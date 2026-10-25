import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, ResolutionController } from './core/renderer';
import { PerfHud } from './core/perfHud';
import { SkyAndSun } from './world/sky';
import { createSeabed } from './world/seabed';
import { SeabedMap } from './world/seabedMap';
import { createFrame } from './world/frame';
import { createGui } from './ui/gui';
import { loadModel } from './core/assets';
import { seabedHeight } from './world/seabedProfile';
import { DEFAULT_OCEAN } from './ocean/params';
import { OceanSim } from './ocean/oceanSim';
import { OceanSurface } from './ocean/oceanSurface';

async function main(): Promise<void> {
  if (!navigator.gpu) {
    document.getElementById('unsupported')!.hidden = false;
    return;
  }

  const container = document.getElementById('app')!;
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.position.set(62, 34, 82);

  const { renderer, pipeline } = await createRenderer(container, scene, camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 4;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.update();

  const sky = new SkyAndSun(scene);
  const seabedMap = new SeabedMap();
  const oceanParams = structuredClone(DEFAULT_OCEAN);
  const oceanSim = new OceanSim(oceanParams);
  const ocean = new OceanSurface(oceanSim, seabedMap, sky);
  scene.add(createSeabed(), ocean.group, createFrame());

  loadModel('test_rock').then((rock) => {
    rock.position.set(-33, seabedHeight(-33, 6) + 0.2, 6);
    rock.scale.setScalar(1.6);
    scene.add(rock);
  });

  const resolution = new ResolutionController(renderer);
  const hud = new PerfHud(renderer);
  createGui({ renderer, resolution, hud, sky, oceanSim, ocean });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();
  timer.connect(document);

  let resolving = false;
  renderer.setAnimationLoop((now: number) => {
    const t0 = performance.now();
    timer.update(now);
    const dt = timer.getDelta();
    controls.update();
    sky.tick(renderer);
    oceanSim.update(renderer, dt);
    pipeline.render();
    const cpuMs = performance.now() - t0;

    if (!resolving && renderer.hasFeature('timestamp-query')) {
      resolving = true;
      Promise.all([
        renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER),
        renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE),
      ]).then(([r, c]) => {
        const renderMs = typeof r === 'number' ? r : 0;
        const computeMs = typeof c === 'number' ? c : 0;
        if (renderMs + computeMs > 0) {
          hud.gpuMs = renderMs + computeMs;
          hud.computeMs = computeMs;
        }
        resolving = false;
      });
    }

    resolution.sample(hud.gpuMs || dt * 1000, now);
    hud.frame(cpuMs, resolution.scale);
  });

  Object.assign(window, { __reef: { scene, camera, renderer, controls, sky, oceanSim, ocean, resolution, hud } });
}

main();
