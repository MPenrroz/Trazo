import { uid } from '../core/geom';
import { store } from '../core/store';
import { TEMPLATES } from '../core/templates';
import { card, h, pickFiles, readImage, toast } from '../ui';

const TAGS = ['Forma', 'Material', 'Uso', 'Detalle', 'Ambiente', 'Unión'];

/** Paso 1 · Concepto: descripción, funcionalidades, imágenes referenciales y estrategia de fabricación. */
export function briefView(root: HTMLElement) {
  const p = store.project;
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => store.update((x) => { x[k] = v; }, 'brief');

  const funcs = h('ul', { class: 'funcs' });
  const renderFuncs = () => {
    funcs.replaceChildren(...store.project.functions.map((f, i) => h('li', null,
      h('input', { value: f, oninput: (e: Event) => store.update((x) => { x.functions[i] = (e.target as HTMLInputElement).value; }, 'brief') }),
      h('button', { class: 'ghost', title: 'Quitar', onclick: () => { store.update((x) => x.functions.splice(i, 1), 'brief'); renderFuncs(); } }, '×'))));
  };
  renderFuncs();
  const newFunc = h('input', { placeholder: 'Ej: Repisas regulables en altura · Se arma sin herramientas…' });
  const addFunc = () => { if (!newFunc.value.trim()) return; store.update((x) => x.functions.push(newFunc.value.trim()), 'brief'); newFunc.value = ''; renderFuncs(); };
  newFunc.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFunc(); });

  const gallery = h('div', { class: 'gallery' });
  const renderGallery = () => {
    gallery.replaceChildren(...store.project.references.map((r, i) => h('figure', { class: 'ref' },
      h('img', { src: r.src, alt: r.caption, loading: 'lazy' }),
      h('select', { onchange: (e: Event) => store.update((x) => { x.references[i].tag = (e.target as HTMLSelectElement).value; }, 'brief') },
        ...TAGS.map((t) => h('option', { selected: t === r.tag }, t))),
      h('input', { value: r.caption, placeholder: 'Qué rescatar de esta imagen…', oninput: (e: Event) => store.update((x) => { x.references[i].caption = (e.target as HTMLInputElement).value; }, 'brief') }),
      h('div', { class: 'ref-actions' },
        i > 0 ? h('button', { class: 'ghost', title: 'Usar como portada', onclick: () => { store.update((x) => { const [m] = x.references.splice(i, 1); x.references.unshift(m); }, 'brief'); renderGallery(); } }, '★ Portada') : h('span', { class: 'badge' }, 'Portada tienda'),
        h('button', { class: 'ghost', onclick: () => { store.update((x) => x.references.splice(i, 1), 'brief'); renderGallery(); } }, 'Quitar')))),
    h('button', { class: 'add-ref', onclick: () => addRefs() }, '+ Agregar imágenes'));
  };
  async function addRefs(files?: File[]) {
    const fs = files ?? await pickFiles('image/*', true);
    for (const f of fs) {
      const img = await readImage(f, 1600);
      store.update((x) => x.references.push({ id: uid('r'), src: img.src, caption: '', tag: 'Forma' }), 'brief');
    }
    renderGallery();
    if (fs.length) toast(`${fs.length} imagen(es) agregada(s)`);
  }
  renderGallery();
  gallery.addEventListener('dragover', (e) => e.preventDefault());
  gallery.addEventListener('drop', (e) => { e.preventDefault(); addRefs([...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))); });

  const methods = h('div', { class: 'chips' }, ...p.fab.methods.map((m) => h('button', {
    class: `chip ${m.id === p.methodId ? 'on' : ''}`, title: m.notes,
    onclick: (e: Event) => { set('methodId', m.id); methods.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); (e.currentTarget as HTMLElement).classList.add('on'); },
  }, m.name)));

  const templates = h('div', { class: 'tpls' }, ...TEMPLATES.map((t) => h('button', {
    class: `tpl ${t.id === p.template ? 'on' : ''}`,
    onclick: (e: Event) => {
      store.update((x) => { x.template = t.id; x.values = Object.fromEntries(t.params.map((q) => [q.key, q.default])); x.rules = {}; }, 'template');
      templates.querySelectorAll('.tpl').forEach((c) => c.classList.remove('on')); (e.currentTarget as HTMLElement).classList.add('on');
    },
  }, h('b', null, t.name), h('span', null, t.description))));

  root.append(h('div', { class: 'page brief' },
    h('div', { class: 'col' },
      card('Concepto',
        h('label', { class: 'field' }, 'Nombre del producto', h('input', { value: p.name, oninput: (e: Event) => { set('name', (e.target as HTMLInputElement).value); document.dispatchEvent(new Event('trazo:title')); } })),
        h('label', { class: 'field' }, 'Autor / estudio', h('input', { value: p.author, oninput: (e: Event) => set('author', (e.target as HTMLInputElement).value) })),
        h('label', { class: 'field' }, 'Descripción del concepto', h('textarea', { rows: 5, placeholder: 'Idea, intención, usuario, contexto, sensaciones…', oninput: (e: Event) => set('description', (e.target as HTMLTextAreaElement).value) }, p.description))),
      card('Funcionalidades', funcs, h('div', { class: 'row' }, newFunc, h('button', { onclick: addFunc }, 'Agregar'))),
      card('Tipología base (generador paramétrico)', templates),
      card('Manufactura prevista', methods, h('p', { class: 'muted' }, 'Define qué restricciones se verifican (tamaño de cama, espesor máximo, herramienta). Ajustable en Fabricación.')),
      card('Notas de diseño', h('textarea', { rows: 4, placeholder: 'Uniones, acabados, dudas a resolver en Rhino…', oninput: (e: Event) => set('notes', (e.target as HTMLTextAreaElement).value) }, p.notes))),
    h('div', { class: 'col' },
      card('Imágenes referenciales', h('p', { class: 'muted' }, 'Arrastra, pega (⌘V) o elige desde Fotos/Archivos. Etiqueta qué tomar de cada una. La primera es la portada de la tienda.'), gallery))));

  const onPaste = async (e: ClipboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input,textarea')) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addRefs(files); }
  };
  document.addEventListener('paste', onPaste);
  return () => document.removeEventListener('paste', onPaste);
}
