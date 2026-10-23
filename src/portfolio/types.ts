/** Portfolios and the analysis the helper sends back (see helper/engine/quant.py). */

export const ASSET_CLASSES = ['US stocks', 'International stocks', 'Bonds', 'Real estate', 'Commodities', 'Cash', 'Crypto', 'Other'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
export type Rebalance = 'none' | 'monthly' | 'quarterly' | 'yearly';

export interface Holding {
  symbol: string;
  /** Target weight in percent. */
  weight: number;
  assetClass: AssetClass;
}

export interface Portfolio {
  id?: string;
  name: string;
  benchmark: string;
  rebalance: Rebalance;
  holdings: Holding[];
  /** Optional start date (YYYY-MM-DD) for performance, e.g. when a client account opened. */
  inception?: string;
  notes?: string;
}

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
  calendar: { year: number; portfolio: number; benchmark: number | null }[];
  growth: Point[];
  benchmarkGrowth: Point[];
  drawdown: Point[];
  benchmarkDrawdown: Point[];
  stress: { name: string; start: string; end: string; portfolio: number | null; benchmark: number | null }[];
  assets: { symbol: string; weight: number; riskContribution: number; cagr: number; volatility: number; last: number; dividends: boolean }[];
  correlation: number[][];
  monteCarlo: { years: number; percentiles: Record<'5' | '25' | '50' | '75' | '95', number[]>; lossChance: number } | null;
}

export interface Optimisation {
  method: string;
  start: string;
  riskFree: number;
  symbols: string[];
  weights: number[];
  current: number[];
  expectedReturns: number[];
  volatilities: number[];
  result: { return: number; volatility: number; sharpe: number | null };
  currentResult: { return: number; volatility: number; sharpe: number | null };
  frontier: { return: number; volatility: number }[];
  converged: boolean;
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

export function holdingsPayload(p: Portfolio) {
  return p.holdings.filter((h) => h.symbol.trim() && h.weight > 0).map((h) => ({ symbol: h.symbol.trim().toUpperCase(), weight: h.weight }));
}
