import type { ParamDef, ParamRule, ParamValues } from './types';

/** Combina la definición de la plantilla con las reglas que fijó el arquitecto. */
export function resolveParams(defs: ParamDef[], rules: Record<string, ParamRule>): ParamDef[] {
  return defs.map((d) => ({ ...d, ...(rules[d.key] ?? {}) }));
}

export function clampValue(d: ParamDef, raw: unknown): number | boolean | string {
  if (d.type === 'bool') return typeof raw === 'boolean' ? raw : raw === 'true' || raw === '1' || (raw === undefined ? !!d.default : !!raw);
  if (d.type === 'choice') {
    const opts = d.options ?? [];
    const hit = opts.find((o) => String(o.value) === String(raw));
    return hit ? hit.value : (d.default as number | string);
  }
  let n = Number(raw);
  if (!Number.isFinite(n)) n = Number(d.default);
  if (d.min !== undefined) n = Math.max(d.min, n);
  if (d.max !== undefined) n = Math.min(d.max, n);
  if (d.step) n = Math.round((n - (d.min ?? 0)) / d.step) * d.step + (d.min ?? 0);
  if (d.type === 'int') n = Math.round(n);
  return Math.round(n * 1000) / 1000;
}

export function resolveValues(defs: ParamDef[], values: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const d of defs) out[d.key] = clampValue(d, values[d.key] ?? d.default);
  return out;
}
