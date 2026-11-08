// Curvas suaves para siluetas: spline que pasa por los puntos (Catmull-Rom uniforme) con esquinas automáticas.
// Cada tramo es una Bézier cúbica exacta: se exporta como NURBS (Rhino) o arcos (DXF para CNC).
import type { V2 } from './types';

export type Bezier = [V2, V2, V2, V2];

/** Vértices que son esquinas: el contorno gira más que `deg` grados en ellos. */
export function corners(pts: V2[], closed: boolean, deg = 50): boolean[] {
  const n = pts.length;
  return pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
    const t1 = Math.atan2(p[1] - a[1], p[0] - a[0]), t2 = Math.atan2(c[1] - p[1], c[0] - p[0]);
    let turn = Math.abs(t2 - t1) * 180 / Math.PI;
    if (turn > 180) turn = 360 - turn;
    return turn > deg;
  });
}

/**
 * Tramos Bézier de una curva que pasa por todos los puntos. En una esquina la tangente sigue el lado,
 * así que entre dos esquinas el tramo es recto (rectángulos y bases quedan rectos).
 */
export function toBeziers(pts: V2[], closed = true): Bezier[] {
  const n = pts.length;
  if (n < 2) return [];
  const cor = corners(pts, closed);
  const P = (i: number) => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  const out: Bezier[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = P(i), p2 = P(i + 1);
    const m1: V2 = cor[i % n] ? [p2[0] - p1[0], p2[1] - p1[1]] : [(p2[0] - P(i - 1)[0]) / 2, (p2[1] - P(i - 1)[1]) / 2];
    const j = (i + 1) % n;
    const m2: V2 = cor[j] ? [p2[0] - p1[0], p2[1] - p1[1]] : [(P(i + 2)[0] - p1[0]) / 2, (P(i + 2)[1] - p1[1]) / 2];
    out.push([p1, [p1[0] + m1[0] / 3, p1[1] + m1[1] / 3], [p2[0] - m2[0] / 3, p2[1] - m2[1] / 3], p2]);
  }
  return out;
}

export function bezierAt([a, b, c, d]: Bezier, t: number): V2 {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]];
}

const isLine = ([a, b, c, d]: Bezier) => {
  const dx = d[0] - a[0], dy = d[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  const off = (p: V2) => Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
  return off(b) < 1e-6 * L + 1e-9 && off(c) < 1e-6 * L + 1e-9;
};

/** Polígono denso que sigue la curva (para 3D, planos y anidado). Los tramos rectos no se subdividen. */
export function sampleLoop(pts: V2[], closed = true, maxPerSeg = 12, stepMm = 4): V2[] {
  const out: V2[] = [];
  for (const bz of toBeziers(pts, closed)) {
    if (isLine(bz)) { out.push(bz[0]); continue; }
    const len = Math.hypot(bz[1][0] - bz[0][0], bz[1][1] - bz[0][1]) + Math.hypot(bz[2][0] - bz[1][0], bz[2][1] - bz[1][1]) + Math.hypot(bz[3][0] - bz[2][0], bz[3][1] - bz[2][1]);
    const k = Math.max(2, Math.min(maxPerSeg, Math.ceil(len / stepMm)));
    for (let j = 0; j < k; j++) out.push(bezierAt(bz, j / k));
  }
  if (!closed && pts.length) out.push(pts[pts.length - 1]);
  return out;
}

/** Círculo por tres puntos (o null si son colineales). */
function circle3(a: V2, b: V2, c: V2): { c: V2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}

/** Vértice de polilínea con "bulge" (DXF): tan(ángulo/4) del arco que va al siguiente vértice; 0 = recta. */
export interface BulgeVertex { p: V2; bulge: number }

/**
 * Aproxima la curva con arcos tangentes a tramos dentro de `tol` (mm): lo ideal para CNC (G2/G3).
 * Devuelve vértices con bulge para una POLYLINE cerrada.
 */
export function toArcs(pts: V2[], closed = true, tol = 0.05): BulgeVertex[] {
  const out: BulgeVertex[] = [];
  const fit = (bz: Bezier, t0: number, t1: number, depth: number) => {
    const a = bezierAt(bz, t0), b = bezierAt(bz, t1), m = bezierAt(bz, (t0 + t1) / 2);
    const ci = circle3(a, m, b);
    const q1 = bezierAt(bz, t0 + (t1 - t0) * 0.25), q3 = bezierAt(bz, t0 + (t1 - t0) * 0.75);
    if (!ci) {
      // colineal: recta si los puntos intermedios también están en la recta
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      const off = (p: V2) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L;
      if ((off(q1) < tol && off(q3) < tol) || depth > 12) { out.push({ p: a, bulge: 0 }); return; }
    } else {
      const err = Math.max(Math.abs(Math.hypot(q1[0] - ci.c[0], q1[1] - ci.c[1]) - ci.r), Math.abs(Math.hypot(q3[0] - ci.c[0], q3[1] - ci.c[1]) - ci.r));
      if (err < tol || depth > 12) {
        // ángulo barrido con signo (a → m → b)
        const ang = (p: V2) => Math.atan2(p[1] - ci.c[1], p[0] - ci.c[0]);
        const norm = (x: number) => { while (x <= -Math.PI) x += 2 * Math.PI; while (x > Math.PI) x -= 2 * Math.PI; return x; };
        const sweep = norm(ang(m) - ang(a)) + norm(ang(b) - ang(m));
        out.push({ p: a, bulge: Math.tan(sweep / 4) });
        return;
      }
    }
    const tm = (t0 + t1) / 2;
    fit(bz, t0, tm, depth + 1); fit(bz, tm, t1, depth + 1);
  };
  for (const bz of toBeziers(pts, closed)) {
    if (isLine(bz)) out.push({ p: bz[0], bulge: 0 });
    else fit(bz, 0, 1, 0);
  }
  if (!closed && pts.length) out.push({ p: pts[pts.length - 1], bulge: 0 });
  return out;
}

/** Puntos del arco con bulge (para verificar o dibujar). */
export function arcPoints(a: V2, b: V2, bulge: number, n = 8): V2[] {
  if (Math.abs(bulge) < 1e-12) return [a];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const d = r * Math.cos(theta / 2);
  const ux = (b[0] - a[0]) / chord, uy = (b[1] - a[1]) / chord;
  const cx = mx - uy * d, cy = my + ux * d;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  return Array.from({ length: n }, (_, k) => { const t = a0 + (theta * k) / n; return [cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)] as V2; });
}
