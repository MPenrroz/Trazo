// Bienvenida: cómo empezar un producto (desde cero, desde un ejemplo o desde un respaldo) y cómo funciona el flujo.
import { STARTERS } from '../core/free';
import { newProject } from '../core/store';
import { getTemplate } from '../core/templates';
import type { Project } from '../core/types';
import { h } from '../ui';
import { starterChange } from './design-change';

/** Plantillas que el compositor todavía no reproduce (curvas, ranuras): quedan como "especiales". */
const SPECIAL = ['nicho', 'costillas'];

export interface WelcomeHooks {
  /** Guarda el proyecto como actual y navega. */
  created(p: Project, route: string): Promise<void>;
  /** Abre el selector de archivos para importar un .trazo. */
  importFile(): Promise<void>;
}

const FLOW = [
  ['Concepto', 'Nombre, descripción, funcionalidades e imágenes de referencia.'],
  ['Boceto (opcional)', 'Dibuja siluetas con el Pencil o calca tu dibujo; las formas cerradas se usan como piezas o calados.'],
  ['Modelo 3D', 'Arma el producto con piezas: tócalas para estirar y mover. Define qué medidas podrá cambiar el cliente.'],
  ['Planos y fabricación', 'Lámina con cotas, chequeos para CNC, tableros y costo.'],
  ['Tienda y exportar', 'Cómo lo verá el cliente, y archivos para Rhino y el taller.'],
];

export function openWelcome(first: boolean, hooks: WelcomeHooks) {
  const close = () => wrap.remove();
  const go = async (p: Project, route = 'modelo') => { close(); await hooks.created(p, route); };

  // un producto nuevo parte por el paso 1 (Concepto); los ejemplos abren directo en el 3D
  const fromScratch = () => go(newProject('Nuevo producto'), 'concepto');
  const fromStarter = (id: string) => {
    const st = STARTERS.find((s) => s.id === id)!;
    const p = newProject(st.name);
    starterChange(st)(p);
    return go(p);
  };
  const fromTemplate = (id: string) => {
    const t = getTemplate(id);
    const p = newProject(t.name);
    p.template = t.id;
    p.values = Object.fromEntries(t.params.map((q) => [q.key, q.default]));
    return go(p);
  };

  const exampleCard = (title: string, desc: string, onPick: () => void, tag?: string) =>
    h('button', { class: 'wl-example', onclick: onPick }, h('b', null, title), tag ? h('small', { class: 'wl-tag' }, tag) : null, h('span', null, desc));

  const examples = h('div', { class: 'wl-examples', hidden: true },
    h('h3', null, 'Partir de un ejemplo'),
    h('p', { class: 'muted' }, 'Los ejemplos se editan pieza por pieza: cambia medidas, agrega o quita piezas. Las plantillas especiales solo se ajustan con sus parámetros.'),
    h('div', { class: 'wl-grid' },
      ...STARTERS.map((st) => exampleCard(st.name, st.description, () => fromStarter(st.id))),
      ...SPECIAL.map((id) => { const t = getTemplate(id); return exampleCard(t.name, t.description, () => fromTemplate(id), 'Plantilla especial: solo parámetros'); })),
    h('button', { class: 'ghost', onclick: () => { examples.hidden = true; choices.hidden = false; } }, '← Volver'));

  const choice = (icon: string, title: string, desc: string, onPick: () => void, primary = false) =>
    h('button', { class: `wl-choice ${primary ? 'primary' : ''}`, onclick: onPick }, h('span', { class: 'wl-ico' }, icon), h('b', null, title), h('span', null, desc));

  const choices = h('div', { class: 'wl-choices' },
    choice('＋', 'Desde cero', 'Un diseño libre vacío: agregas piezas y defines tus medidas.', fromScratch, true),
    choice('▦', 'Partir de un ejemplo', 'Cama nido, estantería, mesa y más, listos para modificar.', () => { choices.hidden = true; examples.hidden = false; }),
    choice('⟲', 'Abrir un respaldo', 'Un archivo .trazo guardado en iCloud o Archivos.', async () => { close(); await hooks.importFile(); }));

  const wrap = h('div', { class: 'welcome-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Empezar un producto' },
    h('div', { class: 'welcome' },
      h('div', { class: 'wl-head' },
        h('div', null, h('h2', null, first ? 'Bienvenido a Trazo' : 'Nuevo producto'),
          h('p', { class: 'muted' }, 'Del boceto a un mueble de tableros listo para fabricar y vender a medida.')),
        first ? null : h('button', { class: 'ghost', 'aria-label': 'Cerrar', onclick: close }, '✕')),
      h('h3', null, '¿Cómo quieres empezar?'),
      choices, examples,
      h('details', { class: 'wl-flow', open: first },
        h('summary', null, 'Cómo funciona'),
        h('ol', null, ...FLOW.map(([t, d]) => h('li', null, h('b', null, t), ' — ', d))),
        h('p', { class: 'muted' }, 'Todo se guarda en este navegador. Usa "Respaldar" (menú ⋯) para guardar una copia en iCloud.'))));
  document.body.appendChild(wrap);
  (wrap.querySelector('.wl-choice') as HTMLElement | null)?.focus();
}
