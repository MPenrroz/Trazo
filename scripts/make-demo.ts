// Genera los productos de ejemplo publicados en public/productos/.
//   npx vite-node scripts/make-demo.ts
// Opcional: DEMO_OUT=<dir> REF_IMG=<foto.jpg> para generar además el proyecto completo (.trazo.json) del nicho
// con imagen referencial y boceto vectorial (se usa para publicar demos sin subir fotos de terceros al repo).
import { readFileSync, writeFileSync } from 'node:fs';
import { newProject, store } from '../src/core/store';
import { getTemplate } from '../src/core/templates';
import type { SketchEl, V2 } from '../src/core/types';
import { buildSpec } from '../src/export/spec';

const demos = [
  { file: 'estanteria-demo', name: 'Librero Modular Trazo', template: 'estanteria', material: 'plywood-abedul',
    description: 'Librero de contrachapado de abedul fresado en CNC. Elige ancho, alto, profundidad y cantidad de repisas.',
    functions: ['Se arma sin herramientas con uniones encastradas', 'Módulos de ancho variable', 'Fondo opcional para usar como divisor de ambientes'] },
  { file: 'banco-costillas-demo', name: 'Banco Costilla', template: 'costillas', material: 'plywood-abedul',
    description: 'Banco formado por costillas a partir de un perfil dibujado a mano. Ajusta el largo y la densidad de costillas.',
    functions: ['Perfil ergonómico dibujado a mano', 'Largo a medida', 'Fabricación 100% CNC en tablero estándar'] },
  { file: 'nicho-lectura', name: 'Nicho de Lectura', template: 'nicho', material: 'mdf-laca',
    description: 'Asiento infantil envolvente tallado en una caja lacada, con cojín curvo tapizado y librero lateral para tener los cuentos a mano.',
    functions: ['Asiento curvo de listones fresados, cubierto por cojín de espuma 40 mm', 'Librero lateral abierto con repisa intermedia', 'Zócalo retranqueado: la caja parece flotar', 'Medidas a escala infantil, configurables'] },
];

for (const d of demos) {
  const p = newProject(d.name);
  Object.assign(p, { id: d.file, template: d.template, materialId: d.material, description: d.description, functions: d.functions, author: 'Trazo' });
  store.project = p;
  p.values = Object.fromEntries(store.template.params.map((q) => [q.key, q.default]));
  if (d.template === 'costillas') p.rules = { l: { min: 600, max: 2400 }, n: { min: 6, max: 30 } };
  if (d.template === 'nicho') {
    p.rules = { ws: { min: 600, max: 900 }, h: { min: 480, max: 650 }, d: { min: 420, max: 560 } };
    p.notes = 'Listones del mismo tablero encastrados en ranura curva de 6 mm fresada en la cara interior de los costados (incluida en el modelo). '
      + 'Cojín: espuma HR 40 mm sobre base de terciado flexible, funda removible con cierre. Cantos redondeados r=3 mm. Laca poliuretánica blanca hueso.';
    p.pricing = { margin: 70, base: 35000, currency: 'CLP' };
  }
  writeFileSync(`public/productos/${d.file}.json`, JSON.stringify(buildSpec(false, false), null, 2));
  console.log('spec', d.file);

  if (d.template === 'nicho' && process.env.DEMO_OUT) {
    p.sketch = nookSketch(p.values);
    if (process.env.REF_IMG) {
      const src = 'data:image/jpeg;base64,' + readFileSync(process.env.REF_IMG).toString('base64');
      p.references = [{ id: 'ref-1', src, caption: 'Caja lacada con corte semicircular, cojín curvo gris y librero lateral abierto', tag: 'Forma' }];
    }
    p.functions = d.functions;
    writeFileSync(`${process.env.DEMO_OUT}/${d.file}.trazo.json`, JSON.stringify(p));
    writeFileSync(`${process.env.DEMO_OUT}/${d.file}.json`, JSON.stringify(buildSpec(false, true), null, 2));
    console.log('proyecto', `${process.env.DEMO_OUT}/${d.file}.trazo.json`);
  }
}

/** Boceto vectorial del alzado frontal (px = mm / 2, Y hacia abajo), calibrado. */
function nookSketch(values: Record<string, unknown>) {
  const parts = getTemplate('nicho').build(values as never, { material: 'mdf-laca' });
  const k = 0.5;
  const side = parts.find((x) => x.id === 'costado-frente')!;
  const P = side.plane.o[2];
  const toPx = ([x, z]: V2): V2 => [x * k, -z * k];
  const outline = side.profile.map(([u, v]) => toPx([u, v + P]));
  const L = Math.max(...side.profile.map((q) => q[0]));
  const H = Math.max(...side.profile.map((q) => q[1])) + P;
  const div = parts.find((x) => x.id === 'division');
  const els: SketchEl[] = [
    { id: 'contorno', kind: 'poly', closed: true, pts: outline },
    { id: 'zocalo', kind: 'poly', closed: true, pts: [[40, 0], [L - 40, 0], [L - 40, P], [40, P]].map((q) => toPx(q as V2)) },
    { id: 'cota-l', kind: 'dim', a: toPx([0, -120]), b: toPx([L, -120]) },
    { id: 'cota-h', kind: 'dim', a: toPx([-120, 0]), b: toPx([-120, H]) },
  ];
  if (div) els.push({ id: 'division', kind: 'poly', closed: false, pts: [toPx([div.plane.o[0], P + 18]), toPx([div.plane.o[0], H])] });
  return { elements: els, mmPerPx: 1 / k, calibrated: true, underlayOpacity: 0.5 };
}
