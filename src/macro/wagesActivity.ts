/**
 * Macro → Jobs market's wage block and Growth's activity block. Pure and tested (wagesActivity.test.ts); drawn in
 * expectationsView.ts (wages) and conditionsView.ts (activity) from FRED through macro.series raw.
 *
 * Wages: the Atlanta Fed Wage Growth Tracker, the median 12-month change in hourly pay of the same people a year apart
 * (3-month moving average; FRED FRBATLWGT3MMAUMHWGO, monthly since 1997). Following the same workers removes the
 * shift in who is working that moves average hourly earnings (Daly, Hobijn and Wiles, "Dissecting Aggregate Real Wage
 * Fluctuations", San Francisco Fed Working Paper 2011-23, the method behind the tracker). It counts only people in work in
 * both years, so it runs above aggregate wage growth. The "rough real pay gap" here = the tracker minus the Cleveland Fed's
 * median CPI 12-month rate averaged over the same three months (the tracker is a 3-month average too): one median minus
 * another, not any one worker's real pay change. All three months must be there; a missing one is never filled.
 *
 * Activity: the Chicago Fed National Activity Index, a weighted average of 85 monthly indicators of production,
 * jobs, spending and sales, scaled so zero is growth at the economy's trend pace and one unit is one standard
 * deviation (Stock and Watson, "Forecasting Inflation", Journal of Monetary Economics 44, 1999, the method it follows).
 * Its 3-month average (CFNAIMA3) smooths the monthly noise. No recession line is drawn: the Chicago Fed's own
 * threshold could not be checked at the source, and the recession check above already has two tested readings.
 * Readings, not signals.
 */
import { rounded, signed } from './conditions';
import { month, type MonthPoint } from './sahm';
import { sharePct } from './expectations';

export type Point = MonthPoint;

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const finite = (xs: Point[]) => xs.filter((p) => Number.isFinite(p.value));

export interface Wages {
  month: string;
  value: number;
  /** the same month a year earlier (null when FRED has no reading for it) */
  yearAgo: number | null;
  /** median CPI 12-month rate averaged over the tracker's three months (null unless all three are there) */
  cpi: number | null;
  /** the rough real pay gap as printed: tracker (1 decimal) - cpi (1 decimal), one value for the chip and the words */
  real: number | null;
  /** months loaded, how many had faster wage growth (ties are neither), and the first month */
  months: number;
  higher: number;
  since: string;
}

export function wages(tracker: Point[], medianCpi: Point[]): Wages | null {
  const w = finite(tracker);
  if (!w.length) return null;
  const last = w[w.length - 1];
  const i = monthIndex(last.time);
  const before = w.find((p) => monthIndex(p.time) === i - 12);
  const byMonth = new Map(finite(medianCpi).map((p) => [monthIndex(p.time), p.value]));
  const three = [i - 2, i - 1, i].map((k) => byMonth.get(k));
  const cpi = three.every((v) => v != null) ? (three as number[]).reduce((a, b) => a + b, 0) / 3 : null;
  return {
    month: last.time,
    value: last.value,
    yearAgo: before ? before.value : null,
    cpi,
    real: cpi == null ? null : rounded(rounded(last.value, 1) - rounded(cpi, 1), 1),
    months: w.length,
    higher: w.filter((p) => p.value > last.value).length,
    since: w[0].time,
  };
}

const pct1 = (v: number) => `${signed(v, 1)}%`;

/** Plain words: the pay rise, against a year earlier, against prices, and against its own history (figures as printed).
 * cpiState: 'loaded' (the series came back), 'empty' (it came back with no readings) or 'failed'. */
export function wageWords(x: Wages, cpiState: 'loaded' | 'empty' | 'failed'): string {
  const v = rounded(x.value, 1);
  let t = `In ${month(x.month)} the typical (median) pay rise was ${pct1(x.value)} over a year, for the same people a year apart`;
  if (x.yearAgo != null) {
    const d = rounded(v - rounded(x.yearAgo, 1), 1);
    t += d === 0 ? ', the same pace as a year before.' : `, ${d > 0 ? 'up' : 'down'} from ${pct1(x.yearAgo)} a year before.`;
  } else t += '.';
  if (x.real != null && x.cpi != null) {
    const r = x.real;
    const prices = `With median prices ${rounded(x.cpi, 1) < 0 ? 'down' : 'up'} ${Math.abs(rounded(x.cpi, 1)).toFixed(1)}% over the same three months`;
    t += r > 0 ? ` ${prices}, pay ran ${r.toFixed(1)} points ahead of prices (roughly).` : r < 0 ? ` ${prices}, pay ran ${Math.abs(r).toFixed(1)} points behind prices (roughly).` : ` ${prices}, pay kept pace with prices.`;
  } else
    t +=
      cpiState === 'failed'
        ? ' Median CPI couldn’t be loaded, so there is no real pay reading.'
        : cpiState === 'empty'
          ? ' FRED sent no median CPI readings, so there is no real pay reading.'
          : ` Median CPI doesn’t yet cover all three months to ${month(x.month)}, so there is no real pay reading.`;
  const from = x.since.slice(0, 4);
  t += x.higher === 0 ? ` No month since ${from} was faster.` : ` ${sharePct(x.higher, x.months)}% of months since ${from} were faster.`;
  return t;
}

export interface Activity {
  month: string;
  /** 3-month average and the month's own reading (null when FRED has none for that month) */
  ma3: number;
  monthly: number | null;
  /** 3-month stretches loaded (overlapping, one per month), and how many were stronger / weaker (ties are neither, so
   * the two shares need not add to 100%) */
  months: number;
  stronger: number;
  weaker: number;
  since: string;
}

export function activity(ma3: Point[], monthly: Point[]): Activity | null {
  const a = finite(ma3);
  if (!a.length) return null;
  const last = a[a.length - 1];
  const m = finite(monthly).find((p) => p.time === last.time);
  return {
    month: last.time,
    ma3: last.value,
    monthly: m ? m.value : null,
    months: a.length,
    stronger: a.filter((p) => p.value > last.value).length,
    weaker: a.filter((p) => p.value < last.value).length,
    since: a[0].time,
  };
}

/** Less than this from zero (as printed to 2 decimals) reads as "about its trend pace": a presentation choice of this
 * platform (a tenth of a standard deviation), not a Chicago Fed threshold. */
export const NEAR_TREND = 0.1;

/** Plain words: above, at or below trend (by the 3-month average as printed), the month itself, and its history. */
export function activityWords(x: Activity): string {
  const v = rounded(x.ma3, 2);
  const at = Math.abs(v) < NEAR_TREND;
  let t = `Over the three months to ${month(x.month)} the Chicago Fed’s index of 85 activity measures averaged ${signed(x.ma3, 2)}: ${
    at ? 'the economy grew at about its trend pace (zero)' : v > 0 ? 'the economy grew faster than its trend pace (zero)' : 'the economy grew slower than its trend pace (zero)'
  }.`;
  if (x.monthly != null) t += ` ${month(x.month)} alone: ${signed(x.monthly, 2)}.`;
  const from = x.since.slice(0, 4);
  const s = sharePct(x.stronger, x.months);
  const w = sharePct(x.weaker, x.months);
  t += x.stronger === 0 ? ` No 3-month stretch since ${from} was stronger.` : x.weaker === 0 ? ` No 3-month stretch since ${from} was weaker.` : ` ${s}% of 3-month stretches since ${from} were stronger and ${w}% weaker.`;
  return t;
}
