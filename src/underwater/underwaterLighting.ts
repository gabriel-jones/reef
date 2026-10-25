import * as THREE from 'three/webgpu';
import { Fn, vec4, float, uniform, output, positionWorld, normalWorld, exp, max, abs, clamp, smoothstep, step, length, cameraPosition } from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import type { Caustics } from './caustics';

const IOR_WATER = 1.333;

/**
 * Light reaching submerged surfaces: Beer–Lambert falloff along the refracted sun path plus
 * caustics. Applied as a wrapper on any lit material's output, so corals and fish get it for free.
 */
export class UnderwaterLighting {
  /** Direction toward the sun as seen from below the surface (refracted, always steeper). */
  readonly sunUnderwater = uniform(new THREE.Vector3(0, 1, 0));
  readonly causticStrength = uniform(0.85);
  readonly sunUp = uniform(1);

  constructor(
    readonly caustics: Caustics,
    readonly absorption: THREE.UniformNode<'vec3', THREE.Vector3>,
  ) {}

  updateSun(towardSun: THREE.Vector3): void {
    // Snell refraction of the incoming ray through a flat surface (normal +Y), reversed to point at the sun.
    const eta = 1 / IOR_WATER;
    const cosi = Math.max(towardSun.y, 0.02);
    const k = 1 - eta * eta * (1 - cosi * cosi);
    this.sunUnderwater.value.set(towardSun.x * eta, Math.sqrt(Math.max(k, 0)), towardSun.z * eta).normalize();
    this.sunUp.value = THREE.MathUtils.smoothstep(towardSun.y, -0.02, 0.25);
  }

  /** TSL: multiplicative light factor for a submerged point with a world normal. */
  factor(p: THREE.Node<'vec3'>, n: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
    const inSlab = step(abs(p.x), float(HALF_X)).mul(step(abs(p.z), float(HALF_Z)));
    const depth = max(float(WORLD.seaLevel).sub(p.y), 0).mul(inSlab).toVar();
    const lu = this.sunUnderwater;
    const pathToSurface = depth.div(lu.y);
    const transmittance = exp(this.absorption.mul(pathToSurface).negate());

    const surfacePoint = p.xz.add(lu.xz.mul(pathToSurface));
    const intensity = this.caustics.sample(surfacePoint, length(p.sub(cameraPosition)));
    const facing = clamp(n.y.mul(0.75).add(0.25), 0, 1);
    const strength = this.causticStrength
      .mul(smoothstep(0.1, 1.0, depth))
      .mul(exp(depth.mul(-0.06)))
      .mul(facing)
      .mul(this.sunUp);
    const caustic = float(1).add(intensity.sub(1).mul(strength));
    return transmittance.mul(caustic);
  }

  apply(material: THREE.NodeMaterial): void {
    material.outputNode = Fn(() => vec4(output.rgb.mul(this.factor(positionWorld, normalWorld)), output.a))();
  }
}