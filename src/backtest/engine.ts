/** A simple, honest backtester: signals on a bar's close are filled at the next bar's open, with costs. */
import type { Bar } from '../types';

export interface Signals {
  /** true on bars where the strategy wants to be long (buy) / flat (sell). */
  enterLong: boolean[];
  exitLong: boolean[];
  enterShort?: boolean[];
  exitShort?: boolean[];
}

export interface BacktestOptions {
  capital: number;
  /** Share of equity put into each trade (1 = all in). */
  positionSize: number;
  /** Commission per side as a fraction of trade value (0.0005 = 0.05%). */
  commission: number;
  /** Slippage per side as a fraction of price. */
  slippage: number;
  /** Optional stop-loss / take-profit as fractions of the entry price (0.05 = 5%). */
  stopLoss?: number;
  takeProfit?: number;
}

export interface Trade {
  side: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
  bars: number;
  reason: 'signal' | 'stop' | 'target' | 'end';
}

export interface BacktestResult {
  trades: Trade[];
  equity: { time: number; value: number }[];
  buyHold: { time: number; value: number }[];
  stats: {
    totalReturn: number;
    buyHoldReturn: number;
    cagr: number | null;
    maxDrawdown: number;
    sharpe: number | null;
    trades: number;
    winRate: number | null;
    profitFactor: number | null;
    avgTrade: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    exposure: number;
    costs: number;
  };
}

export function backtest(bars: Bar[], signals: Signals, o: BacktestOptions): BacktestResult {
  let cash = o.capital;
  type Position = { side: 'long' | 'short'; shares: number; entryPrice: number; entryIndex: number };
  // Closures below change `pos`, so stop TypeScript narrowing it to null here.
  let pos = null as Position | null;
  const trades: Trade[] = [];
  const equity: BacktestResult['equity'] = [];
  let costs = 0;
  let barsInMarket = 0;
  let pending: 'long' | 'short' | 'flat' | null = null;

  const fill = (price: number, buying: boolean) => price * (1 + (buying ? o.slippage : -o.slippage));

  function close(i: number, rawPrice: number, reason: Trade['reason']) {
    if (!pos) return;
    const price = fill(rawPrice, pos.side === 'short');
    const value = pos.shares * price;
    const fee = value * o.commission;
    costs += fee;
    const pnl = pos.side === 'long' ? (price - pos.entryPrice) * pos.shares - fee : (pos.entryPrice - price) * pos.shares - fee;
    cash += pos.side === 'long' ? value - fee : -value - fee;
    trades.push({
      side: pos.side,
      entryTime: bars[pos.entryIndex].time,
      entryPrice: pos.entryPrice,
      exitTime: bars[i].time,
      exitPrice: price,
      shares: pos.shares,
      pnl,
      returnPct: pos.side === 'long' ? price / pos.entryPrice - 1 : pos.entryPrice / price - 1,
      bars: i - pos.entryIndex,
      reason,
    });
    pos = null;
  }

  function open(i: number, side: 'long' | 'short') {
    const price = fill(bars[i].open, side === 'long');
    const budget = Math.max(0, cash) * o.positionSize;
    const shares = budget / (price * (1 + o.commission));
    if (shares <= 0) return;
    const fee = shares * price * o.commission;
    costs += fee;
    cash += side === 'long' ? -(shares * price) - fee : shares * price - fee;
    pos = { side, shares, entryPrice: price, entryIndex: i };
  }

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // 1. Act on yesterday's signal at today's open.
    if (pending) {
      if (pos && (pending === 'flat' || pending !== pos.side)) close(i, b.open, 'signal');
      if (!pos && pending !== 'flat') open(i, pending);
      pending = null;
    }
    // 2. Stops and targets during the bar (a stop is assumed to hit first if both could have).
    if (pos) {
      const p: { side: 'long' | 'short'; entryPrice: number } = pos;
      const long = p.side === 'long';
      const stop = o.stopLoss ? p.entryPrice * (long ? 1 - o.stopLoss : 1 + o.stopLoss) : null;
      const target = o.takeProfit ? p.entryPrice * (long ? 1 + o.takeProfit : 1 - o.takeProfit) : null;
      if (stop != null && (long ? b.low <= stop : b.high >= stop)) close(i, long ? Math.min(stop, b.open) : Math.max(stop, b.open), 'stop');
      else if (target != null && (long ? b.high >= target : b.low <= target)) close(i, long ? Math.max(target, b.open) : Math.min(target, b.open), 'target');
    }
    if (pos) barsInMarket++;
    // 3. Read this bar's signals (filled tomorrow).
    const side = pos?.side;
    if (side === 'long' && signals.exitLong[i]) pending = 'flat';
    if (side === 'short' && signals.exitShort?.[i]) pending = 'flat';
    if (signals.enterLong[i] && side !== 'long') pending = 'long';
    else if (signals.enterShort?.[i] && side !== 'short') pending = 'short';
    const mark = pos ? (pos.side === 'long' ? pos.shares * b.close : -pos.shares * b.close) : 0;
    equity.push({ time: b.time, value: cash + mark });
  }
  if (pos && bars.length) {
    close(bars.length - 1, bars[bars.length - 1].close, 'end');
    equity[equity.length - 1].value = cash;
  }

  const first = bars[0]?.open ?? 1;
  const buyHold = bars.map((b) => ({ time: b.time, value: (o.capital * b.close) / first }));
  const finalValue = equity.length ? equity[equity.length - 1].value : o.capital;
  let peak = -Infinity;
  let maxDd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.value);
    maxDd = Math.min(maxDd, e.value / peak - 1);
  }
  const years = bars.length > 1 ? (bars[bars.length - 1].time - bars[0].time) / (365.25 * 86400) : 0;
  const rets = equity.slice(1).map((e, i) => e.value / equity[i].value - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const periodsPerYear = years > 0 ? rets.length / years : 252;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const avg = (xs: Trade[]) => (xs.length ? xs.reduce((a, t) => a + t.returnPct, 0) / xs.length : null);
  return {
    trades,
    equity,
    buyHold,
    stats: {
      totalReturn: finalValue / o.capital - 1,
      buyHoldReturn: bars.length ? bars[bars.length - 1].close / first - 1 : 0,
      cagr: years >= 0.5 && finalValue > 0 ? (finalValue / o.capital) ** (1 / years) - 1 : null,
      maxDrawdown: maxDd,
      sharpe: sd > 0 ? (mean / sd) * Math.sqrt(periodsPerYear) : null,
      trades: trades.length,
      winRate: trades.length ? wins.length / trades.length : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : null,
      avgTrade: avg(trades),
      avgWin: avg(wins),
      avgLoss: avg(losses),
      exposure: bars.length ? barsInMarket / bars.length : 0,
      costs,
    },
  };
}
