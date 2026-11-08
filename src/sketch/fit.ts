import { bounds2, ccw, d2, polyPerimeter, rdp, uid } from '../core/geom';
import type { SketchDoc, SketchEl, V2 } from '../core/types';

export interface FitOpts {
  /** Tolerancia de simplificación (px de lienzo). */
  eps: number;
  /** Distancia para considerar un trazo cerrado. */
  closeTol: number;
  /** Ajustar ángulos a múltiplos de 15° (0/45/90 priorizados). */
  snapAngle: boolean;
  /** Puntos existentes a los que imantar extremos. */
  snapPts: V2[];
  snapTol: number;
}

const snapTo = (p: V2, pts: V2[], tol: number): V2 => {
  let best: V2 | null = null, bd = tol;
  for (const q of pts) { const d = d2(p, q); if (d < bd) { bd = d; best = q; } }
  return best ? [best[0], best[1]] : p;
};

function snapAngle(a: number): number {
  const deg = (a * 180) / Math.PI;
  for (const step of [90, 45, 15]) {
    const r = Math.round(deg / step) * step;
    if (Math.abs(r - deg) < (step === 90 ? 9 : step === 45 ? 6 : 3)) return (r * Math.PI) / 180;
  }
  return a;
}

/**
 * "Tinta inteligente": convierte un trazo a mano alzada en geometría limpia.
 * - casi circular y cerrado → círculo
 * - pocos tramos → polilínea recta con ángulos imantados (líneas, rectángulos, polígonos)
 * - muchos tramos → curva suavizada (siluetas orgánicas)
 */
export function fitStroke(raw: V2[], o: FitOpts): SketchEl | null {
  if (raw.length < 2) return null;
  const L = polyPerimeter(raw, false);
  if (L < o.eps * 2) return null;
  const closed = raw.length > 4 && d2(raw[0], raw[raw.length - 1]) < Math.max(o.closeTol, L * 0.08) && L > o.closeTol * 3;

  if (closed) {
    const n = raw.length;
    const c: V2 = [raw.reduce((s, p) => s + p[0], 0) / n, raw.reduce((s, p) => s + p[1], 0) / n];
    const rs = raw.map((p) => d2(p, c));
    const r = rs.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(rs.reduce((s, x) => s + (x - r) ** 2, 0) / n);
    if (sd / r < 0.09 && rdp(raw, o.eps).length > 6) return { id: uid('c'), kind: 'circle', c, r };
  }

  let simp = rdp(raw, o.eps);
  if (closed && simp.length > 2 && d2(simp[0], simp[simp.length - 1]) < Math.max(o.closeTol, L * 0.08)) simp = simp.slice(0, -1);
  simp = mergeCollinear(simp, closed, 14);

  if (simp.length - (closed ? 0 : 1) <= 8) {
    const out: V2[] = [snapTo(simp[0], o.snapPts, o.snapTol)];
    for (let i = 1; i < simp.length; i++) {
      const prev = out[i - 1], target = simp[i];
      let ang = Math.atan2(target[1] - simp[i - 1][1], target[0] - simp[i - 1][0]);
      const len = d2(simp[i - 1], target);
      if (o.snapAngle) ang = snapAngle(ang);
      out.push([prev[0] + Math.cos(ang) * len, prev[1] + Math.sin(ang) * len]);
    }
    if (closed) {
      // cerrar: corregir el último vértice para que el polígono quede ortogonal si corresponde
      if (out.length >= 3 && o.snapAngle) {
        const a = out[out.length - 2], first = out[0];
        const last = out[out.length - 1];
        const cand: V2[] = [[first[0], a[1]], [a[0], first[1]]];
        const best = cand.sort((p, q) => d2(p, last) - d2(q, last))[0];
        if (d2(best, last) < o.closeTol * 2) out[out.length - 1] = best;
      }
    } else {
      out[out.length - 1] = snapTo(out[out.length - 1], o.snapPts, o.snapTol);
    }
    return { id: uid('p'), kind: 'poly', pts: out, closed };
  }
  // curva suave: pocos puntos de paso (editables); la spline que pasa por ellos se exporta como NURBS/arcos
  let pts = rdp(raw, o.eps / 2);
  if (closed && pts.length > 3) pts = pts.slice(0, -1);
  return { id: uid('s'), kind: 'poly', pts, closed, smooth: true };
}

/** Elimina vértices casi alineados que deja RDP en las esquinas (giro < tolDeg). */
export function mergeCollinear(pts: V2[], closed: boolean, tolDeg: number): V2[] {
  const out = pts.slice();
  let changed = true;
  while (changed && out.length > (closed ? 3 : 2)) {
    changed = false;
    const start = closed ? 0 : 1, end = closed ? out.length : out.length - 1;
    for (let i = start; i < end; i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let turn = Math.abs(a2 - a1) * 180 / Math.PI;
      if (turn > 180) turn = 360 - turn;
      if (turn < tolDeg) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

/** Vértices existentes para imantar. */
export const snapPoints = (els: SketchEl[]): V2[] => els.flatMap((e) => (e.kind === 'poly' ? (e.smooth ? [e.pts[0], e.pts[e.pts.length - 1]] : e.pts) : e.kind === 'dim' ? [e.a, e.b] : []));

/** Perfil en mm (Y hacia arriba, origen en la esquina inferior izquierda) desde el elemento seleccionado. */
export function profileFromSketch(sk: SketchDoc): V2[] | undefined {
  const e = sk.elements.find((x) => x.id === sk.profileId);
  if (!e) return undefined;
  let pts: V2[];
  if (e.kind === 'circle') pts = Array.from({ length: 48 }, (_, i) => [e.c[0] + e.r * Math.cos((i / 48) * Math.PI * 2), e.c[1] + e.r * Math.sin((i / 48) * Math.PI * 2)] as V2);
  else if (e.kind === 'poly' && e.closed) pts = e.pts;
  else return undefined;
  const k = sk.mmPerPx;
  const mm: V2[] = pts.map(([x, y]) => [x * k, -y * k]);
  const b = bounds2(mm);
  return ccw(mm.map(([x, y]) => [Math.round((x - b.x0) * 10) / 10, Math.round((y - b.y0) * 10) / 10] as V2));
}

export function pointInPoly(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToEl(p: V2, e: SketchEl): number {
  if (e.kind === 'circle') return Math.abs(d2(p, e.c) - e.r);
  const pts = e.kind === 'dim' ? [e.a, e.b] : e.pts;
  const closed = e.kind === 'poly' && e.closed;
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, d2(p, [a[0] + t * dx, a[1] + t * dy]));
  }
  return pts.length === 1 ? d2(p, pts[0]) : best;
}
