import { startTier } from '../core/quality';
export interface SpectrumParams {
  scale: number;
  windSpeed: number;
  /** Direction waves travel toward, degrees (0 = +X, 90 = +Z). */
  direction: number;
  fetch: number;
  /** 0 = isotropic cos² spread, 1 = fully directional cos^2s. */
  spreadBlend: number;
  /** 0..1, narrows spreading for long-travelled swell. */
  swell: number;
  peakEnhancement: number;
  shortWavesFade: number;
}

export interface OceanParams {
  wind: SpectrumParams;
  swell: SpectrumParams;
  choppiness: number;
  timeScale: number;
  foamBias: number;
  foamGain: number;
  foamDecay: number;
  /** Depth (m) over which waves fade out toward the shore. */
  shoalDepth: number;
}

export const CASCADES = [
  { size: 187, kMin: 1e-4, kMax: (2 * Math.PI / 37) * 6 },
  { size: 37, kMin: (2 * Math.PI / 37) * 6, kMax: (2 * Math.PI / 9.3) * 6 },
  { size: 9.3, kMin: (2 * Math.PI / 9.3) * 6, kMax: Infinity },
] as const;

/** Phones simulate at half resolution (finest ripples go); fixed for the session. */
export const FFT_SIZE = startTier() === 0 ? 128 : 256;

/** Bermuda south-shore trade wind sea plus a long Atlantic swell from the southeast, landing on the beach at -X. */
export const DEFAULT_OCEAN: OceanParams = {
  wind: {
    scale: 0.18,
    windSpeed: 5.5,
    direction: 195,
    fetch: 40000,
    spreadBlend: 0.85,
    swell: 0.15,
    peakEnhancement: 3.3,
    shortWavesFade: 0.01,
  },
  swell: {
    scale: 0.12,
    windSpeed: 2.2,
    direction: 175,
    fetch: 300000,
    spreadBlend: 1,
    swell: 1,
    peakEnhancement: 3.3,
    shortWavesFade: 0.01,
  },
  choppiness: 0.9,
  timeScale: 1,
  foamBias: 0.72,
  foamGain: 3.5,
  foamDecay: 0.9,
  shoalDepth: 2.8,
};
