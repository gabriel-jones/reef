import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  int,
  ivec2,
  max,
  mix,
  pow,
  positionGeometry,
  positionLocal,
  sin,
  smoothstep,
  texture,
  textureLoad,
  time,
  transformNormalToView,
  uniform,
  uv,
  varying,
  vec3,
} from 'three/tsl';
import type { UnderwaterLighting } from '../underwater/underwaterLighting';

const loader = new THREE.TextureLoader();
const texBase = `${import.meta.env.BASE_URL}assets/textures/`;

function load(name: string, srgb: boolean): THREE.Texture {
  const t = loader.load(`${texBase}${name}.webp`);
  // glTF UVs are top-left origin.
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Baked vertex animation: rows [0, F) positions, [F, 2F) normals, one column per source vertex. */
export interface Vat {
  texture: THREE.DataTexture;
  frames: number;
  fps: number;
  vertices: number;
}

export async function loadVat(name: string): Promise<Vat> {
  const base = `${import.meta.env.BASE_URL}assets/vat/${name}`;
  const [meta, bin] = await Promise.all([
    fetch(`${base}.json`).then((r) => r.json() as Promise<{ vertices: number; frames: number; fps: number }>),
    fetch(`${base}.bin`).then((r) => r.arrayBuffer()),
  ]);
  const tex = new THREE.DataTexture(new Uint16Array(bin), meta.vertices, meta.frames * 2, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { texture: tex, frames: meta.frames, fps: meta.fps, vertices: meta.vertices };
}

export interface Swimmer {
  material: THREE.MeshStandardNodeMaterial;
  /** Animation clock in seconds of baked cycle time; advance faster to swim harder. */
  clock: THREE.UniformNode<'float', number>;
}

export class FaunaMaterials {
  constructor(private underwater: UnderwaterLighting) {}

  private finish<T extends THREE.NodeMaterial>(mat: T): T {
    this.underwater.apply(mat);
    return mat;
  }

  private skin(mat: THREE.MeshStandardNodeMaterial, name: string, metal: boolean): void {
    const albedo = texture(load(`fish_${name}`, true), uv());
    mat.colorNode = albedo.rgb;
    if (metal) {
      const m = texture(load(`fish_${name}_metal`, false), uv()).r;
      // Guanine-silvered flanks: mirror-like but not chrome; the scene environment supplies the sheen.
      mat.metalnessNode = m.mul(0.85);
      mat.roughnessNode = mix(float(0.5), float(0.22), m);
    }
  }

  /**
   * Instanced reef fish. The body is a travelling lateral wave (carangiform: amplitude grows
   * toward the tail). Per instance: `swim` = (phase rad, amplitude as a fraction of length,
   * scale, unused) and `orient` = the instance rotation quaternion — positionNode runs after
   * instancing, so the body-space offset has to be rotated into the instance frame here.
   * Geometry: nose at +Z, s = 0 at the nose … 1 at the tail tip.
   */
  fish(name: string, length: number, swim: THREE.InstancedBufferAttribute, orient: THREE.InstancedBufferAttribute, pivot = 0.4): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.45 });
    this.skin(mat, name, true);
    const s = float(pivot).sub(positionGeometry.z.div(length));
    const data = instancedBufferAttribute(swim, 'vec4') as unknown as THREE.Node<'vec4'>;
    const q = instancedBufferAttribute(orient, 'vec4') as unknown as THREE.Node<'vec4'>;
    const phase = data.x;
    const env = pow(max(s.sub(0.12), 0).div(0.88), 1.5).add(0.05);
    // ~0.9 wavelengths along the body; the head yaws slightly against the tail.
    const wave = sin(phase.sub(s.mul(5.6))).mul(env).sub(sin(phase).mul(0.05).mul(smoothstep(0.3, 0, s)));
    const fin = smoothstep(0.035, 0.08, positionGeometry.x.abs().add(positionGeometry.y.abs().mul(0.3)).div(length));
    const flutter = sin(phase.mul(2.2).add(hash(instanceIndex).mul(6.28))).mul(fin).mul(0.02);
    const lateral = wave.mul(data.y).add(flutter).mul(length);
    const local = vec3(lateral, 0, 0).mul(data.z);
    // rotate by unit quaternion: v + 2 q.xyz × (q.xyz × v + w v)
    const t = q.xyz.cross(local).add(local.mul(q.w));
    mat.positionNode = positionLocal.add(local.add(q.xyz.cross(t).mul(2)));
    return this.finish(mat);
  }

  /** Static creature with vertex colours (lobster). Antennae sway in the surge. */
  lobster(): THREE.MeshStandardNodeMaterial {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5 });
    const fwd = positionGeometry.z;
    const bend = pow(smoothstep(0.2, 0.62, fwd), 1.3);
    const phase = hash(instanceIndex).mul(6.28);
    const t = time.add(phase);
    const sway = vec3(
      sin(t.mul(1.1).add(fwd.mul(5))).mul(0.035),
      sin(t.mul(0.7)).mul(0.02),
      0,
    ).mul(bend);
    mat.positionNode = positionLocal.add(sway);
    return this.finish(mat);
  }

  /** VAT playback on a plain (non-instanced) mesh: each creature gets its own material + clock. */
  vat(vat: Vat, skin: { name: string; metal: boolean } | { texture: string }): Swimmer {
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.5 });
    if ('name' in skin) this.skin(mat, skin.name, skin.metal);
    else mat.colorNode = texture(load(skin.texture, true), uv()).rgb;
    const clock = uniform(0);
    const id = attribute<'float'>('_vat').add(0.5).toInt();
    const f = fract(clock.mul(vat.fps / vat.frames)).mul(vat.frames);
    const f0 = floor(f).toInt();
    const f1 = f0.add(1).mod(int(vat.frames));
    const k = fract(f);
    const p0 = textureLoad(vat.texture, ivec2(id, f0)).xyz;
    const p1 = textureLoad(vat.texture, ivec2(id, f1)).xyz;
    const n0 = textureLoad(vat.texture, ivec2(id, f0.add(vat.frames))).xyz;
    const n1 = textureLoad(vat.texture, ivec2(id, f1.add(vat.frames))).xyz;
    mat.positionNode = mix(p0, p1, k);
    // Fetched per vertex: in the fragment stage the index would be interpolated across the triangle.
    const normal = varying(mix(n0, n1, k));
    mat.normalNode = transformNormalToView(normal.normalize());
    return { material: this.finish(mat), clock };
  }
}
