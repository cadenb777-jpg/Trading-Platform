/**
 * The Account page's gain maths: price gain (value − cost basis), dividends received and total return, per account
 * holding, per combined holding, per account and overall; plus the page's display choices (% / $ / both).
 * Pure (no DOM), tested in returns.test.ts.
 */

/** How the dividends-received figure was found (the helper's dividends.portfolio `received`). */
export type DividendMethod = 'entered' | 'statement' | 'purchase' | 'tracked' | 'none';

export interface Received {
  amount: number | null;
  method: DividendMethod;
  /** First day counted (YYYY-MM-DD): purchase date, first-seen date, or the entered figure's as-of date. */
  since: string | null;
  /** The owner's or statement's figure, and the estimated payments added after it. */
  base?: number | null;
  estimated?: number | null;
  firstSeen: string | null;
  payments: { exDate: string; perShare: number; shares: number; amount: number }[];
  note?: string;
}

export interface Gain {
  value: number | null;
  /** Cost basis, null when unknown. */
  cost: number | null;
  /** Unrealized price gain = value − cost (null without cost or value). */
  priceGain: number | null;
  priceGainPct: number | null;
  /** Dividends received (null when nothing is known). */
  dividends: number | null;
  /** Price gain + dividends, and that ÷ cost. Null without a cost basis. */
  total: number | null;
  totalPct: number | null;
}

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** One holding's (or account part's) gain. A cost of 0 counts as unknown (free shares would make % meaningless). */
export function gainOf(value: number | null | undefined, cost: number | null | undefined, dividends: number | null | undefined): Gain {
  const c = ok(cost) && cost > 0 ? cost : null;
  const v = ok(value) ? value : null;
  const d = ok(dividends) ? dividends : null;
  const priceGain = v != null && c != null ? v - c : null;
  const total = priceGain != null ? priceGain + (d ?? 0) : null;
  return { value: v, cost: c, priceGain, priceGainPct: priceGain != null ? priceGain / c! : null, dividends: d, total, totalPct: total != null ? total / c! : null };
}

/**
 * Adds gains up (a combined holding's accounts, an account's holdings, everything). Price gain, cost and the total
 * only count parts that have both a value and a cost, so $ and % agree; `dividends` counts every part that knows it.
 * `costCovered` = the share of value that has a cost basis (1 = every holding).
 */
export function sumGains(parts: Gain[]): Gain & { costCovered: number | null } {
  const priced = parts.filter((g) => g.priceGain != null);
  const cost = priced.length ? priced.reduce((s, g) => s + g.cost!, 0) : null;
  const priceGain = priced.length ? priced.reduce((s, g) => s + g.priceGain!, 0) : null;
  const known = parts.filter((g) => g.dividends != null);
  const dividends = known.length ? known.reduce((s, g) => s + g.dividends!, 0) : null;
  // the total (and its %) covers holdings with a cost basis only, so $ and % agree; `dividends` counts every holding
  const pricedDivs = priced.reduce((s, g) => s + (g.dividends ?? 0), 0);
  const total = priceGain != null ? priceGain + pricedDivs : null;
  const value = parts.some((g) => g.value != null) ? parts.reduce((s, g) => s + (g.value ?? 0), 0) : null;
  const pricedValue = priced.reduce((s, g) => s + g.value!, 0);
  return {
    value,
    cost,
    priceGain,
    priceGainPct: priceGain != null && cost ? priceGain / cost : null,
    dividends,
    total,
    totalPct: total != null && cost ? total / cost : null,
    costCovered: value ? pricedValue / value : null,
  };
}

const METHOD_TEXT: Record<DividendMethod, string> = {
  entered: 'you entered',
  statement: 'from your statement',
  purchase: 'since your purchase date, estimated',
  tracked: 'since first seen, estimated',
  none: 'not known',
};

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "since Oct 1, 2026, estimated", "you entered (to May 1, 2026) + estimated since", "not known". */
export function methodLabel(r: Pick<Received, 'method' | 'since' | 'estimated'> | null | undefined): string {
  if (!r) return 'not known';
  if (r.method === 'tracked' || r.method === 'purchase') return r.since ? `since ${shortDate(r.since)}, estimated` : METHOD_TEXT[r.method];
  if (r.method === 'entered' || r.method === 'statement') return `${METHOD_TEXT[r.method]}${r.since ? ` (to ${shortDate(r.since)})` : ''}${r.estimated ? ' + estimated since' : ''}`;
  return METHOD_TEXT.none;
}

/** One word for a mix of methods (combined holdings and totals): the method when all agree, else "mixed". */
export function methodOf(methods: DividendMethod[]): DividendMethod | 'mixed' {
  const set = new Set(methods.filter((m) => m !== 'none'));
  if (!set.size) return 'none';
  return set.size === 1 ? [...set][0] : 'mixed';
}

// ---------- display choices ----------

export type ShowAs = 'pct' | 'usd' | 'both';
export interface DisplayPrefs {
  /** Daily change. */
  day: ShowAs;
  /** Gain / loss and total return. */
  gain: ShowAs;
}
export const DEFAULT_PREFS: DisplayPrefs = { day: 'both', gain: 'both' };
export const PREFS_KEY = 'tp-account-display';
const SHOW: ShowAs[] = ['pct', 'usd', 'both'];

/** The saved choices, with anything missing or unknown falling back to the default (a storage error = defaults). */
export function readPrefs(storage: Pick<Storage, 'getItem'> | null | undefined): DisplayPrefs {
  try {
    const raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null') as Partial<DisplayPrefs> | null;
    const pick = (v: unknown, d: ShowAs) => (SHOW.includes(v as ShowAs) ? (v as ShowAs) : d);
    return { day: pick(raw?.day, DEFAULT_PREFS.day), gain: pick(raw?.gain, DEFAULT_PREFS.gain) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage: Pick<Storage, 'setItem'> | null | undefined, prefs: DisplayPrefs) {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* a per-device convenience only */
  }
}

const money = (v: number) => {
  const a = Math.abs(v);
  return a.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: a >= 1000 ? 0 : 2, minimumFractionDigits: a >= 1000 ? 0 : 2 });
};
export const signedUsd = (v: number) => `${v >= 0 ? '+' : '−'}${money(v)}`;
export const signedPct = (v: number, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits)}%`;

/** A change shown the chosen way: "+$12.30", "+1.25%" or "+$12.30 (+1.25%)"; "—" when the chosen part is unknown. */
export function showChange(usd: number | null | undefined, pct: number | null | undefined, as: ShowAs, digits = 2): string {
  const u = ok(usd) ? signedUsd(usd) : null;
  const p = ok(pct) ? signedPct(pct, digits) : null;
  if (as === 'usd') return u ?? '—';
  if (as === 'pct') return p ?? '—';
  if (u && p) return `${u} (${p})`;
  return u ?? p ?? '—';
}

/** Today's change and its % of yesterday's value from a list of (value, today's $ change) pairs. */
export function dayTotal(rows: { value: number | null; today: number | null }[]): { usd: number | null; pct: number | null } {
  const known = rows.filter((r) => r.today != null && r.value != null);
  if (!known.length) return { usd: null, pct: null };
  const usd = known.reduce((s, r) => s + r.today!, 0);
  const base = known.reduce((s, r) => s + r.value! - r.today!, 0);
  return { usd, pct: base > 0 ? usd / base : null };
}
