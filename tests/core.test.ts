import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analysis';
import { DEFAULT_MATERIALS, DEFAULT_METHODS } from '../src/core/catalog';
import { bounds3, partVertices, polyArea } from '../src/core/geom';
import { nest } from '../src/core/nesting';
import { clampValue, resolveParams, resolveValues } from '../src/core/params';
import { TEMPLATES, getTemplate } from '../src/core/templates';
import { fitStroke, profileFromSketch } from '../src/sketch/fit';
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
