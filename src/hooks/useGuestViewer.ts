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

type WebRtcSignalMessage =
  | { type: "offer"; fromPeerId: string; sdp: string }
  | { type: "answer"; fromPeerId: string; sdp: string }
  | { type: "ice-candidate"; fromPeerId: string; candidate: string };

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
  const [stats, setStats] = useState<ConnectionStats>({ rttMs: null, packetsLost: null, jitterMs: null });
  // 🩺 Panell de diagnòstic del Host (mode "Manteniment Remot") — arriba un
  // únic cop pel canal fiable "diag" en connectar.
  const [diagSnapshot, setDiagSnapshot] = useState<Record<string, unknown> | null>(null);

  const myPeerIdRef = useRef<string>(crypto.randomUUID());
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const signalChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isProcessingOfferRef = useRef(false);
  const failTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputChannelRef = useRef<RTCDataChannel | null>(null);
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
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
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
    signalChannelRef.current?.send({ type: "broadcast", event: "webrtc-signal", payload });
  }, []);

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
        dc.onopen = () => onLog("🔊 Canal d'àudio obert.");
        dc.onmessage = (msg) => {
          const buf = new Uint8Array(msg.data as ArrayBuffer);
          if (buf.length === 0) return;
          handleAudioPacket(buf);
        };
        return;
      }

      if (dc.label === "diag") {
        dc.onmessage = (msg) => {
          if (typeof msg.data !== "string") return;
          try {
            setDiagSnapshot(JSON.parse(msg.data));
            onLog("🩺 Panell de diagnòstic del Host rebut.");
          } catch (e) {
            onLog(`❌ Error parsejant el diagnòstic: ${e}`);
          }
        };
        return;
      }

      if (dc.label !== "video") return;

      dc.binaryType = "arraybuffer";
      let pending: Uint8Array[] = [];
      dc.onopen = () => onLog("🎬 Canal de vídeo obert.");
      dc.onmessage = (msg) => {
        const buf = new Uint8Array(msg.data as ArrayBuffer);
        if (buf.length === 0) return;
        const isLast = buf[0] === 1;
        pending.push(buf.subarray(1));
        if (isLast) {
          const totalLen = pending.reduce((acc, p) => acc + p.length, 0);
          const frame = new Uint8Array(totalLen);
          let offset = 0;
          for (const p of pending) {
            frame.set(p, offset);
            offset += p.length;
          }
          pending = [];
          handleVideoFrame(frame);
        }
      };
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
  }, [handleAudioPacket, handleVideoFrame, onLog, sendSignal]);

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
    (roomCode: string, lanOnly: boolean = false) => {
      const code = roomCode.trim().toUpperCase();
      if (!code) return;

      lanOnlyRef.current = lanOnly;
      setPhase("searching");
      onLog(`Cercant la sala "${code}"...${lanOnly ? " (mode només-LAN)" : ""}`);

      const signalChannel = supabase
        .channel(`webrtc-signal:${code}`, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "webrtc-signal" }, ({ payload }: { payload: WebRtcSignalMessage }) => {
          if (payload.fromPeerId === myPeerIdRef.current) return;
          if (payload.type === "offer") {
            onLog(`Oferta rebuda del Host — negociant...`);
            applyOffer(payload.sdp);
          } else if (payload.type === "ice-candidate") {
            addIceCandidate(payload.candidate);
          }
          // El Guest mai rep "answer" — això només ho envia ell mateix.
        })
        .subscribe();
      signalChannelRef.current = signalChannel;

      const presenceChannel = supabase.channel(`streaming-presence:${code}`, {
        config: { presence: { key: myPeerIdRef.current } },
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
    setDiagSnapshot(null);
    lanOnlyRef.current = false;
  }, []);

  useEffect(() => disconnect, [disconnect]);

  return { phase, connect, disconnect, sendInput, stats, diagSnapshot };
}
