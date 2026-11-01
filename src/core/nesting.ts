import { bounds2 } from './geom';
import type { Part, V2 } from './types';

/**
 * flipped: la pieza se coloca espejada (vista desde su cara 'base') para que sus cajeados de esa cara
 * queden boca arriba en la máquina.
 */
export interface Placement { part: Part; sheet: number; x: number; y: number; rotated: boolean; flipped: boolean; w: number; h: number }

export const needsFlip = (p: Part) => !!p.pockets?.some((k) => k.face === 'base');
export interface NestResult { sheets: number; placements: Placement[]; unplaced: Part[]; sheetSize: V2 }

/**
 * Anidado rápido por filas (shelf packing) usando el rectángulo envolvente de cada pieza.
 * No es óptimo, pero da una estimación realista de tableros y sirve como layout de corte inicial.
 */
export function nest(parts: Part[], sheet: V2, gap: number, margin = 10): NestResult {
  const W = sheet[0] - 2 * margin, H = sheet[1] - 2 * margin;
  const items = parts.map((p) => { const b = bounds2(p.profile); return { p, w: b.w + gap, h: b.h + gap }; })
    .map((it) => (it.h > it.w ? { ...it, w: it.h, h: it.w, rot: true } : { ...it, rot: false }))
    .sort((a, b) => b.h - a.h || b.w - a.w);
  const placements: Placement[] = [];
  const unplaced: Part[] = [];
  type Shelf = { y: number; h: number; x: number };
  const sheets: Shelf[][] = [];
  for (const it of items) {
    let { w, h, rot } = it;
    if (w > W || h > H) {
      // probar sin rotar
      if (h <= W && w <= H) { [w, h] = [h, w]; rot = !rot; } else { unplaced.push(it.p); continue; }
    }
    let placed = false;
    for (let s = 0; s < sheets.length && !placed; s++) {
      for (const sh of sheets[s]) {
        if (sh.x + w <= W && h <= sh.h) { placements.push({ part: it.p, sheet: s, x: margin + sh.x, y: margin + sh.y, rotated: rot, flipped: needsFlip(it.p), w: w - gap, h: h - gap }); sh.x += w; placed = true; break; }
      }
      if (!placed) {
        const last = sheets[s][sheets[s].length - 1];
        const y = last ? last.y + last.h : 0;
        if (y + h <= H) { sheets[s].push({ y, h, x: w }); placements.push({ part: it.p, sheet: s, x: margin, y: margin + y, rotated: rot, flipped: needsFlip(it.p), w: w - gap, h: h - gap }); placed = true; }
      }
    }
    if (!placed) { sheets.push([{ y: 0, h, x: w }]); placements.push({ part: it.p, sheet: sheets.length - 1, x: margin, y: margin, rotated: rot, flipped: needsFlip(it.p), w: w - gap, h: h - gap }); }
  }
  return { sheets: sheets.length, placements, unplaced, sheetSize: sheet };
}

/** Perfil de la pieza transformado a su posición en el tablero. */
export function placedProfile(pl: Placement, pts: V2[]): V2[] {
  const b = bounds2(pl.part.profile);
  return pts.map(([u, v]) => {
    const x = pl.flipped ? b.x1 - u : u - b.x0, y = v - b.y0;
    return pl.rotated ? [pl.x + y, pl.y + (b.w - x)] as V2 : [pl.x + x, pl.y + y] as V2;
  });
}
