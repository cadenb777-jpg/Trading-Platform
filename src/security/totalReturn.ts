/**
 * Total return at market price: the price change plus every distribution, reinvested on its ex-date at that day's
 * close. This is how fund factsheets and Morningstar quote performance (SEC Form N-1A asks funds for total return
 * with distributions reinvested; ETFs also show it at NAV, which usually sits within a few hundredths of the price).
 * Pure: closes and dividends come from dividends.history ([YYYY-MM-DD, value], oldest first).
 */

export type Dated = [string, number];

export interface PeriodReturn {
  /** Period label ('Year to date', '1 year', '3 years (a year)' ...). */
  label: string;
  /** Total return as a fraction (0.05 = 5%); annualised for periods over a year. */
  total: number;
  /** Price change only, same span and basis. */
  price: number;
  /** First and last close used. */
  from: string;
  to: string;
}

/** Growth factor of $1 from the close on `start` to the last close (distributions reinvested). */
function growth(closes: Dated[], dividends: Dated[], i0: number): { total: number; price: number } {
  const divs = [...dividends].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let k = 0;
  while (k < divs.length && divs[k][0] <= closes[i0][0]) k++; // paid before (or on) the start: already in the start price
  let total = 1;
  for (let i = i0 + 1; i < closes.length; i++) {
    let cash = 0;
    while (k < divs.length && divs[k][0] <= closes[i][0]) cash += divs[k++][1]; // credited on the first close on/after the ex-date
    total *= (closes[i][1] + cash) / closes[i - 1][1];
  }
  return { total, price: closes[closes.length - 1][1] / closes[i0][1] };
}

/** Index of the last close on or before `day` (null when the history starts after it). */
function startIndex(closes: Dated[], day: string): number | null {
  let idx: number | null = null;
  for (let i = 0; i < closes.length && closes[i][0] <= day; i++) idx = i;
  return idx;
}

const shiftYears = (day: string, years: number) => `${Number(day.slice(0, 4)) - years}${day.slice(4)}`;

/**
 * Year to date, 1 year and 3 years (annualised) where the history covers the whole span; a period the history
 * does not reach (a young fund) is left out rather than shown from a shorter start.
 */
export function totalReturns(closes: Dated[], dividends: Dated[]): PeriodReturn[] {
  const clean = closes.filter((c) => Number.isFinite(c[1]) && c[1] > 0);
  if (clean.length < 2) return [];
  const last = clean[clean.length - 1][0];
  const spans: { label: string; start: string; years: number }[] = [
    { label: 'Year to date', start: `${Number(last.slice(0, 4)) - 1}-12-31`, years: 0 },
    { label: '1 year', start: shiftYears(last, 1), years: 1 },
    { label: '3 years (a year)', start: shiftYears(last, 3), years: 3 },
  ];
  const out: PeriodReturn[] = [];
  for (const s of spans) {
    const i0 = startIndex(clean, s.start);
    if (i0 == null || i0 >= clean.length - 1) continue;
    // the first close must be close to the span start, or the history doesn't reach back that far
    const gapDays = (Date.parse(s.start) - Date.parse(clean[i0][0])) / 86_400_000;
    if (gapDays > 7) continue;
    const g = growth(clean, dividends, i0);
    const ann = (x: number) => (s.years > 1 ? x ** (1 / s.years) - 1 : x - 1);
    out.push({ label: s.label, total: ann(g.total), price: ann(g.price), from: clean[i0][0], to: last });
  }
  return out;
}

/** Whole years a fund has existed on `today` (null without an inception date). */
export function fundAgeYears(inception: string | null | undefined, today = new Date()): number | null {
  if (!inception) return null;
  const t = Date.parse(inception);
  if (!Number.isFinite(t)) return null;
  return (today.getTime() - t) / (365.25 * 86_400_000);
}

/** Years a figure's label covers ("3 years (a year)", "Sharpe ratio (3 years)", "Worst drop (5 years)"); null = none. */
export function labelYears(label: string): number | null {
  const m = label.match(/(\d+)[ -]years?/i);
  return m ? Number(m[1]) : null;
}

/** False for a figure that covers more years than the fund has existed (shown as 0.00% by some data feeds). */
export function coversFundLife(label: string, ageYears: number | null): boolean {
  const n = labelYears(label);
  return n == null || ageYears == null || ageYears + 0.02 >= n;
}

/**
 * The scale that turns a YCharts percent figure into percent units. YCharts' web API sends percent units (1.69 =
 * 1.69%); its Excel add-in sends fractions (0.0169), so Excel figures are multiplied by 100. When the fund's
 * expense ratio is known from another source (a fraction), YCharts' own expense ratio checks which reading is right.
 */
export function ychartsPctScale(source: 'excel' | 'api' | string | undefined, ychartsExpense: unknown, otherExpense: number | null | undefined): { scale: number; checked: boolean } {
  const fallback = source === 'excel' ? 100 : 1;
  if (typeof ychartsExpense !== 'number' || !Number.isFinite(ychartsExpense) || ychartsExpense <= 0 || otherExpense == null || !(otherExpense > 0)) {
    return { scale: fallback, checked: false };
  }
  const want = otherExpense * 100; // in percent units
  const near = (x: number) => Math.abs(x - want) <= Math.max(0.02, want * 0.15);
  if (near(ychartsExpense * 100) && !near(ychartsExpense)) return { scale: 100, checked: true };
  if (near(ychartsExpense) && !near(ychartsExpense * 100)) return { scale: 1, checked: true };
  return { scale: fallback, checked: false };
}
