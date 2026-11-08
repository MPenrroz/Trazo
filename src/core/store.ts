import { DEFAULT_MATERIALS, DEFAULT_METHODS } from './catalog';
import { uid } from './geom';
import { resolveParams, resolveValues } from './params';
import { getTemplate } from './templates';
import { emptyFree, freeParams, shapesFromSketch } from './free';
import { solvedCopy } from './constraints';
import type { ParamValues, Part, Project } from './types';

const DB = 'trazo', STORE = 'projects', CURRENT = 'trazo:current';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const r = fn(d.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Proyecto nuevo: diseño libre vacío (el centro de la app). */
export function newProject(name = 'Nuevo producto'): Project {
  return {
    id: uid('p-'), name, author: '', description: '', functions: [], notes: '',
    template: 'libre', methodId: 'cnc3', materialId: 'plywood-abedul',
    values: {}, rules: {}, free: emptyFree(),
    references: [],
    sketch: { elements: [], mmPerPx: 1, calibrated: false, underlayOpacity: 0.5 },
    pricing: { margin: 60, base: 15000, currency: 'CLP' },
    fab: { methods: structuredClone(DEFAULT_METHODS), materials: structuredClone(DEFAULT_MATERIALS) },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

/** Rellena campos que falten en proyectos antiguos/importados. */
export function normalize(p: Partial<Project>): Project {
  const base = newProject(p.name);
  const fab = { ...base.fab, ...(p.fab ?? {}) };
  // agrega materiales/métodos nuevos del catálogo a proyectos antiguos
  fab.materials = [...fab.materials, ...base.fab.materials.filter((m) => !fab.materials.some((x) => x.id === m.id))];
  fab.methods = [...fab.methods, ...base.fab.methods.filter((m) => !fab.methods.some((x) => x.id === m.id))];
  return { ...base, ...p, free: p.free ?? emptyFree(), sketch: { ...base.sketch, ...(p.sketch ?? {}) }, pricing: { ...base.pricing, ...(p.pricing ?? {}) }, fab } as Project;
}

type Listener = (p: Project, reason: string) => void;

class Store {
  project: Project = newProject();
  private listeners = new Set<Listener>();
  private saveTimer = 0;

  /** false cuando el navegador no permite IndexedDB (modo privado, iframes): se trabaja solo en memoria. */
  persist = true;
  /** Primera vez en este navegador: no había proyectos guardados (se muestra la bienvenida). */
  firstRun = false;

  /**
   * @param seed proyecto de ejemplo que se carga si aún no existe en este dispositivo (p. ej. una demo publicada).
   * @returns true si se cargó la semilla.
   */
  async init(seed?: () => Promise<Partial<Project> | null>): Promise<boolean> {
    let all: Project[] = [];
    try { all = await this.list(); } catch { this.persist = false; }
    const sp = seed ? await seed().catch(() => null) : null;
    if (sp?.id && !all.some((p) => p.id === sp.id)) {
      this.project = normalize(sp);
      await this.save().catch(() => { this.persist = false; });
      return true;
    }
    let id: string | null = null;
    try { id = localStorage.getItem(CURRENT); } catch { /* sin storage */ }
    const found = all.find((p) => p.id === id) ?? all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (found) this.project = normalize(found);
    else { this.firstRun = true; await this.save().catch(() => { this.persist = false; }); }
    return false;
  }
  async list(): Promise<Project[]> { if (!this.persist) return [this.project]; return tx('readonly', (s) => s.getAll() as IDBRequest<Project[]>); }
  async open(id: string) { if (!this.persist) return; const p = await tx('readonly', (s) => s.get(id) as IDBRequest<Project>); if (p) { this.project = normalize(p); try { localStorage.setItem(CURRENT, p.id); } catch { /* */ } this.emit('open'); } }
  async create(p = newProject()) { this.project = p; await this.save().catch(() => 0); this.emit('open'); }
  async remove(id: string) { if (this.persist) await tx('readwrite', (s) => s.delete(id)); }
  async save() {
    this.project.updatedAt = Date.now();
    if (!this.persist) return;
    try { localStorage.setItem(CURRENT, this.project.id); } catch { /* */ }
    await tx('readwrite', (s) => s.put(structuredClone(this.project)));
  }

  /** Modifica el proyecto, notifica y guarda (con debounce). */
  update(fn: (p: Project) => void, reason = 'edit') {
    fn(this.project);
    this.emit(reason);
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save().catch(console.error), 400);
  }
  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  emit(reason: string) { for (const l of this.listeners) l(this.project, reason); }

  // Derivados
  get template() { return getTemplate(this.project.template); }
  get params() {
    const defs = this.template.id === 'libre' ? freeParams(this.project.free) : this.template.params;
    // el espesor ofrece los espesores del tablero elegido (incluye tableros propios con medidas especiales)
    const th = [...this.material.thicknesses].sort((a, b) => a - b);
    const withT = defs.map((d) => {
      if (d.key !== 't' || d.type !== 'choice' || !th.length) return d;
      const near = th.reduce((a, b) => (Math.abs(b - Number(d.default)) < Math.abs(a - Number(d.default)) ? b : a));
      return { ...d, default: near, options: th.map((n) => ({ value: n, label: `${n} mm` })) };
    });
    return resolveParams(withT, this.project.rules);
  }
  /** Formas cerradas del boceto disponibles como piezas (diseño libre). */
  get shapes() { return this.shapesFor(this.values); }
  /** Formas del boceto con sus cotas resueltas para estos valores (las cotas ligadas a parámetros cambian la forma). */
  shapesFor(values: ParamValues) { return shapesFromSketch(solvedCopy(this.project.sketch, values)); }
  /** Errores de fórmulas de la última construcción. */
  buildErrors: string[] = [];
  get values() { return resolveValues(this.params, this.project.values); }
  get method() { return this.project.fab.methods.find((m) => m.id === this.project.methodId) ?? this.project.fab.methods[0]; }
  get material() { return this.project.fab.materials.find((m) => m.id === this.project.materialId) ?? this.project.fab.materials[0]; }
  parts(values = this.values): Part[] {
    const errors: string[] = [];
    const parts = this.template.build(values, { material: this.material.id, profile: this.project.profile, free: this.project.free, shapes: this.shapesFor(values), errors });
    this.buildErrors = errors;
    return parts;
  }
}

export const store = new Store();
