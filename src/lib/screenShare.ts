import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ICE_SERVERS } from "./transferLink";

/**
 * 🖥️ PANTALLA — compartir pantalla entre navegadors (web ↔ web).
 *
 * Una persona comparteix (getDisplayMedia) i fins a `maxViewers` persones
 * miren, tots amb la mateixa PARAULA. Sincronització: canal Supabase
 * `screen:<PARAULA>` amb presència + broadcast, sense taules. Qui comparteix
 * crea una oferta WebRTC per a cada espectador (vídeo + àudio de la pestanya
 * si el navegador el dona). Res no passa per cap servidor de vídeo.
 *
 * Només una persona pot compartir alhora: el primer que ho demana (per hora
 * d'entrada) guanya; qui arriba després veu "Ja hi ha algú compartint".
 */

export type ScreenRole = "share" | "watch";
export type ScreenPhase = "idle" | "waiting" | "live" | "ended" | "failed";
export type ContentHint = "detail" | "motion";

export interface ScreenState {
  phase: ScreenPhase;
  role: ScreenRole | null;
  code: string;
  error: string | null;
  /** Espectadors connectats (si comparteixes) o persones a la sala (si mires). */
  viewers: number;
  /** El flux remot que s'ha de pintar en un <video> (només espectadors). */
  stream: MediaStream | null;
  hasAudio: boolean;
}

export function initialScreenState(): ScreenState {
  return { phase: "idle", role: null, code: "", error: null, viewers: 0, stream: null, hasAudio: false };
}

export function supportsScreenCapture(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
}

interface Sig {
  from: string;
  to: string;
  type: "offer" | "answer" | "candidate";
  data: any;
}
interface Link {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  connected: boolean;
}

const MAX_BITRATE = 6_000_000;

export class ScreenSession {
  readonly myId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  private state: ScreenState = initialScreenState();
  private channel: RealtimeChannel | null = null;
  private local: MediaStream | null = null;
  private links = new Map<string, Link>();
  private closed = false;

  constructor(
    private readonly code: string,
    private readonly role: ScreenRole,
    private readonly nickname: string,
    private readonly listener: (s: ScreenState) => void,
    private readonly opts: {
      maxViewers?: number;
      hint?: ContentHint;
      lanOnly?: boolean;
      /** Substituïble en proves; per defecte, el selector de pantalla del navegador. */
      getStream?: () => Promise<MediaStream>;
    } = {}
  ) {
    this.state = { ...this.state, code, role };
  }

  private get maxViewers() {
    return this.opts.maxViewers ?? 4;
  }

  /** IMPORTANT: s'ha de cridar des d'un clic (el navegador ho exigeix per capturar la pantalla). */
  async start(): Promise<void> {
    this.patch({ phase: "waiting", error: null });
    if (this.role === "share") {
      try {
        this.local =
          (await this.opts.getStream?.()) ??
          (await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }));
      } catch {
        this.patch({ phase: "failed", error: "No s'ha pogut capturar la pantalla (cancel·lat o sense permís)." });
        return;
      }
      const v = this.local.getVideoTracks()[0];
      if (v) {
        v.contentHint = this.opts.hint ?? "detail";
        // El botó "Deixa de compartir" del navegador també acaba la sessió.
        v.addEventListener("ended", () => void this.stop());
      }
      this.patch({ hasAudio: this.local.getAudioTracks().length > 0 });
    }

    const channel = supabase.channel(`screen:${this.code}`, { config: { broadcast: { self: false }, presence: { key: this.myId } } });
    this.channel = channel;
    channel
      .on("broadcast", { event: "sig" }, ({ payload }) => void this.onSignal(payload as Sig))
      .on("presence", { event: "sync" }, () => this.onSync());
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ id: this.myId, nick: this.nickname, role: this.role, t: Date.now() });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.fail("No s'ha pogut connectar amb el servei de sincronització.");
      }
    });
  }

  /** Deixa de compartir / surt de la sala i allibera tot. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.links.keys()]) this.closeLink(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    if (this.channel) {
      await supabase.removeChannel(this.channel).catch(() => {});
      this.channel = null;
    }
    this.patch({ phase: this.role === "share" ? "ended" : "idle", stream: null, viewers: 0 });
  }

  // ── Presència ────────────────────────────────────────────────────────

  private onSync() {
    if (this.closed || !this.channel) return;
    const raw = this.channel.presenceState() as Record<string, any[]>;
    const all: { id: string; role: ScreenRole; t: number }[] = [];
    for (const entries of Object.values(raw)) for (const p of entries) if (p?.id) all.push({ id: p.id, role: p.role, t: Number(p.t) || 0 });
    all.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    if (!all.some((p) => p.id === this.myId)) return;

    const sharers = all.filter((p) => p.role === "share");
    const watchers = all.filter((p) => p.role === "watch");

    if (this.role === "share") {
      if (sharers[0]?.id !== this.myId) return this.fail("Ja hi ha algú compartint la pantalla en aquesta sala.");
      const allowed = watchers.slice(0, this.maxViewers);
      for (const id of [...this.links.keys()]) if (!allowed.some((w) => w.id === id)) this.closeLink(id);
      for (const w of allowed) if (!this.links.has(w.id)) void this.offerTo(w.id);
      this.patch({ viewers: this.links.size });
    } else {
      const myIdx = watchers.findIndex((w) => w.id === this.myId);
      if (myIdx >= this.maxViewers) return this.fail(`La sala ja té ${this.maxViewers} espectadors.`);
      const sharer = sharers[0];
      if (!sharer) {
        for (const id of [...this.links.keys()]) this.closeLink(id);
        this.patch({ phase: "waiting", stream: null, viewers: watchers.length });
      } else {
        this.patch({ viewers: watchers.length });
      }
    }
  }

  // ── WebRTC ───────────────────────────────────────────────────────────

  private newLink(peerId: string): Link {
    const pc = new RTCPeerConnection({ iceServers: this.opts.lanOnly ? [] : ICE_SERVERS });
    const link: Link = { pc, pending: [], remoteSet: false, connected: false };
    this.links.set(peerId, link);
    pc.onicecandidate = (e) => e.candidate && this.signal(peerId, "candidate", e.candidate.toJSON());
    pc.onconnectionstatechange = () => {
      link.connected = pc.connectionState === "connected";
      if (pc.connectionState === "failed") this.closeLink(peerId);
      if (this.role === "share") this.patch({ viewers: [...this.links.values()].filter((l) => l.connected).length });
    };
    return link;
  }

  private async offerTo(viewerId: string) {
    if (!this.local || this.links.has(viewerId)) return;
    const link = this.newLink(viewerId);
    for (const track of this.local.getTracks()) {
      const sender = link.pc.addTrack(track, this.local);
      if (track.kind === "video") {
        // Bitrat generós: el text i els gràfics es veuen nets.
        try {
          const params = sender.getParameters();
          params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: MAX_BITRATE, maxFramerate: 30 }];
          await sender.setParameters(params);
        } catch {
          /* el navegador no ho permet: es queda amb el valor per defecte */
        }
      }
    }
    try {
      await link.pc.setLocalDescription(await link.pc.createOffer());
      if (this.closed || this.links.get(viewerId) !== link) return; // s'ha tancat mentrestant
      this.signal(viewerId, "offer", link.pc.localDescription!.toJSON());
    } catch {
      /* la connexió s'ha tancat durant la negociació: es reintenta si l'espectador torna */
    }
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
    if (this.role === "share") this.patch({ viewers: this.links.size });
  }

  private signal(to: string, type: Sig["type"], data: unknown) {
    this.channel?.send({ type: "broadcast", event: "sig", payload: { from: this.myId, to, type, data } satisfies Sig });
  }

  private async onSignal(msg: Sig) {
    if (this.closed || !msg || msg.to !== this.myId) return;
    try {
      if (msg.type === "offer" && this.role === "watch") {
        let link = this.links.get(msg.from);
        if (!link) {
          link = this.newLink(msg.from);
          link.pc.ontrack = (e) => {
            const stream = e.streams[0] ?? new MediaStream([e.track]);
            this.patch({ phase: "live", stream, hasAudio: stream.getAudioTracks().length > 0 });
          };
        }
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
        } else if (msg.type === "candidate") {
          if (!link.remoteSet) link.pending.push(msg.data);
          else await link.pc.addIceCandidate(msg.data).catch(() => {});
        }
      }
    } catch {
      /* una negociació fallida es reintenta quan l'espectador torna a entrar */
    }
  }

  private async flush(link: Link) {
    const queued = link.pending;
    link.pending = [];
    for (const c of queued) await link.pc.addIceCandidate(c).catch(() => {});
  }

  private fail(error: string) {
    if (this.closed) return;
    void this.stop().then(() => this.patch({ phase: "failed", error }));
  }

  private patch(p: Partial<ScreenState>) {
    this.state = { ...this.state, ...p };
    this.listener(this.state);
  }
}
