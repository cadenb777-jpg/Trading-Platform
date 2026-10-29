/**
 * Family D, part 1: volume indicators (StockCharts ChartSchool, Achelis "Technical Analysis from A to Z", TA-Lib and
 * the authors' own definitions). Every compute() returns arrays aligned with the bars, NaN during warm-up.
 * Already in the library (not repeated here): Volume, VWAP, VWAP bands, VWMA, OBV, A/D, CMF, MFI, Williams A/D.
 */
import type { Bar } from '../../types';
import type { IndicatorGuide } from '../info';
import { ema, highest, lowest, rma, sma, stdev } from '../math';
import { rollingSum } from '../more';
import type { IndicatorDef, IndicatorInput, IndicatorParams, PriceSource } from '../types';

const UP = '#26a69a';
const DOWN = '#ef5350';
const BLUE = '#2962ff';
const ORANGE = '#ff9800';
const PURPLE = '#7e57c2';
const TEAL = '#26c6da';
const PINK = '#e91e63';
const GREY = '#787b86';

const NaNs = (n: number) => new Array<number>(n).fill(NaN);
const num = (p: IndicatorParams, key: string) => Number(p[key]);
const int = (p: IndicatorParams, key: string) => Math.max(1, Math.round(Number(p[key])));
const numberInput = (key: string, label: string, def: number, step = 1, min = 1, max = 1000): IndicatorInput => ({ key, label, type: 'number', default: def, min, max, step });
const length = (def: number, label = 'Length') => numberInput('length', label, def);
const sourceInput = (def: PriceSource = 'close'): IndicatorInput => ({ key: 'source', label: 'Source', type: 'source', default: def });

const vol = (bars: Bar[]) => bars.map((b) => b.volume);
const closes = (bars: Bar[]) => bars.map((b) => b.close);
const hlc3 = (b: Bar) => (b.high + b.low + b.close) / 3;
function source(bars: Bar[], p: IndicatorParams): number[] {
  const pick: Record<PriceSource, (b: Bar) => number> = {
    close: (b) => b.close,
    open: (b) => b.open,
    high: (b) => b.high,
    low: (b) => b.low,
    hl2: (b) => (b.high + b.low) / 2,
    hlc3,
    ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
  };
  return bars.map(pick[p.source as PriceSource] ?? pick.close);
}
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const div = (a: number[], b: number[]) => a.map((v, i) => (b[i] ? v / b[i] : NaN));
/** Running total that starts at `start` on the first bar. */
function cumulative(values: number[], start = 0): number[] {
  let total = start;
  return values.map((v) => (total += Number.isNaN(v) ? 0 : v));
}
/** +volume on a higher close, -volume on a lower close, 0 unchanged (first bar NaN). */
const signedVolume = (bars: Bar[]) => bars.map((b, i) => (i === 0 ? NaN : b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0));
function obvLine(bars: Bar[]): number[] {
  return cumulative(signedVolume(bars).map((v) => (Number.isNaN(v) ? 0 : v)));
}
/** Volume-weighted average of `values` over `n` bars. */
const vwmaOf = (values: number[], volume: number[], n: number) => div(rollingSum(values.map((v, i) => v * volume[i]), n), rollingSum(volume, n));
/** VWAP that restarts whenever `key(bar)` changes (day, week, month...). */
function periodicVwap(bars: Bar[], key: (time: number) => number): number[] {
  let current = NaN;
  let pv = 0;
  let v = 0;
  return bars.map((b) => {
    const k = key(b.time);
    if (k !== current) {
      current = k;
      pv = v = 0;
    }
    pv += hlc3(b) * b.volume;
    v += b.volume;
    return v ? pv / v : hlc3(b);
  });
}
const dayKey = (t: number) => Math.floor(t / 86400);
/** Weeks start on Monday (1970-01-01 was a Thursday). */
const weekKey = (t: number) => Math.floor((Math.floor(t / 86400) + 3) / 7);
const monthKey = (t: number) => {
  const d = new Date(t * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
const yearKey = (t: number) => new Date(t * 1000).getUTCFullYear();

/** Wilder's swing index for each bar (NaN on the first); `limitPct` is the limit move as a % of the previous close. */
function swingIndex(bars: Bar[], limitPct: number): number[] {
  return bars.map((b, i) => {
    if (i === 0) return NaN;
    const p = bars[i - 1];
    const t = (limitPct / 100) * p.close;
    const hc = Math.abs(b.high - p.close);
    const lc = Math.abs(b.low - p.close);
    const hl = b.high - b.low;
    const co = Math.abs(p.close - p.open);
    const r = hc >= lc && hc >= hl ? hc - 0.5 * lc + 0.25 * co : lc >= hc && lc >= hl ? lc - 0.5 * hc + 0.25 * co : hl + 0.25 * co;
    if (!r || !t) return 0;
    const k = Math.max(hc, lc);
    return ((50 * (b.close - p.close + 0.5 * (b.close - b.open) + 0.25 * (p.close - p.open))) / r) * (k / t);
  });
}

export const VOLUME_DEFS: IndicatorDef[] = [
  {
    id: 'obvsignal',
    name: 'OBV with Signal Line',
    shortName: 'OBV+MA',
    category: 'Volume',
    description: 'On-Balance Volume with an EMA signal line. OBV crossing above its signal = buying pressure picking up.',
    placement: 'separate',
    inputs: [length(20, 'Signal length')],
    plots: [
      { key: 'obv', title: 'OBV', type: 'line', color: '#42a5f5', lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const obv = obvLine(bars);
      return { obv, signal: ema(obv, int(p, 'length')) };
    },
  },
  {
    id: 'obvosc',
    name: 'OBV Oscillator',
    shortName: 'OBV Osc',
    category: 'Volume',
    description: 'On-Balance Volume minus its own EMA: above 0 = volume flowing in faster than usual, below 0 = flowing out.',
    placement: 'separate',
    inputs: [length(20)],
    plots: [{ key: 'osc', title: 'OBV Osc', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [0],
    compute: (bars, p) => {
      const obv = obvLine(bars);
      return { osc: sub(obv, ema(obv, int(p, 'length'))) };
    },
  },
  {
    id: 'chaikinosc',
    name: 'Chaikin Oscillator',
    shortName: 'Chaikin Osc',
    category: 'Volume',
    description: 'Momentum of the Accumulation/Distribution line: its 3-bar EMA minus its 10-bar EMA (TA-Lib ADOSC). Above 0 = accumulation is speeding up.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 3), numberInput('slow', 'Slow', 10)],
    plots: [{ key: 'osc', title: 'Chaikin Osc', type: 'line', color: '#ab47bc', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      // TA-Lib ADOSC: both EMAs start from the first A/D value (not an SMA), output after slow - 1 bars.
      const fast = int(p, 'fast');
      const slow = int(p, 'slow');
      const kf = 2 / (fast + 1);
      const ks = 2 / (slow + 1);
      const out = NaNs(bars.length);
      let ad = 0;
      let ef = 0;
      let es = 0;
      bars.forEach((b, i) => {
        const range = b.high - b.low;
        if (range > 0) ad += ((b.close - b.low - (b.high - b.close)) / range) * b.volume;
        if (i === 0) ef = es = ad;
        else {
          ef = kf * ad + (1 - kf) * ef;
          es = ks * ad + (1 - ks) * es;
        }
        if (i >= Math.max(fast, slow) - 1) out[i] = ef - es;
      });
      return { osc: out };
    },
  },
  {
    id: 'eom',
    name: 'Ease of Movement',
    shortName: 'EMV',
    category: 'Volume',
    description: 'Richard Arms’ Ease of Movement: how far the midpoint moved per unit of volume, averaged. Above 0 = price rises easily on light volume.',
    placement: 'separate',
    inputs: [length(14), numberInput('divisor', 'Volume divisor', 100000000, 1, 1, 1e12)],
    plots: [{ key: 'emv', title: 'EMV', type: 'line', color: TEAL, lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const divisor = num(p, 'divisor');
      const raw = bars.map((b, i) => {
        if (i === 0) return NaN;
        const move = (b.high + b.low) / 2 - (bars[i - 1].high + bars[i - 1].low) / 2;
        const boxRatio = b.volume / divisor / (b.high - b.low);
        return b.high > b.low && b.volume > 0 ? move / boxRatio : 0;
      });
      return { emv: sma(raw, int(p, 'length')) };
    },
  },
  {
    id: 'forceindex',
    name: 'Force Index',
    shortName: 'Force',
    category: 'Volume',
    description: 'Alexander Elder’s Force Index: price change x volume. The raw 1-bar value (histogram) and its 13-bar EMA (line); above 0 = bulls in control.',
    placement: 'separate',
    inputs: [length(13, 'EMA length')],
    plots: [
      { key: 'raw', title: 'Force (1)', type: 'histogram', color: UP + '80', colorBy: 'sign', negativeColor: DOWN + '80' },
      { key: 'fi', title: 'Force (EMA)', type: 'line', color: BLUE, lineWidth: 2 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const raw = bars.map((b, i) => (i === 0 ? NaN : (b.close - bars[i - 1].close) * b.volume));
      return { raw, fi: ema(raw, int(p, 'length')) };
    },
  },
  {
    id: 'nvi',
    name: 'Negative Volume Index',
    shortName: 'NVI',
    category: 'Volume',
    description: 'Paul Dysart / Norman Fosback NVI: moves with price only on days volume falls (the "smart money" days). Above its 255-bar EMA = bull market odds.',
    placement: 'separate',
    inputs: [length(255, 'Signal EMA')],
    plots: [
      { key: 'nvi', title: 'NVI', type: 'line', color: BLUE, lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    compute: (bars, p) => {
      let value = 1000;
      const nvi = bars.map((b, i) => {
        if (i > 0 && b.volume < bars[i - 1].volume && bars[i - 1].close) value *= b.close / bars[i - 1].close;
        return value;
      });
      return { nvi, signal: ema(nvi, int(p, 'length')) };
    },
  },
  {
    id: 'pvi',
    name: 'Positive Volume Index',
    shortName: 'PVI',
    category: 'Volume',
    description: 'Moves with price only on days volume rises (when the crowd is active). Above its 255-bar EMA = bull market odds.',
    placement: 'separate',
    inputs: [length(255, 'Signal EMA')],
    plots: [
      { key: 'pvi', title: 'PVI', type: 'line', color: PINK, lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    compute: (bars, p) => {
      let value = 1000;
      const pvi = bars.map((b, i) => {
        if (i > 0 && b.volume > bars[i - 1].volume && bars[i - 1].close) value *= b.close / bars[i - 1].close;
        return value;
      });
      return { pvi, signal: ema(pvi, int(p, 'length')) };
    },
  },
  {
    id: 'volosc',
    name: 'Volume Oscillator',
    shortName: 'Vol Osc',
    category: 'Volume',
    description: 'Fast EMA of volume vs slow EMA, in %: above 0 = volume is running above its usual level.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 5), numberInput('slow', 'Slow', 10)],
    plots: [{ key: 'osc', title: 'Vol Osc %', type: 'line', color: PURPLE, lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const v = vol(bars);
      const f = ema(v, int(p, 'fast'));
      const s = ema(v, int(p, 'slow'));
      return { osc: f.map((x, i) => (s[i] ? (100 * (x - s[i])) / s[i] : NaN)) };
    },
  },
  {
    id: 'pvo',
    name: 'Percentage Volume Oscillator',
    shortName: 'PVO',
    category: 'Volume',
    description: 'MACD applied to volume: (12-bar EMA - 26-bar EMA) / 26-bar EMA in %, with a 9-bar signal and histogram.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 12), numberInput('slow', 'Slow', 26), numberInput('signal', 'Signal', 9)],
    plots: [
      { key: 'hist', title: 'Histogram', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN },
      { key: 'pvo', title: 'PVO', type: 'line', color: BLUE, lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const v = vol(bars);
      const f = ema(v, int(p, 'fast'));
      const s = ema(v, int(p, 'slow'));
      const pvo = f.map((x, i) => (s[i] ? (100 * (x - s[i])) / s[i] : NaN));
      const signal = ema(pvo, int(p, 'signal'));
      return { pvo, signal, hist: sub(pvo, signal) };
    },
  },
  {
    id: 'vwaprolling',
    name: 'Rolling VWAP',
    shortName: 'rVWAP',
    category: 'Volume',
    description: 'Volume-weighted average price of the last N bars (never resets), so it works on any timeframe.',
    placement: 'overlay',
    inputs: [length(20), sourceInput('hlc3')],
    plots: [{ key: 'vwap', title: 'Rolling VWAP', type: 'line', color: PINK, lineWidth: 2 }],
    compute: (bars, p) => ({ vwap: vwmaOf(source(bars, p), vol(bars), int(p, 'length')) }),
  },
  {
    id: 'avwap',
    name: 'Anchored VWAP',
    shortName: 'AVWAP',
    category: 'Volume',
    description: 'VWAP started from a chosen bar: N bars back, or from a date (YYYYMMDD, UTC) when one is set. Shows the average price paid since that event.',
    placement: 'overlay',
    inputs: [numberInput('barsBack', 'Anchor: bars back', 50, 1, 0, 100000), numberInput('date', 'Anchor date YYYYMMDD (0 = use bars back)', 0, 1, 0, 99991231)],
    plots: [{ key: 'vwap', title: 'Anchored VWAP', type: 'line', color: ORANGE, lineWidth: 2 }],
    compute: (bars, p) => {
      const out = NaNs(bars.length);
      if (!bars.length) return { vwap: out };
      const date = Math.round(num(p, 'date'));
      let anchor = Math.max(0, bars.length - 1 - Math.round(num(p, 'barsBack')));
      if (date > 0) {
        const t = Date.UTC(Math.floor(date / 10000), (Math.floor(date / 100) % 100) - 1, date % 100) / 1000;
        anchor = bars.findIndex((b) => b.time >= t);
        if (anchor === -1) return { vwap: out };
      }
      let pv = 0;
      let v = 0;
      for (let i = anchor; i < bars.length; i++) {
        pv += hlc3(bars[i]) * bars[i].volume;
        v += bars[i].volume;
        out[i] = v ? pv / v : hlc3(bars[i]);
      }
      return { vwap: out };
    },
  },
  {
    id: 'vwapperiodic',
    name: 'VWAP (Day/Week/Month/Year)',
    shortName: 'pVWAP',
    category: 'Volume',
    description: 'VWAP that restarts each day, week (Monday), month or year (UTC). Weekly and monthly VWAPs are levels swing traders watch.',
    placement: 'overlay',
    inputs: [numberInput('period', 'Reset: 1 day, 2 week, 3 month, 4 year', 2, 1, 1, 4)],
    plots: [{ key: 'vwap', title: 'VWAP', type: 'line', color: '#f06292', lineWidth: 2 }],
    compute: (bars, p) => {
      const key = [dayKey, dayKey, weekKey, monthKey, yearKey][Math.min(4, int(p, 'period'))];
      return { vwap: periodicVwap(bars, key) };
    },
  },
  {
    id: 'vwapdist',
    name: 'Distance from VWAP',
    shortName: 'VWAP %',
    category: 'Volume',
    description: 'How far the close is above (+) or below (-) the day’s VWAP, in %. Big readings = stretched away from the average price paid today.',
    placement: 'separate',
    inputs: [],
    plots: [{ key: 'dist', title: 'From VWAP %', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [0],
    compute: (bars) => {
      const vwap = periodicVwap(bars, dayKey);
      return { dist: bars.map((b, i) => (vwap[i] ? (100 * (b.close - vwap[i])) / vwap[i] : NaN)) };
    },
  },
  {
    id: 'kvo',
    name: 'Klinger Volume Oscillator',
    shortName: 'KVO',
    category: 'Volume',
    description: 'Stephen Klinger’s volume force, TradingView form: volume signed by the typical price’s direction, 34-bar EMA minus 55-bar EMA, with a 13-bar signal.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 34), numberInput('slow', 'Slow', 55), numberInput('signal', 'Signal', 13)],
    plots: [
      { key: 'kvo', title: 'KVO', type: 'line', color: BLUE, lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const sv = bars.map((b, i) => (i === 0 ? NaN : hlc3(b) - hlc3(bars[i - 1]) >= 0 ? b.volume : -b.volume));
      const kvo = sub(ema(sv, int(p, 'fast')), ema(sv, int(p, 'slow')));
      return { kvo, signal: ema(kvo, int(p, 'signal')) };
    },
  },
  {
    id: 'tmf',
    name: 'Twiggs Money Flow',
    shortName: 'TMF',
    category: 'Volume',
    description: 'Colin Twiggs’ improved Chaikin Money Flow: uses the true range (so gaps count) and Wilder smoothing. Above 0 = accumulation.',
    placement: 'separate',
    inputs: [length(21)],
    plots: [{ key: 'tmf', title: 'TMF', type: 'line', color: '#43a047', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const adv = bars.map((b, i) => {
        if (i === 0) return NaN;
        const th = Math.max(b.high, bars[i - 1].close);
        const tl = Math.min(b.low, bars[i - 1].close);
        return th > tl ? ((b.close - tl - (th - b.close)) / (th - tl)) * b.volume : 0;
      });
      const v = bars.map((b, i) => (i === 0 ? NaN : b.volume));
      return { tmf: div(rma(adv, n), rma(v, n)) };
    },
  },
  {
    id: 'vroc',
    name: 'Volume Rate of Change',
    shortName: 'VROC',
    category: 'Volume',
    description: 'Percentage change in volume versus N bars ago. Spikes show sudden interest; useful to confirm breakouts.',
    placement: 'separate',
    inputs: [length(14)],
    plots: [{ key: 'vroc', title: 'VROC %', type: 'line', color: PURPLE, lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const n = int(p, 'length');
      return { vroc: bars.map((b, i) => (i >= n && bars[i - n].volume ? (100 * (b.volume - bars[i - n].volume)) / bars[i - n].volume : NaN)) };
    },
  },
  {
    id: 'tvi',
    name: 'Trade Volume Index',
    shortName: 'TVI',
    category: 'Volume',
    description: 'Adds volume while price is ticking up and subtracts it while ticking down; a change smaller than the minimum tick value keeps the last direction.',
    placement: 'separate',
    inputs: [numberInput('mtv', 'Minimum tick value', 0, 0.01, 0, 1000)],
    plots: [{ key: 'tvi', title: 'TVI', type: 'line', color: TEAL, lineWidth: 2 }],
    compute: (bars, p) => {
      const mtv = num(p, 'mtv');
      let dir = 0;
      let total = 0;
      return {
        tvi: bars.map((b, i) => {
          if (i > 0) {
            const change = b.close - bars[i - 1].close;
            if (change > mtv) dir = 1;
            else if (change < -mtv) dir = -1;
            total += dir * b.volume;
          }
          return total;
        }),
      };
    },
  },
  {
    id: 'pvt',
    name: 'Price Volume Trend',
    shortName: 'PVT',
    category: 'Volume',
    description: 'Running total of volume x % price change. Like OBV, but a 0.1% move adds only a little volume and a 5% move adds a lot.',
    placement: 'separate',
    inputs: [],
    plots: [{ key: 'pvt', title: 'PVT', type: 'line', color: '#42a5f5', lineWidth: 2 }],
    compute: (bars) => ({ pvt: cumulative(bars.map((b, i) => (i > 0 && bars[i - 1].close ? ((b.close - bars[i - 1].close) / bars[i - 1].close) * b.volume : 0))) }),
  },
  {
    id: 'vpci',
    name: 'Volume Price Confirmation',
    shortName: 'VPCI',
    category: 'Volume',
    description: 'Buff Dormeier’s VPCI: compares volume-weighted and plain averages. Above 0 = volume confirms the price trend; below 0 = it contradicts it.',
    placement: 'separate',
    inputs: [numberInput('short', 'Short', 5), numberInput('long', 'Long', 20)],
    plots: [{ key: 'vpci', title: 'VPCI', type: 'line', color: BLUE, lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const s = int(p, 'short');
      const l = int(p, 'long');
      const c = closes(bars);
      const v = vol(bars);
      const vpc = sub(vwmaOf(c, v, l), sma(c, l));
      const vpr = div(vwmaOf(c, v, s), sma(c, s));
      const vm = div(sma(v, s), sma(v, l));
      return { vpci: vpc.map((x, i) => x * vpr[i] * vm[i]) };
    },
  },
  {
    id: 'bwmfi',
    name: 'Market Facilitation Index',
    shortName: 'BW MFI',
    category: 'Volume',
    description: 'Bill Williams’ MFI: bar range per million shares traded, i.e. how much price moves per unit of volume. Squat dots = volume up but MFI down (a battle before a breakout).',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'mfi', title: 'MFI', type: 'histogram', color: UP, colorBy: 'change', negativeColor: DOWN },
      { key: 'squat', title: 'Squat', type: 'marker', color: '#ab47bc', marker: { shape: 'circle', position: 'aboveBar', text: 'Squat' } },
    ],
    compute: (bars) => {
      const mfi = bars.map((b) => (b.volume ? ((b.high - b.low) / b.volume) * 1e6 : NaN));
      const squat = mfi.map((m, i) => (i > 0 && m < mfi[i - 1] && bars[i].volume > bars[i - 1].volume ? 1 : 0));
      return { mfi, squat };
    },
  },
  {
    id: 'vwmacd',
    name: 'Volume-Weighted MACD',
    shortName: 'VW-MACD',
    category: 'Volume',
    description: 'MACD built from volume-weighted EMAs (EMA of price x volume / EMA of volume), so heavy-volume bars count more. Signal 9, histogram.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 12), numberInput('slow', 'Slow', 26), numberInput('signal', 'Signal', 9)],
    plots: [
      { key: 'hist', title: 'Histogram', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN },
      { key: 'macd', title: 'VW-MACD', type: 'line', color: BLUE, lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const v = vol(bars);
      const pv = bars.map((b) => b.close * b.volume);
      const vw = (n: number) => div(ema(pv, n), ema(v, n));
      const macd = sub(vw(int(p, 'fast')), vw(int(p, 'slow')));
      const signal = ema(macd, int(p, 'signal'));
      return { macd, signal, hist: sub(macd, signal) };
    },
  },
  {
    id: 'vwrsi',
    name: 'Volume-Weighted RSI',
    shortName: 'VW-RSI',
    category: 'Volume',
    description: 'RSI where each gain or loss is multiplied by that bar’s volume (Wilder smoothing), so moves on heavy volume count more. 70/30 zones.',
    placement: 'separate',
    inputs: [length(14)],
    plots: [{ key: 'rsi', title: 'VW-RSI', type: 'line', color: PURPLE, lineWidth: 2 }],
    levels: [70, 50, 30],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const up = rma(bars.map((b, i) => (i === 0 ? NaN : Math.max(b.close - bars[i - 1].close, 0) * b.volume)), n);
      const down = rma(bars.map((b, i) => (i === 0 ? NaN : Math.max(bars[i - 1].close - b.close, 0) * b.volume)), n);
      return { rsi: up.map((u, i) => (Number.isNaN(u) ? NaN : down[i] === 0 ? (u === 0 ? 50 : 100) : 100 - 100 / (1 + u / down[i]))) };
    },
  },
  {
    id: 'relvol',
    name: 'Relative Volume',
    shortName: 'RVOL',
    category: 'Volume',
    description: 'This bar’s volume divided by the average of the previous N bars. 2 = twice the usual volume.',
    placement: 'separate',
    inputs: [length(20)],
    plots: [{ key: 'rvol', title: 'RVOL', type: 'histogram', color: '#42a5f5' }],
    levels: [1, 2],
    compute: (bars, p) => {
      const avg = sma(vol(bars), int(p, 'length'));
      return { rvol: bars.map((b, i) => (i > 0 && avg[i - 1] ? b.volume / avg[i - 1] : NaN)) };
    },
  },
  {
    id: 'rvoltod',
    name: 'Relative Volume at Time of Day',
    shortName: 'RVOL ToD',
    category: 'Volume',
    description: 'Intraday: volume compared with the same time slot on the previous N days (so the busy open is not always "high"). On daily bars it compares with the last N days.',
    placement: 'separate',
    inputs: [length(10, 'Days')],
    plots: [{ key: 'rvol', title: 'RVOL (time of day)', type: 'histogram', color: TEAL }],
    levels: [1, 2],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const history = new Map<number, number[]>();
      return {
        rvol: bars.map((b) => {
          const slot = ((b.time % 86400) + 86400) % 86400;
          const past = history.get(slot) ?? [];
          const avg = past.length >= n ? past.reduce((a, x) => a + x, 0) / n : NaN;
          past.push(b.volume);
          if (past.length > n) past.shift();
          history.set(slot, past);
          return avg ? b.volume / avg : NaN;
        }),
      };
    },
  },
  {
    id: 'volmas',
    name: 'Volume Moving Averages',
    shortName: 'Vol MAs',
    category: 'Volume',
    description: 'Volume bars with a fast and a slow simple average of volume. Fast above slow = activity is rising.',
    placement: 'separate',
    inputs: [numberInput('fast', 'Fast', 20), numberInput('slow', 'Slow', 50)],
    plots: [
      { key: 'volume', title: 'Volume', type: 'histogram', color: UP + '80', colorBy: 'candle', negativeColor: DOWN + '80' },
      { key: 'fast', title: 'Fast MA', type: 'line', color: ORANGE, lineWidth: 1 },
      { key: 'slow', title: 'Slow MA', type: 'line', color: BLUE, lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const v = vol(bars);
      return { volume: v, fast: sma(v, int(p, 'fast')), slow: sma(v, int(p, 'slow')) };
    },
  },
  {
    id: 'updownvol',
    name: 'Up/Down Volume',
    shortName: 'Up/Down Vol',
    category: 'Volume',
    description: 'Volume split by direction: bars that closed higher than the last close plot up (green), lower closes plot down (red).',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'up', title: 'Up volume', type: 'histogram', color: UP },
      { key: 'down', title: 'Down volume', type: 'histogram', color: DOWN },
    ],
    levels: [0],
    compute: (bars) => {
      const sv = signedVolume(bars);
      return { up: sv.map((v) => (Number.isNaN(v) ? NaN : Math.max(v, 0))), down: sv.map((v) => (Number.isNaN(v) ? NaN : Math.min(v, 0))) };
    },
  },
  {
    id: 'udvr',
    name: 'Up/Down Volume Ratio',
    shortName: 'U/D Vol',
    category: 'Volume',
    description: 'Total up-close volume divided by total down-close volume over N bars. Above 1 = more volume on up days (accumulation).',
    placement: 'separate',
    inputs: [length(20)],
    plots: [{ key: 'ratio', title: 'Up/Down ratio', type: 'line', color: '#43a047', lineWidth: 2 }],
    levels: [1],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const sv = signedVolume(bars);
      const up = rollingSum(sv.map((v) => (Number.isNaN(v) ? NaN : Math.max(v, 0))), n);
      const down = rollingSum(sv.map((v) => (Number.isNaN(v) ? NaN : Math.max(-v, 0))), n);
      return { ratio: div(up, down) };
    },
  },
  {
    id: 'cvd',
    name: 'Cumulative Volume Delta (approximation)',
    shortName: 'CVD≈',
    category: 'Volume',
    description: 'Approximation from candles only (no tick data): each bar’s delta = volume x (close - open) / (high - low), summed. Real CVD needs every trade’s buyer/seller side.',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'delta', title: 'Delta≈', type: 'histogram', color: UP + '80', colorBy: 'sign', negativeColor: DOWN + '80' },
      { key: 'cvd', title: 'CVD≈', type: 'line', color: BLUE, lineWidth: 2 },
    ],
    compute: (bars) => {
      const delta = bars.map((b) => (b.high > b.low ? (b.volume * (b.close - b.open)) / (b.high - b.low) : 0));
      return { delta, cvd: cumulative(delta) };
    },
  },
  {
    id: 'asi',
    name: 'Accumulative Swing Index',
    shortName: 'ASI',
    category: 'Volume',
    description: 'Welles Wilder’s running total of the Swing Index (uses open, high, low, close). Its breakouts and trendlines confirm price breakouts. Limit move = % of the last close.',
    placement: 'separate',
    inputs: [numberInput('limit', 'Limit move (% of price)', 10, 0.5, 0.1, 100)],
    plots: [{ key: 'asi', title: 'ASI', type: 'line', color: PURPLE, lineWidth: 2 }],
    compute: (bars, p) => {
      const si = swingIndex(bars, num(p, 'limit'));
      let total = 0;
      return { asi: si.map((v) => (Number.isNaN(v) ? NaN : (total += v))) };
    },
  },
  {
    id: 'si',
    name: 'Swing Index',
    shortName: 'SI',
    category: 'Volume',
    description: 'Welles Wilder’s Swing Index: one bar’s "real" move from the open, high, low and closes, scaled by a limit move. Above 0 = an up swing.',
    placement: 'separate',
    inputs: [numberInput('limit', 'Limit move (% of price)', 10, 0.5, 0.1, 100)],
    plots: [{ key: 'si', title: 'SI', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [0],
    compute: (bars, p) => ({ si: swingIndex(bars, num(p, 'limit')) }),
  },
  {
    id: 'vzo',
    name: 'Volume Zone Oscillator',
    shortName: 'VZO',
    category: 'Volume',
    description: 'Walid Khalil’s VZO: the share of volume on up closes minus down closes (EMA 14), in %. +40/-40 = strong trend, +60/-60 = extreme.',
    placement: 'separate',
    inputs: [length(14)],
    plots: [{ key: 'vzo', title: 'VZO', type: 'line', color: TEAL, lineWidth: 2 }],
    levels: [60, 40, 0, -40, -60],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const r = signedVolume(bars);
      const v = bars.map((b, i) => (i === 0 ? NaN : b.volume));
      return { vzo: div(ema(r, n), ema(v, n)).map((x) => 100 * x) };
    },
  },
  {
    id: 'bettervol',
    name: 'Better Volume (approximation)',
    shortName: 'BetterVol≈',
    category: 'Volume',
    description: 'A candle-only take on Emini-Watch’s Better Volume: marks climax bars (largest range x volume in N bars), churn (most volume per point of range) and the lowest volume.',
    placement: 'separate',
    inputs: [length(20)],
    plots: [
      { key: 'volume', title: 'Volume', type: 'histogram', color: GREY + '80' },
      { key: 'climaxUp', title: 'Climax up', type: 'marker', color: DOWN, marker: { shape: 'circle', position: 'aboveBar', text: 'Climax' } },
      { key: 'climaxDown', title: 'Climax down', type: 'marker', color: UP, marker: { shape: 'circle', position: 'belowBar', text: 'Climax' } },
      { key: 'churn', title: 'Churn', type: 'marker', color: '#ab47bc', marker: { shape: 'square', position: 'aboveBar', text: 'Churn' } },
      { key: 'low', title: 'Low volume', type: 'marker', color: '#ffb300', marker: { shape: 'circle', position: 'belowBar', text: 'Low' } },
    ],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const v = vol(bars);
      const rangeVol = bars.map((b) => (b.high - b.low) * b.volume);
      const perPoint = bars.map((b) => (b.high > b.low ? b.volume / (b.high - b.low) : NaN));
      const topRV = highest(rangeVol, n);
      const topPP = highest(perPoint.map((x) => (Number.isNaN(x) ? 0 : x)), n);
      const lowV = lowest(v, n);
      const flag = (f: (i: number) => boolean) => bars.map((_, i) => (i >= n - 1 && f(i) ? 1 : 0));
      return {
        volume: v,
        climaxUp: flag((i) => bars[i].close > bars[i].open && rangeVol[i] > 0 && rangeVol[i] === topRV[i]),
        climaxDown: flag((i) => bars[i].close < bars[i].open && rangeVol[i] > 0 && rangeVol[i] === topRV[i]),
        churn: flag((i) => perPoint[i] > 0 && perPoint[i] === topPP[i]),
        low: flag((i) => v[i] === lowV[i]),
      };
    },
  },
  {
    id: 'evwma',
    name: 'Elastic Volume-Weighted MA',
    shortName: 'eVWMA',
    category: 'Volume',
    description: 'Christian Fries’ eVWMA: each bar moves the average by its share of the last N bars’ volume, so the line jumps on heavy volume and barely moves on light volume.',
    placement: 'overlay',
    inputs: [length(20), sourceInput()],
    plots: [{ key: 'ma', title: 'eVWMA', type: 'line', color: '#ff7043', lineWidth: 2 }],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const s = source(bars, p);
      const vs = rollingSum(vol(bars), n);
      const seed = sma(s, n);
      const out = NaNs(bars.length);
      let prev = NaN;
      for (let i = n - 1; i < bars.length; i++) {
        if (Number.isNaN(prev)) prev = seed[i];
        else if (vs[i]) prev = ((vs[i] - bars[i].volume) * prev + bars[i].volume * s[i]) / vs[i];
        out[i] = prev;
      }
      return { ma: out };
    },
  },
  {
    id: 'volz',
    name: 'Volume Z-Score',
    shortName: 'Vol Z',
    category: 'Volume',
    description: 'How many standard deviations this bar’s volume is from its N-bar average. Above +2 = unusually heavy volume.',
    placement: 'separate',
    inputs: [length(20)],
    plots: [{ key: 'z', title: 'Volume z', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [2, 0, -2],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const v = vol(bars);
      const m = sma(v, n);
      const sd = stdev(v, n);
      return { z: v.map((x, i) => (sd[i] ? (x - m[i]) / sd[i] : NaN)) };
    },
  },
  {
    id: 'volrank',
    name: 'Volume Percentile',
    shortName: 'Vol %ile',
    category: 'Volume',
    description: 'Share of the previous N bars that had less volume than this bar (0-100). 95 = busier than 95% of recent bars.',
    placement: 'separate',
    inputs: [length(50)],
    plots: [{ key: 'rank', title: 'Volume percentile', type: 'line', color: PURPLE, lineWidth: 2 }],
    levels: [80, 50, 20],
    compute: (bars, p) => {
      const n = int(p, 'length');
      return {
        rank: bars.map((b, i) => {
          if (i < n) return NaN;
          let below = 0;
          for (let j = i - n; j < i; j++) if (bars[j].volume < b.volume) below++;
          return (100 * below) / n;
        }),
      };
    },
  },
  {
    id: 'fve',
    name: 'Finite Volume Elements',
    shortName: 'FVE',
    category: 'Volume',
    description: 'Markos Katsanos’ FVE: counts volume as buying or selling only when the bar’s move beats a small cutoff (0.3%), over 22 bars. Above 0 = money flowing in.',
    placement: 'separate',
    inputs: [length(22), numberInput('cutoff', 'Cutoff %', 0.3, 0.1, 0, 10)],
    plots: [{ key: 'fve', title: 'FVE', type: 'line', color: '#43a047', lineWidth: 2 }],
    levels: [0],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const cut = num(p, 'cutoff') / 100;
      const vc = bars.map((b, i) => {
        if (i === 0) return NaN;
        const mf = b.close - (b.high + b.low) / 2 + hlc3(b) - hlc3(bars[i - 1]);
        return mf > cut * b.close ? b.volume : mf < -cut * b.close ? -b.volume : 0;
      });
      const sum = rollingSum(vc, n);
      const avg = sma(vol(bars), n);
      return { fve: sum.map((s, i) => (avg[i] ? (100 * s) / (avg[i] * n) : NaN)) };
    },
  },
  {
    id: 'vfi',
    name: 'Volume Flow Indicator',
    shortName: 'VFI',
    category: 'Volume',
    description: 'Katsanos’ VFI (LazyBear form): long-term money flow that ignores tiny moves and caps volume spikes at 2.5x average. Above 0 = bullish flow.',
    placement: 'separate',
    inputs: [length(130), numberInput('coef', 'Cutoff coefficient', 0.2, 0.05, 0, 5), numberInput('vcoef', 'Max volume (x average)', 2.5, 0.1, 0.1, 20), numberInput('signal', 'Signal EMA', 5)],
    plots: [
      { key: 'hist', title: 'VFI - signal', type: 'histogram', color: UP + '80', colorBy: 'sign', negativeColor: DOWN + '80' },
      { key: 'vfi', title: 'VFI', type: 'line', color: BLUE, lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const n = int(p, 'length');
      const tp = bars.map(hlc3);
      const inter = tp.map((t, i) => (i === 0 || t <= 0 || tp[i - 1] <= 0 ? NaN : Math.log(t) - Math.log(tp[i - 1])));
      const vinter = stdev(inter, 30);
      const vave = sma(vol(bars), n);
      const vcp = bars.map((b, i) => {
        if (i === 0 || Number.isNaN(vinter[i]) || Number.isNaN(vave[i - 1])) return NaN;
        const cutoff = num(p, 'coef') * vinter[i] * b.close;
        const vc = Math.min(b.volume, vave[i - 1] * num(p, 'vcoef'));
        const mf = tp[i] - tp[i - 1];
        return mf > cutoff ? vc : mf < -cutoff ? -vc : 0;
      });
      const sum = rollingSum(vcp, n);
      const vfi = sma(sum.map((s, i) => (i > 0 && vave[i - 1] ? s / vave[i - 1] : NaN)), 3);
      const signal = ema(vfi, int(p, 'signal'));
      return { vfi, signal, hist: sub(vfi, signal) };
    },
  },
  {
    id: 'wvad',
    name: 'Williams’ Variable Accumulation/Distribution',
    shortName: 'WVAD',
    category: 'Volume',
    description: 'Larry Williams’ WVAD: sum of (close - open) / (high - low) x volume over N bars. Above 0 = buyers won the bars; below 0 = sellers did.',
    placement: 'separate',
    inputs: [length(14)],
    plots: [{ key: 'wvad', title: 'WVAD', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [0],
    compute: (bars, p) => ({ wvad: rollingSum(bars.map((b) => (b.high > b.low ? ((b.close - b.open) / (b.high - b.low)) * b.volume : 0)), int(p, 'length')) }),
  },
  {
    id: 'tsv',
    name: 'Time Segmented Volume',
    shortName: 'TSV',
    category: 'Volume',
    description: 'Worden’s TSV (common public form): sum of price change x volume over N bars, with an EMA signal. Above 0 = accumulation.',
    placement: 'separate',
    inputs: [length(13), numberInput('signal', 'Signal EMA', 7)],
    plots: [
      { key: 'tsv', title: 'TSV', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN },
      { key: 'signal', title: 'Signal', type: 'line', color: ORANGE, lineWidth: 1 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const tsv = rollingSum(bars.map((b, i) => (i === 0 ? NaN : (b.close - bars[i - 1].close) * b.volume)), int(p, 'length'));
      return { tsv, signal: ema(tsv, int(p, 'signal')) };
    },
  },
  {
    id: 'pvrank',
    name: 'Price and Volume Rank',
    shortName: 'PV Rank',
    category: 'Volume',
    description: 'Achelis’ PV Rank: 1 = price up on rising volume, 2 = price up on falling volume, 3 = price down on falling volume, 4 = price down on rising volume (0 = unchanged). With a 5-bar average.',
    placement: 'separate',
    inputs: [length(5, 'Average')],
    plots: [
      { key: 'rank', title: 'PV Rank', type: 'histogram', color: GREY },
      { key: 'avg', title: 'Average', type: 'line', color: ORANGE, lineWidth: 2 },
    ],
    levels: [2.5],
    compute: (bars, p) => {
      const rank = bars.map((b, i) => {
        if (i === 0) return NaN;
        const up = b.close > bars[i - 1].close;
        const down = b.close < bars[i - 1].close;
        const vUp = b.volume > bars[i - 1].volume;
        const vDown = b.volume < bars[i - 1].volume;
        return up && vUp ? 1 : up && vDown ? 2 : down && vDown ? 3 : down && vUp ? 4 : 0;
      });
      return { rank, avg: sma(rank, int(p, 'length')) };
    },
  },
  {
    id: 'netvol',
    name: 'Net Volume (rolling)',
    shortName: 'Net Vol',
    category: 'Volume',
    description: 'Up-close volume minus down-close volume over the last N bars: a rolling OBV that does not drift. Above 0 = more volume on up bars.',
    placement: 'separate',
    inputs: [length(20)],
    plots: [{ key: 'net', title: 'Net volume', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [0],
    compute: (bars, p) => ({ net: rollingSum(signedVolume(bars), int(p, 'length')) }),
  },
  {
    id: 'buysell',
    name: 'Buying/Selling Pressure',
    shortName: 'Buy/Sell',
    category: 'Volume',
    description: 'Each bar’s volume split by where it closed in its range: close at the high = all buying, at the low = all selling (an estimate from candles).',
    placement: 'separate',
    inputs: [],
    plots: [
      { key: 'buy', title: 'Buying', type: 'histogram', color: UP },
      { key: 'sell', title: 'Selling', type: 'histogram', color: DOWN },
    ],
    levels: [0],
    compute: (bars) => {
      const share = bars.map((b) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5));
      return { buy: bars.map((b, i) => b.volume * share[i]), sell: bars.map((b, i) => -b.volume * (1 - share[i])) };
    },
  },
  {
    id: 'volacc',
    name: 'Volume Accumulation',
    shortName: 'Vol Acc',
    category: 'Volume',
    description: 'Marc Chaikin’s Volume Accumulation: running total of volume x (close - midpoint of the bar). Rising = closes in the upper half on volume.',
    placement: 'separate',
    inputs: [],
    plots: [{ key: 'va', title: 'Volume Accumulation', type: 'line', color: '#ab47bc', lineWidth: 2 }],
    compute: (bars) => ({ va: cumulative(bars.map((b) => b.volume * (b.close - (b.high + b.low) / 2))) }),
  },
  {
    id: 'weiswave',
    name: 'Weis Wave Volume',
    shortName: 'Weis',
    category: 'Volume',
    description: 'David Weis’ wave volume: adds up volume for each up or down wave of closes; a wave turns when the close reverses by more than the reversal % from the wave’s extreme.',
    placement: 'separate',
    inputs: [numberInput('reversal', 'Reversal %', 0, 0.1, 0, 50)],
    plots: [{ key: 'wave', title: 'Wave volume', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN }],
    levels: [0],
    compute: (bars, p) => {
      const r = num(p, 'reversal') / 100;
      let dir = 0;
      let extreme = NaN;
      let total = 0;
      return {
        wave: bars.map((b, i) => {
          if (i === 0) {
            extreme = b.close;
            return NaN;
          }
          const c = b.close;
          if (dir === 0) {
            if (c !== bars[i - 1].close) {
              dir = c > bars[i - 1].close ? 1 : -1;
              total = b.volume;
              extreme = c;
            }
            return dir * total;
          }
          if (dir === 1 ? c < extreme * (1 - r) && c < bars[i - 1].close : c > extreme * (1 + r) && c > bars[i - 1].close) {
            dir = -dir;
            total = b.volume;
            extreme = c;
          } else {
            total += b.volume;
            extreme = dir === 1 ? Math.max(extreme, c) : Math.min(extreme, c);
          }
          return dir * total;
        }),
      };
    },
  },
];

export const VOLUME_GUIDES: Record<string, IndicatorGuide> = {
  obvsignal: {
    what: 'On-Balance Volume (volume added on up days, subtracted on down days) with a moving average of itself.',
    use: ['Check whether OBV agrees with price: both rising = healthy trend.', 'Use the signal line to time changes in buying pressure.'],
    signals: ['OBV crossing above its signal = buying pressure rising; below = selling pressure rising.', 'Price at a new high while OBV stays below its old high = warning (divergence).'],
    tip: 'The OBV number itself means nothing; only its direction and divergences matter.',
  },
  obvosc: {
    what: 'The gap between On-Balance Volume and its moving average, shown as bars around zero.',
    use: ['A quick read on whether volume is flowing in (above 0) or out (below 0) right now.'],
    signals: ['Crossing above 0 = buyers taking over; below 0 = sellers.', 'Shrinking bars while price still rises = the push is fading.'],
  },
  chaikinosc: {
    what: 'The momentum of the Accumulation/Distribution line: a fast average minus a slow average of it.',
    use: ['Confirms trends: a rising price with a rising Chaikin Oscillator is backed by money flow.', 'Look for divergences at highs and lows.'],
    signals: ['Crossing above 0 = accumulation speeding up (bullish); below 0 = distribution (bearish).', 'Bullish divergence: price makes a lower low but the oscillator makes a higher low.'],
    tip: 'Use it with a trend filter (e.g. the 200-day average); zero crosses against the trend are often false.',
  },
  eom: {
    what: 'How easily price moves: the change in the bar’s midpoint divided by its volume per point of range, averaged over 14 bars.',
    use: ['Big positive values = price rising on light volume (little resistance).', 'Values near 0 = it takes a lot of volume to move price.'],
    signals: ['Crossing above 0 = bullish; below 0 = bearish.', 'Readings far from 0 in the trend’s direction confirm the trend.'],
    tip: 'The volume divisor only rescales the line; change it if the numbers look too big or small.',
  },
  forceindex: {
    what: 'Price change times volume: big moves on big volume score high. Shown raw (1 bar) and smoothed (13-bar EMA).',
    use: ['The 13-bar line shows who controls the trend; the raw bars show single-day bursts.', 'In an uptrend, buy when the 2-13 bar Force Index dips below 0 (Elder).'],
    signals: ['13-bar line above 0 = bulls in charge; below 0 = bears.', 'A record spike in the raw value often marks a climax.'],
  },
  nvi: {
    what: 'An index that only changes on days when volume falls: it follows the quiet days that "smart money" is said to use.',
    use: ['Compare NVI with its 255-day average to judge the long-term market backdrop.'],
    signals: ['NVI above its average = good odds of a bull market (Fosback found ~96% historically).', 'NVI crossing below its average = caution.'],
    tip: 'Best on daily charts of indexes or large stocks; it reacts slowly by design.',
  },
  pvi: {
    what: 'An index that only changes on days when volume rises, following the busy days when the crowd trades.',
    use: ['Use with NVI: both above their 255-day averages = strong backdrop.'],
    signals: ['PVI above its average = bullish backdrop; below = bearish.', 'PVI falling while price rises = the crowd is no longer pushing it up.'],
  },
  volosc: {
    what: 'Short-term volume compared with longer-term volume, in %.',
    use: ['Shows whether trading activity is rising or drying up.', 'Use it to confirm breakouts.'],
    signals: ['Above 0 on a breakout = the breakout has volume behind it.', 'Falling below 0 during a rally = interest is fading.'],
  },
  pvo: {
    what: 'MACD for volume: the gap between a 12- and 26-bar volume average in %, plus a signal line and histogram.',
    use: ['Tells you when volume is expanding (above 0) or contracting (below 0).', 'Pair it with price: rising price + rising PVO = strong move.'],
    signals: ['PVO crossing above its signal = volume surging.', 'PVO below 0 during a pullback = quiet, healthy pullback.'],
    tip: 'PVO says nothing about direction; read the price chart for that.',
  },
  vwaprolling: {
    what: 'The volume-weighted average price of the last N bars, updated every bar and never reset.',
    use: ['A fair-value line for any timeframe, including daily and weekly charts.', 'Acts like a moving average where heavy-volume bars count more.'],
    signals: ['Price above a rising rolling VWAP = buyers in control.', 'Pullbacks to it in a trend are common entry points.'],
  },
  avwap: {
    what: 'VWAP started from a bar you choose, such as an earnings day, a big gap or a major low.',
    use: ['Set the anchor to an important event to see the average price everyone paid since then.', 'Use a date (YYYYMMDD) for a fixed anchor, or bars back for a moving one.'],
    signals: ['Price holding above the anchored VWAP = buyers since that event are in profit (support).', 'Losing it = the average buyer since the event is now losing (resistance).'],
    tip: 'Anchor to swing highs/lows or news days, not random bars.',
  },
  vwapperiodic: {
    what: 'VWAP that restarts each day, week, month or year instead of only daily.',
    use: ['Weekly and monthly VWAPs are reference levels for swing traders and funds.', 'Pick the reset with the input: 1 day, 2 week, 3 month, 4 year.'],
    signals: ['Price above the weekly VWAP = this week’s buyers are winning.', 'First test of the monthly VWAP after a trend often reacts.'],
  },
  vwapdist: {
    what: 'How far the close is from today’s VWAP, in %.',
    use: ['Shows when price is stretched far from the day’s average price.', 'Intraday charts only; on daily bars each bar is its own day.'],
    signals: ['Large positive readings = extended above VWAP (chasing is risky).', 'Crossing from negative to positive = price reclaimed VWAP.'],
  },
  kvo: {
    what: 'Klinger’s oscillator: volume counted as positive when the typical price rises and negative when it falls, as the gap between a 34- and a 55-bar EMA.',
    use: ['Spots long-term money flow while staying sensitive to short-term turns.'],
    signals: ['KVO crossing above its signal line = bullish; below = bearish.', 'Divergence between KVO and price warns of reversals.'],
    tip: 'Klinger advised trading signals only in the direction of the main trend.',
  },
  tmf: {
    what: 'A version of Chaikin Money Flow that includes gaps (true range) and smooths with Wilder’s method.',
    use: ['Shows whether money is flowing in (above 0) or out (below 0) over about a month.'],
    signals: ['Crossing above 0 = accumulation; below 0 = distribution.', 'Bearish divergence: price makes a new high, TMF makes a lower high.'],
  },
  vroc: {
    what: 'The % change of volume versus N bars ago.',
    use: ['Confirms breakouts: a real breakout usually has a sharp volume increase.'],
    signals: ['Big spikes = sudden interest (news, breakouts, capitulation).', 'Persistently negative during a rally = weak participation.'],
  },
  tvi: {
    what: 'Like OBV, but a tiny or zero price change keeps the previous direction instead of being ignored.',
    use: ['Tracks whether volume is happening on up-ticks or down-ticks; best on intraday data.'],
    signals: ['Rising TVI = accumulation; falling = distribution.', 'Divergence from price warns of a turn.'],
    tip: 'Set the minimum tick value to filter out noise (e.g. 0.05 for a $50 stock).',
  },
  pvt: {
    what: 'A running total of volume weighted by the % price change of each bar.',
    use: ['Like OBV but fairer: small moves add little, big moves add a lot.'],
    signals: ['PVT rising with price confirms the trend.', 'PVT failing to make a new high with price = bearish divergence.'],
  },
  vpci: {
    what: 'Volume Price Confirmation Indicator: checks whether volume supports the price trend by comparing volume-weighted and normal averages.',
    use: ['Above 0 in an uptrend = volume confirms it; below 0 = price is rising without volume support.'],
    signals: ['VPCI turning up from below 0 in an uptrend = buy signal (Dormeier).', 'VPCI falling while price rises = distribution warning.'],
  },
  bwmfi: {
    what: 'Bill Williams’ Market Facilitation Index: how much price moves per million shares. Bars are green when it rises and red when it falls.',
    use: ['Combine with volume: MFI up + volume up = the trend is being pushed (green bar).', '"Squat" (MFI down, volume up) = a battle; a breakout often follows.'],
    signals: ['Squat dots near the end of a trend often mark the turning point.', 'MFI and volume both falling ("fade") = the market is losing interest.'],
  },
  vwmacd: {
    what: 'MACD made from volume-weighted averages, so bars with heavy volume move it more.',
    use: ['Use like MACD: trend direction above/below 0 and crossovers with the signal line.'],
    signals: ['VW-MACD crossing above its signal = bullish; below = bearish.', 'If it lags normal MACD on a rally, the rally lacks volume.'],
  },
  vwrsi: {
    what: 'RSI where every gain or loss is multiplied by that bar’s volume.',
    use: ['Read it like RSI: above 70 = stretched up, below 30 = stretched down.', 'Compare with plain RSI: if VW-RSI is weaker, the gains came on light volume.'],
    signals: ['Turning back below 70 / above 30 = possible reversal.', 'Divergences with price.'],
  },
  relvol: {
    what: 'This bar’s volume divided by the average of the previous N bars.',
    use: ['Find stocks that are "in play": RVOL above 2 means twice the usual volume.'],
    signals: ['Breakouts with RVOL above 1.5-2 are more reliable.', 'Very low RVOL = little interest; moves are less trustworthy.'],
  },
  rvoltod: {
    what: 'Volume compared with the same time of day on previous days, so the naturally busy open and close are judged fairly.',
    use: ['Intraday charts: spot unusual activity at any time of the day.'],
    signals: ['Above 2 = twice the normal volume for this time of day.', 'Rising RVOL into a breakout level = fuel for the breakout.'],
    tip: 'Needs N full days of history at the same bar size before it shows values.',
  },
  volmas: {
    what: 'Volume bars with a fast and a slow moving average of volume.',
    use: ['Shows whether activity is growing (fast above slow) or fading.'],
    signals: ['Volume bars well above both lines = unusual interest.', 'Fast average crossing below the slow one in a rally = participation fading.'],
  },
  updownvol: {
    what: 'Volume split into up-close bars (above zero) and down-close bars (below zero).',
    use: ['See at a glance whether the big volume comes on up days or down days.'],
    signals: ['Big green bars on up days and small red ones on pullbacks = accumulation.', 'The reverse = distribution.'],
  },
  udvr: {
    what: 'Total volume on up-close bars divided by total volume on down-close bars over N bars.',
    use: ['A simple accumulation/distribution gauge.'],
    signals: ['Above 1 (especially above 1.5) = institutions likely accumulating.', 'Below 1 = more volume on down days (distribution).'],
  },
  cvd: {
    what: 'An estimate of cumulative volume delta (buying minus selling volume) from candles only: each bar’s volume x (close - open) / range.',
    use: ['Trend of buying vs selling pressure; true delta needs tick data, so treat this as an approximation.'],
    signals: ['CVD rising while price falls = hidden buying (possible bottom).', 'CVD falling while price rises = hidden selling.'],
    tip: 'This is not the order-flow CVD from a futures platform; use it only as a rough guide.',
  },
  asi: {
    what: 'Wilder’s Accumulative Swing Index: a running total of the Swing Index, a cleaner "real price" line built from open, high, low and close.',
    use: ['Draw trendlines and support/resistance on the ASI like on price.'],
    signals: ['ASI breaking its own trendline or prior swing high/low confirms a price breakout.', 'A price breakout the ASI does not confirm is suspect.'],
    tip: 'Stocks have no limit move; the limit (as % of price) only rescales the line.',
  },
  si: {
    what: 'Wilder’s Swing Index for each bar: how strong the bar’s move was, comparing open, high, low and close with the previous bar.',
    use: ['Mostly used as the building block of the ASI; shows the strength of single bars.'],
    signals: ['Large positive bars = strong up swings; large negative = strong down swings.'],
  },
  vzo: {
    what: 'Volume Zone Oscillator: the % of recent volume that came on up closes minus down closes.',
    use: ['Trend: above +40 = strong uptrend zone, below -40 = strong downtrend zone.', 'Range: turns from +60/-60 often mark extremes.'],
    signals: ['Crossing above 0 (or +5) in an uptrend = buy (Khalil).', 'Falling from above +60 = overbought turn.'],
  },
  bettervol: {
    what: 'Volume bars with marks for climax (largest range x volume), churn (most volume per point of range) and lowest-volume bars, estimated from candles.',
    use: ['Climax bars often mark the end of a move; churn bars show heavy two-sided trading.'],
    signals: ['Climax up at the top of a rally = possible top; climax down after a fall = possible bottom.', 'Low-volume pullback in a trend = healthy pause.'],
    tip: 'The original Better Volume uses tick data and its own rules; this is a simplified version.',
  },
  evwma: {
    what: 'Elastic volume-weighted moving average: each bar pulls the average by its share of recent volume.',
    use: ['A moving average that speeds up on heavy volume and slows down on light volume.'],
    signals: ['Price crossing the line, especially on rising volume.', 'The line flattening = little volume behind price moves.'],
  },
  volz: {
    what: 'How unusual this bar’s volume is: the number of standard deviations from its recent average.',
    use: ['Spot volume spikes in a consistent way across stocks.'],
    signals: ['Above +2 = a volume spike (news, breakout or climax).', 'Below -1 = very quiet bar.'],
  },
  volrank: {
    what: 'The percentile of this bar’s volume against the last N bars (0-100).',
    use: ['Compare volume across stocks with very different average volumes.'],
    signals: ['Above 90 = one of the busiest bars recently.', 'Below 10 on a pullback = quiet, healthy pause.'],
  },
  fve: {
    what: 'Finite Volume Elements: money flow that ignores bars whose move is below a small cutoff, as a % of volume over 22 bars.',
    use: ['Shows accumulation/distribution while filtering out noise bars.'],
    signals: ['Above 0 and rising = buying pressure.', 'Divergence between FVE and price warns of reversals.'],
  },
  vfi: {
    what: 'Volume Flow Indicator: long-term money flow (130 bars) that ignores small moves and caps volume spikes.',
    use: ['Use as a trend filter: only buy when VFI is above 0.'],
    signals: ['VFI crossing above 0 = bullish; below 0 = bearish.', 'VFI rising while price falls = accumulation.'],
    tip: 'Needs about 130 bars before it shows values.',
  },
  wvad: {
    what: 'Williams’ Variable Accumulation/Distribution: volume weighted by how much of the bar’s range went from open to close, summed over N bars.',
    use: ['Shows whether the day’s session (open to close) favoured buyers or sellers on volume.'],
    signals: ['Above 0 = buyers won; below 0 = sellers won.', 'Divergence from price warns of a turn.'],
  },
  tsv: {
    what: 'Time Segmented Volume: price change times volume summed over N bars, with a signal line.',
    use: ['Find accumulation (positive) and distribution (negative) periods.'],
    signals: ['Crossing above 0 = buying; below 0 = selling.', 'TSV crossing its signal line gives earlier signals.'],
    tip: 'Worden’s original TSV is proprietary; this is the common public formula.',
  },
  pvrank: {
    what: 'A 1-4 score for each bar: 1 = up on rising volume, 2 = up on falling volume, 3 = down on falling volume, 4 = down on rising volume.',
    use: ['Read the average: low (near 1-2) = bullish behaviour; high (near 3-4) = bearish.'],
    signals: ['Average crossing below 2.5 = bullish; above 2.5 = bearish.', 'Repeated 1s = strong accumulation.'],
  },
  netvol: {
    what: 'Volume on up-close bars minus volume on down-close bars over the last N bars.',
    use: ['A rolling version of OBV that does not drift; easy to compare over time.'],
    signals: ['Above 0 = more volume on up bars (bullish).', 'Making lower highs while price makes higher highs = divergence.'],
  },
  buysell: {
    what: 'Each bar’s volume split into an estimated buying part (close near the high) and selling part (close near the low).',
    use: ['See whether volume is mostly buying or selling on each bar.'],
    signals: ['Green much bigger than red on a big-volume day = strong buying.', 'Red dominating at resistance = sellers defending.'],
    tip: 'An estimate from candle shape, not real order data.',
  },
  volacc: {
    what: 'Volume Accumulation: a running total of volume multiplied by how far the close is above or below the bar’s midpoint.',
    use: ['Like the A/D line; shows whether closes are in the upper (buying) or lower (selling) half on volume.'],
    signals: ['Rising line = accumulation; falling = distribution.', 'Divergences with price.'],
  },
  weiswave: {
    what: 'Weis Wave volume: total volume of each up wave and down wave of closes, so you can compare the effort behind each swing.',
    use: ['Compare the volume of up waves with down waves (Wyckoff "effort vs result").'],
    signals: ['Up waves with growing volume and down waves with shrinking volume = healthy uptrend.', 'A big-volume wave that makes little progress = absorption, a possible turn.'],
    tip: 'Raise the reversal % to group small wiggles into bigger waves.',
  },
};
