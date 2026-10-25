import * as THREE from 'three/webgpu';
import { texture, equirectUV, positionWorldDirection, dot, smoothstep, uniform, floor, fract, hash, length, sin, time, vec3, max, float } from 'three/tsl';
import { HALF_X, HALF_Z } from '../config';
import { SkyLut, sunTransmittance } from './atmosphere';

export interface SunState {
  /** Local solar time, 0–24. */
  hours: number;
  rayleigh: number;
  mie: number;
  sunLux: number;
  envIntensity: number;
  /** Base exposure; eye adaptation multiplies it as the light level changes. */
  exposure: number;
}

// Bermuda in late spring. Scene azimuth = compass bearing + NORTH_OFFSET, chosen so the afternoon sun
// lights the slab from the front-left and sets over the open sea (+X) beyond the boiler reef.
const LATITUDE = THREE.MathUtils.degToRad(32.3);
const DECLINATION = THREE.MathUtils.degToRad(15);
const NORTH_OFFSET = -210;
/** Full-moon irradiance relative to the sun — far brighter than nature, so night stays readable. */
const MOON = 1 / 600;
const MOON_TINT = new THREE.Color(0.72, 0.84, 1.0);

/** Solar elevation and compass azimuth (degrees) for a local solar time. */
export function solarPosition(hours: number): { elevation: number; azimuth: number } {
  const H = THREE.MathUtils.degToRad((hours - 12) * 15);
  const sinEl = Math.sin(LATITUDE) * Math.sin(DECLINATION) + Math.cos(LATITUDE) * Math.cos(DECLINATION) * Math.cos(H);
  const el = Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1));
  const cosA = (Math.sin(DECLINATION) - Math.sin(el) * Math.sin(LATITUDE)) / Math.max(Math.cos(el) * Math.cos(LATITUDE), 1e-6);
  let az = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosA, -1, 1)));
  if (Math.sin(H) > 0) az = 360 - az;
  return { elevation: THREE.MathUtils.radToDeg(el), azimuth: az };
}

function luminance(c: THREE.Color): number {
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}

export class SkyAndSun {
  readonly lut = new SkyLut();
  /** The key light: the sun by day, the moon by night. */
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  /** Toward the sun (may be below the horizon). */
  readonly direction = new THREE.Vector3();
  readonly moonDirection = new THREE.Vector3();
  /** Toward whichever of sun/moon is lighting the scene. */
  readonly keyDirection = new THREE.Vector3();
  readonly sunColor = uniform(new THREE.Vector3(1, 1, 1));
  readonly moonColor = uniform(new THREE.Vector3(0, 0, 0));
  /** Key-light irradiance at sea level (colour × intensity), for custom-lit materials. */
  readonly sunRadiance = this.lut.sunRadiance;
  /** Toward the key light, for custom-lit materials. */
  readonly lightDir = this.lut.keyDir;
  /** 0 by day … 1 once the sun is well below the horizon. */
  readonly night = uniform(0);
  readonly state: SunState = { hours: 14.5, rayleigh: 1.25, mie: 0.6, sunLux: 4.2, envIntensity: 1, exposure: 0.9 };
  elevation = 0;
  /** Exposure the eye is adapting toward; main eases the renderer toward it. */
  targetExposure = 0.9;

  private transmittance = new THREE.Color();
  private moonTransmittance = new THREE.Color();
  private referenceLight = 0;

  constructor(private scene: THREE.Scene) {
    const dir = positionWorldDirection;
    const sunDisc = smoothstep(0.99996, 0.99999, dot(dir, this.lut.sunDir)).mul(this.sunColor).mul(3000);
    const moonDisc = smoothstep(0.99993, 0.99996, dot(dir, this.lut.moonDir))
      .mul(sin(dir.x.mul(820)).mul(sin(dir.z.mul(760).add(dir.y.mul(500)))).mul(0.12).add(0.88))
      .mul(this.moonColor)
      .mul(3000 * 0.6);
    // Stars: one candidate per cell of a direction grid, faded in as the sky darkens.
    const g = dir.mul(260);
    const cell = floor(g);
    const h = hash(cell.x.mul(7.13).add(cell.y.mul(113.7)).add(cell.z.mul(271.9)));
    const jitter = vec3(hash(h.mul(17.1)), hash(h.mul(31.7)), hash(h.mul(53.3))).mul(0.6).add(0.2);
    const d = length(fract(g).sub(jitter));
    const twinkle = sin(time.mul(2.3).add(h.mul(400))).mul(0.25).add(0.75);
    const stars = smoothstep(0.2, 0.0, d)
      .mul(max(h.sub(0.9965), 0).div(0.0035))
      .mul(twinkle)
      .mul(smoothstep(0.0, 0.12, dir.y))
      .mul(this.night)
      .mul(float(0.035));
    scene.backgroundNode = texture(this.lut.target.texture, equirectUV(dir)).rgb.add(sunDisc).add(moonDisc).add(vec3(0.85, 0.9, 1).mul(stars));
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
    this.referenceLight = this.lightLevel(this.elevation, this.state);
    this.update();
  }

  /** Rough scene illuminance (key light + skylight) driving eye adaptation. */
  private lightLevel(sunEl: number, st: SunState): number {
    const sunY = Math.sin(THREE.MathUtils.degToRad(sunEl));
    const sunVis = THREE.MathUtils.smoothstep(sunEl, -3, 2);
    const twilight = THREE.MathUtils.smoothstep(sunEl, -12, 25) ** 2.2;
    const moonVis = THREE.MathUtils.smoothstep(-sunEl, -3, 4);
    const direct = st.sunLux * sunVis * Math.max(sunY, 0.03) * luminance(this.transmittance);
    const moon = st.sunLux * MOON * moonVis * Math.max(-sunY, 0.05) * 1.6;
    return direct + st.sunLux * 0.35 * twilight + moon + st.sunLux * 2e-5;
  }

  update(): void {
    const st = this.state;
    const { elevation, azimuth } = solarPosition(st.hours);
    this.elevation = elevation;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth + NORTH_OFFSET);
    this.direction.setFromSphericalCoords(1, phi, theta);
    // A full moon rides opposite the sun.
    this.moonDirection.copy(this.direction).negate();

    sunTransmittance(this.direction, st.rayleigh, st.mie, this.transmittance);
    sunTransmittance(this.moonDirection, st.rayleigh, st.mie, this.moonTransmittance);
    this.sunColor.value.set(this.transmittance.r, this.transmittance.g, this.transmittance.b);

    const sunVis = THREE.MathUtils.smoothstep(elevation, -3, 2);
    const moonVis = THREE.MathUtils.smoothstep(-elevation, -3, 4);
    const sunI = st.sunLux * sunVis;
    const moonI = st.sunLux * MOON * moonVis;
    const moonCol = this.moonTransmittance.clone().multiply(MOON_TINT);
    this.moonColor.value.set(moonCol.r, moonCol.g, moonCol.b).multiplyScalar(MOON * moonVis);

    const moonKey = moonI > sunI;
    const keyColor = moonKey ? moonCol : this.transmittance;
    const keyI = moonKey ? moonI : sunI;
    this.keyDirection.copy(moonKey ? this.moonDirection : this.direction);
    this.sun.color.copy(keyColor);
    this.sun.intensity = keyI;
    this.sunRadiance.value.set(keyColor.r, keyColor.g, keyColor.b).multiplyScalar(keyI);
    this.sun.position.copy(this.keyDirection).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.scene.environmentIntensity = st.envIntensity;
    this.night.value = THREE.MathUtils.smoothstep(-elevation, 2, 12);

    this.lut.sunDir.value.copy(this.direction);
    this.lut.moonDir.value.copy(this.moonDirection);
    this.lut.keyDir.value.copy(this.keyDirection);
    this.lut.moonScale.value = MOON * 1.3;
    this.lut.rayleigh.value = st.rayleigh;
    this.lut.mie.value = st.mie;
    this.lut.invalidate();

    // Adapt only partly while the sun is up, so dusk reads as dusk; fully at night so the moonlit scene stays legible.
    const adapt = THREE.MathUtils.lerp(0.42, 0.74, THREE.MathUtils.smoothstep(-elevation, -4, 6));
    const gain = THREE.MathUtils.clamp((this.referenceLight / this.lightLevel(elevation, st)) ** adapt, 0.6, 160);
    this.targetExposure = st.exposure * gain;
  }

  /** Re-bake the sky LUT if the sun changed. Call once per frame before rendering. */
  tick(renderer: THREE.WebGPURenderer): void {
    this.lut.update(renderer);
  }
}
