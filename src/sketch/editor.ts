import { sampleLoop } from '../core/curve';
import { segAnchor, solve, suggest, targetMm, validConstraints, type Constraint } from '../core/constraints';
import type { ParamValues } from '../core/types';
import { d2, round, uid } from '../core/geom';
import type { SketchDoc, SketchEl, V2 } from '../core/types';
import { distToEl, fitStroke, mergeCollinear, pointInPoly, snapPoints } from './fit';
import { mirrorClose, mirrorEl, segmentAt, translateEl, vertexAt } from './ops';

/** Curvas suaves con pocos puntos de paso muestran manillas para editarlas. */
const SMOOTH_HANDLES = 60;
/** Puntos a dibujar: la curva suave muestreada o la polilínea tal cual. */
const trace = (e: { pts: V2[]; kind: string; closed?: boolean; smooth?: boolean }): V2[] =>
  e.kind === 'poly' && e.smooth && e.pts.length > 2 ? sampleLoop(e.pts, !!e.closed, 12, 3) : e.pts;

export type Tool = 'smart' | 'edit' | 'free' | 'dim' | 'scale' | 'erase' | 'pick' | 'pan';

export interface EditorHooks {
  doc(): SketchDoc;
  change(fn: (d: SketchDoc) => void, reason: string): void;
  askScale(px: number, fromDim?: boolean): Promise<number | null>;
  /** Primer trazo del lienzo (para sugerir calibrar la escala). */
  firstStroke?(): void;
  /** Cambió el elemento seleccionado (herramienta Editar). */
  selection?(el: SketchEl | null): void;
  /** Pide un largo en mm (tocar un lado o una cota). Devuelve null si se cancela. */
  askLength?(title: string, current: number): Promise<number | null>;
  /** Se tocó un lado de la forma seleccionada (o null al soltarlo): la vista muestra las restricciones del lado. */
  setSegment?(id: string, index: number): void;
  /** Siluetas usadas por piezas: la goma no las borra (se borran desde Editar, con aviso). */
  protectedIds?(): Set<string>;
  /** Mensajes breves al usuario. */
  notify?(msg: string): void;
  /** Vista 2D de una pieza: piezas vecinas proyectadas (px del boceto), solo de referencia. */
  ghosts?(): { name: string; pts: V2[]; ref: boolean }[];
  /** Elementos editables (los demás se ven tenues y no se tocan). null = todos. */
  scope?(): Set<string> | null;
  /** Durante un arrastre (el documento ya cambió, sin guardar): para actualizar el 3D en vivo. */
  live?(): void;
  /** Valores del producto (cotas ligadas a parámetros). */
  values?(): ParamValues;
}

type EditDrag = { mode: 'vertex' | 'move' | 'radius' | 'axis'; id: string; index: number; start: V2; before: SketchEl[]; axis0: number; moved: boolean; hitSeg: number };

/**
 * Lienzo vectorial pensado para Apple Pencil:
 * - El lápiz dibuja; los dedos desplazan y hacen zoom (rechazo de palma).
 * - Con mouse: clic izquierdo dibuja, rueda hace zoom, botón central/espacio desplaza.
 */
export class SketchEditor {
  canvas = document.createElement('canvas');
  tool: Tool = 'smart';
  fingerDraws = false;
  snapAngle = true;
  showLengths = true;
  /** Resaltar en naranjo la silueta usada como perfil (solo plantilla Costillas). */
  showProfile = true;
  /** Silueta en edición ("Dibujar en la pieza"): se resalta. */
  focusId: string | null = null;
  /** Si está definido, la próxima forma cerrada reemplaza el contorno de esta silueta (conserva id y nombre). */
  outlineTarget: string | null = null;
  private ctx = this.canvas.getContext('2d')!;
  private view = { x: 40, y: 40, s: 1 };
  private stroke: V2[] | null = null;
  private pressures: number[] = [];
  private touches = new Map<number, V2>();
  private pinch: { d: number; c: V2; view: { x: number; y: number; s: number } } | null = null;
  private img: HTMLImageElement | null = null;
  private imgSrc = '';
  private undoStack: SketchEl[][] = [];
  private redoStack: SketchEl[][] = [];
  private ro: ResizeObserver;
  private spaceDown = false;
  private panStart: { p: V2; view: { x: number; y: number; s: number } } | null = null;
  /** Elemento seleccionado con la herramienta Editar. */
  selected: string | null = null;
  /** Lado seleccionado (para restricciones y cotas). */
  selSeg: { id: string; i: number } | null = null;
  /** Mostrar restricciones y cotas. */
  showConstraints = true;
  private drag: EditDrag | null = null;
  private warnedProtected = false;
  /** Mostrar la imagen de calco (en la vista 2D de pieza se oculta). */
  showUnderlay = true;
  /** Medidas siempre en mm (vista 2D de pieza: la silueta está a escala real). */
  forceMm = false;
  private liveRaf = 0;
  private inScope(e: SketchEl) { const sc = this.hooks.scope?.(); return !sc || sc.has(e.id); }

  constructor(private host: HTMLElement, private hooks: EditorHooks) {
    this.canvas.className = 'sketch-canvas';
    this.canvas.style.touchAction = 'none';
    host.appendChild(this.canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.up(e, true));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt([e.offsetX, e.offsetY], Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.resize();
  }

  destroy() { this.ro.disconnect(); window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp); this.canvas.remove(); }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input,textarea')) return;
    if (e.code === 'Space') this.spaceDown = true;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
  };
  private onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') this.spaceDown = false; };

  resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.max(1, r.width * dpr); this.canvas.height = Math.max(1, r.height * dpr);
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    this.render();
  }

  private toWorld([x, y]: V2): V2 { return [(x - this.view.x) / this.view.s, (y - this.view.y) / this.view.s]; }
  private local(e: PointerEvent): V2 { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  private zoomAt(p: V2, f: number) {
    const w = this.toWorld(p);
    this.view.s = Math.min(20, Math.max(0.05, this.view.s * f));
    this.view.x = p[0] - w[0] * this.view.s; this.view.y = p[1] - w[1] * this.view.s;
    this.render();
  }

  /** Encuadra un elemento (silueta en edición). */
  fitTo(id: string) {
    const e = this.hooks.doc().elements.find((x) => x.id === id);
    if (!e) return this.fit();
    const pts: V2[] = e.kind === 'circle' ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] : e.kind === 'dim' ? [e.a, e.b] : e.pts;
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const r = this.host.getBoundingClientRect();
    const s = Math.min((r.width - 120) / (x1 - x0 || 1), (r.height - 160) / (y1 - y0 || 1), 8);
    this.view = { s, x: r.width / 2 - ((x0 + x1) / 2) * s, y: r.height / 2 - ((y0 + y1) / 2) * s + 30 };
    this.render();
  }

  fit() {
    const d = this.hooks.doc();
    const pts: V2[] = d.elements.flatMap((e) => (e.kind === 'circle' ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] as V2[] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
    if (d.underlaySize) pts.push([0, 0], d.underlaySize);
    if (!pts.length) { this.view = { x: 40, y: 40, s: 1 }; this.render(); return; }
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const r = this.host.getBoundingClientRect();
    const s = Math.min((r.width - 60) / (x1 - x0 || 1), (r.height - 60) / (y1 - y0 || 1), 8);
    this.view = { s, x: r.width / 2 - ((x0 + x1) / 2) * s, y: r.height / 2 - ((y0 + y1) / 2) * s };
    this.render();
  }

  private isDrawPointer(e: PointerEvent) { return e.pointerType === 'pen' || e.pointerType === 'mouse' || this.fingerDraws; }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    if (e.pointerType === 'touch' && !this.fingerDraws) {
      this.touches.set(e.pointerId, p);
      this.startGesture();
      return;
    }
    if (this.tool === 'pan' || e.button === 1 || this.spaceDown) { this.panStart = { p, view: { ...this.view } }; return; }
    if (!this.isDrawPointer(e) || e.button > 0) return;
    const w = this.toWorld(p);
    if (this.tool === 'edit') { this.editDown(w); return; }
    if (this.tool === 'erase') { this.eraseAt(w); this.stroke = []; return; }
    if (this.tool === 'pick') { this.pickAt(w); return; }
    this.stroke = [w];
    this.pressures = [e.pressure || 0.5];
  }

  private startGesture() {
    const pts = [...this.touches.values()];
    if (pts.length === 1) { this.panStart = { p: pts[0], view: { ...this.view } }; this.pinch = null; }
    if (pts.length >= 2) {
      const [a, b] = pts;
      this.pinch = { d: d2(a, b), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: { ...this.view } };
      this.panStart = null;
    }
  }

  private move(e: PointerEvent) {
    const p = this.local(e);
    if (this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, p);
      const pts = [...this.touches.values()];
      if (this.pinch && pts.length >= 2) {
        const [a, b] = pts;
        const c: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const f = d2(a, b) / this.pinch.d;
        const v = this.pinch.view;
        const s = Math.min(20, Math.max(0.05, v.s * f));
        const wx = (this.pinch.c[0] - v.x) / v.s, wy = (this.pinch.c[1] - v.y) / v.s;
        this.view = { s, x: c[0] - wx * s, y: c[1] - wy * s };
        this.render();
      } else if (this.panStart) this.doPan(p);
      return;
    }
    if (this.panStart) { this.doPan(p); return; }
    if (this.drag) { this.editMove(this.toWorld(p)); return; }
    if (!this.stroke) return;
    const evs = (e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }).getCoalescedEvents?.() ?? [e];
    for (const ev of evs) {
      const w = this.toWorld(this.local(ev));
      if (this.tool === 'erase') { this.eraseAt(w); continue; }
      const last = this.stroke[this.stroke.length - 1];
      if (!last || d2(last, w) > 0.6 / this.view.s) { this.stroke.push(w); this.pressures.push(ev.pressure || 0.5); }
    }
    this.render();
  }

  private doPan(p: V2) {
    const s = this.panStart!;
    this.view = { ...s.view, x: s.view.x + p[0] - s.p[0], y: s.view.y + p[1] - s.p[1] };
    this.render();
  }

  private async up(e: PointerEvent, cancel = false) {
    if (this.touches.has(e.pointerId)) { this.touches.delete(e.pointerId); this.startGesture(); if (!this.touches.size) this.panStart = null; return; }
    if (this.panStart) { this.panStart = null; return; }
    if (this.drag) { await this.editUp(cancel); return; }
    const stroke = this.stroke; this.stroke = null;
    if (!stroke || cancel || this.tool === 'erase') { this.render(); return; }
    const doc = this.hooks.doc();
    const tolPx = 14 / this.view.s;
    const sym = doc.symmetry?.on ? doc.symmetry.x : null;
    if (this.tool === 'free') {
      if (stroke.length > 1) this.commit((d) => {
        const el: SketchEl = { id: uid('f'), kind: 'free', pts: stroke };
        d.elements.push(el);
        if (sym !== null) d.elements.push(mirrorEl(el, sym, uid('f')));
      }, 'Trazo libre');
    } else if (this.tool === 'dim' || this.tool === 'scale') {
      if (stroke.length < 2) return this.render();
      const pts = snapPoints(doc.elements);
      const snap = (q: V2) => pts.reduce<V2>((best, c) => (d2(c, q) < d2(best, q) && d2(c, q) < tolPx ? c : best), q);
      const a = snap(stroke[0]), b = snap(stroke[stroke.length - 1]);
      if (this.tool === 'dim') {
        this.commit((d) => d.elements.push({ id: uid('d'), kind: 'dim', a, b }), 'Cota');
        // sin escala: la primera cota puede calibrarla con su medida real
        if (!this.hooks.doc().calibrated) {
          const px = d2(a, b);
          const mm = await this.hooks.askScale(px, true);
          if (mm && mm > 0) this.hooks.change((d) => { d.mmPerPx = mm / px; d.calibrated = true; }, 'Escala calibrada');
        }
      }
      else {
        const px = d2(a, b);
        const mm = await this.hooks.askScale(px);
        if (mm && mm > 0) this.hooks.change((d) => { d.mmPerPx = mm / px; d.calibrated = true; }, 'Escala calibrada');
      }
    } else {
      let el = fitStroke(stroke, { eps: 3 / this.view.s, closeTol: tolPx * 1.4, snapAngle: this.snapAngle, snapPts: snapPoints(doc.elements), snapTol: tolPx });
      if (el && !doc.elements.length) this.hooks.firstStroke?.();
      // simetría: media silueta que empieza y termina en el eje → silueta completa; otro trazo → copia reflejada
      let copy: SketchEl | null = null;
      if (el && sym !== null) {
        const closedHalf = el.kind === 'poly' && !el.closed ? mirrorClose(el.pts, sym, tolPx * 1.5) : null;
        // sin puntos sobrantes sobre el eje (los lados que cruzan el eje quedan de un tramo)
        if (closedHalf && el.kind === 'poly') el = { ...el, pts: el.smooth ? closedHalf : mergeCollinear(closedHalf, true, 2), closed: true };
        else {
          const pts = el.kind === 'circle' ? [el.c] : el.kind === 'dim' ? [el.a, el.b] : el.pts;
          const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
          if (Math.abs(cx - sym) > tolPx) copy = mirrorEl(el, sym, uid('m'));
        }
      }
      const fin = el;
      // "Redibujar contorno": la forma cerrada reemplaza la silueta en edición (las piezas siguen ligadas)
      const target = this.outlineTarget;
      if (fin && target && (fin.kind === 'circle' || (fin.kind === 'poly' && fin.closed))) {
        this.commit((d) => {
          const i = d.elements.findIndex((e) => e.id === target);
          const old = d.elements[i] as { name?: string } | undefined;
          const repl = { ...fin, id: target, name: old?.name } as SketchEl;
          if (i >= 0) d.elements[i] = repl; else d.elements.push(repl);
        }, 'Contorno nuevo');
        this.hooks.notify?.('Contorno reemplazado. La pieza ya usa la forma nueva.');
        this.render();
        return;
      }
      if (fin && target) this.hooks.notify?.('Para reemplazar el contorno, cierra el trazo (termina donde empezaste).');
      if (fin) this.commit((d) => {
        d.elements.push(fin);
        if (copy) d.elements.push(copy);
        if ((fin.kind === 'circle' || (fin.kind === 'poly' && fin.closed)) && !d.profileId) d.profileId = fin.id;
      }, 'Tinta inteligente');
    }
    this.render();
  }

  private commit(fn: (d: SketchDoc) => void, reason: string) {
    this.undoStack.push(structuredClone(this.hooks.doc().elements));
    this.redoStack = [];
    this.hooks.change(fn, reason);
  }
  undo() { const prev = this.undoStack.pop(); if (!prev) return; this.redoStack.push(structuredClone(this.hooks.doc().elements)); this.hooks.change((d) => { d.elements = prev; }, 'Deshacer'); this.keepSelection(); }
  redo() { const nxt = this.redoStack.pop(); if (!nxt) return; this.undoStack.push(structuredClone(this.hooks.doc().elements)); this.hooks.change((d) => { d.elements = nxt; }, 'Rehacer'); this.keepSelection(); }
  private keepSelection() { if (this.selected && !this.hooks.doc().elements.some((e) => e.id === this.selected)) this.select(null); else { this.hooks.selection?.(this.hooks.doc().elements.find((e) => e.id === this.selected) ?? null); this.render(); } }
  clear() { this.commit((d) => { d.elements = []; d.profileId = undefined; }, 'Limpiar'); this.render(); }

  // ---------------------------------------------------------------- herramienta Editar
  /** Elemento bajo el punto: primero formas cerradas (por dentro), luego líneas y cotas (por cercanía). */
  private hitEl(w: V2): SketchEl | null {
    const doc = this.hooks.doc();
    const tol = 12 / this.view.s;
    const els = [...doc.elements].reverse().filter((e) => this.inScope(e));
    return els.find((e) => distToEl(w, e) < tol)
      ?? els.find((e) => (e.kind === 'circle' ? d2(w, e.c) <= e.r : e.kind === 'poly' && e.closed && pointInPoly(w, e.pts)))
      ?? null;
  }

  select(id: string | null) {
    this.selected = id;
    if (!id || this.selSeg?.id !== id) this.selSeg = null;
    this.hooks.selection?.(id ? this.hooks.doc().elements.find((e) => e.id === id) ?? null : null);
    this.render();
  }

  private editDown(w: V2) {
    const doc = this.hooks.doc();
    const tol = 14 / this.view.s;
    const before = structuredClone(doc.elements);
    const base = { start: w, before, axis0: doc.symmetry?.x ?? 0, moved: false, hitSeg: -1 };
    const sel = doc.elements.find((e) => e.id === this.selected);
    if (sel?.kind === 'poly' && (!sel.smooth || sel.pts.length <= SMOOTH_HANDLES)) {
      const vi = vertexAt(sel.pts, w, tol);
      if (vi >= 0) { this.drag = { ...base, mode: 'vertex', id: sel.id, index: vi }; return; }
    }
    if (sel?.kind === 'circle' && Math.abs(d2(w, sel.c) - sel.r) < tol) { this.drag = { ...base, mode: 'radius', id: sel.id, index: 0 }; return; }
    if (sel?.kind === 'dim') {
      const vi = vertexAt([sel.a, sel.b], w, tol);
      if (vi >= 0) { this.drag = { ...base, mode: 'vertex', id: sel.id, index: vi }; return; }
    }
    const hit = this.hitEl(w);
    if (hit) {
      const seg = hit.kind === 'poly' && !hit.smooth && hit.id === this.selected ? segmentAt(hit.pts, hit.closed, w, tol) : -1;
      this.drag = { ...base, mode: 'move', id: hit.id, index: 0, hitSeg: seg };
      return;
    }
    if (doc.symmetry?.on && Math.abs(w[0] - doc.symmetry.x) < tol) { this.drag = { ...base, mode: 'axis', id: '', index: 0 }; return; }
    this.select(null);
  }

  private editMove(w: V2) {
    const g = this.drag!;
    const dx = w[0] - g.start[0], dy = w[1] - g.start[1];
    if (!g.moved && Math.hypot(dx, dy) * this.view.s < 4) return;
    g.moved = true;
    const doc = this.hooks.doc();
    if (g.mode === 'axis') { doc.symmetry = { on: true, x: g.axis0 + dx }; this.render(); return; }
    const i = doc.elements.findIndex((e) => e.id === g.id);
    const orig = g.before.find((e) => e.id === g.id);
    if (i < 0 || !orig) return;
    if (g.mode === 'move') doc.elements[i] = translateEl(orig, dx, dy);
    else if (g.mode === 'radius' && orig.kind === 'circle') doc.elements[i] = { ...orig, r: Math.max(2 / this.view.s, d2(w, orig.c)) };
    else if (g.mode === 'vertex') {
      // imán a vértices de otras formas
      const others = snapPoints(g.before.filter((e) => e.id !== g.id));
      const tol = 12 / this.view.s;
      const near = others.find((q) => d2(q, w) < tol);
      const p: V2 = near ? [near[0], near[1]] : [w[0], w[1]];
      if (orig.kind === 'dim') doc.elements[i] = g.index === 0 ? { ...orig, a: p } : { ...orig, b: p };
      else if (orig.kind === 'poly') { const pts = orig.pts.map((q) => [q[0], q[1]] as V2); pts[g.index] = p; doc.elements[i] = { ...orig, pts }; }
      // restricciones: el punto arrastrado queda fijo y el resto del dibujo se acomoda
      if (doc.constraints?.length) {
        solve(doc, this.hooks.values?.(), new Set([`${g.id}:${g.index}`]));
      }
    }
    this.render();
    if (this.hooks.live) { cancelAnimationFrame(this.liveRaf); this.liveRaf = requestAnimationFrame(() => this.hooks.live?.()); }
  }

  private async editUp(cancel: boolean) {
    const g = this.drag!;
    this.drag = null;
    const doc = this.hooks.doc();
    if (cancel) { doc.elements = g.before; this.render(); return; }
    if (g.moved) {
      // el arrastre ya modificó el documento: se registra para deshacer y se guarda
      this.undoStack.push(g.before);
      this.redoStack = [];
      this.hooks.change(() => { /* cambios ya aplicados */ }, g.mode === 'axis' ? 'Eje de simetría' : 'Editar');
      if (g.mode !== 'axis' && this.selected !== g.id) this.select(g.id); else this.render();
      return;
    }
    // toque sin arrastre
    const el = doc.elements.find((e) => e.id === g.id);
    if (!el) return;
    if (el.kind === 'dim' && this.selected === el.id && this.hooks.askLength) {
      const cur = d2(el.a, el.b) * doc.mmPerPx;
      const mm = await this.hooks.askLength(doc.calibrated ? 'Medida real de esta cota (mm). Se ajusta la escala de todo el boceto.' : 'Medida real de esta cota (mm). Con esto queda calibrada la escala.', Math.round(cur));
      if (mm && mm > 0) this.hooks.change((d) => { d.mmPerPx = mm / d2(el.a, el.b); d.calibrated = true; }, 'Escala calibrada');
      this.render();
      return;
    }
    if (g.hitSeg >= 0 && this.selected === el.id) { this.selSeg = { id: el.id, i: g.hitSeg }; this.render(); this.hooks.setSegment?.(el.id, g.hitSeg); return; }
    this.select(el.id);
  }

  // ---------------------------------------------------------------- restricciones y cotas
  /** Agrega restricciones (reemplaza las del mismo tipo en ese lado) y resuelve. */
  addConstraints(cs: Omit<Constraint, 'id'>[], reason = 'Restricción') {
    this.commit((d) => {
      let list = validConstraints(d);
      for (const c of cs) {
        const clash = (x: Constraint) => x.el === c.el && x.seg === c.seg && (x.kind === c.kind || (c.kind === 'h' && x.kind === 'v') || (c.kind === 'v' && x.kind === 'h'));
        list = list.filter((x) => !clash(x));
        list.push({ ...c, id: uid('k') });
      }
      d.constraints = list;
      solve(d, this.hooks.values?.());
    }, reason);
    this.render();
  }
  /** Quita las restricciones de un lado (o de un círculo). */
  removeConstraints(el: string, seg?: number) {
    this.commit((d) => { d.constraints = validConstraints(d).filter((c) => !(c.el === el && (seg === undefined || c.seg === seg))); }, 'Quitar restricciones');
    this.render();
  }
  /** Restricciones horizontales/verticales para los lados que ya están derechos. */
  autoConstrain(el: string): number {
    const d = this.hooks.doc(), e = d.elements.find((x) => x.id === el);
    const cs = e ? suggest(e, validConstraints(d)) : [];
    if (cs.length) this.addConstraints(cs, 'Auto-restringir');
    return cs.length;
  }
  /** Re-resuelve con los valores actuales (p. ej. cambió un parámetro ligado a una cota). */
  resolveNow() {
    const d = this.hooks.doc();
    if (!d.constraints?.length) return;
    this.hooks.change((x) => { solve(x, this.hooks.values?.()); }, 'Cotas');
    this.render();
  }

  private drawConstraints(doc: SketchDoc, px: number) {
    if (!this.showConstraints) return;
    const { ctx } = this;
    const vals = this.hooks.values?.();
    const badge = (p: V2, txt: string, color: string) => {
      ctx.font = `600 ${11 * px}px system-ui`;
      const w = ctx.measureText(txt).width + 8 * px, hh = 15 * px;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = color; ctx.lineWidth = 1 * px;
      ctx.beginPath(); ctx.roundRect(p[0] - w / 2, p[1] - hh / 2, w, hh, 4 * px); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, p[0], p[1] + 0.5 * px);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    };
    const byEl = new Map(doc.elements.map((e) => [e.id, e]));
    for (const c of validConstraints(doc)) {
      const e = byEl.get(c.el)!;
      if (!this.inScope(e)) continue;
      const color = c.param ? '#2563eb' : '#7c3aed';
      const mm = targetMm(c, vals);
      const txt = (v: number | null) => `${c.param ? `${c.param} = ` : ''}${v === null ? '?' : Math.round(v * 10) / 10}`;
      if (c.kind === 'dia' && e.kind === 'circle') { badge([e.c[0], e.c[1] + e.r + 12 * px], `Ø ${txt(mm)}`, color); continue; }
      const an0 = segAnchor(e, c.seg!);
      if (!an0) continue;
      // normal hacia afuera de la forma (la cota va por fuera, el símbolo H/V por dentro)
      let an = an0;
      if (e.kind === 'poly' && e.closed) {
        const cx = e.pts.reduce((t, q) => t + q[0], 0) / e.pts.length, cy = e.pts.reduce((t, q) => t + q[1], 0) / e.pts.length;
        if ((an0.mid[0] - cx) * an0.nrm[0] + (an0.mid[1] - cy) * an0.nrm[1] < 0) an = { ...an0, nrm: [-an0.nrm[0], -an0.nrm[1]] };
      }
      if (c.kind === 'len') {
        // línea de cota desplazada hacia afuera
        const o = 16 * px, [nx, ny] = an.nrm;
        const a2: V2 = [an.a[0] + nx * o, an.a[1] + ny * o], b2: V2 = [an.b[0] + nx * o, an.b[1] + ny * o];
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1 * px;
        ctx.beginPath(); ctx.moveTo(...an.a); ctx.lineTo(...a2); ctx.moveTo(...an.b); ctx.lineTo(...b2); ctx.moveTo(...a2); ctx.lineTo(...b2); ctx.stroke(); ctx.restore();
        badge([(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2], txt(mm), color);
      } else badge([an.mid[0] - an.nrm[0] * 12 * px, an.mid[1] - an.nrm[1] * 12 * px], c.kind === 'h' ? 'H' : 'V', color);
    }
    // lado seleccionado
    const ss = this.selSeg && byEl.get(this.selSeg.id);
    const an = ss && segAnchor(ss, this.selSeg!.i);
    if (an) { ctx.save(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 5 * px; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(...an.a); ctx.lineTo(...an.b); ctx.stroke(); ctx.restore(); }
  }

  /** Aplica un cambio de geometría con deshacer (usado por la vista: medida de lado, reflejar, duplicar). */
  apply(fn: (d: SketchDoc) => void, reason: string) { this.commit(fn, reason); this.render(); }

  /** Rectángulo con medidas exactas (mm) en el centro de la vista. */
  addRect(wMm: number, hMm: number) {
    const doc = this.hooks.doc();
    const k = doc.mmPerPx || 1;
    const w = wMm / k, hh = hMm / k;
    const c = this.toWorld([this.canvas.clientWidth / 2, this.canvas.clientHeight / 2]);
    const id = uid('p');
    this.apply((d) => { d.elements.push({ id, kind: 'poly', closed: true, pts: [[c[0] - w / 2, c[1] - hh / 2], [c[0] + w / 2, c[1] - hh / 2], [c[0] + w / 2, c[1] + hh / 2], [c[0] - w / 2, c[1] + hh / 2]] }); }, 'Rectángulo');
    this.select(id);
  }

  /** Zoom actual (px de pantalla por px de lienzo). */
  viewScale() { return this.view.s; }

  /** Centro de la vista actual en px de lienzo (para ubicar el eje de simetría). */
  viewCenter(): V2 { return this.toWorld([this.canvas.clientWidth / 2, this.canvas.clientHeight / 2]); }

  private eraseAt(w: V2) {
    const doc = this.hooks.doc();
    const tol = 10 / this.view.s;
    const hit = doc.elements.filter((e) => this.inScope(e)).find((e) => distToEl(w, e) < tol);
    if (hit && this.hooks.protectedIds?.().has(hit.id)) {
      if (!this.warnedProtected) { this.warnedProtected = true; this.hooks.notify?.('Esta silueta se usa en una pieza: la goma no la borra. Para cambiarla, redibuja su contorno o bórrala desde Editar.'); }
      return;
    }
    if (hit) { this.commit((d) => { d.elements = d.elements.filter((e) => e.id !== hit.id); if (d.profileId === hit.id) d.profileId = undefined; }, 'Borrar'); if (this.selected === hit.id) this.select(null); }
  }
  private pickAt(w: V2) {
    const doc = this.hooks.doc();
    const hit = [...doc.elements].reverse().find((e) => (e.kind === 'circle' ? d2(w, e.c) <= e.r : e.kind === 'poly' && e.closed && pointInPoly(w, e.pts)));
    if (hit) this.hooks.change((d) => { d.profileId = hit.id; }, 'Perfil seleccionado');
    this.render();
  }

  render() {
    const doc = this.hooks.doc();
    const { ctx, canvas } = this;
    const dpr = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * this.view.s, 0, 0, dpr * this.view.s, dpr * this.view.x, dpr * this.view.y);
    const px = 1 / this.view.s;

    if (doc.underlay && this.showUnderlay) {
      if (this.imgSrc !== doc.underlay) { this.imgSrc = doc.underlay; this.img = new Image(); this.img.onload = () => this.render(); this.img.src = doc.underlay; }
      if (this.img?.complete && doc.underlaySize) { ctx.globalAlpha = doc.underlayOpacity; ctx.drawImage(this.img, 0, 0, doc.underlaySize[0], doc.underlaySize[1]); ctx.globalAlpha = 1; }
    }
    this.grid(doc, px);

    if (doc.symmetry?.on) {
      const [, y0] = this.toWorld([0, 0]), [, y1] = this.toWorld([0, this.canvas.clientHeight]);
      ctx.save(); ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.2 * px; ctx.setLineDash([8 * px, 6 * px]);
      ctx.beginPath(); ctx.moveTo(doc.symmetry.x, y0); ctx.lineTo(doc.symmetry.x, y1); ctx.stroke(); ctx.restore();
    }
    const focus = this.focusId ? doc.elements.find((e) => e.id === this.focusId) : null;
    if (focus && focus.kind !== 'dim' && focus.kind !== 'free') {
      // silueta en edición: relleno azul suave
      ctx.save(); ctx.beginPath();
      if (focus.kind === 'circle') ctx.arc(focus.c[0], focus.c[1], focus.r, 0, Math.PI * 2);
      else { trace(focus).forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); }
      ctx.fillStyle = 'rgba(37,99,235,0.08)'; ctx.fill(); ctx.restore();
    }
    // piezas vecinas proyectadas: guía de dónde está todo (no se editan)
    const labeled = new Set<string>();
    for (const g of this.hooks.ghosts?.() ?? []) {
      if (g.pts.length < 2) continue;
      ctx.save(); ctx.setLineDash([6 * px, 5 * px]); ctx.lineWidth = 1.2 * px;
      ctx.strokeStyle = g.ref ? 'rgba(100,116,139,.55)' : 'rgba(234,88,12,.55)';
      ctx.fillStyle = g.ref ? 'rgba(100,116,139,.06)' : 'rgba(234,88,12,.05)';
      ctx.beginPath(); g.pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.fill(); ctx.stroke();
      const top = g.pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      ctx.setLineDash([]); ctx.fillStyle = g.ref ? '#64748b' : '#c2410c'; ctx.font = `${11 * px}px system-ui`;
      if (!labeled.has(g.name)) { labeled.add(g.name); ctx.fillText(g.name, top[0] + 4 * px, top[1] - 4 * px); }
      ctx.restore();
    }
    for (const e of doc.elements) {
      const on = this.inScope(e);
      if (!on) ctx.globalAlpha = 0.15;
      this.drawEl(e, doc, px, this.showProfile && e.id === doc.profileId);
      ctx.globalAlpha = 1;
    }
    const sel = doc.elements.find((e) => e.id === this.selected);
    if (sel && this.tool === 'edit') this.drawSelection(sel, px);
    this.drawConstraints(doc, px);
    if (this.stroke && this.stroke.length > 1) {
      ctx.strokeStyle = this.tool === 'scale' ? '#d97706' : this.tool === 'dim' ? '#2563eb' : '#1f2937';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < this.stroke.length; i++) {
        ctx.lineWidth = (0.8 + 2.4 * (this.pressures[i] ?? 0.5)) * px;
        ctx.beginPath(); ctx.moveTo(...this.stroke[i - 1]); ctx.lineTo(...this.stroke[i]); ctx.stroke();
      }
    }
  }

  private drawSelection(e: SketchEl, px: number) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 3 * px; ctx.globalAlpha = 0.35;
    ctx.beginPath();
    if (e.kind === 'circle') ctx.arc(e.c[0], e.c[1], e.r, 0, Math.PI * 2);
    else if (e.kind === 'dim') { ctx.moveTo(...e.a); ctx.lineTo(...e.b); }
    else { trace(e).forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); if (e.kind === 'poly' && e.closed) ctx.closePath(); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // manillas de vértices (tamaño constante en pantalla)
    const handles: V2[] = e.kind === 'poly' && (!e.smooth || e.pts.length <= SMOOTH_HANDLES) ? e.pts : e.kind === 'dim' ? [e.a, e.b] : e.kind === 'circle' ? [[e.c[0] + e.r, e.c[1]]] : [];
    for (const p of handles) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 7 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2 * px; ctx.strokeStyle = '#2563eb'; ctx.stroke();
    }
    ctx.restore();
  }

  private grid(doc: SketchDoc, px: number) {
    const { ctx, canvas } = this;
    const stepMm = [10, 50, 100, 500, 1000].find((s) => (s / doc.mmPerPx) * this.view.s > 24) ?? 1000;
    const step = doc.calibrated ? stepMm / doc.mmPerPx : 50;
    const [x0, y0] = this.toWorld([0, 0]);
    const [x1, y1] = this.toWorld([canvas.clientWidth, canvas.clientHeight]);
    ctx.lineWidth = px;
    ctx.strokeStyle = 'rgba(30,60,90,0.07)';
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.floor(y0 / step) * step; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }

  private label(p: V2, text: string, px: number, color = '#2563eb') {
    const { ctx } = this;
    ctx.font = `${11 * px}px -apple-system, Helvetica, sans-serif`;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(p[0] - w / 2 - 2 * px, p[1] - 8 * px, w + 4 * px, 12 * px);
    ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(text, p[0], p[1] + 2 * px);
  }

  private fmt(pxLen: number, doc: SketchDoc) { return doc.calibrated || this.forceMm ? `${round(pxLen * doc.mmPerPx, 0)} mm` : `${round(pxLen, 0)} px`; }

  private drawEl(e: SketchEl, doc: SketchDoc, px: number, isProfile: boolean) {
    const { ctx } = this;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (e.kind === 'free') {
      ctx.strokeStyle = 'rgba(31,41,55,0.75)'; ctx.lineWidth = 1.6 * px;
      ctx.beginPath(); e.pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke();
      return;
    }
    if (e.kind === 'dim') {
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1 * px;
      ctx.beginPath(); ctx.moveTo(...e.a); ctx.lineTo(...e.b); ctx.stroke();
      for (const q of [e.a, e.b]) { ctx.beginPath(); ctx.arc(q[0], q[1], 2.5 * px, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill(); }
      this.label([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2 - 8 * px], this.fmt(d2(e.a, e.b), doc), px);
      return;
    }
    ctx.beginPath();
    if (e.kind === 'circle') ctx.arc(e.c[0], e.c[1], e.r, 0, Math.PI * 2);
    else { trace(e).forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); if (e.closed) ctx.closePath(); }
    if (isProfile) { ctx.fillStyle = 'rgba(234,88,12,0.12)'; ctx.fill(); }
    ctx.strokeStyle = isProfile ? '#ea580c' : '#111827'; ctx.lineWidth = (isProfile ? 2.4 : 1.8) * px;
    ctx.stroke();
    if (!this.showLengths) return;
    if (e.kind === 'circle') { this.label([e.c[0], e.c[1]], `Ø ${this.fmt(e.r * 2, doc)}`, px, '#6b7280'); return; }
    if (e.smooth) {
      // puntos de paso de la curva (se arrastran en modo Editar)
      for (const p of e.pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 1.8 * px, 0, Math.PI * 2); ctx.fillStyle = '#6b7280'; ctx.fill(); }
      return;
    }
    const n = e.closed ? e.pts.length : e.pts.length - 1;
    // los lados con cota ya muestran su medida en la línea de cota
    const dimmed = new Set((doc.constraints ?? []).filter((c) => c.el === e.id && c.kind === 'len').map((c) => c.seg));
    for (let i = 0; i < n; i++) {
      const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length];
      if (d2(a, b) * this.view.s < 40 || (this.showConstraints && dimmed.has(i))) continue;
      this.label([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], this.fmt(d2(a, b), doc), px, '#6b7280');
    }
    for (const p of e.pts) { ctx.fillStyle = '#111827'; ctx.fillRect(p[0] - 1.5 * px, p[1] - 1.5 * px, 3 * px, 3 * px); }
  }

  /** Exporta los vectores como SVG (px de lienzo; con escala si está calibrado). */
  toSVG(): string {
    const doc = this.hooks.doc();
    const k = doc.calibrated ? doc.mmPerPx : 1;
    const els = doc.elements.map((e) => {
      if (e.kind === 'circle') return `<circle cx="${e.c[0] * k}" cy="${e.c[1] * k}" r="${e.r * k}"/>`;
      if (e.kind === 'dim') return `<line class="dim" x1="${e.a[0] * k}" y1="${e.a[1] * k}" x2="${e.b[0] * k}" y2="${e.b[1] * k}"/>`;
      const tag = e.kind === 'poly' && e.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${trace(e).map(([x, y]) => `${(x * k).toFixed(2)},${(y * k).toFixed(2)}`).join(' ')}"/>`;
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg"${doc.calibrated ? ' data-units="mm"' : ''}><style>*{fill:none;stroke:#111;stroke-width:${doc.calibrated ? 0.5 : 1.5}}.dim{stroke:#2563eb}</style>\n${els}\n</svg>`;
  }
}
