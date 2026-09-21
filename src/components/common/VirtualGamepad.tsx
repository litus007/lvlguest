import { useRef, useState } from "react";
import { InputMessage } from "../../types/inputProtocol";

interface VirtualGamepadProps {
  onInput: (msg: InputMessage) => void;
}

const STICK_RADIUS = 46;

/**
 * Mando virtual per a pantalles tàctils: un stick esquerre arrossegable
 * i quatre botons d'acció (A/B/X/Y). Genera exactament el mateix
 * missatge "gp" que ja envia `useInputCapture` per a un mando físic
 * (Gamepad API) — el Host no distingeix l'origen, així que no calia
 * cap canvi al costat que rep els inputs.
 *
 * Bits de `btns`: index 0=A, 1=B, 2=X, 3=Y — el mateix ordre que
 * `gp.buttons[i]` fa servir la Gamepad API estàndard, per mantenir la
 * mateixa convenció de bits que el mando físic.
 */
export default function VirtualGamepad({ onInput }: VirtualGamepadProps) {
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const [pressed, setPressed] = useState<Record<number, boolean>>({});
  const stickTouchId = useRef<number | null>(null);
  const stickOrigin = useRef({ x: 0, y: 0 });
  const btnsRef = useRef(0);
  const stickRef = useRef({ lx: 0, ly: 0 });

  const sendState = () => {
    onInput({
      t: "gp",
      lx: stickRef.current.lx,
      ly: stickRef.current.ly,
      rx: 0,
      ry: 0,
      lt: 0,
      rt: 0,
      btns: btnsRef.current,
    });
  };

  const handleStickStart = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    stickTouchId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    stickOrigin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const handleStickMove = (e: React.PointerEvent) => {
    if (stickTouchId.current !== e.pointerId) return;
    let dx = e.clientX - stickOrigin.current.x;
    let dy = e.clientY - stickOrigin.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_RADIUS) {
      dx = (dx / dist) * STICK_RADIUS;
      dy = (dy / dist) * STICK_RADIUS;
    }
    setStickPos({ x: dx, y: dy });
    stickRef.current = {
      lx: Math.round((dx / STICK_RADIUS) * 32767),
      ly: Math.round((-dy / STICK_RADIUS) * 32767),
    };
    sendState();
  };

  const handleStickEnd = (e: React.PointerEvent) => {
    if (stickTouchId.current !== e.pointerId) return;
    stickTouchId.current = null;
    setStickPos({ x: 0, y: 0 });
    stickRef.current = { lx: 0, ly: 0 };
    sendState();
  };

  const handleButton = (bit: number, down: boolean) => {
    btnsRef.current = down ? btnsRef.current | (1 << bit) : btnsRef.current & ~(1 << bit);
    setPressed((prev) => ({ ...prev, [bit]: down }));
    sendState();
  };

  const buttonStyle = (bit: number, label: string, position: string, color: string) => (
    <button
      key={bit}
      onPointerDown={(e) => {
        e.preventDefault();
        handleButton(bit, true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        handleButton(bit, false);
      }}
      onPointerLeave={() => pressed[bit] && handleButton(bit, false)}
      className={`absolute w-12 h-12 rounded-full border-2 font-extrabold text-sm select-none touch-none transition-transform duration-100 ${position} ${
        pressed[bit] ? "scale-90" : ""
      } ${color}`}
    >
      {label}
    </button>
  );

  return (
    <div className="absolute inset-x-0 bottom-0 h-40 pointer-events-none select-none">
      {/* Stick esquerre */}
      <div
        onPointerDown={handleStickStart}
        onPointerMove={handleStickMove}
        onPointerUp={handleStickEnd}
        onPointerCancel={handleStickEnd}
        className="absolute left-6 bottom-6 w-28 h-28 rounded-full bg-white/5 border-2 border-orange-400/30 touch-none pointer-events-auto"
      >
        <div
          className="absolute w-12 h-12 rounded-full bg-orange-400/70 border-2 border-orange-200/60 shadow-[0_0_16px_rgba(251,146,60,0.6)]"
          style={{
            left: `calc(50% - 24px + ${stickPos.x}px)`,
            top: `calc(50% - 24px + ${stickPos.y}px)`,
            transition: stickTouchId.current === null ? "left 120ms, top 120ms" : "none",
          }}
        />
      </div>

      {/* Botons d'acció (dreta) */}
      <div className="absolute right-6 bottom-6 w-32 h-32 pointer-events-auto">
        {buttonStyle(3, "Y", "top-0 left-1/2 -translate-x-1/2", "bg-amber-400/20 border-amber-300/50 text-amber-200")}
        {buttonStyle(1, "B", "top-1/2 right-0 -translate-y-1/2", "bg-red-400/20 border-red-300/50 text-red-200")}
        {buttonStyle(2, "X", "top-1/2 left-0 -translate-y-1/2", "bg-blue-400/20 border-blue-300/50 text-blue-200")}
        {buttonStyle(0, "A", "bottom-0 left-1/2 -translate-x-1/2", "bg-emerald-400/20 border-emerald-300/50 text-emerald-200")}
      </div>
    </div>
  );
}
