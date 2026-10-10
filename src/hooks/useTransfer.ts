import { useCallback, useEffect, useRef, useState } from "react";
import {
  TransferSession,
  initialTransferState,
  normalizeCode,
  MIN_CODE_LENGTH,
  type TransferState,
} from "../lib/transferLink";

/**
 * Hook de l'eina Transfer. Idèntic a web-guest i a l'app d'escriptori.
 * Una sessió = una paraula = una sala de 2 persones.
 */
export function useTransfer() {
  const sessionRef = useRef<TransferSession | null>(null);
  const [state, setState] = useState<TransferState>(initialTransferState);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const join = useCallback(
    async (rawCode: string, lanOnly: boolean): Promise<string | null> => {
      const code = normalizeCode(rawCode);
      if (code.length < MIN_CODE_LENGTH) return `La paraula ha de tenir com a mínim ${MIN_CODE_LENGTH} caràcters.`;
      await sessionRef.current?.leave();
      const session = new TransferSession(code, lanOnly, setState, pushLog);
      sessionRef.current = session;
      setState({ ...initialTransferState(), code, phase: "waiting" });
      await session.start();
      return null;
    },
    [pushLog]
  );

  const leave = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    await s?.leave();
    setState(initialTransferState());
  }, []);

  useEffect(() => {
    return () => {
      void sessionRef.current?.leave();
      sessionRef.current = null;
    };
  }, []);

  return {
    state,
    log,
    join,
    leave,
    sendText: useCallback((text: string) => sessionRef.current?.sendText(text), []),
    sendFiles: useCallback((files: File[]) => sessionRef.current?.sendFiles(files), []),
    accept: useCallback((id: string) => void sessionRef.current?.acceptIncoming(id), []),
    reject: useCallback((id: string) => sessionRef.current?.rejectIncoming(id), []),
    cancel: useCallback((id: string) => sessionRef.current?.cancel(id), []),
    chooseFolder: useCallback(() => void sessionRef.current?.chooseFolder(), []),
    clearFolder: useCallback(() => sessionRef.current?.clearFolder(), []),
  };
}
