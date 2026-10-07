// Reassemblatge de frames H264 rebuts pel canal de vídeo (`ordered: false` i
// retransmissions limitades en el temps: `maxPacketLifeTime`). Cada tros porta
// una capçalera de 8 bytes: frame_id u32 LE, chunk_index u16 LE,
// total_chunks u16 LE.
//
// 🛡️ El canal NO és ordenat i els trossos perduts es retransmeten durant uns
// ~200 ms. Conseqüència: un frame pot completar-se ABANS que l'anterior (a
// l'anterior li ha faltat un tros que arriba retransmès). Això NO és una
// pèrdua. Per això els frames s'entreguen EN ORDRE d'id: un frame complet
// espera (fins a `REORDER_WAIT_MS`) que arribi el que el precedeix, i només si
// no arriba mai es dóna per perdut. Llavors sí: els deltes següents
// descodificarien sobre una base trencada, així que es descarten fins al
// proper keyframe i se'n demana un al Host (missatge `{"t":"kf"}`).
//
// ℹ️ Abans qualsevol salt d'id es tractava com a pèrdua a l'instant; amb
// retransmissions això convertia cada tros recuperat en una petició de
// keyframe i la imatge es congelava.

const HEADER_BYTES = 8;
const MAX_PENDING_FRAMES = 16;
/** Més que el `maxPacketLifeTime` del Host (200 ms) + el RTT: passat això, el Host ja ha abandonat el tros. */
const REORDER_WAIT_MS = 300;
const KEYFRAME_REQUEST_COOLDOWN_MS = 400;
const TICK_MS = 50;

export function isKeyFrameAnnexB(buf: Uint8Array): boolean {
  let i = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      if ((buf[i + 4] & 0x1f) === 5) return true;
      i += 4;
    } else if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      if ((buf[i + 3] & 0x1f) === 5) return true;
      i += 3;
    } else {
      i += 1;
    }
  }
  return false;
}

interface Options {
  onFrame: (frame: Uint8Array) => void;
  requestKeyframe: () => void;
  // Cridat cada cop que es detecta pèrdua (tros perdut, frame que no arriba o
  // frame caducat) — serveix per comptar-les a l'HUD de diagnòstic.
  onLoss?: () => void;
}

interface Entry {
  chunks: (Uint8Array | undefined)[];
  total: number;
  received: number;
  firstSeenAt: number;
}

export function createVideoReassembler({ onFrame, requestKeyframe, onLoss }: Options) {
  const pending = new Map<number, Entry>();
  let nextId: number | null = null; // proper frame_id a lliurar (null = encara sense sincronitzar)
  let needKeyframe = true; // s'arrenca esperant un keyframe
  let lastRequestAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const markBroken = () => {
    needKeyframe = true;
    onLoss?.();
    const now = performance.now();
    if (now - lastRequestAt > KEYFRAME_REQUEST_COOLDOWN_MS) {
      lastRequestAt = now;
      requestKeyframe();
    }
  };

  const assemble = (e: Entry): Uint8Array => {
    let totalLen = 0;
    for (const p of e.chunks) totalLen += p?.length ?? 0;
    const frame = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of e.chunks) {
      frame.set(p!, offset);
      offset += p!.length;
    }
    return frame;
  };

  const deliver = (e: Entry) => {
    const frame = assemble(e);
    if (needKeyframe) {
      if (!isKeyFrameAnnexB(frame)) {
        markBroken(); // segueix sense base vàlida: torna-ho a demanar (amb cooldown)
        return;
      }
      needKeyframe = false;
    }
    onFrame(frame);
  };

  const isComplete = (e: Entry) => e.received === e.total;

  // Lliura en ordre tot el que es pugui; el que no arriba a temps es dóna per perdut.
  const drain = () => {
    const now = performance.now();
    for (let guard = 0; guard < 1000; guard++) {
      if (nextId === null) {
        // Sincronització inicial: comencem pel frame COMPLET amb l'id més baix.
        let lowest: number | null = null;
        for (const [id, e] of pending) {
          if (isComplete(e) && (lowest === null || ((id - lowest) | 0) < 0)) lowest = id;
        }
        if (lowest === null) break;
        nextId = lowest;
      }

      const e = pending.get(nextId);
      if (e && isComplete(e)) {
        pending.delete(nextId);
        nextId = (nextId + 1) >>> 0;
        deliver(e);
        continue;
      }

      // El frame següent no és (del tot) aquí. Només té sentit donar-lo per
      // perdut si ja ha arribat alguna cosa POSTERIOR i fa prou que l'esperem.
      let waitedSince: number | null = e ? e.firstSeenAt : null;
      let hasLater = false;
      for (const [id, other] of pending) {
        if (id === nextId) continue;
        hasLater = true;
        if (waitedSince === null || other.firstSeenAt < waitedSince) waitedSince = other.firstSeenAt;
      }
      if (hasLater && waitedSince !== null && now - waitedSince > REORDER_WAIT_MS) {
        pending.delete(nextId);
        nextId = (nextId + 1) >>> 0;
        markBroken();
        continue;
      }
      break;
    }
  };

  const schedule = () => {
    if (timer !== null || pending.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      drain();
      schedule();
    }, TICK_MS);
  };

  return function push(buf: Uint8Array) {
    if (buf.length < HEADER_BYTES) return;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const frameId = view.getUint32(0, true);
    const chunkIndex = view.getUint16(4, true);
    const totalChunks = view.getUint16(6, true);
    const payload = buf.subarray(HEADER_BYTES);
    if (totalChunks === 0 || chunkIndex >= totalChunks) return;

    // Un frame que ja hem donat per perdut (o ja lliurat) i que arriba tard: s'ignora.
    if (nextId !== null && ((frameId - nextId) | 0) < 0) return;

    let entry = pending.get(frameId);
    if (!entry) {
      entry = { chunks: new Array(totalChunks), total: totalChunks, received: 0, firstSeenAt: performance.now() };
      pending.set(frameId, entry);
      if (pending.size > MAX_PENDING_FRAMES) {
        // Massa frames en vol: el més antic no arribarà. Es descarta i es resincronitza.
        const oldest = [...pending.keys()].sort((a, b) => ((a - b) | 0))[0];
        pending.delete(oldest);
        if (nextId !== null && oldest === nextId) nextId = (nextId + 1) >>> 0;
        markBroken();
      }
    }
    if (!entry.chunks[chunkIndex]) {
      entry.chunks[chunkIndex] = payload;
      entry.received += 1;
    }

    drain();
    schedule();
  };
}
