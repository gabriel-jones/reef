import { HALF_X } from '../config';

/**
 * Placeholder analytic seabed used until the Blender terrain lands in Phase 3.
 * Beach at -X, seagrass shallows, patch reef mid-slab, boiler reef ring near +X.
 */

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq) * amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export const BOILER = { x: 27, z: 4, radius: 5.5, width: 2.2 } as const;

export function seabedHeight(x: number, z: number): number {
  const shoreX = -27 + fbm(z * 0.06, 3.1) * 3;

  // Beach rises gently onto land, shallows fall away to the patch-reef floor.
  const beach = smoothstep(shoreX, -HALF_X, x) * 2.2;
  const shelf = -smoothstep(shoreX, -6, x) * 3.6;
  const deep = -smoothstep(10, HALF_X, x) * 5.5;

  // Patch-reef mounds in the middle of the slab.
  const mounds = Math.max(fbm(x * 0.09 + 7, z * 0.09 - 3, 3), 0) * 2.4 * smoothstep(-12, -4, x) * (1 - smoothstep(16, 22, x));

  // Boiler: a ring of algal reef that nearly breaches the surface.
  const r = Math.hypot(x - BOILER.x, (z - BOILER.z) * 1.15);
  const ring = Math.exp(-((r - BOILER.radius) ** 2) / (2 * BOILER.width ** 2));
  const boilerTop = -0.45 - (-3.6 - 5.5 * smoothstep(10, HALF_X, x));
  const boiler = ring * boilerTop * (0.85 + 0.15 * fbm(x * 0.4, z * 0.4, 2));

  const ripples = fbm(x * 0.35, z * 0.35, 3) * 0.18;

  return beach + shelf + deep + mounds + boiler + ripples;
}
