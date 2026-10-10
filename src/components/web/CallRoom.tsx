import { useEffect, useRef, useState, type ReactNode } from "react";
import type { VoiceMember, VoiceState } from "../../lib/roomVoice";
import type { CallActions } from "../../hooks/useWebCall";
import CornerFrame from "../common/CornerFrame";

/**
 * Sala de trucada estil Discord: participants amb anell de veu i nivell,
 * volum per persona, barra de control (micro, auriculars, càmera, ajustos) i
 * un panell d'ajustos amb dispositius, guanys i diagnòstic.
 */

const hueOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

function Avatar({ name, speaking, size = 40 }: { name: string; speaking: boolean; size?: number }) {
  const h = hueOf(name || "?");
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold shrink-0 transition-shadow duration-150 ${speaking ? "ring-2 ring-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]" : "ring-1 ring-white/10"}`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 70% 50% / 0.2)`, color: `hsl(${h} 85% 74%)` }}
      aria-hidden
    >
      {(name || "?").trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function Meter({ level, muted }: { level: number; muted?: boolean }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level} aria-label="Nivell de veu">
      <div className={`h-full rounded-full transition-[width] duration-100 ${muted ? "bg-gray-600" : level > 0.8 ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const MicIcon = ({ off }: { off?: boolean }) => (
  <Icon>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    {off && <path d="M4 4l16 16" />}
  </Icon>
);
const HeadsetIcon = ({ off }: { off?: boolean }) => (
  <Icon>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3" y="14" width="4" height="6" rx="1.5" />
    <rect x="17" y="14" width="4" height="6" rx="1.5" />
    {off && <path d="M4 4l16 16" />}
  </Icon>
);
const CamIcon = ({ off }: { off?: boolean }) => (
  <Icon>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
    {off && <path d="M4 4l16 16" />}
  </Icon>
);
const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
  </Icon>
);

function VideoTile({ stream, name, speaking, mirror }: { stream: MediaStream; name: string; speaking: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={`relative rounded-lg overflow-hidden bg-black aspect-video ${speaking ? "ring-2 ring-emerald-400" : "ring-1 ring-white/10"}`}>
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-cover" style={mirror ? { transform: "scaleX(-1)" } : undefined} />
      <span className="absolute left-2 bottom-2 text-[11px] bg-black/60 rounded px-1.5 py-0.5 text-white">{name}</span>
    </div>
  );
}

const STATUS_TEXT = {
  checking: { text: "Comprovant el micròfon…", cls: "text-gray-400" },
  ok: { text: "El micro s'escolta ✓", cls: "text-emerald-300" },
  silent: { text: "No se sent res del teu micro. Parla, mira el volum o tria un altre dispositiu.", cls: "text-amber-300" },
  muted: { text: "Micro silenciat", cls: "text-gray-400" },
} as const;

function MemberRow({ m, actions, iAmHost }: { m: VoiceMember; actions: CallActions; iAmHost: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="chamfer-sm bg-white/[0.05]">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
        <Avatar name={m.nickname} speaking={m.speaking} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-white">
            <span className="truncate">{m.nickname}</span>
            {m.isHost && <span title="Amfitrió de la trucada">👑</span>}
            {m.app && <span title="A l'app d'escriptori">🖥️</span>}
            {m.muted && <span className="text-gray-500" title="Micro silenciat"><MicIcon off /></span>}
          </div>
          <Meter level={m.level} muted={m.muted} />
        </div>
        <span
          className={`text-[11px] shrink-0 ${!m.connected ? "text-amber-300 animate-pulse" : m.receiving ? "text-emerald-300" : "text-gray-500"}`}
          title={m.connected ? (m.receiving ? "Estem rebent el seu àudio" : "Connectat, però no arriba àudio") : "Connectant…"}
        >
          {!m.connected ? "connectant" : m.receiving ? "rebent" : "sense senyal"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-xs text-gray-300">
          <label className="flex items-center gap-3">
            <span className="w-24 shrink-0">Volum d'ell/a</span>
            <input type="range" min={0} max={200} value={Math.round(m.volume * 100)} onChange={(e) => actions.setMemberVolume(m.id, Number(e.target.value) / 100)} className="flex-1 accent-emerald-400" aria-label={`Volum de ${m.nickname}`} />
            <span className="w-10 text-right font-mono">{Math.round(m.volume * 100)}%</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => actions.setMemberLocalMuted(m.id, !m.localMuted)} className="chamfer-sm px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white">
              {m.localMuted ? "Torna'l a escoltar" : "Silencia'l (només per a mi)"}
            </button>
            {iAmHost && (
              <>
                <button onClick={() => actions.hostMute(m.id, !m.muted)} className="chamfer-sm px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100">
                  {m.muted ? "Treu-li el silenci" : "Silencia'l per a tothom"}
                </button>
                <button onClick={() => actions.hostKick(m.id)} className="chamfer-sm px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-100">
                  Expulsa
                </button>
              </>
            )}
          </div>
          <p className="text-gray-500">
            {m.rttMs !== null ? `Latència ${m.rttMs} ms` : "Latència —"} · {m.lossPct !== null ? `pèrdua ${m.lossPct}%` : "pèrdua —"}
          </p>
        </div>
      )}
    </li>
  );
}

export default function CallRoom({ state, code, actions, onLeave, max }: { state: VoiceState; code: string; actions: CallActions; onLeave: () => void; max: number }) {
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const s = state.settings;
  const st = STATUS_TEXT[state.micStatus];
  const videos = state.members.filter((m) => m.videoStream);

  return (
    <div className="panel chamfer relative p-4 space-y-4">
      <CornerFrame color="emerald" />

      <div className="flex items-center justify-between text-xs">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="text-emerald-300 text-sm font-mono tracking-widest hover:text-emerald-200"
          title="Copia la paraula"
        >
          ● {code} {copied ? "✔" : "⧉"}
        </button>
        <span className="text-gray-400">
          {state.members.length + 1} / {max}
          {state.iAmHost ? " · ets l'amfitrió 👑" : ""}
        </span>
      </div>

      {(state.localVideo || videos.length > 0) && (
        <div className={`grid gap-2 ${videos.length + (state.localVideo ? 1 : 0) > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {state.localVideo && <VideoTile stream={state.localVideo} name="Tu" speaking={state.speaking} mirror />}
          {videos.map((m) => (
            <VideoTile key={m.id} stream={m.videoStream!} name={m.nickname} speaking={m.speaking} />
          ))}
        </div>
      )}

      <ul className="space-y-2">
        <li className="chamfer-sm bg-white/[0.07] px-3 py-2.5">
          <div className="flex items-center gap-3">
            <Avatar name="Tu" speaking={state.speaking} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-sm text-white">
                <span>Tu</span>
                {state.iAmHost && <span title="Amfitrió">👑</span>}
                {state.muted && <span className="text-gray-500"><MicIcon off /></span>}
              </div>
              <Meter level={state.myLevel} muted={state.muted} />
            </div>
            <span className={`text-[11px] shrink-0 ${state.sending ? "text-emerald-300" : "text-gray-500"}`} title="Algú està rebent el teu àudio">
              {state.sending ? "enviant" : "sense destinatari"}
            </span>
          </div>
          <p className={`mt-1.5 text-[11px] ${st.cls}`} role="status">
            {st.text}
            {state.forcedMute ? " (silenciat per l'amfitrió)" : ""}
          </p>
        </li>
        {state.members.map((m) => (
          <MemberRow key={m.id} m={m} actions={actions} iAmHost={state.iAmHost} />
        ))}
        {state.members.length === 0 && <li className="text-center text-xs text-gray-500 py-2">Esperant que algú entri amb aquesta paraula…</li>}
      </ul>

      {/* Barra de control */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={actions.toggleMute}
          aria-pressed={state.muted}
          title={state.muted ? "Activa el micro" : "Silencia el micro"}
          aria-label={state.muted ? "Activa el micro" : "Silencia el micro"}
          className={`chamfer-sm w-11 h-11 flex items-center justify-center transition-colors ${state.muted ? "bg-red-500/25 text-red-200 hover:bg-red-500/35" : "bg-white/10 text-white hover:bg-white/15"}`}
        >
          <MicIcon off={state.muted} />
        </button>
        <button
          onClick={actions.toggleDeafen}
          aria-pressed={state.deafened}
          title={state.deafened ? "Torna a escoltar" : "Deixa d'escoltar (silencia també el micro)"}
          aria-label={state.deafened ? "Torna a escoltar" : "Deixa d'escoltar"}
          className={`chamfer-sm w-11 h-11 flex items-center justify-center transition-colors ${state.deafened ? "bg-red-500/25 text-red-200 hover:bg-red-500/35" : "bg-white/10 text-white hover:bg-white/15"}`}
        >
          <HeadsetIcon off={state.deafened} />
        </button>
        <button
          onClick={actions.toggleCamera}
          aria-pressed={state.camera}
          title={state.camera ? "Apaga la càmera" : "Activa la càmera"}
          aria-label={state.camera ? "Apaga la càmera" : "Activa la càmera"}
          className={`chamfer-sm w-11 h-11 flex items-center justify-center transition-colors ${state.camera ? "bg-emerald-500/25 text-emerald-100" : "bg-white/10 text-white hover:bg-white/15"}`}
        >
          <CamIcon off={!state.camera} />
        </button>
        <button
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          title="Ajustos d'àudio"
          aria-label="Ajustos d'àudio"
          className={`chamfer-sm w-11 h-11 flex items-center justify-center transition-colors ${showSettings ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/15"}`}
        >
          <GearIcon />
        </button>
        <button onClick={onLeave} className="chamfer-sm px-5 h-11 text-sm font-semibold bg-red-500/85 hover:bg-red-500 text-white transition-colors">
          Penjar
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-red-300 text-xs text-center">
          {state.error}
        </p>
      )}

      {showSettings && (
        <div className="space-y-4 border-t border-white/10 pt-4 text-sm text-gray-200" aria-label="Ajustos d'àudio">
          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Micròfon</span>
            <select value={s.inputId} onChange={(e) => actions.updateSettings({ inputId: e.target.value })} className="w-full bg-black/50 border border-white/10 chamfer-sm px-3 py-2 text-sm">
              <option value="">Per defecte del sistema</option>
              {state.inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-gray-400">Sortida d'àudio</span>
            {state.outputSupported ? (
              <select value={s.outputId} onChange={(e) => actions.updateSettings({ outputId: e.target.value })} className="w-full bg-black/50 border border-white/10 chamfer-sm px-3 py-2 text-sm">
                <option value="">Per defecte del sistema</option>
                {state.outputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-gray-500">Aquest navegador no permet triar la sortida: fa servir la del sistema.</p>
            )}
          </label>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Volum del micro (el que sent l'altra gent)</span>
              <span className="font-mono text-gray-200">{Math.round(s.gain * 100)}%</span>
            </div>
            <input type="range" min={0} max={300} value={Math.round(s.gain * 100)} onChange={(e) => actions.updateSettings({ gain: Number(e.target.value) / 100 })} className="w-full accent-emerald-400" aria-label="Volum del micro" />
            <Meter level={state.myLevel} muted={state.muted} />
            <p className="text-[11px] text-gray-500">Parla: la barra ha d'arribar a la meitat aproximadament. Si t'escolten fluix, puja el volum.</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Volum de sortida (el que escoltes)</span>
              <span className="font-mono text-gray-200">{Math.round(s.outVolume * 100)}%</span>
            </div>
            <input type="range" min={0} max={200} value={Math.round(s.outVolume * 100)} onChange={(e) => actions.updateSettings({ outVolume: Number(e.target.value) / 100 })} className="w-full accent-emerald-400" aria-label="Volum de sortida" />
          </div>

          <div className="grid gap-2 text-xs">
            {(
              [
                ["noiseSuppression", "Reducció de soroll"],
                ["echoCancellation", "Cancel·lació d'eco"],
                ["autoGain", "Control automàtic de guany"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-emerald-400" checked={s[key]} onChange={(e) => actions.updateSettings({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-emerald-400" checked={s.monitor} onChange={(e) => actions.updateSettings({ monitor: e.target.checked })} />
              Escolta't a tu mateix (per provar; fes servir auriculars)
            </label>
          </div>

          {state.iAmHost && state.members.length > 0 && (
            <div className="flex gap-2">
              <button onClick={() => actions.hostMuteAll(true)} className="chamfer-sm px-3 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-100">
                Silencia tothom
              </button>
              <button onClick={() => actions.hostMuteAll(false)} className="chamfer-sm px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 text-white">
                Torna'ls la veu
              </button>
            </div>
          )}

          <div className="text-[11px] text-gray-500 space-y-0.5" aria-label="Diagnòstic">
            <p>Diagnòstic: micro «{STATUS_TEXT[state.micStatus].text.replace(" ✓", "")}» · {state.sending ? "algú rep el teu àudio" : "ningú rep encara el teu àudio"}.</p>
            {state.members.map((m) => (
              <p key={m.id}>
                {m.nickname}: {m.connected ? "connectat" : "connectant"} · {m.receiving ? "arriba àudio" : "no arriba àudio"} · {m.rttMs !== null ? `${m.rttMs} ms` : "— ms"}
                {m.lossPct ? ` · pèrdua ${m.lossPct}%` : ""}
              </p>
            ))}
            <p>Als mòbils, el volum de trucada s'ajusta amb els botons de volum del telèfon mentre dura la trucada.</p>
          </div>
        </div>
      )}
    </div>
  );
}
