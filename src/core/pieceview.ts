// Vista 2D de una pieza junto al 3D: la silueta del boceto se lleva a escala real de la pieza
// (1:1 con sus mm) para editarla con el Pencil mientras el 3D se actualiza, y las piezas vecinas
// se proyectan sobre su plano como líneas de referencia.
import { shapeChildren } from './free';
import { bounds2, dot, normal, partVertices } from './geom';
import type { Part, SketchDoc, SketchEl, V2, V3 } from './types';

/** Correspondencia mm locales de la pieza ↔ px del boceto (Y del boceto hacia abajo). */
export interface PieceMap { x0: number; y0: number; u0: number; v1: number; k: number }
export const toPx = (m: PieceMap, [u, v]: V2): V2 => [m.x0 + (u - m.u0) / m.k, m.y0 + (m.v1 - v) / m.k];
export const toMm = (m: PieceMap, [x, y]: V2): V2 => [m.u0 + (x - m.x0) * m.k, m.v1 - (y - m.y0) * m.k];

const elBox = (e: SketchEl) => bounds2(e.kind === 'circle' ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] : e.kind === 'dim' ? [e.a, e.b] : e.pts);

/** Contorno de la pieza en sus puntos de paso (curva suave) o su polígono. */
const outlineOf = (p: Part) => p.curves?.outline ?? p.profile;

/** Mapa actual de la silueta (sin cambiar nada): su caja en el boceto ↔ la caja del contorno de la pieza. */
export function pieceMap(sk: SketchDoc, shapeId: string, part: Part): PieceMap | null {
  const e = sk.elements.find((x) => x.id === shapeId);
  if (!e) return null;
  const bb = elBox(e), pb = bounds2(outlineOf(part));
  return { x0: bb.x0, y0: bb.y0, u0: pb.x0, v1: pb.y1, k: sk.mmPerPx || 1 };
}

/** ¿La silueta ya está a la escala real de la pieza? (tolerancia 0,5 mm) */
export function isRealScale(sk: SketchDoc, shapeId: string, part: Part): boolean {
  const e = sk.elements.find((x) => x.id === shapeId);
  if (!e) return false;
  const bb = elBox(e), pb = bounds2(outlineOf(part)), k = sk.mmPerPx || 1;
  return Math.abs(bb.w * k - pb.w) < 0.5 && Math.abs(bb.h * k - pb.h) < 0.5;
}

/**
 * Redibuja la silueta y sus calados a la escala real de la pieza, en el mismo lugar del boceto.
 * El resultado en 3D no cambia (la silueta se estira igual a la pieza y los calados conservan su forma),
 * pero desde ahora 1 mm dibujado = 1 mm de la pieza. Devuelve los elementos nuevos o null si no aplica.
 */
export function realScaleElements(sk: SketchDoc, shapeId: string, part: Part, holesOn: boolean): SketchEl[] | null {
  const e = sk.elements.find((x) => x.id === shapeId);
  if (!e || (e.kind !== 'poly' && e.kind !== 'circle')) return null;
  const bb = elBox(e), pb = bounds2(outlineOf(part)), k = sk.mmPerPx || 1;
  const m: PieceMap = { x0: bb.x0, y0: bb.y0, u0: pb.x0, v1: pb.y1, k };
  const out: SketchEl[] = [];
  if (e.kind === 'circle') {
    // un círculo estirado a una pieza no cuadrada deja de serlo: queda como curva suave
    const c = toPx(m, [(pb.x0 + pb.x1) / 2, (pb.y0 + pb.y1) / 2]);
    out.push(Math.abs(pb.w - pb.h) < 0.5 ? { ...e, c, r: pb.w / 2 / k } : { id: e.id, kind: 'poly', closed: true, smooth: true, name: e.name, pts: outlineOf(part).map((q) => toPx(m, q)) });
  } else out.push({ ...e, pts: outlineOf(part).map((q) => toPx(m, q)) });
  if (holesOn) {
    const kids = shapeChildren(sk, shapeId);
    kids.forEach((id, j) => {
      const he = sk.elements.find((x) => x.id === id);
      const mm = part.curves?.holes?.[j] ?? part.holes?.[j];
      if (!he || !mm) return;
      if (he.kind === 'circle') {
        const hb = bounds2(part.holes![j]);
        out.push({ ...he, c: toPx(m, [(hb.x0 + hb.x1) / 2, (hb.y0 + hb.y1) / 2]), r: hb.w / 2 / k });
      } else if (he.kind === 'poly') out.push({ ...he, pts: mm.map((q) => toPx(m, q)) });
    });
  }
  return out;
}

/** Proyección (mm locales) de un punto del mundo sobre el plano de la pieza. */
function project(p: Part, w: V3): V2 {
  const d: V3 = [w[0] - p.plane.o[0], w[1] - p.plane.o[1], w[2] - p.plane.o[2]];
  return [dot(d, p.plane.x), dot(d, p.plane.y)];
}

/**
 * Piezas vecinas proyectadas sobre el plano de la pieza (mm locales), para dibujar sabiendo dónde está todo.
 * Las paralelas se proyectan con su contorno; las demás como su silueta rectangular vista de canto.
 * Solo las que están a menos de `near` mm del plano.
 */
export function ghosts(p: Part, parts: Part[], near = 1200): { name: string; pts: V2[]; ref: boolean }[] {
  const n = normal(p.plane);
  const out: { name: string; pts: V2[]; ref: boolean }[] = [];
  for (const q of parts) {
    if (q.id === p.id || (q.source && p.source && q.source.comp === p.source.comp && q.source.i === p.source.i)) continue;
    const vs = partVertices(q);
    const dist = vs.map((v) => dot([v[0] - p.plane.o[0], v[1] - p.plane.o[1], v[2] - p.plane.o[2]], n));
    if (Math.min(...dist.map(Math.abs)) > near && Math.sign(Math.min(...dist)) === Math.sign(Math.max(...dist))) continue;
    const parallel = Math.abs(Math.abs(dot(normal(q.plane), n)) - 1) < 1e-6;
    let pts: V2[];
    if (parallel) {
      pts = q.profile.map(([u, v]) => project(p, [q.plane.o[0] + q.plane.x[0] * u + q.plane.y[0] * v, q.plane.o[1] + q.plane.x[1] * u + q.plane.y[1] * v, q.plane.o[2] + q.plane.x[2] * u + q.plane.y[2] * v]));
    } else {
      const b = bounds2(vs.map((v) => project(p, v)));
      pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    }
    // copias repetidas (barrotes): una sola etiqueta con el nombre base
    out.push({ name: q.source && /\s\d+$/.test(q.name) ? q.name.replace(/\s\d+$/, '') : q.name, pts, ref: q.process === 'ref' });
  }
  return out;
}
