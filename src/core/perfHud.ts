import * as THREE from 'three/webgpu';

export class PerfHud {
  readonly el = document.createElement('div');
  gpuMs = 0;

  private frames = 0;
  private cpuAccum = 0;
  private lastReport = performance.now();
  private fps = 0;
  private cpuMs = 0;

  constructor(private renderer: THREE.WebGPURenderer) {
    this.el.className = 'perf-hud';
    document.body.appendChild(this.el);
  }

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  frame(cpuMs: number, scale: number): void {
    this.frames++;
    this.cpuAccum += cpuMs;
    const now = performance.now();
    if (now - this.lastReport < 500) return;

    this.fps = (this.frames * 1000) / (now - this.lastReport);
    this.cpuMs = this.cpuAccum / this.frames;
    this.frames = 0;
    this.cpuAccum = 0;
    this.lastReport = now;

    const info = this.renderer.info;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const fpsClass = this.fps < 55 ? ' class="bad"' : '';
    this.el.innerHTML =
      `<span${fpsClass}>${this.fps.toFixed(0).padStart(3)} fps</span>\n` +
      `cpu  ${this.cpuMs.toFixed(2)} ms\n` +
      `gpu  ${this.gpuMs ? this.gpuMs.toFixed(2) + ' ms' : 'n/a'}\n` +
      `draw ${info.render.drawCalls}  tris ${(info.render.triangles / 1000).toFixed(0)}k\n` +
      `res  ${size.x}×${size.y} @${scale.toFixed(2)}`;
  }
}
