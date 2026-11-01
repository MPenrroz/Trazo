import type { FabMethod, Material } from './types';

// Valores de referencia editables desde la pestaña Fabricación (precios en moneda local, de ejemplo).
export const DEFAULT_MATERIALS: Material[] = [
  { id: 'plywood-abedul', name: 'Contrachapado abedul', thicknesses: [9, 12, 15, 18, 21, 24], pricePerSheet: 95000, sheet: [2440, 1220], color: '#e2c89a', density: 680, maxSpanRatio: 45 },
  { id: 'osb', name: 'OSB estructural', thicknesses: [9, 11, 15, 18], pricePerSheet: 28000, sheet: [2440, 1220], color: '#c9a66b', density: 620, maxSpanRatio: 35 },
  { id: 'mdf', name: 'MDF', thicknesses: [9, 12, 15, 18, 25], pricePerSheet: 32000, sheet: [2440, 1830], color: '#b9a48a', density: 750, maxSpanRatio: 32 },
  { id: 'pino', name: 'Terciado pino', thicknesses: [9, 12, 15, 18], pricePerSheet: 38000, sheet: [2440, 1220], color: '#e8d3a8', density: 520, maxSpanRatio: 38 },
  { id: 'acrilico', name: 'Acrílico', thicknesses: [3, 4, 5, 6, 8, 10], pricePerSheet: 70000, sheet: [1800, 1200], color: '#cfe8f3', density: 1190, maxSpanRatio: 25 },
  { id: 'aluminio', name: 'Aluminio 5052', thicknesses: [2, 3, 4, 5, 6], pricePerSheet: 180000, sheet: [2440, 1220], color: '#c7ccd1', density: 2680, maxSpanRatio: 80 },
];

export const DEFAULT_METHODS: FabMethod[] = [
  { id: 'cnc3', name: 'CNC router 3 ejes', bed: [2500, 1250], maxThickness: 50, tool: 6, ratePerMeter: 900, setupPerSheet: 6000, notes: 'Esquinas interiores necesitan dogbone (radio = Ø fresa / 2). Ideal tableros de madera.' },
  { id: 'laser', name: 'Corte láser CO₂', bed: [1300, 900], maxThickness: 10, tool: 0.2, ratePerMeter: 600, setupPerSheet: 3000, notes: 'Kerf mínimo, permite esquinas vivas. Limitado en espesor y tamaño de cama.' },
  { id: 'cnc5', name: 'CNC 5 ejes / robot de fresado', bed: [3000, 1500], maxThickness: 200, tool: 10, ratePerMeter: 2200, setupPerSheet: 15000, notes: 'Permite cantos biselados, doble curvatura y piezas macizas.' },
  { id: 'robot', name: 'Celda robótica (ensamble / pick & place)', bed: [2600, 2600], maxThickness: 60, tool: 8, ratePerMeter: 1500, setupPerSheet: 10000, notes: 'Combina corte con ensamble automatizado; conviene estandarizar uniones.' },
  { id: 'semi', name: 'Semi-automatizado (sierra escuadradora + CNC)', bed: [3050, 1830], maxThickness: 60, tool: 4, ratePerMeter: 500, setupPerSheet: 4000, notes: 'Cortes rectos en escuadradora, mecanizados en CNC. Muy económico para piezas rectangulares.' },
  { id: 'print3d', name: 'Impresión 3D gran formato', bed: [1000, 1000], maxThickness: 1000, tool: 1, ratePerMeter: 3000, setupPerSheet: 0, notes: 'Para nodos, conectores y piezas de forma libre. Volumen limitado.' },
];
