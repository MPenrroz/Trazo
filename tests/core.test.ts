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
    for (const t of TEMPLATES.filter((x) => x.id !== 'libre')) { // 'libre' depende del diseño del usuario
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

import { evalExpr } from '../src/core/expr';
import { STARTERS, buildFree, freeParams, shapesFromSketch } from '../src/core/free';
import type { SketchDoc } from '../src/core/types';

describe('fórmulas', () => {
  const s = { ancho: 1060, t: 18, baranda: 1, paso: 110 };
  it('aritmética, precedencia y funciones', () => {
    expect(evalExpr('ancho + 2*t', s)).toBe(1096);
    expect(evalExpr('(ancho - 40) / 2', s)).toBe(510);
    expect(evalExpr('floor((1200 - 100) / paso) + 1', s)).toBe(11);
    expect(evalExpr('max(t, 20) - -2', s)).toBe(22);
  });
  it('condiciones', () => {
    expect(evalExpr('baranda ? 300 : 0', s)).toBe(300);
    expect(evalExpr('ancho > 1000 && !0', s)).toBe(1);
  });
  it('errores claros', () => {
    expect(() => evalExpr('ancho +', s)).toThrow(/incompleta/);
    expect(() => evalExpr('alto * 2', s)).toThrow(/"alto" no es un parámetro/);
    expect(() => evalExpr('ancho / 0', s)).toThrow(/división por cero/);
    expect(() => evalExpr('ancho; alert(1)', s)).toThrow();
  });
});

describe('diseño libre: cama nido', () => {
  const st = STARTERS[0];
  const design = st.design();
  const sketch: SketchDoc = { elements: st.sketch!(0, 0), mmPerPx: 1, calibrated: false, underlayOpacity: 1 };
  const shapes = shapesFromSketch(sketch);
  const values = Object.fromEntries(freeParams(design).map((d) => [d.key, d.default]));
  const build = (v = values) => { const errors: string[] = []; const parts = buildFree(v, design, shapes, 'plywood-abedul', errors); return { parts, errors }; };

  it('la ventana circular se vuelve calado del respaldo', () => {
    expect(Object.keys(shapes)).toEqual(['respaldo-forma']);
    expect(shapes['respaldo-forma'].holes).toHaveLength(1);
  });
  it('arma respaldo, piecera, baranda y barrotes sin errores', () => {
    const { parts, errors } = build();
    expect(errors).toEqual([]);
    const resp = parts.find((p) => p.id === 'respaldo')!;
    expect(resp.holes).toHaveLength(1);
    expect(Math.max(...resp.profile.map((p) => p[0]))).toBeCloseTo(1096);
    expect(Math.max(...resp.profile.map((p) => p[1]))).toBeCloseTo(950);
    expect(parts.filter((p) => p.role === 'Barrote')).toHaveLength(11);
    expect(parts.find((p) => p.id === 'cama')!.process).toBe('ref');
  });
  it('los barrotes dejan luces ≤ 75 mm y quedan centrados en la baranda', () => {
    const bars = build().parts.filter((p) => p.role === 'Barrote').map((p) => p.plane.o[0]).sort((a, b) => a - b);
    expect(bars[1] - bars[0] - 40).toBeLessThanOrEqual(75);
    expect(bars[0]).toBeCloseTo(1200 - (bars[bars.length - 1] + 40), 6);
  });
  it('los Sí/No quitan piezas y la referencia no se cotiza ni anida', () => {
    const { parts } = build({ ...values, baranda: false, piecera: false });
    expect(parts.map((p) => p.role).sort()).toEqual(['Referencia', 'Respaldo']);
    const a = analyse(build().parts, DEFAULT_METHODS[0], DEFAULT_MATERIALS[0], pricing, DEFAULT_MATERIALS);
    expect(a.nest.placements.some((p) => p.part.process === 'ref')).toBe(false);
    expect(a.size[0]).toBeLessThan(2100); // tamaño del producto sin la cama
    expect(a.checks.some((c) => c.level === 'error')).toBe(false);
  });
  it('una fórmula con error se informa sin romper el resto', () => {
    const bad = { ...design, components: design.components.map((c) => (c.id === 'piecera' ? { ...c, h: 'alto_pie * 2' } : c)) };
    const errors: string[] = [];
    const parts = buildFree(values, bad, shapes, 'mdf', errors);
    expect(errors[0]).toMatch(/Piecera · Alto: "alto_pie" no es un parámetro/);
    expect(parts.some((p) => p.id === 'respaldo')).toBe(true);
  });
});

import { applyDrag, nudgeFormula } from '../src/core/direct';

describe('manipulación directa', () => {
  it('ajusta fórmulas de forma legible', () => {
    expect(nudgeFormula('600', 50)).toBe('650');
    expect(nudgeFormula('alto_cama - 20', 50)).toBe('alto_cama + 30');
    expect(nudgeFormula('alto_cama - 20', 20)).toBe('alto_cama');
    expect(nudgeFormula('(n - 1)*paso', -15)).toBe('(n - 1)*paso - 15');
    expect(nudgeFormula('baranda ? 300 : 0', 10)).toBe('(baranda ? 300 : 0) + 10');
    expect(nudgeFormula('a*-2', 10)).toBe('a*-2 + 10'); // no confunde el signo del factor con un ajuste
    expect(nudgeFormula('-t', -50)).toBe('-t - 50');
  });
  const st = STARTERS[0];
  const design = st.design();
  const params = freeParams(design);
  const values = Object.fromEntries(params.map((d) => [d.key, d.default]));
  it('un arrastre sobre una medida-parámetro cambia el parámetro y avisa a cuántas piezas afecta', () => {
    const r = applyDrag(design, values, params, 'respaldo', [{ field: 'h', delta: 50 }]);
    expect(r.values.alto_respaldo).toBe(1000);
    expect(r.design.components.find((c) => c.id === 'respaldo')!.h).toBe('alto_respaldo');
    expect(r.notes[0]).toMatch(/Alto respaldo/);
  });
  it('respeta el rango y mantiene fija la cara opuesta al estirar desde el lado negativo', () => {
    // estirar el respaldo hacia −Y en 400: ancho topa en 1600 (máx), Y se corre solo lo aplicado
    const r = applyDrag(design, values, params, 'respaldo', [{ field: 'w', delta: 400 }, { field: 'y', delta: -400 }], true);
    // w = "ancho + 2*t" no es un parámetro solo → se ajusta la fórmula
    expect(r.design.components.find((c) => c.id === 'respaldo')!.w).toBe('ancho + 2*t + 400');
    expect(r.design.components.find((c) => c.id === 'respaldo')!.y).toBe('-t - 400');
    const r2 = applyDrag(design, values, params, 'larg-sup', [{ field: 'w', delta: 900 }, { field: 'x', delta: -900 }], true, { scope: 'shared' });
    expect(r2.values.largo_baranda).toBe(1800); // tope del rango
    expect(r2.applied).toEqual([600, -600]);
    expect(r2.notes[0]).toMatch(/tope del rango/);
  });
  it('con alcance "solo esta pieza" no cambia el parámetro compartido (copias)', () => {
    const r = applyDrag(design, values, params, 'larg-sup', [{ field: 'w', delta: 50 }], false, { scope: 'piece' });
    expect(r.values.largo_baranda).toBe(values.largo_baranda);
    expect(r.design.components.find((c) => c.id === 'larg-sup')!.w).toBe('largo_baranda + 50');
  });
  it('vista previa fina: no redondea al paso del parámetro', () => {
    const r = applyDrag(design, values, params, 'larg-sup', [{ field: 'w', delta: 3 }], false, { scope: 'shared', fine: true });
    expect(r.applied[0]).toBe(3);
  });
  it('no modifica el diseño original', () => {
    applyDrag(design, values, params, 'barrote', [{ field: 'x', delta: 30 }]);
    expect(design.components.find((c) => c.id === 'barrote')!.x).toBe('(largo_baranda - 40 - (n - 1)*paso) / 2 + i*paso');
  });
});

import { freeSpan } from '../src/core/analysis';

describe('luz libre con apoyos intermedios', () => {
  it('la división central apoya el techo y la base de la estantería', () => {
    const parts = getTemplate('estanteria').build(defaults('estanteria'), { material: 'mdf' });
    const techo = parts.find((p) => p.id === 'techo')!;
    expect(freeSpan(techo, parts)).toBeLessThan(600); // ~582 en vez de 1164
    const one = getTemplate('estanteria').build({ ...defaults('estanteria'), cols: 1 }, { material: 'mdf' });
    expect(freeSpan(one.find((p) => p.id === 'techo')!, one)).toBeCloseTo(1164, 0);
  });
  it('el ejemplo por defecto abre factible (sin advertencias)', () => {
    const parts = getTemplate('estanteria').build(defaults('estanteria'), { material: 'plywood-abedul' });
    const a = analyse(parts, DEFAULT_METHODS[0], DEFAULT_MATERIALS[0], pricing, DEFAULT_MATERIALS);
    expect(a.checks.filter((c) => c.level === 'warn' || c.level === 'error')).toEqual([]);
    expect(a.checks.some((c) => /anclar a muro/.test(c.msg))).toBe(true); // sigue la recomendación, como nota
  });
});

import { partArea } from '../src/core/geom';

describe('ejemplos de diseño libre equivalentes a las plantillas', () => {
  const cases: [string, Record<string, unknown>[]][] = [
    ['estanteria', [{}, { w: 1800, n: 6, cols: 3, back: false, plinth: 0 }, { n: 0, cols: 1, t: 15 }]],
    ['mesa', [{}, { l: 2400, a: 1000, inset: 300, beam: 0, t: 18 }]],
  ];
  for (const [tpl, combos] of cases) {
    const st = STARTERS.find((s) => s.from?.template === tpl)!;
    for (const over of combos) {
      it(`${tpl} ${JSON.stringify(over)}`, () => {
        const tv = { ...defaults(tpl), ...over } as Record<string, number | boolean>;
        const ref = getTemplate(tpl).build(tv, { material: 'mdf' });
        const design = st.design();
        const fv: Record<string, number | boolean | string> = Object.fromEntries(freeParams(design).map((d) => [d.key, d.default]));
        for (const [k, key] of Object.entries(st.from!.map)) fv[key] = tv[k] as number | boolean;
        const errors: string[] = [];
        const mine = buildFree(fv, design, {}, 'mdf', errors);
        expect(errors).toEqual([]);
        expect(mine.length).toBe(ref.length);
        const r = bounds3(ref), m = bounds3(mine);
        for (let i = 0; i < 3; i++) { expect(m.min[i]).toBeCloseTo(r.min[i], 3); expect(m.max[i]).toBeCloseTo(r.max[i], 3); }
        const area = (ps: typeof ref) => ps.reduce((s, p) => s + partArea(p), 0);
        expect(area(mine)).toBeCloseTo(area(ref), 0);
        // misma ubicación de cada pieza (centros ordenados)
        const centers = (ps: typeof ref) => ps.map((p) => { const b = bounds3([p]); return b.min.map((v, i) => Math.round((v + b.max[i]) / 2)).join(','); }).sort();
        expect(centers(mine)).toEqual(centers(ref));
      });
    }
  }
});

import { mirrorClose, mirrorEl, segmentAt, stretchSegment, vertexAt } from '../src/sketch/ops';

describe('edición del boceto', () => {
  const rectPts: V2[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
  it('estirar un lado mantiene el rectángulo', () => {
    const r = stretchSegment(rectPts, 0, 160, true);
    expect(r).toEqual([[0, 0], [160, 0], [160, 50], [0, 50]]);
    const v = stretchSegment(rectPts, 1, 80, true); // lado vertical derecho: 50 → 80 (hacia abajo en pantalla)
    expect(v).toEqual([[0, 0], [100, 0], [100, 80], [0, 80]]);
  });
  it('estirar un lado de un polígono en L conserva sus ángulos', () => {
    const L: V2[] = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 80], [0, 80]];
    const r = stretchSegment(L, 0, 100, true);
    expect(r).toEqual([[0, 0], [100, 0], [100, 20], [20, 20], [20, 80], [0, 80]]);
  });
  it('media silueta sobre el eje se cierra reflejada', () => {
    const half: V2[] = [[101, 0], [150, 10], [160, 80], [99, 90]];
    const full = mirrorClose(half, 100, 4)!;
    expect(full[0]).toEqual([100, 0]);
    expect(full[3]).toEqual([100, 90]);
    expect(full).toHaveLength(6);
    expect(full[4]).toEqual([40, 80]);
    expect(mirrorClose([[50, 0], [150, 10]], 100, 4)).toBeNull(); // no empieza en el eje
  });
  it('reflejar un círculo y ubicar vértices y lados', () => {
    const c = mirrorEl({ id: 'a', kind: 'circle', c: [130, 10], r: 5 }, 100, 'b');
    expect(c.kind === 'circle' && c.c).toEqual([70, 10]);
    expect(vertexAt(rectPts, [98, 3], 6)).toBe(1);
    expect(segmentAt(rectPts, true, [50, 48], 6)).toBe(2);
    expect(segmentAt(rectPts, true, [50, 25], 6)).toBe(-1);
  });
});

import { mergeCollinear } from '../src/sketch/fit';
describe('simetría sin puntos sobrantes', () => {
  it('el rectángulo reflejado queda con 4 vértices', () => {
    const full = mirrorClose([[100, 0], [160, 0], [160, 80], [100, 80]], 100, 3)!;
    expect(mergeCollinear(full, true, 2)).toHaveLength(4);
  });
});

describe('calados sin deformar', () => {
  it('la ventana redonda sigue redonda en respaldo y piecera de distinto alto', () => {
    const st = STARTERS[0];
    const design = st.design();
    const shapes = shapesFromSketch({ elements: st.sketch!(0, 0), mmPerPx: 1, calibrated: false, underlayOpacity: 1 });
    const values = Object.fromEntries(freeParams(design).map((d) => [d.key, d.default]));
    const parts = buildFree(values, design, shapes, 'mdf');
    for (const id of ['respaldo', 'piecera']) {
      const hole = parts.find((p) => p.id === id)!.holes![0];
      const xs = hole.map((p) => p[0]), ys = hole.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 0);
    }
  });
});

import { advancedRepeat, fieldValue, linkedParam, parseRepeat, parseWhen, setRepeat } from '../src/core/simple';

describe('edición simple de piezas', () => {
  const design = STARTERS[0].design();
  const params = freeParams(design);
  const values = Object.fromEntries(params.map((d) => [d.key, d.default]));
  const bar = design.components.find((c) => c.id === 'barrote')!;
  it('reconoce la repetición de los barrotes y su paso ligado a un parámetro', () => {
    const r = parseRepeat(bar);
    expect(r.axis).toBe('x');
    expect(r.step).toBe('paso');
    expect(linkedParam(r.step, params)!.label).toBe('Paso entre barrotes');
    expect(fieldValue(bar, 'count', values)).toBe(11);
    expect(advancedRepeat(bar)).toBe(false);
  });
  it('cambiar la dirección mueve el término de repetición y quitarla lo elimina', () => {
    const c = setRepeat({ ...bar, x: '30', count: '1' }, '5', 'z', '200');
    expect(c.z).toBe('alto_cama - 20 + i*200');
    expect(c.x).toBe('30');
    const back = setRepeat(c, '1', null, '');
    expect(back.z).toBe('alto_cama - 20');
    expect(back.count).toBe('1');
    const fromZero = setRepeat({ ...bar, x: '0', count: '1' }, '3', 'x', 'ancho - t');
    expect(fromZero.x).toBe('i*(ancho - t)');
    expect(parseRepeat(fromZero)).toEqual({ axis: 'x', base: '0', step: '(ancho - t)' });
  });
  it('detecta repeticiones que el modo simple no puede mostrar (repisas en grilla)', () => {
    const shelf = STARTERS.find((s) => s.id === 'estanteria')!.design().components.find((c) => c.id === 'repisa')!;
    expect(advancedRepeat(shelf)).toBe(true);
  });
  it('lee la condición "Aparece"', () => {
    expect(parseWhen(bar, params)).toEqual({ kind: 'param', key: 'baranda' });
    expect(parseWhen({ ...bar, when: '' }, params)).toEqual({ kind: 'always' });
    expect(parseWhen({ ...bar, when: 'zocalo > 0' }, params)).toBeNull();
  });
});

import { buildPrompt, sanitizeProposal } from '../src/core/proposal';

describe('propuesta desde imagen', () => {
  const raw = {
    name: 'Banco con respaldo', summary: 'Banco de dos patas con respaldo curvo.', assumptions: ['Alto de asiento 450 mm'],
    params: [
      { key: 'largo', label: 'Largo', type: 'number', default: 1200, min: 800, max: 1800, step: 10, exposed: true },
      { key: 'Alto Asiento', label: 'Alto asiento', type: 'number', default: 450 },
      { key: 'largo', label: 'Duplicado', type: 'number', default: 1 },
      { key: 'respaldo', label: 'Con respaldo', type: 'bool', default: true },
    ],
    silhouettes: [{ id: 'pata', name: 'Pata curva', outline: [[0, 0], [1, 0], [1.2, 1], [0, 1]], holes: [[[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]] }],
    components: [
      { name: 'Asiento', orient: 'XY', w: 'largo', h: '400', t: 't', x: '0', y: '0', z: 'alto_asiento - t' },
      { name: 'Pata', orient: 'YZ', shape: 'pata', w: '400', h: 'alto_asiento - t', x: 'i*(largo - t)', count: '2' },
      { name: 'Respaldo', orient: 'XZ', shape: 'nube', w: 'largo', h: '300', y: '400 - t', z: 'alto_asiento', when: 'respaldo' },
      { name: 'Rota', orient: 'ZZ', w: 'alto_x', h: '100' },
    ],
  };
  const p = sanitizeProposal(raw, 18);
  it('limpia claves, descarta duplicados y acota rangos', () => {
    expect(p.design.params.map((q) => q.key)).toEqual(['largo', 'alto_asiento', 'respaldo']);
    const a = p.design.params[1];
    expect(a.min).toBeLessThan(450); expect(a.max).toBeGreaterThan(450);
    expect(p.issues.some((m) => /repetido/.test(m))).toBe(true);
  });
  it('enlaza siluetas, acota puntos y avisa piezas sin silueta o con fórmulas rotas', () => {
    expect(p.silhouettes).toHaveLength(1);
    expect(Math.max(...p.silhouettes[0].outline.map((q) => q[0]))).toBe(1);
    expect(p.design.components[1].shape).toBe(p.silhouettes[0].id);
    expect(p.design.components[2].shape).toBe('rect');
    expect(p.design.components[3].orient).toBe('XZ');
    expect(p.issues.some((m) => /"nube" no encontrada/.test(m))).toBe(true);
    expect(p.issues.some((m) => /alto_x/.test(m))).toBe(true);
  });
  it('tolera respuestas vacías o con basura', () => {
    expect(sanitizeProposal(null).issues[0]).toMatch(/no trae piezas/);
    expect(sanitizeProposal({ components: 'x', params: [null, 3] }).design.components).toEqual([]);
  });
  it('las instrucciones incluyen la medida conocida y el espesor', () => {
    const t = buildPrompt({ known: 'ancho 106 cm', thickness: 18 });
    expect(t).toContain('ancho 106 cm');
    expect(t).toContain('18 mm');
  });
});

import { addReference, newComponent } from '../src/core/free';
import { parseMm } from '../src/ui';

describe('volumen de referencia', () => {
  it('agrega parámetros y una pieza que no se fabrica', () => {
    const d = addReference({ params: [], components: [] }, 'Cama nido', 2000, 1060, 450);
    expect(d.params.map((p) => p.key)).toEqual(['ref_largo', 'ref_ancho', 'ref_alto']);
    const parts = buildFree(Object.fromEntries(freeParams(d).map((p) => [p.key, p.default])), d, {}, 'mdf');
    expect(parts[0].process).toBe('ref');
    expect(bounds3(parts).size.map(Math.round)).toEqual([2000, 1060, 450]);
    const a = analyse(parts, DEFAULT_METHODS[0], DEFAULT_MATERIALS[0], pricing, DEFAULT_MATERIALS);
    expect(a.nest.placements).toHaveLength(0);
    expect(addReference(d, 'Otra', 1, 1, 1).params.map((p) => p.key)).toContain('ref_largo_');
  });
  it('lee medidas escritas por personas', () => {
    expect(parseMm('106 cm')).toBe(1060);
    expect(parseMm('2 m')).toBe(2000);
    expect(parseMm('1,5m')).toBe(1500);
    expect(parseMm('450')).toBe(450);
    expect(parseMm('abc')).toBeNaN();
  });
});

import { arcPoints, sampleLoop, toArcs, toBeziers } from '../src/core/curve';

describe('curvas suaves (NURBS / arcos)', () => {
  const circle = Array.from({ length: 16 }, (_, k) => [100 * Math.cos((k / 16) * 2 * Math.PI), 100 * Math.sin((k / 16) * 2 * Math.PI)] as V2);
  it('pasa por los puntos y mantiene rectos los rectángulos', () => {
    const rect: V2[] = [[0, 0], [500, 0], [500, 300], [0, 300]];
    expect(sampleLoop(rect)).toEqual(rect);
    const bz = toBeziers(circle);
    expect(bz).toHaveLength(16);
    bz.forEach((b, k) => expect(b[0]).toEqual(circle[k]));
  });
  it('una spline por 16 puntos de un círculo queda a menos de 0,2 mm del círculo', () => {
    const err = Math.max(...sampleLoop(circle).map(([x, y]) => Math.abs(Math.hypot(x, y) - 100)));
    expect(err).toBeLessThan(0.2);
  });
  it('los arcos para CNC siguen la curva dentro de la tolerancia', () => {
    const vs = toArcs(circle, true, 0.05);
    expect(vs.some((v) => Math.abs(v.bulge) > 0)).toBe(true);
    const dense = sampleLoop(circle, true, 64, 0.5);
    const dist = (p: V2) => Math.min(...dense.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    vs.forEach((v, k) => {
      for (const p of arcPoints(v.p, vs[(k + 1) % vs.length].p, v.bulge, 4)) expect(dist(p)).toBeLessThan(0.15);
    });
    expect(vs.length).toBeLessThan(80);
  });
  it('una pieza con silueta suave guarda la curva exacta y el DXF lleva arcos', () => {
    const design = { params: [], components: [newComponent({ shape: 's1', w: '1000', h: '800' })] };
    const outline = circle.map(([x, y]) => [(x + 100) / 200, (y + 100) / 200] as V2);
    const parts = buildFree({ t: 18 }, design, { s1: { outline, holes: [], label: 'S', size: [1000, 800], smooth: true } }, 'mdf');
    expect(parts[0].curves?.outline).toHaveLength(16);
    expect(parts[0].profile.length).toBeGreaterThan(16);
    const a = analyse(parts, DEFAULT_METHODS[0], DEFAULT_MATERIALS[0], pricing, DEFAULT_MATERIALS);
    expect(nestingDxf(a.nest)).toMatch(/\n42\n-?0\.\d+/);
  });
});

import { findRef, placeAtRef } from '../src/core/free';

describe('piezas junto al mueble existente', () => {
  const base = addReference({ params: [], components: [] }, 'Cama nido', 2000, 1060, 450);
  const vals = (d: typeof base) => Object.fromEntries(freeParams(d).map((p) => [p.key, p.key === 't' ? 18 : p.default]));
  it('cabecera, pies y costado quedan pegados y siguen las medidas', () => {
    const r = findRef(base)!;
    const resp = newComponent({ name: 'Respaldo', h: '1000' });
    const d = { params: base.params, components: [...base.components, placeAtRef(resp, r, 'cabecera'), placeAtRef(resp, r, 'pies'), placeAtRef(newComponent({ h: '300', z: '450' }), r, 'frente')] };
    const ps = buildFree(vals(d), d, {}, 'mdf');
    const bb = (i: number) => bounds3([ps[i]]);
    expect(bb(1).min.map(Math.round)).toEqual([-18, -18, 0]);
    expect(bb(1).max.map(Math.round)).toEqual([0, 1078, 1000]);
    expect(Math.round(bb(2).min[0])).toBe(2000);
    expect(bb(3).min.map(Math.round)).toEqual([0, -18, 450]);
    expect(Math.round(bb(3).max[0])).toBe(2000);
    const a = analyse(ps, DEFAULT_METHODS[0], DEFAULT_MATERIALS[0], pricing, DEFAULT_MATERIALS);
    expect(a.checks.some((c) => /atraviesa/.test(c.msg))).toBe(false);
  });
  it('la propuesta de la IA que atraviesa la cama se corrige y la revisión avisa', () => {
    const raw = { components: [{ name: 'Respaldo nube', orient: 'XZ', w: 'ref_ancho + 2*t', h: '1000', x: '0', y: '300', z: '0' }] };
    const pr = sanitizeProposal(raw, 18, base);
    const c = pr.design.components.find((k) => k.name === 'Respaldo nube')!;
    expect(c.orient).toBe('YZ');
    expect(pr.issues.join(' ')).toMatch(/cabecera/);
    const bad = { params: base.params, components: [...base.components, newComponent({ name: 'Caja', w: '500', h: '200', x: '100', y: '100' })] };
    const a = analyse(buildFree(vals(bad), bad, {}, 'mdf'), DEFAULT_METHODS[0], DEFAULT_MATERIALS[0], pricing, DEFAULT_MATERIALS);
    expect(a.checks.some((k) => /atraviesa/.test(k.msg))).toBe(true);
  });
});

import { ghosts, isRealScale, pieceMap, realScaleElements, toMm } from '../src/core/pieceview';
import type { SketchDoc as SkDoc } from '../src/core/types';

describe('vista 2D de la pieza (2D | 3D)', () => {
  const st = STARTERS[0];
  const design = st.design();
  const values = Object.fromEntries(freeParams(design).map((d) => [d.key, d.key === 't' ? 18 : d.default]));
  const sk: SkDoc = { elements: st.sketch!(0, 0), mmPerPx: 0.7, calibrated: false, underlayOpacity: 1 };
  const resp = () => buildFree(values, design, shapesFromSketch(sk), 'mdf').find((p) => p.id === 'respaldo')!;
  it('llevar la silueta a escala real no cambia la pieza en 3D', () => {
    const before = resp();
    expect(isRealScale(sk, 'respaldo-forma', before)).toBe(false);
    const els = realScaleElements(sk, 'respaldo-forma', before, true)!;
    for (const e of els) sk.elements[sk.elements.findIndex((x) => x.id === e.id)] = e;
    const after = resp();
    expect(isRealScale(sk, 'respaldo-forma', after)).toBe(true);
    const near = (a: number[][], b: number[][]) => a.every((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < 0.01);
    expect(near(after.profile, before.profile)).toBe(true);
    expect(near(after.holes![0], before.holes![0])).toBe(true);
    // 1 px del boceto = mmPerPx mm de la pieza
    const m = pieceMap(sk, 'respaldo-forma', after)!;
    const e = sk.elements.find((x) => x.id === 'respaldo-forma')!;
    const pts = e.kind === 'poly' ? e.pts : [];
    const bx = Math.max(...pts.map((p) => toMm(m, p)[0]));
    expect(Math.round(bx)).toBe(Math.round(Math.max(...after.profile.map((p) => p[0]))));
  });
  it('proyecta las piezas vecinas sobre el plano de la pieza', () => {
    const parts = buildFree(values, design, shapesFromSketch(sk), 'mdf');
    const g = ghosts(parts.find((p) => p.id === 'respaldo')!, parts);
    expect(g.some((x) => x.ref)).toBe(true);
    expect(g.length).toBeGreaterThan(1);
  });
});
