// Panel 2D de la pieza seleccionada, junto al 3D (Modelo → "2D | 3D").
// La silueta se muestra a escala real (mm de la pieza). Lo que se dibuja con el Pencil cambia la pieza
// y el 3D al instante; si el contorno se sale de su caja, la pieza crece (ancho/alto y posición).
import { applyDrag, type DragOp, type DragResult, type Field } from '../core/direct';
import { shapeChildren, type Component } from '../core/free';
import { bounds2, uid } from '../core/geom';
import { ghosts, isRealScale, pieceMap, realScaleElements, toPx, type PieceMap } from '../core/pieceview';
import { store } from '../core/store';
import type { Part, SketchEl, V2 } from '../core/types';
import { SketchEditor } from '../sketch/editor';
import { h, toast } from '../ui';
import { forkShape } from './free-editor';

const AXES: Record<Component['orient'], { u: Field; v: Field }> = { XZ: { u: 'x', v: 'z' }, YZ: { u: 'y', v: 'z' }, XY: { u: 'x', v: 'y' } };
type Mode = 'edit' | 'outline' | 'holes';

export interface Piece2DHooks {
  /** Vista previa en 3D sin guardar (mismo mecanismo que el arrastre en 3D). */
  preview(design: NonNullable<typeof store.project.free>, values: typeof store.project.values): void;
  /** Se guardó un cambio (boceto y/o medidas de la pieza): refrescar 3D y fichas. */
  changed(): void;
  /** Antes de un cambio de medidas (para deshacer en el Modelo). */
  remember(): void;
}

export interface Piece2D { el: HTMLElement; show(compId: string | null): void; refresh(): void; destroy(): void }

export function piece2d(hooks: Piece2DHooks): Piece2D {
  const stage = h('div', { class: 'p2d-stage' });
  const head = h('div', { class: 'p2d-head' });
  const empty = h('div', { class: 'p2d-empty' }, 'Toca una pieza en el 3D para dibujarla aquí a escala real.');
  const el = h('div', { class: 'p2d' }, head, stage, empty);
  let compId: string | null = null;
  let shapeId: string | null = null;
  let mode: Mode = 'edit';
  let ghostPx: { name: string; pts: V2[]; ref: boolean }[] = [];
  /** Elementos creados mientras se dibuja esta pieza (siguen editables aunque queden fuera de la silueta). */
  let created = new Set<string>();
  let known = new Set<string>();

  const comp = () => (compId ? store.project.free?.components.find((c) => c.id === compId) ?? null : null);
  const partOf = (parts = store.parts()) => parts.find((p) => p.source?.comp === compId && p.source.i === 0) ?? null;

  const editor = new SketchEditor(stage, {
    doc: () => store.project.sketch,
    change: (fn) => {
      store.update((p) => fn(p.sketch), 'sketch');
      for (const e of store.project.sketch.elements) if (!known.has(e.id)) { created.add(e.id); known.add(e.id); }
      afterSketchChange(true);
    },
    askScale: async () => null,
    protectedIds: () => new Set(shapeId ? [shapeId] : []),
    notify: (m) => toast(m),
    ghosts: () => ghostPx,
    scope: () => (shapeId ? new Set([shapeId, ...shapeChildren(store.project.sketch, shapeId), ...created]) : new Set()),
    live: () => { const r = sizeChange(); if (r) hooks.preview(r.design, r.values); else hooks.preview(store.project.free!, store.project.values); },
  });
  editor.showUnderlay = false;
  editor.forceMm = true;
  editor.showProfile = false;

  /** Si la silueta dibujada ya no coincide con la caja de la pieza, cambio de medidas/posición que la hace coincidir. */
  function sizeChange(): DragResult | null {
    const c = comp(), p = partOf();
    if (!c || !p || !shapeId || !store.project.free) return null;
    const m = map ?? pieceMap(store.project.sketch, shapeId, p);
    const e = store.project.sketch.elements.find((x) => x.id === shapeId);
    if (!m || !e || (e.kind !== 'poly' && e.kind !== 'circle')) return null;
    const pts = e.kind === 'circle' ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] as V2[] : e.pts;
    const bb = bounds2(pts), pb = bounds2(p.curves?.outline ?? p.profile), k = m.k;
    const left = (bb.x0 - m.x0) * k, right = m.u0 + (bb.x1 - m.x0) * k - pb.x1;
    const top = (m.y0 - bb.y0) * k, bottom = pb.y0 - (m.v1 - (bb.y1 - m.y0) * k);
    const r = (n: number) => Math.round(n);
    const dw = r(right - left), dh = r(top + bottom);
    if (Math.abs(dw) < 0.5 && Math.abs(dh) < 0.5 && Math.abs(left) < 0.5 && Math.abs(bottom) < 0.5) return null;
    const ax = AXES[c.orient];
    const ops: DragOp[] = [];
    if (Math.abs(dw) >= 0.5) ops.push({ field: 'w', delta: dw });
    if (Math.abs(left) >= 0.5) ops.push({ field: ax.u, delta: r(left) });
    if (Math.abs(dh) >= 0.5) ops.push({ field: 'h', delta: dh });
    if (Math.abs(bottom) >= 0.5) ops.push({ field: ax.v, delta: -r(bottom) });
    return applyDrag(store.project.free, store.project.values, store.params, c.id, ops, false, { fine: true });
  }

  let map: PieceMap | null = null;
  /** Tras un cambio en el dibujo: ajustar medidas de la pieza si el contorno cambió de tamaño, y refrescar. */
  function afterSketchChange(save: boolean) {
    const r = save ? sizeChange() : null;
    if (r) {
      hooks.remember();
      store.update((p) => { p.free = r.design; p.values = r.values; }, 'free');
      if (r.notes.length) toast(r.notes.join(' · '));
    }
    hooks.changed();
  }

  /** Lleva la silueta a escala real si hace falta, calcula guías y encuadra. */
  function sync(fit: boolean) {
    const c = comp();
    const p = partOf();
    if (!c || !p || !shapeId) return;
    if (!isRealScale(store.project.sketch, shapeId, p)) {
      const els = realScaleElements(store.project.sketch, shapeId, p, c.holes);
      if (els) store.update((x) => { for (const e of els) { const i = x.sketch.elements.findIndex((y) => y.id === e.id); if (i >= 0) x.sketch.elements[i] = e; } }, 'sketch');
      fit = true;
    }
    map = pieceMap(store.project.sketch, shapeId, p);
    const parts = store.parts();
    ghostPx = map ? ghosts(p, parts).map((g) => ({ ...g, pts: g.pts.map((q) => toPx(map!, q)) })) : [];
    if (fit) editor.fitTo(shapeId); else editor.render();
  }

  /** Pieza rectangular: se crea su silueta (rectángulo a escala real) para poder dibujarla. */
  function ensureShape(c: Component, p: Part): string {
    if (c.shape !== 'rect' && store.shapes[c.shape]) return c.shape;
    const b = bounds2(p.profile), k = store.project.sketch.mmPerPx || 1;
    const id = uid('sil-');
    store.update((x) => {
      const pts: V2[] = x.sketch.elements.flatMap((e) => (e.kind === 'circle' ? [e.c] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
      const ox = pts.length ? bounds2(pts).x1 + 200 : 80, oy = pts.length ? bounds2(pts).y0 : 80;
      x.sketch.elements.push({ id, kind: 'poly', closed: true, name: c.name, pts: [[ox, oy], [ox + b.w / k, oy], [ox + b.w / k, oy + b.h / k], [ox, oy + b.h / k]] } as SketchEl);
      const cc = x.free!.components.find((y) => y.id === c.id)!;
      cc.shape = id; cc.holes = true;
    }, 'free');
    return id;
  }

  function setMode(m: Mode) {
    mode = m;
    editor.tool = m === 'edit' ? 'edit' : 'smart';
    editor.outlineTarget = m === 'outline' ? shapeId : null;
    if (m !== 'edit') editor.select(null);
    renderHead();
  }

  const TIPS: Record<Mode, string> = {
    edit: 'Arrastra los puntos con el Pencil; con los dedos mueves y haces zoom.',
    outline: 'Dibuja la forma cerrada completa: reemplaza el contorno (a escala real).',
    holes: 'Dibuja formas cerradas dentro de la pieza: se cortan como calados.',
  };
  function renderHead() {
    const c = comp();
    if (!c) { head.replaceChildren(); return; }
    const p = partOf();
    const b = p ? bounds2(p.profile) : null;
    const sharing = (store.project.free?.components ?? []).filter((x) => x.id !== c.id && x.shape === c.shape && c.shape !== 'rect');
    head.replaceChildren(...[
      sharing.length ? h('div', { class: 'p2d-shared' }, `Forma compartida con ${sharing.map((x) => `«${x.name}»`).join(', ')}: lo que dibujes cambia ${sharing.length > 1 ? 'todas' : 'ambas'}.`,
        h('button', { class: 'ghost sm', onclick: () => { forkShape(c.id); show(c.id); hooks.changed(); toast(`«${c.name}» tiene ahora su propia forma.`); } }, 'Solo esta pieza')) : null,
      h('div', { class: 'p2d-info' }, h('b', null, c.name), h('small', null, b ? `${Math.round(b.w)} × ${Math.round(b.h)} mm · ${TIPS[mode]}` : TIPS[mode])),
      h('div', { class: 'seg' }, ...([['edit', 'Mover puntos'], ['outline', 'Redibujar'], ['holes', 'Calados']] as const).map(([k, l]) =>
        h('button', { class: `seg-btn ${mode === k ? 'on' : ''}`, onclick: () => setMode(k) }, l))),
      h('button', { class: 'ghost sm', title: 'Deshacer en 2D', 'aria-label': 'Deshacer en 2D', onclick: () => editor.undo() }, '↶'),
      h('button', { class: 'ghost sm', title: 'Encuadrar', 'aria-label': 'Encuadrar', onclick: () => shapeId && editor.fitTo(shapeId) }, '⤢')].filter(Boolean) as Node[]);
  }

  function show(id: string | null) {
    compId = id;
    const c = comp();
    const p = c ? partOf() : null;
    const ok = !!(c && p && c.kind !== 'ref');
    empty.hidden = ok;
    stage.hidden = !ok;
    empty.textContent = c?.kind === 'ref' ? 'El volumen de referencia no se dibuja: elige una pieza.' : 'Toca una pieza en el 3D para dibujarla aquí a escala real.';
    if (!ok) { shapeId = null; editor.focusId = null; head.replaceChildren(); return; }
    shapeId = ensureShape(c!, p!);
    created = new Set(); known = new Set(store.project.sketch.elements.map((e) => e.id));
    editor.focusId = shapeId;
    setMode(mode);
    requestAnimationFrame(() => sync(true));
  }

  return {
    el, show,
    refresh: () => { if (shapeId && comp()) { sync(false); renderHead(); } else if (compId) show(compId); },
    destroy: () => editor.destroy(),
  };
}
