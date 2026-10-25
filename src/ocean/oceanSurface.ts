import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  texture,
  attribute,
  varying,
  positionGeometry,
  positionWorld,
  positionView,
  cameraPosition,
  cameraNear,
  cameraFar,
  screenUV,
  viewportSharedTexture,
  viewportDepthTexture,
  perspectiveDepthToViewZ,
  equirectUV,
  frontFacing,
  normalize,
  reflect,
  dot,
  max,
  abs,
  exp,
  pow,
  mix,
  clamp,
  smoothstep,
  select,
  length,
  refract,
  sin,
  time,
  PI,
} from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import type { SeabedMap } from '../world/seabedMap';
import { foamGlow } from '../underwater/bioluminescence';
import type { SkyAndSun } from '../world/sky';
import { CASCADES } from './params';
import type { OceanSim } from './oceanSim';
import { createFoamTexture } from './foamTexture';

type FloatNode = THREE.Node<'float'>;
type Vec2Node = THREE.Node<'vec2'>;
type Vec3Node = THREE.Node<'vec3'>;
type Vec4Node = THREE.Node<'vec4'>;

const SURFACE_SPACING = 1 / 6;
const IOR_WATER = 1.333;
const EDGE_FADE = 2;

export const DEFAULT_LOOK = {
  absorption: new THREE.Vector3(0.46, 0.085, 0.055),
  deepColor: new THREE.Vector3(0.0, 0.085, 0.13),
  sssColor: new THREE.Vector3(0.1, 0.62, 0.55),
  refraction: 0.6,
  roughness: 0.06,
  sssStrength: 1,
  shoreFoam: 1,
};

/** Wave-field samples at a rest position, computed once per vertex. */
interface FieldSample {
  /** Summed cascade displacement (xyz) and foam (w), before shore attenuation. */
  raw: Vec4Node;
  restDepth: FloatNode;
  atten: FloatNode;
  /** Final world-space displacement (attenuated, wall-masked). */
  offset: Vec3Node;
  /** Shore run-up height added to the waterline. */
  swash: FloatNode;
}

/**
 * The visible ocean: displaced surface grid plus cross-section walls that follow the same
 * wave field, so the cut edge of the slab always matches the live surface.
 */
export class OceanSurface {
  readonly group = new THREE.Group();
  readonly look = {
    absorption: uniform(DEFAULT_LOOK.absorption.clone()),
    deepColor: uniform(DEFAULT_LOOK.deepColor.clone()),
    sssColor: uniform(DEFAULT_LOOK.sssColor.clone()),
    refraction: uniform(DEFAULT_LOOK.refraction),
    roughness: uniform(DEFAULT_LOOK.roughness),
    sssStrength: uniform(DEFAULT_LOOK.sssStrength),
    shoreFoam: uniform(DEFAULT_LOOK.shoreFoam),
  };
  readonly shoalDepth = uniform(2.8);
  /** 0 shaded, 1 transmitted, 2 reflection, 3 normals, 4 foam. */
  readonly debugView = uniform(0, 'int');
  readonly swashHeight = uniform(0.18);
  readonly swashSpeed = uniform(0.42);

  private foamTex = createFoamTexture();

  constructor(
    private sim: OceanSim,
    private seabed: SeabedMap,
    private sky: SkyAndSun,
  ) {
    this.shoalDepth.value = sim.params.shoalDepth;
    this.group.name = 'ocean';
    const surface = new THREE.Mesh(this.buildSurfaceGeometry(), this.buildSurfaceMaterial());
    surface.name = 'ocean-surface';
    surface.frustumCulled = false;
    const walls = new THREE.Mesh(this.buildWallGeometry(), this.buildWallMaterial());
    walls.name = 'ocean-walls';
    walls.frustumCulled = false;
    this.group.add(surface, walls);
  }

  // ---------------------------------------------------------------- wave field

  sampleField(xz: Vec2Node): FieldSample {
    let raw: Vec4Node = vec4(0);
    CASCADES.forEach((c, i) => {
      raw = raw.add(texture(this.sim.displacement[i], xz.div(c.size)).level(float(0)));
    });
    raw = raw.toVar();
    const restDepth = float(WORLD.seaLevel).sub(this.seabed.heightAt(xz)).toVar();
    // Waves die out over the shallows and vanish on the beach.
    const atten = smoothstep(0.0, this.shoalDepth, restDepth).toVar();
    // Horizontal displacement normal to each wall fades to zero so the surface edge stays on the wall plane.
    const mx = smoothstep(HALF_X, HALF_X - EDGE_FADE, abs(xz.x));
    const mz = smoothstep(HALF_Z, HALF_Z - EDGE_FADE, abs(xz.y));
    const swash = this.swashAt(xz, restDepth);
    const offset = vec3(raw.x.mul(mx), raw.y, raw.z.mul(mz)).mul(atten).add(vec3(0, swash, 0));
    return { raw, restDepth, atten, offset, swash };
  }

  /** Run-up on the beach: the waterline climbs and retreats with each swell set. */
  private swashAt(xz: Vec2Node, restDepth: FloatNode): FloatNode {
    const band = smoothstep(-1.4, -0.3, restDepth).mul(smoothstep(1.2, 0.2, restDepth));
    const phase = time.mul(this.swashSpeed).add(xz.y.mul(0.09)).add(sin(xz.y.mul(0.23).add(time.mul(0.13))).mul(1.4));
    const surge = pow(sin(phase).mul(0.5).add(0.5), 1.6);
    return band.mul(surge).mul(this.swashHeight).toVar();
  }

  seabedHeightAt(xz: Vec2Node): FloatNode {
    return this.seabed.heightAt(xz);
  }

  /** TSL: water surface height (world Y) at a rest position. Ignores horizontal displacement. */
  heightAt(xz: Vec2Node): FloatNode {
    return this.sampleField(xz).offset.y.add(WORLD.seaLevel);
  }

  // ---------------------------------------------------------------- geometry

  private buildSurfaceGeometry(): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(WORLD.sizeX, WORLD.sizeZ, Math.round(WORLD.sizeX / SURFACE_SPACING), Math.round(WORLD.sizeZ / SURFACE_SPACING));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, WORLD.seaLevel, 0);
    return geo;
  }

  private buildWallGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const top: number[] = [];
    const indices: number[] = [];
    const edges: Array<[number, number, number, number, number, number]> = [
      [-HALF_X, HALF_Z, HALF_X, HALF_Z, 0, 1],
      [HALF_X, -HALF_Z, -HALF_X, -HALF_Z, 0, -1],
      [HALF_X, HALF_Z, HALF_X, -HALF_Z, 1, 0],
      [-HALF_X, -HALF_Z, -HALF_X, HALF_Z, -1, 0],
    ];
    const offset = 0.01;
    for (const [x0, z0, x1, z1, nx, nz] of edges) {
      const steps = Math.round(Math.hypot(x1 - x0, z1 - z0) / SURFACE_SPACING);
      const base = positions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + (x1 - x0) * t + nx * offset;
        const z = z0 + (z1 - z0) * t + nz * offset;
        positions.push(x, WORLD.seaLevel, z, x, WORLD.seaLevel, z);
        normals.push(nx, 0, nz, nx, 0, nz);
        top.push(1, 0);
      }
      for (let i = 0; i < steps; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    geo.setIndex(indices);
    return geo;
  }

  // ---------------------------------------------------------------- shading helpers

  private skyAt(dir: Vec3Node): Vec3Node {
    return texture(this.sky.lut.target.texture, equirectUV(vec3(dir.x, abs(dir.y), dir.z))).rgb;
  }

  /** Downwelling irradiance just below the surface (sun + sky); sky zenith is passed in as a vertex varying. */
  private downwelling(skyZenith: Vec3Node): Vec3Node {
    return this.sky.sunRadiance.mul(max(this.sky.lightDir.y, 0)).add(skyZenith.mul(PI));
  }

  /**
   * Light arriving back through the water from what lies behind it: Beer–Lambert transmittance
   * of the opaque scene plus in-scattered water colour along the view path.
   */
  private transmitted(uvNode: Vec2Node, down: Vec3Node): Vec3Node {
    // Submerged materials already carry the sun-path falloff (UnderwaterLighting); only the view path remains.
    const sceneViewZ = perspectiveDepthToViewZ(viewportDepthTexture(uvNode), cameraNear, cameraFar);
    const viewZ = positionView.z;
    const thickness = max(viewZ.sub(sceneViewZ), 0);
    const viewPath = thickness.mul(length(positionView)).div(max(viewZ.negate(), 1e-3)).toVar();
    const tView = exp(this.look.absorption.mul(viewPath).negate());
    const scene = viewportSharedTexture(uvNode).rgb;
    const inscatter = this.look.deepColor.mul(down).div(PI).mul(vec3(1).sub(tView));
    return scene.mul(tView).add(inscatter);
  }

  // ---------------------------------------------------------------- materials

  private buildSurfaceMaterial(): THREE.MeshBasicNodeMaterial {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: true });
    const field = this.sampleField(positionGeometry.xz);
    mat.positionNode = positionGeometry.add(field.offset);

    const vRaw = varying(field.raw, 'vOceanRaw');
    const vDepth = varying(field.restDepth, 'vOceanDepth');
    const vAtten = varying(field.atten, 'vOceanAtten');
    const vSwash = varying(field.swash, 'vOceanSwash');
    const vZenith = varying(this.skyAt(vec3(0, 1, 0)), 'vSkyZenith');

    mat.colorNode = Fn(() => {
      const xz = positionGeometry.xz;
      const atten = vAtten;
      const camDist = length(positionWorld.sub(cameraPosition)).toVar();
      const down = this.downwelling(vZenith).toVar();

      // Slopes and Jacobian terms summed over cascades; finer cascades fade with distance to avoid shimmer.
      const fades = [float(1), smoothstep(260, 90, camDist), smoothstep(70, 20, camDist)];
      let slope: Vec2Node = vec2(0);
      let jac: Vec2Node = vec2(0);
      CASCADES.forEach((c, i) => {
        const der = texture(this.sim.derivatives[i], xz.div(c.size));
        slope = slope.add(der.xy.mul(fades[i]));
        jac = jac.add(der.zw.mul(fades[i]));
      });
      slope = slope.mul(atten);
      jac = jac.mul(atten);
      const nLocal = normalize(vec3(slope.x.div(jac.x.add(1)).negate(), 1, slope.y.div(jac.y.add(1)).negate())).toVar();
      const N = select(frontFacing, nLocal, nLocal.negate()).toVar();

      const V = normalize(cameraPosition.sub(positionWorld)).toVar();
      const L = this.sky.lightDir;
      const NdotV = max(dot(N, V), 1e-3).toVar();
      const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(NdotV), 5))).toVar();

      // Reflection of the baked sky plus a GGX sun highlight.
      const reflection = this.skyAt(reflect(V.negate(), N));
      const H = normalize(V.add(L));
      const a = this.look.roughness.add(camDist.mul(0.0006));
      const a2 = a.mul(a);
      const NdotH = max(dot(N, H), 0);
      const d = NdotH.mul(NdotH).mul(a2.sub(1)).add(1);
      const D = a2.div(PI.mul(d).mul(d));
      const NdotL = max(dot(N, L), 0);
      const specular = this.sky.sunRadiance.mul(D.mul(fresnel).mul(NdotL).div(NdotV.mul(4)).min(200));

      // Refraction: bend the backdrop lookup by the surface normal, falling back where it would sample in front of the water.
      const viewDepth = max(positionView.z.negate(), 1);
      const refrUV = screenUV.add(N.xz.mul(this.look.refraction).div(viewDepth));
      const refrViewZ = perspectiveDepthToViewZ(viewportDepthTexture(refrUV), cameraNear, cameraFar);
      const uvFinal = select(refrViewZ.lessThan(positionView.z), refrUV, screenUV);
      const below = this.transmitted(uvFinal, down).toVar();

      // Subsurface glow through sunlit wave crests.
      const heightNow = vRaw.y;
      const crest = max(heightNow.mul(atten), 0);
      const backLit = pow(clamp(dot(V, L.negate().add(N.mul(0.6)).normalize()), 0, 1), 4);
      const sss = this.look.sssColor
        .mul(this.sky.sunRadiance)
        .mul(crest.mul(backLit).mul(0.9).add(pow(NdotV, 2).mul(0.06)))
        .mul(this.look.sssStrength)
        .mul(0.25);

      // Foam: Jacobian whitecaps, shore swash, and whitewater over the boiler reef.
      const depth = vDepth;
      // Swash: foam is thickest at the leading edge of the run-up and thins as it drains.
      const shore = smoothstep(0.55, 0.05, depth.add(heightNow.mul(atten)).add(vSwash)).mul(float(0.55).add(vSwash.div(this.swashHeight).mul(0.45)));
      // Swell trips over the boiler rim: whitewater pulses with the unattenuated wave height.
      const drift = vec2(time.mul(0.011), time.mul(0.007));
      const coarse = texture(this.foamTex, xz.mul(0.045).add(drift)).r;
      const fine = texture(this.foamTex, xz.mul(0.21).sub(drift.mul(2))).g;
      const tex = coarse.mul(0.6).add(fine.mul(0.4));
      const patches = texture(this.foamTex, xz.mul(0.11).add(vec2(0.37, 0.71)).sub(drift.mul(0.5))).r;
      const boiler = smoothstep(1.3, 0.3, depth)
        .mul(smoothstep(-0.08, 0.22, heightNow))
        .mul(smoothstep(0.25, 0.65, patches))
        .mul(smoothstep(-0.1, 0.3, depth))
        .mul(smoothstep(-15, -5, xz.x));
      const foamAmount = clamp(vRaw.w.mul(atten).mul(1.4).add(shore.add(boiler).mul(this.look.shoreFoam)), 0, 1);
      // Noise acts as a per-texel threshold: low foam amounts show as broken streaks, high amounts as solid white.
      const threshold = tex.mul(0.85).add(0.08);
      const foamMask = smoothstep(threshold.sub(0.16), threshold.add(0.16), foamAmount);
      const foamLight = this.sky.sunRadiance.mul(max(dot(nLocal, L), 0.2)).add(vZenith.mul(PI)).mul(0.85 / Math.PI);

      const water = mix(below, reflection, fresnel).add(specular).add(sss);
      const foamOpacity = foamMask.mul(mix(float(0.45), float(0.95), fine.mul(foamMask)));
      // At night, breaking water lights up with bioluminescent plankton.
      const glow = foamGlow(this.sky, foamOpacity, fine.mul(1.2).add(sin(time.mul(3.1).add(tex.mul(23))).mul(0.35)).max(0));
      const shaded = mix(water, foamLight, foamOpacity).add(glow);
      const dbg = this.debugView;
      const lit = select(
        dbg.equal(1),
        below,
        select(dbg.equal(2), reflection.mul(fresnel), select(dbg.equal(3), N.mul(0.5).add(0.5), select(dbg.equal(4), vec3(foamMask), shaded))),
      );

      // From below: Snell's window. Inside the ~48.6° cone the sky refracts through; outside it, total
      // internal reflection mirrors the dim water column back down.
      const T = refract(V.negate(), N, float(IOR_WATER)).toVar();
      const throughWindow = dot(T, T).greaterThan(1e-4);
      const cosT = max(dot(V, N), 0);
      const fresnelUp = float(0.02).add(float(0.98).mul(pow(float(1).sub(cosT), 5)));
      const skyThrough = this.skyAt(T).add(this.sky.sunRadiance.mul(pow(max(dot(T, L), 0), 900).mul(60)));
      const mirrored = this.look.deepColor.mul(down).div(PI).mul(1.9);
      const window = mix(skyThrough.mul(0.9), mirrored, fresnelUp.min(1));
      const underFoam = mix(select(throughWindow, window, mirrored), foamLight.mul(0.5), foamOpacity.mul(0.7)).add(glow);
      return vec4(select(frontFacing, lit, underFoam), 1);
    })();

    return mat;
  }

  private buildWallMaterial(): THREE.MeshBasicNodeMaterial {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.FrontSide, depthWrite: false });
    const isTop = attribute<'float'>('aTop', 'float');
    const xz = positionGeometry.xz;
    const field = this.sampleField(xz);
    const floorY = this.seabed.heightAt(xz);
    const surfaceY = max(field.offset.y.add(WORLD.seaLevel), floorY).toVar();
    const y = mix(floorY, surfaceY, isTop);
    mat.positionNode = vec3(positionGeometry.x.add(field.offset.x.mul(isTop)), y, positionGeometry.z.add(field.offset.z.mul(isTop)));

    const vSurfaceY = varying(surfaceY, 'vWallSurfaceY');
    const vZenith = varying(this.skyAt(vec3(0, 1, 0)), 'vSkyZenith');

    mat.colorNode = Fn(() => {
      const V = normalize(cameraPosition.sub(positionWorld));
      const down = this.downwelling(vZenith);
      const depthBelow = max(vSurfaceY.sub(positionWorld.y), 0);
      // In-scatter deeper in the volume is fed by light that has already been absorbed on the way down.
      const dimming = exp(this.look.absorption.mul(depthBelow).mul(0.5).negate());
      const volume = this.transmitted(screenUV, down.mul(dimming));

      // Thin acrylic: a faint Fresnel sheen and a bright meniscus line at the waterline.
      const nWall = normalize(attribute<'vec3'>('normal', 'vec3'));
      const f = float(0.04).add(float(0.96).mul(pow(float(1).sub(max(dot(nWall, V), 0)), 5)));
      const sheen = this.skyAt(reflect(V.negate(), nWall)).mul(f.mul(0.5));
      const meniscus = smoothstep(0.06, 0.0, depthBelow).mul(0.6);
      return vec4(volume.add(sheen).add(down.mul(meniscus).div(PI)), 1);
    })();
    return mat;
  }
}
