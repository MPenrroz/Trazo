import { uid } from '../core/geom';
import { store } from '../core/store';
import { TEMPLATES, getTemplate } from '../core/templates';
import { STARTERS } from '../core/free';
import { applyStarter, applyTemplate, convertToFree, freeEquivalent, replaceDesign } from './design-change';
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
  const newFunc = h('input', { placeholder: 'Escribe una funcionalidad y pulsa Agregar (o Enter)', enterkeyhint: 'done' });
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

  // Cómo se construye el producto: el diseño libre es el camino principal; las plantillas fijas quedan como especiales
  const build = () => {
    const pr = store.project, t = getTemplate(pr.template);
    const nPieces = pr.free?.components.length ?? 0;
    const equiv = freeEquivalent(pr.template);
    const status = pr.template === 'libre'
      ? h('div', { class: 'build-status' },
          h('div', null, h('b', null, 'Diseño libre'), h('span', { class: 'muted' }, nPieces ? ` · ${nPieces} pieza${nPieces > 1 ? 's' : ''}` : ' · aún sin piezas')),
          h('a', { class: 'btn', href: '#/modelo' }, nPieces ? 'Editar piezas →' : 'Agregar piezas →'))
      : h('div', { class: 'build-status special' },
          h('div', null, h('b', null, t.name), h('span', { class: 'muted' }, ' · plantilla fija: solo se cambian sus parámetros.')),
          equiv ? h('button', { onclick: () => { convertToFree(); } }, 'Pasar a diseño libre (mismas medidas)') : null);
    return [
      status,
      h('p', { class: 'muted' }, 'Partir de un ejemplo (reemplaza el diseño actual; podrás deshacer):'),
      h('div', { class: 'row wrap' }, ...STARTERS.map((st) => h('button', { class: 'ghost', title: st.description, onclick: async () => { if (await applyStarter(st)) location.hash = '#/modelo'; } }, st.name))),
      h('details', { class: 'specials' }, h('summary', null, 'Plantillas especiales'),
        h('p', { class: 'muted' }, 'Generadores con formas que el diseño libre aún no hace (curvas, ranuras). Solo se ajustan sus parámetros.'),
        h('div', { class: 'tpls' }, ...TEMPLATES.filter((x) => ['nicho', 'costillas'].includes(x.id)).map((x) => h('button', {
          class: `tpl ${x.id === pr.template ? 'on' : ''}`, onclick: async () => { if (await applyTemplate(x.id)) location.hash = '#/modelo'; },
        }, h('b', null, x.name), h('span', null, x.description)))),
        pr.template !== 'libre' ? h('button', { class: 'ghost', onclick: () => replaceDesign('Empezar un diseño libre vacío', (q) => { q.template = 'libre'; q.free = { params: [], components: [] }; q.values = {}; q.rules = {}; }, 'Diseño libre vacío') }, 'Empezar diseño libre vacío') : null),
    ];
  };

  root.append(h('div', { class: 'page brief' },
    h('div', { class: 'col' },
      card('Concepto',
        h('label', { class: 'field' }, 'Nombre del producto', h('input', { value: p.name, oninput: (e: Event) => { set('name', (e.target as HTMLInputElement).value); document.dispatchEvent(new Event('trazo:title')); } })),
        h('label', { class: 'field' }, 'Autor / estudio', h('input', { value: p.author, oninput: (e: Event) => set('author', (e.target as HTMLInputElement).value) })),
        h('label', { class: 'field' }, 'Descripción del concepto', h('textarea', { rows: 5, placeholder: 'Idea, intención, usuario, contexto, sensaciones…', oninput: (e: Event) => set('description', (e.target as HTMLTextAreaElement).value) }, p.description))),
      card('Funcionalidades', funcs, h('div', { class: 'row' }, newFunc, h('button', { onclick: addFunc }, 'Agregar'))),
      card('Cómo se construye el producto', ...build()),
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
