import { boxPart, bounds2, ccw } from './geom';
import type { ParamDef, ParamValues, Part, V2 } from './types';

export interface TemplateCtx { material: string; profile?: V2[] }

export interface Template {
  id: string;
  name: string;
  description: string;
  usesProfile: boolean;
  params: ParamDef[];
  build(v: ParamValues, ctx: TemplateCtx): Part[];
}

const thicknessParam = (def = 18): ParamDef => ({
  key: 't', label: 'Espesor tablero', type: 'choice', unit: 'mm', default: def, group: 'Material', exposed: false,
  options: [9, 12, 15, 18, 21, 24].map((n) => ({ value: n, label: `${n} mm` })),
});

const num = (v: ParamValues, k: string) => Number(v[k]);

/** Estantería modular de tableros: laterales, techo, base, repisas, fondo y zócalo. */
const shelf: Template = {
  id: 'estanteria',
  name: 'Estantería / librero',
  description: 'Mueble de tableros con repisas equidistantes, fondo y zócalo opcionales.',
  usesProfile: false,
  params: [
    { key: 'w', label: 'Ancho', type: 'number', unit: 'mm', min: 400, max: 2400, step: 10, default: 1200, group: 'Dimensiones', exposed: true },
    { key: 'h', label: 'Alto', type: 'number', unit: 'mm', min: 400, max: 2400, step: 10, default: 1800, group: 'Dimensiones', exposed: true },
    { key: 'd', label: 'Profundidad', type: 'number', unit: 'mm', min: 200, max: 600, step: 10, default: 350, group: 'Dimensiones', exposed: true },
    { key: 'n', label: 'Repisas intermedias', type: 'int', min: 0, max: 10, step: 1, default: 4, group: 'Configuración', exposed: true },
    { key: 'cols', label: 'Módulos (columnas)', type: 'int', min: 1, max: 6, step: 1, default: 2, group: 'Configuración', exposed: true },
    { key: 'back', label: 'Fondo', type: 'bool', default: true, group: 'Configuración', exposed: true },
    { key: 'plinth', label: 'Zócalo', type: 'number', unit: 'mm', min: 0, max: 150, step: 5, default: 60, group: 'Configuración', exposed: false },
    thicknessParam(18),
  ],
  build(v, { material }) {
    const W = num(v, 'w'), H = num(v, 'h'), D = num(v, 'd'), T = num(v, 't');
    const n = Math.round(num(v, 'n')), cols = Math.max(1, Math.round(num(v, 'cols')));
    const plinth = num(v, 'plinth'), back = !!v.back;
    const bt = back ? T : 0; // fondo encajado entre laterales
    const parts: Part[] = [];
    const innerW = W - 2 * T;
    const dShelf = D - bt;
    parts.push(boxPart('lat-izq', 'Lateral izquierdo', 'Lateral', material, [0, 0, 0], [T, D, H], 'x'));
    parts.push(boxPart('lat-der', 'Lateral derecho', 'Lateral', material, [W - T, 0, 0], [T, D, H], 'x'));
    parts.push(boxPart('techo', 'Techo', 'Cubierta', material, [T, 0, H - T], [innerW, D, T], 'z'));
    parts.push(boxPart('base', 'Base', 'Base', material, [T, 0, plinth], [innerW, D, T], 'z'));
    if (plinth > 0) parts.push(boxPart('zocalo', 'Zócalo', 'Zócalo', material, [T, T, 0], [innerW, T, plinth], 'y'));
    // divisiones verticales
    const colW = (innerW - (cols - 1) * T) / cols;
    const z0 = plinth + T, z1 = H - T;
    for (let c = 1; c < cols; c++) {
      const x = T + c * colW + (c - 1) * T;
      parts.push(boxPart(`div-${c}`, `División ${c}`, 'División', material, [x, 0, z0], [T, dShelf, z1 - z0], 'x'));
    }
    const gap = (z1 - z0 - n * T) / (n + 1);
    for (let c = 0; c < cols; c++) {
      const x = T + c * (colW + T);
      for (let i = 1; i <= n; i++) {
        const z = z0 + i * gap + (i - 1) * T;
        parts.push(boxPart(`rep-${c + 1}-${i}`, `Repisa ${c + 1}.${i}`, 'Repisa', material, [x, 0, z], [colW, dShelf, T], 'z'));
      }
    }
    if (back) parts.push(boxPart('fondo', 'Fondo', 'Fondo', material, [T, D - bt, plinth + T], [innerW, bt, H - plinth - 2 * T], 'y'));
    return parts;
  },
};

/** Mesa de placas: cubierta + 2 patas tipo placa + travesaño. */
const table: Template = {
  id: 'mesa',
  name: 'Mesa de placas',
  description: 'Mesa con cubierta, dos patas-placa y travesaño longitudinal. Encastrable para CNC.',
  usesProfile: false,
  params: [
    { key: 'l', label: 'Largo', type: 'number', unit: 'mm', min: 800, max: 3000, step: 10, default: 1800, group: 'Dimensiones', exposed: true },
    { key: 'a', label: 'Ancho', type: 'number', unit: 'mm', min: 500, max: 1200, step: 10, default: 850, group: 'Dimensiones', exposed: true },
    { key: 'h', label: 'Alto', type: 'number', unit: 'mm', min: 400, max: 1100, step: 10, default: 750, group: 'Dimensiones', exposed: true },
    { key: 'inset', label: 'Retiro de patas', type: 'number', unit: 'mm', min: 0, max: 400, step: 10, default: 150, group: 'Configuración', exposed: false },
    { key: 'beam', label: 'Alto travesaño', type: 'number', unit: 'mm', min: 0, max: 300, step: 10, default: 140, group: 'Configuración', exposed: false },
    thicknessParam(24),
  ],
  build(v, { material }) {
    const L = num(v, 'l'), A = num(v, 'a'), H = num(v, 'h'), T = num(v, 't');
    const inset = num(v, 'inset'), beam = num(v, 'beam');
    const legH = H - T, legW = A - 2 * Math.min(inset / 2, 80);
    const y0 = (A - legW) / 2;
    const parts: Part[] = [boxPart('cubierta', 'Cubierta', 'Cubierta', material, [0, 0, legH], [L, A, T], 'z')];
    parts.push(boxPart('pata-1', 'Pata izquierda', 'Pata', material, [inset, y0, 0], [T, legW, legH], 'x'));
    parts.push(boxPart('pata-2', 'Pata derecha', 'Pata', material, [L - inset - T, y0, 0], [T, legW, legH], 'x'));
    if (beam > 0) {
      const bl = L - 2 * inset - 2 * T;
      parts.push(boxPart('travesano', 'Travesaño', 'Travesaño', material, [inset + T, A / 2 - T / 2, legH - beam], [bl, T, beam], 'y'));
    }
    return parts;
  },
};

/** Perfil por defecto (silueta de banco) si aún no hay boceto. Coordenadas: x = profundidad, y = altura. */
export const DEFAULT_PROFILE: V2[] = [[0, 0], [60, 0], [80, 380], [360, 400], [380, 0], [440, 0], [430, 450], [10, 450]];

/** Costillas: el perfil dibujado a mano se repite N veces a lo largo del producto (banco, biombo, lámpara…). */
const ribs: Template = {
  id: 'costillas',
  name: 'Costillas desde boceto',
  description: 'Usa el perfil cerrado de tu boceto como costilla y la repite en serie. Con 1 costilla = pieza única plana.',
  usesProfile: true,
  params: [
    { key: 'l', label: 'Largo total', type: 'number', unit: 'mm', min: 0, max: 4000, step: 10, default: 1400, group: 'Dimensiones', exposed: true },
    { key: 'n', label: 'N° de costillas', type: 'int', min: 1, max: 60, step: 1, default: 12, group: 'Configuración', exposed: true },
    { key: 'scale', label: 'Escala del perfil', type: 'number', unit: '%', min: 50, max: 200, step: 1, default: 100, group: 'Dimensiones', exposed: true },
    { key: 'slats', label: 'Largueros de unión', type: 'int', min: 0, max: 4, step: 1, default: 2, group: 'Configuración', exposed: false },
    thicknessParam(18),
  ],
  build(v, { material, profile }) {
    const L = num(v, 'l'), n = Math.max(1, Math.round(num(v, 'n'))), T = num(v, 't'), s = num(v, 'scale') / 100;
    const slats = Math.round(num(v, 'slats'));
    const raw = ccw(profile && profile.length >= 3 ? profile : DEFAULT_PROFILE);
    const b = bounds2(raw);
    const prof: V2[] = raw.map(([x, y]) => [(x - b.x0) * s, (y - b.y0) * s]);
    const pb = bounds2(prof);
    const parts: Part[] = [];
    const span = n > 1 ? (Math.max(L, n * T) - T) / (n - 1) : 0;
    for (let i = 0; i < n; i++) {
      // costilla en plano YZ, espesor en X
      parts.push({ id: `cost-${i + 1}`, name: `Costilla ${i + 1}`, role: 'Costilla', material, thickness: T,
        plane: { o: [i * span, 0, 0], x: [0, 1, 0], y: [0, 0, 1] }, profile: prof });
    }
    if (n > 1 && slats > 0) {
      // largueros horizontales apoyados en la parte superior del perfil
      const total = (n - 1) * span + T, sw = 60;
      for (let k = 0; k < slats; k++) {
        const y = pb.w * (k + 1) / (slats + 1) - sw / 2;
        parts.push(boxPart(`larg-${k + 1}`, `Larguero ${k + 1}`, 'Larguero', material, [0, y, pb.h], [total, sw, T], 'z'));
      }
    }
    return parts;
  },
};

export const TEMPLATES: Template[] = [shelf, table, ribs];
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? shelf;
