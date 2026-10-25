import * as THREE from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, uint, float, vec2, vec4, uniform, textureStore, uvec2, cos, sin, exp, clamp } from 'three/tsl';
import { CASCADES, FFT_SIZE, type OceanParams } from './params';
import { buildSpectrum } from './spectrum';

const N = FFT_SIZE;
const NN = N * N;
const HALF = N / 2;
const LOG2N = Math.log2(N);
const PAIRS = 4;
const LAYERS = CASCADES.length * PAIRS;

type Vec2Node = THREE.Node<'vec2'>;

const cmul = (a: Vec2Node, b: Vec2Node) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));
/** Packs two Hermitian spectra so one complex IFFT yields both real fields: F1 + i·F2. */
const packPair = (a: Vec2Node, b: Vec2Node) => vec2(a.x.sub(b.y), a.y.add(b.x));

/**
 * Tessendorf FFT ocean on WebGPU compute. Per frame: evolve h(k,t) for 3 cascades × 4 packed
 * field pairs, run a 2D Stockham inverse FFT over all 12 layers at once, then assemble
 * displacement / derivative storage textures and integrate Jacobian foam.
 */
export class OceanSim {
  readonly displacement: THREE.StorageTexture[] = [];
  readonly derivatives: THREE.StorageTexture[] = [];
  readonly time = uniform(0);
  readonly dt = uniform(0);
  readonly choppiness = uniform(1);
  readonly foamBias = uniform(0.9);
  readonly foamGain = uniform(3);
  readonly foamDecay = uniform(1);

  private h0 = instancedArray(CASCADES.length * NN, 'vec4');
  private waves = instancedArray(CASCADES.length * NN, 'vec4');
  private bufA = instancedArray(LAYERS * NN, 'vec2');
  private bufB = instancedArray(LAYERS * NN, 'vec2');
  private foam = instancedArray(CASCADES.length * NN, 'float');

  private evolveNode: THREE.ComputeNode;
  private fftNodes: THREE.ComputeNode[] = [];
  private assembleNodes: THREE.ComputeNode[] = [];

  constructor(public params: OceanParams) {
    for (let c = 0; c < CASCADES.length; c++) {
      for (const list of [this.displacement, this.derivatives]) {
        const tex = new THREE.StorageTexture(N, N);
        tex.type = THREE.HalfFloatType;
        tex.format = THREE.RGBAFormat;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        list.push(tex);
      }
    }

    this.evolveNode = this.buildEvolve();
    let src = this.bufA;
    let dst = this.bufB;
    for (const vertical of [false, true]) {
      for (let s = 0; s < LOG2N; s++) {
        this.fftNodes.push(this.buildStage(src, dst, s, vertical));
        [src, dst] = [dst, src];
      }
    }
    // 2·log2N stages is even, so the result lands back in bufA.
    for (let c = 0; c < CASCADES.length; c++) this.assembleNodes.push(this.buildAssemble(c));

    this.applyParams();
  }

  /** Rebuild the initial spectrum on the CPU and re-upload; call after spectrum params change. */
  rebuildSpectrum(): void {
    const { h0, waves } = buildSpectrum(this.params);
    (this.h0.value.array as Float32Array).set(h0);
    (this.waves.value.array as Float32Array).set(waves);
    this.h0.value.needsUpdate = true;
    this.waves.value.needsUpdate = true;
  }

  applyParams(): void {
    const p = this.params;
    this.choppiness.value = p.choppiness;
    this.foamBias.value = p.foamBias;
    this.foamGain.value = p.foamGain;
    this.foamDecay.value = p.foamDecay;
    this.rebuildSpectrum();
  }

  update(renderer: THREE.WebGPURenderer, dt: number): void {
    const step = Math.min(dt, 1 / 20) * this.params.timeScale;
    this.dt.value = step;
    this.time.value += step;
    renderer.compute(this.evolveNode);
    for (const node of this.fftNodes) renderer.compute(node);
    for (const node of this.assembleNodes) renderer.compute(node);
  }

  private buildEvolve(): THREE.ComputeNode {
    return Fn(() => {
      const id = instanceIndex;
      const c = id.div(uint(NN));
      const i = id.mod(uint(NN));
      const h0 = this.h0.element(id);
      const w = this.waves.element(id);

      const phase = w.w.mul(this.time);
      const e = vec2(cos(phase), sin(phase));
      const h = cmul(h0.xy, e).add(cmul(h0.zw, vec2(e.x, e.y.negate()))).toVar();
      const ih = vec2(h.y.negate(), h.x).toVar();
      const kx = w.x;
      const kz = w.y;
      const invK = w.z;

      const dx = ih.mul(kx.mul(invK)).negate();
      const dz = ih.mul(kz.mul(invK)).negate();
      const dhdx = ih.mul(kx);
      const dhdz = ih.mul(kz);
      const dxdx = h.mul(kx.mul(kx).mul(invK));
      const dzdz = h.mul(kz.mul(kz).mul(invK));
      const dxdz = h.mul(kx.mul(kz).mul(invK));

      const base = c.mul(uint(PAIRS * NN)).add(i);
      this.bufA.element(base).assign(packPair(dx, dz));
      this.bufA.element(base.add(uint(NN))).assign(packPair(h, dxdx));
      this.bufA.element(base.add(uint(2 * NN))).assign(packPair(dhdx, dhdz));
      this.bufA.element(base.add(uint(3 * NN))).assign(packPair(dzdz, dxdz));
    })().compute(CASCADES.length * NN);
  }

  private buildStage(src: typeof this.bufA, dst: typeof this.bufA, s: number, vertical: boolean): THREE.ComputeNode {
    const ns = 1 << s;
    return Fn(() => {
      const id = instanceIndex;
      const j = id.mod(uint(HALF));
      const line = id.div(uint(HALF));
      const base = line.div(uint(N)).mul(uint(NN));
      const li = line.mod(uint(N));
      const at = (p: THREE.Node<'uint'>) => (vertical ? base.add(p.mul(uint(N))).add(li) : base.add(li.mul(uint(N))).add(p));

      const k = j.bitAnd(uint(ns - 1));
      const a = src.element(at(j)).toVar();
      const b = src.element(at(j.add(uint(HALF)))).toVar();
      const angle = float(k).mul(Math.PI / ns);
      const bw = cmul(b, vec2(cos(angle), sin(angle))).toVar();
      const out = j.sub(k).mul(uint(2)).add(k);
      dst.element(at(out)).assign(a.add(bw));
      dst.element(at(out.add(uint(ns)))).assign(a.sub(bw));
    })().compute(LAYERS * N * HALF);
  }

  private buildAssemble(c: number): THREE.ComputeNode {
    const dispTex = this.displacement[c];
    const derivTex = this.derivatives[c];
    return Fn(() => {
      const id = instanceIndex;
      const base = uint(c * PAIRS * NN).add(id);
      const p0 = this.bufA.element(base);
      const p1 = this.bufA.element(base.add(uint(NN)));
      const p2 = this.bufA.element(base.add(uint(2 * NN)));
      const p3 = this.bufA.element(base.add(uint(3 * NN)));
      const lam = this.choppiness;

      const jxx = p1.y.mul(lam).add(1);
      const jzz = p3.x.mul(lam).add(1);
      const jxz = p3.y.mul(lam);
      const jacobian = jxx.mul(jzz).sub(jxz.mul(jxz));

      const foam = this.foam.element(uint(c * NN).add(id));
      const injected = clamp(this.foamBias.sub(jacobian), 0, 1).mul(this.foamGain).mul(this.dt);
      const next = clamp(foam.mul(exp(this.foamDecay.negate().mul(this.dt))).add(injected), 0, 1).toVar();
      foam.assign(next);

      const texel = uvec2(id.mod(uint(N)), id.div(uint(N)));
      textureStore(dispTex, texel, vec4(p0.x.mul(lam), p1.x, p0.y.mul(lam), next)).toWriteOnly();
      textureStore(derivTex, texel, vec4(p2.x, p2.y, p1.y.mul(lam), p3.x.mul(lam))).toWriteOnly();
    })().compute(NN);
  }

  /** Dev check: GPU height field (cascade 0) vs a direct CPU sum at a few texels. */
  async verify(renderer: THREE.WebGPURenderer): Promise<number> {
    const t = this.time.value;
    const buf = new Float32Array(await renderer.getArrayBufferAsync(this.bufA.value));
    const { h0, waves } = buildSpectrum(this.params);
    let maxErr = 0;
    let maxH = 0;
    for (const [x, z] of [[0, 0], [17, 3], [100, 200], [255, 128]]) {
      let sum = 0;
      for (let i = 0; i < NN; i++) {
        const kx = waves[i * 4];
        const kz = waves[i * 4 + 1];
        const om = waves[i * 4 + 3];
        const ph = om * t;
        const c = Math.cos(ph);
        const s = Math.sin(ph);
        const re = h0[i * 4] * c - h0[i * 4 + 1] * s + h0[i * 4 + 2] * c + h0[i * 4 + 3] * s;
        const im = h0[i * 4] * s + h0[i * 4 + 1] * c - h0[i * 4 + 2] * s + h0[i * 4 + 3] * c;
        const arg = kx * ((x * CASCADES[0].size) / N) + kz * ((z * CASCADES[0].size) / N);
        sum += re * Math.cos(arg) - im * Math.sin(arg);
      }
      const gpu = buf[(NN + z * N + x) * 2];
      maxErr = Math.max(maxErr, Math.abs(gpu - sum));
      maxH = Math.max(maxH, Math.abs(sum));
    }
    return maxErr / Math.max(maxH, 1e-6);
  }
}
