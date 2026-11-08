// Manipulación directa: traduce un arrastre en el 3D (Δ mm sobre un eje) a cambios en el diseño libre
// sin romper lo paramétrico. Reglas, en orden:
//   1. número fijo            "600"            → "650"
//   2. un parámetro de medida  "alto_respaldo"  → cambia el VALOR del parámetro (afecta a todas las piezas que lo usan)
//   3. fórmula con ajuste final "alto_cama - 20" → "alto_cama + 30"
//   4. otra fórmula            "(n - 1)*paso"   → "(n - 1)*paso + 50"   (o entre paréntesis si tiene condiciones)
import type { Component, FreeDesign } from './free';
import type { ParamDef, ParamValues } from './types';

export type Field = 'w' | 'h' | 't' | 'x' | 'y' | 'z';
export const FIELD_LABEL: Record<Field, string> = { w: 'Ancho', h: 'Alto', t: 'Espesor', x: 'X', y: 'Y', z: 'Z' };

const NUM = /^\s*-?\d+(?:\.\d+)?\s*$/;
const ID = /^\s*([A-Za-z_áéíóúñÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]*)\s*$/;
const TAIL = /^(.*\S)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/;
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Suma Δ a una fórmula manteniéndola legible. */
export function nudgeFormula(src: string, delta: number): string {
  if (Math.abs(delta) < 1e-9) return src;
  if (NUM.test(src)) return fmt(Number(src) + delta);
  const risky = /[?<>=!&|]/.test(src);
  const m = !risky ? TAIL.exec(src) : null;
  if (m && !/[-+*/%(,]\s*$/.test(m[1])) {
    const off = (m[2] === '+' ? 1 : -1) * Number(m[3]) + delta;
    if (Math.abs(off) < 1e-9) return m[1];
    return `${m[1]} ${off > 0 ? '+' : '-'} ${fmt(Math.abs(off))}`;
  }
  if (risky) return `(${src}) ${delta > 0 ? '+' : '-'} ${fmt(Math.abs(delta))}`;
  return `${src.trim()} ${delta > 0 ? '+' : '-'} ${fmt(Math.abs(delta))}`;
}

const usesKey = (c: Component, key: string) =>
  (['w', 'h', 't', 'x', 'y', 'z', 'count', 'when'] as const).some((f) => new RegExp(`(^|[^\\wáéíóúñ])${key}($|[^\\wáéíóúñ])`).test(c[f]));

/**
 * Alcance de una edición directa sobre una medida ligada a un parámetro que usan VARIAS piezas:
 * 'piece' = solo esta pieza (su fórmula pasa a "parámetro ± ajuste"); 'shared' = cambia el parámetro (todas).
 */
export type EditScope = 'piece' | 'shared';
let scope: EditScope = (() => { try { return (localStorage.getItem('trazo:scope') as EditScope) || 'piece'; } catch { return 'piece'; } })();
export const getScope = () => scope;
export function setScope(s: EditScope) { scope = s; try { localStorage.setItem('trazo:scope', s); } catch { /* */ } }

/** Cuántas piezas usan cada parámetro ligado a los campos de esta pieza. */
export function sharedLinks(design: FreeDesign, compId: string, params: ParamDef[]): { key: string; label: string; users: number }[] {
  const c = design.components.find((x) => x.id === compId);
  if (!c) return [];
  const out: { key: string; label: string; users: number }[] = [];
  for (const f of ['w', 'h', 'x', 'y', 'z'] as const) {
    const m = ID.exec(c[f]);
    const def = m ? params.find((p) => p.key === m[1] && (p.type === 'number' || p.type === 'int')) : undefined;
    if (!def || out.some((o) => o.key === def.key)) continue;
    const users = design.components.filter((x) => usesKey(x, def.key)).length;
    if (users > 1) out.push({ key: def.key, label: def.label, users });
  }
  return out;
}

export interface DragOp { field: Field; delta: number }
export interface DragResult { design: FreeDesign; values: ParamValues; notes: string[]; applied: number[] }

/**
 * Aplica cambios a una pieza. Con `link`, el segundo op usa −(lo realmente aplicado en el primero):
 * así al estirar desde el lado negativo la cara opuesta queda fija aunque un parámetro tope en su mínimo/máximo.
 */
export function applyDrag(design: FreeDesign, values: ParamValues, params: ParamDef[], compId: string, ops: DragOp[], link = false, opts: { scope?: EditScope; fine?: boolean } = {}): DragResult {
  const sc = opts.scope ?? scope;
  const d: FreeDesign = structuredClone(design);
  const v: ParamValues = { ...values };
  const notes: string[] = [];
  const applied: number[] = [];
  const c = d.components.find((x) => x.id === compId);
  if (!c) return { design: d, values: v, notes, applied };
  ops.forEach((op, k) => {
    const delta = link && k === 1 ? -applied[0] : op.delta;
    const src = c[op.field];
    const m = ID.exec(src);
    let def = m ? params.find((p) => p.key === m[1] && (p.type === 'number' || p.type === 'int')) : undefined;
    // parámetro compartido con otras piezas y alcance "solo esta pieza": se ajusta la fórmula de esta pieza
    if (def && sc === 'piece' && d.components.filter((x) => usesKey(x, def!.key)).length > 1) {
      c[op.field] = nudgeFormula(src, delta);
      applied.push(delta);
      if (k === 0) notes.push(`Solo «${c.name}» (las demás piezas con «${def.label}» no cambian)`);
      def = undefined;
      return;
    }
    if (def) {
      const cur = Number(v[def.key] ?? def.default);
      let next = cur + delta;
      if (def.step && !opts.fine) next = Math.round((next - (def.min ?? 0)) / def.step) * def.step + (def.min ?? 0);
      if (def.min !== undefined) next = Math.max(def.min, next);
      if (def.max !== undefined) next = Math.min(def.max, next);
      next = Math.round(next * 1000) / 1000;
      v[def.key] = next;
      applied.push(next - cur);
      const users = d.components.filter((x) => usesKey(x, def.key)).length;
      const capped = Math.abs(next - (cur + delta)) > (def.step ?? 1) / 2;
      notes.push(`«${def.label}» = ${fmt(next)}${def.unit ? ' ' + def.unit : ''}${users > 1 ? ` (afecta a ${users} piezas)` : ''}${capped ? ` · tope del rango ${def.min}–${def.max}` : ''}`);
    } else {
      c[op.field] = nudgeFormula(src, delta);
      applied.push(delta);
    }
  });
  return { design: d, values: v, notes, applied };
}
