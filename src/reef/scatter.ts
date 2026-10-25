import * as THREE from 'three/webgpu';
import { HALF_X, HALF_Z } from '../config';
import { seabedHeight } from '../world/seabedProfile';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groundNormal(x: number, z: number, e = 0.35): THREE.Vector3 {
  const dx = seabedHeight(x + e, z) - seabedHeight(x - e, z);
  const dz = seabedHeight(x, z + e) - seabedHeight(x, z - e);
  return new THREE.Vector3(-dx, 2 * e, -dz).normalize();
}

/** Uniform-grid occupancy so large objects keep apart from each other. */
export class Occupancy {
  private cells = new Map<string, Array<{ x: number; z: number; r: number }>>();
  constructor(private cell = 2) {}

  private key(ix: number, iz: number): string {
    return `${ix},${iz}`;
  }

  free(x: number, z: number, r: number): boolean {
    const span = Math.ceil((r + 3) / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        for (const o of this.cells.get(this.key(cx + i, cz + j)) ?? []) {
          if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
        }
      }
    }
    return true;
  }

  add(x: number, z: number, r: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push({ x, z, r });
  }
}

export interface Placement {
  variant: number;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

export interface ScatterRule {
  count: number;
  variants: number;
  /** Probability of accepting a candidate at (x, z). */
  density: (x: number, z: number, y: number) => number;
  scale: [number, number];
  /** Footprint radius at scale 1, for occupancy (0 = ignore occupancy). */
  radius: number;
  /** 0 = upright, 1 = fully follow the ground normal. */
  alignToGround: number;
  /** Sink into the ground, metres per unit scale. */
  sink?: number;
  /** Extra random tilt in radians. */
  tilt?: number;
  /** Fixed yaw (e.g. fans face the surge) plus jitter. */
  yaw?: (x: number, z: number, rnd: () => number) => number;
  colors?: THREE.ColorRepresentation[];
  region?: { x0: number; x1: number; z0?: number; z1?: number };
  margin?: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export function scatter(rule: ScatterRule, rnd: () => number, occ: Occupancy): Placement[] {
  const out: Placement[] = [];
  const margin = rule.margin ?? 0.8;
  const region = rule.region ?? { x0: -HALF_X, x1: HALF_X };
  const x0 = Math.max(region.x0, -HALF_X + margin);
  const x1 = Math.min(region.x1, HALF_X - margin);
  const z0 = Math.max(region.z0 ?? -HALF_Z, -HALF_Z + margin);
  const z1 = Math.min(region.z1 ?? HALF_Z, HALF_Z - margin);
  const q = new THREE.Quaternion();
  const tiltQ = new THREE.Quaternion();
  const yawQ = new THREE.Quaternion();
  const palette = rule.colors?.map((c) => new THREE.Color(c));

  for (let attempt = 0; attempt < rule.count * 60 && out.length < rule.count; attempt++) {
    const x = x0 + rnd() * (x1 - x0);
    const z = z0 + rnd() * (z1 - z0);
    const y = seabedHeight(x, z);
    if (rnd() > rule.density(x, z, y)) continue;
    const s = rule.scale[0] + rnd() * (rule.scale[1] - rule.scale[0]);
    const r = rule.radius * s;
    if (r > 0 && !occ.free(x, z, r)) continue;
    if (r > 0) occ.add(x, z, r);

    const n = groundNormal(x, z, Math.max(r * 0.6, 0.25));
    const up = UP.clone().lerp(n, rule.alignToGround).normalize();
    q.setFromUnitVectors(UP, up);
    const tilt = rule.tilt ?? 0;
    if (tilt > 0) {
      tiltQ.setFromAxisAngle(new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize(), (rnd() - 0.5) * 2 * tilt);
      q.multiply(tiltQ);
    }
    yawQ.setFromAxisAngle(UP, rule.yaw ? rule.yaw(x, z, rnd) : rnd() * Math.PI * 2);
    q.multiply(yawQ);

    const pos = new THREE.Vector3(x, y - (rule.sink ?? 0) * s, z);
    const matrix = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s));
    const color = palette ? palette[Math.floor(rnd() * palette.length)].clone().offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.08) : undefined;
    out.push({ variant: Math.floor(rnd() * rule.variants), matrix, color });
  }
  return out;
}
