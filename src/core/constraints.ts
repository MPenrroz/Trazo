// Restricciones geométricas y cotas del boceto (líneas técnicas CAD junto a los trazos del Pencil).
// Se aplican sobre los lados de polilíneas rectas y sobre círculos. Un solucionador iterativo de proyecciones
// (cada restricción mueve lo mínimo los puntos involucrados) es robusto para bocetos de mueble con decenas de puntos.
// Las cotas pueden ligarse a un parámetro del producto: al cambiar el valor, la forma se recalcula (también en la tienda).
import type { ParamValues, SketchDoc, SketchEl, V2 } from './types';

export type ConstraintKind = 'h' | 'v' | 'len' | 'dia';
export interface Constraint {
  id: string;
  kind: ConstraintKind;
  /** Elemento (polilínea recta o círculo). */
  el: string;
  /** Índice del lado (pts[seg] → pts[seg+1]); no aplica a 'dia'. */
  seg?: number;
  /** Medida en mm (len/dia). */
  value?: number;
  /** Parámetro del producto que fija la medida (tiene prioridad sobre value). */
  param?: string;
}

export const KIND_LABEL: Record<ConstraintKind, string> = { h: 'Horizontal', v: 'Vertical', len: 'Largo', dia: 'Diámetro' };

const segOf = (e: SketchEl, i: number): [number, number] | null => {
  if (e.kind !== 'poly' || e.smooth) return null;
  const n = e.pts.length;
  if (i < 0 || i >= (e.closed ? n : n - 1)) return null;
  return [i, (i + 1) % n];
};

/** Restricciones que siguen siendo válidas para el documento (tras borrar o redibujar formas). */
export function validConstraints(doc: SketchDoc): Constraint[] {
  return (doc.constraints ?? []).filter((c) => {
    const e = doc.elements.find((x) => x.id === c.el);
    if (!e) return false;
    if (c.kind === 'dia') return e.kind === 'circle';
    return !!segOf(e, c.seg ?? -1);
  });
}

/** Medida objetivo (mm) de una cota. */
export function targetMm(c: Constraint, values?: ParamValues): number | null {
  if (c.param && values && Number.isFinite(Number(values[c.param]))) return Number(values[c.param]);
  return c.value ?? null;
}

/** ¿Hay cotas ligadas a parámetros? (entonces la forma depende de los valores del producto) */
export const hasParamLinks = (doc: SketchDoc) => (doc.constraints ?? []).some((c) => !!c.param);

/**
 * Resuelve las restricciones moviendo los puntos del documento (in situ).
 * `pinned`: puntos que no se mueven (el que arrastra el lápiz), como "elId:índice".
 * Devuelve el error residual máximo (px).
 */
export function solve(doc: SketchDoc, values?: ParamValues, pinned: Set<string> = new Set(), iters = 80): number {
  const cs = validConstraints(doc);
  if (!cs.length) return 0;
  const k = doc.mmPerPx || 1;
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const w = (el: string, i: number) => (pinned.has(`${el}:${i}`) ? 0 : 1);
  let err = 0;
  for (let it = 0; it < iters; it++) {
    err = 0;
    for (const c of cs) {
      const e = byId.get(c.el)!;
      if (c.kind === 'dia') {
        if (e.kind !== 'circle') continue;
        const mm = targetMm(c, values);
        if (mm && mm > 0) { err = Math.max(err, Math.abs(e.r - mm / 2 / k)); e.r = mm / 2 / k; }
        continue;
      }
      if (e.kind !== 'poly') continue;
      const s = segOf(e, c.seg!)!;
      const a = e.pts[s[0]], b = e.pts[s[1]];
      const wa = w(e.id, s[0]), wb = w(e.id, s[1]);
      if (wa + wb === 0) continue;
      const fa = wa / (wa + wb), fb = wb / (wa + wb);
      if (c.kind === 'h' || c.kind === 'v') {
        const ax = c.kind === 'h' ? 1 : 0; // h: igualar y; v: igualar x
        const d = b[ax] - a[ax];
        err = Math.max(err, Math.abs(d));
        a[ax] += d * fa; b[ax] -= d * fb;
      } else if (c.kind === 'len') {
        const mm = targetMm(c, values);
        if (!mm || mm <= 0) continue;
        const L = mm / k;
        const dx = b[0] - a[0], dy = b[1] - a[1], cur = Math.hypot(dx, dy) || 1e-9;
        const diff = cur - L;
        err = Math.max(err, Math.abs(diff));
        const ux = dx / cur, uy = dy / cur;
        a[0] += ux * diff * fa; a[1] += uy * diff * fa;
        b[0] -= ux * diff * fb; b[1] -= uy * diff * fb;
      }
    }
    if (err < 1e-4) break;
  }
  return err;
}

/** Copia resuelta del boceto (para construir piezas con otros valores sin tocar el documento). */
export function solvedCopy(doc: SketchDoc, values?: ParamValues): SketchDoc {
  if (!validConstraints(doc).length) return doc;
  const d: SketchDoc = { ...doc, elements: structuredClone(doc.elements) };
  solve(d, values);
  return d;
}

/** Lados ya horizontales o verticales (±1°) de una polilínea recta: restricciones sugeridas. */
export function suggest(e: SketchEl, existing: Constraint[]): Omit<Constraint, 'id'>[] {
  if (e.kind !== 'poly' || e.smooth) return [];
  const out: Omit<Constraint, 'id'>[] = [];
  const n = e.closed ? e.pts.length : e.pts.length - 1;
  for (let i = 0; i < n; i++) {
    if (existing.some((c) => c.el === e.id && c.seg === i && (c.kind === 'h' || c.kind === 'v'))) continue;
    const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length];
    const ang = Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180;
    if (ang < 1 || ang > 179) out.push({ kind: 'h', el: e.id, seg: i });
    else if (Math.abs(ang - 90) < 1) out.push({ kind: 'v', el: e.id, seg: i });
  }
  return out;
}

/** Punto medio y normal de un lado (para dibujar el símbolo o la cota). */
export function segAnchor(e: SketchEl, i: number): { mid: V2; nrm: V2; a: V2; b: V2 } | null {
  const s = segOf(e, i);
  if (!s || e.kind !== 'poly') return null;
  const a = e.pts[s[0]], b = e.pts[s[1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], nrm: [-(b[1] - a[1]) / L, (b[0] - a[0]) / L] };
}
