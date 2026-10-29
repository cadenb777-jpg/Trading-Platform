/**
 * Moving averages and smoothing filters for the overlay family. References: TA-Lib (TRIMA, RMA, ZLEMA, T3, MAMA,
 * FRAMA, VIDYA, MCGD, TSF, MIDPOINT, HT_TRENDLINE), John Ehlers' papers and books (Laguerre, Super Smoother,
 * Ultimate Smoother, Instantaneous Trendline, Gaussian and Butterworth filters, Decycler, DSMA), Guppy, Widner,
 * Fries (EVWMA), Pine built-ins (ta.swma) and the common TradingView definitions for the rest.
 */
import type { Bar } from '../../types';
import { wma } from '../math';
import type { IndicatorDef, IndicatorParams, PlotDef } from '../types';
import {
  NaNs,
  ema,
  emaChain,
  fromFirstValid,
  highsOf,
  hilbertLoop,
  intParam,
  isNum,
  lengthIn,
  lowsOf,
  numIn,
  numParam,
  regression,
  rma,
  rolling,
  rollingPercentile,
  shiftBy,
  sma,
  sourceIn,
  srcOf,
  weightedMa,
} from './a-math';

const line = (key: string, title: string, color: string, lineWidth: 1 | 2 | 3 | 4 = 2): PlotDef => ({ key, title, type: 'line', color, lineWidth });

/** One-line moving average definition: `fn` gets the source series and the params. */
function ma(id: string, name: string, shortName: string, description: string, color: string, inputs: IndicatorDef['inputs'], fn: (s: number[], p: IndicatorParams, bars: Bar[]) => number[]): IndicatorDef {
  return {
    id,
    name,
    shortName,
    category: 'Moving Averages',
    description,
    placement: 'overlay',
    inputs,
    plots: [line('ma', shortName, color)],
    compute: (bars, p) => ({ ma: fn(srcOf(bars, p), p, bars) }),
  };
}

// ---------- formulas ----------

/** Triangular MA: an SMA of an SMA, so the middle of the window weighs most (TA-Lib TRIMA). */
export function trima(x: number[], n: number): number[] {
  const a = n % 2 ? (n + 1) / 2 : n / 2;
  const b = n % 2 ? (n + 1) / 2 : n / 2 + 1;
  return sma(sma(x, a), b);
}

/** Zero-lag EMA: EMA of 2 × price − price `(n − 1) / 2` bars ago (Ehlers & Way; TA-Lib ZLEMA). */
export function zlema(x: number[], n: number): number[] {
  const lag = Math.floor((n - 1) / 2);
  const lagged = shiftBy(x, lag);
  return ema(x.map((v, i) => 2 * v - lagged[i]), n);
}

/** Tillson T3: six EMAs combined with the volume factor `v` (TA-Lib T3). */
export function t3(x: number[], n: number, v: number): number[] {
  const [, , e3, e4, e5, e6] = emaChain(x, n, 6);
  const c1 = -(v ** 3);
  const c2 = 3 * v * v + 3 * v ** 3;
  const c3 = -6 * v * v - 3 * v - 3 * v ** 3;
  const c4 = 1 + 3 * v + v ** 3 + 3 * v * v;
  return e6.map((_, i) => c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i]);
}

/** MESA Adaptive MA and its Following AMA (Ehlers 2001), ported from TA-Lib's MAMA. */
export function mama(x: number[], fast: number, slow: number): { mama: number[]; fama: number[] } {
  const outM = NaNs(x.length);
  const outF = NaNs(x.length);
  let m = 0;
  let f = 0;
  let prevPhase = 0;
  hilbertLoop(x, 9, (today, phase) => {
    let delta = prevPhase - phase;
    prevPhase = phase;
    if (delta < 1) delta = 1;
    let alpha = fast;
    if (delta > 1) alpha = Math.max(slow, fast / delta);
    m = (1 - alpha) * m + alpha * x[today];
    f = (1 - alpha / 2) * f + (alpha / 2) * m;
    if (today >= 32) {
      outM[today] = m;
      outF[today] = f;
    }
  });
  return { mama: outM, fama: outF };
}

/** Hilbert Transform Instantaneous Trendline (Ehlers), ported from TA-Lib's HT_TRENDLINE. */
export function htTrendline(x: number[]): number[] {
  const out = NaNs(x.length);
  let it1 = 0;
  let it2 = 0;
  let it3 = 0;
  hilbertLoop(x, 34, (today, _phase, _period, smoothPeriod) => {
    const dc = Math.max(0, Math.floor(smoothPeriod + 0.5));
    let avg = 0;
    for (let i = 0; i < Math.min(dc, 50) && today - i >= 0; i++) avg += x[today - i];
    if (dc > 0) avg /= dc;
    const value = (4 * avg + 3 * it1 + 2 * it2 + it3) / 10;
    it3 = it2;
    it2 = it1;
    it1 = avg;
    if (today >= 63) out[today] = value;
  });
  return out;
}

/** Fractal Adaptive MA (Ehlers 2005) on the bar midpoint, as TA-Lib FRAMA: alpha = exp(−4.6 (D − 1)). */
export function frama(high: number[], low: number[], period: number): number[] {
  const n = high.length;
  const len = Math.max(2, period + (period % 2));
  const half = len / 2;
  const out = NaNs(n);
  if (n < len) return out;
  let prev = (high[len - 1] + low[len - 1]) / 2;
  const range = (from: number, to: number) => {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = from; j <= to; j++) {
      if (high[j] > hi) hi = high[j];
      if (low[j] < lo) lo = low[j];
    }
    return [hi, lo];
  };
  for (let i = len; i < n; i++) {
    const [h1, l1] = range(i - half + 1, i);
    const [h2, l2] = range(i - len + 1, i - half);
    const r1 = h1 - l1;
    const r2 = h2 - l2;
    const r = Math.max(h1, h2) - Math.min(l1, l2);
    const price = (high[i] + low[i]) / 2;
    if (r1 > 0 && r2 > 0 && r1 + r2 > r) {
      const alpha = Math.exp((-4.6 / Math.LN2) * Math.log((r1 + r2) / r));
      prev = (1 - alpha) * prev + alpha * price;
    } else prev = price;
    out[i] = prev;
  }
  return out;
}

/** Chande's VIDYA: an EMA whose speed is scaled by the absolute Chande Momentum Oscillator (TA-Lib VIDYA). */
export function vidya(x: number[], n: number, cmoLength: number): number[] {
  return fromFirstValid(x, (v) => {
    const out = NaNs(v.length);
    if (n <= 1) return v.map((value, i) => (i >= cmoLength ? value : NaN));
    const alpha = 2 / (n + 1);
    let prev = v[0];
    for (let i = 1; i < v.length; i++) {
      let up = 0;
      let down = 0;
      for (let j = Math.max(1, i - cmoLength + 1); j <= i; j++) {
        const d = v[j] - v[j - 1];
        if (d > 0) up += d;
        else down -= d;
      }
      const k = up + down > 0 ? alpha * Math.abs((up - down) / (up + down)) : 0;
      prev = prev + k * (v[i] - prev);
      if (i >= cmoLength) out[i] = prev;
    }
    return out;
  });
}

/** McGinley Dynamic: MD += (P − MD) / (N × (P / MD)^4), started on the first price (TA-Lib MCGD). */
export function mcginley(x: number[], n: number): number[] {
  return fromFirstValid(x, (v) => {
    const out = NaNs(v.length);
    let md = v[0];
    for (let i = 1; i < v.length; i++) {
      const ratio = v[i] / md;
      const next = md + (v[i] - md) / (n * ratio ** 4);
      if (Number.isFinite(next)) md = next;
      if (i >= n - 1) out[i] = md;
    }
    return out;
  });
}

/** Two-pole filters of the form f = c1·(input) + c2·f[1] + c3·f[2], started on the price itself. */
function recursive2(x: number[], c1: number, c2: number, c3: number, input: (v: number[], i: number) => number): number[] {
  return fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = i < 2 ? v[i] : c1 * input(v, i) + c2 * out[i - 1] + c3 * out[i - 2];
    return out;
  });
}

/** Ehlers' two-pole Super Smoother (Cycle Analytics for Traders, 2013). */
export function superSmoother(x: number[], period: number): number[] {
  const a1 = Math.exp((-1.414 * Math.PI) / period);
  const c2 = 2 * a1 * Math.cos((1.414 * Math.PI) / period);
  const c3 = -a1 * a1;
  return recursive2(x, 1 - c2 - c3, c2, c3, (v, i) => (v[i] + v[i - 1]) / 2);
}

/** Ehlers' Ultimate Smoother (TASC April 2024): passes the trend with almost no lag. */
export function ultimateSmoother(x: number[], period: number): number[] {
  const a1 = Math.exp((-1.414 * Math.PI) / period);
  const c2 = 2 * a1 * Math.cos((1.414 * Math.PI) / period);
  const c3 = -a1 * a1;
  const c1 = (1 + c2 - c3) / 4;
  return fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) {
      out[i] = i < 3 ? v[i] : (1 - c1) * v[i] + (2 * c1 - c2) * v[i - 1] - (c1 + c3) * v[i - 2] + c2 * out[i - 1] + c3 * out[i - 2];
    }
    return out;
  });
}

/** Ehlers' Laguerre filter (Time Warp, 2002): four all-pass stages with damping `gamma`. */
export function laguerre(x: number[], gamma: number): number[] {
  return fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    let l0 = v[0];
    let l1 = v[0];
    let l2 = v[0];
    let l3 = v[0];
    for (let i = 0; i < v.length; i++) {
      if (i > 0) {
        const p0 = l0;
        const p1 = l1;
        const p2 = l2;
        l0 = (1 - gamma) * v[i] + gamma * p0;
        l1 = -gamma * l0 + p0 + gamma * p1;
        l2 = -gamma * l1 + p1 + gamma * p2;
        l3 = -gamma * l2 + p2 + gamma * l3;
      }
      out[i] = (l0 + 2 * l1 + 2 * l2 + l3) / 6;
    }
    return out;
  });
}

/** Ehlers' Instantaneous Trendline (Cybernetic Analysis, 2004) with its trigger line 2·IT − IT[2]. */
export function instantTrend(x: number[], alpha: number): { it: number[]; trigger: number[] } {
  const it = fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) {
      if (i < 7) out[i] = i < 2 ? v[i] : (v[i] + 2 * v[i - 1] + v[i - 2]) / 4;
      else
        out[i] =
          (alpha - (alpha * alpha) / 4) * v[i] +
          0.5 * alpha * alpha * v[i - 1] -
          (alpha - 0.75 * alpha * alpha) * v[i - 2] +
          2 * (1 - alpha) * out[i - 1] -
          (1 - alpha) ** 2 * out[i - 2];
    }
    return out;
  });
  return { it, trigger: it.map((v, i) => (i >= 2 ? 2 * v - it[i - 2] : NaN)) };
}

/** Ehlers' N-pole Gaussian filter (1-4 poles); the previous outputs start at the price. */
export function gaussian(x: number[], period: number, poles: number): number[] {
  const p = Math.min(4, Math.max(1, Math.round(poles)));
  const beta = (1 - Math.cos((2 * Math.PI) / period)) / (2 ** (1 / p) - 1);
  const a = -beta + Math.sqrt(beta * beta + 2 * beta);
  const k = 1 - a;
  const coef = [
    [k],
    [2 * k, -(k ** 2)],
    [3 * k, -3 * k ** 2, k ** 3],
    [4 * k, -6 * k ** 2, 4 * k ** 3, -(k ** 4)],
  ][p - 1];
  return fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) {
      let f = a ** p * v[i];
      for (let j = 0; j < p; j++) f += coef[j] * (i - j - 1 >= 0 ? out[i - j - 1] : v[0]);
      out[i] = f;
    }
    return out;
  });
}

/** Ehlers' 2- and 3-pole Butterworth low-pass filters (Cybernetic Analysis, 2004). */
export function butterworth(x: number[], period: number, poles: number): number[] {
  if (Math.round(poles) >= 3) {
    const a = Math.exp(-Math.PI / period);
    const b = 2 * a * Math.cos((1.738 * Math.PI) / period);
    const c = a * a;
    const k1 = ((1 - b + c) * (1 - c)) / 8;
    return fromFirstValid(x, (v) => {
      const out = new Array<number>(v.length);
      for (let i = 0; i < v.length; i++) {
        out[i] = i < 3 ? v[i] : k1 * (v[i] + 3 * v[i - 1] + 3 * v[i - 2] + v[i - 3]) + (b + c) * out[i - 1] - (c + b * c) * out[i - 2] + c * c * out[i - 3];
      }
      return out;
    });
  }
  const a = Math.exp((-1.414 * Math.PI) / period);
  const b = 2 * a * Math.cos((1.414 * Math.PI) / period);
  return recursive2(x, (1 - b + a * a) / 4, b, -a * a, (v, i) => v[i] + 2 * v[i - 1] + v[i - 2]);
}

/** Ehlers' Simple Decycler (TASC Sept 2015): price minus a 2-pole high-pass filter. */
export function decycler(x: number[], period: number): number[] {
  const w = (0.707 * 2 * Math.PI) / period;
  const a = (Math.cos(w) + Math.sin(w) - 1) / Math.cos(w);
  return fromFirstValid(x, (v) => {
    const hp = new Array<number>(v.length).fill(0);
    for (let i = 2; i < v.length; i++) hp[i] = (1 - a / 2) ** 2 * (v[i] - 2 * v[i - 1] + v[i - 2]) + 2 * (1 - a) * hp[i - 1] - (1 - a) ** 2 * hp[i - 2];
    return v.map((value, i) => value - hp[i]);
  });
}

/** Ehlers' Deviation-Scaled MA (TASC July 2018): an EMA whose alpha follows the scaled, smoothed momentum. */
export function dsma(x: number[], period: number): number[] {
  const n = x.length;
  const zeros = x.map((v, i) => (i >= 2 ? v - x[i - 2] : NaN));
  const filt = superSmoother(zeros, Math.max(2, period / 2));
  const out = NaNs(n);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    if (!isNum(filt[i])) continue;
    let ss = 0;
    let count = 0;
    for (let j = Math.max(0, i - period + 1); j <= i; j++) if (isNum(filt[j])) (ss += filt[j] ** 2), count++;
    const rms = Math.sqrt(ss / count);
    const scaled = rms > 0 ? filt[i] / rms : 0;
    const alpha = Math.min(1, (Math.abs(scaled) * 5) / period);
    prev = isNum(prev) ? alpha * x[i] + (1 - alpha) * prev : x[i];
    if (i >= period) out[i] = prev;
  }
  return out;
}

/** Jurik-style MA: the widely used public approximation (phase, power); Jurik's own JMA is proprietary. */
export function jurikApprox(x: number[], length: number, phase: number, power: number): number[] {
  const ratio = phase < -100 ? 0.5 : phase > 100 ? 2.5 : phase / 100 + 1.5;
  const beta = (0.45 * (length - 1)) / (0.45 * (length - 1) + 2);
  const alpha = beta ** power;
  return fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    let e0 = v[0];
    let e1 = 0;
    let e2 = 0;
    let j = v[0];
    for (let i = 0; i < v.length; i++) {
      if (i > 0) {
        e0 = (1 - alpha) * v[i] + alpha * e0;
        e1 = (v[i] - e0) * (1 - beta) + beta * e1;
        e2 = (e0 + ratio * e1 - j) * (1 - alpha) ** 2 + alpha ** 2 * e2;
        j = e2 + j;
      }
      out[i] = j;
    }
    return out;
  });
}

/** Elastic Volume-Weighted MA (Christian Fries): each bar moves the average by its share of the window's volume. */
export function evwma(x: number[], volume: number[], n: number): number[] {
  const out = NaNs(x.length);
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += volume[i];
    if (i >= n) sum -= volume[i - n];
    if (i < n - 1) continue;
    if (!isNum(prev)) prev = x[i];
    else if (sum > 0) prev = ((sum - volume[i]) * prev + volume[i] * x[i]) / sum;
    out[i] = prev;
  }
  return out;
}

/** Nadaraya-Watson kernel regression on past bars only (no repainting): Gaussian weights exp(−j² / 2h²). */
export function kernelRegression(x: number[], window: number, bandwidth: number): number[] {
  const w = Array.from({ length: window }, (_, j) => Math.exp(-(j * j) / (2 * bandwidth * bandwidth)));
  return weightedMa(x, w.slice().reverse());
}

/** Holt's linear (double exponential) smoothing: a level and a trend, each with its own smoothing factor. */
export function holt(x: number[], alpha: number, beta: number): number[] {
  return fromFirstValid(x, (v) => {
    const out = NaNs(v.length);
    if (v.length < 2) return out;
    let level = v[1];
    let trend = v[1] - v[0];
    out[1] = level;
    for (let i = 2; i < v.length; i++) {
      const prevLevel = level;
      level = alpha * v[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      out[i] = level;
    }
    return out;
  });
}

/** A one-dimensional Kalman filter for a random walk; `ratio` = process noise / measurement noise. */
export function kalman(x: number[], ratio: number): number[] {
  return fromFirstValid(x, (v) => {
    const out = new Array<number>(v.length);
    let est = v[0];
    let err = 1;
    for (let i = 0; i < v.length; i++) {
      if (i > 0) {
        err += ratio;
        const gain = err / (err + 1);
        est += gain * (v[i] - est);
        err *= 1 - gain;
      }
      out[i] = est;
    }
    return out;
  });
}

const ribbonColors = ['#2962ff', '#1e88e5', '#039be5', '#00acc1', '#00897b', '#43a047', '#7cb342', '#c0ca33', '#fdd835', '#ffb300', '#fb8c00', '#f4511e'];

// ---------- definitions ----------

export const AVERAGES: IndicatorDef[] = [
  ma('trima', 'Triangular Moving Average', 'TRIMA', 'An average of an average: the middle of the window counts most, giving a very smooth line.', '#7e57c2', [lengthIn(20), sourceIn], (s, p) => trima(s, intParam(p, 'length', 20))),
  ma('smma', "Smoothed Moving Average (Wilder's)", 'SMMA', "Wilder's smoothing (RMA): an EMA with alpha 1/N, used inside RSI and ATR.", '#5c6bc0', [lengthIn(14), sourceIn], (s, p) => rma(s, intParam(p, 'length', 14))),
  ma('zlema', 'Zero-Lag EMA', 'ZLEMA', 'EMA of price plus its recent change, which removes most of the lag.', '#00897b', [lengthIn(21), sourceIn], (s, p) => zlema(s, intParam(p, 'length', 21))),
  ma('t3', 'Tillson T3', 'T3', 'Six chained EMAs blended by a volume factor: smooth and responsive.', '#ef6c00', [lengthIn(5), numIn('vfactor', 'Volume factor', 0.7, 0.05, 0, 1), sourceIn], (s, p) => t3(s, intParam(p, 'length', 5), numParam(p, 'vfactor', 0.7))),
  {
    id: 'mama',
    name: 'MESA Adaptive Moving Average',
    shortName: 'MAMA',
    category: 'Moving Averages',
    description: "Ehlers' adaptive average (MAMA) and its slower follower (FAMA); speed follows the market's measured cycle.",
    placement: 'overlay',
    inputs: [numIn('fast', 'Fast limit', 0.5, 0.01, 0.01, 0.99), numIn('slow', 'Slow limit', 0.05, 0.01, 0.01, 0.99), sourceIn],
    plots: [line('mama', 'MAMA', '#e91e63'), line('fama', 'FAMA', '#2962ff')],
    compute: (bars, p) => mama(srcOf(bars, p), numParam(p, 'fast', 0.5), numParam(p, 'slow', 0.05)),
  },
  {
    id: 'frama',
    name: 'Fractal Adaptive Moving Average',
    shortName: 'FRAMA',
    category: 'Moving Averages',
    description: "Ehlers' FRAMA: follows price closely in trends and flattens in choppy ranges (uses the bar midpoint).",
    placement: 'overlay',
    inputs: [{ ...lengthIn(16, 'Length (even)', 'length', 2), step: 2 }],
    plots: [line('ma', 'FRAMA', '#8d6e63')],
    compute: (bars, p) => ({ ma: frama(highsOf(bars), lowsOf(bars), intParam(p, 'length', 16, 2)) }),
  },
  ma('vidya', 'Variable Index Dynamic Average', 'VIDYA', "Chande's VIDYA: an EMA that speeds up when momentum (CMO) is strong.", '#00acc1', [lengthIn(14), lengthIn(9, 'CMO length', 'cmo', 2), sourceIn], (s, p) => vidya(s, intParam(p, 'length', 14), intParam(p, 'cmo', 9, 2))),
  ma('mcginley', 'McGinley Dynamic', 'MD', 'A self-adjusting average that speeds up in falling markets and hugs price better than an EMA.', '#6d4c41', [lengthIn(14, 'Length', 'length', 2), sourceIn], (s, p) => mcginley(s, intParam(p, 'length', 14, 2))),
  ma('evwma', 'Elastic Volume-Weighted MA', 'EVWMA', 'Each bar moves the average by its share of recent volume: busy bars pull harder.', '#d81b60', [lengthIn(20), sourceIn], (s, p, bars) => evwma(s, bars.map((b) => b.volume), intParam(p, 'length', 20))),
  ma('vwema', 'Volume-Weighted EMA', 'VWEMA', 'EMA of price × volume divided by EMA of volume.', '#ad1457', [lengthIn(20), sourceIn], (s, p, bars) => {
    const n = intParam(p, 'length', 20);
    const pv = ema(s.map((v, i) => v * bars[i].volume), n);
    const vol = ema(bars.map((b) => b.volume), n);
    return pv.map((x, i) => (vol[i] > 0 ? x / vol[i] : NaN));
  }),
  ma('tsf', 'Time Series Forecast', 'TSF', "The linear regression line's projection one bar ahead (TA-Lib TSF).", '#ff7043', [lengthIn(14, 'Length', 'length', 2), sourceIn], (s, p) => {
    const n = intParam(p, 'length', 14, 2);
    const r = regression(s, n);
    return r.intercept.map((b, i) => b + r.slope[i] * n);
  }),
  ma('jma', 'Jurik-style MA (approximation)', 'JMA≈', "A public approximation of Mark Jurik's adaptive average (the real JMA is proprietary). Very smooth with little lag.", '#00bfa5', [lengthIn(7), numIn('phase', 'Phase (−100..100)', 50, 1, -100, 100), numIn('power', 'Power', 2, 1, 1, 10), sourceIn], (s, p) => jurikApprox(s, intParam(p, 'length', 7), numParam(p, 'phase', 50), numParam(p, 'power', 2))),
  ma('laguerre', 'Laguerre Filter', 'Laguerre', "Ehlers' Laguerre filter: heavy smoothing from only four bars of memory. Lower gamma = faster.", '#7cb342', [numIn('gamma', 'Gamma (damping)', 0.8, 0.05, 0, 0.99), sourceIn], (s, p) => laguerre(s, numParam(p, 'gamma', 0.8))),
  ma('supersmoother', 'Ehlers Super Smoother', 'SSF', "Ehlers' two-pole Super Smoother: removes noise shorter than the period with little lag.", '#26a69a', [lengthIn(10, 'Period', 'length', 2), sourceIn], (s, p) => superSmoother(s, intParam(p, 'length', 10, 2))),
  ma('ultsmoother', 'Ehlers Ultimate Smoother', 'USF', "Ehlers' 2024 Ultimate Smoother: smooths like a moving average with almost zero lag in trends.", '#009688', [lengthIn(20, 'Period', 'length', 2), sourceIn], (s, p) => ultimateSmoother(s, intParam(p, 'length', 20, 2))),
  {
    id: 'itrend',
    name: 'Ehlers Instantaneous Trendline',
    shortName: 'iTrend',
    category: 'Moving Averages',
    description: "Ehlers' Instantaneous Trendline with its trigger line; crosses mark trend changes.",
    placement: 'overlay',
    inputs: [numIn('alpha', 'Alpha', 0.07, 0.01, 0.01, 1), sourceIn],
    plots: [line('it', 'Trendline', '#2962ff'), line('trigger', 'Trigger', '#ff6d00', 1)],
    compute: (bars, p) => instantTrend(srcOf(bars, p), numParam(p, 'alpha', 0.07)),
  },
  ma('httrend', 'Hilbert Transform Trendline', 'HT Trend', "Ehlers' Hilbert Transform trendline (TA-Lib HT_TRENDLINE): an average over the measured cycle length.", '#3949ab', [sourceIn], (s) => htTrendline(s)),
  ma('gaussian', 'Gaussian Filter', 'Gauss', "Ehlers' Gaussian filter: more poles = smoother but slower.", '#8e24aa', [lengthIn(20, 'Period', 'length', 2), numIn('poles', 'Poles (1-4)', 4, 1, 1, 4), sourceIn], (s, p) => gaussian(s, intParam(p, 'length', 20, 2), intParam(p, 'poles', 4))),
  ma('butterworth', 'Butterworth Filter', 'Butter', "Ehlers' 2- or 3-pole Butterworth low-pass filter: very smooth, more lag than the Super Smoother.", '#5e35b1', [lengthIn(20, 'Period', 'length', 2), numIn('poles', 'Poles (2-3)', 2, 1, 2, 3), sourceIn], (s, p) => butterworth(s, intParam(p, 'length', 20, 2), intParam(p, 'poles', 2, 2))),
  ma('midpoint', 'Midpoint', 'MidPt', 'Halfway between the highest and lowest value of the source over N bars (TA-Lib MIDPOINT).', '#78909c', [lengthIn(14), sourceIn], (s, p) => {
    const n = intParam(p, 'length', 14);
    return rolling(s, n, (a, b) => {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = a; j <= b; j++) (hi = Math.max(hi, s[j])), (lo = Math.min(lo, s[j]));
      return (hi + lo) / 2;
    });
  }),
  ma('dma', 'Displaced Moving Average', 'DMA', 'An SMA shifted forward by a number of bars, so price must clear it decisively.', '#546e7a', [lengthIn(20), numIn('offset', 'Shift forward (bars)', 5, 1, 0, 200), sourceIn], (s, p) => shiftBy(sma(s, intParam(p, 'length', 20)), intParam(p, 'offset', 5, 0))),
  ma('sinewma', 'Sine-Weighted MA', 'SinWMA', 'Weights follow half a sine wave, so the middle of the window counts most.', '#c2185b', [lengthIn(21), sourceIn], (s, p) => {
    const n = intParam(p, 'length', 21);
    return weightedMa(s, Array.from({ length: n }, (_, j) => Math.sin((Math.PI * (j + 1)) / (n + 1))));
  }),
  ma('swma', 'Symmetrically Weighted MA', 'SWMA', "Pine's ta.swma: a fixed 4-bar average weighted 1-2-2-1.", '#f06292', [sourceIn], (s) => weightedMa(s, [1, 2, 2, 1])),
  ma('ehma', 'Exponential Hull MA', 'EHMA', 'The Hull formula built from EMAs instead of WMAs: smooth and quick.', '#0097a7', [lengthIn(16, 'Length', 'length', 2), sourceIn], (s, p) => {
    const n = intParam(p, 'length', 16, 2);
    const half = ema(s, Math.max(1, Math.floor(n / 2)));
    const full = ema(s, n);
    return ema(half.map((h, i) => 2 * h - full[i]), Math.max(1, Math.round(Math.sqrt(n))));
  }),
  ma('thma', 'Triple Hull MA', 'THMA', 'A three-stage Hull average: WMA of 3·WMA(N/3) − WMA(N/2) − WMA(N).', '#00838f', [lengthIn(21, 'Length', 'length', 3), sourceIn], (s, p) => {
    const n = intParam(p, 'length', 21, 3);
    const a = wma(s, Math.max(1, Math.floor(n / 3)));
    const b = wma(s, Math.max(1, Math.floor(n / 2)));
    const c = wma(s, n);
    return wma(a.map((v, i) => 3 * v - b[i] - c[i]), n);
  }),
  ma('gma', 'Geometric Moving Average', 'GMA', 'The geometric mean of the last N prices: treats percentage moves evenly.', '#9e9d24', [lengthIn(20), sourceIn], (s, p) => sma(s.map((v) => (v > 0 ? Math.log(v) : NaN)), intParam(p, 'length', 20)).map(Math.exp)),
  ma('medianma', 'Moving Median', 'Median', 'The middle price of the last N bars: ignores one-off spikes.', '#a1887f', [lengthIn(20), sourceIn], (s, p) => rollingPercentile(s, intParam(p, 'length', 20), 0.5)),
  ma('cma', 'Cumulative Moving Average', 'CMA', 'The average of every bar on the chart so far.', '#90a4ae', [sourceIn], (s) => {
    let sum = 0;
    return s.map((v, i) => (sum += v) / (i + 1));
  }),
  {
    id: 'decycler',
    name: 'Ehlers Simple Decycler',
    shortName: 'Decycler',
    category: 'Moving Averages',
    description: "Ehlers' Decycler: price with the short cycles filtered out, plus hysteresis bands a set % around it.",
    placement: 'overlay',
    inputs: [lengthIn(125, 'Cut-off period', 'length', 5), numIn('band', 'Band %', 0.5, 0.1, 0, 20), sourceIn],
    plots: [line('upper', 'Upper', '#80cbc4', 1), line('decycler', 'Decycler', '#26a69a'), line('lower', 'Lower', '#80cbc4', 1)],
    compute: (bars, p) => {
      const d = decycler(srcOf(bars, p), intParam(p, 'length', 125, 5));
      const k = numParam(p, 'band', 0.5) / 100;
      return { decycler: d, upper: d.map((v) => v * (1 + k)), lower: d.map((v) => v * (1 - k)) };
    },
  },
  ma('dsma', 'Deviation-Scaled MA', 'DSMA', "Ehlers' DSMA: moves fast when price breaks away and slows when it chops.", '#4527a0', [lengthIn(40, 'Period', 'length', 4), sourceIn], (s, p) => dsma(s, intParam(p, 'length', 40, 4))),
  ma('nwkernel', 'Nadaraya-Watson Kernel (no repaint)', 'NW', 'Kernel regression over past bars only (Gaussian weights): a very smooth estimate that never repaints.', '#f9a825', [lengthIn(100, 'Window', 'length', 2, 500), numIn('bandwidth', 'Bandwidth', 8, 0.5, 0.5, 100), sourceIn], (s, p) => kernelRegression(s, intParam(p, 'length', 100, 2), numParam(p, 'bandwidth', 8))),
  ma('holt', 'Holt Double Exponential MA', 'Holt', "Holt's double exponential smoothing: tracks both the level and the trend, so it lags less in trends.", '#bf360c', [numIn('alpha', 'Level alpha', 0.2, 0.01, 0.01, 1), numIn('beta', 'Trend beta', 0.1, 0.01, 0, 1), sourceIn], (s, p) => holt(s, numParam(p, 'alpha', 0.2), numParam(p, 'beta', 0.1))),
  ma('kalman', 'Kalman Filter', 'Kalman', 'A one-dimensional Kalman filter: a statistically weighted running estimate of price. Higher ratio = faster.', '#283593', [numIn('ratio', 'Noise ratio (process/measurement)', 0.05, 0.005, 0.0001, 10), sourceIn], (s, p) => kalman(s, numParam(p, 'ratio', 0.05))),
  {
    id: 'gmma',
    name: 'Guppy Multiple Moving Average',
    shortName: 'GMMA',
    category: 'Moving Averages',
    description: "Daryl Guppy's 12 EMAs: a short group (3-15, traders) and a long group (30-60, investors).",
    placement: 'overlay',
    inputs: [sourceIn],
    plots: [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60].map((n, i) => line(`e${n}`, `EMA ${n}`, i < 6 ? '#26a69a' : '#ef5350', 1)),
    compute: (bars, p) => {
      const s = srcOf(bars, p);
      return Object.fromEntries([3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60].map((n) => [`e${n}`, ema(s, n)]));
    },
  },
  {
    id: 'maribbon',
    name: 'Moving Average Ribbon',
    shortName: 'Ribbon',
    category: 'Moving Averages',
    description: 'Eight EMAs spaced evenly apart. A fanned-out ribbon = strong trend; a tangled one = no trend.',
    placement: 'overlay',
    inputs: [lengthIn(20, 'First length'), lengthIn(5, 'Step', 'step'), sourceIn],
    plots: Array.from({ length: 8 }, (_, i) => line(`m${i + 1}`, `EMA ${i + 1}`, ribbonColors[i], 1)),
    compute: (bars, p) => {
      const s = srcOf(bars, p);
      const first = intParam(p, 'length', 20);
      const step = intParam(p, 'step', 5);
      return Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`m${i + 1}`, ema(s, first + i * step)]));
    },
  },
  {
    id: 'rainbow',
    name: 'Rainbow Moving Average',
    shortName: 'Rainbow',
    category: 'Moving Averages',
    description: "Mel Widner's Rainbow: ten SMAs, each an average of the one before it.",
    placement: 'overlay',
    inputs: [lengthIn(2), sourceIn],
    plots: Array.from({ length: 10 }, (_, i) => line(`r${i + 1}`, `MA ${i + 1}`, ribbonColors[i + 1], 1)),
    compute: (bars, p) => {
      const n = intParam(p, 'length', 2);
      let cur = srcOf(bars, p);
      const out: Record<string, number[]> = {};
      for (let i = 1; i <= 10; i++) out[`r${i}`] = cur = sma(cur, n);
      return out;
    },
  },
  {
    id: 'emacloud',
    name: 'EMA Clouds',
    shortName: 'EMA Cloud',
    category: 'Moving Averages',
    description: 'Two pairs of EMAs (5/12 for the short-term trend, 34/50 for the bigger one).',
    placement: 'overlay',
    inputs: [lengthIn(5, 'Fast 1', 'f1'), lengthIn(12, 'Slow 1', 's1'), lengthIn(34, 'Fast 2', 'f2'), lengthIn(50, 'Slow 2', 's2'), sourceIn],
    plots: [line('f1', 'Fast 1', '#26a69a', 1), line('s1', 'Slow 1', '#80cbc4', 1), line('f2', 'Fast 2', '#2962ff', 1), line('s2', 'Slow 2', '#90caf9', 1)],
    compute: (bars, p) => {
      const s = srcOf(bars, p);
      return Object.fromEntries(['f1', 's1', 'f2', 's2'].map((k) => [k, ema(s, intParam(p, k, 10))]));
    },
  },
];
