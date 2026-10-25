import { CASCADES, FFT_SIZE, type OceanParams, type SpectrumParams } from './params';

const G = 9.81;

function jonswapAlpha(fetch: number, u: number): number {
  return 0.076 * Math.pow((G * fetch) / (u * u), -0.22);
}

function jonswapPeak(fetch: number, u: number): number {
  return 22 * Math.pow((u * fetch) / (G * G), -0.33);
}

function jonswap(omega: number, p: SpectrumParams, alpha: number, peak: number): number {
  const sigma = omega <= peak ? 0.07 : 0.09;
  const r = Math.exp(-((omega - peak) ** 2) / (2 * sigma * sigma * peak * peak));
  return p.scale * alpha * G * G * Math.pow(omega, -5) * Math.exp(-1.25 * Math.pow(peak / omega, 4)) * Math.pow(p.peakEnhancement, r);
}

function cos2sNormalisation(s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  const s4 = s3 * s;
  if (s < 5) return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
  return -4.8e-8 * s4 + 1.07e-5 * s3 - 9.53e-4 * s2 + 5.9e-2 * s + 3.93e-1;
}

function direction(theta: number, omega: number, peak: number, p: SpectrumParams): number {
  const ratio = omega / peak;
  const s = (ratio > 1 ? 9.77 * Math.pow(ratio, -2.5) : 6.97 * Math.pow(ratio, 5)) + 16 * Math.tanh(Math.min(ratio, 20)) * p.swell * p.swell;
  const d = theta - (p.direction * Math.PI) / 180;
  const iso = (2 / Math.PI) * Math.cos(d) ** 2;
  const dir = cos2sNormalisation(s) * Math.pow(Math.abs(Math.cos(0.5 * d)), 2 * s);
  return iso + (dir - iso) * p.spreadBlend;
}

// Deterministic Box–Muller Gaussian pairs so the sea looks the same every load.
function gaussianSource(seed: number): () => [number, number] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    const m = Math.sqrt(-2 * Math.log(u1));
    return [m * Math.cos(2 * Math.PI * u2), m * Math.sin(2 * Math.PI * u2)];
  };
}

export interface SpectrumData {
  /** Per k: (h0.re, h0.im, conj(h0(-k)).re, conj(h0(-k)).im), cascades stacked. */
  h0: Float32Array;
  /** Per k: (kx, kz, 1/|k|, ω). */
  waves: Float32Array;
}

export function buildSpectrum(params: OceanParams, seed = 1337): SpectrumData {
  const N = FFT_SIZE;
  const NN = N * N;
  const h0 = new Float32Array(CASCADES.length * NN * 4);
  const waves = new Float32Array(CASCADES.length * NN * 4);
  const raw = new Float32Array(NN * 2);

  const specs = [params.wind, params.swell].map((p) => ({
    p,
    alpha: jonswapAlpha(p.fetch, p.windSpeed),
    peak: jonswapPeak(p.fetch, p.windSpeed),
  }));

  CASCADES.forEach((cascade, c) => {
    const gauss = gaussianSource(seed + c * 7919);
    const dk = (2 * Math.PI) / cascade.size;
    const base = c * NN;

    for (let m = 0; m < N; m++) {
      const mm = m < N / 2 ? m : m - N;
      for (let n = 0; n < N; n++) {
        const nn = n < N / 2 ? n : n - N;
        const i = m * N + n;
        const kx = nn * dk;
        const kz = mm * dk;
        const k = Math.hypot(kx, kz);
        const omega = Math.sqrt(G * k);
        const [g1, g2] = gauss();

        const w = (base + i) * 4;
        waves[w] = kx;
        waves[w + 1] = kz;
        waves[w + 2] = k > 0 ? 1 / k : 0;
        waves[w + 3] = omega;

        if (k <= cascade.kMin || k > cascade.kMax) {
          raw[i * 2] = raw[i * 2 + 1] = 0;
          continue;
        }

        const theta = Math.atan2(kz, kx);
        const dOmegaDk = G / (2 * omega);
        let spectrum = 0;
        for (const s of specs) {
          const fade = Math.exp(-(s.p.shortWavesFade * s.p.shortWavesFade) * k * k);
          spectrum += jonswap(omega, s.p, s.alpha, s.peak) * direction(theta, omega, s.peak, s.p) * fade;
        }
        const amp = Math.sqrt((2 * spectrum * Math.abs(dOmegaDk)) / k) * dk;
        raw[i * 2] = g1 * amp * Math.SQRT1_2;
        raw[i * 2 + 1] = g2 * amp * Math.SQRT1_2;
      }
    }

    for (let m = 0; m < N; m++) {
      for (let n = 0; n < N; n++) {
        const i = m * N + n;
        const j = ((N - m) % N) * N + ((N - n) % N);
        const o = (base + i) * 4;
        h0[o] = raw[i * 2];
        h0[o + 1] = raw[i * 2 + 1];
        h0[o + 2] = raw[j * 2];
        h0[o + 3] = -raw[j * 2 + 1];
      }
    }
  });

  return { h0, waves };
}
