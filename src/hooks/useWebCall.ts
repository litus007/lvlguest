import { useCallback, useEffect, useRef, useState } from "react";
import { RoomVoice, initialVoiceState, type VoiceSettings, type VoiceState } from "../lib/roomVoice";
import { normalizeCode, MIN_CODE_LENGTH } from "../lib/transferLink";

export const WEB_CALL_MAX = 6;

export interface CallActions {
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  updateSettings: (p: Partial<VoiceSettings>) => void;
  setMemberVolume: (id: string, v: number) => void;
  setMemberLocalMuted: (id: string, m: boolean) => void;
  hostMute: (id: string, on: boolean) => void;
  hostMuteAll: (on: boolean) => void;
  hostKick: (id: string) => void;
}

/** Trucada entre dispositius (malla WebRTC, fins a 6 persones): veu, càmera opcional i moderació. */
export function useWebCall() {
  const ref = useRef<RoomVoice | null>(null);
  const [state, setState] = useState<VoiceState>(initialVoiceState);
  const [code, setCode] = useState("");
  const idRef = useRef(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const actions: CallActions = {
    toggleMute: useCallback(() => ref.current?.setMuted(!stateRef.current.muted), []),
    toggleDeafen: useCallback(() => ref.current?.setDeafened(!stateRef.current.deafened), []),
    toggleCamera: useCallback(() => void ref.current?.setCamera(!stateRef.current.camera), []),
    updateSettings: useCallback((p: Partial<VoiceSettings>) => void ref.current?.updateSettings(p), []),
    setMemberVolume: useCallback((id: string, v: number) => ref.current?.setMemberVolume(id, v), []),
    setMemberLocalMuted: useCallback((id: string, m: boolean) => ref.current?.setMemberLocalMuted(id, m), []),
    hostMute: useCallback((id: string, on: boolean) => ref.current?.hostMute(id, on), []),
    hostMuteAll: useCallback((on: boolean) => ref.current?.hostMuteAll(on), []),
    hostKick: useCallback((id: string) => ref.current?.hostKick(id), []),
  };
  const toggleMute = actions.toggleMute;

  useEffect(
    () => () => {
      void ref.current?.leave();
      ref.current = null;
    },
    []
  );

  return { state, code, join, leave, toggleMute, actions };
}
