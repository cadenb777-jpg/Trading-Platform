/**
 * Macro → Inflation expected, and the Jobs market. Pure and tested (expectations.test.ts); drawn in
 * expectationsView.ts from FRED series the helper already serves raw (macro.series {raw}): EXPINF1YR..EXPINF30YR,
 * T5YIE, T10YIE, FRBKCLMCILA and FRBKCLMCIM. No helper change.
 *
 * Expected inflation: the Cleveland Fed's model estimates of average inflation over the next 1 to 30 years, from
 * Treasury yields, inflation data, inflation swaps and surveys (Haubrich, Pennacchi and Ritchken, "Inflation
 * Expectations, Real Rates, and Risk Premia: Evidence from Inflation Swaps", Review of Financial Studies 25, 2012).
 * A breakeven (nominal minus TIPS yield) is expected inflation plus an inflation risk premium minus a TIPS liquidity
 * premium, so breakeven minus the model's expectation is a reading of those two premia together, not a mispricing.
 *
 * Months compared: the model's estimate for a month is published early in that month (FRED updated November 2026's
 * on Nov 10), so it is built from data before the month. Each estimate is set against the average daily breakeven
 * of the month BEFORE it, and only whole months count: a month is whole once the breakeven series has a reading in a
 * later month (a month under way, or a saved copy that stops mid-month, is never averaged as if whole).
 *
 * Jobs market: the Kansas City Fed's Labor Market Conditions Indicators, two factors from 24 labour measures: the level
 * of activity (zero = its long-run average) and momentum (zero = its usual pace of change) (Hakkio and Willis,
 * "Assessing Labor Market Conditions: The Level of Activity and the Speed of Improvement", Kansas City Fed Macro
 * Bulletin, 2013). Negative momentum means improving slower than usual, which includes getting worse. Readings, not
 * signals.
 */
import { rounded, signed } from './conditions';
import type { MonthPoint } from './sahm';

export type Point = MonthPoint;

/** The Cleveland Fed horizons shown, in years, with their FRED ids. */
export const HORIZONS = [1, 2, 5, 10, 30] as const;
export const expinfId = (years: number) => `EXPINF${years}YR`;

const monthOf = (iso: string) => iso.slice(0, 7);

/** 'October 2026' for '2026-10-01' (or '2026-10'). */
export function monthLabel(iso: string): string {
  return new Date(`${iso.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** '2026-10' moved by n months ('2026-01', -1 -> '2025-12'). */
export function shiftMonths(month: string, n: number): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Share as a whole percent, kept within 1-99 unless it really is none or all (1 of 250 is "1%", never "0%"). */
export function sharePct(count: number, total: number): number {
  if (count <= 0) return 0;
  if (count >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((count / total) * 100)));
}

/** Average of the daily readings in each whole calendar month ('2026-10' -> mean); the newest month is left out. */
export function monthlyAverages(daily: Point[]): Map<string, number> {
  const sums = new Map<string, { s: number; n: number }>();
  for (const p of daily) {
    if (!Number.isFinite(p.value)) continue;
    const k = monthOf(p.time);
    const a = sums.get(k) ?? { s: 0, n: 0 };
    a.s += p.value;
    a.n += 1;
    sums.set(k, a);
  }
  const newest = [...sums.keys()].sort().pop();
  const out = new Map<string, number>();
  for (const [k, a] of sums) if (k !== newest) out.set(k, a.s / a.n);
  return out;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface CurvePoint {
  years: number;
  value: number;
}

export interface Gap {
  years: 5 | 10;
  /** the model's month ('2026-11-01') and the whole month of breakevens before it ('2026-10-01') */
  modelMonth: string;
  marketMonth: string;
  model: number;
  breakeven: number;
  /** breakeven - model, in points */
  gap: number;
  /** the median gap over every pair of months compared, and how many pairs */
  typical: number | null;
  months: number;
  /** pairs whose gap was lower / higher than this one (ties are neither) */
  lower: number;
  higher: number;
}

export interface Expectations {
  /** the newest month with every horizon */
  month: string;
  curve: CurvePoint[];
  /** the same horizons twelve months earlier (null when that month is missing) */
  yearAgo: CurvePoint[] | null;
  /** model vs market, 5- and 10-year (each only when its breakevens loaded and overlap the model) */
  gaps: Gap[];
}

const byMonth = (xs: Point[]) => new Map(xs.filter((p) => Number.isFinite(p.value)).map((p) => [monthOf(p.time), p.value]));

function curveAt(model: Map<number, Map<string, number>>, month: string): CurvePoint[] | null {
  const out: CurvePoint[] = [];
  for (const y of HORIZONS) {
    const v = model.get(y)?.get(month);
    if (v == null) return null;
    out.push({ years: y, value: v });
  }
  return out;
}

/** One horizon's gaps: each model month against the whole month of breakevens before it. */
export function gapOf(years: 5 | 10, model: Point[], daily: Point[]): Gap | null {
  const m = byMonth(model);
  const avg = monthlyAverages(daily);
  const pairs = [...avg.keys()].filter((k) => m.has(shiftMonths(k, 1))).sort();
  if (!pairs.length) return null;
  const diffs = pairs.map((k) => avg.get(k)! - m.get(shiftMonths(k, 1))!);
  const last = pairs[pairs.length - 1];
  const gap = diffs[diffs.length - 1];
  return {
    years,
    modelMonth: `${shiftMonths(last, 1)}-01`,
    marketMonth: `${last}-01`,
    model: m.get(shiftMonths(last, 1))!,
    breakeven: avg.get(last)!,
    gap,
    typical: median(diffs),
    months: pairs.length,
    lower: diffs.filter((d) => d < gap).length,
    higher: diffs.filter((d) => d > gap).length,
  };
}

/** model: horizon (years) -> the Cleveland Fed's monthly series; be5/be10: daily breakevens (empty when not loaded). */
export function expectations(model: Map<number, Point[]>, be5: Point[], be10: Point[]): Expectations | null {
  const maps = new Map(HORIZONS.map((y) => [y as number, byMonth(model.get(y) ?? [])]));
  const months = [...(maps.get(1)?.keys() ?? [])].sort();
  for (let i = months.length - 1; i >= 0; i--) {
    const curve = curveAt(maps, months[i]);
    if (!curve) continue;
    const gaps = [gapOf(5, model.get(5) ?? [], be5), gapOf(10, model.get(10) ?? [], be10)].filter((g): g is Gap => g != null);
    return { month: `${months[i]}-01`, curve, yearAgo: curveAt(maps, shiftMonths(months[i], -12)), gaps };
  }
  return null;
}

const pc = (v: number) => `${v.toFixed(2)}%`;
const yrs = (y: number) => (y === 1 ? 'the next year' : `the next ${y} years`);
/** A move in points as words, read from the move as printed. */
const move = (x: number) => {
  const r = rounded(x, 2);
  return r === 0 ? 'unchanged' : `${r > 0 ? 'up' : 'down'} ${Math.abs(r).toFixed(2)} points`;
};

/** Plain words for the curve: the near term against the long run (as printed), and the change from a year earlier. */
export function curveWords(e: Expectations): string {
  const first = e.curve[0];
  const last = e.curve[e.curve.length - 1];
  const tilt = rounded(first.value, 2) - rounded(last.value, 2);
  let t = `In ${monthLabel(e.month)} the Cleveland Fed’s model expected inflation to average ${pc(first.value)} over ${yrs(first.years)} and ${pc(last.value)} over ${yrs(last.years)}`;
  t += tilt > 0.001 ? ', so it expects inflation to be higher in the near term than over the long run.' : tilt < -0.001 ? ', so it expects inflation to be lower in the near term than over the long run.' : ', the same in the near term as over the long run.';
  if (e.yearAgo) {
    const a = e.yearAgo[0].value;
    const b = e.yearAgo[e.yearAgo.length - 1].value;
    t += ` A year earlier: ${pc(a)} and ${pc(b)} (${move(rounded(first.value, 2) - rounded(a, 2))} and ${move(rounded(last.value, 2) - rounded(b, 2))}).`;
  }
  return t;
}

/** Where a gap sits, by its sign as printed: "market 0.32 points below the model". */
function side(gap: number): string {
  const v = rounded(gap, 2);
  return v === 0 ? 'level with the model' : `${Math.abs(v).toFixed(2)} points ${v > 0 ? 'above' : 'below'} the model`;
}

/** Plain words for one model-vs-market gap. */
export function gapWords(g: Gap): string {
  let t = `${g.years}-year: the bond market’s breakeven averaged ${pc(g.breakeven)} in ${monthLabel(g.marketMonth)}, ${side(g.gap).replace('the model', `the model’s ${pc(g.model)} for ${monthLabel(g.modelMonth)}`)}.`;
  if (g.typical == null || g.months < 12) return t;
  t += ` Over the ${g.months} months compared, the typical (median) gap was ${side(g.typical)}`;
  const low = sharePct(g.lower, g.months);
  const high = sharePct(g.higher, g.months);
  t +=
    g.lower === 0
      ? '; no month had a lower gap.'
      : g.higher === 0
        ? '; no month had a higher gap.'
        : low <= 10
          ? `; only ${low}% of months had a lower gap.`
          : high <= 10
            ? `; only ${high}% of months had a higher gap.`
            : ', so today’s gap is within its usual range.';
  return t;
}

export type JobsState = 'strong-improving' | 'strong-slowing' | 'weak-improving' | 'weak-slowing';

export interface Jobs {
  month: string;
  level: number;
  momentum: number | null;
  /** the level three months earlier, by position (null when there is no such month) */
  change3m: number | null;
  /** months loaded, and how many had a higher level than this month (ties are neither) */
  months: number;
  higher: number;
  since: string;
  state: JobsState | null;
}

/** The four states of Hakkio and Willis (2013), read from the figures as printed (0.00 counts as at or above). */
export function jobsState(level: number, momentum: number): JobsState {
  const up = rounded(momentum, 2) >= 0;
  return rounded(level, 2) >= 0 ? (up ? 'strong-improving' : 'strong-slowing') : up ? 'weak-improving' : 'weak-slowing';
}

/** The chip's words, read from both figures as printed: "Above average, gaining momentum". */
export function stateWords(level: number, momentum: number): string {
  const v = rounded(level, 2);
  const m = rounded(momentum, 2);
  return `${v > 0 ? 'Above average' : v < 0 ? 'Below average' : 'At its average'}, ${m > 0 ? 'gaining momentum' : m < 0 ? 'losing momentum' : 'momentum at its usual pace'}`;
}

export function jobsWords(j: Jobs): string {
  const v = rounded(j.level, 2);
  let t = `In ${monthLabel(j.month)} the Kansas City Fed’s reading of 24 labour measures stood at ${signed(j.level, 2)}: ${v > 0 ? 'more hiring and work than' : v < 0 ? 'less hiring and work than' : 'about as much hiring and work as'} its long-run average (zero)`;
  if (j.momentum != null) {
    const m = rounded(j.momentum, 2);
    t += `, with momentum at ${signed(j.momentum, 2)} (${m > 0 ? 'improving faster than usual' : m < 0 ? 'improving slower than usual, or worsening' : 'improving at its usual pace'})`;
  }
  t += '.';
  const from = j.since.slice(0, 4);
  t += j.higher === 0 ? ` No month since ${from} was stronger.` : ` ${sharePct(j.higher, j.months)}% of months since ${from} were stronger.`;
  if (j.change3m != null) t += ` ${move(j.change3m).replace(/^./, (c) => c.toUpperCase())} over three months.`;
  return t;
}

export function jobs(level: Point[], momentum: Point[]): Jobs | null {
  const lv = level.filter((p) => Number.isFinite(p.value));
  if (!lv.length) return null;
  const latest = lv[lv.length - 1];
  const mom = momentum.find((p) => p.time === latest.time && Number.isFinite(p.value));
  return {
    month: latest.time,
    level: latest.value,
    momentum: mom ? mom.value : null,
    change3m: lv.length > 3 ? latest.value - lv[lv.length - 4].value : null,
    months: lv.length,
    higher: lv.filter((p) => p.value > latest.value).length,
    since: lv[0].time,
    state: mom ? jobsState(latest.value, mom.value) : null,
  };
}
