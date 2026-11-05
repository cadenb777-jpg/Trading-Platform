/**
 * The security view's tabs and their Bloomberg mnemonics, its route (#sec/AAPL/FA) and its Back/Forward history.
 * Pure and tested (codes.test.ts). See docs/research/bloomberg-structure.md for the mapping.
 */

export type SecTab = 'des' | 'gp' | 'fa' | 'hds' | 'cn' | 'omon' | 'dvd' | 'beta' | 'set';

export interface TabDef {
  id: SecTab;
  /** The mnemonic shown next to the label and typed in the command bar ("AAPL FA"). */
  code: string;
  aliases?: string[];
  label: string;
  /** Needs a company (not an index, ETF-only data or crypto) to have anything to show. */
  company?: boolean;
}

export const SEC_TABS: TabDef[] = [
  { id: 'des', code: 'DES', label: 'Overview' },
  { id: 'gp', code: 'GP', aliases: ['GIP'], label: 'Chart' },
  { id: 'fa', code: 'FA', label: 'Financials', company: true },
  { id: 'hds', code: 'HDS', label: 'Holders', company: true },
  { id: 'cn', code: 'CN', label: 'News' },
  { id: 'omon', code: 'OMON', aliases: ['OMST'], label: 'Options' },
  { id: 'dvd', code: 'DVD', label: 'Dividends' },
  { id: 'beta', code: 'BETA', aliases: ['HP', 'HRA'], label: 'Risk' },
  { id: 'set', code: 'SET', aliases: ['SETUP', 'SETUPS'], label: 'Setups' },
];

export const DEFAULT_TAB: SecTab = 'des';

/** The tab for a mnemonic or tab id ("FA", "fa", "HP"), or null. */
export function tabForCode(code: string | null | undefined): SecTab | null {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return null;
  return SEC_TABS.find((t) => t.code === c || t.id.toUpperCase() === c || t.aliases?.includes(c))?.id ?? null;
}

export const tabDef = (id: SecTab) => SEC_TABS.find((t) => t.id === id)!;

const SYMBOL = /^[$^]?[A-Z0-9][A-Z0-9.\-]{0,14}$/;

/** A symbol the security view can load (stocks, funds, indexes, crypto pairs; futures have their own page). */
export function cleanSymbol(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  return SYMBOL.test(s) && s !== 'CASH' ? s : null;
}

/** "#sec/AAPL/FA" (the symbol URL-encoded, so "$SPX" and "BRK.B" survive). */
export function secHash(symbol: string, tab: SecTab = DEFAULT_TAB): string {
  return `#sec/${encodeURIComponent(symbol)}${tab === DEFAULT_TAB ? '' : `/${tabDef(tab).code}`}`;
}

/** Reads the part after "#sec/" ("AAPL/FA", "aapl", "%24SPX/gp") into a symbol and tab; null when there's no symbol. */
export function parseSecRoute(sub: string): { symbol: string; tab: SecTab } | null {
  const [rawSym, rawTab] = sub.split('/');
  let sym: string;
  try {
    sym = decodeURIComponent(rawSym ?? '');
  } catch {
    return null;
  }
  const symbol = cleanSymbol(sym);
  return symbol ? { symbol, tab: tabForCode(rawTab) ?? DEFAULT_TAB } : null;
}

// ---------- Back / Forward between securities ----------

export interface HistoryEntry {
  symbol: string;
  tab: SecTab;
}

export const HISTORY_MAX = 50;
export const RECENT_MAX = 10;

/**
 * Browser-style history of loaded securities: visiting a new one drops everything ahead (like a browser), the same
 * security twice in a row only updates its tab. `recents` = distinct symbols, newest first.
 */
export function createSecHistory(max = HISTORY_MAX) {
  let list: HistoryEntry[] = [];
  let at = -1;
  return {
    visit(e: HistoryEntry) {
      if (list[at]?.symbol === e.symbol) {
        list[at] = { ...e };
        return;
      }
      list = [...list.slice(0, at + 1), { ...e }].slice(-max);
      at = list.length - 1;
    },
    /** The current entry's tab changed (no new history step). */
    setTab(tab: SecTab) {
      if (list[at]) list[at] = { ...list[at], tab };
    },
    back(): HistoryEntry | null {
      if (at <= 0) return null;
      return { ...list[--at] };
    },
    forward(): HistoryEntry | null {
      if (at >= list.length - 1) return null;
      return { ...list[++at] };
    },
    get canBack() {
      return at > 0;
    },
    get canForward() {
      return at < list.length - 1;
    },
    get current(): HistoryEntry | null {
      return list[at] ? { ...list[at] } : null;
    },
    recents(n = RECENT_MAX): string[] {
      const out: string[] = [];
      for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (!out.includes(list[i].symbol)) out.push(list[i].symbol);
      return out;
    },
  };
}
