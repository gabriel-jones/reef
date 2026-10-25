import * as THREE from 'three/webgpu';
import { Fn, instancedArray, uniform, vec2, Loop } from 'three/tsl';
import { WORLD } from '../config';
import type { OceanSurface } from './oceanSurface';

/**
 * Reads the live water height at one XZ point back to the CPU (a frame or two late), so the app
 * knows whether the camera is underwater. Choppy waves shift the surface sideways, so the rest
 * position under the point is found by fixed-point iteration first.
 */
export class OceanProbe {
  readonly point = uniform(new THREE.Vector2());
  height: number = WORLD.seaLevel;

  private out = instancedArray(1, 'float');
  private node: THREE.ComputeNode;
  private pending = false;

  constructor(ocean: OceanSurface) {
    this.node = Fn(() => {
      const rest = vec2(this.point).toVar();
      Loop(3, () => {
        rest.assign(this.point.sub(ocean.sampleField(rest).offset.xz));
      });
      this.out.element(0).assign(ocean.heightAt(rest));
    })().compute(1);
  }

  update(renderer: THREE.WebGPURenderer, x: number, z: number): void {
    this.point.value.set(x, z);
    renderer.compute(this.node);
    if (this.pending) return;
    this.pending = true;
    renderer.getArrayBufferAsync(this.out.value).then((buf) => {
      this.height = new Float32Array(buf)[0];
      this.pending = false;
    });
  }
}
