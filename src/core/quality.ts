/**
 * Quality tiers. The starting tier comes from the device (phones low, tablets mid, desktops by core
 * count) or `?quality=low|mid|high`; the live controller then trades resolution first and scene
 * detail second to hold the frame budget, so a device that heats up and throttles stays smooth.
 */
export interface Tier {
  name: 'low' | 'mid' | 'high';
  /** Frame-rate cap; phones run at 30 to stay cool, desktops never exceed 60 (ProMotion would double the work). */
  fpsCap: number;
  /** Allowed pixel ratios, ascending; the controller moves between neighbours. */
  pixelRatios: readonly number[];
  /** Index into `pixelRatios` to start at. */
  initial: number;
  /** Fraction of seagrass clumps drawn. */
  seagrass: number;
  /** Fish per bait school. */
  bait: number;
  /** Ocean surface vertex spacing, m. */
  surfaceSpacing: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'low', fpsCap: 30, pixelRatios: [1, 1.25, 1.5, 1.75], initial: 1, seagrass: 0.35, bait: 150, surfaceSpacing: 1 / 3 },
  { name: 'mid', fpsCap: 60, pixelRatios: [0.75, 1, 1.25, 1.5], initial: 1, seagrass: 0.65, bait: 240, surfaceSpacing: 1 / 4 },
  { name: 'high', fpsCap: 60, pixelRatios: [0.75, 1, 1.25, 1.5], initial: 2, seagrass: 1, bait: 340, surfaceSpacing: 1 / 6 },
];

let start: number | null = null;

/** Tier index to start at; fixed for the session because some choices (FFT size) are made at startup. */
export function startTier(): number {
  if (start !== null) return start;
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
  const named = TIERS.findIndex((t) => t.name === forced);
  if (named >= 0) return (start = named);
  if (typeof navigator === 'undefined') return (start = 2);
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPod|Android.*Mobile/.test(ua)) start = 0;
  else if (/iPad|Android/.test(ua) || iPadOS) start = 1;
  else start = (navigator.hardwareConcurrency ?? 8) >= 10 ? 2 : 1;
  return start;
}

export interface QualityTargets {
  setPixelRatio(r: number): void;
  applyTier(t: Tier): void;
}

/** Seconds of evidence needed before acting. */
const DOWN_AFTER = 2;
const UP_AFTER = 8;
/** After any change, frame times are ignored while targets reallocate and the GPU settles (ms). */
const SETTLE = 1500;
/** An increase undone within this long is treated as a failed probe (ms)... */
const PROBE_WINDOW = 15000;
/** ...and blocks further increases for this long (ms). */
const PROBE_BAN = 60000;

/**
 * Holds the frame budget with as few changes as possible: every pixel-ratio change reallocates the
 * multisampled targets and hitches, so a jumpy controller causes the lag it is trying to avoid.
 * With GPU timestamps it compares GPU time with the budget; without them (Safari) it counts frames
 * that missed their slot, which can't measure headroom, so it then never climbs above the start.
 */
export class QualityController {
  enabled = true;
  tier: number;
  /** Index into the current tier's `pixelRatios`. */
  step: number;
  /** Set once per session from the renderer; decides which signal drives the controller. */
  timestamps = false;
  private window: number[] = [];
  private missed = 0;
  private frames = 0;
  private windowStart = 0;
  private overStreak = 0;
  private underStreak = 0;
  private ignoreUntil = 0;
  private lastUp = -Infinity;
  private upBanUntil = 0;
  private readonly startStep: number;

  constructor(private targets: QualityTargets, tier = startTier()) {
    this.tier = tier;
    this.step = this.startStep = TIERS[tier].initial;
    targets.applyTier(TIERS[tier]);
    targets.setPixelRatio(this.scale);
  }

  get current(): Tier {
    return TIERS[this.tier];
  }

  get scale(): number {
    return this.current.pixelRatios[this.step];
  }

  /** Minimum time between rendered frames for the current cap (ms). */
  get interval(): number {
    return 1000 / this.current.fpsCap;
  }

  /** Jump to the pixel-ratio step nearest `scale` in the current tier. */
  setScale(scale: number): void {
    const list = this.current.pixelRatios;
    let best = 0;
    for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - scale) < Math.abs(list[best] - scale)) best = i;
    this.setStep(best);
  }

  private setStep(step: number, now = performance.now()): void {
    if (step === this.step) return;
    this.step = step;
    this.targets.setPixelRatio(this.scale);
    this.settle(SETTLE, now);
  }

  /** Ignore frame times for a while, e.g. while new content compiles its shaders. */
  settle(ms: number, now = performance.now()): void {
    this.ignoreUntil = Math.max(this.ignoreUntil, now + ms);
  }

  /** Feed once per rendered frame: GPU ms (0 if unknown) and the time since the previous rendered frame. */
  sample(gpuMs: number, frameDt: number, now: number): void {
    if (!this.enabled) return;
    if (now < this.ignoreUntil) {
      this.window.length = this.missed = this.frames = 0;
      this.windowStart = now;
      return;
    }
    if (gpuMs > 0) this.window.push(gpuMs);
    this.frames++;
    if (frameDt > this.interval * 1.45) this.missed++;
    if (now - this.windowStart < 1000 || this.frames < 15) return;

    let over: boolean;
    let under: boolean;
    if (this.timestamps && this.window.length >= 10) {
      const sorted = this.window.sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const budget = this.interval * 0.85;
      over = p90 > budget;
      under = p90 < budget * 0.6;
    } else {
      const rate = this.missed / this.frames;
      over = rate > 0.1;
      under = rate < 0.01;
    }
    this.window.length = this.missed = this.frames = 0;
    this.windowStart = now;
    this.overStreak = over ? this.overStreak + 1 : 0;
    this.underStreak = under ? this.underStreak + 1 : 0;

    if (this.overStreak >= DOWN_AFTER) {
      this.overStreak = 0;
      if (now - this.lastUp < PROBE_WINDOW) this.upBanUntil = now + PROBE_BAN;
      if (this.step > 0) this.setStep(this.step - 1, now);
      else if (this.tier > 0) this.changeTier(this.tier - 1, now);
    } else if (this.underStreak >= UP_AFTER && now > this.upBanUntil) {
      this.underStreak = 0;
      const ceiling = this.timestamps ? this.current.pixelRatios.length - 1 : this.startStep;
      if (this.step < ceiling) {
        this.lastUp = now;
        this.setStep(this.step + 1, now);
      } else if (this.timestamps && this.tier < Math.min(startTier() + 1, TIERS.length - 1)) {
        this.lastUp = now;
        this.changeTier(this.tier + 1, now);
      }
    }
  }

  changeTier(tier: number, now = performance.now()): void {
    if (tier === this.tier) return;
    const down = tier < this.tier;
    const scale = this.scale;
    this.tier = tier;
    this.targets.applyTier(this.current);
    // Keep the resolution where it was when possible; the detail change is the point.
    const list = this.current.pixelRatios;
    let step = down ? list.length - 1 : 0;
    while (down ? step > 0 && list[step] > scale : step < list.length - 1 && list[step] < scale) step += down ? -1 : 1;
    this.step = -1;
    this.setStep(step, now);
    this.overStreak = this.underStreak = 0;
    // A device that needed a lower tier is likely hot: don't climb back for a while.
    if (down) this.upBanUntil = Math.max(this.upBanUntil, now + 45000);
  }
}
