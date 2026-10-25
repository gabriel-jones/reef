/**
 * World conventions: Y up, 1 unit = 1 metre, sea level at y = 0.
 * The slab spans X (beach at -X, open sea at +X) and Z (front face at +Z).
 */
export const WORLD = {
  sizeX: 80,
  sizeZ: 50,
  seaLevel: 0,
  baseY: -12,
} as const;

export const HALF_X = WORLD.sizeX / 2;
export const HALF_Z = WORLD.sizeZ / 2;
