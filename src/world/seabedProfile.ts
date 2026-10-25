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

export function shoreX(z: number): number {
  return -27 + fbm(z * 0.06, 3.1) * 3;
}

/** Lagoon patch reefs: knolls of reef framework rising off the sand (x, z, radius m, relief m). */
export const PATCH_REEFS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-3, 14, 5, 1.6],
  [4, -10, 6.5, 2.0],
  [10, 15, 4.5, 1.5],
  [15, -2, 5.5, 2.2],
  [-6, -3, 3.5, 1.1],
  [19, -17, 4, 1.8],
  [6, 4, 3, 1.2],
  [-12, -15, 2.6, 0.8],
  [35, -15, 4.5, 2.6],
  [34, 18, 5, 2.4],
];

/** Normalised distance to the nearest patch-reef edge with a lobed, noisy outline (<1 inside). */
function patchDistance(x: number, z: number): { d: number; relief: number } {
  let best = { d: 9, relief: 0 };
  for (const [px, pz, r, relief] of PATCH_REEFS) {
    const a = Math.atan2(z - pz, x - px);
    const lobes = 1 + fbm(Math.cos(a) * 1.3 + px, Math.sin(a) * 1.3 + pz, 3) * 0.45;
    const d = Math.hypot(x - px, z - pz) / (r * lobes);
    if (d < best.d) best = { d, relief };
  }
  return best;
}

/** Patch-reef mound height (m). */
function moundHeight(x: number, z: number): number {
  const { d, relief } = patchDistance(x, z);
  if (d >= 1.25) return 0;
  const dome = Math.max(1 - d * d, 0) ** 0.6;
  const skirt = smoothstep(1.25, 0.8, d) * 0.25;
  return (dome * (0.8 + fbm(x * 0.4, z * 0.4, 3) * 0.5) + skirt) * relief;
}

function boilerRing(x: number, z: number): number {
  const r = Math.hypot(x - BOILER.x, (z - BOILER.z) * 1.15);
  return Math.exp(-((r - BOILER.radius) ** 2) / (2 * BOILER.width ** 2));
}

export function seabedHeight(x: number, z: number): number {
  const sx = shoreX(z);

  // Beach rises gently onto land, shallows fall away to the patch-reef floor.
  const beach = smoothstep(sx, -HALF_X, x) * 2.2;
  const shelf = -smoothstep(sx, -6, x) * 3.6;
  const deep = -smoothstep(10, HALF_X, x) * 5.5;
  const mounds = moundHeight(x, z);

  const ripples = fbm(x * 0.35, z * 0.35, 3) * 0.18;
  const base = beach + shelf + deep + mounds + ripples;

  // Boiler: a ring of algal reef whose crest nearly breaches the surface.
  const ring = boilerRing(x, z);
  const crest = -0.35 + fbm(x * 0.5, z * 0.5, 3) * 0.35;
  return base + (crest - base) * ring;
}

/** 0 = bare sand, 1 = hard reef framework (patch-reef mounds and the boiler rim). */
export function reefDensity(x: number, z: number): number {
  const mound = smoothstep(1.1, 0.75, patchDistance(x, z).d);
  const boiler = smoothstep(0.25, 0.75, boilerRing(x, z));
  const breakup = fbm(x * 0.6 + 11, z * 0.6 - 5, 3);
  return Math.min(Math.max(Math.max(mound, boiler) * (0.85 + breakup * 0.6), 0), 1);
}

/** Turtle-grass meadow coverage in the shallows, 0..1. */
export function seagrassDensity(x: number, z: number): number {
  const depth = -seabedHeight(x, z);
  const band = smoothstep(0.4, 1.0, depth) * (1 - smoothstep(3.4, 4.4, depth));
  const patches = smoothstep(-0.3, 0.05, fbm(x * 0.07 - 2, z * 0.1 + 9, 4));
  // Meadows also ring the patch reefs at a sand halo's distance (grazers crop the halo itself).
  const halo = smoothstep(1.25, 1.6, patchDistance(x, z).d);
  return band * patches * halo * (1 - reefDensity(x, z)) * (1 - smoothstep(-2, 6, x));
}

export { fbm, smoothstep };
