import './styles.css';
import { normalize, newProject, store } from './core/store';
import { briefView } from './views/brief';
import { exportView } from './views/export';
import { fabView } from './views/fab';
import { modelView } from './views/model';
import { plansView } from './views/plans';
import { shopView } from './views/shop';
import { sketchView } from './views/sketch';
import { confirmDialog, h, pickFiles, toast } from './ui';

type ViewFn = (root: HTMLElement, q: URLSearchParams) => void | (() => void);
const ROUTES: { id: string; label: string; n: string; view: ViewFn }[] = [
  { id: 'concepto', n: '1', label: 'Concepto', view: briefView },
  { id: 'boceto', n: '2', label: 'Boceto', view: sketchView },
  { id: 'modelo', n: '3', label: 'Modelo 3D', view: modelView },
  { id: 'planos', n: '4', label: 'Planos', view: plansView },
  { id: 'fabricacion', n: '5', label: 'Fabricación', view: fabView },
  { id: 'tienda', n: '6', label: 'Tienda', view: shopView },
  { id: 'exportar', n: '7', label: 'Exportar', view: exportView },
];

const app = document.getElementById('app')!;
const content = h('main', { class: 'content' });
const nav = h('nav', { class: 'tabs' });
const projSel = h('select', { class: 'proj-sel', title: 'Proyectos' });
let unmount: (() => void) | void;

async function refreshProjects() {
  const list = (await store.list()).sort((a, b) => b.updatedAt - a.updatedAt);
  projSel.replaceChildren(...list.map((p) => h('option', { value: p.id, selected: p.id === store.project.id }, p.name || 'Sin nombre')));
}
projSel.addEventListener('change', async () => { await store.save(); await store.open(projSel.value); route(); });
document.addEventListener('trazo:title', () => { const o = projSel.selectedOptions[0]; if (o) o.textContent = store.project.name; });

const menuItems = h('div', { class: 'menu-items' },
  h('button', { class: 'ghost', onclick: async () => { await store.save(); await store.create(newProject()); await refreshProjects(); location.hash = '#/concepto'; route(); } }, '+ Nuevo'),
  h('button', { class: 'ghost', onclick: async () => {
    const [f] = await pickFiles('.json,application/json');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.format === 'trazo-spec@1') throw new Error('Ese archivo es un spec de tienda; importa un .trazo.json');
      const p = normalize({ ...data, id: data.id ?? undefined });
      await store.create(p); await refreshProjects(); route(); toast('Proyecto importado');
    } catch (e) { toast(`No se pudo importar: ${(e as Error).message}`, 'err'); }
  } }, 'Importar'),
  h('button', { class: 'ghost', onclick: async () => {
    const copy = structuredClone(store.project); copy.id = newProject().id; copy.name += ' (copia)';
    await store.save(); await store.create(copy); await refreshProjects(); route();
  } }, 'Duplicar'),
  h('button', { class: 'ghost danger', onclick: async () => {
    if (!(await confirmDialog(`¿Eliminar "${store.project.name}"? No se puede deshacer.`))) return;
    await store.remove(store.project.id);
    const rest = await store.list();
    if (rest.length) await store.open(rest[0].id); else await store.create(newProject());
    await refreshProjects(); route();
  } }, 'Eliminar'));
const menu = h('details', { class: 'menu' }, h('summary', { title: 'Proyecto' }, '⋯'), menuItems);
menuItems.addEventListener('click', () => menu.removeAttribute('open'));

function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const r = ROUTES.find((x) => x.id === path) ?? ROUTES[0];
  const q = new URLSearchParams(qs ?? '');
  const public_ = r.id === 'tienda' && q.has('producto');
  document.body.classList.toggle('public', public_);
  nav.replaceChildren(...ROUTES.map((x) => h('a', { href: `#/${x.id}`, class: x.id === r.id ? 'on' : '' }, h('i', null, x.n), h('span', null, x.label))));
  if (typeof unmount === 'function') unmount();
  content.replaceChildren();
  content.dataset.view = r.id;
  unmount = r.view(content, q);
}

async function start() {
  app.append(h('header', { class: 'top' },
    h('a', { class: 'brand', href: '#/concepto' }, h('img', { src: 'icon.svg', alt: '' }), h('b', null, 'Trazo')),
    nav, h('div', { class: 'proj' }, projSel, menu)), content);
  // VITE_SEED=<nombre> precarga public/productos/<nombre>.trazo.json la primera vez (demos publicadas)
  const seedName = import.meta.env.VITE_SEED as string | undefined;
  const seed = seedName ? () => fetch(`productos/${seedName}.trazo.json`).then((r) => (r.ok ? r.json() : null)) : undefined;
  const seeded = await store.init(seed).catch((e) => { console.error(e); return false; });
  if (!store.persist) toast('Este navegador no permite guardar: los cambios duran solo esta sesión', 'err');
  if (seeded && !location.hash) location.hash = '#/modelo';
  await refreshProjects().catch(() => 0);
  let last = '';
  window.addEventListener('hashchange', () => {
    // la tienda reescribe su query en cada cambio: no remontar si solo cambió la query
    const path = location.hash.split('?')[0];
    if (path === last) return;
    last = path; route();
  });
  last = location.hash.split('?')[0];
  route();
}
start();
