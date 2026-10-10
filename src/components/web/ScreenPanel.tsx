import { useEffect, useRef, useState } from "react";
import { useScreenShare } from "../../hooks/useScreenShare";
import { supportsScreenCapture, type ContentHint } from "../../lib/screenShare";
import CornerFrame from "../common/CornerFrame";

/** 🖥️ Pantalla entre navegadors: compartir o mirar amb una paraula. */
export default function ScreenPanel({ onBusyChange, onActiveChange }: { onBusyChange?: (busy: boolean) => void; onActiveChange?: (active: boolean) => void }) {
  const { state, start, stop } = useScreenShare();
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<ContentHint>("detail");
  const [lanOnly, setLanOnly] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canShare = supportsScreenCapture();

  const idle = state.phase === "idle" || state.phase === "failed" || state.phase === "ended";
  useEffect(() => onBusyChange?.(!idle), [idle, onBusyChange]);
  const flowing = state.phase === "live" || (state.role === "share" && state.viewers > 0);
  useEffect(() => onActiveChange?.(flowing), [flowing, onActiveChange]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = state.stream;
  }, [state.stream, state.phase]);

  const go = async (role: "share" | "watch") => {
    setFormError(null);
    // Atenció: s'ha de cridar directament des del clic (captura de pantalla).
    const err = await start(code, role, "Convidat", hint, lanOnly);
    if (err) setFormError(err);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sense permís de porta-retalls */
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-4">
      {idle && (
        <div className="panel chamfer relative p-6 space-y-4 animate-scale-in">
          <CornerFrame color="rose" />
          {state.phase === "ended" && <p className="text-sm text-gray-300 text-center">Has deixat de compartir.</p>}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="EX: REUNIO-12"
            maxLength={20}
            aria-label="Paraula de la sala"
            className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-rose-400/60"
          />

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => void go("share")}
              disabled={!code.trim() || !canShare}
              className="chamfer-sm py-3 font-bold bg-rose-500 hover:bg-rose-400 text-black disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Compartir
            </button>
            <button
              onClick={() => void go("watch")}
              disabled={!code.trim()}
              className="chamfer-sm py-3 font-bold bg-white/10 hover:bg-white/15 text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Mirar
            </button>
          </div>
          {!canShare && <p className="text-[11px] text-amber-300/90">Aquest navegador no pot compartir pantalla (als mòbils només es pot mirar). Sí que pots mirar.</p>}

          {canShare && (
            <div role="radiogroup" aria-label="Optimitza per" className="flex text-xs chamfer-sm overflow-hidden border border-white/10">
              {([["detail", "Text i presentacions"], ["motion", "Vídeo i jocs"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={hint === v}
                  onClick={() => setHint(v)}
                  className={`flex-1 py-2 transition-colors ${hint === v ? "bg-rose-500/25 text-rose-100" : "text-gray-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" className="accent-rose-500" checked={lanOnly} onChange={(e) => setLanOnly(e.target.checked)} />
            Només xarxa local (sense STUN/TURN)
          </label>
          {(formError || state.error) && (
            <p role="alert" className="text-red-300 text-sm text-center">
              {formError ?? state.error}
            </p>
          )}
        </div>
      )}

      {state.phase === "waiting" && !(state.role === "share" && state.viewers > 0) && (
        <div className="panel chamfer relative p-6 text-center space-y-3">
          <CornerFrame color="rose" />
          <div className="w-12 h-12 mx-auto border-4 border-white/10 border-t-rose-400 rounded-full animate-spin" />
          <p className="text-gray-200 text-sm">
            {state.role === "share" ? "Pantalla capturada. Esperant que algú miri amb aquesta paraula…" : "Esperant que algú comparteixi la pantalla…"}
          </p>
          <button onClick={copy} className="font-mono tracking-widest text-lg text-rose-300 hover:text-rose-200" title="Copia la paraula">
            {state.code} {copied ? "✔" : "⧉"}
          </button>
          <div>
            <button onClick={() => void stop()} className="text-xs text-gray-500 hover:text-red-300 underline">
              {state.role === "share" ? "Deixa de compartir" : "Cancel·la"}
            </button>
          </div>
        </div>
      )}

      {state.role === "share" && state.phase === "waiting" && state.viewers > 0 && (
        <div className="panel chamfer p-5 space-y-3 border-emerald-400/30">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-emerald-300">
              ● Compartint · {state.viewers} {state.viewers === 1 ? "espectador" : "espectadors"}
            </p>
            <span className="text-xs text-gray-400">{state.hasAudio ? "Amb àudio" : "Sense àudio"}</span>
          </div>
          <button onClick={copy} className="font-mono tracking-widest text-rose-300 hover:text-rose-200 text-sm" title="Copia la paraula">
            {state.code} {copied ? "✔" : "⧉"}
          </button>
          <button onClick={() => void stop()} className="w-full chamfer-sm py-2.5 text-sm font-semibold bg-red-500/80 hover:bg-red-500 text-white transition-colors">
            Deixa de compartir
          </button>
        </div>
      )}

      {state.role === "watch" && state.phase === "live" && (
        <div className="space-y-3">
          <div className="relative bg-black chamfer overflow-hidden border border-rose-400/30">
            <video ref={videoRef} autoPlay playsInline muted={muted} className="w-full aspect-video object-contain bg-black" />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-rose-300">● En directe · {state.code}</span>
            <div className="flex gap-2">
              {state.hasAudio && (
                <button onClick={() => setMuted((m) => !m)} aria-pressed={muted} className="chamfer-sm px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white">
                  {muted ? "Activa el so" : "Silencia"}
                </button>
              )}
              <button onClick={() => void videoRef.current?.requestFullscreen?.()} className="chamfer-sm px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white">
                Pantalla completa
              </button>
              <button onClick={() => void stop()} className="chamfer-sm px-3 py-1.5 text-gray-300 hover:text-white hover:bg-white/10">
                Sortir
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
