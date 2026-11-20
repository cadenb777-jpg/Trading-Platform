/**
 * YCharts (the owner's paid API key, Settings > Data connections > YCharts): the helper's ycharts.* requests
 * (engine/ycharts.py). Used by the security overview (a YCharts panel for stocks, ETFs and mutual funds) and the
 * YCharts explorer page (any metric of any company, fund, index or economic indicator, as a chart and table).
 *
 * The metric codes below are YCharts' names as its own pages and sample clients use them; YCharts' full list is in its
 * API documentation (behind its login). A code the owner's plan doesn't include comes back as an error for that metric
 * and is listed as not available, never estimated.
 */
import { engineRequest } from './schwab';

export const YCHARTS_HELPER_VERSION = 95;

export type YKind = 'companies' | 'mutual_funds' | 'indices' | 'indicators';

export interface YPoint {
  value: number | string | null;
  date: string | null;
  error: string | null;
}
export interface YPoints {
  kind: YKind;
  results: Record<string, Record<string, YPoint>>;
  fetched: string;
}
export interface YSeries {
  kind: YKind;
  results: Record<string, Record<string, { points: [string, number][]; error: string | null }>>;
  fetched: string;
}

export type YFormat = 'money' | 'pct' | 'x' | 'num' | 'price';
export interface YMetric {
  code: string;
  label: string;
  format: YFormat;
  group: string;
}

const m = (group: string, list: [string, string, YFormat][]): YMetric[] => list.map(([code, label, format]) => ({ code, label, format, group }));

/** Company (and ETF) metrics shown on the overview when the plan has them. */
export const COMPANY_METRICS: YMetric[] = [
  ...m('Valuation', [
    ['market_cap', 'Market cap', 'money'],
    ['enterprise_value', 'Enterprise value', 'money'],
    ['pe_ratio', 'P/E', 'x'],
    ['forward_pe_ratio', 'Forward P/E', 'x'],
    ['peg_ratio', 'PEG', 'x'],
    ['ps_ratio', 'Price / sales', 'x'],
    ['price_to_book_value', 'Price / book', 'x'],
    ['ev_ebitda', 'EV / EBITDA', 'x'],
    ['dividend_yield', 'Dividend yield', 'pct'],
    ['payout_ratio', 'Payout ratio', 'pct'],
  ]),
  ...m('Profitability', [
    ['gross_profit_margin', 'Gross margin', 'pct'],
    ['operating_margin', 'Operating margin', 'pct'],
    ['profit_margin', 'Net margin', 'pct'],
    ['return_on_equity', 'Return on equity', 'pct'],
    ['return_on_assets', 'Return on assets', 'pct'],
    ['return_on_invested_capital', 'Return on invested capital', 'pct'],
  ]),
  ...m('Size and growth', [
    ['revenues', 'Revenue (quarter)', 'money'],
    ['net_income', 'Net income (quarter)', 'money'],
    ['eps', 'EPS (quarter)', 'price'],
    ['free_cash_flow', 'Free cash flow (quarter)', 'money'],
    ['shares_outstanding', 'Shares outstanding', 'num'],
  ]),
  ...m('Risk and balance sheet', [
    ['beta', 'Beta', 'num'],
    ['current_ratio', 'Current ratio', 'num'],
    ['debt_equity_ratio', 'Debt / equity', 'num'],
    ['short_interest', 'Short interest (shares)', 'num'],
  ]),
];

/** Mutual fund metrics (ids are M:TICKER). */
export const FUND_METRICS: YMetric[] = [
  ...m('Fund', [
    ['nav', 'NAV', 'price'],
    ['net_assets', 'Net assets', 'money'],
    ['net_expense_ratio', 'Net expense ratio', 'pct'],
    ['gross_expense_ratio', 'Gross expense ratio', 'pct'],
    ['turnover_ratio', 'Turnover', 'pct'],
    ['distribution_yield', 'Distribution yield', 'pct'],
  ]),
  ...m('Returns and risk', [
    ['total_return_1y', 'Total return 1 year', 'pct'],
    ['total_return_3y', 'Total return 3 years (a year)', 'pct'],
    ['total_return_5y', 'Total return 5 years (a year)', 'pct'],
    ['standard_deviation_3y', 'Standard deviation 3 years', 'pct'],
    ['sharpe_ratio_3y', 'Sharpe ratio 3 years', 'num'],
    ['max_drawdown_5y', 'Max drawdown 5 years', 'pct'],
  ]),
];

/** Examples for the explorer (any code YCharts has can be typed). */
export const EXAMPLES: Record<YKind, { id: string; metrics: string[] }> = {
  companies: { id: 'AAPL', metrics: ['price', 'pe_ratio', 'market_cap', 'dividend_yield', 'revenues', 'profit_margin'] },
  mutual_funds: { id: 'M:VFIAX', metrics: ['nav', 'net_expense_ratio', 'net_assets', 'total_return_1y'] },
  indices: { id: '^SPX', metrics: ['level', 'pe_ratio', 'dividend_yield'] },
  indicators: { id: 'I:USCPI', metrics: ['value'] },
};

export const KIND_LABELS: Record<YKind, string> = { companies: 'Company or ETF', mutual_funds: 'Mutual fund', indices: 'Index', indicators: 'Economic indicator' };

/** YCharts id for a ticker: mutual funds are M:TICKER, indexes ^TICKER, everything else the ticker. */
export function ychartsId(symbol: string, kind: YKind): string {
  const s = symbol.replace(/^\$/, '').toUpperCase();
  if (kind === 'mutual_funds') return s.startsWith('M:') ? s : `M:${s}`;
  if (kind === 'indices') return s.startsWith('^') ? s : `^${s}`;
  return s;
}

/** A YCharts figure as text. Percent figures arrive in percent units (5.2 = 5.2%). */
export function yFormat(v: number | string | null | undefined, f: YFormat): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  switch (f) {
    case 'money':
      return abs >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : abs >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : abs >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    case 'pct':
      return `${v.toFixed(2)}%`;
    case 'x':
      return `${v.toFixed(1)}×`;
    case 'price':
      return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      return abs >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}

export const yPoints = (kind: YKind, ids: string[], metrics: string[], date?: string) =>
  engineRequest<YPoints>('ycharts.points', { kind, ids, metrics, ...(date ? { date } : {}) }, 45_000);
export const ySeries = (kind: YKind, ids: string[], metrics: string[], start?: string, end?: string) =>
  engineRequest<YSeries>('ycharts.series', { kind, ids, metrics, ...(start ? { start } : {}), ...(end ? { end } : {}) }, 60_000);
export const yStatus = () => engineRequest<{ ok: boolean; message: string }>('ycharts.status', {}, 30_000);

let keyKnown: Promise<boolean> | null = null;
/** Whether a YCharts key is saved (Settings), asked once per page load. */
export function ychartsKeySet(): Promise<boolean> {
  keyKnown ??= engineRequest<{ ychartsKeySet?: boolean }>('settings.get', {}, 15_000).then((s) => !!s.ychartsKeySet, () => false);
  return keyKnown;
}
