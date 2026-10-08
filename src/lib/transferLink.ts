import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * 📁 TRANSFER — intercanvi d'arxius P2P sense límit de mida.
 *
 * Aquest fitxer és IDÈNTIC a `web-guest/src/lib/transferLink.ts` i a
 * `lan_virtual/src/lib/transferLink.ts`: Transfer només fa servir APIs
 * estàndard de navegador (RTCPeerConnection, RTCDataChannel, File System
 * Access), així que el mateix codi corre a la web i a l'app d'escriptori
 * (WebView2). Si el canvies en un lloc, copia'l a l'altre.
 *
 * Com sincronitza la gent (igual que la resta d'eines): UNA PARAULA.
 *  - Canal Supabase Realtime `transfer:<PARAULA>` → presència + broadcast.
 *  - CAP taula, CAP SQL: la presència diu qui hi és i el broadcast porta
 *    l'oferta/resposta/ICE. Fa servir la mateixa URL i anon key de sempre.
 *  - Sala de 2 persones: s'ordenen per hora d'entrada; les dues primeres
 *    són la parella (la primera crea l'oferta WebRTC) i qualsevol tercera
 *    veu "sala plena" i en surt sola.
 *
 * Transferència: RTCDataChannel fiable en trossos de 16 KB amb:
 *  - contrapressió d'enviament (`bufferedAmount`),
 *  - finestra d'acusaments del receptor (màx. 32 MB "en vol"), perquè un
 *    disc lent no inflï la RAM del receptor,
 *  - desat directe a disc (File System Access API) quan el navegador ho
 *    permet → mida il·limitada; si no, fallback a Blob en memòria.
 */

// ── Paràmetres ───────────────────────────────────────────────────────────
const CHUNK_SIZE = 16 * 1024; // mida segura entre navegadors per DataChannel
const READ_BLOCK = 1024 * 1024; // es llegeix de disc en blocs d'1 MB i es parteix en trossos
const BUFFER_HIGH = 8 * 1024 * 1024; // pausa l'enviament per sobre d'això
const BUFFER_LOW = 1 * 1024 * 1024; // …i el represa per sota d'això
const ACK_EVERY = 4 * 1024 * 1024; // el receptor confirma cada 4 MB escrits
const SEND_WINDOW = 32 * 1024 * 1024; // màxim de bytes enviats sense confirmar
const CONNECT_TIMEOUT_MS = 45_000;
const DISCONNECT_GRACE_MS = 8_000;
export const MIN_CODE_LENGTH = 3;

// Mateixos servidors STUN/TURN que la resta d'eines de LVCLITS.
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

// ── Tipus públics ────────────────────────────────────────────────────────
export type TransferPhase = "idle" | "waiting" | "connecting" | "connected" | "failed";
export type TransferErrorCode = "ROOM_FULL" | "CHANNEL" | "CONNECT_TIMEOUT" | "ICE_FAILED" | "CONNECTION_LOST";
export type TransferItemStatus = "queued" | "waiting" | "active" | "done" | "error" | "rejected" | "cancelled";

export interface TransferItem {
  id: string;
  direction: "send" | "receive";
  name: string;
  size: number;
  mime: string;
  /** Bytes enviats (send) o rebuts (receive). */
  done: number;
  status: TransferItemStatus;
  /** Només a la recepció: on s'està desant. */
  savedTo?: "disk" | "memory";
  /** Només a la recepció amb fallback a memòria: enllaç de descàrrega. */
  blobUrl?: string;
  note?: string;
}

export interface TransferState {
  phase: TransferPhase;
  code: string;
  error: TransferErrorCode | null;
  /** Missatge informatiu (p. ex. "L'altra persona ha marxat"). */
  notice: string | null;
  items: TransferItem[];
  /** Nom de la carpeta de desat automàtic, si l'usuari n'ha triat una. */
  dirName: string | null;
  canSaveToDisk: boolean;
  canPickFolder: boolean;
}

export const ERROR_MESSAGES: Record<TransferErrorCode, string> = {
  ROOM_FULL: "Aquesta paraula ja té dues persones connectades. Tria'n una altra.",
  CHANNEL: "No s'ha pogut connectar amb el servei de sincronització. Comprova la connexió.",
  CONNECT_TIMEOUT: "No s'ha pogut establir la connexió directa. Revisa la xarxa o prova-ho de nou.",
  ICE_FAILED: "La connexió directa ha fallat (xarxa massa restrictiva).",
  CONNECTION_LOST: "S'ha perdut la connexió amb l'altra persona.",
};

/** Neteja la paraula: majúscules, sense espais ni símbols estranys. */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

export function supportsDiskStreaming(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showSaveFilePicker === "function";
}
export function supportsFolderPicker(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function initialTransferState(): TransferState {
  return {
    phase: "idle",
    code: "",
    error: null,
    notice: null,
    items: [],
    dirName: null,
    canSaveToDisk: supportsDiskStreaming(),
    canPickFolder: supportsFolderPicker(),
  };
}

// ── Protocol pel DataChannel (missatges de control en JSON) ──────────────
type Ctl =
  | { t: "offer"; id: string; name: string; size: number; mime: string }
  | { t: "accept"; id: string }
  | { t: "reject"; id: string }
  | { t: "cancel"; id: string }
  | { t: "end"; id: string }
  | { t: "ack"; id: string; n: number };

interface SignalMsg {
  from: string;
  to: string | null;
  type: "offer" | "answer" | "candidate";
  data: any;
}

interface RecvState {
  id: string;
  size: number;
  mime: string;
  received: number;
  written: number;
  lastAck: number;
  writer: any | null;
  chunks: ArrayBuffer[] | null;
  chain: Promise<void>;
  failed: boolean;
}

type Decision = "accept" | "reject" | "cancel" | "closed";

export class TransferSession {
  readonly myId = newId();
  private state: TransferState = initialTransferState();
  private channel: RealtimeChannel | null = null;
  private tracked = false;
  private closed = false;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private remoteId: string | null = null;
  private remoteDescSet = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  // Enviament
  private files = new Map<string, File>();
  private pumping = false;
  private decisions = new Map<string, (d: Decision) => void>();
  private acked = new Map<string, number>();
  private ackWaiter: (() => void) | null = null;

  // Recepció
  private recv: RecvState | null = null;
  private dirHandle: any | null = null;

  private wakeLock: any | null = null;

  constructor(
    private readonly code: string,
    private readonly lanOnly: boolean,
    private readonly listener: (s: TransferState) => void,
    private readonly log: (msg: string) => void = () => {}
  ) {
    this.state = { ...this.state, code };
  }

  // ═════════════════════════ Connexió i senyalització ═════════════════════

  /** Entra a la sala `transfer:<paraula>` i espera/troba l'altra persona. */
  async start(): Promise<void> {
    this.patchState({ phase: "waiting", error: null, notice: null });
    const channel = supabase.channel(`transfer:${this.code}`, {
      config: { broadcast: { self: false }, presence: { key: this.myId } },
    });
    this.channel = channel;

    channel
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        void this.onSignal(payload as SignalMsg);
      })
      .on("presence", { event: "sync" }, () => this.onPresenceSync());

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        channel.subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            // També s'executa en reconnexions: tornem a anunciar-nos.
            await channel.track({ id: this.myId, t: Date.now() });
            this.tracked = true;
            if (!settled) {
              settled = true;
              resolve();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            if (!settled) {
              settled = true;
              reject(new Error(status));
            } else {
              this.log(`⚠️ Canal de sincronització: ${status}`);
            }
          }
        });
      });
    } catch (err) {
      this.log(`❌ ${String(err)}`);
      this.fail("CHANNEL");
    }
  }

  private onPresenceSync() {
    if (this.closed || !this.channel || !this.tracked) return;
    const raw = this.channel.presenceState() as Record<string, any[]>;
    const seen = new Map<string, number>();
    for (const entries of Object.values(raw)) {
      for (const p of entries) {
        if (p && typeof p.id === "string") seen.set(p.id, Number(p.t) || 0);
      }
    }
    const peers = Array.from(seen, ([id, t]) => ({ id, t })).sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
    const myIdx = peers.findIndex((p) => p.id === this.myId);
    if (myIdx < 0) return; // el nostre propi track encara no ha arribat
    if (myIdx >= 2) {
      this.fail("ROOM_FULL");
      return;
    }

    const other = peers.slice(0, 2).find((p) => p.id !== this.myId) ?? null;

    if (!other) {
      if (this.remoteId) this.dropPeer("L'altra persona ha marxat. El codi continua obert.");
      return;
    }
    if (this.remoteId === other.id) return;
    if (this.remoteId) this.dropPeer("L'altra persona ha canviat.");

    this.remoteId = other.id;
    void this.setupPeer(myIdx === 0);
  }

  private signal(type: SignalMsg["type"], data: unknown) {
    this.channel?.send({
      type: "broadcast",
      event: "signal",
      payload: { from: this.myId, to: this.remoteId, type, data } satisfies SignalMsg,
    });
  }

  private async onSignal(msg: SignalMsg) {
    if (this.closed || !msg || msg.to !== this.myId) return;
    try {
      if (msg.type === "offer") {
        // L'oferta pot arribar abans que la presència ens hagi avisat.
        if (!this.pc) {
          this.remoteId = msg.from;
          await this.setupPeer(false);
        }
        const pc = this.pc!;
        await pc.setRemoteDescription(msg.data);
        this.remoteDescSet = true;
        await this.flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal("answer", pc.localDescription!.toJSON());
      } else if (msg.type === "answer") {
        if (!this.pc || msg.from !== this.remoteId) return;
        await this.pc.setRemoteDescription(msg.data);
        this.remoteDescSet = true;
        await this.flushCandidates();
      } else if (msg.type === "candidate") {
        if (!this.pc || msg.from !== this.remoteId) return;
        if (!this.remoteDescSet) this.pendingCandidates.push(msg.data);
        else await this.pc.addIceCandidate(msg.data).catch(() => {});
      }
    } catch (err) {
      this.log(`❌ Senyalització (${msg.type}): ${String(err)}`);
    }
  }

  private async flushCandidates() {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  private async setupPeer(isOfferer: boolean) {
    if (this.pc) return;
    const pc = new RTCPeerConnection({ iceServers: this.lanOnly ? [] : ICE_SERVERS });
    this.pc = pc;
    this.remoteDescSet = false;
    this.pendingCandidates = [];
    this.patchState({ phase: "connecting", notice: null });

    this.connectTimer = setTimeout(() => {
      if (this.state.phase === "connecting") this.fail("CONNECT_TIMEOUT");
    }, CONNECT_TIMEOUT_MS);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal("candidate", e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        if (this.graceTimer) clearTimeout(this.graceTimer);
        this.graceTimer = null;
      } else if (s === "failed") {
        this.fail(this.state.phase === "connected" ? "CONNECTION_LOST" : "ICE_FAILED");
      } else if (s === "disconnected" && !this.graceTimer) {
        // "disconnected" sovint es recupera sol: donem uns segons.
        this.graceTimer = setTimeout(() => {
          this.graceTimer = null;
          if (this.pc?.connectionState !== "connected") this.fail("CONNECTION_LOST");
        }, DISCONNECT_GRACE_MS);
      }
    };

    if (isOfferer) {
      this.bindChannel(pc.createDataChannel("files"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal("offer", pc.localDescription!.toJSON());
    } else {
      pc.ondatachannel = (e) => this.bindChannel(e.channel);
    }
  }

  private bindChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = BUFFER_LOW;
    dc.onopen = () => {
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.patchState({ phase: "connected", error: null, notice: null });
      this.log("✅ Connexió directa establerta.");
      void this.pump(); // per si hi havia fitxers en cua
    };
    dc.onclose = () => {
      if (this.closed || this.dc !== dc) return;
      if (this.state.phase === "connected") this.fail("CONNECTION_LOST");
    };
    dc.onmessage = (e) => this.onData(e.data);
  }

  /** L'altra persona ha marxat: tanquem la parella però deixem la sala oberta. */
  private dropPeer(notice: string) {
    this.failActiveItems("connexió tancada");
    this.teardownPeer();
    this.remoteId = null;
    this.patchState({ phase: "waiting", notice });
  }

  private teardownPeer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.connectTimer = null;
    this.graceTimer = null;
    try {
      this.dc?.close();
    } catch {
      /* ja tancat */
    }
    try {
      this.pc?.close();
    } catch {
      /* ja tancat */
    }
    this.dc = null;
    this.pc = null;
    this.remoteDescSet = false;
    this.pendingCandidates = [];
    this.resolveAllWaiters();
  }

  private fail(code: TransferErrorCode) {
    if (this.closed) return;
    this.failActiveItems(ERROR_MESSAGES[code]);
    this.teardownPeer();
    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.tracked = false;
    this.remoteId = null;
    this.patchState({ phase: "failed", error: code });
  }

  /** Surt de la sala i allibera tot (canal, WebRTC, fitxers oberts, blobs). */
  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failActiveItems("sessió tancada");
    this.teardownPeer();
    for (const it of this.state.items) if (it.blobUrl) URL.revokeObjectURL(it.blobUrl);
    if (this.channel) {
      await supabase.removeChannel(this.channel).catch(() => {});
      this.channel = null;
    }
    this.releaseWake();
    if (this.emitTimer) clearTimeout(this.emitTimer);
  }

  // ═════════════════════════════ Enviament ════════════════════════════════

  /** Afegeix fitxers a la cua d'enviament (es manen d'un en un). */
  sendFiles(files: File[]) {
    if (this.state.phase !== "connected") return;
    const added: TransferItem[] = files.map((f) => {
      const id = newId();
      this.files.set(id, f);
      return { id, direction: "send", name: f.name, size: f.size, mime: f.type, done: 0, status: "queued" };
    });
    this.patchState({ items: [...this.state.items, ...added] });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (!this.dc || this.dc.readyState !== "open") break;
        const next = this.state.items.find((i) => i.direction === "send" && i.status === "queued");
        if (!next) break;
        await this.sendOne(next.id);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async sendOne(id: string) {
    const file = this.files.get(id);
    if (!file) return;
    this.patchItem(id, { status: "waiting" });
    this.sendCtl({ t: "offer", id, name: file.name, size: file.size, mime: file.type });

    const decision = await new Promise<Decision>((resolve) => this.decisions.set(id, resolve));
    this.decisions.delete(id);
    if (decision !== "accept") {
      const cur = this.findItem(id);
      if (cur && cur.status === "waiting") {
        this.patchItem(id, {
          status: decision === "reject" ? "rejected" : "cancelled",
          note: decision === "closed" ? "connexió tancada" : undefined,
        });
      }
      this.files.delete(id);
      return;
    }

    this.patchItem(id, { status: "active" });
    try {
      await this.streamFile(id, file);
      this.sendCtl({ t: "end", id });
      this.patchItem(id, { status: "done", done: file.size });
    } catch (err) {
      const cur = this.findItem(id);
      if (cur && cur.status === "active") this.patchItem(id, { status: "error", note: String((err as Error)?.message ?? err) });
    } finally {
      this.files.delete(id);
      this.acked.delete(id);
    }
  }

  private async streamFile(id: string, file: File) {
    let sent = 0;
    while (sent < file.size) {
      const block = await file.slice(sent, Math.min(sent + READ_BLOCK, file.size)).arrayBuffer();
      for (let p = 0; p < block.byteLength; p += CHUNK_SIZE) {
        this.assertSending(id);
        const dc = this.dc!;
        if (dc.bufferedAmount > BUFFER_HIGH) await this.waitBufferLow(dc);
        while (sent - (this.acked.get(id) ?? 0) > SEND_WINDOW) {
          await new Promise<void>((resolve) => (this.ackWaiter = resolve));
          this.assertSending(id);
        }
        const len = Math.min(CHUNK_SIZE, block.byteLength - p);
        dc.send(new Uint8Array(block, p, len));
        sent += len;
        this.patchItem(id, { done: Math.max(0, sent - dc.bufferedAmount) }, false);
      }
    }
  }

  private assertSending(id: string) {
    const it = this.findItem(id);
    if (!it || it.status !== "active") throw new Error("cancel·lat");
    if (!this.dc || this.dc.readyState !== "open") throw new Error("connexió tancada");
  }

  private waitBufferLow(dc: RTCDataChannel): Promise<void> {
    return new Promise<void>((resolve) => {
      let iv: ReturnType<typeof setInterval> | null = null;
      const done = () => {
        dc.removeEventListener("bufferedamountlow", done);
        if (iv) clearInterval(iv);
        resolve();
      };
      dc.addEventListener("bufferedamountlow", done);
      // Xarxa de seguretat: si l'esdeveniment es perd o el canal es tanca.
      iv = setInterval(() => {
        if (dc.readyState !== "open" || dc.bufferedAmount <= BUFFER_LOW) done();
      }, 100);
    });
  }

  // ═════════════════════════════ Recepció ═════════════════════════════════

  /**
   * L'usuari accepta un fitxer entrant. IMPORTANT: s'ha de cridar des d'un
   * clic (gest d'usuari) perquè el navegador deixi obrir el selector de
   * "Desar com…". Amb una carpeta de desat triada ja no cal cap clic.
   */
  async acceptIncoming(id: string): Promise<void> {
    const item = this.findItem(id);
    if (!item || item.direction !== "receive" || item.status !== "waiting" || this.recv) return;

    let writer: any | null = null;
    try {
      if (this.dirHandle) {
        const fh = await this.dirHandle.getFileHandle(await this.uniqueName(item.name), { create: true });
        writer = await fh.createWritable();
      } else if (supportsDiskStreaming()) {
        const fh = await (window as any).showSaveFilePicker({ suggestedName: item.name });
        writer = await fh.createWritable();
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return; // ha cancel·lat el selector: segueix pendent
      this.log(`⚠️ No es pot desar directament a disc (${String(err)}); es farà en memòria.`);
      writer = null;
    }

    if (!this.findItem(id) || this.findItem(id)!.status !== "waiting") {
      await writer?.abort?.().catch(() => {});
      return; // mentrestant s'ha cancel·lat o s'ha tancat la connexió
    }

    this.recv = {
      id,
      size: item.size,
      mime: item.mime,
      received: 0,
      written: 0,
      lastAck: 0,
      writer,
      chunks: writer ? null : [],
      chain: Promise.resolve(),
      failed: false,
    };
    this.patchItem(id, { status: "active", savedTo: writer ? "disk" : "memory" });
    this.sendCtl({ t: "accept", id });
  }

  rejectIncoming(id: string) {
    const item = this.findItem(id);
    if (!item || item.direction !== "receive" || item.status !== "waiting") return;
    this.sendCtl({ t: "reject", id });
    this.patchItem(id, { status: "rejected" });
  }

  /** Cancel·la un fitxer (en cua, en espera o en curs, enviant o rebent). */
  cancel(id: string) {
    const item = this.findItem(id);
    if (!item || !["queued", "waiting", "active"].includes(item.status)) return;
    if (item.status !== "queued") this.sendCtl({ t: "cancel", id });
    if (item.direction === "receive" && this.recv?.id === id) void this.abortRecv(this.recv);
    this.patchItem(id, { status: "cancelled" });
    this.decisions.get(id)?.("cancel");
    this.ackWaiter?.();
    this.files.delete(id);
  }

  /** Tria una carpeta: els fitxers entrants s'hi desen sols, sense preguntar. */
  async chooseFolder(): Promise<void> {
    if (!supportsFolderPicker()) return;
    try {
      this.dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      this.patchState({ dirName: String(this.dirHandle.name ?? "") });
      const waiting = this.state.items.find((i) => i.direction === "receive" && i.status === "waiting");
      if (waiting) void this.acceptIncoming(waiting.id);
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") this.log(`⚠️ No s'ha pogut triar la carpeta: ${String(err)}`);
    }
  }

  clearFolder() {
    this.dirHandle = null;
    this.patchState({ dirName: null });
  }

  private async uniqueName(name: string): Promise<string> {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    for (let n = 1; n < 1000; n++) {
      try {
        await this.dirHandle.getFileHandle(candidate); // sense `create`: llança si no existeix
        candidate = `${base} (${n})${ext}`;
      } catch {
        return candidate;
      }
    }
    return `${base}-${newId().slice(0, 8)}${ext}`;
  }

  private onData(data: unknown) {
    if (typeof data === "string") {
      let msg: Ctl;
      try {
        msg = JSON.parse(data) as Ctl;
      } catch {
        return;
      }
      this.onCtl(msg);
      return;
    }
    const r = this.recv;
    if (!r || !(data instanceof ArrayBuffer)) return;
    r.received += data.byteLength;

    if (r.writer) {
      r.chain = r.chain.then(async () => {
        if (r.failed) return;
        try {
          await r.writer.write(data);
          r.written += data.byteLength;
          this.maybeAck(r);
        } catch (err) {
          r.failed = true;
          this.failRecv(r, `error d'escriptura: ${String((err as Error)?.message ?? err)}`);
        }
      });
    } else {
      r.chunks!.push(data);
      r.written = r.received;
      this.maybeAck(r);
    }
    this.patchItem(r.id, { done: r.received }, false);
  }

  private maybeAck(r: RecvState) {
    if (r.written - r.lastAck >= ACK_EVERY) {
      r.lastAck = r.written;
      this.sendCtl({ t: "ack", id: r.id, n: r.written });
    }
  }

  private onCtl(msg: Ctl) {
    switch (msg.t) {
      case "offer": {
        const item: TransferItem = {
          id: msg.id,
          direction: "receive",
          name: String(msg.name || "fitxer"),
          size: Number(msg.size) || 0,
          mime: String(msg.mime || ""),
          done: 0,
          status: "waiting",
        };
        this.patchState({ items: [...this.state.items, item] });
        if (this.dirHandle) void this.acceptIncoming(msg.id);
        break;
      }
      case "accept":
        this.decisions.get(msg.id)?.("accept");
        break;
      case "reject":
        this.decisions.get(msg.id)?.("reject");
        break;
      case "cancel": {
        const it = this.findItem(msg.id);
        if (!it || !["queued", "waiting", "active"].includes(it.status)) break;
        if (it.direction === "receive" && this.recv?.id === msg.id) void this.abortRecv(this.recv);
        this.patchItem(msg.id, { status: "cancelled", note: "cancel·lat per l'altra persona" });
        this.decisions.get(msg.id)?.("cancel");
        this.ackWaiter?.();
        break;
      }
      case "ack":
        this.acked.set(msg.id, Math.max(this.acked.get(msg.id) ?? 0, Number(msg.n) || 0));
        this.ackWaiter?.();
        break;
      case "end": {
        const r = this.recv;
        if (!r || r.id !== msg.id) break;
        r.chain = r.chain.then(() => this.finishRecv(r));
        break;
      }
    }
  }

  private async finishRecv(r: RecvState) {
    if (r.failed || this.recv !== r) return;
    this.recv = null;
    try {
      if (r.received !== r.size) throw new Error(`incomplet (${r.received} de ${r.size} bytes)`);
      if (r.writer) {
        await r.writer.close();
        this.patchItem(r.id, { status: "done", done: r.size });
      } else {
        const blob = new Blob(r.chunks!, { type: r.mime || "application/octet-stream" });
        this.patchItem(r.id, { status: "done", done: r.size, blobUrl: URL.createObjectURL(blob) });
      }
    } catch (err) {
      await r.writer?.abort?.().catch(() => {});
      this.patchItem(r.id, { status: "error", note: String((err as Error)?.message ?? err) });
    }
  }

  /** Error local a mitja recepció: avisem l'emissor perquè pari. */
  private failRecv(r: RecvState, note: string) {
    if (this.recv !== r) return;
    this.recv = null;
    this.sendCtl({ t: "cancel", id: r.id });
    void r.writer?.abort?.().catch(() => {});
    this.patchItem(r.id, { status: "error", note });
  }

  private async abortRecv(r: RecvState) {
    if (this.recv === r) this.recv = null;
    r.failed = true;
    r.chunks = null;
    await r.writer?.abort?.().catch(() => {});
  }

  // ═════════════════════════════ Utilitats ════════════════════════════════

  private sendCtl(msg: Ctl) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
  }

  private findItem(id: string) {
    return this.state.items.find((i) => i.id === id);
  }

  private resolveAllWaiters() {
    for (const resolve of this.decisions.values()) resolve("closed");
    this.ackWaiter?.();
  }

  /** Marca com a error tot el que estava en curs o pendent. */
  private failActiveItems(note: string) {
    if (this.recv) {
      const r = this.recv;
      this.recv = null;
      r.failed = true;
      void r.writer?.abort?.().catch(() => {});
    }
    let changed = false;
    const items = this.state.items.map((i) => {
      if (i.status === "queued" || i.status === "waiting" || i.status === "active") {
        changed = true;
        return { ...i, status: "error" as const, note };
      }
      return i;
    });
    if (changed) this.state = { ...this.state, items };
    this.files.clear();
  }

  private patchItem(id: string, patch: Partial<TransferItem>, immediate = true) {
    this.state = {
      ...this.state,
      items: this.state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    };
    this.emit(immediate);
  }

  private patchState(patch: Partial<TransferState>) {
    this.state = { ...this.state, ...patch };
    this.emit(true);
  }

  private emit(immediate: boolean) {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.listener(this.state);
      this.syncWake();
      return;
    }
    if (this.emitTimer) return; // el progrés es publica com a molt ~8 cops/s
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.listener(this.state);
    }, 120);
  }

  // Evita que el mòbil s'adormi enmig d'una transferència llarga.
  private syncWake() {
    const busy = this.state.items.some((i) => i.status === "active");
    if (busy && !this.wakeLock) {
      const wl = (navigator as any).wakeLock;
      if (wl?.request) {
        this.wakeLock = {};
        wl.request("screen")
          .then((lock: any) => {
            if (this.wakeLock) this.wakeLock = lock;
            else lock.release?.();
          })
          .catch(() => {
            this.wakeLock = null;
          });
      }
    } else if (!busy) {
      this.releaseWake();
    }
  }

  private releaseWake() {
    const lock = this.wakeLock;
    this.wakeLock = null;
    lock?.release?.().catch?.(() => {});
  }
}
