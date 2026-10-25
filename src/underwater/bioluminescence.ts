import * as THREE from 'three/webgpu';
import { exp, float, hash, instanceIndex, instancedBufferAttribute, length, max, sin, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import type { SkyAndSun } from '../world/sky';

const COUNT = 9000;

/**
 * Dinoflagellate sparks: at night, anything moving through the water (fish, turtle, barracuda,
 * the diver) mechanically stimulates plankton, which flash blue-green for a second or two.
 * Sparks are spawned on the CPU along each emitter's path into a ring buffer.
 */
export class Bioluminescence {
  readonly sprite: THREE.Sprite;
  readonly strength = uniform(1);
  /** Sparks per metre travelled, per unit emitter size. */
  rate = 9;

  private clock = uniform(0);
  private now = 0;
  private head = 0;
  private readonly data = new Float32Array(COUNT * 4);
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly lastCamera = new THREE.Vector3();

  constructor(private sky: SkyAndSun) {
    for (let i = 0; i < COUNT; i++) this.data[i * 4 + 3] = -1e4;
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = instancedBufferAttribute(this.attr, 'vec4') as unknown as THREE.Node<'vec4'>;
    const seed = hash(instanceIndex);
    const age = this.clock.sub(p.w);
    const life = seed.mul(1.4).add(0.6);
    // a fast flash, then a decaying glow with a little shimmer
    const envelope = smoothstep(0, 0.06, age).mul(exp(age.negate().mul(3.2).div(life))).mul(age.lessThan(life.mul(2)).select(1, 0));
    const shimmer = sin(this.clock.mul(19).add(seed.mul(60))).mul(0.25).add(0.75);
    mat.positionNode = p.xyz.add(vec3(0, age.mul(0.02), 0));
    mat.scaleNode = seed.mul(0.03).add(0.025);
    const disc = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
    const col = vec3(0.18, 0.78, 1.0).mul(seed.mul(0.6).add(0.7));
    mat.colorNode = vec4(col.mul(0.22), max(envelope.mul(shimmer).mul(disc).mul(sky.night).mul(this.strength), 0));
    this.sprite = new THREE.Sprite(mat);
    this.sprite.count = COUNT;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 11;
    this.sprite.name = 'bioluminescence';
  }

  private spawn(x: number, y: number, z: number, spread: number): void {
    const i = this.head;
    this.head = (this.head + 1) % COUNT;
    const o = i * 4;
    this.data[o] = x + (Math.random() - 0.5) * spread;
    this.data[o + 1] = Math.min(y + (Math.random() - 0.5) * spread, -0.05);
    this.data[o + 2] = z + (Math.random() - 0.5) * spread;
    this.data[o + 3] = this.now - Math.random() * 0.05;
  }

  /** emitter: position, speed (m/s), body size (m). Call between begin() and end(). */
  emit = (x: number, y: number, z: number, speed: number, size: number, dt: number): void => {
    if (y > 0) return;
    const n = speed * dt * this.rate * Math.max(size * 6, 0.6);
    let count = Math.floor(n);
    if (Math.random() < n - count) count++;
    for (let k = 0; k < count; k++) this.spawn(x, y, z, size * 1.4 + 0.05);
  };

  /** Returns false (and skips all work) by day. */
  begin(dt: number, camera: THREE.Vector3, underwater: boolean): boolean {
    this.now += dt;
    this.clock.value = this.now;
    const active = this.sky.night.value > 0.01;
    this.sprite.visible = active;
    if (!active) {
      this.lastCamera.copy(camera);
      return false;
    }
    if (underwater) {
      const speed = camera.distanceTo(this.lastCamera) / Math.max(dt, 1e-3);
      if (speed < 20) {
        // the diver's wake: sparks a little ahead and around the camera
        const n = Math.min(speed * dt * 70, 40);
        for (let k = 0; k < n; k++) this.spawn(camera.x, camera.y - 0.15, camera.z, 1.4);
      }
    }
    this.lastCamera.copy(camera);
    return true;
  }

  end(): void {
    this.attr.needsUpdate = true;
  }
}

/** Blue glow for breaking foam, shared with the ocean surface material. */
export function foamGlow(sky: SkyAndSun, foam: THREE.Node<'float'>, sparkle: THREE.Node<'float'>): THREE.Node<'vec3'> {
  return vec3(0.12, 0.6, 1.0).mul(foam).mul(sparkle).mul(sky.night).mul(float(0.022));
}
