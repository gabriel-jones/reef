import * as THREE from 'three/webgpu';
import { loadGltf } from '../core/assets';
import { HALF_X, HALF_Z } from '../config';
import { PATCH_REEFS, reefDensity } from '../world/seabedProfile';
import { variantGeometries, type ReefSurfaces } from '../reef/reef';
import { mulberry32 } from '../reef/scatter';
import type { UnderwaterLighting } from '../underwater/underwaterLighting';
import { FaunaMaterials, loadVat, type Swimmer } from './faunaMaterials';
import type { HeightField } from './heightField';

const SURFACE_CLEARANCE = 0.45;
const WALL = 1.2;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

type Behaviour = 'graze' | 'hover' | 'roam' | 'pair';

interface Species {
  name: string;
  length: number;
  count: number;
  groupSize: number;
  behaviour: Behaviour;
  cruise: number;
  maxSpeed: number;
  /** Height band above the local seabed (m). */
  band: [number, number];
  /** Wander radius around the group's home (m). */
  range: number;
  scale: [number, number];
}

const SPECIES: Species[] = [
  { name: 'sergeant_major', length: 0.16, count: 48, groupSize: 12, behaviour: 'hover', cruise: 0.22, maxSpeed: 0.8, band: [0.6, 2.4], range: 2.5, scale: [0.8, 1.15] },
  { name: 'blue_tang', length: 0.22, count: 27, groupSize: 9, behaviour: 'roam', cruise: 0.45, maxSpeed: 1.2, band: [0.3, 1.4], range: 3.5, scale: [0.8, 1.15] },
  { name: 'queen_angelfish', length: 0.3, count: 6, groupSize: 2, behaviour: 'pair', cruise: 0.3, maxSpeed: 1.0, band: [0.3, 1.2], range: 4, scale: [0.85, 1.15] },
  { name: 'french_angelfish', length: 0.32, count: 6, groupSize: 2, behaviour: 'pair', cruise: 0.3, maxSpeed: 1.0, band: [0.3, 1.4], range: 4, scale: [0.85, 1.15] },
  { name: 'parrotfish', length: 0.45, count: 12, groupSize: 3, behaviour: 'graze', cruise: 0.4, maxSpeed: 1.3, band: [0.25, 1.0], range: 4.5, scale: [0.75, 1.2] },
];

/** Patch reefs deep enough to host fish (reef top a metre or more below the surface). */
function fishReefs(h: HeightField): Array<{ x: number; z: number; r: number }> {
  return PATCH_REEFS.filter(([x, z]) => h.at(x, z) < -1.3).map(([x, z, r]) => ({ x, z, r }));
}

interface Agent {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dir: THREE.Vector3;
  target: THREE.Vector3;
  timer: number;
  group: number;
  scale: number;
  phase: number;
  roll: number;
  /** Grazing parrotfish hold nose-down at the bed for a few seconds. */
  pause: number;
}

function newAgent(pos: THREE.Vector3, group: number, scale: number, rnd: () => number): Agent {
  const a = rnd() * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  return { pos, vel: dir.clone().multiplyScalar(0.1), dir, target: pos.clone(), timer: 0, group, scale, phase: rnd() * 6.28, roll: 0, pause: 0 };
}

/**
 * Soft boundaries: walls, surface, and everything solid below. With a velocity and look-ahead time it
 * also feels for reef rising ahead and steers up and around it. Returns a steering acceleration.
 */
function bounds(p: THREE.Vector3, h: HeightField, clearance: number, out: THREE.Vector3, vx = 0, vz = 0, look = 0): THREE.Vector3 {
  out.set(0, 0, 0);
  const lim = (v: number, half: number) => (v > half - WALL ? -(v - half + WALL) : v < -half + WALL ? -half + WALL - v : 0);
  out.x = lim(p.x, HALF_X) * 3;
  out.z = lim(p.z, HALF_Z) * 3;
  const bed = h.at(p.x, p.z) + clearance;
  if (p.y < bed) out.y += (bed - p.y) * 6;
  if (look > 0) {
    const ax = p.x + vx * look;
    const az = p.z + vz * look;
    const block = h.at(ax, az) + clearance - p.y;
    if (block > 0) {
      const e = 0.25;
      const gx = (h.at(ax + e, az) - h.at(ax - e, az)) / (2 * e);
      const gz = (h.at(ax, az + e) - h.at(ax, az - e)) / (2 * e);
      out.x -= gx * block * 4;
      out.z -= gz * block * 4;
      out.y += block * 5;
    }
  }
  const top = -SURFACE_CLEARANCE;
  if (p.y > top) out.y -= (p.y - top) * 6;
  return out;
}

/** Lowest a body may sit: clear of whatever is under its head, middle and tail. */
function floorUnder(h: HeightField, x: number, z: number, dx: number, dz: number, half: number, clearance: number): number {
  return Math.max(h.at(x, z), h.at(x + dx * half, z + dz * half), h.at(x - dx * half, z - dz * half)) + clearance;
}

/** Orientation from heading with limited pitch and a bank into turns. */
function orient(dir: THREE.Vector3, roll: number, maxPitch: number, out: THREE.Quaternion): THREE.Quaternion {
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = -Math.asin(THREE.MathUtils.clamp(dir.y / Math.max(dir.length(), 1e-6), -Math.sin(maxPitch), Math.sin(maxPitch)));
  _e.set(pitch, yaw, roll);
  return out.setFromEuler(_e);
}

/** One species as an InstancedMesh, with the per-instance swim/orientation attributes the shader reads. */
class FishSchool {
  readonly mesh: THREE.InstancedMesh;
  readonly agents: Agent[] = [];
  protected readonly swim: THREE.InstancedBufferAttribute;
  protected readonly orient: THREE.InstancedBufferAttribute;

  constructor(geo: THREE.BufferGeometry, mats: FaunaMaterials, readonly name: string, readonly length: number, count: number) {
    geo = geo.clone();
    this.swim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.orient = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.swim.setUsage(THREE.DynamicDrawUsage);
    this.orient.setUsage(THREE.DynamicDrawUsage);
    const material = mats.fish(name, length, this.swim, this.orient);
    this.mesh = new THREE.InstancedMesh(geo, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = `fish-${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Tail-beat frequency follows speed (U ≈ 0.7·L·f), with a floor for hovering fin sculling. */
  protected writeInstance(i: number, a: Agent, dt: number, cruise: number, maxPitch = 0.45): void {
    const speed = a.vel.length();
    const L = this.length * a.scale;
    const freq = 0.9 + speed / (0.7 * L) * 0.55;
    a.phase = (a.phase + dt * freq * Math.PI * 2) % (Math.PI * 200);
    const amp = 0.035 + 0.09 * Math.min(speed / cruise, 1.6);
    orient(a.dir, a.roll, maxPitch, _q);
    _s.setScalar(a.scale);
    _m.compose(a.pos, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.swim.setXYZW(i, a.phase, amp, a.scale, 0);
    this.orient.setXYZW(i, _q.x, _q.y, _q.z, _q.w);
  }

  protected flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
    this.orient.needsUpdate = true;
  }

  /** Turn the heading toward the velocity, banking with the yaw rate. */
  protected steerHeading(a: Agent, dt: number, minSpeed = 0.03): void {
    const speed = a.vel.length();
    if (speed < minSpeed) return;
    _v.copy(a.vel).divideScalar(speed);
    const before = Math.atan2(a.dir.x, a.dir.z);
    a.dir.lerp(_v, 1 - Math.exp(-dt * 5)).normalize();
    let dyaw = Math.atan2(a.dir.x, a.dir.z) - before;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const targetRoll = THREE.MathUtils.clamp((-dyaw / Math.max(dt, 1e-3)) * 0.25, -0.5, 0.5);
    a.roll += (targetRoll - a.roll) * (1 - Math.exp(-dt * 4));
  }
}

class ReefSchool extends FishSchool {
  private homes: Array<{ x: number; z: number; r: number }>;
  private groupHome: number[] = [];
  private groupTimer: number[] = [];

  constructor(geo: THREE.BufferGeometry, mats: FaunaMaterials, readonly sp: Species, private h: HeightField, reefs: Array<{ x: number; z: number; r: number }>, private rnd: () => number) {
    super(geo, mats, sp.name, sp.length, sp.count);
    this.homes = reefs;
    const groups = Math.ceil(sp.count / sp.groupSize);
    for (let g = 0; g < groups; g++) {
      this.groupHome.push(Math.floor(rnd() * reefs.length));
      this.groupTimer.push(30 + rnd() * 40);
    }
    for (let i = 0; i < sp.count; i++) {
      const g = Math.floor(i / sp.groupSize);
      const home = reefs[this.groupHome[g]];
      const p = this.pickTarget(home, new THREE.Vector3());
      const scale = sp.scale[0] + rnd() * (sp.scale[1] - sp.scale[0]);
      this.agents.push(newAgent(p, g, scale, rnd));
    }
  }

  private pickTarget(home: { x: number; z: number; r: number }, out: THREE.Vector3, bed = false): THREE.Vector3 {
    const a = this.rnd() * Math.PI * 2;
    const r = Math.sqrt(this.rnd()) * Math.min(this.sp.range, home.r * 1.1);
    const x = home.x + Math.cos(a) * r;
    const z = home.z + Math.sin(a) * r;
    const ground = this.h.at(x, z);
    const [lo, hi] = this.sp.band;
    const y = bed ? ground + 0.08 * this.sp.length / 0.45 + 0.05 : ground + lo + this.rnd() * (hi - lo);
    return out.set(x, Math.min(y, -SURFACE_CLEARANCE - 0.2), z);
  }

  update(dt: number, camera: THREE.Vector3, threats: THREE.Vector3[]): void {
    const sp = this.sp;
    for (let g = 0; g < this.groupTimer.length; g++) {
      this.groupTimer[g] -= dt;
      if (sp.behaviour === 'roam' && this.groupTimer[g] < 0) {
        this.groupHome[g] = Math.floor(this.rnd() * this.homes.length);
        this.groupTimer[g] = 35 + this.rnd() * 40;
      }
    }
    // group centroids for cohesion
    const centres: THREE.Vector3[] = this.groupHome.map(() => new THREE.Vector3());
    const counts = this.groupHome.map(() => 0);
    for (const a of this.agents) {
      centres[a.group].add(a.pos);
      counts[a.group]++;
    }
    centres.forEach((c, g) => c.divideScalar(Math.max(counts[g], 1)));

    const acc = new THREE.Vector3();
    this.agents.forEach((a, i) => {
      const home = this.homes[this.groupHome[a.group]];
      a.timer -= dt;
      const leader = sp.behaviour === 'pair' && i % 2 === 1 ? this.agents[i - 1] : null;
      if (leader) {
        // partner trails its mate by a body length or two, offset to one side
        _v.set(-leader.dir.z, 0, leader.dir.x).multiplyScalar(0.35).addScaledVector(leader.dir, -0.45);
        a.target.copy(leader.pos).add(_v);
      } else if (a.pause > 0) {
        a.pause -= dt;
      } else if (a.timer < 0 || a.pos.distanceToSquared(a.target) < 0.15) {
        const grazing = sp.behaviour === 'graze' && this.rnd() < 0.55;
        this.pickTarget(home, a.target, grazing);
        a.timer = (sp.behaviour === 'hover' ? 3 : 6) + this.rnd() * 8;
        if (grazing) a.timer += 100;
      }
      if (sp.behaviour === 'graze' && a.timer > 50 && a.pos.distanceTo(a.target) < 0.25 && a.pause <= 0) {
        a.pause = 1.5 + this.rnd() * 3;
        a.timer = 0.5;
      }

      // seek
      acc.subVectors(a.target, a.pos);
      const dist = acc.length();
      const desiredSpeed = (leader ? Math.min(dist * 1.5, sp.maxSpeed) : Math.min(sp.cruise * (0.6 + Math.min(dist, 2) * 0.4), sp.maxSpeed)) * (a.pause > 0 ? 0.05 : 1);
      if (dist > 1e-4) acc.multiplyScalar(desiredSpeed / dist);
      acc.sub(a.vel).multiplyScalar(1.6);

      // cohesion / separation within the group
      if (sp.behaviour !== 'pair') acc.addScaledVector(_v.subVectors(centres[a.group], a.pos), sp.behaviour === 'roam' ? 0.25 : 0.08);
      for (let j = 0; j < this.agents.length; j++) {
        if (j === i) continue;
        const b = this.agents[j];
        _v.subVectors(a.pos, b.pos);
        const d2 = _v.lengthSq();
        const r = (this.length * 1.4) ** 2;
        if (d2 < r && d2 > 1e-8) acc.addScaledVector(_v, (1 / Math.sqrt(d2)) * 0.25);
      }
      // flee the diver and predators
      for (const t of [camera, ...threats]) {
        _v.subVectors(a.pos, t);
        const d = _v.length();
        const radius = t === camera ? 1.4 : 2.5;
        if (d < radius && d > 1e-4) {
          acc.addScaledVector(_v, ((radius - d) / d) * 3);
          a.pause = 0;
        }
      }
      acc.add(bounds(a.pos, this.h, 0.12, _w, a.vel.x, a.vel.z, 0.8));

      a.vel.addScaledVector(acc, dt);
      const sp2 = a.vel.length();
      if (sp2 > sp.maxSpeed) a.vel.multiplyScalar(sp.maxSpeed / sp2);
      a.pos.addScaledVector(a.vel, dt);
      const floor = floorUnder(this.h, a.pos.x, a.pos.z, a.dir.x, a.dir.z, this.length * a.scale * 0.5, 0.05);
      if (a.pos.y < floor) {
        a.pos.y = floor;
        if (a.vel.y < 0) a.vel.y = 0;
      }
      this.steerHeading(a, dt);
      // grazers tip nose-down onto the rock
      if (a.pause > 0) a.dir.y += (-0.9 - a.dir.y) * (1 - Math.exp(-dt * 3));
      this.writeInstance(i, a, dt, sp.cruise, a.pause > 0 ? 0.75 : 0.4);
    });
    this.flush();
  }
}

/**
 * Bait-fish ball: boids anchored to a slowly drifting centre, scattering from predators and the
 * diver. Hundreds of fish per school, so state lives in flat arrays and neighbours come from a
 * counting-sorted uniform grid rebuilt every frame.
 */
class BaitSchool extends FishSchool {
  readonly anchor = new THREE.Vector3();
  private anchorGoal = new THREE.Vector3();
  private anchorTimer = 0;
  private readonly n: number;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly cellOf: Int32Array;
  private readonly order: Int32Array;
  private cellStart = new Int32Array(1);
  private readonly cell = 0.6;

  constructor(geo: THREE.BufferGeometry, mats: FaunaMaterials, count: number, start: THREE.Vector3, private h: HeightField, private rnd: () => number) {
    super(geo, mats, 'bait', 0.09, count);
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.cellOf = new Int32Array(count);
    this.order = new Int32Array(count);
    this.anchor.copy(start);
    this.anchorGoal.copy(start);
    for (let i = 0; i < count; i++) {
      const a = newAgent(new THREE.Vector3((rnd() - 0.5) * 3, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 3).add(start), 0, 0.8 + rnd() * 0.4, rnd);
      this.agents.push(a);
      this.p.set([a.pos.x, a.pos.y, a.pos.z], i * 3);
      this.v.set([a.vel.x, a.vel.y, a.vel.z], i * 3);
    }
  }

  private pickAnchor(): void {
    for (let tries = 0; tries < 40; tries++) {
      const x = -8 + this.rnd() * 44;
      const z = -HALF_Z + 5 + this.rnd() * (HALF_Z * 2 - 10);
      const bed = this.h.at(x, z);
      if (bed > -2.6) continue;
      this.anchorGoal.set(x, THREE.MathUtils.lerp(bed + 1.0, -1.0, 0.3 + this.rnd() * 0.5), z);
      return;
    }
  }

  update(dt: number, camera: THREE.Vector3, threats: THREE.Vector3[]): void {
    this.anchorTimer -= dt;
    if (this.anchorTimer < 0 || this.anchor.distanceTo(this.anchorGoal) < 1) {
      this.pickAnchor();
      this.anchorTimer = 25 + this.rnd() * 30;
    }
    _v.subVectors(this.anchorGoal, this.anchor);
    const ad = _v.length();
    if (ad > 0.01) this.anchor.addScaledVector(_v, Math.min((0.35 * dt) / ad, 1));

    const { n, p, v, cell } = this;
    // grid over the school's bounding box (clamped so a scattered school can't blow it up)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const gx = Math.min(Math.floor((x1 - x0) / cell) + 1, 48);
    const gy = Math.min(Math.floor((y1 - y0) / cell) + 1, 24);
    const gz = Math.min(Math.floor((z1 - z0) / cell) + 1, 48);
    const cells = gx * gy * gz;
    if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
    const start = this.cellStart;
    start.fill(0, 0, cells + 1);
    const ci = (x: number, y: number, z: number) => {
      const i = Math.min(Math.floor((x - x0) / cell), gx - 1);
      const j = Math.min(Math.floor((y - y0) / cell), gy - 1);
      const k = Math.min(Math.floor((z - z0) / cell), gz - 1);
      return (k * gy + j) * gx + i;
    };
    for (let i = 0; i < n; i++) {
      const c = ci(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      this.cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = this.order;
    const cursor = start.slice(0, cells);
    for (let i = 0; i < n; i++) fill[cursor[this.cellOf[i]]++] = i;

    const cruise = 0.7;
    const maxSpeed = 2.2;
    const r2 = cell * cell;
    const ax = this.anchor.x, ay = this.anchor.y, az = this.anchor.z;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const px = p[o], py = p[o + 1], pz = p[o + 2];
      let vx = v[o], vy = v[o + 1], vz = v[o + 2];
      let alx = 0, aly = 0, alz = 0, cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0, cnt = 0;
      const c = this.cellOf[i];
      const ix = c % gx, iy = Math.floor(c / gx) % gy, iz = Math.floor(c / (gx * gy));
      search: for (let kz = Math.max(iz - 1, 0); kz <= Math.min(iz + 1, gz - 1); kz++)
        for (let ky = Math.max(iy - 1, 0); ky <= Math.min(iy + 1, gy - 1); ky++)
          for (let kx = Math.max(ix - 1, 0); kx <= Math.min(ix + 1, gx - 1); kx++) {
            const cc = (kz * gy + ky) * gx + kx;
            for (let s = start[cc]; s < start[cc + 1]; s++) {
              const j = fill[s];
              if (j === i) continue;
              const q = j * 3;
              const dx = px - p[q], dy = py - p[q + 1], dz = pz - p[q + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > r2) continue;
              cnt++;
              alx += v[q]; aly += v[q + 1]; alz += v[q + 2];
              cx += p[q]; cy += p[q + 1]; cz += p[q + 2];
              if (d2 < 0.035 && d2 > 1e-8) {
                const w = 1 / d2;
                sx += dx * w; sy += dy * w; sz += dz * w;
              }
              if (cnt >= 14) break search;
            }
          }
      let fx = 0, fy = 0, fz = 0;
      if (cnt > 0) {
        const inv = 1 / cnt;
        fx += (alx * inv - vx) * 1.4 + (cx * inv - px) + sx * 0.012;
        fy += (aly * inv - vy) * 1.4 + (cy * inv - py) + sy * 0.012;
        fz += (alz * inv - vz) * 1.4 + (cz * inv - pz) + sz * 0.012;
      }
      // anchor: a loose spring that tightens with distance, plus a circulating mill around it
      const tx = ax - px, ty = ay - py, tz = az - pz;
      const td = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const k = 0.12 + Math.max(td - 2.5, 0) * 0.3;
      fx += tx * k; fy += ty * k; fz += tz * k;
      const hl = Math.hypot(tx, tz) || 1;
      fx += (-tz / hl) * 0.35; fz += (tx / hl) * 0.35;
      // flee
      for (let t = -1; t < threats.length; t++) {
        const src = t < 0 ? camera : threats[t];
        const radius = t < 0 ? 2.0 : 3.5;
        const dx = px - src.x, dy = py - src.y, dz = pz - src.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < radius && d > 1e-4) {
          const w = ((radius - d) / d) * 9;
          fx += dx * w; fy += dy * w; fz += dz * w;
        }
      }
      _v.set(px, py, pz);
      bounds(_v, this.h, 0.5, _w, vx, vz, 0.7);
      fx += _w.x; fy += _w.y; fz += _w.z;
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (s < cruise && s > 1e-4) {
        const w = ((cruise - s) / s) * 1.5;
        fx += vx * w; fy += vy * w; fz += vz * w;
      }
      vx += fx * dt; vy += fy * dt; vz += fz * dt;
      const s2 = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (s2 > maxSpeed) {
        const w = maxSpeed / s2;
        vx *= w; vy *= w; vz *= w;
      }
      let ny = py + vy * dt;
      const floor = this.h.at(px + vx * dt, pz + vz * dt) + 0.15;
      if (ny < floor) {
        ny = floor;
        if (vy < 0) vy = 0;
      }
      v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
      p[o] = px + vx * dt; p[o + 1] = ny; p[o + 2] = pz + vz * dt;

      const a = this.agents[i];
      a.pos.set(p[o], p[o + 1], p[o + 2]);
      a.vel.set(vx, vy, vz);
      this.steerHeading(a, dt);
      this.writeInstance(i, a, dt, cruise, 0.5);
    }
    this.flush();
  }

  centre(out: THREE.Vector3): THREE.Vector3 {
    const { n, p } = this;
    out.set(0, 0, 0);
    for (let i = 0; i < n; i++) out.x += p[i * 3], out.y += p[i * 3 + 1], out.z += p[i * 3 + 2];
    return out.divideScalar(n);
  }
}

/** A single VAT-animated creature steered on the CPU. */
class Cruiser {
  readonly mesh: THREE.Mesh;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly dir = new THREE.Vector3(1, 0, 0);
  target = new THREE.Vector3();
  roll = 0;
  timer = 0;
  speed: number;

  constructor(geo: THREE.BufferGeometry, private swimmer: Swimmer, readonly cruise: number, private strokeSpeed: number, private readonly length: number) {
    this.mesh = new THREE.Mesh(geo, swimmer.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.speed = cruise;
    swimmer.clock.value = Math.random() * 10;
  }

  step(dt: number, h: HeightField, clearance: number, maxPitch: number, turnRate = 1.2): void {
    _v.subVectors(this.target, this.pos);
    const dist = _v.length();
    const desired = dist > 1e-4 ? _v.multiplyScalar(Math.min(this.speed, dist * 0.8 + 0.05) / dist) : _v.set(0, 0, 0);
    const acc = desired.sub(this.vel).multiplyScalar(turnRate).add(bounds(this.pos, h, clearance, _w, this.vel.x, this.vel.z, 1.4));
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    const floor = floorUnder(h, this.pos.x, this.pos.z, this.dir.x, this.dir.z, this.length * 0.5, clearance * 0.4);
    if (this.pos.y < floor) {
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    const sp = this.vel.length();
    if (sp > 0.02) {
      _v.copy(this.vel).divideScalar(sp);
      const before = Math.atan2(this.dir.x, this.dir.z);
      this.dir.lerp(_v, 1 - Math.exp(-dt * 2)).normalize();
      let dyaw = Math.atan2(this.dir.x, this.dir.z) - before;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const targetRoll = THREE.MathUtils.clamp((-dyaw / Math.max(dt, 1e-3)) * 0.6, -0.45, 0.45);
      this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 2));
    }
    // stroke rate follows speed, with a slow idle beat when hanging in the water
    this.swimmer.clock.value += dt * (0.35 + (sp / this.cruise) * 0.75) * this.strokeSpeed;
    orient(this.dir, this.roll, maxPitch, this.mesh.quaternion);
    this.mesh.position.copy(this.pos);
  }
}

async function vatGeometry(file: string): Promise<THREE.BufferGeometry> {
  const gltf = await loadGltf(file);
  let geo: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !geo) geo = (o as THREE.Mesh).geometry;
  });
  if (!geo) throw new Error(`no mesh in ${file}`);
  // Positions come from the VAT; the rest is unpacked from its quantized form.
  const src = geo as THREE.BufferGeometry;
  const out = new THREE.BufferGeometry();
  out.setIndex(src.getIndex());
  for (const name of ['position', 'normal', 'uv', '_vat']) {
    const a = src.getAttribute(name);
    if (!a) throw new Error(`${file}: missing ${name}`);
    const data = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) data[i * a.itemSize + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize));
  }
  return out;
}

export interface Fauna {
  group: THREE.Group;
  update(dt: number, camera: THREE.Vector3): void;
  /** Every swimmer's position, speed and body length, e.g. for bioluminescent wakes. */
  emit(fn: (x: number, y: number, z: number, speed: number, size: number, dt: number) => void, dt: number): void;
}

export async function createFauna(underwater: UnderwaterLighting, surfaces: ReefSurfaces, seed = 777): Promise<Fauna> {
  const rnd = mulberry32(seed);
  const mats = new FaunaMaterials(underwater);
  const h = surfaces.obstacles;
  const ground = surfaces.terrain;
  const reefs = fishReefs(h);
  const group = new THREE.Group();
  group.name = 'fauna';

  const [fishGeos, lobsterGeos, barracudaGeo, turtleGeo, barracudaVat, turtleVat] = await Promise.all([
    Promise.all([...SPECIES.map((s) => s.name), 'bait'].map((n) => variantGeometries('fish', n).then((g) => g[0]))),
    variantGeometries('lobster', 'lobster_'),
    vatGeometry('barracuda'),
    vatGeometry('turtle'),
    loadVat('barracuda'),
    loadVat('turtle'),
  ]);

  const reefSchools = SPECIES.map((sp, i) => new ReefSchool(fishGeos[i], mats, sp, h, reefs, rnd));
  const baitGeo = fishGeos[SPECIES.length];
  const bait = [new BaitSchool(baitGeo, mats, 340, new THREE.Vector3(2, -2.2, 4), h, rnd), new BaitSchool(baitGeo, mats, 340, new THREE.Vector3(22, -3, -8), h, rnd)];
  for (const s of [...reefSchools, ...bait]) group.add(s.mesh);

  // Great barracuda: hang motionless high in the water column, cruise slowly, now and then rush the bait.
  const barracuda = [0, 1].map((k) => {
    const c = new Cruiser(barracudaGeo, mats.vat(barracudaVat, { name: 'barracuda', metal: true }), 0.35, 1.0, 1.3);
    c.pos.set(18 + k * 8, -1.6, -4 + k * 10);
    c.target.copy(c.pos);
    c.mesh.name = `barracuda-${k}`;
    group.add(c.mesh);
    return c;
  });
  // Green turtle: a long loop around the lagoon at a few metres, surfacing to breathe every minute or so.
  const turtle = new Cruiser(turtleGeo, mats.vat(turtleVat, { texture: 'turtle' }), 0.42, 1.0, 1.0);
  turtle.pos.set(-4, -2.4, 8);
  turtle.mesh.name = 'turtle';
  group.add(turtle.mesh);
  const loop = [
    [-6, 10], [6, 16], [16, 8], [24, -6], [14, -14], [2, -16], [-8, -8], [-12, 2],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  let loopIndex = 0;
  let breathTimer = 40;
  let surfacing: 'no' | 'up' | 'rest' = 'no';

  // Spiny lobsters tucked under the edges of the patch reefs, antennae out.
  const lobsterMat = mats.lobster();
  const lobsterLists: THREE.Matrix4[][] = lobsterGeos.map(() => []);
  for (let tries = 0, placed = 0; tries < 2000 && placed < 9; tries++) {
    const reef = reefs[Math.floor(rnd() * reefs.length)];
    const a = rnd() * Math.PI * 2;
    const r = reef.r * (0.7 + rnd() * 0.5);
    const x = reef.x + Math.cos(a) * r;
    const z = reef.z + Math.sin(a) * r;
    const d = reefDensity(x, z);
    // On open rock or sand, not perched on a coral head.
    if (d < 0.25 || d > 0.7 || ground.at(x, z) > -1.8 || h.at(x, z) > ground.at(x, z) + 0.05) continue;
    const yaw = Math.atan2(Math.cos(a), Math.sin(a)) + (rnd() - 0.5) * 0.8;
    _q.setFromAxisAngle(UP, yaw);
    const s = 0.8 + rnd() * 0.45;
    lobsterLists[placed % lobsterGeos.length].push(new THREE.Matrix4().compose(new THREE.Vector3(x, ground.at(x, z) - 0.01, z), _q, _s.setScalar(s)));
    placed++;
  }
  lobsterGeos.forEach((geo, i) => {
    const list = lobsterLists[i];
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, lobsterMat, list.length);
    list.forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `lobster-${i}`;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  const threats: THREE.Vector3[] = barracuda.map((b) => b.pos);
  const tmp = new THREE.Vector3();

  return {
    group,
    emit(fn, dt) {
      for (const s of [...reefSchools, ...bait]) for (const a of s.agents) fn(a.pos.x, a.pos.y, a.pos.z, a.vel.length(), s.length * a.scale, dt);
      for (const b of barracuda) fn(b.pos.x, b.pos.y, b.pos.z, b.vel.length(), 1.3, dt);
      fn(turtle.pos.x, turtle.pos.y, turtle.pos.z, turtle.vel.length() + 0.15, 1.0, dt);
    },
    update(dt, camera) {
      dt = Math.min(dt, 1 / 20);
      for (const s of reefSchools) s.update(dt, camera, threats);
      for (const s of bait) s.update(dt, camera, threats);

      for (const b of barracuda) {
        b.timer -= dt;
        if (b.timer < 0) {
          const hunt = rnd() < 0.25;
          if (hunt) {
            const school = bait[Math.floor(rnd() * bait.length)];
            b.target.copy(school.centre(tmp));
            b.speed = 1.6;
            b.timer = 3;
          } else {
            const x = 4 + rnd() * 32;
            const z = -HALF_Z + 4 + rnd() * (HALF_Z * 2 - 8);
            b.target.set(x, Math.max(h.at(x, z) + 1, -1.2 - rnd() * 1.6), z);
            b.speed = 0.15 + rnd() * 0.3;
            b.timer = 10 + rnd() * 14;
          }
        }
        b.step(dt, h, 0.6, 0.25, b.speed > 1 ? 2 : 0.6);
      }

      breathTimer -= dt;
      if (surfacing === 'no') {
        const wp = loop[loopIndex];
        turtle.target.set(wp.x, Math.max(h.at(wp.x, wp.z) + 1.2, -3.2), wp.z);
        if (Math.hypot(turtle.pos.x - wp.x, turtle.pos.z - wp.z) < 2.5) loopIndex = (loopIndex + 1) % loop.length;
        if (breathTimer < 0) surfacing = 'up';
      } else if (surfacing === 'up') {
        turtle.target.set(turtle.pos.x + turtle.dir.x * 3, 0, turtle.pos.z + turtle.dir.z * 3);
        if (turtle.pos.y > -SURFACE_CLEARANCE - 0.1) {
          surfacing = 'rest';
          breathTimer = 4;
        }
      } else {
        turtle.target.set(turtle.pos.x + turtle.dir.x, -0.3, turtle.pos.z + turtle.dir.z);
        if (breathTimer < 0) {
          surfacing = 'no';
          breathTimer = 50 + rnd() * 40;
        }
      }
      turtle.speed = surfacing === 'rest' ? 0.12 : 0.42;
      turtle.step(dt, h, 0.9, 0.5, 0.5);
    },
  };
}
