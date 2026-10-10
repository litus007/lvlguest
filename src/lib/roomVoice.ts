import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ICE_SERVERS } from "./transferLink";

/**
 * 🎙️ Motor de trucada (veu + càmera opcional) en malla WebRTC.
 *
 * El mateix a l'app d'escriptori (sala LAN i Trucada) i al web-guest: una
 * trucada pot tenir persones a l'app i a navegadors (Windows, Mac, Android,
 * iPhone) alhora.
 *
 *  - Senyalització: canal Supabase (presència + broadcast), sense taules.
 *  - Àudio: micròfon → [guany ajustable] → [compressor] → pista enviada. Així el
 *    volum del micro es pot pujar (fins a 300 %) sense renegociar res, i es veu
 *    el nivell real del que sent l'altra gent.
 *  - Sortida: cada persona passa per un guany propi (0–200 %) i un guany mestre.
 *  - Diagnòstic: nivell d'entrada, nivell i "rebent veu" de cada participant
 *    (bytes que arriben, via getStats), latència i pèrdua de paquets.
 *  - Càmera: opcional i activable en qualsevol moment (replaceTrack, sense renegociar).
 *  - Amfitrió: l'app d'escriptori (si n'hi ha) i si no, qui hi és des de fa més.
 *    Pot silenciar-te o expulsar-te (és cooperatiu: no hi ha servidor que ho imposi).
 */

export interface VoiceMember {
  id: string;
  nickname: string;
  /** Micro silenciat (per ell mateix o per l'amfitrió). */
  muted: boolean;
  connected: boolean;
  /** Està a l'app d'escriptori. */
  app: boolean;
  isHost: boolean;
  /** Nivell de veu 0–1 i si parla ara mateix. */
  level: number;
  speaking: boolean;
  /** Estem rebent àudio d'aquesta persona (els bytes augmenten). */
  receiving: boolean;
  /** Volum amb què jo l'escolto (0–2) i si l'he silenciat només per a mi. */
  volume: number;
  localMuted: boolean;
  /** Vídeo (càmera) d'aquesta persona, si en té. */
  videoStream: MediaStream | null;
  rttMs: number | null;
  lossPct: number | null;
}

export interface VoiceSettings {
  /** Guany del micro (0–3). */
  gain: number;
  /** Volum general de sortida (0–2). */
  outVolume: number;
  inputId: string;
  outputId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  /** Escoltar-se a un mateix (per provar; cal auriculars). */
  monitor: boolean;
}

export interface DeviceInfo {
  id: string;
  label: string;
}

export type MicStatus = "checking" | "ok" | "silent" | "muted";

export interface VoiceState {
  joined: boolean;
  muted: boolean;
  deafened: boolean;
  /** L'amfitrió t'ha silenciat: no et pots activar tu. */
  forcedMute: boolean;
  error: string | null;
  members: VoiceMember[];
  hostId: string | null;
  iAmHost: boolean;
  myLevel: number;
  speaking: boolean;
  micStatus: MicStatus;
  /** Els bytes d'àudio que enviem estan pujant (algú ens rep). */
  sending: boolean;
  camera: boolean;
  localVideo: MediaStream | null;
  settings: VoiceSettings;
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
  outputSupported: boolean;
}

const SETTINGS_KEY = "lv-voice-settings";
const SPEAK_THRESHOLD = 0.06;
const LEVEL_MS = 100;
const STATS_MS = 1000;

export function defaultSettings(): VoiceSettings {
  const base: VoiceSettings = { gain: 1, outVolume: 1, inputId: "", outputId: "", noiseSuppression: true, echoCancellation: true, autoGain: true, monitor: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { ...base, ...saved, monitor: false };
  } catch {
    return base;
  }
}

export function initialVoiceState(): VoiceState {
  return {
    joined: false,
    muted: false,
    deafened: false,
    forcedMute: false,
    error: null,
    members: [],
    hostId: null,
    iAmHost: false,
    myLevel: 0,
    speaking: false,
    micStatus: "checking",
    sending: false,
    camera: false,
    localVideo: null,
    settings: defaultSettings(),
    inputs: [],
    outputs: [],
    outputSupported: typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype,
  };
}

interface Link {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  connected: boolean;
  videoSender: RTCRtpSender | null;
  // Sortida d'àudio d'aquesta persona
  keep: HTMLAudioElement | null;
  src: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
  analyser: AnalyserNode | null;
  videoStream: MediaStream | null;
  level: number;
  speakingUntil: number;
  bytesIn: number;
  bytesInPrev: number;
  receiving: boolean;
  rttMs: number | null;
  lossPct: number | null;
  bytesOut: number;
  bytesOutPrev: number;
}

interface Sig {
  from: string;
  to: string;
  type: "offer" | "answer" | "candidate";
  data: any;
}
interface Ctl {
  from: string;
  to: string;
  type: "srvmute" | "kick";
  on?: boolean;
}
interface PresenceInfo {
  nickname: string;
  muted: boolean;
  app: boolean;
  t: number;
}

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function rms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

export class RoomVoice {
  private state: VoiceState = initialVoiceState();
  private channel: RealtimeChannel | null = null;
  private closed = false;
  private links = new Map<string, Link>();
  private presence = new Map<string, PresenceInfo>();
  private prefs = new Map<string, { volume: number; localMuted: boolean }>();

  private ctx: AudioContext | null = null;
  private rawStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  private master: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sendTrack: MediaStreamTrack | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(512));
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private joinedAt = 0;
  private everHeard = false;
  private mySpeakingUntil = 0;
  private lastSig = "";
  private wasMutedBeforeDeafen = false;
  private iAmApp = inTauri();

  constructor(
    private readonly channelName: string,
    private readonly myId: string,
    private readonly nickname: string,
    private readonly listener: (s: VoiceState) => void,
    private readonly maxMembers = 4
  ) {}

  // ═════════ Entrar i sortir ═════════

  async join(): Promise<void> {
    if (this.channel || this.closed) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx();
      await this.ctx.resume().catch(() => {});
      this.buildGraph();
      await this.acquireMic();
    } catch (err) {
      this.patch({ error: micError(err) });
      await this.teardownAudio();
      return;
    }
    await this.refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);

    const channel = supabase.channel(this.channelName, { config: { broadcast: { self: false }, presence: { key: this.myId } } });
    this.channel = channel;
    channel
      .on("broadcast", { event: "sig" }, ({ payload }) => void this.onSignal(payload as Sig))
      .on("broadcast", { event: "ctl" }, ({ payload }) => this.onCtl(payload as Ctl))
      .on("presence", { event: "sync" }, () => this.onSync());
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await this.track();
        this.joinedAt = Date.now();
        this.patch({ joined: true, error: null });
        this.startTimers();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.patch({ error: "S'ha perdut la connexió amb el servei de veu." });
      }
    });
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.levelTimer) clearInterval(this.levelTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    for (const id of [...this.links.keys()]) this.closeLink(id);
    this.camTrack?.stop();
    this.camTrack = null;
    await this.teardownAudio();
    if (this.channel) {
      await supabase.removeChannel(this.channel).catch(() => {});
      this.channel = null;
    }
  }

  private async teardownAudio() {
    this.rawStream?.getTracks().forEach((t) => t.stop());
    this.rawStream = null;
    try {
      this.micSource?.disconnect();
    } catch {
      /* ja desconnectat */
    }
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  // ═════════ Gràfic d'àudio ═════════

  private buildGraph() {
    const ctx = this.ctx!;
    this.micGain = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    // El compressor evita que el guany alt (fins a 300 %) saturi i distorsioni.
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 512;
    this.dest = ctx.createMediaStreamDestination();
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.master = ctx.createGain();
    this.micGain.connect(this.comp);
    this.comp.connect(this.dest);
    this.comp.connect(this.micAnalyser);
    this.comp.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);
    this.master.connect(ctx.destination);
    this.sendTrack = this.dest.stream.getAudioTracks()[0] ?? null;
    this.applyGains();
  }

  private async acquireMic() {
    const s = this.state.settings;
    const audio: MediaTrackConstraints = {
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGain,
      channelCount: 1,
      ...(s.inputId ? { deviceId: { exact: s.inputId } } : {}),
    };
    let raw: MediaStream;
    try {
      raw = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      // El dispositiu guardat ja no existeix: tornem al per defecte.
      if (s.inputId) {
        this.setSettings({ inputId: "" }, false);
        raw = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: undefined } });
      } else throw err;
    }
    this.rawStream?.getTracks().forEach((t) => t.stop());
    try {
      this.micSource?.disconnect();
    } catch {
      /* ja desconnectat */
    }
    this.rawStream = raw;
    this.micSource = this.ctx!.createMediaStreamSource(raw);
    this.micSource.connect(this.micGain!);
    raw.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (!this.closed) {
        this.patch({ error: "El micròfon s'ha desconnectat. Tria'n un altre als ajustos." });
      }
    });
  }

  private applyGains() {
    if (!this.ctx) return;
    const s = this.state.settings;
    const live = !this.state.muted && !this.state.deafened;
    if (this.micGain) this.micGain.gain.value = live ? s.gain : 0;
    if (this.monitorGain) this.monitorGain.gain.value = s.monitor ? 1 : 0;
    if (this.master) this.master.gain.value = s.outVolume;
    for (const [id, link] of this.links) this.applyMemberGain(id, link);
  }

  private applyMemberGain(id: string, link: Link) {
    if (!link.gain) return;
    const p = this.prefs.get(id) ?? { volume: 1, localMuted: false };
    link.gain.gain.value = this.state.deafened || p.localMuted ? 0 : p.volume;
  }

  // ═════════ Accions de l'usuari ═════════

  setMuted(muted: boolean) {
    if (!muted && this.state.forcedMute) {
      this.patch({ error: "L'amfitrió t'ha silenciat." });
      return;
    }
    if (!muted && this.state.deafened) this.setDeafened(false);
    this.patch({ muted, error: null });
    this.applyGains();
    void this.track();
  }

  setDeafened(deafened: boolean) {
    if (deafened) {
      this.wasMutedBeforeDeafen = this.state.muted;
      this.patch({ deafened: true, muted: true });
    } else {
      this.patch({ deafened: false, muted: this.state.forcedMute ? true : this.wasMutedBeforeDeafen });
    }
    this.applyGains();
    void this.track();
  }

  setMemberVolume(id: string, volume: number) {
    const p = this.prefs.get(id) ?? { volume: 1, localMuted: false };
    this.prefs.set(id, { ...p, volume: Math.max(0, Math.min(2, volume)) });
    const link = this.links.get(id);
    if (link) this.applyMemberGain(id, link);
    this.publishMembers();
  }

  setMemberLocalMuted(id: string, localMuted: boolean) {
    const p = this.prefs.get(id) ?? { volume: 1, localMuted: false };
    this.prefs.set(id, { ...p, localMuted });
    const link = this.links.get(id);
    if (link) this.applyMemberGain(id, link);
    this.publishMembers();
  }

  /** Canvia ajustos; els que requereixen reobrir el micro (dispositiu, processat) ho fan sols. */
  async updateSettings(partial: Partial<VoiceSettings>) {
    this.setSettings(partial, true);
    const needsMic = "inputId" in partial || "noiseSuppression" in partial || "echoCancellation" in partial || "autoGain" in partial;
    if (needsMic && this.ctx) {
      try {
        await this.acquireMic();
      } catch (err) {
        this.patch({ error: micError(err) });
      }
      await this.refreshDevices();
    }
    if ("outputId" in partial) {
      try {
        await (this.ctx as any)?.setSinkId?.(partial.outputId ?? "");
      } catch {
        this.patch({ error: "No s'ha pogut canviar la sortida d'àudio." });
      }
    }
    this.applyGains();
  }

  private setSettings(partial: Partial<VoiceSettings>, patch: boolean) {
    const settings = { ...this.state.settings, ...partial };
    this.state = { ...this.state, settings };
    try {
      const { monitor: _m, ...persist } = settings;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(persist));
    } catch {
      /* sense persistència */
    }
    if (patch) this.patch({ settings });
  }

  async setCamera(on: boolean) {
    if (on === !!this.camTrack) return;
    if (on) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } });
        this.camTrack = cam.getVideoTracks()[0];
        this.camTrack.addEventListener("ended", () => void this.setCamera(false));
      } catch {
        this.patch({ error: "No s'ha pogut accedir a la càmera. Revisa els permisos." });
        return;
      }
      for (const link of this.links.values()) await this.attachCamera(link);
      this.patch({ camera: true, localVideo: new MediaStream([this.camTrack]), error: null });
    } else {
      this.camTrack?.stop();
      this.camTrack = null;
      for (const link of this.links.values()) await link.videoSender?.replaceTrack(null).catch(() => {});
      this.patch({ camera: false, localVideo: null });
    }
    void this.track();
  }

  private async attachCamera(link: Link) {
    if (!link.videoSender || !this.camTrack) return;
    await link.videoSender.replaceTrack(this.camTrack).catch(() => {});
    try {
      const params = link.videoSender.getParameters();
      params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: 600_000, maxFramerate: 24 }];
      await link.videoSender.setParameters(params);
    } catch {
      /* el navegador no ho permet */
    }
  }

  // ═════════ Amfitrió ═════════

  hostMute(id: string, on: boolean) {
    if (!this.state.iAmHost) return;
    this.sendCtl({ from: this.myId, to: id, type: "srvmute", on });
  }
  hostMuteAll(on: boolean) {
    for (const id of this.presence.keys()) this.hostMute(id, on);
  }
  hostKick(id: string) {
    if (!this.state.iAmHost) return;
    this.sendCtl({ from: this.myId, to: id, type: "kick" });
  }
  private sendCtl(c: Ctl) {
    this.channel?.send({ type: "broadcast", event: "ctl", payload: c });
  }
  private onCtl(c: Ctl) {
    if (this.closed || !c || c.to !== this.myId || c.from !== this.state.hostId) return;
    if (c.type === "srvmute") {
      this.patch({ forcedMute: !!c.on, muted: c.on ? true : this.state.muted });
      this.applyGains();
      void this.track();
    } else if (c.type === "kick") {
      this.patch({ error: "L'amfitrió t'ha expulsat de la trucada." });
      void this.leave().then(() => this.patch({ joined: false }));
    }
  }

  // ═════════ Presència ═════════

  private async track() {
    await this.channel?.track({ id: this.myId, nick: this.nickname, muted: this.state.muted, app: this.iAmApp, t: this.joinedAt || Date.now() });
  }

  private onSync() {
    if (!this.channel || this.closed) return;
    const raw = this.channel.presenceState() as Record<string, any[]>;
    const all: { id: string; t: number; app: boolean }[] = [];
    this.presence.clear();
    for (const entries of Object.values(raw)) {
      for (const p of entries) {
        if (!p?.id) continue;
        all.push({ id: p.id, t: Number(p.t) || 0, app: !!p.app });
        if (p.id !== this.myId) this.presence.set(p.id, { nickname: String(p.nick ?? "Convidat"), muted: !!p.muted, app: !!p.app, t: Number(p.t) || 0 });
      }
    }
    all.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    const myIdx = all.findIndex((o) => o.id === this.myId);
    if (myIdx >= this.maxMembers) {
      this.patch({ joined: false, error: `La sala és plena (màx. ${this.maxMembers} persones).` });
      void this.leave();
      return;
    }
    const allowed = all.slice(0, this.maxMembers);
    const allowedIds = new Set(allowed.map((o) => o.id));
    for (const id of [...this.presence.keys()]) if (!allowedIds.has(id)) this.presence.delete(id);
    // Amfitrió: la persona a l'app d'escriptori que hi és des de fa més; si no n'hi ha, la més antiga.
    const host = allowed.find((o) => o.app) ?? allowed[0];
    this.patch({ hostId: host?.id ?? null, iAmHost: host?.id === this.myId });

    for (const id of [...this.links.keys()]) if (!this.presence.has(id)) this.closeLink(id);
    for (const id of this.presence.keys()) if (!this.links.has(id) && this.myId < id) void this.createLink(id, true);
    this.publishMembers();
  }

  private publishMembers(force = false) {
    const now = performance.now();
    const members: VoiceMember[] = [...this.presence].map(([id, p]) => {
      const link = this.links.get(id);
      const pref = this.prefs.get(id) ?? { volume: 1, localMuted: false };
      return {
        id,
        nickname: p.nickname,
        muted: p.muted,
        connected: link?.connected ?? false,
        app: p.app,
        isHost: id === this.state.hostId,
        level: p.muted ? 0 : Math.round((link?.level ?? 0) * 20) / 20,
        speaking: !p.muted && (link?.speakingUntil ?? 0) > now,
        receiving: link?.receiving ?? false,
        volume: pref.volume,
        localMuted: pref.localMuted,
        videoStream: link?.videoStream ?? null,
        rttMs: link?.rttMs ?? null,
        lossPct: link?.lossPct ?? null,
      };
    });
    // Evita re-pintar si no ha canviat res visible (els nivells es quantitzen).
    const sig = members.map((m) => [m.id, m.muted, m.connected, m.app, m.isHost, m.level, m.speaking, m.receiving, m.volume, m.localMuted, !!m.videoStream, m.rttMs, m.lossPct].join(":")).join("|");
    if (!force && sig === this.lastSig && this.state.members.length === members.length) return;
    this.lastSig = sig;
    this.patch({ members });
  }

  // ═════════ Temporitzadors: nivells i estadístiques ═════════

  private startTimers() {
    this.levelTimer = setInterval(() => this.tickLevels(), LEVEL_MS);
    this.statsTimer = setInterval(() => void this.tickStats(), STATS_MS);
  }

  private tickLevels() {
    if (document.hidden || !this.micAnalyser) return;
    const now = performance.now();
    const raw = rms(this.micAnalyser, this.levelBuf);
    const live = !this.state.muted && !this.state.deafened;
    const myLevel = live ? Math.round(raw * 20) / 20 : 0;
    if (live && raw > SPEAK_THRESHOLD) {
      this.mySpeakingUntil = now + 350;
      this.everHeard = true;
    }
    const speaking = live && this.mySpeakingUntil > now;
    let micStatus: MicStatus;
    if (!live) micStatus = "muted";
    else if (this.everHeard) micStatus = "ok";
    else micStatus = Date.now() - this.joinedAt > 5000 ? "silent" : "checking";

    for (const link of this.links.values()) {
      if (!link.analyser) continue;
      link.level = rms(link.analyser, this.levelBuf);
      if (link.level > SPEAK_THRESHOLD) link.speakingUntil = now + 350;
    }
    if (myLevel !== this.state.myLevel || speaking !== this.state.speaking || micStatus !== this.state.micStatus) {
      this.patch({ myLevel, speaking, micStatus });
    }
    this.publishMembers();
  }

  private async tickStats() {
    if (document.hidden) return;
    let anySending = false;
    await Promise.all(
      [...this.links.values()].map(async (link) => {
        try {
          const report = await link.pc.getStats();
          let lost = 0;
          let recv = 0;
          report.forEach((s: any) => {
            if (s.type === "inbound-rtp" && s.kind === "audio") {
              link.bytesIn = s.bytesReceived ?? 0;
              lost = s.packetsLost ?? 0;
              recv = s.packetsReceived ?? 0;
            } else if (s.type === "outbound-rtp" && s.kind === "audio") {
              link.bytesOut = s.bytesSent ?? 0;
            } else if (s.type === "candidate-pair" && s.nominated && typeof s.currentRoundTripTime === "number") {
              link.rttMs = Math.round(s.currentRoundTripTime * 1000);
            }
          });
          link.receiving = link.bytesIn > link.bytesInPrev;
          link.bytesInPrev = link.bytesIn;
          if (link.bytesOut > link.bytesOutPrev) anySending = true;
          link.bytesOutPrev = link.bytesOut;
          link.lossPct = recv + lost > 0 ? Math.round((lost / (recv + lost)) * 100) : 0;
        } catch {
          /* connexió tancada */
        }
      })
    );
    if (anySending !== this.state.sending) this.patch({ sending: anySending });
    this.publishMembers();
  }

  // ═════════ Dispositius ═════════

  private onDeviceChange = () => void this.refreshDevices();

  private async refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind: MediaDeviceKind) =>
        list.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === "audioinput" ? "Micròfon" : "Sortida"} ${i + 1}` }));
      this.patch({ inputs: pick("audioinput"), outputs: pick("audiooutput") });
    } catch {
      /* sense accés a la llista de dispositius */
    }
  }

  // ═════════ WebRTC ═════════

  private async createLink(peerId: string, offerer: boolean): Promise<Link | null> {
    if (!this.sendTrack || this.links.has(peerId)) return this.links.get(peerId) ?? null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link: Link = {
      pc, pending: [], remoteSet: false, connected: false, videoSender: null, keep: null, src: null, gain: null, analyser: null, videoStream: null,
      level: 0, speakingUntil: 0, bytesIn: 0, bytesInPrev: 0, receiving: false, rttMs: null, lossPct: null, bytesOut: 0, bytesOutPrev: 0,
    };
    this.links.set(peerId, link);

    pc.onicecandidate = (e) => e.candidate && this.signal(peerId, "candidate", e.candidate.toJSON());
    pc.ontrack = (e) => this.onRemoteTrack(peerId, link, e);
    pc.onconnectionstatechange = () => {
      link.connected = pc.connectionState === "connected";
      if (pc.connectionState === "failed") this.closeLink(peerId);
      this.publishMembers(true);
    };

    if (offerer) {
      pc.addTrack(this.sendTrack, this.dest!.stream);
      link.videoSender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
      await this.attachCamera(link);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        if (this.closed || this.links.get(peerId) !== link) return link;
        this.signal(peerId, "offer", pc.localDescription!.toJSON());
      } catch {
        /* connexió tancada durant la negociació */
      }
    }
    return link;
  }

  /** Qui rep l'oferta enganxa el seu micro/càmera als transceptors que ha creat l'oferta. */
  private async attachAsAnswerer(link: Link) {
    for (const t of link.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      if (kind === "audio" && this.sendTrack) {
        await t.sender.replaceTrack(this.sendTrack);
        t.direction = "sendrecv";
      } else if (kind === "video") {
        t.direction = "sendrecv";
        link.videoSender = t.sender;
        await this.attachCamera(link);
      }
    }
  }

  private onRemoteTrack(peerId: string, link: Link, e: RTCTrackEvent) {
    if (e.track.kind === "audio" && this.ctx && this.master) {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      // Chrome només "activa" un flux remot si està connectat a un element: el deixem mut
      // i fem servir WebAudio per al volum, el nivell i la sortida.
      link.keep = new Audio();
      link.keep.srcObject = stream;
      link.keep.muted = true;
      void link.keep.play().catch(() => {});
      link.src = this.ctx.createMediaStreamSource(stream);
      link.gain = this.ctx.createGain();
      link.analyser = this.ctx.createAnalyser();
      link.analyser.fftSize = 512;
      link.src.connect(link.analyser);
      link.src.connect(link.gain);
      link.gain.connect(this.master);
      this.applyMemberGain(peerId, link);
    } else if (e.track.kind === "video") {
      const refresh = () => {
        link.videoStream = e.track.muted ? null : new MediaStream([e.track]);
        this.publishMembers(true);
      };
      e.track.onmute = refresh;
      e.track.onunmute = refresh;
      refresh();
    }
  }

  private closeLink(peerId: string) {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    try {
      link.src?.disconnect();
      link.gain?.disconnect();
      link.pc.close();
    } catch {
      /* ja tancat */
    }
    if (link.keep) {
      link.keep.srcObject = null;
      link.keep = null;
    }
    this.publishMembers(true);
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
        await this.attachAsAnswerer(link);
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
        } else if (!link.remoteSet) link.pending.push(msg.data);
        else await link.pc.addIceCandidate(msg.data).catch(() => {});
      }
    } catch {
      /* una negociació fallida es reintenta quan l'altre torni a entrar */
    }
  }

  private async flush(link: Link) {
    const q = link.pending;
    link.pending = [];
    for (const c of q) await link.pc.addIceCandidate(c).catch(() => {});
  }

  private patch(p: Partial<VoiceState>) {
    this.state = { ...this.state, ...p };
    this.listener(this.state);
  }
}

function micError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "No tens permís per al micròfon. Permet-lo al navegador o a la configuració de Windows/Android.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No s'ha trobat cap micròfon. Connecta'n un o tria'l als ajustos.";
  if (name === "NotReadableError") return "El micròfon l'està fent servir una altra aplicació.";
  return "No s'ha pogut accedir al micròfon.";
}
