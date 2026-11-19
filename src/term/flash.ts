/**
 * Calm change flashes (owner, 2026-11-19: "listen to the flashing lights every time it changes so it's not
 * fatiguing"). A value that changes gets one soft tint that fades (up = green, down = red), never a blink. Limits that
 * keep a busy screen quiet:
 *   - a cell flashes at most once every 2 seconds, however often its value ticks;
 *   - tiny changes (below `minMove`, relative) don't flash at all;
 *   - at most 12 cells start a flash in any one second across the whole screen; the rest just update;
 *   - nothing flashes when the system asks for reduced motion, when the setting is off or when the tab is hidden;
 *   - the first value a cell shows never flashes (only real changes do).
 * The decision is pure (`shouldFlash`) and tested; `flash` applies it.
 */

export const FLASH = { cellGapMs: 2000, perSecond: 12, fadeMs: 900 };
const KEY = 'tp-flash';

export function flashEnabled(): boolean {
  try {
    if (localStorage.getItem(KEY) === 'off') return false;
  } catch {
    // private window: on
  }
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function setFlashEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // not remembered
  }
}

export interface FlashState {
  /** Per cell: when it last flashed. */
  last: WeakMap<object, number>;
  /** Start times of flashes in the last second (screen-wide budget). */
  recent: number[];
}

export const newFlashState = (): FlashState => ({ last: new WeakMap(), recent: [] });

/** 'up' / 'down' when this change should flash now, else null. Records the flash in `state` when it says yes. */
export function shouldFlash(state: FlashState, cell: object, prev: number | null | undefined, next: number | null | undefined, now: number, minMove = 0): 'up' | 'down' | null {
  if (prev == null || next == null || !Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return null;
  if (minMove > 0 && Math.abs(next - prev) <= Math.abs(prev) * minMove) return null;
  const last = state.last.get(cell);
  if (last != null && now - last < FLASH.cellGapMs) return null;
  state.recent = state.recent.filter((t) => now - t < 1000);
  if (state.recent.length >= FLASH.perSecond) return null;
  state.recent.push(now);
  state.last.set(cell, now);
  return next > prev ? 'up' : 'down';
}

const shared = newFlashState();

/** Soft-tints `el` once when `next` differs from `prev` (see the limits above). */
export function flash(el: HTMLElement, prev: number | null | undefined, next: number | null | undefined, minMove = 0) {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (!flashEnabled()) return;
  const dir = shouldFlash(shared, el, prev, next, performance.now(), minMove);
  if (!dir) return;
  el.classList.remove('tk-up', 'tk-down');
  void el.offsetWidth; // restart the fade when the class comes back
  el.classList.add(dir === 'up' ? 'tk-up' : 'tk-down');
  window.setTimeout(() => el.classList.remove('tk-up', 'tk-down'), FLASH.fadeMs + 50);
}
