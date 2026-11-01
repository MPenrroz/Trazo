import { analyse } from '../core/analysis';
import { store } from '../core/store';
import type { ParamDef } from '../core/types';
import { checkList, h, money, paramControl } from '../ui';
import { Viewer } from '../viewer';

/** Paso 3 · Modelo paramétrico + visor 3D + reglas del arquitecto para la tienda. */
export function modelView(root: HTMLElement) {
  const viewerEl = h('div', { class: 'viewer' });
  const paramsEl = h('div', { class: 'params' });
  const rulesEl = h('div', { class: 'rules' });
  const checksEl = h('div', { class: 'model-checks' });
  const summary = h('div', { class: 'summary' });
  let viewer: Viewer | null = null;
  let mode: 'params' | 'rules' = 'params';

  const refresh = (refit = false) => {
    const parts = store.parts();
    viewer?.setParts(parts, store.project.fab.materials, refit);
    const a = analyse(parts, store.method, store.material, store.project);
    const worst = a.checks.some((c) => c.level === 'error') ? 'error' : a.checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
    summary.replaceChildren(
      h('div', null, h('small', null, 'Medidas'), h('b', null, `${a.size[0]} × ${a.size[1]} × ${a.size[2]} mm`)),
      h('div', null, h('small', null, 'Piezas / tableros'), h('b', null, `${parts.length} / ${a.nest.sheets}`)),
      h('div', null, h('small', null, 'Peso aprox.'), h('b', null, `${a.weightKg.toFixed(1)} kg`)),
      h('div', null, h('small', null, 'Precio tienda'), h('b', null, money(a.cost.price, store.project.pricing.currency))),
      h('div', { class: `state ${worst}` }, worst === 'ok' ? 'Factible' : worst === 'warn' ? 'Revisar' : 'No factible'));
    checksEl.replaceChildren(checkList(a.checks.filter((c) => c.level !== 'info')));
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
          ...mats.map((m) => h('option', { value: m.id, selected: m.id === store.project.materialId }, m.name)))),
      ...grouped(store.params).map(([g, defs]) => h('fieldset', null, h('legend', null, g),
        ...defs.map((d) => paramControl(d, vals[d.key], (v) => { store.update((p) => { p.values[d.key] = v; }, 'param'); refresh(); })))));
  };

  const renderRules = () => {
    const rows = store.params.map((d) => {
      const rule = (k: 'min' | 'max' | 'step' | 'default', v: string) => store.update((p) => { p.rules[d.key] = { ...(p.rules[d.key] ?? {}), [k]: Number(v) }; }, 'rules');
      const numeric = d.type === 'number' || d.type === 'int';
      return h('tr', null,
        h('td', null, d.label, d.unit ? h('small', null, ` ${d.unit}`) : null),
        h('td', null, h('input', { type: 'checkbox', checked: d.exposed, onchange: (e: Event) => store.update((p) => { p.rules[d.key] = { ...(p.rules[d.key] ?? {}), exposed: (e.target as HTMLInputElement).checked }; }, 'rules') })),
        ...(['min', 'max', 'step'] as const).map((k) => h('td', null, numeric ? h('input', { type: 'number', value: String(d[k] ?? ''), inputmode: 'decimal', onchange: (e: Event) => { rule(k, (e.target as HTMLInputElement).value); refresh(); } }) : '—')));
    });
    rulesEl.replaceChildren(
      h('p', { class: 'muted' }, 'Define qué puede cambiar el cliente y dentro de qué rangos. Lo no expuesto queda fijo con el valor actual del diseño.'),
      h('table', { class: 'rules-t' }, h('thead', null, h('tr', null, h('th', null, 'Parámetro'), h('th', null, 'Cliente'), h('th', null, 'Mín'), h('th', null, 'Máx'), h('th', null, 'Paso'))), h('tbody', null, ...rows)),
      h('div', { class: 'row wrap' },
        h('label', { class: 'field sm' }, 'Margen %', h('input', { type: 'number', value: String(store.project.pricing.margin), onchange: (e: Event) => { store.update((p) => { p.pricing.margin = Number((e.target as HTMLInputElement).value); }, 'rules'); refresh(); } })),
        h('label', { class: 'field sm' }, 'Costo base (armado, embalaje)', h('input', { type: 'number', value: String(store.project.pricing.base), onchange: (e: Event) => { store.update((p) => { p.pricing.base = Number((e.target as HTMLInputElement).value); }, 'rules'); refresh(); } })),
        h('label', { class: 'field sm' }, 'Moneda', h('input', { value: store.project.pricing.currency, onchange: (e: Event) => { store.update((p) => { p.pricing.currency = (e.target as HTMLInputElement).value.toUpperCase(); }, 'rules'); refresh(); } }))),
      h('button', { class: 'ghost', onclick: () => { store.update((p) => { p.rules = {}; }, 'rules'); renderRules(); renderParams(); refresh(); } }, 'Restablecer reglas'));
  };

  const tabs = h('div', { class: 'seg' },
    h('button', { class: 'on', onclick: (e: Event) => switchMode('params', e) }, 'Diseño'),
    h('button', { onclick: (e: Event) => switchMode('rules', e) }, 'Reglas para tienda'));
  function switchMode(m: typeof mode, e: Event) {
    mode = m;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    paramsEl.hidden = m !== 'params'; rulesEl.hidden = m !== 'rules';
    if (m === 'rules') renderRules(); else renderParams();
  }
  rulesEl.hidden = true;

  const explode = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
  explode.addEventListener('input', () => viewer?.setExplode(Number(explode.value) * 0.8));

  root.append(h('div', { class: 'page model' },
    h('aside', { class: 'panel' },
      h('div', { class: 'tpl-name' }, h('small', null, 'Tipología'), h('b', null, store.template.name),
        store.template.usesProfile ? h('a', { href: '#/boceto', class: 'link' }, store.project.profile ? 'Perfil desde boceto ✓ · editar' : 'Usando perfil de ejemplo · dibujar perfil') : null),
      tabs, paramsEl, rulesEl),
    h('div', { class: 'main' },
      summary,
      h('div', { class: 'viewer-wrap' }, viewerEl,
        h('div', { class: 'viewer-tools' },
          h('label', null, 'Explotar', explode),
          h('button', { class: 'ghost', onclick: () => viewer?.frame(store.parts()) }, 'Encuadrar'))),
      checksEl)));

  renderParams();
  requestAnimationFrame(() => { viewer = new Viewer(viewerEl); refresh(true); });
  return () => viewer?.dispose();
}
