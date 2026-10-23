/**
 * Strategy research for the backtester: rules built from the indicators on your chart, and the checks a
 * professional would run before trusting a backtest: Monte Carlo resampling of the trades, a random-walk
 * test (does the strategy also "work" on random prices?), a parameter sweep, monthly returns and deeper stats.
 */
import type { ExternalPoint, IndicatorDef, IndicatorInstance } from '../indicators/types';
import type { Bar } from '../types';
import { backtest, type BacktestOptions, type BacktestResult, type Signals, type Trade } from './engine';

// ---------- Rules from chart indicators ----------

export type Operand = { kind: 'price'; field: 'close' | 'open' | 'high' | 'low' } | { kind: 'ind'; uid: string; plot: string } | { kind: 'value'; value: number };
export type Operator = 'crossAbove' | 'crossBelow' | 'above' | 'below';
export interface Rule {
  left: Operand;
  op: Operator;
  right: Operand;
}
export interface RuleSet {
  entry: Rule[];
  entryMode: 'all' | 'any';
  exit: Rule[];
  exitMode: 'all' | 'any';
}

export const OPERATORS: [Operator, string][] = [
  ['crossAbove', 'crosses above'],
  ['crossBelow', 'crosses below'],
  ['above', 'is above'],
  ['below', 'is below'],
];

/** An indicator on the chart, ready to compute: its definition, settings and any outside data it needs. */
export interface ChartIndicator {
  instance: IndicatorInstance;
  def: IndicatorDef;
  external?: ExternalPoint[];
}

export type Series = Map<string, number[]>; // `${uid}:${plot}` -> values aligned with bars

export function computeSeries(bars: Bar[], indicators: ChartIndicator[], overrides: Record<string, number> = {}): Series {
  const out: Series = new Map();
  for (const ci of indicators) {
    const params = { ...ci.instance.params };
    for (const [k, v] of Object.entries(overrides)) {
      const [uid, key] = k.split('.');
      if (uid === ci.instance.uid) params[key] = v;
    }
    let values: Record<string, number[]> = {};
    try {
      values = ci.def.compute(bars, params, ci.external);
    } catch {
      values = {};
    }
    for (const [plot, arr] of Object.entries(values)) out.set(`${ci.instance.uid}:${plot}`, arr);
  }
  return out;
}

function operandValues(bars: Bar[], series: Series, o: Operand): number[] {
  if (o.kind === 'price') return bars.map((b) => b[o.field]);
  if (o.kind === 'value') return new Array<number>(bars.length).fill(o.value);
  return series.get(`${o.uid}:${o.plot}`) ?? new Array<number>(bars.length).fill(NaN);
}

function ruleHits(bars: Bar[], series: Series, r: Rule): boolean[] {
  const a = operandValues(bars, series, r.left);
  const b = operandValues(bars, series, r.right);
  return a.map((x, i) => {
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (r.op === 'above') return x > y;
    if (r.op === 'below') return x < y;
    if (i === 0 || !Number.isFinite(a[i - 1]) || !Number.isFinite(b[i - 1])) return false;
    return r.op === 'crossAbove' ? a[i - 1] <= b[i - 1] && x > y : a[i - 1] >= b[i - 1] && x < y;
  });
}

function combine(bars: Bar[], series: Series, rules: Rule[], mode: 'all' | 'any'): boolean[] {
  if (!rules.length) return new Array<boolean>(bars.length).fill(false);
  const hits = rules.map((r) => ruleHits(bars, series, r));
  return bars.map((_, i) => (mode === 'all' ? hits.every((h) => h[i]) : hits.some((h) => h[i])));
}

export function ruleSignals(bars: Bar[], series: Series, rules: RuleSet, allowShort: boolean): Signals {
  const enterLong = combine(bars, series, rules.entry, rules.entryMode);
  const exitLong = combine(bars, series, rules.exit, rules.exitMode);
  return allowShort ? { enterLong, exitLong, enterShort: exitLong.slice(), exitShort: enterLong.slice() } : { enterLong, exitLong };
}

const isMovingAverage = (d: IndicatorDef) => d.placement === 'overlay' && d.plots.filter((p) => p.type === 'line').length === 1;
const hasBands = (d: IndicatorDef) => d.placement === 'overlay' && d.plots.some((p) => /upper/i.test(p.key)) && d.plots.some((p) => /lower/i.test(p.key));
const linePlots = (d: IndicatorDef) => d.plots.filter((p) => p.type === 'line');

/** Turns the chart's indicators into a sensible starting strategy (you can edit every rule). */
export function suggestRules(indicators: ChartIndicator[]): RuleSet {
  const usable = indicators.filter((c) => c.instance.visible !== false && c.def.placement !== 'volume' && linePlots(c.def).length);
  const close: Operand = { kind: 'price', field: 'close' };
  const pairs: { entry: Rule; exit: Rule; filter: Rule }[] = [];
  const mas = usable.filter((c) => isMovingAverage(c.def));
  if (mas.length >= 2) {
    const len = (c: ChartIndicator) => Number(c.instance.params.length ?? c.instance.params.period ?? 0);
    const [fast, slow] = [...mas].sort((x, y) => len(x) - len(y));
    const f: Operand = { kind: 'ind', uid: fast.instance.uid, plot: linePlots(fast.def)[0].key };
    const s: Operand = { kind: 'ind', uid: slow.instance.uid, plot: linePlots(slow.def)[0].key };
    pairs.push({ entry: { left: f, op: 'crossAbove', right: s }, exit: { left: f, op: 'crossBelow', right: s }, filter: { left: f, op: 'above', right: s } });
  }
  for (const c of usable) {
    if (mas.length >= 2 && mas.includes(c)) continue;
    const plots = linePlots(c.def);
    const ref = (key: string): Operand => ({ kind: 'ind', uid: c.instance.uid, plot: key });
    if (hasBands(c.def)) {
      const lower = plots.find((p) => /lower/i.test(p.key))!;
      const mid = plots.find((p) => /basis|mid|middle|ma/i.test(p.key)) ?? plots.find((p) => /upper/i.test(p.key))!;
      pairs.push({ entry: { left: close, op: 'crossBelow', right: ref(lower.key) }, exit: { left: close, op: 'crossAbove', right: ref(mid.key) }, filter: { left: close, op: 'above', right: ref(lower.key) } });
    } else if (isMovingAverage(c.def)) {
      const m = ref(plots[0].key);
      pairs.push({ entry: { left: close, op: 'crossAbove', right: m }, exit: { left: close, op: 'crossBelow', right: m }, filter: { left: close, op: 'above', right: m } });
    } else if (c.def.levels && c.def.levels.length >= 2) {
      const lv = [...c.def.levels].sort((x, y) => x - y);
      const lo = lv[0];
      const hi = lv[lv.length - 1];
      const main = ref(plots[0].key);
      // Positioning indexes (COT) are bullish when high; oscillators like RSI are bought when low.
      if (c.def.category === 'Positioning') pairs.push({ entry: { left: main, op: 'crossAbove', right: { kind: 'value', value: hi } }, exit: { left: main, op: 'crossBelow', right: { kind: 'value', value: lo } }, filter: { left: main, op: 'above', right: { kind: 'value', value: (lo + hi) / 2 } } });
      else pairs.push({ entry: { left: main, op: 'crossAbove', right: { kind: 'value', value: lo } }, exit: { left: main, op: 'crossBelow', right: { kind: 'value', value: hi } }, filter: { left: main, op: 'below', right: { kind: 'value', value: hi } } });
    } else if (plots.length >= 2) {
      pairs.push({ entry: { left: ref(plots[0].key), op: 'crossAbove', right: ref(plots[1].key) }, exit: { left: ref(plots[0].key), op: 'crossBelow', right: ref(plots[1].key) }, filter: { left: ref(plots[0].key), op: 'above', right: ref(plots[1].key) } });
    } else {
      const main = ref(plots[0].key);
      pairs.push({ entry: { left: main, op: 'crossAbove', right: { kind: 'value', value: 0 } }, exit: { left: main, op: 'crossBelow', right: { kind: 'value', value: 0 } }, filter: { left: main, op: 'above', right: { kind: 'value', value: 0 } } });
    }
  }
  if (!pairs.length) return { entry: [], entryMode: 'all', exit: [], exitMode: 'any' };
  // The first indicator triggers trades; the others act as filters that must agree.
  return { entry: [pairs[0].entry, ...pairs.slice(1, 3).map((p) => p.filter)], entryMode: 'all', exit: [pairs[0].exit], exitMode: 'any' };
}

// ---------- Deeper statistics ----------

export interface DeepStats {
  sortino: number | null;
  calmar: number | null;
  expectancy: number | null;
  kelly: number | null;
  avgBars: number | null;
  maxConsecutiveLosses: number;
  longestDrawdownDays: number;
  recoveryFactor: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
}

export function deepStats(r: BacktestResult, capital: number): DeepStats {
  const eq = r.equity;
  const rets = eq.slice(1).map((e, i) => e.value / eq[i].value - 1);
  const years = eq.length > 1 ? (eq[eq.length - 1].time - eq[0].time) / (365.25 * 86400) : 0;
  const perYear = years > 0 ? rets.length / years : 252;
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const down = Math.sqrt(rets.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / (rets.length || 1));
  let peak = -Infinity;
  let peakTime = eq[0]?.time ?? 0;
  let longest = 0;
  for (const e of eq) {
    if (e.value >= peak) {
      peak = e.value;
      peakTime = e.time;
    } else longest = Math.max(longest, (e.time - peakTime) / 86400);
  }
  const t = r.trades;
  const wins = t.filter((x) => x.pnl > 0);
  const losses = t.filter((x) => x.pnl <= 0);
  const winRate = t.length ? wins.length / t.length : 0;
  const avgWin = wins.length ? wins.reduce((a, x) => a + x.returnPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? -losses.reduce((a, x) => a + x.returnPct, 0) / losses.length : 0;
  let streak = 0;
  let maxStreak = 0;
  for (const x of t) {
    streak = x.pnl <= 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }
  const net = (eq[eq.length - 1]?.value ?? capital) - capital;
  const maxDdDollars = (() => {
    let pk = -Infinity;
    let worst = 0;
    for (const e of eq) {
      pk = Math.max(pk, e.value);
      worst = Math.max(worst, pk - e.value);
    }
    return worst;
  })();
  return {
    sortino: down > 0 ? (mean / down) * Math.sqrt(perYear) : null,
    calmar: r.stats.cagr != null && r.stats.maxDrawdown < 0 ? r.stats.cagr / -r.stats.maxDrawdown : null,
    expectancy: t.length ? winRate * avgWin - (1 - winRate) * avgLoss : null,
    kelly: t.length && avgLoss > 0 && avgWin > 0 ? winRate - (1 - winRate) / (avgWin / avgLoss) : null,
    avgBars: t.length ? t.reduce((a, x) => a + x.bars, 0) / t.length : null,
    maxConsecutiveLosses: maxStreak,
    longestDrawdownDays: Math.round(longest),
    recoveryFactor: maxDdDollars > 0 ? net / maxDdDollars : null,
    bestTrade: t.length ? Math.max(...t.map((x) => x.returnPct)) : null,
    worstTrade: t.length ? Math.min(...t.map((x) => x.returnPct)) : null,
  };
}

/** Month-by-month returns of the equity curve: { 2024: { 0: 0.012, 1: -0.004, ... , 12: yearly } }. */
export function monthlyReturns(equity: { time: number; value: number }[]): Map<number, (number | null)[]> {
  const ends = new Map<string, number>();
  let first: number | null = null;
  for (const e of equity) {
    const d = new Date(e.time * 1000);
    ends.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, e.value);
    first ??= e.value;
  }
  const out = new Map<number, (number | null)[]>();
  let prev = first ?? 0;
  let yearStart = prev;
  let lastYear: number | null = null;
  for (const [key, value] of ends) {
    const [y, m] = key.split('-').map(Number);
    if (lastYear !== null && y !== lastYear) yearStart = prev;
    if (!out.has(y)) out.set(y, new Array<number | null>(13).fill(null));
    const row = out.get(y)!;
    row[m] = prev ? value / prev - 1 : null;
    row[12] = yearStart ? value / yearStart - 1 : null;
    prev = value;
    lastYear = y;
  }
  return out;
}

// ---------- Random numbers (seeded, so results repeat) ----------

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (i - lo);
};

// ---------- Monte Carlo ----------

export interface MonteCarloResult {
  runs: number;
  finalReturn: Record<'p5' | 'p25' | 'p50' | 'p75' | 'p95', number>;
  maxDrawdown: Record<'p5' | 'p50' | 'p95', number>;
  lossChance: number;
  /** Chance of a drawdown worse than the backtest's own. */
  worseDrawdownChance: number;
  /** Equity bands by trade number (percentiles of account value). */
  bands: { trade: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  histogram: { from: number; to: number; count: number }[];
}

/**
 * Reshuffles the strategy's trades thousands of times (sampling with replacement) to show the range of outcomes
 * the same edge could have produced: luck in the order and mix of trades.
 */
export function monteCarlo(trades: Trade[], capital: number, positionSize: number, actualMaxDd: number, runs = 2000, seed = 7, commission = 0): MonteCarloResult | null {
  if (trades.length < 5) return null;
  const rand = rng(seed);
  const n = trades.length;
  const finals: number[] = [];
  const dds: number[] = [];
  const paths: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let r = 0; r < runs; r++) {
    let value = capital;
    let peak = capital;
    let dd = 0;
    paths[0].push(value);
    for (let k = 0; k < n; k++) {
      const t = trades[Math.floor(rand() * n)];
      // Trade returns already include slippage; take the commission on the way in and out as the backtest does.
      value *= (1 + t.returnPct * positionSize) * (1 - 2 * commission * positionSize);
      peak = Math.max(peak, value);
      dd = Math.min(dd, value / peak - 1);
      paths[k + 1].push(value);
    }
    finals.push(value / capital - 1);
    dds.push(dd);
  }
  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(n / 60));
  const bands = [];
  for (let k = 0; k <= n; k += step) {
    const s = paths[k].sort((a, b) => a - b);
    bands.push({ trade: k, p5: percentile(s, 0.05), p25: percentile(s, 0.25), p50: percentile(s, 0.5), p75: percentile(s, 0.75), p95: percentile(s, 0.95) });
  }
  const histogram = binsOf(finals);
  return {
    runs,
    finalReturn: { p5: percentile(finals, 0.05), p25: percentile(finals, 0.25), p50: percentile(finals, 0.5), p75: percentile(finals, 0.75), p95: percentile(finals, 0.95) },
    maxDrawdown: { p5: percentile(dds, 0.95), p50: percentile(dds, 0.5), p95: percentile(dds, 0.05) },
    lossChance: finals.filter((f) => f < 0).length / runs,
    worseDrawdownChance: dds.filter((d) => d < actualMaxDd).length / runs,
    bands,
    histogram,
  };
}

/** Groups values into equal-width bins for a histogram. */
export function binsOf(values: number[], count = 24) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const width = (hi - lo) / count || 1;
  const bins = Array.from({ length: count }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const v of values) bins[Math.min(count - 1, Math.floor((v - lo) / width))].count++;
  return bins;
}

// ---------- Random-walk test ----------

/** Fake price history with the same daily moves as the real one, shuffled into random order (a random walk). */
export function randomWalkBars(bars: Bar[], rand: () => number): Bar[] {
  const n = bars.length;
  const moves = bars.slice(1).map((b, i) => ({
    ret: Math.log(b.close / bars[i].close),
    open: Math.log(b.open / b.close),
    high: Math.log(b.high / b.close),
    low: Math.log(b.low / b.close),
    volume: b.volume,
  }));
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  const out: Bar[] = [{ ...bars[0] }];
  let close = bars[0].close;
  for (let i = 0; i < moves.length && out.length < n; i++) {
    const m = moves[i];
    close *= Math.exp(m.ret);
    const open = close * Math.exp(m.open);
    out.push({ time: bars[i + 1].time, open, high: Math.max(open, close, close * Math.exp(m.high)), low: Math.min(open, close, close * Math.exp(m.low)), close, volume: m.volume });
  }
  return out;
}

export interface RandomWalkResult {
  runs: number;
  actual: number;
  returns: number[];
  /** Share of random runs that did at least as well as the real backtest (lower = more likely a real edge). */
  pValue: number;
  percentileRank: number;
  median: number;
  verdict: 'edge' | 'maybe' | 'luck';
}

/**
 * Runs the same strategy on many random walks built from the stock's own daily moves. If it does just as well on
 * random prices, the backtest result is probably luck or simply the market's drift, not a real edge.
 */
export function randomWalkTest(bars: Bar[], run: (bars: Bar[]) => number, actual: number, runs = 200, seed = 11): RandomWalkResult {
  const rand = rng(seed);
  const returns: number[] = [];
  for (let r = 0; r < runs; r++) returns.push(run(randomWalkBars(bars, rand)));
  returns.sort((a, b) => a - b);
  const better = returns.filter((x) => x >= actual).length;
  const pValue = (better + 1) / (runs + 1);
  return {
    runs,
    actual,
    returns,
    pValue,
    percentileRank: returns.filter((x) => x < actual).length / runs,
    median: percentile(returns, 0.5),
    verdict: pValue < 0.05 ? 'edge' : pValue < 0.2 ? 'maybe' : 'luck',
  };
}

// ---------- Parameter sweep ----------

export interface SweepCell {
  x: number;
  y: number | null;
  totalReturn: number;
  sharpe: number | null;
  maxDrawdown: number;
  trades: number;
}

/** Re-runs the backtest across a grid of settings to show whether results are robust or one lucky setting. */
export function sweep(bars: Bar[], signalsFor: (params: Record<string, number>) => Signals, opts: BacktestOptions, xKey: string, xs: number[], yKey?: string, ys: number[] = []): SweepCell[] {
  const cells: SweepCell[] = [];
  for (const x of xs)
    for (const y of yKey ? ys : [null]) {
      const params: Record<string, number> = { [xKey]: x };
      if (yKey && y != null) params[yKey] = y;
      const r = backtest(bars, signalsFor(params), opts);
      cells.push({ x, y, totalReturn: r.stats.totalReturn, sharpe: r.stats.sharpe, maxDrawdown: r.stats.maxDrawdown, trades: r.stats.trades });
    }
  return cells;
}

/** Evenly spaced values around a setting, e.g. 14 → [7, 9, 11, 14, 17, 20, 23]. */
export function rangeAround(value: number, count = 7, integer = true): number[] {
  const lo = Math.max(integer ? 2 : value * 0.3, value * 0.5);
  const hi = value * 1.6;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = lo + ((hi - lo) * i) / (count - 1);
    out.push(integer ? Math.round(v) : +v.toFixed(2));
  }
  // Always include the current setting so the sweep shows where you are now.
  return [...new Set([...out, integer ? Math.round(value) : value])].sort((a, b) => a - b);
}
