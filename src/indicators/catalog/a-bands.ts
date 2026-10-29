/**
 * Bands and channels for the overlay family. References: StockCharts ChartSchool (Price Channels, Chandelier,
 * Keltner's original 10-day version), TA-Lib ACCBANDS (Headley), Achelis "Technical Analysis from A to Z"
 * (Projection Bands, Standard Error Bands, STARC, Raff), Vitali Apirine (Moving Average Bands, TASC 2017).
 */
import type { IndicatorDef, PlotDef } from '../types';
import { kernelRegression } from './a-averages';
import { NaNs, atrOf, closesOf, ema, highsOf, intParam, lengthIn, lowsOf, numIn, numParam, regression, rolling, rollingPercentile, shiftBy, sma, sourceIn, srcOf } from './a-math';
import { highest, lowest, stdev } from '../math';

const line = (key: string, title: string, color: string, lineWidth: 1 | 2 | 3 | 4 = 1): PlotDef => ({ key, title, type: 'line', color, lineWidth });
const triple = (upper: string, basis: string, lower = upper): PlotDef[] => [line('upper', 'Upper', upper), line('basis', 'Basis', basis), line('lower', 'Lower', lower)];

function band(id: string, name: string, shortName: string, description: string, inputs: IndicatorDef['inputs'], plots: PlotDef[], compute: IndicatorDef['compute']): IndicatorDef {
  return { id, name, shortName, category: 'Bands & Channels', description, placement: 'overlay', inputs, plots, compute };
}

const around = (basis: number[], width: number[], k: number) => ({
  basis,
  upper: basis.map((b, i) => b + k * width[i]),
  lower: basis.map((b, i) => b - k * width[i]),
});

/** Residuals of each window's least-squares line: returns fn(residuals) per bar. */
function residualStat(values: number[], n: number, fn: (res: number[], start: number, fit: (j: number) => number) => number): { end: number[]; stat: number[] } {
  const r = regression(values, n);
  const stat = rolling(values, n, (start, i) => {
    const fit = (j: number) => r.intercept[i] + r.slope[i] * j;
    const res = Array.from({ length: n }, (_, j) => values[start + j] - fit(j));
    return fn(res, start, fit);
  });
  return { end: r.end, stat };
}

export const BANDS: IndicatorDef[] = [
  band(
    'bb3',
    'Bollinger Bands (2 and 3 SD)',
    'BB 2/3',
    'Bollinger Bands with an inner pair at 2 standard deviations and an outer pair at 3.',
    [lengthIn(20), numIn('inner', 'Inner std dev', 2, 0.1, 0.1, 10), numIn('outer', 'Outer std dev', 3, 0.1, 0.1, 10), sourceIn],
    [line('upper3', 'Upper 3', '#ef5350'), line('upper2', 'Upper 2', '#2196f3'), line('basis', 'Basis', '#ff6d00'), line('lower2', 'Lower 2', '#2196f3'), line('lower3', 'Lower 3', '#26a69a')],
    (bars, p) => {
      const s = srcOf(bars, p);
      const n = intParam(p, 'length', 20);
      const basis = sma(s, n);
      const sd = stdev(s, n);
      const a = numParam(p, 'inner', 2);
      const b = numParam(p, 'outer', 3);
      return {
        basis,
        upper2: basis.map((m, i) => m + a * sd[i]),
        lower2: basis.map((m, i) => m - a * sd[i]),
        upper3: basis.map((m, i) => m + b * sd[i]),
        lower3: basis.map((m, i) => m - b * sd[i]),
      };
    },
  ),
  band(
    'keltnerclassic',
    'Keltner Channels (original)',
    'KC classic',
    "Chester Keltner's 1960 version: a 10-bar average of the typical price, ± the 10-bar average high-low range.",
    [lengthIn(10), numIn('mult', 'Range multiplier', 1, 0.1, 0.1, 10)],
    triple('#2962ff', '#787b86'),
    (bars, p) => {
      const n = intParam(p, 'length', 10);
      return around(sma(bars.map((b) => (b.high + b.low + b.close) / 3), n), sma(bars.map((b) => b.high - b.low), n), numParam(p, 'mult', 1));
    },
  ),
  band(
    'starc',
    'STARC Bands',
    'STARC',
    "Manning Stoller's Average Range Channel: a short SMA ± a multiple of ATR.",
    [lengthIn(6, 'SMA length'), lengthIn(15, 'ATR length', 'atr'), numIn('mult', 'ATR multiplier', 2, 0.1, 0.1, 10)],
    triple('#ab47bc', '#787b86'),
    (bars, p) => around(sma(closesOf(bars), intParam(p, 'length', 6)), atrOf(bars, intParam(p, 'atr', 15)), numParam(p, 'mult', 2)),
  ),
  band(
    'atrbands',
    'ATR Bands',
    'ATR Bands',
    'The source ± a multiple of the Average True Range: how far a normal move reaches from here.',
    [lengthIn(14, 'ATR length'), numIn('mult', 'ATR multiplier', 2, 0.1, 0.1, 10), sourceIn],
    triple('#ef5350', '#787b86', '#26a69a'),
    (bars, p) => around(srcOf(bars, p), atrOf(bars, intParam(p, 'length', 14)), numParam(p, 'mult', 2)),
  ),
  band(
    'accbands',
    'Acceleration Bands',
    'ABANDS',
    "Price Headley's Acceleration Bands: SMAs of the high and low widened by the bar's relative range (TA-Lib ACCBANDS).",
    [lengthIn(20, 'Length', 'length', 2)],
    triple('#26a69a', '#787b86', '#ef5350'),
    (bars, p) => {
      const n = intParam(p, 'length', 20, 2);
      const k = bars.map((b) => (b.high + b.low > 0 ? (4 * (b.high - b.low)) / (b.high + b.low) : 0));
      return {
        upper: sma(bars.map((b, i) => b.high * (1 + k[i])), n),
        basis: sma(closesOf(bars), n),
        lower: sma(bars.map((b, i) => b.low * (1 - k[i])), n),
      };
    },
  ),
  band(
    'sebands',
    'Standard Error Bands',
    'SE Bands',
    "Jon Andersen's bands: a linear regression line ± 2 standard errors, smoothed. Tight bands = a clean trend.",
    [lengthIn(21, 'Length', 'length', 3), numIn('mult', 'Standard errors', 2, 0.1, 0.1, 10), lengthIn(3, 'Smoothing', 'smooth'), sourceIn],
    triple('#5c6bc0', '#ff9800'),
    (bars, p) => {
      const n = intParam(p, 'length', 21, 3);
      const k = numParam(p, 'mult', 2);
      const m = intParam(p, 'smooth', 3);
      const { end, stat } = residualStat(srcOf(bars, p), n, (res) => Math.sqrt(res.reduce((a, r) => a + r * r, 0) / (n - 2)));
      return { basis: sma(end, m), upper: sma(end.map((e, i) => e + k * stat[i]), m), lower: sma(end.map((e, i) => e - k * stat[i]), m) };
    },
  ),
  band(
    'lrc',
    'Linear Regression Channel',
    'LR Channel',
    'The end of a best-fit line through the last N bars ± a multiple of the standard deviation of the misses.',
    [lengthIn(50, 'Length', 'length', 2), numIn('mult', 'Std dev', 2, 0.1, 0.1, 10), sourceIn],
    triple('#2196f3', '#ff7043'),
    (bars, p) => {
      const n = intParam(p, 'length', 50, 2);
      const { end, stat } = residualStat(srcOf(bars, p), n, (res) => Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n));
      return around(end, stat, numParam(p, 'mult', 2));
    },
  ),
  band(
    'raff',
    'Raff Regression Channel',
    'Raff',
    "Gilbert Raff's channel: the regression line with parallel lines through the bar that strayed furthest from it.",
    [lengthIn(50, 'Length', 'length', 2)],
    triple('#8e24aa', '#ff7043'),
    (bars, p) => {
      const n = intParam(p, 'length', 50, 2);
      const h = highsOf(bars);
      const l = lowsOf(bars);
      const { end, stat } = residualStat(closesOf(bars), n, (_res, start, fit) => {
        let d = 0;
        for (let j = 0; j < n; j++) d = Math.max(d, h[start + j] - fit(j), fit(j) - l[start + j]);
        return d;
      });
      return around(end, stat, 1);
    },
  ),
  band(
    'fibbands',
    'Fibonacci Bands',
    'Fib Bands',
    'An EMA with bands at 1.618, 2.618 and 4.236 ATRs (Fibonacci ratios) for stretched-price targets.',
    [lengthIn(20, 'EMA length'), lengthIn(14, 'ATR length', 'atr'), sourceIn],
    [line('u3', '+4.236', '#b71c1c'), line('u2', '+2.618', '#ef5350'), line('u1', '+1.618', '#ef9a9a'), line('basis', 'Basis', '#ff9800'), line('l1', '−1.618', '#80cbc4'), line('l2', '−2.618', '#26a69a'), line('l3', '−4.236', '#00695c')],
    (bars, p) => {
      const basis = ema(srcOf(bars, p), intParam(p, 'length', 20));
      const atr = atrOf(bars, intParam(p, 'atr', 14));
      const at = (k: number) => basis.map((b, i) => b + k * atr[i]);
      return { basis, u1: at(1.618), u2: at(2.618), u3: at(4.236), l1: at(-1.618), l2: at(-2.618), l3: at(-4.236) };
    },
  ),
  band(
    'mabands',
    'Moving Average Bands',
    'MAB',
    "Vitali Apirine's bands: a fast EMA in the middle, bands around a slow EMA as wide as the two averages' spread.",
    [lengthIn(10, 'Fast EMA', 'fast'), lengthIn(50, 'Slow EMA', 'slow'), numIn('mult', 'Multiplier', 1, 0.1, 0.1, 10), sourceIn],
    triple('#2962ff', '#ff6d00'),
    (bars, p) => {
      const s = srcOf(bars, p);
      const nf = intParam(p, 'fast', 10);
      const fast = ema(s, nf);
      const slow = ema(s, intParam(p, 'slow', 50));
      const dev = sma(fast.map((f, i) => (f - slow[i]) ** 2), nf).map(Math.sqrt);
      const k = numParam(p, 'mult', 1);
      return { basis: fast, upper: slow.map((v, i) => v + k * dev[i]), lower: slow.map((v, i) => v - k * dev[i]) };
    },
  ),
  band(
    'projbands',
    'Projection Bands',
    'Proj Bands',
    "Mel Widner's bands: each recent high and low projected to today along its own regression slope; the outermost form the bands.",
    [lengthIn(14, 'Length', 'length', 2)],
    [line('upper', 'Upper', '#26a69a'), line('lower', 'Lower', '#ef5350')],
    (bars, p) => {
      const n = intParam(p, 'length', 14, 2);
      const h = highsOf(bars);
      const l = lowsOf(bars);
      const sh = regression(h, n).slope;
      const sl = regression(l, n).slope;
      const upper = NaNs(bars.length);
      const lower = NaNs(bars.length);
      for (let i = n - 1; i < bars.length; i++) {
        let u = -Infinity;
        let d = Infinity;
        for (let j = 0; j < n; j++) {
          u = Math.max(u, h[i - j] + sh[i] * j);
          d = Math.min(d, l[i - j] + sl[i] * j);
        }
        upper[i] = u;
        lower[i] = d;
      }
      return { upper, lower };
    },
  ),
  band(
    'pricechannel',
    'Price Channels',
    'PC',
    'The highest high and lowest low of the previous N bars (not counting this one), so a close beyond it is a breakout.',
    [lengthIn(20)],
    triple('#26a69a', '#787b86', '#ef5350'),
    (bars, p) => {
      const n = intParam(p, 'length', 20);
      const upper = shiftBy(highest(highsOf(bars), n), 1);
      const lower = shiftBy(lowest(lowsOf(bars), n), 1);
      return { upper, lower, basis: upper.map((u, i) => (u + lower[i]) / 2) };
    },
  ),
  band(
    'envelopeema',
    'EMA Envelope',
    'EMA Env',
    'An EMA with bands a fixed percentage above and below.',
    [lengthIn(20), numIn('percent', 'Percent', 2.5, 0.1, 0.1, 50), sourceIn],
    triple('#ef5350', '#ff9800', '#26a69a'),
    (bars, p) => {
      const basis = ema(srcOf(bars, p), intParam(p, 'length', 20));
      const k = numParam(p, 'percent', 2.5) / 100;
      return { basis, upper: basis.map((b) => b * (1 + k)), lower: basis.map((b) => b * (1 - k)) };
    },
  ),
  band(
    'percentilebands',
    'Percentile Channel',
    'Pctl',
    'Where the top and bottom 10% of recent prices sit, with the median in between. Unaffected by single spikes.',
    [lengthIn(50, 'Length', 'length', 2), numIn('pct', 'Percentile (e.g. 10 = 10th/90th)', 10, 1, 1, 49), sourceIn],
    triple('#ef5350', '#787b86', '#26a69a'),
    (bars, p) => {
      const s = srcOf(bars, p);
      const n = intParam(p, 'length', 50, 2);
      const q = numParam(p, 'pct', 10) / 100;
      return { upper: rollingPercentile(s, n, 1 - q), basis: rollingPercentile(s, n, 0.5), lower: rollingPercentile(s, n, q) };
    },
  ),
  band(
    'emawave',
    'EMA Wave (High/Close/Low)',
    'EMA Wave',
    'EMAs of the highs, closes and lows. Price holding above the wave = uptrend; inside it = no clear trend.',
    [lengthIn(34)],
    [line('upper', 'EMA of highs', '#26a69a'), line('basis', 'EMA of closes', '#2962ff'), line('lower', 'EMA of lows', '#ef5350')],
    (bars, p) => {
      const n = intParam(p, 'length', 34);
      return { upper: ema(highsOf(bars), n), basis: ema(closesOf(bars), n), lower: ema(lowsOf(bars), n) };
    },
  ),
  band(
    'nwenvelope',
    'Nadaraya-Watson Envelope (no repaint)',
    'NW Env',
    'A kernel-regression centre line with bands a multiple of the average distance from it; past bars only, so it never repaints.',
    [lengthIn(100, 'Window', 'length', 2, 500), numIn('bandwidth', 'Bandwidth', 8, 0.5, 0.5, 100), numIn('mult', 'Width multiplier', 3, 0.1, 0.1, 10), sourceIn],
    triple('#ef5350', '#f9a825', '#26a69a'),
    (bars, p) => {
      const s = srcOf(bars, p);
      const n = intParam(p, 'length', 100, 2);
      const basis = kernelRegression(s, n, numParam(p, 'bandwidth', 8));
      const mae = sma(s.map((v, i) => Math.abs(v - basis[i])), n);
      return around(basis, mae, numParam(p, 'mult', 3));
    },
  ),
  band(
    'turtle',
    'Turtle Channels',
    'Turtle',
    "The Turtle Traders' breakout lines: the prior 20-bar high/low to enter and the prior 10-bar low/high to exit.",
    [lengthIn(20, 'Entry length', 'entry'), lengthIn(10, 'Exit length', 'exit')],
    [line('entryHigh', 'Entry high', '#26a69a', 2), line('exitLow', 'Exit low (longs)', '#80cbc4'), line('exitHigh', 'Exit high (shorts)', '#ef9a9a'), line('entryLow', 'Entry low', '#ef5350', 2)],
    (bars, p) => {
      const h = highsOf(bars);
      const l = lowsOf(bars);
      const e = intParam(p, 'entry', 20);
      const x = intParam(p, 'exit', 10);
      return { entryHigh: shiftBy(highest(h, e), 1), entryLow: shiftBy(lowest(l, e), 1), exitHigh: shiftBy(highest(h, x), 1), exitLow: shiftBy(lowest(l, x), 1) };
    },
  ),
];
