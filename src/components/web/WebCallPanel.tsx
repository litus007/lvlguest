import { useEffect, useState } from "react";
import { useWebCall, WEB_CALL_MAX } from "../../hooks/useWebCall";
import CornerFrame from "../common/CornerFrame";
import CallRoom from "./CallRoom";

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
  const { state, code, join, leave, toggleMute, actions } = useWebCall();
  const [codeInput, setCodeInput] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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
        <CallRoom state={state} code={code} actions={actions} onLeave={() => void leave()} max={WEB_CALL_MAX} />
      )}
    </div>
  );
}
