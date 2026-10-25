import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, ResolutionController } from './core/renderer';
import { PerfHud } from './core/perfHud';
import { SkyAndSun } from './world/sky';
import { createSeabed } from './world/seabed';
import { createFrame, createWaterPlaceholder } from './world/waterPlaceholder';
import { createGui } from './ui/gui';
import { loadModel } from './core/assets';
import { seabedHeight } from './world/seabedProfile';

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
  scene.add(createSeabed(), createWaterPlaceholder(), createFrame());

  loadModel('test_rock').then((rock) => {
    rock.position.set(-33, seabedHeight(-33, 6) + 0.2, 6);
    rock.scale.setScalar(1.6);
    scene.add(rock);
  });

  const resolution = new ResolutionController(renderer);
  const hud = new PerfHud(renderer);
  createGui({ renderer, resolution, hud, sky });

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
    controls.update();
    sky.tick(renderer);
    pipeline.render();
    const cpuMs = performance.now() - t0;

    if (!resolving && renderer.hasFeature('timestamp-query')) {
      resolving = true;
      renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER).then((ms) => {
        if (typeof ms === 'number' && ms > 0) hud.gpuMs = ms;
        resolving = false;
      });
    }

    resolution.sample(hud.gpuMs || timer.getDelta() * 1000, now);
    hud.frame(cpuMs, resolution.scale);
  });

  Object.assign(window, { __reef: { scene, camera, renderer, controls, sky } });
}

main();
