/**
 * YCharts (the owner's paid API key, Settings > Data connections > YCharts): the helper's ycharts.* requests
 * (engine/ycharts.py). Used by the security overview (a YCharts panel for stocks, ETFs and mutual funds) and the
 * YCharts explorer page (any metric of any company, fund, index or economic indicator, as a chart and table).
 *
 * Where the data comes from: on Windows the owner's YCharts Excel add-in (the helper asks Excel in the background,
 * helper 98), elsewhere YCharts' web API with a key. The metric codes below were checked against YCharts' own Excel
 * reference sheet. The full catalog (thousands of codes) is not in this public repository: the owner loads their copy of
 * the reference sheet on the YCharts page and it stays in this browser. A code with no value is listed as missing,
 * never estimated.
 */
import { engineRequest } from './schwab';
import { xlsxRows } from '../ai/files';

export const YCHARTS_HELPER_VERSION = 95;
/** The Excel add-in route, calculations, holdings and the cross-check source. */
export const YCHARTS_EXCEL_HELPER_VERSION = 98;

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
    ['revenues_ttm', 'Revenue (TTM)', 'money'],
    ['net_income_cf_ttm', 'Net income (TTM)', 'money'],
    ['eps_ttm', 'EPS diluted (TTM)', 'price'],
    ['free_cash_flow_ttm', 'Free cash flow (TTM)', 'money'],
    ['shares_outstanding', 'Shares outstanding', 'num'],
    ['one_year_total_return', 'Total return, 1 year', 'pct'],
  ]),
  ...m('Risk and balance sheet', [
    ['market_beta_60_month', 'Beta (5 years)', 'num'],
    ['current_ratio', 'Current ratio', 'num'],
    ['debt_equity_ratio', 'Debt / equity', 'num'],
    ['short_interest', 'Short interest (shares)', 'num'],
    ['days_to_cover', 'Days to cover short', 'num'],
  ]),
];

/** ETF and closed-end fund metrics (plain tickers). */
export const ETF_METRICS: YMetric[] = [
  ...m('Fund', [
    ['net_asset_value', 'NAV', 'price'],
    ['discount_or_premium_to_nav', 'Premium / discount to NAV', 'pct'],
    ['assets_under_management', 'Assets (this share class)', 'money'],
    ['expense_ratio', 'Net expense ratio', 'pct'],
    ['gross_expense_ratio_generic', 'Gross expense ratio', 'pct'],
    ['distribution_yield', 'Distribution yield', 'pct'],
    ['dividend_yield', 'Dividend yield', 'pct'],
    ['turnover_ratio', 'Turnover', 'pct'],
  ]),
  ...m('Returns and risk', [
    ['one_year_total_return', 'Total return, 1 year', 'pct'],
    ['annualized_daily_three_year_total_return', 'Total return, 3 years (a year)', 'pct'],
    ['annualized_daily_five_year_total_return', 'Total return, 5 years (a year)', 'pct'],
    ['monthly_standard_deviation_annualized_3y', 'Volatility, 3 years', 'pct'],
    ['historical_sharpe_3y', 'Sharpe ratio, 3 years', 'num'],
    ['max_drawdown_5y', 'Max drawdown, 5 years', 'pct'],
  ]),
];

/** Mutual fund metrics (ids are M:TICKER). */
export const FUND_METRICS: YMetric[] = [
  ...m('Fund', [
    ['net_asset_value', 'NAV', 'price'],
    ['assets_under_management', 'Assets (this share class)', 'money'],
    ['expense_ratio', 'Net expense ratio', 'pct'],
    ['gross_expense_ratio_generic', 'Gross expense ratio', 'pct'],
    ['turnover_ratio', 'Turnover', 'pct'],
    ['distribution_yield', 'Distribution yield', 'pct'],
  ]),
  ...m('Returns and risk', [
    ['one_year_total_return', 'Total return, 1 year', 'pct'],
    ['annualized_daily_three_year_total_return', 'Total return, 3 years (a year)', 'pct'],
    ['annualized_daily_five_year_total_return', 'Total return, 5 years (a year)', 'pct'],
    ['monthly_standard_deviation_annualized_3y', 'Volatility, 3 years', 'pct'],
    ['historical_sharpe_3y', 'Sharpe ratio, 3 years', 'num'],
    ['max_drawdown_5y', 'Max drawdown, 5 years', 'pct'],
  ]),
];

/** Examples for the explorer (any code YCharts has can be typed). */
export const EXAMPLES: Record<YKind, { id: string; metrics: string[] }> = {
  companies: { id: 'AAPL', metrics: ['price', 'pe_ratio', 'market_cap', 'dividend_yield', 'revenues', 'profit_margin'] },
  mutual_funds: { id: 'M:VFIAX', metrics: ['net_asset_value', 'expense_ratio', 'assets_under_management', 'one_year_total_return'] },
  indices: { id: '^SPX', metrics: ['price', 'pe_ratio', 'dividend_yield'] },
  indicators: { id: 'I:USCPI', metrics: ['value'] }, // indicators have one value: the code is ignored
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

// Through Excel a first request may wait for Excel to start (up to a minute and a half), so the waits are long.
export const yPoints = (kind: YKind, ids: string[], metrics: string[], date?: string) =>
  engineRequest<YPoints>('ycharts.points', { kind, ids, metrics, ...(date ? { date } : {}) }, 240_000);
export const ySeries = (kind: YKind, ids: string[], metrics: string[], start?: string, end?: string, frequency?: string) =>
  engineRequest<YSeries>('ycharts.series', { kind, ids, metrics, ...(start ? { start } : {}), ...(end ? { end } : {}), ...(frequency ? { frequency } : {}) }, 300_000);
export const yStatus = () => engineRequest<{ ok: boolean; message: string }>('ycharts.status', {}, 240_000);
export const yCalc = (kind: YKind, ids: string[], metrics: string[], start: string, end: string | undefined, aggregate: string) =>
  engineRequest<{ results: Record<string, Record<string, YPoint>>; fetched: string }>('ycharts.calc', { kind, ids, metrics, start, ...(end ? { end } : {}), aggregate }, 300_000);
export const yHoldings = (symbol: string) =>
  engineRequest<{ holdings: { holding: string; weight: number | null }[]; fetched: string }>('ycharts.holdings', { symbol }, 300_000);

/** YCharts' resampling frequencies and calculations (its "YCS Parameter Options"), in plain words. */
export const FREQUENCIES: [string, string][] = [['', 'As reported'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
export const CALCULATIONS: [string, string][] = [
  ['pct_change', '% change over the period'], ['mean', 'Average'], ['median', 'Median'], ['max', 'Highest (and when)'],
  ['min', 'Lowest (and when)'], ['std', 'Standard deviation'], ['first', 'First value'], ['last', 'Last value'], ['sum', 'Sum'],
];

let readyKnown: Promise<{ ready: boolean; source: 'excel' | 'api' }> | null = null;
/** Whether YCharts can be asked: through the Excel add-in (Windows) or with a saved API key. Asked once per page load. */
export function ychartsReady(): Promise<{ ready: boolean; source: 'excel' | 'api' }> {
  readyKnown ??= engineRequest<{ ychartsKeySet?: boolean; ychartsSource?: 'excel' | 'api' }>('settings.get', {}, 15_000).then(
    (s) => ({ ready: s.ychartsSource === 'excel' || !!s.ychartsKeySet, source: s.ychartsSource ?? 'api' }),
    () => ({ ready: false, source: 'api' as const }),
  );
  return readyKnown;
}
/** Kept for older callers: true when YCharts can be asked. */
export const ychartsKeySet = () => ychartsReady().then((r) => r.ready);

// ---------- the owner's YCharts reference sheet (stays in this browser) ----------

export interface CatalogEntry {
  code: string;
  name: string;
  /** Company, ETF & CEF, Mutual Fund, Macroeconomic ... and Metrics or Info */
  group: string;
}
const CATALOG_KEY = 'tp-ycharts-catalog';

/** Metric codes and names from YCharts' Excel reference workbook: every sheet with a "Metric Code" column (pure, tested). */
export function catalogFromRows(sheets: { name: string; rows: string[][] }[]): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const sheet of sheets) {
    // client privacy: YCharts Portfolios and the user's account data are never offered (owner's rule)
    if (/portfolio|user info/i.test(sheet.name)) continue;
    const head = sheet.rows.findIndex((r) => r.some((c) => (c ?? '').trim() === 'Metric Code'));
    if (head < 0) continue;
    const ci = sheet.rows[head].findIndex((c) => (c ?? '').trim() === 'Metric Code');
    const ni = sheet.rows[head].findIndex((c) => (c ?? '').trim() === 'Metric Name');
    for (const r of sheet.rows.slice(head + 1)) {
      const code = (r[ci] ?? '').trim();
      if (/^[a-z0-9_]{1,80}$/.test(code)) out.push({ code, name: (r[ni >= 0 ? ni : 0] ?? code).trim(), group: sheet.name.trim() });
    }
  }
  return out;
}

export async function importCatalog(file: File): Promise<number> {
  const entries = catalogFromRows(await xlsxRows(await file.arrayBuffer()));
  if (!entries.length) throw new Error('No "Metric Code" column found: is this the YCharts Excel reference workbook?');
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(entries.map((e) => [e.code, e.name, e.group])));
  } catch {
    throw new Error('This browser could not keep the list (storage full or blocked).');
  }
  return entries.length;
}

export function loadCatalog(): CatalogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? '[]') as [string, string, string][];
    return raw.map(([code, name, group]) => ({ code, name, group }));
  } catch {
    return [];
  }
}

/** Catalog entries matching every word of `q` in the code, name or sheet, best first (pure, tested). */
export function searchCatalog(entries: CatalogEntry[], q: string, kindGroup?: string, limit = 40): CatalogEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = entries.filter((e) => {
    const t = `${e.code} ${e.name} ${e.group}`.toLowerCase();
    return words.every((w) => t.includes(w));
  });
  const score = (e: CatalogEntry) => (e.code === q ? 0 : 1) + (kindGroup && e.group.startsWith(kindGroup) ? 0 : 2) + e.name.length / 1000;
  const seen = new Set<string>();
  return hits.sort((a, b) => score(a) - score(b)).filter((e) => !seen.has(e.code) && seen.add(e.code)).slice(0, limit);
}

// ---------- YCharts woven into the platform's own panels (helper 99, Excel add-in) ----------

export const YCHARTS_PROFILE_HELPER_VERSION = 99;
export type YAsset = 'stock' | 'etf' | 'mutual_fund';
export interface YProfile {
  symbol: string;
  asset: YAsset;
  info: Record<string, string | number>;
  figures: Record<string, number | string>;
  fetched: string;
}

const profiles = new Map<string, Promise<YProfile | null>>();
/**
 * YCharts' facts about a stock, ETF or mutual fund, or null when YCharts can't be asked (no Excel add-in route, older
 * helper, or YCharts has nothing). Never throws: panels just keep their own data. One request per symbol per page load.
 */
export function yProfile(symbol: string, asset: YAsset, helperVersion: number): Promise<YProfile | null> {
  if (helperVersion < YCHARTS_PROFILE_HELPER_VERSION) return Promise.resolve(null);
  const key = `${asset}:${symbol.toUpperCase()}`;
  let p = profiles.get(key);
  if (!p) {
    p = ychartsReady()
      .then((r) => (r.ready && r.source === 'excel' ? engineRequest<YProfile>('ycharts.profile', { symbol, asset }, 240_000) : null))
      .catch(() => null);
    profiles.set(key, p);
  }
  return p;
}

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const yesNo = (v: unknown) => {
  const t = text(v).toLowerCase();
  return t === 'true' || t === 'yes' || t === 'y' || t === '1' ? 'Yes' : t === 'false' || t === 'no' || t === 'n' || t === '0' ? 'No' : text(v);
};

/** "Cupertino, CA, United States" from YCharts' headquarters fields (pure, tested). */
export function headquarters(info: Record<string, unknown>): string {
  return [info.hq_city, info.hq_state_province, info.hq_country].map(text).filter(Boolean).join(', ');
}

/** The fund facts YCharts adds to the fund profile, as [label, value, hint] rows; empty ones left out (pure, tested). */
export function fundFactRows(info: Record<string, unknown>): [string, string, string?][] {
  const style = text(info.equity_style) || text(info.fixed_income_style);
  const special = [yesNo(info.leveraged_fund) === 'Yes' ? 'leveraged' : '', yesNo(info.inverse_fund) === 'Yes' ? 'inverse' : ''].filter(Boolean);
  const rows: [string, string, string?][] = [
    ['Benchmark', text(info.prospectus_benchmark_index), 'The index the fund compares itself to in its prospectus'],
    ['Style', style, 'Morningstar-style box: size and value/growth for stocks, quality and duration for bonds'],
    ['Asset class', text(info.broad_asset_class)],
    ['Index fund', info.index_fund == null ? '' : yesNo(info.index_fund), 'Tracks an index instead of picking investments'],
    ['Leveraged / inverse', special.length ? `Yes: ${special.join(' and ')}` : '', 'Uses borrowing or bets against the index: meant for short holds'],
    ['Legal structure', text(info.legal_structure)],
    ['Share class', text(info.share_class)],
    ['Open to new investors', info.open_to_new_investors == null ? '' : yesNo(info.open_to_new_investors)],
    ['Pays out', text(info.dividend_frequency)],
    ['Next ex-dividend', text(info.next_ex_dividend_date)],
    ['Fee waiver ends', text(info.waiver_expiration_date), 'After this date the expense ratio can rise to the gross ratio'],
    ['Holdings as of', text(info.latest_holdings_date)],
  ];
  return rows.filter(([, v]) => v);
}
