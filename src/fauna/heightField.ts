import { HALF_X, HALF_Z } from '../config';
import { seabedHeight } from '../world/seabedProfile';

/** Seabed height cached on a grid, for the many per-frame lookups the fauna steering makes. */
export class HeightField {
  private readonly nx: number;
  private readonly nz: number;
  private readonly data: Float32Array;

  constructor(private readonly cell = 0.5) {
    this.nx = Math.ceil((HALF_X * 2) / cell) + 1;
    this.nz = Math.ceil((HALF_Z * 2) / cell) + 1;
    this.data = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) this.data[j * this.nx + i] = seabedHeight(-HALF_X + i * cell, -HALF_Z + j * cell);
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
}
