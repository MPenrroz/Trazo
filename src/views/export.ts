import { analyse } from '../core/analysis';
import { store } from '../core/store';
import { technicalDrawing } from '../drawings';
import { download, shareManyOrDownload, shareOrDownload, slug } from '../export/download';
import { nestingDxf, sketchDxf } from '../export/dxf';
import { toGLB, toOBJ, toSTL, toUSDZ } from '../export/mesh';
import { export3dm } from '../export/rhino';
import { buildSpec } from '../export/spec';
import { card, h, toast } from '../ui';
import { backupProject } from '../backup';

/** Paso 7 · Entregables: Rhino, CNC, AR y especificación para la tienda / Grasshopper. */
export function exportView(root: HTMLElement) {
  const name = () => slug(store.project.name);
  const busy = (btn: HTMLButtonElement, fn: () => Promise<void>) => async () => {
    const t = btn.textContent; btn.disabled = true; btn.textContent = 'Generando…';
    try { await fn(); } catch (e) { console.error(e); toast(`Error: ${(e as Error).message}`, 'err'); } finally { btn.disabled = false; btn.textContent = t; }
  };
  const item = (title: string, desc: string, label: string, fn: () => Promise<void> | void, primary = false) => {
    const b = h('button', { class: primary ? '' : 'ghost' }, label);
    b.onclick = busy(b, async () => { await fn(); });
    return h('div', { class: 'exp' }, h('div', null, h('b', null, title), h('p', { class: 'muted' }, desc)), b);
  };
  const parts = () => store.parts();
  const mats = () => store.project.fab.materials;

  const analysis = () => analyse(parts(), store.method, store.material, store.project, store.project.fab.materials);
  const main = (icon: string, title: string, desc: string, label: string, fn: () => Promise<void>) => {
    const b = h('button', null, label);
    b.onclick = busy(b, fn);
    return h('div', { class: 'exp-main' }, h('span', { class: 'exp-ico' }, icon), h('b', null, title), h('p', { class: 'muted' }, desc), b);
  };
  const essentials = card('Lo esencial',
    h('div', { class: 'exp-grid' },
      main('▣', 'Para Rhino', 'Modelo .3dm con piezas por capa, perfiles de corte y parámetros. Ábrelo en Rhino en el computador.', 'Descargar .3dm', async () => {
        const a = analysis();
        await shareOrDownload(await export3dm(store.project, parts(), store.values, a.nest, buildSpec(false, false)), `${name()}.3dm`, 'application/octet-stream');
      }),
      main('✂', 'Para el taller', 'DXF de corte (piezas acomodadas en tableros) y la lámina de planos con cotas y despiece.', 'DXF + planos', async () => {
        await shareManyOrDownload([
          { data: nestingDxf(analysis().nest), name: `${name()}-corte.dxf`, type: 'application/dxf' },
          { data: technicalDrawing(store.project, parts()), name: `${name()}-planos.svg`, type: 'image/svg+xml' },
        ]);
      }),
      main('⟲', 'Respaldo', 'Todo el proyecto en un archivo .trazo para guardarlo en iCloud o abrirlo en otro dispositivo.', 'Respaldar', () => backupProject())));

  root.append(h('div', { class: 'page export' }, essentials, h('details', { class: 'more-formats' }, h('summary', null, 'Más formatos'), h('div', { class: 'export-cols' },
    h('div', { class: 'col' },
      card('Rhino',
        item('Modelo Rhino (.3dm)', 'Sólidos por capa y rol, perfiles CNC anidados, boceto de referencia y parámetros en DocumentUserText. Abre en Rhino 7/8 (Mac/Windows) o en el visor Rhino de iPad.', 'Descargar .3dm', async () => {
          const a = analyse(parts(), store.method, store.material, store.project, store.project.fab.materials);
          const bytes = await export3dm(store.project, parts(), store.values, a.nest, buildSpec(false, false));
          await shareOrDownload(bytes, `${name()}.3dm`, 'application/octet-stream');
        }, true),
        item('Especificación paramétrica (.json)', 'Parámetros, rangos, perfil y piezas en coordenadas de mundo. La lee el script de Rhino/Grasshopper y la tienda.', 'Descargar spec', () => shareOrDownload(JSON.stringify(buildSpec(true, false), null, 2), `${name()}.trazo-spec.json`, 'application/json')),
        item('Script Rhino / Grasshopper (Python 3)', 'Reconstruye el producto desde el spec en Rhino 8 (ScriptEditor) o dentro de un componente Python de Grasshopper para seguir parametrizando.', 'trazo_rhino.py', async () => { const r = await fetch('rhino/trazo_rhino.py'); download(await r.text(), 'trazo_rhino.py', 'text/x-python'); })),
      card('Fabricación',
        item('Corte CNC / láser (.dxf)', 'Piezas anidadas por tablero en capas CORTE_EXTERIOR / CORTE_INTERIOR / ETIQUETAS, en mm.', 'DXF de corte', () => download(nestingDxf(analyse(parts(), store.method, store.material, store.project, store.project.fab.materials).nest), `${name()}-corte.dxf`, 'application/dxf')),
        item('Planos técnicos (.svg)', 'Lámina A3 con vistas, cotas y despiece. Importable en Rhino, Illustrator o Morpholio.', 'SVG', () => download(technicalDrawing(store.project, parts()), `${name()}-planos.svg`, 'image/svg+xml')),
        item('Boceto vectorizado (.dxf)', 'Las líneas limpias de tu boceto, a escala real.', 'DXF boceto', () => download(sketchDxf(store.project.sketch), `${name()}-boceto.dxf`, 'application/dxf')),
        item('Impresión 3D (.stl)', 'Malla del conjunto para maqueta a escala o piezas impresas.', 'STL', () => download(toSTL(parts(), mats()).buffer as ArrayBuffer, `${name()}.stl`, 'model/stl')))),
    h('div', { class: 'col' },
      card('Visualización',
        item('Realidad aumentada (.usdz)', 'Abre con AR Quick Look en iPad/iPhone para ver el producto a escala 1:1 en el espacio.', 'USDZ', async () => shareOrDownload(await toUSDZ(parts(), mats()), `${name()}.usdz`, 'model/vnd.usdz+zip')),
        item('Web / render (.glb)', 'Para Keyshot, Blender, Sketchfab, ShapeDiver o la web.', 'GLB', async () => download(await toGLB(parts(), mats()), `${name()}.glb`, 'model/gltf-binary')),
        item('Malla (.obj)', 'Formato universal.', 'OBJ', () => download(toOBJ(parts(), mats()), `${name()}.obj`, 'text/plain'))),
      card('Proyecto',
        item('Proyecto Trazo completo (.trazo.json)', 'Incluye boceto, referencias, reglas y fabricación. Guárdalo en iCloud Drive para pasarlo entre iPad y computador.', 'Exportar proyecto', () => backupProject(), true)),
      card('Flujo sugerido iPad ↔ Rhino', h('ol', { class: 'steps' },
        h('li', null, 'Dibuja en Procreate/Concepts → comparte PNG a Trazo (o pega con ⌘V).'),
        h('li', null, 'Calca con tinta inteligente, calibra escala y elige el perfil.'),
        h('li', null, 'Ajusta parámetros y verifica factibilidad + costo.'),
        h('li', null, 'Descarga .3dm + spec a iCloud Drive → ábrelo en Rhino en el computador.'),
        h('li', null, 'Refina en Rhino/Grasshopper (uniones, cantos, herrajes) con trazo_rhino.py.'),
        h('li', null, 'Publica el spec en la tienda con los rangos del arquitecto.'))))))));
}
