import * as THREE from 'three/webgpu';
import { HALF_X, HALF_Z, WORLD } from '../config';

const RIM_HEIGHT = 1.2;

/** Faint acrylic frame around the slab. */
export function createFrame(): THREE.LineSegments {
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
    pts.push(ax, RIM_HEIGHT, az, bx, RIM_HEIGHT, bz);
    pts.push(ax, b, az, bx, b, bz);
    pts.push(ax, b, az, ax, RIM_HEIGHT, az);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicNodeMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.35 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'acrylic-frame';
  return lines;
}
