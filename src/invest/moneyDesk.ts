/**
 * Money and supply (helper 66, engine/moneydesk.py `bonds.money`): funding stress (SOFR vs IORB), the mortgage spread
 * over the 10-year Treasury and the Treasury's borrowing pace with its bill share. Types and plain-language readings,
 * pure and tested (moneyDesk.test.ts); drawing in moneyDeskView.ts.
 */

export interface Funding {
  date: string;
  sofr: number | null;
  iorb: number;
  spreadBp: number;
  spreadPct: number | null;
  dispersionBp: number;
  dispersionPct: number | null;
  high30Bp: number;
  from: string;
  days: number;
  /** month-end = SOFR above IORB at an unusual level, but in the days around a month-end when that is normal. */
  reading: 'tight' | 'month-end' | 'calm';
  series: { date: string; spreadBp: number; dispersionBp: number }[];
}
export interface Mortgage {
  date: string;
  mortgage: number;
  tenYear: number;
  spreadBp: number;
  percentile: number | null;
  medianBp: number;
  yearAgoBp: number | null;
  from: string;
  weeks: number;
  series: { date: string; spreadBp: number }[];
}
export interface Supply {
  date: string;
  heldByPublic: number;
  change30: number | null;
  change91: number | null;
  change365: number | null;
  pacePerYear: number | null;
  billShare: number | null;
  billShareNew3m: number | null;
  billShareNew12m: number | null;
  mspdDate: string | null;
}
export interface MoneyReply {
  funding: Funding | null;
  mortgage: Mortgage | null;
  supply: Supply | null;
  notes: string[];
  sources: Record<'funding' | 'mortgage' | 'supply', { name: string; url: string }>;
}

/** The range Treasury's borrowing advisers (TBAC) have pointed to for bills' share of marketable debt over time. */
export const TBAC_BILLS = [0.15, 0.2] as const;

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
export const yearOf = (iso: string) => iso.slice(0, 4);
export const pct0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);
const ord = (n: number) => {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? 'th' : r % 10 === 1 ? 'st' : r % 10 === 2 ? 'nd' : r % 10 === 3 ? 'rd' : 'th';
  return `${r}${s}`;
};

/** "+5 bp" / "−1 bp". */
export function bp(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} bp`;
}

/** Billions or trillions of dollars from a figure in billions. */
export function bn(v: number | null | undefined): string {
  if (!ok(v)) return '—';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return a >= 1000 ? `${sign}$${(a / 1000).toFixed(2)} trillion` : `${sign}$${Math.round(a)} billion`;
}

export function fundingWords(f: Funding): string {
  const rel = Math.round(f.spreadBp) === 0 ? 'about the same as' : f.spreadBp > 0 ? `${Math.abs(Math.round(f.spreadBp))} bp more than` : `${Math.abs(Math.round(f.spreadBp))} bp less than`;
  const base = `Overnight money backed by Treasuries (SOFR ${ok(f.sofr) ? `${f.sofr.toFixed(2)}%` : '—'}) costs ${rel} banks earn at the Fed (IORB ${f.iorb.toFixed(2)}%).`;
  if (f.reading === 'tight')
    return `${base} That is higher than on ${Math.round(f.spreadPct ?? 0)}% of days since ${yearOf(f.from)}: cash is getting scarce. Before a month- or quarter-end this is normal; on other days it is the warning repo desks watch.`;
  if (f.reading === 'month-end')
    return `${base} Higher than usual, but it is a month-end, when banks shrink their balance sheets and repo rates normally bump: not a warning on its own.`;
  return `${base} Calm: cash is plentiful.`;
}

export function mortgageWords(m: Mortgage): string {
  const vs = ok(m.percentile) ? `, more than on ${Math.round(m.percentile)}% of weeks since ${yearOf(m.from)}` : '';
  return `Homebuyers pay ${(m.spreadBp / 100).toFixed(2)} points over the 10-year Treasury (${m.mortgage.toFixed(2)}% vs ${m.tenYear.toFixed(2)}%)${vs}; the usual gap is ${(m.medianBp / 100).toFixed(2)} points.`;
}

export function supplyWords(s: Supply): string {
  const parts = [`The government added ${bn(s.change30)} of debt held by the public in the last 30 days`];
  if (ok(s.pacePerYear)) parts[0] += ` (${bn(s.pacePerYear)} a year at the last 3 months' pace)`;
  parts[0] += '.';
  if (ok(s.billShareNew3m) && ok(s.billShare))
    parts.push(
      `Bills were ${pct0(s.billShareNew3m)} of the new marketable debt in the last 3 months and are ${pct0(s.billShare)} of all of it; Treasury's advisers have pointed to roughly ${pct0(TBAC_BILLS[0])}–${pct0(TBAC_BILLS[1])} over time.`,
    );
  return parts.join(' ');
}

/** A bill share outside the advisers' range, in words for the headline ('' inside it). */
export function billShareFlag(s: Supply): string {
  if (!ok(s.billShare)) return '';
  if (s.billShare > TBAC_BILLS[1]) return `Bills are ${pct0(s.billShare)} of marketable debt, above the ${pct0(TBAC_BILLS[0])}–${pct0(TBAC_BILLS[1])} range: more borrowing is short-term.`;
  if (s.billShare < TBAC_BILLS[0]) return `Bills are ${pct0(s.billShare)} of marketable debt, below the ${pct0(TBAC_BILLS[0])}–${pct0(TBAC_BILLS[1])} range: more borrowing is long-term.`;
  return '';
}

/** Home "Edge today": only when overnight funding is tight (otherwise the card stays uncluttered). */
export function fundingEdgeLine(d: MoneyReply | null) {
  const f = d?.funding;
  if (!f || f.reading !== 'tight') return null;
  return {
    label: 'Overnight money is tight',
    value: bp(f.spreadBp),
    tone: 'down' as const,
    detail: `SOFR over the Fed's IORB, ${ord(f.spreadPct ?? 0)} percentile since ${yearOf(f.from)}`,
    href: '#invest/bonds/market',
    source: `NY Fed SOFR and Fed IORB via FRED, ${f.date}`,
  };
}

export { ord };
