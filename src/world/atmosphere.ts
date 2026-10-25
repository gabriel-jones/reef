import * as THREE from 'three/webgpu';
import { Fn, Loop, float, vec3, vec4, uv, uniform, exp, sqrt, max, dot, cos, sin, mix, smoothstep, PI } from 'three/tsl';

/** Nishita-style single scattering, in metres. Shared by the GPU sky LUT and the CPU sun-colour solve. */
export const ATMO = {
  earthRadius: 6360e3,
  atmoRadius: 6420e3,
  viewHeight: 2,
  betaR: new THREE.Vector3(5.8e-6, 13.5e-6, 33.1e-6),
  betaM: 21e-6,
  hR: 7994,
  hM: 1200,
  g: 0.76,
  sunIntensity: 20,
};

const PRIMARY_STEPS = 24;
const LIGHT_STEPS = 6;

type FloatNode = THREE.Node<'float'>;
type Vec3Node = THREE.Node<'vec3'>;

const raySphereFar = Fn(([origin, dir, radius]: [Vec3Node, Vec3Node, FloatNode]) => {
  const b = dot(origin, dir);
  const c = dot(origin, origin).sub(radius.mul(radius));
  return b.negate().add(sqrt(max(b.mul(b).sub(c), 0)));
});

/** Sky radiance for a view direction (y-up), assuming the viewer sits just above sea level. */
export const skyRadiance = Fn(([dirIn, sunDir, rayleighScale, mieScale]: [Vec3Node, Vec3Node, FloatNode, FloatNode]) => {
  const dir = vec3(dirIn.x, max(dirIn.y, 0.0), dirIn.z).normalize();
  const origin = vec3(0, ATMO.earthRadius + ATMO.viewHeight, 0);
  const betaR = vec3(ATMO.betaR.x, ATMO.betaR.y, ATMO.betaR.z).mul(rayleighScale);
  const betaM = float(ATMO.betaM).mul(mieScale);

  const tMax = raySphereFar(origin, dir, float(ATMO.atmoRadius));
  const sumR = vec3(0).toVar();
  const sumM = vec3(0).toVar();
  const odR = float(0).toVar();
  const odM = float(0).toVar();

  // Quadratic step spacing: near-horizon rays get most samples in the dense air close to the viewer.
  Loop(PRIMARY_STEPS, ({ i }) => {
    const a = float(i).div(PRIMARY_STEPS);
    const b = float(i).add(1).div(PRIMARY_STEPS);
    const t0 = a.mul(a).mul(tMax);
    const t1 = b.mul(b).mul(tMax);
    const ds = t1.sub(t0);
    const p = origin.add(dir.mul(t0.add(t1).mul(0.5)));
    const h = p.length().sub(ATMO.earthRadius);
    const hr = exp(h.negate().div(ATMO.hR)).mul(ds);
    const hm = exp(h.negate().div(ATMO.hM)).mul(ds);
    odR.addAssign(hr);
    odM.addAssign(hm);

    const tl = raySphereFar(p, sunDir, float(ATMO.atmoRadius));
    const dl = tl.div(LIGHT_STEPS);
    const lR = float(0).toVar();
    const lM = float(0).toVar();
    Loop(LIGHT_STEPS, ({ i: j }) => {
      const q = p.add(sunDir.mul(float(j).add(0.5).mul(dl)));
      const hq = q.length().sub(ATMO.earthRadius);
      lR.addAssign(exp(hq.negate().div(ATMO.hR)).mul(dl));
      lM.addAssign(exp(hq.negate().div(ATMO.hM)).mul(dl));
    });

    const tau = betaR.mul(odR.add(lR)).add(vec3(betaM.mul(1.1)).mul(odM.add(lM)));
    const att = exp(tau.negate());
    sumR.addAssign(att.mul(hr));
    sumM.addAssign(att.mul(hm));
  });

  const mu = dot(dir, sunDir);
  const phaseR = float(3).div(PI.mul(16)).mul(mu.mul(mu).add(1));
  const g = float(ATMO.g);
  const g2 = g.mul(g);
  const phaseM = float(3)
    .div(PI.mul(8))
    .mul(float(1).sub(g2).mul(mu.mul(mu).add(1)))
    .div(g2.add(2).mul(max(g2.add(1).sub(g.mul(mu).mul(2)), 1e-4).pow(1.5)));

  return sumR.mul(betaR).mul(phaseR).add(sumM.mul(betaM).mul(phaseM)).mul(ATMO.sunIntensity);
});

function opticalDepthCPU(height: number, dir: THREE.Vector3, steps = 24): [number, number] {
  const o = new THREE.Vector3(0, ATMO.earthRadius + height, 0);
  const b = o.dot(dir);
  const c = o.lengthSq() - ATMO.atmoRadius ** 2;
  const disc = b * b - c;
  if (disc < 0) return [0, 0];
  const t = -b + Math.sqrt(disc);
  const ds = t / steps;
  let r = 0;
  let m = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    p.copy(o).addScaledVector(dir, (i + 0.5) * ds);
    const h = p.length() - ATMO.earthRadius;
    if (h < 0) return [Infinity, Infinity];
    r += Math.exp(-h / ATMO.hR) * ds;
    m += Math.exp(-h / ATMO.hM) * ds;
  }
  return [r, m];
}

/** Transmittance of direct sunlight reaching sea level. */
export function sunTransmittance(sunDir: THREE.Vector3, rayleighScale: number, mieScale: number, out = new THREE.Color()): THREE.Color {
  const [r, m] = opticalDepthCPU(ATMO.viewHeight, sunDir);
  const bm = ATMO.betaM * mieScale * 1.1 * m;
  return out.setRGB(
    Math.exp(-(ATMO.betaR.x * rayleighScale * r + bm)),
    Math.exp(-(ATMO.betaR.y * rayleighScale * r + bm)),
    Math.exp(-(ATMO.betaR.z * rayleighScale * r + bm)),
    THREE.LinearSRGBColorSpace,
  );
}

/**
 * Bakes sky radiance into an equirect HDR texture whenever the sun moves. The texture
 * backs scene.background, scene.environment, and (later) water reflections.
 */
export class SkyLut {
  readonly target: THREE.RenderTarget;
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  readonly rayleigh = uniform(1);
  readonly mie = uniform(1);
  readonly horizonTint = uniform(new THREE.Vector3(0.02, 0.21, 0.32));

  private quad: THREE.QuadMesh;
  private dirty = true;

  constructor(width = 512, height = 256) {
    this.target = new THREE.RenderTarget(width, height, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;

    const mat = new THREE.NodeMaterial();
    mat.fragmentNode = Fn(() => {
      const st = uv();
      const phi = st.x.sub(0.5).mul(PI.mul(2));
      const theta = st.y.sub(0.5).mul(PI);
      const dir = vec3(cos(theta).mul(cos(phi)), sin(theta), cos(theta).mul(sin(phi)));
      const sky = skyRadiance(dir, this.sunDir, this.rayleigh, this.mie);
      // Below the horizon: a distant open ocean that takes the sky's horizon colour, darkening downward.
      const horizon = skyRadiance(vec3(dir.x, 0.0, dir.z), this.sunDir, this.rayleigh, this.mie);
      const sea = mix(horizon.mul(0.55), this.horizonTint.mul(horizon.length().mul(0.12)), smoothstep(0.0, -0.35, dir.y));
      return vec4(mix(sky, sea, smoothstep(0.0, -0.02, dir.y)), 1);
    })();
    mat.depthTest = false;
    mat.depthWrite = false;
    this.quad = new THREE.QuadMesh(mat);
  }

  invalidate(): void {
    this.dirty = true;
  }

  update(renderer: THREE.WebGPURenderer): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
    this.target.texture.needsPMREMUpdate = true;
    return true;
  }
}