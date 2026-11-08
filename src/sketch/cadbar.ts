// Barra de líneas técnicas: restricciones y cotas del lado o círculo seleccionado (Boceto y vista 2D de pieza).
import { validConstraints, type ConstraintKind } from '../core/constraints';
import { shapeChildren } from '../core/free';
import { d2 } from '../core/geom';
import { store } from '../core/store';
import type { ParamDef, SketchEl } from '../core/types';
import { h, parseMm, toast } from '../ui';
import type { SketchEditor } from './editor';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1').slice(0, 32);

/** Diálogo de cota: medida en mm y, opcionalmente, ligarla a un parámetro (existente o nuevo). */
function dimDialog(title: string, current: number, currentParam?: string): Promise<{ mm: number; param?: string; newParam?: { label: string; exposed: boolean } } | null> {
  return new Promise((res) => {
    const free = store.project.template === 'libre';
    const nums = free ? store.params.filter((p) => p.type === 'number' && p.key !== 't') : [];
    const val = h('input', { value: `${Math.round(current * 10) / 10}`, inputmode: 'decimal', 'aria-label': 'Medida (mm)' });
    const sel = h('select', { 'aria-label': 'Parámetro' },
      h('option', { value: '' }, 'Medida fija'),
      ...nums.map((p) => h('option', { value: p.key, selected: p.key === currentParam }, `Ligada a «${p.label}» (${store.values[p.key]} mm)`)),
      free ? h('option', { value: '__new' }, '+ Nuevo parámetro con esta medida') : null);
    const name = h('input', { placeholder: 'Nombre, p. ej. Alto oreja' });
    const expo = h('input', { type: 'checkbox', checked: true });
    const newBox = h('div', { class: 'dim-new', hidden: true }, h('label', { class: 'field' }, 'Nombre del parámetro', name), h('label', { class: 'mini-toggle' }, expo, 'El cliente lo puede cambiar en la tienda'));
    const sync = () => { newBox.hidden = sel.value !== '__new'; val.disabled = !!sel.value && sel.value !== '__new'; if (val.disabled) val.value = String(store.values[sel.value]); };
    sel.addEventListener('change', sync);
    const close = (v: Parameters<typeof res>[0]) => { wrap.remove(); res(v); };
    const ok = () => {
      const mm = parseMm(val.value);
      if (!(mm > 0)) { toast('Escribe una medida válida (mm, cm o m)', 'err'); return; }
      if (sel.value === '__new') { if (!name.value.trim()) { toast('Ponle nombre al parámetro', 'err'); return; } close({ mm, newParam: { label: name.value.trim(), exposed: expo.checked } }); }
      else close({ mm, param: sel.value || undefined });
    };
    const wrap = h('div', { class: 'dlg-back', onclick: (e: Event) => { if (e.target === wrap) close(null); } },
      h('form', { class: 'dlg', onsubmit: (e: Event) => { e.preventDefault(); ok(); } },
        h('p', null, title),
        h('label', { class: 'field' }, 'Medida (mm)', val),
        free ? h('label', { class: 'field' }, 'Tipo de cota', sel) : null,
        newBox,
        h('p', { class: 'muted small' }, 'Una cota ligada a un parámetro cambia la forma cuando cambia el valor, también en la tienda.'),
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancelar'), h('button', { type: 'submit' }, 'Aplicar'))));
    document.body.appendChild(wrap);
    sync();
    val.focus();
  });
}

/** Silueta dueña de un elemento (la propia o aquella de la que es calado). */
function ownerShape(elId: string): string | null {
  const sk = store.project.sketch;
  const shapes = Object.keys(store.shapes);
  if (shapes.includes(elId)) return elId;
  return shapes.find((s) => shapeChildren(sk, s).includes(elId)) ?? null;
}

export interface CadBar { el: HTMLElement; update(): void }

/**
 * Barra contextual: con un lado seleccionado → Horizontal / Vertical / Cota / Quitar;
 * con un círculo → Diámetro; con una forma recta → Auto-restringir.
 */
export function cadBar(editor: SketchEditor, changed?: () => void): CadBar {
  const el = h('div', { class: 'cad-bar', hidden: true });

  async function dim(target: SketchEl, kind: ConstraintKind, seg: number | undefined, cur: number) {
    const existing = validConstraints(store.project.sketch).find((c) => c.el === target.id && c.kind === kind && c.seg === seg);
    const r = await dimDialog(kind === 'dia' ? 'Diámetro del círculo' : 'Largo de este lado', cur, existing?.param);
    if (!r) return;
    let param = r.param;
    if (r.newParam) {
      let key = slug(r.newParam.label) || 'medida';
      while (store.params.some((p) => p.key === key)) key += '_';
      const def: ParamDef = { key, label: r.newParam.label, type: 'number', unit: 'mm', default: Math.round(r.mm), min: Math.round(r.mm * 0.5), max: Math.round(r.mm * 1.5), step: 5, exposed: r.newParam.exposed, group: 'Forma' };
      store.update((p) => { p.free!.params.push(def); p.values[key] = def.default; }, 'free');
      param = key;
    } else if (param) {
      // ligar a un parámetro existente: su valor pasa a ser la medida escrita
      store.update((p) => { p.values[param!] = r.mm; }, 'free');
    }
    editor.addConstraints([{ kind, el: target.id, seg, value: r.mm, param }], 'Cota');
    if (param) {
      // las piezas con esta forma pasan a medir lo que mide el dibujo (si no, la cota sería solo una proporción)
      const sh = ownerShape(target.id);
      const comps = (store.project.free?.components ?? []).filter((c) => c.shape === sh && c.fit !== 'sketch');
      if (comps.length) {
        store.update((p) => { for (const c of p.free!.components) if (c.shape === sh) c.fit = 'sketch'; }, 'free');
        toast(`${comps.map((c) => `«${c.name}»`).join(', ')}: ahora toma${comps.length > 1 ? 'n' : ''} su tamaño del dibujo, así la cota mide mm reales.`);
      }
    }
    changed?.();
    update();
  }

  function update() {
    const doc = store.project.sketch;
    const sel = editor.selected ? doc.elements.find((e) => e.id === editor.selected) : undefined;
    const ss = editor.selSeg && sel && editor.selSeg.id === sel.id ? editor.selSeg : null;
    const cs = validConstraints(doc);
    const k = doc.mmPerPx || 1;
    const btn = (label: string, on: boolean, fn: () => void, title = '') => h('button', { class: `ghost sm ${on ? 'on' : ''}`, title, onclick: fn }, label);
    if (sel?.kind === 'poly' && !sel.smooth && ss) {
      const here = cs.filter((c) => c.el === sel.id && c.seg === ss.i);
      const a = sel.pts[ss.i], b = sel.pts[(ss.i + 1) % sel.pts.length];
      const len = here.find((c) => c.kind === 'len');
      el.hidden = false;
      el.replaceChildren(...[
        h('span', { class: 'cad-t' }, `Lado ${ss.i + 1} · ${Math.round(d2(a, b) * k)} mm`),
        btn('─ Horizontal', here.some((c) => c.kind === 'h'), () => { editor.addConstraints([{ kind: 'h', el: sel.id, seg: ss.i }]); changed?.(); update(); }),
        btn('│ Vertical', here.some((c) => c.kind === 'v'), () => { editor.addConstraints([{ kind: 'v', el: sel.id, seg: ss.i }]); changed?.(); update(); }),
        btn(len ? `↔ ${len.param ? len.param : Math.round(len.value ?? 0)} mm` : '↔ Cota…', !!len, () => dim(sel, 'len', ss.i, d2(a, b) * k), 'Fijar el largo de este lado'),
        here.length ? btn('Quitar', false, () => { editor.removeConstraints(sel.id, ss.i); changed?.(); update(); }) : null,
        btn('✕', false, () => { editor.selSeg = null; editor.render(); update(); }, 'Soltar el lado')].filter(Boolean) as Node[]);
      return;
    }
    if (sel?.kind === 'circle') {
      const dia = cs.find((c) => c.el === sel.id && c.kind === 'dia');
      el.hidden = false;
      el.replaceChildren(...[
        h('span', { class: 'cad-t' }, `Círculo · Ø ${Math.round(sel.r * 2 * k)} mm`),
        btn(dia ? `Ø ${dia.param ?? Math.round(dia.value ?? 0)} mm` : 'Ø Cota…', !!dia, () => dim(sel, 'dia', undefined, sel.r * 2 * k)),
        dia ? btn('Quitar', false, () => { editor.removeConstraints(sel.id); changed?.(); update(); }) : null].filter(Boolean) as Node[]);
      return;
    }
    if (sel?.kind === 'poly' && !sel.smooth) {
      const n = cs.filter((c) => c.el === sel.id).length;
      el.hidden = false;
      el.replaceChildren(
        h('span', { class: 'cad-t' }, n ? `${n} restricción(es) · toca un lado para agregar` : 'Toca un lado para ponerle H, V o una cota'),
        btn('Auto-restringir', false, () => { const m = editor.autoConstrain(sel.id); toast(m ? `${m} lado(s) quedaron horizontales o verticales` : 'No hay lados derechos sin restringir'); changed?.(); update(); }, 'Los lados derechos quedan fijos como horizontales o verticales'));
      return;
    }
    el.hidden = true;
  }
  return { el, update };
}
