interface CornerFrameProps {
  color?: "cyan" | "orange";
}

const COLOR_MAP: Record<string, string> = {
  cyan: "border-cyan-400/70 shadow-[0_0_8px_rgba(34,211,238,0.6)]",
  orange: "border-orange-400/70 shadow-[0_0_8px_rgba(251,146,60,0.6)]",
};

/**
 * Quatre marques de cantonada en forma de L, com el HUD d'una consola
 * o d'una pantalla de selecció de plataforma. Es col·loca dins d'un
 * contenidor amb `position: relative` i cobreix tot el seu espai amb
 * `absolute inset-0 pointer-events-none`.
 */
export default function CornerFrame({ color = "cyan" }: CornerFrameProps) {
  const c = COLOR_MAP[color];
  const base = "absolute w-5 h-5 border-t-2 border-l-2";
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className={`${base} ${c} top-0 left-0`} />
      <div className={`${base} ${c} top-0 right-0 rotate-90`} />
      <div className={`${base} ${c} bottom-0 right-0 rotate-180`} />
      <div className={`${base} ${c} bottom-0 left-0 -rotate-90`} />
    </div>
  );
}
