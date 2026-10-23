/** Ready-made strategies for the backtester. Each turns bars + settings into buy/sell signals. */
import { ema, highest, lowest, rsi, sma, stdev } from '../indicators/math';
import type { Bar } from '../types';
import type { Signals } from './engine';

export interface StrategyParam {
  key: string;
  label: string;
  default: number;
  min?: number;
  step?: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  params: StrategyParam[];
  signals(bars: Bar[], p: Record<string, number>, allowShort: boolean): Signals;
}

const cross = (a: number[], b: number[], i: number) => i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i];

function fromConditions(n: number, buy: (i: number) => boolean, sell: (i: number) => boolean, allowShort: boolean): Signals {
  const enterLong = new Array<boolean>(n).fill(false);
  const exitLong = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    enterLong[i] = buy(i);
    exitLong[i] = sell(i);
  }
  return allowShort ? { enterLong, exitLong, enterShort: exitLong.slice(), exitShort: enterLong.slice() } : { enterLong, exitLong };
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'ma-cross',
    name: 'Moving-average crossover',
    description: 'Buy when the fast average crosses above the slow one; sell when it crosses back below. A classic trend-follower.',
    params: [
      { key: 'fast', label: 'Fast average (bars)', default: 50, min: 2 },
      { key: 'slow', label: 'Slow average (bars)', default: 200, min: 3 },
      { key: 'useEma', label: 'Use EMA (1) or SMA (0)', default: 0, min: 0, step: 1 },
    ],
    signals(bars, p, allowShort) {
      const c = bars.map((b) => b.close);
      const f = p.useEma ? ema(c, p.fast) : sma(c, p.fast);
      const s = p.useEma ? ema(c, p.slow) : sma(c, p.slow);
      return fromConditions(bars.length, (i) => cross(f, s, i), (i) => cross(s, f, i), allowShort);
    },
  },
  {
    id: 'rsi-reversion',
    name: 'RSI mean reversion',
    description: 'Buy when RSI drops below the oversold level; sell when it rises above the exit level. Works best in range-bound markets.',
    params: [
      { key: 'length', label: 'RSI length', default: 14, min: 2 },
      { key: 'buyBelow', label: 'Buy below', default: 30, min: 1 },
      { key: 'sellAbove', label: 'Sell above', default: 55, min: 1 },
    ],
    signals(bars, p, allowShort) {
      const r = rsi(bars.map((b) => b.close), p.length);
      return fromConditions(bars.length, (i) => r[i] < p.buyBelow && !(r[i - 1] < p.buyBelow), (i) => r[i] > p.sellAbove && !(r[i - 1] > p.sellAbove), allowShort);
    },
  },
  {
    id: 'breakout',
    name: 'Channel breakout (Donchian)',
    description: 'Buy when price closes above the highest high of the last N bars; sell below the lowest low of the last M bars. The "Turtle" approach.',
    params: [
      { key: 'entry', label: 'Entry channel (bars)', default: 55, min: 2 },
      { key: 'exit', label: 'Exit channel (bars)', default: 20, min: 2 },
    ],
    signals(bars, p, allowShort) {
      const hi = highest(bars.map((b) => b.high), p.entry);
      const lo = lowest(bars.map((b) => b.low), p.exit);
      return fromConditions(bars.length, (i) => i > 0 && bars[i].close > hi[i - 1], (i) => i > 0 && bars[i].close < lo[i - 1], allowShort);
    },
  },
  {
    id: 'bollinger',
    name: 'Bollinger band reversion',
    description: 'Buy when price closes below the lower band; sell when it gets back to the middle band.',
    params: [
      { key: 'length', label: 'Length', default: 20, min: 2 },
      { key: 'mult', label: 'Band width (std devs)', default: 2, min: 0.5, step: 0.1 },
    ],
    signals(bars, p, allowShort) {
      const c = bars.map((b) => b.close);
      const mid = sma(c, p.length);
      const sd = stdev(c, p.length);
      return fromConditions(bars.length, (i) => c[i] < mid[i] - p.mult * sd[i], (i) => c[i] > mid[i], allowShort);
    },
  },
  {
    id: 'trend-filter',
    name: 'Trend filter (price vs average)',
    description: 'Hold while price is above its long moving average, stay in cash below it. A simple way to sidestep big bear markets.',
    params: [{ key: 'length', label: 'Average (bars)', default: 200, min: 2 }],
    signals(bars, p, allowShort) {
      const c = bars.map((b) => b.close);
      const m = sma(c, p.length);
      return fromConditions(bars.length, (i) => cross(c, m, i) || (i === p.length && c[i] > m[i]), (i) => cross(m, c, i), allowShort);
    },
  },
];
