/**
 * Rates desk readings (helper 64): the Treasury auction demand scorecard, credit spreads by rating and the Kim-Wright
 * term premium. Pure and tested (ratesDesk.test.ts); drawing in ratesDeskView.ts. Helper maths: engine/ratesdesk.py.
 *
 * Auction scorecard (how desks judge an auction once results post at 1 pm): bid-to-cover (bids / amount sold), the
 * share primary dealers had to take (they must bid, so a big dealer share = weak outside demand) and the indirect
 * share (mostly foreign central banks and funds bidding through dealers), each against the last 6 auctions of the
 * same maturity. A "tail" against the market's when-issued yield is what desks quote first, but the when-issued price
 * isn't free, and our closing-curve stand-in was mostly noise (76 auctions 2024-26: SD 3.7 bp vs typical tails of
 * 1-2 bp), so it is left out (docs/improvement/LESSONS.md).
 */

export interface AuctionRow {
  cusip: string;
  type: string;
  term: string;
  auctionDate: string;
  issueDate: string;
  maturityDate: string;
  yield: number | null;
  bidToCover: number | null;
  reopening: boolean;
  tips?: boolean;
  frn?: boolean;
  dealers?: number | null;
  direct?: number | null;
  indirect?: number | null;
}

export const FAMILIES = [2, 3, 5, 7, 10, 20, 30] as const;
export const LOOKBACK = 6;
export const MIN_PRIOR = 4;
/** Strong / weak when bid-to-cover z minus dealer-share z reaches this. Measured on 126 scored note and bond auctions
 *  (2024-26): 2 labelled a third of them (18% strong, 15% weak); 3 labels about 1 in 10 each way, so 3. */
export const READ_AT = 3;

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The maturity family (2-, 3-, 5-, 7-, 10-, 20- or 30-year) from issue to maturity; reopenings count with their family. */
export function family(a: Pick<AuctionRow, 'issueDate' | 'maturityDate'>): number | null {
  const start = Date.parse(a.issueDate.slice(0, 10));
  const end = Date.parse(a.maturityDate.slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const years = (end - start) / (365.25 * 86400e3);
  const best = FAMILIES.reduce((b, f) => (Math.abs(f - years) < Math.abs(b - years) ? f : b), FAMILIES[0]);
  return Math.abs(best - years) <= 1 ? best : null;
}

export interface Measure {
  value: number;
  usual: number | null;
  z: number | null;
}

export interface Score {
  auction: AuctionRow;
  family: number;
  bidToCover: Measure;
  dealerShare: Measure;
  indirectShare: Measure;
  prior: number;
  read: 'strong' | 'weak' | 'usual' | 'not enough history';
}

function shares(a: AuctionRow) {
  if (!ok(a.dealers) || !ok(a.direct) || !ok(a.indirect)) return null;
  const comp = a.dealers + a.direct + a.indirect;
  return comp > 0 ? { dealer: a.dealers / comp, indirect: a.indirect / comp } : null;
}

function measure(value: number, prior: number[]): Measure {
  if (prior.length < MIN_PRIOR) return { value, usual: null, z: null };
  const mean = prior.reduce((s, x) => s + x, 0) / prior.length;
  const sd = Math.sqrt(prior.reduce((s, x) => s + (x - mean) ** 2, 0) / (prior.length - 1));
  return { value, usual: mean, z: sd > 1e-12 ? (value - mean) / sd : null };
}

/** Nominal coupon auctions (no TIPS, no floating-rate notes) scored against the previous 6 of the same family,
 *  newest first. */
export function scoreAuctions(rows: AuctionRow[]): Score[] {
  const usable = rows
    .filter((a) => (a.type === 'Note' || a.type === 'Bond') && !a.tips && !a.frn && ok(a.bidToCover) && shares(a))
    .map((a) => ({ a, f: family(a), s: shares(a)! }))
    .filter((x): x is { a: AuctionRow; f: number; s: { dealer: number; indirect: number } } => x.f != null)
    .sort((x, y) => x.a.auctionDate.localeCompare(y.a.auctionDate));
  const out: Score[] = [];
  usable.forEach((x, i) => {
    const prior = usable.slice(0, i).filter((p) => p.f === x.f).slice(-LOOKBACK);
    const btc = measure(x.a.bidToCover!, prior.map((p) => p.a.bidToCover!));
    const dealer = measure(x.s.dealer, prior.map((p) => p.s.dealer));
    const indirect = measure(x.s.indirect, prior.map((p) => p.s.indirect));
    let read: Score['read'] = 'not enough history';
    if (btc.z != null && dealer.z != null) {
      const score = btc.z - dealer.z;
      read = score >= READ_AT ? 'strong' : score <= -READ_AT ? 'weak' : 'usual';
    }
    out.push({ auction: x.a, family: x.f, bidToCover: btc, dealerShare: dealer, indirectShare: indirect, prior: prior.length, read });
  });
  return out.reverse();
}

export const READ_WORDS: Record<Score['read'], string> = {
  strong: 'Strong demand',
  weak: 'Weak demand',
  usual: 'About usual',
  'not enough history': 'Too few past auctions',
};

/** One plain sentence for an auction. */
export function scoreSentence(s: Score): string {
  const p = (v: number) => `${Math.round(v * 100)}%`;
  const parts = [`${s.bidToCover.value.toFixed(2)}× bids for every dollar sold${s.bidToCover.usual != null ? ` (usually ${s.bidToCover.usual.toFixed(2)}×)` : ''}`];
  parts.push(`dealers kept ${p(s.dealerShare.value)}${s.dealerShare.usual != null ? ` (usually ${p(s.dealerShare.usual)})` : ''}`);
  parts.push(`indirect bidders took ${p(s.indirectShare.value)}${s.indirectShare.usual != null ? ` (usually ${p(s.indirectShare.usual)})` : ''}`);
  return `${parts.join('; ')}.`;
}

// ---------- credit spreads by rating (engine/ratesdesk.py credit_ladder) ----------

export interface CreditStep {
  to: string;
  bp: number;
  date: string;
  percentile: number | null;
  low: number;
  high: number;
  monthAgo: number | null;
  reading: string;
}
export interface CreditRow {
  rating: string;
  series: string;
  grade: 'ig' | 'hy';
  spread: number | null;
  date?: string;
  monthAgo?: number | null;
  yearAgo?: number | null;
  low?: number;
  high?: number;
  percentile?: number | null;
  from?: string;
  days?: number;
  reading?: string;
  step?: CreditStep;
}
export interface CreditReply {
  rows: CreditRow[];
  failed: string[];
  source: { name: string; url: string; asOf: string | null };
}

/** The headline: the most unusual notch step (tightest or widest against its own 3 years), or a calm sentence. */
export function creditHeadline(rows: CreditRow[]): string {
  const steps = rows.filter((r) => r.step && r.step.percentile != null).map((r) => ({ from: r.rating, ...r.step! }));
  if (!steps.length) return 'Not enough spread history to compare yet.';
  const extreme = steps.reduce((b, s) => (Math.abs(s.percentile! - 50) > Math.abs(b.percentile! - 50) ? s : b));
  const pct = Math.round(extreme.percentile!);
  const start = rows.find((r) => r.from)?.from;
  const since = start ? `since ${new Date(`${start.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}` : 'in the data';
  if (extreme.reading === 'unusually tight')
    return `Moving from ${extreme.from} to ${extreme.to} pays ${Math.round(extreme.bp)} bp more, less than on ${100 - pct}% of days ${since}: that notch of risk is cheaply paid.`;
  if (extreme.reading === 'unusually wide')
    return `Moving from ${extreme.from} to ${extreme.to} pays ${Math.round(extreme.bp)} bp more, more than on ${pct}% of days ${since}: that notch of risk is well paid.`;
  return `Every step between ratings is within its usual range ${since}.`;
}

// ---------- term premium (Kim-Wright) ----------

export interface TermPremium {
  date: string;
  yield: number;
  premium: number;
  expected: number;
  monthAgo: number | null;
  yearAgo: number | null;
  percentile: number | null;
  from: string;
  history: { date: string; premium: number; expected: number }[];
}

export function termPremiumSentence(t: TermPremium): string {
  const pctl = t.percentile != null ? ` That premium is higher than on ${Math.round(t.percentile)}% of days since ${t.from.slice(0, 4)}.` : '';
  return `Of the model's 10-year yield of ${t.yield.toFixed(2)}%, about ${t.expected.toFixed(2)}% is the average short-term rate it expects over 10 years and ${t.premium.toFixed(2)}% is extra pay for lending long.${pctl}`;
}
