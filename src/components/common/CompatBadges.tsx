import { COMPAT, PLATFORMS, SUPPORT_GLYPH, SUPPORT_LABEL, type CompatTool } from "../../lib/compat";

/**
 * Fitxes petites amb un emoji per dispositiu i el seu estat:
 * ✅ funciona · ⚠️ amb límits · ❌ no disponible. Amb `showNotes`, a sota
 * s'expliquen els límits (als mòbils no hi ha hover/tooltip).
 */
export default function CompatBadges({ tool, showNotes = false, className = "" }: { tool: CompatTool; showNotes?: boolean; className?: string }) {
  const entry = COMPAT[tool];
  return (
    <div className={className}>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Compatibilitat per dispositiu">
        {PLATFORMS.map((p) => {
          const s = entry.support[p.id];
          const note = entry.notes[p.id];
          return (
            <li
              key={p.id}
              title={`${p.name}: ${SUPPORT_LABEL[s]}${note ? ` — ${note}` : ""}`}
              aria-label={`${p.name}: ${SUPPORT_LABEL[s]}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${
                s === "yes" ? "border-emerald-400/25 bg-emerald-400/[0.07]" : s === "partial" ? "border-amber-400/30 bg-amber-400/[0.08]" : "border-white/10 bg-white/[0.03] opacity-60"
              }`}
            >
              <span aria-hidden>{p.emoji}</span>
              <span aria-hidden className="text-[10px]">
                {SUPPORT_GLYPH[s]}
              </span>
            </li>
          );
        })}
      </ul>
      {showNotes && (
        <p className="mt-2 text-[10px] text-gray-500">✅ funciona · ⚠️ amb límits · ❌ no disponible</p>
      )}
      {showNotes && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-gray-400">
          {PLATFORMS.filter((p) => entry.support[p.id] !== "yes" && entry.notes[p.id]).map((p) => (
            <li key={p.id}>
              <span aria-hidden>{p.emoji}</span> <span className="text-gray-300">{p.name}:</span> {entry.notes[p.id]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
