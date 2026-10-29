import * as THREE from 'three/webgpu';
import { useBakedSeabed } from './seabedProfile';
import { SEABED_BAKE_VERSION, sourceHash } from './seabedBakeFormat';

/**
 * Load the baked seabed grids (height as float16, reef and grass density as bytes). Falls back to
 * the analytic profile if the file is missing or, in development, out of date with the source.
 */
export async function loadBakedSeabed(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}assets/seabed.bin`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const head = new Uint32Array(buf, 0, 5);
    const [version, nx, nz, res_, hash] = head;
    if (version !== SEABED_BAKE_VERSION) throw new Error('version mismatch');
    if (import.meta.env.DEV) {
      const src = (await import('./seabedProfile.ts?raw')).default as string;
      if (sourceHash(src) !== hash) throw new Error('seabedProfile.ts changed since the last bake (npm run bake)');
    }
    const n = nx * nz;
    const halves = new Uint16Array(buf, 20, n);
    const bytes = new Uint8Array(buf, 20 + n * 2 + ((n * 2) % 4 ? 2 : 0));
    const height = new Float32Array(n);
    const reef = new Float32Array(n);
    const grass = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      height[i] = THREE.DataUtils.fromHalfFloat(halves[i]);
      reef[i] = bytes[i] / 255;
      grass[i] = bytes[n + i] / 255;
    }
    useBakedSeabed({ nx, nz, res: res_, height, reef, grass });
    return true;
  } catch (e) {
    console.warn(`Seabed bake unavailable, evaluating the profile live: ${(e as Error).message}`);
    return false;
  }
}
