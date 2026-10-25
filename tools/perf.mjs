#!/usr/bin/env node
// Measure GPU time for named scenarios at a fixed pixel ratio.
// Usage: node tools/perf.mjs <pixelRatio> '<label>=<js>' ...
import puppeteer from 'puppeteer-core';

const [ratio = '1.25', ...cases] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1728, height: 1117, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate((s) => {
  const r = window.__reef;
  r.resolution.enabled = false;
  r.resolution.setScale(Number(s));
}, ratio);

const sample = async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const vals = [];
  for (let i = 0; i < 30; i++) {
    vals.push(await page.evaluate(() => window.__reef.hud.gpuMs));
    await new Promise((r) => setTimeout(r, 100));
  }
  vals.sort((a, b) => a - b);
  return `p25 ${vals[7].toFixed(2)}  p50 ${vals[15].toFixed(2)}  p90 ${vals[27].toFixed(2)} ms`;
};

console.log(`baseline: ${await sample()}`);
for (const c of cases) {
  const i = c.indexOf('=');
  const label = c.slice(0, i);
  await page.evaluate(c.slice(i + 1));
  console.log(`${label}: ${await sample()}`);
}
await browser.close();
