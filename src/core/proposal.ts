// "Interpretar imagen": instrucciones para Claude y validación estricta de su propuesta de diseño libre.
// La respuesta nunca se usa tal cual: se limpia, se acota y se construye con el mismo motor que el resto
// de la app, informando lo que no se pudo usar.
import { buildFree, findRef, freeParams, newComponent, placeAtRef, type Component, type FreeDesign, type RefSide, type Shape } from './free';
import { bounds3 } from './geom';
import { uid } from './geom';
import type { ParamDef, V2 } from './types';

export interface Silhouette { id: string; name: string; outline: V2[]; holes: V2[][] }
export interface Proposal {
  name: string;
  summary: string;
  assumptions: string[];
  design: FreeDesign;
  silhouettes: Silhouette[];
  /** Problemas encontrados al validar o construir (piezas descartadas, fórmulas con error). */
  issues: string[];
}

const ORIENTS = ['XZ', 'YZ', 'XY'] as const;
const KINDS = ['tablero', 'tapiz', 'ref'] as const;
const MAX_COMPONENTS = 40, MAX_PARAMS = 20, MAX_SIL = 4, MAX_PTS = 80;

/** Instrucciones completas (Claude no recuerda nada entre llamadas). */
export function buildPrompt(ctx: { known?: string; focus?: string; description?: string; functions?: string[]; thickness: number; existing?: { name: string; largo: number; ancho: number; alto: number } }): string {
  return `Eres un diseñador de mobiliario que convierte una imagen de referencia en un modelo paramétrico de TABLEROS PLANOS para fabricar con CNC (piezas planas de espesor constante, cortadas de planchas).

Mira la imagen y propone un diseño inicial que alguien sin experiencia pueda seguir editando.
${ctx.known ? `Medida conocida (úsala para escalar todo): ${ctx.known}` : 'No hay medida conocida: estima medidas realistas para este tipo de mueble.'}
${ctx.focus ? `Qué tomar de la imagen: ${ctx.focus}` : ''}
${ctx.description ? `Descripción del proyecto: ${ctx.description.slice(0, 800)}` : ''}
${ctx.functions?.length ? `Funcionalidades: ${ctx.functions.slice(0, 8).join('; ')}` : ''}
${ctx.existing ? `EL DISEÑO ES PARA UN OBJETO EXISTENTE: "${ctx.existing.name}" de ${ctx.existing.largo} mm de largo (X) × ${ctx.existing.ancho} mm de ancho (Y) × ${ctx.existing.alto} mm de alto (Z), ubicado desde el origen (0,0,0). Ya existe como volumen de referencia con los parámetros ref_largo, ref_ancho y ref_alto: NO lo agregues a "components" ni a "params"; úsalos en tus fórmulas para que las piezas calcen con él. Ubica cada pieza PEGADA al volumen, nunca atravesándolo:
  - Cabecera (respaldo): orient "YZ", w "ref_ancho + 2*t", x "-t", y "-t".
  - Pies (piecera, frente de pies): orient "YZ", w "ref_ancho + 2*t", x "ref_largo", y "-t".
  - Costado cercano (baranda, faldón frontal): orient "XZ", w "ref_largo" (o una parte), x "0" o mayor, y "-t".
  - Costado del muro: orient "XZ", w "ref_largo", x "0", y "ref_ancho".
  - Sobre el volumen: orient "XY", z "ref_alto".
  En una cama el ancho (ref_ancho, eje Y) es el lado corto: el respaldo NUNCA va "XZ" a lo largo de X. Las alturas (h) de respaldo y barandas se miden desde el piso (z = 0) salvo que estén sobre el volumen.` : 'Si la descripción o las funcionalidades mencionan un mueble u objeto existente con medidas, inclúyelo como pieza kind "ref" con parámetros para esas medidas y adapta el diseño a él.'}

MODELO (respeta exactamente estas reglas):
- Unidades: milímetros. Ejes: X = largo (izquierda→derecha visto de frente), Y = fondo (frente en Y=0, hacia atrás positivo), Z = alto (piso en Z=0).
- Cada pieza es un tablero con "orient":
  - "XZ" de frente: ancho w a lo largo de X, alto h hacia arriba, espesor hacia +Y desde y.
  - "YZ" de lado: ancho w hacia el fondo (Y), alto h hacia arriba, espesor hacia +X desde x.
  - "XY" acostada: ancho w a lo largo de X, alto h hacia el fondo (Y), espesor hacia arriba desde z.
- x, y, z = esquina mínima de la pieza.
- w, h, t, x, y, z, count y when son FÓRMULAS de texto: números, claves de parámetros, + - * / ( ), min(), max(), floor(), ceil(), round(), comparaciones y "cond ? a : b". Variables extra: t = espesor del tablero (${ctx.thickness} mm), i = índice de copia (0..n-1), n = cantidad.
- Repeticiones (barrotes, repisas, listones): count = cantidad y en la posición "base + i*paso".
- "when": "" (siempre) o la clave de un parámetro Sí/No (type "bool").
- "kind": "tablero" (se fabrica), "tapiz" (cojines) o "ref" (contexto que NO se fabrica, p. ej. un colchón o la cama existente).
- Prefiere usar el espesor t en "t" y medidas derivadas de parámetros (p. ej. "ancho - 2*t") para que el diseño siga siendo paramétrico.
- Si una pieza no es rectangular (orejas, curvas, arcos), dale "shape": id de una silueta. Las siluetas son contornos cerrados normalizados a [0,1]×[0,1] con x hacia la derecha e y HACIA ARRIBA; se estiran al ancho×alto de la pieza. "holes" son calados interiores (ventanas, formas recortadas), también en [0,1]. Máximo ${MAX_SIL} siluetas y ${MAX_PTS} puntos cada una; con más de 8 puntos el contorno se trata como CURVA SUAVE que pasa por ellos (se fabrica como curva exacta en CNC): usa pocos puntos bien ubicados (8-30) y deja esquinas vivas donde el contorno gire más de 50° (p. ej. la base recta).
- Parámetros: claves cortas en minúscula con guion bajo (ancho, alto_respaldo), "label" en español, rango min/max realista, "exposed": true para lo que un cliente querría elegir.
- Máximo ${MAX_PARAMS} parámetros y ${MAX_COMPONENTS} piezas. Simplifica: es un punto de partida.

Responde SOLO con un objeto JSON con esta forma:
{"name": "nombre corto del producto",
 "summary": "1-2 frases: qué entendiste de la imagen",
 "assumptions": ["supuestos de medidas o construcción que el usuario debería revisar"],
 "params": [{"key":"ancho","label":"Ancho","type":"number","default":1200,"min":600,"max":2000,"step":10,"exposed":true,"group":"Dimensiones"}],
 "components": [{"name":"Lateral","role":"Lateral","orient":"YZ","shape":"rect","w":"prof","h":"alto","t":"t","x":"i*(ancho - t)","y":"0","z":"0","count":"2","when":"","kind":"tablero"}],
 "silhouettes": [{"id":"respaldo","name":"Respaldo con orejas","outline":[[0,0],[1,0],[1,0.8],[0,0.8]],"holes":[]}]}`;
}

const str = (v: unknown, def = '') => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : def);
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1').slice(0, 32);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function points(v: unknown): V2[] {
  if (!Array.isArray(v)) return [];
  const out: V2[] = [];
  for (const p of v.slice(0, MAX_PTS)) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))) out.push([clamp01(Number(p[0])), clamp01(Number(p[1]))]);
  }
  return out;
}

/** Limpia la respuesta de Claude y la construye con el motor real para detectar errores. */
export function sanitizeProposal(raw: unknown, thickness = 18, base: FreeDesign = { params: [], components: [] }): Proposal {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const issues: string[] = [];

  // parámetros
  const params: ParamDef[] = [];
  const seen = new Set<string>(['t', 'i', 'n', 'pi', ...base.params.map((p) => p.key)]);
  for (const p of (Array.isArray(r.params) ? r.params : []).slice(0, MAX_PARAMS)) {
    const q = (p ?? {}) as Record<string, unknown>;
    const key = slug(str(q.key) || str(q.label));
    if (!key || seen.has(key)) { if (key) issues.push(`Parámetro repetido o reservado: ${key}`); continue; }
    seen.add(key);
    const type = q.type === 'bool' ? 'bool' : q.type === 'int' ? 'int' : 'number';
    const label = str(q.label, key).slice(0, 40);
    const group = str(q.group, 'General').slice(0, 30);
    if (type === 'bool') { params.push({ key, label, type, default: q.default === true || q.default === 'true', exposed: q.exposed !== false, group }); continue; }
    const def = Number(q.default);
    if (!Number.isFinite(def)) { issues.push(`Parámetro sin valor: ${label}`); continue; }
    let min = Number(q.min), max = Number(q.max);
    if (!Number.isFinite(min)) min = type === 'int' ? 0 : Math.max(0, Math.round(def * 0.5));
    if (!Number.isFinite(max)) max = type === 'int' ? Math.max(def * 2, 10) : Math.round(def * 1.5);
    if (min > max) [min, max] = [max, min];
    const step = Number.isFinite(Number(q.step)) && Number(q.step) > 0 ? Number(q.step) : type === 'int' ? 1 : 10;
    params.push({ key, label, type, unit: type === 'number' ? 'mm' : undefined, default: Math.min(max, Math.max(min, def)), min, max, step, exposed: q.exposed === true, group });
  }

  // siluetas
  const silhouettes: Silhouette[] = [];
  const silIds = new Map<string, string>();
  for (const s of (Array.isArray(r.silhouettes) ? r.silhouettes : []).slice(0, MAX_SIL)) {
    const q = (s ?? {}) as Record<string, unknown>;
    const outline = points(q.outline);
    if (outline.length < 3) { issues.push(`Silueta sin contorno válido: ${str(q.name || q.id, '?')}`); continue; }
    const holes = (Array.isArray(q.holes) ? q.holes : []).slice(0, 6).map(points).filter((h) => h.length >= 3);
    const id = uid('sil-');
    silIds.set(str(q.id), id);
    silhouettes.push({ id, name: str(q.name, 'Silueta').slice(0, 40), outline, holes });
  }

  // piezas
  const components: Component[] = [];
  for (const c of (Array.isArray(r.components) ? r.components : []).slice(0, MAX_COMPONENTS)) {
    const q = (c ?? {}) as Record<string, unknown>;
    const orient = ORIENTS.includes(q.orient as never) ? (q.orient as Component['orient']) : 'XZ';
    const kind = KINDS.includes(q.kind as never) ? (q.kind as Component['kind']) : 'tablero';
    const shapeRef = str(q.shape, 'rect');
    const shape = shapeRef !== 'rect' && silIds.has(shapeRef) ? silIds.get(shapeRef)! : 'rect';
    if (shapeRef !== 'rect' && shape === 'rect') issues.push(`${str(q.name, 'Pieza')}: silueta "${shapeRef}" no encontrada, se usa rectángulo`);
    const f = (k: string, def: string) => str(q[k], def).slice(0, 200) || def;
    components.push(newComponent({
      name: str(q.name, 'Pieza').slice(0, 40), role: str(q.role).slice(0, 40), orient, kind, shape,
      w: f('w', '400'), h: f('h', '400'), t: f('t', 't'), x: f('x', '0'), y: f('y', '0'), z: f('z', '0'),
      count: f('count', '1'), when: str(q.when).slice(0, 200), holes: true,
    }));
  }
  if (!components.length) issues.push('La propuesta no trae piezas utilizables.');

  // el volumen de referencia (medidas exactas del usuario) va primero
  const design: FreeDesign = { params: [...base.params, ...params], components: [...base.components, ...components] };
  // construir con el motor real: errores de fórmulas a la vista
  const shapes: Record<string, Shape> = Object.fromEntries(silhouettes.map((s) => [s.id, { outline: s.outline, holes: s.holes, label: s.name, size: [1000, 1000] as V2 }]));
  const values = Object.fromEntries(freeParams(design).map((d) => [d.key, d.key === 't' ? thickness : d.default]));
  const errors: string[] = [];
  let parts = buildFree(values, design, shapes, 'mdf', errors);
  // piezas que atraviesan el mueble existente: se pegan a su cabecera, pies o costado según su nombre
  const ref = base.components.length ? findRef(design) : null;
  if (ref) {
    const rp = parts.find((p) => p.source?.comp === ref.comp.id);
    const rb = rp && bounds3([rp]);
    const fixed = new Set<string>();
    for (const p of parts) {
      if (!rb || p.process === 'ref' || !p.source || fixed.has(p.source.comp)) continue;
      const pb = bounds3([p]);
      if (![0, 1, 2].every((k) => Math.min(pb.max[k], rb.max[k]) - Math.max(pb.min[k], rb.min[k]) > 2)) continue;
      const i = design.components.findIndex((c) => c.id === p.source!.comp);
      const c = design.components[i];
      const side: RefSide | null = /respaldo|cabecer/i.test(c.name) ? 'cabecera' : /piecera|pies/i.test(c.name) ? 'pies' : /baranda|costado|lateral|fald/i.test(c.name) ? 'frente' : null;
      if (!side) { issues.push(`${c.name}: atraviesa «${ref.name}»; ubícala con "Ubicar junto a".`); continue; }
      design.components[i] = placeAtRef(c, ref, side);
      fixed.add(c.id);
      issues.push(`${c.name}: atravesaba «${ref.name}»; se ubicó en ${side === 'frente' ? 'el costado' : `la ${side}`}.`);
    }
    if (fixed.size) parts = buildFree(values, design, shapes, 'mdf', []);
  }
  issues.push(...errors);

  return {
    name: str(r.name, 'Diseño desde imagen').slice(0, 60),
    summary: str(r.summary).slice(0, 400),
    assumptions: (Array.isArray(r.assumptions) ? r.assumptions : []).map((a) => str(a)).filter(Boolean).slice(0, 8),
    design, silhouettes, issues,
  };
}
