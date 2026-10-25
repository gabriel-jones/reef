import * as THREE from 'three/webgpu';
import { attribute, color, mix, positionWorld, smoothstep, sin, float, normalWorldGeometry, abs, texture } from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import { reefDensity, seabedHeight, seagrassDensity } from './seabedProfile';
import type { UnderwaterLighting } from '../underwater/underwaterLighting';
import type { ReefMaterials } from '../reef/reefMaterials';

const SEG_PER_METRE = 3;

function buildTop(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, WORLD.sizeX * SEG_PER_METRE, WORLD.sizeZ * SEG_PER_METRE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const reef = new Float32Array(pos.count);
  const grass = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, seabedHeight(x, z));
    reef[i] = reefDensity(x, z);
    grass[i] = seagrassDensity(x, z);
  }
  geo.setAttribute('aReef', new THREE.BufferAttribute(reef, 1));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
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

export function createSeabed(underwater: UnderwaterLighting, materials: ReefMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'seabed';

  const y = positionWorld.y;

  const topMat = new THREE.MeshStandardNodeMaterial();
  const drySand = color(0xf3d9cf);
  const shallowSand = color(0xeacfc2);
  const deepSand = color(0xd8c9b6);
  const sandByHeight = mix(deepSand, shallowSand, smoothstep(-5, -0.5, y));
  // The swash zone stays damp: darker, glossier sand just above the waterline.
  const wet = smoothstep(0.42, 0.12, y).mul(smoothstep(-0.4, 0.05, y));
  const surface = mix(mix(sandByHeight, drySand, smoothstep(0.0, 0.5, y)), color(0xc9a597), wet.mul(0.7));
  const steep = float(1).sub(abs(normalWorldGeometry.y)).mul(4).clamp(0, 1);
  const sand = mix(surface, color(0xa79d8a), steep);

  // Hard reef framework shows through the sand where the reef density is high, with a ragged edge.
  const crust = materials.crustLayer();
  const edgeNoise = texture(materials.tex.crust.arm, positionWorld.xz.mul(0.09)).g;
  const reefMask = smoothstep(0.35, 0.65, attribute<'float'>('aReef', 'float').add(edgeNoise.sub(0.5).mul(0.5)));
  // Under a meadow the bed is dark with detritus and the blade canopy, which reads from afar where blades are sub-pixel.
  const meadow = smoothstep(0.05, 0.6, attribute<'float'>('aGrass', 'float')).mul(mix(float(0.75), float(1), edgeNoise));
  topMat.colorNode = mix(mix(sand, color(0x3e4a22), meadow.mul(0.8)), crust.albedo, reefMask);
  topMat.roughnessNode = mix(mix(float(0.93), float(0.38), wet), crust.rough, reefMask);
  topMat.normalNode = materials.toView(mix(materials.sandNormal(), crust.normal, reefMask).normalize());
  underwater.apply(topMat);

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
