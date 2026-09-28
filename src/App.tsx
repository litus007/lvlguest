import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useGuestViewer } from "./hooks/useGuestViewer";
import { useInputCapture } from "./hooks/useInputCapture";
import Logo from "./components/common/Logo";
import CornerFrame from "./components/common/CornerFrame";
import PingBadge from "./components/common/PingBadge";
import VirtualGamepad from "./components/common/VirtualGamepad";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// 🔘 Botó rodó amb icona, sense text — la unitat visual de tot el HUD
// sobre el vídeo. `active` pinta l'accent de color quan l'estat és "on".
function IconButton({
  icon,
  title,
  onClick,
  active = false,
  disabled = false,
  accent = "orange",
  size = "md",
}: {
  icon: ReactNode;
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
      {icon}
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
        <IconButton icon="➤" title="Enviar missatge" onClick={onSend} size="sm" active accent="cyan" />
      </div>
    </div>
  );
}

export default function App() {
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [bgFailed, setBgFailed] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [gamepadName, setGamepadName] = useState<string | null>(null);
  const [lanOnly, setLanOnly] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVirtualPad, setShowVirtualPad] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  // 📁 Assistència Remota: fitxer a enviar al Host + progrés d'enviament.
  const [fileToSend, setFileToSend] = useState<File | null>(null);
  const [sendProgress, setSendProgress] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
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

  const { phase, connect, disconnect, sendInput, stats: connectionStats, videoStats, chatMessages, sendChat, diagSnapshot, requestDiagRefresh, sendFileToHost } = useGuestViewer({ canvasRef, audioMuted: isMuted, onLog: pushLog });

  // 🖱️🩺 Fix de seguretat + suport a l'Assistència Remota: el ratolí/tàctil
  // ara només s'enganxa al `<canvas>` (mai a la resta de la pàgina), i
  // només quan `controlActive` és cert — que per defecte és fals encara
  // que ja estiguis "connected". Passar a Pantalla Completa activa el
  // control automàticament; també es pot activar/desactivar a mà amb el
  // botó "🖱️ Control" per qui no vulgui/pugui fer servir pantalla completa.
  const [controlActive, setControlActive] = useState(false);
  const [appMode, setAppMode] = useState<"game" | "assist">("game");

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

  // En un dispositiu tàctil, mostrem el mando virtual automàticament un
  // cop connectats — es pot amagar amb el botó corresponent.
  useEffect(() => {
    if (phase === "connected" && isTouchDevice) {
      setShowVirtualPad(true);
    }
  }, [phase, isTouchDevice]);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const handleConnect = () => {
    if (!roomCodeInput.trim()) return;
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

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex flex-col">
      {/* Art de fons, la mateixa identitat "Compartir Joc" de l'app d'escriptori */}
      {!bgFailed ? (
        <img
          src="/panels/compartir-joc.jpg"
          alt=""
          onError={() => setBgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-orange-950 via-black to-black grid-bg-stream" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/85 to-black" />

      {/* Barra de sistema */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 animate-fade-in-up">
          <Logo size={28} />
          <span className="text-white font-extrabold text-sm tracking-[0.25em]">LVCLITS</span>
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
          {!installed && installEvent && (
            <button
              onClick={handleInstall}
              className="text-[11px] font-bold uppercase tracking-widest text-orange-200 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/30 rounded-full px-3.5 py-1.5 transition-colors duration-200"
            >
              ⬇ Instal·lar app
            </button>
          )}
          <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${appMode === "assist" ? "text-cyan-400" : "text-gray-400"}`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${appMode === "assist" ? "bg-cyan-400" : "bg-orange-400"}`} />
            {appMode === "assist" ? "Sistema 03 · Assistència" : "Sistema 02 · Streaming"}
          </div>
        </div>
      </div>

      {phase !== "connected" ? (
        <div className="relative z-10 flex-1 flex items-center justify-center px-6">
          <div className="max-w-md w-full animate-fade-in-up">
            {/* 🆕 Selector d'eina: "Jugar" (mode existent) vs "Assistència
                Remota" (tècnica: control + estadístiques + fitxers, sense
                comandament). Bloquejat mentre s'intenta connectar. */}
            <div className="flex mb-6 chamfer-sm border border-white/10 overflow-hidden">
              <button
                onClick={() => setAppMode("game")}
                disabled={phase === "searching" || phase === "negotiating"}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50 ${
                  appMode === "game" ? "bg-orange-500 text-black" : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                🎮 Jugar
              </button>
              <button
                onClick={() => setAppMode("assist")}
                disabled={phase === "searching" || phase === "negotiating"}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50 ${
                  appMode === "assist" ? "bg-cyan-500 text-black" : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                🩺 Assistència Remota
              </button>
            </div>

            <div className="text-center mb-8">
              <span className={`text-xs uppercase tracking-widest font-semibold ${appMode === "assist" ? "text-cyan-300/80" : "text-orange-300/80"}`}>
                {appMode === "assist" ? "🩺 Suport tècnic" : "🎮 Joc remot"}
              </span>
              <h1 className="text-4xl font-extrabold text-white tracking-tight mt-2">
                {appMode === "assist" ? (
                  <>
                    Assistència{" "}
                    <span className="text-cyan-400 drop-shadow-[0_0_20px_rgba(34,211,238,0.4)]">remota</span>
                  </>
                ) : (
                  <>
                    Jugar en{" "}
                    <span className="text-orange-400 drop-shadow-[0_0_20px_rgba(251,146,60,0.4)]">remot</span>
                  </>
                )}
              </h1>
              <p className="text-gray-400 text-sm mt-2">
                {appMode === "assist"
                  ? "Introdueix el codi de sessió que et doni qui necessita ajuda. Un cop connectat, podràs veure la seva pantalla, controlar el teclat i el ratolí, consultar l'estat del seu PC i enviar-li arxius."
                  : "Introdueix el codi de sala. Un cop connectat, el teclat, el ratolí i el comandament controlaran el joc del Host."}
              </p>
            </div>

            <div className="relative animate-scale-in space-y-4 bg-white/5 border border-white/10 p-6 chamfer backdrop-blur-md shadow-xl">
              <CornerFrame color={appMode === "assist" ? "cyan" : "orange"} />
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="EX: PARTIDA-RETRO"
                maxLength={20}
                disabled={phase === "searching" || phase === "negotiating"}
                className={`w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none transition-all disabled:opacity-50 ${
                  appMode === "assist" ? "focus:border-cyan-400/60" : "focus:border-orange-400/60"
                }`}
              />

              <button
                onClick={phase === "searching" || phase === "negotiating" ? disconnect : handleConnect}
                disabled={phase !== "searching" && phase !== "negotiating" && !roomCodeInput.trim()}
                className={`w-full font-bold py-3 chamfer-sm transition-all duration-300 hover:scale-[1.01] shadow-lg ${
                  phase === "searching" || phase === "negotiating"
                    ? "bg-red-500/80 hover:bg-red-500 text-white shadow-red-500/20"
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
                    No s'ha pogut connectar. Comprova el codi i que l'altra persona encara estigui compartint.
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
      ) : (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
          <div
            ref={containerRef}
            className="relative chamfer overflow-hidden border border-white/10 bg-black w-full aspect-video shadow-2xl max-w-6xl animate-scale-in"
          >
            <canvas ref={canvasRef} className="w-full h-full object-contain block" />
            <CornerFrame color={appMode === "assist" ? "cyan" : "orange"} />

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
                {((diagSnapshot as any).warnings ?? []).map((w: string, i: number) => (
                  <p key={i} className="text-red-300">{w}</p>
                ))}
              </div>
            )}

            {showVirtualPad && appMode === "game" && <VirtualGamepad onInput={sendInput} />}

            {/* 👁️ Interruptor del HUD: SEMPRE visible (fins i tot amb el
                HUD amagat) perquè mai es quedi "atrapat" sense botons. */}
            <div className="absolute top-3 right-3 z-30">
              <IconButton
                icon={hudVisible ? "⬍" : "👁️"}
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
                  title="Actualitza estadístiques del Host"
                  onClick={handleRequestDiag}
                  disabled={diagLoading}
                  active={diagLoading}
                  accent="cyan"
                />
                <IconButton icon="💬" title="Xat amb el Host" onClick={() => setChatOpen((o) => !o)} active={chatOpen} accent="cyan" />
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
                <IconButton icon="✖" title="Desconnectar" onClick={handleDisconnect} accent="red" active />
                {appMode === "game" && (
                  <IconButton
                    icon={isMuted ? "🔇" : "🔊"}
                    title={isMuted ? "Activar so" : "Silenciar"}
                    onClick={() => setIsMuted((m) => !m)}
                    active={!isMuted}
                  />
                )}
                {appMode === "game" && isTouchDevice && (
                  <IconButton
                    icon="🕹️"
                    title="Mando tàctil"
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
                  title={
                    controlActive
                      ? "Control actiu — el teclat i el ratolí arriben al Host. Clica per desactivar."
                      : "Només visualitzant — cap clic/toc arriba al Host. Clica per activar el control."
                  }
                  onClick={() => setControlActive((c) => !c)}
                  active={controlActive}
                  accent="emerald"
                />
                <IconButton
                  icon={isFullscreen ? "🡼" : "📺"}
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

      <footer className="relative z-10 text-center pb-4">
        <p className="text-gray-500 text-[10px] tracking-widest uppercase">
          {appMode === "assist"
            ? "LVCLITS Platform · Assistència Remota (teclat, ratolí, estadístiques i fitxers)"
            : "LVCLITS Platform · Joc remot (teclat, ratolí i comandament)"}
        </p>
      </footer>
    </div>
  );
}
