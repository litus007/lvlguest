// 🎤 Veu bidireccional per micròfon — compartit per les tres eines que en
// fan ús (Compartir Joc, Assistència Remota, Trucada Directa). Reutilitza
// el mateix patró de reordenació per seqüència que `audioReassembler.ts`
// (aquest canal també és `ordered: false`) i la mateixa tècnica de
// descodificació+reproducció amb WebCodecs que ja es feia servir per al so
// del sistema.
//
// 🧪 Peça més nova de tota l'app: `MediaStreamTrackProcessor` + `AudioEncoder`
// per codificar el micròfon és una API relativament recent (Chrome/Edge;
// no WebKit/Safari). Si el navegador no la suporta, `startSendingMic`
// rebutja la promesa amb un missatge clar en lloc de petar en silenci.

import { createAudioReorderBuffer } from "./audioReassembler";

const MIC_SAMPLE_RATE = 48000;

export interface VoicePlayback {
  feedPacket: (packet: Uint8Array) => void;
}

/// Descodifica paquets Opus rebuts (ja reordenats) i els reprodueix amb
/// Web Audio. Una instància per flux (el so del sistema i la veu del
/// micròfon són fluxos independents, cada un amb el seu propi descodificador).
export function createVoicePlayback(
  ctx: AudioContext,
  destination: AudioNode,
  channels: 1 | 2
): VoicePlayback {
  let decoder: AudioDecoder | null = null;
  let configured = false;
  let nextPlayTime = 0;

  const ensureDecoder = () => {
    if (decoder) return decoder;
    if (typeof AudioDecoder === "undefined") return null;
    decoder = new AudioDecoder({
      output: (audioData) => {
        const numberOfChannels = audioData.numberOfChannels;
        const buffer = ctx.createBuffer(numberOfChannels, audioData.numberOfFrames, audioData.sampleRate);
        const chan = new Float32Array(audioData.numberOfFrames);
        for (let c = 0; c < numberOfChannels; c++) {
          audioData.copyTo(chan, { planeIndex: c, format: "f32-planar" });
          buffer.copyToChannel(chan, c);
        }
        audioData.close();

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(destination);

        const now = ctx.currentTime;
        if (nextPlayTime < now) nextPlayTime = now + 0.08;
        src.start(nextPlayTime);
        nextPlayTime += buffer.duration;
      },
      error: (e) => console.error("[VOICE] Error AudioDecoder:", e),
    });
    return decoder;
  };

  let timestamp = 0;
  const pushReordered = createAudioReorderBuffer((payload) => {
    const dec = ensureDecoder();
    if (!dec) return;
    if (!configured) {
      try {
        dec.configure({ codec: "opus", sampleRate: MIC_SAMPLE_RATE, numberOfChannels: channels });
        configured = true;
      } catch {
        return;
      }
    }
    try {
      timestamp += 20000;
      dec.decode(new EncodedAudioChunk({ type: "key", timestamp, data: payload }));
    } catch {
      // paquet descartat — el següent arriba de seguida (20ms)
    }
  });

  return { feedPacket: pushReordered };
}

export interface MicSender {
  stop: () => void;
}

/// Captura el micròfon local, el codifica en Opus amb WebCodecs i l'envia
/// pel canal de dades donat, amb la mateixa capçalera de seqüència de 4
/// bytes que fa servir el costat Rust. Llança si el navegador no suporta
/// `MediaStreamTrackProcessor`/`AudioEncoder` (Safari, principalment).
export async function startSendingMic(dataChannel: RTCDataChannel): Promise<MicSender> {
  if (typeof (window as any).MediaStreamTrackProcessor === "undefined" || typeof AudioEncoder === "undefined") {
    throw new Error("Aquest navegador no suporta l'enviament de micròfon (cal Chrome o Edge).");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: MIC_SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("No s'ha trobat cap micròfon.");

  let seq = 0;
  let stopped = false;

  const encoder = new AudioEncoder({
    output: (chunk) => {
      if (stopped || dataChannel.readyState !== "open") return;
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      const envelope = new Uint8Array(4 + buf.length);
      new DataView(envelope.buffer).setUint32(0, seq, true);
      envelope.set(buf, 4);
      seq = (seq + 1) >>> 0;
      dataChannel.send(envelope);
    },
    error: (e) => console.error("[VOICE] Error AudioEncoder:", e),
  });
  encoder.configure({
    codec: "opus",
    sampleRate: MIC_SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: 32_000,
  });

  // @ts-expect-error - MediaStreamTrackProcessor encara no és a tots els lib.dom.ts
  const processor = new MediaStreamTrackProcessor({ track });
  const reader: ReadableStreamDefaultReader<any> = processor.readable.getReader();

  (async () => {
    while (!stopped) {
      let result;
      try {
        result = await reader.read();
      } catch {
        break;
      }
      if (result.done) break;
      const audioData = result.value;
      try {
        if (encoder.state === "configured") encoder.encode(audioData);
      } catch {
        // frame descartat — no val la pena trencar tot el flux per un
      } finally {
        audioData.close();
      }
    }
  })();

  return {
    stop: () => {
      stopped = true;
      try {
        reader.cancel();
      } catch {
        /* ja tancat */
      }
      track.stop();
      stream.getTracks().forEach((t) => t.stop());
      if (encoder.state !== "closed") {
        try {
          encoder.close();
        } catch {
          /* ja tancat */
        }
      }
    },
  };
}
