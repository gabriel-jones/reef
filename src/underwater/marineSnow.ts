import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, vec3, vec4, float, uniform, cameraPosition, time, mod, abs, smoothstep, length, sin, max, exp, uv, PI } from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import type { SkyAndSun } from '../world/sky';
import type { OceanSurface } from '../ocean/oceanSurface';

const COUNT = 6000;
const BOX = 22;

/** Drifting suspended particles in a box that wraps around the camera, for a sense of scale and current. */
export function createMarineSnow(sky: SkyAndSun, ocean: OceanSurface): THREE.Sprite {
  const seeds = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 4] = Math.random();
    seeds[i * 4 + 1] = Math.random();
    seeds[i * 4 + 2] = Math.random();
    seeds[i * 4 + 3] = Math.random();
  }
  const seedBuf = instancedArray(seeds, 'vec4');
  const current = uniform(new THREE.Vector3(0.12, 0.015, 0.05));

  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const seed = seedBuf.element(instanceIndex);
  const drift = current.mul(time).add(vec3(sin(time.mul(0.3).add(seed.w.mul(PI.mul(2)))).mul(0.15), 0, 0));
  const local = mod(seed.xyz.mul(BOX).add(drift).sub(cameraPosition), BOX).sub(BOX / 2);
  const world = cameraPosition.add(local).toVar();
  mat.positionNode = world;
  mat.scaleNode = float(0.012).add(seed.w.mul(0.03));

  mat.colorNode = Fn(() => {
    const inSlab = smoothstep(0, 1, float(HALF_X).sub(abs(world.x))).mul(smoothstep(0, 1, float(HALF_Z).sub(abs(world.z))));
    const below = smoothstep(0.0, 0.3, float(WORLD.seaLevel).sub(world.y));
    const aboveFloor = smoothstep(0, 0.4, world.y.sub(ocean.seabedHeightAt(world.xz)));
    const fade = smoothstep(float(BOX / 2), float(BOX / 2 - 4), length(local)).mul(smoothstep(0.15, 0.8, length(local)));
    const depth = max(float(WORLD.seaLevel).sub(world.y), 0);
    const light = sky.sunRadiance.mul(exp(ocean.look.absorption.mul(depth).negate())).mul(0.05);
    const disc = smoothstep(0.5, 0.1, length(uv().sub(0.5)));
    return vec4(light, inSlab.mul(below).mul(aboveFloor).mul(fade).mul(disc).mul(0.7));
  })();

  const sprite = new THREE.Sprite(mat);
  sprite.count = COUNT;
  sprite.frustumCulled = false;
  sprite.name = 'marine-snow';
  sprite.renderOrder = 10;
  return sprite;
}
