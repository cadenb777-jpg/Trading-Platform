/**
 * Broker trade-history exports -> fills for the journal. One preset per broker (Webull, Schwab, TD Ameritrade,
 * Fidelity, Interactive Brokers Flex and Activity Statement, Robinhood, E*TRADE) plus a generic one; the format is
 * detected from the headings and the owner can correct the column match in the preview. Rows that aren't trades
 * (dividends, transfers, cancelled orders) are counted and skipped. Times without a zone are New York time.
 * Pure and tested (importers.test.ts); the helper dedupes and groups the fills (helper/engine/journal.py).
 */
import { parseMoney } from '../invest/holdings';

export type ImportField = 'date' | 'time' | 'symbol' | 'side' | 'qty' | 'price' | 'fees' | 'fees2' | 'orderId' | 'account' | 'description' | 'assetClass' | 'multiplier' | 'status' | 'openClose';

export const IMPORT_FIELDS: Record<ImportField, string> = {
  date: 'Date (or date and time)',
  time: 'Time',
  symbol: 'Symbol',
  side: 'Buy / sell',
  qty: 'Quantity',
  price: 'Price',
  fees: 'Fees / commission',
  fees2: 'Other fees',
  orderId: 'Order / trade id',
  account: 'Account',
  description: 'Description',
  assetClass: 'Asset class',
  multiplier: 'Multiplier',
  status: 'Status',
  openClose: 'Open / close',
};

export type ImportColumns = Partial<Record<ImportField, number>>;

export interface ImportFill {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** 'short' for a sale that opens a short position. */
  open?: 'short';
  qty: number;
  price: number;
  /** Unix seconds. */
  time: number;
  fees: number;
  orderId?: string;
  account?: string;
  assetClass?: 'stock' | 'futures' | 'option';
  multiplier?: number;
}

export interface Preset {
  id: string;
  label: string;
  /** Exact headings (lower case) per field; the first one found wins. */
  headings: Partial<Record<ImportField, string[]>>;
  /** Fields that must be found for the preset to match. */
  required: ImportField[];
  note?: string;
}

const P = (id: string, label: string, headings: Preset['headings'], required: ImportField[], note?: string): Preset => ({ id, label, headings, required, note });

export const PRESETS: Preset[] = [
  P('webull', 'Webull (Orders export)', { symbol: ['symbol'], side: ['side'], status: ['status'], qty: ['filled', 'filled qty'], price: ['avg price', 'average price'], date: ['filled time'], description: ['name'] },
    ['symbol', 'side', 'status', 'qty', 'price', 'date'], 'Webull app or desktop: Orders > Order history > Export. Only filled orders are imported.'),
  P('schwab', 'Charles Schwab (Transactions)', { date: ['date'], side: ['action'], symbol: ['symbol'], description: ['description'], qty: ['quantity'], price: ['price'], fees: ['fees & comm', 'fees & commissions'] },
    ['date', 'side', 'symbol', 'qty', 'price', 'fees'], 'schwab.com: Accounts > History > Transactions > Export.'),
  P('tda', 'TD Ameritrade (old transactions export)', { date: ['date'], orderId: ['transaction id'], description: ['description'], qty: ['quantity'], symbol: ['symbol'], price: ['price'], fees: ['commission'], fees2: ['reg fee'] },
    ['date', 'orderId', 'description', 'qty', 'symbol', 'price'], 'TD Ameritrade accounts moved to Schwab: older history is in the TD transactions.csv file.'),
  P('fidelity', 'Fidelity (Activity & Orders history)', { date: ['run date'], side: ['action'], symbol: ['symbol'], description: ['description'], qty: ['quantity'], price: ['price ($)', 'price'], fees: ['commission ($)'], fees2: ['fees ($)'], account: ['account'] },
    ['date', 'side', 'symbol', 'qty', 'price'], 'fidelity.com: Accounts & Trade > Activity & Orders > History > Download.'),
  P('ibkr', 'Interactive Brokers (Flex query: Trades)', { account: ['clientaccountid', 'accountid'], symbol: ['symbol'], assetClass: ['assetclass'], side: ['buy/sell'], qty: ['quantity'], price: ['tradeprice'], date: ['datetime', 'tradedate'], fees: ['ibcommission'], multiplier: ['multiplier'], orderId: ['tradeid', 'iborderid'], openClose: ['open/closeindicator', 'opencloseindicator'] },
    ['symbol', 'side', 'qty', 'price', 'date'], 'Client Portal: Performance & Reports > Flex Queries > Trades (CSV), with Date/Time, Buy/Sell, Multiplier and TradeID.'),
  P('ibkr_activity', 'Interactive Brokers (Activity Statement)', { assetClass: ['asset category'], symbol: ['symbol'], date: ['date/time'], qty: ['quantity'], price: ['t. price'], fees: ['comm/fee', 'comm in usd'], openClose: ['code'] },
    ['assetClass', 'symbol', 'date', 'qty', 'price'], 'Client Portal: Statements > Activity > CSV. Only the Trades section is read.'),
  P('robinhood', 'Robinhood (Account activity)', { date: ['activity date'], symbol: ['instrument'], description: ['description'], side: ['trans code'], qty: ['quantity'], price: ['price'] },
    ['date', 'symbol', 'side', 'qty', 'price'], 'Robinhood: Account > Reports and statements > Reports > Generate (account activity CSV).'),
  P('etrade', 'E*TRADE (Transaction history)', { date: ['transactiondate', 'transaction date'], side: ['transactiontype', 'transaction type'], assetClass: ['securitytype', 'security type'], symbol: ['symbol'], qty: ['quantity'], price: ['price'], fees: ['commission'], description: ['description'] },
    ['date', 'side', 'symbol', 'qty', 'price'], 'etrade.com: Accounts > Transactions > Download (CSV).'),
];

/** The generic match for any other export (the owner checks the columns in the preview). */
const GENERIC: [ImportField, RegExp][] = [
  ['orderId', /(order|trade|transaction|execution) ?(id|#|number)/i],
  ['date', /(date|time|executed|filled)/i],
  ['symbol', /(symbol|ticker|instrument)/i],
  ['side', /(side|action|buy\/sell|b\/s|type)/i],
  ['qty', /(qty|quantity|shares|filled|units|contracts)/i],
  ['price', /(price|fill)/i],
  ['fees', /(commission|fee)/i],
  ['account', /account/i],
  ['description', /description/i],
];
export const GENERIC_PRESET: Preset = P('generic', 'Other broker (match the columns)', {}, ['date', 'symbol', 'qty', 'price']);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function mapColumns(headers: string[], preset: Preset): ImportColumns {
  const hs = headers.map(norm);
  const out: ImportColumns = {};
  if (preset.id === 'generic') {
    const used = new Set<number>();
    for (const [field, rx] of GENERIC) {
      const i = headers.findIndex((x, j) => !used.has(j) && rx.test(x));
      if (i >= 0) (out[field] = i), used.add(i);
    }
    return out;
  }
  for (const [field, names] of Object.entries(preset.headings) as [ImportField, string[]][]) {
    for (const name of names) {
      const i = hs.indexOf(name);
      if (i >= 0) {
        out[field] = i;
        break;
      }
    }
  }
  return out;
}

/** IBKR Activity Statements hold many sections: keep the Trades heading and its order rows (not subtotals). */
function activitySection(rows: string[][]): string[][] {
  if (!rows.some((r) => r[0] === 'Trades' && r[1] === 'Header')) return rows;
  const head = rows.find((r) => r[0] === 'Trades' && r[1] === 'Header')!;
  return [head.slice(2), ...rows.filter((r) => r[0] === 'Trades' && r[1] === 'Data' && /^order$/i.test(r[2] ?? '')).map((r) => r.slice(2))];
}

/** The best preset for a file and its heading row: {preset, headerAt, rows}. Falls back to the generic match. */
export function detect(raw: string[][]): { preset: Preset; headerAt: number; rows: string[][] } {
  const rows = activitySection(raw);
  for (let at = 0; at < Math.min(rows.length, 15); at++) {
    for (const preset of PRESETS) {
      const cols = mapColumns(rows[at], preset);
      if (preset.required.every((f) => cols[f] != null)) return { preset, headerAt: at, rows };
    }
  }
  const at = rows.findIndex((r) => {
    const c = mapColumns(r, GENERIC_PRESET);
    return GENERIC_PRESET.required.every((f) => c[f] != null);
  });
  return { preset: GENERIC_PRESET, headerAt: Math.max(0, at), rows };
}

/** Offset of New York from UTC (minutes) at a UTC instant. */
function nyOffset(utcMs: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - (utcMs - (utcMs % 60000))) / 60000);
}

/** Wall-clock New York time -> unix seconds. */
export function nyTime(y: number, mo: number, d: number, hh = 12, mm = 0, ss = 0): number {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss);
  const off = nyOffset(guess - nyOffset(guess) * 60000);
  return Math.round((guess - off * 60000) / 1000);
}

/**
 * A date (and time) as broker exports write them: 10/21/2024, 10/21/24, 2024-10-21, 20241021;093105,
 * "2024-10-21, 09:31:05", "10/21/2024 09:31:05 EDT", ISO with Z/offset, "10/21/2024 as of 10/18/2024" (the first).
 * Returns unix seconds and whether a time of day was given; null when unreadable.
 */
export function parseWhen(text: string, extraTime = ''): { time: number; hasTime: boolean } | null {
  let s = `${String(text ?? '').trim()} ${String(extraTime ?? '').trim()}`.trim();
  if (!s) return null;
  if (/T\d\d:\d\d.*(Z|[+-]\d\d:?\d\d)$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? { time: Math.round(t / 1000), hasTime: true } : null;
  }
  s = s.replace(/ as of .*/i, '');
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})(\d\d)(\d\d)(?:[;\s,T]+(\d\d):?(\d\d):?(\d\d)?)?/);
  if (!m) m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[,\sT;]+(\d{1,2}):(\d\d)(?::(\d\d))?)?/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d\d)(?::(\d\d))?\s*(AM|PM)?)?/i);
    if (!m) return null;
    [mo, d, y] = [+m[1], +m[2], +m[3] < 100 ? 2000 + +m[3] : +m[3]];
  }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1980)) return null;
  const hasTime = m[4] != null;
  let hh = hasTime ? +m[4] : 12;
  const ampm = m[7]?.toUpperCase();
  if (ampm === 'PM' && hh < 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;
  return { time: nyTime(y, mo, d, hh, hasTime ? +m[5] : 0, hasTime && m[6] ? +m[6] : 0), hasTime };
}

/** The side of a row from its action text (and the quantity's sign when the text doesn't say). */
export function readSide(text: string, qty: number | null, openClose = ''): { side: 'BUY' | 'SELL'; open?: 'short' } | null {
  const s = ` ${text.toLowerCase().replace(/[_-]/g, ' ')} `;
  if (/sell short|short sale|sold short|\bsell to open\b|\bsto\b|\bss\b| short /.test(s)) return { side: 'SELL', open: 'short' };
  if (/buy to cover|bought to cover|\bcover\b|\bbtc\b|buy to close/.test(s)) return { side: 'BUY' };
  if (/\b(buy|bought|bot|b|bto|buy to open|reinvest)\b/.test(s) && !/\bsell\b|\bsold\b/.test(s)) return { side: 'BUY' };
  if (/\b(sell|sold|sld|s|stc|sell to close)\b/.test(s)) {
    return { side: 'SELL', ...(/^o\b|;o\b|\bo$/i.test(openClose.trim()) ? { open: 'short' as const } : {}) };
  }
  if (!text.trim() && qty != null && qty !== 0) return qty > 0 ? { side: 'BUY' } : { side: 'SELL', ...(/^o/i.test(openClose.trim()) ? { open: 'short' as const } : {}) };
  return null;
}

const NOT_TRADES = /(dividend|interest|transfer|journal|deposit|withdraw|fee charged|adr fee|split|merger|spin|reinvest|cash in lieu|expired|assigned|exercise)/i;

export interface ImportResult {
  fills: ImportFill[];
  skipped: number;
  problems: string[];
}

/** Turns the rows under the heading into fills. */
export function rowsToFills(rows: string[][], headerAt: number, columns: ImportColumns, preset: Preset): ImportResult {
  const get = (r: string[], f: ImportField) => (columns[f] == null ? '' : String(r[columns[f]!] ?? '').trim());
  let body = rows.slice(headerAt + 1).filter((r) => r.some((c) => c.trim()));
  const fills: ImportFill[] = [];
  const problems: string[] = [];
  let skipped = 0;
  // newest-first exports (most brokers) are put in time order, so same-day fills without a time keep their sequence
  const dated = body.map((r) => parseWhen(get(r, 'date'))?.time).filter((t): t is number => t != null);
  const firstWhen = dated[0] ?? 0;
  const lastWhen = dated[dated.length - 1] ?? 0;
  if (firstWhen > lastWhen) body = [...body].reverse();
  body.forEach((r, i) => {
    const line = headerAt + 2 + i;
    if (preset.id === 'webull' && !/^filled$|partial/i.test(get(r, 'status'))) return void skipped++;
    const description = get(r, 'description');
    const qtyRaw = parseMoney(get(r, 'qty'));
    let sideText = get(r, 'side');
    if (preset.id === 'tda') sideText = description;
    if (preset.id === 'robinhood' && !/^(buy|sell|bto|stc|sto|btc)$/i.test(sideText)) return void skipped++;
    const oc = get(r, 'openClose');
    const side = readSide(sideText, qtyRaw, oc);
    if (!side || (NOT_TRADES.test(`${sideText}`) && !/short|cover/i.test(sideText))) return void skipped++;
    let symbol = get(r, 'symbol').toUpperCase().replace(/^\$/, '');
    const when = parseWhen(get(r, 'date'), get(r, 'time'));
    const qty = qtyRaw == null ? null : Math.abs(qtyRaw);
    const price = parseMoney(get(r, 'price'));
    if (!symbol && preset.id === 'tda') symbol = description.match(/(?:bought|sold)\s+[\d,.]+\s+([A-Z.\/]+)/i)?.[1]?.toUpperCase() ?? '';
    if (!symbol || !when || !qty || price == null || price < 0) {
      if (symbol || qty) problems.push(`Line ${line}: missing ${[!symbol && 'symbol', !when && 'date', !qty && 'quantity', price == null && 'price'].filter(Boolean).join(', ')}`);
      else skipped++;
      return;
    }
    const assetText = `${get(r, 'assetClass')} ${preset.id === 'robinhood' && /^(bto|stc|sto|btc)$/i.test(sideText) ? 'option' : ''}`.toLowerCase();
    // futures and options when the export says so; otherwise the helper decides (a known futures root is futures)
    const assetClass = /fut/.test(assetText) || symbol.startsWith('/') ? 'futures' : /opt|option/.test(assetText) || / [CP]$|\d{6}[CP]\d{8}$/.test(symbol) ? 'option' : /stk|stock|eq\b|equit/.test(assetText) ? 'stock' : undefined;
    const multiplier = parseMoney(get(r, 'multiplier'));
    const fees = Math.abs(parseMoney(get(r, 'fees')) ?? 0) + Math.abs(parseMoney(get(r, 'fees2')) ?? 0);
    fills.push({
      symbol: preset.id === 'robinhood' && assetClass === 'option' ? description.toUpperCase().slice(0, 40) : symbol,
      side: side.side,
      ...(side.open ? { open: side.open } : {}),
      qty,
      price,
      // without a time of day, rows are spaced a second apart from noon so their order is kept
      time: when.hasTime ? when.time : when.time + i,
      fees,
      ...(get(r, 'orderId') ? { orderId: get(r, 'orderId') } : {}),
      ...(get(r, 'account') ? { account: get(r, 'account') } : {}),
      ...(assetClass ? { assetClass } : {}),
      ...(multiplier ? { multiplier } : {}),
    });
  });
  return { fills, skipped, problems };
}

/** Detects the format and reads the fills in one step (the preview can re-run rowsToFills with corrected columns). */
export function parseExport(raw: string[][]) {
  const { preset, headerAt, rows } = detect(raw);
  const columns = mapColumns(rows[headerAt] ?? [], preset);
  return { preset, headerAt, rows, columns, ...rowsToFills(rows, headerAt, columns, preset) };
}
