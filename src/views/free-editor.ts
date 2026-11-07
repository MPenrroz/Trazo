import { evalExpr } from '../core/expr';
import { STARTERS, emptyFree, freeParams, newComponent, scopeFrom, type Component, type FreeDesign } from '../core/free';
import { bounds2, uid } from '../core/geom';
import { store } from '../core/store';
import type { ParamDef, Project, V2 } from '../core/types';
import { confirmDialog, h, toast } from '../ui';

const ORIENT: Record<Component['orient'], string> = {
  XZ: 'Frontal (ancho → X largo · alto → Z)',
  YZ: 'Lateral (ancho → Y fondo · alto → Z)',
  XY: 'Horizontal (ancho → X · alto → Y · espesor hacia arriba)',
};
const KIND: Record<Component['kind'], string> = { tablero: 'Tablero CNC', tapiz: 'Tapiz (espuma + tela)', ref: 'Referencia (no se fabrica)' };
const FIELDS: { k: 'w' | 'h' | 't' | 'x' | 'y' | 'z'; label: string }[] = [
  { k: 'w', label: 'Ancho' }, { k: 'h', label: 'Alto' }, { k: 't', label: 'Espesor' },
  { k: 'x', label: 'X' }, { k: 'y', label: 'Y' }, { k: 'z', label: 'Z' },
];

const design = (p: Project): FreeDesign => (p.free ??= emptyFree());

export { applyStarter } from './design-change';
import { applyStarter } from './design-change';

/** Miniatura SVG de una forma del boceto. */
function thumb(shapeId: string) {
  const sh = store.shapes[shapeId];
  if (!sh) return h('span', { class: 'thumb empty' }, '▭');
  const path = (pts: V2[]) => `M${pts.map(([u, v]) => `${(u * 40 + 2).toFixed(1)},${((1 - v) * 40 + 2).toFixed(1)}`).join('L')}Z`;
  const d = [sh.outline, ...sh.holes].map(path).join(' ');
  const span = h('span', { class: 'thumb' });
  span.innerHTML = `<svg viewBox="0 0 44 44" width="44" height="44"><path d="${d}" fill-rule="evenodd"/></svg>`;
  return span;
}

/** Lista de piezas del diseño libre. `changed` refresca el 3D. */
export type PiecesEl = HTMLElement & { selectPiece(id: string | null): void };

/** Lista de piezas del diseño libre. `changed` refresca el 3D; `onOpen` avisa qué ficha se abrió (para seleccionarla en 3D). */
export function piecesEditor(changed: () => void, onOpen?: (compId: string | null) => void, initialOpen: string | null = null): PiecesEl {
  const root = h('div', { class: 'free' }) as unknown as PiecesEl;
  let openId: string | null = initialOpen;
  root.selectPiece = (id) => {
    openId = id; // se fija antes: los eventos "toggle" que siguen se reconocen como programáticos
    root.querySelectorAll<HTMLDetailsElement>('details.piece').forEach((d) => {
      const on = d.dataset.id === id;
      if (d.open !== on) d.open = on;
      if (on) {
        // desplaza solo el panel lateral (no la página, para no mover el visor bajo el dedo)
        const panel = d.closest('.panel') as HTMLElement | null;
        if (panel) panel.scrollTo({ top: Math.max(0, d.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 80), behavior: 'smooth' });
      }
    });
  };

  const set = (c: Component, fn: (c: Component) => void, rerender = false) => {
    store.update((p) => { const x = design(p).components.find((y) => y.id === c.id); if (x) fn(x); }, 'free');
    changed();
    if (rerender) render(); else updateHints();
  };

  const hintEls = new Map<string, HTMLElement>();
  function updateHints() {
    const scope = scopeFrom(store.values);
    for (const c of design(store.project).components) {
      let n = 1;
      try { n = Math.round(evalExpr(c.count || '1', scope)); } catch { /* */ }
      for (const f of [...FIELDS.map((x) => x.k), 'count', 'when'] as const) {
        const el = hintEls.get(`${c.id}:${f}`);
        if (!el) continue;
        const src = c[f];
        if (f === 'when' && !src.trim()) { el.textContent = 'siempre'; el.className = 'hint'; continue; }
        try {
          const v = evalExpr(src, { ...scope, i: 0, n });
          el.textContent = f === 'when' ? (v ? 'sí' : 'no') : `= ${Math.round(v * 10) / 10}`;
          el.className = 'hint';
        } catch (e) { el.textContent = (e as Error).message; el.className = 'hint err'; }
      }
    }
    errs.replaceChildren(...store.buildErrors.map((m) => h('li', null, m)));
  }

  const errs = h('ul', { class: 'free-errors' });

  function formula(c: Component, f: 'w' | 'h' | 't' | 'x' | 'y' | 'z' | 'count' | 'when', label: string, placeholder = '') {
    const hint = h('span', { class: 'hint' });
    hintEls.set(`${c.id}:${f}`, hint);
    const inp = h('input', { value: c[f], title: c[f], placeholder, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', class: 'mono' });
    inp.addEventListener('change', () => set(c, (x) => { x[f] = inp.value.trim(); }));
    return h('label', { class: 'ff' }, h('span', { class: 'fl' }, label, hint), inp);
  }

  function card(c: Component, idx: number, total: number) {
    const shapes = store.shapes;
    const det = h('details', { class: `piece ${c.kind}`, open: openId === c.id, 'data-id': c.id });
    // abrir/cerrar una ficha sincroniza la selección en 3D; solo una ficha abierta a la vez
    det.addEventListener('toggle', () => {
      if (det.open && openId !== c.id) { root.selectPiece(c.id); onOpen?.(c.id); }
      else if (!det.open && openId === c.id) { openId = null; onOpen?.(null); }
    });
    const sel = <T extends string>(value: T, opts: Record<string, string>, onPick: (v: T) => void) =>
      h('select', { onchange: (e: Event) => onPick((e.target as HTMLSelectElement).value as T) }, ...Object.entries(opts).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
    const shapeOpts: Record<string, string> = { rect: 'Rectángulo', ...Object.fromEntries(Object.entries(shapes).map(([id, s]) => [id, s.label])) };
    if (c.shape !== 'rect' && !shapes[c.shape]) shapeOpts[c.shape] = '⚠︎ forma borrada';
    const move = (d: number) => { store.update((p) => { const arr = design(p).components; const [x] = arr.splice(idx, 1); arr.splice(idx + d, 0, x); }, 'free'); changed(); render(); };

    det.append(
      h('summary', null, c.shape !== 'rect' ? thumb(c.shape) : h('span', { class: 'thumb' }, '▭'),
        h('span', { class: 'pname' }, h('b', null, c.name), h('small', null, `${KIND[c.kind].split(' (')[0]} · ${c.orient}${c.count.trim() !== '1' ? ` · ×${c.count}` : ''}${c.when.trim() ? ` · si ${c.when}` : ''}`))),
      h('div', { class: 'pbody' },
        h('div', { class: 'grid2' },
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Nombre'), h('input', { value: c.name, onchange: (e: Event) => set(c, (x) => { x.name = (e.target as HTMLInputElement).value; }, true) })),
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Grupo (despiece)'), h('input', { value: c.role, placeholder: c.name, onchange: (e: Event) => set(c, (x) => { x.role = (e.target as HTMLInputElement).value; }) })),
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Forma'), sel(c.shape, shapeOpts, (v) => set(c, (x) => { x.shape = v; }, true))),
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Tipo'), sel(c.kind, KIND, (v) => set(c, (x) => { x.kind = v; }, true)))),
        h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Orientación'), sel(c.orient, ORIENT, (v) => set(c, (x) => { x.orient = v; }, true))),
        c.shape !== 'rect' && shapes[c.shape]?.holes.length ? h('label', { class: 'mini-toggle' }, h('input', { type: 'checkbox', checked: c.holes, onchange: (e: Event) => set(c, (x) => { x.holes = (e.target as HTMLInputElement).checked; }) }), `Calar las ${shapes[c.shape].holes.length} forma(s) interiores`) : null,
        h('div', { class: 'grid3' }, ...FIELDS.slice(0, 3).map((f) => formula(c, f.k, f.label))),
        h('div', { class: 'grid3' }, ...FIELDS.slice(3).map((f) => formula(c, f.k, f.label))),
        h('div', { class: 'grid2' }, formula(c, 'count', 'Cantidad', '1'), formula(c, 'when', 'Presente si', 'p. ej. baranda')),
        h('div', { class: 'row wrap' },
          h('button', { class: 'ghost sm', onclick: () => { store.update((p) => { design(p).components.splice(idx + 1, 0, { ...structuredClone(c), id: uid('c-'), name: `${c.name} copia` }); }, 'free'); changed(); render(); } }, 'Duplicar'),
          c.kind !== 'ref' ? h('button', { class: 'ghost sm', title: 'Dibujar calados o cambiar la silueta en el Boceto', onclick: () => drawOnPiece(c.id) }, 'Dibujar en la pieza') : null,
          idx > 0 ? h('button', { class: 'ghost sm', onclick: () => move(-1) }, '↑') : null,
          idx < total - 1 ? h('button', { class: 'ghost sm', onclick: () => move(1) }, '↓') : null,
          h('span', { class: 'sep' }),
          h('button', { class: 'ghost sm danger', onclick: async () => { if (await confirmDialog(`¿Eliminar la pieza "${c.name}"?`)) { store.update((p) => { design(p).components.splice(idx, 1); }, 'free'); changed(); render(); } } }, 'Eliminar'))));
    return det;
  }

  function addPiece() {
    const d = design(store.project);
    const c = newComponent({ name: `Pieza ${d.components.length + 1}` });
    openId = c.id;
    store.update((p) => { design(p).components.push(c); }, 'free'); changed(); render();
    onOpen?.(c.id);
  }

  function render() {
    hintEls.clear();
    const d = design(store.project);
    const vars = [...freeParams(d).map((p) => p.key), 'i', 'n'];
    const nShapes = Object.keys(store.shapes).length;
    root.replaceChildren(...[
      errs,
      d.components.length ? null : h('div', { class: 'empty' },
        h('b', null, 'Tu producto aún no tiene piezas'),
        h('p', null, 'Cada pieza es un tablero: rectangular o con la silueta que dibujes en el Boceto. Después la estiras y mueves tocándola en el 3D.'),
        h('button', { onclick: () => addPiece() }, '+ Agregar la primera pieza'),
        h('p', { class: 'muted' }, 'O parte de un ejemplo (todo es editable):'),
        h('div', { class: 'row wrap' }, ...STARTERS.map((st) => h('button', { class: 'ghost sm', title: st.description, onclick: async () => { if (await applyStarter(st)) { changed(); render(); } } }, st.name)))),
      ...d.components.map((c, i) => card(c, i, d.components.length)),
      d.components.length ? h('button', { class: 'add-piece', onclick: () => addPiece() }, '+ Agregar pieza') : null,
      h('div', { class: 'vars' }, h('small', null, 'Variables para las fórmulas'), h('div', { class: 'chips' }, ...vars.map((v) => h('code', null, v))),
        h('p', { class: 'muted' }, 'Operaciones: + − * / ( ), min(), max(), round(), floor(), ceil(), comparaciones y "condición ? a : b". La posición es la esquina mínima de la pieza; `i` es el número de copia (0, 1, 2…) y `n` la cantidad.'),
        h('p', { class: 'muted' }, `Formas cerradas en el boceto: ${nShapes}. `, h('a', { class: 'link', href: '#/boceto' }, 'Dibujar o editar siluetas →')))].filter((x) => !!x) as HTMLElement[]);
    updateHints();
  }
  render();
  return root;
}

const slugKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'p';

/** Editor de los parámetros propios del diseño libre (qué existe, rangos y qué ve el cliente). */
export function paramDefsEditor(changed: () => void): HTMLElement {
  const root = h('div', { class: 'free' });
  const set = (i: number, fn: (d: ParamDef) => void, rerender = false) => {
    store.update((p) => fn(design(p).params[i]), 'free');
    changed();
    if (rerender) render();
  };
  function renameKey(i: number, raw: string) {
    const d = design(store.project);
    const old = d.params[i].key, key = slugKey(raw);
    if (key === old) return;
    if (freeParams(d).some((p) => p.key === key) || ['i', 'n', 'pi'].includes(key)) { toast(`Ya existe un parámetro "${key}"`, 'err'); render(); return; }
    const re = new RegExp(`\\b${old}\\b`, 'g');
    store.update((p) => {
      const f = design(p);
      f.params[i].key = key;
      for (const c of f.components) for (const k of ['w', 'h', 't', 'x', 'y', 'z', 'count', 'when'] as const) c[k] = c[k].replace(re, key);
      if (old in p.values) { p.values[key] = p.values[old]; delete p.values[old]; }
    }, 'free');
    toast(`Renombrado a "${key}" también en las fórmulas`);
    changed(); render();
  }
  function render() {
    const d = design(store.project);
    root.replaceChildren(
      h('p', { class: 'muted' }, 'Tus parámetros: el nombre corto (clave) es el que usas en las fórmulas de las piezas. Marca "Cliente" para que aparezca en la tienda con ese rango.'),
      ...d.params.map((p, i) => {
        const numeric = p.type !== 'bool' && p.type !== 'choice';
        const numIn = (k: 'min' | 'max' | 'step' | 'default', label: string) => h('label', { class: 'ff' }, h('span', { class: 'fl' }, label),
          h('input', { type: 'number', inputmode: 'decimal', value: String(p[k] ?? ''), onchange: (e: Event) => set(i, (x) => { (x as any)[k] = Number((e.target as HTMLInputElement).value); }) }));
        return h('div', { class: 'pdef' },
          h('div', { class: 'grid2' },
            h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Nombre visible'), h('input', { value: p.label, onchange: (e: Event) => set(i, (x) => { x.label = (e.target as HTMLInputElement).value; }) })),
            h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Clave (fórmulas)'), h('input', { value: p.key, class: 'mono', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', onchange: (e: Event) => renameKey(i, (e.target as HTMLInputElement).value) }))),
          h('div', { class: 'grid3' },
            h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Tipo'), h('select', { onchange: (e: Event) => set(i, (x) => {
              const t = (e.target as HTMLSelectElement).value as ParamDef['type'];
              x.type = t;
              if (t === 'bool') { x.default = true; delete x.min; delete x.max; delete x.step; x.unit = undefined; } else if (typeof x.default !== 'number') { Object.assign(x, { default: 100, min: 0, max: 1000, step: t === 'int' ? 1 : 10, unit: t === 'int' ? undefined : 'mm' }); }
            }, true) }, ...([['number', 'Medida (mm)'], ['int', 'Cantidad'], ['bool', 'Sí / No']] as const).map(([v, l]) => h('option', { value: v, selected: p.type === v }, l)))),
            numeric ? numIn('default', 'Valor') : h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Valor'), h('select', { onchange: (e: Event) => set(i, (x) => { x.default = (e.target as HTMLSelectElement).value === '1'; }) }, h('option', { value: '1', selected: !!p.default }, 'Sí'), h('option', { value: '0', selected: !p.default }, 'No'))),
            h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Grupo'), h('input', { value: p.group ?? '', onchange: (e: Event) => set(i, (x) => { x.group = (e.target as HTMLInputElement).value || undefined; }) }))),
          numeric ? h('div', { class: 'grid3' }, numIn('min', 'Mín'), numIn('max', 'Máx'), numIn('step', 'Paso')) : null,
          h('div', { class: 'row wrap' },
            h('label', { class: 'mini-toggle' }, h('input', { type: 'checkbox', checked: p.exposed, onchange: (e: Event) => set(i, (x) => { x.exposed = (e.target as HTMLInputElement).checked; }) }), 'Cliente lo puede cambiar'),
            h('span', { class: 'sep' }),
            h('button', { class: 'ghost sm danger', onclick: async () => {
              const used = d.components.filter((c) => (['w', 'h', 't', 'x', 'y', 'z', 'count', 'when'] as const).some((k) => new RegExp(`\\b${p.key}\\b`).test(c[k])));
              if (await confirmDialog(used.length ? `"${p.key}" se usa en ${used.map((c) => c.name).join(', ')}. ¿Eliminar igual?` : `¿Eliminar el parámetro "${p.label}"?`)) { store.update((pp) => { design(pp).params.splice(i, 1); }, 'free'); changed(); render(); }
            } }, 'Eliminar')));
      }),
      h('button', { class: 'add-piece', onclick: () => {
        const n = d.params.length + 1;
        let key = `param${n}`;
        while (freeParams(d).some((p) => p.key === key)) key += '_';
        store.update((p) => { design(p).params.push({ key, label: `Parámetro ${n}`, type: 'number', unit: 'mm', default: 500, min: 100, max: 2000, step: 10, exposed: false, group: 'General' }); }, 'free');
        changed(); render();
      } }, '+ Agregar parámetro'),
      h('p', { class: 'muted' }, 'El espesor del tablero (t) se define en Valores → Material.'));
  }
  render();
  return root;
}


/**
 * "Dibujar en la pieza": abre el Boceto con la silueta de la pieza a escala. Si es un rectángulo,
 * se crea su silueta rectangular en el boceto. Lo que se dibuje dentro se vuelve calado.
 */
export function drawOnPiece(compId: string) {
  const parts = store.parts();
  const part = parts.find((p) => p.source?.comp === compId);
  const c = design(store.project).components.find((x) => x.id === compId);
  if (!c || !part) return;
  if (c.shape === 'rect' || !store.shapes[c.shape]) {
    const b = bounds2(part.profile);
    store.update((p) => {
      const k = p.sketch.mmPerPx || 1;
      const pts: V2[] = p.sketch.elements.flatMap((e) => (e.kind === 'circle' ? [e.c] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
      const ox = pts.length ? bounds2(pts).x1 + 120 : 80, oy = pts.length ? bounds2(pts).y0 : 80;
      const w = b.w / k, hh = b.h / k, id = uid('sil-');
      p.sketch.elements.push({ id, kind: 'poly', closed: true, pts: [[ox, oy], [ox + w, oy], [ox + w, oy + hh], [ox, oy + hh]] });
      const comp = design(p).components.find((x) => x.id === compId)!;
      comp.shape = id;
      comp.holes = true;
    }, 'free');
  }
  toast(`Dibuja dentro de la silueta de «${c.name}»: cada forma cerrada será un calado. También puedes redibujar el contorno.`);
  location.hash = '#/boceto';
}
