/**
 * Shared helpers for the momentum family (Momentum, Oscillators, Cycles). Every function returns an array as long
 * as its input with NaN for the warm-up, like math.ts.
 */
import type { Bar } from '../../types';
import type { IndicatorGuide } from '../info';
import { ema, highest, lowest, rma, sma, wma } from '../math';
import type { IndicatorDef, IndicatorInput, IndicatorParams, PlotDef, PriceSource } from '../types';

export const NaNs = (n: number) => new Array<number>(n).fill(NaN);
export const num = (p: IndicatorParams, key: string) => Number(p[key]);
/** Integer parameter, at least `min` (guards against 0 or fractional lengths typed into the settings). */
export const int = (p: IndicatorParams, key: string, min = 1) => Math.max(min, Math.round(Number(p[key])));

export function source(bars: Bar[], src: PriceSource): number[] {
  switch (src) {
    case 'open':
      return bars.map((b) => b.open);
    case 'high':
      return bars.map((b) => b.high);
    case 'low':
      return bars.map((b) => b.low);
    case 'hl2':
      return bars.map((b) => (b.high + b.low) / 2);
    case 'hlc3':
      return bars.map((b) => (b.high + b.low + b.close) / 3);
    case 'ohlc4':
      return bars.map((b) => (b.open + b.high + b.low + b.close) / 4);
    default:
      return bars.map((b) => b.close);
  }
}
export const src = (bars: Bar[], p: IndicatorParams) => source(bars, (p.source as PriceSource) ?? 'close');
export const opens = (bars: Bar[]) => bars.map((b) => b.open);
export const highs = (bars: Bar[]) => bars.map((b) => b.high);
export const lows = (bars: Bar[]) => bars.map((b) => b.low);
export const closes = (bars: Bar[]) => bars.map((b) => b.close);

export const n = (key: string, label: string, def: number, min = 1, max = 1000, step = 1): IndicatorInput => ({ key, label, type: 'number', default: def, min, max, step });
export const len = (def: number, label = 'Length'): IndicatorInput => n('length', label, def);
export const sourceInput = (def: PriceSource = 'close'): IndicatorInput => ({ key: 'source', label: 'Source', type: 'source', default: def });

/** Palette shared with the original library (library.ts / more.ts). */
export const C = {
  up: '#26a69a',
  down: '#ef5350',
  blue: '#2962ff',
  orange: '#ff6d00',
  purple: '#7e57c2',
  grey: '#787b86',
  amber: '#ff9800',
  violet: '#ab47bc',
  pink: '#e91e63',
  sky: '#2196f3',
  aqua: '#00bcd4',
};

/** One indicator with its beginner guide, so the two can't drift apart. */
export type Entry = { def: IndicatorDef; guide: IndicatorGuide };

/** a / b, or `fallback` when b is 0 (NaN stays NaN). */
export const div = (a: number, b: number, fallback = 0) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : b === 0 ? fallback : a / b);

/** Element-wise map over two arrays. */
export const zip = (a: number[], b: number[], f: (x: number, y: number) => number) => a.map((x, i) => f(x, b[i]));
export const sub = (a: number[], b: number[]) => zip(a, b, (x, y) => x - y);

/** Value `k` bars ago (NaN before the start). */
export const lag = (a: number[], k: number) => a.map((_, i) => (i - k >= 0 ? a[i - k] : NaN));
/** Change over `k` bars. */
export const change = (a: number[], k = 1) => a.map((v, i) => (i - k >= 0 ? v - a[i - k] : NaN));
/** Rate of change in percent over `k` bars. */
export const roc = (a: number[], k: number) => a.map((v, i) => (i - k >= 0 ? div(100 * (v - a[i - k]), a[i - k]) : NaN));

/** Rolling sum by direct summation (exact; NaN if any value in the window is NaN). */
export function sum(a: number[], length: number): number[] {
  return a.map((_, i) => {
    if (i < length - 1) return NaN;
    let s = 0;
    for (let j = i - length + 1; j <= i; j++) s += a[j];
    return s;
  });
}

/** Stochastic %K (0-100) of `value` against the rolling range of `hi`/`lo`; 50 when the range is flat. */
export function stochK(value: number[], hi: number[], lo: number[], length: number): number[] {
  const hh = highest(hi, length);
  const ll = lowest(lo, length);
  return value.map((v, i) => (Number.isNaN(hh[i]) || Number.isNaN(ll[i]) || Number.isNaN(v) ? NaN : hh[i] === ll[i] ? 50 : (100 * (v - ll[i])) / (hh[i] - ll[i])));
}

/** Moving average by name (for indicators with a choice). */
export function ma(kind: 'sma' | 'ema' | 'rma' | 'wma', a: number[], length: number): number[] {
  if (kind === 'ema') return ema(a, length);
  if (kind === 'rma') return rma(a, length);
  if (kind === 'wma') return wma(a, length);
  return sma(a, length);
}

/** Index of the first non-NaN value (the length when there is none); recursive filters start there. */
export function firstValid(a: number[]): number {
  const i = a.findIndex((v) => !Number.isNaN(v));
  return i === -1 ? a.length : i;
}

/** Ehlers' 2-pole Super Smoother (Cycle Analytics for Traders, 2013). Starts as the input for 2 bars. */
export function superSmoother(a: number[], period: number): number[] {
  const out = NaNs(a.length);
  const s = firstValid(a);
  const a1 = Math.exp((-1.414 * Math.PI) / period);
  const b1 = 2 * a1 * Math.cos((1.414 * Math.PI) / period);
  const c2 = b1;
  const c3 = -a1 * a1;
  const c1 = 1 - c2 - c3;
  for (let i = s; i < a.length; i++) {
    if (i < s + 2) out[i] = a[i];
    else out[i] = (c1 * (a[i] + a[i - 1])) / 2 + c2 * out[i - 1] + c3 * out[i - 2];
  }
  return out;
}

/** Ehlers' 2-pole high-pass filter (Cycle Analytics), cut-off `period` bars. Zero for the first 2 bars. */
export function highPass2(a: number[], period: number): number[] {
  const out = NaNs(a.length);
  const s = firstValid(a);
  const w = (0.707 * 2 * Math.PI) / period;
  const alpha = (Math.cos(w) + Math.sin(w) - 1) / Math.cos(w);
  for (let i = s; i < a.length; i++) {
    if (i < s + 2) out[i] = 0;
    else
      out[i] =
        (1 - alpha / 2) * (1 - alpha / 2) * (a[i] - 2 * a[i - 1] + a[i - 2]) + 2 * (1 - alpha) * out[i - 1] - (1 - alpha) * (1 - alpha) * out[i - 2];
  }
  return out;
}

/** Ehlers' 1-pole high-pass filter, cut-off `period` bars. Zero on the first bar. */
export function highPass1(a: number[], period: number): number[] {
  const out = NaNs(a.length);
  const s = firstValid(a);
  const w = (2 * Math.PI) / period;
  const alpha = (Math.cos(w) + Math.sin(w) - 1) / Math.cos(w);
  for (let i = s; i < a.length; i++) {
    if (i < s + 1) out[i] = 0;
    else out[i] = (1 - alpha / 2) * (a[i] - a[i - 1]) + (1 - alpha) * out[i - 1];
  }
  return out;
}

/** Ehlers' Roofing filter: 2-pole high-pass then Super Smoother. */
export const roofing = (a: number[], hp: number, lp: number) => superSmoother(highPass2(a, hp), lp);

/** Pearson correlation of each rolling window of `a` with `b` (same length arrays). */
export function correlation(a: number[], b: number[], length: number): number[] {
  return a.map((_, i) => {
    if (i < length - 1) return NaN;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const x = a[j];
      const y = b[j];
      if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    const vx = length * sxx - sx * sx;
    const vy = length * syy - sy * sy;
    return vx > 0 && vy > 0 ? (length * sxy - sx * sy) / Math.sqrt(vx * vy) : 0;
  });
}

/** Clamp into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** EMA with a custom smoothing factor, seeded with the SMA of the first `length` values (DecisionPoint PMO). */
export function emaAlpha(a: number[], length: number, alpha: number): number[] {
  const out = NaNs(a.length);
  const s = firstValid(a);
  if (a.length - s < length) return out;
  let prev = 0;
  for (let i = s; i < s + length; i++) prev += a[i];
  prev /= length;
  out[s + length - 1] = prev;
  for (let i = s + length; i < a.length; i++) {
    prev = alpha * a[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Least-squares slope per bar over the last `length` values. */
export function slope(a: number[], length: number): number[] {
  return a.map((_, i) => {
    if (i < length - 1 || length < 2) return NaN;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let j = 0; j < length; j++) {
      const y = a[i - length + 1 + j];
      sx += j; sy += y; sxy += j * y; sxx += j * j;
    }
    return (length * sxy - sx * sy) / (length * sxx - sx * sx);
  });
}

/** Inverse Fisher transform: squeezes any value into -1..+1. */
export const ift = (x: number) => (Number.isNaN(x) ? NaN : Math.tanh(x));

/** Line plot. */
export const line = (key: string, title: string, color: string, lineWidth: 1 | 2 = 2): PlotDef => ({ key, title, type: 'line', color, lineWidth });
/** Histogram coloured by sign (or by whether it rose). */
export const hist = (key: string, title: string, colorBy: 'sign' | 'change' = 'sign'): PlotDef => ({ key, title, type: 'histogram', color: C.up, colorBy, negativeColor: C.down });
