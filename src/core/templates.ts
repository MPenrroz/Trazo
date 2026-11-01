import { buildFree, type FreeDesign, type Shape } from './free';
import { arc, boxPart, bounds2, ccw } from './geom';
import type { ParamDef, ParamValues, Part, V2 } from './types';

export interface TemplateCtx {
  material: string;
  profile?: V2[];
  /** Diseño libre y formas del boceto (tipología 'libre'). */
  free?: FreeDesign;
  shapes?: Record<string, Shape>;
  /** Errores de fórmulas detectados al construir. */
  errors?: string[];
}

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

/**
 * Nicho de lectura / sofá infantil: caja de tableros con corte semicircular en los costados largos,
 * asiento curvo de listones (fresados del mismo tablero) con cojín tapizado y librero lateral abierto.
 * Ejes: X = largo, Y = profundidad (frente en Y=0), Z = alto.
 */
const nook: Template = {
  id: 'nicho',
  name: 'Nicho de lectura (asiento curvo + librero)',
  description: 'Caja con corte semicircular en los costados, asiento de listones curvados con cojín y librero lateral abierto.',
  usesProfile: false,
  params: [
    { key: 'ws', label: 'Diámetro del asiento', type: 'number', unit: 'mm', min: 500, max: 1100, step: 10, default: 760, group: 'Dimensiones', exposed: true, help: 'Ancho del corte semicircular.' },
    { key: 'h', label: 'Alto', type: 'number', unit: 'mm', min: 420, max: 750, step: 10, default: 560, group: 'Dimensiones', exposed: true },
    { key: 'd', label: 'Profundidad', type: 'number', unit: 'mm', min: 380, max: 650, step: 10, default: 480, group: 'Dimensiones', exposed: true },
    { key: 'libr', label: 'Librero lateral', type: 'bool', default: true, group: 'Configuración', exposed: true },
    { key: 'wb', label: 'Ancho librero', type: 'number', unit: 'mm', min: 200, max: 450, step: 10, default: 280, group: 'Configuración', exposed: true },
    { key: 'cojin', label: 'Cojín tapizado', type: 'bool', default: true, group: 'Configuración', exposed: true },
    { key: 'list', label: 'Listones del asiento', type: 'int', min: 8, max: 30, step: 1, default: 16, group: 'Fabricación', exposed: false },
    { key: 'plinth', label: 'Zócalo retranqueado', type: 'number', unit: 'mm', min: 0, max: 100, step: 5, default: 50, group: 'Fabricación', exposed: false },
    { key: 'gd', label: 'Profundidad ranura listones', type: 'number', unit: 'mm', min: 0, max: 10, step: 1, default: 6, group: 'Fabricación', exposed: false, help: 'Ranura curva en la cara interior de los costados donde encajan los listones. 0 = sin ranura.' },
    thicknessParam(18),
  ],
  build(v, { material }) {
    const T = num(v, 't'), H = num(v, 'h'), D = num(v, 'd'), P = num(v, 'plinth');
    const gd = Math.max(0, Math.min(Number.isFinite(num(v, 'gd')) ? num(v, 'gd') : 6, T - 6)); // deja al menos 6 mm de pared
    const libr = !!v.libr, wb = libr ? num(v, 'wb') : 0, cojin = !!v.cojin;
    const n = Math.max(4, Math.round(num(v, 'list')));
    const ts = T, foam = 40, margin = 80; // listones del mismo tablero, espuma 40 mm, ala a cada lado del corte
    // labio de material entre el borde del corte y la ranura (para que la ranura quede cerrada y resistente)
    const lip = gd > 0 ? 15 : 0, clr = 0.5; // holgura de encaje por lado
    const Hb = H - P;
    // el corte no puede atravesar la base: radio máximo según el alto disponible
    const R = Math.min(num(v, 'ws') / 2, Hb - T - lip - ts - 30);
    const Rs = R + lip; // radio de la cara interior de los listones
    const Ls = 2 * R + 2 * margin; // largo interior de la zona de asiento
    const L = T + Ls + T + (libr ? wb : 0);
    const cx = T + Ls / 2;
    const parts: Part[] = [];

    // Costados largos (frente y trasera): rectángulo con corte semicircular desde arriba
    const prof: V2[] = [[0, 0], [L, 0], [L, Hb], ...arc(cx, Hb, R, 0, -Math.PI, 36), [0, Hb]];
    // Ranura curva (anillo) en la cara interior: cubre la banda de los listones, incluida la flecha de cada cuerda
    const n0 = Math.max(4, Math.round(num(v, 'list')));
    const rIn = Rs * Math.cos(Math.PI / (2 * n0)) - clr, rOut = Rs + ts + 1 + clr;
    const groove: V2[] = [...arc(cx, Hb, rOut, Math.PI, 2 * Math.PI, 48), ...arc(cx, Hb, rIn, 2 * Math.PI, Math.PI, 48)];
    const side = (id: string, name: string, y: number, face: 'base' | 'top'): Part => ({ id, name, role: 'Costado', material, thickness: T,
      plane: { o: [0, y, P], x: [1, 0, 0], y: [0, 0, 1] }, profile: prof, // normal −Y
      pockets: gd > 0 ? [{ name: "Ranura curva listones", outline: groove, depth: gd, face }] : undefined });
    // frente: origen en la cara interior (y=T) → 'base'; trasero: origen en la cara exterior (y=D) → 'top'
    parts.push(side('costado-frente', 'Costado frontal', T, 'base'), side('costado-tras', 'Costado trasero', D, 'top'));

    const yi = T, di = D - 2 * T; // interior entre costados
    parts.push(boxPart('cabezal', 'Cabezal izquierdo', 'Cabezal', material, [0, yi, P], [T, di, Hb], 'x'));
    parts.push(boxPart('base', 'Base', 'Base', material, [T, yi, P], [L - T - (libr ? 0 : T), di, T], 'z'));
    if (libr) {
      const x0 = T + Ls;
      parts.push(boxPart('division', 'División librero', 'División', material, [x0, yi, P + T], [T, di, Hb - T], 'x'));
      parts.push(boxPart('techo-libr', 'Techo librero', 'Cubierta', material, [x0 + T, yi, H - T], [wb, di, T], 'z'));
      const zr = P + T + (Hb - 2 * T) / 2 - T / 2;
      parts.push(boxPart('repisa-libr', 'Repisa librero', 'Repisa', material, [x0 + T, yi, zr], [wb, di, T], 'z'));
    } else {
      parts.push(boxPart('cabezal-der', 'Cabezal derecho', 'Cabezal', material, [L - T, yi, P], [T, di, Hb], 'x'));
    }
    if (P > 0) {
      const r = 40; // retranqueo del zócalo
      parts.push(boxPart('zoc-frente', 'Zócalo frontal', 'Zócalo', material, [r, r, 0], [L - 2 * r, T, P], 'y'));
      parts.push(boxPart('zoc-tras', 'Zócalo trasero', 'Zócalo', material, [r, D - r - T, 0], [L - 2 * r, T, P], 'y'));
      parts.push(boxPart('zoc-izq', 'Zócalo izquierdo', 'Zócalo', material, [r, r + T, 0], [T, D - 2 * r - 2 * T, P], 'x'));
      parts.push(boxPart('zoc-der', 'Zócalo derecho', 'Zócalo', material, [L - r - T, r + T, 0], [T, D - 2 * r - 2 * T, P], 'x'));
    }

    // Asiento: facetas siguiendo el arco (normal hacia afuera del centro). Listones por fuera del radio R, cojín por dentro.
    const zc = H; // centro del arco en el borde superior
    const facets = (r: number, k: number, fn: (i: number, o: [number, number, number], dir: [number, number, number], w: number) => void) => {
      for (let i = 0; i < k; i++) {
        const a0 = Math.PI + (Math.PI * i) / k, a1 = Math.PI + (Math.PI * (i + 1)) / k;
        const A: V2 = [cx + r * Math.cos(a0), zc + r * Math.sin(a0)], B: V2 = [cx + r * Math.cos(a1), zc + r * Math.sin(a1)];
        const w = Math.hypot(B[0] - A[0], B[1] - A[1]);
        fn(i, [A[0], yi, A[1]], [(B[0] - A[0]) / w, 0, (B[1] - A[1]) / w], w);
      }
    };
    // los listones entran en las ranuras: más largos en (profundidad − holgura) por lado
    const ext = gd > 0 ? gd - clr : 0, ls = di + 2 * ext;
    facets(Rs, n, (i, o, dir, w) => parts.push({ id: `liston-${i + 1}`, name: `Listón ${i + 1}`, role: 'Listón asiento', material, thickness: ts,
      plane: { o: [o[0], o[1] - ext, o[2]], x: [0, 1, 0], y: dir }, profile: [[0, 0], [ls, 0], [ls, w], [0, w]] }));
    if (cojin) facets(Rs - foam, n, (i, o, dir, w) => parts.push({ id: `cojin-${i + 1}`, name: `Cojín ${i + 1}`, role: 'Cojín', material: 'tapiz', process: 'tapiz', thickness: foam,
      plane: { o, x: [0, 1, 0], y: dir }, profile: [[0, 0], [di, 0], [di, w], [0, w]] }));
    return parts;
  },
};

/** Diseño libre: los parámetros y piezas los define el arquitecto (ver core/free.ts). */
const free: Template = {
  id: 'libre',
  name: 'Diseño libre (compositor)',
  description: 'Defines tus propios parámetros y armas el producto con piezas: rectángulos o siluetas del boceto, con fórmulas, repeticiones y calados.',
  usesProfile: false,
  params: [], // dinámicos: project.free.params
  build: (v, ctx) => buildFree(v, ctx.free, ctx.shapes ?? {}, ctx.material, ctx.errors),
};

export const TEMPLATES: Template[] = [free, shelf, table, ribs, nook];
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? shelf;
