import * as THREE from 'three/webgpu';
import { color, mix, positionWorld, smoothstep, sin, float, normalWorld, abs } from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import { seabedHeight } from './seabedProfile';

const SEG_PER_METRE = 3;

function buildTop(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, WORLD.sizeX * SEG_PER_METRE, WORLD.sizeZ * SEG_PER_METRE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, seabedHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Vertical cross-section walls from the terrain edge down to the slab base. */
function buildSkirt(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const edges: Array<{ from: [number, number]; to: [number, number]; n: [number, number]; len: number }> = [
    { from: [-HALF_X, HALF_Z], to: [HALF_X, HALF_Z], n: [0, 1], len: WORLD.sizeX },
    { from: [HALF_X, -HALF_Z], to: [-HALF_X, -HALF_Z], n: [0, -1], len: WORLD.sizeX },
    { from: [HALF_X, HALF_Z], to: [HALF_X, -HALF_Z], n: [1, 0], len: WORLD.sizeZ },
    { from: [-HALF_X, -HALF_Z], to: [-HALF_X, HALF_Z], n: [-1, 0], len: WORLD.sizeZ },
  ];

  for (const e of edges) {
    const steps = e.len * SEG_PER_METRE;
    const base = positions.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = e.from[0] + (e.to[0] - e.from[0]) * t;
      const z = e.from[1] + (e.to[1] - e.from[1]) * t;
      positions.push(x, seabedHeight(x, z), z, x, WORLD.baseY, z);
      normals.push(e.n[0], 0, e.n[1], e.n[0], 0, e.n[1]);
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

export function createSeabed(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'seabed';

  const y = positionWorld.y;

  const topMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
  const drySand = color(0xf3d9cf);
  const wetSand = color(0xd9b3a5);
  const deepSand = color(0xcfc2ae);
  const sandByHeight = mix(mix(deepSand, wetSand, smoothstep(-4, -0.2, y)), drySand, smoothstep(0.1, 0.6, y));
  const steep = float(1).sub(abs(normalWorld.y)).mul(4).clamp(0, 1);
  topMat.colorNode = mix(sandByHeight, color(0xa79d8a), steep);

  const skirtMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const strata = sin(y.mul(3.1).add(sin(positionWorld.x.mul(0.21).add(positionWorld.z.mul(0.17))).mul(0.8))).mul(0.5).add(0.5);
  skirtMat.colorNode = mix(color(0xb9a48f), color(0xd8c3ae), strata).mul(mix(float(0.55), float(1), smoothstep(WORLD.baseY, 0, y)));

  const top = new THREE.Mesh(buildTop(), topMat);
  top.receiveShadow = true;
  top.castShadow = true;
  top.name = 'seabed-top';

  const skirt = new THREE.Mesh(buildSkirt(), skirtMat);
  skirt.receiveShadow = true;
  skirt.name = 'seabed-skirt';

  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ).rotateX(Math.PI / 2), skirtMat);
  bottom.position.y = WORLD.baseY;

  group.add(top, skirt, bottom);
  return group;
}
