/**
 * Support and resistance levels for the overlay family: pivot points (floor/classic, Woodie, Camarilla, Fibonacci,
 * DeMark, Central Pivot Range) on day/week/month anchors, previous and current period levels, swing points
 * (Williams fractals, pivots, ZigZag), Fibonacci retracements, Tirone levels (Achelis), anchored VWAPs, the opening
 * range and round numbers. Day anchors use the New York date for intraday bars and the bar's own date otherwise.
 */
import { highest, lowest } from '../math';
import type { Bar } from '../../types';
import type { IndicatorDef, PlotDef } from '../types';
import { NaNs, anchorIn, atrOf, barSpacing, closesOf, gapAtStarts, highsOf, intParam, isNum, lengthIn, lowsOf, numIn, numParam, nyDate, periodKeys, previousPeriod } from './a-math';

const R = ['#ef9a9a', '#ef5350', '#b71c1c', '#880e4f'];
const S = ['#80cbc4', '#26a69a', '#00695c', '#004d40'];
const P = '#ff9800';
const line = (key: string, title: string, color: string, lineWidth: 1 | 2 | 3 | 4 = 1): PlotDef => ({ key, title, type: 'line', color, lineWidth });
const marker = (key: string, title: string, color: string, up: boolean): PlotDef => ({
  key,
  title,
  type: 'marker',
  color,
  marker: up ? { shape: 'arrowDown', position: 'aboveBar' } : { shape: 'arrowUp', position: 'belowBar' },
});

function level(id: string, name: string, shortName: string, description: string, inputs: IndicatorDef['inputs'], plots: PlotDef[], compute: IndicatorDef['compute']): IndicatorDef {
  return { id, name, shortName, category: 'Support & Resistance', description, placement: 'overlay', inputs, plots, compute };
}

// ---------- pivot points ----------

type Prev = { h: number; l: number; c: number; o: number; openNow: number };
type PivotFormula = (x: Prev) => Record<string, number>;

const PIVOT_TYPES: Record<string, { name: string; short: string; description: string; keys: string[]; f: PivotFormula }> = {
  pivotsclassic: {
    name: 'Pivot Points (Classic / Floor)',
    short: 'Pivots',
    description: "Floor-trader pivots from the previous period's high, low and close: P, R1-R3 and S1-S3.",
    keys: ['r3', 'r2', 'r1', 'p', 's1', 's2', 's3'],
    f: ({ h, l, c }) => {
      const p = (h + l + c) / 3;
      return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l), r3: h + 2 * (p - l), s3: l - 2 * (h - p) };
    },
  },
  pivotsfib: {
    name: 'Pivot Points (Fibonacci)',
    short: 'Fib Pivots',
    description: "Pivots spaced 38.2%, 61.8% and 100% of the previous period's range from the classic pivot.",
    keys: ['r3', 'r2', 'r1', 'p', 's1', 's2', 's3'],
    f: ({ h, l, c }) => {
      const p = (h + l + c) / 3;
      const r = h - l;
      return { p, r1: p + 0.382 * r, r2: p + 0.618 * r, r3: p + r, s1: p - 0.382 * r, s2: p - 0.618 * r, s3: p - r };
    },
  },
  pivotswoodie: {
    name: 'Pivot Points (Woodie)',
    short: 'Woodie',
    description: "Woodie's pivots: the pivot uses this period's open, (H + L + 2 × open) / 4, with the previous high and low.",
    keys: ['r3', 'r2', 'r1', 'p', 's1', 's2', 's3'],
    f: ({ h, l, openNow }) => {
      const p = (h + l + 2 * openNow) / 4;
      return { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l), r3: h + 2 * (p - l), s3: l - 2 * (h - p) };
    },
  },
  pivotscamarilla: {
    name: 'Pivot Points (Camarilla)',
    short: 'Camarilla',
    description: "Nick Scott's Camarilla levels: tight bands around the previous close at 1.1/12, /6, /4 and /2 of its range.",
    keys: ['r4', 'r3', 'r2', 'r1', 'p', 's1', 's2', 's3', 's4'],
    f: ({ h, l, c }) => {
      const r = (h - l) * 1.1;
      return { p: (h + l + c) / 3, r1: c + r / 12, r2: c + r / 6, r3: c + r / 4, r4: c + r / 2, s1: c - r / 12, s2: c - r / 6, s3: c - r / 4, s4: c - r / 2 };
    },
  },
  pivotsdemark: {
    name: 'Pivot Points (DeMark)',
    short: 'DeMark',
    description: "Tom DeMark's pivots: one level each side, weighted by whether the previous period closed up or down.",
    keys: ['r1', 'p', 's1'],
    f: ({ h, l, c, o }) => {
      const x = c < o ? h + 2 * l + c : c > o ? 2 * h + l + c : h + l + 2 * c;
      return { p: x / 4, r1: x / 2 - l, s1: x / 2 - h };
    },
  },
  pivotscpr: {
    name: 'Central Pivot Range (CPR)',
    short: 'CPR',
    description: 'The pivot with its top and bottom central levels. A narrow range often comes before a trending session.',
    keys: ['tc', 'p', 'bc'],
    f: ({ h, l, c }) => {
      const p = (h + l + c) / 3;
      const bc = (h + l) / 2;
      return { tc: 2 * p - bc, p, bc };
    },
  },
};

function pivotColor(key: string): string {
  if (key === 'p') return P;
  if (key === 'tc' || key === 'bc') return '#2962ff';
  const n = Number(key.slice(1)) - 1;
  return key[0] === 'r' ? R[n] : S[n];
}

function pivotDef(id: string): IndicatorDef {
  const t = PIVOT_TYPES[id];
  return level(
    id,
    t.name,
    t.short,
    t.description,
    [anchorIn(1)],
    t.keys.map((k) => line(k, k.toUpperCase(), pivotColor(k), k === 'p' ? 2 : 1)),
    (bars, p) => {
      const prev = previousPeriod(bars, intParam(p, 'anchor', 1));
      const out: Record<string, number[]> = Object.fromEntries(t.keys.map((k) => [k, NaNs(bars.length)]));
      for (let i = 0; i < bars.length; i++) {
        if (!isNum(prev.h[i])) continue;
        const v = t.f({ h: prev.h[i], l: prev.l[i], c: prev.c[i], o: prev.o[i], openNow: prev.curOpen[i] });
        for (const k of t.keys) out[k][i] = v[k];
      }
      return gapAtStarts(out, prev.first);
    },
  );
}

// ---------- swings ----------

/** Swing highs/lows: bar i is a pivot high when its high is above the `left` bars before and the `right` bars after. */
export function swingPoints(bars: Bar[], left: number, right: number): { highs: boolean[]; lows: boolean[] } {
  const n = bars.length;
  const highs = new Array<boolean>(n).fill(false);
  const lows = new Array<boolean>(n).fill(false);
  for (let i = left; i < n - right; i++) {
    let hi = true;
    let lo = true;
    for (let j = i - left; j <= i + right && (hi || lo); j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) hi = false;
      if (bars[j].low <= bars[i].low) lo = false;
    }
    highs[i] = hi;
    lows[i] = lo;
  }
  return { highs, lows };
}

/**
 * ZigZag through highs and lows: a swing is confirmed once price reverses by the threshold (`pct` percent of the
 * extreme, or `atrMult` ATRs). The line joins the confirmed swings; its last leg runs to the newest extreme, so it
 * redraws until the next swing is confirmed.
 */
export function zigzag(bars: Bar[], threshold: (i: number, ext: number) => number): number[] {
  const n = bars.length;
  const out = NaNs(n);
  const pivots: { i: number; v: number }[] = [];
  let dir = 0;
  let hiI = 0;
  let loI = 0;
  let extI = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    if (dir === 0) {
      if (b.high > bars[hiI].high) hiI = i;
      if (b.low < bars[loI].low) loI = i;
      const t = threshold(i, bars[hiI].high);
      const u = threshold(i, bars[loI].low);
      if (isNum(t) && hiI < i && bars[hiI].high - b.low >= t) {
        pivots.push({ i: hiI, v: bars[hiI].high });
        dir = -1;
        extI = i;
      } else if (isNum(u) && loI < i && b.high - bars[loI].low >= u) {
        pivots.push({ i: loI, v: bars[loI].low });
        dir = 1;
        extI = i;
      }
    } else if (dir === 1) {
      if (b.high > bars[extI].high) extI = i;
      else if (bars[extI].high - b.low >= threshold(i, bars[extI].high)) {
        pivots.push({ i: extI, v: bars[extI].high });
        dir = -1;
        extI = i;
      }
    } else if (b.low < bars[extI].low) extI = i;
    else if (b.high - bars[extI].low >= threshold(i, bars[extI].low)) {
      pivots.push({ i: extI, v: bars[extI].low });
      dir = 1;
      extI = i;
    }
  }
  if (!pivots.length) return out;
  pivots.push({ i: extI, v: dir === 1 ? bars[extI].high : bars[extI].low });
  for (let k = 0; k + 1 < pivots.length; k++) {
    const a = pivots[k];
    const b = pivots[k + 1];
    for (let i = a.i; i <= b.i; i++) out[i] = b.i === a.i ? a.v : a.v + ((b.v - a.v) * (i - a.i)) / (b.i - a.i);
  }
  return out;
}

// ---------- VWAP ----------

/** Volume-weighted average of the typical price from each reset, with standard-deviation bands. */
export function anchoredVwap(bars: Bar[], resets: boolean[], k1: number, k2: number): Record<string, number[]> {
  const n = bars.length;
  const out = { vwap: NaNs(n), u1: NaNs(n), l1: NaNs(n), u2: NaNs(n), l2: NaNs(n) };
  let pv = 0;
  let pv2 = 0;
  let vol = 0;
  let started = false;
  for (let i = 0; i < n; i++) {
    if (resets[i]) (pv = 0), (pv2 = 0), (vol = 0), (started = true);
    if (!started) continue;
    const b = bars[i];
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume > 0 ? b.volume : 0;
    pv += tp * v;
    pv2 += tp * tp * v;
    vol += v;
    if (vol <= 0) continue;
    const w = pv / vol;
    const sd = Math.sqrt(Math.max(0, pv2 / vol - w * w));
    out.vwap[i] = w;
    out.u1[i] = w + k1 * sd;
    out.l1[i] = w - k1 * sd;
    out.u2[i] = w + k2 * sd;
    out.l2[i] = w - k2 * sd;
  }
  return out;
}

const vwapPlots: PlotDef[] = [line('u2', 'Upper 2', '#ef9a9a'), line('u1', 'Upper 1', '#f48fb1'), line('vwap', 'VWAP', '#e91e63', 2), line('l1', 'Lower 1', '#f48fb1'), line('l2', 'Lower 2', '#ef9a9a')];
const bandInputs = [numIn('k1', 'Band 1 (std dev)', 1, 0.1, 0, 10), numIn('k2', 'Band 2 (std dev)', 2, 0.1, 0, 10)];

/** Most recent value of `flags` up to each bar (for levels from confirmed swing points). */
function lastTwo(n: number, at: { confirm: number; v: number }[]): [number[], number[]] {
  const a = NaNs(n);
  const b = NaNs(n);
  let k = 0;
  let one = NaN;
  let two = NaN;
  for (let i = 0; i < n; i++) {
    while (k < at.length && at[k].confirm <= i) (two = one), (one = at[k++].v);
    a[i] = one;
    b[i] = two;
  }
  return [a, b];
}

export const LEVELS: IndicatorDef[] = [
  ...Object.keys(PIVOT_TYPES).map(pivotDef),
  level(
    'prevhlc',
    'Previous Period High/Low/Close',
    'Prev HLC',
    "Yesterday's (or last week's / month's) high, low and close: levels traders watch for a reaction.",
    [anchorIn(1)],
    [line('ph', 'Prev high', R[1]), line('pc', 'Prev close', P), line('pl', 'Prev low', S[1])],
    (bars, p) => {
      const prev = previousPeriod(bars, intParam(p, 'anchor', 1));
      return gapAtStarts({ ph: prev.h, pl: prev.l, pc: prev.c }, prev.first);
    },
  ),
  level(
    'periodhl',
    'Current Period Open/High/Low',
    'Period HL',
    "Today's (or this week's / month's) open with the running high and low so far.",
    [anchorIn(1)],
    [line('hi', 'High so far', R[1]), line('open', 'Open', P), line('lo', 'Low so far', S[1])],
    (bars, p) => {
      const keys = periodKeys(bars, intParam(p, 'anchor', 1));
      const hi = NaNs(bars.length);
      const lo = NaNs(bars.length);
      const open = NaNs(bars.length);
      const first = keys.map((k, i) => i === 0 || k !== keys[i - 1]);
      bars.forEach((b, i) => {
        hi[i] = first[i] ? b.high : Math.max(hi[i - 1], b.high);
        lo[i] = first[i] ? b.low : Math.min(lo[i - 1], b.low);
        open[i] = first[i] ? b.open : open[i - 1];
      });
      return gapAtStarts({ hi, lo, open }, first);
    },
  ),
  level(
    'fractals',
    'Williams Fractals',
    'Fractals',
    "Bill Williams' fractals: a high with two lower highs each side (or a low with two higher lows). Shown 2 bars late, when confirmed.",
    [],
    [marker('up', 'Up fractal (high)', '#ef5350', true), marker('down', 'Down fractal (low)', '#26a69a', false)],
    (bars) => {
      const s = swingPoints(bars, 2, 2);
      return { up: s.highs.map(Number), down: s.lows.map(Number) };
    },
  ),
  level(
    'pivothl',
    'Pivot Highs and Lows',
    'Pivot HL',
    'Swing highs and lows: a bar higher (lower) than N bars on each side. Marked on the swing bar once the right side has formed.',
    [lengthIn(5, 'Left bars', 'left'), lengthIn(5, 'Right bars', 'right')],
    [marker('high', 'Pivot high', '#ef5350', true), marker('low', 'Pivot low', '#26a69a', false)],
    (bars, p) => {
      const s = swingPoints(bars, intParam(p, 'left', 5), intParam(p, 'right', 5));
      return { high: s.highs.map(Number), low: s.lows.map(Number) };
    },
  ),
  level(
    'autosr',
    'Auto Support & Resistance',
    'Auto S/R',
    'The two most recent confirmed swing highs (resistance) and swing lows (support), updated as new swings form.',
    [lengthIn(10, 'Swing strength (bars each side)', 'strength', 1, 100)],
    [line('r2', 'Resistance 2', R[0]), line('r1', 'Resistance 1', R[1], 2), line('s1', 'Support 1', S[1], 2), line('s2', 'Support 2', S[0])],
    (bars, p) => {
      const k = intParam(p, 'strength', 10);
      const s = swingPoints(bars, k, k);
      const hs = s.highs.flatMap((v, i) => (v ? [{ confirm: i + k, v: bars[i].high }] : []));
      const ls = s.lows.flatMap((v, i) => (v ? [{ confirm: i + k, v: bars[i].low }] : []));
      const [r1, r2] = lastTwo(bars.length, hs);
      const [s1, s2] = lastTwo(bars.length, ls);
      return { r1, r2, s1, s2 };
    },
  ),
  level(
    'zigzag',
    'ZigZag (percent)',
    'ZigZag',
    'Joins swing highs and lows that are at least N% apart, hiding smaller moves. The last leg redraws until the swing is confirmed.',
    [numIn('pct', 'Reversal %', 5, 0.1, 0.1, 50)],
    [line('zigzag', 'ZigZag', '#2962ff', 2)],
    (bars, p) => {
      const k = numParam(p, 'pct', 5) / 100;
      return { zigzag: zigzag(bars, (_i, ext) => ext * k) };
    },
  ),
  level(
    'zigzagatr',
    'ZigZag (ATR)',
    'ZigZag ATR',
    'A ZigZag whose reversal size is a multiple of ATR, so it adapts to volatility. The last leg redraws.',
    [lengthIn(14, 'ATR length'), numIn('mult', 'ATR multiplier', 3, 0.1, 0.1, 20)],
    [line('zigzag', 'ZigZag', '#7e57c2', 2)],
    (bars, p) => {
      const atr = atrOf(bars, intParam(p, 'length', 14));
      const m = numParam(p, 'mult', 3);
      return { zigzag: zigzag(bars, (i) => (isNum(atr[i]) ? m * atr[i] : NaN)) };
    },
  ),
  level(
    'fibretrace',
    'Auto Fibonacci Retracement',
    'Auto Fib',
    'Fibonacci retracement levels (23.6%, 38.2%, 50%, 61.8%, 78.6%) of the range of the last N bars, measured back from the latest extreme.',
    [lengthIn(100, 'Look-back', 'length', 2)],
    [
      line('f0', '0%', '#787b86'),
      line('f236', '23.6%', '#ef5350'),
      line('f382', '38.2%', '#ff9800'),
      line('f500', '50%', '#4caf50'),
      line('f618', '61.8%', '#2196f3'),
      line('f786', '78.6%', '#7e57c2'),
      line('f100', '100%', '#787b86'),
    ],
    (bars, p) => {
      const n = intParam(p, 'length', 100, 2);
      const keys = ['f0', 'f236', 'f382', 'f500', 'f618', 'f786', 'f100'];
      const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const out: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, NaNs(bars.length)]));
      for (let i = n - 1; i < bars.length; i++) {
        let hi = i;
        let lo = i;
        for (let j = i - n + 1; j <= i; j++) {
          if (bars[j].high >= bars[hi].high) hi = j;
          if (bars[j].low <= bars[lo].low) lo = j;
        }
        const top = bars[hi].high;
        const bottom = bars[lo].low;
        const up = hi >= lo; // the high came last: measure the pullback down from it
        keys.forEach((k, j) => (out[k][i] = up ? top - (top - bottom) * ratios[j] : bottom + (top - bottom) * ratios[j]));
      }
      return out;
    },
  ),
  level(
    'tirone',
    'Tirone Levels (Midpoint)',
    'Tirone',
    "John Tirone's levels: one third, one half and two thirds of the way through the recent high-low range.",
    [lengthIn(20)],
    [line('top', 'Top (2/3)', R[1]), line('center', 'Centre (1/2)', P), line('bottom', 'Bottom (1/3)', S[1])],
    (bars, p) => {
      const n = intParam(p, 'length', 20);
      const hh = highest(highsOf(bars), n);
      const ll = lowest(lowsOf(bars), n);
      return { top: hh.map((h, i) => h - (h - ll[i]) / 3), center: hh.map((h, i) => ll[i] + (h - ll[i]) / 2), bottom: hh.map((h, i) => ll[i] + (h - ll[i]) / 3) };
    },
  ),
  level(
    'tironemean',
    'Tirone Levels (Mean)',
    'Tirone Mean',
    "Tirone's mean method: the adjusted mean of the range and close, with regular and extreme highs and lows around it.",
    [lengthIn(20)],
    [line('eh', 'Extreme high', R[2]), line('rh', 'Regular high', R[1]), line('am', 'Adjusted mean', P, 2), line('rl', 'Regular low', S[1]), line('el', 'Extreme low', S[2])],
    (bars, p) => {
      const n = intParam(p, 'length', 20);
      const hh = highest(highsOf(bars), n);
      const ll = lowest(lowsOf(bars), n);
      const c = closesOf(bars);
      const am = hh.map((h, i) => (h + ll[i] + c[i]) / 3);
      return { am, eh: am.map((m, i) => m + (hh[i] - ll[i])), rh: am.map((m, i) => 2 * m - ll[i]), rl: am.map((m, i) => 2 * m - hh[i]), el: am.map((m, i) => m - (hh[i] - ll[i])) };
    },
  ),
  level(
    'vwapanchor',
    'VWAP (Session / Week / Month) with Bands',
    'VWAP+',
    'Volume-weighted average price restarting each New York session, week, month, quarter or year, with standard-deviation bands.',
    [anchorIn(1, 5), ...bandInputs],
    vwapPlots,
    (bars, p) => {
      const keys = periodKeys(bars, intParam(p, 'anchor', 1));
      const first = keys.map((k, i) => i === 0 || k !== keys[i - 1]);
      return gapAtStarts(anchoredVwap(bars, first, numParam(p, 'k1', 1), numParam(p, 'k2', 2)), first);
    },
  ),
  level(
    'avwap',
    'Anchored VWAP (bars back)',
    'AVWAP',
    'VWAP measured from a chosen number of bars ago (for example from a big earnings bar), with standard-deviation bands.',
    [lengthIn(50, 'Anchor (bars back)', 'length', 1, 5000), ...bandInputs],
    vwapPlots,
    (bars, p) => {
      const start = Math.max(0, bars.length - intParam(p, 'length', 50));
      return anchoredVwap(bars, bars.map((_, i) => i === start), numParam(p, 'k1', 1), numParam(p, 'k2', 2));
    },
  ),
  level(
    'openingrange',
    'Opening Range',
    'ORB',
    'High and low of the first N minutes of the New York session (9:30 ET), drawn until the next session’s range is set. Intraday charts only.',
    [lengthIn(30, 'Minutes', 'minutes', 1, 390)],
    [line('high', 'OR high', '#26a69a', 2), line('low', 'OR low', '#ef5350', 2)],
    (bars, p) => {
      const n = bars.length;
      const high = NaNs(n);
      const low = NaNs(n);
      const spacing = barSpacing(bars);
      if (!(spacing > 0 && spacing < 86400)) return { high, low };
      const end = 570 + intParam(p, 'minutes', 30);
      // the range being built (today) and the latest finished one, shown until the next day's range is complete
      let day = '';
      let hi = NaN;
      let lo = NaN;
      let shownHi = NaN;
      let shownLo = NaN;
      for (let i = 0; i < n; i++) {
        const d = nyDate(bars[i].time);
        const key = `${d.y}-${d.m}-${d.d}`;
        const minute = d.h * 60 + d.minute;
        // a bar counts when any part of it falls inside the window (an hourly 9:00 bar covers 9:30-10:00)
        if (minute < end && minute + spacing / 60 > 570) {
          if (key !== day) (day = key), (hi = bars[i].high), (lo = bars[i].low);
          else (hi = Math.max(hi, bars[i].high)), (lo = Math.min(lo, bars[i].low));
          continue;
        }
        if (isNum(hi)) (shownHi = hi), (shownLo = lo);
        high[i] = shownHi;
        low[i] = shownLo;
      }
      return { high, low };
    },
  ),
  level(
    'roundlevels',
    'Round Number Levels',
    'Round #',
    'The nearest round numbers above and below price (psychological levels). Step 0 picks one from the price.',
    [numIn('step', 'Step (0 = auto)', 0, 0.5, 0, 100000)],
    [line('above', 'Round above', R[1]), line('below', 'Round below', S[1])],
    (bars, p) => {
      const fixed = numParam(p, 'step', 0);
      const step = (c: number) => (fixed > 0 ? fixed : c > 0 ? 10 ** (Math.floor(Math.log10(c)) - 1) * 5 : NaN);
      return {
        above: bars.map((b) => Math.ceil(b.close / step(b.close)) * step(b.close)),
        below: bars.map((b) => Math.floor(b.close / step(b.close)) * step(b.close)),
      };
    },
  ),
];
