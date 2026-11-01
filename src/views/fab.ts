import { analyse } from '../core/analysis';
import { store } from '../core/store';
import { nestingDrawing } from '../drawings';
import { download, slug } from '../export/download';
import { nestingDxf } from '../export/dxf';
import { card, checkList, h, money } from '../ui';

/** Paso 5 · Fabricación: restricciones del método, anidado, despiece y costos. */
export function fabView(root: HTMLElement) {
  const out = h('div', { class: 'col wide' });
  const cfg = h('div', { class: 'col' });

  const numField = (label: string, v: number, set: (n: number) => void) =>
    h('label', { class: 'field sm' }, label, h('input', { type: 'number', value: String(v), inputmode: 'decimal', onchange: (e: Event) => { store.update(() => set(Number((e.target as HTMLInputElement).value)), 'fab'); render(); } }));

  function render() {
    const m = store.method, mat = store.material;
    const parts = store.parts();
    const a = analyse(parts, m, mat, store.project, store.project.fab.materials);
    const cur = store.project.pricing.currency;
    cfg.replaceChildren(
      card('Método de fabricación',
        h('select', { onchange: (e: Event) => { store.update((p) => { p.methodId = (e.target as HTMLSelectElement).value; }, 'fab'); render(); } },
          ...store.project.fab.methods.map((x) => h('option', { value: x.id, selected: x.id === m.id }, x.name))),
        h('p', { class: 'muted' }, m.notes),
        h('div', { class: 'grid2' },
          numField('Cama X (mm)', m.bed[0], (n) => { m.bed[0] = n; }),
          numField('Cama Y (mm)', m.bed[1], (n) => { m.bed[1] = n; }),
          numField('Espesor máx. (mm)', m.maxThickness, (n) => { m.maxThickness = n; }),
          numField('Ø herramienta / kerf (mm)', m.tool, (n) => { m.tool = n; }),
          numField('Costo por m de corte', m.ratePerMeter, (n) => { m.ratePerMeter = n; }),
          numField('Setup por tablero', m.setupPerSheet, (n) => { m.setupPerSheet = n; }))),
      card('Material',
        h('select', { onchange: (e: Event) => { store.update((p) => { p.materialId = (e.target as HTMLSelectElement).value; }, 'fab'); render(); } },
          ...store.project.fab.materials.filter((x) => x.id !== 'tapiz').map((x) => h('option', { value: x.id, selected: x.id === mat.id }, x.name))),
        h('div', { class: 'grid2' },
          numField('Tablero X (mm)', mat.sheet[0], (n) => { mat.sheet[0] = n; }),
          numField('Tablero Y (mm)', mat.sheet[1], (n) => { mat.sheet[1] = n; }),
          numField('Precio por tablero', mat.pricePerSheet, (n) => { mat.pricePerSheet = n; }),
          numField('Luz/espesor máx.', mat.maxSpanRatio, (n) => { mat.maxSpanRatio = n; })),
        h('label', { class: 'field' }, 'Espesores disponibles (mm, separados por coma)', h('input', { value: mat.thicknesses.join(', '), onchange: (e: Event) => { store.update(() => { mat.thicknesses = (e.target as HTMLInputElement).value.split(',').map(Number).filter((n) => n > 0); }, 'fab'); render(); } }))));
    out.replaceChildren(
      card('Factibilidad', checkList(a.checks)),
      card('Costo estimado',
        h('table', { class: 'cost' },
          h('tr', null, h('td', null, `Material (${a.nest.sheets} tablero/s × ${money(mat.pricePerSheet, cur)})`), h('td', null, money(a.cost.material, cur))),
          h('tr', null, h('td', null, `Mecanizado (${a.cutM.toFixed(1)} m + setup)`), h('td', null, money(a.cost.machining, cur))),
          a.cost.upholstery ? h('tr', null, h('td', null, `Tapiz (${a.upholsteryM2.toFixed(2)} m² espuma + tela, +30% confección)`), h('td', null, money(a.cost.upholstery, cur))) : null,
          h('tr', null, h('td', null, 'Base (armado, embalaje)'), h('td', null, money(store.project.pricing.base, cur))),
          h('tr', { class: 'sub' }, h('td', null, 'Costo directo'), h('td', null, money(a.cost.subtotal, cur))),
          h('tr', { class: 'total' }, h('td', null, `Precio de venta (margen ${store.project.pricing.margin}%)`), h('td', null, money(a.cost.price, cur))))),
      card('Despiece',
        h('table', { class: 'cutlist' }, h('thead', null, h('tr', null, ...['Pieza', 'Cant.', 'Largo', 'Ancho', 'Esp.'].map((t) => h('th', null, t)))),
          h('tbody', null, ...a.cutList.map((r) => h('tr', null, h('td', null, r.role), h('td', null, String(r.qty)), h('td', null, String(r.w)), h('td', null, String(r.h)), h('td', null, String(r.t))))))),
      card(`Anidado en tableros (${a.nest.sheets})`,
        a.nest.unplaced.length ? h('p', { class: 'chk error' }, `${a.nest.unplaced.length} pieza(s) no caben en el tablero.`) : null,
        h('div', { class: 'nest-wrap', html: nestingDrawing(a.nest) }),
        h('div', { class: 'row wrap' },
          h('button', { onclick: () => download(nestingDxf(a.nest), `${slug(store.project.name)}-corte-cnc.dxf`, 'application/dxf') }, 'Descargar DXF de corte (CAM)'),
          h('button', { class: 'ghost', onclick: () => download(nestingDrawing(a.nest), `${slug(store.project.name)}-anidado.svg`, 'image/svg+xml') }, 'SVG'))));
  }
  render();
  root.append(h('div', { class: 'page fab' }, cfg, out));
}

