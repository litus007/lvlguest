import { useEffect, useRef } from "react";
import { InputMessage } from "../types/inputProtocol";

interface UseInputCaptureOptions {
  enabled: boolean;
  onInput: (msg: InputMessage) => void;
  // 🛡️ FIX DE SEGURETAT (setembre 2026): abans, el ratolí i el tàctil
  // s'enganxaven a `window` sencer. Això volia dir que QUALSEVOL clic o
  // toc a la pàgina —encara que no estiguessis en mode de control, encara
  // que fos sobre el botó de "Silenciar" o sobre el registre— es
  // reenviava al Host i s'executava allà. En mòbil, a més, un simple tap
  // dispara també un `mousedown`/`mouseup` sintètic del navegador, així
  // que "només mirar" la pantalla petita ja movia i clicava al PC real
  // —d'aquí que s'obrissin programes sols. Ara el ratolí/tàctil només
  // s'enganxa a `targetRef` (normalment el propi `<canvas>` del vídeo),
  // mai a la resta de la interfície. El teclat es manté sempre a
  // `window` (no té "element objectiu" natural i un `<canvas>` no rep
  // esdeveniments de teclat sense `tabindex`).
  targetRef?: React.RefObject<HTMLElement | null>;
  // 🎯 "absolute": el punt tocat/clicat sobre la imatge es tradueix a la
  // mateixa posició al Host (ideal per assistència i mòbil). "relative":
  // deltes acumulats, necessari per a jocs amb càmera (FPS).
  mouseMode?: "absolute" | "relative";
}

/**
 * Captura inputs de teclat, ratolí, tàctil i comandament, i els entrega al
 * callback `onInput` perquè s'enviïn pel DataChannel. Només actiu quan
 * `enabled` és cert — i, per a ratolí/tàctil, només dins de `targetRef`
 * (mai a la resta de botons/controls de la pàgina).
 */
export function useInputCapture({ enabled, onInput, targetRef, mouseMode = "relative" }: UseInputCaptureOptions) {
  const onInputRef = useRef(onInput);
  useEffect(() => { onInputRef.current = onInput; }, [onInput]);

  const animFrameRef = useRef<number | null>(null);
  const prevGamepadRef = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;
    const target: HTMLElement = targetRef?.current ?? (document.body as unknown as HTMLElement);

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      onInputRef.current({ t: "kd", code: e.code });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      onInputRef.current({ t: "ku", code: e.code });
    };

    // Converteix coordenades de pantalla a posició normalitzada dins la
    // imatge REAL del vídeo (descomptant les barres negres d'`object-contain`).
    const toNormalized = (clientX: number, clientY: number) => {
      const rect = target.getBoundingClientRect();
      const cv = target as unknown as HTMLCanvasElement;
      const vw = cv.width || rect.width;
      const vh = cv.height || rect.height;
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const drawnW = vw * scale;
      const drawnH = vh * scale;
      const offX = (rect.width - drawnW) / 2;
      const offY = (rect.height - drawnH) / 2;
      const nx = (clientX - rect.left - offX) / drawnW;
      const ny = (clientY - rect.top - offY) / drawnH;
      return { nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)) };
    };
    const sendAbs = (clientX: number, clientY: number) => {
      const { nx, ny } = toNormalized(clientX, clientY);
      onInputRef.current({ t: "ma", nx, ny });
    };

    let lastX = 0, lastY = 0;
    const handleMouseMove = (e: MouseEvent) => {
      if (mouseMode === "absolute") { sendAbs(e.clientX, e.clientY); return; }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      onInputRef.current({ t: "mm", x: e.clientX, y: e.clientY, dx, dy });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (mouseMode === "absolute") sendAbs(e.clientX, e.clientY);
      onInputRef.current({ t: "mb", btn: e.button as 0 | 1 | 2, down: true });
    };

    const handleMouseUp = (e: MouseEvent) => {
      onInputRef.current({ t: "mb", btn: e.button as 0 | 1 | 2, down: false });
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onInputRef.current({ t: "mw", dy: e.deltaY });
    };

    // 📱 Tàctil real (abans no existia cap gestor propi): un dit avall
    // equival a botó esquerre avall, i el moviment es tradueix en els
    // mateixos deltes relatius `dx/dy` que fa servir el ratolí. Amb
    // `preventDefault()` evitem que el navegador generi A MÉS els
    // `mousedown`/`mousemove`/`mouseup` sintètics de compatibilitat
    // (que, si no, arribarien duplicats pels gestors de ratolí de dalt).
    let touchActive = false;
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      lastX = t.clientX;
      lastY = t.clientY;
      touchActive = true;
      if (mouseMode === "absolute") sendAbs(t.clientX, t.clientY);
      onInputRef.current({ t: "mb", btn: 0, down: true });
    };
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!touchActive) return;
      const t = e.touches[0];
      if (!t) return;
      if (mouseMode === "absolute") { sendAbs(t.clientX, t.clientY); return; }
      const dx = t.clientX - lastX;
      const dy = t.clientY - lastY;
      lastX = t.clientX;
      lastY = t.clientY;
      onInputRef.current({ t: "mm", x: t.clientX, y: t.clientY, dx, dy });
    };
    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (!touchActive) return;
      touchActive = false;
      onInputRef.current({ t: "mb", btn: 0, down: false });
    };

    // ⌨️ El teclat SEMPRE a `window` (únic listener, mai duplicat amb el
    // de `target`): no té sentit "escopar-lo" a un element concret.
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    // 🖱️📱 Ratolí i tàctil NOMÉS dins de `target` (el canvas del vídeo).
    target.addEventListener("mousemove", handleMouseMove as EventListener);
    target.addEventListener("mousedown", handleMouseDown as EventListener);
    target.addEventListener("mouseup", handleMouseUp as EventListener);
    target.addEventListener("wheel", handleWheel as EventListener, { passive: false });
    target.addEventListener("touchstart", handleTouchStart as EventListener, { passive: false });
    target.addEventListener("touchmove", handleTouchMove as EventListener, { passive: false });
    target.addEventListener("touchend", handleTouchEnd as EventListener, { passive: false });
    target.addEventListener("touchcancel", handleTouchEnd as EventListener, { passive: false });

    // Polling del gamepad: la Gamepad API no emite eventos, hay que
    // leer el estado en cada frame y mandarlo solo si hay cambios.
    const pollGamepad = () => {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0];

      if (gp) {
        const msg: InputMessage = {
          t: "gp",
          lx: Math.round(gp.axes[0] * 32767),
          ly: Math.round(-gp.axes[1] * 32767), // Y invertido: JS positivo=abajo, XInput positivo=arriba
          rx: Math.round(gp.axes[2] * 32767),
          ry: Math.round(-gp.axes[3] * 32767),
          lt: Math.round((gp.buttons[6]?.value ?? 0) * 255),
          rt: Math.round((gp.buttons[7]?.value ?? 0) * 255),
          btns: gp.buttons.reduce((acc, btn, i) => acc | (btn.pressed ? (1 << i) : 0), 0),
        };

        // Solo mandamos si el estado cambió respecto al frame anterior —
        // evita saturar el DataChannel con mensajes idénticos 60 veces/segundo
        // cuando el mando está en reposo.
        const serialized = JSON.stringify(msg);
        if (serialized !== prevGamepadRef.current) {
          prevGamepadRef.current = serialized;
          onInputRef.current(msg);
        }
      }

      animFrameRef.current = requestAnimationFrame(pollGamepad);
    };

    animFrameRef.current = requestAnimationFrame(pollGamepad);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      target.removeEventListener("mousemove", handleMouseMove as EventListener);
      target.removeEventListener("mousedown", handleMouseDown as EventListener);
      target.removeEventListener("mouseup", handleMouseUp as EventListener);
      target.removeEventListener("wheel", handleWheel as EventListener);
      target.removeEventListener("touchstart", handleTouchStart as EventListener);
      target.removeEventListener("touchmove", handleTouchMove as EventListener);
      target.removeEventListener("touchend", handleTouchEnd as EventListener);
      target.removeEventListener("touchcancel", handleTouchEnd as EventListener);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [enabled, targetRef, mouseMode]);
}
