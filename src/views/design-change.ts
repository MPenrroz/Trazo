// Cambios que reemplazan el diseño (tipología, ejemplo, conversión): avisan qué se pierde y permiten deshacer.
import { STARTERS, freeParams, type Starter } from '../core/free';
import { bounds2 } from '../core/geom';
import { store } from '../core/store';
import { getTemplate } from '../core/templates';
import type { Project, V2 } from '../core/types';
import { confirmDialog, toast } from '../ui';

/** Qué se perdería al reemplazar el diseño actual (null si no hay nada propio). */
export function designLoss(p: Project): string | null {
  if (p.template === 'libre') {
    const n = p.free?.components.length ?? 0;
    if (!n) return null;
    return `${n} pieza${n > 1 ? 's' : ''} y ${p.free?.params.length ?? 0} parámetro(s) del diseño actual`;
  }
  const t = getTemplate(p.template);
  const changed = t.params.some((d) => p.values[d.key] !== undefined && String(p.values[d.key]) !== String(d.default));
  return changed || Object.keys(p.rules).length ? `los valores y reglas de "${t.name}"` : null;
}

type Snap = Pick<Project, 'template' | 'free' | 'values' | 'rules'> & { elements: Project['sketch']['elements'] };
const snapshot = (p: Project): Snap => structuredClone({ template: p.template, free: p.free, values: p.values, rules: p.rules, elements: p.sketch.elements });

/**
 * Ejecuta un cambio que reemplaza el diseño: confirma si hay trabajo que perder y ofrece "Deshacer".
 * Devuelve false si el usuario canceló.
 */
export async function replaceDesign(what: string, change: (p: Project) => void, done: string): Promise<boolean> {
  const loss = designLoss(store.project);
  if (loss && !(await confirmDialog(`${what} reemplaza ${loss}. Podrás deshacerlo justo después. ¿Continuar?`, 'Reemplazar'))) return false;
  const before = snapshot(store.project);
  store.update(change, 'template');
  rerender();
  toast(done, 'ok', {
    label: 'Deshacer',
    run: () => {
      store.update((p) => { p.template = before.template; p.free = before.free; p.values = before.values; p.rules = before.rules; p.sketch.elements = before.elements; }, 'template');
      rerender();
      toast('Cambio deshecho');
    },
  });
  return true;
}

/** Pide a la app volver a dibujar la vista actual. */
export const rerender = () => document.dispatchEvent(new Event('trazo:rerender'));

/** Aplica un ejemplo al proyecto: parámetros, piezas y sus siluetas en el boceto. */
export function starterChange(st: Starter, values?: Record<string, unknown>) {
  return (p: Project) => {
    p.template = 'libre';
    p.rules = {};
    p.free = st.design();
    const pts: V2[] = p.sketch.elements.flatMap((e) => (e.kind === 'circle' ? [e.c] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
    const ox = pts.length ? bounds2(pts).x1 + 120 : 80;
    const els = st.sketch?.(ox, 80) ?? [];
    const ids = new Set(p.sketch.elements.map((e) => e.id));
    p.sketch.elements.push(...els.filter((e) => !ids.has(e.id))); // no duplica siluetas ya cargadas
    p.values = { ...Object.fromEntries(freeParams(p.free).map((d) => [d.key, d.default])), ...(values ?? {}) } as Project['values'];
  };
}

export const applyStarter = (st: Starter) =>
  replaceDesign(`Cargar "${st.name}"`, starterChange(st), `Ejemplo cargado: ${st.name}. Todo es editable.`);

/** Ejemplo de diseño libre equivalente a la plantilla del proyecto (estantería, mesa). */
export const freeEquivalent = (template: string) => STARTERS.find((s) => s.from?.template === template);

/** Pasa un proyecto de plantilla fija a diseño libre conservando sus medidas. */
export function convertToFree() {
  const p = store.project, st = freeEquivalent(p.template);
  if (!st?.from) return;
  const vals: Record<string, unknown> = {};
  const t = getTemplate(p.template);
  for (const d of t.params) vals[st.from.map[d.key] ?? d.key] = p.values[d.key] ?? d.default;
  store.update(starterChange(st, vals), 'template');
  rerender();
  toast('Ahora es diseño libre: puedes tocar y estirar cada pieza.');
}

/** Cambiar a una plantilla especial (generador fijo). */
export const applyTemplate = (id: string) => {
  const t = getTemplate(id);
  return replaceDesign(`Usar la plantilla "${t.name}"`, (p) => {
    p.template = t.id;
    p.values = Object.fromEntries(t.params.map((q) => [q.key, q.default]));
    p.rules = {};
  }, `Plantilla: ${t.name}`);
};
