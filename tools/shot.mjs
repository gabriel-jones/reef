#!/usr/bin/env node
// Screenshot the running dev server in real Chrome (WebGPU).
// Usage: node tools/shot.mjs <out.png> [--url URL] [--wait ms] [--eval "js"] [--size 1728x1117] [--dpr 2]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const out = args[0] ?? 'shots/shot.png';
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const url = opt('url', 'http://127.0.0.1:5173/');
const wait = Number(opt('wait', 4000));
const evalJs = opt('eval', '');
const [w, h] = opt('size', '1728x1117').split('x').map(Number);
const dpr = Number(opt('dpr', 2));

const guard = setTimeout(() => {
  console.log('[shot] timed out after 60s');
  process.exit(2);
}, 60000);
guard.unref();

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: w, height: h, deviceScaleFactor: dpr },
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load', timeout: 50000 });
await new Promise((r) => setTimeout(r, 2500));
if (evalJs) {
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(evalJs);
}
await new Promise((r) => setTimeout(r, wait));
const hud = await page.evaluate(() => document.querySelector('.perf-hud')?.textContent ?? '');
if (hud) console.log(`[hud]\n${hud}`);
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
