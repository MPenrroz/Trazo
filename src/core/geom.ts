import type { Part, Plane, V2, V3 } from './types';

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const normal = (p: Plane): V3 => cross(p.x, p.y);

export const d2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Punto local (u, v, w) → mundo. */
export function toWorld(p: Plane, u: number, v: number, w = 0): V3 {
  return add(add(add(p.o, mul(p.x, u)), mul(p.y, v)), mul(normal(p), w));
}

export function polyArea(pts: V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polyPerimeter(pts: V2[], closed = true): number {
  let l = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) l += d2(pts[i], pts[(i + 1) % pts.length]);
  return l;
}

export function bounds2(pts: V2[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export const ccw = (pts: V2[]) => (polyArea(pts) < 0 ? [...pts].reverse() : pts);

/** Rectángulo local [0,w]×[0,h]. */
export const rect = (w: number, h: number): V2[] => [[0, 0], [w, 0], [w, h], [0, h]];

/**
 * Vértices cóncavos (interiores) de un polígono CCW: requieren dogbone o radio en CNC.
 * `minTurnDeg` ignora los quiebres suaves (p. ej. los segmentos de un arco), que la fresa sigue sin problema.
 */
export function reflexVertices(pts: V2[], minTurnDeg = 0): number[] {
  const p = ccw(pts);
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr >= -1e-6) continue;
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let turn = Math.abs(t2 - t1) * 180 / Math.PI;
    if (turn > 180) turn = 360 - turn;
    if (turn >= minTurnDeg) out.push(i);
  }
  return out;
}

/** Puntos de un arco de circunferencia (ángulos en radianes, incluye extremos). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): V2[] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V2; });
}

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];

/**
 * Crea una pieza rectangular alineada a ejes a partir de una caja [x,y,z]+[dx,dy,dz].
 * `axis` indica en qué eje va el espesor del tablero.
 */
export function boxPart(id: string, name: string, role: string, material: string,
  o: V3, size: V3, axis: 'x' | 'y' | 'z'): Part {
  const [dx, dy, dz] = size;
  if (axis === 'z') return { id, name, role, material, thickness: dz, plane: { o, x: X, y: Y }, profile: rect(dx, dy) };
  if (axis === 'x') return { id, name, role, material, thickness: dx, plane: { o, x: Y, y: Z }, profile: rect(dy, dz) };
  return { id, name, role, material, thickness: dy, plane: { o, x: Z, y: X }, profile: rect(dz, dx) };
}

/** Las 8 (o 2n) esquinas en mundo de la pieza extruida. */
export function partVertices(p: Part): V3[] {
  const out: V3[] = [];
  for (const [u, v] of p.profile) { out.push(toWorld(p.plane, u, v, 0)); out.push(toWorld(p.plane, u, v, p.thickness)); }
  return out;
}

export function bounds3(parts: Part[]) {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (const v of partVertices(p)) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
  if (!parts.length) return { min: [0, 0, 0] as V3, max: [0, 0, 0] as V3, size: [0, 0, 0] as V3 };
  return { min, max, size: sub(max, min) };
}

/** Área neta de material (mm²) de la pieza. */
export function partArea(p: Part): number {
  let a = Math.abs(polyArea(p.profile));
  for (const h of p.holes ?? []) a -= Math.abs(polyArea(h));
  return a;
}

/** Longitud total de corte (mm). */
export function partCutLength(p: Part): number {
  return polyPerimeter(p.profile) + (p.holes ?? []).reduce((s, h) => s + polyPerimeter(h), 0);
}

/** Ramer–Douglas–Peucker. */
export function rdp(pts: V2[], eps: number): V2[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1];
  let idx = -1, max = 0;
  const L = d2(a, b) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dist = L < 1e-6 ? d2(p, a) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
    if (dist > max) { max = dist; idx = i; }
  }
  if (max <= eps) return [a, b];
  const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
  return [...l.slice(0, -1), ...r];
}

/** Suavizado de Chaikin. */
export function chaikin(pts: V2[], closed: boolean, iters = 2): V2[] {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const out: V2[] = [];
    const n = closed ? p.length : p.length - 1;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

export const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 9);
export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
