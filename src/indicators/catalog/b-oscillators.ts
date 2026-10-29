/**
 * Momentum family, part 2: indicators in the 'Oscillators' category (bounded or mean-reverting readings).
 * Sources: StockCharts ChartSchool, TA-Lib, Achelis, the authors' articles and TradingView scripts where noted.
 */
import { ema, highest, lowest, rma, rsi, sma, stdev, trueRange, wma } from '../math';
import { C, change, closes, correlation, div, highs, hist, ift, int, lag, len, line, lows, n, NaNs, slope, sourceInput, src, stochK, sum, superSmoother, type Entry } from './b-util';

const hlc3 = (bars: { high: number; low: number; close: number }[]) => bars.map((b) => (b.high + b.low + b.close) / 3);
const hl2 = (bars: { high: number; low: number }[]) => bars.map((b) => (b.high + b.low) / 2);

/** CCI of a series: (x - SMA) / (0.015 x mean absolute deviation). */
export function cci(x: number[], length: number): number[] {
  const m = sma(x, length);
  return x.map((v, i) => {
    if (Number.isNaN(m[i])) return NaN;
    let dev = 0;
    for (let j = i - length + 1; j <= i; j++) dev += Math.abs(x[j] - m[i]);
    dev /= length;
    return div(v - m[i], 0.015 * dev);
  });
}

/** Recursive smoothing x = prev + k (input - prev), started at the first valid input (Schaff, KDJ). */
function blend(a: number[], k: number, start?: number): number[] {
  const out = NaNs(a.length);
  let prev = start ?? NaN;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) continue;
    prev = Number.isNaN(prev) ? a[i] : prev + k * (a[i] - prev);
    out[i] = prev;
  }
  return out;
}

/** Stochastic of a series against its own range, keeping the previous value when the range is flat (Schaff). */
function selfStoch(a: number[], length: number): number[] {
  const hh = highest(a, length);
  const ll = lowest(a, length);
  const out = NaNs(a.length);
  let prev = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(hh[i])) continue;
    const r = hh[i] - ll[i];
    prev = r > 0 ? (100 * (a[i] - ll[i])) / r : prev;
    out[i] = prev;
  }
  return out;
}

export const OSCILLATOR_ENTRIES: Entry[] = [
  {
    def: {
      id: 'stochf',
      name: 'Fast Stochastic',
      shortName: 'Fast Stoch',
      category: 'Oscillators',
      description: 'Unsmoothed Stochastic: raw %K (close within the N-bar range) and a 3-bar SMA %D (TA-Lib STOCHF).',
      placement: 'separate',
      inputs: [len(14, '%K length'), n('d', '%D length', 3)],
      plots: [line('k', '%K', C.blue), line('d', '%D', C.orange)],
      levels: [80, 20],
      compute: (bars, p) => {
        const k = stochK(closes(bars), highs(bars), lows(bars), int(p, 'length'));
        return { k, d: sma(k, int(p, 'd')) };
      },
    },
    guide: {
      what: 'The original, jumpy Stochastic: where today’s close sits in the recent high-low range (0 = at the low, 100 = at the high).',
      use: ['Above 80 near the top of the range, below 20 near the bottom.', 'Best for very short-term timing; the normal (slow) Stochastic is calmer.'],
      signals: ['%K crossing %D in the extreme zones.'],
    },
  },
  {
    def: {
      id: 'kdj',
      name: 'KDJ',
      shortName: 'KDJ',
      category: 'Oscillators',
      description: 'Stochastic variant popular in Asia: K and D are 1/3 recursive smoothings of the 9-bar raw stochastic (started at 50), J = 3K - 2D.',
      placement: 'separate',
      inputs: [len(9, 'Length'), n('k', 'K smoothing', 3), n('d', 'D smoothing', 3)],
      plots: [line('k', 'K', C.blue), line('d', 'D', C.orange), line('j', 'J', C.purple, 1)],
      levels: [80, 20],
      compute: (bars, p) => {
        const rsv = stochK(closes(bars), highs(bars), lows(bars), int(p, 'length'));
        const k = blend(rsv, 1 / int(p, 'k'), 50);
        const d = blend(k, 1 / int(p, 'd'), 50);
        return { k, d, j: k.map((v, i) => 3 * v - 2 * d[i]) };
      },
    },
    guide: {
      what: 'A Stochastic with an extra J line that exaggerates the gap between K and D, so turns show up early.',
      use: ['K and D above 80 = overbought, below 20 = oversold.', 'J above 100 or below 0 = extreme.'],
      signals: ['K crossing above D in the oversold zone = buy; below D in overbought = sell.'],
    },
  },
  {
    def: {
      id: 'dss',
      name: 'Double Smoothed Stochastic (Bressert)',
      shortName: 'DSS',
      category: 'Oscillators',
      description: 'Walter Bressert’s DSS: EMA of the stochastic, then the stochastic of that line, EMA-smoothed again (13-bar range, 8-bar EMAs).',
      placement: 'separate',
      inputs: [len(13, 'Stochastic length'), n('ema', 'EMA length', 8)],
      plots: [line('dss', 'DSS', C.blue), line('stage1', 'First stage', C.orange, 1)],
      levels: [80, 20],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const e = int(p, 'ema');
        const stage1 = ema(stochK(closes(bars), highs(bars), lows(bars), l), e);
        const dss = ema(stochK(stage1, stage1, stage1, l), e);
        return { dss, stage1 };
      },
    },
    guide: {
      what: 'A Stochastic smoothed twice, which gives clean, rounded swings between 0 and 100.',
      use: ['Above 80 = overbought, below 20 = oversold.'],
      signals: ['DSS turning up from below 20 = buy; turning down from above 80 = sell.', 'DSS crossing the first-stage line.'],
    },
  },
  {
    def: {
      id: 'woodiescci',
      name: "Woodies CCI",
      shortName: 'Woodies CCI',
      category: 'Oscillators',
      description: 'Ken Wood’s CCI setup: 14-bar CCI (histogram) with a 6-bar "turbo" CCI line, on the typical price.',
      placement: 'separate',
      inputs: [len(14, 'CCI length'), n('turbo', 'Turbo length', 6)],
      plots: [hist('cci', 'CCI'), line('turbo', 'Turbo CCI', C.amber, 1)],
      levels: [200, 100, -100, -200],
      compute: (bars, p) => {
        const tp = hlc3(bars);
        return { cci: cci(tp, int(p, 'length')), turbo: cci(tp, int(p, 'turbo')) };
      },
    },
    guide: {
      what: 'The CCI drawn as bars plus a faster CCI line, used for a family of pattern trades (zero-line reject, trend-line break).',
      use: ['Six or more bars on one side of zero = trend in that direction.', '±100 and ±200 mark strong and extreme moves.'],
      signals: ['Zero-line reject: in a trend, CCI pulls back toward zero and bounces away again.', 'Turbo CCI hooking first warns of a turn.'],
    },
  },
  {
    def: {
      id: 'fisher',
      name: 'Fisher Transform',
      shortName: 'Fisher',
      category: 'Oscillators',
      description: 'Ehlers’ Fisher transform of the bar midpoint’s position in its N-bar range (TradingView formula: 0.66/0.67 smoothing, ±0.999 clamp), with the previous value as trigger.',
      placement: 'separate',
      inputs: [len(9)],
      plots: [line('fisher', 'Fisher', C.blue), line('trigger', 'Trigger', C.orange, 1)],
      levels: [1.5, 0, -1.5],
      compute: (bars, p) => {
        const m = hl2(bars);
        const l = int(p, 'length');
        const hh = highest(m, l);
        const ll = lowest(m, l);
        const fisher = NaNs(m.length);
        let v = 0;
        let f = 0;
        for (let i = 0; i < m.length; i++) {
          if (Number.isNaN(hh[i])) continue;
          const pos = hh[i] === ll[i] ? 0 : (m[i] - ll[i]) / (hh[i] - ll[i]) - 0.5;
          v = 0.66 * pos + 0.67 * v;
          v = v > 0.99 ? 0.999 : v < -0.99 ? -0.999 : v;
          f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * f;
          fisher[i] = f;
        }
        return { fisher, trigger: lag(fisher, 1) };
      },
    },
    guide: {
      what: 'Turns price into a line with sharp, clear turning points by stretching values near the edges of the recent range.',
      use: ['Big readings (beyond ±1.5) mean price is at an extreme of its recent range.'],
      signals: ['Fisher crossing its trigger line, especially from an extreme.'],
      tip: 'Very fast: confirm with the trend.',
    },
  },
  {
    def: {
      id: 'ifrsi',
      name: 'Inverse Fisher RSI',
      shortName: 'IFT RSI',
      category: 'Oscillators',
      description: 'Sylvain Vervoort’s inverse Fisher transform of RSI: 0.1 x (RSI(5) - 50), 9-bar WMA, then (e^2x - 1)/(e^2x + 1), from -1 to +1.',
      placement: 'separate',
      inputs: [len(5, 'RSI length'), n('wma', 'WMA length', 9)],
      plots: [line('ift', 'IFT RSI', C.purple)],
      levels: [0.5, -0.5],
      compute: (bars, p) => ({ ift: wma(rsi(closes(bars), int(p, 'length')).map((r) => 0.1 * (r - 50)), int(p, 'wma')).map(ift) }),
    },
    guide: {
      what: 'An RSI squeezed between -1 and +1 so that it snaps quickly from one side to the other, giving clear signals.',
      use: ['Above +0.5 = bullish zone; below -0.5 = bearish zone.'],
      signals: ['Crossing up through -0.5 = buy; crossing down through +0.5 = sell.'],
    },
  },
  {
    def: {
      id: 'ifstoch',
      name: 'Inverse Fisher Stochastic',
      shortName: 'IFT Stoch',
      category: 'Oscillators',
      description: 'Inverse Fisher transform of the raw stochastic: 0.1 x (%K - 50), 9-bar WMA, then (e^2x - 1)/(e^2x + 1).',
      placement: 'separate',
      inputs: [len(14, 'Stochastic length'), n('wma', 'WMA length', 9)],
      plots: [line('ift', 'IFT Stoch', C.blue)],
      levels: [0.5, -0.5],
      compute: (bars, p) => ({ ift: wma(stochK(closes(bars), highs(bars), lows(bars), int(p, 'length')).map((k) => 0.1 * (k - 50)), int(p, 'wma')).map(ift) }),
    },
    guide: {
      what: 'The Stochastic squeezed between -1 and +1, so it spends most of its time at the edges and flips quickly.',
      use: ['Above +0.5 bullish, below -0.5 bearish.'],
      signals: ['Crosses of ±0.5.'],
    },
  },
  {
    def: {
      id: 'rvgi',
      name: 'Relative Vigor Index',
      shortName: 'RVGI',
      category: 'Oscillators',
      description: 'Ehlers’ RVI: N-bar sum of the 1-2-2-1 weighted (close - open) over the same of (high - low), with a 1-2-2-1 signal line.',
      placement: 'separate',
      inputs: [len(10)],
      plots: [line('rvi', 'RVI', C.up), line('signal', 'Signal', C.down)],
      levels: [0],
      compute: (bars, p) => {
        const swma = (a: number[]) => a.map((_, i) => (i < 3 ? NaN : (a[i] + 2 * a[i - 1] + 2 * a[i - 2] + a[i - 3]) / 6));
        const l = int(p, 'length');
        const num = sum(swma(bars.map((b) => b.close - b.open)), l);
        const den = sum(swma(bars.map((b) => b.high - b.low)), l);
        const rvi = num.map((v, i) => div(v, den[i]));
        return { rvi, signal: swma(rvi) };
      },
    },
    guide: {
      what: 'Measures the "vigour" of a move: in uptrends closes tend to be above opens, in downtrends below.',
      use: ['Above zero = closes beat opens on balance.'],
      signals: ['RVI crossing its signal line.', 'Divergences with price.'],
    },
  },
  {
    def: {
      id: 'rvi_dorsey',
      name: 'Relative Volatility Index',
      shortName: 'RVI',
      category: 'Oscillators',
      description: 'Donald Dorsey’s RVI as on TradingView: RSI-style split of the 10-bar standard deviation into up-bar and down-bar parts, each smoothed with a 14-bar EMA.',
      placement: 'separate',
      inputs: [n('stdev', 'Stdev length', 10), len(14, 'Smoothing'), sourceInput()],
      plots: [line('rvi', 'RVI', C.purple)],
      levels: [70, 30],
      compute: (bars, p) => {
        const s = src(bars, p);
        const sd = stdev(s, int(p, 'stdev'));
        const ch = change(s);
        const l = int(p, 'length');
        const upper = ema(sd.map((v, i) => (Number.isNaN(v) || Number.isNaN(ch[i]) ? NaN : ch[i] <= 0 ? 0 : v)), l);
        const lower = ema(sd.map((v, i) => (Number.isNaN(v) || Number.isNaN(ch[i]) ? NaN : ch[i] > 0 ? 0 : v)), l);
        return { rvi: upper.map((u, i) => div(100 * u, u + lower[i], 50)) };
      },
    },
    guide: {
      what: 'Like RSI, but it measures whether volatility is happening on up days or down days rather than the size of the moves.',
      use: ['Above 50 = volatility comes with up moves (bullish).', 'Dorsey meant it as a confirmation filter for other signals.'],
      signals: ['Only take buy signals from another tool when RVI is above 50 (sells below 50).'],
    },
  },
  {
    def: {
      id: 'lrsi',
      name: 'Laguerre RSI',
      shortName: 'Laguerre RSI',
      category: 'Oscillators',
      description: 'Ehlers’ Laguerre RSI (0-100): an RSI over a 4-stage Laguerre filter; gamma 0.5 (higher = smoother). The filter starts at the first price.',
      placement: 'separate',
      inputs: [n('gamma', 'Gamma', 0.5, 0, 0.95, 0.05), sourceInput()],
      plots: [line('lrsi', 'Laguerre RSI', C.purple)],
      levels: [80, 20],
      compute: (bars, p) => {
        const s = src(bars, p);
        const g = Math.min(0.99, Math.max(0, Number(p.gamma)));
        const out = NaNs(s.length);
        if (!s.length) return { lrsi: out };
        let l0 = s[0], l1 = s[0], l2 = s[0], l3 = s[0];
        let prev = 50;
        for (let i = 0; i < s.length; i++) {
          const n0 = (1 - g) * s[i] + g * l0;
          const n1 = -g * n0 + l0 + g * l1;
          const n2 = -g * n1 + l1 + g * l2;
          const n3 = -g * n2 + l2 + g * l3;
          l0 = n0; l1 = n1; l2 = n2; l3 = n3;
          let cu = 0;
          let cd = 0;
          for (const d of [l0 - l1, l1 - l2, l2 - l3]) {
            if (d > 0) cu += d;
            else cd -= d;
          }
          if (cu + cd !== 0) prev = (100 * cu) / (cu + cd);
          out[i] = prev;
        }
        return { lrsi: out };
      },
    },
    guide: {
      what: 'A fast, smooth RSI from John Ehlers that reaches 0 and 100 often, giving crisp signals.',
      use: ['Above 80 = overbought, below 20 = oversold.', 'Raise gamma for a smoother line, lower it for a faster one.'],
      signals: ['Crossing up through 20 = buy; down through 80 = sell.'],
    },
  },
  {
    def: {
      id: 'stc',
      name: 'Schaff Trend Cycle',
      shortName: 'STC',
      category: 'Oscillators',
      description: 'Doug Schaff’s STC: a MACD (23/50) put through two stochastic + 0.5-factor smoothing passes over 10 bars (common TradingView formula).',
      placement: 'separate',
      inputs: [n('fast', 'Fast length', 23), n('slow', 'Slow length', 50), len(10, 'Cycle length'), n('factor', 'Factor', 0.5, 0.05, 1, 0.05)],
      plots: [line('stc', 'STC', C.purple)],
      levels: [75, 25],
      compute: (bars, p) => {
        const c = closes(bars);
        const f = ema(c, int(p, 'fast'));
        const s = ema(c, int(p, 'slow'));
        const macd = f.map((v, i) => v - s[i]);
        const l = int(p, 'length');
        const k = Number(p.factor);
        const pf = blend(selfStoch(macd, l), k);
        return { stc: blend(selfStoch(pf, l), k) };
      },
    },
    guide: {
      what: 'A fast trend gauge (0-100) that combines MACD with the Stochastic so it turns earlier than MACD.',
      use: ['Above 75 = uptrend in force; below 25 = downtrend.'],
      signals: ['Turning up from below 25 = buy; turning down from above 75 = sell.'],
    },
  },
  {
    def: {
      id: 'qqe',
      name: 'QQE',
      shortName: 'QQE',
      category: 'Oscillators',
      description: 'Quantitative Qualitative Estimation (common TradingView version): 5-bar EMA of RSI(14) with a trailing line set 4.236 x the double-smoothed (27-bar EMA) RSI change away.',
      placement: 'separate',
      inputs: [len(14, 'RSI length'), n('smooth', 'RSI smoothing', 5), n('factor', 'QQE factor', 4.236, 0.1, 20, 0.001)],
      plots: [line('rsi', 'QQE (smoothed RSI)', C.blue), line('trail', 'Trailing line', C.orange, 1)],
      levels: [50],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const r = ema(rsi(closes(bars), l), int(p, 'smooth'));
        const wilders = l * 2 - 1;
        const dar = ema(ema(r.map((v, i) => (i === 0 ? NaN : Math.abs(v - r[i - 1]))), wilders), wilders).map((v) => v * Number(p.factor));
        const len_ = r.length;
        const longband = NaNs(len_);
        const shortband = NaNs(len_);
        const trail = NaNs(len_);
        let trend = 1;
        const gt = (a: number, b: number) => a > b; // NaN compares false, like Pine's na
        for (let i = 0; i < len_; i++) {
          const nl = r[i] - dar[i];
          const ns = r[i] + dar[i];
          const lb1 = i > 0 ? longband[i - 1] : NaN;
          const sb1 = i > 0 ? shortband[i - 1] : NaN;
          const r1 = i > 0 ? r[i - 1] : NaN;
          longband[i] = gt(r1, lb1) && gt(r[i], lb1) ? Math.max(lb1, nl) : nl;
          shortband[i] = gt(sb1, r1) && gt(sb1, r[i]) ? Math.min(sb1, ns) : ns;
          const sb2 = i > 1 ? shortband[i - 2] : NaN;
          const lb2 = i > 1 ? longband[i - 2] : NaN;
          const crossS = (gt(r[i], sb1) && !gt(r1, sb2) && !Number.isNaN(r1) && !Number.isNaN(sb2)) || (gt(sb1, r[i]) && !gt(sb2, r1) && !Number.isNaN(r1) && !Number.isNaN(sb2));
          const crossL = (gt(lb1, r[i]) && !gt(lb2, r1) && !Number.isNaN(r1) && !Number.isNaN(lb2)) || (gt(r[i], lb1) && !gt(r1, lb2) && !Number.isNaN(r1) && !Number.isNaN(lb2));
          if (crossS) trend = 1;
          else if (crossL) trend = -1;
          trail[i] = trend === 1 ? longband[i] : shortband[i];
        }
        return { rsi: r, trail };
      },
    },
    guide: {
      what: 'A smoothed RSI with a trailing line that works like a stop: when the RSI crosses it, momentum has flipped.',
      use: ['Smoothed RSI above 50 = bullish; below 50 = bearish.'],
      signals: ['Smoothed RSI crossing the trailing line.', 'Crossing 50.'],
    },
  },
  {
    def: {
      id: 'wt',
      name: 'WaveTrend',
      shortName: 'WT',
      category: 'Oscillators',
      description: 'LazyBear’s WaveTrend: CCI-like ratio of typical price to its 10-bar EMA and mean deviation, smoothed by a 21-bar EMA (WT1), with a 4-bar SMA (WT2).',
      placement: 'separate',
      inputs: [n('channel', 'Channel length', 10), n('average', 'Average length', 21)],
      plots: [line('wt1', 'WT1', C.up), line('wt2', 'WT2', C.down, 1)],
      levels: [60, 53, -53, -60],
      compute: (bars, p) => {
        const ap = hlc3(bars);
        const n1 = int(p, 'channel');
        const esa = ema(ap, n1);
        const d = ema(ap.map((v, i) => Math.abs(v - esa[i])), n1);
        const ci = ap.map((v, i) => div(v - esa[i], 0.015 * d[i]));
        const wt1 = ema(ci, int(p, 'average'));
        return { wt1, wt2: sma(wt1, 4) };
      },
    },
    guide: {
      what: 'A smooth overbought/oversold wave popular with crypto traders.',
      use: ['Above +53/+60 = overbought; below -53/-60 = oversold.'],
      signals: ['WT1 crossing WT2 inside the extreme zones.'],
    },
  },
  {
    def: {
      id: 'psy',
      name: 'Psychological Line',
      shortName: 'PSY',
      category: 'Oscillators',
      description: 'Percentage of the last N bars that closed higher than the bar before.',
      placement: 'separate',
      inputs: [len(12)],
      plots: [line('psy', 'PSY', C.purple)],
      levels: [75, 25],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const up = sum(change(closes(bars)).map((c) => (Number.isNaN(c) ? NaN : c > 0 ? 1 : 0)), l);
        return { psy: up.map((u) => (100 * u) / l) };
      },
    },
    guide: {
      what: 'A simple crowd-mood gauge: what share of recent days were up days.',
      use: ['Above 75 = many up days in a row (optimism); below 25 = pessimism.'],
      signals: ['Extremes often come before pullbacks or bounces.'],
    },
  },
  {
    def: {
      id: 'rainbow_osc',
      name: 'Rainbow Oscillator',
      shortName: 'Rainbow',
      category: 'Oscillators',
      description: 'Mel Widner’s Rainbow: close minus the average of 10 recursive 2-bar SMAs, as a percent of the 10-bar high-low range; bands show the spread of the 10 averages.',
      placement: 'separate',
      inputs: [len(2, 'SMA length'), n('lookback', 'Range length', 10)],
      plots: [hist('osc', 'Rainbow'), line('upper', 'Band +', C.grey, 1), line('lower', 'Band -', C.grey, 1)],
      levels: [0],
      compute: (bars, p) => {
        const c = closes(bars);
        const l = int(p, 'length');
        const mas: number[][] = [];
        let m = c;
        for (let k = 0; k < 10; k++) mas.push((m = sma(m, l)));
        const lb = int(p, 'lookback');
        const hh = highest(c, lb);
        const ll = lowest(c, lb);
        const osc = NaNs(c.length);
        const upper = NaNs(c.length);
        for (let i = 0; i < c.length; i++) {
          const vals = mas.map((a) => a[i]);
          if (vals.some(Number.isNaN) || Number.isNaN(hh[i])) continue;
          const avg = vals.reduce((t, v) => t + v, 0) / 10;
          const r = hh[i] - ll[i];
          osc[i] = div(100 * (c[i] - avg), r);
          upper[i] = div(100 * (Math.max(...vals) - Math.min(...vals)), r);
        }
        return { osc, upper, lower: upper.map((v) => -v) };
      },
    },
    guide: {
      what: 'Compares price with a "rainbow" of ten ever-smoother moving averages; the bands show how spread out the averages are.',
      use: ['Oscillator above zero = price above the rainbow (bullish).', 'Wide bands = strong trend; narrow = quiet market.'],
      signals: ['Oscillator crossing zero.', 'Extreme readings with very wide bands warn that the move is stretched.'],
    },
  },
  {
    def: {
      id: 'demarker',
      name: 'DeMarker',
      shortName: 'DeM',
      category: 'Oscillators',
      description: 'Tom DeMark’s DeMarker (0-1): SMA of higher-high amounts over SMA of higher-high plus lower-low amounts.',
      placement: 'separate',
      inputs: [len(14)],
      plots: [line('dem', 'DeMarker', C.purple)],
      levels: [0.7, 0.3],
      compute: (bars, p) => {
        const l = int(p, 'length');
        const h = highs(bars);
        const lo = lows(bars);
        const up = sma(h.map((v, i) => (i === 0 ? NaN : Math.max(v - h[i - 1], 0))), l);
        const dn = sma(lo.map((v, i) => (i === 0 ? NaN : Math.max(lo[i - 1] - v, 0))), l);
        return { dem: up.map((u, i) => div(u, u + dn[i], 0.5)) };
      },
    },
    guide: {
      what: 'Compares how far new highs push up with how far new lows push down, on a 0-1 scale.',
      use: ['Above 0.7 = overbought; below 0.3 = oversold.'],
      signals: ['Turning back from the zones; divergences with price.'],
    },
  },
  {
    def: {
      id: 'rei',
      name: 'Range Expansion Index',
      shortName: 'REI',
      category: 'Oscillators',
      description: 'Tom DeMark’s TD REI (common MetaStock/TradingView form): 2-bar changes of high and low, zeroed when price fails to overlap 5-8 bars back, summed over 8 bars, -100..+100.',
      placement: 'separate',
      inputs: [len(8)],
      plots: [line('rei', 'REI', C.blue)],
      levels: [60, -60],
      compute: (bars, p) => {
        const h = highs(bars);
        const l = lows(bars);
        const c = closes(bars);
        const numA = NaNs(h.length);
        const denA = NaNs(h.length);
        for (let i = 8; i < h.length; i++) {
          const x1 = h[i - 2] < c[i - 7] && h[i - 2] < c[i - 8] && h[i] < h[i - 5] && h[i] < h[i - 6] ? 0 : 1;
          const x2 = l[i - 2] > c[i - 7] && l[i - 2] > c[i - 8] && l[i] > l[i - 5] && l[i] > l[i - 6] ? 0 : 1;
          const dh = h[i] - h[i - 2];
          const dl = l[i] - l[i - 2];
          numA[i] = x1 * x2 * (dh + dl);
          denA[i] = Math.abs(dh) + Math.abs(dl);
        }
        const k = int(p, 'length');
        const nu = sum(numA, k);
        const de = sum(denA, k);
        return { rei: nu.map((v, i) => div(100 * v, de[i])) };
      },
    },
    guide: {
      what: 'DeMark’s overbought/oversold gauge that ignores moves where price is not really expanding its range.',
      use: ['Above +60 = overbought; below -60 = oversold.', 'DeMark: be careful if it stays beyond ±60 for more than 6 bars (strong trend).'],
      signals: ['A short visit beyond ±60 and a return inside = reversal setup.'],
    },
  },
  {
    def: {
      id: 'traders_di',
      name: "Traders Dynamic Index",
      shortName: 'TDI',
      category: 'Oscillators',
      description: 'Dean Malone’s TDI: RSI(13) with a 2-bar SMA (fast) and 7-bar SMA (slow), plus 34-bar Bollinger-style bands (1.6185 stdev) around the RSI’s mean.',
      placement: 'separate',
      inputs: [len(13, 'RSI length'), n('band', 'Band length', 34), n('fast', 'Fast line', 2), n('slow', 'Slow line', 7)],
      plots: [line('fast', 'Price line', C.up), line('slow', 'Signal line', C.down), line('mid', 'Market base', C.amber, 1), line('upper', 'Upper band', C.sky, 1), line('lower', 'Lower band', C.sky, 1)],
      levels: [68, 50, 32],
      compute: (bars, p) => {
        const r = rsi(closes(bars), int(p, 'length'));
        const b = int(p, 'band');
        const mid = sma(r, b);
        const sd = stdev(r, b);
        return {
          fast: sma(r, int(p, 'fast')),
          slow: sma(r, int(p, 'slow')),
          mid,
          upper: mid.map((m, i) => m + 1.6185 * sd[i]),
          lower: mid.map((m, i) => m - 1.6185 * sd[i]),
        };
      },
    },
    guide: {
      what: 'An RSI dashboard: a fast and slow RSI line for timing, a middle line for the trend and bands for volatility.',
      use: ['Fast line above the market base (yellow) = uptrend.', 'Bands widening = volatility rising.'],
      signals: ['Fast (green) line crossing the slow (red) line, in the direction of the market base.', 'Readings above 68 or below 32 are extreme.'],
    },
  },
  {
    def: {
      id: 'derivosc',
      name: 'Derivative Oscillator',
      shortName: 'DerivOsc',
      category: 'Oscillators',
      description: 'Constance Brown’s derivative oscillator: RSI(14) double-smoothed with EMAs (5, 3), minus its 9-bar SMA, as a histogram.',
      placement: 'separate',
      inputs: [len(14, 'RSI length'), n('ema1', 'First EMA', 5), n('ema2', 'Second EMA', 3), n('signal', 'SMA length', 9)],
      plots: [hist('osc', 'Derivative')],
      levels: [0],
      compute: (bars, p) => {
        const s1 = ema(ema(rsi(closes(bars), int(p, 'length')), int(p, 'ema1')), int(p, 'ema2'));
        const sig = sma(s1, int(p, 'signal'));
        return { osc: s1.map((v, i) => v - sig[i]) };
      },
    },
    guide: {
      what: 'A MACD-style histogram made from a smoothed RSI: it shows whether RSI momentum is speeding up or slowing.',
      use: ['Above zero = the smoothed RSI is rising faster than usual.'],
      signals: ['Zero-line crosses.', 'Divergences with price.'],
    },
  },
  {
    def: {
      id: 'cbci',
      name: 'Composite Index (Brown)',
      shortName: 'CI',
      category: 'Oscillators',
      description: 'Constance Brown’s Composite Index: 9-bar momentum of RSI(14) plus a 3-bar SMA of RSI(3), with 13- and 33-bar SMAs. It is not bounded, so it diverges where RSI cannot.',
      placement: 'separate',
      inputs: [len(14, 'RSI length'), n('mom', 'RSI momentum', 9), n('fastRsi', 'Short RSI', 3), n('fastMa', 'Short RSI SMA', 3), n('ma1', 'Fast SMA', 13), n('ma2', 'Slow SMA', 33)],
      plots: [line('ci', 'Composite', C.blue), line('fast', 'Fast SMA', C.up, 1), line('slow', 'Slow SMA', C.down, 1)],
      compute: (bars, p) => {
        const c = closes(bars);
        const r = rsi(c, int(p, 'length'));
        const mom = change(r, int(p, 'mom'));
        const short = sma(rsi(c, int(p, 'fastRsi')), int(p, 'fastMa'));
        const ci = mom.map((v, i) => v + short[i]);
        return { ci, fast: sma(ci, int(p, 'ma1')), slow: sma(ci, int(p, 'ma2')) };
      },
    },
    guide: {
      what: 'An RSI-based line built to show divergences that the normal RSI misses, because it is not capped at 0 and 100.',
      use: ['Compare its peaks and troughs with price: a lower peak while price makes a higher one is a warning.'],
      signals: ['Divergences with price (and with RSI).', 'Crosses of its two averages.'],
    },
  },
  {
    def: {
      id: 'premier',
      name: 'Premier Stochastic',
      shortName: 'Premier',
      category: 'Oscillators',
      description: 'Lee Leibfarth’s Premier Stochastic: 0.1 x (%K(8) - 50) double-smoothed with 5-bar EMAs, then (e^x - 1)/(e^x + 1), from -1 to +1.',
      placement: 'separate',
      inputs: [len(8, 'Stochastic length'), n('smooth', 'EMA length', 5)],
      plots: [line('ps', 'Premier', C.blue)],
      levels: [0.9, 0.2, -0.2, -0.9],
      compute: (bars, p) => {
        const k = stochK(closes(bars), highs(bars), lows(bars), int(p, 'length')).map((v) => 0.1 * (v - 50));
        const e = int(p, 'smooth');
        return { ps: ema(ema(k, e), e).map((v) => (Number.isNaN(v) ? NaN : Math.tanh(v / 2))) };
      },
    },
    guide: {
      what: 'A Stochastic smoothed and squeezed into -1..+1 so that only strong turns cross the trigger levels.',
      use: ['Above +0.9 = strongly overbought; below -0.9 = strongly oversold.'],
      signals: ['Crossing back below +0.9 (or +0.2) = sell; crossing back above -0.9 (or -0.2) = buy.'],
    },
  },
  {
    def: {
      id: 'pgo',
      name: 'Pretty Good Oscillator',
      shortName: 'PGO',
      category: 'Oscillators',
      description: 'Mark Johnson’s PGO: (close - SMA) / EMA of true range, i.e. the distance from the average in "average ranges".',
      placement: 'separate',
      inputs: [len(14)],
      plots: [line('pgo', 'PGO', C.blue)],
      levels: [3, 0, -3],
      compute: (bars, p) => {
        const c = closes(bars);
        const l = int(p, 'length');
        const m = sma(c, l);
        const atr = ema(trueRange(highs(bars), lows(bars), c), l);
        return { pgo: c.map((v, i) => div(v - m[i], atr[i])) };
      },
    },
    guide: {
      what: 'How many average daily ranges price is away from its moving average.',
      use: ['Johnson’s rule: above +3 = start of a long-term uptrend; below -3 = downtrend.'],
      signals: ['Crossing +3 to buy; crossing back to zero to exit.'],
    },
  },
  {
    def: {
      id: 'projosc',
      name: 'Projection Oscillator',
      shortName: 'PO',
      category: 'Oscillators',
      description: 'Mel Widner’s projection oscillator: where the close sits (0-100) between regression-slope-adjusted projection bands of the highs and lows, with a 3-bar EMA trigger.',
      placement: 'separate',
      inputs: [len(14), n('signal', 'Trigger length', 3)],
      plots: [line('po', 'PO', C.blue), line('signal', 'Trigger', C.orange, 1)],
      levels: [80, 20],
      compute: (bars, p) => {
        const l = int(p, 'length', 2);
        const h = highs(bars);
        const lo = lows(bars);
        const sh = slope(h, l);
        const sl = slope(lo, l);
        const po = h.map((_, i) => {
          if (Number.isNaN(sh[i])) return NaN;
          let up = -Infinity;
          let dn = Infinity;
          for (let k = 0; k < l; k++) {
            up = Math.max(up, h[i - k] + k * sh[i]);
            dn = Math.min(dn, lo[i - k] + k * sl[i]);
          }
          return div(100 * (bars[i].close - dn), up - dn, 50);
        });
        return { po, signal: ema(po, int(p, 'signal')) };
      },
    },
    guide: {
      what: 'A Stochastic that tilts its range with the trend, so it does not stay pinned at the top in a steady uptrend.',
      use: ['Above 80 = near the top of the projected range; below 20 = near the bottom.'],
      signals: ['PO crossing its trigger line from an extreme zone.'],
    },
  },
  {
    def: {
      id: 'gator',
      name: 'Gator Oscillator',
      shortName: 'Gator',
      category: 'Oscillators',
      description: 'Bill Williams’ Gator: |jaw - teeth| above zero and -|teeth - lips| below, from the Alligator’s smoothed (SMMA 13/8/5, shifted 8/5/3) midpoint lines.',
      placement: 'separate',
      inputs: [n('jaw', 'Jaw length', 13), n('jawShift', 'Jaw shift', 8, 0), n('teeth', 'Teeth length', 8), n('teethShift', 'Teeth shift', 5, 0), n('lips', 'Lips length', 5), n('lipsShift', 'Lips shift', 3, 0)],
      plots: [hist('upper', 'Upper', 'change'), hist('lower', 'Lower', 'change')],
      compute: (bars, p) => {
        const m = hl2(bars);
        const jaw = lag(rma(m, int(p, 'jaw')), int(p, 'jawShift', 0));
        const teeth = lag(rma(m, int(p, 'teeth')), int(p, 'teethShift', 0));
        const lips = lag(rma(m, int(p, 'lips')), int(p, 'lipsShift', 0));
        return { upper: jaw.map((v, i) => Math.abs(v - teeth[i])), lower: teeth.map((v, i) => -Math.abs(v - lips[i])) };
      },
    },
    guide: {
      what: 'Shows how far apart the three Alligator lines are: bars growing on both sides = the "gator is eating" (a trend); shrinking = it is sleeping (range).',
      use: ['Both sides growing = trend in progress; both shrinking = quiet market.'],
      signals: ['A switch from shrinking to growing bars = a new trend may be starting.'],
    },
  },
  {
    def: {
      id: 'dpo',
      name: 'Detrended Price Oscillator',
      shortName: 'DPO',
      category: 'Oscillators',
      description: 'StockCharts DPO: the close (N/2 + 1) bars ago minus the N-bar SMA. Removes the trend to show shorter cycles.',
      placement: 'separate',
      inputs: [len(20), sourceInput()],
      plots: [hist('dpo', 'DPO')],
      levels: [0],
      compute: (bars, p) => {
        const s = src(bars, p);
        const l = int(p, 'length');
        const m = sma(s, l);
        const back = lag(s, Math.floor(l / 2) + 1);
        return { dpo: back.map((v, i) => v - m[i]) };
      },
    },
    guide: {
      what: 'Takes the trend out of price so you can see the short cycles — the regular peaks and troughs.',
      use: ['Measure the distance between DPO peaks (or troughs) to estimate the cycle length.'],
      signals: ['Cycle lows below zero often line up with buying opportunities in a range.'],
      tip: 'It is not a momentum timing tool; use it to find the rhythm of the market.',
    },
  },
  {
    def: {
      id: 'cti',
      name: 'Correlation Trend Indicator',
      shortName: 'CTI',
      category: 'Oscillators',
      description: 'John Ehlers’ CTI (2020): Pearson correlation of the last N closes with a straight rising line, from -1 to +1.',
      placement: 'separate',
      inputs: [len(20), sourceInput()],
      plots: [line('cti', 'CTI', C.blue)],
      levels: [0.5, 0, -0.5],
      compute: (bars, p) => {
        const s = src(bars, p);
        return { cti: correlation(s, s.map((_, i) => i), int(p, 'length', 2)) };
      },
    },
    guide: {
      what: 'How closely the last N closes follow a straight upward line (+1) or downward line (-1).',
      use: ['Near +1 = clean uptrend; near -1 = clean downtrend; near 0 = no trend.'],
      signals: ['Crossing zero = trend change.'],
    },
  },
  {
    def: {
      id: 'dso',
      name: 'Deviation-Scaled Oscillator',
      shortName: 'DSO',
      category: 'Oscillators',
      description: 'Ehlers’ DSO (2018): Super Smoother (half period) of the 2-bar change, divided by its N-bar RMS, then Fisher-transformed (kept when the scaled value reaches ±2).',
      placement: 'separate',
      inputs: [len(40, 'Period')],
      plots: [line('dso', 'DSO', C.blue)],
      levels: [2, 0, -2],
      compute: (bars, p) => {
        const c = closes(bars);
        const l = int(p, 'length', 2);
        const filt = superSmoother(change(c, 2), 0.5 * l);
        const out = NaNs(c.length);
        let fisher = 0;
        for (let i = 0; i < c.length; i++) {
          if (i - l + 1 < 0 || Number.isNaN(filt[i - l + 1])) continue;
          let ms = 0;
          for (let j = i - l + 1; j <= i; j++) ms += filt[j] * filt[j];
          const rms = Math.sqrt(ms / l);
          const scaled = rms === 0 ? 0 : filt[i] / rms;
          if (Math.abs(scaled) < 2) fisher = 0.5 * Math.log((1 + scaled / 2) / (1 - scaled / 2));
          out[i] = fisher;
        }
        return { dso: out };
      },
    },
    guide: {
      what: 'A smoothed momentum line rescaled by its own typical size, so the same levels work on any market.',
      use: ['Readings beyond ±2 are extremes.'],
      signals: ['Turns from beyond ±2 = possible reversal.', 'Zero-line crosses.'],
    },
  },
  {
    def: {
      id: 'ifcci',
      name: 'Inverse Fisher CCI',
      shortName: 'IFT CCI',
      category: 'Oscillators',
      description: 'Inverse Fisher transform of the CCI: CCI(14) / 100, 9-bar WMA, then (e^2x - 1)/(e^2x + 1), from -1 to +1 (the /100 scaling is this platform’s choice).',
      placement: 'separate',
      inputs: [len(14, 'CCI length'), n('wma', 'WMA length', 9)],
      plots: [line('ift', 'IFT CCI', C.blue)],
      levels: [0.5, -0.5],
      compute: (bars, p) => ({ ift: wma(cci(hlc3(bars), int(p, 'length')).map((v) => v / 100), int(p, 'wma')).map(ift) }),
    },
    guide: {
      what: 'The CCI squeezed between -1 and +1, so it flips quickly between bullish and bearish.',
      use: ['Above +0.5 bullish, below -0.5 bearish.'],
      signals: ['Crossing up through -0.5 = buy; down through +0.5 = sell.'],
    },
  },
  {
    def: {
      id: 'stochcci',
      name: 'Stochastic CCI',
      shortName: 'Stoch CCI',
      category: 'Oscillators',
      description: 'Stochastic of the CCI: where CCI(14) sits within its own 14-bar range (0-100), %K smoothed 3, %D 3.',
      placement: 'separate',
      inputs: [len(14, 'CCI length'), n('stoch', 'Stochastic length', 14), n('k', '%K smoothing', 3), n('d', '%D length', 3)],
      plots: [line('k', '%K', C.blue), line('d', '%D', C.orange)],
      levels: [80, 20],
      compute: (bars, p) => {
        const x = cci(hlc3(bars), int(p, 'length'));
        const k = sma(stochK(x, x, x, int(p, 'stoch')), int(p, 'k'));
        return { k, d: sma(k, int(p, 'd')) };
      },
    },
    guide: {
      what: 'Applies the Stochastic to the CCI, making a fast 0-100 oscillator that reaches its extremes often.',
      use: ['Above 80 = overbought, below 20 = oversold.'],
      signals: ['%K crossing %D in the extreme zones.'],
    },
  },
];
