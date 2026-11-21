/**
 * Macro → Underlying inflation and Recession probability. Pure and tested (underlying.test.ts); drawn in
 * underlyingView.ts from FRED series through the helper's raw request (macro.series {raw}).
 *
 * Underlying inflation: measures that drop the month's outliers, which Fed speakers quote to see past one-off moves.
 * - Median CPI (Cleveland Fed): the middle price change of the CPI's components each month (Bryan and Cecchetti,
 *   "Measuring Core Inflation", NBER 1994). FRED MEDCPIM159SFRBCLE (12-month) and MEDCPIM158SFRBCLE (1 month, annual rate).
 * - Sticky-price core CPI (Atlanta Fed): core items whose prices change rarely, so they carry expectations (Bryan and
 *   Meyer, "Are Some Prices in the CPI More Forward Looking Than Others?", Atlanta Fed 2010). CORESTICKM159SFRBATL /
 *   CORESTICKM158SFRBATL.
 * - Trimmed-mean PCE (Dallas Fed): the PCE measure with the biggest rises and falls cut off (Dolmas, "Trimmed Mean PCE
 *   Inflation", Dallas Fed Working Paper 0506, 2005). PCETRIM12M159SFRBDAL / PCETRIM1M158SFRBDAL.
 * - Headline and core CPI (BLS) from their index levels (CPIAUCSL, CPILFESL) for comparison.
 * The 3-month pace compounds the last three monthly rates (or index levels) to a yearly rate; three consecutive months
 * are required. The Fed's 2% goal is for PCE inflation; CPI measures usually run a few tenths higher.
 *
 * Recession probability: Chauvet and Piger's smoothed recession probabilities from a dynamic-factor Markov-switching
 * model on payrolls, industrial production, real income and real sales ("A Comparison of the Real-Time Performance of
 * Business Cycle Dating Methods", Journal of Business and Economic Statistics 26, 2008). FRED RECPROUSM156N, monthly,
 * about two months behind. The published history is smoothed with today's data, so its record against NBER dates looks
 * better than it would have in real time; that is said beside it.
 */
import { rounded } from './conditions';
import { crossings, missedRecessions, month, type MonthPoint, type Signal } from './sahm';

export type Point = MonthPoint;

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/** The last `n` points if they are consecutive months, else null. */
function lastMonths(xs: Point[], n: number): Point[] | null {
  const ok = xs.filter((p) => Number.isFinite(p.value));
  if (ok.length < n) return null;
  const tail = ok.slice(-n);
  for (let i = 1; i < tail.length; i++) if (monthIndex(tail[i].time) - monthIndex(tail[i - 1].time) !== 1) return null;
  return tail;
}

/** Yearly pace (%) of the last `n` monthly rates that are already at an annual rate (FRED units "158"). */
export function paceFromAnnualRates(monthly: Point[], n = 3): { pace: number; month: string } | null {
  const tail = lastMonths(monthly, n);
  if (!tail) return null;
  const growth = tail.reduce((g, p) => g * Math.pow(1 + p.value / 100, 1 / 12), 1);
  return { pace: (Math.pow(growth, 12 / n) - 1) * 100, month: tail[n - 1].time };
}

/** Yearly pace (%) over the last `n` months of an index level. */
export function paceFromLevels(index: Point[], n = 3): { pace: number; month: string } | null {
  const tail = lastMonths(index, n + 1);
  if (!tail || tail[0].value <= 0) return null;
  return { pace: (Math.pow(tail[n].value / tail[0].value, 12 / n) - 1) * 100, month: tail[n].time };
}

/** Change (%) over 12 months of an index level, for the newest month and the same month a year before. A month FRED
 * has no reading for (BLS published no CPI for October 2025) leaves that rate out and is named in `missing`: it is
 * never filled in. */
export function yearlyFromLevels(index: Point[]): { month: string; now: number | null; yearAgo: number | null; missing: string | null; yearAgoMissing: string | null } | null {
  const ok = index.filter((p) => Number.isFinite(p.value) && p.value > 0);
  if (!ok.length) return null;
  const by = new Map(ok.map((p) => [monthIndex(p.time), p.value]));
  const first = monthIndex(ok[0].time);
  const last = ok[ok.length - 1];
  const i = monthIndex(last.time);
  const at = (k: number) => (by.has(k) && by.has(k - 12) ? (by.get(k)! / by.get(k - 12)! - 1) * 100 : null);
  const iso = (k: number) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01`;
  /** the month inside the loaded span that a 12-month rate ending at k lacks (null when both ends are there or the
   * span simply starts later) */
  const gap = (k: number) => [k, k - 12].find((x) => x >= first && !by.has(x));
  const now = at(i);
  const yearAgo = at(i - 12);
  const g1 = now == null ? gap(i) : undefined;
  const g2 = yearAgo == null ? gap(i - 12) : undefined;
  return { month: last.time, now, yearAgo, missing: g1 == null ? null : iso(g1), yearAgoMissing: g2 == null ? null : iso(g2) };
}

export interface Measure {
  key: 'median' | 'sticky' | 'trimmed' | 'cpi' | 'core';
  label: string;
  /** who publishes it */
  by: string;
  /** true for the three outlier-trimming measures (the panel's subject); false for headline/core, shown to compare */
  underlying: boolean;
  /** FRED ids: the 12-month rate (or the index for cpi/core) and the monthly annual rate (none for cpi/core) */
  yearId: string;
  monthId: string | null;
}

export const MEASURES: Measure[] = [
  { key: 'median', label: 'Median CPI', by: 'Cleveland Fed', underlying: true, yearId: 'MEDCPIM159SFRBCLE', monthId: 'MEDCPIM158SFRBCLE' },
  { key: 'sticky', label: 'Sticky-price core CPI', by: 'Atlanta Fed', underlying: true, yearId: 'CORESTICKM159SFRBATL', monthId: 'CORESTICKM158SFRBATL' },
  { key: 'trimmed', label: 'Trimmed-mean PCE', by: 'Dallas Fed', underlying: true, yearId: 'PCETRIM12M159SFRBDAL', monthId: 'PCETRIM1M158SFRBDAL' },
  { key: 'cpi', label: 'CPI (headline)', by: 'BLS', underlying: false, yearId: 'CPIAUCSL', monthId: null },
  { key: 'core', label: 'Core CPI', by: 'BLS', underlying: false, yearId: 'CPILFESL', monthId: null },
];

export interface Row {
  measure: Measure;
  month: string;
  /** 12-month rate (%) now (null when the index has a missing month; `missing` names it) and a year earlier */
  year: number | null;
  missing?: string | null;
  /** the month missing behind `yearAgo` (index measures only) */
  yearAgoMissing?: string | null;
  yearAgo: number | null;
  /** 3-month pace at a yearly rate (%), for the same month as `year`; null when the months don't line up */
  pace3: number | null;
}

/** One measure's row. For the Fed measures `year` is the published 12-month rate and `monthly` the annual-rate series;
 * for cpi/core `year` is the index (both rates come from its levels). */
export function row(measure: Measure, year: Point[], monthly: Point[]): Row | null {
  if (measure.monthId == null) {
    const y = yearlyFromLevels(year);
    if (!y) return null;
    const p = paceFromLevels(year);
    return { measure, month: y.month, year: y.now, missing: y.missing, yearAgoMissing: y.yearAgoMissing, yearAgo: y.yearAgo, pace3: p && p.month === y.month ? p.pace : null };
  }
  const ok = year.filter((p) => Number.isFinite(p.value));
  if (!ok.length) return null;
  const last = ok[ok.length - 1];
  const before = ok.find((p) => monthIndex(p.time) === monthIndex(last.time) - 12);
  const p = paceFromAnnualRates(monthly);
  return { measure, month: last.time, year: last.value, yearAgo: before ? before.value : null, pace3: p && p.month === last.time ? p.pace : null };
}

/** Plain words over the three underlying measures: where they sit against 2% and whether the recent pace is faster. */
export function underlyingWords(rows: Row[]): string {
  const u = rows.filter((r): r is Row & { year: number } => r.measure.underlying && r.year != null);
  if (!u.length) return 'None of the underlying inflation measures could be loaded right now.';
  const r1 = (v: number) => rounded(v, 1);
  const above = u.filter((r) => r1(r.year) > 2).length;
  const paced = u.filter((r) => r.pace3 != null);
  const faster = paced.filter((r) => r1(r.pace3!) > r1(r.year)).length;
  const slower = paced.filter((r) => r1(r.pace3!) < r1(r.year)).length;
  const lo = Math.min(...u.map((r) => r1(r.year)));
  const hi = Math.max(...u.map((r) => r1(r.year)));
  const range = lo === hi ? `${lo.toFixed(1)}%` : `${lo.toFixed(1)}% to ${hi.toFixed(1)}%`;
  const of = u.length === 3 ? 'all three' : `${u.length === 1 ? 'the one' : `the ${u.length}`} loaded`;
  let t = `Over 12 months the underlying measures run at ${range}; ${above === u.length ? (u.length === 1 ? 'it is' : `${of} are`) : above === 0 ? (u.length === 1 ? 'it is not' : `none of ${of} is`) : `${above} of ${u.length} are`} above 2%.`;
  if (paced.length) {
    t +=
      faster === paced.length
        ? ` Over the last 3 months ${paced.length === 1 ? 'it has' : `${paced.length === 3 ? 'all three have' : 'each has'}`} run faster than its 12-month rate: underlying inflation has picked up lately.`
        : slower === paced.length
          ? ` Over the last 3 months ${paced.length === 1 ? 'it has' : `${paced.length === 3 ? 'all three have' : 'each has'}`} run slower than its 12-month rate: underlying inflation has cooled lately.`
          : ` Over the last 3 months ${faster ? `${faster} of the ${paced.length} ran faster than ${faster === 1 ? 'its' : 'their'} 12-month rate` : `none ran faster than its 12-month rate`}${slower ? ` and ${slower} slower` : faster ? ' and none slower' : ''}: no clear turn yet.`;
  }
  return `${t} The Fed’s 2% goal is for PCE inflation; CPI measures usually run a few tenths higher.`;
}

/** Recession probability: the line read here (%), more likely than not; a crossing needs six quiet months before it,
 * as the Sahm check. Not the authors' own dating rule. */
export const PROB_TRIGGER = 50;

export interface Late {
  date: string;
  value: number;
  /** the recession it fell inside, and how many months after that recession's first month */
  recessionStart: string;
  monthsIn: number;
}

export interface ProbRecord {
  latest: Point;
  /** crossings within MATCH_MONTHS of a recession's start */
  onTime: Signal[];
  /** crossings inside a recession, later than that, for a recession nothing caught on time */
  late: Late[];
  /** crossings outside any recession NBER has declared */
  alarms: Signal[];
  /** recessions that began after the series did, and those with no crossing at all */
  testable: string[];
  missed: string[];
}

/** The start of the NBER recession a month falls inside (USREC = 1): its first month, 'before-data' when it was already
 * under way where the NBER series begins, or null outside any recession. */
function recessionAt(usrec: Point[], iso: string): string | 'before-data' | null {
  const i = usrec.findIndex((p) => p.time === iso);
  if (i < 0 || usrec[i].value !== 1) return null;
  let j = i;
  while (j > 0 && usrec[j - 1].value === 1) j--;
  return j > 0 ? usrec[j].time : 'before-data';
}

export function probRecord(prob: Point[], usrec: Point[]): ProbRecord | null {
  const ok = prob.filter((p) => Number.isFinite(p.value));
  if (!ok.length) return null;
  const signals = crossings(ok, usrec, PROB_TRIGGER);
  const onTime = signals.filter((s) => s.recessionStart);
  const caught = new Set(onTime.map((s) => s.recessionStart));
  const late: Late[] = [];
  const alarms: Signal[] = [];
  for (const s of signals) {
    if (s.recessionStart) continue;
    const r = recessionAt(usrec, s.date);
    if (r == null) alarms.push(s);
    // inside a recession that began before the NBER dates loaded: neither a call nor an alarm, left out
    else if (r === 'before-data') continue;
    // a second crossing in a recession already caught (or already counted late) is a repeat, counted once
    else if (!caught.has(r)) {
      caught.add(r);
      late.push({ date: s.date, value: s.value, recessionStart: r, monthsIn: monthIndex(s.date) - monthIndex(r) });
    }
  }
  // only recessions that began inside the series' own span can be tested
  const last = ok[ok.length - 1].time;
  const testable = missedRecessions(ok, usrec, []).testable.filter((s) => s <= last);
  return { latest: ok[ok.length - 1], onTime, late, alarms, testable, missed: testable.filter((s) => !caught.has(s)) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The probability in words (one decimal, as shown) and its record: on time, late, missed and false alarms. */
export function probWords(r: ProbRecord, usrec: boolean, usrecThrough: string | null): string {
  const v = rounded(r.latest.value, 1);
  let t = `For ${month(r.latest.time)} the model puts the chance that the US economy was in recession at ${v.toFixed(1)}%${v >= PROB_TRIGGER ? `: past ${PROB_TRIGGER}%, so a recession is more likely than not` : ''}.`;
  if (!usrec) return `${t} Its record needs the NBER recession dates (FRED USREC), which couldn’t be loaded right now.`;
  if (r.testable.length) {
    const first = r.testable[0].slice(0, 4);
    const far = Math.max(0, ...r.onTime.map((s) => Math.abs(s.monthsFromStart ?? 0)));
    // recessions caught, not crossings: one recession can collect two on-time crossings
    const caught = new Set(r.onTime.map((s) => s.recessionStart)).size;
    const when = far === 0 ? 'in the same month as the start of' : `within ${plural(far, 'month')} of the start of`;
    const n = r.testable.length;
    const which = caught === n ? (n === 1 ? 'the one recession' : n === 2 ? 'both recessions' : `all ${n} recessions`) : `${caught} of ${n} recessions`;
    t += ` Since ${first} it crossed ${PROB_TRIGGER}% ${when} ${which}.`;
    if (r.late.length) t += ` It was late for ${r.late.map((l) => `the one starting ${month(l.recessionStart)} (${month(l.date)}, ${plural(l.monthsIn, 'month')} in)`).join(' and ')}.`;
    if (r.missed.length) t += ` It never crossed for the one starting ${r.missed.map(month).join(' or ')}.`;
  }
  t += r.alarms.length
    ? ` ${plural(r.alarms.length, 'false alarm')} (${r.alarms.map((s) => month(s.date)).join(', ')})${usrecThrough ? `, by NBER dates to ${month(usrecThrough)}` : ''}.`
    : ' No false alarms.';
  return `${t} The history is smoothed with later data, so this record is better than it looked at the time.`;
}
