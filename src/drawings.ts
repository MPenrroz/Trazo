import { bounds2, bounds3, dot, normal, round, toWorld } from './core/geom';
import { placedProfile, type NestResult } from './core/nesting';
import type { Part, Project, SketchDoc, V2, V3 } from './core/types';

type View = 'front' | 'top' | 'left';
const VIEW_LABEL: Record<View, string> = { front: 'ALZADO FRONTAL', top: 'PLANTA', left: 'VISTA LATERAL IZQ.' };

/** Proyección (sistema europeo / ISO E). Devuelve [u, v, profundidad desde el observador]. */
function proj(view: View, p: V3): [number, number, number] {
  if (view === 'front') return [p[0], p[2], p[1]];
  if (view === 'top') return [p[0], p[1], -p[2]];
  return [-p[1], p[2], p[0]];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const SCALES = [1, 2, 5, 10, 15, 20, 25, 30, 50, 75, 100];

interface Faces { pts: V2[]; depth: number }

function faces(p: Part, view: View): Faces[] {
  const out: Faces[] = [];
  const ring = (w: number) => p.profile.map(([u, v]) => proj(view, toWorld(p.plane, u, v, w)));
  const a = ring(0), b = ring(p.thickness);
  const avg = (r: [number, number, number][]) => r.reduce((s, q) => s + q[2], 0) / r.length;
  out.push({ pts: a.map((q) => [q[0], q[1]]), depth: avg(a) }, { pts: b.map((q) => [q[0], q[1]]), depth: avg(b) });
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length, quad = [a[i], a[j], b[j], b[i]];
    out.push({ pts: quad.map((q) => [q[0], q[1]]), depth: avg(quad) });
  }
  return out;
}

function dimH(x0: number, x1: number, y: number, text: string, off: number) {
  const yy = y + off;
  return `<g class="dim"><line x1="${x0}" y1="${y}" x2="${x0}" y2="${yy + Math.sign(off) * 1.5}"/><line x1="${x1}" y1="${y}" x2="${x1}" y2="${yy + Math.sign(off) * 1.5}"/>`
    + `<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" marker-start="url(#tick)" marker-end="url(#tick)"/>`
    + `<text x="${(x0 + x1) / 2}" y="${yy - 1}" text-anchor="middle">${text}</text></g>`;
}
function dimV(y0: number, y1: number, x: number, text: string, off: number) {
  const xx = x + off;
  return `<g class="dim"><line x1="${x}" y1="${y0}" x2="${xx + Math.sign(off) * 1.5}" y2="${y0}"/><line x1="${x}" y1="${y1}" x2="${xx + Math.sign(off) * 1.5}" y2="${y1}"/>`
    + `<line x1="${xx}" y1="${y0}" x2="${xx}" y2="${y1}" marker-start="url(#tick)" marker-end="url(#tick)"/>`
    + `<text transform="translate(${xx - 1} ${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle">${text}</text></g>`;
}

/** Intervalos libres entre piezas de un eje (luces entre repisas, módulos…). */
function chain(parts: Part[], axis: 0 | 1 | 2, min: number, max: number): number[] {
  const n: V3 = [0, 0, 0]; n[axis] = 1;
  const edges = new Set<number>([round(min, 1), round(max, 1)]);
  for (const p of parts) {
    if (Math.abs(dot(normal(p.plane), n)) < 0.9) continue;
    const c = p.plane.o[axis], c2 = c + p.thickness * Math.sign(dot(normal(p.plane), n));
    edges.add(round(Math.min(c, c2), 1)); edges.add(round(Math.max(c, c2), 1));
  }
  return [...edges].sort((a, b) => a - b);
}

export type OverlayView = View;
export interface DrawingOpts { sketchOverlay?: boolean; overlayOpacity?: number; overlayView?: View }

export function technicalDrawing(project: Project, allParts: Part[], opts: DrawingOpts = {}): string {
  const parts = allParts.filter((p) => p.process !== 'ref'); // la referencia no va en los planos
  const W = 420, H = 297; // A3 horizontal
  const b = bounds3(parts);
  const [sx, sy, sz] = b.size;
  const availW = 300, availH = 225;
  const scaleN = SCALES.find((n) => (sx + sy) / n + 50 <= availW && (sz + sy) / n + 50 <= availH) ?? 200;
  const s = 1 / scaleN;
  const gap = 28;
  // posiciones (mm de papel) de las esquinas inferiores-izquierdas de cada vista
  // Sistema europeo (ISO E): alzado arriba, planta debajo, vista lateral izquierda a la derecha.
  const fx = 30, fy = 22 + sz * s; // fy = borde inferior del alzado
  const origin: Record<View, [number, number]> = {
    front: [fx, fy],
    top: [fx, fy + gap + sy * s],
    left: [fx + sx * s + gap, fy],
  };
  const vb: Record<View, { u0: number; v0: number }> = {
    front: { u0: b.min[0], v0: b.min[2] },
    top: { u0: b.min[0], v0: b.min[1] },
    left: { u0: -b.max[1], v0: b.min[2] },
  };
  const toPaper = (view: View, u: number, v: number): V2 => [origin[view][0] + (u - vb[view].u0) * s, origin[view][1] - (v - vb[view].v0) * s];

  let body = '';
  for (const view of ['front', 'top', 'left'] as View[]) {
    const all = parts.flatMap((p) => faces(p, view)).sort((a, c) => c.depth - a.depth);
    body += `<g class="view">` + all.map((f) => `<polygon points="${f.pts.map(([u, v]) => toPaper(view, u, v).map((n) => n.toFixed(2)).join(',')).join(' ')}"/>`).join('') + `</g>`;
    // cajeados/ranuras en línea oculta (segmentada) cuando su cara mira hacia la vista
    const vdir: V3 = view === 'front' ? [0, 1, 0] : view === 'top' ? [0, 0, 1] : [1, 0, 0];
    body += `<g class="hidden">` + parts.flatMap((p) => (Math.abs(dot(normal(p.plane), vdir)) > 0.9 ? p.pockets ?? [] : []).map((k) => {
      const w = k.face === 'base' ? k.depth : p.thickness - k.depth;
      const pts = k.outline.map(([u, v]) => { const q = proj(view, toWorld(p.plane, u, v, w)); return toPaper(view, q[0], q[1]).map((n) => n.toFixed(2)).join(','); });
      return `<polygon points="${pts.join(' ')}"/>`;
    })).join('') + `</g>`;
    const [ox, oy] = origin[view];
    const wv = (view === 'left' ? sy : sx) * s, hv = (view === 'top' ? sy : sz) * s;
    body += `<text class="vlabel" x="${ox}" y="${oy + (view === 'top' ? 7 : 17)}">${VIEW_LABEL[view]}</text>`;
    if (view === 'front') {
      body += dimH(ox, ox + wv, oy, `${round(sx, 0)}`, 9);
      body += dimV(oy - hv, oy, ox, `${round(sz, 0)}`, -9);
      // cadena vertical (luces entre piezas horizontales)
      const zs = chain(parts, 2, b.min[2], b.max[2]);
      for (let i = 0; i < zs.length - 1; i++) {
        const d = zs[i + 1] - zs[i];
        if (d < 25) continue;
        const [, y0] = toPaper('front', 0, zs[i]), [, y1] = toPaper('front', 0, zs[i + 1]);
        body += dimV(y1, y0, ox + wv, `${round(d, 0)}`, 7);
      }
      const xs = chain(parts, 0, b.min[0], b.max[0]);
      for (let i = 0; i < xs.length - 1; i++) {
        const d = xs[i + 1] - xs[i];
        if (d < 25 || xs.length > 30) continue;
        const [x0] = toPaper('front', xs[i], 0), [x1] = toPaper('front', xs[i + 1], 0);
        body += dimH(x0, x1, oy - hv, `${round(d, 0)}`, -5);
      }
    } else if (view === 'top') {
      body += dimV(oy - hv, oy, ox, `${round(sy, 0)}`, -9);
    } else {
      body += dimH(ox, ox + wv, oy, `${round(sy, 0)}`, 9);
    }
  }
  if (opts.sketchOverlay) {
    const v = opts.overlayView ?? 'front';
    const vw = (v === 'left' ? sy : sx) * s;
    body += sketchOverlay(project.sketch, origin[v], vw, s, v === 'left', opts.overlayOpacity ?? 0.5);
  }

  const date = new Date().toLocaleDateString('es-CL');
  const tb = `<g class="title">
    <rect x="${W - 110}" y="${H - 62}" width="100" height="52"/>
    <line x1="${W - 110}" y1="${H - 48}" x2="${W - 10}" y2="${H - 48}"/>
    <line x1="${W - 110}" y1="${H - 34}" x2="${W - 10}" y2="${H - 34}"/>
    <line x1="${W - 110}" y1="${H - 22}" x2="${W - 10}" y2="${H - 22}"/>
    <line x1="${W - 60}" y1="${H - 34}" x2="${W - 60}" y2="${H - 10}"/>
    <text class="big" x="${W - 107}" y="${H - 52}">${esc(project.name)}</text>
    <text x="${W - 107}" y="${H - 39}">${esc(project.fab.materials.find((m) => m.id === project.materialId)?.name ?? '')} · e=${[...new Set(parts.map((p) => p.thickness))].join('/')} mm</text>
    <text x="${W - 107}" y="${H - 26}">ESCALA 1:${scaleN}</text><text x="${W - 57}" y="${H - 26}">A3 · mm</text>
    <text x="${W - 107}" y="${H - 14}">${esc(project.author || 'Autor')}</text><text x="${W - 57}" y="${H - 14}">${date}</text>
    <text class="small" x="${W - 107}" y="${H - 64}">TRAZO · ${esc(project.fab.methods.find((m) => m.id === project.methodId)?.name ?? '')}</text>
  </g>`;
  const cut = cutTable(parts, W - 110, 20) + pocketNote(parts, W - 110, H - 80);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" class="sheet">
  <defs><marker id="tick" viewBox="-3 -3 6 6" markerWidth="6" markerHeight="6" orient="auto"><line x1="-2" y1="2" x2="2" y2="-2" stroke="#111" stroke-width="0.6"/></marker></defs>
  <style>
    .sheet{background:#fff;font-family:'Helvetica Neue',Arial,sans-serif}
    .view polygon{fill:#fff;stroke:#111;stroke-width:0.25;stroke-linejoin:round}
    .dim line{stroke:#333;stroke-width:0.18}.dim text{font-size:2.6px;fill:#111}
    .vlabel{font-size:3px;font-weight:700;letter-spacing:.3px;fill:#111}
    .title rect,.title line{fill:none;stroke:#111;stroke-width:0.35}.title text{font-size:2.8px;fill:#111}.title .big{font-size:4.2px;font-weight:700}.title .small{font-size:2.3px;fill:#555}
    .cut text{font-size:2.3px;fill:#111}.cut line{stroke:#999;stroke-width:0.12}.cut .h{font-weight:700}
    .frame{fill:none;stroke:#111;stroke-width:0.5}
    .hidden polygon{fill:none;stroke:#111;stroke-width:0.18;stroke-dasharray:1.2 0.8}
  </style>
  <rect width="${W}" height="${H}" fill="#fff"/>
  <rect class="frame" x="10" y="10" width="${W - 20}" height="${H - 20}"/>
  ${body}${cut}${tb}
</svg>`;
}

function pocketNote(parts: Part[], x: number, y: number): string {
  const ks = new Map<string, { n: number; depth: number }>();
  for (const p of parts) for (const k of p.pockets ?? []) { const e = ks.get(k.name); if (e) e.n++; else ks.set(k.name, { n: 1, depth: k.depth }); }
  if (!ks.size) return '';
  return `<g class="cut"><text class="h" x="${x}" y="${y}">MECANIZADOS (línea segmentada)</text>` + [...ks].map(([name, e], i) =>
    `<text x="${x}" y="${y + 4 + i * 4}">${esc(name)} · prof. ${e.depth} mm · ${e.n} pieza(s), cara interior</text>`).join('') + '</g>';
}

function cutTable(parts: Part[], x: number, y: number): string {
  const rows = new Map<string, { role: string; qty: number; w: number; h: number; t: number }>();
  for (const p of parts) {
    const bb = bounds2(p.profile);
    const w = round(Math.max(bb.w, bb.h), 0), h = round(Math.min(bb.w, bb.h), 0);
    const k = `${p.role}|${w}|${h}|${p.thickness}`;
    const r = rows.get(k); if (r) r.qty++; else rows.set(k, { role: p.role, qty: 1, w, h, t: p.thickness });
  }
  let out = `<g class="cut"><text class="h" x="${x}" y="${y}">DESPIECE</text>`;
  let yy = y + 5;
  out += `<text class="h" x="${x}" y="${yy}">Pieza</text><text class="h" x="${x + 40}" y="${yy}">Cant.</text><text class="h" x="${x + 52}" y="${yy}">Largo×Ancho×e</text>`;
  for (const r of [...rows.values()].slice(0, 40)) {
    yy += 4;
    out += `<line x1="${x}" y1="${yy - 3}" x2="${x + 100}" y2="${yy - 3}"/><text x="${x}" y="${yy}">${esc(r.role)}</text><text x="${x + 40}" y="${yy}">${r.qty}</text><text x="${x + 52}" y="${yy}">${r.w}×${r.h}×${r.t}</text>`;
  }
  return out + '</g>';
}

/** Boceto calibrado superpuesto al alzado para comparar intención vs. modelo. */
function sketchOverlay(sk: SketchDoc, origin: [number, number], viewW: number, s: number, mirror: boolean, opacity: number): string {
  if (!sk.calibrated) return '';
  // se alinea por el perfil elegido (o por todo lo dibujado, sin cotas)
  const ref = sk.elements.filter((e) => (sk.profileId ? e.id === sk.profileId : e.kind !== 'dim'));
  const pts = ref.flatMap((e) => (e.kind === 'circle' ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] as V2[] : e.kind === 'dim' ? [e.a, e.b] : e.pts));
  if (!pts.length && !sk.underlay) return '';
  const bb = pts.length ? bounds2(pts) : { x0: 0, y0: 0, x1: sk.underlaySize?.[0] ?? 0, y1: sk.underlaySize?.[1] ?? 0 };
  const k = sk.mmPerPx * s;
  // esquina inferior del boceto = esquina inferior de la vista. En la vista lateral izquierda el perfil
  // (dibujado en el plano YZ) se ve reflejado, por eso se espeja.
  const ty = origin[1] - bb.y1 * k;
  const tf = mirror ? `translate(${origin[0] + viewW + bb.x0 * k} ${ty}) scale(${-k} ${k})` : `translate(${origin[0] - bb.x0 * k} ${ty}) scale(${k})`;
  let g = `<g opacity="${opacity}" transform="${tf}">`;
  if (sk.underlay && sk.underlaySize) g += `<image href="${sk.underlay}" x="0" y="0" width="${sk.underlaySize[0]}" height="${sk.underlaySize[1]}"/>`;
  const sw = 0.35 / k;
  for (const e of sk.elements) {
    if (e.kind === 'circle') g += `<circle cx="${e.c[0]}" cy="${e.c[1]}" r="${e.r}" fill="none" stroke="#e5484d" stroke-width="${sw}"/>`;
    else if (e.kind !== 'dim') g += `<polyline points="${e.pts.map((p) => p.join(',')).join(' ')}${e.kind === 'poly' && e.closed ? ' ' + e.pts[0].join(',') : ''}" fill="none" stroke="#e5484d" stroke-width="${sw}" stroke-dasharray="${2 / k} ${1 / k}"/>`;
  }
  return g + '</g>';
}

/** Láminas de anidado (layout de corte) a escala. */
export function nestingDrawing(nr: NestResult): string {
  const [SW, SH] = nr.sheetSize;
  const pad = 60, gapY = 120;
  const H = nr.sheets * (SH + gapY) + pad;
  const W = SW + pad * 2;
  let g = '';
  for (let s = 0; s < nr.sheets; s++) {
    const oy = pad + s * (SH + gapY);
    g += `<text x="${pad}" y="${oy - 20}" class="lbl">Tablero ${s + 1} — ${SW}×${SH} mm</text><rect x="${pad}" y="${oy}" width="${SW}" height="${SH}" class="sheetr"/>`;
    for (const pl of nr.placements.filter((p) => p.sheet === s)) {
      const outer = placedProfile(pl, pl.part.profile).map(([x, y]) => `${pad + x},${oy + SH - y}`).join(' ');
      g += `<polygon points="${outer}" class="part"/>`;
      for (const h of pl.part.holes ?? []) g += `<polygon points="${placedProfile(pl, h).map(([x, y]) => `${pad + x},${oy + SH - y}`).join(' ')}" class="hole"/>`;
      for (const k of pl.part.pockets ?? []) {
        if (pl.flipped ? k.face !== 'base' : k.face !== 'top') continue;
        g += `<polygon points="${placedProfile(pl, k.outline).map(([x, y]) => `${pad + x},${oy + SH - y}`).join(' ')}" class="pocket"/>`;
      }
      const cx = pad + pl.x + pl.w / 2, cy = oy + SH - (pl.y + pl.h / 2);
      const fs = Math.max(18, Math.min(42, Math.min(pl.w, pl.h) / 5));
      g += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" class="pl">${esc(pl.part.name)}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="nest"><style>.sheetr{fill:#faf7f0;stroke:#666;stroke-width:3}.part{fill:#e9d8b4;stroke:#7a4b16;stroke-width:3}.hole{fill:#faf7f0;stroke:#7a4b16;stroke-width:3}.lbl{font:600 34px sans-serif;fill:#444}.pl{font-family:sans-serif;fill:#5a3a10}.pocket{fill:#c9b48b;stroke:#0e7a55;stroke-width:3}</style>${g}</svg>`;
}
