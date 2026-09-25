import { useCallback, useEffect, useRef, useState } from "react";
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
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pushLog = useCallback((message: string) => {
    setLog((prev) => [...prev.slice(-40), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const { phase, connect, disconnect, sendInput, stats: connectionStats, diagSnapshot } = useGuestViewer({ canvasRef, audioMuted: isMuted, onLog: pushLog });

  // Envia teclat, ratolí i comandament al Host pel canal "inputs" — el
  // mateix protocol i el mateix hook (100% API de navegador) que fa
  // servir l'app d'escriptori. Només actiu un cop connectats.
  useInputCapture({
    enabled: phase === "connected",
    onInput: sendInput,
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
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
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
    connect(roomCodeInput, lanOnly);
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
  };

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
          {!installed && installEvent && (
            <button
              onClick={handleInstall}
              className="text-[11px] font-bold uppercase tracking-widest text-orange-200 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/30 rounded-full px-3.5 py-1.5 transition-colors duration-200"
            >
              ⬇ Instal·lar app
            </button>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            Sistema 02 · Streaming
          </div>
        </div>
      </div>

      {phase !== "connected" ? (
        <div className="relative z-10 flex-1 flex items-center justify-center px-6">
          <div className="max-w-md w-full animate-fade-in-up">
            <div className="text-center mb-8">
              <span className="text-orange-300/80 text-xs uppercase tracking-widest font-semibold">
                🎮 Joc remot
              </span>
              <h1 className="text-4xl font-extrabold text-white tracking-tight mt-2">
                Jugar en{" "}
                <span className="text-orange-400 drop-shadow-[0_0_20px_rgba(251,146,60,0.4)]">
                  remot
                </span>
              </h1>
              <p className="text-gray-400 text-sm mt-2">
                Introdueix el codi de sala. Un cop connectat, el teclat, el ratolí i el comandament
                controlaran el joc del Host.
              </p>
            </div>

            <div className="relative animate-scale-in space-y-4 bg-white/5 border border-white/10 p-6 chamfer backdrop-blur-md shadow-xl">
              <CornerFrame color="orange" />
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="EX: PARTIDA-RETRO"
                maxLength={20}
                disabled={phase === "searching" || phase === "negotiating"}
                className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-orange-400/60 transition-all disabled:opacity-50"
              />

              <button
                onClick={handleConnect}
                disabled={!roomCodeInput.trim() || phase === "searching" || phase === "negotiating"}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-40 disabled:pointer-events-none text-black font-bold py-3 chamfer-sm transition-all duration-300 hover:scale-[1.01] shadow-lg shadow-orange-500/20"
              >
                {phase === "searching"
                  ? "Cercant la sala..."
                  : phase === "negotiating"
                  ? "Connectant..."
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
            <CornerFrame color="orange" />

            {diagSnapshot && (
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

            {showVirtualPad && <VirtualGamepad onInput={sendInput} />}

            <div className="absolute top-3 left-3 right-3 flex justify-between items-center bg-black/70 backdrop-blur-md p-2.5 chamfer-sm opacity-80 hover:opacity-100 transition-opacity duration-200 border border-white/5">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDisconnect}
                  className="text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 chamfer-sm bg-red-500/10 hover:bg-red-500/20 transition-colors duration-200"
                >
                  Desconnectar
                </button>
                <button
                  onClick={() => setIsMuted((m) => !m)}
                  className="text-xs text-orange-300 font-semibold px-3 py-1.5 chamfer-sm bg-white/5 hover:bg-white/10 transition-colors duration-200"
                >
                  {isMuted ? "🔇 Activar So" : "🔊 Silenciar"}
                </button>
                {isTouchDevice && (
                  <button
                    onClick={() => setShowVirtualPad((v) => !v)}
                    className={`text-xs font-semibold px-3 py-1.5 chamfer-sm transition-colors duration-200 ${
                      showVirtualPad ? "text-orange-200 bg-orange-500/20" : "text-gray-300 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    🕹️ Mando tàctil
                  </button>
                )}
                <span className="text-[10px] text-emerald-300/80 uppercase tracking-widest hidden sm:inline">
                  🎮 Control actiu
                </span>
              </div>
              <div className="flex items-center gap-2">
                <PingBadge rttMs={connectionStats.rttMs} packetsLost={connectionStats.packetsLost} />
                <button
                  onClick={handleFullscreen}
                  className="text-xs text-white bg-orange-600 hover:bg-orange-500 font-bold px-4 py-1.5 chamfer-sm transition-colors duration-200 shadow-md shadow-orange-600/20 whitespace-nowrap"
                >
                  {isFullscreen ? "🡼 Sortir" : "📺 Pantalla Completa"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="relative z-10 text-center pb-4">
        <p className="text-gray-500 text-[10px] tracking-widest uppercase">
          LVCLITS Platform · Joc remot (teclat, ratolí i comandament)
        </p>
      </footer>
    </div>
  );
}
