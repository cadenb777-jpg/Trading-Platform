/**
 * Types for the helper's market scanner (scanner.results) shared by the Setups page, Home's morning brief and the
 * trade guide, plus takeProfit and sideRecord.
 */

type StrategyKey = 'weekly_swing' | 'mean_reversion' | 'breakout' | string;
type Tier = 'A' | 'B' | 'C';

interface Level {
  price: number;
  label: string;
}

export interface Stats {
  trades: number;
  /** Distinct signal weeks (signal days on hourly bars): trades in one week share one market move (helper v21+). */
  effectiveTrades?: number;
  winRate: number | null;
  profitFactor: number | null;
  /** Average trade after costs. */
  expectancy: number | null;
  /** Average trade in R (multiples of the initial risk), after costs (helper v21+). */
  avgR?: number | null;
  avgBars?: number | null;
  maxDrawdown?: number;
  grade?: string;
  /** t-statistic counting same-week trades as one bet, and the independent bets needed for one-sided p 0.10 at 80% power. */
  tStat?: number | null;
  tradesNeeded?: number | null;
}

export interface Setup {
  symbol: string;
  strategy: StrategyKey;
  strategyName: string;
  direction: number;
  status: 'forming' | 'ready' | 'waiting' | 'in trade';
  statusText: string;
  signalDate: string;
  price: number;
  day: number | null;
  week: number | null;
  reasons: string[];
  score: number;
  tier: Tier | null;
  why?: string[];
  /** One short code per `why` reason, for counting the same reason together. */
  whyCodes?: string[];
  /** What the grade rests on, e.g. "6,200 backtest trades after costs, adjusted for 15 tests" (helper v21+). */
  gradeBasis?: string;
  new?: boolean;
  /** Found by the strategy lab (helper v21: graded only on trades after it was first shown). */
  lab?: boolean;
  /** Plain sector name, for the open-risk-per-sector line (helper v21+). */
  sector?: string;
  conflict?: { strategy: string; direction: number; tier: Tier | null };
  plan: {
    entryType: 'stop' | 'open';
    trigger: number;
    validUntil: string;
    stop: number;
    target: number | null;
    targetNote: string;
    maxHold: number;
    exitBy: string;
    exitRule: string;
    riskReward: number | null;
    riskPct: number | null;
    holdText?: string;
    holdSessions?: number;
    /** The exit trails the price instead of a fixed target (helper v21+). */
    trail?: boolean;
    atr: number;
    horizon: string;
  };
  indicators: {
    z: number | null;
    cot: number | null;
    cotView: 'agree' | 'against' | 'neutral' | null;
    /** Set when COT counts in the grade (the edge study on your data passed). */
    cotGate?: { weeks: number; hi: number; lo: number; sign: number; value: number | null };
    weekly: number | null;
    trendRule?: string;
    trendText?: string | null;
    rsi2: number | null;
  };
  checks: { label: string; ok: boolean | null; detail: string; level?: string }[];
  levels: { supports: Level[]; resistances: Level[] };
  stock: Stats;
  strategyStats: Stats & { randomEntryP: number | null; randomEntryPAdjusted?: number | null };
  randomWalk?: { runs: number; p: number; q?: number; verdict: 'edge' | 'maybe' | 'luck' } | { pending: true; runs: number } | null;
  monteCarlo?: MonteCarlo | null;
  trade?: { entry: number; filled: string; pnl: number; daysHeld: number };
  horizon?: 'short' | 'swing' | 'position';
  unit?: string;
  darkPool?: { avg5: number; avg40: number; date: string };
  earnings?: { date?: string; time?: string; inWindow?: boolean; unknown?: boolean } | null;
  news?: { headline: string; link?: string; source?: string; count: number; tone: number };
  smartMoney?: { text: string; points: number }[];
  bias?: { direction: 'up' | 'down' | 'flat'; winRate: number | null; samples: number } | null;
}

/** 1,000 simulated runs of the next `horizon` trades, drawn from the past ones (in %; or in R when key = 'r'). */
export interface MonteCarlo {
  runs: number;
  horizon: number;
  key?: 'ret' | 'r';
  profitable: number;
  median: number;
  bad: number;
  good: number;
  worstDrop: number;
}

export interface RandomEntry {
  p: number;
  /** Holm-corrected for every strategy record tested at once (helper v21+). */
  pAdjusted?: number;
  family?: number;
  excess?: number;
  trades: number;
  clusters?: number;
  runs?: number;
  verdict: 'edge' | 'maybe' | 'luck';
}

export interface Robust {
  costs: boolean;
  halves: boolean;
  costsExpectancy: number | null;
  firstHalf: { trades: number; expectancy: number | null; tStat: number | null };
  secondHalf: { trades: number; expectancy: number | null; tStat: number | null };
}

export interface SideRecord {
  stats: Stats;
  randomEntry: RandomEntry | null;
  monteCarlo?: MonteCarlo | null;
  /** The same in R: drawdowns at a fixed risk per trade (helper v21+). */
  monteCarloR?: MonteCarlo | null;
  robust?: Robust | null;
}

export interface StrategyInfo {
  name: string;
  short: string;
  horizon: string;
  stocks: number;
  stats: Stats;
  randomEntry: RandomEntry | null;
  monteCarlo?: MonteCarlo | null;
  /** Separate records for buys and sells; breakouts buy only, lab strategies trade one side (helper v21). */
  sides?: { long?: SideRecord; short?: SideRecord };
  lab?: boolean;
  /** Lab strategies: graded on trades since this date only, and capped at B below `needed` of them. */
  forward?: { since: string | null; needed: number } | null;
  description?: string | null;
}

/** Where to take profit. Pullbacks have a tested target; mean reversion's target is the 5-bar average (it moves);
 *  trailing exits (breakouts) have none, so +2R is shown as a reference that is NOT part of the tested rule. */
export function takeProfit(s: Setup): { price: number; label: string; tested: boolean; note: string } {
  const p = s.plan;
  const entry = s.trade?.entry ?? p.trigger;
  if (p.target != null) {
    if (s.strategy === 'mean_reversion')
      return { price: p.target, label: 'Target (moves)', tested: true, note: `Take profit at the first close back across the 5-bar average (about $${p.target.toFixed(2)} today; it moves each bar).` };
    return { price: p.target, label: 'Target', tested: true, note: `Take profit at $${p.target.toFixed(2)} (${p.targetNote}).` };
  }
  const price = entry + (s.direction > 0 ? 1 : -1) * 2 * Math.abs(entry - p.stop);
  return {
    price,
    label: '2R guide',
    tested: false,
    note: `No fixed target: this strategy is tested with a stop that trails the price, so winners can run. If you want a take-profit, $${price.toFixed(2)} is 2× your risk (a guide only, not part of the tested rule).`,
  };
}

/** The record that applies to a setup: its own side's when the helper sends one. */
export function sideRecord(st: StrategyInfo | undefined, direction: number): SideRecord | undefined {
  if (!st) return undefined;
  if (!st.sides) return st;
  return st.sides[direction > 0 ? 'long' : 'short'];
}
