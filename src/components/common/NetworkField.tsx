import { useEffect, useRef } from "react";

/**
 * Fons dinàmic de LVCLITS: una xarxa de nodes que deriven lentament, units
 * per línies fines, amb paquets que viatgen d'un node a un altre — és el
 * que fa el producte (connexions directes entre persones), dibuixat com a
 * ambient. El color s'adapta a l'eina activa (transició suau) i la
 * `intensity` puja el nombre de paquets: p. ex. mentre es transfereix un fitxer.
 *
 * Idèntic a web-guest i a l'app d'escriptori. Es pinta en un <canvas> fix
 * de tota la finestra, pausa quan la pestanya s'amaga, limita a 30 fps en
 * pantalles tàctils i, amb "reduir moviment", es queda en una imatge fixa.
 */

export type FieldAccent = "orange" | "cyan" | "emerald" | "violet" | "rose" | "amber" | "brand";

type RGB = [number, number, number];
const PALETTE: Record<FieldAccent, { main: RGB; packet: RGB }> = {
  orange: { main: [251, 146, 60], packet: [255, 214, 170] },
  cyan: { main: [34, 211, 238], packet: [190, 245, 252] },
  emerald: { main: [52, 211, 153], packet: [190, 250, 225] },
  violet: { main: [167, 139, 250], packet: [225, 215, 255] },
  amber: { main: [251, 191, 36], packet: [253, 230, 138] },
  rose: { main: [251, 113, 133], packet: [255, 205, 212] },
  // Identitat de marca (logo): nodes cian, paquets taronja.
  brand: { main: [34, 211, 238], packet: [251, 146, 60] },
};

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ph: number;
}
interface Packet {
  a: Node;
  b: Node;
  t: number;
  speed: number;
}

interface NetworkFieldProps {
  accent?: FieldAccent;
  /** 0 = tranquil, 1 = molta activitat (més paquets i línies més vives). */
  intensity?: number;
  className?: string;
}

export default function NetworkField({ accent = "brand", intensity = 0.4, className = "" }: NetworkFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef({ accent, intensity });
  targetRef.current = { accent, intensity };
  const snapRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    // 30 fps: la deriva és lenta i a 60 fps gastaria el doble sense que es notés.
    const minFrame = 1000 / 30;

    let w = 0;
    let h = 0;
    let nodes: Node[] = [];
    let packets: Packet[] = [];
    let linkDist = 150;
    const pointer = { x: -9999, y: -9999 };
    const start = PALETTE[targetRef.current.accent];
    const cur = { main: [...start.main] as RGB, packet: [...start.packet] as RGB, k: targetRef.current.intensity };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(22, Math.min(64, Math.round((w * h) / (coarse ? 22000 : 15000))));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 22,
        vy: (Math.random() - 0.5) * 22,
        r: 1.3 + Math.random() * 1.3,
        ph: Math.random() * Math.PI * 2,
      }));
      packets = [];
      linkDist = Math.max(120, Math.min(190, Math.sqrt((w * h) / count) * 1.5));
      draw();
    };

    const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    const step = (dt: number) => {
      const target = targetRef.current;
      const pal = PALETTE[target.accent];
      const f = Math.min(1, dt * 3);
      for (let i = 0; i < 3; i++) {
        cur.main[i] += (pal.main[i] - cur.main[i]) * f;
        cur.packet[i] += (pal.packet[i] - cur.packet[i]) * f;
      }
      cur.k += (target.intensity - cur.k) * Math.min(1, dt * 2);

      const speed = 0.6 + cur.k * 0.9;
      for (const n of nodes) {
        n.x += n.vx * dt * speed;
        n.y += n.vy * dt * speed;
        n.ph += dt * 1.4;
        if (n.x < -20) n.x = w + 20;
        else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        else if (n.y > h + 20) n.y = -20;
      }

      // Paquets: neixen sobre enllaços existents i els recorren d'extrem a extrem.
      const rate = 0.5 + cur.k * 7;
      if (packets.length < 44 && Math.random() < rate * dt) {
        const a = nodes[(Math.random() * nodes.length) | 0];
        const near = nodes.filter((b) => b !== a && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < linkDist * linkDist);
        if (near.length) {
          packets.push({ a, b: near[(Math.random() * near.length) | 0], t: 0, speed: (0.7 + Math.random() * 0.5) * (0.8 + cur.k * 0.8) });
        }
      }
      for (const p of packets) p.t += dt * p.speed;
      packets = packets.filter((p) => p.t < 1);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const L2 = linkDist * linkDist;
      const base = 0.17 + cur.k * 0.22;
      ctx.lineWidth = 1;

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > L2) continue;
          const q = 1 - Math.sqrt(d2) / linkDist;
          ctx.strokeStyle = rgba(cur.main, base * q * 1.5);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        const pd = Math.hypot(n.x - pointer.x, n.y - pointer.y);
        const near = pd < 170 ? 1 - pd / 170 : 0;
        const pulse = 0.5 + 0.5 * Math.sin(n.ph);
        ctx.fillStyle = rgba(cur.main, 0.42 + pulse * 0.25 + near * 0.5);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + near * 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (near > 0.15) {
          ctx.strokeStyle = rgba(cur.main, near * 0.4);
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
      }

      for (const p of packets) {
        const x = p.a.x + (p.b.x - p.a.x) * p.t;
        const y = p.a.y + (p.b.y - p.a.y) * p.t;
        const t0 = Math.max(0, p.t - 0.14);
        const fade = Math.sin(Math.PI * p.t);
        ctx.strokeStyle = rgba(cur.packet, 0.55 * fade);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.a.x + (p.b.x - p.a.x) * t0, p.a.y + (p.b.y - p.a.y) * t0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = rgba(cur.packet, 0.95 * fade);
        ctx.beginPath();
        ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 1;
    };

    // Amb "reduir moviment" només es repinta quan canvia el color/mida.
    snapRef.current = () => {
      const t = targetRef.current;
      cur.main = [...PALETTE[t.accent].main] as RGB;
      cur.packet = [...PALETTE[t.accent].packet] as RGB;
      cur.k = t.intensity;
      if (reduce) draw();
    };

    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const el = ts - last;
      if (el < minFrame) return;
      last = ts;
      step(Math.min(0.05, el / 1000));
      draw();
    };
    // Només anima quan la finestra és visible I té el focus: mentre jugues a
    // un altre programa (o transmets) el fons no gasta ni CPU ni GPU.
    const shouldRun = () => !document.hidden && document.hasFocus();
    const sync = () => {
      if (reduce) return;
      if (shouldRun()) {
        if (!raf) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onPointer = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("focus", sync);
      window.addEventListener("blur", sync);
      document.addEventListener("visibilitychange", sync);
      sync();
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  useEffect(() => {
    snapRef.current();
  }, [accent]);

  return <canvas ref={canvasRef} aria-hidden className={`fixed inset-0 w-full h-full pointer-events-none ${className}`} />;
}
