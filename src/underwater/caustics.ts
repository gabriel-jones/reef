import * as THREE from 'three/webgpu';
import { Fn, instanceIndex, uint, ivec2, vec2, vec3, vec4, float, textureLoad, textureStore, texture, refract, normalize, abs, clamp, uniform, uvec2, mix, smoothstep } from 'three/tsl';
import { CASCADES, FFT_SIZE } from '../ocean/params';
import type { OceanSim } from '../ocean/oceanSim';

const N = FFT_SIZE;
/** Size of the box-filtered copy used for god rays. */
const SOFT = 64;
const IOR_WATER = 1.333;

/**
 * Caustics from the inverse Jacobian of the refraction map: each surface texel bends a vertical
 * light ray, and the focusing of neighbouring rays at a reference depth gives the intensity.
 * One tiling texture per fine cascade, so the pattern moves with the actual waves.
 */
export class Caustics {
  /** Per cascade (1 and 2): R = intensity at the reference depth. */
  readonly textures: THREE.StorageTexture[] = [];
  readonly cascades = [1, 2] as const;
  /** Artistic focal depths: the gentle trade-wind sea would only focus tens of metres down. */
  readonly focusDepth = [uniform(13), uniform(5)];
  /**
   * Coarse cascade box-filtered to SOFT² and pre-raised to the shaft contrast curve. God rays march
   * through this instead of the full-resolution pattern: a smooth integrand needs far fewer samples,
   * so the per-pixel jitter stops showing as grain.
   */
  readonly soft: THREE.StorageTexture;
  private nodes: THREE.ComputeNode[] = [];

  constructor(private sim: OceanSim) {
    this.cascades.forEach((c, i) => {
      const tex = new THREE.StorageTexture(N, N);
      tex.type = THREE.HalfFloatType;
      tex.format = THREE.RGBAFormat;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this.textures.push(tex);
      this.nodes.push(this.build(c, tex, this.focusDepth[i]));
    });
    this.soft = new THREE.StorageTexture(SOFT, SOFT);
    this.soft.type = THREE.HalfFloatType;
    this.soft.format = THREE.RGBAFormat;
    this.soft.wrapS = this.soft.wrapT = THREE.RepeatWrapping;
    this.soft.minFilter = this.soft.magFilter = THREE.LinearFilter;
    this.soft.generateMipmaps = false;
    this.nodes.push(this.buildSoft(this.textures[0], this.soft));
  }

  private buildSoft(src: THREE.StorageTexture, out: THREE.StorageTexture): THREE.ComputeNode {
    const block = N / SOFT;
    return Fn(() => {
      const x = instanceIndex.mod(uint(SOFT));
      const y = instanceIndex.div(uint(SOFT));
      const sum = float(0).toVar();
      for (let j = 0; j < block; j++)
        for (let i = 0; i < block; i++) sum.addAssign(textureLoad(src, ivec2(x.mul(uint(block)).add(uint(i)).toInt(), y.mul(uint(block)).add(uint(j)).toInt())).r.pow(2.2));
      textureStore(out, uvec2(x, y), vec4(sum.div(block * block), 0, 0, 1)).toWriteOnly();
    })().compute(SOFT * SOFT);
  }

  update(renderer: THREE.WebGPURenderer): void {
    for (const n of this.nodes) renderer.compute(n);
  }

  private build(cascade: number, out: THREE.StorageTexture, depth: THREE.UniformNode<'float', number>): THREE.ComputeNode {
    const deriv = this.sim.derivatives[cascade];
    const texel = CASCADES[cascade].size / N;
    return Fn(() => {
      const x = instanceIndex.mod(uint(N));
      const y = instanceIndex.div(uint(N));
      const wrap = (v: THREE.Node<'uint'>) => v.bitAnd(uint(N - 1));

      // Horizontal landing offset per unit depth for a vertical ray refracted at a texel.
      const landing = (ix: THREE.Node<'uint'>, iy: THREE.Node<'uint'>) => {
        const s = textureLoad(deriv, ivec2(wrap(ix).toInt(), wrap(iy).toInt())).xy;
        const n = normalize(vec3(s.x.negate(), 1, s.y.negate()));
        const r = refract(vec3(0, -1, 0), n, float(1 / IOR_WATER));
        return r.xz.div(r.y.negate()).mul(depth);
      };

      const back = uint(N - 1);
      const ox = landing(x.add(uint(1)), y).sub(landing(x.add(back), y));
      const oz = landing(x, y.add(uint(1))).sub(landing(x, y.add(back)));
      // Jacobian of q(p) = p + offset(p), by central differences over two texels.
      const span = texel * 2;
      const dqdx = vec2(span, 0).add(ox).div(span);
      const dqdz = vec2(0, span).add(oz).div(span);
      const det = abs(dqdx.x.mul(dqdz.y).sub(dqdx.y.mul(dqdz.x)));
      // Soft-clip the focal spikes so a single texel never reads as a hard white cell.
      const raw = float(1).div(det.max(1e-3));
      const intensity = clamp(raw.div(float(1).add(raw.mul(0.2))).mul(1.2), 0, 5);
      textureStore(out, uvec2(x, y), vec4(intensity, 0, 0, 1)).toWriteOnly();
    })().compute(N * N);
  }

  /** TSL: caustic intensity (mean ≈ 1) at a surface point. */
  sample(xzSurface: THREE.Node<'vec2'>, viewDistance: THREE.Node<'float'>): THREE.Node<'float'> {
    // The storage textures have no mips, so fade each cascade toward its mean before it starts to alias.
    const coarse = mix(float(1), texture(this.textures[0], xzSurface.div(CASCADES[1].size)).r, smoothstep(170, 60, viewDistance));
    const fine = mix(float(1), texture(this.textures[1], xzSurface.div(CASCADES[2].size)).r, smoothstep(30, 8, viewDistance));
    return coarse.mul(fine.pow(0.6));
  }
}
