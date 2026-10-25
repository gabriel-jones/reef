#!/usr/bin/env node
// Downloads CC0 Poly Haven texture sets and writes compact WebP maps to public/assets/textures/<id>_<map>.webp.
// Usage: npm run assets:textures
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const rawDir = join(root, 'assets/raw/textures');
const outDir = join(root, 'public/assets/textures');
mkdirSync(rawDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// id → maps to fetch (diff = albedo, nor_gl = OpenGL normal, arm = AO/rough/metal packed)
const SETS = {
  coral_fort_wall_01: ['diff', 'nor_gl', 'arm'],
  rock_boulder_dry: ['diff', 'nor_gl', 'arm'],
  coral_ground_02: ['diff', 'nor_gl', 'arm'],
  coast_sand_03: ['nor_gl'],
};
const RES = '2k';
const OUT_SIZE = 1024;

for (const [id, maps] of Object.entries(SETS)) {
  for (const map of maps) {
    const file = `${id}_${map}_${RES}.jpg`;
    const raw = join(rawDir, file);
    if (!existsSync(raw)) {
      const url = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${RES}/${id}/${file}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    }
    const name = map === 'nor_gl' ? 'nor' : map;
    const dst = join(outDir, `${id}_${name}.webp`);
    await sharp(readFileSync(raw)).resize(OUT_SIZE, OUT_SIZE).webp({ quality: map === 'diff' ? 86 : 92 }).toFile(dst);
    console.log(`✔ ${id}_${name}.webp`);
  }
}
