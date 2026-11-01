import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { polyArea, polyPerimeter } from './geom';
import type { Part, Pocket, V2 } from './types';

/** Capa de una pieza con cajeados: un perfil (con huecos) extruido entre w0 y w1. */
export interface Layer { outer: V2[]; holes: V2[][]; w0: number; w1: number }

const ring = (pts: V2[]): V2[] => [...pts, pts[0]];
const unring = (r: [number, number][]): V2[] => r.slice(0, -1).map(([x, y]) => [x, y]);

/**
 * Descompone una pieza en capas sólidas: la parte rebajada por cada cajeado queda más delgada.
 * Sin cajeados devuelve una sola capa de espesor completo.
 */
export function partLayers(p: Part): Layer[] {
  const base: Polygon = [ring(p.profile), ...(p.holes ?? []).map(ring)];
  if (!p.pockets?.length) return [{ outer: p.profile, holes: p.holes ?? [], w0: 0, w1: p.thickness }];
  // cortes en w donde cambia la sección
  const cuts = new Set<number>([0, p.thickness]);
  for (const k of p.pockets) cuts.add(k.face === 'base' ? k.depth : p.thickness - k.depth);
  const ws = [...cuts].sort((a, b) => a - b);
  const layers: Layer[] = [];
  for (let i = 0; i < ws.length - 1; i++) {
    const w0 = ws[i], w1 = ws[i + 1], mid = (w0 + w1) / 2;
    const active = p.pockets.filter((k) => (k.face === 'base' ? mid < k.depth : mid > p.thickness - k.depth));
    let mp: MultiPolygon = [base];
    if (active.length) mp = polygonClipping.difference(base, ...active.map((k) => [ring(k.outline)] as Polygon));
    for (const poly of mp) layers.push({ outer: unring(poly[0]), holes: poly.slice(1).map(unring), w0, w1 });
  }
  return layers;
}

/** Área efectivamente cajeada (contorno ∩ pieza), en mm². */
export function pocketArea(p: Part, k: Pocket): number {
  const inter = polygonClipping.intersection([ring(p.profile)], [ring(k.outline)]);
  return inter.reduce((s, poly) => s + Math.abs(polyArea(unring(poly[0]))) - poly.slice(1).reduce((t, h) => t + Math.abs(polyArea(unring(h))), 0), 0);
}

/**
 * Recorrido aproximado de fresa para vaciar el cajeado (mm): pasadas paralelas separadas
 * 0,8 × Ø + contorno, multiplicado por las pasadas en profundidad (máx. 1 × Ø por pasada).
 */
export function pocketToolpath(p: Part, k: Pocket, tool: number): number {
  const passes = Math.max(1, Math.ceil(k.depth / Math.max(tool, 1)));
  return (pocketArea(p, k) / (0.8 * Math.max(tool, 1)) + polyPerimeter(k.outline)) * passes;
}
