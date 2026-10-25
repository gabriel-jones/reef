#!/usr/bin/env node
// Runs Blender headless for each asset script: blender/assets/<name>.py → assets/raw/<name>.glb (+ blender/source/<name>.blend)
// Usage: npm run assets:build [-- name ...]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const blender = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
if (!existsSync(blender)) {
  console.error(`Blender not found at ${blender}. Set BLENDER=/path/to/blender.`);
  process.exit(1);
}

const scriptsDir = join(root, 'blender/assets');
const requested = process.argv.slice(2);
const names = requested.length
  ? requested
  : readdirSync(scriptsDir).filter((f) => f.endsWith('.py')).map((f) => f.slice(0, -3));

let failed = 0;
for (const name of names) {
  const script = join(scriptsDir, `${name}.py`);
  const glb = join(root, 'assets/raw', `${name}.glb`);
  const blend = join(root, 'blender/source', `${name}.blend`);
  console.log(`\n▶ ${name}`);
  const r = spawnSync(blender, ['-b', '--factory-startup', '-noaudio', '-P', script, '--', '--glb', glb, '--blend', blend], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`✖ ${name} failed (exit ${r.status})`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
