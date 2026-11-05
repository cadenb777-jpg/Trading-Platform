/**
 * Animation-frame helpers shared by the chart: batch many updates into one per frame, and ease values smoothly.
 * Everything respects the system's "reduce motion" setting (animations jump straight to the end).
 */

type Schedule = (cb: () => void) => unknown;

const defaultSchedule: Schedule = (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => cb()) : setTimeout(cb, 16));

export interface FrameBatch<T> {
  /** Adds a value; the flush runs once on the next frame with every value pushed until then merged. */
  push(value: T): void;
  /** Runs a pending flush now (e.g. before switching symbols). */
  flush(): void;
  /** Drops a pending flush. */
  cancel(): void;
  readonly pending: boolean;
}

/** Collects updates and runs `run` at most once per animation frame with them merged (`merge(old, new)`). */
export function frameBatch<T>(run: (value: T) => void, merge: (a: T, b: T) => T, schedule: Schedule = defaultSchedule): FrameBatch<T> {
  let slot: { value: T } | null = null;
  let generation = 0;
  const fire = (gen: number) => {
    if (gen !== generation || !slot) return;
    const { value } = slot;
    slot = null;
    run(value);
  };
  return {
    push(value) {
      if (slot) slot.value = merge(slot.value, value);
      else {
        slot = { value };
        const gen = ++generation;
        schedule(() => fire(gen));
      }
    },
    flush() {
      if (slot) {
        generation++;
        const { value } = slot;
        slot = null;
        run(value);
      }
    },
    cancel() {
      generation++;
      slot = null;
    },
    get pending() {
      return slot !== null;
    },
  };
}

/** Calls `run` with only the latest value pushed during each frame (e.g. crosshair moves). */
export const latestPerFrame = <T>(run: (value: T) => void, schedule?: Schedule) => frameBatch<T>(run, (_, b) => b, schedule);

/** True when the person asked their system for less motion. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/**
 * Moves `current` toward `target` like a critically damped spring with time constant `ms`, frame-rate independent.
 * Snaps when close enough (relative `epsilon`) so animations end.
 */
export function approach(current: number, target: number, dtMs: number, ms: number, epsilon = 1e-4): number {
  if (!Number.isFinite(current) || ms <= 0) return target;
  const next = target + (current - target) * Math.exp(-dtMs / ms);
  return Math.abs(next - target) <= epsilon * Math.max(1, Math.abs(target)) ? target : next;
}

/** Colour with a new opacity: accepts #rgb, #rrggbb, #rrggbbaa and rgb()/rgba(); anything else is returned as is. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  let m = /^#([0-9a-f]{3})$/i.exec(color);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return `rgba(${r},${g},${b},${a})`;
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (m) {
    const base = m[2] ? parseInt(m[2], 16) / 255 : 1;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${+(a * base).toFixed(3)})`;
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${+(a * (m[4] === undefined ? 1 : Number(m[4]))).toFixed(3)})`;
  return color;
}

function rgbOf(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})/i.exec(color) ?? /^#([0-9a-f]{3})$/i.exec(color);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Blends two hex colours (`t` = 0 gives `a`, 1 gives `b`); for other colour formats it picks the nearer end. */
export function mixColor(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return t < 0.5 ? a : b;
  const k = Math.max(0, Math.min(1, t));
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const EFFECTS_KEY = 'tp-chart-effects';
let effectsPref: boolean | null = null;
const effectsListeners = new Set<() => void>();

/** The "Chart effects" setting (Settings > Chart, saved in this browser): on unless switched off. */
export function chartEffectsSetting(): boolean {
  if (effectsPref === null) {
    try {
      effectsPref = localStorage.getItem(EFFECTS_KEY) !== 'off';
    } catch {
      effectsPref = true;
    }
  }
  return effectsPref;
}

export function setChartEffects(on: boolean) {
  effectsPref = on;
  try {
    localStorage.setItem(EFFECTS_KEY, on ? 'on' : 'off');
  } catch {
    // private window: not remembered
  }
  for (const fn of [...effectsListeners]) fn();
}

export function onChartEffectsChange(fn: () => void): () => void {
  effectsListeners.add(fn);
  return () => effectsListeners.delete(fn);
}

/** Crosshair glow and selected-drawing glow: on with the setting, always off with reduced motion. */
export const chartEffects = () => chartEffectsSetting() && !reducedMotion();
