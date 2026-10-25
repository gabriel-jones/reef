import * as THREE from 'three/webgpu';
import { HALF_X, HALF_Z } from '../config';
import { seabedHeight } from '../world/seabedProfile';

const _v = new THREE.Vector3();

/**
 * Top-surface height on a grid: the seabed, raised wherever meshes have been splatted onto it.
 * Used to seat corals on rock and to keep the fauna above everything solid.
 */
export class HeightField {
  private readonly nx: number;
  private readonly nz: number;
  private readonly data: Float32Array;

  constructor(private readonly cell = 0.5, from?: HeightField) {
    this.nx = Math.ceil((HALF_X * 2) / cell) + 1;
    this.nz = Math.ceil((HALF_Z * 2) / cell) + 1;
    if (from && from.cell === cell) {
      this.data = from.data.slice();
      return;
    }
    this.data = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) this.data[j * this.nx + i] = seabedHeight(-HALF_X + i * cell, -HALF_Z + j * cell);
  }

  clone(): HeightField {
    return new HeightField(this.cell, this);
  }

  at(x: number, z: number): number {
    const fx = Math.min(Math.max((x + HALF_X) / this.cell, 0), this.nx - 1.001);
    const fz = Math.min(Math.max((z + HALF_Z) / this.cell, 0), this.nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const d = this.data;
    const a = d[j * this.nx + i];
    const b = d[j * this.nx + i + 1];
    const c = d[(j + 1) * this.nx + i];
    const e = d[(j + 1) * this.nx + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }

  /** Raise the field to the top of a mesh placed with `matrix`. */
  splat(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const w = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(matrix);
      w[k * 3] = (_v.x + HALF_X) / this.cell;
      w[k * 3 + 1] = _v.y;
      w[k * 3 + 2] = (_v.z + HALF_Z) / this.cell;
    }
    const { nx, nz, data } = this;
    const raise = (i: number, j: number, y: number) => {
      if (i < 0 || j < 0 || i >= nx || j >= nz) return;
      const o = j * nx + i;
      if (y > data[o]) data[o] = y;
    };
    // Vertices catch triangles smaller than a cell.
    for (let k = 0; k < n; k++) raise(Math.round(w[k * 3]), Math.round(w[k * 3 + 2]), w[k * 3 + 1]);

    const index = geo.getIndex();
    const tris = index ? index.count / 3 : n / 3;
    for (let t = 0; t < tris; t++) {
      const a = (index ? index.getX(t * 3) : t * 3) * 3;
      const b = (index ? index.getX(t * 3 + 1) : t * 3 + 1) * 3;
      const c = (index ? index.getX(t * 3 + 2) : t * 3 + 2) * 3;
      const ax = w[a], ay = w[a + 1], az = w[a + 2];
      const bx = w[b], by = w[b + 1], bz = w[b + 2];
      const cx = w[c], cy = w[c + 1], cz = w[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(Math.ceil(Math.min(ax, bx, cx)), 0), i1 = Math.min(Math.floor(Math.max(ax, bx, cx)), nx - 1);
      const j0 = Math.max(Math.ceil(Math.min(az, bz, cz)), 0), j1 = Math.min(Math.floor(Math.max(az, bz, cz)), nz - 1);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const l1 = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / det;
          const l2 = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          raise(i, j, l1 * ay + l2 * by + l3 * cy);
        }
    }
  }
}
