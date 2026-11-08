import { applyDrag, getScope, setScope, sharedLinks, type Field } from '../core/direct';
import { evalExpr } from '../core/expr';
import { advancedRepeat, fieldValue, isNumber, linkedParam, parseRepeat, parseWhen, setRepeat, type Axis } from '../core/simple';
import { REF_SIDES, STARTERS, shapeChildren, addReference, emptyFree, findRef, freeParams, newComponent, placeAtRef, scopeFrom, type Component, type FreeDesign } from '../core/free';
import { bounds2, uid } from '../core/geom';
import { store } from '../core/store';
import type { ParamDef, Project, SketchEl, V2 } from '../core/types';
import { choiceDialog, confirmDialog, formDialog, h, parseMm, toast } from '../ui';

const KIND: Record<Component['kind'], string> = { tablero: 'Tablero CNC', tapiz: 'Tapiz (espuma + tela)', ref: 'Referencia (no se fabrica)' };
const FIELDS: { k: 'w' | 'h' | 't' | 'x' | 'y' | 'z'; label: string }[] = [
  { k: 'w', label: 'Ancho' }, { k: 'h', label: 'Alto' }, { k: 't', label: 'Espesor' },
  { k: 'x', label: 'X' }, { k: 'y', label: 'Y' }, { k: 'z', label: 'Z' },
];

const design = (p: Project): FreeDesign => (p.free ??= emptyFree());

export { applyStarter } from './design-change';
import { applyStarter } from './design-change';
import { getSample, openInterpret } from './interpret';

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
export function piecesEditor(changed: () => void, onOpen?: (compId: string | null) => void, initialOpen: string | null = null, remember?: () => void): PiecesEl {
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
    remember?.();
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

  /** Cambia una medida o posición escribiendo su valor: se traduce a parámetro, número o ajuste de fórmula. */
  function applyValue(c: Component, f: Field, delta: number) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return;
    remember?.();
    const res = applyDrag(design(store.project), store.values, store.params, c.id, [{ field: f, delta }]);
    store.update((p) => { p.free = res.design; p.values = res.values; }, 'free');
    changed(); render();
    if (res.notes.length) toast(res.notes.join(' · '));
  }
  /** Reemplaza una pieza completa (repetición, condición). */
  function replace(c: Component, next: Component) {
    remember?.();
    store.update((p) => { const arr = design(p).components; const k = arr.findIndex((y) => y.id === c.id); if (k >= 0) arr[k] = next; }, 'free');
    changed(); render();
  }
  const fmtN = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '');

  /** Campo numérico simple; muestra si está ligado a un parámetro o calculado por una fórmula. */
  function numField(c: Component, f: Field, label: string) {
    const params = store.params;
    const val = fieldValue(c, f, store.values);
    const link = linkedParam(c[f], params);
    // en posiciones las fórmulas son habituales: solo se marca cuando están ligadas a un parámetro
    const calc = !link && !isNumber(c[f]) && !['x', 'y', 'z'].includes(f);
    const inp = h('input', { type: 'number', inputmode: 'decimal', value: fmtN(val), 'aria-label': label });
    inp.addEventListener('change', () => applyValue(c, f, Number(inp.value.replace(',', '.')) - val));
    return h('label', { class: 'ff num' }, h('span', { class: 'fl' }, label), inp,
      link ? h('small', { class: 'link-chip', title: `Ligado al parámetro "${link.label}"` }, `↔ ${link.label}`)
        : calc ? h('small', { class: 'link-chip calc', title: c[f] }, 'calculada') : null);
  }

  /** Con "tamaño desde el dibujo" el ancho/alto no se edita aquí: lo dan el dibujo y sus cotas. */
  function fitSize(c: Component, f: 'w' | 'h', label: string) {
    const sh = c.fit === 'sketch' && c.shape !== 'rect' ? store.shapes[c.shape] : undefined;
    if (!sh) return null;
    const v = f === 'w' ? sh.size[0] : sh.size[1];
    return h('label', { class: 'ff num' }, h('span', { class: 'fl' }, label), h('input', { value: fmtN(v), disabled: true, 'aria-label': label }),
      h('small', { class: 'link-chip calc', title: 'Se cambia en el dibujo (2D o Boceto) y sus cotas' }, 'del dibujo'));
  }

  function thicknessField(c: Component) {
    if (c.kind !== 'tablero') return numField(c, 't', 'Espesor');
    const avail = store.material.thicknesses;
    const cur = c.t.trim();
    const opts: [string, string][] = [['t', `${store.values.t} mm · tablero`], ...avail.map((n) => [String(n), `${n} mm`] as [string, string])];
    if (cur !== 't' && !avail.map(String).includes(cur)) opts.push([cur, `${fmtN(fieldValue(c, 't', store.values))} mm (fórmula)`]);
    return h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Espesor'),
      h('select', { onchange: (e: Event) => set(c, (x) => { x.t = (e.target as HTMLSelectElement).value; }, true) },
        ...opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l))));
  }

  const ORIENT_ICON: Record<Component['orient'], [string, string]> = {
    XZ: ['De frente', '<svg viewBox="0 0 32 32"><rect x="9" y="5" width="14" height="22" rx="1"/></svg>'],
    YZ: ['De lado', '<svg viewBox="0 0 32 32"><path d="M10 9 22 4v20l-12 5z"/></svg>'],
    XY: ['Acostada', '<svg viewBox="0 0 32 32"><path d="M4 20 12 12h16l-8 8z"/></svg>'],
  };
  const AXIS_LABEL: Record<Axis, string> = { x: 'Largo (X)', y: 'Fondo (Y)', z: 'Alto (Z)' };

  function repeatBlock(c: Component) {
    const count = fieldValue(c, 'count', store.values);
    if (advancedRepeat(c)) return h('p', { class: 'muted small' }, `Se repite ${count} veces con una regla avanzada (ver fórmulas).`);
    const r = parseRepeat(c);
    const on = c.count.trim() !== '1' && c.count.trim() !== '';
    const defAxis: Axis = c.orient === 'YZ' ? 'x' : c.orient === 'XY' ? 'z' : 'x';
    const toggle = h('label', { class: 'mini-toggle' }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => {
      const v = (e.target as HTMLInputElement).checked;
      const thick = fieldValue(c, c.orient === 'XZ' ? 'w' : 't', store.values);
      replace(c, v ? setRepeat(c, '2', r.axis ?? defAxis, r.step || String(Math.round((thick || 100) + 50))) : setRepeat(c, '1', null, ''));
    } }), 'Repetir esta pieza');
    if (!on) return h('div', { class: 'rep' }, toggle);
    const stepLink = linkedParam(r.step, store.params);
    const stepVal = (() => { try { return evalExpr(r.step || '0', { ...scopeFrom(store.values), i: 0, n: count }); } catch { return NaN; } })();
    const cnt = h('input', { type: 'number', inputmode: 'numeric', min: '1', value: String(count), 'aria-label': 'Cantidad' });
    cnt.addEventListener('change', () => { const n = Math.max(1, Math.round(Number(cnt.value))); replace(c, setRepeat(c, String(n), r.axis ?? defAxis, r.step || '100')); });
    const step = h('input', { type: 'number', inputmode: 'decimal', value: fmtN(stepVal), 'aria-label': 'Separación' });
    step.addEventListener('change', () => {
      const v = Number(step.value.replace(',', '.'));
      if (!Number.isFinite(v)) return;
      if (stepLink && (stepLink.type === 'number' || stepLink.type === 'int')) {
        remember?.();
        store.update((p) => { p.values[stepLink.key] = v; }, 'free'); changed(); render();
        toast(`«${stepLink.label}» = ${v} mm`);
      } else replace(c, setRepeat(c, c.count, r.axis ?? defAxis, String(v)));
    });
    return h('div', { class: 'rep' }, toggle,
      h('div', { class: 'grid3' },
        h('label', { class: 'ff num' }, h('span', { class: 'fl' }, 'Cantidad'), cnt, !isNumber(c.count) ? h('small', { class: 'link-chip calc', title: c.count }, 'automática') : null),
        h('label', { class: 'ff num' }, h('span', { class: 'fl' }, 'Cada (mm)'), step, stepLink ? h('small', { class: 'link-chip' }, `↔ ${stepLink.label}`) : !isNumber(r.step) && r.step ? h('small', { class: 'link-chip calc', title: r.step }, 'calculada') : null),
        h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Dirección'),
          h('select', { onchange: (e: Event) => replace(c, setRepeat(c, c.count, (e.target as HTMLSelectElement).value as Axis, r.step || '100')) },
            ...(['x', 'y', 'z'] as Axis[]).map((a) => h('option', { value: a, selected: a === (r.axis ?? defAxis) }, AXIS_LABEL[a]))))));
  }

  function whenSelect(c: Component) {
    const bools = store.params.filter((p) => p.type === 'bool');
    const w = parseWhen(c, store.params);
    const val = w === null ? '__adv' : w.kind === 'always' ? '' : w.key;
    return h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Aparece'),
      h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v !== '__adv') set(c, (x) => { x.when = v; }, true); } },
        h('option', { value: '', selected: val === '' }, 'Siempre'),
        ...bools.map((b) => h('option', { value: b.key, selected: val === b.key }, `Solo si: ${b.label}`)),
        val === '__adv' ? h('option', { value: '__adv', selected: true, disabled: true }, 'Condición avanzada') : null));
  }

  /** Si la pieza comparte medidas con otras (p. ej. una copia), elegir si un cambio la afecta solo a ella o a todas. */
  function scopeCtl(c: Component) {
    const links = sharedLinks(design(store.project), c.id, store.params);
    if (!links.length) return null;
    const sc = getScope();
    const box = h('div', { class: 'scope-ctl' });
    const others = Math.max(...links.map((l) => l.users)) - 1;
    const draw = () => box.replaceChildren(
      h('span', null, `Comparte ${links.map((l) => `«${l.label}»`).join(', ')} con ${others} pieza${others > 1 ? 's' : ''} más. Al cambiar medidas:`),
      h('div', { class: 'seg' }, ...([['piece', 'Solo esta pieza'], ['shared', 'Todas']] as const).map(([k, l]) =>
        h('button', { class: `seg-btn ${getScope() === k ? 'on' : ''}`, onclick: () => { setScope(k); draw(); } }, l))));
    void sc;
    draw();
    return box;
  }

  /** Atajo para piezas de un mueble existente: pegarla a la cabecera, los pies o un costado del volumen de referencia. */
  function refPlace(c: Component) {
    const r = findRef(store.project.free);
    if (!r || c.kind === 'ref') return null;
    return h('div', { class: 'ref-place' },
      h('span', { class: 'fl' }, `Ubicar junto a «${r.name}»`),
      h('div', { class: 'chips' }, ...REF_SIDES.map((sd) => h('button', { class: 'chip', title: sd.help, onclick: () => {
        replace(c, placeAtRef(c, r, sd.id));
        toast(`«${c.name}» en ${sd.label.toLowerCase()}: su largo y posición siguen las medidas de «${r.name}».`);
      } }, sd.label))));
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
    if (c.shape !== 'rect' && !shapes[c.shape]) shapeOpts[c.shape] = '⚠︎ silueta borrada';
    const move = (d: number) => { remember?.(); store.update((p) => { const arr = design(p).components; const [x] = arr.splice(idx, 1); arr.splice(idx + d, 0, x); }, 'free'); changed(); render(); };
    const count = fieldValue(c, 'count', store.values);
    const w = parseWhen(c, store.params);
    const whenTxt = w?.kind === 'param' ? ` · si ${store.params.find((p) => p.key === w.key)?.label ?? w.key}` : w === null ? ' · condicional' : '';

    det.append(
      h('summary', null, c.shape !== 'rect' ? thumb(c.shape) : h('span', { class: 'thumb' }, '▭'),
        h('span', { class: 'pname' }, h('b', null, c.name), h('small', null, `${KIND[c.kind].split(' (')[0]} · ${ORIENT_ICON[c.orient][0].toLowerCase()}${count !== 1 ? ` · ×${count}` : ''}${whenTxt}`))),
      h('div', { class: 'pbody' },
        h('div', { class: 'grid2' },
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Nombre'), h('input', { value: c.name, onchange: (e: Event) => set(c, (x) => { x.name = (e.target as HTMLInputElement).value; }, true) })),
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Forma'), sel(c.shape, shapeOpts, (v) => set(c, (x) => { x.shape = v; }, true)))),
        h('div', { class: 'orient', role: 'radiogroup', 'aria-label': 'Orientación' },
          ...(Object.keys(ORIENT_ICON) as Component['orient'][]).map((o) => h('button', { class: `orient-btn ${o === c.orient ? 'on' : ''}`, role: 'radio', 'aria-checked': String(o === c.orient), onclick: () => { if (o !== c.orient) set(c, (x) => { x.orient = o; }, true); } },
            h('span', { html: ORIENT_ICON[o][1] }), ORIENT_ICON[o][0]))),
        scopeCtl(c),
        refPlace(c),
        c.shape !== 'rect' && shapes[c.shape] ? h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Tamaño'),
          sel(c.fit ?? 'stretch', { stretch: 'Estirar la silueta a ancho × alto', sketch: 'Desde el dibujo (cotas en mm reales)' }, (v) => set(c, (x) => { x.fit = v === 'sketch' ? 'sketch' : undefined; }, true))) : null,
        h('div', { class: 'grid3' }, fitSize(c, 'w', 'Ancho') ?? numField(c, 'w', 'Ancho'), fitSize(c, 'h', 'Alto') ?? numField(c, 'h', 'Alto'), thicknessField(c)),
        h('div', { class: 'grid3' }, numField(c, 'x', 'X · largo'), numField(c, 'y', 'Y · fondo'), numField(c, 'z', 'Z · altura')),
        h('p', { class: 'muted small' }, 'Medidas en mm. La posición es la esquina más cercana al origen; también puedes arrastrar la pieza en el 3D.'),
        repeatBlock(c),
        h('div', { class: 'grid2' },
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Tipo'), sel(c.kind, KIND, (v) => set(c, (x) => { x.kind = v; }, true))),
          whenSelect(c)),
        c.shape !== 'rect' && shapes[c.shape]?.holes.length ? h('label', { class: 'mini-toggle' }, h('input', { type: 'checkbox', checked: c.holes, onchange: (e: Event) => set(c, (x) => { x.holes = (e.target as HTMLInputElement).checked; }) }), `Calar las ${shapes[c.shape].holes.length} forma(s) interiores`) : null,
        h('details', { class: 'adv' }, h('summary', null, 'Ver fórmulas (avanzado)'),
          h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Grupo en el despiece'), h('input', { value: c.role, placeholder: c.name, onchange: (e: Event) => set(c, (x) => { x.role = (e.target as HTMLInputElement).value; }) })),
          h('div', { class: 'grid3' }, ...FIELDS.slice(0, 3).map((f) => formula(c, f.k, f.label))),
          h('div', { class: 'grid3' }, ...FIELDS.slice(3).map((f) => formula(c, f.k, f.label))),
          h('div', { class: 'grid2' }, formula(c, 'count', 'Cantidad', '1'), formula(c, 'when', 'Presente si', 'p. ej. baranda'))),
        h('div', { class: 'row wrap' },
          h('button', { class: 'ghost sm', onclick: () => { remember?.(); store.update((p) => { design(p).components.splice(idx + 1, 0, { ...structuredClone(c), id: uid('c-'), name: `${c.name} copia` }); }, 'free'); changed(); render(); } }, 'Duplicar'),
          c.kind !== 'ref' ? h('button', { class: 'ghost sm', title: 'Dibujar calados o cambiar la silueta en el Boceto', onclick: () => drawOnPiece(c.id) }, 'Dibujar en la pieza') : null,
          idx > 0 ? h('button', { class: 'ghost sm', 'aria-label': 'Subir en la lista', onclick: () => move(-1) }, '↑') : null,
          idx < total - 1 ? h('button', { class: 'ghost sm', 'aria-label': 'Bajar en la lista', onclick: () => move(1) }, '↓') : null,
          h('span', { class: 'sep' }),
          h('button', { class: 'ghost sm danger', onclick: async () => { if (await confirmDialog(`¿Eliminar la pieza "${c.name}"?`)) { remember?.(); store.update((p) => { design(p).components.splice(idx, 1); }, 'free'); changed(); render(); } } }, 'Eliminar'))));
    return det;
  }

  /** Mueble u objeto existente (p. ej. la cama a la que se adapta el diseño): se ve en 3D, no se fabrica. */
  async function addRefVolume() {
    const v = await formDialog('Volumen de referencia: el mueble u objeto existente al que se adapta tu diseño. Se ve en 3D pero no se fabrica. Acepta mm, cm o m.', [
      { key: 'name', label: 'Nombre', value: 'Cama existente' },
      { key: 'l', label: 'Largo (X)', placeholder: 'Ej: 200 cm', type: 'number' },
      { key: 'a', label: 'Ancho (Y)', placeholder: 'Ej: 106 cm', type: 'number' },
      { key: 'h', label: 'Alto (Z)', placeholder: 'Ej: 45 cm', type: 'number' },
    ], 'Agregar');
    if (!v) return;
    const [l, a, hh] = [parseMm(v.l), parseMm(v.a), parseMm(v.h)];
    if (![l, a, hh].every((n) => Number.isFinite(n) && n > 0)) { toast('Revisa las medidas: usa números, por ejemplo 106 cm o 1060.', 'err'); return; }
    remember?.();
    store.update((p) => {
      p.free = addReference(design(p), v.name || 'Referencia', l, a, hh);
      for (const d of freeParams(p.free)) if (!(d.key in p.values)) p.values[d.key] = d.default;
    }, 'free');
    changed(); render();
    toast(`Volumen "${v.name}" agregado (${Math.round(l)} × ${Math.round(a)} × ${Math.round(hh)} mm). Sus medidas quedan como parámetros.`);
  }

  function addPiece() {
    const d = design(store.project);
    const c = newComponent({ name: `Pieza ${d.components.length + 1}` });
    openId = c.id;
    remember?.();
    store.update((p) => { design(p).components.push(c); }, 'free'); changed(); render();
    onOpen?.(c.id);
  }

  // "Desde una imagen": aparece si hay referencias y la página puede consultar a Claude
  const aiBtn = h('button', { class: 'ai-btn', hidden: true, onclick: () => openInterpret(store.project.references, 0, () => { changed(); render(); }) }, '✦ Crear desde una imagen de referencia');
  getSample().then((s) => { aiBtn.hidden = !s || !store.project.references.length; });

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
        h('button', { class: 'ghost', onclick: () => addRefVolume() }, '+ Volumen de un mueble existente'),
        aiBtn,
        h('p', { class: 'muted' }, 'O parte de un ejemplo (todo es editable):'),
        h('div', { class: 'row wrap' }, ...STARTERS.map((st) => h('button', { class: 'ghost sm', title: st.description, onclick: async () => { if (await applyStarter(st)) { changed(); render(); } } }, st.name)))),
      ...d.components.map((c, i) => card(c, i, d.components.length)),
      d.components.length ? h('div', { class: 'add-row' }, h('button', { class: 'add-piece', onclick: () => addPiece() }, '+ Agregar pieza'), h('button', { class: 'add-piece ref', onclick: () => addRefVolume() }, '+ Volumen de referencia')) : null,
      h('p', { class: 'muted' }, `Siluetas en el boceto: ${nShapes}. `, h('a', { class: 'link', href: '#/boceto' }, 'Dibujar o editar siluetas →')),
      h('details', { class: 'vars' }, h('summary', null, 'Ayuda de fórmulas (avanzado)'), h('div', { class: 'chips' }, ...vars.map((v) => h('code', null, v))),
        h('p', { class: 'muted' }, 'Operaciones: + − * / ( ), min(), max(), round(), floor(), ceil(), comparaciones y "condición ? a : b". La posición es la esquina mínima de la pieza; `i` es el número de copia (0, 1, 2…) y `n` la cantidad.'))].filter((x) => !!x) as HTMLElement[]);
    updateHints();
  }
  render();
  return root;
}

const slugKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'p';

/** Editor de los parámetros propios del diseño libre (qué existe, rangos y qué ve el cliente). */
export function paramDefsEditor(changed: () => void, remember?: () => void): HTMLElement {
  const root = h('div', { class: 'free' });
  const set = (i: number, fn: (d: ParamDef) => void, rerender = false) => {
    remember?.();
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
      h('p', { class: 'muted' }, 'Tus parámetros son las medidas y opciones del producto (ancho, alto, con o sin baranda). Las piezas se ligan a ellos y el cliente puede cambiar los que marques.'),
      ...d.params.map((p, i) => {
        const numeric = p.type !== 'bool' && p.type !== 'choice';
        const numIn = (k: 'min' | 'max' | 'step' | 'default', label: string) => h('label', { class: 'ff' }, h('span', { class: 'fl' }, label),
          h('input', { type: 'number', inputmode: 'decimal', value: String(p[k] ?? ''), onchange: (e: Event) => set(i, (x) => { (x as any)[k] = Number((e.target as HTMLInputElement).value); }) }));
        return h('div', { class: 'pdef' },
          h('div', { class: 'grid2' },
            h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Nombre'), h('input', { value: p.label, onchange: (e: Event) => {
              const label = (e.target as HTMLInputElement).value;
              set(i, (x) => { x.label = label; });
              // un parámetro recién creado ("param3") toma su nombre corto del nombre visible
              if (/^param\d+_*$/.test(p.key)) renameKey(i, label);
            } })),
            h('label', { class: 'ff' }, h('span', { class: 'fl' }, 'Nombre corto (fórmulas)'), h('input', { value: p.key, class: 'mono', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', onchange: (e: Event) => renameKey(i, (e.target as HTMLInputElement).value) }))),
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

/** Copia la forma (y sus calados) de una pieza para que solo esa pieza la use. */
export function forkShape(compId: string) {
  const c = design(store.project).components.find((x) => x.id === compId);
  if (!c || c.shape === 'rect') return;
  store.update((p) => {
    const src = p.sketch.elements.find((e) => e.id === c.shape);
    if (!src || src.kind === 'dim' || src.kind === 'free') return;
    const pts: V2[] = p.sketch.elements.flatMap((e) => (e.kind === 'circle' ? [e.c] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
    const all = bounds2(pts), own = bounds2(src.kind === 'circle' ? [[src.c[0] - src.r, src.c[1] - src.r], [src.c[0] + src.r, src.c[1] + src.r]] : src.pts);
    const dx = all.x1 + 120 - own.x0;
    const id = uid('sil-');
    // la forma y sus calados se copian a la derecha del boceto
    const kids = shapeChildren(p.sketch, src.id).map((k) => p.sketch.elements.find((e) => e.id === k)!).filter(Boolean);
    const mv = (e: SketchEl, nid: string): SketchEl => (e.kind === 'circle' ? { ...e, id: nid, c: [e.c[0] + dx, e.c[1]] } : e.kind === 'poly' ? { ...e, id: nid, pts: e.pts.map(([x, y]) => [x + dx, y] as V2) } : e);
    p.sketch.elements.push(mv({ ...src, name: c.name } as SketchEl, id), ...kids.map((e) => mv(e, uid('s'))));
    design(p).components.find((x) => x.id === compId)!.shape = id;
  }, 'free');
}

export async function drawOnPiece(compId: string) {
  const parts = store.parts();
  const part = parts.find((p) => p.source?.comp === compId);
  const c = design(store.project).components.find((x) => x.id === compId);
  if (!c || !part) return;
  // silueta compartida con otras piezas (p. ej. una copia): ¿editarla para todas o separar esta?
  const sharing = c.shape !== 'rect' ? design(store.project).components.filter((x) => x.id !== c.id && x.shape === c.shape) : [];
  if (sharing.length && store.shapes[c.shape]) {
    const ch = await choiceDialog(`La forma de «${c.name}» también la usa${sharing.length > 1 ? 'n' : ''} ${sharing.map((x) => `«${x.name}»`).join(', ')}.`, [['copy', 'Solo esta pieza (hacer una copia de la forma)'], ['shared', 'Editarla para todas']]);
    if (!ch) return;
    if (ch === 'copy') forkShape(compId);
  }
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
  // el Boceto se abre enfocado en la silueta de esta pieza (redibujar contorno o agregar calados)
  location.hash = `#/boceto?pieza=${encodeURIComponent(compId)}`;
}
