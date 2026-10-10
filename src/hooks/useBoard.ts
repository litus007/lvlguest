import { useCallback, useEffect, useRef, useState } from "react";
import { BoardSession, initialBoardState, type BoardState } from "../lib/whiteboard";
import { normalizeCode, MIN_CODE_LENGTH } from "../lib/transferLink";

/** Pissarra compartida: una sessió = una paraula. Retorna també la sessió viva per al llenç. */
export function useBoard() {
  const ref = useRef<BoardSession | null>(null);
  const [state, setState] = useState<BoardState>(initialBoardState);
  const [session, setSession] = useState<BoardSession | null>(null);

  const join = useCallback(async (rawCode: string, nickname: string, lanOnly: boolean): Promise<string | null> => {
    const code = normalizeCode(rawCode);
    if (code.length < MIN_CODE_LENGTH) return `La paraula ha de tenir com a mínim ${MIN_CODE_LENGTH} caràcters.`;
    await ref.current?.leave();
    const s = new BoardSession(code, nickname || "Convidat", setState, { lanOnly });
    ref.current = s;
    setSession(s);
    setState({ ...initialBoardState(), code, phase: "connecting" });
    await s.start();
    return null;
  }, []);

  const leave = useCallback(async () => {
    const s = ref.current;
    ref.current = null;
    setSession(null);
    await s?.leave();
    setState(initialBoardState());
  }, []);

  useEffect(
    () => () => {
      void ref.current?.leave();
      ref.current = null;
    },
    []
  );

  return { state, session, join, leave };
}
