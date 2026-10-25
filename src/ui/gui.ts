import GUI from 'lil-gui';
import type * as THREE from 'three/webgpu';
import type { ResolutionController } from '../core/renderer';
import type { PerfHud } from '../core/perfHud';
import type { SkyAndSun } from '../world/sky';

export function createGui(opts: {
  renderer: THREE.WebGPURenderer;
  resolution: ResolutionController;
  hud: PerfHud;
  sky: SkyAndSun;
}): GUI {
  const gui = new GUI({ title: 'Reef' });
  const { renderer, resolution, hud, sky } = opts;

  const sun = gui.addFolder('Sun');
  sun.add(sky.state, 'elevation', -10, 90, 0.1).onChange(() => sky.update());
  sun.add(sky.state, 'azimuth', 0, 360, 0.1).onChange(() => sky.update());
  sun.add(sky.state, 'rayleigh', 0.2, 4, 0.01).onChange(() => sky.update());
  sun.add(sky.state, 'mie', 0, 5, 0.01).name('haze').onChange(() => sky.update());
  sun.add(sky.state, 'sunLux', 0, 12, 0.01).name('sun intensity').onChange(() => sky.update());
  sun.add(sky.state, 'envIntensity', 0, 3, 0.01).name('sky light').onChange(() => sky.update());

  const render = gui.addFolder('Render');
  render.add(renderer, 'toneMappingExposure', 0.05, 3, 0.01).name('exposure').listen();
  render.add(resolution, 'enabled').name('auto resolution');
  const scaleProxy = { scale: resolution.scale };
  render
    .add(scaleProxy, 'scale', 0.5, 2, 0.05)
    .name('pixel ratio')
    .listen()
    .onChange((v: number) => resolution.setScale(v));
  render.add(resolution, 'targetMs', 8, 33, 0.5).name('budget ms');
  const hudProxy = { perfHud: true };
  render.add(hudProxy, 'perfHud').name('perf HUD').onChange((v: boolean) => (hud.visible = v));

  gui.onChange(() => (scaleProxy.scale = resolution.scale));
  setInterval(() => (scaleProxy.scale = resolution.scale), 500);

  return gui;
}
