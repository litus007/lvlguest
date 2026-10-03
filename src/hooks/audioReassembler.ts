// Reordenament de paquets d'àudio Opus rebuts pel canal "audio" NO fiable
// (`ordered: false, max_retransmits: 0`). Cada paquet porta un número de
// seqüència de 4 bytes (u32 LE) al davant.
//
// 🛡️ Abans, els paquets es passaven a l'`AudioDecoder` directament en
// l'ordre D'ARRIBADA, amb una marca de temps purament seqüencial — si dos
// paquets es creuaven per la xarxa (molt habitual en un canal desordenat),
// sonaven en l'ordre equivocat. Això sonava a "crac"/distorsió, sobretot en
// veus. Aquest mòdul els reordena per número de seqüència abans d'entregar-
// los, amb una finestra curta d'espera (uns pocs paquets de 20ms) perquè no
// s'afegeixi gaire latència — i si un paquet no arriba mai (el canal no en
// fa retransmissió), salta endavant en lloc de quedar-se esperant per
// sempre.

const HEADER_BYTES = 4;
const MAX_WAIT_MS = 60; // ~3 paquets de 20ms — prou per absorbir un creuament normal
const MAX_PENDING = 12; // mai acumular més que això abans de saltar endavant

export function createAudioReorderBuffer(onPacket: (payload: Uint8Array) => void) {
  const pending = new Map<number, { payload: Uint8Array; arrivedAt: number }>();
  let nextSeq: number | null = null;

  const drain = () => {
    if (nextSeq === null) return;
    while (pending.has(nextSeq)) {
      const entry = pending.get(nextSeq)!;
      pending.delete(nextSeq);
      onPacket(entry.payload);
      nextSeq = (nextSeq + 1) >>> 0;
    }
  };

  const skipAheadIfStale = () => {
    if (nextSeq === null || pending.size === 0) return;
    const now = performance.now();
    const oldest = pending.get(nextSeq);
    const tooOld = oldest !== undefined && now - oldest.arrivedAt > MAX_WAIT_MS;
    const tooFull = pending.size > MAX_PENDING;
    if (!tooOld && !tooFull) return;
    // El paquet `nextSeq` no arribarà mai (pèrdua real al canal no fiable) —
    // saltem fins al més antic que sí que tenim, perdent aquest tros.
    const keys = [...pending.keys()];
    nextSeq = keys.reduce((min, k) => (min === null || k < min ? k : min), null as number | null);
    drain();
  };

  return function push(buf: Uint8Array) {
    if (buf.length < HEADER_BYTES) return;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const seq = view.getUint32(0, true);
    const payload = buf.subarray(HEADER_BYTES);

    if (nextSeq === null) nextSeq = seq;

    // Ja massa tard per aquest (el vam saltar fa temps) — es descarta.
    const age = (seq - nextSeq + 0x100000000) % 0x100000000;
    if (age > 0x80000000) return;

    pending.set(seq, { payload, arrivedAt: performance.now() });
    drain();
    skipAheadIfStale();
  };
}
