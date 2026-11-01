import { d2, round, uid } from '../core/geom';
import type { SketchDoc, SketchEl, V2 } from '../core/types';
import { distToEl, fitStroke, pointInPoly, snapPoints } from './fit';

export type Tool = 'smart' | 'free' | 'dim' | 'scale' | 'erase' | 'pick' | 'pan';

export interface EditorHooks {
  doc(): SketchDoc;
  change(fn: (d: SketchDoc) => void, reason: string): void;
  askScale(px: number): Promise<number | null>;
}

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
    const stroke = this.stroke; this.stroke = null;
    if (!stroke || cancel || this.tool === 'erase') { this.render(); return; }
    const doc = this.hooks.doc();
    const tolPx = 14 / this.view.s;
    if (this.tool === 'free') {
      if (stroke.length > 1) this.commit((d) => d.elements.push({ id: uid('f'), kind: 'free', pts: stroke }), 'Trazo libre');
    } else if (this.tool === 'dim' || this.tool === 'scale') {
      if (stroke.length < 2) return this.render();
      const pts = snapPoints(doc.elements);
      const snap = (q: V2) => pts.reduce<V2>((best, c) => (d2(c, q) < d2(best, q) && d2(c, q) < tolPx ? c : best), q);
      const a = snap(stroke[0]), b = snap(stroke[stroke.length - 1]);
      if (this.tool === 'dim') this.commit((d) => d.elements.push({ id: uid('d'), kind: 'dim', a, b }), 'Cota');
      else {
        const px = d2(a, b);
        const mm = await this.hooks.askScale(px);
        if (mm && mm > 0) this.hooks.change((d) => { d.mmPerPx = mm / px; d.calibrated = true; }, 'Escala calibrada');
      }
    } else {
      const el = fitStroke(stroke, { eps: 3 / this.view.s, closeTol: tolPx * 1.4, snapAngle: this.snapAngle, snapPts: snapPoints(doc.elements), snapTol: tolPx });
      if (el) this.commit((d) => {
        d.elements.push(el);
        if ((el.kind === 'circle' || (el.kind === 'poly' && el.closed)) && !d.profileId) d.profileId = el.id;
      }, 'Tinta inteligente');
    }
    this.render();
  }

  private commit(fn: (d: SketchDoc) => void, reason: string) {
    this.undoStack.push(structuredClone(this.hooks.doc().elements));
    this.redoStack = [];
    this.hooks.change(fn, reason);
  }
  undo() { const prev = this.undoStack.pop(); if (!prev) return; this.redoStack.push(structuredClone(this.hooks.doc().elements)); this.hooks.change((d) => { d.elements = prev; }, 'Deshacer'); this.render(); }
  redo() { const nxt = this.redoStack.pop(); if (!nxt) return; this.undoStack.push(structuredClone(this.hooks.doc().elements)); this.hooks.change((d) => { d.elements = nxt; }, 'Rehacer'); this.render(); }
  clear() { this.commit((d) => { d.elements = []; d.profileId = undefined; }, 'Limpiar'); this.render(); }

  private eraseAt(w: V2) {
    const doc = this.hooks.doc();
    const tol = 10 / this.view.s;
    const hit = doc.elements.find((e) => distToEl(w, e) < tol);
    if (hit) this.commit((d) => { d.elements = d.elements.filter((e) => e.id !== hit.id); if (d.profileId === hit.id) d.profileId = undefined; }, 'Borrar');
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

    if (doc.underlay) {
      if (this.imgSrc !== doc.underlay) { this.imgSrc = doc.underlay; this.img = new Image(); this.img.onload = () => this.render(); this.img.src = doc.underlay; }
      if (this.img?.complete && doc.underlaySize) { ctx.globalAlpha = doc.underlayOpacity; ctx.drawImage(this.img, 0, 0, doc.underlaySize[0], doc.underlaySize[1]); ctx.globalAlpha = 1; }
    }
    this.grid(doc, px);

    for (const e of doc.elements) this.drawEl(e, doc, px, e.id === doc.profileId);
    if (this.stroke && this.stroke.length > 1) {
      ctx.strokeStyle = this.tool === 'scale' ? '#d97706' : this.tool === 'dim' ? '#2563eb' : '#1f2937';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < this.stroke.length; i++) {
        ctx.lineWidth = (0.8 + 2.4 * (this.pressures[i] ?? 0.5)) * px;
        ctx.beginPath(); ctx.moveTo(...this.stroke[i - 1]); ctx.lineTo(...this.stroke[i]); ctx.stroke();
      }
    }
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

  private fmt(pxLen: number, doc: SketchDoc) { return doc.calibrated ? `${round(pxLen * doc.mmPerPx, 0)} mm` : `${round(pxLen, 0)} px`; }

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
    else { e.pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); if (e.closed) ctx.closePath(); }
    if (isProfile) { ctx.fillStyle = 'rgba(234,88,12,0.12)'; ctx.fill(); }
    ctx.strokeStyle = isProfile ? '#ea580c' : '#111827'; ctx.lineWidth = (isProfile ? 2.4 : 1.8) * px;
    ctx.stroke();
    if (!this.showLengths) return;
    if (e.kind === 'circle') { this.label([e.c[0], e.c[1]], `Ø ${this.fmt(e.r * 2, doc)}`, px, '#6b7280'); return; }
    if (e.smooth) return;
    const n = e.closed ? e.pts.length : e.pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length];
      if (d2(a, b) * this.view.s < 40) continue;
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
      return `<${tag} points="${e.pts.map(([x, y]) => `${(x * k).toFixed(2)},${(y * k).toFixed(2)}`).join(' ')}"/>`;
    }).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg"${doc.calibrated ? ' data-units="mm"' : ''}><style>*{fill:none;stroke:#111;stroke-width:${doc.calibrated ? 0.5 : 1.5}}.dim{stroke:#2563eb}</style>\n${els}\n</svg>`;
  }
}
