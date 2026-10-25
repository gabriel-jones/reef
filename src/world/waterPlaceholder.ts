import * as THREE from 'three/webgpu';
import { HALF_X, HALF_Z, WORLD } from '../config';
import { seabedHeight } from './seabedProfile';

const WALL_OFFSET = 0.01;

/** Flat stand-in for the FFT ocean (Phase 1): surface plus cross-section walls clipped to the seabed. */
export function createWaterPlaceholder(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water-placeholder';

  const mat = new THREE.MeshPhysicalNodeMaterial({
    color: 0x2fb7c4,
    roughness: 0.05,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const surface = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, 1, 1).rotateX(-Math.PI / 2), mat);
  surface.position.y = WORLD.seaLevel;
  group.add(surface);

  const positions: number[] = [];
  const indices: number[] = [];
  const edges: Array<[number, number, number, number, number, number]> = [
    [-HALF_X, HALF_Z, HALF_X, HALF_Z, 0, 1],
    [HALF_X, -HALF_Z, -HALF_X, -HALF_Z, 0, -1],
    [HALF_X, HALF_Z, HALF_X, -HALF_Z, 1, 0],
    [-HALF_X, -HALF_Z, -HALF_X, HALF_Z, -1, 0],
  ];
  for (const [x0, z0, x1, z1, nx, nz] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(len * 2);
    const base = positions.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const floor = Math.min(seabedHeight(x, z), WORLD.seaLevel);
      positions.push(x + nx * WALL_OFFSET, WORLD.seaLevel, z + nz * WALL_OFFSET, x + nx * WALL_OFFSET, floor, z + nz * WALL_OFFSET);
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  wallGeo.setIndex(indices);
  wallGeo.computeVertexNormals();
  group.add(new THREE.Mesh(wallGeo, mat));

  return group;
}

/** Faint acrylic frame around the slab. */
export function createFrame(): THREE.LineSegments {
  const top = 0.6;
  const b = WORLD.baseY;
  const c = [
    [-HALF_X, -HALF_Z],
    [HALF_X, -HALF_Z],
    [HALF_X, HALF_Z],
    [-HALF_X, HALF_Z],
  ];
  const pts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i];
    const [bx, bz] = c[(i + 1) % 4];
    pts.push(ax, top, az, bx, top, bz);
    pts.push(ax, b, az, bx, b, bz);
    pts.push(ax, b, az, ax, top, az);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicNodeMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.35 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'acrylic-frame';
  return lines;
}
