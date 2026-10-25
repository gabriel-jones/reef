#!/usr/bin/env node
// assets/raw/<name>.glb → public/assets/<name>.glb : dedupe, weld, quantize, meshopt, textures ≤ 2048 webp.
// Usage: npm run assets:optimize [-- name ...]
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, meshopt, textureCompress, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const rawDir = join(root, 'assets/raw');
const outDir = join(root, 'public/assets');
mkdirSync(outDir, { recursive: true });

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const requested = process.argv.slice(2);
const names = requested.length
  ? requested
  : readdirSync(rawDir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));

// Procedural textures written by blender/textures/*.py.
const texRaw = join(rawDir, 'textures');
const texOut = join(outDir, 'textures');
mkdirSync(texOut, { recursive: true });
for (const f of readdirSync(texRaw).filter((f) => f.startsWith('gen_') && f.endsWith('.png'))) {
  const dst = join(texOut, f.replace(/^gen_/, '').replace(/\.png$/, '.webp'));
  await sharp(join(texRaw, f)).webp({ quality: 92, alphaQuality: 100 }).toFile(dst);
  console.log(`✔ textures/${f} → ${dst.split('/').pop()}`);
}

for (const name of names) {
  const src = join(rawDir, `${name}.glb`);
  const dst = join(outDir, `${name}.glb`);
  const doc = await io.read(src);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true }),
    resample(),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }),
    quantize({ pattern: /^(?!_)/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(dst, doc);
  const kb = (p) => (statSync(p).size / 1024).toFixed(0);
  console.log(`✔ ${name}: ${kb(src)} KB → ${kb(dst)} KB`);
}
