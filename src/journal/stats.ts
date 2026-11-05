/**
 * Trading journal maths: P&L after fees (first in, first out), R-multiples, the standard journal statistics (win rate,
 * profit factor, expectancy, payoff, streaks, drawdown, Sharpe/Sortino on daily P&L), breakdowns, the P&L calendar,
 * MAE/MFE from price bars, plan adherence and tax-lot style realized gains. Pure and tested (stats.test.ts).
 *
 * Statistical honesty: only closed trades with a known cost count (trades opened before the journal's history are left
 * out until they close with a known cost), and every figure carries its sample size; under MIN_TRADES the page says
 * "not enough trades yet" (docs/research/setups-statistics.md explains why).
 */
import type { Bar } from '../types';

export interface Portion {
  time: number;
  price: number;
  qty: number;
  fees: number;
  fillId?: string;
  orderId?: string;
  preJournal?: boolean;
}

export interface TradePlan {
  stop?: number | null;
  target?: number | null;
  riskPct?: number | null;
  setup?: string;
  setupId?: string;
  exitBy?: string;
  thesis?: string;
}

export interface Trade {
  id: string;
  symbol: string;
  account: string;
  env?: string | null;
  side: 'long' | 'short';
  assetClass: 'stock' | 'futures' | 'option';
  multiplier: number;
  entries: Portion[];
  exits: Portion[];
  status: 'open' | 'closed';
  openedAt: number;
  closedAt?: number | null;
  openQty?: number;
  openedBefore?: boolean;
  costUnknown?: boolean;
  source: string;
  viaPlatform?: boolean;
  strategy?: string;
  playbookId?: string;
  rulesFollowed?: boolean[];
  plan?: TradePlan;
  tags?: string[];
  emotionsBefore?: string[];
  emotionsAfter?: string[];
  mistakes?: string[];
  rating?: number | null;
  notes?: string;
  screenshots?: string[];
  /** Worst and best open P&L in $ while the trade was on (negative MAE), and the prices they happened at. */
  mae?: number | null;
  mfe?: number | null;
  maePrice?: number | null;
  mfePrice?: number | null;
  /** ATR(14) of daily bars at entry: the risk unit for an estimated R when the trade had no planned stop. */
  atr?: number | null;
  excursionSource?: string;
  review?: string;
}

/** Below this many closed trades the page says the numbers are not yet evidence. */
export const MIN_TRADES = 30;
export const NY = 'America/New_York';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const qtyOf = (ps: Portion[]) => sum(ps.map((p) => p.qty));
export const avgPrice = (ps: Portion[]) => {
  const q = qtyOf(ps);
  return q ? sum(ps.map((p) => p.qty * p.price)) / q : null;
};
export const feesOf = (t: Trade) => sum(t.entries.map((p) => p.fees)) + sum(t.exits.map((p) => p.fees));

/** Realized P&L before and after fees, first in first out. null when the cost is unknown. */
export function tradePnl(t: Trade): { gross: number; fees: number; net: number } | null {
  if (t.costUnknown) return null;
  const lots = t.entries.map((e) => ({ qty: e.qty, price: e.price }));
  const sign = t.side === 'long' ? 1 : -1;
  let gross = 0;
  for (const x of t.exits) {
    let q = x.qty;
    while (q > 1e-12 && lots.length) {
      const take = Math.min(q, lots[0].qty);
      gross += sign * (x.price - lots[0].price) * take;
      lots[0].qty -= take;
      q -= take;
      if (lots[0].qty <= 1e-12) lots.shift();
    }
  }
  gross *= t.multiplier;
  const fees = feesOf(t);
  return { gross, fees, net: gross - fees };
}

/** Counts in the statistics: closed, with a known cost, not opened before the journal's history. */
export const counted = (t: Trade) => t.status === 'closed' && !t.costUnknown && !t.openedBefore;

/** $ at risk from the planned stop (entry to stop x size), or null. */
export function plannedRisk(t: Trade): number | null {
  const stop = t.plan?.stop;
  const entry = avgPrice(t.entries);
  if (stop == null || entry == null) return null;
  const risk = Math.abs(entry - stop) * qtyOf(t.entries) * t.multiplier;
  return risk > 0 ? risk : null;
}

/** R = net P&L / planned risk. Without a stop, one daily ATR at entry stands in and the R is marked estimated. */
export function rOf(t: Trade): { r: number; estimated: boolean } | null {
  const pnl = tradePnl(t);
  if (!pnl) return null;
  const risk = plannedRisk(t);
  if (risk) return { r: pnl.net / risk, estimated: false };
  if (t.atr && t.atr > 0) return { r: pnl.net / (t.atr * qtyOf(t.entries) * t.multiplier), estimated: true };
  return null;
}

export const holdSeconds = (t: Trade) => (t.closedAt ?? t.openedAt) - t.openedAt;

/** New York calendar day 'YYYY-MM-DD', hour (0-23) and weekday (0 = Sunday) of a unix time. */
export function nyParts(time: number): { day: string; hour: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date(time * 1000))
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}
/** The day a trade counts on: the day it closed (open trades: the day they opened). */
export const tradeDay = (t: Trade) => nyParts(t.closedAt ?? t.openedAt).day;

export interface Stats {
  n: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  net: number;
  gross: number;
  fees: number;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  expectancyR: number | null;
  /** Trades with an R (planned or estimated). */
  nR: number;
  largestWin: number | null;
  largestLoss: number | null;
  maxConsecWins: number;
  maxConsecLosses: number;
  /** +3 = three wins in a row now, -2 = two losses. */
  currentStreak: number;
  maxDrawdown: number;
  /** On daily net P&L over every weekday from the first to the last closing day (no-trade days count as $0),
   * scaled by the square root of 252. */
  sharpe: number | null;
  sortino: number | null;
  /** Weekdays in that series. */
  sharpeDays: number;
  avgHoldWin: number | null;
  avgHoldLoss: number | null;
  open: number;
  excluded: number;
  enough: boolean;
}

const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

/** The standard journal statistics over a list of trades (only counted trades enter the figures). */
export function computeStats(all: Trade[]): Stats {
  const done = all.filter(counted).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  const nets = done.map((t) => tradePnl(t)!.net);
  const winsList = nets.filter((x) => x > 0);
  const lossList = nets.filter((x) => x < 0);
  let run = 0;
  let maxW = 0;
  let maxL = 0;
  for (const x of nets) {
    run = x > 0 ? (run > 0 ? run + 1 : 1) : x < 0 ? (run < 0 ? run - 1 : -1) : 0;
    maxW = Math.max(maxW, run);
    maxL = Math.max(maxL, -run);
  }
  const rs = done.map(rOf).filter((r): r is { r: number; estimated: boolean } => r != null).map((r) => r.r);
  const daily = dailySeries(done).map((d) => d.net);
  const dm = mean(daily);
  const sd = daily.length > 1 ? Math.sqrt(sum(daily.map((x) => (x - dm!) ** 2)) / (daily.length - 1)) : null;
  const down = daily.length > 1 ? Math.sqrt(sum(daily.map((x) => Math.min(0, x) ** 2)) / daily.length) : null;
  const holds = (pred: (x: number) => boolean) => mean(done.filter((_, i) => pred(nets[i])).map(holdSeconds));
  const pnl = done.map((t) => tradePnl(t)!);
  return {
    n: done.length,
    wins: winsList.length,
    losses: lossList.length,
    breakeven: nets.filter((x) => x === 0).length,
    winRate: done.length ? winsList.length / done.length : null,
    net: sum(nets),
    gross: sum(pnl.map((p) => p.gross)),
    fees: sum(pnl.map((p) => p.fees)),
    avgWin: mean(winsList),
    avgLoss: mean(lossList),
    payoff: winsList.length && lossList.length ? mean(winsList)! / -mean(lossList)! : null,
    profitFactor: lossList.length ? sum(winsList) / -sum(lossList) : null,
    expectancy: mean(nets),
    expectancyR: mean(rs),
    nR: rs.length,
    largestWin: winsList.length ? Math.max(...winsList) : null,
    largestLoss: lossList.length ? Math.min(...lossList) : null,
    maxConsecWins: maxW,
    maxConsecLosses: maxL,
    currentStreak: run,
    maxDrawdown: Math.min(0, ...equityCurve(done).map((p) => p.drawdown)),
    sharpe: dm != null && sd ? (dm / sd) * Math.sqrt(252) : null,
    sortino: dm != null && down ? (dm / down) * Math.sqrt(252) : null,
    sharpeDays: daily.length,
    avgHoldWin: holds((x) => x > 0),
    avgHoldLoss: holds((x) => x < 0),
    open: all.filter((t) => t.status === 'open').length,
    excluded: all.filter((t) => t.status === 'closed' && !counted(t)).length,
    enough: done.length >= MIN_TRADES,
  };
}

/** Cumulative net P&L by close time, with the drawdown from the running peak (0 or negative). */
export function equityCurve(trades: Trade[]): { time: number; equity: number; drawdown: number; id: string }[] {
  let eq = 0;
  let peak = 0;
  return trades
    .filter(counted)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
    .map((t) => {
      eq += tradePnl(t)!.net;
      peak = Math.max(peak, eq);
      return { time: t.closedAt!, equity: eq, drawdown: eq - peak, id: t.id };
    });
}

export interface DayCell {
  net: number;
  trades: number;
  wins: number;
  ids: string[];
}

/** Net P&L per New York day (closed, counted trades on their closing day). */
export function dailyPnl(trades: Trade[]): Map<string, DayCell> {
  const out = new Map<string, DayCell>();
  for (const t of trades.filter(counted)) {
    const day = tradeDay(t);
    const net = tradePnl(t)!.net;
    const c = out.get(day) ?? { net: 0, trades: 0, wins: 0, ids: [] };
    c.net += net;
    c.trades += 1;
    c.wins += net > 0 ? 1 : 0;
    c.ids.push(t.id);
    out.set(day, c);
  }
  return out;
}

/** Net P&L for every weekday (Mon-Fri, plus weekend days with a closed trade) from the first to the last day with a
 * closed trade; days without one are $0
 * (market holidays are counted as $0 days too: a small, conservative effect). */
export function dailySeries(trades: Trade[]): { day: string; net: number }[] {
  const daily = dailyPnl(trades);
  const days = [...daily.keys()].sort();
  if (!days.length) return [];
  const out: { day: string; net: number }[] = [];
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  for (let t = Date.parse(`${days[0]}T00:00:00Z`); t <= end; t += 86400000) {
    const d = new Date(t);
    const day = d.toISOString().slice(0, 10);
    // weekends only when something closed then (futures trade Sunday evening)
    if ((d.getUTCDay() === 0 || d.getUTCDay() === 6) && !daily.has(day)) continue;
    out.push({ day, net: daily.get(day)?.net ?? 0 });
  }
  return out;
}

/** A month as weeks of 7 cells (Sunday first): null outside the month, else {day, cell}; plus the month's total. */
export function calendarMonth(year: number, month: number, daily: Map<string, DayCell>) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: ({ day: string; date: number; cell: DayCell | null } | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) {
    const day = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day, date: d, cell: daily.get(day) ?? null });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    weeks.push({ cells: week, net: sum(week.map((c) => c?.cell?.net ?? 0)), trades: sum(week.map((c) => c?.cell?.trades ?? 0)) });
  }
  const inMonth = cells.filter((c) => c?.cell).map((c) => c!.cell!);
  return { weeks, net: sum(inMonth.map((c) => c.net)), trades: sum(inMonth.map((c) => c.trades)), greenDays: inMonth.filter((c) => c.net > 0).length, redDays: inMonth.filter((c) => c.net < 0).length };
}

export interface BreakdownRow {
  key: string;
  n: number;
  net: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
}

/** Statistics per group; a trade can sit in several groups (tags, emotions). Sorted by net P&L, best first. */
export function breakdown(trades: Trade[], keys: (t: Trade) => string[]): BreakdownRow[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades.filter(counted)) for (const k of keys(t)) groups.set(k, [...(groups.get(k) ?? []), t]);
  return [...groups.entries()]
    .map(([key, list]) => {
      const s = computeStats(list);
      return { key, n: s.n, net: s.net, winRate: s.winRate, profitFactor: s.profitFactor, expectancy: s.expectancy, avgR: s.expectancyR };
    })
    .sort((a, b) => b.net - a.net);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const holdBucket = (s: number) => (s < 3600 ? 'Under 1 hour' : s < 86400 ? 'Same day' : s < 7 * 86400 ? '1-7 days' : s < 30 * 86400 ? '1-4 weeks' : 'Over a month');
const hourLabel = (hr: number) => `${String(hr).padStart(2, '0')}:00`;

/** The breakdowns on the dashboard, by name. */
export const BREAKDOWNS: Record<string, { label: string; keys: (t: Trade, all?: Trade[]) => string[] }> = {
  symbol: { label: 'Symbol', keys: (t) => [t.symbol] },
  strategy: { label: 'Strategy', keys: (t) => [t.strategy || 'No strategy'] },
  tag: { label: 'Tag', keys: (t) => (t.tags?.length ? t.tags : ['No tags']) },
  emotion: { label: 'Emotion (before)', keys: (t) => (t.emotionsBefore?.length ? t.emotionsBefore : ['Not noted']) },
  hour: { label: 'Time of day (entry, New York)', keys: (t) => [hourLabel(nyParts(t.openedAt).hour)] },
  weekday: { label: 'Day of week (entry)', keys: (t) => [WEEKDAYS[nyParts(t.openedAt).weekday]] },
  side: { label: 'Long vs short', keys: (t) => [t.side === 'long' ? 'Long' : 'Short'] },
  hold: { label: 'Hold time', keys: (t) => [holdBucket(holdSeconds(t))] },
  account: { label: 'Account', keys: (t) => [t.account] },
};

/** Trades opened within `minutes` of a losing trade closing: a simple revenge-trading check. */
export function afterLoss(trades: Trade[], minutes = 60): { after: Trade[]; others: Trade[] } {
  const losses = trades.filter((t) => counted(t) && tradePnl(t)!.net < 0).map((t) => t.closedAt!);
  const after: Trade[] = [];
  const others: Trade[] = [];
  for (const t of trades.filter(counted)) (losses.some((c) => t.openedAt > c && t.openedAt - c <= minutes * 60) ? after : others).push(t);
  return { after, others };
}

/** R distribution in half-R bins from -3R to +5R (the ends collect everything beyond). */
export function rHistogram(trades: Trade[]): { label: string; lo: number; count: number }[] {
  const bins = Array.from({ length: 16 }, (_, i) => ({ lo: -3 + i * 0.5, count: 0 }));
  for (const t of trades.filter(counted)) {
    const r = rOf(t);
    if (!r) continue;
    const i = Math.max(0, Math.min(15, Math.floor((r.r + 3) / 0.5)));
    bins[i].count++;
  }
  return bins.map((b, i) => ({ ...b, label: i === 0 ? '≤ -2.5R' : i === 15 ? '≥ 4.5R' : `${b.lo}R` }));
}

export interface Filters {
  from?: string;
  to?: string;
  symbol?: string;
  side?: 'long' | 'short' | '';
  status?: 'open' | 'closed' | '';
  result?: 'win' | 'loss' | '';
  tag?: string;
  strategy?: string;
  account?: string;
  text?: string;
}

/** The trades matching every filter set (dates compare the trade's day, inclusive). */
export function applyFilters(trades: Trade[], f: Filters): Trade[] {
  const text = f.text?.trim().toLowerCase();
  return trades.filter((t) => {
    const day = tradeDay(t);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.symbol && t.symbol !== f.symbol.trim().toUpperCase()) return false;
    if (f.side && t.side !== f.side) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.tag && !(t.tags ?? []).includes(f.tag)) return false;
    if (f.strategy && (t.strategy || '') !== f.strategy) return false;
    if (f.account && t.account !== f.account) return false;
    if (f.result) {
      const p = counted(t) ? tradePnl(t)!.net : null;
      if (p == null || (f.result === 'win' ? p <= 0 : p >= 0)) return false;
    }
    if (text && ![t.symbol, t.notes, t.strategy, ...(t.tags ?? []), ...(t.mistakes ?? [])].join(' ').toLowerCase().includes(text)) return false;
    return true;
  });
}

/**
 * Worst (MAE, negative) and best (MFE) open P&L in $ from the bars while the trade was on, for the shares held at entry,
 * and the prices. Bars are bucketed by their start time; the entry and exit bars count in full (an intraday bar
 * size keeps that error small; daily bars are marked by the caller).
 */
export function excursions(t: Trade, bars: Bar[], barSeconds: number) {
  const entry = avgPrice(t.entries);
  if (entry == null) return null;
  const end = t.closedAt ?? Infinity;
  const on = bars.filter((b) => b.time + barSeconds > t.openedAt && b.time <= end);
  if (!on.length) return null;
  const lo = Math.min(...on.map((b) => b.low));
  const hi = Math.max(...on.map((b) => b.high));
  const size = qtyOf(t.entries) * t.multiplier;
  const long = t.side === 'long';
  return {
    mae: Math.min(0, ((long ? lo : hi) - entry) * size * (long ? 1 : -1)),
    mfe: Math.max(0, ((long ? hi : lo) - entry) * size * (long ? 1 : -1)),
    maePrice: long ? lo : hi,
    mfePrice: long ? hi : lo,
    bars: on.length,
  };
}

/** ATR(14) (simple average of true ranges) on the last 14 daily bars before `time`; null without enough bars. */
export function atrAt(bars: Bar[], time: number, n = 14): number | null {
  const before = bars.filter((b) => b.time < time);
  if (before.length < n + 1) return null;
  const tail = before.slice(-(n + 1));
  const trs = tail.slice(1).map((b, i) => Math.max(b.high - b.low, Math.abs(b.high - tail[i].close), Math.abs(b.low - tail[i].close)));
  return sum(trs) / n;
}

/**
 * Plan vs actual: followed the stop (no exit more than a tenth of the planned risk past it), size versus the owner's
 * usual risk (more than 1.5x the median planned risk of the other trades = oversized), and playbook rules ticked.
 */
export function adherence(t: Trade, all: Trade[] = []) {
  const stop = t.plan?.stop;
  const entry = avgPrice(t.entries);
  let followedStop: boolean | null = null;
  if (stop != null && entry != null && t.exits.length) {
    const room = Math.abs(entry - stop) * 0.1;
    followedStop = t.side === 'long' ? t.exits.every((x) => x.price >= stop - room) : t.exits.every((x) => x.price <= stop + room);
  }
  const risks = all.filter((x) => x.id !== t.id).map(plannedRisk).filter((x): x is number => x != null).sort((a, b) => a - b);
  const median = risks.length ? risks[Math.floor(risks.length / 2)] : null;
  const risk = plannedRisk(t);
  const oversized = risk != null && median != null && risks.length >= 5 ? risk > 1.5 * median : null;
  const rules = t.rulesFollowed ?? [];
  return { followedStop, oversized, rulesFollowed: rules.length ? rules.filter(Boolean).length / rules.length : null };
}

/** Plan adherence over many trades: share that followed the stop and share sized within the usual risk. */
export function adherenceSummary(trades: Trade[]) {
  const list = trades.filter(counted).map((t) => adherence(t, trades));
  const share = (xs: (boolean | null)[]) => {
    const known = xs.filter((x): x is boolean => x != null);
    return { n: known.length, rate: known.length ? known.filter(Boolean).length / known.length : null };
  };
  return { stop: share(list.map((a) => a.followedStop)), sized: share(list.map((a) => (a.oversized == null ? null : !a.oversized))) };
}

export interface LotRow {
  symbol: string;
  account: string;
  acquired: string;
  sold: string;
  qty: number;
  proceeds: number;
  cost: number;
  gain: number;
  term: 'Short' | 'Long';
  tradeId: string;
}

/**
 * Realized gains lot by lot (first in, first out within each trade), like a broker's 1099-B. An estimate, not tax
 * advice: wash sales, corporate actions and futures' 60/40 treatment aren't applied. Short sales count as acquired at
 * the cover and sold at the short.
 */
export function realizedLots(trades: Trade[]): LotRow[] {
  const out: LotRow[] = [];
  for (const t of trades.filter((x) => !x.costUnknown)) {
    const lots = t.entries.map((e) => ({ ...e }));
    for (const x of t.exits) {
      let q = x.qty;
      while (q > 1e-12 && lots.length) {
        const lot = lots[0];
        const take = Math.min(q, lot.qty);
        const feeIn = (lot.fees * take) / (lot.qty || 1);
        const feeOut = (x.fees * take) / x.qty;
        const long = t.side === 'long';
        const proceeds = (long ? x.price : lot.price) * take * t.multiplier - feeOut;
        const cost = (long ? lot.price : x.price) * take * t.multiplier + feeIn;
        out.push({
          symbol: t.symbol,
          account: t.account,
          acquired: nyParts(long ? lot.time : x.time).day,
          sold: nyParts(long ? x.time : lot.time).day,
          qty: take,
          proceeds,
          cost,
          gain: proceeds - cost,
          term: x.time - lot.time > 365 * 86400 ? 'Long' : 'Short',
          tradeId: t.id,
        });
        lot.fees -= feeIn;
        lot.qty -= take;
        q -= take;
        if (lot.qty <= 1e-12) lots.shift();
      }
    }
  }
  return out.sort((a, b) => a.sold.localeCompare(b.sold));
}

/** A CSV cell that a spreadsheet won't run as a formula (text starting with = + - @ tab or CR gets a '; plain numbers
 * such as -12.50 stay numbers) and quoted when it holds a comma, quote or line break. */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per trade, for a spreadsheet. */
export function tradesCsv(trades: Trade[]): string {
  const head = ['id', 'symbol', 'account', 'side', 'status', 'opened', 'closed', 'qty', 'avg_entry', 'avg_exit', 'gross', 'fees', 'net', 'r', 'r_estimated', 'strategy', 'tags', 'emotions_before', 'emotions_after', 'rating', 'notes'];
  const rows = trades.map((t) => {
    const p = tradePnl(t);
    const r = rOf(t);
    return [t.id, t.symbol, t.account, t.side, t.status, new Date(t.openedAt * 1000).toISOString(), t.closedAt ? new Date(t.closedAt * 1000).toISOString() : '', qtyOf(t.entries),
      avgPrice(t.entries)?.toFixed(4), avgPrice(t.exits)?.toFixed(4) ?? '', p?.gross.toFixed(2) ?? '', p?.fees.toFixed(2) ?? '', p?.net.toFixed(2) ?? '', r?.r.toFixed(2) ?? '', r?.estimated ? 'yes' : '',
      t.strategy ?? '', (t.tags ?? []).join('; '), (t.emotionsBefore ?? []).join('; '), (t.emotionsAfter ?? []).join('; '), t.rating ?? '', t.notes ?? ''];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Monthly summary rows ('YYYY-MM'), newest first. */
export function monthly(trades: Trade[]) {
  return breakdown(trades, (t) => [tradeDay(t).slice(0, 7)]).sort((a, b) => b.key.localeCompare(a.key));
}

/** The owner's own record per strategy name (for the Setups page next to the scanner's paper record). */
export function strategyRecord(trades: Trade[]) {
  return new Map(breakdown(trades, (t) => (t.strategy ? [t.strategy] : [])).map((r) => [r.key, r]));
}
