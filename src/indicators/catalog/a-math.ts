/**
 * Shared maths for the overlay family (moving averages, bands, trend stops, levels). Every function returns an
 * array as long as its input with NaN where there isn't enough data yet. Formulas are referenced next to each one.
 */
import type { Bar } from '../../types';
import { ema, rma, sma, trueRange } from '../math';
import type { IndicatorInput, IndicatorParams, NumberInput, PriceSource } from '../types';

export const NaNs = (n: number) => new Array<number>(Math.max(0, n)).fill(NaN);
export const isNum = (v: number) => typeof v === 'number' && Number.isFinite(v);

// ---------- params and inputs ----------

/** A whole-number parameter, never below `min` (a typed 0 or a fraction can't break a loop). */
export function intParam(p: IndicatorParams, key: string, fallback: number, min = 1): number {
  const v = Number(p[key]);
  return Math.max(min, Math.round(Number.isFinite(v) ? v : fallback));
}

export function numParam(p: IndicatorParams, key: string, fallback: number): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : fallback;
}

export const lengthIn = (def: number, label = 'Length', key = 'length', min = 1, max = 1000): NumberInput => ({ key, label, type: 'number', default: def, min, max, step: 1 });
export const numIn = (key: string, label: string, def: number, step: number, min: number, max: number): IndicatorInput => ({ key, label, type: 'number', default: def, min, max, step });
export const sourceIn: IndicatorInput = { key: 'source', label: 'Source', type: 'source', default: 'close' };
/** Period used by pivots and anchored levels: 1 = day, 2 = week, 3 = month (4 = quarter, 5 = year where offered). */
export const anchorIn = (def = 1, max = 3): IndicatorInput => ({
  key: 'anchor',
  label: max >= 5 ? 'Period (1 day, 2 week, 3 month, 4 quarter, 5 year)' : 'Period (1 day, 2 week, 3 month)',
  type: 'number',
  default: def,
  min: 1,
  max,
  step: 1,
});

// ---------- prices ----------

export function priceOf(bars: Bar[], src: PriceSource | string | undefined): number[] {
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
export const srcOf = (bars: Bar[], p: IndicatorParams) => priceOf(bars, p.source as PriceSource);
export const highsOf = (bars: Bar[]) => bars.map((b) => b.high);
export const lowsOf = (bars: Bar[]) => bars.map((b) => b.low);
export const closesOf = (bars: Bar[]) => bars.map((b) => b.close);

// ---------- averages and windows ----------

/** Wilder's Average True Range as TA-Lib computes it: the first bar has no previous close, so it starts on bar 1. */
export function atrOf(bars: Bar[], length: number): number[] {
  const tr = trueRange(highsOf(bars), lowsOf(bars), closesOf(bars)).map((v, i) => (i === 0 ? NaN : v));
  return rma(tr, length);
}

/** Shifts a series right by `n` bars (positive = later; the last `n` values have no bar to land on). */
export function shiftBy(values: number[], n: number): number[] {
  return values.map((_, i) => (i - n >= 0 && i - n < values.length ? values[i - n] : NaN));
}

/** Rolling window helper: calls `fn` with the window's start index once the window is full of numbers. */
export function rolling(values: number[], length: number, fn: (start: number, end: number) => number): number[] {
  const out = NaNs(values.length);
  let lastNaN = -1;
  for (let i = 0; i < values.length; i++) {
    if (!isNum(values[i])) lastNaN = i;
    const start = i - length + 1;
    if (start >= 0 && lastNaN < start) out[i] = fn(start, i);
  }
  return out;
}

/** Weighted moving average with any weights; weights[0] applies to the oldest bar of the window. */
export function weightedMa(values: number[], weights: number[]): number[] {
  const n = weights.length;
  const norm = weights.reduce((a, b) => a + b, 0);
  return rolling(values, n, (start) => {
    let s = 0;
    for (let j = 0; j < n; j++) s += weights[j] * values[start + j];
    return s / norm;
  });
}

/** Percentile of a sorted array with linear interpolation (numpy's default method). */
export function percentileSorted(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function rollingPercentile(values: number[], length: number, q: number): number[] {
  return rolling(values, length, (start, end) => percentileSorted(values.slice(start, end + 1).sort((a, b) => a - b), q));
}

/**
 * Least-squares line through each window of `length` values, x = 0 (oldest) .. length-1 (newest).
 * `end` is the fitted value on the newest bar (TA-Lib LINEARREG), `slope` per bar, and `rmse` the population
 * standard deviation of the residuals.
 */
export function regression(values: number[], length: number): { end: number[]; slope: number[]; intercept: number[] } {
  const n = values.length;
  const end = NaNs(n);
  const slope = NaNs(n);
  const intercept = NaNs(n);
  const sx = (length * (length - 1)) / 2;
  const sxx = ((length - 1) * length * (2 * length - 1)) / 6;
  const div = length * sxx - sx * sx;
  rolling(values, length, (start, i) => {
    let sy = 0;
    let sxy = 0;
    for (let j = 0; j < length; j++) {
      sy += values[start + j];
      sxy += j * values[start + j];
    }
    const m = div === 0 ? 0 : (length * sxy - sx * sy) / div;
    const b = (sy - m * sx) / length;
    slope[i] = m;
    intercept[i] = b;
    end[i] = b + m * (length - 1);
    return 0;
  });
  return { end, slope, intercept };
}

/** Runs a recursive filter from the first valid value; `step` gets the index into the valid part. */
export function fromFirstValid(values: number[], fn: (valid: number[]) => number[]): number[] {
  const start = values.findIndex(isNum);
  if (start === -1) return NaNs(values.length);
  const tail = values.slice(start).map((v) => (isNum(v) ? v : NaN));
  return [...NaNs(start), ...fn(tail)];
}

/** EMA of an EMA ... `times` deep (used by T3, GMMA-like ribbons). */
export function emaChain(values: number[], length: number, times: number): number[][] {
  const out: number[][] = [];
  let cur = values;
  for (let k = 0; k < times; k++) out.push((cur = ema(cur, length)));
  return out;
}

export { ema, rma, sma };

// ---------- time anchors ----------

const nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });
const hourMemo = new Map<number, { y: number; m: number; d: number; h: number }>();

/** New York calendar date and hour of a UTC time (memoised per UTC hour: New York offsets are whole hours). */
export function nyDate(time: number): { y: number; m: number; d: number; h: number; minute: number } {
  const hourKey = Math.floor(time / 3600);
  let hit = hourMemo.get(hourKey);
  if (!hit) {
    const parts = Object.fromEntries(nyParts.formatToParts(new Date(hourKey * 3600 * 1000)).map((x) => [x.type, x.value]));
    hit = { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24 };
    if (hourMemo.size > 200000) hourMemo.clear();
    hourMemo.set(hourKey, hit);
  }
  return { ...hit, minute: Math.floor((time % 3600) / 60) };
}

/** Typical spacing between bars in seconds (the median gap), 0 for fewer than two bars. */
export function barSpacing(bars: Bar[]): number {
  if (bars.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = Math.max(1, bars.length - 200); i < bars.length; i++) gaps.push(bars[i].time - bars[i - 1].time);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * The period a bar belongs to (1 day, 2 week, 3 month, 4 quarter, 5 year). Intraday bars use the New York date
 * (the US session); daily and longer bars carry their date in UTC (exchanges stamp them at midnight UTC).
 */
export function periodKeys(bars: Bar[], anchor: number): number[] {
  const intraday = barSpacing(bars) > 0 && barSpacing(bars) < 86400;
  return bars.map((b) => {
    let y: number;
    let m: number;
    let d: number;
    if (intraday) ({ y, m, d } = nyDate(b.time));
    else {
      const dt = new Date(b.time * 1000);
      y = dt.getUTCFullYear();
      m = dt.getUTCMonth() + 1;
      d = dt.getUTCDate();
    }
    const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    switch (anchor) {
      case 2:
        return Math.floor((dayNumber + 3) / 7); // weeks start on Monday (1970-01-01 was a Thursday)
      case 3:
        return y * 12 + m;
      case 4:
        return y * 4 + Math.floor((m - 1) / 3);
      case 5:
        return y;
      default:
        return dayNumber;
    }
  });
}

/** Open, high, low and close of each bar's previous completed period (NaN until one has finished). */
export function previousPeriod(bars: Bar[], anchor: number): { o: number[]; h: number[]; l: number[]; c: number[]; curOpen: number[]; first: boolean[] } {
  const keys = periodKeys(bars, anchor);
  const n = bars.length;
  const o = NaNs(n);
  const h = NaNs(n);
  const l = NaNs(n);
  const c = NaNs(n);
  const curOpen = NaNs(n);
  const first = new Array<boolean>(n).fill(false);
  type Agg = { o: number; h: number; l: number; c: number };
  let cur: Agg | null = null as Agg | null;
  let prev: Agg | null = null as Agg | null;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (i === 0 || keys[i] !== keys[i - 1]) {
      if (cur) prev = cur;
      cur = { o: b.open, h: b.high, l: b.low, c: b.close };
      first[i] = true;
    } else if (cur) {
      cur.h = Math.max(cur.h, b.high);
      cur.l = Math.min(cur.l, b.low);
      cur.c = b.close;
    }
    curOpen[i] = cur!.o;
    if (prev) {
      o[i] = prev.o;
      h[i] = prev.h;
      l[i] = prev.l;
      c[i] = prev.c;
    }
  }
  return { o, h, l, c, curOpen, first };
}

/**
 * Breaks step lines where a new period starts (so a level doesn't draw a vertical jump), but only when the period
 * holds more than one bar; a chart where every bar is its own period keeps every value.
 */
export function gapAtStarts(series: Record<string, number[]>, first: boolean[]): Record<string, number[]> {
  for (const values of Object.values(series)) {
    for (let i = 1; i < values.length - 1; i++) if (first[i] && !first[i + 1]) values[i] = NaN;
  }
  return series;
}

// ---------- Ehlers' Hilbert transform (TA-Lib's MAMA / HT_TRENDLINE core) ----------

/**
 * Port of TA-Lib's Hilbert transform loop (ta_MAMA.c / ta_HT_TRENDLINE.c). It walks the series from bar 0 like
 * TA-Lib does (the odd/even bar split depends on the absolute index), warming the 4-bar WMA over `warm` bars, and
 * calls `onBar` for every bar after the warm-up with the phase (degrees), the period and the smoothed period.
 */
export function hilbertLoop(x: number[], warm: number, onBar: (today: number, phase: number, period: number, smoothPeriod: number) => void) {
  const a = 0.0962;
  const b = 0.5769;
  const rad2Deg = 180 / Math.PI;
  if (x.length < warm + 4) return;
  let today = 0;
  let trailingWMAIdx = 0;
  let periodWMASub = x[today];
  let periodWMASum = x[today++];
  periodWMASub += x[today];
  periodWMASum += x[today++] * 2;
  periodWMASub += x[today];
  periodWMASum += x[today++] * 3;
  let trailingWMAValue = 0;
  let smoothed = 0;
  for (let i = warm; i > 0; i--) {
    const v = x[today++];
    periodWMASub += v;
    periodWMASub -= trailingWMAValue;
    periodWMASum += v * 4;
    trailingWMAValue = x[trailingWMAIdx++];
    smoothed = periodWMASum * 0.1;
    periodWMASum -= periodWMASub;
  }
  // One Hilbert stage per signal (detrender, Q1, jI, jQ), each with an odd and an even copy, as in TA-Lib.
  const stage = () => ({ odd: [0, 0, 0], even: [0, 0, 0], prevOdd: 0, prevEven: 0, prevInOdd: 0, prevInEven: 0 });
  const st = { det: stage(), q1: stage(), ji: stage(), jq: stage() };
  let hilbertIdx = 0;
  const transform = (s: ReturnType<typeof stage>, input: number, even: boolean, adj: number) => {
    const t = a * input;
    let out: number;
    if (even) {
      out = -s.even[hilbertIdx];
      s.even[hilbertIdx] = t;
      out += t;
      out -= s.prevEven;
      s.prevEven = b * s.prevInEven;
      out += s.prevEven;
      s.prevInEven = input;
    } else {
      out = -s.odd[hilbertIdx];
      s.odd[hilbertIdx] = t;
      out += t;
      out -= s.prevOdd;
      s.prevOdd = b * s.prevInOdd;
      out += s.prevOdd;
      s.prevInOdd = input;
    }
    return out * adj;
  };
  let period = 0;
  let prevQ2 = 0;
  let prevI2 = 0;
  let re = 0;
  let im = 0;
  let i1EvenPrev3 = 0;
  let i1OddPrev3 = 0;
  let i1EvenPrev2 = 0;
  let i1OddPrev2 = 0;
  let smoothPeriod = 0;
  void smoothed;
  while (today < x.length) {
    const adj = 0.075 * period + 0.54;
    const v = x[today];
    periodWMASub += v;
    periodWMASub -= trailingWMAValue;
    periodWMASum += v * 4;
    trailingWMAValue = x[trailingWMAIdx++];
    smoothed = periodWMASum * 0.1;
    periodWMASum -= periodWMASub;
    const even = today % 2 === 0;
    const detrender = transform(st.det, smoothed, even, adj);
    const q1 = transform(st.q1, detrender, even, adj);
    const i1 = even ? i1EvenPrev3 : i1OddPrev3;
    const ji = transform(st.ji, i1, even, adj);
    const jq = transform(st.jq, q1, even, adj);
    if (even && ++hilbertIdx === 3) hilbertIdx = 0;
    const q2 = 0.2 * (q1 + ji) + 0.8 * prevQ2;
    const i2 = 0.2 * (i1 - jq) + 0.8 * prevI2;
    if (even) {
      i1OddPrev3 = i1OddPrev2;
      i1OddPrev2 = detrender;
    } else {
      i1EvenPrev3 = i1EvenPrev2;
      i1EvenPrev2 = detrender;
    }
    const phase = i1 !== 0 ? Math.atan(q1 / i1) * rad2Deg : 0;
    re = 0.8 * re + 0.2 * (i2 * prevI2 + q2 * prevQ2);
    im = 0.8 * im + 0.2 * (i2 * prevQ2 - q2 * prevI2);
    prevQ2 = q2;
    prevI2 = i2;
    const last = period;
    if (im !== 0 && re !== 0) period = 360 / (Math.atan(im / re) * rad2Deg);
    if (period > 1.5 * last) period = 1.5 * last;
    if (period < 0.67 * last) period = 0.67 * last;
    if (period < 6) period = 6;
    else if (period > 50) period = 50;
    period = 0.2 * period + 0.8 * last;
    smoothPeriod = 0.67 * smoothPeriod + 0.33 * period;
    onBar(today, phase, period, smoothPeriod);
    today++;
  }
}
