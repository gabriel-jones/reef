import * as THREE from 'three/webgpu';
import {
  abs,
  cameraViewMatrix,
  float,
  hash,
  instanceIndex,
  max,
  mix,
  normalWorldGeometry,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { UnderwaterLighting } from '../underwater/underwaterLighting';

type Vec3Node = THREE.Node<'vec3'>;
type FloatNode = THREE.Node<'float'>;

const loader = new THREE.TextureLoader();
const base = `${import.meta.env.BASE_URL}assets/textures/`;

function load(name: string, srgb = false, flipY = true): THREE.Texture {
  const t = loader.load(`${base}${name}.webp`);
  t.flipY = flipY;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Sharpened triplanar blend weights from a world normal. */
function weights(n: Vec3Node): Vec3Node {
  const w = pow(abs(n), vec3(4));
  return w.div(w.x.add(w.y).add(w.z));
}

function triplanar(tex: THREE.Texture, p: Vec3Node, n: Vec3Node, scale: number | FloatNode): THREE.Node<'vec4'> {
  const w = weights(n);
  const s = typeof scale === 'number' ? float(scale) : scale;
  return texture(tex, p.zy.mul(s))
    .mul(w.x)
    .add(texture(tex, p.xz.mul(s)).mul(w.y))
    .add(texture(tex, p.xy.mul(s)).mul(w.z));
}

/** Whiteout-blended triplanar normal map; returns a world-space normal. */
function triplanarNormal(tex: THREE.Texture, p: Vec3Node, n: Vec3Node, scale: number, strength = 1): Vec3Node {
  const w = weights(n);
  const unpack = (uvNode: THREE.Node<'vec2'>) => {
    const t = texture(tex, uvNode).xyz.mul(2).sub(1);
    return vec3(t.xy.mul(strength), t.z);
  };
  const tx = unpack(p.zy.mul(scale));
  const ty = unpack(p.xz.mul(scale));
  const tz = unpack(p.xy.mul(scale));
  const nx = vec3(tx.xy.add(n.zy), abs(tx.z).mul(n.x));
  const ny = vec3(ty.xy.add(n.xz), abs(ty.z).mul(n.y));
  const nz = vec3(tz.xy.add(n.xy), abs(tz.z).mul(n.z));
  return nx.zyx.mul(w.x).add(ny.xzy.mul(w.y)).add(nz.xyz.mul(w.z)).normalize();
}

function toView(nWorld: Vec3Node): Vec3Node {
  return cameraViewMatrix.mul(vec4(nWorld, 0)).xyz.normalize();
}

/**
 * Shared look-dev for everything that grows on or sits in the slab. All submerged materials get
 * the underwater light factor (absorption along the refracted sun path + caustics).
 */
export class ReefMaterials {
  /** Surge: shoreward/back orbital motion near the bed. x,z = direction, y unused. */
  readonly currentDir = uniform(new THREE.Vector3(1, 0, 0.25).normalize());
  readonly surge = uniform(1);
  readonly surgePeriod = uniform(6.5);
  readonly wind = uniform(1);

  readonly tex = {
    limestone: { diff: load('coral_fort_wall_01_diff', true), nor: load('coral_fort_wall_01_nor'), arm: load('coral_fort_wall_01_arm') },
    boulder: { diff: load('rock_boulder_dry_diff', true), nor: load('rock_boulder_dry_nor'), arm: load('rock_boulder_dry_arm') },
    crust: { diff: load('coral_ground_02_diff', true), nor: load('coral_ground_02_nor'), arm: load('coral_ground_02_arm') },
    sandNor: load('coast_sand_03_nor'),
    brainMask: load('brain_mask'),
    brainNor: load('brain_nor'),
    starMask: load('star_mask'),
    starNor: load('star_nor'),
    // Sampled with glTF UVs (v = 0 at the top of the image), unlike the triplanar maps.
    seafan: load('seafan', false, false),
  };

  constructor(private underwater: UnderwaterLighting) {}

  /** Orbital surge displacement for a point `bend` (0 at holdfast … 1 at tip), in metres at the tip. */
  private surgeOffset(bend: FloatNode, amplitude: number): Vec3Node {
    const phase = hash(instanceIndex).mul(0.9);
    const omega = float(Math.PI * 2).div(this.surgePeriod);
    const along = positionWorld.xz.dot(this.currentDir.xz).mul(0.25);
    const s = sin(time.mul(omega).sub(along).add(phase)).add(sin(time.mul(omega.mul(2.3)).add(phase.mul(7))).mul(0.25));
    return this.currentDir.mul(s.mul(bend).mul(amplitude).mul(this.surge));
  }

  /** 0 → 1 as the reef first appears: each instance rises out of the seabed, staggered. */
  readonly reveal = uniform(1);
  private risen = new WeakSet<THREE.NodeMaterial>();

  rising(mat: THREE.NodeMaterial): void {
    if (this.risen.has(mat)) return;
    this.risen.add(mat);
    const k = smoothstep(0, 1, this.reveal.sub(hash(instanceIndex).mul(0.6)).div(0.4).clamp());
    mat.positionNode = ((mat.positionNode ?? positionLocal) as Vec3Node).sub(vec3(0, k.oneMinus().mul(1.6), 0));
  }

  private finish<T extends THREE.NodeMaterial>(mat: T): T {
    this.underwater.apply(mat);
    return mat;
  }

  rock(kind: 'limestone' | 'boulder'): THREE.MeshStandardNodeMaterial {
    const t = this.tex[kind];
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
    const p = positionWorld;
    const n = normalWorldGeometry;
    const scale = kind === 'limestone' ? 0.45 : 0.6;
    const arm = triplanar(t.arm, p, n, scale);
    // Submerged rock picks up a film of turf algae and coralline crust.
    const below = smoothstep(0.1, -0.6, p.y);
    const crust = triplanar(this.tex.crust.diff, p, n, 0.35).rgb;
    const film = below.mul(smoothstep(0.35, 0.75, n.y.add(triplanar(this.tex.crust.arm, p, n, 0.2).g.mul(0.5))));
    const albedo = mix(triplanar(t.diff, p, n, scale).rgb.mul(kind === 'limestone' ? vec3(1.08, 1.02, 0.95) : vec3(1)), crust.mul(vec3(0.75, 0.85, 0.6)), film.mul(0.8));
    mat.colorNode = albedo;
    mat.roughnessNode = mix(arm.g, float(0.6), below.mul(0.4));
    mat.aoNode = arm.r;
    mat.normalNode = toView(triplanarNormal(t.nor, p, n, scale, 1.3));
    return this.finish(mat);
  }

  brainCoral(): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.62 });
    const p = positionWorld;
    const n = normalWorldGeometry;
    const s = 1 / 0.9;
    const m = triplanar(this.tex.brainMask, p, n, s);
    const ridge = m.r;
    const mott = m.g;
    const ridgeCol = vec3(0.78, 0.68, 0.42);
    const valleyCol = vec3(0.3, 0.33, 0.17);
    mat.colorNode = mix(valleyCol, ridgeCol, smoothstep(0.15, 0.8, ridge)).mul(mix(float(0.8), float(1.15), mott));
    mat.normalNode = toView(triplanarNormal(this.tex.brainNor, p, n, s, 1.4));
    mat.aoNode = mix(float(0.55), float(1), ridge);
    return this.finish(mat);
  }

  starCoral(): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7 });
    const p = positionWorld;
    const n = normalWorldGeometry;
    const s = 1 / 0.4;
    const m = triplanar(this.tex.starMask, p, n, s);
    const polyp = m.b;
    // Corallite cups read slightly greener/fluorescent; the coenosteum between is tan-brown.
    const between = vec3(0.5, 0.42, 0.24);
    const cup = vec3(0.32, 0.42, 0.22);
    mat.colorNode = mix(between, cup, polyp).mul(mix(float(0.75), float(1.15), m.g));
    mat.normalNode = toView(triplanarNormal(this.tex.starNor, p, n, s, 1.2));
    mat.aoNode = mix(float(0.6), float(1), m.r);
    return this.finish(mat);
  }

  seaFan(): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.75, alphaTest: 0.35 });
    mat.alphaToCoverage = true;
    const lattice = texture(this.tex.seafan, uv());
    mat.colorNode = mix(float(0.72), float(1.05), lattice.r).mul(mix(float(1), float(1.2), lattice.g));
    mat.opacityNode = lattice.a;
    mat.positionNode = positionLocal.add(this.surgeOffset(pow(uv().y.oneMinus(), 1.6), 0.07));
    return this.finish(mat);
  }

  branching(height: number, amplitude: number): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8 });
    const bend = pow(max(positionGeometry.y, 0).div(height), 1.8);
    mat.positionNode = positionLocal.add(this.surgeOffset(bend, amplitude));
    // Polyps give a faint fuzzy sheen at grazing angles.
    mat.colorNode = vec3(1);
    return this.finish(mat);
  }

  plant(height: number): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 });
    const h = max(positionGeometry.y, 0).div(height);
    const phase = hash(instanceIndex).mul(6.28);
    const sway = sin(time.mul(1.3).add(phase)).mul(0.6).add(sin(time.mul(2.9).add(phase.mul(3))).mul(0.25));
    const radial = positionGeometry.xz.length();
    const flutter = sin(time.mul(7).add(positionGeometry.x.mul(5)).add(positionGeometry.z.mul(4))).mul(radial).mul(0.012);
    const windDir = vec3(0.8, 0, 0.6);
    mat.positionNode = positionLocal.add(windDir.mul(pow(h, 2).mul(sway).mul(0.08).add(flutter)).mul(this.wind));
    return this.finish(mat);
  }

  seagrass(): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.55 });
    const t = uv().y;
    const blade = uv().x;
    const tipStain = smoothstep(0.55, 1, t).mul(smoothstep(0.3, 0.7, hash(instanceIndex.toFloat().mul(7).add(blade.mul(31)))));
    mat.colorNode = mix(vec3(0.07, 0.17, 0.035), vec3(0.2, 0.3, 0.07), t).mul(mix(float(1), float(1.6), tipStain));
    const flutter = sin(time.mul(2.1).add(blade.mul(9)).add(hash(instanceIndex).mul(6.28))).mul(0.25);
    mat.positionNode = positionLocal.add(this.surgeOffset(pow(t, 1.5), 0.12)).add(vec3(0, 0, flutter.mul(t).mul(0.03)));
    return this.finish(mat);
  }

  /** Albedo/normal/roughness contribution for reef framework on the seabed (patch reefs, boiler rim). */
  crustLayer(): { albedo: Vec3Node; normal: Vec3Node; rough: FloatNode } {
    const p = positionWorld;
    const n = normalWorldGeometry;
    const t = this.tex.crust;
    return {
      albedo: triplanar(t.diff, p, n, 0.3).rgb.mul(vec3(0.95, 0.85, 0.7)).add(vec3(0.04, 0.03, 0.02)),
      normal: triplanarNormal(t.nor, p, n, 0.3, 1.4),
      rough: triplanar(t.arm, p, n, 0.3).g,
    };
  }

  sandNormal(): Vec3Node {
    const p = positionWorld;
    const t = texture(this.tex.sandNor, p.xz.mul(0.7)).xyz.mul(2).sub(1);
    const t2 = texture(this.tex.sandNor, p.xz.mul(0.13).add(vec2(0.31, 0.77))).xyz.mul(2).sub(1);
    const n = normalWorldGeometry;
    return vec3(t.x.add(t2.x).mul(0.6).add(n.x), n.y, t.y.add(t2.y).mul(0.6).add(n.z)).normalize();
  }

  toView = toView;
}
