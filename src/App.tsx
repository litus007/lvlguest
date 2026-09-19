import { useCallback, useEffect, useRef, useState } from "react";
import { useGuestViewer } from "./hooks/useGuestViewer";
import Logo from "./components/common/Logo";
import CornerFrame from "./components/common/CornerFrame";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pushLog = useCallback((message: string) => {
    setLog((prev) => [...prev.slice(-40), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const { phase, connect, disconnect } = useGuestViewer({ canvasRef, onLog: pushLog });

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

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const handleConnect = () => {
    if (!roomCodeInput.trim()) return;
    connect(roomCodeInput);
  };

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setRoomCodeInput("");
  };

  return (
    <div className="min-h-screen bg-[#0d0a1f] relative overflow-hidden flex flex-col">
      {/* Art de fons, la mateixa identitat "Compartir Joc" de l'app d'escriptori */}
      {!bgFailed ? (
        <img
          src="/panels/compartir-joc.jpg"
          alt=""
          onError={() => setBgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950 via-[#1a1030] to-[#0d0a1f]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0d0a1f]/70 via-[#0d0a1f]/85 to-[#0d0a1f]" />

      {/* Barra de sistema */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5 animate-fade-in-up">
          <Logo size={28} />
          <span className="text-white font-extrabold text-sm tracking-[0.25em]">LVCLITS</span>
        </div>
        <div className="flex items-center gap-3 animate-fade-in-up">
          {!installed && installEvent && (
            <button
              onClick={handleInstall}
              className="text-[11px] font-bold uppercase tracking-widest text-violet-200 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30 rounded-full px-3.5 py-1.5 transition-colors duration-200"
            >
              ⬇ Instal·lar app
            </button>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Sistema 02 · Streaming
          </div>
        </div>
      </div>

      {phase !== "connected" ? (
        <div className="relative z-10 flex-1 flex items-center justify-center px-6">
          <div className="max-w-md w-full animate-fade-in-up">
            <div className="text-center mb-8">
              <span className="text-violet-300/80 text-xs uppercase tracking-widest font-semibold">
                📡 Visor remot
              </span>
              <h1 className="text-4xl font-extrabold text-white tracking-tight mt-2">
                Rebre{" "}
                <span className="bg-gradient-to-r from-violet-400 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(167,139,250,0.3)]">
                  pantalla
                </span>
              </h1>
              <p className="text-gray-400 text-sm mt-2">
                Introdueix el codi de sala que et doni la persona que comparteix el joc.
              </p>
            </div>

            <div className="relative animate-scale-in space-y-4 bg-white/5 border border-white/10 p-6 rounded-2xl backdrop-blur-md shadow-xl">
              <CornerFrame color="violet" />
              <input
                type="text"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="EX: PARTIDA-RETRO"
                maxLength={20}
                disabled={phase === "searching" || phase === "negotiating"}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-violet-400/60 transition-all disabled:opacity-50"
              />

              <button
                onClick={handleConnect}
                disabled={!roomCodeInput.trim() || phase === "searching" || phase === "negotiating"}
                className="w-full bg-gradient-to-r from-violet-500 to-amber-500 hover:from-violet-400 hover:to-amber-400 disabled:opacity-40 disabled:pointer-events-none text-black font-bold py-3 rounded-xl transition-all duration-300 hover:scale-[1.01] shadow-lg shadow-violet-500/10"
              >
                {phase === "searching"
                  ? "Cercant la sala..."
                  : phase === "negotiating"
                  ? "Connectant..."
                  : "Connectar →"}
              </button>

              {(phase === "searching" || phase === "negotiating") && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <div className="w-4 h-4 border-2 border-white/10 border-t-violet-400 rounded-full animate-spin" />
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
                    className="px-6 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    Tornar a intentar
                  </button>
                </div>
              )}
            </div>

            {log.length > 0 && (
              <div className="animate-fade-in-up mt-6 bg-black/50 border border-white/10 rounded-xl p-4 backdrop-blur-md">
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
            className="relative rounded-2xl overflow-hidden border border-white/10 bg-black w-full aspect-video shadow-2xl max-w-6xl animate-scale-in"
          >
            <canvas ref={canvasRef} className="w-full h-full object-contain block" />
            <CornerFrame color="violet" />

            <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center bg-black/70 backdrop-blur-md p-2.5 rounded-xl opacity-0 hover:opacity-100 transition-opacity duration-200 border border-white/5">
              <button
                onClick={handleDisconnect}
                className="text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors duration-200"
              >
                Desconnectar
              </button>
              <button
                onClick={handleFullscreen}
                className="text-xs text-white bg-violet-600 hover:bg-violet-500 font-bold px-4 py-1.5 rounded-lg transition-colors duration-200 shadow-md shadow-violet-600/20"
              >
                📺 Pantalla Completa
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="relative z-10 text-center pb-4">
        <p className="text-gray-500 text-[10px] tracking-widest uppercase">
          LVCLITS Platform · Visor remot (només recepció, sense control)
        </p>
      </footer>
    </div>
  );
}
