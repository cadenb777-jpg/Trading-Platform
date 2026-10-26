/**
 * Account risk, sectors and taxes: the browser half (live weights and the helper's risk.account / tax.account
 * replies). The helper works out volatility, beta, value-at-risk and drawdown from daily closes
 * (helper/engine/risk.py); here the live prices turn them into today's dollars. Pure functions, tested.
 */
import { engineRequest } from '../data/schwab';

export interface SectorInfo {
  sector: string;
  fundType?: string | null;
  sic?: string;
  industry?: string;
  source: string;
}

export interface AssetRisk {
  volatility: number;
  beta: number | null;
  /** Share of the account's day-to-day swings that comes from this holding (they add up to 1). */
  riskShare: number;
  weight: number;
}

export interface RiskReport {
  total: number;
  sectors: Record<string, SectorInfo>;
  sectorNote: string | null;
  stats: {
    volatility: number;
    beta: number | null;
    /** 1-day 95% value-at-risk as a fraction of the measured part of the account. */
    var95: number;
    maxDrawdown: number;
    peak: string;
    trough: string;
    start: string;
    end: string;
    measured: number;
  } | null;
  assets: Record<string, AssetRisk>;
  /** Holdings without a year of daily prices (left out of the risk figures). */
  missing: string[];
  alts: string[];
  note: string | null;
}

export interface RiskInput {
  symbol: string;
  value: number;
  kind: 'security' | 'cash' | 'alt';
}

export const fetchRisk = (holdings: RiskInput[]) => engineRequest<RiskReport>('risk.account', { holdings }, 120000);

/** Warning lines: one stock above this share of the account, or one sector above SECTOR_LIMIT. */
export const STOCK_LIMIT = 0.2;
export const SECTOR_LIMIT = 0.35;
export const FUNDS = 'Funds';
export const CASH = 'Cash';
export const OTHER = 'Other';

export interface Concentration {
  /** Each position (not cash) as a share of the whole account, largest first. */
  weights: { symbol: string; value: number; weight: number }[];
  total: number;
  largest: { symbol: string; weight: number } | null;
  top5: number | null;
  /** 1 / Σ(position share²): 10 equal holdings = 10; one big holding pulls it toward 1. */
  effective: number | null;
}

/** Weights from live values. Cash counts in the total (it's part of the account) but isn't a holding. */
export function concentration(rows: RiskInput[]): Concentration {
  const sums = new Map<string, number>();
  let cash = 0;
  for (const r of rows) {
    if (!(r.value > 0)) continue;
    if (r.kind === 'cash') cash += r.value;
    else sums.set(r.symbol, (sums.get(r.symbol) ?? 0) + r.value);
  }
  const invested = [...sums.values()].reduce((a, b) => a + b, 0);
  const total = invested + cash;
  const weights = [...sums.entries()].map(([symbol, value]) => ({ symbol, value, weight: value / total })).sort((a, b) => b.value - a.value);
  if (!invested) return { weights: [], total, largest: null, top5: null, effective: null };
  return {
    weights,
    total,
    largest: { symbol: weights[0].symbol, weight: weights[0].weight },
    top5: weights.slice(0, 5).reduce((s, x) => s + x.weight, 0),
    effective: 1 / weights.reduce((s, x) => s + (x.value / invested) ** 2, 0),
  };
}

/** The group a holding is counted in: its sector, "Funds", "Cash", or "Other" when unknown (never guessed). */
export function groupOf(r: RiskInput, sectors: Record<string, SectorInfo>): string {
  if (r.kind === 'cash') return CASH;
  if (r.kind === 'alt') return OTHER;
  const s = sectors[r.symbol]?.sector;
  if (s === 'Fund') return FUNDS;
  return s || OTHER;
}

/** Value per sector group, largest first, with each one's share of the account and its symbols. */
export function sectorBreakdown(rows: RiskInput[], sectors: Record<string, SectorInfo>) {
  const out = new Map<string, { label: string; value: number; weight: number; symbols: string[] }>();
  let total = 0;
  for (const r of rows) {
    if (!(r.value > 0)) continue;
    total += r.value;
    const label = groupOf(r, sectors);
    const g = out.get(label) ?? out.set(label, { label, value: 0, weight: 0, symbols: [] }).get(label)!;
    g.value += r.value;
    if (!g.symbols.includes(r.symbol)) g.symbols.push(r.symbol);
  }
  for (const g of out.values()) g.weight = total ? g.value / total : 0;
  return [...out.values()].sort((a, b) => b.value - a.value);
}

/** Plain warnings: one stock (not a fund) above 20% of the account, or one real sector above 35%. */
export function warnings(rows: RiskInput[], sectors: Record<string, SectorInfo>): string[] {
  const c = concentration(rows);
  const out: string[] = [];
  for (const x of c.weights) {
    if (x.weight > STOCK_LIMIT && sectors[x.symbol]?.sector !== 'Fund' && !rows.some((r) => r.symbol === x.symbol && r.kind === 'alt'))
      out.push(`${x.symbol} is ${(x.weight * 100).toFixed(0)}% of this money: one company’s bad news would hit you hard. Many advisers keep a single stock under ${STOCK_LIMIT * 100}%.`);
  }
  for (const g of sectorBreakdown(rows, sectors)) {
    if (g.weight > SECTOR_LIMIT && ![FUNDS, CASH, OTHER].includes(g.label))
      out.push(`${g.label} is ${(g.weight * 100).toFixed(0)}% of this money: stocks in one industry tend to fall together. Above ${SECTOR_LIMIT * 100}% is a lot.`);
  }
  return out;
}

/**
 * "On a bad day (1 in 20) you could lose about $X": the helper's 1-day 95% value-at-risk (a fraction of the part it
 * could measure) times that part's live value. Holdings without a year of prices and alternatives aren't in it.
 */
export function varDollars(report: RiskReport, rows: RiskInput[]): number | null {
  if (!report.stats) return null;
  const measured = new Set([...Object.keys(report.assets)]);
  const live = rows.reduce((s, r) => s + (r.kind === 'cash' || (r.kind === 'security' && measured.has(r.symbol)) ? Math.max(0, r.value) : 0), 0);
  return report.stats.var95 > 0 ? report.stats.var95 * live : 0;
}

// ---------- taxes ----------

export type TaxType = 'roth' | 'deferred' | 'taxable';

export interface TaxRow {
  account: string;
  symbol: string;
  shares: number;
  value: number | null;
  cost: number | null;
  gain: number | null;
  /** short = every share bought in the last 31 days; mixed = some; unknown = no purchase date. */
  term: 'short' | 'mixed' | 'unknown';
  recentShares: number | null;
  harvest: boolean;
  /** Accounts where the same symbol was bought in the last 31 days (only for holdings at a loss). */
  washSale: string[];
}

export interface TaxReport {
  groups: { type: TaxType; label: string; meaning: string; value: number; accounts: string[] }[];
  taxable: TaxRow[];
  totals: { gain: number; loss: number; harvest: number; noCost: number };
  notAdvice: string;
  buysKnown: boolean;
  buysNote: string | null;
  buyDays: number;
}

export interface TaxAccountInput {
  name: string;
  taxType?: TaxType;
  /** Webull account id: its recent fills date some of the shares (short-term). */
  webullAccount?: string;
  holdings: { symbol: string; shares: number; value: number | null; cost: number | null; kind: string }[];
}

export const fetchTax = (accounts: TaxAccountInput[]) => engineRequest<TaxReport>('tax.account', { accounts }, 120000);

/** Same rule as the helper's tax.tax_type: the owner's choice, else the account's name. */
export function taxTypeOf(name: string, chosen?: string | null): TaxType {
  if (chosen === 'roth' || chosen === 'deferred' || chosen === 'taxable') return chosen;
  const n = name.toLowerCase();
  if (n.includes('roth')) return 'roth';
  if (['ira', '401', '403', 'sep', 'traditional', 'rollover', 'pension'].some((w) => n.includes(w))) return 'deferred';
  return 'taxable';
}

interface DividendLike {
  symbol: string;
  history12?: { month: string; amount: number }[];
  upcoming?: { exDate: string; payDate: string; perShare: number; exPassed: boolean }[];
}

/**
 * Estimated dividends this calendar year on the taxable shares: per-share payments already gone ex this year plus
 * the expected ones still to come before Dec 31 (from dividends.portfolio), times the shares in taxable accounts.
 * Assumes those shares were held all year, so it's an estimate.
 */
export function dividendsThisYear(holdings: DividendLike[], taxableShares: Record<string, number>, today = new Date()): number {
  const year = String(today.getUTCFullYear());
  let total = 0;
  for (const x of holdings) {
    const shares = taxableShares[x.symbol] ?? 0;
    if (!shares) continue;
    const past = (x.history12 ?? []).filter((m) => m.month.startsWith(year)).reduce((s, m) => s + m.amount, 0);
    const coming = (x.upcoming ?? []).filter((u) => !u.exPassed && u.exDate.startsWith(year) && u.payDate.startsWith(year)).reduce((s, u) => s + u.perShare, 0);
    total += (past + coming) * shares;
  }
  return total;
}
