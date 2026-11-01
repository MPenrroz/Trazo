import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bounds3, normal } from './core/geom';
import { partLayers } from './core/pockets';
import type { Material, Part } from './core/types';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // Z arriba, como Rhino

/** Geometría three.js de una pieza (perfil extruido, con cajeados) en coordenadas de mundo. */
export function partGeometry(p: Part): THREE.BufferGeometry {
  const geoms = partLayers(p).map((l) => {
    const shape = new THREE.Shape(l.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of l.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const lg = new THREE.ExtrudeGeometry(shape, { depth: l.w1 - l.w0, bevelEnabled: false, curveSegments: 1 });
    lg.translate(0, 0, l.w0);
    return lg;
  });
  const g = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false)!;
  const n = normal(p.plane);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...p.plane.x), new THREE.Vector3(...p.plane.y), new THREE.Vector3(...n));
  m.setPosition(...p.plane.o);
  g.applyMatrix4(m);
  return g;
}

export function partsToGroup(parts: Part[], materials: Material[], edges = true): THREE.Group {
  const group = new THREE.Group();
  const mats = new Map<string, THREE.Material>();
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.55 });
  const refMat = new THREE.MeshStandardMaterial({ color: 0x8f9aa1, transparent: true, opacity: 0.22, depthWrite: false, roughness: 1 });
  for (const p of parts) {
    if (p.process === 'ref') {
      // contexto (cama existente): volumen translúcido sin sombras
      const g = partGeometry(p);
      const mesh = new THREE.Mesh(g, refMat);
      mesh.name = p.name; mesh.userData = { partId: p.id, role: p.role, ref: true };
      if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), new THREE.LineBasicMaterial({ color: 0x6b767d, transparent: true, opacity: 0.5 })));
      group.add(mesh);
      continue;
    }
    if (!mats.has(p.material)) {
      const m = materials.find((x) => x.id === p.material);
      mats.set(p.material, new THREE.MeshStandardMaterial({ color: m?.color ?? '#ddd', roughness: 0.75, metalness: p.material === 'aluminio' ? 0.6 : 0, transparent: p.material === 'acrilico', opacity: p.material === 'acrilico' ? 0.6 : 1 }));
    }
    const g = partGeometry(p);
    const mesh = new THREE.Mesh(g, mats.get(p.material));
    mesh.name = p.name;
    mesh.userData = { partId: p.id, role: p.role };
    mesh.castShadow = mesh.receiveShadow = true;
    if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), lineMat));
    group.add(mesh);
  }
  return group;
}

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group = new THREE.Group();
  private ro: ResizeObserver;
  private raf = 0;
  private explode = 0;
  private framed = false;
  private ground: THREE.Mesh;

  constructor(private el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, 10, 100000);
    this.camera.position.set(3000, -3500, 2200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#eef0f2');
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2000, -3000, 5000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4000, right: 4000, top: 4000, bottom: -4000, near: 100, far: 20000 });
    this.scene.add(sun);
    const grid = new THREE.GridHelper(10000, 100, 0xb5bac0, 0xd6d9dd);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.ShadowMaterial({ opacity: 0.18 }));
    this.ground.receiveShadow = true;
    this.ground.position.z = -0.5;
    this.scene.add(this.ground);
    this.scene.add(this.group);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setParts(parts: Part[], materials: Material[], refit = false) {
    this.group.clear();
    this.group.add(partsToGroup(parts, materials));
    this.applyExplode();
    if (!this.framed || refit) { this.frame(parts); this.framed = true; }
  }

  frame(parts: Part[]) {
    const b = bounds3(parts);
    const c = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    // distancia para que la esfera envolvente quepa tanto en vertical como en horizontal (iPhone en vertical)
    const rs = Math.max(Math.hypot(...b.size) / 2, 150);
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect);
    const dist = (rs / Math.sin(Math.min(vf, hf))) * 1.05;
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(1.3, -1.7, 1.0).normalize().multiplyScalar(dist));
    this.camera.updateProjectionMatrix();
  }

  setExplode(f: number) { this.explode = f; this.applyExplode(); }
  private applyExplode() {
    const root = this.group.children[0];
    if (!root) return;
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    for (const m of root.children as THREE.Mesh[]) {
      m.geometry.computeBoundingBox();
      const pc = m.geometry.boundingBox!.getCenter(new THREE.Vector3());
      m.position.copy(pc.sub(c).multiplyScalar(this.explode));
    }
  }

  snapshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }

  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
