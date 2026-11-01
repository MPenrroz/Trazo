import { placedProfile, type NestResult } from '../core/nesting';
import type { SketchDoc, V2 } from '../core/types';

/** Escritor DXF R12 mínimo (compatible con Rhino, VCarve, Fusion, LightBurn, AutoCAD). */
class Dxf {
  private ents: string[] = [];
  private layers = new Map<string, number>();
  layer(name: string, color: number) { this.layers.set(name, color); return this; }
  poly(pts: V2[], layer: string, closed = true) {
    this.ents.push(`0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${closed ? 1 : 0}\n10\n0\n20\n0\n30\n0`);
    for (const [x, y] of pts) this.ents.push(`0\nVERTEX\n8\n${layer}\n10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n30\n0`);
    this.ents.push(`0\nSEQEND\n8\n${layer}`);
  }
  circle(c: V2, r: number, layer: string) { this.ents.push(`0\nCIRCLE\n8\n${layer}\n10\n${c[0].toFixed(3)}\n20\n${c[1].toFixed(3)}\n30\n0\n40\n${r.toFixed(3)}`); }
  text(p: V2, h: number, s: string, layer: string) { this.ents.push(`0\nTEXT\n8\n${layer}\n10\n${p[0].toFixed(3)}\n20\n${p[1].toFixed(3)}\n30\n0\n40\n${h}\n1\n${s.replace(/\n/g, ' ')}`); }
  toString() {
    const lt = [...this.layers].map(([n, c]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\nCONTINUOUS`).join('\n');
    return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${this.layers.size}\n${lt}\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${this.ents.join('\n')}\n0\nENDSEC\n0\nEOF\n`;
  }
}

/** Capa por profundidad, convención habitual para asignar estrategias en VCarve/Fusion/RhinoCAM. */
export const pocketLayer = (depth: number) => `CAJEADO_${String(depth).replace('.', '_')}MM`;

/** Layout de corte listo para CAM: un tablero tras otro a lo largo de X. */
export function nestingDxf(nr: NestResult): string {
  const d = new Dxf().layer('TABLERO', 8).layer('CORTE_EXTERIOR', 1).layer('CORTE_INTERIOR', 5).layer('ETIQUETAS', 3);
  const depths = new Set(nr.placements.flatMap((p) => (p.part.pockets ?? []).map((k) => k.depth)));
  for (const dep of depths) d.layer(pocketLayer(dep), 4);
  const [SW, SH] = nr.sheetSize;
  for (let s = 0; s < nr.sheets; s++) {
    const ox = s * (SW + 200);
    d.poly([[ox, 0], [ox + SW, 0], [ox + SW, SH], [ox, SH]], 'TABLERO');
    for (const pl of nr.placements.filter((p) => p.sheet === s)) {
      d.poly(placedProfile(pl, pl.part.profile).map(([x, y]) => [x + ox, y]), 'CORTE_EXTERIOR');
      for (const h of pl.part.holes ?? []) d.poly(placedProfile(pl, h).map(([x, y]) => [x + ox, y]), 'CORTE_INTERIOR');
      // cajeados: con la pieza espejada (flipped) los de la cara 'base' quedan boca arriba
      for (const k of pl.part.pockets ?? []) {
        const up = pl.flipped ? k.face === 'base' : k.face === 'top';
        if (up) d.poly(placedProfile(pl, k.outline).map(([x, y]) => [x + ox, y]), pocketLayer(k.depth));
      }
      d.text([ox + pl.x + 10, pl.y + 10], 12, `${pl.part.name} e=${pl.part.thickness}${pl.flipped ? ' (cara interior arriba)' : ''}`, 'ETIQUETAS');
    }
  }
  return d.toString();
}

/** Vectores del boceto en mm (Y hacia arriba). */
export function sketchDxf(sk: SketchDoc): string {
  const d = new Dxf().layer('BOCETO', 7).layer('PERFIL', 1).layer('COTAS', 3);
  const k = sk.mmPerPx;
  const t = ([x, y]: V2): V2 => [x * k, -y * k];
  for (const e of sk.elements) {
    if (e.kind === 'circle') d.circle(t(e.c), e.r * k, 'BOCETO');
    else if (e.kind === 'dim') d.poly([t(e.a), t(e.b)], 'COTAS', false);
    else d.poly(e.pts.map(t), e.id === sk.profileId ? 'PERFIL' : 'BOCETO', e.kind === 'poly' && e.closed);
  }
  return d.toString();
}
