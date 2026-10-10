import { useCallback, useEffect, useRef, useState } from "react";
import { RoomVoice, initialVoiceState, type VoiceState } from "../lib/roomVoice";
import { normalizeCode, MIN_CODE_LENGTH } from "../lib/transferLink";

export const WEB_CALL_MAX = 6;

/** Trucada de veu entre navegadors (malla WebRTC, fins a 6 persones). */
export function useWebCall() {
  const ref = useRef<RoomVoice | null>(null);
  const [state, setState] = useState<VoiceState>(initialVoiceState);
  const [code, setCode] = useState("");
  const idRef = useRef(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

  /** Cal cridar-ho des d'un clic (permís del micròfon i àudio). */
  const join = useCallback(async (rawCode: string, nickname: string): Promise<string | null> => {
    const c = normalizeCode(rawCode);
    if (c.length < MIN_CODE_LENGTH) return `La paraula ha de tenir com a mínim ${MIN_CODE_LENGTH} caràcters.`;
    await ref.current?.leave();
    setCode(c);
    const v = new RoomVoice(`call-web:${c}`, idRef.current, nickname || "Convidat", setState, WEB_CALL_MAX);
    ref.current = v;
    await v.join();
    return null;
  }, []);

  const leave = useCallback(async () => {
    const v = ref.current;
    ref.current = null;
    await v?.leave();
    setState(initialVoiceState());
    setCode("");
  }, []);

  const toggleMute = useCallback(() => ref.current?.setMuted(!state.muted), [state.muted]);

  useEffect(
    () => () => {
      void ref.current?.leave();
      ref.current = null;
    },
    []
  );

  return { state, code, join, leave, toggleMute };
}
