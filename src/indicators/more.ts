/**
 * The extended indicator library. Formulas follow TradingView's built-in versions so values
 * line up with what you see there.
 */
import type { Bar } from '../types';
import { ema, highest, lowest, rma, rsi, sma, stdev, trueRange, wma } from './math';
import type { IndicatorDef, IndicatorInput, IndicatorParams, PriceSource } from './types';

const NaNs = (n: number) => new Array<number>(n).fill(NaN);
const num = (p: IndicatorParams, key: string) => Number(p[key]);

function source(bars: Bar[], src: PriceSource): number[] {
  const pick: Record<PriceSource, (b: Bar) => number> = {
    close: (b) => b.close,
    open: (b) => b.open,
    high: (b) => b.high,
    low: (b) => b.low,
    hl2: (b) => (b.high + b.low) / 2,
    hlc3: (b) => (b.high + b.low + b.close) / 3,
    ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
  };
  return bars.map(pick[src] ?? pick.close);
}
const src = (bars: Bar[], p: IndicatorParams) => source(bars, (p.source as PriceSource) ?? 'close');
const highs = (bars: Bar[]) => bars.map((b) => b.high);
const lows = (bars: Bar[]) => bars.map((b) => b.low);
const closes = (bars: Bar[]) => bars.map((b) => b.close);

/** Rolling sum over `length` values. */
export function rollingSum(values: number[], length: number): number[] {
  const out = NaNs(values.length);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) {
      sum = 0;
      valid = 0;
      continue;
    }
    sum += v;
    valid++;
    if (valid > length) sum -= values[i - length];
    if (valid >= length) out[i] = sum;
  }
  return out;
}

/** Shifts a series right by `n` bars (positive) or left (negative). */
export function shift(values: number[], n: number): number[] {
  return values.map((_, i) => (i - n >= 0 && i - n < values.length ? values[i - n] : NaN));
}

export function hma(values: number[], length: number): number[] {
  const half = wma(values, Math.max(1, Math.floor(length / 2)));
  const full = wma(values, length);
  return wma(half.map((h, i) => 2 * h - full[i]), Math.max(1, Math.round(Math.sqrt(length))));
}

export function linreg(values: number[], length: number): number[] {
  return values.map((_, i) => {
    if (i < length - 1) return NaN;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (let j = 0; j < length; j++) {
      const y = values[i - length + 1 + j];
      sx += j;
      sy += y;
      sxy += j * y;
      sxx += j * j;
    }
    const slope = (length * sxy - sx * sy) / (length * sxx - sx * sx || 1);
    const intercept = (sy - slope * sx) / length;
    return intercept + slope * (length - 1);
  });
}

const length = (def: number, label = 'Length'): IndicatorInput => ({ key: 'length', label, type: 'number', default: def, min: 1, max: 1000, step: 1 });
const numberInput = (key: string, label: string, def: number, step = 1, min = 0, max = 1000): IndicatorInput => ({ key, label, type: 'number', default: def, min, max, step });
const sourceInput: IndicatorInput = { key: 'source', label: 'Source', type: 'source', default: 'close' };
const UP = '#26a69a';
const DOWN = '#ef5350';

export const MORE_INDICATORS: IndicatorDef[] = [
  // ---------- Moving averages ----------
  {
    id: 'hma',
    name: 'Hull Moving Average',
    shortName: 'HMA',
    category: 'Moving Averages',
    description: 'A fast, smooth moving average with very little lag.',
    placement: 'overlay',
    inputs: [length(9), sourceInput],
    plots: [{ key: 'ma', title: 'HMA', type: 'line', color: '#00bcd4', lineWidth: 2 }],
    compute: (bars, p) => ({ ma: hma(src(bars, p), num(p, 'length')) }),
  },
  {
    id: 'dema',
    name: 'Double EMA',
    shortName: 'DEMA',
    category: 'Moving Averages',
    description: 'EMA with reduced lag: 2 × EMA − EMA of EMA.',
    placement: 'overlay',
    inputs: [length(21), sourceInput],
    plots: [{ key: 'ma', title: 'DEMA', type: 'line', color: '#43a047', lineWidth: 2 }],
    compute: (bars, p) => {
      const e1 = ema(src(bars, p), num(p, 'length'));
      const e2 = ema(e1, num(p, 'length'));
      return { ma: e1.map((v, i) => 2 * v - e2[i]) };
    },
  },
  {
    id: 'tema',
    name: 'Triple EMA',
    shortName: 'TEMA',
    category: 'Moving Averages',
    description: 'EMA with even less lag than DEMA.',
    placement: 'overlay',
    inputs: [length(21), sourceInput],
    plots: [{ key: 'ma', title: 'TEMA', type: 'line', color: '#8e24aa', lineWidth: 2 }],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const e1 = ema(src(bars, p), n);
      const e2 = ema(e1, n);
      const e3 = ema(e2, n);
      return { ma: e1.map((v, i) => 3 * (v - e2[i]) + e3[i]) };
    },
  },
  {
    id: 'vwma',
    name: 'Volume-Weighted MA',
    shortName: 'VWMA',
    category: 'Moving Averages',
    description: 'Moving average where high-volume bars count more.',
    placement: 'overlay',
    inputs: [length(20), sourceInput],
    plots: [{ key: 'ma', title: 'VWMA', type: 'line', color: '#f06292', lineWidth: 2 }],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const s = src(bars, p);
      const pv = sma(s.map((v, i) => v * bars[i].volume), n);
      const v = sma(bars.map((b) => b.volume), n);
      return { ma: pv.map((x, i) => (v[i] ? x / v[i] : NaN)) };
    },
  },
  {
    id: 'alma',
    name: 'Arnaud Legoux MA',
    shortName: 'ALMA',
    category: 'Moving Averages',
    description: 'Smooth moving average using a Gaussian weighting.',
    placement: 'overlay',
    inputs: [length(9), numberInput('offset', 'Offset', 0.85, 0.01, 0, 1), numberInput('sigma', 'Sigma', 6, 0.5, 0.5, 50), sourceInput],
    plots: [{ key: 'ma', title: 'ALMA', type: 'line', color: '#ffb300', lineWidth: 2 }],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const s = src(bars, p);
      const m = num(p, 'offset') * (n - 1);
      const sig = n / num(p, 'sigma');
      const weights = Array.from({ length: n }, (_, i) => Math.exp(-((i - m) ** 2) / (2 * sig * sig)));
      const norm = weights.reduce((a, b) => a + b, 0);
      return { ma: s.map((_, i) => (i < n - 1 ? NaN : weights.reduce((acc, w, j) => acc + w * s[i - n + 1 + j], 0) / norm)) };
    },
  },
  {
    id: 'kama',
    name: 'Kaufman Adaptive MA',
    shortName: 'KAMA',
    category: 'Moving Averages',
    description: 'Moves fast in trends and slows down in choppy markets.',
    placement: 'overlay',
    inputs: [length(10), numberInput('fast', 'Fast', 2, 1, 1, 100), numberInput('slow', 'Slow', 30, 1, 1, 500), sourceInput],
    plots: [{ key: 'ma', title: 'KAMA', type: 'line', color: '#26c6da', lineWidth: 2 }],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const s = src(bars, p);
      const fastSc = 2 / (num(p, 'fast') + 1);
      const slowSc = 2 / (num(p, 'slow') + 1);
      const out = NaNs(s.length);
      let prev = NaN;
      for (let i = n; i < s.length; i++) {
        let noise = 0;
        for (let j = i - n + 1; j <= i; j++) noise += Math.abs(s[j] - s[j - 1]);
        const er = noise ? Math.abs(s[i] - s[i - n]) / noise : 0;
        const sc = (er * (fastSc - slowSc) + slowSc) ** 2;
        prev = Number.isNaN(prev) ? s[i] : prev + sc * (s[i] - prev);
        out[i] = prev;
      }
      return { ma: out };
    },
  },
  {
    id: 'linreg',
    name: 'Linear Regression',
    shortName: 'LinReg',
    category: 'Moving Averages',
    description: 'End point of a best-fit straight line through the last N bars.',
    placement: 'overlay',
    inputs: [length(50), sourceInput],
    plots: [{ key: 'line', title: 'LinReg', type: 'line', color: '#ff7043', lineWidth: 2 }],
    compute: (bars, p) => ({ line: linreg(src(bars, p), num(p, 'length')) }),
  },

  // ---------- Bands & channels ----------
  {
    id: 'keltner',
    name: 'Keltner Channels',
    shortName: 'KC',
    category: 'Bands & Channels',
    description: 'EMA with bands a multiple of ATR above and below.',
    placement: 'overlay',
    inputs: [length(20), numberInput('mult', 'Multiplier', 2, 0.1, 0.1, 10), numberInput('atr', 'ATR length', 10, 1, 1, 500), sourceInput],
    plots: [
      { key: 'upper', title: 'Upper', type: 'line', color: '#2962ff', lineWidth: 1 },
      { key: 'basis', title: 'Basis', type: 'line', color: '#787b86', lineWidth: 1 },
      { key: 'lower', title: 'Lower', type: 'line', color: '#2962ff', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const basis = ema(src(bars, p), num(p, 'length'));
      const atr = rma(trueRange(highs(bars), lows(bars), closes(bars)), num(p, 'atr'));
      const m = num(p, 'mult');
      return { basis, upper: basis.map((b, i) => b + m * atr[i]), lower: basis.map((b, i) => b - m * atr[i]) };
    },
  },
  {
    id: 'envelope',
    name: 'Moving Average Envelope',
    shortName: 'Env',
    category: 'Bands & Channels',
    description: 'Moving average with bands a fixed percentage above and below.',
    placement: 'overlay',
    inputs: [length(20), numberInput('percent', 'Percent', 2.5, 0.1, 0.1, 50), sourceInput],
    plots: [
      { key: 'upper', title: 'Upper', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'basis', title: 'Basis', type: 'line', color: '#ff9800', lineWidth: 1 },
      { key: 'lower', title: 'Lower', type: 'line', color: '#26a69a', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const basis = sma(src(bars, p), num(p, 'length'));
      const k = num(p, 'percent') / 100;
      return { basis, upper: basis.map((b) => b * (1 + k)), lower: basis.map((b) => b * (1 - k)) };
    },
  },

  // ---------- Trend ----------
  {
    id: 'ichimoku',
    name: 'Ichimoku Cloud',
    shortName: 'Ichimoku',
    category: 'Trend',
    description: 'All-in-one trend system: conversion and base lines, leading spans (the cloud) and lagging span.',
    placement: 'overlay',
    inputs: [
      numberInput('conversion', 'Conversion line', 9, 1, 1, 500),
      numberInput('base', 'Base line', 26, 1, 1, 500),
      numberInput('spanB', 'Leading span B', 52, 1, 1, 500),
      numberInput('displacement', 'Displacement', 26, 1, 1, 500),
    ],
    plots: [
      { key: 'conversion', title: 'Conversion', type: 'line', color: '#2962ff', lineWidth: 1 },
      { key: 'base', title: 'Base', type: 'line', color: '#b71c1c', lineWidth: 1 },
      { key: 'lagging', title: 'Lagging', type: 'line', color: '#43a047', lineWidth: 1 },
      { key: 'spanA', title: 'Span A', type: 'line', color: '#26a69a', lineWidth: 1 },
      { key: 'spanB', title: 'Span B', type: 'line', color: '#ef5350', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const mid = (n: number) => {
        const hh = highest(highs(bars), n);
        const ll = lowest(lows(bars), n);
        return hh.map((h, i) => (h + ll[i]) / 2);
      };
      const conversion = mid(num(p, 'conversion'));
      const base = mid(num(p, 'base'));
      const d = num(p, 'displacement') - 1;
      return {
        conversion,
        base,
        spanA: shift(conversion.map((c, i) => (c + base[i]) / 2), d),
        spanB: shift(mid(num(p, 'spanB')), d),
        lagging: shift(closes(bars), -d),
      };
    },
  },
  {
    id: 'supertrend',
    name: 'SuperTrend',
    shortName: 'ST',
    category: 'Trend',
    description: 'Trend-following line based on ATR: green below price in uptrends, red above price in downtrends.',
    placement: 'overlay',
    inputs: [numberInput('atr', 'ATR length', 10, 1, 1, 500), numberInput('mult', 'Factor', 3, 0.1, 0.1, 20)],
    plots: [
      { key: 'up', title: 'Up trend', type: 'line', color: UP, lineWidth: 2 },
      { key: 'down', title: 'Down trend', type: 'line', color: DOWN, lineWidth: 2 },
    ],
    compute: (bars, p) => {
      const atr = rma(trueRange(highs(bars), lows(bars), closes(bars)), num(p, 'atr'));
      const m = num(p, 'mult');
      const up = NaNs(bars.length);
      const down = NaNs(bars.length);
      let lower = NaN;
      let upper = NaN;
      let dir = 1;
      for (let i = 0; i < bars.length; i++) {
        if (Number.isNaN(atr[i])) continue;
        const hl2 = (bars[i].high + bars[i].low) / 2;
        const prevClose = bars[i - 1]?.close ?? bars[i].close;
        let newLower = hl2 - m * atr[i];
        let newUpper = hl2 + m * atr[i];
        if (!Number.isNaN(lower) && (newLower < lower && prevClose > lower)) newLower = lower;
        if (!Number.isNaN(upper) && (newUpper > upper && prevClose < upper)) newUpper = upper;
        if (!Number.isNaN(upper)) {
          if (dir === -1 && bars[i].close > upper) dir = 1;
          else if (dir === 1 && bars[i].close < lower) dir = -1;
        }
        lower = newLower;
        upper = newUpper;
        if (dir === 1) up[i] = lower;
        else down[i] = upper;
      }
      return { up, down };
    },
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    shortName: 'SAR',
    category: 'Trend',
    description: 'Dots that trail price and flip sides when the trend reverses. Often used for trailing stops.',
    placement: 'overlay',
    inputs: [numberInput('start', 'Start', 0.02, 0.001, 0.001, 1), numberInput('increment', 'Increment', 0.02, 0.001, 0.001, 1), numberInput('max', 'Maximum', 0.2, 0.01, 0.01, 1)],
    plots: [{ key: 'sar', title: 'SAR', type: 'line', style: 'dots', color: '#2962ff', lineWidth: 2 }],
    compute: (bars, p) => {
      const out = NaNs(bars.length);
      if (bars.length < 2) return { sar: out };
      const start = num(p, 'start');
      const inc = num(p, 'increment');
      const max = num(p, 'max');
      let long = bars[1].close >= bars[0].close;
      let sar = long ? bars[0].low : bars[0].high;
      let ep = long ? bars[1].high : bars[1].low;
      let af = start;
      for (let i = 1; i < bars.length; i++) {
        const b = bars[i];
        sar = sar + af * (ep - sar);
        if (long) {
          sar = Math.min(sar, bars[i - 1].low, bars[i - 2]?.low ?? bars[i - 1].low);
          if (b.low < sar) {
            long = false;
            sar = ep;
            ep = b.low;
            af = start;
          } else if (b.high > ep) {
            ep = b.high;
            af = Math.min(max, af + inc);
          }
        } else {
          sar = Math.max(sar, bars[i - 1].high, bars[i - 2]?.high ?? bars[i - 1].high);
          if (b.high > sar) {
            long = true;
            sar = ep;
            ep = b.high;
            af = start;
          } else if (b.low < ep) {
            ep = b.low;
            af = Math.min(max, af + inc);
          }
        }
        out[i] = sar;
      }
      return { sar: out };
    },
  },
  {
    id: 'pivots',
    name: 'Pivot Points (Daily)',
    shortName: 'Pivots',
    category: 'Trend',
    description: "Classic support and resistance levels from the previous day's high, low and close.",
    placement: 'overlay',
    inputs: [],
    plots: [
      { key: 'r2', title: 'R2', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'r1', title: 'R1', type: 'line', color: '#ef9a9a', lineWidth: 1 },
      { key: 'p', title: 'P', type: 'line', color: '#ff9800', lineWidth: 1 },
      { key: 's1', title: 'S1', type: 'line', color: '#80cbc4', lineWidth: 1 },
      { key: 's2', title: 'S2', type: 'line', color: '#26a69a', lineWidth: 1 },
    ],
    compute: (bars) => {
      const out = { p: NaNs(bars.length), r1: NaNs(bars.length), r2: NaNs(bars.length), s1: NaNs(bars.length), s2: NaNs(bars.length) };
      let day = -1;
      let cur = { h: -Infinity, l: Infinity, c: NaN };
      let prev: typeof cur | null = null;
      bars.forEach((b, i) => {
        const d = Math.floor(b.time / 86400);
        if (d !== day) {
          if (day !== -1) prev = cur;
          day = d;
          cur = { h: -Infinity, l: Infinity, c: NaN };
        }
        cur.h = Math.max(cur.h, b.high);
        cur.l = Math.min(cur.l, b.low);
        cur.c = b.close;
        if (prev) {
          const pp = (prev.h + prev.l + prev.c) / 3;
          out.p[i] = pp;
          out.r1[i] = 2 * pp - prev.l;
          out.s1[i] = 2 * pp - prev.h;
          out.r2[i] = pp + (prev.h - prev.l);
          out.s2[i] = pp - (prev.h - prev.l);
        }
      });
      return out;
    },
  },
  {
    id: 'adx',
    name: 'ADX / DMI',
    shortName: 'ADX',
    category: 'Trend',
    description: 'Trend strength (ADX above 25 = strong trend) with +DI and −DI showing direction.',
    placement: 'separate',
    inputs: [length(14, 'DI length'), numberInput('smoothing', 'ADX smoothing', 14, 1, 1, 500)],
    plots: [
      { key: 'adx', title: 'ADX', type: 'line', color: '#ff9800', lineWidth: 2 },
      { key: 'plus', title: '+DI', type: 'line', color: UP, lineWidth: 1 },
      { key: 'minus', title: '−DI', type: 'line', color: DOWN, lineWidth: 1 },
    ],
    levels: [25],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const plusDm = bars.map((b, i) => {
        if (!i) return NaN;
        const up = b.high - bars[i - 1].high;
        const down = bars[i - 1].low - b.low;
        return up > down && up > 0 ? up : 0;
      });
      const minusDm = bars.map((b, i) => {
        if (!i) return NaN;
        const up = b.high - bars[i - 1].high;
        const down = bars[i - 1].low - b.low;
        return down > up && down > 0 ? down : 0;
      });
      const tr = rma(trueRange(highs(bars), lows(bars), closes(bars)).map((v, i) => (i ? v : NaN)), n);
      const plus = rma(plusDm, n).map((v, i) => (100 * v) / tr[i]);
      const minus = rma(minusDm, n).map((v, i) => (100 * v) / tr[i]);
      const dx = plus.map((v, i) => (v + minus[i] ? (100 * Math.abs(v - minus[i])) / (v + minus[i]) : 0));
      return { adx: rma(dx, num(p, 'smoothing')), plus, minus };
    },
  },
  {
    id: 'aroon',
    name: 'Aroon',
    shortName: 'Aroon',
    category: 'Trend',
    description: 'How recently the highest high and lowest low happened. Up near 100 = strong uptrend.',
    placement: 'separate',
    inputs: [length(14)],
    plots: [
      { key: 'up', title: 'Up', type: 'line', color: '#ff9800', lineWidth: 2 },
      { key: 'down', title: 'Down', type: 'line', color: '#2962ff', lineWidth: 2 },
    ],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const up = NaNs(bars.length);
      const down = NaNs(bars.length);
      for (let i = n; i < bars.length; i++) {
        let hi = i;
        let lo = i;
        for (let j = i - n; j <= i; j++) {
          if (bars[j].high >= bars[hi].high) hi = j;
          if (bars[j].low <= bars[lo].low) lo = j;
        }
        up[i] = (100 * (n - (i - hi))) / n;
        down[i] = (100 * (n - (i - lo))) / n;
      }
      return { up, down };
    },
  },

  // ---------- Momentum ----------
  {
    id: 'stochrsi',
    name: 'Stochastic RSI',
    shortName: 'StochRSI',
    category: 'Momentum',
    description: 'Stochastic applied to RSI: a faster, more sensitive overbought/oversold gauge.',
    placement: 'separate',
    inputs: [numberInput('k', 'K', 3, 1, 1, 100), numberInput('d', 'D', 3, 1, 1, 100), numberInput('rsi', 'RSI length', 14, 1, 1, 500), numberInput('stoch', 'Stochastic length', 14, 1, 1, 500), sourceInput],
    plots: [
      { key: 'k', title: 'K', type: 'line', color: '#2962ff', lineWidth: 2 },
      { key: 'd', title: 'D', type: 'line', color: '#ff6d00', lineWidth: 2 },
    ],
    levels: [80, 20],
    compute: (bars, p) => {
      const r = rsi(src(bars, p), num(p, 'rsi'));
      const n = num(p, 'stoch');
      const hh = highest(r, n);
      const ll = lowest(r, n);
      const raw = r.map((v, i) => (hh[i] === ll[i] ? 50 : (100 * (v - ll[i])) / (hh[i] - ll[i])));
      const k = sma(raw, num(p, 'k'));
      return { k, d: sma(k, num(p, 'd')) };
    },
  },
  {
    id: 'mfi',
    name: 'Money Flow Index',
    shortName: 'MFI',
    category: 'Volume',
    description: 'Volume-weighted RSI. Above 80 overbought, below 20 oversold.',
    placement: 'separate',
    inputs: [length(14)],
    plots: [{ key: 'mfi', title: 'MFI', type: 'line', color: '#7e57c2', lineWidth: 2 }],
    levels: [80, 20],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const tp = source(bars, 'hlc3');
      const pos = tp.map((v, i) => (i && v > tp[i - 1] ? v * bars[i].volume : i ? 0 : NaN));
      const neg = tp.map((v, i) => (i && v < tp[i - 1] ? v * bars[i].volume : i ? 0 : NaN));
      const ps = rollingSum(pos, n);
      const ns = rollingSum(neg, n);
      return { mfi: ps.map((v, i) => (ns[i] === 0 ? 100 : 100 - 100 / (1 + v / ns[i]))) };
    },
  },
  {
    id: 'roc',
    name: 'Rate of Change',
    shortName: 'ROC',
    category: 'Momentum',
    description: 'Percentage change compared with N bars ago.',
    placement: 'separate',
    inputs: [length(9), sourceInput],
    plots: [{ key: 'roc', title: 'ROC', type: 'line', color: '#2196f3', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const s = src(bars, p);
      const n = num(p, 'length');
      return { roc: s.map((v, i) => (i >= n ? (100 * (v - s[i - n])) / s[i - n] : NaN)) };
    },
  },
  {
    id: 'mom',
    name: 'Momentum',
    shortName: 'Mom',
    category: 'Momentum',
    description: 'Price now minus price N bars ago.',
    placement: 'separate',
    inputs: [length(10), sourceInput],
    plots: [{ key: 'mom', title: 'Momentum', type: 'line', color: '#26a69a', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const s = src(bars, p);
      const n = num(p, 'length');
      return { mom: s.map((v, i) => (i >= n ? v - s[i - n] : NaN)) };
    },
  },
  {
    id: 'trix',
    name: 'TRIX',
    shortName: 'TRIX',
    category: 'Momentum',
    description: 'Rate of change of a triple-smoothed EMA; filters out small moves.',
    placement: 'separate',
    inputs: [length(18)],
    plots: [{ key: 'trix', title: 'TRIX', type: 'line', color: '#e91e63', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const e = ema(ema(ema(closes(bars).map(Math.log), n), n), n);
      return { trix: e.map((v, i) => (i ? 10000 * (v - e[i - 1]) : NaN)) };
    },
  },
  {
    id: 'ao',
    name: 'Awesome Oscillator',
    shortName: 'AO',
    category: 'Momentum',
    description: '5-bar minus 34-bar average of the midpoint. Green bars = rising, red = falling.',
    placement: 'separate',
    inputs: [],
    plots: [{ key: 'ao', title: 'AO', type: 'histogram', color: UP, colorBy: 'change', negativeColor: DOWN }],
    compute: (bars) => {
      const mid = source(bars, 'hl2');
      const fast = sma(mid, 5);
      const slow = sma(mid, 34);
      return { ao: fast.map((v, i) => v - slow[i]) };
    },
  },
  {
    id: 'uo',
    name: 'Ultimate Oscillator',
    shortName: 'UO',
    category: 'Momentum',
    description: 'Combines momentum over three timeframes to reduce false signals.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 7, 1, 1, 500), numberInput('middle', 'Middle', 14, 1, 1, 500), numberInput('slow', 'Slow', 28, 1, 1, 500)],
    plots: [{ key: 'uo', title: 'UO', type: 'line', color: '#f44336', lineWidth: 2 }],
    levels: [70, 30],
    compute: (bars, p) => {
      const bp = bars.map((b, i) => (i ? b.close - Math.min(b.low, bars[i - 1].close) : NaN));
      const tr = bars.map((b, i) => (i ? Math.max(b.high, bars[i - 1].close) - Math.min(b.low, bars[i - 1].close) : NaN));
      const avg = (n: number) => {
        const a = rollingSum(bp, n);
        const t = rollingSum(tr, n);
        return a.map((v, i) => (t[i] ? v / t[i] : NaN));
      };
      const a1 = avg(num(p, 'fast'));
      const a2 = avg(num(p, 'middle'));
      const a3 = avg(num(p, 'slow'));
      return { uo: a1.map((v, i) => (100 * (4 * v + 2 * a2[i] + a3[i])) / 7) };
    },
  },

  // ---------- Volume & volatility ----------
  {
    id: 'cmf',
    name: 'Chaikin Money Flow',
    shortName: 'CMF',
    category: 'Volume',
    description: 'Buying vs selling pressure over N bars. Above 0 = buyers in control.',
    placement: 'separate',
    inputs: [length(20)],
    plots: [{ key: 'cmf', title: 'CMF', type: 'line', color: '#43a047', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const n = num(p, 'length');
      const mfv = bars.map((b) => (b.high === b.low ? 0 : (((b.close - b.low) - (b.high - b.close)) / (b.high - b.low)) * b.volume));
      const sv = rollingSum(mfv, n);
      const vol = rollingSum(bars.map((b) => b.volume), n);
      return { cmf: sv.map((v, i) => (vol[i] ? v / vol[i] : NaN)) };
    },
  },
  {
    id: 'ad',
    name: 'Accumulation/Distribution',
    shortName: 'A/D',
    category: 'Volume',
    description: 'Running total of money flowing in and out, based on where each bar closes in its range.',
    placement: 'separate',
    inputs: [],
    plots: [{ key: 'ad', title: 'A/D', type: 'line', color: '#ab47bc', lineWidth: 2 }],
    compute: (bars) => {
      let total = 0;
      return {
        ad: bars.map((b) => {
          if (b.high !== b.low) total += (((b.close - b.low) - (b.high - b.close)) / (b.high - b.low)) * b.volume;
          return total;
        }),
      };
    },
  },
  {
    id: 'stdev',
    name: 'Standard Deviation',
    shortName: 'StdDev',
    category: 'Volatility',
    description: 'How spread out prices have been over N bars. Rising = more volatile.',
    placement: 'separate',
    inputs: [length(20), sourceInput],
    plots: [{ key: 'sd', title: 'StdDev', type: 'line', color: '#ffa726', lineWidth: 2 }],
    compute: (bars, p) => ({ sd: stdev(src(bars, p), num(p, 'length')) }),
  },
  {
    id: 'bbpb',
    name: 'Bollinger %B',
    shortName: '%B',
    category: 'Volatility',
    description: 'Where price sits within the Bollinger Bands: 1 = upper band, 0 = lower band.',
    placement: 'separate',
    inputs: [length(20), numberInput('mult', 'Std dev', 2, 0.1, 0.1, 10), sourceInput],
    plots: [{ key: 'pb', title: '%B', type: 'line', color: '#26a69a', lineWidth: 2 }],
    levels: [1, 0.5, 0],
    compute: (bars, p) => {
      const s = src(bars, p);
      const basis = sma(s, num(p, 'length'));
      const dev = stdev(s, num(p, 'length'));
      const m = num(p, 'mult');
      return { pb: s.map((v, i) => (dev[i] ? (v - (basis[i] - m * dev[i])) / (2 * m * dev[i]) : NaN)) };
    },
  },
  {
    id: 'bbw',
    name: 'Bollinger Bandwidth',
    shortName: 'BBW',
    category: 'Volatility',
    description: 'Width of the Bollinger Bands as a % of the middle band. Very low values often come before big moves (a "squeeze").',
    placement: 'separate',
    inputs: [length(20), numberInput('mult', 'Std dev', 2, 0.1, 0.1, 10), sourceInput],
    plots: [{ key: 'bbw', title: 'BBW', type: 'line', color: '#5c6bc0', lineWidth: 2 }],
    compute: (bars, p) => {
      const s = src(bars, p);
      const basis = sma(s, num(p, 'length'));
      const dev = stdev(s, num(p, 'length'));
      return { bbw: basis.map((b, i) => (b ? (200 * num(p, 'mult') * dev[i]) / b : NaN)) };
    },
  },
];

/** Quant overlays and signal indicators (stage 4). */
export const QUANT_INDICATORS: IndicatorDef[] = [
  {
    id: 'vwapbands',
    name: 'VWAP with Std Dev Bands',
    shortName: 'VWAP±',
    category: 'Volume',
    description: 'Daily VWAP with bands 1, 2 and 3 volume-weighted standard deviations away. Price far outside the bands is stretched.',
    placement: 'overlay',
    inputs: [numberInput('m1', 'Band 1 (std devs)', 1, 0.1, 0.1, 10), numberInput('m2', 'Band 2', 2, 0.1, 0.1, 10), numberInput('m3', 'Band 3', 3, 0.1, 0.1, 10)],
    plots: [
      { key: 'vwap', title: 'VWAP', type: 'line', color: '#e91e63', lineWidth: 2 },
      { key: 'u1', title: '+1', type: 'line', color: '#42a5f5', lineWidth: 1 },
      { key: 'l1', title: '−1', type: 'line', color: '#42a5f5', lineWidth: 1 },
      { key: 'u2', title: '+2', type: 'line', color: '#7e57c2', lineWidth: 1 },
      { key: 'l2', title: '−2', type: 'line', color: '#7e57c2', lineWidth: 1 },
      { key: 'u3', title: '+3', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'l3', title: '−3', type: 'line', color: '#26a69a', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const out: Record<string, number[]> = Object.fromEntries(['vwap', 'u1', 'l1', 'u2', 'l2', 'u3', 'l3'].map((k) => [k, NaNs(bars.length)]));
      let day = -1;
      let pv = 0;
      let pv2 = 0;
      let vol = 0;
      bars.forEach((b, i) => {
        const d = Math.floor(b.time / 86400);
        const newSession = d !== day;
        if (newSession) {
          day = d;
          pv = pv2 = vol = 0;
        }
        const tp = (b.high + b.low + b.close) / 3;
        pv += tp * b.volume;
        pv2 += tp * tp * b.volume;
        vol += b.volume;
        const vwap = vol ? pv / vol : tp;
        const sd = vol ? Math.sqrt(Math.max(0, pv2 / vol - vwap * vwap)) : 0;
        // Leave a gap where a new day starts so the lines don't jump vertically.
        if (newSession && i > 0) return;
        out.vwap[i] = vwap;
        (['1', '2', '3'] as const).forEach((n) => {
          const m = num(p, `m${n}`);
          out[`u${n}`][i] = vwap + m * sd;
          out[`l${n}`][i] = vwap - m * sd;
        });
      });
      return out;
    },
  },
  {
    id: 'zscore',
    name: 'Z-Score',
    shortName: 'Z',
    category: 'Volatility',
    description: 'How many standard deviations price is from its average. Beyond ±2 is statistically stretched.',
    placement: 'separate',
    inputs: [length(20), sourceInput],
    plots: [{ key: 'z', title: 'Z-Score', type: 'line', color: '#26c6da', lineWidth: 2 }],
    levels: [2, 0, -2],
    compute: (bars, p) => {
      const s = src(bars, p);
      const mean = sma(s, num(p, 'length'));
      const sd = stdev(s, num(p, 'length'));
      return { z: s.map((v, i) => (sd[i] ? (v - mean[i]) / sd[i] : NaN)) };
    },
  },
  {
    id: 'zchannel',
    name: 'Z-Score Channels',
    shortName: 'ZCh',
    category: 'Bands & Channels',
    description: 'Moving average with channels at ±1, ±2 and ±3 standard deviations (a multi-level Bollinger Band).',
    placement: 'overlay',
    inputs: [length(50), sourceInput],
    plots: [
      { key: 'mid', title: 'Mean', type: 'line', color: '#ff9800', lineWidth: 1 },
      { key: 'u1', title: '+1σ', type: 'line', color: '#42a5f580', lineWidth: 1 },
      { key: 'l1', title: '−1σ', type: 'line', color: '#42a5f580', lineWidth: 1 },
      { key: 'u2', title: '+2σ', type: 'line', color: '#7e57c2', lineWidth: 1 },
      { key: 'l2', title: '−2σ', type: 'line', color: '#7e57c2', lineWidth: 1 },
      { key: 'u3', title: '+3σ', type: 'line', color: '#ef5350', lineWidth: 1 },
      { key: 'l3', title: '−3σ', type: 'line', color: '#26a69a', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const s = src(bars, p);
      const mid = sma(s, num(p, 'length'));
      const sd = stdev(s, num(p, 'length'));
      const band = (k: number) => mid.map((m, i) => m + k * sd[i]);
      return { mid, u1: band(1), l1: band(-1), u2: band(2), l2: band(-2), u3: band(3), l3: band(-3) };
    },
  },
  {
    id: 'macross',
    name: 'MA Cross Signals',
    shortName: 'MA×',
    category: 'Trend',
    description: 'Buy arrow when the fast EMA crosses above the slow EMA, sell arrow when it crosses below.',
    placement: 'overlay',
    inputs: [numberInput('fast', 'Fast EMA', 9, 1, 1, 500), numberInput('slow', 'Slow EMA', 21, 1, 1, 500)],
    plots: [
      { key: 'buy', title: 'Buy', type: 'marker', color: UP, marker: { shape: 'arrowUp', position: 'belowBar', text: 'Buy' } },
      { key: 'sell', title: 'Sell', type: 'marker', color: DOWN, marker: { shape: 'arrowDown', position: 'aboveBar', text: 'Sell' } },
    ],
    compute: (bars, p) => {
      const c = closes(bars);
      const f = ema(c, num(p, 'fast'));
      const s = ema(c, num(p, 'slow'));
      return {
        buy: f.map((v, i) => (i && v > s[i] && f[i - 1] <= s[i - 1] ? 1 : 0)),
        sell: f.map((v, i) => (i && v < s[i] && f[i - 1] >= s[i - 1] ? 1 : 0)),
      };
    },
  },
  {
    id: 'rsisignals',
    name: 'RSI Signals',
    shortName: 'RSI sig',
    category: 'Momentum',
    description: 'Buy dot when RSI climbs back above the oversold level, sell dot when it drops back below overbought.',
    placement: 'overlay',
    inputs: [length(14), numberInput('lower', 'Oversold', 30, 1, 1, 99), numberInput('upper', 'Overbought', 70, 1, 1, 99)],
    plots: [
      { key: 'buy', title: 'Oversold exit', type: 'marker', color: UP, marker: { shape: 'circle', position: 'belowBar' } },
      { key: 'sell', title: 'Overbought exit', type: 'marker', color: DOWN, marker: { shape: 'circle', position: 'aboveBar' } },
    ],
    compute: (bars, p) => {
      const r = rsi(closes(bars), num(p, 'length'));
      const lo = num(p, 'lower');
      const hi = num(p, 'upper');
      return {
        buy: r.map((v, i) => (i && v > lo && r[i - 1] <= lo ? 1 : 0)),
        sell: r.map((v, i) => (i && v < hi && r[i - 1] >= hi ? 1 : 0)),
      };
    },
  },
];
