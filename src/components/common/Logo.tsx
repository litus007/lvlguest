interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Emblema del sistema LVCLITS — el mateix disseny que l'icona de
 * l'aplicació (src-tauri/icons/), en SVG inline perquè es vegi nítid a
 * qualsevol mida dins la interfície (capçaleres, pantalla de selecció,
 * splash...).
 */
export default function Logo({ size = 48, className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lvclits-shield" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#fb923c" />
        </linearGradient>
        <linearGradient id="lvclits-inner" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a0e1f" />
          <stop offset="100%" stopColor="#05060d" />
        </linearGradient>
      </defs>

      <path
        d="M512 118 L845 300 L845 664 L512 906 L179 664 L179 300 Z"
        fill="url(#lvclits-inner)"
        stroke="url(#lvclits-shield)"
        strokeWidth="4"
      />
      <path
        d="M512 158 L512 866"
        stroke="url(#lvclits-shield)"
        strokeWidth="3"
        strokeDasharray="2 14"
        opacity="0.5"
      />
      <path d="M340 360 L340 620 L470 620" fill="none" stroke="#67e8f9" strokeWidth="46" strokeLinecap="square" />
      <path d="M540 360 L660 640 L780 360" fill="none" stroke="#fb923c" strokeWidth="46" strokeLinecap="square" />
      <g stroke="#f97316" strokeWidth="6" fill="#f97316" opacity="0.85">
        <path d="M300 760 H420 L450 730 H574 L604 760 H724" fill="none" />
        <circle cx="300" cy="760" r="9" />
        <circle cx="724" cy="760" r="9" />
        <circle cx="512" cy="700" r="9" />
      </g>
    </svg>
  );
}
