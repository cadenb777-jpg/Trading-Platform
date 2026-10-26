/** Portfolios and the analysis the helper sends back (see helper/engine/quant.py). */

export const ASSET_CLASSES = [
  'US stocks',
  'International stocks',
  'Bonds',
  'Real estate',
  'Commodities',
  'Cash',
  'Crypto',
  'Private credit',
  'Private real estate',
  'Private equity',
  'Infrastructure',
  'Hedge funds',
  'Other',
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
export type Rebalance = 'none' | 'monthly' | 'quarterly' | 'yearly';
/** How holdings are entered: target percentages, number of shares, or dollar amounts. */
export type EntryMode = 'weight' | 'shares' | 'dollars';
export type HoldingKind = 'security' | 'cash' | 'alt';

export const ALT_CLASSES: AssetClass[] = ['Private credit', 'Private real estate', 'Private equity', 'Infrastructure', 'Hedge funds'];
/** How liquid each asset class usually is, for reports. */
export function liquidityOf(h: Pick<Holding, 'kind' | 'assetClass'>): 'Liquid' | 'Semi-liquid' | 'Illiquid' {
  if (h.kind === 'alt') return h.assetClass === 'Private equity' || h.assetClass === 'Infrastructure' ? 'Illiquid' : 'Semi-liquid';
  return 'Liquid';
}

/** Listed stand-ins used to model alternatives and cash in the performance maths (they have no daily prices). */
export const PROXIES: Partial<Record<AssetClass, string>> = {
  Cash: 'BIL',
  'Private credit': 'BIZD',
  'Private real estate': 'VNQ',
  'Private equity': 'PSP',
  Infrastructure: 'IGF',
  'Hedge funds': 'QAI',
};

export interface Holding {
  /** Ticker for securities; for cash and alternatives a short label (e.g. CASH, BCRED). */
  symbol: string;
  /** Target weight in percent (used when the portfolio is entered as percentages). */
  weight: number;
  assetClass: AssetClass;
  kind?: HoldingKind;
  /** Full name, e.g. "Blackstone Private Credit Fund" or "Schwab money market". */
  name?: string;
  /** Number of shares (shares mode, securities). */
  shares?: number;
  /** Dollar value: the amount in dollars mode, and always for cash and alternatives outside percent mode. */
  amount?: number;
  /** Total cost basis in dollars (optional), for unrealized gain. */
  cost?: number;
  /** Yearly income yield as a fraction (cash rate, fund distribution rate); securities use their dividend yield. */
  yield?: number;
  /** Listed stand-in for the performance maths (alternatives and cash); defaults by asset class. */
  proxy?: string;
  /** Private fund directory id (src/invest/catalog.ts) when the alternative is a known fund. */
  fundId?: string;
  /** Alternatives: commitment, paid in and distributions (for TVPI/DPI in reports). */
  commitment?: number;
  contributed?: number;
  distributed?: number;
  /** Date of the latest NAV / valuation for alternatives. */
  valueDate?: string;
  /** Share log kept by the helper at every save (first time seen, then each change in shares): dividends are
   * estimated from the first date. Never typed by the owner. */
  seen?: { date: string; shares: number }[];
  /** The owner's purchase date (YYYY-MM-DD), typed on the Account page; dividends are counted from it. */
  purchaseDate?: string;
  /** Dividends received in total (dollars), typed by the owner or read from a statement, as of dividendsAsOf. */
  dividends?: number;
  dividendsSource?: 'entered' | 'statement';
  dividendsAsOf?: string;
  /** The owner's return-of-capital share of the payouts (0.4 = 40%), from a 1099-DIV box 3 or the fund's 19(a)
   * notices, and the year it describes. Never estimated. */
  rocPct?: number;
  rocYear?: string;
}

export interface Portfolio {
  id?: string;
  name: string;
  benchmark: string;
  rebalance: Rebalance;
  /** How holdings are entered (default: percentages). */
  mode?: EntryMode;
  holdings: Holding[];
  /** Optional start date (YYYY-MM-DD) for performance, e.g. when a client account opened. */
  inception?: string;
  notes?: string;
  /** The owner's own account (shown on the Account page). Unset: true for portfolios synced from a live Webull account. */
  mine?: boolean;
  /** How the account is taxed, chosen on the Account page's Taxes section; unset = read from the name ("Roth", "IRA"). */
  taxType?: 'roth' | 'deferred' | 'taxable';
  /** Set by the helper's Webull sync. */
  webullAccount?: string;
  webullEnv?: 'test' | 'live';
  /** Webull's account class at the last sync (e.g. ROTH_IRA), for the Taxes section. */
  webullClass?: string;
  syncedAt?: string;
}

/** Whether a portfolio is one of the owner's own accounts (client portfolios are not). */
export const isMine = (p: Portfolio) => p.mine ?? (!!p.webullAccount && (p.webullEnv ?? 'live') === 'live');

export interface Point {
  time: string;
  value: number;
}

export interface PortfolioStats {
  cagr: number;
  totalReturn: number;
  volatility: number;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number;
  peak: string;
  trough: string;
  recovered: string | null;
  calmar: number | null;
  beta: number | null;
  alpha: number;
  correlation: number;
  trackingError: number;
  informationRatio: number | null;
  var95: number;
  cvar95: number;
  bestDay: number;
  worstDay: number;
  bestMonth: number | null;
  worstMonth: number | null;
  positiveMonths: number | null;
}

export type PeriodKey = 'ytd' | '1y' | '3y' | '5y' | '10y' | 'inception';

/** An RIA advisory fee: tiers like tax brackets (each rate applies to the part of the account inside its tier),
 * debited from the account each billing period, in arrears (period-end value) or in advance (period-start value). */
export interface FeeSchedule {
  tiers: { upTo: number | null; rate: number }[];
  billing: 'monthly' | 'quarterly' | 'annual';
  timing: 'arrears' | 'advance';
}

/** "1.00% on the first $1,000,000, 0.75% above; billed quarterly in arrears". */
export function describeFees(f: FeeSchedule): string {
  const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  // 0% tiers stay: "0% on the first $1M" is a real band (and a capped top tier reads "0.00% above ...").
  const tiers = [...f.tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const parts = tiers.map((t, i) => {
    const rate = `${(t.rate * 100).toFixed(2)}%`;
    if (tiers.length === 1) return `${rate} a year`;
    if (i === 0) return `${rate} on the first ${money(t.upTo ?? 0)}`;
    const prev = tiers[i - 1].upTo ?? 0;
    return t.upTo == null ? `${rate} above ${money(prev)}` : `${rate} from ${money(prev)} to ${money(t.upTo)}`;
  });
  const billed = { monthly: 'monthly', quarterly: 'quarterly', annual: 'annually' }[f.billing] ?? f.billing;
  return `${parts.join(', ')}; billed ${billed} in ${f.timing}`;
}

export interface Analysis {
  symbols: string[];
  benchmark: string;
  rebalance: Rebalance;
  /** Yearly advisory fee taken out of returns. */
  fee: number;
  /** True when every holding includes reinvested dividends. */
  totalReturn: boolean;
  /** Holdings without dividend data (price-only returns). */
  priceOnly: string[];
  start: string;
  end: string;
  riskFree: number;
  stats: PortfolioStats;
  benchmarkStats: PortfolioStats;
  trailing: Record<PeriodKey, { portfolio: number | null; benchmark: number | null }>;
  calendar: { year: number; portfolio: number; benchmark: number | null; gross?: number | null }[];
  /** Returns before fees (only when a fee was applied). */
  gross?: { trailing: Record<PeriodKey, number | null>; stats: PortfolioStats } | null;
  /** RIA billing results: fees debited per calendar year, total and effective yearly rate. */
  fees?: { byYear: { year: number; fees: number; averageValue: number; rate: number | null }[]; total: number; initial: number; effectiveRate: number | null; endValueGross: number; endValueNet: number | null } | null;
  feeSchedule?: FeeSchedule | null;
  growth: Point[];
  benchmarkGrowth: Point[];
  drawdown: Point[];
  benchmarkDrawdown: Point[];
  stress: { name: string; start: string; end: string; portfolio: number | null; benchmark: number | null }[];
  assets: { symbol: string; weight: number; riskContribution: number; cagr: number; volatility: number; last: number; dividends: boolean }[];
  correlation: number[][];
  monteCarlo: { years: number; percentiles: Record<'5' | '25' | '50' | '75' | '95', number[]>; lossChance: number } | null;
}

export interface WalkForwardRow {
  key: 'current' | 'equal' | 'min_var' | 'risk_parity' | 'growth';
  return: number;
  volatility: number;
  maxDrawdown: number;
  sharpe: number | null;
  /** Share of the portfolio traded per year. */
  turnover: number;
}

export interface Optimisation {
  method: 'risk_parity' | 'min_var' | 'growth' | 'black_litterman';
  start: string;
  end: string;
  riskFree: number;
  symbols: string[];
  /** Symbols that stand in for cash (e.g. BIL). */
  cash: string[];
  keepCash: boolean;
  weights: number[];
  current: number[];
  volatility: { current: number; suggested: number };
  walkForward: { windowYears: number; days: number; rows: WalkForwardRow[] } | null;
  /** How often shuffled histories gave the method at least its real out-of-sample Sharpe edge over the current portfolio. */
  randomWalk: { method: string; runs: number; edge: number; p: number } | null;
}

export const PERIOD_LABELS: [PeriodKey, string][] = [
  ['ytd', 'YTD'],
  ['1y', '1 year'],
  ['3y', '3 years'],
  ['5y', '5 years'],
  ['10y', '10 years'],
  ['inception', 'Since inception'],
];

export const TEMPLATES: Portfolio[] = [
  {
    name: 'Classic 60/40',
    benchmark: 'SPY',
    rebalance: 'quarterly',
    holdings: [
      { symbol: 'VTI', weight: 45, assetClass: 'US stocks' },
      { symbol: 'VXUS', weight: 15, assetClass: 'International stocks' },
      { symbol: 'BND', weight: 40, assetClass: 'Bonds' },
    ],
  },
  {
    name: 'All-weather style',
    benchmark: 'SPY',
    rebalance: 'quarterly',
    holdings: [
      { symbol: 'VTI', weight: 30, assetClass: 'US stocks' },
      { symbol: 'TLT', weight: 40, assetClass: 'Bonds' },
      { symbol: 'IEF', weight: 15, assetClass: 'Bonds' },
      { symbol: 'GLD', weight: 7.5, assetClass: 'Commodities' },
      { symbol: 'DBC', weight: 7.5, assetClass: 'Commodities' },
    ],
  },
  {
    name: 'Growth (90/10)',
    benchmark: 'SPY',
    rebalance: 'yearly',
    holdings: [
      { symbol: 'VTI', weight: 65, assetClass: 'US stocks' },
      { symbol: 'VXUS', weight: 25, assetClass: 'International stocks' },
      { symbol: 'BND', weight: 10, assetClass: 'Bonds' },
    ],
  },
];

export const isCashOrAlt = (h: Holding) => h.kind === 'cash' || h.kind === 'alt';

/** The ticker used for a holding's price history: its own symbol, or a listed stand-in for cash and alternatives. */
export function analysisSymbol(h: Holding): string {
  if (isCashOrAlt(h)) return (h.proxy?.trim() || PROXIES[h.assetClass] || (h.kind === 'cash' ? 'BIL' : 'PSP')).toUpperCase();
  return h.symbol.trim().toUpperCase();
}

/** Market value of a holding in dollars (null in percent mode, or when a needed price is missing). */
export function holdingValue(p: Portfolio, h: Holding, prices: Record<string, number | null | undefined>): number | null {
  const mode = p.mode ?? 'weight';
  if (mode === 'weight') return null;
  if (isCashOrAlt(h) || mode === 'dollars') return h.amount ?? null;
  const price = prices[h.symbol.trim().toUpperCase()];
  return h.shares != null && price != null ? h.shares * price : null;
}

export interface Position {
  holding: Holding;
  value: number | null;
  /** Share of the portfolio, 0-1. */
  weight: number;
  price: number | null;
}

/** Each holding's value and weight. In percent mode weights come from the targets; otherwise from values. */
export function positions(p: Portfolio, prices: Record<string, number | null | undefined> = {}): { rows: Position[]; total: number | null } {
  const live = p.holdings.filter((h) => h.symbol.trim() || h.name?.trim());
  if ((p.mode ?? 'weight') === 'weight') {
    const sum = live.reduce((s, h) => s + (h.weight > 0 ? h.weight : 0), 0) || 1;
    return { rows: live.map((h) => ({ holding: h, value: null, weight: h.weight > 0 ? h.weight / sum : 0, price: prices[h.symbol.trim().toUpperCase()] ?? null })), total: null };
  }
  const values = live.map((h) => holdingValue(p, h, prices));
  const total = values.reduce<number>((s, v) => s + (v && v > 0 ? v : 0), 0);
  return {
    rows: live.map((h, i) => ({ holding: h, value: values[i], weight: total && values[i] ? Math.max(0, values[i]!) / total : 0, price: isCashOrAlt(h) ? null : (prices[h.symbol.trim().toUpperCase()] ?? null) })),
    total: total || null,
  };
}

/** Symbols whose live price is needed to value the portfolio (shares mode). */
export function pricedSymbols(p: Portfolio): string[] {
  return [...new Set(p.holdings.filter((h) => !isCashOrAlt(h) && h.symbol.trim()).map((h) => h.symbol.trim().toUpperCase()))];
}

/** Symbols in a shares-mode portfolio that have shares entered but no price yet (so they can't be valued). */
export function unpricedSymbols(p: Portfolio, prices: Record<string, number | null | undefined>): string[] {
  if ((p.mode ?? 'weight') !== 'shares') return [];
  return p.holdings.filter((h) => !isCashOrAlt(h) && h.symbol.trim() && (h.shares ?? 0) > 0 && prices[h.symbol.trim().toUpperCase()] == null).map((h) => h.symbol.trim().toUpperCase());
}

/** What the helper's portfolio maths needs: one weight per ticker (stand-ins merged, weights in percent). */
export function holdingsPayload(p: Portfolio, prices: Record<string, number | null | undefined> = {}) {
  const missing = unpricedSymbols(p, prices);
  // Without a price a holding would silently drop out and the rest (often just cash) would look like 100%.
  if (missing.length) throw new Error(`No live price for ${missing.join(', ')}, so the share amounts can't be valued. Check the helper is running and logged in to Schwab, then try again.`);
  const merged = new Map<string, number>();
  for (const r of positions(p, prices).rows) {
    if (r.weight <= 0) continue;
    const sym = analysisSymbol(r.holding);
    if (sym) merged.set(sym, (merged.get(sym) ?? 0) + r.weight * 100);
  }
  const cash = cashSymbols(p);
  return [...merged.entries()].map(([symbol, weight]) => ({ symbol, weight: +weight.toFixed(4), ...(cash.has(symbol) ? { cash: true } : {}) }));
}

/** Stand-in tickers that only carry cash (a stand-in also held as a real security isn't counted). */
function cashSymbols(p: Portfolio): Set<string> {
  const real = new Set(p.holdings.filter((h) => !isCashOrAlt(h)).map((h) => h.symbol.trim().toUpperCase()));
  return new Set(p.holdings.filter((h) => h.kind === 'cash').map(analysisSymbol).filter((s) => !real.has(s)));
}

/** How to show an analysis ticker: cash as "Cash" (not its stand-in, e.g. BIL), alternatives by name. */
export function holdingLabel(p: Portfolio, symbol: string): { label: string; note?: string } {
  if (cashSymbols(p).has(symbol)) return { label: 'Cash', note: symbol === 'BIL' ? 'modelled as T-bills (BIL)' : `modelled as ${symbol}` };
  const alts = p.holdings.filter((h) => h.kind === 'alt' && analysisSymbol(h) === symbol);
  if (alts.length && !p.holdings.some((h) => !isCashOrAlt(h) && h.symbol.trim().toUpperCase() === symbol)) return { label: alts.map((h) => h.name || h.symbol).join(' + '), note: `modelled as ${symbol}` };
  return { label: symbol };
}

/** Plain-language list of stand-ins used, for notes under results and in reports. */
export function proxyNotes(p: Portfolio): string[] {
  return p.holdings.filter(isCashOrAlt).map((h) => `${h.name || h.symbol} modelled with ${analysisSymbol(h)}`);
}
