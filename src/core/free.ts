import { evalExpr, type Scope } from './expr';
import { arc, bounds2, ccw, polyArea, uid } from './geom';
import type { ParamDef, ParamValues, Part, Plane, SketchDoc, SketchEl, V2 } from './types';

/**
 * Diseño libre: el arquitecto define sus propios parámetros y arma el producto con piezas.
 * Cada medida/posición es una fórmula sobre los parámetros (+ `t` espesor, `i` índice y `n` cantidad en repeticiones).
 * Ejes: X = largo, Y = profundidad/ancho, Z = alto. La posición es la esquina mínima de la pieza.
 */
export interface Component {
  id: string;
  name: string;
  /** Agrupa en despiece y capas de Rhino (Respaldo, Barrote…). */
  role: string;
  /** 'rect' o id de una forma cerrada del boceto (se escala a ancho × alto). */
  shape: string;
  /** XZ = frontal (ancho→X, alto→Z, espesor→Y) · YZ = lateral (ancho→Y, alto→Z, espesor→X) · XY = horizontal (ancho→X, alto→Y, espesor→Z) */
  orient: 'XZ' | 'YZ' | 'XY';
  w: string; h: string; t: string;
  x: string; y: string; z: string;
  /** Cantidad de copias; en las fórmulas `i` va de 0 a n−1. */
  count: string;
  /** La pieza existe solo si la fórmula ≠ 0 (p. ej. un parámetro Sí/No). Vacío = siempre. */
  when: string;
  /** Usar las formas dibujadas dentro de la silueta como calados. */
  holes: boolean;
  /** tablero = se fabrica en CNC · tapiz = se cotiza por m² · ref = contexto (cama existente, muro…), no se fabrica. */
  kind: 'tablero' | 'tapiz' | 'ref';
}

export interface FreeDesign { params: ParamDef[]; components: Component[] }

/** Forma del boceto normalizada a [0,1]×[0,1] (Y hacia arriba), con sus calados. */
export interface Shape { outline: V2[]; holes: V2[][]; label: string; size: V2 }

export const THICKNESS_PARAM: ParamDef = {
  key: 't', label: 'Espesor tablero', type: 'choice', unit: 'mm', default: 18, group: 'Material', exposed: false,
  options: [9, 12, 15, 18, 21, 24].map((n) => ({ value: n, label: `${n} mm` })),
};

export const freeParams = (f?: FreeDesign): ParamDef[] => {
  const ps = f?.params ?? [];
  return ps.some((p) => p.key === 't') ? ps : [...ps, THICKNESS_PARAM];
};

export const emptyFree = (): FreeDesign => ({ params: [], components: [] });

export function newComponent(partial: Partial<Component> = {}): Component {
  return { id: uid('c-'), name: 'Pieza', role: '', shape: 'rect', orient: 'XZ', w: '600', h: '400', t: 't', x: '0', y: '0', z: '0', count: '1', when: '', holes: true, kind: 'tablero', ...partial };
}

/** Polígono de un elemento del boceto (px, Y hacia abajo). */
function elPoly(e: SketchEl): V2[] | null {
  if (e.kind === 'circle') return arc(e.c[0], e.c[1], e.r, 0, 2 * Math.PI, 48).slice(0, -1);
  if (e.kind === 'poly' && e.closed && e.pts.length >= 3) return e.pts;
  return null;
}

function inside(p: V2, poly: V2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Formas cerradas del boceto utilizables como piezas. Las formas contenidas dentro de otra
 * se vuelven calados de esa forma (no se listan aparte).
 */
export function shapesFromSketch(sk: SketchDoc): Record<string, Shape> {
  const polys = sk.elements.map((e) => ({ e, poly: elPoly(e) })).filter((x): x is { e: SketchEl; poly: V2[] } => !!x.poly);
  const area = (p: V2[]) => Math.abs(polyArea(p));
  const parentOf = new Map<string, string>();
  for (const a of polys) {
    let best: { id: string; area: number } | null = null;
    for (const b of polys) {
      if (a === b || area(b.poly) <= area(a.poly)) continue;
      if (a.poly.every((pt) => inside(pt, b.poly)) && (!best || area(b.poly) < best.area)) best = { id: b.e.id, area: area(b.poly) };
    }
    if (best) parentOf.set(a.e.id, best.id);
  }
  const out: Record<string, Shape> = {};
  let k = 0;
  for (const s of polys) {
    if (parentOf.has(s.e.id)) continue;
    k++;
    const bb = bounds2(s.poly);
    const norm = (pts: V2[]): V2[] => pts.map(([x, y]) => [(x - bb.x0) / (bb.w || 1), (bb.y1 - y) / (bb.h || 1)] as V2);
    const holes = polys.filter((h) => parentOf.get(h.e.id) === s.e.id).map((h) => ccw(norm(h.poly)).reverse());
    const size: V2 = [bb.w * sk.mmPerPx, bb.h * sk.mmPerPx];
    const nm = (s.e.kind === 'poly' || s.e.kind === 'circle') && s.e.name ? s.e.name : `Silueta ${k}`;
    out[s.e.id] = { outline: ccw(norm(s.poly)), holes, size, label: `${nm}${holes.length ? ` (${holes.length} calado${holes.length > 1 ? 's' : ''})` : ''}` };
  }
  return out;
}

/** Calado normalizado → mm: centro estirado con la pieza, forma escalada uniformemente (factor menor). */
export function keepHole(hh: V2[], w: number, h: number, size?: V2): V2[] {
  if (!size || size[0] <= 0 || size[1] <= 0) return hh.map(([u, v]) => [u * w, v * h] as V2);
  const b = bounds2(hh);
  const cu = (b.x0 + b.x1) / 2, cv = (b.y0 + b.y1) / 2;
  const s = Math.min(w / size[0], h / size[1]);
  return hh.map(([u, v]) => [cu * w + (u - cu) * size[0] * s, cv * h + (v - cv) * size[1] * s] as V2);
}

function planeFor(orient: Component['orient'], x: number, y: number, z: number, t: number): Plane {
  if (orient === 'XZ') return { o: [x, y + t, z], x: [1, 0, 0], y: [0, 0, 1] }; // normal −Y → ocupa [y, y+t]
  if (orient === 'YZ') return { o: [x, y, z], x: [0, 1, 0], y: [0, 0, 1] }; // normal +X
  return { o: [x, y, z], x: [1, 0, 0], y: [0, 1, 0] }; // normal +Z
}

export function scopeFrom(values: ParamValues): Scope {
  const s: Scope = {};
  for (const [k, v] of Object.entries(values)) s[k] = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  return s;
}

/** Construye las piezas. Los errores de fórmulas se acumulan en `errors` (pieza: mensaje) sin detener el resto. */
export function buildFree(values: ParamValues, design: FreeDesign | undefined, shapes: Record<string, Shape>, material: string, errors: string[] = []): Part[] {
  const parts: Part[] = [];
  const scope = scopeFrom(values);
  for (const c of design?.components ?? []) {
    const fail = (field: string, e: unknown) => errors.push(`${c.name} · ${field}: ${(e as Error).message}`);
    const ev = (field: string, src: string, s: Scope) => { try { return evalExpr(src, s); } catch (e) { fail(field, e); return NaN; } };
    if (c.when.trim() && !ev('Presente si', c.when, scope)) continue;
    const n = Math.round(ev('Cantidad', c.count || '1', scope));
    if (!Number.isFinite(n)) continue;
    if (n > 300) { errors.push(`${c.name}: ${n} copias es demasiado (máx. 300)`); continue; }
    for (let i = 0; i < n; i++) {
      const s = { ...scope, i, n };
      const [w, h, t, x, y, z] = (['w', 'h', 't', 'x', 'y', 'z'] as const).map((f) => ev({ w: 'Ancho', h: 'Alto', t: 'Espesor', x: 'X', y: 'Y', z: 'Z' }[f], c[f], s));
      if ([w, h, t, x, y, z].some((v) => !Number.isFinite(v))) break;
      if (w <= 0 || h <= 0 || t <= 0) { errors.push(`${c.name}: ancho, alto y espesor deben ser mayores que 0 (${Math.round(w)} × ${Math.round(h)} × ${Math.round(t)})`); break; }
      let outline: V2[] = [[0, 0], [w, 0], [w, h], [0, h]], holes: V2[][] = [];
      if (c.shape !== 'rect') {
        const sh = shapes[c.shape];
        if (!sh) { if (i === 0) errors.push(`${c.name}: la forma del boceto ya no existe; se usa un rectángulo`); }
        else {
          outline = sh.outline.map(([u, v]) => [u * w, v * h]);
          // los calados no se deforman: se ubican estirados con la silueta, pero conservan su proporción
          // (una ventana redonda sigue redonda aunque el respaldo cambie de alto)
          if (c.holes) holes = sh.holes.map((hh) => keepHole(hh, w, h, sh.size));
        }
      }
      const kind = c.kind ?? 'tablero';
      parts.push({
        id: n > 1 ? `${c.id}-${i + 1}` : c.id, name: n > 1 ? `${c.name} ${i + 1}` : c.name, role: c.role || c.name,
        material: kind === 'tablero' ? material : kind, thickness: t, plane: planeFor(c.orient, x, y, z, t),
        profile: outline, holes: holes.length ? holes : undefined, process: kind === 'tablero' ? undefined : kind, source: { comp: c.id, i },
      });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------- ejemplo de partida

const num = (key: string, label: string, def: number, min: number, max: number, step: number, exposed: boolean, group: string, help?: string): ParamDef =>
  ({ key, label, type: 'number', unit: 'mm', default: def, min, max, step, exposed, group, help });
const bool = (key: string, label: string, def: boolean, exposed: boolean, group: string): ParamDef => ({ key, label, type: 'bool', default: def, exposed, group });

/** Silueta de respaldo con "orejas" y ventana circular, en px de boceto (Y hacia abajo). */
function headboardSketch(ox: number, oy: number, S = 400): SketchEl[] {
  const P = (u: number, v: number): V2 => [ox + u * S, oy + (1 - v) * S];
  const pts: V2[] = [P(0, 0), P(1, 0), P(1, 0.78)];
  const ear = (cx: number) => arc(cx, 0.84, 0.14, (-25 * Math.PI) / 180, (205 * Math.PI) / 180, 20);
  const mid = arc(0.5, 0.4, Math.hypot(0.233, 0.38), Math.atan2(0.38, 0.233), Math.PI - Math.atan2(0.38, 0.233), 12);
  for (const [u, v] of [...ear(0.86), ...mid, ...ear(0.14)]) pts.push(P(u, v));
  pts.push(P(0, 0.78));
  const c = P(0.5, 0.48);
  return [
    { id: 'respaldo-forma', kind: 'poly', closed: true, smooth: true, pts },
    { id: 'respaldo-ventana', kind: 'circle', c, r: 0.11 * S },
  ];
}

export interface Starter {
  id: string;
  name: string;
  description: string;
  design: () => FreeDesign;
  /** Siluetas que el ejemplo agrega al boceto (opcional). */
  sketch?: (ox: number, oy: number) => SketchEl[];
  /** Plantilla antigua equivalente y cómo traducir sus valores (para "Pasar a diseño libre"). */
  from?: { template: string; map: Record<string, string> };
}

export const STARTERS: Starter[] = [{
  id: 'cama-nido',
  name: 'Cama nido: respaldo + baranda',
  description: 'Respaldo y piecera con silueta del boceto, baranda de barrotes removible. Cama de referencia 106 × 200 × 45 cm.',
  sketch: headboardSketch,
  design: () => ({
    params: [
      num('ancho', 'Ancho cama', 1060, 800, 1600, 10, true, 'Cama existente'),
      num('largo', 'Largo cama', 2000, 1800, 2200, 10, true, 'Cama existente'),
      num('alto_cama', 'Alto cama', 450, 300, 600, 5, true, 'Cama existente'),
      num('alto_respaldo', 'Alto respaldo', 950, 700, 1300, 10, true, 'Respaldo'),
      bool('piecera', 'Piecera', true, true, 'Respaldo'),
      num('alto_piecera', 'Alto piecera', 700, 500, 1000, 10, false, 'Respaldo'),
      bool('baranda', 'Baranda lateral', true, true, 'Baranda'),
      num('largo_baranda', 'Largo baranda', 1200, 600, 1800, 10, true, 'Baranda'),
      num('alto_baranda', 'Alto sobre la cama', 280, 200, 400, 10, true, 'Baranda'),
      num('paso', 'Paso entre barrotes', 110, 90, 115, 5, false, 'Baranda', 'Con barrotes de 40 mm, paso ≤ 115 deja luces ≤ 75 mm (seguridad infantil).'),
      { ...THICKNESS_PARAM },
    ],
    components: [
      newComponent({ id: 'cama', name: 'Cama nido (referencia)', role: 'Referencia', orient: 'XY', w: 'largo', h: 'ancho', t: 'alto_cama', kind: 'ref' }),
      newComponent({ id: 'respaldo', name: 'Respaldo', role: 'Respaldo', shape: 'respaldo-forma', orient: 'YZ', w: 'ancho + 2*t', h: 'alto_respaldo', x: '-t', y: '-t', z: '0' }),
      newComponent({ id: 'piecera', name: 'Piecera', role: 'Piecera', shape: 'respaldo-forma', orient: 'YZ', w: 'ancho + 2*t', h: 'alto_piecera', x: 'largo', y: '-t', z: '0', when: 'piecera' }),
      newComponent({ id: 'larg-sup', name: 'Larguero superior', role: 'Larguero baranda', orient: 'XZ', w: 'largo_baranda', h: '60', x: '0', y: '-t', z: 'alto_cama + alto_baranda - 60', when: 'baranda' }),
      newComponent({ id: 'larg-inf', name: 'Larguero inferior', role: 'Larguero baranda', orient: 'XZ', w: 'largo_baranda', h: '80', x: '0', y: '-t', z: 'alto_cama - 100', when: 'baranda' }),
      newComponent({ id: 'barrote', name: 'Barrote', role: 'Barrote', orient: 'XZ', w: '40', h: 'alto_baranda - 40', x: '(largo_baranda - 40 - (n - 1)*paso) / 2 + i*paso', y: '-t', z: 'alto_cama - 20', count: 'floor((largo_baranda - 100) / paso) + 1', when: 'baranda' }),
    ],
  }),
}, {
  id: 'estanteria',
  name: 'Estantería / librero',
  description: 'Laterales, techo, base, zócalo, módulos con divisiones, repisas equidistantes y fondo opcional.',
  from: { template: 'estanteria', map: { w: 'ancho', h: 'alto', d: 'prof', n: 'repisas', cols: 'modulos', back: 'fondo', plinth: 'zocalo', t: 't' } },
  design: () => {
    // ancho de cada módulo y separación vertical entre repisas, como fórmulas reutilizables
    const col = '(ancho - 2*t - (modulos - 1)*t) / modulos';
    const gap = '(alto - zocalo - 2*t - repisas*t) / (repisas + 1)';
    const dIn = 'prof - (fondo ? t : 0)';
    return {
      params: [
        num('ancho', 'Ancho', 1200, 400, 2400, 10, true, 'Dimensiones'),
        num('alto', 'Alto', 1800, 400, 2400, 10, true, 'Dimensiones'),
        num('prof', 'Profundidad', 350, 200, 600, 10, true, 'Dimensiones'),
        { key: 'repisas', label: 'Repisas intermedias', type: 'int', default: 4, min: 0, max: 10, step: 1, exposed: true, group: 'Configuración' },
        { key: 'modulos', label: 'Módulos (columnas)', type: 'int', default: 2, min: 1, max: 6, step: 1, exposed: true, group: 'Configuración' },
        bool('fondo', 'Fondo', true, true, 'Configuración'),
        num('zocalo', 'Zócalo', 60, 0, 150, 5, false, 'Configuración'),
        { ...THICKNESS_PARAM },
      ],
      components: [
        newComponent({ id: 'lateral', name: 'Lateral', role: 'Lateral', orient: 'YZ', w: 'prof', h: 'alto', x: 'i*(ancho - t)', count: '2' }),
        newComponent({ id: 'techo', name: 'Techo', role: 'Cubierta', orient: 'XY', w: 'ancho - 2*t', h: 'prof', x: 't', z: 'alto - t' }),
        newComponent({ id: 'base', name: 'Base', role: 'Base', orient: 'XY', w: 'ancho - 2*t', h: 'prof', x: 't', z: 'zocalo' }),
        newComponent({ id: 'zocalo', name: 'Zócalo', role: 'Zócalo', orient: 'XZ', w: 'ancho - 2*t', h: 'zocalo', x: 't', y: 't', when: 'zocalo > 0' }),
        newComponent({ id: 'division', name: 'División', role: 'División', orient: 'YZ', w: dIn, h: 'alto - zocalo - 2*t', x: `t + (i + 1)*${col} + i*t`, z: 'zocalo + t', count: 'modulos - 1' }),
        newComponent({ id: 'repisa', name: 'Repisa', role: 'Repisa', orient: 'XY', w: col, h: dIn, x: `t + floor(i / repisas)*(${col} + t)`, z: `zocalo + t + (i % repisas + 1)*${gap} + (i % repisas)*t`, count: 'repisas*modulos' }),
        newComponent({ id: 'fondo', name: 'Fondo', role: 'Fondo', orient: 'XZ', w: 'ancho - 2*t', h: 'alto - zocalo - 2*t', x: 't', y: 'prof - t', z: 'zocalo + t', when: 'fondo' }),
      ],
    };
  },
}, {
  id: 'mesa',
  name: 'Mesa de placas',
  description: 'Cubierta, dos patas-placa y travesaño longitudinal.',
  from: { template: 'mesa', map: { l: 'largo', a: 'ancho', h: 'alto', inset: 'retiro', beam: 'travesano', t: 't' } },
  design: () => ({
    params: [
      num('largo', 'Largo', 1800, 800, 3000, 10, true, 'Dimensiones'),
      num('ancho', 'Ancho', 850, 500, 1200, 10, true, 'Dimensiones'),
      num('alto', 'Alto', 750, 400, 1100, 10, true, 'Dimensiones'),
      num('retiro', 'Retiro de patas', 150, 0, 400, 10, false, 'Configuración'),
      num('travesano', 'Alto travesaño', 140, 0, 300, 10, false, 'Configuración'),
      { ...THICKNESS_PARAM, default: 24 },
    ],
    components: [
      newComponent({ id: 'cubierta', name: 'Cubierta', role: 'Cubierta', orient: 'XY', w: 'largo', h: 'ancho', z: 'alto - t' }),
      newComponent({ id: 'pata', name: 'Pata', role: 'Pata', orient: 'YZ', w: 'ancho - 2*min(retiro/2, 80)', h: 'alto - t', x: 'retiro + i*(largo - 2*retiro - t)', y: 'min(retiro/2, 80)', count: '2' }),
      newComponent({ id: 'travesano', name: 'Travesaño', role: 'Travesaño', orient: 'XZ', w: 'largo - 2*retiro - 2*t', h: 'travesano', x: 'retiro + t', y: 'ancho/2 - t/2', z: 'alto - t - travesano', when: 'travesano > 0' }),
    ],
  }),
}];
