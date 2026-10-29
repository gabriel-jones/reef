import GUI from 'lil-gui';
import type * as THREE from 'three/webgpu';
import { TIERS, type QualityController } from '../core/quality';
import type { PerfHud } from '../core/perfHud';
import type { SkyAndSun } from '../world/sky';
import type { OceanSim } from '../ocean/oceanSim';
import type { OceanSurface } from '../ocean/oceanSurface';
import type { UnderwaterLighting } from '../underwater/underwaterLighting';
import type { UnderwaterPost } from '../underwater/underwaterPost';
import type { Caustics } from '../underwater/caustics';

export function createGui(opts: {
  renderer: THREE.WebGPURenderer;
  resolution: QualityController;
  hud: PerfHud;
  sky: SkyAndSun;
  oceanSim: OceanSim;
  ocean: OceanSurface;
  underwater: UnderwaterLighting;
  post: UnderwaterPost;
  caustics: Caustics;
}): GUI {
  const gui = new GUI({ title: 'Reef' });
  const { resolution, hud, sky, oceanSim, ocean, underwater, post, caustics } = opts;

  const sun = gui.addFolder('Sun');
  sun.add(sky.state, 'hours', 0, 24, 0.01).name('time of day').onChange(() => sky.update()).listen();
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

  const under = gui.addFolder('Underwater');
  under.add(underwater.causticStrength, 'value', 0, 3, 0.01).name('caustics');
  under.add(caustics.focusDepth[0], 'value', 1, 40, 0.1).name('caustic focus m');
  under.add(caustics.focusDepth[1], 'value', 0.5, 15, 0.1).name('ripple focus m');
  under.add(post.godRays, 'value', 0, 3, 0.01).name('god rays');
  under.add(post.scatter, 'value', 0, 0.3, 0.001).name('turbidity');
  under.add(post.fogColor.value, 'x', 0, 0.5, 0.001).name('fog R');
  under.add(post.fogColor.value, 'y', 0, 0.5, 0.001).name('fog G');
  under.add(post.fogColor.value, 'z', 0, 0.5, 0.001).name('fog B');
  under.add(post.debug, 'value', { final: 0, mask: 1, transmittance: 2, inscatter: 3, distance: 4 }).name('debug');
  under.add(ocean.swashHeight, 'value', 0, 0.5, 0.01).name('swash height');
  under.add(ocean.swashSpeed, 'value', 0, 2, 0.01).name('swash speed');

  const render = gui.addFolder('Render');
  render.add(sky.state, 'exposure', 0.05, 3, 0.01).onChange(() => sky.update());
  render.add(resolution, 'enabled').name('auto quality');
  const tierProxy = { tier: resolution.current.name };
  render
    .add(tierProxy, 'tier', TIERS.map((t) => t.name))
    .name('quality')
    .listen()
    .onChange((name: string) => resolution.changeTier(TIERS.findIndex((t) => t.name === name)));
  const scaleProxy = { scale: resolution.scale };
  render
    .add(scaleProxy, 'scale', 0.5, 2, 0.05)
    .name('pixel ratio')
    .listen()
    .onChange((v: number) => resolution.setScale(v));
  const hudProxy = { perfHud: true };
  render.add(hudProxy, 'perfHud').name('perf HUD').onChange((v: boolean) => (hud.visible = v));
  setInterval(() => {
    scaleProxy.scale = resolution.scale;
    tierProxy.tier = resolution.current.name;
  }, 500);

  for (const f of [waves, foam, water, under]) f.close();
  return gui;
}
