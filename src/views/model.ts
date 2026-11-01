import { analyse } from '../core/analysis';
import { store } from '../core/store';
import type { ParamDef } from '../core/types';
import { checkList, h, money, paramControl } from '../ui';
import { Viewer } from '../viewer';
import { paramDefsEditor, piecesEditor } from './free-editor';

/** Paso 3 · Modelo paramétrico + visor 3D + reglas del arquitecto para la tienda. */
export function modelView(root: HTMLElement) {
  const viewerEl = h('div', { class: 'viewer' });
  const paramsEl = h('div', { class: 'params' });
  const rulesEl = h('div', { class: 'rules' });
  const checksEl = h('div', { class: 'model-checks' });
  const summary = h('div', { class: 'summary' });
  let viewer: Viewer | null = null;
  const free = store.template.id === 'libre';
  const piecesEl = h('div', { class: 'pieces' });
  const defsEl = h('div', { class: 'defs' });

  const refresh = (refit = false) => {
    const parts = store.parts();
    viewer?.setParts(parts, store.project.fab.materials, refit);
    const a = analyse(parts, store.method, store.material, store.project, store.project.fab.materials);
    const worst = a.checks.some((c) => c.level === 'error') ? 'error' : a.checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
    summary.replaceChildren(
      h('div', null, h('small', null, 'Medidas'), h('b', null, `${a.size[0]} × ${a.size[1]} × ${a.size[2]} mm`)),
      h('div', null, h('small', null, 'Piezas / tableros'), h('b', null, `${parts.length} / ${a.nest.sheets}`)),
      h('div', null, h('small', null, 'Peso aprox.'), h('b', null, `${a.weightKg.toFixed(1)} kg`)),
      h('div', null, h('small', null, 'Precio tienda'), h('b', null, money(a.cost.price, store.project.pricing.currency))),
      h('div', { class: `state ${worst}` }, worst === 'ok' ? 'Factible' : worst === 'warn' ? 'Revisar' : 'No factible'));
    const formulaErrors = store.buildErrors.map((msg) => ({ level: 'error' as const, msg: `Fórmula · ${msg}` }));
    checksEl.replaceChildren(checkList([...formulaErrors, ...a.checks.filter((c) => c.level !== 'info')]));
    if (free && !parts.length) checksEl.prepend(h('p', { class: 'muted' }, 'Aún no hay piezas: ve a la pestaña Piezas para armar tu producto o partir de un ejemplo.'));
  };

  const grouped = (defs: ParamDef[]) => {
    const g = new Map<string, ParamDef[]>();
    for (const d of defs) { const k = d.group ?? 'General'; g.set(k, [...(g.get(k) ?? []), d]); }
    return [...g];
  };

  const renderParams = () => {
    const vals = store.values;
    const mats = store.project.fab.materials;
    paramsEl.replaceChildren(
      h('label', { class: 'param' }, h('span', { class: 'plabel' }, 'Material'),
        h('select', { onchange: (e: Event) => { store.update((p) => { p.materialId = (e.target as HTMLSelectElement).value; }, 'param'); refresh(); } },
          ...mats.filter((m) => m.id !== 'tapiz').map((m) => h('option', { value: m.id, selected: m.id === store.project.materialId }, m.name)))),
      ...grouped(store.params).map(([g, defs]) => h('fieldset', null, h('legend', null, g),
        ...defs.map((d) => paramControl(d, vals[d.key], (v) => { store.update((p) => { p.values[d.key] = v; }, 'param'); refresh(); })))));
  };

  const renderRules = () => {
    // en diseño libre el rango y la visibilidad se editan en Parámetros; aquí solo precios
    const rows = (free ? [] : store.params).map((d) => {
      const rule = (k: 'min' | 'max' | 'step' | 'default', v: string) => store.update((p) => { p.rules[d.key] = { ...(p.rules[d.key] ?? {}), [k]: Number(v) }; }, 'rules');
      const numeric = d.type === 'number' || d.type === 'int';
      return h('tr', null,
        h('td', null, d.label, d.unit ? h('small', null, ` ${d.unit}`) : null),
        h('td', null, h('input', { type: 'checkbox', checked: d.exposed, onchange: (e: Event) => store.update((p) => { p.rules[d.key] = { ...(p.rules[d.key] ?? {}), exposed: (e.target as HTMLInputElement).checked }; }, 'rules') })),
        ...(['min', 'max', 'step'] as const).map((k) => h('td', null, numeric ? h('input', { type: 'number', value: String(d[k] ?? ''), inputmode: 'decimal', onchange: (e: Event) => { rule(k, (e.target as HTMLInputElement).value); refresh(); } }) : '—')));
    });
    rulesEl.replaceChildren(
      h('p', { class: 'muted' }, free ? 'Qué ve el cliente y sus rangos se definen en la pestaña Parámetros. Aquí: precio de venta.' : 'Define qué puede cambiar el cliente y dentro de qué rangos. Lo no expuesto queda fijo con el valor actual del diseño.'),
      ...(free ? [] : [h('table', { class: 'rules-t' }, h('thead', null, h('tr', null, h('th', null, 'Parámetro'), h('th', null, 'Cliente'), h('th', null, 'Mín'), h('th', null, 'Máx'), h('th', null, 'Paso'))), h('tbody', null, ...rows))]),
      h('div', { class: 'row wrap' },
        h('label', { class: 'field sm' }, 'Margen %', h('input', { type: 'number', value: String(store.project.pricing.margin), onchange: (e: Event) => { store.update((p) => { p.pricing.margin = Number((e.target as HTMLInputElement).value); }, 'rules'); refresh(); } })),
        h('label', { class: 'field sm' }, 'Costo base (armado, embalaje)', h('input', { type: 'number', value: String(store.project.pricing.base), onchange: (e: Event) => { store.update((p) => { p.pricing.base = Number((e.target as HTMLInputElement).value); }, 'rules'); refresh(); } })),
        h('label', { class: 'field sm' }, 'Moneda', h('input', { value: store.project.pricing.currency, onchange: (e: Event) => { store.update((p) => { p.pricing.currency = (e.target as HTMLInputElement).value.toUpperCase(); }, 'rules'); refresh(); } }))),
      ...(free ? [] : [h('button', { class: 'ghost', onclick: () => { store.update((p) => { p.rules = {}; }, 'rules'); renderRules(); renderParams(); refresh(); } }, 'Restablecer reglas')]));
  };

  // pestañas del panel: en diseño libre se agregan Piezas y Parámetros
  type Mode = 'params' | 'pieces' | 'defs' | 'rules';
  const modes: [Mode, string][] = free
    ? [['pieces', 'Piezas'], ['params', 'Valores'], ['defs', 'Parámetros'], ['rules', 'Precio']]
    : [['params', 'Diseño'], ['rules', 'Reglas para tienda']];
  const panes: Record<Mode, HTMLElement> = { params: paramsEl, pieces: piecesEl, defs: defsEl, rules: rulesEl };
  const onFreeChange = () => refresh();
  const tabs = h('div', { class: `seg ${free ? 'four' : ''}` }, ...modes.map(([m, label]) => h('button', { 'data-mode': m, onclick: () => switchMode(m) }, label)));
  function switchMode(m: Mode) {
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== m;
    if (m === 'rules') renderRules();
    else if (m === 'params') renderParams();
    else if (m === 'pieces') piecesEl.replaceChildren(piecesEditor(onFreeChange));
    else defsEl.replaceChildren(paramDefsEditor(onFreeChange));
  }

  const explode = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
  explode.addEventListener('input', () => viewer?.setExplode(Number(explode.value) * 0.8));

  root.append(h('div', { class: 'page model' },
    h('aside', { class: 'panel' },
      h('div', { class: 'tpl-name' }, h('small', null, 'Tipología'), h('b', null, store.template.name),
        store.template.usesProfile ? h('a', { href: '#/boceto', class: 'link' }, store.project.profile ? 'Perfil desde boceto ✓ · editar' : 'Usando perfil de ejemplo · dibujar perfil') : null),
      tabs, piecesEl, paramsEl, defsEl, rulesEl),
    h('div', { class: 'main' },
      summary,
      h('div', { class: 'viewer-wrap' }, viewerEl,
        h('div', { class: 'viewer-tools' },
          h('label', null, 'Explotar', explode),
          h('button', { class: 'ghost', onclick: () => viewer?.frame(store.parts()) }, 'Encuadrar'))),
      checksEl)));

  switchMode(modes[0][0]);
  requestAnimationFrame(() => { viewer = new Viewer(viewerEl); refresh(true); });
  return () => viewer?.dispose();
}
