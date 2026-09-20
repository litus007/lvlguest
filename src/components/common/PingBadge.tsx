interface PingBadgeProps {
  rttMs: number | null;
  packetsLost?: number | null;
}

function quality(rttMs: number | null): { label: string; color: string; dot: string } {
  if (rttMs === null) return { label: "Mesurant...", color: "text-gray-400 bg-white/5 border-white/10", dot: "bg-gray-500" };
  if (rttMs <= 60) return { label: "Excel·lent", color: "text-emerald-300 bg-emerald-400/10 border-emerald-400/30", dot: "bg-emerald-400" };
  if (rttMs <= 150) return { label: "Bona", color: "text-orange-300 bg-orange-400/10 border-orange-400/30", dot: "bg-orange-400" };
  return { label: "Inestable", color: "text-red-300 bg-red-400/10 border-red-400/30", dot: "bg-red-400" };
}

/**
 * Latència mesurada a nivell d'ICE (RTCPeerConnection.getStats()) — és
 * fiable independentment de si el vídeo viatja per un track RTP o per un
 * RTCDataChannel, ja que ve del propi agent ICE, no del contingut que hi
 * circula per sobre. Útil per saber si la partida anirà fluida o no.
 */
export default function PingBadge({ rttMs, packetsLost }: PingBadgeProps) {
  const { label, color, dot } = quality(rttMs);
  return (
    <div
      className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest px-2.5 py-1 border font-mono ${color}`}
      title={packetsLost !== null && packetsLost !== undefined ? `${packetsLost} paquets perduts` : undefined}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${rttMs !== null ? "animate-pulse" : ""}`} />
      {rttMs !== null ? `${rttMs} ms` : "—"} · {label}
    </div>
  );
}
