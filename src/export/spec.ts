import type { ParamValues, Project } from '../core/types';
import { store } from '../core/store';
import type { FreeDesign, Shape } from '../core/free';

/**
 * Especificación del producto configurable: lo que necesita la tienda (o Grasshopper / ShapeDiver)
 * para regenerar el producto con los rangos que dejó el arquitecto.
 */
export interface ProductSpec {
  format: 'trazo-spec@1';
  id: string;
  name: string;
  description: string;
  functions: string[];
  template: string;
  profile?: [number, number][];
  params: ReturnType<typeof store['params']['slice']>;
  defaults: ParamValues;
  materialId: string;
  methodId: string;
  pricing: Project['pricing'];
  fab: Project['fab'];
  hero?: string;
  parts?: unknown;
  /** Diseño libre + formas del boceto ya normalizadas (para regenerar en la tienda y en Rhino). */
  free?: FreeDesign;
  shapes?: Record<string, Shape>;
}

export function buildSpec(withParts = false, withHero = true): ProductSpec {
  const p = store.project;
  return {
    format: 'trazo-spec@1', id: p.id, name: p.name, description: p.description, functions: p.functions,
    template: p.template, profile: p.profile, params: store.params, defaults: store.values,
    materialId: p.materialId, methodId: p.methodId, pricing: p.pricing, fab: p.fab,
    hero: withHero ? p.references[0]?.src : undefined,
    parts: withParts ? store.parts() : undefined,
    free: p.template === 'libre' ? p.free : undefined,
    shapes: p.template === 'libre' ? store.shapes : undefined,
  };
}
