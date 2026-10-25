import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, ResolutionController } from './core/renderer';
import { PerfHud } from './core/perfHud';
import { HALF_X, HALF_Z } from './config';
import { SkyAndSun } from './world/sky';
import { createSeabed } from './world/seabed';
import { SeabedMap } from './world/seabedMap';
import { createFrame } from './world/frame';
import { createGui } from './ui/gui';
import { seabedHeight } from './world/seabedProfile';
import { DEFAULT_OCEAN } from './ocean/params';
import { OceanSim } from './ocean/oceanSim';
import { OceanSurface } from './ocean/oceanSurface';
import { OceanProbe } from './ocean/oceanProbe';
import { Caustics } from './underwater/caustics';
import { UnderwaterLighting } from './underwater/underwaterLighting';
import { UnderwaterPost } from './underwater/underwaterPost';
import { createMarineSnow } from './underwater/marineSnow';
import { ReefMaterials } from './reef/reefMaterials';
import { createReef } from './reef/reef';

const CAMERA_CLEARANCE = 0.45;

async function main(): Promise<void> {
  if (!navigator.gpu) {
    document.getElementById('unsupported')!.hidden = false;
    return;
  }

  const container = document.getElementById('app')!;
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 6000);
  camera.position.set(62, 34, 82);

  const { renderer, pipeline, scenePass } = await createRenderer(container, scene, camera);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.2;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.94;
  controls.update();

  const sky = new SkyAndSun(scene);
  const seabedMap = new SeabedMap();
  const oceanParams = structuredClone(DEFAULT_OCEAN);
  const oceanSim = new OceanSim(oceanParams);
  const ocean = new OceanSurface(oceanSim, seabedMap, sky);
  const caustics = new Caustics(oceanSim);
  const underwater = new UnderwaterLighting(caustics, ocean.look.absorption);
  const post = new UnderwaterPost(ocean, sky, underwater, camera);
  const probe = new OceanProbe(ocean);
  const snow = createMarineSnow(sky, ocean);

  const reefMaterials = new ReefMaterials(underwater);
  const seabed = createSeabed(underwater, reefMaterials);
  scene.add(seabed, ocean.group, createFrame(), snow);
  pipeline.outputNode = post.build(scenePass);

  createReef(reefMaterials).then((reef) => scene.add(reef));

  const resolution = new ResolutionController(renderer);
  const hud = new PerfHud(renderer);
  createGui({ renderer, resolution, hud, sky, oceanSim, ocean, underwater, post, caustics });

  // Double-click the seabed to orbit around that spot; zooming in from there dives under.
  const raycaster = new THREE.Raycaster();
  const seabedTop = seabed.getObjectByName('seabed-top')!;
  const targetGoal = new THREE.Vector3().copy(controls.target);
  renderer.domElement.addEventListener('dblclick', (e) => {
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(seabedTop, false)[0];
    if (hit) targetGoal.copy(hit.point).add(new THREE.Vector3(0, 1.2, 0));
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  const state = { underwater: false };

  let resolving = false;
  renderer.setAnimationLoop((now: number) => {
    const t0 = performance.now();
    timer.update(now);
    const dt = timer.getDelta();

    controls.target.lerp(targetGoal, 1 - Math.exp(-dt * 4));
    controls.update();
    const inSlab = Math.abs(camera.position.x) < HALF_X && Math.abs(camera.position.z) < HALF_Z;
    if (inSlab) {
      const floor = seabedHeight(camera.position.x, camera.position.z) + CAMERA_CLEARANCE;
      if (camera.position.y < floor) camera.position.y = floor;
    }

    sky.tick(renderer);
    underwater.updateSun(sky.direction);
    oceanSim.update(renderer, dt);
    caustics.update(renderer);
    probe.update(renderer, camera.position.x, camera.position.z);
    state.underwater = inSlab && camera.position.y < probe.height;
    snow.visible = inSlab && camera.position.y < probe.height + 1;

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

  Object.assign(window, {
    __reef: { scene, camera, renderer, controls, sky, oceanSim, ocean, resolution, hud, underwater, post, caustics, probe, state, targetGoal, reefMaterials },
  });
}

main();
