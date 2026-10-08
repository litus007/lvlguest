import { ReactNode, useRef, useState } from "react";
import { InputMessage } from "../../types/inputProtocol";

interface VirtualGamepadProps {
  onInput: (msg: InputMessage) => void;
}

/**
 * 🎮 Mando virtual tàctil. NO s'activa sol: l'usuari el treu des del botó 🕹️
 * de la barra quan el necessita.
 *
 * Genera exactament el mateix missatge "gp" que un mando físic (Gamepad API):
 * `btns` és una màscara on el bit `i` és `gamepad.buttons[i]` de la Gamepad
 * API estàndard (el Host la tradueix a XInput). Els gallets LT/RT viatgen als
 * camps `lt`/`rt`.
 *
 * Disposició: gallets/espatlleres a dalt de cada costat, stick esquerre (o
 * creueta) a baix a l'esquerra, botons A/B/X/Y (o stick dret) a baix a la
 * dreta, i Back/Start al centre amb dos commutadors (✚ creueta, 🎯 stick dret).
 */

// Índexs de la Gamepad API estàndard
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, BACK = 8, START = 9;
const DPAD_UP = 12, DPAD_DOWN = 13, DPAD_LEFT = 14, DPAD_RIGHT = 15;

const buzz = () => {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
  } catch {
    /* sense vibració: res a fer */
  }
};

const GLASS =
  "bg-gradient-to-b from-white/[0.16] to-white/[0.04] border border-white/25 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_14px_rgba(0,0,0,0.35)]";

/** Botó que es manté premut mentre hi ha un dit a sobre. */
function HoldButton({
  onDown,
  onUp,
  className,
  pressedClassName,
  label,
  children,
}: {
  onDown: () => void;
  onUp: () => void;
  className: string;
  pressedClassName: string;
  label: string;
  children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  const active = useRef(false);

  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (active.current) return;
    active.current = true;
    setPressed(true);
    buzz();
    onDown();
  };
  const release = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!active.current) return;
    active.current = false;
    setPressed(false);
    onUp();
  };

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      className={`select-none touch-none flex items-center justify-center transition-all duration-100 ${className} ${
        pressed ? `scale-90 ${pressedClassName}` : ""
      }`}
    >
      {children}
    </button>
  );
}

/** Stick analògic: retorna (x, y) normalitzats a -1..1 (y positiva = amunt). */
function Stick({ size, accent, onMove }: { size: number; accent: "orange" | "sky"; onMove: (x: number, y: number) => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(false);
  const pointerId = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const travel = size * 0.3;
  const thumb = size * 0.42;

  const update = (clientX: number, clientY: number) => {
    let dx = clientX - origin.current.x;
    let dy = clientY - origin.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > travel) {
      dx = (dx / dist) * travel;
      dy = (dy / dist) * travel;
    }
    setPos({ x: dx, y: dy });
    onMove(dx / travel, -dy / travel);
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setHeld(true);
    update(e.clientX, e.clientY);
  };
  const move = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    update(e.clientX, e.clientY);
  };
  const end = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    setHeld(false);
    setPos({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const thumbColor =
    accent === "orange"
      ? "bg-[radial-gradient(circle_at_35%_30%,#fdba74,#f97316_60%,#9a3412)] border-orange-200/60 shadow-[0_4px_16px_rgba(249,115,22,0.55)]"
      : "bg-[radial-gradient(circle_at_35%_30%,#7dd3fc,#0ea5e9_60%,#075985)] border-sky-200/60 shadow-[0_4px_16px_rgba(14,165,233,0.55)]";

  return (
    <div
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      style={{ width: size, height: size }}
      className={`relative rounded-full touch-none select-none ${GLASS} ${held ? "border-white/40" : ""}`}
    >
      {/* anell interior i marques de direcció */}
      <div className="absolute inset-[14%] rounded-full border border-white/10" />
      <span className="absolute left-1/2 top-[6%] -translate-x-1/2 w-1 h-1 rounded-full bg-white/30" />
      <span className="absolute left-1/2 bottom-[6%] -translate-x-1/2 w-1 h-1 rounded-full bg-white/30" />
      <span className="absolute top-1/2 left-[6%] -translate-y-1/2 w-1 h-1 rounded-full bg-white/30" />
      <span className="absolute top-1/2 right-[6%] -translate-y-1/2 w-1 h-1 rounded-full bg-white/30" />
      <div
        className={`absolute rounded-full border ${thumbColor}`}
        style={{
          width: thumb,
          height: thumb,
          left: `calc(50% - ${thumb / 2}px + ${pos.x}px)`,
          top: `calc(50% - ${thumb / 2}px + ${pos.y}px)`,
          transition: held ? "none" : "left 120ms ease-out, top 120ms ease-out",
        }}
      />
    </div>
  );
}

const FACE = {
  A: { glyph: "A", idle: "text-emerald-300", on: "bg-emerald-400/35 border-emerald-300/80 shadow-[0_0_20px_rgba(52,211,153,0.6)]" },
  B: { glyph: "B", idle: "text-red-300", on: "bg-red-400/35 border-red-300/80 shadow-[0_0_20px_rgba(248,113,113,0.6)]" },
  X: { glyph: "X", idle: "text-sky-300", on: "bg-sky-400/35 border-sky-300/80 shadow-[0_0_20px_rgba(56,189,248,0.6)]" },
  Y: { glyph: "Y", idle: "text-amber-300", on: "bg-amber-400/35 border-amber-300/80 shadow-[0_0_20px_rgba(251,191,36,0.6)]" },
} as const;

export default function VirtualGamepad({ onInput }: VirtualGamepadProps) {
  const [dpadMode, setDpadMode] = useState(false); // false = stick esquerre, true = creueta
  const [rightStickMode, setRightStickMode] = useState(false); // false = A/B/X/Y, true = stick dret
  const st = useRef({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, btns: 0 });

  const send = () => onInput({ t: "gp", ...st.current });
  const setBtn = (bit: number, down: boolean) => {
    st.current.btns = down ? st.current.btns | (1 << bit) : st.current.btns & ~(1 << bit);
    send();
  };
  const setStick = (which: "l" | "r", x: number, y: number) => {
    const cx = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
    const cy = Math.round(Math.max(-1, Math.min(1, y)) * 32767);
    if (which === "l") {
      st.current.lx = cx;
      st.current.ly = cy;
    } else {
      st.current.rx = cx;
      st.current.ry = cy;
    }
    send();
  };
  const setTrigger = (which: "lt" | "rt", down: boolean) => {
    st.current[which] = down ? 255 : 0;
    send();
  };

  // En canviar de mode no ha de quedar cap eix ni botó "enganxat" del mode anterior.
  const toggleDpad = () => {
    st.current.lx = 0;
    st.current.ly = 0;
    st.current.btns &= ~((1 << DPAD_UP) | (1 << DPAD_DOWN) | (1 << DPAD_LEFT) | (1 << DPAD_RIGHT));
    send();
    setDpadMode((v) => !v);
  };
  const toggleRightStick = () => {
    st.current.rx = 0;
    st.current.ry = 0;
    st.current.btns &= ~((1 << A) | (1 << B) | (1 << X) | (1 << Y));
    send();
    setRightStickMode((v) => !v);
  };

  const pill = (label: string, onDown: () => void, onUp: () => void, wide = false) => (
    <HoldButton
      label={label}
      onDown={onDown}
      onUp={onUp}
      className={`${GLASS} rounded-xl h-9 ${wide ? "w-20" : "w-16"} text-[11px] font-bold tracking-wider text-gray-200`}
      pressedClassName="bg-white/30 border-white/60"
    >
      {label}
    </HoldButton>
  );

  const face = (key: keyof typeof FACE, bit: number, position: string) => (
    <div key={key} className={`absolute ${position}`}>
      <HoldButton
        label={key}
        onDown={() => setBtn(bit, true)}
        onUp={() => setBtn(bit, false)}
        className={`${GLASS} w-12 h-12 rounded-full text-lg font-extrabold ${FACE[key].idle}`}
        pressedClassName={FACE[key].on}
      >
        {FACE[key].glyph}
      </HoldButton>
    </div>
  );

  const dpadKey = (label: string, bit: number, position: string, rounded: string) => (
    <div className={`absolute ${position}`}>
      <HoldButton
        label={`Creueta ${label}`}
        onDown={() => setBtn(bit, true)}
        onUp={() => setBtn(bit, false)}
        className={`${GLASS} w-11 h-11 ${rounded} text-sm text-gray-200`}
        pressedClassName="bg-white/30 border-white/60"
      >
        {label}
      </HoldButton>
    </div>
  );

  const miniToggle = (title: string, active: boolean, onClick: () => void, icon: string) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`w-8 h-8 rounded-full text-sm border transition-colors ${
        active ? "bg-orange-400/30 border-orange-300/60 text-orange-100" : "bg-white/10 border-white/20 text-gray-300"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="absolute inset-x-0 bottom-0 h-[260px] pointer-events-none select-none opacity-95">
      {/* Espatlleres i gallets */}
      <div className="absolute left-3 bottom-[166px] flex flex-col gap-1.5 pointer-events-auto">
        {pill("LT", () => setTrigger("lt", true), () => setTrigger("lt", false))}
        {pill("LB", () => setBtn(LB, true), () => setBtn(LB, false))}
      </div>
      <div className="absolute right-3 bottom-[166px] flex flex-col gap-1.5 items-end pointer-events-auto">
        {pill("RT", () => setTrigger("rt", true), () => setTrigger("rt", false))}
        {pill("RB", () => setBtn(RB, true), () => setBtn(RB, false))}
      </div>

      {/* Esquerra: stick o creueta */}
      <div className="absolute left-4 bottom-4 pointer-events-auto">
        {dpadMode ? (
          <div className="relative w-[132px] h-[132px]">
            {dpadKey("▲", DPAD_UP, "left-1/2 top-0 -translate-x-1/2", "rounded-t-xl rounded-b-md")}
            {dpadKey("▼", DPAD_DOWN, "left-1/2 bottom-0 -translate-x-1/2", "rounded-b-xl rounded-t-md")}
            {dpadKey("◀", DPAD_LEFT, "left-0 top-1/2 -translate-y-1/2", "rounded-l-xl rounded-r-md")}
            {dpadKey("▶", DPAD_RIGHT, "right-0 top-1/2 -translate-y-1/2", "rounded-r-xl rounded-l-md")}
          </div>
        ) : (
          <Stick size={132} accent="orange" onMove={(x, y) => setStick("l", x, y)} />
        )}
      </div>

      {/* Centre: Back / Start i commutadors */}
      <div className="absolute left-1/2 bottom-4 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-auto">
        <div className="flex gap-2">
          {miniToggle("Alternar stick / creueta", dpadMode, toggleDpad, "✚")}
          {miniToggle("Alternar botons / stick dret (càmera)", rightStickMode, toggleRightStick, "🎯")}
        </div>
        <div className="flex gap-2">
          {pill("BACK", () => setBtn(BACK, true), () => setBtn(BACK, false), true)}
          {pill("START", () => setBtn(START, true), () => setBtn(START, false), true)}
        </div>
      </div>

      {/* Dreta: A/B/X/Y o stick dret */}
      <div className="absolute right-4 bottom-4 pointer-events-auto">
        {rightStickMode ? (
          <Stick size={132} accent="sky" onMove={(x, y) => setStick("r", x, y)} />
        ) : (
          <div className="relative w-[132px] h-[132px]">
            {face("Y", Y, "left-1/2 top-0 -translate-x-1/2")}
            {face("A", A, "left-1/2 bottom-0 -translate-x-1/2")}
            {face("X", X, "left-0 top-1/2 -translate-y-1/2")}
            {face("B", B, "right-0 top-1/2 -translate-y-1/2")}
          </div>
        )}
      </div>
    </div>
  );
}
