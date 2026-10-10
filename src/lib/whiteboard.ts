import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ICE_SERVERS } from "./transferLink";

/**
 * 🎨 PISSARRA COMPARTIDA — dibuix col·laboratiu en temps real.
 *
 * Mateix sistema de PARAULA que la resta d'eines i idèntic a web-guest i a
 * l'app d'escriptori (es poden barrejar: un navegador i l'app a la mateixa pissarra).
 *
 *  - Senyalització: canal Supabase `board:<PARAULA>` (presència + broadcast), SENSE taules.
 *  - Dades: malla de RTCDataChannel fiables entre els participants (fins a `maxMembers`).
 *    Els traços NO passen per Supabase (el seu límit d'esdeveniments/s els ofegaria);
 *    van directes de persona a persona.
 *  - Model: llista d'elements amb id (traç, línia, fletxa, rectangle, el·lipse, text).
 *    Cada eina només afegeix elements o n'esborra per id → convergeix sense conflictes.
 *  - Qui entra tard demana l'estat sencer als altres (`sync`).
 *
 * Coordenades lògiques fixes de 1600×900 (16:9): tothom veu el mateix encara que
 * la finestra tingui una altra mida.
 */

export const BOARD_W = 1600;
export const BOARD_H = 900;
const MAX_STROKE_NUMBERS = 8000; // un traç molt llarg es parteix (límit de missatge del DataChannel)
const SYNC_CHUNK_CHARS = 60_000;

export type ElementKind = "stroke" | "line" | "arrow" | "rect" | "ellipse" | "text";
export type Background = "dark" | "light";

export interface BoardElement {
  id: string;
  author: string;
  kind: ElementKind;
  /** "ink" = tinta adaptativa (blanca sobre fons fosc, negra sobre clar) o un color #rrggbb. */
  color: string;
  w: number;
  pts?: number[];
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
  size?: number;
}

export interface BoardMember {
  id: string;
  nickname: string;
  color: string;
  connected: boolean;
}

export interface Cursor {
  x: number;
  y: number;
  at: number;
}

export type BoardErrorCode = "ROOM_FULL" | "CHANNEL" | "CONNECT_TIMEOUT";
export const BOARD_ERRORS: Record<BoardErrorCode, string> = {
  ROOM_FULL: "Aquesta pissarra ja té el màxim de persones. Tria una altra paraula.",
  CHANNEL: "No s'ha pogut connectar amb el servei de sincronització.",
  CONNECT_TIMEOUT: "No s'ha pogut establir la connexió directa amb els altres participants.",
};

export interface BoardState {
  phase: "idle" | "connecting" | "ready" | "failed";
  code: string;
  error: BoardErrorCode | null;
  members: BoardMember[];
  bg: Background;
  count: number;
}

export function initialBoardState(): BoardState {
  return { phase: "idle", code: "", error: null, members: [], bg: "dark", count: 0 };
}

/** Color estable per persona (el mateix a tots els clients, derivat de l'id). */
export function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 85% 66%)`;
}

type Msg =
  | { t: "ss"; id: string; k: "stroke"; c: string; w: number; x: number; y: number } // stroke-start
  | { t: "sp"; id: string; p: number[] } // stroke-points
  | { t: "se"; id: string } // stroke-end
  | { t: "add"; el: BoardElement }
  | { t: "del"; id: string }
  | { t: "clear" }
  | { t: "bg"; v: Background }
  | { t: "cur"; x: number; y: number }
  | { t: "req" }
  | { t: "sync"; els: BoardElement[]; bg: Background; first: boolean };

interface SigMsg {
  from: string;
  to: string;
  type: "offer" | "answer" | "candidate";
  data: any;
}

interface Link {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  open: boolean;
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export class BoardSession {
  readonly myId = newId() + newId();
  private state: BoardState = initialBoardState();
  private channel: RealtimeChannel | null = null;
  private links = new Map<string, Link>();
  private presence = new Map<string, string>(); // id -> nickname
  private closed = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Elements confirmats (en ordre d'inserció). */
  private order: string[] = [];
  private elements = new Map<string, BoardElement>();
  /** Traços en curs (locals i remots), encara sense confirmar. */
  readonly live = new Map<string, BoardElement>();
  readonly cursors = new Map<string, Cursor>();
  private dirtyListeners = new Set<() => void>();
  private ptsBuffer = new Map<string, number[]>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCursorSent = 0;
  /** Augmenta cada cop que canvia el contingut confirmat (el llenç sap quan repintar la capa fixa). */
  rev = 0;

  constructor(
    private readonly code: string,
    private readonly nickname: string,
    private readonly listener: (s: BoardState) => void,
    private readonly opts: { lanOnly?: boolean; maxMembers?: number } = {}
  ) {
    this.state = { ...this.state, code };
  }

  private get maxMembers() {
    return this.opts.maxMembers ?? 6;
  }

  // ═════════ Accés de lectura (el llenç el consulta a cada fotograma) ═════════

  getElements(): BoardElement[] {
    return this.order.map((id) => this.elements.get(id)!).filter(Boolean);
  }
  onDirty(cb: () => void): () => void {
    this.dirtyListeners.add(cb);
    return () => this.dirtyListeners.delete(cb);
  }
  private dirty() {
    this.dirtyListeners.forEach((cb) => cb());
  }

  // ═════════ Connexió ═════════

  async start(): Promise<void> {
    this.patch({ phase: "connecting", error: null });
    const channel = supabase.channel(`board:${this.code}`, { config: { broadcast: { self: false }, presence: { key: this.myId } } });
    this.channel = channel;
    channel
      .on("broadcast", { event: "sig" }, ({ payload }) => void this.onSignal(payload as SigMsg))
      .on("presence", { event: "sync" }, () => this.onSync());
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ id: this.myId, nick: this.nickname, t: Date.now() });
        // Sola a la sala també és una pissarra vàlida (es pot dibuixar i esperar gent).
        this.patch({ phase: "ready" });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.fail("CHANNEL");
      }
    });
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    for (const id of [...this.links.keys()]) this.closeLink(id);
    if (this.channel) {
      await supabase.removeChannel(this.channel).catch(() => {});
      this.channel = null;
    }
    this.dirtyListeners.clear();
  }

  private onSync() {
    if (this.closed || !this.channel) return;
    const raw = this.channel.presenceState() as Record<string, any[]>;
    const all: { id: string; t: number; nick: string }[] = [];
    for (const entries of Object.values(raw)) for (const p of entries) if (p?.id) all.push({ id: p.id, t: Number(p.t) || 0, nick: String(p.nick ?? "Convidat") });
    all.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    const myIdx = all.findIndex((p) => p.id === this.myId);
    if (myIdx < 0) return;
    if (myIdx >= this.maxMembers) return this.fail("ROOM_FULL");

    const allowed = all.slice(0, this.maxMembers);
    this.presence.clear();
    for (const p of allowed) if (p.id !== this.myId) this.presence.set(p.id, p.nick);
    for (const id of [...this.links.keys()]) if (!this.presence.has(id)) this.closeLink(id);
    for (const id of this.presence.keys()) if (!this.links.has(id) && this.myId < id) void this.connectTo(id, true);
    for (const id of [...this.cursors.keys()]) if (!this.presence.has(id)) this.cursors.delete(id);
    this.publishMembers();
  }

  private publishMembers() {
    const members: BoardMember[] = [...this.presence].map(([id, nickname]) => ({
      id,
      nickname,
      color: colorOf(id),
      connected: this.links.get(id)?.open ?? false,
    }));
    this.patch({ members });
  }

  // ═════════ WebRTC (malla de data channels) ═════════

  private async connectTo(peerId: string, offerer: boolean): Promise<Link | null> {
    if (this.links.has(peerId)) return this.links.get(peerId)!;
    const pc = new RTCPeerConnection({ iceServers: this.opts.lanOnly ? [] : ICE_SERVERS });
    const link: Link = { pc, dc: null, pending: [], remoteSet: false, open: false };
    this.links.set(peerId, link);

    pc.onicecandidate = (e) => e.candidate && this.signal(peerId, "candidate", e.candidate.toJSON());
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.closeLink(peerId);
    };
    if (offerer) this.bindChannel(peerId, link, pc.createDataChannel("board"));
    else pc.ondatachannel = (e) => this.bindChannel(peerId, link, e.channel);

    if (offerer) {
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

  private bindChannel(peerId: string, link: Link, dc: RTCDataChannel) {
    link.dc = dc;
    dc.onopen = () => {
      link.open = true;
      this.publishMembers();
      this.sendTo(peerId, { t: "req" }); // demana l'estat actual de la pissarra
    };
    dc.onclose = () => {
      link.open = false;
      this.publishMembers();
    };
    dc.onmessage = (e) => this.onMessage(peerId, e.data);
  }

  private closeLink(peerId: string) {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    try {
      link.dc?.close();
      link.pc.close();
    } catch {
      /* ja tancat */
    }
    this.cursors.delete(peerId);
    // Un traç a mitges d'algú que marxa es confirma tal com estava.
    for (const [id, el] of [...this.live]) if (el.author === peerId) this.commitLive(id);
    this.publishMembers();
    this.dirty();
  }

  private signal(to: string, type: SigMsg["type"], data: unknown) {
    this.channel?.send({ type: "broadcast", event: "sig", payload: { from: this.myId, to, type, data } satisfies SigMsg });
  }

  private async onSignal(msg: SigMsg) {
    if (this.closed || !msg || msg.to !== this.myId) return;
    try {
      if (msg.type === "offer") {
        const link = await this.connectTo(msg.from, false);
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
        } else if (!link.remoteSet) link.pending.push(msg.data);
        else await link.pc.addIceCandidate(msg.data).catch(() => {});
      }
    } catch {
      /* es reintenta quan l'altra persona torni a entrar */
    }
  }

  private async flush(link: Link) {
    const q = link.pending;
    link.pending = [];
    for (const c of q) await link.pc.addIceCandidate(c).catch(() => {});
  }

  // ═════════ Missatges ═════════

  private sendTo(peerId: string, msg: Msg) {
    const dc = this.links.get(peerId)?.dc;
    if (dc?.readyState === "open") dc.send(JSON.stringify(msg));
  }
  private broadcast(msg: Msg, opts: { droppable?: boolean } = {}) {
    const text = JSON.stringify(msg);
    for (const link of this.links.values()) {
      const dc = link.dc;
      if (dc?.readyState !== "open") continue;
      if (opts.droppable && dc.bufferedAmount > 512 * 1024) continue; // cursors: millor perdre'n que acumular
      dc.send(text);
    }
  }

  private onMessage(from: string, raw: unknown) {
    if (typeof raw !== "string") return;
    let m: Msg;
    try {
      m = JSON.parse(raw) as Msg;
    } catch {
      return;
    }
    switch (m.t) {
      case "ss":
        this.live.set(m.id, { id: m.id, author: from, kind: "stroke", color: m.c, w: m.w, pts: [m.x, m.y] });
        this.dirty();
        break;
      case "sp": {
        const el = this.live.get(m.id);
        if (el?.pts && Array.isArray(m.p)) el.pts.push(...m.p);
        this.dirty();
        break;
      }
      case "se":
        this.commitLive(m.id);
        break;
      case "add":
        this.addElement(m.el);
        break;
      case "del":
        this.removeElement(m.id);
        break;
      case "clear":
        this.resetElements();
        break;
      case "bg":
        if (m.v === "dark" || m.v === "light") {
          this.rev++;
          this.patch({ bg: m.v });
          this.dirty();
        }
        break;
      case "cur":
        this.cursors.set(from, { x: m.x, y: m.y, at: performance.now() });
        this.dirty();
        break;
      case "req":
        this.sendSnapshot(from);
        break;
      case "sync":
        for (const el of m.els) this.addElement(el, true);
        if (m.bg === "dark" || m.bg === "light") {
          this.rev++;
          this.patch({ bg: m.bg });
        }
        this.dirty();
        break;
    }
  }

  private sendSnapshot(to: string) {
    const els = this.getElements();
    let chunk: BoardElement[] = [];
    let size = 0;
    let first = true;
    const flush = () => {
      this.sendTo(to, { t: "sync", els: chunk, bg: this.state.bg, first });
      first = false;
      chunk = [];
      size = 0;
    };
    for (const el of els) {
      const len = JSON.stringify(el).length;
      if (size + len > SYNC_CHUNK_CHARS && chunk.length) flush();
      chunk.push(el);
      size += len;
    }
    flush(); // sempre n'envia un (encara que sigui buit) amb el fons
  }

  // ═════════ Estat d'elements ═════════

  private addElement(el: BoardElement, silent = false) {
    if (!el || typeof el.id !== "string" || this.elements.has(el.id)) return;
    this.elements.set(el.id, el);
    this.order.push(el.id);
    this.rev++;
    this.patch({ count: this.order.length });
    if (!silent) this.dirty();
  }
  private removeElement(id: string) {
    if (!this.elements.delete(id)) return;
    this.rev++;
    this.order = this.order.filter((x) => x !== id);
    this.patch({ count: this.order.length });
    this.dirty();
  }
  private resetElements() {
    this.elements.clear();
    this.rev++;
    this.order = [];
    this.live.clear();
    this.patch({ count: 0 });
    this.dirty();
  }
  private commitLive(id: string) {
    const el = this.live.get(id);
    if (!el) return;
    this.live.delete(id);
    this.addElement(el);
    this.dirty();
  }

  // ═════════ API local (la crida el llenç) ═════════

  /** Comença un traç a mà alçada. Retorna l'id per afegir-hi punts. */
  beginStroke(color: string, w: number, x: number, y: number): string {
    const id = newId();
    this.live.set(id, { id, author: this.myId, kind: "stroke", color, w, pts: [Math.round(x), Math.round(y)] });
    this.broadcast({ t: "ss", id, k: "stroke", c: color, w, x: Math.round(x), y: Math.round(y) });
    this.dirty();
    return id;
  }

  /** Afegeix un punt; retorna l'id vigent (canvia si el traç s'ha partit per ser massa llarg). */
  extendStroke(id: string, x: number, y: number): string {
    const el = this.live.get(id);
    if (!el?.pts) return id;
    const px = Math.round(x);
    const py = Math.round(y);
    if (el.pts[el.pts.length - 2] === px && el.pts[el.pts.length - 1] === py) return id;
    el.pts.push(px, py);
    const buf = this.ptsBuffer.get(id) ?? [];
    buf.push(px, py);
    this.ptsBuffer.set(id, buf);
    this.scheduleFlush();
    this.dirty();
    if (el.pts.length > MAX_STROKE_NUMBERS) {
      // Parteix el traç: confirma l'actual i en continua un de nou des del mateix punt.
      this.endStroke(id);
      return this.beginStroke(el.color, el.w, px, py);
    }
    return id;
  }

  endStroke(id: string) {
    this.flushPoints(id);
    this.broadcast({ t: "se", id });
    this.commitLive(id);
  }

  addShape(kind: "line" | "arrow" | "rect" | "ellipse", color: string, w: number, x1: number, y1: number, x2: number, y2: number) {
    const el: BoardElement = { id: newId(), author: this.myId, kind, color, w, x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) };
    this.addElement(el);
    this.broadcast({ t: "add", el });
  }

  addText(color: string, size: number, x: number, y: number, text: string) {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    const el: BoardElement = { id: newId(), author: this.myId, kind: "text", color, w: 1, size, x1: Math.round(x), y1: Math.round(y), text: clean };
    this.addElement(el);
    this.broadcast({ t: "add", el });
  }

  /** Esborra un element (qualsevol, també d'altres). */
  remove(id: string) {
    this.removeElement(id);
    this.broadcast({ t: "del", id });
  }

  /** Desfà el meu últim element. */
  undo(): boolean {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const el = this.elements.get(this.order[i])!;
      if (el.author === this.myId) {
        this.remove(el.id);
        return true;
      }
    }
    return false;
  }

  clear() {
    this.resetElements();
    this.broadcast({ t: "clear" });
  }

  setBackground(v: Background) {
    this.rev++;
    this.patch({ bg: v });
    this.broadcast({ t: "bg", v });
    this.dirty();
  }

  /** Posició del cursor (limitat a ~20 missatges/s). */
  cursor(x: number, y: number) {
    const now = performance.now();
    if (now - this.lastCursorSent < 50) return;
    this.lastCursorSent = now;
    this.broadcast({ t: "cur", x: Math.round(x), y: Math.round(y) }, { droppable: true });
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const id of [...this.ptsBuffer.keys()]) this.flushPoints(id);
    }, 33);
  }
  private flushPoints(id: string) {
    const buf = this.ptsBuffer.get(id);
    if (buf?.length) this.broadcast({ t: "sp", id, p: buf });
    this.ptsBuffer.delete(id);
  }

  private fail(code: BoardErrorCode) {
    if (this.closed) return;
    void this.leave().then(() => this.patch({ phase: "failed", error: code }));
  }

  private patch(p: Partial<BoardState>) {
    this.state = { ...this.state, ...p };
    this.listener(this.state);
  }
}
