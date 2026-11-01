import wasmUrl from 'rhino3dm/rhino3dm.wasm?url';
import { bounds3, normal } from '../core/geom';
import { placedProfile, type NestResult } from '../core/nesting';
import { partLayers } from '../core/pockets';
import type { Part, Project, V2 } from '../core/types';

let rhinoPromise: Promise<any> | null = null;
/** Carga diferida de rhino3dm (WASM ~2.6 MB) solo cuando se exporta. */
export function loadRhino(): Promise<any> {
  if (!rhinoPromise) rhinoPromise = import('rhino3dm/rhino3dm.module.js').then((m: any) => (m.default ?? m)({ locateFile: () => wasmUrl }));
  return rhinoPromise;
}

const hex = (c: string) => { const n = parseInt(c.replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 }; };

/**
 * Genera un .3dm (Rhino 7/8) con:
 *  - Piezas sólidas (Extrusion) por capa de material/rol, con UserText (rol, espesor, material).
 *  - Perfiles de corte 2D anidados a un costado (listos para RhinoCAM / exportar a CNC).
 *  - Boceto calibrado como curvas de referencia.
 *  - Parámetros y rangos del producto en los DocumentUserText (para Grasshopper).
 */
export async function export3dm(project: Project, parts: Part[], values: Record<string, unknown>, nest: NestResult, spec: unknown): Promise<Uint8Array> {
  const rh = await loadRhino();
  const doc = new rh.File3dm();
  doc.settings().modelUnitSystem = rh.UnitSystem.Millimeters;
  const layers = new Map<string, number>();
  const layer = (name: string, color = '#333333') => {
    if (layers.has(name)) return layers.get(name)!;
    const l = new rh.Layer(); l.name = name; l.color = hex(color);
    const i = doc.layers().add(l); layers.set(name, i); return i;
  };
  const curve = (pts: [number, number, number][]) => {
    const pl = new rh.Point3dList();
    for (const p of pts) pl.add(p[0], p[1], p[2]);
    pl.add(pts[0][0], pts[0][1], pts[0][2]);
    return new rh.PolylineCurve(pl);
  };
  const worldXY = rh.Plane.worldXY();

  for (const p of parts) {
    const mat = project.fab.materials.find((m) => m.id === p.material);
    const li = layer(`Piezas · ${p.role}`, mat?.color ?? '#999999');
    const n = normal(p.plane);
    // Extrusion.create extruye hacia +Z del plano de la curva; se mapea WorldXY → plano de la pieza
    const toPart = rh.Transform.planeToPlane(worldXY, { origin: p.plane.o, xAxis: p.plane.x, yAxis: p.plane.y, zAxis: n });
    // Piezas con cajeados: una extrusión por capa (zona rebajada más delgada). En Rhino: _BooleanUnion para un solo sólido.
    const layersOf = partLayers(p);
    layersOf.forEach((l, i) => {
      const ex = rh.Extrusion.create(curve(l.outer.map(([x, y]) => [x, y, 0])), l.w1 - l.w0, true);
      if (!ex) return;
      for (const h of l.holes) ex.addInnerProfile(curve(h.map(([x, y]) => [x, y, 0])));
      ex.transform(rh.Transform.translationXYZ(0, 0, l.w0));
      ex.transform(toPart);
      const a = new rh.ObjectAttributes();
      a.layerIndex = li; a.name = layersOf.length > 1 ? `${p.name} (capa ${i + 1}/${layersOf.length})` : p.name;
      a.setUserString('trazo:id', p.id); a.setUserString('trazo:rol', p.role);
      a.setUserString('trazo:material', mat?.name ?? p.material); a.setUserString('trazo:espesor_mm', String(p.thickness));
      for (const k of p.pockets ?? []) a.setUserString(`trazo:cajeado:${k.name}`, `prof ${k.depth} mm, cara ${k.face}`);
      doc.objects().add(ex, a);
    });
    // contorno de cada cajeado en el fondo de la ranura (trayectoria para CAM)
    for (const k of p.pockets ?? []) {
      const w = k.face === 'base' ? k.depth : p.thickness - k.depth;
      const c = curve(k.outline.map(([x, y]) => [x, y, 0]));
      c.transform(rh.Transform.translationXYZ(0, 0, w));
      c.transform(toPart);
      const a = new rh.ObjectAttributes();
      a.layerIndex = layer(`CNC · Cajeado ${k.depth} mm`, '#0e9f6e'); a.name = `${p.name} · ${k.name}`;
      doc.objects().add(c, a);
    }
  }

  // Perfiles de corte anidados, desplazados a la derecha del modelo
  const maxX = bounds3(parts).max[0] + 1500;
  const [SW, SH] = nest.sheetSize;
  const lSheet = layer('CNC · Tableros', '#888888'), lCut = layer('CNC · Corte exterior', '#d62828'), lHole = layer('CNC · Corte interior', '#1d4ed8');
  for (let s = 0; s < nest.sheets; s++) {
    const oy = -SH - 400 - s * (SH + 200);
    const add = (pts: V2[], li: number, name: string) => { const a = new rh.ObjectAttributes(); a.layerIndex = li; a.name = name; doc.objects().add(curve(pts.map(([x, y]) => [maxX + x, oy + y, 0])), a); };
    add([[0, 0], [SW, 0], [SW, SH], [0, SH]], lSheet, `Tablero ${s + 1}`);
    for (const pl of nest.placements.filter((p) => p.sheet === s)) {
      add(placedProfile(pl, pl.part.profile), lCut, pl.part.name);
      for (const h of pl.part.holes ?? []) add(placedProfile(pl, h), lHole, `${pl.part.name} vaciado`);
      for (const k of pl.part.pockets ?? []) {
        if (pl.flipped ? k.face !== 'base' : k.face !== 'top') continue; // solo los que quedan boca arriba
        add(placedProfile(pl, k.outline), layer(`CNC · Cajeado ${k.depth} mm`, '#0e9f6e'), `${pl.part.name} · ${k.name}`);
      }
    }
  }

  // Boceto como referencia (plano XZ, detrás del modelo)
  const sk = project.sketch;
  if (sk.calibrated && sk.elements.length) {
    const lSk = layer('Referencia · Boceto', '#e5484d');
    const k = sk.mmPerPx;
    for (const e of sk.elements) {
      const a = new rh.ObjectAttributes(); a.layerIndex = lSk;
      const pts: V2[] = e.kind === 'circle'
        ? Array.from({ length: 49 }, (_, i) => [e.c[0] + e.r * Math.cos((i / 48) * 2 * Math.PI), e.c[1] + e.r * Math.sin((i / 48) * 2 * Math.PI)] as V2)
        : e.kind === 'dim' ? [e.a, e.b] : e.pts;
      const pl = new rh.Point3dList();
      for (const [x, y] of pts) pl.add(x * k, -200, -y * k);
      if (e.kind === 'poly' && e.closed) pl.add(pts[0][0] * k, -200, -pts[0][1] * k);
      doc.objects().add(new rh.PolylineCurve(pl), a);
    }
  }

  const strings = doc.strings();
  strings.set('trazo:proyecto', project.name);
  strings.set('trazo:plantilla', project.template);
  for (const [k, v] of Object.entries(values)) strings.set(`trazo:param:${k}`, String(v));
  strings.set('trazo:spec', JSON.stringify(spec));
  return doc.toByteArray();
}
