/**
 * Beyond the debt line (helper 69): what refinancing the debt due soon would cost at today's corporate bond yields,
 * and what the company owes outside its debt (leases, purchase commitments, uncertain tax positions).
 * Pure and tested (obligations.test.ts, hand-worked on Apple's FY2026 10-K); drawn in debtDilutionView.ts.
 */
import { day, fy, ok, pc, usd, type Ladder, type Maturities, type Statements } from './debtDilution';

/** One figure from the newest annual report that tags it. */
export interface Filed {
  value: number;
  asOf: string;
  filed: string;
  accession: string;
  form: string;
  tag: string;
  url?: string;
}
export interface LeaseLadder extends Omit<Maturities, 'buckets'> {
  buckets: Record<'next12' | 'year2' | 'year3' | 'year4' | 'year5' | 'after5' | 'total' | 'presentValue', number | null>;
}
export interface Obligations {
  /** operating leases (payments by year, total, present value) */
  leases: LeaseLadder | null;
  /** finance lease liability (total only); missing from helpers before this field was added */
  financeLease?: Filed | null;
  purchase: Filed | null;
  uncertainTax: Filed | null;
}
export interface Yield {
  value: number;
  date: string;
  series: string;
}
export interface CorpYields {
  ig: Yield | null;
  hy: Yield | null;
  /** helper 83: Moody's Baa corporate yield (FRED BAA, monthly), for Research's return on capital */
  baa?: Yield | null;
  /** helper 86: 10-year real Treasury yield (FRED DFII10) with its percentile since 2003 */
  real10?: (Yield & { since?: string; percentile?: number | null }) | null;
}

const days = (a: string, b: string) => Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
/** Two balance-sheet dates count as the same year-end within a week (52/53-week years). */
const sameDate = (a: string, b: string) => days(a, b) <= 7;

// ---------- the refinancing wall ----------

export interface Refinancing {
  due: number;
  ig: Yield | null;
  hy: Yield | null;
  /** a year's interest on `due` at each yield */
  igCost: number | null;
  hyCost: number | null;
  operatingIncome: number | null;
  operatingEnd: string | null;
  /** igCost / operating income (only when it is a profit) */
  igShareOfProfit: number | null;
}

/** Interest on the debt due within 2 years if it were borrowed again at today's average corporate yields. The yields
 * are market averages (ICE BofA indexes), not the company's own rate: no credit rating is guessed. The company's own
 * average cost isn't compared: interest expense also covers commercial paper, leases and fees, and the ladder only
 * gives year-end principal, so that ratio could point the wrong way (code review, #19). */
export function refinancing(lad: Ladder | null, a: Statements, y: CorpYields | null | undefined): Refinancing | null {
  if (!lad || lad.dueIn2 == null || lad.dueIn2 <= 0) return null;
  const ig = y?.ig ?? null;
  const hy = y?.hy ?? null;
  if (!ig && !hy) return null;
  const due = lad.dueIn2;
  const oi = a.values.operatingIncome ?? [];
  let i = oi.length - 1;
  while (i >= 0 && !ok(oi[i])) i--;
  const operatingIncome = i >= 0 ? (oi[i] as number) : null;
  const igCost = ig ? (due * ig.value) / 100 : null;
  return {
    due,
    ig,
    hy,
    igCost,
    hyCost: hy ? (due * hy.value) / 100 : null,
    operatingIncome,
    operatingEnd: i >= 0 ? a.periods[i] : null,
    igShareOfProfit: igCost != null && operatingIncome != null && operatingIncome > 0 ? igCost / operatingIncome : null,
  };
}

export function refinancingWords(r: Refinancing): string {
  let t: string;
  if (r.ig && r.igCost != null) {
    t = `Borrowing the ${usd(r.due)} due within 2 years again at today's investment-grade average yield (${r.ig.value.toFixed(2)}% on ${day(r.ig.date)}) would cost ${usd(r.igCost)} a year in interest`;
    if (r.igShareOfProfit != null && r.operatingEnd) t += `, ${pc(r.igShareOfProfit)} of ${fy(r.operatingEnd)} operating profit`;
    if (r.hy && r.hyCost != null) t += `; at the high-yield average (${r.hy.value.toFixed(2)}%), ${usd(r.hyCost)}`;
    t += '.';
  } else {
    t = `Borrowing the ${usd(r.due)} due within 2 years again at today's high-yield average (${(r.hy as Yield).value.toFixed(2)}% on ${day((r.hy as Yield).date)}) would cost ${usd(r.hyCost)} a year in interest.`;
  }
  return `${t} These are market averages, not the company’s own rate, which depends on its credit rating.`;
}

// ---------- outside the debt line ----------

export interface Leases {
  asOf: string;
  next12: number | null;
  total: number | null;
  presentValue: number | null;
  /** total payments minus the present value: the interest inside the lease payments */
  interestPart: number | null;
  /** all scheduled debt principal at the same year-end (complete ladder only), for lease-adjusted debt */
  debt: number | null;
  /** present value over that debt (rating agencies add leases to debt) */
  addsToDebt: number | null;
  financeLease: number | null;
}

/** Above this, "the rest is interest" would mean the payments and the liability weren't measured on the same basis
 * (e.g. a combined operating + finance table): the split isn't shown. Typical leases are well under it. */
export const MAX_INTEREST_SHARE = 0.4;

export function leases(o: Obligations | null | undefined, lad: Ladder | null, m: Maturities | null | undefined): Leases | null {
  const l = o?.leases;
  if (!l) return null;
  const b = l.buckets;
  const byYear = (['next12', 'year2', 'year3', 'year4', 'year5', 'after5'] as const).map((k) => b[k]);
  const total = ok(b.total) ? b.total : byYear.every(ok) ? byYear.reduce((s, v) => s + (v as number), 0) : null;
  const pv = ok(b.presentValue) ? b.presentValue : null;
  if (total == null && pv == null && !byYear.some(ok)) return null;
  // lease-adjusted debt only from the same year-end as the debt ladder, never mixing years
  const debt = lad && m && lad.complete && lad.known > 0 && sameDate(m.asOf, l.asOf) ? lad.known : null;
  const interest = total != null && pv != null && total >= pv ? total - pv : null;
  const fin = o?.financeLease && sameDate(o.financeLease.asOf, l.asOf) ? o.financeLease.value : null;
  return {
    asOf: l.asOf,
    next12: ok(b.next12) ? b.next12 : null,
    total,
    presentValue: pv,
    interestPart: interest != null && total != null && total > 0 && interest / total <= MAX_INTEREST_SHARE ? interest : null,
    debt,
    addsToDebt: debt != null && pv != null ? pv / debt : null,
    financeLease: fin,
  };
}

export function leaseWords(l: Leases): string {
  const parts: string[] = [];
  if (l.total != null) {
    let t = `${usd(l.total)} of operating lease payments are scheduled`;
    if (l.next12 != null) t += ` (${usd(l.next12)} in the next 12 months)`;
    parts.push(`${t}.`);
  } else if (l.next12 != null) parts.push(`${usd(l.next12)} of operating lease payments are due in the next 12 months.`);
  if (l.presentValue != null) {
    let t = `${usd(l.presentValue)} is on the balance sheet as a lease liability`;
    if (l.interestPart != null) t += `; the other ${usd(l.interestPart)} is interest`;
    parts.push(`${t}.`);
  }
  if (l.addsToDebt != null && l.debt != null) parts.push(`Counting them as debt, as rating agencies do, adds ${pc(l.addsToDebt, 0)} to the ${usd(l.debt)} of debt.`);
  if (l.financeLease != null) parts.push(`Finance leases add another ${usd(l.financeLease)} of liability.`);
  return parts.join(' ');
}

/** Purchase commitments or uncertain tax positions against cash and short-term investments. */
export function vsCash(f: Filed | null | undefined, cash: number | null): number | null {
  return f && ok(cash) && cash > 0 ? f.value / cash : null;
}

export function purchaseWords(f: Filed, cash: number | null): string {
  const share = vsCash(f, cash);
  return `Purchase commitments not on the balance sheet (goods and services it has agreed to buy): ${usd(f.value)}${share != null ? `, ${pc(share, 0)} of cash and short-term investments` : ''}.`;
}

export function taxWords(f: Filed, cash: number | null): string {
  const share = vsCash(f, cash);
  return `Tax positions the company itself thinks a tax authority could overturn (unrecognized tax benefits): ${usd(f.value)}${share != null ? `, ${pc(share, 0)} of cash and short-term investments` : ''}. Not all of it would ever be paid, and none of it is due on a date.`;
}
