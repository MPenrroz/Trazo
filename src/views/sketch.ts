import { round } from '../core/geom';
import { store } from '../core/store';
import { download, slug } from '../export/download';
import { sketchDxf } from '../export/dxf';
import { SketchEditor, type Tool } from '../sketch/editor';
import { profileFromSketch } from '../sketch/fit';
import { h, pickFiles, readImage, toast } from '../ui';

const TOOLS: { id: Tool; label: string; icon: string; tip: string }[] = [
  { id: 'smart', label: 'Tinta inteligente', icon: '✎', tip: 'Convierte trazos en líneas rectas, rectángulos, círculos o curvas limpias.' },
  { id: 'free', label: 'Libre', icon: '〰', tip: 'Trazo a mano alzada sin corrección.' },
  { id: 'dim', label: 'Cota', icon: '↔', tip: 'Mide entre dos puntos.' },
  { id: 'scale', label: 'Escala', icon: '📏', tip: 'Dibuja sobre una medida conocida e ingresa su largo real en mm.' },
  { id: 'pick', label: 'Elegir perfil', icon: '◎', tip: 'Toca una forma cerrada para usarla como perfil del producto.' },
  { id: 'erase', label: 'Borrar', icon: '⌫', tip: 'Toca o arrastra sobre elementos para borrarlos.' },
  { id: 'pan', label: 'Mover', icon: '✋', tip: 'Desplazar el lienzo (también con dos dedos).' },
];

/** Paso 2 · Boceto → geometría: importa el dibujo del iPad, calca con tinta inteligente y calibra la escala. */
export function sketchView(root: HTMLElement) {
  const stage = h('div', { class: 'stage' });
  const status = h('div', { class: 'sk-status' });
  const editor = new SketchEditor(stage, {
    doc: () => store.project.sketch,
    change: (fn, reason) => {
      store.update((p) => { fn(p.sketch); p.profile = profileFromSketch(p.sketch) ?? p.profile; }, 'sketch');
      if (reason === 'Escala calibrada') toast(`Escala: 1 px = ${round(store.project.sketch.mmPerPx, 3)} mm`);
      updateStatus();
    },
    askScale: async (px) => {
      const v = prompt(`Largo real de la línea dibujada (${round(px, 0)} px) en mm:`, '1000');
      return v ? Number(v.replace(',', '.')) : null;
    },
  });

  const toolBtns = TOOLS.map((t) => h('button', { class: `tool ${t.id === editor.tool ? 'on' : ''}`, title: t.tip, onclick: () => { editor.tool = t.id; toolBtns.forEach((b, i) => b.classList.toggle('on', TOOLS[i].id === t.id)); updateStatus(); } }, h('span', { class: 'ico' }, t.icon), h('span', { class: 'tl' }, t.label)));

  const opacity = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(store.project.sketch.underlayOpacity) });
  opacity.addEventListener('input', () => { store.update((p) => { p.sketch.underlayOpacity = Number(opacity.value); }, 'sketch'); editor.render(); });

  async function importUnderlay(files?: File[]) {
    const [f] = files ?? await pickFiles('image/*');
    if (!f) return;
    const img = await readImage(f, 2400);
    store.update((p) => { p.sketch.underlay = img.src; p.sketch.underlaySize = [img.w, img.h]; }, 'sketch');
    editor.fit();
    toast('Boceto importado. Calca encima con el Pencil y calibra la escala 📏');
  }

  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const cb = h('input', { type: 'checkbox', checked: get(), onchange: () => { set(cb.checked); editor.render(); } });
    return h('label', { class: 'mini-toggle' }, cb, label);
  };

  function updateStatus() {
    const sk = store.project.sketch;
    const prof = store.project.profile;
    const tool = TOOLS.find((t) => t.id === editor.tool)!;
    const bb = prof?.length ? prof.reduce((a, [x, y]) => [Math.max(a[0], x), Math.max(a[1], y)], [0, 0]) : null;
    status.replaceChildren(
      h('span', { class: sk.calibrated ? 'pill ok' : 'pill warn' }, sk.calibrated ? `Escala 1 px = ${round(sk.mmPerPx, 3)} mm` : 'Sin escala — usa 📏'),
      h('span', { class: sk.profileId ? 'pill ok' : 'pill' }, sk.profileId && bb ? `Perfil: ${round(bb[0], 0)} × ${round(bb[1], 0)} mm` : 'Sin perfil cerrado'),
      h('span', { class: 'muted' }, tool.tip));
  }
  updateStatus();

  const onPaste = (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); importUnderlay(files); }
  };
  document.addEventListener('paste', onPaste);
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); importUnderlay([...(e.dataTransfer?.files ?? [])]); });

  root.append(h('div', { class: 'page sketch' },
    h('div', { class: 'toolbar' }, ...toolBtns,
      h('span', { class: 'sep' }),
      h('button', { class: 'tool', onclick: () => editor.undo(), title: 'Deshacer (⌘Z)' }, h('span', { class: 'ico' }, '↶'), h('span', { class: 'tl' }, 'Deshacer')),
      h('button', { class: 'tool', onclick: () => editor.redo(), title: 'Rehacer' }, h('span', { class: 'ico' }, '↷'), h('span', { class: 'tl' }, 'Rehacer')),
      h('button', { class: 'tool', onclick: () => editor.fit(), title: 'Encuadrar' }, h('span', { class: 'ico' }, '⤢'), h('span', { class: 'tl' }, 'Encuadrar'))),
    h('div', { class: 'sketch-body' }, stage,
      h('aside', { class: 'side' },
        h('h4', null, 'Boceto base'),
        h('p', { class: 'muted' }, 'Exporta desde Procreate / Concepts / Morpholio como PNG o JPG, o copia y pega (⌘V). También puedes dibujar directo aquí.'),
        h('button', { onclick: () => importUnderlay() }, 'Importar imagen de boceto'),
        h('label', { class: 'field' }, 'Opacidad del boceto', opacity),
        store.project.sketch.underlay ? h('button', { class: 'ghost', onclick: () => { store.update((p) => { p.sketch.underlay = undefined; p.sketch.underlaySize = undefined; }, 'sketch'); editor.render(); } }, 'Quitar imagen') : null,
        h('h4', null, 'Asistencia'),
        toggle('Dibujar con el dedo', () => editor.fingerDraws, (v) => { editor.fingerDraws = v; }),
        toggle('Imantar ángulos (0/45/90°)', () => editor.snapAngle, (v) => { editor.snapAngle = v; }),
        toggle('Mostrar medidas', () => editor.showLengths, (v) => { editor.showLengths = v; }),
        h('h4', null, 'Del boceto al producto'),
        h('p', { class: 'muted' }, 'La primera forma cerrada se usa como perfil (naranjo). Con la tipología "Costillas desde boceto" se convierte en piezas CNC.'),
        h('button', { onclick: () => { store.update((p) => { if (p.template !== 'costillas') { p.template = 'costillas'; p.values = {}; p.rules = {}; } }, 'template'); location.hash = '#/modelo'; } }, 'Usar perfil → Modelo 3D'),
        h('h4', null, 'Exportar boceto'),
        h('div', { class: 'row wrap' },
          h('button', { class: 'ghost', onclick: () => download(editor.toSVG(), `${slug(store.project.name)}-boceto.svg`, 'image/svg+xml') }, 'SVG'),
          h('button', { class: 'ghost', onclick: () => download(sketchDxf(store.project.sketch), `${slug(store.project.name)}-boceto.dxf`, 'application/dxf') }, 'DXF (mm)')),
        h('button', { class: 'ghost danger', onclick: () => { if (confirm('¿Borrar todos los trazos?')) editor.clear(); } }, 'Limpiar lienzo'))),
    status));
  requestAnimationFrame(() => editor.fit());
  return () => { editor.destroy(); document.removeEventListener('paste', onPaste); };
}
