import * as THREE from 'three/webgpu';
import { texture, vec2, float } from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import { seabedHeight } from './seabedProfile';

const TEXELS_PER_METRE = 4;

/** Seabed height as a GPU texture, so shaders can query water depth anywhere on the slab. */
export class SeabedMap {
  readonly texture: THREE.DataTexture;

  constructor() {
    const w = WORLD.sizeX * TEXELS_PER_METRE + 1;
    const h = WORLD.sizeZ * TEXELS_PER_METRE + 1;
    const data = new Uint16Array(w * h);
    for (let j = 0; j < h; j++) {
      const z = -HALF_Z + (j / (h - 1)) * WORLD.sizeZ;
      for (let i = 0; i < w; i++) {
        const x = -HALF_X + (i / (w - 1)) * WORLD.sizeX;
        data[j * w + i] = THREE.DataUtils.toHalfFloat(seabedHeight(x, z));
      }
    }
    this.texture = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** TSL: seabed height (m) at a world XZ position. */
  heightAt(xz: THREE.Node<'vec2'>): THREE.Node<'float'> {
    const { width, height } = this.texture.image;
    const texel = xz.add(vec2(HALF_X, HALF_Z)).mul(TEXELS_PER_METRE).add(0.5);
    return texture(this.texture, texel.div(vec2(width, height))).level(float(0)).r;
  }
}
