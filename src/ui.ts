import type { Check, ParamDef } from './core/types';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** Mini helper para crear DOM sin framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k in el && k !== 'list' && k !== 'style' && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}
function append(el: Node, children: Child[]) {
  for (const c of children.flat(9 as 1)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Aviso breve. Con `action` muestra un botón (p. ej. "Deshacer") y dura más. */
export function toast(msg: string, kind: 'ok' | 'err' = 'ok', action?: { label: string; run: () => void }) {
  document.querySelectorAll('.toast.has-action').forEach((x) => x.remove()); // un deshacer a la vez
  const close = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  const t = h('div', { class: `toast ${kind} ${action ? 'has-action' : ''}`, role: 'status' }, h('span', null, msg),
    action ? h('button', { class: 'toast-btn', onclick: () => { action.run(); close(); } }, action.label) : null);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(close, action ? 7000 : 2600);
}

export const money = (n: number, currency = 'CLP') => {
  try { return new Intl.NumberFormat('es-CL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); } catch { return `$${Math.round(n)}`; }
};

/** Lee una imagen y la reduce (máx. `max` px) para no inflar el almacenamiento local. */
export function readImage(file: Blob, max = 2200): Promise<{ src: string; w: number; h: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const png = file.type === 'image/png';
      res({ src: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), w: c.width, h: c.height });
    };
    img.onerror = rej;
    img.src = url;
  });
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, multiple });
    i.addEventListener('change', () => res([...(i.files ?? [])]));
    i.click();
  });
}

/** Control para un parámetro (slider + número, toggle o select). */
export function paramControl(d: ParamDef, value: unknown, onChange: (v: number | boolean | string) => void): HTMLElement {
  const label = h('span', { class: 'plabel' }, d.label, d.unit && d.type !== 'choice' ? h('small', null, ` ${d.unit}`) : null);
  if (d.type === 'bool') {
    const cb = h('input', { type: 'checkbox', checked: !!value, onchange: () => onChange(cb.checked) });
    return h('label', { class: 'param toggle' }, label, h('span', { class: 'switch' }, cb, h('i')));
  }
  if (d.type === 'choice') {
    const sel = h('select', { onchange: () => onChange(isNaN(Number(sel.value)) ? sel.value : Number(sel.value)) },
      ...(d.options ?? []).map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label)));
    return h('label', { class: 'param' }, label, sel);
  }
  const range = h('input', { type: 'range', min: String(d.min ?? 0), max: String(d.max ?? 100), step: String(d.step ?? 1), value: String(value) });
  const num = h('input', { type: 'number', min: String(d.min ?? ''), max: String(d.max ?? ''), step: String(d.step ?? 1), value: String(value), inputmode: 'decimal' });
  range.addEventListener('input', () => { num.value = range.value; onChange(Number(range.value)); });
  num.addEventListener('change', () => { range.value = num.value; onChange(Number(num.value)); });
  return h('div', { class: 'param' }, h('div', { class: 'prow' }, label, num), range,
    h('div', { class: 'prange' }, h('span', null, String(d.min ?? '')), h('span', null, String(d.max ?? ''))));
}

const ICON: Record<Check['level'], string> = { ok: '✓', info: 'i', warn: '!', error: '×' };
export function checkList(checks: Check[]) {
  return h('ul', { class: 'checks' }, ...checks.map((c) => h('li', { class: `chk ${c.level}` }, h('b', null, ICON[c.level]), h('span', null, c.msg))));
}

export function card(title: string, ...children: Child[]) {
  return h('section', { class: 'card' }, h('h3', null, title), ...children);
}

/** Diálogo propio (los nativos prompt/confirm no funcionan en todos los contenedores, p. ej. vistas embebidas). */
function dialog(title: string, opts: { input?: string; inputmode?: string; ok: string; danger?: boolean }): Promise<string | null> {
  return new Promise((res) => {
    const input = opts.input !== undefined ? h('input', { id: 'dlg-input', value: opts.input, inputmode: opts.inputmode ?? 'text' }) : null;
    const close = (v: string | null) => { wrap.remove(); res(v); };
    const okBtn = h('button', { class: opts.danger ? 'danger-solid' : '', onclick: () => close(input ? input.value : '') }, opts.ok);
    const wrap = h('div', { class: 'dlg-back', onclick: (e: Event) => { if (e.target === wrap) close(null); } },
      h('form', { class: 'dlg', onsubmit: (e: Event) => { e.preventDefault(); close(input ? input.value : ''); } },
        h('p', null, title), input,
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancelar'), okBtn)));
    document.body.appendChild(wrap);
    (input ?? okBtn).focus();
    input?.select();
  });
}
export const ask = (title: string, def = '', inputmode = 'decimal') => dialog(title, { input: def, inputmode, ok: 'Aceptar' });
export const confirmDialog = async (title: string, ok = 'Eliminar') => (await dialog(title, { ok, danger: true })) !== null;

/** Formulario breve en un diálogo propio. Devuelve los valores o null si se cancela. */
export function formDialog(title: string, fields: { key: string; label: string; value?: string; type?: 'text' | 'number'; placeholder?: string }[], ok = 'Aceptar'): Promise<Record<string, string> | null> {
  return new Promise((res) => {
    const inputs = fields.map((f) => h('input', { id: `fd-${f.key}`, value: f.value ?? '', placeholder: f.placeholder ?? '', type: f.type === 'number' ? 'text' : 'text', inputmode: f.type === 'number' ? 'decimal' : 'text' }));
    const close = (v: Record<string, string> | null) => { wrap.remove(); res(v); };
    const collect = () => Object.fromEntries(fields.map((f, i) => [f.key, inputs[i].value.trim()]));
    const wrap = h('div', { class: 'dlg-back', onclick: (e: Event) => { if (e.target === wrap) close(null); } },
      h('form', { class: 'dlg', onsubmit: (e: Event) => { e.preventDefault(); close(collect()); } },
        h('p', null, title),
        ...fields.map((f, i) => h('label', { class: 'field' }, f.label, inputs[i])),
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: () => close(null) }, 'Cancelar'), h('button', { type: 'submit' }, ok))));
    document.body.appendChild(wrap);
    inputs[0]?.focus();
  });
}

/** Número escrito por una persona: acepta coma decimal y unidades (mm, cm, m). Devuelve mm o NaN. */
export function parseMm(s: string): number {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i.exec(s);
  if (!m) return NaN;
  const n = Number(m[1].replace(',', '.'));
  const u = (m[2] ?? 'mm').toLowerCase();
  return u === 'm' ? n * 1000 : u === 'cm' ? n * 10 : n;
}
