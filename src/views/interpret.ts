// "Crear diseño desde una imagen": Claude interpreta la referencia y propone un diseño libre editable.
// Funciona donde la página puede consultar a Claude (enlace de claude.ai, capacidad `sample` con imágenes);
// en la app instalada el botón no aparece.
import { addReference, freeParams } from '../core/free';
import { bounds2 } from '../core/geom';
import { buildPrompt, sanitizeProposal, type Proposal } from '../core/proposal';
import { fieldValue } from '../core/simple';
import { store } from '../core/store';
import type { RefImage, SketchEl, V2 } from '../core/types';
import { h, parseMm } from '../ui';
import { replaceDesign } from './design-change';

type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: (input: string, opts?: Record<string, unknown>) => Promise<unknown>;
  limits: () => Promise<{ images?: { maxCount: number; mediaTypes: string[] } }>;
};

let samplePromise: Promise<SampleFn | null> | null = null;
/** La función de Claude con imágenes, o null si esta vista no puede usarla. */
export function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const c = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    samplePromise = !c ? Promise.resolve(null) : c.use('sample').then(async (s) => {
      if (!s) return null;
      const fn = s as SampleFn;
      const lim = await fn.limits().catch(() => null);
      return lim?.images ? fn : null;
    }).catch(() => null);
  }
  return samplePromise;
}

function dataUrlToBlob(src: string): Blob {
  const [head, b64] = src.split(',');
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const imageSize = (src: string) => new Promise<V2>((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([1000, 800]); i.src = src; });

const ERRORS: Record<string, string> = {
  not_granted: 'No diste permiso para consultar a Claude desde esta página. Puedes activarlo en el menú de permisos del artefacto.',
  sampling_disabled: 'Claude no está disponible para esta cuenta.',
  rate_limited: 'Se alcanzó el límite de uso por ahora. Intenta más tarde.',
  image_rejected: 'La imagen no se pudo enviar (formato o tamaño). Prueba con otra.',
  invalid_json: 'La respuesta no vino en el formato esperado. Puedes intentarlo de nuevo.',
  refused: 'Claude no quiso procesar esta imagen. Prueba con otra referencia.',
  session_expired: 'Tu sesión expiró: vuelve a iniciar sesión en claude.ai.',
  images_unavailable: 'Esta vista no puede enviar imágenes a Claude.',
};

/** Aplica la propuesta al proyecto: diseño libre, siluetas en el boceto y, si se pide, la foto como calco. */
async function applyProposal(p: Proposal, ref: RefImage, useUnderlay: boolean) {
  const size = useUnderlay ? await imageSize(ref.src) : null;
  return replaceDesign('Crear el diseño desde la imagen', (pr) => {
    pr.template = 'libre';
    pr.rules = {};
    pr.free = p.design;
    pr.values = Object.fromEntries(freeParams(p.design).map((d) => [d.key, d.default]));
    if (!pr.name || /^Nuevo producto/.test(pr.name)) pr.name = p.name;
    if (!pr.description && p.summary) pr.description = p.summary;
    // siluetas al boceto, con el tamaño de la primera pieza que las usa (boceto vacío: 1 px = 1 mm, ya calibrado)
    if (!pr.sketch.calibrated && !pr.sketch.elements.length) { pr.sketch.mmPerPx = 1; pr.sketch.calibrated = true; }
    const k = pr.sketch.mmPerPx || 1;
    const pts: V2[] = pr.sketch.elements.flatMap((e) => (e.kind === 'circle' ? [e.c] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
    let ox = pts.length ? bounds2(pts).x1 + 120 : 80;
    const oy = 80;
    const els: SketchEl[] = [];
    for (const s of p.silhouettes) {
      const comp = p.design.components.find((c) => c.shape === s.id);
      const w = comp ? fieldValue(comp, 'w', pr.values) : 600, hh = comp ? fieldValue(comp, 'h', pr.values) : 600;
      const W = (Number.isFinite(w) && w > 0 ? w : 600) / k, H = (Number.isFinite(hh) && hh > 0 ? hh : 600) / k;
      const map = (pl: V2[]) => pl.map(([u, v]) => [ox + u * W, oy + (1 - v) * H] as V2);
      els.push({ id: s.id, kind: 'poly', closed: true, smooth: s.outline.length > 8, name: s.name, pts: map(s.outline) });
      s.holes.forEach((hl, j) => els.push({ id: `${s.id}-c${j + 1}`, kind: 'poly', closed: true, smooth: hl.length > 8, pts: map(hl) }));
      ox += W + 120;
    }
    pr.sketch.elements.push(...els);
    if (useUnderlay && size && !pr.sketch.underlay) { pr.sketch.underlay = ref.src; pr.sketch.underlaySize = size; pr.sketch.underlayOpacity = 0.35; }
  }, `Diseño creado desde la imagen: ${p.design.components.length} piezas. Revisa los supuestos.`);
}

/** Abre el asistente. `refs` = imágenes del concepto; `start` = la elegida al abrir. */
export async function openInterpret(refs: RefImage[], start = 0, done?: () => void) {
  const sample = await getSample();
  let idx = Math.min(start, refs.length - 1);
  const close = () => { ctl?.abort(); wrap.remove(); };
  let ctl: AbortController | null = null;

  const body = h('div', { class: 'ai-body' });
  const wrap = h('div', { class: 'welcome-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Crear diseño desde una imagen' },
    h('div', { class: 'welcome ai' },
      h('div', { class: 'wl-head' },
        h('div', null, h('h2', null, '✦ Crear diseño desde una imagen'), h('p', { class: 'muted' }, 'Claude mira tu referencia y propone piezas, medidas y siluetas. Es un punto de partida: después lo editas a mano.')),
        h('button', { class: 'ghost', 'aria-label': 'Cerrar', onclick: close }, '✕')),
      body));
  document.body.appendChild(wrap);

  if (!sample) {
    body.replaceChildren(h('p', null, 'Esta función usa Claude y está disponible al abrir Trazo desde su enlace en claude.ai. En la app instalada se agregará más adelante.'),
      h('button', { onclick: close }, 'Entendido'));
    return;
  }

  const known = h('input', { id: 'ai-known', placeholder: 'Ej: la cama mide 106 cm de ancho', enterkeyhint: 'next' });
  const focus = h('textarea', { id: 'ai-focus', rows: 2, placeholder: 'Ej: solo el respaldo y la baranda; sin cajones' });
  const under = h('input', { type: 'checkbox', checked: true, id: 'ai-under' });
  // mueble u objeto existente al que se adapta el diseño (p. ej. la cama nido): volumen de referencia exacto
  const exName = h('input', { id: 'ai-ex-name', placeholder: 'Ej: Cama nido plaza y media' });
  const exL = h('input', { id: 'ai-ex-l', inputmode: 'decimal', placeholder: 'Largo (ej: 200 cm)' });
  const exA = h('input', { id: 'ai-ex-a', inputmode: 'decimal', placeholder: 'Ancho (ej: 106 cm)' });
  const exH = h('input', { id: 'ai-ex-h', inputmode: 'decimal', placeholder: 'Alto (ej: 45 cm)' });
  const existing = () => {
    const l = parseMm(exL.value), a = parseMm(exA.value), hh = parseMm(exH.value);
    return [l, a, hh].every((n) => Number.isFinite(n) && n > 0) ? { name: exName.value.trim() || 'Mueble existente', largo: l, ancho: a, alto: hh } : undefined;
  };

  function form() {
    const thumbs = h('div', { class: 'ai-thumbs' }, ...refs.map((r, i) => h('button', { class: `ai-thumb ${i === idx ? 'on' : ''}`, 'aria-label': `Imagen ${i + 1}`, onclick: () => { idx = i; form(); } }, h('img', { src: r.src, alt: '' }))));
    body.replaceChildren(...[
      refs.length > 1 ? thumbs : null,
      h('img', { class: 'ai-preview', src: refs[idx].src, alt: 'Imagen de referencia' }),
      h('label', { class: 'field' }, 'Una medida que conozcas (recomendado)', known),
      h('label', { class: 'field' }, '¿Qué tomar de la imagen? (opcional)', focus),
      h('details', { class: 'ai-existing', open: !!(exL.value || exA.value) },
        h('summary', null, '¿Es para un mueble existente? (opcional)'),
        h('p', { class: 'muted small' }, 'Se agrega como volumen de referencia con tus medidas exactas y el diseño se adapta a él. Acepta mm, cm o m.'),
        h('label', { class: 'field' }, 'Nombre', exName),
        h('div', { class: 'grid3' }, exL, exA, exH)),
      h('label', { class: 'mini-toggle' }, under, 'Usar la imagen como calco en el Boceto'),
      h('p', { class: 'muted' }, 'Usa tu cuenta de Claude; la primera vez te pedirá permiso. Suele tardar entre 30 segundos y 2 minutos.'),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: close }, 'Cancelar'), h('button', { onclick: run }, 'Crear diseño'))].filter(Boolean) as Node[]);
  }

  async function run() {
    const ex = existing();
    ctl = new AbortController();
    const t0 = Date.now();
    const status = h('p', { class: 'muted' }, 'Mirando la imagen…');
    const timer = window.setInterval(() => { status.textContent = `Mirando la imagen y armando las piezas… ${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
    body.replaceChildren(h('div', { class: 'ai-wait' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), status),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => ctl?.abort() }, 'Detener')));
    try {
      const raw = await sample!.json(buildPrompt({
        known: known.value.trim() || undefined, focus: focus.value.trim() || undefined,
        description: store.project.description, functions: store.project.functions, thickness: Number(store.values.t) || 18, existing: ex,
      }), { images: [dataUrlToBlob(refs[idx].src)], signal: ctl.signal, modelTier: 'default' });
      const base = ex ? addReference({ params: [], components: [] }, ex.name, ex.largo, ex.ancho, ex.alto) : undefined;
      result(sanitizeProposal(raw, Number(store.values.t) || 18, base));
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'upstream_error';
      if (code === 'cancelled') { form(); return; }
      body.replaceChildren(h('p', { class: 'chk error' }, ERRORS[code] ?? 'No se pudo completar. Puedes intentarlo de nuevo.'),
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: close }, 'Cerrar'), h('button', { onclick: form }, 'Volver')));
    } finally { window.clearInterval(timer); }
  }

  function result(p: Proposal) {
    const groups = new Map<string, number>();
    for (const c of p.design.components) groups.set(c.name, (groups.get(c.name) ?? 0) + 1);
    body.replaceChildren(...[
      h('h3', null, p.name),
      p.summary ? h('p', null, p.summary) : null,
      h('div', { class: 'ai-cols' },
        h('div', null, h('b', null, `Piezas (${p.design.components.length})`), h('ul', null, ...p.design.components.map((c) => h('li', null, c.name, c.count.trim() !== '1' ? h('span', { class: 'muted' }, ` · repetida`) : null, c.kind === 'ref' ? h('span', { class: 'muted' }, ' · referencia') : null)))),
        h('div', null, h('b', null, `Medidas que podrás cambiar (${p.design.params.length})`), h('ul', null, ...p.design.params.map((q) => h('li', null, q.label, q.type === 'bool' ? h('span', { class: 'muted' }, ' · sí/no') : h('span', { class: 'muted' }, ` · ${q.default} mm`)))))),
      p.silhouettes.length ? h('p', null, h('b', null, 'Siluetas: '), p.silhouettes.map((s) => s.name).join(', '), h('span', { class: 'muted' }, ' (quedan en el Boceto para redibujarlas a mano)')) : null,
      p.assumptions.length ? h('div', { class: 'ai-assume' }, h('b', null, 'Supuestos a revisar'), h('ul', null, ...p.assumptions.map((a) => h('li', null, a)))) : null,
      p.issues.length ? h('details', { class: 'ai-issues' }, h('summary', null, `${p.issues.length} detalle(s) que no se pudieron usar tal cual`), h('ul', null, ...p.issues.map((m) => h('li', null, m)))) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'ghost', onclick: form }, 'Probar de nuevo'),
        h('button', { disabled: !p.design.components.length, onclick: async () => {
          wrap.remove();
          if (await applyProposal(p, refs[idx], under.checked)) { done?.(); location.hash = '#/modelo'; }
        } }, 'Aplicar al proyecto'))].filter(Boolean) as Node[]);
  }

  form();
}
