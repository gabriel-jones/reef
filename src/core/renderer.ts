import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

export interface RenderContext {
  renderer: THREE.WebGPURenderer;
  pipeline: THREE.RenderPipeline;
  scenePass: ReturnType<typeof pass>;
}

export async function createRenderer(container: HTMLElement, scene: THREE.Scene, camera: THREE.Camera): Promise<RenderContext> {
  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp: true, forceWebGL: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  await renderer.init();

  const scenePass = pass(scene, camera, { samples: 4 });
  const pipeline = new THREE.RenderPipeline(renderer, scenePass);

  return { renderer, pipeline, scenePass };
}

/**
 * Adjusts the pixel ratio to hold a frame-time budget. Scale is relative to
 * CSS pixels, so 2.0 is native on a Retina display.
 */
export class ResolutionController {
  enabled = true;
  scale: number;
  min = 0.75;
  max = 1.5;
  targetMs = 16.0;

  private samples: number[] = [];
  private lastAdjust = 0;

  constructor(private renderer: THREE.WebGPURenderer, initial = 1.25) {
    this.scale = initial;
    renderer.setPixelRatio(initial);
  }

  setScale(scale: number): void {
    this.scale = THREE.MathUtils.clamp(scale, this.min, Math.max(this.max, scale));
    this.renderer.setPixelRatio(this.scale);
  }

  /** Feed the best available frame cost (GPU time if known, otherwise frame delta). */
  sample(frameMs: number, now: number): void {
    if (!this.enabled) return;
    this.samples.push(frameMs);
    if (now - this.lastAdjust < 1000 || this.samples.length < 30) return;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.samples.length = 0;
    this.lastAdjust = now;

    let next = this.scale;
    if (p90 > this.targetMs * 1.04) next -= 0.1;
    else if (p90 < this.targetMs * 0.72) next += 0.05;
    next = THREE.MathUtils.clamp(next, this.min, this.max);
    if (Math.abs(next - this.scale) > 1e-3) this.setScale(next);
  }
}
