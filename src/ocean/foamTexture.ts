import * as THREE from 'three/webgpu';

/** Tileable two-channel fbm value noise used to break up foam: R = coarse cells, G = fine bubbles. */
export function createFoamTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  const lattice = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return (x: number, y: number) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const u = fx * fx * (3 - 2 * fx);
      const v = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => g[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
      const a = at(xi, yi);
      const b = at(xi + 1, yi);
      const c = at(xi, yi + 1);
      const d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  };

  const fbm = (x: number, y: number, base: number, octaves: number, seed: number) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const period = base << o;
      sum += lattice(period, seed + o * 101)((x * period) / size, (y * period) / size) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round(fbm(x, y, 8, 4, 11) * 255);
      data[i + 1] = Math.round(fbm(x, y, 32, 3, 77) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
