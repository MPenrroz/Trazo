import * as THREE from 'three';
import { applyDrag, FIELD_LABEL, type DragOp, type DragResult, type Field } from '../core/direct';
import type { Component, FreeDesign } from '../core/free';
import { bounds2, partVertices, toWorld } from '../core/geom';
import type { ParamDef, ParamValues, Part, V3 } from '../core/types';
import type { Viewer } from '../viewer';

/** Qué campo de posición corresponde a cada eje local de la pieza según su orientación. */
const AXES: Record<Component['orient'], { u: Field; v: Field }> = {
  XZ: { u: 'x', v: 'z' }, YZ: { u: 'y', v: 'z' }, XY: { u: 'x', v: 'y' },
};
const WORLD: { field: Field; dir: V3; color: number }[] = [
  { field: 'x', dir: [1, 0, 0], color: 0xd64545 },
  { field: 'y', dir: [0, 1, 0], color: 0x2f9e44 },
  { field: 'z', dir: [0, 0, 1], color: 0x2563eb },
];

export interface DirectHooks {
  parts(): Part[];
  /** Diseño libre actual (null si la tipología no es editable a mano). */
  design(): FreeDesign | null;
  params(): ParamDef[];
  values(): ParamValues;
  /** Vista previa durante el arrastre (sin guardar). */
  preview(design: FreeDesign, values: ParamValues): void;
  /** Guarda el resultado del arrastre. */
  commit(res: DragResult): void;
  /** Avisa qué pieza quedó seleccionada (para abrir su ficha). */
  selected(part: Part | null): void;
}

interface Handle {
  obj: THREE.Group;
  hit: THREE.Mesh;
  base: THREE.Vector3; // punto de anclaje en mundo
  axis: THREE.Vector3; // eje de arrastre (positivo de mundo)
  offset: number; // desplazamiento del dibujo sobre el eje (en unidades de escala de pantalla)
  kind: 'size' | 'move';
  field: Field; // medida (w/h) o posición (x/y/z)
  posField?: Field; // para estirar desde el lado negativo
  side?: 1 | -1;
  size?: number; // medida actual (mm)
}

/**
 * Edición directa en el visor 3D:
 * - Tocar una pieza la selecciona (girar con un dedo y zoom con dos siguen funcionando).
 * - Esferas naranjas en los bordes: estirar/encoger. Flechas X/Y/Z en el centro: mover.
 * - Imán a caras de otras piezas (15 mm) y grilla de 5 mm.
 */
export class DirectEdit {
  part: Part | null = null;
  private handles: Handle[] = [];
  private down: { x: number; y: number; t: number; multi: boolean } | null = null;
  private pointers = new Set<number>();
  private drag: { h: Handle; s0: number; last: number; res: DragResult | null; base0: THREE.Vector3; snapped: string | null } | null = null;
  private label = document.createElement('div');
  private raf = 0;
  private frame = () => this.scaleHandles();

  constructor(private viewer: Viewer, private el: HTMLElement, private hooks: DirectHooks) {
    this.label.className = 'drag-label';
    this.label.hidden = true;
    el.appendChild(this.label);
    el.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    viewer.onFrame.add(this.frame);
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this.onDown, { capture: true });
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.viewer.onFrame.delete(this.frame);
    this.label.remove();
  }

  /** Posiciones de las manillas en pantalla (para pruebas automáticas y ayudas). */
  handleScreenPoints(): { kind: string; field: string; side?: number; x: number; y: number }[] {
    const r = this.el.getBoundingClientRect();
    return this.handles.map((h) => {
      const v = h.obj.position.clone().project(this.viewer.camera);
      return { kind: h.kind, field: h.field, side: h.side, x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    });
  }

  /** Selecciona una pieza por id (o la primera copia de una pieza del diseño libre). */
  select(partId: string | null, notify = true) {
    const parts = this.hooks.parts();
    this.part = partId ? parts.find((p) => p.id === partId || p.source?.comp === partId) ?? null : null;
    this.refresh();
    if (notify) this.hooks.selected(this.part);
  }

  /** Reconstruye resaltado y manillas tras cambiar el modelo. */
  refresh() {
    const parts = this.hooks.parts();
    if (this.part) this.part = parts.find((p) => p.id === this.part!.id) ?? parts.find((p) => p.source?.comp === this.part!.source?.comp) ?? null;
    const comp = this.part?.source?.comp;
    this.viewer.highlight(this.part?.id ?? null, comp ? parts.filter((p) => p.source?.comp === comp).map((p) => p.id) : []);
    this.buildHandles();
  }

  private component(): Component | null {
    const c = this.part?.source?.comp;
    return c ? this.hooks.design()?.components.find((x) => x.id === c) ?? null : null;
  }

  private buildHandles() {
    this.viewer.overlay.clear();
    this.handles = [];
    const p = this.part, c = this.component();
    if (!p || !c || c.kind === 'ref') return;
    const b = bounds2(p.profile);
    const mid = (u: number, v: number) => new THREE.Vector3(...toWorld(p.plane, u, v, p.thickness / 2));
    const ax = AXES[c.orient];
    const ux = new THREE.Vector3(...p.plane.x), vy = new THREE.Vector3(...p.plane.y);
    // estirar: ±u (ancho) y ±v (alto)
    const size = (pos: THREE.Vector3, axis: THREE.Vector3, field: Field, posField: Field, side: 1 | -1, sz: number) =>
      this.addHandle({ base: pos, axis, offset: 0, kind: 'size', field, posField, side, size: sz }, 0xea580c, 'sphere');
    // "tamaño desde el dibujo": las medidas se cambian en el 2D; aquí solo se mueve
    if (c.fit !== 'sketch' || c.shape === 'rect') {
      size(mid(b.x1, (b.y0 + b.y1) / 2), ux, 'w', ax.u, 1, b.w);
      size(mid(b.x0, (b.y0 + b.y1) / 2), ux, 'w', ax.u, -1, b.w);
      size(mid((b.x0 + b.x1) / 2, b.y1), vy, 'h', ax.v, 1, b.h);
      size(mid((b.x0 + b.x1) / 2, b.y0), vy, 'h', ax.v, -1, b.h);
    }
    // mover: flechas de mundo desde el centro de la pieza
    const center = mid((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    for (const w of WORLD) this.addHandle({ base: center, axis: new THREE.Vector3(...w.dir), offset: 4.2, kind: 'move', field: w.field }, w.color, 'arrow');
  }

  private addHandle(h: Omit<Handle, 'obj' | 'hit'>, color: number, shape: 'sphere' | 'arrow') {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    const obj = new THREE.Group();
    if (shape === 'sphere') {
      obj.add(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat));
      const ring = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
      ring.renderOrder = -1;
      obj.add(ring);
    } else {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 18), mat);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.axis);
      obj.add(cone);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, h.offset, 8), mat);
      line.quaternion.copy(cone.quaternion);
      line.position.copy(h.axis.clone().multiplyScalar(-h.offset / 2));
      obj.add(line);
    }
    // zona de toque más grande que el dibujo (dedos)
    const hit = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    obj.add(hit);
    obj.traverse((o) => { o.renderOrder = 999; });
    this.viewer.overlay.add(obj);
    this.handles.push({ ...h, obj, hit });
  }

  /** Mantiene las manillas con tamaño constante en pantalla. */
  private scaleHandles() {
    const cam = this.viewer.camera;
    for (const h of this.handles) {
      const s = cam.position.distanceTo(h.base) * 0.011;
      h.obj.scale.setScalar(s);
      h.obj.position.copy(h.base).addScaledVector(h.axis, h.offset * s);
    }
  }

  /** Parámetro del punto del eje más cercano al rayo del dedo. */
  private axisParam(h: Handle, clientX: number, clientY: number): number | null {
    const ray = this.viewer.ray(clientX, clientY);
    const a = h.axis, d = ray.direction, w0 = h.base.clone().sub(ray.origin);
    const b = a.dot(d), denom = 1 - b * b;
    if (denom < 1e-4) return null; // mirando a lo largo del eje
    return (b * d.dot(w0) - a.dot(w0)) / denom;
  }

  private onDown = (e: PointerEvent) => {
    this.pointers.add(e.pointerId);
    if (this.pointers.size > 1) { if (this.down) this.down.multi = true; return; }
    if (this.handles.length) {
      const hit = this.viewer.hit(e.clientX, e.clientY, this.handles.map((h) => h.hit));
      const h = hit && this.handles.find((x) => x.hit === hit.object);
      if (h) {
        const s0 = this.axisParam(h, e.clientX, e.clientY);
        if (s0 !== null) {
          e.stopPropagation(); e.preventDefault();
          this.viewer.controls.enabled = false;
          this.drag = { h, s0, last: 0, res: null, base0: h.base.clone(), snapped: null };
          for (const o of this.handles) o.obj.visible = o === h; // solo la manilla activa
          return;
        }
      }
    }
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), multi: false };
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const s = this.axisParam(this.drag.h, e.clientX, e.clientY);
    if (s === null) return;
    const { delta, target } = this.snap(this.drag.h, s - this.drag.s0);
    this.drag.snapped = target;
    this.label.hidden = false;
    const r = this.el.getBoundingClientRect();
    this.label.style.left = `${e.clientX - r.left}px`;
    this.label.style.top = `${e.clientY - r.top}px`;
    if (delta === this.drag.last && this.drag.res) return;
    this.drag.last = delta;
    // vista previa fina (sin redondear al paso de los parámetros): el movimiento sigue al dedo
    const res = this.compute(this.drag.h, delta, true);
    this.drag.res = res;
    const h = this.drag.h;
    const ap = Math.round(res?.applied[0] ?? 0);
    // la manilla acompaña al dedo: en el lado negativo la cara se mueve al revés del cambio de medida
    const faceMove = h.kind === 'size' && h.side === -1 ? -(res?.applied[0] ?? 0) : res?.applied[0] ?? 0;
    h.base.copy(this.drag.base0).addScaledVector(h.axis, faceMove);
    this.label.textContent = (h.kind === 'size'
      ? `${FIELD_LABEL[h.field]} ${Math.round((h.size ?? 0) + ap)} mm (${ap >= 0 ? '+' : '−'}${Math.abs(ap)})`
      : `${h.field.toUpperCase()} ${ap >= 0 ? '+' : '−'}${Math.abs(ap)} mm`) + (target ? ` · ⇥ toca «${target}»` : '');
    this.label.classList.toggle('snapped', !!target);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => { if (res) this.hooks.preview(res.design, res.values); });
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.drag) {
      const dr = this.drag;
      // al soltar: resultado definitivo (con el paso de los parámetros, salvo que haya quedado tocando otra pieza)
      const res = dr.res ? this.compute(dr.h, dr.last, !!dr.snapped) ?? dr.res : null;
      this.drag = null;
      this.label.classList.remove('snapped');
      this.viewer.controls.enabled = true;
      this.label.hidden = true;
      cancelAnimationFrame(this.raf);
      if (res) this.hooks.commit(res);
      else for (const o of this.handles) o.obj.visible = true; // toque sin arrastre
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d || d.multi || this.pointers.size) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 450) return; // fue un giro, no un toque
    const hit = this.viewer.hit(e.clientX, e.clientY);
    this.select((hit?.object.userData.partId as string) ?? (hit?.object.parent?.userData.partId as string) ?? null);
  };

  /** Imán a caras de otras piezas (tolerancia en pantalla, ~20 px); si no hay ninguna cerca, grilla de 1 mm. */
  private snap(h: Handle, raw: number): { delta: number; target: string | null } {
    const p = this.part!;
    const i = h.axis.x ? 0 : h.axis.y ? 1 : 2;
    const own = partVertices(p).map((v) => v[i]);
    const faces = h.kind === 'size' ? [this.drag?.base0.getComponent(i) ?? h.base.getComponent(i)] : [Math.min(...own), Math.max(...own)];
    const comp = p.source?.comp;
    // mm por píxel a la distancia de la manilla
    const cam = this.viewer.camera as THREE.PerspectiveCamera;
    const dist = cam.position.distanceTo(this.drag?.base0 ?? h.base);
    const mmPerPx = (2 * dist * Math.tan(((cam.fov ?? 45) * Math.PI) / 360)) / Math.max(1, this.el.clientHeight);
    const tol = Math.max(6, 14 * mmPerPx);
    let best: { d: number; name: string } | null = null;
    for (const q of this.hooks.parts()) {
      if (q.source?.comp === comp) continue;
      const vs = partVertices(q).map((v) => v[i]);
      for (const t of [Math.min(...vs), Math.max(...vs)]) for (const f of faces) {
        const d = t - f;
        if (Math.abs(d) < 0.5) continue; // ya alineada: no frena el inicio del arrastre
        if (Math.abs(d - raw) < tol && (!best || Math.abs(d - raw) < Math.abs(best.d - raw))) best = { d, name: q.name };
      }
    }
    let delta = best ? best.d : Math.round(raw);
    // medida mínima de 5 mm
    if (h.kind === 'size' && h.size !== undefined) {
      if (h.side === 1) delta = Math.max(delta, 5 - h.size);
      else delta = Math.min(delta, h.size - 5);
    }
    return { delta: Math.round(delta * 10) / 10, target: best ? best.name : null };
  }

  private compute(h: Handle, delta: number, fine = false): DragResult | null {
    const design = this.hooks.design(), comp = this.part?.source?.comp;
    if (!design || !comp) return null;
    let ops: DragOp[], link = false;
    if (h.kind === 'move') ops = [{ field: h.field, delta }];
    else if (h.side === 1) ops = [{ field: h.field, delta }];
    else { ops = [{ field: h.field, delta: -delta }, { field: h.posField!, delta }]; link = true; }
    return applyDrag(design, this.hooks.values(), this.hooks.params(), comp, ops, link, { fine });
  }
}

export const partDims = (p: Part) => {
  const b = bounds2(p.profile);
  return `${Math.round(b.w)} × ${Math.round(b.h)} × ${Math.round(p.thickness)} mm`;
};
