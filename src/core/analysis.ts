import { bounds2, bounds3, d2, dot, normal, partArea, partCutLength, partVertices, polyArea, polyPerimeter, reflexVertices, round } from './geom';
import { nest, type NestResult } from './nesting';
import { pocketToolpath } from './pockets';
import type { Check, FabMethod, Material, Part, Project } from './types';

export interface Analysis {
  checks: Check[];
  nest: NestResult;
  areaM2: number;
  cutM: number;
  /** Recorrido de fresa en cajeados/ranuras (m). */
  pocketM: number;
  weightKg: number;
  size: [number, number, number];
  cost: { material: number; machining: number; upholstery: number; subtotal: number; price: number };
  /** m² de tapiz (espuma + tela) de las piezas con process 'tapiz'. */
  upholsteryM2: number;
  cutList: { name: string; role: string; qty: number; w: number; h: number; t: number; material: string }[];
}

export function analyse(allParts: Part[], method: FabMethod, material: Material, project: Pick<Project, 'pricing'>, materials: Material[] = []): Analysis {
  const checks: Check[] = [];
  // las piezas de referencia (cama, muro existente) no se fabrican ni cotizan
  const refs = allParts.filter((p) => p.process === 'ref');
  allParts = allParts.filter((p) => p.process !== 'ref');
  // piezas que atraviesan el mueble existente: casi siempre una pieza girada o mal ubicada
  for (const r of refs) {
    const rb = bounds3([r]);
    for (const p of allParts) {
      const pb = bounds3([p]);
      const pen = [0, 1, 2].map((k) => Math.min(pb.max[k], rb.max[k]) - Math.max(pb.min[k], rb.min[k]));
      if (pen.every((d) => d > 2)) checks.push({ level: 'warn', part: p.name, msg: `${p.name}: atraviesa el volumen de referencia «${r.name.replace(/ \(referencia\)$/, '')}». Usa "Ubicar junto a" en la pieza para ponerla en la cabecera, los pies o un costado.` });
    }
  }
  const b3 = bounds3(allParts);
  // solo las piezas de tablero pasan por CNC; el tapiz se cotiza aparte
  const parts = allParts.filter((p) => p.process !== 'tapiz');
  const soft = allParts.filter((p) => p.process === 'tapiz');
  const size = b3.size.map((n) => round(n, 0)) as [number, number, number];
  const bed: [number, number] = [Math.min(method.bed[0], material.sheet[0]), Math.min(method.bed[1], material.sheet[1])];

  for (const p of parts) {
    const b = bounds2(p.profile);
    const fits = (b.w <= bed[0] && b.h <= bed[1]) || (b.h <= bed[0] && b.w <= bed[1]);
    if (!fits) checks.push({ level: 'error', part: p.name, msg: `${p.name}: ${round(b.w, 0)}×${round(b.h, 0)} mm no cabe en ${bed[0]}×${bed[1]} mm (${method.name}). Dividir la pieza o cambiar de método/tablero.` });
    if (p.thickness > method.maxThickness) checks.push({ level: 'error', part: p.name, msg: `${p.name}: espesor ${p.thickness} mm supera el máximo de ${method.name} (${method.maxThickness} mm).` });
    const reflex = reflexVertices(p.profile, 25);
    if (reflex.length && method.tool > 1) checks.push({ level: 'info', part: p.name, msg: `${p.name}: ${reflex.length} esquina(s) interior(es) quedarán con radio ${method.tool / 2} mm (fresa Ø${method.tool}). Si ahí encastra otra pieza, agregar dogbones.` });
    for (const k of p.pockets ?? []) {
      if (k.depth > p.thickness - 6) checks.push({ level: 'error', part: p.name, msg: `${p.name}: ${k.name} deja menos de 6 mm de material (espesor ${p.thickness} mm).` });
      // ancho medio de la ranura ≈ 2·área / perímetro (exacto para franjas delgadas)
      const width = (2 * Math.abs(polyArea(k.outline))) / polyPerimeter(k.outline);
      if (width < method.tool) checks.push({ level: 'error', part: p.name, msg: `${p.name}: ${k.name} es más angosta que la fresa Ø${method.tool}.` });
    }
    const n = p.profile.length;
    const short = p.profile.some((pt, i) => d2(pt, p.profile[(i + 1) % n]) < method.tool * 1.5 && n < 40);
    if (short) checks.push({ level: 'warn', part: p.name, msg: `${p.name}: tiene detalles menores a ${round(method.tool * 1.5, 1)} mm; la herramienta no los reproducirá.` });
    // Luz de repisas horizontales
    if (Math.abs(dot(normal(p.plane), [0, 0, 1])) > 0.9 && /Repisa|Cubierta|Techo/.test(p.role)) {
      // luz libre: se descuentan los apoyos intermedios (divisiones o patas que tocan la pieza por arriba o por abajo)
      const span = freeSpan(p, parts);
      const ratio = span / p.thickness;
      if (ratio > material.maxSpanRatio) checks.push({ level: 'warn', part: p.name, msg: `${p.name}: luz ${round(span, 0)} mm / espesor ${p.thickness} mm = ${round(ratio, 0)} (> ${material.maxSpanRatio} recomendado para ${material.name}). Riesgo de flecha: aumentar espesor o agregar apoyo.` });
    }
  }
  const thicknesses = [...new Set(parts.map((p) => p.thickness))];
  for (const t of thicknesses) if (!material.thicknesses.includes(t)) checks.push({ level: 'warn', msg: `${material.name} no se fabrica comúnmente en ${t} mm (disponible: ${material.thicknesses.join(', ')} mm).` });
  // estabilidad: sobre 4 se recomienda anclar (habitual en libreros); sobre 6 es un riesgo real de vuelco
  // solo para muebles de más de 900 mm de alto: lo bajo no representa riesgo de vuelco
  const slender = size[2] > 900 && Math.min(size[0], size[1]) > 0 ? size[2] / Math.min(size[0], size[1]) : 0;
  if (slender > 6) checks.push({ level: 'warn', msg: `Relación alto/base ${round(slender, 1)}: riesgo de volcamiento. Anclar a muro o ensanchar la base.` });
  else if (slender > 4) checks.push({ level: 'info', msg: `Relación alto/base ${round(slender, 1)}: se recomienda anclar a muro (herraje antivuelco).` });

  const nr = nest(parts, bed, method.tool + 4);
  const areaM2 = parts.reduce((s, p) => s + partArea(p), 0) / 1e6;
  const cutM = parts.reduce((s, p) => s + partCutLength(p), 0) / 1000;
  const pocketParts = parts.filter((p) => p.pockets?.length);
  const pocketM = pocketParts.reduce((s, p) => s + (p.pockets ?? []).reduce((t, k) => t + pocketToolpath(p, k, method.tool), 0), 0) / 1000;
  const upMat = materials.find((m) => m.id === soft[0]?.material);
  const upholsteryM2 = soft.reduce((s, p) => s + partArea(p), 0) / 1e6;
  const weightKg = parts.reduce((s, p) => s + partArea(p) * p.thickness, 0) / 1e9 * material.density
    + soft.reduce((s, p) => s + partArea(p) * p.thickness, 0) / 1e9 * (upMat?.density ?? 35);
  const sheetArea = (bed[0] * bed[1]) / 1e6;
  const util = nr.sheets ? areaM2 / (nr.sheets * sheetArea) : 0;
  checks.push({ level: 'info', msg: `${parts.length} piezas · ${nr.sheets} tablero(s) de ${bed[0]}×${bed[1]} · aprovechamiento ${round(util * 100, 0)}% · ${round(cutM, 1)} m de corte · ~${round(weightKg, 1)} kg.` });
  if (pocketParts.length) {
    const names = [...new Set(pocketParts.flatMap((p) => (p.pockets ?? []).map((k) => k.name)))].join(', ');
    const flip = pocketParts.some((p) => p.pockets!.some((k) => k.face === 'base'));
    checks.push({ level: 'info', msg: `Cajeados: ${names} en ${pocketParts.length} pieza(s) · ${round(pocketM, 1)} m de recorrido con fresa Ø${method.tool}.${flip ? ' En el DXF de corte las piezas van espejadas para mecanizar la ranura boca arriba.' : ''}` });
  }
  if (soft.length) checks.push({ level: 'info', msg: `Tapiz: ${round(upholsteryM2, 2)} m² de espuma ${soft[0].thickness} mm + tela (se confecciona aparte, no pasa por CNC).` });
  if (nr.sheets && util < 0.45) checks.push({ level: 'info', msg: 'Aprovechamiento de tablero bajo: ajustar dimensiones para que las piezas aniden mejor puede bajar el costo.' });
  const grouped = groupChecks(checks);
  checks.length = 0; checks.push(...grouped);
  if (!checks.some((c) => c.level === 'error' || c.level === 'warn')) checks.unshift({ level: 'ok', msg: `Factible con ${method.name} en ${material.name}.` });

  const materialCost = nr.sheets * material.pricePerSheet;
  // el vaciado avanza más rápido que el corte pasante: se cobra al 50% por metro
  const machining = cutM * method.ratePerMeter + pocketM * method.ratePerMeter * 0.5 + nr.sheets * method.setupPerSheet;
  // tapiz: m² × precio del paño / área del paño, +30% por merma y confección
  const upholstery = upMat ? Math.round(upholsteryM2 / ((upMat.sheet[0] * upMat.sheet[1]) / 1e6) * upMat.pricePerSheet * 1.3) : 0;
  const subtotal = materialCost + machining + upholstery + project.pricing.base;
  const price = Math.round((subtotal * (1 + project.pricing.margin / 100)) / 100) * 100;

  const map = new Map<string, Analysis['cutList'][number]>();
  for (const p of parts) {
    const b = bounds2(p.profile);
    const w = round(Math.max(b.w, b.h), 0), h = round(Math.min(b.w, b.h), 0);
    const key = `${p.role}|${w}|${h}|${p.thickness}|${p.profile.length}`;
    const e = map.get(key);
    if (e) e.qty++; else map.set(key, { name: p.name, role: p.role, qty: 1, w, h, t: p.thickness, material: p.material });
  }
  return { checks, nest: nr, areaM2, cutM, pocketM, weightKg, size, cost: { material: materialCost, machining, upholstery, subtotal, price }, upholsteryM2, cutList: [...map.values()] };
}

/** Une mensajes idénticos de piezas distintas ("Costilla 1…12: …") para no repetir 12 veces lo mismo. */
export function groupChecks(checks: Check[]): Check[] {
  const out: Check[] = [];
  const groups = new Map<string, { c: Check; names: string[] }>();
  for (const c of checks) {
    if (!c.part) { out.push(c); continue; }
    const key = c.level + '|' + c.msg.slice(c.part.length);
    const g = groups.get(key);
    if (g) g.names.push(c.part);
    else { const ng = { c: { ...c }, names: [c.part] }; groups.set(key, ng); out.push(ng.c); }
  }
  for (const { c, names } of groups.values()) {
    if (names.length > 1) {
      const label = names.length > 3 ? `${names[0]} … ${names[names.length - 1]} (${names.length} piezas)` : names.join(', ');
      c.msg = label + c.msg.slice(c.part!.length);
    }
  }
  return out;
}

/** Mayor tramo sin apoyo de una pieza horizontal, considerando piezas verticales que la tocan por arriba o por abajo. */
export function freeSpan(p: Part, parts: Part[]): number {
  const box = (q: Part) => {
    const vs = partVertices(q);
    const mn = [0, 1, 2].map((i) => Math.min(...vs.map((v) => v[i]))), mx = [0, 1, 2].map((i) => Math.max(...vs.map((v) => v[i])));
    return { mn, mx };
  };
  const a = box(p);
  const ax = a.mx[0] - a.mn[0] >= a.mx[1] - a.mn[1] ? 0 : 1; // eje de la luz (el más largo)
  const other = 1 - ax;
  const cuts = [a.mn[ax], a.mx[ax]];
  for (const q of parts) {
    if (q === p || q.process === 'tapiz' || q.process === 'ref' || Math.abs(normal(q.plane)[2]) > 0.9) continue;
    const b = box(q);
    const touches = Math.abs(b.mx[2] - a.mn[2]) < 1 || Math.abs(b.mn[2] - a.mx[2]) < 1;
    // apoyo real: cruza ≥80 % del ancho de la pieza y es angosto a lo largo de la luz (una división, no un fondo paralelo)
    const overlap = Math.min(b.mx[other], a.mx[other]) - Math.max(b.mn[other], a.mn[other]);
    const crosses = overlap >= 0.8 * (a.mx[other] - a.mn[other]) && b.mx[ax] - b.mn[ax] < 0.25 * (a.mx[ax] - a.mn[ax]);
    const c = (b.mn[ax] + b.mx[ax]) / 2;
    if (touches && crosses && c > a.mn[ax] + 1 && c < a.mx[ax] - 1) cuts.push(c);
  }
  cuts.sort((x, y) => x - y);
  let max = 0;
  for (let i = 1; i < cuts.length; i++) max = Math.max(max, cuts[i] - cuts[i - 1]);
  return max;
}
