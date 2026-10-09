import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useGuestViewer } from "./hooks/useGuestViewer";
import { useInputCapture } from "./hooks/useInputCapture";
import Logo from "./components/common/Logo";
import CornerFrame from "./components/common/CornerFrame";
import PingBadge from "./components/common/PingBadge";
import VirtualGamepad from "./components/common/VirtualGamepad";
import AppIcon from "./components/common/AppIcon";
import TransferPanel from "./components/transfer/TransferPanel";
import NetworkField, { type FieldAccent } from "./components/common/NetworkField";
import ToolIcon, { type ToolIconName } from "./components/common/ToolIcon";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ℹ️ Avís "això és només el Guest": un cop tancat, es recorda al navegador.
const HOST_NOTICE_KEY = "lvclits-host-notice-dismissed";

// 🔘 Botó rodó amb icona, sense text — la unitat visual de tot el HUD
// sobre el vídeo. `active` pinta l'accent de color quan l'estat és "on".
function IconButton({
  icon,
  iconName,
  title,
  onClick,
  active = false,
  disabled = false,
  accent = "orange",
  size = "md",
}: {
  icon: ReactNode;
  /** Nom de la icona personalitzada (`public/ui-icons/<nom>.svg|png`); si no existeix, es mostra `icon`. */
  iconName?: string;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  accent?: "orange" | "cyan" | "red" | "emerald" | "white";
  size?: "sm" | "md";
}) {
  const accentClasses: Record<string, string> = {
    orange: "text-orange-300 bg-orange-500/20 border-orange-400/40",
    cyan: "text-cyan-300 bg-cyan-500/20 border-cyan-400/40",
    red: "text-red-300 bg-red-500/20 border-red-400/40",
    emerald: "text-emerald-300 bg-emerald-500/20 border-emerald-400/40",
    white: "text-white bg-white/20 border-white/40",
  };
  const dim = size === "sm" ? "w-8 h-8 text-sm" : "w-10 h-10 text-base";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`${dim} rounded-full flex items-center justify-center border transition-all duration-200 backdrop-blur-md shadow-md disabled:opacity-40 disabled:pointer-events-none ${
        active ? accentClasses[accent] : "text-gray-300 bg-black/50 border-white/15 hover:bg-white/10 hover:text-white"
      }`}
    >
      {iconName ? <AppIcon name={iconName} fallback={icon} size={size === "sm" ? 16 : 20} /> : icon}
    </button>
  );
}

// 💬 Panell de xat compacte (tècnic ↔ Host).
function ChatPanel({
  messages,
  input,
  onInput,
  onSend,
  className = "",
}: {
  messages: { from: "me" | "host"; text: string }[];
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  className?: string;
}) {
  return (
    <div className={`bg-black/85 border border-cyan-400/30 chamfer-sm p-2 flex flex-col gap-2 ${className}`}>
      <div className="max-h-40 overflow-y-auto flex flex-col gap-1 text-xs">
        {messages.length === 0 && <p className="text-gray-500 text-center">Cap missatge encara.</p>}
        {messages.map((m, i) => (
          <p
            key={i}
            className={`px-2 py-1 rounded-lg max-w-[85%] ${
              m.from === "me" ? "self-end bg-cyan-500/25 text-cyan-100" : "self-start bg-white/10 text-gray-200"
            }`}
          >
            {m.text}
          </p>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="Escriu un missatge..."
          maxLength={500}
          className="flex-1 bg-black/60 border border-white/15 rounded-full px-3 py-1.5 text-xs text-white"
        />
        <IconButton icon="➤" iconName="send" title="Enviar missatge" onClick={onSend} size="sm" active accent="cyan" />
      </div>
    </div>
  );
}

type AppMode = "game" | "assist" | "call" | "transfer";

// Classes literals perquè Tailwind les detecti.
const TOOLS: { id: AppMode; label: string; icon: ToolIconName; on: string; dot: string; badge: string; glow: string }[] = [
  { id: "game", label: "Jugar", icon: "game", on: "bg-orange-500 text-black shadow-orange-500/30", dot: "bg-orange-400", badge: "bg-orange-500/15 text-orange-300", glow: "drop-shadow-[0_0_16px_rgba(251,146,60,0.55)]" },
  { id: "assist", label: "Assistència", icon: "assist", on: "bg-cyan-500 text-black shadow-cyan-500/30", dot: "bg-cyan-400", badge: "bg-cyan-500/15 text-cyan-300", glow: "drop-shadow-[0_0_16px_rgba(34,211,238,0.55)]" },
  { id: "call", label: "Trucada", icon: "call", on: "bg-emerald-500 text-black shadow-emerald-500/30", dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-300", glow: "drop-shadow-[0_0_16px_rgba(52,211,153,0.55)]" },
  { id: "transfer", label: "Transfer", icon: "transfer", on: "bg-violet-500 text-black shadow-violet-500/30", dot: "bg-violet-400", badge: "bg-violet-500/15 text-violet-300", glow: "drop-shadow-[0_0_16px_rgba(167,139,250,0.55)]" },
];
const FIELD_ACCENT: Record<AppMode, FieldAccent> = { game: "orange", assist: "cyan", call: "emerald", transfer: "violet" };
const FIELD_GLOW: Record<AppMode, string> = { game: "251,146,60", assist: "34,211,238", call: "52,211,153", transfer: "167,139,250" };

function HeroBadge({ mode }: { mode: AppMode }) {
  const t = TOOLS.find((x) => x.id === mode)!;
  return (
    <div className={`mx-auto mb-4 w-fit ${t.glow}`}>
      <div className={`w-14 h-14 chamfer flex items-center justify-center ${t.badge}`}>
        <ToolIcon name={t.icon} size={28} />
      </div>
    </div>
  );
}

export default function App() {
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [gamepadName, setGamepadName] = useState<string | null>(null);
  const [lanOnly, setLanOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVirtualPad, setShowVirtualPad] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showHostNotice, setShowHostNotice] = useState(() => {
    try {
      return localStorage.getItem(HOST_NOTICE_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const dismissHostNotice = () => {
    setShowHostNotice(false);
    try {
      localStorage.setItem(HOST_NOTICE_KEY, "1");
    } catch {
      /* sense emmagatzematge: simplement reapareixerà en recarregar */
    }
  };
  // 📁 Assistència Remota: fitxer a enviar al Host + progrés d'enviament.
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [sendProgress, setSendProgress] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [quickActionBusy, setQuickActionBusy] = useState<string | null>(null);
  // 🎛️ HUD amagable: amb els botons ara rodons i sense text, es poden
  // amagar del tot per deixar la imatge neta — només queda l'interruptor
  // (👁️/⬍) flotant, sempre visible, per tornar-los a mostrar.
  const [hudVisible, setHudVisible] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    sendChat(text);
    setChatInput("");
  };
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pushLog = useCallback((message: string) => {
    setLog((prev) => [...prev.slice(-40), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const { phase, connect, disconnect, sendInput, stats: connectionStats, videoStats, chatMessages, sendChat, diagSnapshot, requestDiagRefresh, requestQuickAction, quickActionMsg, sendFileToHost, toggleMic, micSending, micError, peopleCount } = useGuestViewer({ canvasRef, audioMuted: isMuted, onLog: pushLog });

  // 🖱️🩺 Fix de seguretat + suport a l'Assistència Remota: el ratolí/tàctil
  // ara només s'enganxa al `<canvas>` (mai a la resta de la pàgina), i
  // només quan `controlActive` és cert — que per defecte és fals encara
  // que ja estiguis "connected". Passar a Pantalla Completa activa el
  // control automàticament; també es pot activar/desactivar a mà amb el
  // botó "🖱️ Control" per qui no vulgui/pugui fer servir pantalla completa.
  const [controlActive, setControlActive] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("game");
  // 📁 Hi ha un fitxer en moviment: el fons dinàmic puja d'activitat.
  const [transferActive, setTransferActive] = useState(false);
  // 📁 Transfer està "ocupat" quan hi ha sala oberta: bloqueja el canvi d'eina.
  const [transferBusy, setTransferBusy] = useState(false);
  // 🎨 Color d'identitat de cada eina: 🎮 taronja · 🩺 cian · 📞 verd · 📁 violeta.
  const frameColor = appMode === "transfer" ? "violet" : appMode === "call" ? "emerald" : appMode === "assist" ? "cyan" : "orange";
  const fieldIntensity =
    phase === "searching" || phase === "negotiating" ? 0.8 : appMode === "transfer" && transferActive ? 1 : 0.4;

  // Envia teclat, ratolí i comandament al Host pel canal "inputs". Ratolí i
  // tàctil escopats al `<canvas>` i només actius amb `controlActive` —
  // "connected" per si sol JA NO és suficient (vegis el comentari de dalt).
  useInputCapture({
    enabled: phase === "connected" && controlActive,
    onInput: sendInput,
    targetRef: canvasRef,
    mouseMode: appMode === "assist" ? "absolute" : "relative",
  });

  // Detecció visible de comandaments — la Gamepad API només informa amb
  // esdeveniments quan es prem un botó per primer cop, així que també
  // comprovem l'estat ja connectat en muntar.
  useEffect(() => {
    const updateFromList = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const first = Array.from(pads).find((p) => p);
      setGamepadName(first ? first.id : null);
    };
    const handleConnected = (e: GamepadEvent) => {
      setGamepadName(e.gamepad.id);
      pushLog(`🎮 Comandament detectat: ${e.gamepad.id}`);
    };
    const handleDisconnected = () => {
      updateFromList();
      pushLog("🎮 Comandament desconnectat.");
    };
    updateFromList();
    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
    };
  }, [pushLog]);

  // Captura l'esdeveniment natiu d'instal·lació (Chrome/Edge/Android) per
  // oferir un botó propi enlloc de dependre només de l'icona del navegador.
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // 🕹️ Pantalla completa: escoltem l'esdeveniment natiu perquè el botó
  // reflecteixi l'estat real (fins i tot si es surt amb Esc) i perquè
  // funcioni també a Safari/iOS (prefix "webkit").
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isFs);
      // Sortir de pantalla completa desactiva el control automàticament
      // (torna a "vista normal": mirar, no tocar). Entrar-hi l'activa.
      setControlActive(isFs);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, []);

  // 🎮 El mando virtual NO surt sol: l'usuari l'activa amb el botó 🕹️ quan el
  // necessita (abans apareixia automàticament en dispositius tàctils i
  // tapava la imatge).

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const handleConnect = () => {
    if (appMode === "transfer" || !roomCodeInput.trim()) return;
    connect(roomCodeInput, lanOnly, appMode);
  };

  const handleRequestDiag = () => {
    setDiagLoading(true);
    requestDiagRefresh();
  };

  const handleSendFile = async () => {
    if (!fileToSend) return;
    setSendError(null);
    setSendProgress(0);
    try {
      await sendFileToHost(fileToSend, (sent, total) => setSendProgress(Math.round((sent / total) * 100)));
      pushLog(`📤 "${fileToSend.name}" enviat correctament.`);
      setFileToSend(null);
      setSendProgress(null);
    } catch (e) {
      setSendError(String(e));
      setSendProgress(null);
    }
  };

  const handleFullscreen = () => {
    const el = containerRef.current as any;
    if (!el) return;
    const isFs = document.fullscreenElement || (document as any).webkitFullscreenElement;
    if (!isFs) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      req?.call(el)?.catch?.(() => {});
    } else {
      const exit = document.exitFullscreen || (document as any).webkitExitFullscreen;
      exit?.call(document);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setRoomCodeInput("");
    setIsMuted(true);
    setControlActive(false);
    setFileToSend(null);
    setSendProgress(null);
    setSendError(null);
    setDiagLoading(false);
    setChatOpen(false);
    setChatInput("");
  };

  // Un cop arriben estadístiques noves, treiem l'indicador de "Consultant...".
  useEffect(() => {
    if (diagSnapshot) setDiagLoading(false);
  }, [diagSnapshot]);
  useEffect(() => {
    if (quickActionMsg) setQuickActionBusy(null);
  }, [quickActionMsg]);

  const handleQuickAction = (action: "clean_temp_files" | "lock_screen") => {
    setQuickActionBusy(action);
    requestQuickAction(action);
  };

  // Selector d'eina. Bloquejat mentre es connecta o hi ha una sala de Transfer oberta.
  const switchLocked = phase === "searching" || phase === "negotiating" || transferBusy;
  const modeSelector = (
    <div role="tablist" aria-label="Eina" className="panel chamfer-sm grid grid-cols-4 gap-1 p-1 mb-8">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={appMode === t.id}
          onClick={() => setAppMode(t.id)}
          disabled={switchLocked}
          className={`chamfer-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-2.5 text-[11px] sm:text-sm font-semibold transition-all duration-300 disabled:opacity-50 ${
            appMode === t.id ? `${t.on} shadow-lg` : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <ToolIcon name={t.icon} size={18} />
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#05070a] relative overflow-hidden flex flex-col">
      {/* Fons dinàmic: xarxa de nodes que canvia de color segons l'eina. No es dibuixa en streaming. */}
      {phase !== "connected" && (
        <>
          <NetworkField accent={FIELD_ACCENT[appMode]} intensity={fieldIntensity} />
          <div
            aria-hidden
            className="fixed inset-0 pointer-events-none transition-[background] duration-700"
            style={{
              background: `radial-gradient(ellipse 70% 50% at 50% 0%, rgba(${FIELD_GLOW[appMode]},0.12), transparent 70%), radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.72) 100%)`,
            }}
          />
        </>
      )}

      {/* Barra de sistema */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 animate-fade-in-up">
          <Logo size={28} />
          <span className="font-display text-white font-bold text-base tracking-[0.18em]">LVCLITS</span>
        </div>
        <div className="flex items-center gap-3 animate-fade-in-up">
          {appMode === "game" && (
            <div
              className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors duration-300 ${
                gamepadName
                  ? "text-emerald-300 bg-emerald-400/10 border-emerald-400/30"
                  : "text-gray-500 bg-white/5 border-white/10"
              }`}
              title={gamepadName ?? "Cap comandament detectat"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${gamepadName ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
              🎮 {gamepadName ? "Comandament actiu" : "Sense comandament"}
            </div>
          )}
          {phase !== "connected" && (
            <button
              onClick={() => (showHostNotice ? dismissHostNotice() : setShowHostNotice(true))}
              title="Per què cal l'app d'escriptori?"
              aria-label="Per què cal l'app d'escriptori?"
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border transition-colors duration-200 ${
                showHostNotice
                  ? "text-cyan-200 bg-cyan-500/20 border-cyan-400/40"
                  : "text-gray-400 bg-white/5 border-white/10 hover:text-white hover:bg-white/10"
              }`}
            >
              ℹ️
            </button>
          )}
          {!installed && installEvent && (
            <button
              onClick={handleInstall}
              className="text-[11px] font-bold uppercase tracking-widest text-orange-200 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/30 rounded-full px-3.5 py-1.5 transition-colors duration-200"
            >
              ⬇ Instal·lar app
            </button>
          )}
          <div className="flex items-center gap-2 text-xs font-medium text-gray-300 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${TOOLS.find((t) => t.id === appMode)!.dot}`} />
            {TOOLS.find((t) => t.id === appMode)!.label}
          </div>
        </div>
      </div>

      {appMode === "transfer" ? (
        <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-4">
          <div className="max-w-lg w-full animate-fade-in-up">
            {modeSelector}
            <div className="text-center mb-6">
              <HeroBadge mode="transfer" />
              <h1 className="text-4xl font-bold text-white tracking-tight">Transfer</h1>
              <p className="text-gray-400 text-sm mt-2">
                Eina d'intercanvi d'arxius sense límits: P2P directe, sense pujar res a cap servidor i sense cap topall de
                mida. Els dos escriviu la mateixa paraula i ja podeu enviar-vos fitxers en qualsevol direcció.
              </p>
            </div>
            <TransferPanel onBusyChange={setTransferBusy} onActiveChange={setTransferActive} />
          </div>
        </div>
      ) : phase !== "connected" ? (
        <div className="relative z-10 flex-1 flex items-center justify-center px-6">
          <div className="max-w-md w-full animate-fade-in-up">
            {modeSelector}

            <div className="text-center mb-8">
              <HeroBadge mode={appMode} />
              <h1 className="text-4xl font-bold text-white tracking-tight">
                {appMode === "call" ? "Trucada directa" : appMode === "assist" ? "Assistència remota" : "Jugar en remot"}
              </h1>
              <p className="text-gray-400 text-sm mt-2">
                {appMode === "call"
                  ? "Introdueix el codi de la trucada que t'hagi donat l'altra persona des de l'app LVCLITS (eina \"Trucada Directa\"). Només veu: parlareu i us sentireu, res més es comparteix."
                  : appMode === "assist"
                  ? "Introdueix el codi de sessió que et doni qui necessita ajuda. Un cop connectat, podràs veure la seva pantalla, controlar el teclat i el ratolí, consultar l'estat del seu PC i enviar-li arxius."
                  : "Introdueix el codi de sala. Un cop connectat, el teclat, el ratolí i el comandament controlaran el joc del Host."}
              </p>
            </div>

            <div className="relative animate-scale-in space-y-4 panel p-6 chamfer">
              <CornerFrame color={frameColor} />
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder={appMode === "call" ? "EX: A1B2C3" : "EX: PARTIDA-RETRO"}
                maxLength={20}
                disabled={phase === "searching" || phase === "negotiating"}
                className={`w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none transition-all disabled:opacity-50 ${
                  appMode === "call" ? "focus:border-emerald-400/60" : appMode === "assist" ? "focus:border-cyan-400/60" : "focus:border-orange-400/60"
                }`}
              />

              <button
                onClick={phase === "searching" || phase === "negotiating" ? disconnect : handleConnect}
                disabled={phase !== "searching" && phase !== "negotiating" && !roomCodeInput.trim()}
                className={`w-full font-bold py-3 chamfer-sm transition-all duration-300 hover:scale-[1.01] shadow-lg ${
                  phase === "searching" || phase === "negotiating"
                    ? "bg-red-500/80 hover:bg-red-500 text-white shadow-red-500/20"
                    : appMode === "call"
                    ? "bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:pointer-events-none text-black shadow-emerald-500/20"
                    : appMode === "assist"
                    ? "bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:pointer-events-none text-black shadow-cyan-500/20"
                    : "bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:pointer-events-none text-black shadow-orange-500/20"
                }`}
              >
                {phase === "searching"
                  ? "❌ Cancel·la la cerca"
                  : phase === "negotiating"
                  ? "❌ Cancel·la la connexió"
                  : "Connectar →"}
              </button>

              <label className="flex items-center gap-3 px-1 py-1 cursor-pointer group">
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center chamfer-sm transition-colors duration-200 ${
                    lanOnly ? "bg-orange-500/60" : "bg-white/10"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={lanOnly}
                    disabled={phase === "searching" || phase === "negotiating"}
                    onChange={(e) => setLanOnly(e.target.checked)}
                    className="sr-only"
                  />
                  <span
                    className={`inline-block h-3.5 w-3.5 transform bg-white transition-transform duration-200 ${
                      lanOnly ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </span>
                <span className="text-xs text-gray-300 group-hover:text-white transition-colors">
                  📡 Només xarxa local (LAN)
                  <span className="block text-[10px] text-gray-500">
                    Sense servidors externs — més ràpid, però només funciona si esteu a la mateixa xarxa que el Host
                  </span>
                </span>
              </label>

              {(phase === "searching" || phase === "negotiating") && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <div className="w-4 h-4 border-2 border-white/10 border-t-orange-400 rounded-full animate-spin" />
                  <p className="text-gray-500 text-xs">
                    {phase === "searching" ? "Esperant que el Host respongui..." : "Establint connexió directa..."}
                  </p>
                </div>
              )}

              {phase === "failed" && (
                <div className="text-center space-y-3">
                  <p className="text-red-400 text-sm">
                    {appMode === "call"
                      ? "No s'ha pogut connectar. Comprova el codi i que l'altra persona tingui la trucada oberta."
                      : "No s'ha pogut connectar. Comprova el codi i que l'altra persona encara estigui compartint."}
                  </p>
                  <button
                    onClick={handleDisconnect}
                    className="px-6 py-2 bg-white/5 border border-white/10 chamfer-sm text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    Tornar a intentar
                  </button>
                </div>
              )}
            </div>

            {log.length > 0 && (
              <div className="animate-fade-in-up mt-6 bg-black/50 border border-white/10 chamfer-sm p-4 backdrop-blur-md">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2 border-b border-white/5 pb-2">
                  📋 Estat de la connexió
                </p>
                <div className="h-28 overflow-y-auto space-y-1 pr-2">
                  {log.map((entry, i) => (
                    <p key={i} className="text-[11px] font-mono text-gray-500">
                      {entry}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : appMode === "call" ? (
        <div className="relative z-10 flex-1 flex items-center justify-center px-6">
          <div className="relative max-w-md w-full animate-scale-in bg-white/5 border border-white/10 p-8 chamfer backdrop-blur-md shadow-xl text-center space-y-6">
            <CornerFrame color="emerald" />
            <div>
              <p className="text-emerald-300 font-semibold text-lg">📞 Trucada activa</p>
              <p className="text-gray-400 text-xs mt-1">
                Sala <span className="font-mono tracking-widest text-gray-200">{roomCodeInput}</span> · sents tothom
                automàticament
              </p>
            </div>
            <p className="text-gray-300 text-xs">👥 {Math.max(peopleCount, 2)} persones a la trucada</p>
            <div className="flex justify-center">
              <PingBadge rttMs={connectionStats.rttMs} packetsLost={connectionStats.packetsLost} />
            </div>
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={toggleMic}
                title={micSending ? "Silenciar-me" : "Activar el micròfon"}
                aria-label={micSending ? "Silenciar-me" : "Activar el micròfon"}
                className={`w-24 h-24 rounded-full text-4xl flex items-center justify-center border-2 transition-all duration-200 shadow-lg ${
                  micError
                    ? "text-red-300 bg-red-500/20 border-red-400/50"
                    : micSending
                    ? "text-emerald-200 bg-emerald-500/25 border-emerald-400/60 shadow-emerald-500/30 animate-pulse"
                    : "text-gray-300 bg-black/50 border-white/20 hover:bg-white/10 hover:text-white"
                }`}
              >
                <AppIcon name={micSending ? "mic-on" : "mic-off"} fallback={micSending ? "🎤" : "🔇"} size={44} />
              </button>
              <p className={`text-xs ${micError ? "text-red-300" : "text-gray-400"}`}>
                {micError
                  ? `❌ ${micError}`
                  : micSending
                  ? "Micròfon actiu — clica per silenciar-te"
                  : "Micròfon apagat — clica per parlar"}
              </p>
            </div>
            <button
              onClick={handleDisconnect}
              className="w-full font-bold py-3 chamfer-sm bg-red-500/80 hover:bg-red-500 text-white shadow-lg shadow-red-500/20 transition-all duration-300"
            >
              <AppIcon name="hang-up" fallback="📵" size={18} /> Penjar
            </button>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
          <div
            ref={containerRef}
            className="relative chamfer overflow-hidden border border-white/10 bg-black w-full aspect-video shadow-2xl max-w-6xl animate-scale-in"
          >
            <canvas ref={canvasRef} className="w-full h-full object-contain block" />
            <CornerFrame color={frameColor} />

            {appMode === "assist" && diagSnapshot && (
              <div className="absolute top-2 right-2 z-20 bg-black/85 border border-orange-400/30 chamfer-sm px-3 py-2 text-[11px] text-gray-200 max-w-xs space-y-0.5 font-mono">
                <p className="text-orange-300 font-semibold mb-1">
                  🩺 {String((diagSnapshot as any).hostname ?? "Host")}
                </p>
                <p>{String((diagSnapshot as any).os_name)} · {String((diagSnapshot as any).os_version)}</p>
                <p>
                  CPU: {String((diagSnapshot as any).cpu?.brand)} —{" "}
                  {Number((diagSnapshot as any).cpu?.global_usage_percent ?? 0).toFixed(0)}%
                </p>
                <p>
                  RAM: {Number((diagSnapshot as any).memory?.used_gb ?? 0).toFixed(1)} /{" "}
                  {Number((diagSnapshot as any).memory?.total_gb ?? 0).toFixed(1)} GB (
                  {Number((diagSnapshot as any).memory?.used_percent ?? 0).toFixed(0)}%)
                </p>
                {((diagSnapshot as any).disks ?? []).map((d: any) => (
                  <p key={d.mount_point}>
                    💾 {d.mount_point}: {d.available_gb.toFixed(1)} GB lliures ({d.used_percent.toFixed(0)}% ple)
                  </p>
                ))}
                {((diagSnapshot as any).top_processes ?? []).slice(0, 5).map((pr: any) => (
                  <p key={pr.pid}>⚙️ {pr.name}: {Number(pr.cpu_percent ?? 0).toFixed(0)}% CPU · {Number(pr.memory_mb ?? 0).toFixed(0)} MB</p>
                ))}
                {((diagSnapshot as any).networks ?? []).map((n: any) => (
                  <p key={n.interface}>
                    📶 {n.interface}: ↓{Number(n.received_kbps ?? 0).toFixed(0)} ↑{Number(n.transmitted_kbps ?? 0).toFixed(0)} kbps
                  </p>
                ))}
                {((diagSnapshot as any).warnings ?? []).map((w: string, i: number) => (
                  <p key={i} className="text-red-300">{w}</p>
                ))}
                <div className="flex gap-2 pt-1">
                  <IconButton
                    icon="🧹"
                    iconName="quick-clean"
                    title="Buida temporals del Host"
                    onClick={() => handleQuickAction("clean_temp_files")}
                    disabled={quickActionBusy !== null}
                    active={quickActionBusy === "clean_temp_files"}
                    size="sm"
                    accent="cyan"
                  />
                  <IconButton
                    icon="🔒"
                    iconName="quick-lock"
                    title="Bloqueja la pantalla del Host"
                    onClick={() => handleQuickAction("lock_screen")}
                    disabled={quickActionBusy !== null}
                    active={quickActionBusy === "lock_screen"}
                    size="sm"
                    accent="cyan"
                  />
                </div>
                {quickActionMsg && <p className="text-emerald-300">{quickActionMsg}</p>}
              </div>
            )}

            {showVirtualPad && appMode === "game" && <VirtualGamepad onInput={sendInput} />}

            {/* 👁️ Interruptor del HUD: SEMPRE visible (fins i tot amb el
                HUD amagat) perquè mai es quedi "atrapat" sense botons. */}
            <div className="absolute top-3 right-3 z-30">
              <IconButton
                icon={hudVisible ? "⬍" : "👁️"}
                iconName={hudVisible ? "hud-hide" : "hud-show"}
                title={hudVisible ? "Amaga els controls" : "Mostra els controls"}
                onClick={() => setHudVisible((v) => !v)}
                size="sm"
              />
            </div>

            {/* 🩺 Controls exclusius de l'Assistència Remota: estadístiques
                sota demanda i enviament d'un fitxer al Host. */}
            {appMode === "assist" && hudVisible && chatOpen && (
              <ChatPanel
                className="absolute bottom-16 left-3 z-30 w-64"
                messages={chatMessages}
                input={chatInput}
                onInput={setChatInput}
                onSend={handleSendChat}
              />
            )}

            {appMode === "assist" && hudVisible && (
              <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-end gap-2 z-20">
                <IconButton
                  icon="🩺"
                  iconName="diagnostics"
                  title="Actualitza estadístiques del Host"
                  onClick={handleRequestDiag}
                  disabled={diagLoading}
                  active={diagLoading}
                  accent="cyan"
                />
                <IconButton icon="💬" iconName="chat" title="Xat amb el Host" onClick={() => setChatOpen((o) => !o)} active={chatOpen} accent="cyan" />
                <label title="Tria un arxiu per enviar al Host">
                  <span
                    className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200 backdrop-blur-md shadow-md cursor-pointer ${
                      fileToSend
                        ? "text-cyan-300 bg-cyan-500/20 border-cyan-400/40"
                        : "text-gray-300 bg-black/50 border-white/15 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    📁
                  </span>
                  <input type="file" className="hidden" onChange={(e) => setFileToSend(e.target.files?.[0] ?? null)} />
                </label>
                {fileToSend && (
                  <IconButton
                    icon={sendProgress !== null ? `${sendProgress}%` : "📤"}
                    iconName={sendProgress !== null ? undefined : "send-file"}
                    title={sendProgress !== null ? `Enviant... ${sendProgress}%` : `Enviar "${fileToSend.name}" al Host`}
                    onClick={handleSendFile}
                    disabled={sendProgress !== null}
                    active
                    accent="cyan"
                  />
                )}
                {sendError && (
                  <span className="text-[11px] text-red-300 bg-black/60 px-2 py-1 rounded-full self-center">
                    ❌ {sendError}
                  </span>
                )}
              </div>
            )}

            {hudVisible && (
              <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
                <IconButton icon="✖" iconName="disconnect" title="Desconnectar" onClick={handleDisconnect} accent="red" active />
                {appMode === "game" && (
                  <IconButton
                    icon={isMuted ? "🔇" : "🔊"}
                    iconName={isMuted ? "sound-off" : "sound-on"}
                    title={isMuted ? "Activar so" : "Silenciar"}
                    onClick={() => setIsMuted((m) => !m)}
                    active={!isMuted}
                  />
                )}
                {appMode === "game" && (
                  <IconButton
                    icon="🕹️"
                    iconName="gamepad"
                    title="Mando virtual"
                    onClick={() => setShowVirtualPad((v) => !v)}
                    active={showVirtualPad}
                  />
                )}
                {/* 🛡️ Ja NO diu sempre "Control actiu": ara reflecteix
                    l'estat real de `controlActive` (lligat a Pantalla
                    Completa), i es pot activar/desactivar a mà sense
                    necessitat de fullscreen (útil a iOS o en finestra). */}
                <IconButton
                  icon={controlActive ? "🎮" : "👁️"}
                  iconName={controlActive ? "control-on" : "control-off"}
                  title={
                    controlActive
                      ? "Control actiu — el teclat i el ratolí arriben al Host. Clica per desactivar."
                      : "Només visualitzant — cap clic/toc arriba al Host. Clica per activar el control."
                  }
                  onClick={() => setControlActive((c) => !c)}
                  active={controlActive}
                  accent="emerald"
                />
                {/* 🎤 Només controla l'ENVIAMENT del propi micròfon — sentir
                    l'altra banda ja funciona sol des que el canal s'obre. */}
                <IconButton
                  icon={micSending ? "🎤" : "🔇"}
                  iconName={micSending ? "mic-on" : "mic-off"}
                  title={
                    micError
                      ? `❌ ${micError}`
                      : micSending
                      ? "Micròfon actiu — clica per silenciar-te"
                      : "Micròfon apagat — clica per parlar"
                  }
                  onClick={toggleMic}
                  active={micSending}
                  accent={micError ? "red" : "cyan"}
                />
                <IconButton
                  icon={isFullscreen ? "🡼" : "📺"}
                  iconName={isFullscreen ? "fullscreen-exit" : "fullscreen-enter"}
                  title={isFullscreen ? "Sortir de pantalla completa" : "Pantalla completa"}
                  onClick={handleFullscreen}
                />
                <div className="ml-1">
                  <PingBadge rttMs={connectionStats.rttMs} packetsLost={connectionStats.packetsLost} />
                  <span
                    className="ml-2 text-[10px] font-mono text-gray-300 bg-black/50 rounded-full px-2 py-1"
                    title="Frames rebuts/s · frames pintats/s · pèrdues/s · keyframes demanats/s"
                  >
                    📥{videoStats.rxFps} 🖼️{videoStats.decFps} ⚠️{videoStats.losses} 🔑{videoStats.kfRequests}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ℹ️ Avís flotant: aquesta web és SEMPRE el costat Guest. */}
      {showHostNotice && phase !== "connected" && (
        <div
          role="status"
          className="fixed bottom-14 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md animate-fade-in-up lg:left-auto lg:right-6 lg:translate-x-0 lg:w-80"
        >
          <div className="relative bg-black/90 border border-cyan-400/40 chamfer-sm px-4 py-3 pr-10 backdrop-blur-md shadow-2xl shadow-cyan-500/10 text-left">
            <p className="text-cyan-300 text-[11px] font-semibold uppercase tracking-widest mb-1">
              ℹ️ Cal l'app d'escriptori a l'altra banda
            </p>
            {appMode === "transfer" ? (
              <p className="text-gray-300 text-xs leading-relaxed">
                <span className="text-white font-semibold">Transfer és l'excepció:</span> no necessita Host. Funciona
                entre dues webs, entre web i app d'escriptori, o entre dues apps — només cal que tots dos entreu amb la
                mateixa paraula.
              </p>
            ) : (
            <p className="text-gray-300 text-xs leading-relaxed">
              Aquesta web és només el costat <span className="text-white font-semibold">Guest</span>. Totes les eines
              (Jugar, Assistència i Trucada) es connecten sempre a un{" "}
              <span className="text-white font-semibold">Host d'escriptori</span> amb l'app LVCLITS oberta. No
              funcionen entre dues webs (excepte Transfer).
            </p>
            )}
            {appMode !== "assist" && appMode !== "transfer" && (
              <p className="text-gray-400 text-[11px] mt-1.5">
                {appMode === "call"
                  ? "A una trucada hi poden entrar fins a 8 persones amb el mateix codi, i tothom se sent amb tothom."
                  : "A una partida hi poden jugar fins a 4 persones amb el mateix codi. El jugador 1 controla teclat, ratolí i mando; la resta, només el seu mando."}
              </p>
            )}
            {appMode !== "transfer" && (
            <p className="text-gray-400 text-[11px] mt-1.5">
              Ara: l'altra persona ha d'obrir{" "}
              <span className="text-gray-200 font-semibold">
                «{appMode === "call" ? "Trucada Directa" : appMode === "assist" ? "Assistència Remota" : "Compartir Joc"}»
              </span>{" "}
              a l'app i donar-te el codi.
            </p>
            )}
            <button
              onClick={dismissHostNotice}
              title="Tanca l'avís"
              aria-label="Tanca l'avís"
              className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              ✖
            </button>
          </div>
        </div>
      )}

      <footer className="relative z-10 text-center pb-4">
        <p className="text-gray-500 text-[10px] tracking-widest uppercase">
          {appMode === "transfer"
            ? "LVCLITS Platform · Transfer (arxius sense límits, P2P)"
            : appMode === "call"
            ? "LVCLITS Platform · Trucada Directa (només veu)"
            : appMode === "assist"
            ? "LVCLITS Platform · Assistència Remota (teclat, ratolí, estadístiques i fitxers)"
            : "LVCLITS Platform · Joc remot (teclat, ratolí i comandament)"}
        </p>
      </footer>
    </div>
  );
}
