import type { ReactElement } from "react";

export type ToolIconName = "lan" | "stream" | "game" | "assist" | "call" | "transfer" | "board";

/**
 * Icones de línia pròpies de cada eina (en lloc d'emojis), amb cantonades
 * en angle com la resta del llenguatge visual. Hereten `currentColor`.
 */
const PATHS: Record<ToolIconName, ReactElement> = {
  lan: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M11 7 6 16M13 7l5 9M7.2 18h9.6" />
    </>
  ),
  stream: (
    <>
      <path d="M3 4.5h18v11.5H3zM8.5 20h7M12 16v4" />
      <path d="M10.3 7.6 15 10.2l-4.7 2.6z" />
    </>
  ),
  game: (
    <>
      <path d="M7 8h10a4.5 4.5 0 0 1 4.4 5.4l-.6 3a2.6 2.6 0 0 1-4.6 1L15 15.5H9L7.8 17.4a2.6 2.6 0 0 1-4.6-1l-.6-3A4.5 4.5 0 0 1 7 8Z" />
      <path d="M7.5 10.5v3M6 12h3M16 11.2h.01M18 13h.01" />
    </>
  ),
  assist: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="m5.6 5.6 3.9 3.9M18.4 5.6l-3.9 3.9M5.6 18.4l3.9-3.9M18.4 18.4l-3.9-3.9" />
    </>
  ),
  call: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1C10.7 20 4 13.3 4 5a1 1 0 0 1 1-1Z" />,
  transfer: <path d="M7 20V5M3.5 8.5 7 5l3.5 3.5M17 4v15M13.5 15.5 17 19l3.5-3.5" />,
  board: (
    <>
      <path d="M3 4h18v11.5H3zM8 20l1.5-4.5M16 20l-1.5-4.5" />
      <path d="M7 12.5c1.6-3.2 3-.2 4.6-2.2s2.3-2.6 5.4-1" />
    </>
  ),
};

export default function ToolIcon({ name, size = 20, className = "" }: { name: ToolIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
