/**
 * Trend lines and trailing stops drawn on the price chart. References: StockCharts ChartSchool (Chandelier Exit),
 * TA-Lib (CKSP, SAREXT, TYPPRICE, MEDPRICE, WCLPRICE, AVGPRICE), Alexander
 * Elder (SafeZone, "Come Into My Trading Room"), Robert Krausz (Gann HiLo Activator), Bill Williams (Alligator),
 * Steve Nison (Renko, Kagi, Three Line Break, "Beyond Candlesticks").
 */
import { highest, lowest, stdev } from '../math';
import type { Bar } from '../../types';
import type { IndicatorDef, PlotDef } from '../types';
import { NaNs, atrOf, closesOf, highsOf, intParam, isNum, lengthIn, lowsOf, numIn, numParam, rma, shiftBy, sma } from './a-math';

const UP = '#26a69a';
const DOWN = '#ef5350';
const line = (key: string, title: string, color: string, lineWidth: 1 | 2 | 3 | 4 = 2, style?: 'dots'): PlotDef => ({ key, title, type: 'line', color, lineWidth, ...(style ? { style } : {}) });
const upDown = (style?: 'dots'): PlotDef[] => [line('up', 'Up trend', UP, 2, style), line('down', 'Down trend', DOWN, 2, style)];

function trend(id: string, name: string, shortName: string, description: string, inputs: IndicatorDef['inputs'], plots: PlotDef[], compute: IndicatorDef['compute']): IndicatorDef {
  return { id, name, shortName, category: 'Trend', description, placement: 'overlay', inputs, plots, compute };
}

/** Splits one stop line into an up-trend and a down-trend plot. */
function split(values: number[], dirs: number[]): { up: number[]; down: number[] } {
  return { up: values.map((v, i) => (dirs[i] > 0 ? v : NaN)), down: values.map((v, i) => (dirs[i] < 0 ? v : NaN)) };
}

/** Parabolic SAR with separate long/short acceleration, ported from TA-Lib SAREXT (positive = long, negative = short). */
export function sarExt(
  bars: Bar[],
  o: { initLong: number; incLong: number; maxLong: number; initShort: number; incShort: number; maxShort: number; offset: number },
): number[] {
  const out = NaNs(bars.length);
  if (bars.length < 2) return out;
  const initLong = Math.min(o.initLong, o.maxLong);
  const incLong = Math.min(o.incLong, o.maxLong);
  const initShort = Math.min(o.initShort, o.maxShort);
  const incShort = Math.min(o.incShort, o.maxShort);
  let afLong = initLong;
  let afShort = initShort;
  const h = (i: number) => bars[i].high;
  const l = (i: number) => bars[i].low;
  // TA-Lib starts short when bar 1 has a positive minus directional movement
  const plusDm = h(1) - h(0);
  const minusDm = l(0) - l(1);
  let long = !(minusDm > 0 && minusDm > plusDm);
  let ep = long ? h(1) : l(1);
  let sar = long ? l(0) : h(0);
  let newLow = l(1);
  let newHigh = h(1);
  for (let i = 1; i < bars.length; i++) {
    const prevLow = newLow;
    const prevHigh = newHigh;
    newLow = l(i);
    newHigh = h(i);
    if (long) {
      if (newLow <= sar) {
        long = false;
        sar = Math.max(ep, prevHigh, newHigh);
        if (o.offset) sar += sar * o.offset;
        out[i] = -sar;
        afShort = initShort;
        ep = newLow;
        sar = Math.max(sar + afShort * (ep - sar), prevHigh, newHigh);
      } else {
        out[i] = sar;
        if (newHigh > ep) {
          ep = newHigh;
          afLong = Math.min(o.maxLong, afLong + incLong);
        }
        sar = Math.min(sar + afLong * (ep - sar), prevLow, newLow);
      }
    } else if (newHigh >= sar) {
      long = true;
      sar = Math.min(ep, prevLow, newLow);
      if (o.offset) sar -= sar * o.offset;
      out[i] = sar;
      afLong = initLong;
      ep = newHigh;
      sar = Math.min(sar + afLong * (ep - sar), prevLow, newLow);
    } else {
      out[i] = -sar;
      if (newLow < ep) {
        ep = newLow;
        afShort = Math.min(o.maxShort, afShort + incShort);
      }
      sar = Math.max(sar + afShort * (ep - sar), prevHigh, newHigh);
    }
  }
  return out;
}

/** Elder's SafeZone stops: yesterday's low minus k × the average downside penetration (longs), held for 3 bars. */
export function safeZone(bars: Bar[], length: number, k: number): { long: number[]; short: number[] } {
  const n = bars.length;
  const avgPen = (down: boolean) => {
    const pen = bars.map((b, i) => (i === 0 ? NaN : down ? Math.max(0, bars[i - 1].low - b.low) : Math.max(0, b.high - bars[i - 1].high)));
    const out = NaNs(n);
    for (let i = length; i < n; i++) {
      let sum = 0;
      let count = 0;
      for (let j = i - length + 1; j <= i; j++) if (pen[j] > 0) (sum += pen[j]), count++;
      out[i] = count ? sum / count : 0;
    }
    return out;
  };
  const dn = avgPen(true);
  const up = avgPen(false);
  const rawLong = bars.map((_, i) => (i > 0 ? bars[i - 1].low - k * dn[i - 1] : NaN));
  const rawShort = bars.map((_, i) => (i > 0 ? bars[i - 1].high + k * up[i - 1] : NaN));
  const long = rawLong.map((_, i) => (i >= 2 && [0, 1, 2].every((j) => isNum(rawLong[i - j])) ? Math.max(rawLong[i], rawLong[i - 1], rawLong[i - 2]) : NaN));
  const short = rawShort.map((_, i) => (i >= 2 && [0, 1, 2].every((j) => isNum(rawShort[i - j])) ? Math.min(rawShort[i], rawShort[i - 1], rawShort[i - 2]) : NaN));
  return { long, short };
}

/** Gann HiLo Activator: shows the SMA of lows while closes beat the previous SMA of highs, and vice versa. */
export function hiLoActivator(bars: Bar[], length: number): { value: number[]; dir: number[] } {
  const hi = sma(highsOf(bars), length);
  const lo = sma(lowsOf(bars), length);
  const value = NaNs(bars.length);
  const dir = new Array<number>(bars.length).fill(0);
  let d = 0;
  for (let i = 1; i < bars.length; i++) {
    if (!isNum(hi[i - 1])) continue;
    if (bars[i].close > hi[i - 1]) d = 1;
    else if (bars[i].close < lo[i - 1]) d = -1;
    if (d === 0) continue;
    dir[i] = d;
    value[i] = d > 0 ? lo[i] : hi[i];
  }
  return { value, dir };
}

/** Nick Rypock Trailing Reverse: a stop a fixed percentage from the best close of the current swing. */
export function nrtr(closes: number[], pct: number): { stop: number[]; dir: number[] } {
  const k = pct / 100;
  const stop = NaNs(closes.length);
  const dir = new Array<number>(closes.length).fill(0);
  if (closes.length < 2) return { stop, dir };
  let up = closes[1] >= closes[0];
  let ext = closes[0];
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i];
    if (up) {
      ext = Math.max(ext, c);
      if (c < ext * (1 - k)) (up = false), (ext = c);
    } else {
      ext = Math.min(ext, c);
      if (c > ext * (1 + k)) (up = true), (ext = c);
    }
    stop[i] = up ? ext * (1 - k) : ext * (1 + k);
    dir[i] = up ? 1 : -1;
  }
  return { stop, dir };
}

/** Renko brick level with boxes a percentage of price; a reversal needs two boxes (Nison). */
export function renko(closes: number[], pct: number): { level: number[]; dir: number[] } {
  const level = NaNs(closes.length);
  const dirs = new Array<number>(closes.length).fill(0);
  if (!closes.length) return { level, dir: dirs };
  const k = pct / 100;
  let lv = closes[0];
  let d = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const box = () => Math.abs(lv) * k;
    if (box() > 0) {
      if (d >= 0 && c >= lv + box()) {
        while (c >= lv + box()) lv += box();
        d = 1;
      } else if (d <= 0 && c <= lv - box()) {
        while (c <= lv - box() && lv - box() > 0) lv -= box();
        d = -1;
      } else if (d === 1 && c <= lv - 2 * box()) {
        lv -= 2 * box();
        while (c <= lv - box() && lv - box() > 0) lv -= box();
        d = -1;
      } else if (d === -1 && c >= lv + 2 * box()) {
        lv += 2 * box();
        while (c >= lv + box()) lv += box();
        d = 1;
      }
    }
    level[i] = lv;
    dirs[i] = d >= 0 ? 1 : -1;
  }
  return { level, dir: dirs };
}

/** Kagi line: follows new extremes and turns only after a reversal of `pct` percent (Nison). */
export function kagi(closes: number[], pct: number): { level: number[]; dir: number[] } {
  const k = pct / 100;
  const level = NaNs(closes.length);
  const dirs = new Array<number>(closes.length).fill(0);
  if (!closes.length) return { level, dir: dirs };
  let lv = closes[0];
  let d = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (d === 0) {
      if (c >= lv * (1 + k) && c > lv) (d = 1), (lv = c);
      else if (c <= lv * (1 - k) && c < lv) (d = -1), (lv = c);
    } else if (d === 1) {
      if (c > lv) lv = c;
      else if (c <= lv * (1 - k)) (d = -1), (lv = c);
    } else if (c < lv) lv = c;
    else if (c >= lv * (1 + k)) (d = 1), (lv = c);
    level[i] = lv;
    dirs[i] = d >= 0 ? 1 : -1;
  }
  return { level, dir: dirs };
}

/** Three Line Break: a new line on a new closing extreme; a reversal must break the last `count` lines. */
export function lineBreak(closes: number[], count: number): { level: number[]; dir: number[] } {
  const level = NaNs(closes.length);
  const dirs = new Array<number>(closes.length).fill(0);
  const lines: { open: number; close: number }[] = [];
  let d = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (!lines.length) {
      if (i > 0 && c !== closes[0]) {
        lines.push({ open: closes[0], close: c });
        d = c > closes[0] ? 1 : -1;
      }
    } else {
      const last = lines[lines.length - 1];
      const recent = lines.slice(-count);
      const top = Math.max(...recent.map((x) => Math.max(x.open, x.close)));
      const bottom = Math.min(...recent.map((x) => Math.min(x.open, x.close)));
      if (d === 1 && c > last.close) lines.push({ open: last.close, close: c });
      else if (d === -1 && c < last.close) lines.push({ open: last.close, close: c });
      else if (d === 1 && c < bottom) (lines.push({ open: last.open, close: c }), (d = -1));
      else if (d === -1 && c > top) (lines.push({ open: last.open, close: c }), (d = 1));
    }
    if (lines.length) {
      level[i] = lines[lines.length - 1].close;
      dirs[i] = d;
    }
    if (lines.length > count + 2) lines.shift();
  }
  return { level, dir: dirs };
}

function priceLine(id: string, name: string, shortName: string, description: string, color: string, fn: (b: Bar) => number): IndicatorDef {
  return trend(id, name, shortName, description, [], [line('price', shortName, color)], (bars) => ({ price: bars.map(fn) }));
}

const dirsToUpDown = (r: { stop?: number[]; level?: number[]; value?: number[]; dir: number[] }) => split((r.stop ?? r.level ?? r.value)!, r.dir);

export const TREND_LINES: IndicatorDef[] = [
  trend(
    'chandelier',
    'Chandelier Exit',
    'CE',
    "Chuck LeBeau's trailing stops: N-bar highest high minus 3 ATRs for longs, lowest low plus 3 ATRs for shorts.",
    [lengthIn(22), numIn('mult', 'ATR multiplier', 3, 0.1, 0.1, 10)],
    [line('long', 'Long exit', UP), line('short', 'Short exit', DOWN)],
    (bars, p) => {
      const n = intParam(p, 'length', 22);
      const m = numParam(p, 'mult', 3);
      const atr = atrOf(bars, n);
      const hh = highest(highsOf(bars), n);
      const ll = lowest(lowsOf(bars), n);
      return { long: hh.map((h, i) => h - m * atr[i]), short: ll.map((l, i) => l + m * atr[i]) };
    },
  ),
  trend(
    'kasedev',
    'Kase-style Dev Stops (approximation)',
    'DevStop≈',
    "An approximation of Cynthia Kase's DevStops: trailing stops 1, 2.2 and 3.6 standard deviations of the two-bar range beyond its average.",
    [lengthIn(30, 'Range length', 'length', 2), lengthIn(10, 'Fast MA', 'fast'), lengthIn(21, 'Slow MA', 'slow')],
    [line('dev1', 'Warning (1 SD)', '#ffb300', 1), line('dev2', 'Stop (2.2 SD)', '#ff6d00', 1), line('dev3', 'Wide stop (3.6 SD)', '#b71c1c', 1)],
    (bars, p) => {
      const n = intParam(p, 'length', 30, 2);
      const c = closesOf(bars);
      const range = bars.map((b, i) => (i === 0 ? NaN : Math.max(b.high, bars[i - 1].high) - Math.min(b.low, bars[i - 1].low)));
      const avg = sma(range, n);
      const sd = stdev(range, n);
      const fast = sma(c, intParam(p, 'fast', 10));
      const slow = sma(c, intParam(p, 'slow', 21));
      const out: Record<string, number[]> = {};
      for (const [key, k] of [['dev1', 1], ['dev2', 2.2], ['dev3', 3.6]] as const) {
        const values = NaNs(bars.length);
        let prev = NaN;
        let prevUp: boolean | null = null;
        for (let i = 0; i < bars.length; i++) {
          if (!isNum(avg[i]) || !isNum(fast[i]) || !isNum(slow[i])) continue;
          const up = fast[i] >= slow[i];
          const width = avg[i] + k * sd[i];
          const raw = up ? c[i] - width : c[i] + width;
          prev = prevUp === up && isNum(prev) ? (up ? Math.max(prev, raw) : Math.min(prev, raw)) : raw;
          prevUp = up;
          values[i] = prev;
        }
        out[key] = values;
      }
      return out;
    },
  ),
  trend(
    'cksp',
    'Chande Kroll Stop',
    'CKSP',
    'Two ATR-based stop lines from the recent highest high and lowest low, smoothed by a second look-back (TA-Lib CKSP).',
    [lengthIn(10, 'ATR length', 'length', 2), numIn('mult', 'ATR multiplier', 1, 0.1, 0.1, 10), lengthIn(9, 'Stop length', 'stop')],
    [line('highStop', 'Long stop (from highs)', UP), line('lowStop', 'Short stop (from lows)', DOWN)],
    (bars, p) => {
      const n = intParam(p, 'length', 10, 2);
      const x = numParam(p, 'mult', 1);
      const q = intParam(p, 'stop', 9);
      const atr = atrOf(bars, n);
      const first = highest(highsOf(bars), n).map((h, i) => h - x * atr[i]);
      const firstLow = lowest(lowsOf(bars), n).map((l, i) => l + x * atr[i]);
      return { highStop: highest(first, q), lowStop: lowest(firstLow, q) };
    },
  ),
  trend(
    'psarext',
    'Parabolic SAR (Extended)',
    'SAREXT',
    'Parabolic SAR with separate acceleration for long and short trends (TA-Lib SAREXT).',
    [
      numIn('initLong', 'Long start', 0.02, 0.001, 0, 1),
      numIn('incLong', 'Long increment', 0.02, 0.001, 0, 1),
      numIn('maxLong', 'Long maximum', 0.2, 0.01, 0, 1),
      numIn('initShort', 'Short start', 0.02, 0.001, 0, 1),
      numIn('incShort', 'Short increment', 0.02, 0.001, 0, 1),
      numIn('maxShort', 'Short maximum', 0.2, 0.01, 0, 1),
      numIn('offset', 'Offset on reverse (%)', 0, 0.1, 0, 10),
    ],
    [line('long', 'Long SAR', UP, 2, 'dots'), line('short', 'Short SAR', DOWN, 2, 'dots')],
    (bars, p) => {
      const sar = sarExt(bars, {
        initLong: numParam(p, 'initLong', 0.02),
        incLong: numParam(p, 'incLong', 0.02),
        maxLong: numParam(p, 'maxLong', 0.2),
        initShort: numParam(p, 'initShort', 0.02),
        incShort: numParam(p, 'incShort', 0.02),
        maxShort: numParam(p, 'maxShort', 0.2),
        offset: numParam(p, 'offset', 0) / 100,
      });
      return { long: sar.map((v) => (v > 0 ? v : NaN)), short: sar.map((v) => (v < 0 ? -v : NaN)) };
    },
  ),
  trend(
    'safezone',
    'Elder SafeZone Stops',
    'SafeZone',
    "Alexander Elder's stops: beyond the previous bar by a multiple of the average recent penetration, never loosening for 3 bars.",
    [lengthIn(10, 'Look-back'), numIn('mult', 'Coefficient', 2, 0.1, 0.1, 10)],
    [line('long', 'Long stop', UP, 2, 'dots'), line('short', 'Short stop', DOWN, 2, 'dots')],
    (bars, p) => safeZone(bars, intParam(p, 'length', 10), numParam(p, 'mult', 2)),
  ),
  trend(
    'hilo',
    'Gann HiLo Activator',
    'HiLo',
    'An average of recent lows under price in up-trends and of recent highs over price in down-trends.',
    [lengthIn(3)],
    upDown(),
    (bars, p) => dirsToUpDown(hiLoActivator(bars, intParam(p, 'length', 3))),
  ),
  trend(
    'alligator',
    'Williams Alligator',
    'Alligator',
    "Bill Williams' three smoothed averages shifted forward: Jaw (13/8), Teeth (8/5), Lips (5/3). Tangled = asleep, fanned = trending.",
    [lengthIn(13, 'Jaw length', 'jaw'), lengthIn(8, 'Jaw shift', 'jawShift', 0), lengthIn(8, 'Teeth length', 'teeth'), lengthIn(5, 'Teeth shift', 'teethShift', 0), lengthIn(5, 'Lips length', 'lips'), lengthIn(3, 'Lips shift', 'lipsShift', 0)],
    [line('jaw', 'Jaw', '#2962ff'), line('teeth', 'Teeth', DOWN), line('lips', 'Lips', '#43a047')],
    (bars, p) => {
      const hl2 = bars.map((b) => (b.high + b.low) / 2);
      const s = (len: string, sh: string, a: number, b: number) => shiftBy(rma(hl2, intParam(p, len, a)), intParam(p, sh, b, 0));
      return { jaw: s('jaw', 'jawShift', 13, 8), teeth: s('teeth', 'teethShift', 8, 5), lips: s('lips', 'lipsShift', 5, 3) };
    },
  ),
  trend(
    'nrtr',
    'NRTR (Nick Rypock Trailing Reverse)',
    'NRTR',
    'A stop a fixed percentage from the best close of the current swing; it reverses when price closes through it.',
    [numIn('pct', 'Percent', 2, 0.1, 0.1, 50)],
    upDown(),
    (bars, p) => dirsToUpDown(nrtr(closesOf(bars), numParam(p, 'pct', 2))),
  ),
  trend(
    'heikinashi',
    'Heikin-Ashi Values',
    'HA',
    'Heikin-Ashi open and close as lines on a normal chart: the open/close of smoothed candles that filter noise.',
    [],
    [line('haOpen', 'HA open', '#ff9800', 1), line('haClose', 'HA close', '#2962ff', 2), line('haHigh', 'HA high', '#90a4ae', 1), line('haLow', 'HA low', '#90a4ae', 1)],
    (bars) => {
      const o: number[] = [];
      const c: number[] = [];
      bars.forEach((b, i) => {
        c.push((b.open + b.high + b.low + b.close) / 4);
        o.push(i ? (o[i - 1] + c[i - 1]) / 2 : (b.open + b.close) / 2);
      });
      return { haOpen: o, haClose: c, haHigh: bars.map((b, i) => Math.max(b.high, o[i], c[i])), haLow: bars.map((b, i) => Math.min(b.low, o[i], c[i])) };
    },
  ),
  trend(
    'renko',
    'Renko Trend Line',
    'Renko',
    'The level of the latest Renko brick (box = a % of price). It moves only after a full box, ignoring small wiggles.',
    [numIn('box', 'Box size %', 2, 0.1, 0.1, 50)],
    upDown(),
    (bars, p) => dirsToUpDown(renko(closesOf(bars), numParam(p, 'box', 2))),
  ),
  trend(
    'kagi',
    'Kagi Trend Line',
    'Kagi',
    'The Kagi line: follows new closing extremes and turns only after a reversal of a set percentage.',
    [numIn('pct', 'Reversal %', 4, 0.1, 0.1, 50)],
    upDown(),
    (bars, p) => dirsToUpDown(kagi(closesOf(bars), numParam(p, 'pct', 4))),
  ),
  trend(
    'linebreak',
    'Three Line Break Level',
    'LB',
    'The close of the latest Three Line Break line: a new line on each new closing high/low; reversals must beat the last 3 lines.',
    [lengthIn(3, 'Lines to break', 'lines', 1, 10)],
    upDown(),
    (bars, p) => dirsToUpDown(lineBreak(closesOf(bars), intParam(p, 'lines', 3))),
  ),
  priceLine('typprice', 'Typical Price', 'TP', 'The average of high, low and close: (H + L + C) / 3.', '#7e57c2', (b) => (b.high + b.low + b.close) / 3),
  priceLine('medprice', 'Median Price', 'MP', 'The middle of each bar: (H + L) / 2.', '#78909c', (b) => (b.high + b.low) / 2),
  priceLine('wclprice', 'Weighted Close', 'WC', 'The bar average with the close counted twice: (H + L + 2C) / 4.', '#5c6bc0', (b) => (b.high + b.low + 2 * b.close) / 4),
  priceLine('avgprice', 'Average Price', 'AP', 'The average of open, high, low and close.', '#8d6e63', (b) => (b.open + b.high + b.low + b.close) / 4),
];
