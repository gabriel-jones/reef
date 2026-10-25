import GUI from 'lil-gui';
import type * as THREE from 'three/webgpu';
import type { ResolutionController } from '../core/renderer';
import type { PerfHud } from '../core/perfHud';
import type { SkyAndSun } from '../world/sky';
import type { OceanSim } from '../ocean/oceanSim';
import type { OceanSurface } from '../ocean/oceanSurface';

export function createGui(opts: {
  renderer: THREE.WebGPURenderer;
  resolution: ResolutionController;
  hud: PerfHud;
  sky: SkyAndSun;
  oceanSim: OceanSim;
  ocean: OceanSurface;
}): GUI {
  const gui = new GUI({ title: 'Reef' });
  const { renderer, resolution, hud, sky, oceanSim, ocean } = opts;

  const sun = gui.addFolder('Sun');
  sun.add(sky.state, 'elevation', -10, 90, 0.1).onChange(() => sky.update());
  sun.add(sky.state, 'azimuth', 0, 360, 0.1).onChange(() => sky.update());
  sun.add(sky.state, 'rayleigh', 0.2, 4, 0.01).onChange(() => sky.update());
  sun.add(sky.state, 'mie', 0, 5, 0.01).name('haze').onChange(() => sky.update());
  sun.add(sky.state, 'sunLux', 0, 12, 0.01).name('sun intensity').onChange(() => sky.update());
  sun.add(sky.state, 'envIntensity', 0, 3, 0.01).name('sky light').onChange(() => sky.update());

  const p = oceanSim.params;
  const rebuild = () => oceanSim.applyParams();
  const waves = gui.addFolder('Waves');
  waves.add(p.wind, 'windSpeed', 0.5, 20, 0.1).name('wind m/s').onFinishChange(rebuild);
  waves.add(p.wind, 'direction', 0, 360, 1).name('wind dir').onFinishChange(rebuild);
  waves.add(p.wind, 'fetch', 1000, 300000, 1000).name('fetch m').onFinishChange(rebuild);
  waves.add(p.wind, 'scale', 0, 4, 0.01).name('wind sea scale').onFinishChange(rebuild);
  waves.add(p.swell, 'scale', 0, 4, 0.01).name('swell scale').onFinishChange(rebuild);
  waves.add(p.swell, 'windSpeed', 0.5, 10, 0.1).name('swell energy').onFinishChange(rebuild);
  waves.add(p.swell, 'direction', 0, 360, 1).name('swell dir').onFinishChange(rebuild);
  waves.add(p, 'choppiness', 0, 2.5, 0.01).onChange((v: number) => (oceanSim.choppiness.value = v));
  waves.add(p, 'timeScale', 0, 3, 0.01).name('time scale');
  waves.add(ocean.shoalDepth, 'value', 0.2, 8, 0.1).name('shoal depth m');

  const foam = gui.addFolder('Foam');
  foam.add(oceanSim.foamBias, 'value', 0, 1.5, 0.01).name('whitecap bias');
  foam.add(oceanSim.foamGain, 'value', 0, 20, 0.1).name('whitecap gain');
  foam.add(oceanSim.foamDecay, 'value', 0, 5, 0.01).name('decay');
  foam.add(ocean.look.shoreFoam, 'value', 0, 2, 0.01).name('shore / boiler');

  const water = gui.addFolder('Water');
  const abs = ocean.look.absorption.value;
  water.add(abs, 'x', 0, 2, 0.005).name('absorb R');
  water.add(abs, 'y', 0, 1, 0.005).name('absorb G');
  water.add(abs, 'z', 0, 1, 0.005).name('absorb B');
  const deep = ocean.look.deepColor.value;
  water.add(deep, 'x', 0, 0.5, 0.001).name('scatter R');
  water.add(deep, 'y', 0, 0.5, 0.001).name('scatter G');
  water.add(deep, 'z', 0, 0.5, 0.001).name('scatter B');
  water.add(ocean.look.refraction, 'value', 0, 3, 0.01).name('refraction');
  water.add(ocean.look.roughness, 'value', 0.005, 0.4, 0.001).name('roughness');
  water.add(ocean.look.sssStrength, 'value', 0, 4, 0.01).name('crest glow');

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
  setInterval(() => (scaleProxy.scale = resolution.scale), 500);

  for (const f of [waves, foam, water]) f.close();
  return gui;
}
