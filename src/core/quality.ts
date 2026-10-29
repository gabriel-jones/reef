/**
 * Quality tiers. The starting tier comes from the device (phones low, tablets mid, desktops by core
 * count) or `?quality=low|mid|high`; the live controller then trades resolution first and scene
 * detail second to hold the frame budget, so a device that heats up and throttles stays smooth.
 */
export interface Tier {
  name: 'low' | 'mid' | 'high';
  /** Frame-rate cap; phones run at 30 to stay cool, desktops never exceed 60 (ProMotion would double the work). */
  fpsCap: number;
  pixelRatio: { min: number; max: number; initial: number };
  /** Fraction of seagrass clumps drawn. */
  seagrass: number;
  /** Fish per bait school. */
  bait: number;
  /** Ocean surface vertex spacing, m. */
  surfaceSpacing: number;
}

export const TIERS: readonly Tier[] = [
  { name: 'low', fpsCap: 30, pixelRatio: { min: 0.6, max: 1.25, initial: 0.9 }, seagrass: 0.35, bait: 150, surfaceSpacing: 1 / 3 },
  { name: 'mid', fpsCap: 60, pixelRatio: { min: 0.7, max: 1.5, initial: 1.0 }, seagrass: 0.65, bait: 240, surfaceSpacing: 1 / 4 },
  { name: 'high', fpsCap: 60, pixelRatio: { min: 0.75, max: 1.5, initial: 1.25 }, seagrass: 1, bait: 340, surfaceSpacing: 1 / 6 },
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

/**
 * Holds the frame budget. With GPU timestamps it compares GPU time with the budget; without them
 * (Safari) it counts frames that missed their slot.
 */
export class QualityController {
  enabled = true;
  tier: number;
  scale: number;
  private window: number[] = [];
  private missed = 0;
  private frames = 0;
  private lastAdjust = 0;
  private overStreak = 0;
  private underStreak = 0;
  private holdUntil = 0;

  constructor(private targets: QualityTargets, tier = startTier()) {
    this.tier = tier;
    this.scale = TIERS[tier].pixelRatio.initial;
    targets.applyTier(TIERS[tier]);
    targets.setPixelRatio(this.scale);
  }

  get current(): Tier {
    return TIERS[this.tier];
  }

  /** Minimum time between rendered frames for the current cap (ms). */
  get interval(): number {
    return 1000 / this.current.fpsCap;
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.targets.setPixelRatio(scale);
  }

  private ignoreUntil = 0;

  /** Ignore frame times for a while, e.g. while new content compiles its shaders. */
  settle(ms: number, now = performance.now()): void {
    this.ignoreUntil = Math.max(this.ignoreUntil, now + ms);
  }

  /** Feed once per rendered frame: GPU ms (0 if unknown) and the time since the previous rendered frame. */
  sample(gpuMs: number, frameDt: number, now: number): void {
    if (!this.enabled) return;
    if (now < this.ignoreUntil) {
      this.window.length = this.missed = this.frames = 0;
      this.lastAdjust = now;
      return;
    }
    if (gpuMs > 0) this.window.push(gpuMs);
    this.frames++;
    if (frameDt > this.interval * 1.45) this.missed++;
    if (now - this.lastAdjust < 1000 || this.frames < 20) return;

    let over: boolean;
    let under: boolean;
    if (this.window.length >= 10) {
      const sorted = this.window.sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const budget = this.interval * 0.85;
      over = p90 > budget;
      under = p90 < budget * 0.65;
    } else {
      const rate = this.missed / this.frames;
      over = rate > 0.08;
      under = rate < 0.01;
    }
    this.window.length = 0;
    this.missed = 0;
    this.frames = 0;
    this.lastAdjust = now;

    const pr = this.current.pixelRatio;
    this.overStreak = over ? this.overStreak + 1 : 0;
    this.underStreak = under ? this.underStreak + 1 : 0;
    if (over) {
      if (this.scale > pr.min + 1e-3) this.setScale(Math.max(this.scale - 0.1, pr.min));
      else if (this.overStreak >= 3 && this.tier > 0) this.changeTier(this.tier - 1, now, true);
    } else if (under && now > this.holdUntil) {
      if (this.scale < pr.max - 1e-3) {
        if (this.underStreak >= 2) this.setScale(Math.min(this.scale + 0.05, pr.max));
      } else if (this.underStreak >= 10 && this.tier < Math.min(startTier() + 1, TIERS.length - 1)) this.changeTier(this.tier + 1, now, false);
    }
  }

  changeTier(tier: number, now = performance.now(), down = tier < this.tier): void {
    this.tier = tier;
    const pr = this.current.pixelRatio;
    this.targets.applyTier(this.current);
    this.setScale(Math.min(Math.max(this.scale, pr.min), pr.max));
    this.overStreak = this.underStreak = 0;
    // After stepping down, don't try climbing back for a while: the device is likely hot.
    if (down) this.holdUntil = now + 45000;
  }
}
