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
