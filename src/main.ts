import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { dot, fract, renderOutput, screenCoordinate, vec2, vec4 } from 'three/tsl';
import { createRenderer } from './core/renderer';
import { QualityController, type Tier } from './core/quality';
import { loadBakedSeabed } from './world/seabedBake';
import { PerfHud } from './core/perfHud';
import { HALF_X, HALF_Z } from './config';
import { SkyAndSun } from './world/sky';
import { createSeabed } from './world/seabed';
import { SeabedMap } from './world/seabedMap';
import { createFrame } from './world/frame';
import { createGui } from './ui/gui';
import { createTimeArc } from './ui/timeArc';
import { createCornerButtons } from './ui/corner';
import { PhotoMode } from './ui/photoMode';
import { Ambience } from './audio/ambience';
import { seabedHeight } from './world/seabedProfile';
import { DEFAULT_OCEAN } from './ocean/params';
import { OceanSim } from './ocean/oceanSim';
import { OceanSurface } from './ocean/oceanSurface';
import { OceanProbe } from './ocean/oceanProbe';
import { Caustics } from './underwater/caustics';
import { UnderwaterLighting } from './underwater/underwaterLighting';
import { UnderwaterPost } from './underwater/underwaterPost';
import { createMarineSnow } from './underwater/marineSnow';
import { Bioluminescence } from './underwater/bioluminescence';
import { ReefMaterials } from './reef/reefMaterials';
import { createReef } from './reef/reef';
import { createFauna, type Fauna } from './fauna/fauna';

const CAMERA_CLEARANCE = 0.45;
const INTRO_SECONDS = 6.5;

/** Interleaved-gradient noise, ±1 LSB triangular: hides 8-bit banding in the sky and fog gradients. */
function dithered(color: THREE.Node<'vec4'>): THREE.Node<'vec4'> {
  const ign = (o: number) => fract(fract(dot(screenCoordinate.xy.add(o), vec2(0.06711056, 0.00583715))).mul(52.9829189));
  return vec4(color.rgb.add(ign(0).add(ign(5.588238)).sub(1).div(255)), 1);
}

function showNotice(title?: string, detail?: string): void {
  document.getElementById('veil')?.remove();
  const notice = document.getElementById('unsupported')!;
  if (title) notice.querySelector('h1')!.textContent = title;
  if (detail) notice.querySelector('p')!.textContent = detail;
  notice.hidden = false;
}

async function main(): Promise<void> {
  // navigator.gpu exists on many phones that have no usable adapter; three would then fall back
  // to WebGL2, which can't run the ocean's storage-texture compute passes.
  const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
  if (!adapter) {
    showNotice();
    return;
  }

  const seabedReady = loadBakedSeabed();
  const container = document.getElementById('app')!;
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 6000);
  camera.position.set(62, 34, 82);

  const { renderer, pipeline, scenePass } = await createRenderer(container, scene, camera);
  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    renderer.domElement.remove();
    showNotice();
    return;
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.2;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI * 0.94;
  controls.update();

  const sky = new SkyAndSun(scene);
  await seabedReady;
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
  const bio = new Bioluminescence(sky);
  scene.add(seabed, ocean.group, createFrame(), snow, bio.sprite);
  const photo = new PhotoMode(() => (captureNext = true));
  const hdr = post.build(scenePass);
  const output = dithered(renderOutput(hdr));
  const photoOutput = dithered(renderOutput(dof(hdr, scenePass.getViewZNode(), photo.focus, photo.focalLength, photo.bokeh)));
  pipeline.outputColorTransform = false;
  pipeline.outputNode = output;
  let captureNext = false;

  // The ocean shows first; the reef compiles in the background and rises into place, then the fauna.
  let fauna: Fauna | null = null;
  let reefGroup: THREE.Group | null = null;
  let tier: Tier | null = null;
  let revealStart = -1;
  const applyTier = (t: Tier) => {
    tier = t;
    ocean.setSpacing(t.surfaceSpacing);
    const grass = reefGroup?.getObjectByName('seagrass') as THREE.InstancedMesh | undefined;
    if (grass) grass.count = Math.round(grass.userData.total * t.seagrass);
    fauna?.setBait(t.bait);
  };
  createReef(reefMaterials)
    .then(async ({ group, surfaces }) => {
      reefGroup = group;
      reefMaterials.reveal.value = 0;
      if (tier) applyTier(tier);
      await renderer.compileAsync(group, camera, scene);
      scene.add(group);
      resolution.settle(3000);
      revealStart = performance.now();
      const f = await createFauna(underwater, surfaces);
      await renderer.compileAsync(f.group, camera, scene);
      fauna = f;
      if (tier) applyTier(tier);
      scene.add(f.group);
      resolution.settle(3000);
    })
    .catch((e) => console.error('reef failed to load', e));

  const resolution = new QualityController({ setPixelRatio: (r) => renderer.setPixelRatio(r), applyTier });
  const hasTimestamps = renderer.hasFeature('timestamp-query');
  resolution.settle(4000);
  const hud = new PerfHud(renderer);
  const gui = createGui({ renderer, resolution, hud, sky, oceanSim, ocean, underwater, post, caustics });
  const timeArc = createTimeArc(sky);
  const ambience = new Ambience();
  createCornerButtons({ sound: (on) => void ambience.setEnabled(on), photo: () => photo.toggle() });
  // Dev tools stay out of the way: ?dev in the URL, or the backquote key, toggles them.
  let dev = new URLSearchParams(location.search).has('dev');
  const showDev = () => {
    gui.show(dev);
    hud.visible = dev;
  };
  showDev();
  window.addEventListener('keydown', (e) => {
    if (e.key === '`') {
      dev = !dev;
      showDev();
    }
  });

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

  // Photo mode: the world freezes, depth of field comes in, clicks focus.
  const forward = new THREE.Vector3();
  const focusOn = (point: THREE.Vector3) => photo.focusAt(Math.max(forward.copy(point).sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3())), 0.3));
  photo.onChange((on) => {
    pipeline.outputNode = on ? photoOutput : output;
    pipeline.needsUpdate = true;
    if (on) focusOn(controls.target);
  });
  let downAt = { x: 0, y: 0 };
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener('click', (e) => {
    if (!photo.active || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [seabedTop, ...(reefGroup?.children.filter((o) => o.name !== 'seagrass') ?? []), ...(fauna?.group.children ?? [])];
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) focusOn(hit.point);
  });
  const saveFrame = () => {
    const scale = resolution.scale;
    const auto = resolution.enabled;
    resolution.enabled = false;
    renderer.setPixelRatio(Math.max(window.devicePixelRatio, 2));
    pipeline.render();
    // Read back in the same task as the render, before the canvas is presented.
    renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `reef-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
    renderer.setPixelRatio(scale);
    resolution.enabled = auto;
  };

  // Veil until the reef and fauna are in and their shaders compiled, then a slow fly-in.
  const automated = navigator.webdriver || dev;
  const veil = document.getElementById('veil')!;
  const home = { position: camera.position.clone(), target: controls.target.clone() };
  const homeSph = new THREE.Spherical().setFromVector3(home.position.clone().sub(home.target));
  const startSph = new THREE.Spherical(homeSph.radius * 1.7, homeSph.phi - 0.22, homeSph.theta + 0.75);
  let intro = automated ? -1 : 0;
  let readyFrames = 0;
  let lifted = automated;
  if (automated) veil.remove();
  else camera.position.setFromSpherical(startSph).add(home.target);
  controls.addEventListener('start', () => (intro = -1));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  const state = { underwater: false };
  const lastCam = camera.position.clone();
  const listener = { position: camera.position, right: new THREE.Vector3(), underwater: false, depth: 0, night: 0, speed: 0 };
  let adapted = renderer.toneMappingExposure;

  let resolving = false;
  let lastFrame = -1e9;
  renderer.setAnimationLoop((now: number) => {
    // Frame cap (30 on phones, 60 elsewhere), with a little slack for rAF jitter.
    const sinceLast = now - lastFrame;
    if (sinceLast < resolution.interval - 2.5) return;
    lastFrame = now;
    const t0 = performance.now();
    timer.update(now);
    const dt = timer.getDelta();
    const frozen = photo.active;

    if (!automated && !lifted && ++readyFrames > 8) {
      lifted = true;
      veil.classList.add('lifted');
      setTimeout(() => veil.remove(), 2500);
    }
    if (intro >= 0 && lifted) intro += dt / INTRO_SECONDS;
    if (intro >= 0) {
      const k = Math.min(intro, 1);
      const e = 1 - Math.pow(1 - k, 3);
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(startSph.radius, homeSph.radius, e),
        THREE.MathUtils.lerp(startSph.phi, homeSph.phi, e),
        THREE.MathUtils.lerp(startSph.theta, homeSph.theta, e),
      );
      camera.position.setFromSpherical(sph).add(home.target);
      if (k >= 1) intro = -1;
    }

    if (revealStart >= 0) {
      const k = Math.min((performance.now() - revealStart) / 2800, 1);
      reefMaterials.reveal.value = k;
      if (k >= 1) revealStart = -1;
    }

    controls.target.lerp(targetGoal, 1 - Math.exp(-dt * 4));
    controls.update();
    const inSlab = Math.abs(camera.position.x) < HALF_X && Math.abs(camera.position.z) < HALF_Z;
    if (inSlab) {
      const floor = seabedHeight(camera.position.x, camera.position.z) + CAMERA_CLEARANCE;
      if (camera.position.y < floor) camera.position.y = floor;
    }

    timeArc.tick();
    if (!frozen) {
      fauna?.update(dt, camera.position);
      if (bio.begin(dt, camera.position, state.underwater)) {
        fauna?.emit(bio.emit, dt);
        bio.end();
      }
    }
    // Eye adaptation: ease exposure toward the light level (faster when brightening, like a real eye).
    const exp = adapted;
    // Under the surface at night the eye can't fully adapt, so the dark (and the glow) stays.
    const target = sky.targetExposure * (state.underwater ? 1 - 0.6 * sky.night.value : 1);
    const rate = target < exp ? 3 : 1.2;
    adapted = Math.exp(THREE.MathUtils.lerp(Math.log(exp), Math.log(target), 1 - Math.exp(-dt * rate)));
    renderer.toneMappingExposure = adapted * (frozen ? 2 ** photo.settings.ev : 1);
    sky.tick(renderer);
    underwater.updateSun(sky.keyDirection);
    if (!frozen) {
      oceanSim.update(renderer, dt);
      caustics.update(renderer);
    }
    probe.update(renderer, camera.position.x, camera.position.z);
    state.underwater = inSlab && camera.position.y < probe.height;
    snow.visible = inSlab && camera.position.y < probe.height + 1;

    listener.right.setFromMatrixColumn(camera.matrixWorld, 0);
    listener.underwater = state.underwater;
    listener.depth = Math.max(probe.height - camera.position.y, 0);
    listener.night = sky.night.value;
    listener.speed = dt > 0 ? lastCam.distanceTo(camera.position) / dt : 0;
    lastCam.copy(camera.position);
    ambience.update(dt, listener);

    if (captureNext) {
      captureNext = false;
      saveFrame();
    } else pipeline.render();
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

    resolution.sample(hasTimestamps ? hud.gpuMs : 0, sinceLast, now);
    hud.frame(cpuMs, resolution.scale);
  });

  Object.assign(window, {
    __reef: { scene, camera, renderer, controls, sky, oceanSim, ocean, resolution, hud, underwater, post, caustics, probe, state, targetGoal, reefMaterials, bio, photo, ambience, get fauna() { return fauna; } },
  });
}

main().catch((e: unknown) => {
  console.error(e);
  showNotice('Reef failed to start', e instanceof Error ? e.message : String(e));
});
