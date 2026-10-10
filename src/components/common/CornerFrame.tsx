interface CornerFrameProps {
  color?: "cyan" | "orange" | "emerald" | "violet" | "rose";
}

const COLOR_MAP: Record<string, string> = {
  cyan: "border-cyan-400/80 drop-shadow-[0_0_5px_rgba(34,211,238,0.7)]",
  orange: "border-orange-400/80 drop-shadow-[0_0_5px_rgba(251,146,60,0.7)]",
  emerald: "border-emerald-400/80 drop-shadow-[0_0_5px_rgba(52,211,153,0.7)]",
  rose: "border-rose-400/80 drop-shadow-[0_0_5px_rgba(251,113,133,0.7)]",
  violet: "border-violet-400/80 drop-shadow-[0_0_5px_rgba(167,139,250,0.7)]",
};

/**
 * Dues marques de cantonada en L, només als vèrtexs rectes: els altres dos
 * estan tallats en diagonal pel `chamfer` del contenidor (i la línia
 * diagonal la dibuixa `.panel`). Es col·loca dins d'un contenidor amb
 * `position: relative` i cobreix tot el seu espai.
 */
export default function CornerFrame({ color = "cyan" }: CornerFrameProps) {
  const c = COLOR_MAP[color];
  const base = "absolute w-6 h-6 border-t-2 border-l-2";
  return (
    <div className="absolute inset-0 pointer-events-none">
      <div className={`${base} ${c} top-0 right-0 rotate-90`} />
      <div className={`${base} ${c} bottom-0 left-0 -rotate-90`} />
    </div>
  );
}
