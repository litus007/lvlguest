import { useEffect, useState } from "react";
import { useWebCall, WEB_CALL_MAX } from "../../hooks/useWebCall";
import CornerFrame from "../common/CornerFrame";

const Mic = ({ muted }: { muted: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    {muted && <path d="M4 4l16 16" />}
  </svg>
);

/** 📞 Trucada de veu entre navegadors (sense app ni Host), fins a 6 persones. */
export interface WebCallSummary {
  joined: boolean;
  code: string;
  people: number;
  muted: boolean;
}

export default function WebCallPanel({
  onBusyChange,
  onSummary,
  leaveRef,
  muteRef,
}: {
  onBusyChange?: (busy: boolean) => void;
  /** Resum de la trucada (per al mini-panell de l'app d'escriptori). */
  onSummary?: (s: WebCallSummary) => void;
  leaveRef?: { current: (() => void) | null };
  muteRef?: { current: (() => void) | null };
}) {
  const { state, code, join, leave, toggleMute } = useWebCall();
  const [codeInput, setCodeInput] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => onBusyChange?.(state.joined), [state.joined, onBusyChange]);
  useEffect(() => {
    onSummary?.({ joined: state.joined, code, people: state.members.length + 1, muted: state.muted });
  }, [state.joined, code, state.members.length, state.muted, onSummary]);
  useEffect(() => {
    if (leaveRef) leaveRef.current = () => void leave();
    if (muteRef) muteRef.current = toggleMute;
    return () => {
      if (leaveRef) leaveRef.current = null;
      if (muteRef) muteRef.current = null;
    };
  }, [leaveRef, muteRef, leave, toggleMute]);

  const go = async () => {
    setFormError(null);
    const err = await join(codeInput, name.trim().slice(0, 20));
    if (err) setFormError(err);
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {!state.joined ? (
        <div className="panel chamfer relative p-6 space-y-4 animate-scale-in">
          <CornerFrame color="emerald" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="El teu nom (opcional)"
            maxLength={20}
            aria-label="El teu nom"
            className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-emerald-400/60"
          />
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && codeInput.trim() && void go()}
            placeholder="EX: TERTULIA-5"
            maxLength={20}
            aria-label="Paraula de la trucada"
            className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-emerald-400/60"
          />
          <button
            onClick={() => void go()}
            disabled={!codeInput.trim()}
            className="w-full chamfer-sm py-3 font-bold bg-emerald-500 hover:bg-emerald-400 text-black disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Entrar a la trucada →
          </button>
          <p className="text-[11px] text-gray-500 text-center">Fins a {WEB_CALL_MAX} persones amb la mateixa paraula. Fes servir auriculars per evitar l'eco.</p>
          {(formError || state.error) && (
            <p role="alert" className="text-red-300 text-sm text-center">
              {formError ?? state.error}
            </p>
          )}
        </div>
      ) : (
        <div className="panel chamfer relative p-5 space-y-4">
          <CornerFrame color="emerald" />
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(code).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="text-emerald-300 text-sm font-mono tracking-widest hover:text-emerald-200"
              title="Copia la paraula"
            >
              ● {code} {copied ? "✔" : "⧉"}
            </button>
            <span className="text-xs text-gray-400">{state.members.length + 1} / {WEB_CALL_MAX}</span>
          </div>

          <ul className="space-y-2">
            <li className="flex items-center justify-between chamfer-sm bg-white/[0.05] px-4 py-2.5 text-sm text-white">
              <span>Tu</span>
              <span className={state.muted ? "text-gray-500" : "text-emerald-300"}>
                <Mic muted={state.muted} />
              </span>
            </li>
            {state.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between chamfer-sm bg-white/[0.05] px-4 py-2.5 text-sm text-white">
                <span className="truncate">{m.nickname}</span>
                <span className={m.muted ? "text-gray-500" : m.connected ? "text-emerald-300" : "text-amber-300 animate-pulse"} title={m.connected ? "Connectat" : "Connectant…"}>
                  <Mic muted={m.muted} />
                </span>
              </li>
            ))}
            {state.members.length === 0 && <li className="text-center text-xs text-gray-500 py-2">Esperant que algú entri amb aquesta paraula…</li>}
          </ul>

          <div className="flex gap-2">
            <button
              onClick={toggleMute}
              aria-pressed={state.muted}
              className={`flex-1 chamfer-sm py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                state.muted ? "bg-red-500/20 text-red-200 hover:bg-red-500/30" : "bg-white/10 text-white hover:bg-white/15"
              }`}
            >
              <Mic muted={state.muted} />
              {state.muted ? "Silenciat" : "Micro obert"}
            </button>
            <button onClick={() => void leave()} className="chamfer-sm px-4 py-2.5 text-sm font-semibold bg-red-500/80 hover:bg-red-500 text-white transition-colors">
              Penjar
            </button>
          </div>
          {state.error && (
            <p role="alert" className="text-red-300 text-xs text-center">
              {state.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
