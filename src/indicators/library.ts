/**
 * The built-in indicator library. To add a new indicator, append a definition to INDICATORS:
 * describe its inputs and plots, and write a `compute` function that returns one array per plot.
 */
import type { Bar } from '../types';
import { ema, highest, lowest, rma, rsi, sma, stdev, trueRange, wma } from './math';
import type { IndicatorDef, IndicatorInput, IndicatorParams, PriceSource } from './types';

function source(bars: Bar[], src: PriceSource): number[] {
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

const num = (p: IndicatorParams, key: string) => Number(p[key]);
const src = (bars: Bar[], p: IndicatorParams) => source(bars, p.source as PriceSource);

const lengthInput = (def: number): IndicatorInput => ({ key: 'length', label: 'Length', type: 'number', default: def, min: 1, max: 1000, step: 1 });
const sourceInput: IndicatorInput = { key: 'source', label: 'Source', type: 'source', default: 'close' };

const UP = '#26a69a';
const DOWN = '#ef5350';

export const INDICATORS: IndicatorDef[] = [
  {
    id: 'volume',
    name: 'Volume',
    shortName: 'Vol',
    category: 'Volume',
    description: 'Traded volume per bar, coloured by candle direction.',
    placement: 'volume',
    inputs: [],
    plots: [{ key: 'volume', title: 'Volume', type: 'histogram', color: UP + '80', colorBy: 'candle', negativeColor: DOWN + '80' }],
    compute: (bars) => ({ volume: bars.map((b) => b.volume) }),
  },
  {
    id: 'sma',
    name: 'Simple Moving Average',
    shortName: 'SMA',
    category: 'Moving Averages',
    description: 'Average price over the last N bars.',
    placement: 'overlay',
    inputs: [lengthInput(20), sourceInput],
    plots: [{ key: 'ma', title: 'SMA', type: 'line', color: '#2962ff', lineWidth: 2 }],
    compute: (bars, p) => ({ ma: sma(src(bars, p), num(p, 'length')) }),
  },
  {
    id: 'ema',
    name: 'Exponential Moving Average',
    shortName: 'EMA',
    category: 'Moving Averages',
    description: 'Moving average that weights recent prices more heavily.',
    placement: 'overlay',
    inputs: [lengthInput(50), sourceInput],
    plots: [{ key: 'ma', title: 'EMA', type: 'line', color: '#ff9800', lineWidth: 2 }],
    compute: (bars, p) => ({ ma: ema(src(bars, p), num(p, 'length')) }),
  },
  {
    id: 'wma',
    name: 'Weighted Moving Average',
    shortName: 'WMA',
    category: 'Moving Averages',
    description: 'Moving average with linearly increasing weights.',
    placement: 'overlay',
    inputs: [lengthInput(20), sourceInput],
    plots: [{ key: 'ma', title: 'WMA', type: 'line', color: '#ab47bc', lineWidth: 2 }],
    compute: (bars, p) => ({ ma: wma(src(bars, p), num(p, 'length')) }),
  },
  {
    id: 'vwap',
    name: 'VWAP',
    shortName: 'VWAP',
    category: 'Volume',
    description: 'Volume-weighted average price, resetting each day (UTC).',
    placement: 'overlay',
    inputs: [],
    plots: [{ key: 'vwap', title: 'VWAP', type: 'line', color: '#e91e63', lineWidth: 2 }],
    compute: (bars) => {
      let day = -1;
      let pv = 0;
      let vol = 0;
      const out = bars.map((b) => {
        const d = Math.floor(b.time / 86400);
        if (d !== day) {
          day = d;
          pv = 0;
          vol = 0;
        }
        const tp = (b.high + b.low + b.close) / 3;
        pv += tp * b.volume;
        vol += b.volume;
        return vol === 0 ? tp : pv / vol;
      });
      return { vwap: out };
    },
  },
  {
    id: 'bb',
    name: 'Bollinger Bands',
    shortName: 'BB',
    category: 'Bands & Channels',
    description: 'Moving average with bands N standard deviations above and below.',
    placement: 'overlay',
    inputs: [lengthInput(20), { key: 'mult', label: 'Std dev', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 }, sourceInput],
    plots: [
      { key: 'upper', title: 'Upper', type: 'line', color: '#2196f3', lineWidth: 1 },
      { key: 'basis', title: 'Basis', type: 'line', color: '#ff6d00', lineWidth: 1 },
      { key: 'lower', title: 'Lower', type: 'line', color: '#2196f3', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const s = src(bars, p);
      const len = num(p, 'length');
      const basis = sma(s, len);
      const dev = stdev(s, len);
      const mult = num(p, 'mult');
      return {
        basis,
        upper: basis.map((b, i) => b + mult * dev[i]),
        lower: basis.map((b, i) => b - mult * dev[i]),
      };
    },
  },
  {
    id: 'donchian',
    name: 'Donchian Channels',
    shortName: 'DC',
    category: 'Bands & Channels',
    description: 'Highest high and lowest low over the last N bars.',
    placement: 'overlay',
    inputs: [lengthInput(20)],
    plots: [
      { key: 'upper', title: 'Upper', type: 'line', color: '#26a69a', lineWidth: 1 },
      { key: 'basis', title: 'Basis', type: 'line', color: '#787b86', lineWidth: 1 },
      { key: 'lower', title: 'Lower', type: 'line', color: '#ef5350', lineWidth: 1 },
    ],
    compute: (bars, p) => {
      const len = num(p, 'length');
      const upper = highest(bars.map((b) => b.high), len);
      const lower = lowest(bars.map((b) => b.low), len);
      return { upper, lower, basis: upper.map((u, i) => (u + lower[i]) / 2) };
    },
  },
  {
    id: 'rsi',
    name: 'Relative Strength Index',
    shortName: 'RSI',
    category: 'Momentum',
    description: 'Momentum oscillator from 0 to 100. Above 70 is often called overbought, below 30 oversold.',
    placement: 'separate',
    inputs: [lengthInput(14), sourceInput],
    plots: [{ key: 'rsi', title: 'RSI', type: 'line', color: '#7e57c2', lineWidth: 2 }],
    levels: [70, 30],
    compute: (bars, p) => ({ rsi: rsi(src(bars, p), num(p, 'length')) }),
  },
  {
    id: 'macd',
    name: 'MACD',
    shortName: 'MACD',
    category: 'Momentum',
    description: 'Difference between a fast and slow EMA, with a signal line and histogram.',
    placement: 'separate',
    inputs: [
      { key: 'fast', label: 'Fast length', type: 'number', default: 12, min: 1, max: 500, step: 1 },
      { key: 'slow', label: 'Slow length', type: 'number', default: 26, min: 1, max: 500, step: 1 },
      { key: 'signal', label: 'Signal length', type: 'number', default: 9, min: 1, max: 500, step: 1 },
      sourceInput,
    ],
    plots: [
      { key: 'hist', title: 'Histogram', type: 'histogram', color: UP, colorBy: 'sign', negativeColor: DOWN },
      { key: 'macd', title: 'MACD', type: 'line', color: '#2962ff', lineWidth: 2 },
      { key: 'signal', title: 'Signal', type: 'line', color: '#ff6d00', lineWidth: 2 },
    ],
    levels: [0],
    compute: (bars, p) => {
      const s = src(bars, p);
      const fast = ema(s, num(p, 'fast'));
      const slow = ema(s, num(p, 'slow'));
      const macd = fast.map((f, i) => f - slow[i]);
      const signal = ema(macd, num(p, 'signal'));
      return { macd, signal, hist: macd.map((m, i) => m - signal[i]) };
    },
  },
  {
    id: 'stoch',
    name: 'Stochastic',
    shortName: 'Stoch',
    category: 'Momentum',
    description: 'Where the close sits within the recent high-low range, from 0 to 100.',
    placement: 'separate',
    inputs: [
      { key: 'k', label: '%K length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { key: 'smooth', label: '%K smoothing', type: 'number', default: 3, min: 1, max: 100, step: 1 },
      { key: 'd', label: '%D length', type: 'number', default: 3, min: 1, max: 100, step: 1 },
    ],
    plots: [
      { key: 'k', title: '%K', type: 'line', color: '#2962ff', lineWidth: 2 },
      { key: 'd', title: '%D', type: 'line', color: '#ff6d00', lineWidth: 2 },
    ],
    levels: [80, 20],
    compute: (bars, p) => {
      const len = num(p, 'k');
      const hh = highest(bars.map((b) => b.high), len);
      const ll = lowest(bars.map((b) => b.low), len);
      const raw = bars.map((b, i) => (hh[i] === ll[i] ? 50 : (100 * (b.close - ll[i])) / (hh[i] - ll[i])));
      const k = sma(raw, num(p, 'smooth'));
      return { k, d: sma(k, num(p, 'd')) };
    },
  },
  {
    id: 'cci',
    name: 'Commodity Channel Index',
    shortName: 'CCI',
    category: 'Momentum',
    description: 'How far price is from its average, scaled by typical deviation.',
    placement: 'separate',
    inputs: [lengthInput(20)],
    plots: [{ key: 'cci', title: 'CCI', type: 'line', color: '#26c6da', lineWidth: 2 }],
    levels: [100, -100],
    compute: (bars, p) => {
      const len = num(p, 'length');
      const tp = source(bars, 'hlc3');
      const mean = sma(tp, len);
      const cci = tp.map((v, i) => {
        if (Number.isNaN(mean[i])) return NaN;
        let dev = 0;
        for (let j = i - len + 1; j <= i; j++) dev += Math.abs(tp[j] - mean[i]);
        dev /= len;
        return dev === 0 ? 0 : (v - mean[i]) / (0.015 * dev);
      });
      return { cci };
    },
  },
  {
    id: 'willr',
    name: 'Williams %R',
    shortName: '%R',
    category: 'Momentum',
    description: 'Like Stochastic but scaled from -100 to 0.',
    placement: 'separate',
    inputs: [lengthInput(14)],
    plots: [{ key: 'r', title: '%R', type: 'line', color: '#ec407a', lineWidth: 2 }],
    levels: [-20, -80],
    compute: (bars, p) => {
      const len = num(p, 'length');
      const hh = highest(bars.map((b) => b.high), len);
      const ll = lowest(bars.map((b) => b.low), len);
      return { r: bars.map((b, i) => (hh[i] === ll[i] ? -50 : (-100 * (hh[i] - b.close)) / (hh[i] - ll[i]))) };
    },
  },
  {
    id: 'atr',
    name: 'Average True Range',
    shortName: 'ATR',
    category: 'Volatility',
    description: 'Average size of each bar\'s full range, including gaps. Measures volatility.',
    placement: 'separate',
    inputs: [lengthInput(14)],
    plots: [{ key: 'atr', title: 'ATR', type: 'line', color: '#ef5350', lineWidth: 2 }],
    compute: (bars, p) => {
      const tr = trueRange(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close));
      return { atr: rma(tr, num(p, 'length')) };
    },
  },
  {
    id: 'obv',
    name: 'On-Balance Volume',
    shortName: 'OBV',
    category: 'Volume',
    description: 'Running total of volume, added on up bars and subtracted on down bars.',
    placement: 'separate',
    inputs: [],
    plots: [{ key: 'obv', title: 'OBV', type: 'line', color: '#42a5f5', lineWidth: 2 }],
    compute: (bars) => {
      let total = 0;
      const obv = bars.map((b, i) => {
        if (i > 0) {
          if (b.close > bars[i - 1].close) total += b.volume;
          else if (b.close < bars[i - 1].close) total -= b.volume;
        }
        return total;
      });
      return { obv };
    },
  },
];

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((d) => d.id === id);
}

export function defaultParams(def: IndicatorDef): IndicatorParams {
  return Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
}

export function defaultColors(def: IndicatorDef): Record<string, string> {
  return Object.fromEntries(def.plots.map((p) => [p.key, p.color]));
}

/** Label shown in the chart legend, e.g. "RSI 14 close". */
export function indicatorLabel(def: IndicatorDef, params: IndicatorParams): string {
  const values = def.inputs.map((i) => params[i.key]);
  return values.length ? `${def.shortName} ${values.join(' ')}` : def.shortName;
}
