import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBoard } from "../../hooks/useBoard";
import { BOARD_ERRORS, BOARD_H, BOARD_W, colorOf, type Background, type BoardElement, type BoardSession } from "../../lib/whiteboard";
import CornerFrame from "../common/CornerFrame";

/**
 * 🎨 Pissarra compartida: llenç + eines. Idèntica a web-guest i a l'app
 * d'escriptori (i es poden barrejar a la mateixa paraula).
 */

type Tool = "pen" | "line" | "arrow" | "rect" | "ellipse" | "text" | "eraser";
const COLORS = ["ink", "#fb7185", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9"];
const WIDTHS = [3, 6, 12];
const TEXT_SIZES = [32, 48, 80];
const CURSOR_LIFE_MS = 3000;

export interface BoardSummary {
  active: boolean;
  code: string;
  people: number;
}

const inkColor = (bg: Background) => (bg === "dark" ? "#f8fafc" : "#111827");
const resolve = (c: string, bg: Background) => (c === "ink" ? inkColor(bg) : c);

// ── Dibuix ───────────────────────────────────────────────────────────────

function drawElement(ctx: CanvasRenderingContext2D, el: BoardElement, bg: Background) {
  ctx.strokeStyle = resolve(el.color, bg);
  ctx.fillStyle = resolve(el.color, bg);
  ctx.lineWidth = el.w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (el.kind === "stroke" && el.pts) {
    const p = el.pts;
    ctx.beginPath();
    if (p.length <= 2) {
      ctx.arc(p[0], p[1], el.w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(p[0], p[1]);
    // Corbes quadràtiques pels punts mitjans: traç suau sense "escalons".
    for (let i = 2; i < p.length - 2; i += 2) ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  } else if (el.kind === "line" || el.kind === "arrow") {
    const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = el;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (el.kind === "arrow") {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const h = 14 + el.w * 2.2;
      ctx.beginPath();
      ctx.moveTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45));
      ctx.stroke();
    }
  } else if (el.kind === "rect") {
    const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = el;
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (el.kind === "ellipse") {
    const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = el;
    ctx.beginPath();
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (el.kind === "text" && el.text) {
    const size = el.size ?? 48;
    ctx.font = `600 ${size}px "Onest", system-ui, sans-serif`;
    ctx.textBaseline = "top";
    el.text.split("\n").forEach((line, i) => ctx.fillText(line, el.x1 ?? 0, (el.y1 ?? 0) + i * size * 1.2));
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** És el punt prou a prop de l'element per esborrar-lo? */
function hits(el: BoardElement, x: number, y: number): boolean {
  const tol = 14 + el.w / 2;
  if (el.kind === "stroke" && el.pts) {
    const p = el.pts;
    if (p.length <= 2) return Math.hypot(x - p[0], y - p[1]) < tol;
    for (let i = 0; i < p.length - 2; i += 2) if (distToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < tol) return true;
    return false;
  }
  const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = el;
  if (el.kind === "line" || el.kind === "arrow") return distToSegment(x, y, x1, y1, x2, y2) < tol;
  if (el.kind === "rect") {
    const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), b = Math.max(y1, y2);
    return (
      distToSegment(x, y, l, t, r, t) < tol || distToSegment(x, y, r, t, r, b) < tol || distToSegment(x, y, r, b, l, b) < tol || distToSegment(x, y, l, b, l, t) < tol
    );
  }
  if (el.kind === "ellipse") {
    const rx = Math.max(1, Math.abs(x2 - x1) / 2), ry = Math.max(1, Math.abs(y2 - y1) / 2);
    const nx = (x - (x1 + x2) / 2) / rx, ny = (y - (y1 + y2) / 2) / ry;
    return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) < tol;
  }
  if (el.kind === "text") {
    const size = el.size ?? 48;
    const lines = (el.text ?? "").split("\n");
    const w = Math.max(...lines.map((l) => l.length)) * size * 0.6;
    return x >= x1 - 8 && x <= x1 + w + 8 && y >= y1 - 8 && y <= y1 + lines.length * size * 1.2 + 8;
  }
  return false;
}

function paintBoard(ctx: CanvasRenderingContext2D, els: BoardElement[], bg: Background) {
  ctx.fillStyle = bg === "dark" ? "#0b0f14" : "#fbfbf8";
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  for (const el of els) drawElement(ctx, el, bg);
}

// ── Llenç ────────────────────────────────────────────────────────────────

function BoardCanvas({ session, bg, tool, color, widthIdx }: { session: BoardSession; bg: Background; tool: Tool; color: string; widthIdx: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const layerRev = useRef(-1);
  const layerBg = useRef<Background | null>(null);
  const rafRef = useRef(0);
  const strokeId = useRef<string | null>(null);
  const shapeStart = useRef<{ x: number; y: number } | null>(null);
  const preview = useRef<BoardElement | null>(null);
  const erasing = useRef(false);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");

  const props = useRef({ bg, tool, color, widthIdx });
  props.current = { bg, tool, color, widthIdx };

  const render = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { bg: curBg } = props.current;
    const scale = canvas.width / BOARD_W;

    // Capa fixa (elements confirmats): només es repinta si ha canviat.
    if (!layerRef.current) layerRef.current = document.createElement("canvas");
    const layer = layerRef.current;
    if (layer.width !== canvas.width || layer.height !== canvas.height || layerRev.current !== session.rev || layerBg.current !== curBg) {
      layer.width = canvas.width;
      layer.height = canvas.height;
      const lctx = layer.getContext("2d")!;
      lctx.setTransform(scale, 0, 0, scale, 0, 0);
      paintBoard(lctx, session.getElements(), curBg);
      layerRev.current = session.rev;
      layerBg.current = curBg;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const el of session.live.values()) drawElement(ctx, el, curBg);
    if (preview.current) drawElement(ctx, preview.current, curBg);

    // Cursors dels altres (es desdibuixen als 3 s sense moure's).
    const now = performance.now();
    let animating = session.live.size > 0 || !!preview.current;
    for (const [id, cur] of session.cursors) {
      const age = now - cur.at;
      if (age > CURSOR_LIFE_MS) continue;
      animating = true;
      const c = colorOf(id);
      ctx.globalAlpha = Math.max(0, 1 - age / CURSOR_LIFE_MS);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(cur.x, cur.y);
      ctx.lineTo(cur.x + 5, cur.y + 30);
      ctx.lineTo(cur.x + 14, cur.y + 22);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (animating) rafRef.current = requestAnimationFrame(render);
  }, [session]);

  const requestRender = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(render);
  }, [render]);

  // Mida del llenç = mida CSS × densitat de píxels (limitada).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(320, Math.round(wrap.clientWidth * dpr));
      canvas.width = w;
      canvas.height = Math.round((w * BOARD_H) / BOARD_W);
      requestRender();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    const off = session.onDirty(requestRender);
    return () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [session, requestRender]);

  useEffect(requestRender, [bg, requestRender]);

  const toLogical = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(BOARD_W, ((e.clientX - r.left) / r.width) * BOARD_W)), y: Math.max(0, Math.min(BOARD_H, ((e.clientY - r.top) / r.height) * BOARD_H)) };
  };

  const eraseAt = (x: number, y: number) => {
    const els = session.getElements();
    for (let i = els.length - 1; i >= 0; i--) {
      if (hits(els[i], x, y)) {
        session.remove(els[i].id);
        return;
      }
    }
  };

  const commitText = useCallback(() => {
    if (textAt && textValue.trim()) session.addText(props.current.color, TEXT_SIZES[props.current.widthIdx], textAt.x, textAt.y, textValue);
    setTextAt(null);
    setTextValue("");
  }, [session, textAt, textValue]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (textAt) commitText();
    const { tool: t, color: c, widthIdx: wi } = props.current;
    const p = toLogical(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (t === "pen") strokeId.current = session.beginStroke(c, WIDTHS[wi], p.x, p.y);
    else if (t === "eraser") {
      erasing.current = true;
      eraseAt(p.x, p.y);
    } else if (t === "text") {
      e.preventDefault();
      setTextAt(p);
    } else shapeStart.current = p;
    requestRender();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool: t, color: c, widthIdx: wi } = props.current;
    const p = toLogical(e);
    session.cursor(p.x, p.y);
    if (strokeId.current && t === "pen") {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const q = toLogical(ev);
        strokeId.current = session.extendStroke(strokeId.current!, q.x, q.y);
      }
    } else if (erasing.current) eraseAt(p.x, p.y);
    else if (shapeStart.current && (t === "line" || t === "arrow" || t === "rect" || t === "ellipse")) {
      const s = shapeStart.current;
      preview.current = { id: "preview", author: "me", kind: t, color: c, w: WIDTHS[wi], x1: s.x, y1: s.y, x2: p.x, y2: p.y };
      requestRender();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool: t, color: c, widthIdx: wi } = props.current;
    if (strokeId.current) {
      session.endStroke(strokeId.current);
      strokeId.current = null;
    }
    erasing.current = false;
    if (shapeStart.current && (t === "line" || t === "arrow" || t === "rect" || t === "ellipse")) {
      const s = shapeStart.current;
      const p = toLogical(e);
      if (Math.hypot(p.x - s.x, p.y - s.y) > 6) session.addShape(t, c, WIDTHS[wi], s.x, s.y, p.x, p.y);
    }
    shapeStart.current = null;
    preview.current = null;
    requestRender();
  };

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Pissarra compartida"
        className="absolute inset-0 w-full h-full chamfer-sm"
        style={{ touchAction: "none", cursor: tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair" }}
      />
      {textAt && (
        <textarea
          autoFocus
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setTextAt(null);
              setTextValue("");
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            }
          }}
          placeholder="Escriu i prem Enter"
          rows={1}
          className="absolute bg-black/70 text-white border border-white/30 rounded px-2 py-1 text-sm outline-none"
          style={{ left: `${(textAt.x / BOARD_W) * 100}%`, top: `${(textAt.y / BOARD_H) * 100}%`, minWidth: 140 }}
        />
      )}
    </div>
  );
}

// ── Eines (icones) ───────────────────────────────────────────────────────

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: "pen", label: "Llapis", icon: <Icon><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /></Icon> },
  { id: "line", label: "Línia", icon: <Icon><path d="M5 19 19 5" /></Icon> },
  { id: "arrow", label: "Fletxa", icon: <Icon><path d="M5 19 19 5M10 5h9v9" /></Icon> },
  { id: "rect", label: "Rectangle", icon: <Icon><rect x="4" y="6" width="16" height="12" rx="1" /></Icon> },
  { id: "ellipse", label: "El·lipse", icon: <Icon><ellipse cx="12" cy="12" rx="8" ry="6" /></Icon> },
  { id: "text", label: "Text", icon: <Icon><path d="M5 6h14M12 6v13M9 19h6" /></Icon> },
  { id: "eraser", label: "Goma (esborra un element)", icon: <Icon><path d="m16 4 4 4-9 9H7l-3-3zM12 20h8" /></Icon> },
];

// ── Panell ───────────────────────────────────────────────────────────────

export default function BoardPanel({
  onBusyChange,
  onSummary,
  leaveRef,
}: {
  onBusyChange?: (busy: boolean) => void;
  onSummary?: (s: BoardSummary) => void;
  leaveRef?: { current: (() => void) | null };
}) {
  const { state, session, join, leave } = useBoard();
  const [codeInput, setCodeInput] = useState("");
  const [name, setName] = useState("");
  const [lanOnly, setLanOnly] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("ink");
  const [widthIdx, setWidthIdx] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);

  const inBoard = state.phase === "ready" && !!session;
  useEffect(() => onBusyChange?.(state.phase === "connecting" || state.phase === "ready"), [state.phase, onBusyChange]);
  useEffect(() => {
    onSummary?.({ active: inBoard, code: state.code, people: state.members.length + 1 });
  }, [inBoard, state.code, state.members.length, onSummary]);
  useEffect(() => {
    if (leaveRef) leaveRef.current = () => void leave();
    return () => {
      if (leaveRef) leaveRef.current = null;
    };
  }, [leaveRef, leave]);

  // Ctrl/Cmd+Z = desfer.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        session.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  const go = async () => {
    setFormError(null);
    const err = await join(codeInput, name.trim().slice(0, 20), lanOnly);
    if (err) setFormError(err);
  };

  const download = () => {
    if (!session) return;
    const c = document.createElement("canvas");
    c.width = BOARD_W;
    c.height = BOARD_H;
    paintBoard(c.getContext("2d")!, session.getElements(), state.bg);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pissarra-${state.code}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  };

  if (!inBoard) {
    return (
      <div className="w-full max-w-lg mx-auto">
        <div className="panel chamfer relative p-6 space-y-4 animate-scale-in">
          <CornerFrame color="amber" />
          {state.phase === "connecting" ? (
            <div className="text-center space-y-3 py-4">
              <div className="w-12 h-12 mx-auto border-4 border-white/10 border-t-amber-400 rounded-full animate-spin" />
              <p className="text-sm text-gray-200">Entrant a la pissarra…</p>
            </div>
          ) : (
            <>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="El teu nom (opcional)"
                maxLength={20}
                aria-label="El teu nom"
                className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-2.5 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-amber-400/60"
              />
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && codeInput.trim() && void go()}
                placeholder="EX: IDEES-2026"
                maxLength={20}
                aria-label="Paraula de la pissarra"
                className="w-full bg-black/40 border border-white/10 chamfer-sm px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder:text-gray-700 focus:outline-none focus:border-amber-400/60"
              />
              <button
                onClick={() => void go()}
                disabled={!codeInput.trim()}
                className="w-full chamfer-sm py-3 font-bold bg-amber-400 hover:bg-amber-300 text-black disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                Obrir la pissarra →
              </button>
              <p className="text-[11px] text-gray-500 text-center">Fins a 6 persones amb la mateixa paraula, des del navegador o l'app d'escriptori.</p>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" className="accent-amber-400" checked={lanOnly} onChange={(e) => setLanOnly(e.target.checked)} />
                Només xarxa local (sense STUN/TURN)
              </label>
              {(formError || state.error) && (
                <p role="alert" className="text-red-300 text-sm text-center">
                  {formError ?? (state.error ? BOARD_ERRORS[state.error] : "")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      {/* Barra superior: paraula, persones, accions */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(state.code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
          title="Copia la paraula"
          className="font-mono tracking-widest text-amber-300 hover:text-amber-200 text-sm"
        >
          ● {state.code} {copied ? "✔" : "⧉"}
        </button>
        <ul className="flex items-center gap-2 text-gray-300" aria-label="Participants">
          <li className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-white" /> Tu
          </li>
          {state.members.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5" title={m.connected ? "Connectat" : "Connectant…"}>
              <span className={`w-2 h-2 rounded-full ${m.connected ? "" : "animate-pulse opacity-60"}`} style={{ background: m.color }} />
              <span className="max-w-[90px] truncate">{m.nickname}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel chamfer-sm p-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="toolbar" aria-label="Eines" className="flex gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              aria-pressed={tool === t.id}
              title={t.label}
              aria-label={t.label}
              className={`chamfer-sm w-9 h-9 flex items-center justify-center transition-colors ${tool === t.id ? "bg-amber-400 text-black" : "text-gray-300 hover:bg-white/10"}`}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Color">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              aria-label={c === "ink" ? "Tinta" : `Color ${c}`}
              title={c === "ink" ? "Tinta (s'adapta al fons)" : c}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? "border-white scale-110" : "border-white/20"}`}
              style={{ background: c === "ink" ? (state.bg === "dark" ? "#f8fafc" : "#111827") : c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Gruix">
          {WIDTHS.map((w, i) => (
            <button
              key={w}
              onClick={() => setWidthIdx(i)}
              aria-pressed={widthIdx === i}
              aria-label={`Gruix ${i + 1}`}
              className={`w-8 h-8 flex items-center justify-center chamfer-sm ${widthIdx === i ? "bg-white/15" : "hover:bg-white/10"}`}
            >
              <span className="rounded-full bg-gray-200" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto text-xs">
          <button onClick={() => session?.undo()} title="Desfés (Ctrl+Z)" className="chamfer-sm px-3 py-2 text-gray-200 hover:bg-white/10">
            Desfés
          </button>
          <button
            onClick={() => session?.setBackground(state.bg === "dark" ? "light" : "dark")}
            title="Canvia el fons (per a tothom)"
            className="chamfer-sm px-3 py-2 text-gray-200 hover:bg-white/10"
          >
            {state.bg === "dark" ? "Fons clar" : "Fons fosc"}
          </button>
          <button onClick={download} title="Descarrega com a imatge PNG" className="chamfer-sm px-3 py-2 text-gray-200 hover:bg-white/10">
            Descarrega
          </button>
          {confirmClear ? (
            <button
              onClick={() => {
                session?.clear();
                setConfirmClear(false);
              }}
              onBlur={() => setConfirmClear(false)}
              autoFocus
              className="chamfer-sm px-3 py-2 bg-red-500/80 hover:bg-red-500 text-white font-semibold"
            >
              Segur? Esborra-ho tot
            </button>
          ) : (
            <button onClick={() => setConfirmClear(true)} className="chamfer-sm px-3 py-2 text-gray-200 hover:bg-white/10">
              Neteja
            </button>
          )}
          <button onClick={() => void leave()} className="chamfer-sm px-3 py-2 text-gray-400 hover:text-white hover:bg-white/10">
            Sortir
          </button>
        </div>
      </div>

      <div className="border border-white/10 chamfer-sm overflow-hidden bg-black">
        <BoardCanvas session={session!} bg={state.bg} tool={tool} color={color} widthIdx={widthIdx} />
      </div>
      {state.members.length === 0 && <p className="text-center text-xs text-gray-500">Esperant que algú entri amb aquesta paraula… Mentrestant pots dibuixar.</p>}
    </div>
  );
}
