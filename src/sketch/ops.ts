// Operaciones de edición del boceto (puras, en px de lienzo).
import { d2 } from '../core/geom';
import type { SketchEl, V2 } from '../core/types';

/**
 * Cambia el largo del lado i (de pts[i] a pts[i+1]) "estirando" la forma: todos los vértices que están
 * en el extremo final del lado o más allá se desplazan en la dirección del lado. Así un rectángulo sigue
 * siendo rectángulo y un polígono conserva sus ángulos.
 */
export function stretchSegment(pts: V2[], i: number, newLen: number, closed: boolean): V2[] {
  const n = pts.length;
  const a = pts[i], b = pts[(i + 1) % n];
  const L = d2(a, b);
  if (L < 1e-9 || newLen <= 0 || (!closed && i >= n - 1)) return pts.slice();
  const dir: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const delta = newLen - L;
  const eps = Math.max(0.5, L * 1e-3);
  return pts.map((p) => {
    const t = (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1];
    return t >= L - eps ? [p[0] + dir[0] * delta, p[1] + dir[1] * delta] as V2 : [p[0], p[1]] as V2;
  });
}

const mirrorPt = ([x, y]: V2, axisX: number): V2 => [2 * axisX - x, y];

/**
 * Media silueta → silueta completa: si un trazo abierto empieza y termina sobre el eje,
 * se refleja y se une en una forma cerrada.
 */
export function mirrorClose(pts: V2[], axisX: number, tol: number): V2[] | null {
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.abs(first[0] - axisX) > tol || Math.abs(last[0] - axisX) > tol) return null;
  const half: V2[] = pts.map((p) => [p[0], p[1]]);
  half[0] = [axisX, first[1]];
  half[half.length - 1] = [axisX, last[1]];
  const mid = half.slice(1, -1);
  return [...half, ...mid.reverse().map((p) => mirrorPt(p, axisX))];
}

/** Copia reflejada de un elemento respecto de un eje vertical. */
export function mirrorEl(e: SketchEl, axisX: number, id: string): SketchEl {
  if (e.kind === 'circle') return { ...e, id, c: mirrorPt(e.c, axisX) };
  if (e.kind === 'dim') return { ...e, id, a: mirrorPt(e.a, axisX), b: mirrorPt(e.b, axisX) };
  // el orden se invierte para mantener el sentido de giro del polígono
  return { ...e, id, pts: e.pts.map((p) => mirrorPt(p, axisX)).reverse() } as SketchEl;
}

export function translateEl(e: SketchEl, dx: number, dy: number): SketchEl {
  const t = ([x, y]: V2): V2 => [x + dx, y + dy];
  if (e.kind === 'circle') return { ...e, c: t(e.c) };
  if (e.kind === 'dim') return { ...e, a: t(e.a), b: t(e.b) };
  return { ...e, pts: e.pts.map(t) } as SketchEl;
}

export function elPoints(e: SketchEl): V2[] {
  if (e.kind === 'circle') return [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]];
  if (e.kind === 'dim') return [e.a, e.b];
  return e.pts;
}

/** Índice del vértice más cercano dentro de la tolerancia, o -1. */
export function vertexAt(pts: V2[], p: V2, tol: number): number {
  let best = -1, bd = tol;
  pts.forEach((q, i) => { const d = d2(p, q); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** Índice del lado más cercano dentro de la tolerancia, o -1. */
export function segmentAt(pts: V2[], closed: boolean, p: V2, tol: number): number {
  let best = -1, bd = tol;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const d = d2(p, [a[0] + t * dx, a[1] + t * dy]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
