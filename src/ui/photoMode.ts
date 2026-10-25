import { uniform } from 'three/tsl';

export interface PhotoSettings {
  /** Bokeh size; 0 turns depth of field off. */
  aperture: number;
  /** Exposure offset in stops. */
  ev: number;
}

/**
 * Photo mode: the scene freezes and the UI gives way to a small bar of camera settings. Click the
 * scene to focus; Save writes a full-resolution PNG.
 */
export class PhotoMode {
  active = false;
  readonly settings: PhotoSettings = { aperture: 1.5, ev: 0 };
  readonly focus = uniform(12);
  readonly focalLength = uniform(6);
  readonly bokeh = uniform(1.5);
  private readonly bar: HTMLElement;
  private readonly listeners: Array<(on: boolean) => void> = [];

  constructor(private readonly save: () => void) {
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'photo-bar';
    bar.hidden = true;
    bar.innerHTML = `
      <label>focus blur<input type="range" name="aperture" min="0" max="4" step="0.05"></label>
      <label>exposure<input type="range" name="ev" min="-2" max="2" step="0.05"></label>
      <button name="save">save</button>
      <button name="exit" title="Exit (P / Esc)">×</button>
      <span class="hint">click to focus</span>`;
    for (const key of ['aperture', 'ev'] as const) {
      const input = bar.querySelector<HTMLInputElement>(`input[name=${key}]`)!;
      input.value = String(this.settings[key]);
      input.addEventListener('input', () => {
        this.settings[key] = Number(input.value);
        this.bokeh.value = this.settings.aperture;
      });
    }
    bar.querySelector('button[name=save]')!.addEventListener('click', () => this.save());
    bar.querySelector('button[name=exit]')!.addEventListener('click', () => this.toggle(false));
    document.body.appendChild(bar);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'p' || e.key === 'P') this.toggle();
      else if (e.key === 'Escape' && this.active) this.toggle(false);
    });
  }

  onChange(fn: (on: boolean) => void): void {
    this.listeners.push(fn);
  }

  toggle(on = !this.active): void {
    if (on === this.active) return;
    this.active = on;
    this.bar.hidden = !on;
    document.body.classList.toggle('photo', on);
    for (const fn of this.listeners) fn(on);
  }

  /** Focus at a distance along the view direction; blur ramps up over a span that scales with it. */
  focusAt(distance: number): void {
    this.focus.value = distance;
    this.focalLength.value = Math.max(distance * 0.5, 0.6);
  }
}
