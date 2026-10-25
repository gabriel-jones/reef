import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  float,
  vec2,
  vec3,
  vec4,
  uv,
  uniform,
  texture,
  equirectUV,
  getViewPosition,
  screenCoordinate,
  normalize,
  length,
  dot,
  max,
  min,
  abs,
  exp,
  pow,
  mix,
  fract,
  smoothstep,
  select,
  PI,
} from 'three/tsl';
import { HALF_X, HALF_Z, WORLD } from '../config';
import type { OceanSurface } from '../ocean/oceanSurface';
import type { SkyAndSun } from '../world/sky';
import type { UnderwaterLighting } from './underwaterLighting';
import { CASCADES } from '../ocean/params';

const RAY_STEPS = 20;

export class UnderwaterPost {
  readonly scatter = uniform(0.05);
  /** Single-scattering albedo of the water column: what the open-water background looks like per unit of downwelling light. */
  readonly fogColor = uniform(new THREE.Vector3(0.005, 0.1, 0.16));
  readonly godRays = uniform(0.15);
  readonly maxRayDistance = uniform(28);
  /** 0 final, 1 underwater mask, 2 fog transmittance, 3 in-scatter, 4 distance/40 m. */
  readonly debug = uniform(0, 'int');

  constructor(
    private ocean: OceanSurface,
    private sky: SkyAndSun,
    private lighting: UnderwaterLighting,
    camera: THREE.PerspectiveCamera,
  ) {
    // Inside a post pass the built-in camera nodes refer to the fullscreen quad's camera.
    this.cameraWorld = uniform(camera.matrixWorld);
    this.projectionInverse = uniform(camera.projectionMatrixInverse);
    this.cameraPos = uniform(new THREE.Vector3()).onRenderUpdate(() => this.cameraPos.value.setFromMatrixPosition(camera.matrixWorld));
  }

  private cameraWorld: THREE.UniformNode<'mat4', THREE.Matrix4>;
  private projectionInverse: THREE.UniformNode<'mat4', THREE.Matrix4>;
  private cameraPos: THREE.UniformNode<'vec3', THREE.Vector3>;

  /** Wraps the scene pass with underwater fog and god rays wherever the eye is below the surface. */
  build(scenePass: ReturnType<typeof import('three/tsl').pass>): THREE.Node<'vec4'> {
    const colorTex = scenePass.getTextureNode('output');
    const depthTex = scenePass.getTextureNode('depth');
    const look = this.ocean.look;
    const cameraWorldMatrix = this.cameraWorld;
    const cameraProjectionMatrixInverse = this.projectionInverse;
    const cameraPosition = this.cameraPos;

    return Fn(() => {
      const st = uv();
      const color = colorTex.sample(st).toVar();
      const depth = depthTex.sample(st).r;

      // Is this pixel's near-plane point below the live water surface (inside the slab)?
      const nearWorld = cameraWorldMatrix.mul(vec4(getViewPosition(st, float(0), cameraProjectionMatrixInverse), 1)).xyz;
      const inSlab = abs(nearWorld.x).lessThan(HALF_X).and(abs(nearWorld.z).lessThan(HALF_Z));
      const surfaceY = this.ocean.heightAt(nearWorld.xz);
      const submerged = inSlab.and(nearWorld.y.lessThan(surfaceY));

      const result = vec4(color).toVar();
      If(submerged, () => {
        const viewPos = getViewPosition(st, depth, cameraProjectionMatrixInverse);
        const isSky = depth.greaterThanEqual(0.99999);
        const dist = select(isSky, float(400), length(viewPos)).toVar();
        const worldPos = cameraWorldMatrix.mul(vec4(viewPos, 1)).xyz;
        const viewDir = normalize(worldPos.sub(cameraPosition)).toVar();

        const sigma = look.absorption.add(this.scatter);
        const transmittance = exp(sigma.mul(dist).negate());

        // In-scatter: downwelling light dimmed to the eye's depth, brighter toward the sun and the surface.
        const lu = this.lighting.sunUnderwater;
        const zenith = texture(this.sky.lut.target.texture, equirectUV(vec3(0, 1, 0))).rgb;
        const downwelling = this.sky.sunRadiance.mul(max(this.sky.lut.sunDir.y, 0)).add(zenith.mul(PI));
        const eyeDepth = max(surfaceY.sub(cameraPosition.y), 0);
        const ambient = downwelling.mul(exp(look.absorption.mul(eyeDepth).mul(0.7).negate()));
        const cosSun = dot(viewDir, lu);
        const phase = float(1).add(pow(max(cosSun, 0), 8).mul(3)).add(pow(max(cosSun, 0), 64).mul(6));
        const vertical = mix(float(0.45), float(1.35), viewDir.y.mul(0.5).add(0.5));
        const inscatter = this.fogColor.mul(ambient).div(PI).mul(phase).mul(vertical);

        const fogged = color.rgb.mul(transmittance).add(inscatter.mul(vec3(1).sub(transmittance)));

        // God rays: march toward the scene, sampling the coarse caustic field projected up the refracted sun direction.
        const rayLen = min(dist, this.maxRayDistance);
        const dt = rayLen.div(RAY_STEPS);
        const jitter = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
        const shafts = float(0).toVar();
        Loop(RAY_STEPS, ({ i }) => {
          const t = float(i).add(jitter).mul(dt);
          const p = cameraPosition.add(viewDir.mul(t));
          const d = max(float(WORLD.seaLevel).sub(p.y), 0);
          const toSurface = d.div(lu.y);
          const sp = p.xz.add(lu.xz.mul(toSurface));
          const beam = texture(this.lighting.caustics.textures[0], sp.div(CASCADES[1].size)).r;
          const atten = exp(look.absorption.y.mul(toSurface.add(t)).negate());
          shafts.addAssign(pow(beam, 2.2).mul(atten).mul(smoothstep(0.0, 0.6, d)));
        });
        const rayLight = this.sky.sunRadiance
          .mul(look.deepColor.add(vec3(0.02, 0.06, 0.05)))
          .mul(shafts.mul(dt))
          .mul(phase.sub(0.7).max(0))
          .mul(this.godRays)
          .mul(this.lighting.sunUp);

        result.assign(vec4(fogged.add(rayLight), 1));
        If(this.debug.equal(2), () => result.assign(vec4(transmittance, 1)));
        If(this.debug.equal(3), () => result.assign(vec4(inscatter, 1)));
        If(this.debug.equal(4), () => result.assign(vec4(vec3(dist.div(40)), 1)));
      });
      If(this.debug.equal(1), () => result.assign(vec4(select(submerged, vec3(1, 0, 0), color.rgb.mul(0.3)), 1)));
      return result;
    })();
  }
}
