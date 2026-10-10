import { useCallback, useEffect, useRef, useState } from "react";
import { ScreenSession, initialScreenState, type ContentHint, type ScreenRole, type ScreenState } from "../lib/screenShare";
import { normalizeCode, MIN_CODE_LENGTH } from "../lib/transferLink";

/** Pantalla entre navegadors: una sessió = una paraula = un qui comparteix + espectadors. */
export function useScreenShare() {
  const ref = useRef<ScreenSession | null>(null);
  const [state, setState] = useState<ScreenState>(initialScreenState);

  /** Cal cridar-ho DES D'UN CLIC (captura de pantalla). Retorna un error de formulari o null. */
  const start = useCallback(async (rawCode: string, role: ScreenRole, nickname: string, hint: ContentHint, lanOnly: boolean): Promise<string | null> => {
    const code = normalizeCode(rawCode);
    if (code.length < MIN_CODE_LENGTH) return `La paraula ha de tenir com a mínim ${MIN_CODE_LENGTH} caràcters.`;
    await ref.current?.stop();
    const session = new ScreenSession(code, role, nickname, setState, { hint, lanOnly });
    ref.current = session;
    setState({ ...initialScreenState(), code, role, phase: "waiting" });
    await session.start();
    return null;
  }, []);

  const stop = useCallback(async () => {
    const s = ref.current;
    ref.current = null;
    await s?.stop();
    setState(initialScreenState());
  }, []);

  useEffect(
    () => () => {
      void ref.current?.stop();
      ref.current = null;
    },
    []
  );

  return { state, start, stop };
}
