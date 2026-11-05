/**
 * The security view's maths (Risk / BETA tab, key levels, dividends). Pure and tested against reference values in
 * stats.test.ts. Conventions (as Bloomberg's BETA and HRA defaults): simple daily returns, 252 trading days a year,
 * sample (n-1) standard deviation, beta = cov(asset, market) / var(market) on the same dates, annualised Sharpe and
 * Sortino with the risk-free rate taken off each day. Every function returns null instead of NaN when the data is too
 * short, so the page shows "—" with a reason and never "NaN".
 */

export const TRADING_DAYS = 252;
/** Fewer than this many paired daily returns and a statistic is not shown. */
export const MIN_RETURNS = 60;

/** A day's close: [unix seconds, close]. */
export type Close = [number, number];

export const dayKey = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const finite = (v: number) => Number.isFinite(v);
/** A spread this small is rounding noise: ratios over it are meaningless. */
const EPS = 1e-12;

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** Sample standard deviation (n-1). */
export function stdev(xs: number[]): number | null {
  const m = mean(xs);
  if (m == null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Simple returns between consecutive closes (closes that aren't positive numbers are skipped). */
export function returnsOf(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (finite(a) && finite(b) && a > 0 && b > 0) out.push(b / a - 1);
  }
  return out;
}

/** Daily returns of two series on the dates both traded (each return spans the same two dates). */
export function pairedReturns(a: Close[], b: Close[]): { a: number[]; b: number[]; days: string[] } {
  const bMap = new Map(b.map(([t, c]) => [dayKey(t), c]));
  const both = a.map(([t, c]) => [dayKey(t), c, bMap.get(dayKey(t))] as const).filter(([, x, y]) => y != null && x > 0 && (y as number) > 0);
  const out = { a: [] as number[], b: [] as number[], days: [] as string[] };
  for (let i = 1; i < both.length; i++) {
    out.a.push(both[i][1] / both[i - 1][1] - 1);
    out.b.push((both[i][2] as number) / (both[i - 1][2] as number) - 1);
    out.days.push(both[i][0]);
  }
  return out;
}

export function covariance(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ma = mean(a.slice(0, n))!;
  const mb = mean(b.slice(0, n))!;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

/** Beta of `asset` to `market` (same-date returns). */
export function beta(asset: number[], market: number[]): number | null {
  if (Math.min(asset.length, market.length) < MIN_RETURNS) return null;
  const cov = covariance(asset, market);
  const sd = stdev(market.slice(0, asset.length));
  return cov == null || sd == null || sd < EPS ? null : cov / sd ** 2;
}

export function correlation(a: number[], b: number[]): number | null {
  if (Math.min(a.length, b.length) < MIN_RETURNS) return null;
  const n = Math.min(a.length, b.length);
  const cov = covariance(a, b);
  const sa = stdev(a.slice(0, n));
  const sb = stdev(b.slice(0, n));
  return cov == null || sa == null || sb == null || sa < EPS || sb < EPS ? null : Math.max(-1, Math.min(1, cov / (sa * sb)));
}

/** Annualised volatility of daily returns. */
export function annualVol(returns: number[]): number | null {
  if (returns.length < MIN_RETURNS) return null;
  const sd = stdev(returns);
  return sd == null ? null : sd * Math.sqrt(TRADING_DAYS);
}

/** Annualised Sharpe ratio: mean daily excess return over its standard deviation, times √252. */
export function sharpe(returns: number[], riskFree = 0): number | null {
  if (returns.length < MIN_RETURNS) return null;
  const rf = riskFree / TRADING_DAYS;
  const ex = returns.map((r) => r - rf);
  const sd = stdev(ex);
  return sd != null && sd > EPS ? (mean(ex)! / sd) * Math.sqrt(TRADING_DAYS) : null;
}

/** Annualised Sortino ratio: mean daily excess return over the downside deviation (below the risk-free rate, all days counted). */
export function sortino(returns: number[], riskFree = 0): number | null {
  if (returns.length < MIN_RETURNS) return null;
  const rf = riskFree / TRADING_DAYS;
  const ex = returns.map((r) => r - rf);
  const dd = Math.sqrt(ex.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / ex.length);
  return dd > EPS ? (mean(ex)! / dd) * Math.sqrt(TRADING_DAYS) : null;
}

export interface Drawdown {
  /** The fall from the peak, as a negative fraction (-0.25 = 25% down); 0 when it never fell. */
  depth: number;
  peak: number;
  trough: number;
  /** The index where the price got back above the peak, or null if it hasn't. */
  recovered: number | null;
}

/** The largest peak-to-trough fall of a price series. */
export function maxDrawdown(closes: number[]): Drawdown | null {
  const xs = closes.filter((c) => finite(c) && c > 0);
  if (xs.length < 2) return null;
  let peak = 0;
  let best: Drawdown = { depth: 0, peak: 0, trough: 0, recovered: null };
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] > xs[peak]) peak = i;
    const dd = xs[i] / xs[peak] - 1;
    if (dd < best.depth) best = { depth: dd, peak, trough: i, recovered: null };
  }
  if (best.depth < 0) {
    for (let i = best.trough + 1; i < xs.length; i++) if (xs[i] >= xs[best.peak]) {
      best.recovered = i;
      break;
    }
  }
  return best;
}

/** Yearly growth rate from the first to the last close over `years`. */
export function cagr(first: number, last: number, years: number): number | null {
  if (!(first > 0) || !(last > 0) || !(years > 0)) return null;
  return (last / first) ** (1 / years) - 1;
}

/** The closes from the last `days` calendar days (the newest close's date counts back). */
export function lastDays(series: Close[], days: number): Close[] {
  if (!series.length) return [];
  const from = series[series.length - 1][0] - days * 86400;
  return series.filter(([t]) => t >= from);
}

export interface RiskWindow {
  label: string;
  /** Daily returns used. */
  n: number;
  beta: number | null;
  correlation: number | null;
  vol: number | null;
  benchVol: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: Drawdown | null;
  /** Price return over the window (yearly rate for windows longer than a year). */
  ret: number | null;
}

/** Risk figures for one window (e.g. 365 or 3 × 365 calendar days). */
export function riskWindow(asset: Close[], bench: Close[], days: number, riskFree: number, label: string): RiskWindow {
  const a = lastDays(asset, days);
  const b = lastDays(bench, days);
  const p = pairedReturns(a, b);
  const own = returnsOf(a.map(([, c]) => c));
  // a window counts only when the history really covers it (a 3-year window on 1 year of data is not shown)
  const covered = a.length > 1 && a[a.length - 1][0] - a[0][0] >= days * 86400 * 0.9;
  const years = a.length > 1 ? (a[a.length - 1][0] - a[0][0]) / (365.25 * 86400) : 0;
  const ret = covered && a.length > 1 ? (years > 1.1 ? cagr(a[0][1], a[a.length - 1][1], years) : a[a.length - 1][1] / a[0][1] - 1) : null;
  return {
    label,
    n: p.a.length,
    beta: covered ? beta(p.a, p.b) : null,
    correlation: covered ? correlation(p.a, p.b) : null,
    vol: covered ? annualVol(own) : null,
    benchVol: covered ? annualVol(returnsOf(b.map(([, c]) => c))) : null,
    sharpe: covered ? sharpe(own, riskFree) : null,
    sortino: covered ? sortino(own, riskFree) : null,
    maxDrawdown: covered ? maxDrawdown(a.map(([, c]) => c)) : null,
    ret,
  };
}

/**
 * A portfolio's daily returns from its holdings' closes and value weights. On each day the holdings with a return
 * that day share the weight (a holding that hadn't listed yet doesn't count as flat).
 */
export function portfolioReturns(holdings: { weight: number; closes: Close[] }[]): Close[] {
  const byDay = new Map<string, { sum: number; w: number; t: number }>();
  for (const x of holdings) {
    if (!(x.weight > 0)) continue;
    const s = x.closes.filter(([, c]) => c > 0);
    for (let i = 1; i < s.length; i++) {
      const k = dayKey(s[i][0]);
      const e = byDay.get(k) ?? { sum: 0, w: 0, t: s[i][0] };
      e.sum += x.weight * (s[i][1] / s[i - 1][1] - 1);
      e.w += x.weight;
      byDay.set(k, e);
    }
  }
  // as an index level (starting at 1), so it pairs with a price series through pairedReturns
  const days = [...byDay.values()].sort((a, b) => a.t - b.t);
  const out: Close[] = [];
  let level = 1;
  if (days.length) out.push([days[0].t - 86400, 1]);
  for (const d of days) {
    level *= 1 + d.sum / d.w;
    out.push([d.t, level]);
  }
  return out;
}

// ---------- key levels ----------

export interface LevelBar {
  time: number;
  high: number;
  low: number;
  close: number;
}

export function sma(values: number[], n: number): number | null {
  if (values.length < n || n <= 0) return null;
  return mean(values.slice(-n));
}

/** Average true range (simple average of the last n true ranges). */
export function atr(bars: LevelBar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1].close;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev)));
  }
  return mean(tr);
}

export interface KeyLevels {
  high52: number | null;
  low52: number | null;
  sma50: number | null;
  sma200: number | null;
  prevClose: number | null;
  atr14: number | null;
  /** The newest bar's range (today's range while the market is open). */
  dayHigh: number | null;
  dayLow: number | null;
}

/** 52-week range, 50/200-day averages, previous close and ATR from daily bars (oldest first). */
export function keyLevels(bars: LevelBar[]): KeyLevels {
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const year = last ? bars.filter((b) => b.time >= last.time - 365 * 86400) : [];
  return {
    high52: year.length ? Math.max(...year.map((b) => b.high)) : null,
    low52: year.length ? Math.min(...year.map((b) => b.low)) : null,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    prevClose: bars.length > 1 ? bars[bars.length - 2].close : null,
    atr14: atr(bars, 14),
    dayHigh: last?.high ?? null,
    dayLow: last?.low ?? null,
  };
}

// ---------- dividends ----------

export interface DividendSummary {
  /** Dividends with an ex-date in the last 365 days, per share. */
  ttm: number;
  /** ttm / price (null without a price). */
  yield: number | null;
  /** Payments a year (from the last 2 years). */
  perYear: number;
  /** Yearly growth of the dividend over the last 5 full calendar years (null with less history or a zero year). */
  growth5y: number | null;
  /** The next ex-date, estimated from the usual gap between payments (null for fewer than 3 payments). */
  nextEx: string | null;
  /** Calendar year -> total per share. */
  byYear: [number, number][];
}

const dayMs = 86400000;

/** Dividends [ISO ex-date, per share] (any order) read as yield, frequency, growth and the next ex-date estimate. */
export function dividendSummary(divs: [string, number][], price: number | null, today: string): DividendSummary {
  const list = divs.filter(([d, a]) => /^\d{4}-\d{2}-\d{2}/.test(d) && a > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  const t = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  const ttm = list.filter(([d]) => now - t(d) < 365 * dayMs && t(d) <= now).reduce((s, [, a]) => s + a, 0);
  const recent = list.filter(([d]) => now - t(d) < 730 * dayMs);
  const perYear = Math.round(recent.length / 2);
  const years = new Map<number, number>();
  for (const [d, a] of list) years.set(Number(d.slice(0, 4)), (years.get(Number(d.slice(0, 4))) ?? 0) + a);
  const thisYear = Number(today.slice(0, 4));
  const y1 = years.get(thisYear - 1);
  const y0 = years.get(thisYear - 6);
  const growth5y = y1 && y0 ? cagr(y0, y1, 5) : null;
  let nextEx: string | null = null;
  if (list.length >= 3) {
    const gaps = list.slice(-5).map(([d], i, a) => (i ? t(d) - t(a[i - 1][0]) : 0)).slice(1).sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    let next = t(list[list.length - 1][0]) + gap;
    while (next < now) next += gap;
    // a payer that stopped (more than two gaps without a payment) has no next date
    if (gap > 0 && now - t(list[list.length - 1][0]) <= 2 * gap) nextEx = new Date(next).toISOString().slice(0, 10);
  }
  return { ttm, yield: price && price > 0 && ttm ? ttm / price : null, perYear, growth5y, nextEx, byYear: [...years.entries()].sort((a, b) => a[0] - b[0]) };
}
