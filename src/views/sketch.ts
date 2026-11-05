import { bounds2, d2, round, uid } from '../core/geom';
import { store } from '../core/store';
import type { SketchEl } from '../core/types';
import { download, slug } from '../export/download';
import { sketchDxf } from '../export/dxf';
import { SketchEditor, type Tool } from '../sketch/editor';
import { profileFromSketch } from '../sketch/fit';
import { elPoints, mirrorEl, stretchSegment, translateEl } from '../sketch/ops';
import { nextStep } from '../steps';
import { ask, confirmDialog, h, pickFiles, readImage, toast } from '../ui';

interface ToolDef { id: Tool; label: string; icon: string; tip: string; only?: string }
const TOOLS: ToolDef[] = [
  { id: 'smart', label: 'Tinta inteligente', icon: '✎', tip: 'Convierte trazos en líneas rectas, rectángulos, círculos o curvas limpias.' },
  { id: 'edit', label: 'Editar', icon: '⬚', tip: 'Toca una forma: arrastra sus puntos o muévela. Toca un lado para escribir su medida.' },
  { id: 'free', label: 'Libre', icon: '〰', tip: 'Trazo a mano alzada sin corrección.' },
  { id: 'dim', label: 'Cota', icon: '↔', tip: 'Mide entre dos puntos. La primera cota puede fijar la escala.' },
  { id: 'scale', label: 'Escala', icon: '📏', tip: 'Dibuja sobre una medida conocida e ingresa su largo real en mm.' },
  { id: 'pick', label: 'Usar como perfil', icon: '◎', tip: 'Toca una silueta para usarla como costilla.', only: 'costillas' },
  { id: 'erase', label: 'Borrar', icon: '⌫', tip: 'Toca o arrastra sobre elementos para borrarlos.' },
  { id: 'pan', label: 'Mover vista', icon: '✋', tip: 'Desplazar el lienzo (también con dos dedos).' },
];

const isSilhouette = (e: SketchEl) => e.kind === 'circle' || (e.kind === 'poly' && e.closed);

/** Paso 2 · Boceto (opcional): siluetas y calados dibujados a mano, a escala. */
export function sketchView(root: HTMLElement) {
  const tpl = store.project.template;
  const tools = TOOLS.filter((t) => !t.only || t.only === tpl);
  const stage = h('div', { class: 'stage' });
  const status = h('div', { class: 'sk-status' });
  const selBar = h('div', { class: 'sk-sel', hidden: true });
  const mm = (px: number) => (store.project.sketch.calibrated ? `${round(px * store.project.sketch.mmPerPx, 0)} mm` : `${round(px, 0)} px`);
  const askMm = async (title: string, cur: number) => {
    const v = await ask(title, cur ? String(cur) : '');
    const n = v ? Number(v.replace(',', '.')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const editor = new SketchEditor(stage, {
    doc: () => store.project.sketch,
    change: (fn, reason) => {
      store.update((p) => { fn(p.sketch); p.profile = profileFromSketch(p.sketch) ?? p.profile; }, 'sketch');
      if (reason === 'Escala calibrada') toast(`Escala: 1 px = ${round(store.project.sketch.mmPerPx, 3)} mm`);
      updateStatus();
      renderSel();
    },
    askScale: async (px, fromDim) => {
      const v = fromDim
        ? await ask('¿Cuánto mide esta cota en la realidad? (mm) — así queda calibrada la escala. Cancela para omitir.', '')
        : await ask(`Largo real de la línea dibujada (${round(px, 0)} px), en mm:`, '1000');
      return v ? Number(v.replace(',', '.')) : null;
    },
    askLength: (title, cur) => askMm(title, cur),
    firstStroke: () => {
      if (!store.project.sketch.calibrated) toast('Consejo: indica una medida conocida con 📏 Escala o con una Cota para que todo quede en mm.');
    },
    selection: () => renderSel(),
    setSegment: async (id, i) => {
      const sk = store.project.sketch;
      const e = sk.elements.find((x) => x.id === id);
      if (!e || e.kind !== 'poly') return;
      const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length];
      const cur = d2(a, b) * sk.mmPerPx;
      const v = await askMm(sk.calibrated ? 'Largo de este lado (mm):' : 'Largo de este lado (px; calibra la escala para trabajar en mm):', Math.round(cur));
      if (!v) return;
      editor.apply((d) => {
        const x = d.elements.find((y) => y.id === id);
        if (x?.kind === 'poly') x.pts = stretchSegment(x.pts, i, v / d.mmPerPx, x.closed);
      }, 'Medida de lado');
    },
  });

  editor.showProfile = tpl === 'costillas';

  // ---------------------------------------------------------------- barra de la forma seleccionada
  function usedBy(id: string) {
    return (store.project.free?.components ?? []).filter((c) => c.shape === id).map((c) => c.name);
  }
  function renderSel() {
    const id = editor.selected;
    const e = id ? store.project.sketch.elements.find((x) => x.id === id) : undefined;
    selBar.hidden = !e;
    if (!e) return;
    const bb = bounds2(elPoints(e));
    const sil = isSilhouette(e);
    const used = sil ? usedBy(e.id) : [];
    const name = sil ? h('input', { class: 'sk-name', value: (e as { name?: string }).name ?? '', placeholder: 'Nombre de la silueta', 'aria-label': 'Nombre de la silueta',
      onchange: (ev: Event) => editor.apply((d) => { const x = d.elements.find((y) => y.id === e.id) as { name?: string } | undefined; if (x) x.name = (ev.target as HTMLInputElement).value.trim() || undefined; }, 'Nombre') }) : null;
    selBar.replaceChildren(...[
      h('div', { class: 'sk-sel-info' },
        name ?? h('b', null, e.kind === 'dim' ? 'Cota' : e.kind === 'free' ? 'Trazo libre' : 'Línea'),
        h('small', null, e.kind === 'dim' ? `${mm(d2(e.a, e.b))} · tócala de nuevo para cambiar su medida` : `${mm(bb.w)} × ${mm(bb.h)}${sil ? (used.length ? ` · usada en: ${used.join(', ')}` : ' · sin usar en piezas') : ''}`)),
      e.kind === 'poly' && !e.smooth ? h('span', { class: 'sk-hint' }, 'Arrastra los puntos · toca un lado para su medida') : null,
      h('button', { class: 'ghost sm', title: 'Reflejar horizontalmente', onclick: () => editor.apply((d) => { const i = d.elements.findIndex((y) => y.id === e.id); const cx = (bb.x0 + bb.x1) / 2; d.elements[i] = { ...mirrorEl(d.elements[i], cx, e.id) }; }, 'Reflejar') }, 'Reflejar'),
      h('button', { class: 'ghost sm', onclick: () => { const nid = uid('c'); editor.apply((d) => { const x = d.elements.find((y) => y.id === e.id)!; d.elements.push({ ...translateEl(structuredClone(x), 30 / editor.viewScale(), 30 / editor.viewScale()), id: nid }); }, 'Duplicar'); editor.select(nid); } }, 'Duplicar'),
      h('button', { class: 'ghost sm danger', onclick: async () => {
        if (used.length && !(await confirmDialog(`"${(e as { name?: string }).name ?? 'Esta silueta'}" se usa en ${used.join(', ')}. Al borrarla esas piezas vuelven a ser rectángulos. ¿Borrar?`, 'Borrar'))) return;
        editor.apply((d) => { d.elements = d.elements.filter((y) => y.id !== e.id); if (d.profileId === e.id) d.profileId = undefined; }, 'Borrar');
        editor.select(null);
      } }, 'Borrar'),
      h('button', { class: 'ghost sm', 'aria-label': 'Quitar selección', onclick: () => editor.select(null) }, '✕'),
    ].filter(Boolean) as Node[]);
  }

  // ---------------------------------------------------------------- herramientas
  // en iPad no hay "hover": la ayuda de cada herramienta se muestra la primera vez que se elige
  const seenTip = (id: string) => { try { const k = 'trazo:tip:' + id; if (localStorage.getItem(k)) return true; localStorage.setItem(k, '1'); } catch { /* */ } return false; };
  const setTool = (t: ToolDef) => {
    editor.tool = t.id;
    toolBtns.forEach((b, i) => b.classList.toggle('on', tools[i].id === t.id));
    if (t.id !== 'edit') editor.select(null);
    updateStatus();
    if (!seenTip(t.id)) toast(`${t.label}: ${t.tip}`);
  };
  const toolBtns = tools.map((t) => h('button', { class: `tool ${t.id === editor.tool ? 'on' : ''}`, title: t.tip, 'aria-label': `${t.label}: ${t.tip}`, onclick: () => setTool(t) },
    h('span', { class: 'ico' }, t.icon), h('span', { class: 'tl' }, t.label)));

  // ¿esta plantilla usa el boceto? (diseño libre: siluetas de piezas; costillas: perfil)
  const usesSketch = tpl === 'costillas' || tpl === 'libre';
  const notice = usesSketch ? null : h('div', { class: 'sk-notice' },
    h('span', null, h('b', null, `La plantilla "${store.template.name}" no usa el boceto. `), 'Puedes dibujar para pensar y compararlo en Planos. Para que tus siluetas se vuelvan piezas, pasa a diseño libre en Concepto.'),
    h('a', { class: 'btn ghost sm', href: '#/concepto' }, 'Ir a Concepto'));

  const opacity = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(store.project.sketch.underlayOpacity) });
  opacity.addEventListener('input', () => { store.update((p) => { p.sketch.underlayOpacity = Number(opacity.value); }, 'sketch'); editor.render(); });

  async function importUnderlay(files?: File[]) {
    const [f] = files ?? await pickFiles('image/*');
    if (!f) return;
    const img = await readImage(f, 2400);
    store.update((p) => { p.sketch.underlay = img.src; p.sketch.underlaySize = [img.w, img.h]; }, 'sketch');
    editor.fit();
    toast('Imagen importada. Calca encima con el Pencil y calibra la escala 📏');
  }

  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const cb = h('input', { type: 'checkbox', checked: get(), onchange: () => { set(cb.checked); editor.render(); } });
    return h('label', { class: 'mini-toggle' }, cb, label);
  };

  const symToggle = toggle('Simetría (eje vertical)', () => !!store.project.sketch.symmetry?.on, (v) => {
    store.update((p) => { p.sketch.symmetry = { on: v, x: p.sketch.symmetry?.x ?? editor.viewCenter()[0] }; }, 'sketch');
    if (v) toast('Dibuja media silueta empezando y terminando en el eje violeta: se completa sola. Arrastra el eje con Editar.');
  });

  function updateStatus() {
    const sk = store.project.sketch;
    const nSil = Object.keys(store.shapes).length;
    const tool = tools.find((t) => t.id === editor.tool)!;
    status.replaceChildren(...[
      h('span', { class: sk.calibrated ? 'pill ok' : 'pill warn' }, sk.calibrated ? `Escala 1 px = ${round(sk.mmPerPx, 3)} mm` : 'Sin escala — usa 📏 o una cota'),
      h('span', { class: nSil ? 'pill ok' : 'pill' }, nSil ? `${nSil} silueta${nSil > 1 ? 's' : ''}` : 'Sin siluetas'),
      tpl === 'costillas' ? h('span', { class: sk.profileId ? 'pill ok' : 'pill' }, sk.profileId ? 'Perfil de costilla elegido' : 'Elige el perfil con ◎') : null,
      h('span', { class: 'muted' }, tool.tip)].filter(Boolean) as Node[]);
  }
  updateStatus();

  const onPaste = (e: ClipboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input,textarea')) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); importUnderlay(files); }
  };
  document.addEventListener('paste', onPaste);
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); importUnderlay([...(e.dataTransfer?.files ?? [])]); });

  const howTo = tpl === 'costillas'
    ? 'Dibuja la silueta lateral cerrada y márcala con ◎ "Usar como perfil": se repite como costillas.'
    : 'Cada forma cerrada es una silueta: asígnala a una pieza en Modelo 3D → Piezas → Forma. Lo que dibujes dentro de una silueta se vuelve calado. La silueta se estira al ancho y alto de la pieza.';

  root.append(h('div', { class: 'page sketch' },
    h('div', { class: 'toolbar' }, ...toolBtns,
      h('span', { class: 'sep' }),
      h('button', { class: 'tool', onclick: () => editor.undo(), title: 'Deshacer (⌘Z)' }, h('span', { class: 'ico' }, '↶'), h('span', { class: 'tl' }, 'Deshacer')),
      h('button', { class: 'tool', onclick: () => editor.redo(), title: 'Rehacer' }, h('span', { class: 'ico' }, '↷'), h('span', { class: 'tl' }, 'Rehacer')),
      h('button', { class: 'tool', onclick: () => editor.fit(), title: 'Encuadrar' }, h('span', { class: 'ico' }, '⤢'), h('span', { class: 'tl' }, 'Encuadrar')),
      nextStep('boceto', store.project.sketch.elements.length && !store.project.sketch.calibrated ? 'Aún no calibras la escala' : undefined, true)),
    notice,
    h('div', { class: 'sketch-body' }, h('div', { class: 'stage-wrap' }, stage, selBar),
      h('aside', { class: 'side' },
        h('h4', null, 'Siluetas'),
        h('p', { class: 'muted' }, howTo),
        h('button', { class: 'ghost', onclick: async () => {
          const w = await askMm('Ancho del rectángulo (mm):', 600); if (!w) return;
          const hh = await askMm('Alto del rectángulo (mm):', 400); if (!hh) return;
          if (!store.project.sketch.calibrated) toast('Sin escala calibrada: se asume 1 px = 1 mm.');
          setTool(tools.find((t) => t.id === 'edit')!);
          editor.addRect(w, hh);
        } }, '▭ Rectángulo con medidas'),
        symToggle,
        h('h4', null, 'Imagen de calco'),
        h('p', { class: 'muted' }, 'Desde Procreate, Concepts o Morpholio: exporta PNG/JPG o copia y pega (⌘V).'),
        h('button', { class: 'ghost', onclick: () => importUnderlay() }, 'Importar imagen'),
        h('label', { class: 'field' }, 'Opacidad de la imagen', opacity),
        store.project.sketch.underlay ? h('button', { class: 'ghost', onclick: () => { store.update((p) => { p.sketch.underlay = undefined; p.sketch.underlaySize = undefined; }, 'sketch'); editor.render(); } }, 'Quitar imagen') : null,
        h('h4', null, 'Asistencia'),
        toggle('Dibujar con el dedo', () => editor.fingerDraws, (v) => { editor.fingerDraws = v; }),
        toggle('Imantar ángulos (0/45/90°)', () => editor.snapAngle, (v) => { editor.snapAngle = v; }),
        toggle('Mostrar medidas', () => editor.showLengths, (v) => { editor.showLengths = v; }),
        h('h4', null, 'Exportar boceto'),
        h('div', { class: 'row wrap' },
          h('button', { class: 'ghost', onclick: () => download(editor.toSVG(), `${slug(store.project.name)}-boceto.svg`, 'image/svg+xml') }, 'SVG'),
          h('button', { class: 'ghost', onclick: () => download(sketchDxf(store.project.sketch), `${slug(store.project.name)}-boceto.dxf`, 'application/dxf') }, 'DXF (mm)')),
        h('button', { class: 'ghost danger', onclick: async () => { if (await confirmDialog('¿Borrar todos los trazos del lienzo? Podrás deshacerlo.', 'Borrar')) editor.clear(); } }, 'Limpiar lienzo'))),
    status));
  (window as unknown as { __trazoSketch?: SketchEditor }).__trazoSketch = editor; // ayuda para pruebas automáticas
  requestAnimationFrame(() => editor.fit());
  return () => { editor.destroy(); document.removeEventListener('paste', onPaste); };
}
