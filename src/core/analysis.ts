import { bounds2, bounds3, d2, dot, normal, partArea, partCutLength, reflexVertices, round } from './geom';
import { nest, type NestResult } from './nesting';
import type { Check, FabMethod, Material, Part, Project } from './types';

export interface Analysis {
  checks: Check[];
  nest: NestResult;
  areaM2: number;
  cutM: number;
  weightKg: number;
  size: [number, number, number];
  cost: { material: number; machining: number; subtotal: number; price: number };
  cutList: { name: string; role: string; qty: number; w: number; h: number; t: number; material: string }[];
}

export function analyse(parts: Part[], method: FabMethod, material: Material, project: Pick<Project, 'pricing'>): Analysis {
  const checks: Check[] = [];
  const b3 = bounds3(parts);
  const size = b3.size.map((n) => round(n, 0)) as [number, number, number];
  const bed: [number, number] = [Math.min(method.bed[0], material.sheet[0]), Math.min(method.bed[1], material.sheet[1])];

  for (const p of parts) {
    const b = bounds2(p.profile);
    const fits = (b.w <= bed[0] && b.h <= bed[1]) || (b.h <= bed[0] && b.w <= bed[1]);
    if (!fits) checks.push({ level: 'error', part: p.name, msg: `${p.name}: ${round(b.w, 0)}×${round(b.h, 0)} mm no cabe en ${bed[0]}×${bed[1]} mm (${method.name}). Dividir la pieza o cambiar de método/tablero.` });
    if (p.thickness > method.maxThickness) checks.push({ level: 'error', part: p.name, msg: `${p.name}: espesor ${p.thickness} mm supera el máximo de ${method.name} (${method.maxThickness} mm).` });
    const reflex = reflexVertices(p.profile);
    if (reflex.length && method.tool > 1) checks.push({ level: 'warn', part: p.name, msg: `${p.name}: ${reflex.length} esquina(s) interior(es). Con fresa Ø${method.tool} quedará radio ${method.tool / 2} mm → agregar dogbones si encastra otra pieza.` });
    const n = p.profile.length;
    const short = p.profile.some((pt, i) => d2(pt, p.profile[(i + 1) % n]) < method.tool * 1.5 && n < 40);
    if (short) checks.push({ level: 'warn', part: p.name, msg: `${p.name}: tiene detalles menores a ${round(method.tool * 1.5, 1)} mm; la herramienta no los reproducirá.` });
    // Luz de repisas horizontales
    if (Math.abs(dot(normal(p.plane), [0, 0, 1])) > 0.9 && /Repisa|Cubierta|Base|Techo/.test(p.role)) {
      const span = Math.max(b.w, b.h);
      const ratio = span / p.thickness;
      if (ratio > material.maxSpanRatio) checks.push({ level: 'warn', part: p.name, msg: `${p.name}: luz ${round(span, 0)} mm / espesor ${p.thickness} mm = ${round(ratio, 0)} (> ${material.maxSpanRatio} recomendado para ${material.name}). Riesgo de flecha: aumentar espesor o agregar apoyo.` });
    }
  }
  const thicknesses = [...new Set(parts.map((p) => p.thickness))];
  for (const t of thicknesses) if (!material.thicknesses.includes(t)) checks.push({ level: 'warn', msg: `${material.name} no se fabrica comúnmente en ${t} mm (disponible: ${material.thicknesses.join(', ')} mm).` });
  if (size[2] > 0 && Math.min(size[0], size[1]) > 0 && size[2] / Math.min(size[0], size[1]) > 4) checks.push({ level: 'warn', msg: `Relación alto/base ${round(size[2] / Math.min(size[0], size[1]), 1)}: el producto puede volcar. Prever anclaje a muro.` });

  const nr = nest(parts, bed, method.tool + 4);
  const areaM2 = parts.reduce((s, p) => s + partArea(p), 0) / 1e6;
  const cutM = parts.reduce((s, p) => s + partCutLength(p), 0) / 1000;
  const weightKg = parts.reduce((s, p) => s + partArea(p) * p.thickness, 0) / 1e9 * material.density;
  const sheetArea = (bed[0] * bed[1]) / 1e6;
  const util = nr.sheets ? areaM2 / (nr.sheets * sheetArea) : 0;
  checks.push({ level: 'info', msg: `${parts.length} piezas · ${nr.sheets} tablero(s) de ${bed[0]}×${bed[1]} · aprovechamiento ${round(util * 100, 0)}% · ${round(cutM, 1)} m de corte · ~${round(weightKg, 1)} kg.` });
  if (nr.sheets && util < 0.45) checks.push({ level: 'info', msg: 'Aprovechamiento de tablero bajo: ajustar dimensiones para que las piezas aniden mejor puede bajar el costo.' });
  const grouped = groupChecks(checks);
  checks.length = 0; checks.push(...grouped);
  if (!checks.some((c) => c.level === 'error' || c.level === 'warn')) checks.unshift({ level: 'ok', msg: `Factible con ${method.name} en ${material.name}.` });

  const materialCost = nr.sheets * material.pricePerSheet;
  const machining = cutM * method.ratePerMeter + nr.sheets * method.setupPerSheet;
  const subtotal = materialCost + machining + project.pricing.base;
  const price = Math.round((subtotal * (1 + project.pricing.margin / 100)) / 100) * 100;

  const map = new Map<string, Analysis['cutList'][number]>();
  for (const p of parts) {
    const b = bounds2(p.profile);
    const w = round(Math.max(b.w, b.h), 0), h = round(Math.min(b.w, b.h), 0);
    const key = `${p.role}|${w}|${h}|${p.thickness}|${p.profile.length}`;
    const e = map.get(key);
    if (e) e.qty++; else map.set(key, { name: p.name, role: p.role, qty: 1, w, h, t: p.thickness, material: p.material });
  }
  return { checks, nest: nr, areaM2, cutM, weightKg, size, cost: { material: materialCost, machining, subtotal, price }, cutList: [...map.values()] };
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
