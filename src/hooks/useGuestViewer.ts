import { createVideoReassembler } from "./videoReassembler";
import { createAudioReorderBuffer } from "./audioReassembler";
import { createVoicePlayback, startSendingMic } from "./voiceChat";
import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { InputMessage } from "../types/inputProtocol";

export type ViewerPhase = "idle" | "searching" | "negotiating" | "connected" | "failed";

export interface ConnectionStats {
  rttMs: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
}

// 👥 Multi-guest: el Host pot tenir VARIS Guests a la mateixa sala, tots al
// mateix canal de difusió. `toPeerId` diu a qui va adreçat cada missatge;
// qui el rep i no n'és el destinatari l'ignora. (Sense `toPeerId` — Hosts
// antics — el missatge es tracta com sempre.)
type WebRtcSignalMessage =
  | { type: "offer"; fromPeerId: string; toPeerId?: string; sdp: string }
  | { type: "answer"; fromPeerId: string; toPeerId?: string; sdp: string }
  | { type: "ice-candidate"; fromPeerId: string; toPeerId?: string; candidate: string };

// Mateixos servidors STUN/TURN que fa servir l'app d'escriptori — han de
// coincidir perquè els dos costats negociïn candidats ICE compatibles
// quan la xarxa no permet connexió P2P directa.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.relay.metered.ca:80" },
  {
    urls: [
      "turn:global.relay.metered.ca:80",
      "turn:global.relay.metered.ca:443",
      "turn:global.relay.metered.ca:443?transport=tcp",
      "turns:global.relay.metered.ca:443?transport=tcp",
    ],
    username: "31b19a4757491e833e0bc1d3",
    credential: "27ZtwUL1sdb22PpM",
  },
];

interface UseGuestViewerOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  // 🛡️ Substitueix l'antic `audioRef` (<audio> ocult amb el track RTP,
  // que mai va sonar — vegis el fix a `ondatachannel`/"audio" més avall).
  // Ara la reproducció és 100% Web Audio API; només calen mut/resume,
  // controlats des de fora amb el mateix botó "Activar So" de sempre.
  audioMuted: boolean;
  onLog: (message: string) => void;
}

/**
 * Aquest hook reprodueix EXACTAMENT el mateix protocol que
 * `useGuestPeerConnection` + `useWebRtcSignaling` de l'app d'escriptori
 * (rol Guest), perquè aquest visor web és compatible amb qualsevol Host
 * Tauri ja desplegat, sense canviar res al costat del Host:
 *
 *  1. Es fa `presence.track` al canal `streaming-presence:<codi>` per
 *     anunciar-nos com a "guest" — el Host, en veure'ns, crea una Offer.
 *  2. L'Offer/Answer/ICE viatgen pel canal de broadcast
 *     `webrtc-signal:<codi>`.
 *  3. El vídeo NO arriba per un track RTP normal, sinó per un
 *     RTCDataChannel etiquetat "video" amb frames H.264 Annex-B crus,
 *     que decodifiquem amb la WebCodecs API i dibuixem a un <canvas>.
 *
 * Aquest visor REP pantalla i, un cop connectat, també ENVIA els inputs
 * de teclat, ratolí i comandament — a través del mateix canal de dades
 * "inputs" que el Host ja obre cap al Guest, amb el mateix format que
 * fa servir `useInputCapture` a l'app d'escriptori. No calen canvis al
 * Host: el protocol de missatges és idèntic bit a bit.
 */
export function useGuestViewer({ canvasRef, audioMuted, onLog }: UseGuestViewerOptions) {
  const [phase, setPhase] = useState<ViewerPhase>("idle");
  // 📊 Diagnòstic de vídeo al Guest: separa "no arriba" (xarxa) de "arriba
  // però no es pinta" (descodificació) per saber on és el coll d'ampolla.
  const [chatMessages, setChatMessages] = useState<{ from: "me" | "host"; text: string }[]>([]);
  const [quickActionMsg, setQuickActionMsg] = useState<string | null>(null);
  const incomingFileRef = useRef<{ name: string; size: number; chunks: Uint8Array[] } | null>(null);
  const droppingUntilKeyRef = useRef(false);
  const rxFramesRef = useRef(0);
  const decFramesRef = useRef(0);
  const lossesRef = useRef(0);
  const kfReqRef = useRef(0);
  const [videoStats, setVideoStats] = useState({ rxFps: 0, decFps: 0, losses: 0, kfRequests: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setVideoStats({
        rxFps: rxFramesRef.current,
        decFps: decFramesRef.current,
        losses: lossesRef.current,
        kfRequests: kfReqRef.current,
      });
      rxFramesRef.current = 0;
      decFramesRef.current = 0;
      lossesRef.current = 0;
      kfReqRef.current = 0;
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const [stats, setStats] = useState<ConnectionStats>({ rttMs: null, packetsLost: null, jitterMs: null });
  // 🩺 Panell de diagnòstic del Host (mode "Manteniment Remot") — arriba un
  // únic cop pel canal fiable "diag" en connectar.
  const [diagSnapshot, setDiagSnapshot] = useState<Record<string, unknown> | null>(null);

  const myPeerIdRef = useRef<string>(crypto.randomUUID());
  // 👥 El Host que ens ha enviat l'oferta: hi adrecem respostes i candidats ICE.
  const hostPeerIdRef = useRef<string | null>(null);
  // 👥 Gent a la sala segons la presència (inclòs jo) — per a "N persones".
  const [peopleCount, setPeopleCount] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isProcessingOfferRef = useRef(false);
  const failTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputChannelRef = useRef<RTCDataChannel | null>(null);
  // 🆕 Mode "Assistència Remota": referències pròpies per poder enviar-hi
  // dades des de fora (botó "Actualitza estadístiques" / enviar un fitxer).
  const diagChannelRef = useRef<RTCDataChannel | null>(null);
  const filesChannelRef = useRef<RTCDataChannel | null>(null);
  // 🆕 "Només xarxa local": fixat en el moment de `connect()`, abans de
  // crear el RTCPeerConnection.
  const lanOnlyRef = useRef(false);

  const videoDecoderRef = useRef<VideoDecoder | null>(null);
  const decoderConfiguredRef = useRef(false);
  const pendingChunksRef = useRef<Uint8Array[]>([]);
  const decodedFrameCountRef = useRef(0);
  const fpsWindowStartRef = useRef(performance.now());

  // 🔊 Reproducció d'àudio 100% Web Audio API — el track RTP d'àudio mai
  // va sonar (vegis el fix a `ondatachannel`/"audio"), així que ara
  // rebem paquets Opus crus pel DataChannel i els decodifiquem/programem
  // nosaltres mateixos, sense passar per cap <audio>/<video> element.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const audioDecoderRef = useRef<AudioDecoder | null>(null);
  const audioDecoderConfiguredRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const audioTimestampRef = useRef(0);
  const audioPacketCountRef = useRef(0);
  // 🎤 Veu per micròfon — flux INDEPENDENT del so del sistema de dalt,
  // amb el seu propi descodificador (mateixa tècnica, canal diferent).
  const micChannelRef = useRef<RTCDataChannel | null>(null);
  // 🗣️ Un reproductor per parlant: "host" (canal "mic") i cada altre convidat
  // (canals "voice:<peer_id>", retransmesos pel Host en trucades/partides de grup).
  const voicePlaybacksRef = useRef<Map<string, ReturnType<typeof createVoicePlayback>>>(new Map());
  const micSenderRef = useRef<{ stop: () => void } | null>(null);
  const [micSending, setMicSending] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    if (typeof AudioContext === "undefined") return null;
    const ctx = new AudioContext({ sampleRate: 48000 });
    const gain = ctx.createGain();
    gain.gain.value = audioMuted ? 0 : 1;
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    masterGainRef.current = gain;
    return ctx;
  }, [audioMuted]);

  const handleAudioPacket = useCallback(
    (opusPacket: Uint8Array) => {
      if (typeof AudioDecoder === "undefined") {
        if (audioPacketCountRef.current === 0) {
          onLog("❌ Aquest navegador no suporta WebCodecs (AudioDecoder). Prova amb Chrome o Edge recents.");
        }
        audioPacketCountRef.current += 1;
        return;
      }

      const ctx = ensureAudioContext();
      if (!ctx) return;

      if (!audioDecoderRef.current) {
        audioDecoderRef.current = new AudioDecoder({
          output: (audioData) => {
            const gain = masterGainRef.current;
            if (!gain) {
              audioData.close();
              return;
            }
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
            src.connect(gain);

            // Programació seqüencial sense forats/talls: si ens hem
            // quedat enrere (backlog buit o negatiu), reprenem amb un
            // petit marge (~80ms) en lloc d'intentar recuperar el retard
            // acumulat — per a àudio en temps real, un forat curt és
            // preferible a anar sempre endarrerit.
            const now = ctx.currentTime;
            if (nextPlayTimeRef.current < now) {
              nextPlayTimeRef.current = now + 0.08;
            }
            src.start(nextPlayTimeRef.current);
            nextPlayTimeRef.current += buffer.duration;
          },
          error: (e) => console.error("[GUEST-WEB] Error AudioDecoder:", e),
        });
      }

      if (!audioDecoderConfiguredRef.current) {
        try {
          audioDecoderRef.current.configure({
            codec: "opus",
            sampleRate: 48000,
            numberOfChannels: 2,
          });
          audioDecoderConfiguredRef.current = true;
        } catch (e) {
          onLog(`❌ Error configurant AudioDecoder: ${e}`);
          return;
        }
      }

      audioPacketCountRef.current += 1;
      if (audioPacketCountRef.current === 1) {
        onLog(`🔊 Primer paquet d'àudio rebut (${opusPacket.length} bytes).`);
      }

      try {
        audioTimestampRef.current += 20000; // 20ms en microsegons
        audioDecoderRef.current.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: audioTimestampRef.current,
            data: opusPacket,
          })
        );
      } catch {
        // Paquet corrupte o fora d'ordre — el següent ja ho corregeix sol.
      }
    },
    [ensureAudioContext, onLog]
  );

  // Mut/activar so i "despertar" l'AudioContext (requereix gest d'usuari
  // als navegadors) sempre que canviï `audioMuted` des de fora.
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = audioMuted ? 0 : 1;
    }
    if (!audioMuted) {
      audioCtxRef.current?.resume().catch(() => {});
    }
  }, [audioMuted]);

  const isKeyFrameAnnexB = (buf: Uint8Array): boolean => {
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
  };

  const handleVideoFrame = useCallback(
    (frame: Uint8Array) => {
      if (typeof VideoDecoder === "undefined") {
        onLog("❌ Aquest navegador no suporta WebCodecs (VideoDecoder). Prova amb Chrome o Edge recents.");
        return;
      }

      if (!videoDecoderRef.current) {
        videoDecoderRef.current = new VideoDecoder({
          output: (videoFrame) => {
            decFramesRef.current += 1;
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d", { alpha: false, desynchronized: true });
            if (canvas && ctx) {
              if (canvas.width !== videoFrame.displayWidth || canvas.height !== videoFrame.displayHeight) {
                canvas.width = videoFrame.displayWidth;
                canvas.height = videoFrame.displayHeight;
              }
              ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
            }
            videoFrame.close();

            // 🔎 DIAGNÒSTIC: FPS reals de decodificació+pintat al canvas,
            // cada ~2s — per saber si el coll d'ampolla és aquí (navegador)
            // o a la captura/codificació del Host.
            decodedFrameCountRef.current += 1;
            const windowElapsed = performance.now() - fpsWindowStartRef.current;
            if (windowElapsed >= 2000) {
              const fps = (decodedFrameCountRef.current / windowElapsed) * 1000;
              onLog(`🔎 Decodificació: ${fps.toFixed(1)} FPS reals al canvas.`);
              decodedFrameCountRef.current = 0;
              fpsWindowStartRef.current = performance.now();
            }
          },
          error: (e) => console.error("[GUEST-WEB] Error VideoDecoder:", e),
        });
      }

      const isKey = isKeyFrameAnnexB(frame);

      if (!decoderConfiguredRef.current) {
        if (!isKey) return;
        try {
          videoDecoderRef.current.configure({
            codec: "avc1.42001f",
            // @ts-expect-error - suport de format avc no tipat encara
            avc: { format: "annexb" },
            optimizeForLatency: true,
          });
          decoderConfiguredRef.current = true;
        } catch {
          return;
        }
      }

      // 🚦 Si el descodificador (mòbil lent) s'endarrereix, seguir-li donant
      // frames només afegeix latència. Es descarten els deltes fins al proper
      // keyframe (que es demana al Host un sol cop per episodi).
      if (isKey) {
        droppingUntilKeyRef.current = false;
      } else if (droppingUntilKeyRef.current) {
        return;
      } else if (videoDecoderRef.current.decodeQueueSize > 8) {
        droppingUntilKeyRef.current = true;
        lossesRef.current += 1;
        kfReqRef.current += 1;
        const ic = inputChannelRef.current;
        if (ic && ic.readyState === "open") ic.send(JSON.stringify({ t: "kf" }));
        return;
      }

      try {
        const chunk = new EncodedVideoChunk({
          type: isKey ? "key" : "delta",
          timestamp: performance.now() * 1000,
          data: frame,
        });
        videoDecoderRef.current.decode(chunk);
      } catch {
        // Frame corrupte o fora d'ordre — el següent keyframe ho arregla sol.
      }
    },
    [canvasRef, onLog]
  );

  const sendSignal = useCallback((payload: WebRtcSignalMessage) => {
    signalChannelRef.current?.send({
      type: "broadcast",
      event: "webrtc-signal",
      payload: { ...payload, toPeerId: hostPeerIdRef.current ?? undefined },
    });
  }, []);

  // 🗣️ Reprodueix un paquet de veu d'un parlant concret.
  const feedVoice = useCallback(
    (sourceId: string, payload: Uint8Array) => {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      let playback = voicePlaybacksRef.current.get(sourceId);
      if (!playback) {
        // 🛡️ La veu va DIRECTA a la sortida, no pel guany mestre: el botó 🔊
        // només silencia el so del joc/sistema. El Host (Rust) codifica en
        // estèreo, així que el descodificador també és de 2 canals.
        playback = createVoicePlayback(ctx, ctx.destination, 2);
        voicePlaybacksRef.current.set(sourceId, playback);
      }
      playback.feedPacket(payload);
    },
    [ensureAudioContext]
  );

  const ensurePeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({ iceServers: lanOnlyRef.current ? [] : ICE_SERVERS });
    pcRef.current = pc;

    // 🛡️ FIX (el so mai s'escoltava): l'àudio anava pel track RTP/SRTP
    // "normal" — el MATEIX mecanisme que ja vam haver de descartar pel
    // vídeo perquè no funcionava en aquest muntatge de webrtc-rs. El
    // Host ara envia l'àudio pel DataChannel "audio" (com el vídeo), i
    // aquest track RTP es manté només de forma vestigial — no cal fer
    // res amb ell.
    pc.ontrack = (event) => {
      onLog(`🎯 Track WebRTC rebut del Host (tipus: ${event.track.kind}, id: ${event.track.id}) — vestigial, ignorat.`);
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;

      if (dc.label === "inputs") {
        inputChannelRef.current = dc;
        dc.onopen = () => onLog("🎮 Canal de control obert — teclat, ratolí i comandament actius.");
        dc.onclose = () => {
          if (inputChannelRef.current === dc) inputChannelRef.current = null;
        };
        return;
      }

      if (dc.label === "audio") {
        dc.binaryType = "arraybuffer";
        // 🛡️ FIX DE QUALITAT ("el so era horrible"): aquest canal és
        // `ordered: false` — sense reordenar, dos paquets que es creuin
        // sonen en l'ordre equivocat. Vegis `audioReassembler.ts`.
        const pushAudio = createAudioReorderBuffer((payload) => handleAudioPacket(payload));
        dc.onopen = () => onLog("🔊 Canal d'àudio obert.");
        dc.onmessage = (msg) => {
          const buf = new Uint8Array(msg.data as ArrayBuffer);
          if (buf.length === 0) return;
          pushAudio(buf);
        };
        return;
      }

      if (dc.label === "diag") {
        diagChannelRef.current = dc;
        dc.onclose = () => {
          if (diagChannelRef.current === dc) diagChannelRef.current = null;
        };
        dc.onmessage = (msg) => {
          if (typeof msg.data !== "string") return;
          try {
            setDiagSnapshot(JSON.parse(msg.data));
            onLog("🩺 Estadístiques del Host rebudes.");
          } catch (e) {
            onLog(`❌ Error parsejant el diagnòstic: ${e}`);
          }
        };
        return;
      }

      // 👥 Veu d'un ALTRE convidat, retransmesa pel Host: cada parlant té el
      // seu canal i, per tant, la seva pròpia reordenació i descodificador.
      if (dc.label.startsWith("voice:")) {
        const sourceId = dc.label.slice("voice:".length);
        dc.binaryType = "arraybuffer";
        const pushVoice = createAudioReorderBuffer((payload) => feedVoice(sourceId, payload));
        dc.onmessage = (msg) => {
          const buf = new Uint8Array(msg.data as ArrayBuffer);
          if (buf.length > 0) pushVoice(buf);
        };
        return;
      }

      if (dc.label === "mic") {
        micChannelRef.current = dc;
        // 🛡️ FIX: sense això el navegador lliura `Blob` (el valor per
        // defecte als canals de dades) i `new Uint8Array(blob)` queda buit:
        // la veu rebuda s'ignorava en silenci. Vídeo i àudio ja ho feien.
        dc.binaryType = "arraybuffer";
        const pushMic = createAudioReorderBuffer((payload) => feedVoice("host", payload));
        dc.onopen = () => onLog("🎤 Canal de veu obert.");
        dc.onmessage = (msg) => {
          const buf = new Uint8Array(msg.data as ArrayBuffer);
          if (buf.length > 0) pushMic(buf);
        };
        return;
      }
      if (dc.label === "files") {
        filesChannelRef.current = dc;
        dc.onmessage = (msg) => {
          if (typeof msg.data !== "string") {
            // 📥 Tros binari d'un fitxer que ens envia el Host.
            const incoming = incomingFileRef.current;
            if (incoming) incoming.chunks.push(new Uint8Array(msg.data as ArrayBuffer));
            return;
          }
          try {
            const parsed = JSON.parse(msg.data);
            if (parsed.type === "chat" && typeof parsed.text === "string") {
              setChatMessages((prev) => [...prev.slice(-100), { from: "host", text: parsed.text }]);
            } else if (parsed.type === "quick_action_result") {
              setQuickActionMsg(parsed.message);
              onLog(parsed.message);
            } else if (parsed.type === "start" && typeof parsed.name === "string") {
              incomingFileRef.current = { name: parsed.name, size: parsed.size ?? 0, chunks: [] };
            } else if (parsed.type === "end") {
              const incoming = incomingFileRef.current;
              incomingFileRef.current = null;
              if (incoming) {
                // 🌐 Al navegador no podem "desar al disc": oferim una
                // baixada normal (Blob + enllaç temporal), tal com faria
                // qualsevol pàgina en descarregar un fitxer.
                const blob = new Blob(incoming.chunks as BlobPart[]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = incoming.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 30_000);
                onLog(`📥 "${incoming.name}" rebut del Host — descarregant...`);
              }
            }
          } catch {
            // missatge no JSON: s'ignora
          }
        };
        dc.onopen = () => onLog("📁 Canal de fitxers obert.");
        dc.onclose = () => {
          if (filesChannelRef.current === dc) filesChannelRef.current = null;
        };
        return;
      }

      if (dc.label !== "video") return;

      // 🩺 FIX DE QUALITAT (mateix motiu que a l'app d'escriptori, vegis
      // `useGuestPeerConnection.ts`): aquest canal és `ordered: false,
      // max_retransmits: 0` al Host — sense ordre ni garantia d'entrega.
      // Concatenar per ordre d'arribada amb només un bit "és l'últim" (com
      // abans) pot ajuntar trossos de frames diferents o en l'ordre
      // equivocat sense poder-ho detectar. Ara cada tros porta una
      // capçalera de 8 bytes (frame_id u32 LE, chunk_index u16 LE,
      // total_chunks u16 LE): reordenem per `chunk_index` i descartem el
      // frame sencer si en falta algun, en lloc de lliurar-lo corrupte.
      dc.binaryType = "arraybuffer";
      const push = createVideoReassembler({
        onFrame: (frame) => { rxFramesRef.current += 1; handleVideoFrame(frame); },
        onLoss: () => { lossesRef.current += 1; },
        requestKeyframe: () => {
          const ic = inputChannelRef.current;
          kfReqRef.current += 1;
          if (ic && ic.readyState === "open") ic.send(JSON.stringify({ t: "kf" }));
        },
      });
      dc.onopen = () => onLog("🎬 Canal de vídeo obert.");
      dc.onmessage = (msg) => push(new Uint8Array(msg.data as ArrayBuffer));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          type: "ice-candidate",
          fromPeerId: myPeerIdRef.current,
          candidate: JSON.stringify(event.candidate),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        if (failTimeoutRef.current) {
          clearTimeout(failTimeoutRef.current);
          failTimeoutRef.current = null;
        }
        setPhase("connected");

        // 📶 Mesura de latència/estabilitat: nivell ICE, vàlida encara que
        // el vídeo viatgi per un DataChannel i no per un track RTP.
        if (!statsIntervalRef.current) {
          statsIntervalRef.current = setInterval(async () => {
            const activePc = pcRef.current;
            if (!activePc) return;
            try {
              const report = await activePc.getStats();
              report.forEach((entry) => {
                if (entry.type === "candidate-pair" && entry.state === "succeeded" && (entry as any).nominated) {
                  const rtt = (entry as any).currentRoundTripTime;
                  if (typeof rtt === "number") {
                    setStats((prev) => ({ ...prev, rttMs: Math.round(rtt * 1000) }));
                  }
                }
              });
            } catch {
              // getStats pot fallar momentàniament — es reintenta al següent tick.
            }
          }, 2000);
        }
      }

      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (!failTimeoutRef.current) {
          failTimeoutRef.current = setTimeout(() => {
            if (pcRef.current && (pcRef.current.connectionState === "failed" || pcRef.current.connectionState === "closed")) {
              setPhase("failed");
            }
          }, 5000);
        }
      }
    };

    return pc;
  }, [ensureAudioContext, feedVoice, handleAudioPacket, handleVideoFrame, onLog, sendSignal]);

  const applyOffer = useCallback(
    async (sdp: string) => {
      const pc = ensurePeerConnection();
      if (isProcessingOfferRef.current) return;

      try {
        isProcessingOfferRef.current = true;
        setPhase("negotiating");
        const offer: RTCSessionDescriptionInit = JSON.parse(sdp);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // 🔎 DIAGNÒSTIC: registrem quins "transceivers" ha creat el navegador
        // en processar l'oferta — si aquí ja no hi ha cap transceiver
        // d'àudio/vídeo (o surten "stopped"/"inactive"), el problema és de
        // negociació SDP, no del nostre codi de reproducció.
        const transceiverInfo = pc
          .getTransceivers()
          .map((t) => `${t.receiver.track?.kind ?? "?"}:${t.currentDirection ?? t.direction}`)
          .join(", ");
        onLog(`🔎 Transceivers negociats: [${transceiverInfo || "cap"}]`);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal({
          type: "answer",
          fromPeerId: myPeerIdRef.current,
          sdp: JSON.stringify({ type: pc.localDescription?.type, sdp: pc.localDescription?.sdp }),
        });

        if (iceQueueRef.current.length > 0) {
          for (const candidate of iceQueueRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          }
          iceQueueRef.current = [];
        }
      } catch (err) {
        onLog(`❌ Error processant l'oferta del Host: ${err}`);
        setPhase("failed");
      } finally {
        isProcessingOfferRef.current = false;
      }
    },
    [ensurePeerConnection, onLog, sendSignal]
  );

  const addIceCandidate = useCallback(async (candidateJson: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      let parsed = JSON.parse(candidateJson);
      if (parsed && parsed.candidate && typeof parsed.candidate === "object") {
        parsed = parsed.candidate;
      }
      const candidateInit: RTCIceCandidateInit = {
        candidate: parsed.candidate ?? parsed,
        sdpMid: parsed.sdpMid ?? "0",
        sdpMLineIndex: parsed.sdpMLineIndex ?? 0,
      };

      if (pc.remoteDescription && pc.remoteDescription.type && !isProcessingOfferRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
      } else {
        iceQueueRef.current.push(candidateInit);
      }
    } catch {
      // Candidat malformat — l'ignorem, en solen arribar molts més.
    }
  }, []);

  const sendInput = useCallback((msg: InputMessage) => {
    const dc = inputChannelRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(
    (roomCode: string, lanOnly: boolean = false, mode: "game" | "assist" | "call" = "game") => {
      const code = roomCode.trim().toUpperCase();
      if (!code) return;

      lanOnlyRef.current = lanOnly;
      setPhase("searching");
      onLog(`Cercant la sala "${code}"...${lanOnly ? " (mode només-LAN)" : ""}`);

      // 🩺 Mode "Assistència Remota": mateix espai de noms que fa servir el
      // Host (`webrtc_assist_create_offer` + `assist-presence:<codi>`) per
      // no col·lidir mai amb una sala de "Compartir Joc" amb el mateix codi.
      // 📞 Mode "Trucada Directa": mateixos noms que `CallView.tsx` a l'app
      // d'escriptori (`call:<codi>` + `call-presence:<codi>`).
      const signalRoomId = mode === "assist" ? `assist:${code}` : mode === "call" ? `call:${code}` : code;
      const presenceRoomName =
        mode === "assist"
          ? `assist-presence:${code}`
          : mode === "call"
          ? `call-presence:${code}`
          : `streaming-presence:${code}`;

      const signalChannel = supabase
        .channel(`webrtc-signal:${signalRoomId}`, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "webrtc-signal" }, ({ payload }: { payload: WebRtcSignalMessage }) => {
          if (payload.fromPeerId === myPeerIdRef.current) return;
          // 👥 Adreçat a un altre convidat de la sala: no és per a mi.
          if (payload.toPeerId && payload.toPeerId !== myPeerIdRef.current) return;
          if (payload.type === "offer") {
            hostPeerIdRef.current = payload.fromPeerId;
            onLog(`Oferta rebuda del Host — negociant...`);
            applyOffer(payload.sdp);
          } else if (payload.type === "ice-candidate") {
            addIceCandidate(payload.candidate);
          }
          // El Guest mai rep "answer" — això només ho envia ell mateix.
        })
        .subscribe();
      signalChannelRef.current = signalChannel;

      const presenceChannel = supabase.channel(presenceRoomName, {
        config: { presence: { key: myPeerIdRef.current } },
      });
      presenceChannel.on("presence", { event: "sync" }, () => {
        setPeopleCount(Object.keys(presenceChannel.presenceState()).length);
      });
      presenceChannel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presenceChannel.track({ peer_id: myPeerIdRef.current, role: "guest" });
          onLog("Presència anunciada. Esperant que el Host respongui...");
        }
      });
      presenceChannelRef.current = presenceChannel;
    },
    [addIceCandidate, applyOffer, onLog]
  );

  // 🩺 Demana un snapshot fresc de diagnòstic al Host (botó "Actualitza
  // estadístiques" — mai automàtic).
  const requestDiagRefresh = useCallback(() => {
    const dc = diagChannelRef.current;
    if (dc && dc.readyState === "open") {
      dc.send("refresh");
    }
  }, []);

  // 📁 Envia un fitxer sencer al Host pel canal "files" (fiable i ordenat).
  // Mateix protocol que l'app d'escriptori — vegis `file_transfer.rs`.
  const sendFileToHost = useCallback(
    async (file: File, onProgress?: (sentBytes: number, totalBytes: number) => void) => {
      const dc = filesChannelRef.current;
      if (!dc || dc.readyState !== "open") {
        throw new Error("El canal de fitxers no està obert.");
      }
      const CHUNK_SIZE = 16_000;
      dc.send(JSON.stringify({ type: "start", name: file.name, size: file.size }));

      const buffer = await file.arrayBuffer();
      let offset = 0;
      while (offset < buffer.byteLength) {
        const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
        while (dc.bufferedAmount > 8 * CHUNK_SIZE) {
          await new Promise((r) => setTimeout(r, 20));
        }
        dc.send(chunk);
        offset += chunk.byteLength;
        onProgress?.(offset, buffer.byteLength);
      }

      dc.send(JSON.stringify({ type: "end" }));
    },
    []
  );

  // ⚡ Demana al Host que executi una acció ràpida.
  const requestQuickAction = useCallback((action: "clean_temp_files" | "lock_screen") => {
    const dc = filesChannelRef.current;
    if (dc && dc.readyState === "open") {
      setQuickActionMsg(null);
      dc.send(JSON.stringify({ type: "quick_action", action }));
    }
  }, []);

  const sendChat = useCallback((text: string) => {
    const dc = filesChannelRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify({ type: "chat", text }));
      setChatMessages((prev) => [...prev.slice(-100), { from: "me", text }]);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (failTimeoutRef.current) clearTimeout(failTimeoutRef.current);
    failTimeoutRef.current = null;
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    statsIntervalRef.current = null;

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (signalChannelRef.current) {
      supabase.removeChannel(signalChannelRef.current);
      signalChannelRef.current = null;
    }
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }

    videoDecoderRef.current?.close();
    videoDecoderRef.current = null;
    decoderConfiguredRef.current = false;
    pendingChunksRef.current = [];
    iceQueueRef.current = [];
    inputChannelRef.current = null;
    diagChannelRef.current = null;
    filesChannelRef.current = null;
    micChannelRef.current = null;
    voicePlaybacksRef.current.clear();
    hostPeerIdRef.current = null;
    setPeopleCount(0);
    micSenderRef.current?.stop();
    micSenderRef.current = null;
    setMicSending(false);
    setMicError(null);

    audioDecoderRef.current?.close();
    audioDecoderRef.current = null;
    audioDecoderConfiguredRef.current = false;
    audioTimestampRef.current = 0;
    nextPlayTimeRef.current = 0;
    audioPacketCountRef.current = 0;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    masterGainRef.current = null;

    setPhase("idle");
    setStats({ rttMs: null, packetsLost: null, jitterMs: null });
    setChatMessages([]);
    setQuickActionMsg(null);
    incomingFileRef.current = null;
    setDiagSnapshot(null);
    lanOnlyRef.current = false;
  }, []);

  useEffect(() => disconnect, [disconnect]);

  // 🎤 Activa/desactiva l'ENVIAMENT del propi micròfon. Sentir l'altra
  // banda no depèn d'això — ja es reprodueix sol des que arriben paquets.
  const toggleMic = useCallback(async () => {
    if (micSenderRef.current) {
      micSenderRef.current.stop();
      micSenderRef.current = null;
      setMicSending(false);
      return;
    }
    const dc = micChannelRef.current;
    if (!dc || dc.readyState !== "open") {
      setMicError("El canal de veu encara no està obert.");
      return;
    }
    setMicError(null);
    try {
      micSenderRef.current = await startSendingMic(dc);
      setMicSending(true);
    } catch (e) {
      setMicError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  return {
    phase, connect, disconnect, sendInput, stats, videoStats, chatMessages, sendChat,
    requestQuickAction, quickActionMsg, diagSnapshot, requestDiagRefresh, sendFileToHost,
    toggleMic, micSending, micError, peopleCount,
  };
}
