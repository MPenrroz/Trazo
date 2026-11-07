// Edición simple de piezas: traduce controles sin fórmulas (números, repetición, condición) al diseño paramétrico.
import { evalExpr } from './expr';
import { scopeFrom, type Component } from './free';
import type { ParamDef, ParamValues } from './types';

export type Axis = 'x' | 'y' | 'z';
const ID = /^\s*([A-Za-z_áéíóúñÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]*)\s*$/;
const NUM = /^\s*-?\d+(?:\.\d+)?\s*$/;

/** Parámetro al que está "ligada" una fórmula si es exactamente un parámetro (p. ej. "alto_respaldo"). */
export function linkedParam(src: string, params: ParamDef[]): ParamDef | undefined {
  const m = ID.exec(src);
  return m ? params.find((p) => p.key === m[1]) : undefined;
}

export const isNumber = (src: string) => NUM.test(src);

/** Valor actual de un campo de la pieza (primera copia). */
export function fieldValue(c: Component, f: 'w' | 'h' | 't' | 'x' | 'y' | 'z' | 'count', values: ParamValues): number {
  const s = scopeFrom(values);
  try {
    const n = Math.round(evalExpr(c.count || '1', s));
    return evalExpr(f === 'count' ? c.count || '1' : c[f], { ...s, i: 0, n });
  } catch { return NaN; }
}

export interface Repeat { axis: Axis | null; base: string; step: string }

/** Lee una repetición escrita como "<base> + i*<paso>" (o "i*<paso>") en X, Y o Z. */
export function parseRepeat(c: Component): Repeat {
  for (const ax of ['x', 'y', 'z'] as Axis[]) {
    const src = c[ax].trim();
    let m = /^(.*\S)\s*\+\s*i\s*\*\s*(.+)$/.exec(src);
    if (m) return { axis: ax, base: m[1], step: m[2].trim() };
    m = /^i\s*\*\s*(.+)$/.exec(src);
    if (m) return { axis: ax, base: '0', step: m[1].trim() };
  }
  return { axis: null, base: '', step: '' };
}

/** ¿La repetición usa `i` de una forma que el editor simple no sabe mostrar? */
export function advancedRepeat(c: Component): boolean {
  const r = parseRepeat(c);
  const usesI = (s: string) => /(^|[^\wáéíóúñ])i($|[^\wáéíóúñ])/.test(s);
  const others = (['x', 'y', 'z', 'w', 'h', 't'] as const).filter((f) => f !== r.axis);
  return others.some((f) => usesI(c[f])) || (r.axis !== null && usesI(r.base)) || (r.axis === null && c.count.trim() !== '1' && c.count.trim() !== '');
}

/** Escribe la repetición: quita el término "+ i*paso" del eje anterior y lo pone en el nuevo. */
export function setRepeat(c: Component, count: string, axis: Axis | null, step: string): Component {
  const r = parseRepeat(c);
  const out = { ...c };
  if (r.axis) out[r.axis] = r.base;
  if (!axis || count.trim() === '1') { out.count = '1'; return out; }
  out.count = count;
  const base = out[axis].trim();
  const st = /^[\w.]+$/.test(step.trim()) ? step.trim() : `(${step.trim()})`;
  out[axis] = base === '0' || base === '' ? `i*${st}` : `${base} + i*${st}`;
  return out;
}

/** Condición "Aparece": siempre, o un parámetro Sí/No. null = condición avanzada. */
export function parseWhen(c: Component, params: ParamDef[]): { kind: 'always' } | { kind: 'param'; key: string } | null {
  const w = c.when.trim();
  if (!w) return { kind: 'always' };
  const p = linkedParam(w, params);
  return p && p.type === 'bool' ? { kind: 'param', key: p.key } : null;
}
