import { h } from './ui';

/** Pasos del flujo (orden y nombres visibles). */
export const STEPS = [
  { id: 'concepto', n: '1', label: 'Concepto' },
  { id: 'boceto', n: '2', label: 'Boceto', optional: true },
  { id: 'modelo', n: '3', label: 'Modelo 3D' },
  { id: 'planos', n: '4', label: 'Planos' },
  { id: 'fabricacion', n: '5', label: 'Fabricación' },
  { id: 'tienda', n: '6', label: 'Tienda' },
  { id: 'exportar', n: '7', label: 'Exportar' },
] as const;

/** Botón "Siguiente: …" con una pista opcional de lo que falta. */
export function nextStep(fromId: string, hint?: string, compact = false): HTMLElement | null {
  const i = STEPS.findIndex((s) => s.id === fromId);
  // el boceto es opcional: desde Concepto se sigue al Modelo, con el boceto como alternativa
  let next: (typeof STEPS)[number] | undefined = STEPS[i + 1];
  const skip = next && 'optional' in next && next.optional ? next : null;
  if (skip) next = STEPS[i + 2];
  if (!next) return null;
  return h('div', { class: 'next-step' },
    hint ? h('span', { class: 'muted' }, hint) : null,
    skip && !compact ? h('a', { class: 'btn ghost', href: `#/${skip.id}` }, `Dibujar siluetas (opcional)`) : null,
    h('a', { class: 'btn', href: `#/${next.id}`, title: `Siguiente: ${next.label}`, 'aria-label': `Siguiente: ${next.label}` }, compact ? `${next.label} →` : `Siguiente: ${next.label} →`));
}
