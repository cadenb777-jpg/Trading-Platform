/**
 * Live-tick indicator updates without recomputing the whole history.
 *
 * A live trade only changes the last bar (or adds one), so most indicators only need their tail redone. Indicators are
 * plain `compute(bars)` functions with no saved state, so this recomputes them on the last `window` bars and checks
 * the overlap: where the bars didn't change, the tail result must equal the values already on the chart. If it does,
 * the tail has "warmed up" (moving averages have converged, windows are full) and its new values are spliced in. If
 * not (a cumulative line such as OBV, a long EMA, or a pattern that rewrites old bars), the caller does a full
 * recompute and the window doubles for next time, up to a cap after which the indicator always recomputes in full.
 * Values match a full recompute within floating-point rounding (TOLERANCE): running sums started at a different bar
 * round differently in the last digits.
 */
import type { Bar } from '../types';

export type Values = Record<string, number[]>;

export interface TailState {
  /** Bars recomputed per tick. Doubles after a failed check. */
  window: number;
  /** True once the window would cover most of the history: the indicator always recomputes in full. */
  fullOnly: boolean;
}

export const FIRST_WINDOW = 512;
const MAX_WINDOW = 8192;
/** Relative difference allowed between the tail result and the stored values (floating-point rounding only). */
export const TOLERANCE = 1e-9;

export const newTailState = (): TailState => ({ window: FIRST_WINDOW, fullOnly: false });

export function sameValue(a: number | undefined, b: number | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Number.isNaN(a)) return Number.isNaN(b);
  if (Number.isNaN(b) || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Recomputes only the tail. `prev` holds the values for the bars before the change (index < changedFrom, unchanged).
 * Returns the full-length values, or null when the caller must recompute everything (the state is updated so the next
 * tick tries a longer window, or stops trying).
 */
export function tailUpdate(compute: (bars: Bar[]) => Values, bars: Bar[], prev: Values, changedFrom: number, state: TailState): Values | null {
  const n = bars.length;
  const w = state.window;
  if (state.fullOnly) return null;
  // Short histories are cheap to redo; the window must also reach well before the change to have something to check.
  if (n < w * 2) return null;
  const start = n - w;
  const checkFrom = start + (w >> 1);
  if (changedFrom <= checkFrom || changedFrom > n) return null;
  const tail = compute(bars.slice(start));
  const keys = Object.keys(prev);
  let ok = keys.length === Object.keys(tail).length;
  for (let k = 0; ok && k < keys.length; k++) {
    const old = prev[keys[k]];
    const fresh = tail[keys[k]];
    if (!fresh || fresh.length !== w) {
      ok = false;
      break;
    }
    for (let i = checkFrom; i < changedFrom; i++) {
      if (!sameValue(old[i], fresh[i - start])) {
        ok = false;
        break;
      }
    }
  }
  if (!ok) {
    state.window = w * 2;
    if (state.window > MAX_WINDOW || state.window * 2 > n) state.fullOnly = true;
    return null;
  }
  const out: Values = {};
  for (const key of keys) {
    const merged = prev[key].slice(0, changedFrom);
    const fresh = tail[key];
    for (let i = changedFrom - start; i < w; i++) merged.push(fresh[i]);
    out[key] = merged;
  }
  return out;
}

/** First index where two value sets differ (Infinity when they're the same), to redraw only what changed. */
export function firstDifference(a: Values, b: Values, from = 0): number {
  let first = Infinity;
  for (const key of Object.keys(b)) {
    const x = a[key];
    const y = b[key];
    if (!x) return from;
    const n = Math.max(x.length, y.length);
    for (let i = from; i < Math.min(n, first); i++) {
      if (!Object.is(x[i], y[i])) {
        first = i;
        break;
      }
    }
  }
  return first;
}
