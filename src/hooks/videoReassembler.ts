// Reassemblatge de frames H264 rebuts pel canal de vídeo NO fiable
// (`ordered: false, max_retransmits: 0`). Cada tros porta una capçalera de
// 8 bytes: frame_id u32 LE, chunk_index u16 LE, total_chunks u16 LE.
//
// 🔑 Novetat: si es perd QUALSEVOL tros (frame incomplet), o hi ha un salt de
// `frame_id`, els frames delta següents s'han de descodificar sobre una base
// trencada. Aquí els descartem fins al proper keyframe i, alhora, demanem al
// Host que en generi un a l'instant (missatge `{"t":"kf"}` pel canal d'inputs).

const HEADER_BYTES = 8;
const MAX_PENDING_FRAMES = 6;
const FRAME_TIMEOUT_MS = 500;
const KEYFRAME_REQUEST_COOLDOWN_MS = 400;

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
}

export function createVideoReassembler({ onFrame, requestKeyframe }: Options) {
  const pending = new Map<
    number,
    { chunks: (Uint8Array | undefined)[]; received: number; firstSeenAt: number }
  >();
  let lastDeliveredId: number | null = null;
  let needKeyframe = true; // s'arrenca esperant un keyframe
  let lastRequestAt = 0;

  const markBroken = () => {
    needKeyframe = true;
    const now = performance.now();
    if (now - lastRequestAt > KEYFRAME_REQUEST_COOLDOWN_MS) {
      lastRequestAt = now;
      requestKeyframe();
    }
  };

  return function push(buf: Uint8Array) {
    if (buf.length < HEADER_BYTES) return;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const frameId = view.getUint32(0, true);
    const chunkIndex = view.getUint16(4, true);
    const totalChunks = view.getUint16(6, true);
    const payload = buf.subarray(HEADER_BYTES);
    if (totalChunks === 0 || chunkIndex >= totalChunks) return;

    let entry = pending.get(frameId);
    if (!entry) {
      entry = { chunks: new Array(totalChunks), received: 0, firstSeenAt: performance.now() };
      pending.set(frameId, entry);
      if (pending.size > MAX_PENDING_FRAMES) {
        const oldest = [...pending.keys()].sort((a, b) => a - b)[0];
        pending.delete(oldest);
        markBroken();
      }
    }
    if (!entry.chunks[chunkIndex]) {
      entry.chunks[chunkIndex] = payload;
      entry.received += 1;
    }

    if (entry.received === totalChunks) {
      pending.delete(frameId);
      const totalLen = entry.chunks.reduce((acc, p) => acc + (p?.length ?? 0), 0);
      const frame = new Uint8Array(totalLen);
      let offset = 0;
      for (const p of entry.chunks) {
        if (!p) return;
        frame.set(p, offset);
        offset += p.length;
      }

      // Salt de seqüència = s'ha perdut algun frame pel camí.
      if (lastDeliveredId !== null && frameId !== ((lastDeliveredId + 1) >>> 0)) {
        markBroken();
      }
      lastDeliveredId = frameId;

      if (needKeyframe) {
        if (!isKeyFrameAnnexB(frame)) {
          markBroken(); // segueix sense base vàlida: torna-ho a demanar (amb cooldown)
          return;
        }
        needKeyframe = false;
      }
      onFrame(frame);
    }

    const now = performance.now();
    for (const [id, e] of pending) {
      if (now - e.firstSeenAt > FRAME_TIMEOUT_MS) {
        pending.delete(id);
        markBroken();
      }
    }
  };
}
