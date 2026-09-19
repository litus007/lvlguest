import { useEffect, useRef } from "react";
import { InputMessage } from "../types/inputProtocol";

interface UseInputCaptureOptions {
  enabled: boolean;
  onInput: (msg: InputMessage) => void;
}

/**
 * Captura inputs de teclado, ratón y mando en el WebView del guest y los
 * entrega al callback `onInput` para que se envíen por el DataChannel.
 * Se activa solo cuando `enabled` es true (cuando el guest está conectado
 * y el DataChannel está abierto), para no interceptar inputs en el resto
 * de la navegación normal de la app.
 */
export function useInputCapture({ enabled, onInput }: UseInputCaptureOptions) {
  const onInputRef = useRef(onInput);
  useEffect(() => { onInputRef.current = onInput; }, [onInput]);

  const animFrameRef = useRef<number | null>(null);
  const prevGamepadRef = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      onInputRef.current({ t: "kd", code: e.code });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      onInputRef.current({ t: "ku", code: e.code });
    };

    let lastX = 0, lastY = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      onInputRef.current({ t: "mm", x: e.clientX, y: e.clientY, dx, dy });
    };

    const handleMouseDown = (e: MouseEvent) => {
      onInputRef.current({ t: "mb", btn: e.button as 0 | 1 | 2, down: true });
    };

    const handleMouseUp = (e: MouseEvent) => {
      onInputRef.current({ t: "mb", btn: e.button as 0 | 1 | 2, down: false });
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onInputRef.current({ t: "mw", dy: e.deltaY });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("wheel", handleWheel, { passive: false });

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
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("wheel", handleWheel);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [enabled]);
}