import * as THREE from 'three/webgpu';
import { loadGltf } from '../core/assets';
import { HALF_X, HALF_Z } from '../config';
import { reefDensity, seabedHeight, seagrassDensity, shoreX, smoothstep } from '../world/seabedProfile';
import type { ReefMaterials } from './reefMaterials';
import { mulberry32, Occupancy, scatter, type Placement, type ScatterRule } from './scatter';

interface Family {
  file: string;
  prefix: string;
  material: THREE.Material;
  rule: ScatterRule;
  castShadow?: boolean;
}

async function variantGeometries(file: string, prefix: string): Promise<THREE.BufferGeometry[]> {
  const gltf = await loadGltf(file);
  gltf.scene.updateMatrixWorld(true);
  const found: Array<{ name: string; geo: THREE.BufferGeometry }> = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && o.name.startsWith(prefix)) {
      const geo = mesh.geometry.clone();
      // Quantized (normalized int16) attributes would clamp once the dequantization transform is baked in.
      for (const name of ['position', 'normal']) {
        const a = geo.getAttribute(name);
        if (!a) continue;
        const out = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
        geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
      }
      geo.applyMatrix4(mesh.matrixWorld);
      found.push({ name: o.name, geo });
    }
  });
  found.sort((a, b) => a.name.localeCompare(b.name));
  if (!found.length) throw new Error(`no meshes '${prefix}*' in ${file}`);
  return found.map((f) => f.geo);
}

function instanced(geo: THREE.BufferGeometry, material: THREE.Material, list: Placement[], name: string, castShadow: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(list.length, 1));
  mesh.name = name;
  list.forEach((p, i) => {
    mesh.setMatrixAt(i, p.matrix);
    if (p.color) mesh.setColorAt(i, p.color);
  });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Turtle grass: a clump of strap-like blades. uv.x = blade id, uv.y = 0 base … 1 tip. */
function seagrassClump(rnd: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const blades = 5;
  const rows = 5;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const ox = Math.cos(a) * 0.035;
    const oz = Math.sin(a) * 0.035;
    const len = 0.22 + rnd() * 0.2;
    const lean = rnd() * Math.PI * 2;
    const lx = Math.cos(lean);
    const lz = Math.sin(lean);
    const face = lean + Math.PI / 2 + (rnd() - 0.5) * 0.6;
    const wx = Math.cos(face) * 0.0055;
    const wz = Math.sin(face) * 0.0055;
    const base = positions.length / 3;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const bend = t * t * len * 0.35;
      const x = ox + lx * bend;
      const z = oz + lz * bend;
      const y = t * len * (1 - t * 0.12);
      const taper = r === rows - 1 ? 0.35 : 1;
      positions.push(x - wx * taper, y, z - wz * taper, x + wx * taper, y, z + wz * taper);
      uvs.push(b / blades, t, b / blades, t);
    }
    for (let r = 0; r < rows - 1; r++) {
      const i = base + r * 2;
      indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function seagrass(materials: ReefMaterials, rnd: () => number): THREE.InstancedMesh {
  const geo = seagrassClump(rnd);
  const list: Placement[] = [];
  const target = 12000;
  const q = new THREE.Quaternion();
  for (let i = 0; i < target * 12 && list.length < target; i++) {
    const x = -HALF_X + 0.5 + rnd() * (HALF_X * 2 - 1);
    const z = -HALF_Z + 0.5 + rnd() * (HALF_Z * 2 - 1);
    if (rnd() > seagrassDensity(x, z)) continue;
    const s = 0.75 + rnd() * 0.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    list.push({ variant: 0, matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, seabedHeight(x, z) - 0.02, z), q, new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s)) });
  }
  return instanced(geo, materials.seagrass(), list, 'seagrass', false);
}

export async function createReef(materials: ReefMaterials, seed = 4242): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'reef';
  const rnd = mulberry32(seed);
  const occ = new Occupancy(2);

  const submerged = (y: number, min = 0.8) => smoothstep(min, min + 0.6, -y);
  const onReef = (x: number, z: number, sand = 0) => smoothstep(0.3, 0.65, reefDensity(x, z)) + sand;
  const surgeYaw = (_x: number, _z: number, r: () => number) => {
    const d = materials.currentDir.value;
    return Math.atan2(d.x, d.z) + (r() - 0.5) * 0.6;
  };

  const limestone = materials.rock('limestone');
  const families: Family[] = [
    {
      file: 'rocks',
      prefix: 'limestone_',
      material: limestone,
      rule: { count: 40, variants: 4, scale: [0.55, 1.15], radius: 1.5, alignToGround: 0.8, sink: 0.25, tilt: 0.12, density: (x, z, y) => onReef(x, z, 0.004) * submerged(y, 0.6) },
    },
    {
      file: 'rocks',
      prefix: 'limestone_',
      material: materials.rock('boulder'),
      // Eroded aeolianite boulders straddling the waterline along the beach.
      rule: { count: 9, variants: 3, scale: [0.6, 1.2], radius: 1.6, alignToGround: 0.6, sink: 0.35, tilt: 0.25, region: { x0: -34, x1: -20 }, density: (x, z, y) => smoothstep(1.2, 0.2, Math.abs(y - 0.1)) * 0.5 * (Math.abs(x - shoreX(z)) < 5 ? 1 : 0) },
    },
    {
      file: 'corals',
      prefix: 'star_coral_',
      material: materials.starCoral(),
      rule: { count: 38, variants: 3, scale: [0.7, 1.3], radius: 1.0, alignToGround: 0.35, sink: 0.12, tilt: 0.1, colors: ['#ffffff', '#e8f0d0', '#f2dcc0', '#d8e4c0'], density: (x, z, y) => onReef(x, z) ** 1.5 * submerged(y, 1.2) },
    },
    {
      file: 'corals',
      prefix: 'brain_coral_',
      material: materials.brainCoral(),
      rule: { count: 70, variants: 3, scale: [0.6, 1.4], radius: 0.6, alignToGround: 0.45, sink: 0.05, tilt: 0.12, colors: ['#ffffff', '#f0e6c0', '#e0ecc8', '#f6d8b0'], density: (x, z, y) => onReef(x, z, 0.004) * submerged(y, 0.9) },
    },
    {
      file: 'gorgonians',
      prefix: 'sea_fan_',
      material: materials.seaFan(),
      rule: { count: 95, variants: 3, scale: [0.7, 1.3], radius: 0.35, alignToGround: 0.15, tilt: 0.1, yaw: surgeYaw, colors: ['#8a3a8c', '#9b4a9e', '#7a3070', '#a05a9a', '#c8a040'], density: (x, z, y) => onReef(x, z) * submerged(y, 1.0) },
    },
    {
      file: 'gorgonians',
      prefix: 'sea_rod_',
      material: materials.branching(1.0, 0.05),
      rule: { count: 85, variants: 3, scale: [0.8, 1.3], radius: 0.3, alignToGround: 0.1, tilt: 0.12, colors: ['#6b4a3a', '#7a5a48', '#5a3d4a', '#8a6a50'], density: (x, z, y) => onReef(x, z, 0.006) * submerged(y, 1.0) },
    },
    {
      file: 'gorgonians',
      prefix: 'sea_plume_',
      material: materials.branching(1.2, 0.1),
      rule: { count: 40, variants: 2, scale: [0.8, 1.2], radius: 0.35, alignToGround: 0.1, tilt: 0.1, colors: ['#9a7aa0', '#8a6a58', '#b09ab8'], density: (x, z, y) => onReef(x, z) * submerged(y, 1.6) },
    },
    {
      file: 'rocks',
      prefix: 'cobble_',
      material: limestone,
      castShadow: false,
      rule: { count: 170, variants: 2, scale: [0.6, 1.5], radius: 0.25, alignToGround: 1, sink: 0.06, density: (x, z, y) => (onReef(x, z) * 0.6 + smoothstep(0.1, 0.35, reefDensity(x, z)) * 0.4 + 0.004) * submerged(y, 0.3) },
    },
    {
      file: 'shore_plants',
      prefix: 'palmetto_',
      material: materials.plant(4),
      rule: { count: 8, variants: 3, scale: [0.85, 1.15], radius: 2.2, alignToGround: 0, margin: 2, region: { x0: -40, x1: -30 }, density: (_x, _z, y) => (y > 1.2 ? 0.8 : 0) },
    },
    {
      file: 'shore_plants',
      prefix: 'sea_grape_',
      material: materials.plant(1.5),
      rule: { count: 14, variants: 2, scale: [0.8, 1.3], radius: 1.1, alignToGround: 0.3, sink: 0.05, margin: 1.2, region: { x0: -40, x1: -27 }, density: (_x, _z, y) => (y > 0.55 && y < 2 ? 0.8 : 0) },
    },
  ];

  const geoCache = new Map<string, Promise<THREE.BufferGeometry[]>>();
  const geos = await Promise.all(
    families.map((f) => {
      const key = `${f.file}/${f.prefix}`;
      if (!geoCache.has(key)) geoCache.set(key, variantGeometries(f.file, f.prefix));
      return geoCache.get(key)!;
    }),
  );

  families.forEach((f, fi) => {
    const placements = scatter(f.rule, rnd, occ);
    const variants = geos[fi];
    variants.forEach((geo, vi) => {
      const list = placements.filter((p) => p.variant === vi);
      if (list.length) group.add(instanced(geo, f.material, list, `${f.prefix}${vi}`, f.castShadow ?? true));
    });
  });
  group.add(seagrass(materials, rnd));
  return group;
}
