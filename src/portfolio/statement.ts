/**
 * Reads a brokerage positions export (Schwab, Fidelity, Vanguard, Robinhood, Webull, ...) into holdings with cost basis.
 * Columns are matched by their headings; the owner can correct the match in the import preview.
 */
import { parseMoney } from '../invest/holdings';

export type StatementField = 'symbol' | 'name' | 'shares' | 'cost' | 'costPerShare' | 'value' | 'dividends' | 'account';

export const FIELD_LABELS: Record<StatementField, string> = {
  symbol: 'Symbol',
  name: 'Description',
  shares: 'Shares / quantity',
  cost: 'Cost basis (total)',
  costPerShare: 'Cost per share',
  value: 'Market value',
  dividends: 'Dividends received',
  account: 'Account',
};

export type Columns = Partial<Record<StatementField, number>>;

export interface Position {
  symbol: string;
  name?: string;
  shares: number;
  /** Total cost basis in dollars. */
  cost?: number;
  value?: number;
  /** Dividends received so far (when the export has such a column). */
  dividends?: number;
  /** Cash or a money-market fund (kept as a cash amount, not shares). */
  cash?: boolean;
}

/** Heading patterns, most specific first; headings about changes, gains or percentages never match. */
const HEADINGS: [StatementField, RegExp][] = [
  ['dividends', /^(total )?dividends?( income)?( received| paid| earned)?( \(\$\))?$|^income earned$/i],
  ['costPerShare', /(avg|average|unit|per[- ]share|\/ ?share).*cost|cost.*(per[- ]share|\/ ?share)|(avg|average).*price/i],
  ['cost', /(cost basis|total cost|book value|^cost$|\bcost\b)/i],
  ['value', /(market value|mkt val|current value|total value|^value$|^equity$|ending value|\bvalue\b)/i],
  ['shares', /(qty|quantity|shares|units)/i],
  ['symbol', /(symbol|ticker|instrument)/i],
  ['account', /^account( name| number| #)?$|^acct\b/i],
  ['name', /(description|investment name|security name|security description|^name$|^security$)/i],
];
const NEVER = /(gain|loss|chng|change|%|percent|day'?s|today|ratio|reinvest|price chng)/i;

export function mapStatementColumns(headers: string[]): Columns {
  const out: Columns = {};
  const used = new Set<number>();
  for (const [field, rx] of HEADINGS) {
    const idx = headers.findIndex((raw, i) => {
      const h = raw.trim();
      return !used.has(i) && rx.test(h) && !NEVER.test(h);
    });
    if (idx >= 0) {
      out[field] = idx;
      used.add(idx);
    }
  }
  return out;
}

/** The heading row: the first row with both a symbol and a quantity column. */
export function findHeader(rows: string[][]): number {
  return rows.findIndex((r) => {
    const c = mapStatementColumns(r);
    return c.symbol != null && c.shares != null;
  });
}

const MONEY_MARKET = /^(SPAXX|FDRXX|FZFXX|SPRXX|FCASH|CORE|SWVXX|SNVXX|SNOXX|SWYXX|VMFXX|VMRXX|VUSXX|QACDS)$/;
const CASH_TEXT = /(cash|money market|sweep|core position|fdic|bank deposit)/i;
const TICKER = /^[A-Z][A-Z0-9.\-/]{0,9}$/;

/** Turns the rows under the heading into positions; one row per symbol (accounts are added together). */
export function rowsToPositions(rows: string[][], headerAt: number, columns: Columns): Position[] {
  const get = (r: string[], f: StatementField) => (columns[f] == null ? '' : (r[columns[f]!] ?? '').trim());
  const bySymbol = new Map<string, Position>();
  let cash = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const rawSymbol = get(r, 'symbol');
    const name = get(r, 'name');
    if (/^(account )?total|grand total|^pending|^subtotal/i.test(rawSymbol) || /^(account )?total\b/i.test(name)) continue;
    const symbol = rawSymbol.replace(/\*+$/, '').replace(/^\$/, '').trim().toUpperCase();
    const value = parseMoney(get(r, 'value'));
    if (MONEY_MARKET.test(symbol) || (CASH_TEXT.test(rawSymbol) && !TICKER.test(symbol)) || (!symbol && CASH_TEXT.test(name)) || (/\*\*$/.test(rawSymbol) && CASH_TEXT.test(name))) {
      // Cash rows usually show "--" for quantity; use the value (or the quantity, which equals dollars for money funds).
      cash += value ?? parseMoney(get(r, 'shares')) ?? 0;
      continue;
    }
    if (!TICKER.test(symbol)) continue; // notes, disclaimers, options legs with spaces, blank lines
    const shares = parseMoney(get(r, 'shares'));
    if (shares == null || shares <= 0) continue;
    const total = parseMoney(get(r, 'cost'));
    let cost = total != null && total > 0 ? total : undefined; // "0" or negative cost is a blank, not free shares
    const perShare = parseMoney(get(r, 'costPerShare'));
    if (cost == null && perShare != null && perShare > 0) cost = perShare * shares;
    const divs = parseMoney(get(r, 'dividends'));
    const dividends = divs != null && divs >= 0 ? divs : undefined;
    const prev = bySymbol.get(symbol);
    if (prev) {
      prev.shares += shares;
      prev.dividends = prev.dividends != null || dividends != null ? (prev.dividends ?? 0) + (dividends ?? 0) : undefined;
      prev.cost = prev.cost != null || cost != null ? (prev.cost ?? 0) + (cost ?? 0) : undefined;
      prev.value = prev.value != null || value != null ? (prev.value ?? 0) + (value ?? 0) : undefined;
    } else bySymbol.set(symbol, { symbol, name: name && name !== '--' ? name : undefined, shares, cost, value: value ?? undefined, ...(dividends != null ? { dividends } : {}) });
  }
  const out: Position[] = [...bySymbol.values()].map((p) => ({ ...p, shares: +p.shares.toFixed(6), cost: p.cost != null ? +p.cost.toFixed(2) : undefined }));
  if (cash > 0) out.push({ symbol: 'CASH', name: 'Cash & money market', shares: 0, value: +cash.toFixed(2), cash: true });
  return out;
}

/** Finds the table and reads it. `columns` overrides the detected match (from the preview). */
export function parseStatement(rows: string[][], columns?: Columns) {
  const headerAt = findHeader(rows);
  if (headerAt < 0) return { headerAt, headers: [] as string[], columns: {} as Columns, positions: [] as Position[] };
  const headers = rows[headerAt].map((h) => h.trim());
  const cols = columns ?? mapStatementColumns(headers);
  return { headerAt, headers, columns: cols, positions: rowsToPositions(rows, headerAt, cols) };
}

/** Rows from the AI's JSON reading of a PDF statement, in the same shape as a spreadsheet. */
export function jsonToRows(text: string): string[][] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('The AI did not return a positions table.');
  const list = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[];
  const s = (v: unknown) => (v == null ? '' : String(v));
  return [['Symbol', 'Description', 'Quantity', 'Cost Basis', 'Market Value'], ...list.map((x) => [s(x.symbol), s(x.name), s(x.shares), s(x.costBasis), s(x.marketValue)])];
}
