import { store } from '../core/store';
import { technicalDrawing, type OverlayView } from '../drawings';
import { download, slug } from '../export/download';
import { h } from '../ui';

/** Paso 4 · Planimetría técnica automática (ISO E, A3) para corroborar factibilidad contra el boceto. */
export function plansView(root: HTMLElement) {
  const sheet = h('div', { class: 'sheet-wrap' });
  let overlay = store.project.sketch.calibrated;
  let opacity = 0.5;
  let view: OverlayView = store.template.usesProfile ? 'left' : 'front';
  const render = () => { sheet.innerHTML = technicalDrawing(store.project, store.parts(), { sketchOverlay: overlay, overlayOpacity: opacity, overlayView: view }); };
  const ov = h('input', { type: 'checkbox', checked: overlay, disabled: !store.project.sketch.calibrated, onchange: () => { overlay = ov.checked; render(); } });
  const op = h('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: String(opacity), oninput: () => { opacity = Number(op.value); render(); } });
  root.append(h('div', { class: 'page plans' },
    h('div', { class: 'toolbar' },
      h('label', { class: 'mini-toggle' }, ov, 'Superponer boceto calibrado en'),
      h('select', { class: 'inline', onchange: (e: Event) => { view = (e.target as HTMLSelectElement).value as OverlayView; render(); } },
        ...([['front', 'Alzado'], ['left', 'Lateral'], ['top', 'Planta']] as const).map(([v, l]) => h('option', { value: v, selected: v === view }, l))),
      h('label', { class: 'mini-toggle' }, 'Opacidad', op),
      !store.project.sketch.calibrated ? h('span', { class: 'muted' }, 'Calibra la escala en Boceto para comparar.') : null,
      h('span', { class: 'sep' }),
      h('button', { onclick: () => download(sheet.innerHTML, `${slug(store.project.name)}-planos.svg`, 'image/svg+xml') }, 'SVG'),
      h('button', { onclick: () => window.print() }, 'PDF / Imprimir')),
    sheet));
  render();
}
