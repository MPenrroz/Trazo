import { DEFAULT_MATERIALS, DEFAULT_METHODS } from './catalog';
import { uid } from './geom';
import { resolveParams, resolveValues } from './params';
import { getTemplate } from './templates';
import type { Part, Project } from './types';

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

export function newProject(name = 'Nuevo producto'): Project {
  const t = getTemplate('estanteria');
  return {
    id: uid('p-'), name, author: '', description: '', functions: [], notes: '',
    template: t.id, methodId: 'cnc3', materialId: 'plywood-abedul',
    values: Object.fromEntries(t.params.map((p) => [p.key, p.default])), rules: {},
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
  return { ...base, ...p, sketch: { ...base.sketch, ...(p.sketch ?? {}) }, pricing: { ...base.pricing, ...(p.pricing ?? {}) }, fab: { ...base.fab, ...(p.fab ?? {}) } } as Project;
}

type Listener = (p: Project, reason: string) => void;

class Store {
  project: Project = newProject();
  private listeners = new Set<Listener>();
  private saveTimer = 0;

  async init() {
    const id = localStorage.getItem(CURRENT);
    const all = await this.list().catch(() => []);
    const found = all.find((p) => p.id === id) ?? all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (found) this.project = normalize(found);
    else await this.save();
  }
  list(): Promise<Project[]> { return tx('readonly', (s) => s.getAll() as IDBRequest<Project[]>); }
  async open(id: string) { const p = await tx('readonly', (s) => s.get(id) as IDBRequest<Project>); if (p) { this.project = normalize(p); localStorage.setItem(CURRENT, p.id); this.emit('open'); } }
  async create(p = newProject()) { this.project = p; await this.save(); this.emit('open'); }
  async remove(id: string) { await tx('readwrite', (s) => s.delete(id)); }
  async save() { this.project.updatedAt = Date.now(); localStorage.setItem(CURRENT, this.project.id); await tx('readwrite', (s) => s.put(structuredClone(this.project))); }

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
  get params() { return resolveParams(this.template.params, this.project.rules); }
  get values() { return resolveValues(this.params, this.project.values); }
  get method() { return this.project.fab.methods.find((m) => m.id === this.project.methodId) ?? this.project.fab.methods[0]; }
  get material() { return this.project.fab.materials.find((m) => m.id === this.project.materialId) ?? this.project.fab.materials[0]; }
  parts(values = this.values): Part[] { return this.template.build(values, { material: this.material.id, profile: this.project.profile }); }
}

export const store = new Store();
