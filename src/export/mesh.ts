import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { Material, Part } from '../core/types';
import { partsToGroup } from '../viewer';

const group = (parts: Part[], materials: Material[]) => { const g = partsToGroup(parts, materials, false); g.updateMatrixWorld(true); return g; };

export const toOBJ = (parts: Part[], m: Material[]) => new OBJExporter().parse(group(parts, m));
export const toSTL = (parts: Part[], m: Material[]) => new STLExporter().parse(group(parts, m), { binary: true }) as DataView;
export async function toGLB(parts: Part[], m: Material[]): Promise<ArrayBuffer> {
  return (await new GLTFExporter().parseAsync(yUpMeters(group(parts, m)), { binary: true })) as ArrayBuffer;
}
/** USDZ para AR Quick Look en iPad/iPhone: ver el producto a escala real en el espacio. */
export async function toUSDZ(parts: Part[], m: Material[]): Promise<Uint8Array> {
  return new USDZExporter().parseAsync(yUpMeters(group(parts, m)));
}
function yUpMeters(g: THREE.Group) {
  const root = new THREE.Group();
  root.add(g);
  g.scale.setScalar(0.001);
  g.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  return root;
}
