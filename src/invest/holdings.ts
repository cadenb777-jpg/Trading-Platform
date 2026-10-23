/**
 * Your own alternative investments (e.g. funds held through iCapital): commitments, capital called,
 * distributions and current value. Saved by the helper in its database, never in the browser.
 * Imports read a CSV or Excel export and match its columns by their headings.
 */

export interface AltHolding {
  id?: string;
  fund: string;
  manager?: string;
  strategy?: string;
  account?: string;
  commitment: number | null;
  /** Capital called / paid in so far. */
  contributed: number | null;
  distributed: number | null;
  /** Latest value (NAV) of what you still hold. */
  value: number | null;
  valueDate?: string;
  notes?: string;
  /** SEC number of the fund, when linked to its filings. */
  cik?: number;
}

export interface HoldingStats {
  unfunded: number | null;
  /** Total value to paid-in: (distributions + value) / contributions. */
  tvpi: number | null;
  /** Distributions to paid-in. */
  dpi: number | null;
  gain: number | null;
}

const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v);

export function holdingStats(h: Pick<AltHolding, 'commitment' | 'contributed' | 'distributed' | 'value'>): HoldingStats {
  const commitment = n(h.commitment);
  const contributed = n(h.contributed);
  const distributed = n(h.distributed) ?? 0;
  const value = n(h.value);
  return {
    unfunded: commitment != null && contributed != null ? Math.max(0, commitment - contributed) : null,
    tvpi: contributed ? (distributed + (value ?? 0)) / contributed : null,
    dpi: contributed ? distributed / contributed : null,
    gain: contributed != null && value != null ? value + distributed - contributed : null,
  };
}

export function totals(list: AltHolding[]) {
  const sum = (k: 'commitment' | 'contributed' | 'distributed' | 'value') => list.reduce((s, h) => s + (n(h[k]) ?? 0), 0);
  const t = { fund: 'Total', commitment: sum('commitment'), contributed: sum('contributed'), distributed: sum('distributed'), value: sum('value') };
  return { ...t, ...holdingStats(t) };
}

/** "$1,234.50", "(2,000)", "12.5k", "1.2M" → numbers; blanks and dashes → null. */
export function parseMoney(text: string): number | null {
  let s = String(text ?? '').trim();
  if (!s || /^[-–—]+$/.test(s) || /^n\/?a$/i.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()$,\s-]/g, '').replace(/^USD/i, '');
  const mult = /m$/i.test(s) ? 1e6 : /k$/i.test(s) ? 1e3 : /b$/i.test(s) ? 1e9 : 1;
  const v = parseFloat(s.replace(/[kmb]$/i, ''));
  return Number.isFinite(v) ? (negative ? -v : v) * mult : null;
}

/** Splits CSV text into rows (handles quoted cells with commas and quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

type Field = 'fund' | 'manager' | 'strategy' | 'account' | 'commitment' | 'contributed' | 'distributed' | 'value' | 'valueDate';

/** Heading keywords for each field, most specific first. */
const HEADINGS: [Field, RegExp][] = [
  ['commitment', /commit/i],
  ['contributed', /(contribut|paid[- ]?in|called|capital call|funded|invested)/i],
  ['distributed', /distribut/i],
  ['valueDate', /(as of|value date|nav date|valuation date|statement date|\bdate\b)/i],
  ['value', /(\bnav\b|market value|current value|ending (balance|value)|fair value|balance|\bvalue\b)/i],
  ['manager', /(manager|sponsor|gp\b|general partner)/i],
  ['strategy', /(strategy|asset class|category|type)/i],
  ['account', /(account|investor|entity)/i],
  ['fund', /(fund|investment|offering|product|name|holding|security)/i],
];

export function mapColumns(headers: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const [field, rx] of HEADINGS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && rx.test(h) && !(field !== 'contributed' && /unfunded|remaining/i.test(h)));
    if (idx >= 0) {
      out[field] = idx;
      used.add(idx);
    }
  }
  return out;
}

/** Turns spreadsheet rows (first row with a fund-name column is the heading) into holdings. */
export function rowsToHoldings(rows: string[][]): { holdings: AltHolding[]; columns: Partial<Record<Field, number>>; headers: string[] } {
  const headerAt = rows.findIndex((r) => {
    const cols = mapColumns(r);
    return cols.fund != null && (cols.value != null || cols.commitment != null || cols.contributed != null);
  });
  if (headerAt < 0) return { holdings: [], columns: {}, headers: [] };
  const headers = rows[headerAt];
  const columns = mapColumns(headers);
  const get = (r: string[], f: Field) => (columns[f] == null ? '' : (r[columns[f]!] ?? '').trim());
  const holdings: AltHolding[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const name = get(r, 'fund');
    if (!name || /^(total|sum|grand total)\b/i.test(name)) continue;
    const h: AltHolding = {
      fund: name,
      manager: get(r, 'manager') || undefined,
      strategy: get(r, 'strategy') || undefined,
      account: get(r, 'account') || undefined,
      commitment: parseMoney(get(r, 'commitment')),
      contributed: parseMoney(get(r, 'contributed')),
      distributed: parseMoney(get(r, 'distributed')),
      value: parseMoney(get(r, 'value')),
      valueDate: get(r, 'valueDate') || undefined,
    };
    if (h.commitment == null && h.contributed == null && h.value == null) continue;
    holdings.push(h);
  }
  return { holdings, columns, headers };
}
