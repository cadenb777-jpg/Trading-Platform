/**
 * Index futures fair value (helper futures.carry): types and the plain-language readings the Futures page and the
 * morning brief show. Pure and tested in fairValue.test.ts; the maths itself is in helper/engine/carry.py.
 */

export interface CarryContract {
  code: string;
  symbol: string;
  expiry: string;
  days: number;
  price: number | null;
}

export interface CarryRow {
  root: string;
  index: string;
  indexName: string;
  etf: string;
  spot: number | null;
  spotAt: number | null;
  mult: number;
  contract: CarryContract | null;
  next: CarryContract | null;
  cashOpen: boolean;
  divYield: number | null;
  fairValue: number | null;
  fairPremium: number | null;
  basis: number | null;
  mispricing: number | null;
  mispricingUsd: number | null;
  impliedRate: number | null;
  spreadBp: number | null;
  impliedOpen: number | null;
  impliedOpenChange: number | null;
  roll: { days: number; fairSpread: number; spread: number; rich: number; richUsd: number; impliedRate: number | null } | null;
  why?: string;
}

export interface Envelope {
  value: number;
  source: string;
  sourceName: string;
  asOf: string | number | null;
}

export interface Carry {
  rows: CarryRow[];
  cashOpen: boolean;
  session: 'open' | 'extended' | 'closed';
  asOf: number;
  rate: Envelope | null;
  sofrFutures: { contract: string; rate: number | null };
  yields: Record<string, Envelope | null>;
  errors: string[];
}

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** "+0.42%" (2 decimals: an implied open is read in hundredths). */
export function signedPct(v: number | null | undefined, digits = 2): string {
  if (!ok(v)) return '—';
  const t = (v * 100).toFixed(digits);
  return `${Number(t) > 0 ? '+' : ''}${Number(t) === 0 ? (0).toFixed(digits) : t}%`;
}

/** Index points with sign: "+1.30 pts". */
export function signedPts(v: number | null | undefined, digits = 2): string {
  if (!ok(v)) return '—';
  const t = v.toFixed(digits);
  return `${Number(t) > 0 ? '+' : ''}${Number(t) === 0 ? (0).toFixed(digits) : t} pts`;
}

/** Whole dollars with sign: "+$65". */
export function signedUsd(v: number | null | undefined): string {
  if (!ok(v)) return '—';
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}$${Math.abs(r).toLocaleString('en-US')}`;
}

/** Basis points with sign: "+22 bp". */
export function signedBp(v: number | null | undefined): string {
  if (!ok(v)) return '—';
  const r = Math.round(v);
  return `${r > 0 ? '+' : ''}${r} bp`;
}

export function level(v: number | null | undefined): string {
  return ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

export type Tone = 'up' | 'down' | '';
const toneOf = (v: number | null | undefined): Tone => (!ok(v) || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');

/** The one figure a tile leads with. Cash market shut: where the index is set to open. Open: futures against fair value. */
export function headline(r: CarryRow): { label: string; value: string; tone: Tone; detail: string } {
  if (!r.cashOpen) {
    return ok(r.impliedOpenChange)
      ? { label: 'Implied open', value: signedPct(r.impliedOpenChange), tone: toneOf(r.impliedOpenChange), detail: `${level(r.impliedOpen)} vs ${level(r.spot)} close` }
      : { label: 'Implied open', value: '—', tone: '', detail: r.why ?? 'Needs a futures price, the index close and a fair value.' };
  }
  return ok(r.mispricing)
    ? { label: 'Futures vs fair value', value: signedPts(r.mispricing), tone: '', detail: `${signedUsd(r.mispricingUsd)} a contract · financing ${signedBp(r.spreadBp)} over SOFR` }
    : { label: 'Futures vs fair value', value: '—', tone: '', detail: r.why ?? 'Needs a futures price, the index and a fair value.' };
}

/** One sentence explaining what the reading means, for the tile's tooltip and the screen reader. */
export function reading(r: CarryRow): string {
  if (!r.cashOpen && ok(r.impliedOpenChange) && ok(r.fairPremium) && r.contract?.price != null) {
    const dir = r.impliedOpenChange > 0 ? 'higher' : r.impliedOpenChange < 0 ? 'lower' : 'unchanged';
    const by = dir === 'unchanged' ? '' : ` by ${(Math.abs(r.impliedOpenChange) * 100).toFixed(2)}%`;
    return `${r.contract.code} at ${level(r.contract.price)}, less its fair premium of ${level(r.fairPremium)} points, points to the ${r.indexName} opening ${dir}${by}.`;
  }
  if (r.cashOpen && ok(r.mispricing) && ok(r.impliedRate)) {
    const side = r.mispricing > 0 ? 'above' : r.mispricing < 0 ? 'below' : 'at';
    return `${r.contract?.code} trades ${side} its fair value${side === 'at' ? '' : ` by ${Math.abs(r.mispricing).toFixed(2)} points`}: buyers are paying ${(r.impliedRate * 100).toFixed(2)}% a year to hold the index through futures.`;
  }
  return r.why ?? 'Not enough data for a reading yet.';
}

/** The roll in words: "H27 is 7.58 pts dear vs fair (+$379 a contract)". */
export function rollText(r: CarryRow): string {
  if (!r.roll || !r.next) return '—';
  const word = r.roll.rich > 0 ? 'dear' : r.roll.rich < 0 ? 'cheap' : 'fair';
  return `${r.next.code}: ${Math.abs(r.roll.rich).toFixed(2)} pts ${word} (${signedUsd(r.roll.richUsd)} a contract)`;
}

/** The morning brief's line: the S&P 500's implied open while the cash market is shut, else nothing. */
export function briefLine(c: Carry | null): { text: string; tone: Tone } | null {
  const es = c?.rows.find((r) => r.root === 'ES');
  if (!es || es.cashOpen || !ok(es.impliedOpenChange)) return null;
  return { text: `S&P 500 implied open ${signedPct(es.impliedOpenChange)}`, tone: toneOf(es.impliedOpenChange) };
}

/** The roll for a table cell: "H27 +7.58 pts" (dear when +, cheap when -); rollText() is its tooltip. */
export function rollShort(r: CarryRow): string {
  if (!r.roll || !r.next) return '—';
  return `${r.next.code.slice(-3)} ${signedPts(r.roll.rich)}`;
}
