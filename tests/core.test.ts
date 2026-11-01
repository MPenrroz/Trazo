import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis';
import { DEFAULT_MATERIALS, DEFAULT_METHODS } from '../src/core/catalog';
import { bounds3, partVertices, polyArea } from '../src/core/geom';
import { nest } from '../src/core/nesting';
import { clampValue, resolveParams, resolveValues } from '../src/core/params';
import { TEMPLATES, getTemplate } from '../src/core/templates';
import { fitStroke, profileFromSketch } from '../src/sketch/fit';
import { partLayers, pocketArea } from '../src/core/pockets';
import { nestingDxf } from '../src/export/dxf';
import { placedProfile } from '../src/core/nesting';
import type { V2 } from '../src/core/types';

const defaults = (id: string) => Object.fromEntries(getTemplate(id).params.map((p) => [p.key, p.default]));
const pricing = { pricing: { margin: 50, base: 0, currency: 'CLP' } };

describe('plantillas', () => {
  it('la estantería respeta las medidas exteriores', () => {
    const t = getTemplate('estanteria');
    const parts = t.build({ ...defaults('estanteria'), w: 1000, h: 2000, d: 400 }, { material: 'mdf' });
    const b = bounds3(parts);
    expect(b.size.map(Math.round)).toEqual([1000, 400, 2000]);
    expect(parts.filter((p) => p.role === 'Repisa')).toHaveLength(4 * 2);
  });
  it('todas las plantillas generan piezas con espesor positivo', () => {
    for (const t of TEMPLATES) {
      const parts = t.build(defaults(t.id), { material: 'mdf' });
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) { expect(p.thickness).toBeGreaterThan(0); expect(Math.abs(polyArea(p.profile))).toBeGreaterThan(0); }
    }
  });
  it('costillas usa el perfil del boceto escalado', () => {
    const profile: V2[] = [[0, 0], [500, 0], [500, 300], [0, 300]];
    const parts = getTemplate('costillas').build({ ...defaults('costillas'), n: 3, slats: 0, scale: 200 }, { material: 'mdf', profile });
    const v = partVertices(parts[0]);
    expect(Math.max(...v.map((p) => p[1]))).toBeCloseTo(1000);
    expect(Math.max(...v.map((p) => p[2]))).toBeCloseTo(600);
  });
});

describe('parámetros', () => {
  it('limita a los rangos del arquitecto', () => {
    const defs = resolveParams(getTemplate('estanteria').params, { w: { min: 600, max: 900 } });
    const w = defs.find((d) => d.key === 'w')!;
    expect(clampValue(w, 2000)).toBe(900);
    expect(clampValue(w, 100)).toBe(600);
    expect(resolveValues(defs, { w: 755 }).w).toBe(760);
  });
});

describe('tinta inteligente', () => {
  const opts = { eps: 3, closeTol: 20, snapAngle: true, snapPts: [], snapTol: 10 };
  it('un trazo casi recto se vuelve línea horizontal', () => {
    const raw: V2[] = Array.from({ length: 50 }, (_, i) => [i * 4, 100 + Math.sin(i) * 1.2 + i * 0.05]);
    const el = fitStroke(raw, opts)!;
    expect(el.kind).toBe('poly');
    if (el.kind === 'poly') { expect(el.pts).toHaveLength(2); expect(el.pts[1][1]).toBeCloseTo(el.pts[0][1], 5); }
  });
  it('un trazo circular cerrado se vuelve círculo', () => {
    const raw: V2[] = Array.from({ length: 80 }, (_, i) => { const a = (i / 79) * Math.PI * 2; return [200 + 100 * Math.cos(a) + Math.sin(i) * 2, 200 + 100 * Math.sin(a)]; });
    const el = fitStroke(raw, opts)!;
    expect(el.kind).toBe('circle');
    if (el.kind === 'circle') expect(el.r).toBeGreaterThan(95);
  });
  it('un rectángulo temblequeado queda ortogonal y cerrado', () => {
    const raw: V2[] = [];
    const corners: V2[] = [[0, 0], [300, 3], [302, 200], [2, 198], [1, 4]];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 20; i++) { const a = corners[k], b = corners[k + 1]; raw.push([a[0] + (b[0] - a[0]) * i / 20 + Math.random(), a[1] + (b[1] - a[1]) * i / 20 + Math.random()]); }
    const el = fitStroke(raw, opts)!;
    expect(el.kind).toBe('poly');
    if (el.kind === 'poly') {
      expect(el.closed).toBe(true);
      expect(el.pts).toHaveLength(4);
      for (let i = 0; i < 4; i++) { const a = el.pts[i], b = el.pts[(i + 1) % 4]; expect(Math.min(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))).toBeLessThan(0.5); }
    }
  });
  it('convierte el perfil del boceto a mm con Y hacia arriba', () => {
    const prof = profileFromSketch({ elements: [{ id: 'a', kind: 'poly', closed: true, pts: [[10, 10], [110, 10], [110, 60], [10, 60]] }], profileId: 'a', mmPerPx: 2, calibrated: true, underlayOpacity: 1 })!;
    expect(Math.max(...prof.map((p) => p[0]))).toBe(200);
    expect(Math.max(...prof.map((p) => p[1]))).toBe(100);
    expect(polyArea(prof)).toBeGreaterThan(0);
  });
});

describe('fabricación', () => {
  it('anida sin solapes dentro del tablero', () => {
    const parts = getTemplate('estanteria').build(defaults('estanteria'), { material: 'mdf' });
    const r = nest(parts, [2440, 1220], 10);
    expect(r.unplaced).toHaveLength(0);
    for (const a of r.placements) {
      expect(a.x + a.w).toBeLessThanOrEqual(2440); expect(a.y + a.h).toBeLessThanOrEqual(1220);
      for (const b of r.placements) if (a !== b && a.sheet === b.sheet) {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
  it('marca error si una pieza excede la cama del láser', () => {
    const parts = getTemplate('estanteria').build(defaults('estanteria'), { material: 'mdf' });
    const a = analyse(parts, DEFAULT_METHODS.find((m) => m.id === 'laser')!, DEFAULT_MATERIALS[0], pricing);
    expect(a.checks.some((c) => c.level === 'error')).toBe(true);
  });
  it('advierte luz excesiva en repisas delgadas', () => {
    const parts = getTemplate('estanteria').build({ ...defaults('estanteria'), w: 2000, cols: 1, t: 12 }, { material: 'mdf' });
    const a = analyse(parts, DEFAULT_METHODS[0], DEFAULT_MATERIALS[2], pricing);
    expect(a.checks.some((c) => c.level === 'warn' && /flecha/.test(c.msg))).toBe(true);
    expect(a.cost.price).toBeGreaterThan(0);
  });
});

describe('nicho de lectura', () => {
  const v = defaults('nicho');
  it('genera la caja con corte semicircular y librero', () => {
    const parts = getTemplate('nicho').build(v, { material: 'mdf-laca' });
    const b = bounds3(parts);
    expect(b.size.map(Math.round)).toEqual([18 + 920 + 18 + 280, 480, 560]);
    const side = parts.find((p) => p.id === 'costado-frente')!;
    // punto más bajo del corte: alto − radio
    const minArcZ = Math.min(...side.profile.filter(([x]) => x > 100 && x < 900).map(([, y]) => y)) + 50;
    expect(Math.round(minArcZ)).toBe(560 - 380);
    expect(parts.filter((p) => p.role === 'Listón asiento')).toHaveLength(16);
  });
  it('el cojín se cotiza como tapiz y no entra al anidado CNC', () => {
    const parts = getTemplate('nicho').build(v, { material: 'mdf-laca' });
    const mat = DEFAULT_MATERIALS.find((m) => m.id === 'mdf-laca')!;
    const a = analyse(parts, DEFAULT_METHODS[0], mat, pricing, DEFAULT_MATERIALS);
    expect(a.nest.placements.some((p) => p.part.process === 'tapiz')).toBe(false);
    expect(a.upholsteryM2).toBeGreaterThan(0.3);
    expect(a.cost.upholstery).toBeGreaterThan(0);
    expect(a.checks.some((c) => c.level === 'error')).toBe(false);
    // el arco no cuenta como esquinas interiores
    expect(a.checks.some((c) => /Costado.*esquina/.test(c.msg))).toBe(false);
  });
  it('limita el radio para no atravesar la base', () => {
    const parts = getTemplate('nicho').build({ ...v, ws: 1100, h: 420 }, { material: 'mdf-laca' });
    const base = parts.find((p) => p.id === 'base')!;
    const lowest = Math.min(...parts.filter((p) => p.role === 'Listón asiento').map((p) => p.plane.o[2]));
    expect(lowest).toBeGreaterThan(base.plane.o[2] + base.thickness);
  });
});

describe('ranura curva para listones', () => {
  const v = defaults('nicho');
  const parts = getTemplate('nicho').build(v, { material: 'mdf-laca' });
  const front = parts.find((p) => p.id === 'costado-frente')!;
  const back = parts.find((p) => p.id === 'costado-tras')!;
  const slats = parts.filter((p) => p.role === 'Listón asiento');

  it('ambos costados llevan la ranura en su cara interior', () => {
    expect(front.pockets?.[0]).toMatchObject({ depth: 6, face: 'base' }); // origen en y=T (interior)
    expect(back.pockets?.[0]).toMatchObject({ depth: 6, face: 'top' }); // w=espesor en y=D−T (interior)
    // cara interior en mundo: frente y=T, trasero y=D−T
    expect(front.plane.o[1]).toBe(18);
    expect(back.plane.o[1] - back.thickness).toBe(480 - 18);
  });
  it('los listones entran en la ranura con holgura y no la atraviesan', () => {
    for (const s of slats) {
      const y0 = s.plane.o[1], y1 = y0 + s.profile[1][0];
      expect(y0).toBeCloseTo(18 - 5.5); expect(y1).toBeCloseTo(480 - 18 + 5.5);
      expect(18 - y0).toBeLessThan(6); // no toca el fondo de la ranura
    }
  });
  it('la ranura queda cerrada: labio de material entre el corte y la ranura', () => {
    const R = 380, Hb = 510, cx = 18 + 920 / 2;
    const rIn = Math.min(...front.pockets![0].outline.map(([x, y]) => Math.hypot(x - cx, y - Hb)));
    expect(rIn - R).toBeGreaterThan(10);
  });
  it('la pieza se descompone en capas: la zona ranurada es 6 mm más delgada', () => {
    const layers = partLayers(front);
    expect(layers.map((l) => [l.w0, l.w1])).toEqual([[0, 6], [6, 18]]);
    const area = (l: (typeof layers)[number]) => Math.abs(polyArea(l.outer)) - l.holes.reduce((s, h) => s + Math.abs(polyArea(h)), 0);
    expect(area(layers[1]) - area(layers[0])).toBeCloseTo(pocketArea(front, front.pockets![0]), -1);
  });
  it('el DXF de corte incluye la capa de cajeado con las piezas boca arriba', () => {
    const a = analyse(parts, DEFAULT_METHODS[0], DEFAULT_MATERIALS.find((m) => m.id === 'mdf-laca')!, pricing, DEFAULT_MATERIALS);
    const dxf = nestingDxf(a.nest);
    expect(dxf).toContain('CAJEADO_6MM');
    const pf = a.nest.placements.find((p) => p.part.id === 'costado-frente')!;
    const pb = a.nest.placements.find((p) => p.part.id === 'costado-tras')!;
    expect(pf.flipped).toBe(true); expect(pb.flipped).toBe(false);
    // la ranura cae dentro del contorno colocado
    const out = placedProfile(pf, pf.part.profile), g = placedProfile(pf, pf.part.pockets![0].outline);
    const xs = out.map((p) => p[0]);
    for (const [x] of g) { expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6); expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6); }
    expect(a.pocketM).toBeGreaterThan(1);
    expect(a.checks.some((c) => c.level === 'error')).toBe(false);
  });
  it('sin ranura (0 mm) los listones vuelven al largo interior', () => {
    const p2 = getTemplate('nicho').build({ ...v, gd: 0 }, { material: 'mdf-laca' });
    expect(p2.find((p) => p.id === 'costado-frente')!.pockets).toBeUndefined();
    expect(p2.find((p) => p.role === 'Listón asiento')!.profile[1][0]).toBe(444);
  });
});
