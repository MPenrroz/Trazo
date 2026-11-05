// Tipos centrales de Trazo. Unidades: milímetros. Sistema de coordenadas: Z arriba (igual que Rhino).

export type V2 = [number, number];
export type V3 = [number, number, number];

/** Plano local de una pieza: origen + ejes X/Y. La normal (Z) = X × Y es la dirección del espesor. */
export interface Plane { o: V3; x: V3; y: V3 }

/** Pieza plana (tablero) = perfil 2D cerrado extruido según la normal del plano. Ideal para CNC/láser. */
export interface Part {
  id: string;
  name: string;
  /** Perfil exterior cerrado (sin repetir el primer punto), coordenadas locales del plano, en mm. */
  profile: V2[];
  /** Perforaciones / vaciados internos. */
  holes?: V2[][];
  thickness: number;
  plane: Plane;
  material: string;
  /** Rol en el producto (lateral, repisa, cubierta…) para agrupar en despiece y capas de Rhino. */
  role: string;
  /**
   * Proceso: 'cnc' (por defecto, se anida y corta), 'tapiz' (espuma/tela, se cotiza por m², no se corta en CNC)
   * o 'ref' (contexto: la cama o el muro existente; se ve en 3D pero no se fabrica ni cotiza).
   */
  process?: 'cnc' | 'tapiz' | 'ref';
  /** Mecanizados de profundidad parcial (ranuras, cajeados, rebajes). */
  pockets?: Pocket[];
  /** Pieza del diseño libre que la generó (para edición directa en el 3D). */
  source?: { comp: string; i: number };
}

/**
 * Cajeado: zona del perfil rebajada `depth` mm desde una de las caras.
 * face 'base' = cara en w=0 (origen del plano); 'top' = cara en w=espesor.
 * El contorno puede tocar el borde de la pieza (ranura abierta).
 */
export interface Pocket { name: string; outline: V2[]; depth: number; face: 'base' | 'top' }

export type ParamType = 'number' | 'int' | 'bool' | 'choice';

export interface ParamOption { value: string | number; label: string }

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean | string;
  options?: ParamOption[];
  group?: string;
  help?: string;
  /** Si el cliente final puede modificarlo en la tienda. */
  exposed: boolean;
}

export type ParamValues = Record<string, number | boolean | string>;

/** Ajustes que el arquitecto fija sobre cada parámetro (rango, paso, visibilidad para el cliente). */
export type ParamRule = Partial<Pick<ParamDef, 'min' | 'max' | 'step' | 'default' | 'exposed' | 'label'>>;

export interface Material {
  id: string;
  name: string;
  thicknesses: number[];
  /** Precio por tablero completo (moneda local). */
  pricePerSheet: number;
  sheet: V2;
  color: string;
  /** kg/m³ para estimar peso. */
  density: number;
  /** Relación luz/espesor máxima recomendada para repisas sin apoyo. */
  maxSpanRatio: number;
}

export interface FabMethod {
  id: string;
  name: string;
  /** Área útil de trabajo (mm). */
  bed: V2;
  maxThickness: number;
  /** Diámetro de herramienta / kerf (mm). */
  tool: number;
  /** Costo por metro lineal de corte. */
  ratePerMeter: number;
  /** Costo fijo por tablero / setup. */
  setupPerSheet: number;
  notes: string;
}

export type SketchEl =
  | { id: string; kind: 'free'; pts: V2[] }
  | { id: string; kind: 'poly'; pts: V2[]; closed: boolean; smooth?: boolean }
  | { id: string; kind: 'circle'; c: V2; r: number }
  | { id: string; kind: 'dim'; a: V2; b: V2 };

export interface SketchDoc {
  underlay?: string; // dataURL de la imagen del boceto (Procreate, Concepts, foto…)
  underlayOpacity: number;
  underlaySize?: V2; // px
  elements: SketchEl[];
  /** mm por píxel del lienzo (calibración de escala). */
  mmPerPx: number;
  calibrated: boolean;
  /** Elemento cerrado usado como perfil del producto. */
  profileId?: string;
}

export interface RefImage { id: string; src: string; caption: string; tag: string }

export interface Project {
  id: string;
  name: string;
  author: string;
  description: string;
  functions: string[];
  notes: string;
  template: string;
  methodId: string;
  materialId: string;
  values: ParamValues;
  rules: Record<string, ParamRule>;
  references: RefImage[];
  sketch: SketchDoc;
  /** Perfil en mm derivado del boceto (para plantillas que lo usan). */
  profile?: V2[];
  pricing: { margin: number; base: number; currency: string };
  /** Diseño libre (tipología 'libre'): parámetros y piezas definidos por el arquitecto. */
  free?: import('./free').FreeDesign;
  fab: { methods: FabMethod[]; materials: Material[] };
  createdAt: number;
  updatedAt: number;
  /** Último respaldo exportado (.trazo.json). */
  backupAt?: number;
}

export type CheckLevel = 'ok' | 'info' | 'warn' | 'error';
export interface Check { level: CheckLevel; msg: string; part?: string }
