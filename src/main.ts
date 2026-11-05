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
import { STEPS, nextStep } from './steps';
import { backupProject, backupStatus } from './backup';
import { openWelcome } from './views/welcome';

type ViewFn = (root: HTMLElement, q: URLSearchParams) => void | (() => void);
const VIEWS: Record<string, ViewFn> = { concepto: briefView, boceto: sketchView, modelo: modelView, planos: plansView, fabricacion: fabView, tienda: shopView, exportar: exportView };
const ROUTES = STEPS.map((s) => ({ ...s, view: VIEWS[s.id] }));
/** Vistas que se recorren con scroll: llevan "Siguiente" al pie (Boceto y Modelo lo traen integrado). */
const FOOTER_NEXT = new Set(['concepto', 'planos', 'fabricacion', 'tienda']);

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

async function importFile() {
  const [f] = await pickFiles('.json,.trazo,application/json');
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format === 'trazo-spec@1') throw new Error('Ese archivo es una especificación de tienda; abre un respaldo .trazo.json');
    const p = normalize({ ...data, id: data.id ?? undefined });
    await store.save(); await store.create(p); await refreshProjects(); route(); toast('Proyecto abierto');
  } catch (e) { toast(`No se pudo abrir: ${(e as Error).message}`, 'err'); }
}

/** Bienvenida / nuevo producto. En la primera visita reemplaza el proyecto vacío creado al iniciar. */
function welcome(first: boolean) {
  const blank = first ? store.project.id : null;
  openWelcome(first, {
    created: async (p, r) => {
      await store.save().catch(() => 0);
      await store.create(p);
      if (blank && blank !== p.id) await store.remove(blank).catch(() => 0);
      await refreshProjects();
      location.hash = `#/${r}`;
      route();
    },
    importFile: async () => { await importFile(); if (blank && store.project.id !== blank) { await store.remove(blank).catch(() => 0); await refreshProjects(); } },
  });
}

const menuItems = h('div', { class: 'menu-items' },
  h('button', { class: 'ghost', onclick: () => welcome(false) }, '+ Nuevo producto'),
  h('button', { class: 'ghost', onclick: () => importFile() }, 'Abrir respaldo (.trazo)'),
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
const backupInfo = h('p', { class: 'menu-note' });
menuItems.prepend(h('button', { class: 'ghost', onclick: () => backupProject() }, 'Respaldar proyecto (.trazo)'));
menuItems.append(h('button', { class: 'ghost', onclick: () => welcome(false) }, 'Cómo funciona'), backupInfo);
const menu = h('details', { class: 'menu' }, h('summary', { title: 'Proyecto' }, '⋯'), menuItems);
menu.addEventListener('toggle', () => { if (menu.open) backupInfo.textContent = backupStatus().text; });

/** Aviso de dónde se guarda el trabajo y recordatorio de respaldo (se puede posponer 7 días). */
const banner = h('div', { class: 'backup-banner', hidden: true });
function renderBackupBanner() {
  const st = backupStatus();
  banner.hidden = !st.nag || document.body.classList.contains('public');
  if (banner.hidden) return;
  banner.replaceChildren(
    h('span', null, h('b', null, 'Tus proyectos se guardan solo en este navegador. '), st.text, ' Respáldalo en iCloud o Archivos para no perderlo.'),
    h('button', { class: 'sm', onclick: async () => { await backupProject(); renderBackupBanner(); } }, 'Respaldar ahora'),
    h('button', { class: 'ghost sm', onclick: () => { try { localStorage.setItem(`trazo:snooze:${store.project.id}`, String(Date.now())); } catch { /* */ } renderBackupBanner(); } }, 'Más tarde'));
}
document.addEventListener('trazo:backup', () => renderBackupBanner());
menuItems.addEventListener('click', () => menu.removeAttribute('open'));

function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const r = ROUTES.find((x) => x.id === path) ?? ROUTES[0];
  const q = new URLSearchParams(qs ?? '');
  const public_ = r.id === 'tienda' && q.has('producto');
  document.body.classList.toggle('public', public_);
  nav.replaceChildren(...ROUTES.map((x) => {
    const opt = 'optional' in x && x.optional;
    const label = opt ? `${x.label} (opcional)` : x.label;
    return h('a', { href: `#/${x.id}`, class: `${x.id === r.id ? 'on' : ''} ${opt ? 'opt' : ''}`, title: label, 'aria-label': `Paso ${x.n}: ${label}` }, h('i', null, x.n), h('span', null, x.label));
  }));
  if (typeof unmount === 'function') unmount();
  content.replaceChildren();
  content.dataset.view = r.id;
  unmount = r.view(content, q);
  if (FOOTER_NEXT.has(r.id) && !public_) { const n = nextStep(r.id); if (n) content.querySelector('.page')?.append(n); }
  renderBackupBanner();
}

async function start() {
  app.append(h('header', { class: 'top' },
    h('a', { class: 'brand', href: '#/concepto' }, h('img', { src: 'icon.svg', alt: '' }), h('b', null, 'Trazo')),
    nav, h('div', { class: 'proj' }, projSel, menu)), banner, content);
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
  document.addEventListener('trazo:rerender', () => route());
  route();
  if (store.firstRun && !seeded) welcome(true);
}
start();
