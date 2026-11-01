// Genera los productos de ejemplo publicados en public/productos/ (npx vite-node scripts/make-demo.ts)
import { writeFileSync } from 'node:fs';
import { newProject, store } from '../src/core/store';
import { buildSpec } from '../src/export/spec';

const demos = [
  { file: 'estanteria-demo', name: 'Librero Modular Trazo', template: 'estanteria', material: 'plywood-abedul',
    description: 'Librero de contrachapado de abedul fresado en CNC. Elige ancho, alto, profundidad y cantidad de repisas.',
    functions: ['Se arma sin herramientas con uniones encastradas', 'Módulos de ancho variable', 'Fondo opcional para usar como divisor de ambientes'] },
  { file: 'banco-costillas-demo', name: 'Banco Costilla', template: 'costillas', material: 'plywood-abedul',
    description: 'Banco formado por costillas a partir de un perfil dibujado a mano. Ajusta el largo y la densidad de costillas.',
    functions: ['Perfil ergonómico dibujado a mano', 'Largo a medida', 'Fabricación 100% CNC en tablero estándar'] },
];
for (const d of demos) {
  const p = newProject(d.name);
  Object.assign(p, { id: d.file, template: d.template, materialId: d.material, description: d.description, functions: d.functions, author: 'Trazo' });
  store.project = p;
  p.values = Object.fromEntries(store.template.params.map((q) => [q.key, q.default]));
  if (d.template === 'costillas') p.rules = { l: { min: 600, max: 2400 }, n: { min: 6, max: 30 } };
  writeFileSync(`public/productos/${d.file}.json`, JSON.stringify(buildSpec(false, false), null, 2));
  console.log('ok', d.file);
}
