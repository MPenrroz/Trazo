import { analyse } from '../core/analysis';
import { resolveValues } from '../core/params';
import { getTemplate } from '../core/templates';
import type { ParamValues, Part } from '../core/types';
import { download, shareOrDownload, slug } from '../export/download';
import { toUSDZ } from '../export/mesh';
import { buildSpec, type ProductSpec } from '../export/spec';
import { h, money, paramControl, toast } from '../ui';
import { Viewer } from '../viewer';

export function partsFromSpec(spec: ProductSpec, values: ParamValues): Part[] {
  return getTemplate(spec.template).build(values, { material: spec.materialId, profile: spec.profile });
}

/**
 * Paso 6 · Tienda: vista del cliente final. Solo ve los parámetros que el arquitecto expuso, dentro de sus rangos.
 * Funciona con el proyecto actual o con un producto publicado: #/tienda?producto=<id> → productos/<id>.json
 */
export function shopView(root: HTMLElement, query: URLSearchParams) {
  let viewer: Viewer | null = null;
  let disposed = false;
  const box = h('div', { class: 'page shop' }, h('p', { class: 'muted' }, 'Cargando producto…'));
  root.append(box);

  const id = query.get('producto');
  const load: Promise<ProductSpec> = id
    ? fetch(`productos/${encodeURIComponent(id)}.json`).then((r) => { if (!r.ok) throw new Error(`No existe productos/${id}.json`); return r.json(); })
    : Promise.resolve(buildSpec());

  load.then((spec) => {
    if (disposed) return;
    const method = spec.fab.methods.find((m) => m.id === spec.methodId) ?? spec.fab.methods[0];
    const material = spec.fab.materials.find((m) => m.id === spec.materialId) ?? spec.fab.materials[0];
    const initial: ParamValues = { ...spec.defaults };
    for (const d of spec.params) if (d.exposed && query.has(d.key)) initial[d.key] = query.get(d.key)!;
    let values = resolveValues(spec.params, initial);

    const priceEl = h('div', { class: 'price' });
    const dimsEl = h('div', { class: 'dims' });
    const viewerEl = h('div', { class: 'viewer' });
    const update = (refit = false) => {
      const parts = partsFromSpec(spec, values);
      viewer?.setParts(parts, spec.fab.materials, refit);
      const a = analyse(parts, method, material, { pricing: spec.pricing });
      priceEl.textContent = money(a.cost.price, spec.pricing.currency);
      const blocked = a.checks.some((c) => c.level === 'error');
      dimsEl.replaceChildren(h('span', null, `${a.size[0]} × ${a.size[1]} × ${a.size[2]} mm`), h('span', null, `${material.name} · ~${a.weightKg.toFixed(0)} kg`),
        blocked ? h('span', { class: 'chk error' }, 'Esta combinación no es fabricable') : h('span', { class: 'ok-txt' }, 'Fabricado a pedido'));
      buy.disabled = blocked;
      const q = new URLSearchParams(id ? { producto: id } : {});
      for (const d of spec.params) if (d.exposed) q.set(d.key, String(values[d.key]));
      history.replaceState(null, '', `#/tienda?${q}`);
      return { parts, a };
    };

    const exposed = spec.params.filter((d) => d.exposed);
    const controls = h('div', { class: 'shop-params' }, ...exposed.map((d) => paramControl(d, values[d.key], (v) => { values = resolveValues(spec.params, { ...values, [d.key]: v }); update(); })));

    const buy = h('button', { class: 'buy', onclick: () => {
      const { parts, a } = update();
      const order = { format: 'trazo-order@1', product: spec.id, name: spec.name, values, price: a.cost.price, currency: spec.pricing.currency, size: a.size, cutList: a.cutList, parts, createdAt: new Date().toISOString() };
      download(JSON.stringify(order, null, 2), `pedido-${slug(spec.name)}.json`, 'application/json');
      toast('Pedido generado (demo). Conecta aquí tu checkout: Shopify, WooCommerce, Stripe…');
    } }, 'Agregar al carro');

    const ar = h('button', { class: 'ghost', onclick: async () => {
      const usdz = await toUSDZ(partsFromSpec(spec, values), spec.fab.materials);
      const blob = new Blob([usdz], { type: 'model/vnd.usdz+zip' });
      // AR Quick Look (Safari iOS/iPadOS) se activa con <a rel="ar"> conteniendo una <img>
      const a = h('a', { rel: 'ar', href: URL.createObjectURL(blob), download: `${slug(spec.name)}.usdz` }, h('img', { alt: '', src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }));
      document.body.appendChild(a); a.click(); a.remove();
    } }, 'Ver en mi espacio (AR)');

    const share = h('button', { class: 'ghost', onclick: async () => {
      const url = location.href;
      if (navigator.share) navigator.share({ title: spec.name, url }).catch(() => 0);
      else { await navigator.clipboard?.writeText(url); toast('Enlace de configuración copiado'); }
    } }, 'Compartir configuración');

    box.replaceChildren(
      h('div', { class: 'shop-hero' },
        h('div', { class: 'shop-visual' },
          h('div', { class: 'viewer-wrap' }, viewerEl),
          spec.hero ? h('img', { class: 'hero-thumb', src: spec.hero, alt: '' }) : null),
        h('div', { class: 'shop-info' },
          h('small', { class: 'eyebrow' }, 'Diseño configurable'),
          h('h1', null, spec.name),
          spec.description ? h('p', null, spec.description) : null,
          spec.functions.length ? h('ul', { class: 'feat' }, ...spec.functions.map((f) => h('li', null, f))) : null,
          h('h4', null, 'Configura tu pieza'),
          exposed.length ? controls : h('p', { class: 'muted' }, 'El arquitecto aún no expone parámetros (Modelo → Reglas para tienda).'),
          dimsEl, priceEl,
          h('div', { class: 'row wrap' }, buy, ar, share),
          !id ? h('div', { class: 'publish' },
            h('p', { class: 'muted' }, 'Vista previa del proyecto actual. Para publicarlo: descarga la especificación, súbela al repositorio en public/productos/ y comparte #/tienda?producto=<nombre>.'),
            h('button', { class: 'ghost', onclick: () => shareOrDownload(JSON.stringify(buildSpec(false, true), null, 2), `${slug(spec.name)}.json`, 'application/json') }, 'Descargar especificación para publicar')) : null)));
    requestAnimationFrame(() => { if (disposed) return; viewer = new Viewer(viewerEl); update(true); });
  }).catch((e) => box.replaceChildren(h('p', { class: 'chk error' }, String(e.message ?? e))));

  return () => { disposed = true; viewer?.dispose(); };
}
