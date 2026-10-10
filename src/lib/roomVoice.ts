import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ICE_SERVERS } from "./transferLink";

/**
 * 🎙️ Veu de sala per a LAN Virtual: malla WebRTC (cada jugador es connecta
 * amb cada un dels altres, màx. 4 → 3 enllaços per persona) amb àudio Opus
 * natiu del navegador. No fa servir el motor de veu de Rust: és independent i
 * s'activa només si el jugador prem "Unir-me a la veu".
 *
 * Sincronització: canal Supabase (nom lliure, p. ex. `room-voice:<id>` o
 * `call-web:<paraula>`) amb presència + broadcast, sense taules. El de l'id
 * més petit crea l'oferta (no hi ha col·lisions). `maxMembers` limita la sala:
 * qui arriba tard veu "sala plena" i en surt sol.
 *
 * Idèntic a l'app d'escriptori (sala LAN) i al web-guest (Trucada entre navegadors).
 */

export interface VoiceMember {
  id: string;
  nickname: string;
  muted: boolean;
  connected: boolean;
}

export interface VoiceState {
  joined: boolean;
  muted: boolean;
  members: VoiceMember[];
  error: string | null;
}

interface Link {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  audio: HTMLAudioElement | null;
  connected: boolean;
}

interface Sig {
  from: string;
  to: string;
  type: "offer" | "answer" | "candidate";
  data: any;
}

export function initialVoiceState(): VoiceState {
  return { joined: false, muted: false, members: [], error: null };
}

export class RoomVoice {
  private state: VoiceState = initialVoiceState();
  private channel: RealtimeChannel | null = null;
  private stream: MediaStream | null = null;
  private links = new Map<string, Link>();
  private presence = new Map<string, { nickname: string; muted: boolean }>();
  private closed = false;

  constructor(
    private readonly channelName: string,
    private readonly myId: string,
    private readonly nickname: string,
    private readonly listener: (s: VoiceState) => void,
    private readonly maxMembers = 4
  ) {}

  async join(): Promise<void> {
    if (this.channel || this.closed) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.patch({ error: "No s'ha pogut accedir al micròfon. Revisa els permisos de Windows." });
      return;
    }

    const channel = supabase.channel(this.channelName, {
      config: { broadcast: { self: false }, presence: { key: this.myId } },
    });
    this.channel = channel;
    channel
      .on("broadcast", { event: "sig" }, ({ payload }) => void this.onSignal(payload as Sig))
      .on("presence", { event: "sync" }, () => this.onSync());

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ id: this.myId, nick: this.nickname, muted: this.state.muted, t: Date.now() });
        this.patch({ joined: true, error: null });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.patch({ error: "S'ha perdut la connexió amb el servei de veu." });
      }
    });
  }

  setMuted(muted: boolean) {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.patch({ muted });
    void this.channel?.track({ id: this.myId, nick: this.nickname, muted, t: Date.now() });
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.links.keys()]) this.closeLink(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.channel) {
      await supabase.removeChannel(this.channel).catch(() => {});
      this.channel = null;
    }
  }

  // ── Presència: qui és a la veu i qui ha de fer l'oferta ──────────────

  private onSync() {
    if (!this.channel || this.closed) return;
    const raw = this.channel.presenceState() as Record<string, any[]>;
    this.presence.clear();
    const order: { id: string; t: number }[] = [];
    for (const entries of Object.values(raw)) {
      for (const p of entries) {
        if (!p?.id) continue;
        order.push({ id: p.id, t: Number(p.t) || 0 });
        if (p.id !== this.myId) this.presence.set(p.id, { nickname: String(p.nick ?? "Jugador"), muted: !!p.muted });
      }
    }
    // Sala plena: els primers `maxMembers` per hora d'entrada s'hi queden.
    order.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    const myIdx = order.findIndex((o) => o.id === this.myId);
    if (myIdx >= this.maxMembers) {
      this.patch({ joined: false, error: `La sala és plena (màx. ${this.maxMembers} persones).` });
      void this.leave();
      return;
    }
    const allowed = new Set(order.slice(0, this.maxMembers).map((o) => o.id));
    for (const id of [...this.presence.keys()]) if (!allowed.has(id)) this.presence.delete(id);
    for (const id of [...this.links.keys()]) if (!this.presence.has(id)) this.closeLink(id);
    for (const id of this.presence.keys()) {
      if (!this.links.has(id) && this.myId < id) void this.createLink(id, true);
    }
    this.publishMembers();
  }

  private publishMembers() {
    const members: VoiceMember[] = [...this.presence].map(([id, p]) => ({
      id,
      nickname: p.nickname,
      muted: p.muted,
      connected: this.links.get(id)?.connected ?? false,
    }));
    this.patch({ members });
  }

  // ── WebRTC ───────────────────────────────────────────────────────────

  private async createLink(peerId: string, offerer: boolean): Promise<Link | null> {
    if (!this.stream || this.links.has(peerId)) return this.links.get(peerId) ?? null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link: Link = { pc, pending: [], remoteSet: false, audio: null, connected: false };
    this.links.set(peerId, link);

    this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(peerId, "candidate", e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      const audio = new Audio();
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      audio.autoplay = true;
      void audio.play().catch(() => {});
      link.audio = audio;
    };
    pc.onconnectionstatechange = () => {
      link.connected = pc.connectionState === "connected";
      if (pc.connectionState === "failed") this.closeLink(peerId);
      this.publishMembers();
    };

    if (offerer) {
      try {
        await pc.setLocalDescription(await pc.createOffer());
        if (this.closed || this.links.get(peerId) !== link) return link;
        this.signal(peerId, "offer", pc.localDescription!.toJSON());
      } catch {
        /* la connexió s'ha tancat durant la negociació */
      }
    }
    return link;
  }

  private closeLink(peerId: string) {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    try {
      link.pc.close();
    } catch {
      /* ja tancat */
    }
    if (link.audio) {
      link.audio.srcObject = null;
      link.audio = null;
    }
    this.publishMembers();
  }

  private signal(to: string, type: Sig["type"], data: unknown) {
    this.channel?.send({ type: "broadcast", event: "sig", payload: { from: this.myId, to, type, data } satisfies Sig });
  }

  private async onSignal(msg: Sig) {
    if (this.closed || !msg || msg.to !== this.myId) return;
    try {
      if (msg.type === "offer") {
        const link = await this.createLink(msg.from, false);
        if (!link) return;
        await link.pc.setRemoteDescription(msg.data);
        link.remoteSet = true;
        await this.flush(link);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        this.signal(msg.from, "answer", link.pc.localDescription!.toJSON());
      } else {
        const link = this.links.get(msg.from);
        if (!link) return;
        if (msg.type === "answer") {
          await link.pc.setRemoteDescription(msg.data);
          link.remoteSet = true;
          await this.flush(link);
        } else if (!link.remoteSet) {
          link.pending.push(msg.data);
        } else {
          await link.pc.addIceCandidate(msg.data).catch(() => {});
        }
      }
    } catch {
      /* una negociació fallida es reintenta quan l'altre torna a entrar */
    }
  }

  private async flush(link: Link) {
    const queued = link.pending;
    link.pending = [];
    for (const c of queued) await link.pc.addIceCandidate(c).catch(() => {});
  }

  private patch(p: Partial<VoiceState>) {
    this.state = { ...this.state, ...p };
    this.listener(this.state);
  }
}
