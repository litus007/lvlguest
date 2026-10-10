import { useEffect, useRef, useState } from "react";
import { useTransfer } from "../../hooks/useTransfer";
import { ERROR_MESSAGES, type TransferItem } from "../../lib/transferLink";
import CornerFrame from "../common/CornerFrame";

/**
 * 📁 Panell de l'eina Transfer (violeta). Idèntic a web-guest i a l'app
 * d'escriptori; cadascun l'embolcalla amb el seu propi fons/capçalera.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

const STATUS_LABEL: Record<TransferItem["status"], string> = {
  queued: "En cua",
  waiting: "Esperant",
  active: "En curs",
  done: "Completat",
  error: "Error",
  rejected: "Rebutjat",
  cancelled: "Cancel·lat",
};

function ItemRow({
  item,
  onAccept,
  onReject,
  onCancel,
}: {
  item: TransferItem;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const pct = item.size ? Math.min(100, Math.round((item.done / item.size) * 100)) : item.status === "done" ? 100 : 0;
  const incomingPending = item.direction === "receive" && item.status === "waiting";
  const cancellable = item.status === "queued" || item.status === "active" || (item.status === "waiting" && !incomingPending);
  const color =
    item.status === "done"
      ? "text-emerald-300"
      : item.status === "error"
      ? "text-red-300"
      : item.status === "active"
      ? "text-violet-300"
      : "text-gray-400";
  return (
    <div className="bg-black/40 border border-white/10 chamfer-sm px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span title={item.direction === "send" ? "Enviant" : "Rebent"}>{item.direction === "send" ? "📤" : "📥"}</span>
        <span className="flex-1 truncate text-gray-100" title={item.name}>
          {item.name}
        </span>
        <span className="text-gray-500 font-mono shrink-0">{formatBytes(item.size)}</span>
      </div>
      {(item.status === "active" || item.status === "done") && (
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-violet-400 transition-all duration-150" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <span className={color}>
          {STATUS_LABEL[item.status]}
          {item.status === "active" ? ` · ${pct}%` : ""}
          {item.note ? ` — ${item.note}` : ""}
        </span>
        {item.direction === "receive" && item.savedTo && item.status !== "waiting" && (
          <span className="text-gray-500">{item.savedTo === "disk" ? "· desant a disc" : "· en memòria"}</span>
        )}
        <span className="flex-1" />
        {incomingPending && (
          <>
            <button onClick={onAccept} className="px-2.5 py-1 rounded-full bg-violet-500 hover:bg-violet-400 text-black font-bold">
              Acceptar i desar
            </button>
            <button onClick={onReject} className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-gray-200">
              Rebutjar
            </button>
          </>
        )}
        {cancellable && (
          <button onClick={onCancel} className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-red-500/30 text-gray-200">
            Cancel·lar
          </button>
        )}
        {item.blobUrl && (
          <a
            href={item.blobUrl}
            download={item.name}
            className="px-2.5 py-1 rounded-full bg-emerald-500/80 hover:bg-emerald-400 text-black font-bold"
          >
            ⬇ Descarregar
          </a>
        )}
      </div>
    </div>
  );
}

export interface TransferSummary {
  phase: "idle" | "waiting" | "connecting" | "connected" | "failed";
  code: string;
  /** Fitxers movent-se ara mateix. */
  moving: number;
}

export default function TransferPanel({
  onBusyChange,
  onActiveChange,
  onSummary,
  leaveRef,
}: {
  onBusyChange?: (busy: boolean) => void;
  onActiveChange?: (active: boolean) => void;
  /** Resum de la sessió (per al mini-panell de l'app d'escriptori). */
  onSummary?: (summary: TransferSummary) => void;
  /** Exposa "sortir de la sala" al pare (p. ex. per al botó "Acaba" del mini-panell). */
  leaveRef?: { current: (() => void) | null };
}) {
  const { state, log, join, leave, sendFiles, sendText, accept, reject, cancel, chooseFolder, clearFolder } = useTransfer();
  const [draft, setDraft] = useState("");
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const send = () => {
    if (!draft.trim()) return;
    sendText(draft);
    setDraft("");
  };
  const [codeInput, setCodeInput] = useState("");
  const [lanOnly, setLanOnly] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const idle = state.phase === "idle" || state.phase === "failed";
  useEffect(() => {
    onBusyChange?.(!idle);
  }, [idle, onBusyChange]);

  // Avisa quan hi ha un fitxer en moviment (el fons dinàmic reacciona).
  const moving = state.items.some((i) => i.status === "active");
  useEffect(() => {
    onActiveChange?.(moving);
  }, [moving, onActiveChange]);

  const movingCount = state.items.filter((i) => i.status === "active").length;
  useEffect(() => {
    onSummary?.({ phase: state.phase, code: state.code, moving: movingCount });
  }, [state.phase, state.code, movingCount, onSummary]);
  useEffect(() => {
    if (leaveRef) leaveRef.current = () => void leave();
    return () => {
      if (leaveRef) leaveRef.current = null;
    };
  }, [leaveRef, leave]);

  const handleJoin = async () => {
    setFormError(null);
    const err = await join(codeInput, lanOnly);
    if (err) setFormError(err);
  };

  const handleFiles = (list: FileList | null) => {
    if (list && list.length > 0) sendFiles(Array.from(list));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sense permís de porta-retalls */
    }
  };

  const bigWithoutDisk = !state.canSaveToDisk;

  return (
    <div className="w-full max-w-lg mx-auto space-y-4">
      {idle && (
        <div className="relative space-y-4 panel p-6 chamfer animate-scale-in">
          <CornerFrame color="violet" />
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && void handleJoin()}
            placeholder="EX: PAELLA-77"
            maxLength={20}
            className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-violet-400/60"
          />
          <button
            onClick={() => void handleJoin()}
            disabled={!codeInput.trim()}
            className="w-full font-bold py-3 chamfer-sm bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:pointer-events-none text-black shadow-lg shadow-violet-500/20 transition-all"
          >
            Entrar a la sala →
          </button>
          <p className="text-[11px] text-gray-500 text-center">
            Inventa una paraula i digues-la a l'altra persona: qui l'escrigui primer crea la sala i el segon hi entra.
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" className="accent-violet-500" checked={lanOnly} onChange={(e) => setLanOnly(e.target.checked)} />
            📡 Només xarxa local (sense STUN/TURN)
          </label>
          {(formError || state.error) && (
            <p className="text-red-400 text-sm text-center">❌ {formError ?? (state.error ? ERROR_MESSAGES[state.error] : "")}</p>
          )}
        </div>
      )}

      {(state.phase === "waiting" || state.phase === "connecting") && (
        <div className="relative panel p-6 chamfer text-center space-y-3">
          <CornerFrame color="violet" />
          <div className="w-12 h-12 mx-auto border-4 border-white/10 border-t-violet-400 rounded-full animate-spin" />
          <p className="text-gray-200 text-sm">
            {state.phase === "waiting" ? "Esperant que algú entri amb aquesta paraula…" : "Establint connexió directa…"}
          </p>
          <button
            onClick={copyCode}
            title="Copia la paraula"
            className="font-mono tracking-widest text-lg text-violet-300 hover:text-violet-200"
          >
            {state.code} {copied ? "✔" : "⧉"}
          </button>
          {state.notice && <p className="text-amber-300 text-xs">{state.notice}</p>}
          <div>
            <button onClick={() => void leave()} className="text-xs text-gray-500 hover:text-red-300 underline">
              Cancel·la
            </button>
          </div>
        </div>
      )}

      {state.phase === "connected" && (
        <>
          <div className="relative panel p-4 chamfer space-y-3">
            <CornerFrame color="violet" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-emerald-300">● Connectat · sala <span className="font-mono tracking-widest">{state.code}</span></span>
              <button onClick={() => void leave()} className="text-gray-400 hover:text-red-300 underline">
                Sortir
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer text-center border-2 border-dashed chamfer-sm px-4 py-8 transition-colors ${
                dragging ? "border-violet-300 bg-violet-500/15" : "border-white/20 hover:border-violet-400/60 hover:bg-white/5"
              }`}
            >
              <p className="text-2xl">📁</p>
              <p className="text-sm text-gray-200 mt-1">Arrossega arxius aquí o clica per triar-los</p>
              <p className="text-[11px] text-gray-500 mt-1">Sense límit de mida · es poden triar-ne varis</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </div>

            {state.canPickFolder && (
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                {state.dirName ? (
                  <>
                    <span>📂 Desant automàticament a <span className="text-violet-300">{state.dirName}</span></span>
                    <button onClick={clearFolder} className="underline hover:text-white">
                      Treure
                    </button>
                  </>
                ) : (
                  <button onClick={chooseFolder} className="underline hover:text-white">
                    📂 Triar carpeta per desar sense preguntar cada cop
                  </button>
                )}
              </div>
            )}

            {bigWithoutDisk && (
              <p className="text-[11px] text-amber-300/90">
                ⚠️ Aquest navegador no pot desar directament a disc: el que rebis passa per la memòria RAM abans de
                descarregar-se. Per a arxius molt grans fes servir Chrome o Edge d'escriptori.
              </p>
            )}
          </div>

          {/* Xat de text: enllaços, contrasenyes, notes… per la mateixa connexió directa. */}
          <div className="panel chamfer p-4 space-y-3">
            {state.messages.length > 0 && (
              <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                {state.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`group max-w-[85%] chamfer-sm px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                        m.mine ? "bg-violet-500/20 text-violet-50" : "bg-white/[0.07] text-gray-100"
                      }`}
                    >
                      {m.text}
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(m.text).then(() => {
                            setCopiedMsg(m.id);
                            setTimeout(() => setCopiedMsg(null), 1200);
                          });
                        }}
                        className="ml-2 text-[11px] text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        {copiedMsg === m.id ? "Copiat" : "Copia"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Envia un missatge o un enllaç"
                aria-label="Missatge"
                maxLength={4000}
                className="flex-1 min-w-0 bg-black/40 border border-white/10 chamfer-sm px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-400/60"
              />
              <button
                onClick={send}
                disabled={!draft.trim()}
                className="chamfer-sm px-4 py-2 text-sm font-semibold bg-violet-500 hover:bg-violet-400 text-black disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                Envia
              </button>
            </div>
          </div>

          {state.items.length > 0 && (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {[...state.items].reverse().map((it) => (
                <ItemRow key={it.id} item={it} onAccept={() => accept(it.id)} onReject={() => reject(it.id)} onCancel={() => cancel(it.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {log.length > 0 && state.phase !== "connected" && (
        <div className="max-h-24 overflow-y-auto bg-black/40 border border-white/10 chamfer-sm p-2 text-[10px] text-gray-500 font-mono">
          {log.slice(-8).map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}
