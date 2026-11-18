/**
 * Debt and dilution (Research overview, helper 68 for the ladder): when a company's debt comes due, how well its
 * profits cover the interest, and whether buybacks really shrink the share count once stock pay is counted.
 * Pure and tested (debtDilution.test.ts, hand-worked on Apple's FY2026 and Coca-Cola's FY2025 10-K figures);
 * drawing in debtDilutionView.ts. Every input is from the company's own SEC filings (XBRL company facts).
 */

export interface Statements {
  periods: string[];
  values: Record<string, (number | null)[]>;
}

/** The 10-K debt maturity table (ASC 470-10-50-1): principal due in each of the next five years and after. */
export interface Maturities {
  asOf: string;
  filed: string;
  accession: string;
  form: string;
  url?: string;
  buckets: Record<BucketKey, number | null>;
}
export type BucketKey = 'next12' | 'year2' | 'year3' | 'year4' | 'year5' | 'after5';
export const BUCKETS: [BucketKey, string][] = [
  ['next12', 'Next 12 months'],
  ['year2', 'Year 2'],
  ['year3', 'Year 3'],
  ['year4', 'Year 4'],
  ['year5', 'Year 5'],
  ['after5', 'After 5 years'],
];

export const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
/** '2026-11-03' -> 'Nov 3, 2026' */
export const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** A year-on-year change in the share count close to a whole-number ratio (2x, 3x, 4x... or 1/2, 1/3...) is a stock
 * split or reverse split left unrestated in an older filing, not dilution. Within 8%, because buybacks and new shares
 * move the diluted count a little in the same year. Anything else, however big (share sales, stock-paid mergers), is
 * real dilution and is compared. */
export const SPLIT_TOLERANCE = 0.08;
export function looksLikeSplit(ratio: number): boolean {
  if (!(ratio > 0)) return false;
  const r = ratio >= 1 ? ratio : 1 / ratio;
  const n = Math.round(r);
  return n >= 2 && Math.abs(r / n - 1) <= SPLIT_TOLERANCE;
}

export const fy = (end: string) => `FY${end.slice(0, 4)}`;

/** $ in plain words: $86.4 billion, $1.65 trillion, $746 million. */
export function usd(v: number | null | undefined): string {
  if (!ok(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)} trillion`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)} billion`;
  if (a >= 1e6) return `${s}$${Math.round(a / 1e6)} million`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
}
/** 0.0288 -> "2.9%"; signed adds + / − (a real minus sign). */
export function pc(v: number | null | undefined, digits = 1, signed = false): string {
  if (!ok(v)) return '—';
  const t = (Math.abs(v) * 100).toFixed(digits);
  if (Number(t) === 0) return `${(0).toFixed(digits)}%`;
  return `${signed ? (v > 0 ? '+' : '−') : v < 0 ? '−' : ''}${t}%`;
}

// ---------- share count ----------

/** 14,720,306,000 -> "14.72 billion"; 4,200,000 -> "4.2 million". */
/** A difference of two rates in percentage points, one decimal, signed by the rounded figure: +31.1, −39.7, 0.0. */
export function signedPoints(v: number): string {
  const t = Math.abs(v * 100).toFixed(1);
  return `${t === '0.0' ? '' : v > 0 ? '+' : '−'}${t}`;
}

export function shareCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  return Math.round(n).toLocaleString('en-US');
}

export interface ShareChange {
  years: number;
  from: string;
  to: string;
  /** yearly rate, (now / then)^(1/years) - 1 */
  rate: number;
}
export interface Shares {
  latest: number;
  latestEnd: string;
  changes: ShareChange[];
  /** the share count changed by a split-like ratio after this year: this year and older aren't compared */
  breakAfter: string | null;
}

/** Diluted share count change per year over 1, 3 and 5 years, never across an unrestated split. */
export function shareChange(a: Statements): Shares | null {
  const row = a.values.dilutedShares ?? [];
  let i = row.length - 1;
  while (i >= 0 && !ok(row[i])) i--;
  if (i < 0) return null;
  const now = row[i] as number;
  // walk back while each year is a plausible step from the next one
  let first = i;
  let breakAfter: string | null = null;
  for (let j = i - 1; j >= 0; j--) {
    const v = row[j];
    const next = row[j + 1];
    if (!ok(v) || !ok(next) || v <= 0) break;
    if (looksLikeSplit(next / v)) {
      breakAfter = a.periods[j];
      break;
    }
    first = j;
  }
  const changes: ShareChange[] = [];
  for (const years of [1, 3, 5]) {
    const j = i - years;
    if (j < first) continue;
    changes.push({ years, from: a.periods[j], to: a.periods[i], rate: (now / (row[j] as number)) ** (1 / years) - 1 });
  }
  return { latest: now, latestEnd: a.periods[i], changes, breakAfter };
}

// ---------- buybacks, dividends and stock pay ----------

export interface Payouts {
  end: string;
  /** null = the filing has no buyback line that year (unknown, not zero) */
  buybacks: number | null;
  dividends: number | null;
  stockComp: number | null;
  revenue: number | null;
  /** buybacks / market value today */
  buybackYield: number | null;
  dividendYield: number | null;
  shareholderYield: number | null;
  /** stock pay as a share of sales */
  sbcOfRevenue: number | null;
  /** stock pay / buybacks: the part of the buyback that only soaks up shares handed to staff */
  sbcOfBuybacks: number | null;
  /** buybacks - stock pay, over market value */
  netBuybackYield: number | null;
}

/** The newest fiscal year with buybacks, dividends or stock pay reported. A figure the filing doesn't give stays
 * null (unknown), never zero; yields that need it are null too. */
export function payouts(a: Statements, marketCap: number | null): Payouts | null {
  const v = a.values;
  for (let i = a.periods.length - 1; i >= 0; i--) {
    const bb = v.buybacks?.[i];
    const dv = v.dividends?.[i] ?? null;
    const sbc = v.stockComp?.[i] ?? null;
    if (!ok(bb) && !ok(dv) && !ok(sbc)) continue;
    const buybacks = ok(bb) ? bb : null;
    const cap = ok(marketCap) && marketCap > 0 ? marketCap : null;
    const rev = v.revenue?.[i] ?? null;
    return {
      end: a.periods[i],
      buybacks,
      dividends: dv,
      stockComp: sbc,
      revenue: rev,
      buybackYield: cap && buybacks != null ? buybacks / cap : null,
      dividendYield: cap && ok(dv) ? dv / cap : null,
      shareholderYield: cap && buybacks != null && ok(dv) ? (buybacks + dv) / cap : null,
      sbcOfRevenue: ok(sbc) && ok(rev) && rev > 0 ? sbc / rev : null,
      sbcOfBuybacks: ok(sbc) && buybacks != null && buybacks > 0 ? sbc / buybacks : null,
      netBuybackYield: cap && ok(sbc) && buybacks != null ? (buybacks - sbc) / cap : null,
    };
  }
  return null;
}

// ---------- debt ----------

export interface Ladder {
  rows: { key: BucketKey; label: string; amount: number | null }[];
  /** sum of the buckets the filing gives */
  known: number;
  complete: boolean;
  dueIn2: number | null;
  /** dueIn2 / all scheduled principal (only when every bucket is given) */
  dueIn2Share: number | null;
}

export function ladder(m: Maturities | null | undefined): Ladder | null {
  if (!m) return null;
  const rows = BUCKETS.map(([key, label]) => ({ key, label, amount: ok(m.buckets[key]) ? (m.buckets[key] as number) : null }));
  if (!rows.some((r) => r.amount != null)) return null;
  const known = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const complete = rows.every((r) => r.amount != null);
  const n = m.buckets.next12;
  const y2 = m.buckets.year2;
  const dueIn2 = ok(n) && ok(y2) ? n + y2 : null;
  return {
    rows,
    known,
    complete,
    dueIn2,
    dueIn2Share: complete && dueIn2 != null && known > 0 ? dueIn2 / known : null,
  };
}

export interface Cover {
  /** fiscal year of the figures used */
  end: string;
  operatingIncome: number;
  interest: number;
  /** operating income / interest expense (negative = an operating loss) */
  times: number;
  /** the newest year has operating income but no separate interest expense line */
  stale: boolean;
  newestEnd: string;
}

/** Interest cover = operating income / interest expense, from the newest year that reports both. */
export function interestCover(a: Statements): Cover | null {
  const oi = a.values.operatingIncome ?? [];
  const ie = a.values.interestExpense ?? [];
  let newest = oi.length - 1;
  while (newest >= 0 && !ok(oi[newest])) newest--;
  if (newest < 0) return null;
  for (let i = newest; i >= 0; i--) {
    const o = oi[i];
    const x = ie[i];
    if (ok(o) && ok(x) && x > 0) return { end: a.periods[i], operatingIncome: o, interest: x, times: o / x, stale: i !== newest, newestEnd: a.periods[newest] };
  }
  return null;
}

/** Rating-agency style words for interest cover (the higher, the safer). */
export function coverWord(times: number): string {
  if (times < 1.5) return 'thin: profits barely pay the interest';
  if (times < 3) return 'tight';
  if (times < 8) return 'comfortable';
  return 'very strong';
}

// ---------- sentences ----------

export function sharesWords(s: Shares): string {
  const five = s.changes.find((c) => c.years === 5) ?? s.changes[s.changes.length - 1];
  const one = s.changes.find((c) => c.years === 1);
  if (!five) return `${shareCount(s.latest)} diluted shares in ${fy(s.latestEnd)}.`;
  const dir = (r: number) => (Math.abs(r) < 0.0005 ? 'about flat' : r < 0 ? `shrinking ${pc(-r)} a year` : `growing ${pc(r)} a year`);
  let t = `The share count is ${dir(five.rate)} over ${five.years} year${five.years > 1 ? 's' : ''} (${fy(five.from)} to ${fy(five.to)})`;
  if (one && one !== five) t += `; ${pc(one.rate, 1, true)} in the last year`;
  t += '.';
  if (five.rate < -0.0005) t += ' Each share owns a growing slice of the company.';
  else if (five.rate > 0.0005) t += ' Each share owns a shrinking slice: new shares are diluting owners.';
  return t;
}

export function payoutWords(p: Payouts): string {
  const year = fy(p.end);
  const parts: string[] = [];
  if (p.buybacks != null && p.buybacks > 0) parts.push(`spent ${usd(p.buybacks)} buying back shares`);
  if (ok(p.dividends) && p.dividends > 0) parts.push(`paid ${usd(p.dividends)} in dividends`);
  let t = parts.length ? `In ${year} the company ${parts.join(' and ')}` : `In ${year} the filings show no buybacks or dividends`;
  const bought = p.buybacks != null && p.buybacks > 0;
  const paid = ok(p.dividends) && p.dividends > 0;
  // the yield of exactly what the sentence lists
  const y = bought && paid ? p.shareholderYield : bought ? p.buybackYield : paid ? p.dividendYield : null;
  if (ok(y) && y > 0) t += `: ${pc(y)} of today's market value`;
  t += '.';
  if (ok(p.stockComp) && p.stockComp > 0) {
    t += ` It also paid staff ${usd(p.stockComp)} in stock`;
    if (ok(p.sbcOfRevenue)) t += ` (${pc(p.sbcOfRevenue)} of sales)`;
    if (ok(p.sbcOfBuybacks)) {
      t += p.sbcOfBuybacks >= 1
        ? `, more than the buybacks: they don't even offset the new shares.`
        : `, so ${pc(p.sbcOfBuybacks, 0)} of the buyback only offsets shares handed to staff.`;
    } else t += '.';
  }
  if (p.buybacks == null) t += ' The filing has no share buyback line that year, so buybacks are unknown, not zero.';
  return t;
}

export function ladderWords(l: Ladder, m: Maturities, cash: number | null): string {
  let t = `The ${fy(m.asOf)} ${m.form} schedules ${usd(l.known)} of debt principal`;
  t += l.complete ? '.' : ` in the years it lists (it doesn't break out every year).`;
  if (l.dueIn2 != null) {
    t += ` ${usd(l.dueIn2)} is due within 2 years`;
    t += l.dueIn2Share != null ? ` (${pc(l.dueIn2Share, 0)} of it).` : '.';
    if (ok(cash) && cash > 0 && l.dueIn2 > 0) {
      const x = cash / l.dueIn2;
      t += x >= 1
        ? ` Cash and short-term investments cover that ${x.toFixed(1)} times over.`
        : ` Cash and short-term investments cover only ${pc(x, 0)} of it: the rest must come from profits or new borrowing.`;
    }
  }
  return t;
}

export function coverWords(c: Cover): string {
  if (c.operatingIncome <= 0) {
    const t = `${fy(c.end)} had an operating loss of ${usd(-c.operatingIncome)}: no operating profit to pay ${usd(c.interest)} of interest, so it came from cash or borrowing.`;
    return c.stale ? `${t} Newer filings don't show interest expense on its own line.` : t;
  }
  const base = `Operating profit covers interest ${c.times.toFixed(1)} times (${fy(c.end)}: ${usd(c.operatingIncome)} vs ${usd(c.interest)})`;
  if (c.stale) return `${base}. Since then the filings don't show interest expense on its own line, so the newest year (${fy(c.newestEnd)}) can't be checked.`;
  return `${base}: ${coverWord(c.times)}.`;
}
