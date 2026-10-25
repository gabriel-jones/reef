import type { SkyAndSun } from '../world/sky';

const W = 128;
const H = 72;
const CX = W / 2;
const CY = H - 14;
const R = 50;
const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** A thin day arc in the corner: 0:00 at the left, noon at the top, 24:00 at the right. Drag the glyph to change the time. */
export function createTimeArc(sky: SkyAndSun): { tick(): void } {
  const root = document.createElement('div');
  root.className = 'time-arc';
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, root);
  el('path', { d: `M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`, class: 'track' }, svg);
  el('line', { x1: CX - R - 6, y1: CY, x2: CX + R + 6, y2: CY, class: 'horizon' }, svg);
  const glyph = el('g', { class: 'glyph' }, svg);
  el('circle', { r: 9, class: 'hit' }, glyph);
  const sun = el('circle', { r: 4.2, class: 'sun' }, glyph);
  const moon = el('path', { d: 'M1.5,-4.4 A4.6,4.6 0 1 0 1.5,4.4 A3.6,3.6 0 1 1 1.5,-4.4 Z', class: 'moon' }, glyph);
  const label = document.createElement('span');
  root.appendChild(label);
  document.body.appendChild(root);

  let shown = -1;
  const tick = (): void => {
    const h = sky.state.hours;
    if (h === shown) return;
    shown = h;
    const a = Math.PI * (1 - h / 24);
    glyph.setAttribute('transform', `translate(${(CX + R * Math.cos(a)).toFixed(2)},${(CY - R * Math.sin(a)).toFixed(2)})`);
    const day = sky.elevation > -0.5;
    sun.style.display = day ? '' : 'none';
    moon.style.display = day ? 'none' : '';
    const m = Math.round(h * 60) % 1440;
    label.textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  const drag = (e: PointerEvent): void => {
    const box = svg.getBoundingClientRect();
    const x = e.clientX - box.left - CX;
    const y = CY - (e.clientY - box.top);
    const a = Math.atan2(Math.max(y, 0), x);
    sky.state.hours = Math.min(Math.max((1 - a / Math.PI) * 24, 0), 23.99);
    sky.update();
    tick();
  };
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    drag(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (svg.hasPointerCapture(e.pointerId)) drag(e);
  });
  const release = (e: PointerEvent): void => {
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    root.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  tick();
  return { tick };
}
