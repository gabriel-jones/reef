import * as THREE from 'three/webgpu';
import { texture, equirectUV, positionWorldDirection, dot, smoothstep, uniform } from 'three/tsl';
import { HALF_X, HALF_Z } from '../config';
import { SkyLut, sunTransmittance } from './atmosphere';

export interface SunState {
  elevation: number;
  azimuth: number;
  rayleigh: number;
  mie: number;
  sunLux: number;
  envIntensity: number;
}

export class SkyAndSun {
  readonly lut = new SkyLut();
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly direction = new THREE.Vector3();
  readonly sunColor = uniform(new THREE.Vector3(1, 1, 1));
  /** Direct sun irradiance at sea level (colour × intensity), for custom-lit materials. */
  readonly sunRadiance = this.lut.sunRadiance;
  readonly state: SunState = { elevation: 52, azimuth: 35, rayleigh: 1.25, mie: 0.6, sunLux: 4.2, envIntensity: 1 };

  private transmittance = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    const dir = positionWorldDirection;
    const sunDisc = smoothstep(0.99996, 0.99999, dot(dir, this.lut.sunDir)).mul(this.sunColor).mul(3000);
    scene.backgroundNode = texture(this.lut.target.texture, equirectUV(dir)).rgb.add(sunDisc);
    scene.environment = this.lut.target.texture;

    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    const ext = Math.hypot(HALF_X, HALF_Z) + 2;
    s.camera.left = -ext;
    s.camera.right = ext;
    s.camera.top = ext;
    s.camera.bottom = -ext;
    s.camera.near = 1;
    s.camera.far = 200;
    s.bias = -0.0004;
    s.normalBias = 0.03;
    this.sun.castShadow = true;
    scene.add(this.sun, this.sun.target);

    this.update();
  }

  update(): void {
    const st = this.state;
    const phi = THREE.MathUtils.degToRad(90 - st.elevation);
    const theta = THREE.MathUtils.degToRad(st.azimuth);
    this.direction.setFromSphericalCoords(1, phi, theta);

    this.lut.sunDir.value.copy(this.direction);
    this.lut.rayleigh.value = st.rayleigh;
    this.lut.mie.value = st.mie;
    this.lut.invalidate();

    sunTransmittance(this.direction, st.rayleigh, st.mie, this.transmittance);
    this.sunColor.value.set(this.transmittance.r, this.transmittance.g, this.transmittance.b);
    const horizonFade = THREE.MathUtils.smoothstep(st.elevation, -2, 3);
    this.sun.color.copy(this.transmittance);
    this.sun.intensity = st.sunLux * horizonFade;
    this.sunRadiance.value.set(this.transmittance.r, this.transmittance.g, this.transmittance.b).multiplyScalar(this.sun.intensity);
    this.sun.position.copy(this.direction).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.scene.environmentIntensity = st.envIntensity;
  }

  /** Re-bake the sky LUT if the sun changed. Call once per frame before rendering. */
  tick(renderer: THREE.WebGPURenderer): void {
    this.lut.update(renderer);
  }
}
