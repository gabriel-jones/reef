import * as THREE from 'three/webgpu';
import { BOILER, shoreX } from '../world/seabedProfile';

/**
 * Procedural soundscape, synthesized with Web Audio (no samples):
 *  - above water: surf on the beach and the boiler, wind, gulls by day, crickets by night;
 *  - below: a low swell rumble, snapping-shrimp crackle, bubbles when the diver moves fast.
 * The air bus is muffled and ducked as the camera goes under, the water bus fades in.
 */
export interface Listener {
  position: THREE.Vector3;
  /** Camera right vector, for panning. */
  right: THREE.Vector3;
  underwater: boolean;
  /** Metres below the surface (0 above). */
  depth: number;
  /** 0 day … 1 night. */
  night: number;
  /** Camera speed, m/s. */
  speed: number;
}

const MASTER = 0.7;

function noiseBuffer(ctx: AudioContext, seconds: number, colour: 'white' | 'brown'): AudioBuffer {
  const buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (colour === 'white') d[i] = w;
      else d[i] = last = (last + 0.02 * w) / 1.02;
    }
    if (colour === 'brown') for (let i = 0; i < d.length; i++) d[i] *= 3.5;
    // Crossfade the loop seam.
    const fade = Math.min(2048, d.length >> 3);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
    }
  }
  return buf;
}

/** Dense, uneven clicking: snapping shrimp heard from all around a reef. */
function crackleBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(sr * seconds), sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const clicks = seconds * 260;
    for (let k = 0; k < clicks; k++) {
      const at = Math.floor(Math.random() * (d.length - 200));
      const amp = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? -1 : 1);
      const len = 30 + Math.random() * 60;
      for (let i = 0; i < len; i++) d[at + i] += amp * Math.exp(-i / (len * 0.18)) * (i % 2 ? -1 : 1);
    }
  }
  return buf;
}

/** A field cricket: trills of three or four 4.6 kHz pulses, a few per second. */
function cricketBuffer(ctx: AudioContext, seconds: number, freq: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
  const d = buf.getChannelData(0);
  let t = Math.random() * 0.2;
  while (t < seconds - 0.2) {
    const pulses = 3 + (Math.random() < 0.4 ? 1 : 0);
    for (let p = 0; p < pulses; p++) {
      const start = Math.floor((t + p * 0.022) * sr);
      const len = Math.floor(0.014 * sr);
      for (let i = 0; i < len; i++) {
        const env = Math.sin((Math.PI * i) / len);
        d[start + i] += Math.sin((2 * Math.PI * freq * i) / sr) * env * env;
      }
    }
    t += 0.28 + Math.random() * 0.12;
  }
  return buf;
}

class Layer {
  readonly gain: GainNode;
  readonly pan: StereoPannerNode;
  constructor(ctx: AudioContext, out: AudioNode) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.gain.connect(this.pan).connect(out);
  }
  set(ctx: AudioContext, level: number, pan = 0, smooth = 0.25): void {
    this.gain.gain.setTargetAtTime(level, ctx.currentTime, smooth);
    this.pan.pan.setTargetAtTime(THREE.MathUtils.clamp(pan, -1, 1), ctx.currentTime, smooth);
  }
}

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private airMuffle!: BiquadFilterNode;
  private air!: GainNode;
  private water!: GainNode;
  private beach!: Layer;
  private beachTone!: BiquadFilterNode;
  private wash!: Layer;
  private boiler!: Layer;
  private wind!: Layer;
  private windTone!: BiquadFilterNode;
  private crickets!: Layer;
  private rumble!: Layer;
  private shrimp!: Layer;
  private clock = 0;
  private gullTimer = 6;
  private bubbleTimer = 0;
  enabled = false;

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    if (on && !this.ctx) this.build();
    if (!this.ctx) return;
    if (on) await this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? MASTER : 0, this.ctx.currentTime, 0.4);
  }

  private loop(buf: AudioBuffer, to: AudioNode, rate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(to);
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  private build(): void {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.airMuffle = ctx.createBiquadFilter();
    this.airMuffle.type = 'lowpass';
    this.airMuffle.frequency.value = 18000;
    this.air = ctx.createGain();
    this.airMuffle.connect(this.air).connect(this.master);
    this.water = ctx.createGain();
    this.water.gain.value = 0;
    this.water.connect(this.master);

    const white = noiseBuffer(ctx, 6, 'white');
    const brown = noiseBuffer(ctx, 8, 'brown');

    // Surf: brown-noise body whose brightness and level rise as each set breaks, plus a hissing wash.
    this.beach = new Layer(ctx, this.airMuffle);
    this.beachTone = ctx.createBiquadFilter();
    this.beachTone.type = 'lowpass';
    this.beachTone.frequency.value = 500;
    this.beachTone.connect(this.beach.gain);
    this.loop(brown, this.beachTone);
    this.wash = new Layer(ctx, this.airMuffle);
    const washTone = ctx.createBiquadFilter();
    washTone.type = 'bandpass';
    washTone.frequency.value = 3200;
    washTone.Q.value = 0.5;
    washTone.connect(this.wash.gain);
    this.loop(white, washTone, 0.9);
    this.boiler = new Layer(ctx, this.airMuffle);
    const boilerTone = ctx.createBiquadFilter();
    boilerTone.type = 'lowpass';
    boilerTone.frequency.value = 900;
    boilerTone.connect(this.boiler.gain);
    this.loop(brown, boilerTone, 1.3);

    this.wind = new Layer(ctx, this.airMuffle);
    this.windTone = ctx.createBiquadFilter();
    this.windTone.type = 'bandpass';
    this.windTone.frequency.value = 500;
    this.windTone.Q.value = 0.8;
    this.windTone.connect(this.wind.gain);
    this.loop(white, this.windTone, 0.7);

    this.crickets = new Layer(ctx, this.airMuffle);
    const cricketsMix = ctx.createGain();
    cricketsMix.connect(this.crickets.gain);
    [4550, 4720, 4900].forEach((f, i) => {
      const p = ctx.createStereoPanner();
      p.pan.value = [-0.7, 0.6, 0.1][i];
      p.connect(cricketsMix);
      this.loop(cricketBuffer(ctx, 3.1 + i * 0.7, f), p);
    });

    this.rumble = new Layer(ctx, this.water);
    const rumbleTone = ctx.createBiquadFilter();
    rumbleTone.type = 'lowpass';
    rumbleTone.frequency.value = 160;
    rumbleTone.connect(this.rumble.gain);
    this.loop(brown, rumbleTone, 0.6);
    this.shrimp = new Layer(ctx, this.water);
    const shrimpTone = ctx.createBiquadFilter();
    shrimpTone.type = 'highpass';
    shrimpTone.frequency.value = 1800;
    shrimpTone.connect(this.shrimp.gain);
    this.loop(crackleBuffer(ctx, 5), shrimpTone);
  }

  /** A distant herring gull: a falling, slightly rough "kee-ow". */
  private gull(pan: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const vib = ctx.createOscillator();
    vib.frequency.value = 28;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = 40;
    vib.connect(vibAmt).connect(osc.frequency);
    const tone = ctx.createBiquadFilter();
    tone.type = 'bandpass';
    tone.frequency.value = 1700;
    tone.Q.value = 2.5;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(tone).connect(g).connect(p).connect(this.airMuffle);
    const calls = 1 + Math.floor(Math.random() * 3);
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < calls; k++) {
      const s = t + k * 0.42;
      osc.frequency.setValueAtTime(1150 + Math.random() * 100, s);
      osc.frequency.linearRampToValueAtTime(1500, s + 0.06);
      osc.frequency.exponentialRampToValueAtTime(820, s + 0.32);
      g.gain.setTargetAtTime(0.022, s, 0.02);
      g.gain.setTargetAtTime(0, s + 0.24, 0.05);
    }
    const end = t + calls * 0.42 + 0.4;
    osc.start(t);
    vib.start(t);
    osc.stop(end);
    vib.stop(end);
  }

  /** A short rising blip: one bubble breaking free past the mask. */
  private bubble(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + Math.random() * 0.05;
    const osc = ctx.createOscillator();
    const f = 300 + Math.random() * 500;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 2.6, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    osc.connect(g).connect(p).connect(this.water);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  update(dt: number, l: Listener): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    this.clock += dt;
    const t = this.clock;
    const p = l.position;
    const day = 1 - l.night;
    const under = l.underwater ? 1 : 0;

    // Bus crossfade at the waterline; the air bus stays faintly audible just under the surface.
    const muffle = l.underwater ? 380 * Math.exp(-l.depth * 0.25) + 120 : 18000;
    this.airMuffle.frequency.setTargetAtTime(muffle, ctx.currentTime, 0.08);
    this.air.gain.setTargetAtTime(l.underwater ? 0.35 * Math.exp(-l.depth * 0.4) : 1, ctx.currentTime, 0.08);
    this.water.gain.setTargetAtTime(under, ctx.currentTime, 0.12);

    // Sets roll in every ~8 s; the crash and the hissing run-up follow each one.
    const swell = Math.pow(0.5 + 0.5 * Math.sin((t / 8.3) * Math.PI * 2), 2.2) * 0.75 + 0.25 * (0.5 + 0.5 * Math.sin((t / 3.1) * Math.PI * 2 + 1));
    const wash = Math.pow(Math.max(Math.sin((t / 8.3) * Math.PI * 2 - 1.1), 0), 3);
    const pan = (sx: number, sz: number) => {
      const dx = sx - p.x;
      const dz = sz - p.z;
      const d = Math.hypot(dx, dz) || 1;
      return ((dx * l.right.x + dz * l.right.z) / d) * 0.8;
    };
    const sx = shoreX(p.z);
    const shoreDist = Math.hypot(Math.max(p.x - sx, 0), Math.max(p.y, 0) * 0.6) + 2;
    const near = 1 / (1 + shoreDist / 10);
    this.beach.set(ctx, 0.55 * near * (0.45 + swell * 0.7), pan(sx, p.z));
    this.beachTone.frequency.setTargetAtTime(260 + swell * 700 * near + 120, ctx.currentTime, 0.3);
    this.wash.set(ctx, 0.12 * near * wash, pan(sx - 2, p.z));
    const bd = Math.hypot(p.x - BOILER.x, p.z - BOILER.z, Math.max(p.y, 0) * 0.6);
    this.boiler.set(ctx, (0.25 / (1 + Math.max(bd - BOILER.radius, 0) / 8)) * (0.5 + swell * 0.5), pan(BOILER.x, BOILER.z));

    const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.073 + 2);
    const height = THREE.MathUtils.clamp(p.y / 40, 0, 1);
    this.wind.set(ctx, (0.05 + 0.1 * height) * gust * (0.6 + 0.4 * day), 0, 0.6);
    this.windTone.frequency.setTargetAtTime(380 + gust * 420 + height * 300, ctx.currentTime, 0.6);
    this.crickets.set(ctx, 0.05 * THREE.MathUtils.smoothstep(l.night, 0.4, 0.9) / (1 + Math.max(p.x - sx + 8, 0) / 14), pan(sx - 10, p.z) * 0.5, 1);

    this.rumble.set(ctx, 0.5 * (0.7 + swell * 0.3));
    this.shrimp.set(ctx, 0.09 * (1 - Math.exp(-l.depth * 0.8)));

    if (!l.underwater && day > 0.5 && p.y < 60) {
      this.gullTimer -= dt;
      if (this.gullTimer < 0) {
        this.gull(Math.random() * 1.4 - 0.7);
        this.gullTimer = 9 + Math.random() * 18;
      }
    }
    if (l.underwater && l.speed > 0.6) {
      this.bubbleTimer -= dt * Math.min(l.speed, 6);
      while (this.bubbleTimer < 0) {
        this.bubble(0.05 * Math.min(l.speed / 3, 1));
        this.bubbleTimer += 0.05 + Math.random() * 0.15;
      }
    }
  }
}
