import { analyse } from '../core/analysis';
import { store } from '../core/store';
import type { ParamDef } from '../core/types';
import { checkList, h, money, paramControl } from '../ui';
import { Viewer } from '../viewer';
import { nextStep } from '../steps';
import { getScope, setScope, sharedLinks } from '../core/direct';
import { drawOnPiece, paramDefsEditor, piecesEditor, type PiecesEl } from './free-editor';
import { DirectEdit, partDims } from './direct-edit';
import { convertToFree, freeEquivalent } from './design-change';
import { confirmDialog, toast } from '../ui';
import { uid } from '../core/geom';
import type { FreeDesign } from '../core/free';
import type { ParamValues, Part } from '../core/types';

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
  let direct: DirectEdit | null = null;
  let pieces: PiecesEl | null = null;
  const selBar = h('div', { class: 'sel-bar', hidden: true });
  // deshacer / rehacer de la edición en 3D y en fichas
  const undo: { free: FreeDesign; values: ParamValues }[] = [], redo: typeof undo = [];
  const snap = () => ({ free: structuredClone(store.project.free!), values: { ...store.project.values } });
  const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
  const ICON_REDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';
  const undoBtn = h('button', { class: 'ghost icon-btn', title: 'Deshacer', 'aria-label': 'Deshacer', disabled: true, html: ICON_UNDO, onclick: () => step(undo, redo) });
  const redoBtn = h('button', { class: 'ghost icon-btn', title: 'Rehacer', 'aria-label': 'Rehacer', disabled: true, html: ICON_REDO, onclick: () => step(redo, undo) });
  function step(from: typeof undo, to: typeof undo) {
    const s0 = from.pop(); if (!s0) return;
    to.push(snap());
    store.update((p) => { p.free = s0.free; p.values = s0.values; }, 'free');
    afterEdit();
  }
  function remember() { undo.push(snap()); if (undo.length > 60) undo.shift(); redo.length = 0; undoBtn.disabled = false; redoBtn.disabled = true; }
  function afterEdit() {
    refresh();
    if (!piecesEl.hidden) { pieces = piecesEditor(onFreeChange, onOpen, direct?.part?.source?.comp ?? null, remember); piecesEl.replaceChildren(pieces); }
    if (!defsEl.hidden) defsEl.replaceChildren(paramDefsEditor(onFreeChange, remember));
    undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
  }

  const refresh = (refit = false) => {
    const parts = store.parts();
    viewer?.setParts(parts, store.project.fab.materials, refit);
    direct?.refresh();
    renderSelBar(direct?.part ?? null);
    const a = analyse(parts, store.method, store.material, store.project, store.project.fab.materials);
    const empty = !parts.filter((q) => q.process !== 'ref').length;
    const worst = empty ? 'none' : a.checks.some((c) => c.level === 'error') ? 'error' : a.checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
    summary.replaceChildren(
      h('div', null, h('small', null, 'Medidas'), h('b', null, `${a.size[0]} × ${a.size[1]} × ${a.size[2]} mm`)),
      h('div', null, h('small', null, 'Piezas / tableros'), h('b', null, `${parts.length} / ${a.nest.sheets}`)),
      h('div', null, h('small', null, 'Peso aprox.'), h('b', null, `${a.weightKg.toFixed(1)} kg`)),
      h('div', null, h('small', null, 'Precio tienda'), h('b', null, empty ? '—' : money(a.cost.price, store.project.pricing.currency))),
      h('button', { class: `state ${worst}`, title: 'Ver avisos', onclick: () => checksEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, worst === 'none' ? 'Sin piezas' : worst === 'ok' ? 'Factible' : worst === 'warn' ? 'Revisar' : 'No factible'),
      nextStep('modelo', undefined, true) ?? '');
    const formulaErrors = store.buildErrors.map((msg) => ({ level: 'error' as const, msg: `Fórmula · ${msg}` }));
    checksEl.replaceChildren(empty ? h('p', { class: 'muted' }, 'Agrega la primera pieza en el panel para empezar.') : checkList([...formulaErrors, ...a.checks.filter((c) => c.level !== 'info')]));
  };

  const grouped = (defs: ParamDef[]) => {
    const g = new Map<string, ParamDef[]>();
    for (const d of defs) { const k = d.group ?? 'General'; g.set(k, [...(g.get(k) ?? []), d]); }
    return [...g];
  };

  const renderParams = () => {
    const vals = store.values;
    const mats = store.project.fab.materials;
    // material y espesor juntos; el espesor solo ofrece los que existen para ese material
    const tDef = store.params.find((d) => d.key === 't' && d.type === 'choice');
    const avail = store.material.thicknesses;
    const tCtl = tDef ? paramControl({ ...tDef, label: 'Espesor', options: (tDef.options ?? []).filter((o) => avail.includes(Number(o.value)) || Number(o.value) === Number(vals.t)).map((o) => ({ ...o, label: avail.includes(Number(o.value)) ? o.label : `${o.label} (no disponible)` })) }, vals.t, (v) => { store.update((p) => { p.values.t = v; }, 'param'); refresh(); renderParams(); }) : null;
    paramsEl.replaceChildren(...[
      h('fieldset', null, h('legend', null, 'Material'),
        h('label', { class: 'param' }, h('span', { class: 'plabel' }, 'Tablero'),
          h('select', { onchange: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            store.update((p) => { p.materialId = id; }, 'param');
            // si el espesor actual no existe en el nuevo material, se usa el más cercano disponible
            const th = store.material.thicknesses, cur = Number(store.values.t);
            if (tDef && th.length && !th.includes(cur)) {
              const near = th.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
              store.update((p) => { p.values.t = near; }, 'param');
              toast(`${store.material.name} no viene en ${cur} mm: se usa ${near} mm.`);
            }
            refresh(); renderParams();
          } }, ...mats.filter((m) => m.id !== 'tapiz').map((m) => h('option', { value: m.id, selected: m.id === store.project.materialId }, m.name)))),
        tCtl),
      ...grouped(store.params.filter((d) => d !== tDef)).map(([g, defs]) => h('fieldset', null, h('legend', null, g),
        ...defs.map((d) => paramControl(d, vals[d.key], (v) => { store.update((p) => { p.values[d.key] = v; }, 'param'); refresh(); }))))].filter(Boolean) as Node[]);
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
  const onFreeChange = () => { refresh(); };
  const onOpen = (compId: string | null) => { if (direct && compId !== (direct.part?.source?.comp ?? null)) { resetExplode(); direct.select(compId, false); renderSelBar(direct.part); } };

  function renderSelBar(p: Part | null) {
    selBar.hidden = !p;
    if (!p) return;
    const comp = p.source ? store.project.free?.components.find((c) => c.id === p.source!.comp) : undefined;
    const copies = comp ? store.parts().filter((q) => q.source?.comp === comp.id).length : 1;
    selBar.replaceChildren(...([
      h('div', { class: 'sel-info' }, h('b', null, comp?.name ?? p.name), h('small', null, `${partDims(p)}${copies > 1 ? ` · ${copies} copias` : ''}`)),
      comp && comp.kind !== 'ref' ? h('span', { class: 'sel-hint' }, 'Arrastra ● para estirar · flechas para mover') : null,
      comp && store.project.free && sharedLinks(store.project.free, comp.id, store.params).length ? h('button', { class: 'ghost sm', title: 'Esta pieza comparte medidas con otras', onclick: () => { setScope(getScope() === 'piece' ? 'shared' : 'piece'); renderSelBar(p); pieces?.selectPiece(comp.id); } }, getScope() === 'piece' ? 'Cambia: solo esta' : 'Cambia: todas las ligadas') : null,
      comp && comp.kind !== 'ref' ? h('button', { class: 'ghost sm', onclick: () => drawOnPiece(comp.id) }, 'Dibujar en la pieza') : null,
      comp ? h('button', { class: 'ghost sm', onclick: () => {
        remember();
        const id = uid('c-');
        store.update((pp) => { const arr = pp.free!.components; const i = arr.findIndex((c) => c.id === comp.id); arr.splice(i + 1, 0, { ...structuredClone(comp), id, name: `${comp.name} copia`, x: `${comp.x} + 100` }); }, 'free');
        afterEdit(); direct?.select(id); toast('Copia creada 100 mm a la derecha');
      } }, 'Duplicar') : null,
      comp ? h('button', { class: 'ghost sm danger', onclick: async () => {
        if (!(await confirmDialog(`¿Eliminar la pieza "${comp.name}"?`))) return;
        remember();
        store.update((pp) => { pp.free!.components = pp.free!.components.filter((c) => c.id !== comp.id); }, 'free');
        direct?.select(null); afterEdit();
      } }, 'Eliminar') : freeEquivalent(store.project.template) ? h('button', { class: 'sm', onclick: () => convertToFree() }, 'Pasar a diseño libre para editarla') : h('span', { class: 'muted' }, 'Plantilla especial: se edita con sus parámetros.'),
      h('button', { class: 'ghost sm', title: 'Quitar selección', onclick: () => { direct?.select(null); } }, '✕')].filter(Boolean) as Node[]));
  }
  function resetExplode() { if (Number(explode.value)) { explode.value = '0'; viewer?.setExplode(0); } }
  const tabs = h('div', { class: `seg ${free ? 'four' : ''}` }, ...modes.map(([m, label]) => h('button', { 'data-mode': m, onclick: () => switchMode(m) }, label)));
  function switchMode(m: Mode) {
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== m;
    if (m === 'rules') renderRules();
    else if (m === 'params') renderParams();
    else if (m === 'pieces') { pieces = piecesEditor(() => { onFreeChange(); }, onOpen, direct?.part?.source?.comp ?? null, remember); piecesEl.replaceChildren(pieces); }
    else defsEl.replaceChildren(paramDefsEditor(onFreeChange, remember));
  }

  const explode = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
  explode.addEventListener('input', () => viewer?.setExplode(Number(explode.value) * 0.8));

  root.append(h('div', { class: 'page model' },
    h('aside', { class: 'panel' },
      h('div', { class: 'tpl-name' }, h('small', null, free ? 'Producto' : 'Plantilla especial'), h('b', null, free ? 'Diseño libre' : store.template.name),
        store.template.usesProfile ? h('a', { href: '#/boceto', class: 'link' }, store.project.profile ? 'Perfil desde boceto ✓ · editar' : 'Usando perfil de ejemplo · dibujar perfil') : null),
      tabs, piecesEl, paramsEl, defsEl, rulesEl),
    h('div', { class: 'main' },
      summary,
      h('div', { class: 'viewer-wrap' }, viewerEl, selBar,
        h('div', { class: 'viewer-tools' },
          free ? undoBtn : null, free ? redoBtn : null,
          h('label', null, 'Explotar', explode),
          h('button', { class: 'ghost', onclick: () => viewer?.frame(store.parts()) }, 'Encuadrar'))),
      checksEl)));

  switchMode(modes[0][0]);
  let disposed = false;
  requestAnimationFrame(() => {
    if (disposed) return; // la vista se cerró antes del primer cuadro
    viewer = new Viewer(viewerEl);
    direct = new DirectEdit(viewer, viewerEl, {
      parts: () => store.parts(),
      design: () => (free ? store.project.free ?? null : null),
      params: () => store.params,
      values: () => store.values,
      preview: (design, values) => {
        // vista previa: se construye con el diseño temporal, sin guardar
        const prev = { free: store.project.free, values: store.project.values };
        store.project.free = design; store.project.values = values;
        const parts = store.parts();
        store.project.free = prev.free; store.project.values = prev.values;
        viewer!.setParts(parts, store.project.fab.materials);
        viewer!.highlight(direct!.part?.id ?? null, parts.filter((q) => q.source?.comp === direct!.part?.source?.comp).map((q) => q.id));
      },
      commit: (res) => {
        remember();
        store.update((p) => { p.free = res.design; p.values = res.values; }, 'free');
        afterEdit();
        if (res.notes.length) toast(res.notes.join(' · '));
      },
      selected: (part) => {
        resetExplode();
        renderSelBar(part);
        if (free && part?.source) { if (piecesEl.hidden) switchMode('pieces'); pieces?.selectPiece(part.source.comp); }
        else pieces?.selectPiece(null);
      },
    });
    (window as unknown as { __trazoDirect?: DirectEdit }).__trazoDirect = direct; // ayuda para pruebas automáticas
    refresh(true);
    // al volver de "Dibujar en la pieza", queda seleccionada la pieza editada
    let back: string | null = null;
    try { back = sessionStorage.getItem('trazo:select'); sessionStorage.removeItem('trazo:select'); } catch { /* */ }
    if (back && free) direct.select(back);
  });
  return () => { disposed = true; direct?.destroy(); viewer?.dispose(); };
}
