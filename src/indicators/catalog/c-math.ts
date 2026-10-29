/**
 * Shared helpers for the trend / volatility / statistics family (c-trend.ts, c-volatility.ts, c-stats.ts).
 * Every function returns an array aligned with its input, NaN where there isn't enough data yet; a window that
 * contains a NaN gives NaN, and anything that would be infinite (a division by zero on flat prices) becomes NaN.
 */
import type { Bar } from '../../types';
import type { IndicatorGuide } from '../info';
import type { IndicatorDef, IndicatorInput, IndicatorParams, PriceSource } from '../types';

export interface Entry {
  def: IndicatorDef;
  guide: IndicatorGuide;
}

export const NaNs = (n: number) => new Array<number>(n).fill(NaN);
export const num = (p: IndicatorParams, key: string) => Number(p[key]);
/** Keeps finite numbers; Infinity and NaN become NaN. */
export const fin = (v: number) => (Number.isFinite(v) ? v : NaN);

export function source(bars: Bar[], s: PriceSource): number[] {
  switch (s) {
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

export const input = (key: string, label: string, def: number, min = 1, max = 1000, step = 1): IndicatorInput => ({ key, label, type: 'number', default: def, min, max, step });
export const length = (def: number, min = 1, label = 'Length'): IndicatorInput => input('length', label, def, min, 1000, 1);
export const sourceInput: IndicatorInput = { key: 'source', label: 'Source', type: 'source', default: 'close' };
/** Bars per year used to annualise (252 trading days on daily bars). */
export const annualInput: IndicatorInput = input('annual', 'Bars per year', 252, 1, 100000, 1);

/** Palette (same hues as the original library and the theme's viz colours). */
export const C = {
  blue: '#2962ff',
  orange: '#ff9800',
  up: '#26a69a',
  down: '#ef5350',
  purple: '#7e57c2',
  aqua: '#26c6da',
  pink: '#e91e63',
  sky: '#42a5f5',
  amber: '#ffb300',
  violet: '#ab47bc',
  grey: '#787b86',
  indigo: '#5c6bc0',
};

/** Applies `fn` to every full window of `n` values (oldest first); NaN when the window holds a NaN. */
export function rolling(values: number[], n: number, fn: (w: number[], i: number) => number): number[] {
  const out = NaNs(values.length);
  n = Math.max(1, Math.floor(n));
  let lastNaN = -1;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) lastNaN = i;
    if (i < n - 1 || lastNaN > i - n) continue;
    out[i] = fin(fn(values.slice(i - n + 1, i + 1), i));
  }
  return out;
}

export const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);
export const mean = (w: number[]) => sum(w) / w.length;
/** Population (divide by n) or sample (n - 1) variance. */
export function variance(w: number[], sample = false): number {
  const m = mean(w);
  let s = 0;
  for (const v of w) s += (v - m) ** 2;
  return s / (w.length - (sample ? 1 : 0));
}
export const rollingSum = (values: number[], n: number) => rolling(values, n, sum);

/** values[i] - values[i - k]. */
export const change = (values: number[], k = 1) => values.map((v, i) => (i >= k ? v - values[i - k] : NaN));
/** values[i - k]. */
export const shift = (values: number[], k: number) => values.map((_, i) => (i >= k ? values[i - k] : NaN));
export const simpleReturns = (c: number[]) => c.map((v, i) => (i && c[i - 1] > 0 ? v / c[i - 1] - 1 : NaN));
export const logReturns = (c: number[]) => c.map((v, i) => (i && c[i - 1] > 0 && v > 0 ? Math.log(v / c[i - 1]) : NaN));

/** Least-squares line through w against x = 0..n-1 (oldest bar = 0). */
export function lineFit(w: number[]) {
  const n = w.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let j = 0; j < n; j++) {
    sx += j;
    sy += w[j];
    sxy += j * w[j];
    sxx += j * j;
    syy += w[j] * w[j];
  }
  const dx = n * sxx - sx * sx;
  const dy = n * syy - sy * sy;
  const slope = dx ? (n * sxy - sx * sy) / dx : NaN;
  const intercept = (sy - slope * sx) / n;
  const r = (n * sxy - sx * sy) / Math.sqrt(dx * dy);
  let ss = 0;
  for (let j = 0; j < n; j++) ss += (w[j] - (intercept + slope * j)) ** 2;
  return { slope, intercept, end: intercept + slope * (n - 1), r, r2: r * r, se: n > 2 ? Math.sqrt(ss / (n - 2)) : NaN };
}

/** Linear-interpolated quantile of sorted values (numpy's default method), q in 0..1. */
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const sorted = (w: number[]) => [...w].sort((a, b) => a - b);
export const median = (w: number[]) => quantile(sorted(w), 0.5);

/** % of the previous `n` values that are <= the current one (Pine's ta.percentrank). */
export function percentRank(values: number[], n: number): number[] {
  return values.map((v, i) => {
    if (i < n || Number.isNaN(v)) return NaN;
    let count = 0;
    for (let j = i - n; j < i; j++) {
      if (Number.isNaN(values[j])) return NaN;
      if (values[j] <= v) count++;
    }
    return (100 * count) / n;
  });
}

/** Pearson correlation of two equal-length arrays. */
export function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let j = 0; j < a.length; j++) {
    sab += (a[j] - ma) * (b[j] - mb);
    saa += (a[j] - ma) ** 2;
    sbb += (b[j] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

/** Least-squares slope of y against x. */
export function slopeOf(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let j = 0; j < x.length; j++) {
    sxy += (x[j] - mx) * (y[j] - my);
    sxx += (x[j] - mx) ** 2;
  }
  return sxy / sxx;
}

/** Rolling function of two aligned series (NaN when either window holds a NaN). */
export function rolling2(a: number[], b: number[], n: number, fn: (wa: number[], wb: number[]) => number): number[] {
  return a.map((_, i) => {
    if (i < n - 1) return NaN;
    const wa = a.slice(i - n + 1, i + 1);
    const wb = b.slice(i - n + 1, i + 1);
    if (wa.some(Number.isNaN) || wb.some(Number.isNaN)) return NaN;
    return fin(fn(wa, wb));
  });
}
