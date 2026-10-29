#!/usr/bin/env node
// Bakes the analytic seabed (src/world/seabedProfile.ts) into public/assets/seabed.bin:
// float16 height plus byte reef/seagrass density on an 8-per-metre grid.
// Usage: npm run bake
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { DataUtils } from 'three';

const RES = 8;
const root = resolve(import.meta.dirname, '..');
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const profile = await server.ssrLoadModule('/src/world/seabedProfile.ts');
  const { SEABED_BAKE_VERSION, sourceHash } = await server.ssrLoadModule('/src/world/seabedBakeFormat.ts');
  const { HALF_X, HALF_Z, WORLD } = await server.ssrLoadModule('/src/config.ts');
  const nx = WORLD.sizeX * RES + 1;
  const nz = WORLD.sizeZ * RES + 1;
  const n = nx * nz;
  const pad = (n * 2) % 4 ? 2 : 0;
  const buf = new ArrayBuffer(20 + n * 2 + pad + n * 2);
  const hash = sourceHash(readFileSync(join(root, 'src/world/seabedProfile.ts'), 'utf8'));
  new Uint32Array(buf, 0, 5).set([SEABED_BAKE_VERSION, nx, nz, RES, hash]);
  const halves = new Uint16Array(buf, 20, n);
  const bytes = new Uint8Array(buf, 20 + n * 2 + pad);
  for (let j = 0; j < nz; j++) {
    const z = -HALF_Z + j / RES;
    for (let i = 0; i < nx; i++) {
      const x = -HALF_X + i / RES;
      const k = j * nx + i;
      halves[k] = DataUtils.toHalfFloat(profile.analyticHeight(x, z));
      bytes[k] = Math.round(profile.analyticReef(x, z) * 255);
      bytes[n + k] = Math.round(profile.analyticGrass(x, z) * 255);
    }
  }
  const out = join(root, 'public/assets/seabed.bin');
  writeFileSync(out, Buffer.from(buf));
  console.log(`wrote ${out} (${nx}×${nz}, ${(buf.byteLength / 1e6).toFixed(2)} MB)`);
} finally {
  await server.close();
}
