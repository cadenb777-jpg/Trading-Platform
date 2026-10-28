/**
 * The command bar (Bloomberg-style): press / or Ctrl/Cmd+K, type a ticker, a function code ("AAPL GP", "WEI",
 * "ECO") or part of a name, and press Enter. Also the global keyboard shortcuts (g h, g c, n a, ? ...) and the
 * shortcut sheet. Browser only: it reuses requests the helper already has (invest.search, store.list, news,
 * webull.sync). Trade only pre-fills the Trade page's ticket; nothing is ever placed from here.
 *
 * The top half is pure (parsing, ranking, shortcut dispatch, recents) and tested in command.test.ts.
 */
import { prefillAssistant } from '../ai/hub';
import { guessMarket, type MarketRef } from '../data/quotes';
import { engineRequest, helper, loadNews } from '../data/schwab';
import { listDocs } from '../data/store';
import { BOARDS } from '../invest/catalog';
import { combineHoldings, myPortfolios } from '../portfolio/account';
import type { Portfolio } from '../portfolio/types';
import { persist, state } from '../state';
import { h, openModal, timeAgo, toast } from './dom';
import { icon } from './icons';
import { LINK_LABELS, focusPanel, focusedPanel, links } from './linkGroups';
import { normalizeTicker, tickerPreview } from './tickerCard';

// ---------- function codes ----------

export interface FnCode {
  code: string;
  aliases?: string[];
  label: string;
  /** Works on a ticker ("AAPL GP"). */
  ticker?: boolean;
  /** Needs a ticker (no page of its own). */
  tickerOnly?: boolean;
  keywords?: string;
}

export const CODES: FnCode[] = [
  { code: 'GP', label: 'Chart', ticker: true, keywords: 'graph price chart candles' },
  { code: 'DES', label: 'Description (Research overview)', ticker: true, keywords: 'research company profile' },
  { code: 'FA', label: 'Financials', ticker: true, keywords: 'financial analysis income balance cash flow sec' },
  { code: 'CN', label: 'News', ticker: true, keywords: 'company news headlines' },
  { code: 'OMON', aliases: ['FLOW'], label: 'Options and flow', ticker: true, keywords: 'options monitor flow insiders short' },
  { code: 'TRADE', aliases: ['TRD'], label: 'Order ticket (pre-fills only)', ticker: true, keywords: 'buy sell order ticket webull' },
  { code: 'ALRT', label: 'Alerts', ticker: true, keywords: 'alert notify price' },
  { code: 'WL', label: 'Add to watchlist', ticker: true, tickerOnly: true, keywords: 'watchlist favourite' },
  { code: 'WEI', label: 'World equity indices (Home)', keywords: 'indexes indices markets home' },
  { code: 'ECO', label: 'Economic calendar', keywords: 'calendar economic releases fomc' },
  { code: 'FUT', aliases: ['CTM'], label: 'Futures', keywords: 'futures contracts commodities' },
  { code: 'PORT', label: 'Portfolios (models, what-ifs, optimizer)', keywords: 'portfolio model optimizer what-if' },
  { code: 'ACCT', label: 'Account (my real money, all accounts)', keywords: 'account holdings dividends total value' },
  { code: 'MULTI', aliases: ['WS'], label: 'Workspace: linked panels (Chart mode)', keywords: 'multi chart grid side by side workspace panels linked layout launchpad' },
  { code: 'SCRIPT', aliases: ['PINE'], label: 'Scripts (Chart mode)', keywords: 'script pine editor indicator code' },
  { code: 'COT', label: 'Futures positioning (COT)', keywords: 'cot commitment traders positioning hedgers cftc' },
  { code: 'BTST', label: 'Backtest', keywords: 'backtest strategy test' },
  { code: 'SET', label: 'Setups', keywords: 'setups scanner signals' },
  { code: 'MACRO', label: 'Macro', keywords: 'economy fred rates' },
  { code: 'BONDS', aliases: ['WB'], label: 'Bonds (world bonds)', keywords: 'yields treasuries bonds' },
  { code: 'INV', label: 'Investments', keywords: 'investments etfs funds alternatives' },
  { code: 'HELP', label: 'Keyboard shortcuts', keywords: 'help shortcuts keys' },
];

/** Where a code without a ticker goes. */
const CODE_ROUTE: Record<string, string> = {
  GP: 'chart', DES: 'research', FA: 'research', CN: 'home', OMON: 'flow', TRADE: 'trade', WEI: 'home', ECO: 'calendar', FUT: 'futures',
  PORT: 'portfolio', ACCT: 'account', MULTI: 'chart/multi', SCRIPT: 'chart/scripts', COT: 'futures/cot', BTST: 'backtest', SET: 'setups', MACRO: 'macro', INV: 'invest',
};

export function findCode(token: string): FnCode | null {
  const t = token.trim().toUpperCase();
  return CODES.find((c) => c.code === t || c.aliases?.includes(t)) ?? null;
}

/** Bloomberg's yellow-key words, ignored ("AAPL US Equity GP <GO>"). */
const FILLER = new Set(['US', 'EQUITY', 'INDEX', 'CURNCY', 'COMDTY', '<GO>', 'GO']);

export interface Parsed {
  /** The cleaned text (upper case, single spaces). */
  text: string;
  ticker: string | null;
  code: FnCode | null;
  /** Both a ticker and a code were typed ("AAPL GP"). */
  pair: boolean;
}

/** Reads "AAPL GP", "GP AAPL", "AAPL US Equity DES", "WEI", "aapl". A single word can be both a ticker and a code. */
export function parseCommand(input: string): Parsed {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter((t) => t && !FILLER.has(t));
  const text = tokens.join(' ');
  if (!tokens.length) return { text, ticker: null, code: null, pair: false };
  if (tokens.length === 1) return { text, ticker: normalizeTicker(tokens[0]), code: findCode(tokens[0]), pair: false };
  if (tokens.length === 2) {
    const [a, b] = tokens;
    const last = findCode(b);
    if (last?.ticker && normalizeTicker(a)) return { text, ticker: normalizeTicker(a), code: last, pair: true };
    const first = findCode(a);
    if (first?.ticker && normalizeTicker(b)) return { text, ticker: normalizeTicker(b), code: first, pair: true };
  }
  return { text, ticker: null, code: null, pair: false };
}

// ---------- ranking ----------

/** Scattered matches scoring below this are noise ("xa" somewhere in a long name). */
export const FUZZY_MIN = 150;
const isWordStart = (t: string, i: number) => i === 0 || /[^a-z0-9]/.test(t[i - 1]);

/**
 * How well `query` matches `text`, FUZZY_MIN-499 (higher is better), or null. A plain substring beats a scattered
 * match; matches at the start of a word score more. Short queries (4 characters or fewer) must match at word starts:
 * "gold" finds "Gold", "na" finds "New alert", but "ld" finds nothing in "Gold".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return null;
  const short = q.replace(/ /g, '').length <= 4;
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + 1)) {
    const wordStart = isWordStart(t, at);
    if (short && !wordStart) continue;
    return Math.min(499, 400 - Math.min(at, 80) + (wordStart ? 60 : 0));
  }
  let score = 200;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    let found = t.indexOf(ch, ti);
    while (short && found >= 0 && !isWordStart(t, found)) found = t.indexOf(ch, found + 1);
    if (found < 0) return null;
    if (found === prev + 1) score += 10;
    else score -= Math.min(found - ti, 10);
    if (found === 0 || /[^a-z0-9]/.test(t[found - 1])) score += 12;
    prev = found;
    ti = found + 1;
  }
  return score < FUZZY_MIN ? null : Math.min(399, score);
}

export type SymbolSource = 'watchlist' | 'holding' | 'nasdaq' | 'futures' | 'board' | 'search';
export interface SymbolEntry {
  symbol: string;
  name?: string;
  source: SymbolSource;
}

export interface ActionEntry {
  id: string;
  title: string;
  subtitle?: string;
  hint?: string;
  keywords?: string;
}

export interface Sources {
  symbols: SymbolEntry[];
  pages: { route: string; label: string; group?: string }[];
  portfolios: { id: string; name: string; mine: boolean }[];
  clients: { id: string; name: string }[];
  actions: ActionEntry[];
}

export interface ResultItem {
  /** What running it does (see runId), also the key in the recent list. */
  id: string;
  title: string;
  subtitle?: string;
  /** A code or key shown on the right. */
  hint?: string;
  /** Shows the ticker card preview while selected. */
  symbol?: string;
  /** What Tab puts in the input. */
  complete: string;
  score: number;
}
export interface ResultGroup {
  label: string;
  items: ResultItem[];
}

export interface RecentEntry {
  id: string;
  title: string;
  subtitle?: string;
}

/** The symbol without its $ (index), / (futures) or ^ prefix, for matching what was typed. */
const bare = (s: string) => s.replace(/^[$/^]/, '');
const SOURCE_LABEL: Record<SymbolSource, string> = { watchlist: 'Watchlist', holding: 'You hold', nasdaq: 'Nasdaq-100', futures: 'Futures', board: 'Markets', search: 'Search' };

/** Which codes make sense for a symbol: futures open their contract detail, indexes and crypto have no company data. */
export function codesFor(symbol: string): FnCode[] {
  if (symbol.startsWith('/')) return CODES.filter((c) => c.code === 'GP');
  const company = !symbol.startsWith('$') && !symbol.startsWith('^') && !symbol.includes('-');
  return CODES.filter((c) => c.ticker && (company || ['GP', 'ALRT', 'WL'].includes(c.code)));
}

/** One entry per symbol, the first source winning (watchlist before holdings before lists), names merged. */
export function mergeSymbols(list: SymbolEntry[]): SymbolEntry[] {
  const out = new Map<string, SymbolEntry>();
  for (const e of list) {
    const s = e.symbol.toUpperCase();
    const had = out.get(s);
    if (!had) out.set(s, { ...e, symbol: s });
    else if (!had.name && e.name) had.name = e.name;
  }
  return [...out.values()];
}

const LIMIT = { symbols: 8, other: 6 };

/**
 * The palette's results, in groups ordered by their best match. Ranking: an exact ticker first, then an exact
 * function code (so "FA" means Financials, not FANG), then ticker prefixes, code prefixes, and fuzzy name matches.
 * Empty input: recent commands, then the function codes.
 */
export function buildResults(input: string, src: Sources, recents: RecentEntry[] = []): ResultGroup[] {
  const p = parseCommand(input);
  const q = p.text;
  if (!q) {
    const groups: ResultGroup[] = [];
    if (recents.length) groups.push({ label: 'Recent', items: recents.map((r, i) => ({ ...r, complete: r.title, score: 100 - i })) });
    groups.push({ label: 'Functions', items: CODES.filter((c) => !c.tickerOnly).map((c, i) => codeItem(c, 50 - i)) });
    return groups;
  }
  const symbols = mergeSymbols(src.symbols);
  const groups: ResultGroup[] = [];
  const known = (t: string) => symbols.find((s) => s.symbol === t) ?? symbols.find((s) => bare(s.symbol) === bare(t));

  // "AAPL GP": one obvious thing to run
  if (p.pair && p.ticker && p.code) {
    const sym = known(p.ticker)?.symbol ?? p.ticker;
    groups.push({ label: 'Run', items: [tickerItem(sym, p.code, 2000, known(sym)?.name)] });
  }

  // a single word that is a ticker: its actions (Chart first, the Enter default)
  let shownTicker: string | null = null;
  if (!p.pair && p.ticker && !q.includes(' ')) {
    const hit = known(p.ticker);
    const sym = hit?.symbol ?? p.ticker;
    shownTicker = sym;
    const base = hit ? 1000 : 300; // an unknown word may be a name ("gold"): name matches come first
    const name = hit?.name;
    groups.push({ label: name ? `${sym.replace(/^\$/, '')} · ${name}` : sym.replace(/^\$/, ''), items: codesFor(sym).map((c, i) => tickerItem(sym, c, base - i * 0.1, name)) });
  }

  const symItems: ResultItem[] = [];
  if (!p.pair) {
    for (const s of symbols) {
      if (s.symbol === shownTicker) continue;
      const b = bare(s.symbol);
      let score: number | null = null;
      if (!q.includes(' ') && (b.startsWith(q) || s.symbol.startsWith(q))) score = 800 - Math.min(b.length - bare(q).length, 50);
      const byName = s.name && q.length >= 2 ? fuzzyScore(q, s.name) : null;
      if (byName != null && (score == null || byName > score)) score = byName;
      if (score == null) continue;
      symItems.push({ id: `tk:${s.symbol}:GP`, title: s.symbol.replace(/^\$/, ''), subtitle: [s.name, SOURCE_LABEL[s.source]].filter(Boolean).join(' · '), hint: 'GP', symbol: s.symbol, complete: `${s.symbol} `, score });
    }
  }
  pushGroup(groups, 'Symbols', symItems, LIMIT.symbols);

  const codeItems: ResultItem[] = [];
  for (const c of CODES) {
    if (c.tickerOnly) continue;
    const names = [c.code, ...(c.aliases ?? [])];
    let score: number | null = names.includes(q) ? 900 : names.some((n) => n.startsWith(q)) ? 700 - Math.min(c.code.length - q.length, 50) : null;
    const byName = fuzzyScore(q, `${c.label} ${c.keywords ?? ''}`);
    if (byName != null && (score == null || byName > score)) score = byName;
    if (score != null && !(p.pair && p.code === c)) codeItems.push(codeItem(c, score));
  }
  pushGroup(groups, 'Functions', codeItems, LIMIT.other);

  const fuzzyGroup = (label: string, list: { id: string; title: string; subtitle?: string; hint?: string; keywords?: string }[]) =>
    pushGroup(
      groups,
      label,
      list.flatMap((x) => {
        const score = fuzzyScore(q, `${x.title} ${x.keywords ?? ''}`);
        return score == null ? [] : [{ id: x.id, title: x.title, subtitle: x.subtitle, hint: x.hint, complete: x.title, score }];
      }),
      LIMIT.other,
    );
  fuzzyGroup('Pages', src.pages.map((pg) => ({ id: `page:${pg.route}`, title: pg.label, subtitle: pg.group, keywords: pg.route })));
  fuzzyGroup('Accounts', [
    { id: 'page:account', title: 'All accounts (total value)', subtitle: 'Account: your real money, every account', keywords: 'account total holdings webull broker' },
    { id: 'page:trade', title: 'Webull ordering account', subtitle: 'Trade: one account’s buying power, positions and orders', keywords: 'account broker webull buying power orders' },
    ...src.portfolios.filter((x) => x.mine).map((x) => ({ id: `ac:${x.id}`, title: x.name, subtitle: 'My account (Account page)', keywords: 'account' })),
  ]);
  fuzzyGroup('Portfolios', src.portfolios.filter((x) => !x.mine).map((x) => ({ id: `pf:${x.id}`, title: x.name, subtitle: 'Model portfolio', keywords: 'portfolio model' })));
  fuzzyGroup('Clients', src.clients.map((c) => ({ id: `cl:${c.id}`, title: c.name, subtitle: 'Client', keywords: 'client report' })));
  fuzzyGroup('Actions', src.actions);

  return groups.sort((a, b) => b.items[0].score - a.items[0].score);
}

function pushGroup(groups: ResultGroup[], label: string, items: ResultItem[], max: number) {
  if (items.length) groups.push({ label, items: items.sort((a, b) => b.score - a.score).slice(0, max) });
}

function codeItem(c: FnCode, score: number): ResultItem {
  return { id: `fn:${c.code}`, title: c.label, subtitle: c.ticker ? `Add a ticker: AAPL ${c.code}` : undefined, hint: c.code, complete: c.code, score };
}

function tickerItem(symbol: string, c: FnCode, score: number, name?: string): ResultItem {
  const shown = symbol.replace(/^\$/, '');
  const title = symbol.startsWith('/') ? `${shown} contract detail` : `${shown} ${c.label.replace(/ \(.*\)$/, '').toLowerCase()}`;
  return { id: `tk:${symbol}:${c.code}`, title, subtitle: c.code === 'TRADE' ? 'Fills in the Trade page; you still preview and confirm' : name, hint: c.code, symbol, complete: `${symbol} ${c.code}`, score };
}

/** The flat order the arrow keys move through. */
export const flatten = (groups: ResultGroup[]) => groups.flatMap((g) => g.items);

// ---------- recent commands ----------

const RECENT_KEY = 'tp-command-recent';
export const RECENT_MAX = 8;

/** The list with `entry` moved (or added) to the front, at most `max` long. */
export function pushRecent(list: RecentEntry[], entry: RecentEntry, max = RECENT_MAX): RecentEntry[] {
  return [{ id: entry.id, title: entry.title, ...(entry.subtitle ? { subtitle: entry.subtitle } : {}) }, ...list.filter((r) => r.id !== entry.id)].slice(0, max);
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): KeyStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadRecents(store: KeyStore | null = browserStore()): RecentEntry[] {
  try {
    const raw = store?.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((r): r is RecentEntry => !!r && typeof r.id === 'string' && typeof r.title === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecents(list: RecentEntry[], store: KeyStore | null = browserStore()) {
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // private window or blocked storage: the palette still works, it just won't remember
  }
}

// ---------- global shortcuts ----------

/** Two-key shortcuts: press the first, then the second within CHORD_MS. */
export const CHORDS: { keys: string; id: string; label: string }[] = [
  { keys: 'g h', id: 'page:home', label: 'Go to Home' },
  { keys: 'g c', id: 'page:chart', label: 'Go to Chart' },
  { keys: 'g s', id: 'page:setups', label: 'Go to Setups' },
  { keys: 'g a', id: 'page:account', label: 'Go to Account' },
  { keys: 'g t', id: 'page:trade', label: 'Go to Trade (nothing is placed by a key)' },
  { keys: 'g f', id: 'page:futures', label: 'Go to Futures' },
  { keys: 'g p', id: 'page:portfolio', label: 'Go to Portfolios (models)' },
  { keys: 'g m', id: 'page:chart/multi', label: 'Go to the Workspace (linked panels)' },
  { keys: 'n a', id: 'act:alert', label: 'New alert' },
];
export const CHORD_MS = 1500;

export interface KeyInfo {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** KeyboardEvent.code ("Digit1"): Alt+digit types other characters on a Mac keyboard. */
  code?: string;
  /** Focus is in a text field, list box or editable area. */
  inField?: boolean;
  /** Focus is on a linked panel that takes typed tickers (not the Chart or Trade, whose letters are their own). */
  inPanel?: boolean;
  /** A dialog is open (its keys are its own). */
  modalOpen?: boolean;
}
export interface Pending {
  key: string;
  at: number;
}
export interface Dispatch {
  /** 'palette', 'help', 'ai', 'panel-type' (a letter typed on a panel), 'panel:next' / 'panel:prev' / 'panel:3', or a command id (page:..., act:...). */
  action: string | null;
  pending: Pending | null;
  /** Stop the key reaching the page (so "g s" on the Trade page doesn't also pick Sell). */
  consume: boolean;
}

/**
 * What a key press does. Nothing fires inside a dialog (above all the order confirm window) or a pinned ticker card;
 * single keys, chords and the panel keys also never fire while typing in a field (Ctrl/Cmd+K and +I do).
 * Panels: Ctrl/Cmd+[ and ] or F6 (Shift+F6 back) move between them, Alt+1..6 jumps to one, and a letter typed on a
 * panel opens the command bar scoped to that panel's link group.
 */
export function dispatchKey(pending: Pending | null, k: KeyInfo, now: number): Dispatch {
  const none: Dispatch = { action: null, pending: null, consume: false };
  const run = (action: string): Dispatch => ({ action, pending: null, consume: true });
  if (k.modalOpen) return none;
  if (k.ctrl || k.meta) {
    if (k.alt) return none;
    const key = k.key.toLowerCase();
    if (key === 'k') return run('palette');
    if (key === 'i') return run('ai');
    if (!k.inField && (key === '[' || key === ']')) return run(key === ']' ? 'panel:next' : 'panel:prev');
    return none;
  }
  if (k.inField) return none;
  if (k.key === 'F6') return run(k.shift ? 'panel:prev' : 'panel:next');
  const digit = /^Digit([1-6])$/.exec(k.code ?? '');
  if (k.alt) return digit ? run(`panel:${digit[1]}`) : none;
  if (k.inPanel && /^[a-z]$/i.test(k.key)) return run('panel-type');
  if (pending && now - pending.at <= CHORD_MS) {
    const chord = CHORDS.find((c) => c.keys === `${pending.key} ${k.key}`);
    if (chord) return { action: chord.id, pending: null, consume: true };
  }
  if (k.key === '/') return { action: 'palette', pending: null, consume: true };
  if (k.key === '?') return { action: 'help', pending: null, consume: true };
  if (CHORDS.some((c) => c.keys.startsWith(`${k.key} `))) return { action: null, pending: { key: k.key, at: now }, consume: false };
  return none;
}

/** Every shortcut in the app, for the sheet (audited from the pages' own key handlers). */
export const SHORTCUT_SHEET: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      ['/  or  Ctrl/Cmd+K', 'Open the command bar'],
      ['?', 'This list of shortcuts'],
      ['Ctrl/Cmd+I', 'Open or close the AI assistant'],
      ...CHORDS.map((c) => [c.keys, c.label] as [string, string]),
      ['Esc', 'Close a dialog, pop-up or ticker card'],
    ],
  },
  {
    title: 'Panels and link colours',
    rows: [
      ['Ctrl/Cmd+]  or  F6', 'Next panel'],
      ['Ctrl/Cmd+[  or  Shift+F6', 'Previous panel'],
      ['Alt+1 … Alt+6', 'Jump to panel 1-6'],
      ['A-Z (on a panel)', 'Type a ticker: the command bar opens for that panel’s colour group'],
    ],
  },
  {
    title: 'Command bar',
    rows: [
      ['↑ ↓', 'Move through the results'],
      ['Enter', 'Run the highlighted result'],
      ['Tab', 'Complete the input from the highlighted result'],
      ['Esc', 'Close'],
    ],
  },
  {
    title: 'Chart page',
    rows: [
      ['f', 'Fit the chart to the data'],
      ['Delete / Backspace', 'Remove the selected drawing'],
      ['Esc', 'Cancel the drawing tool or selection'],
      ['Enter (symbol box)', 'Load the symbol'],
    ],
  },
  {
    title: 'Trade page',
    rows: [
      ['b / s', 'Ticket side: Buy / Sell'],
      ['Enter', 'Preview the order (placing always needs the Place button in the confirm window)'],
      ['Esc', 'Leave the field you are typing in'],
    ],
  },
  {
    title: 'Elsewhere',
    rows: [
      ['Tab (on a ticker)', 'Step into its ticker card'],
      ['Enter / Space', 'Open a focused row or card'],
      ['Ctrl/Cmd+S', 'Save the script (Scripts editor)'],
      ['Tab (Scripts editor)', 'Indent'],
    ],
  },
];

// ---------- the browser part ----------

/** The Nasdaq-100, the same list as the helper's scanner (helper/engine/scanner.py NASDAQ_100; a test checks they match). */
export const NASDAQ_100 = (
  'AAPL MSFT NVDA AMZN META GOOGL AVGO TSLA COST NFLX TMUS ASML CSCO AMD PEP LIN AZN ADBE INTU QCOM TXN ISRG BKNG AMGN AMAT PDD HON ' +
  'CMCSA ARM GILD ADP PANW LRCX VRTX MU SBUX ADI MELI KLAC INTC APP CRWD PLTR MSTR CTAS MDLZ CEG SNPS CDNS ORLY MAR FTNT PYPL DASH ' +
  'REGN ABNB ADSK WDAY CSX ROP CHTR MRVL NXPI PCAR AEP CPRT PAYX TTD FANG ROST KDP MNST AXON FAST TEAM ODFL EA XEL DDOG BKR VRSK ' +
  'CTSH EXC KHC IDXX CCEP GEHC ZS CSGP TTWO LULU DXCM ON MCHP CDW WBD BIIB GFS MDB SHOP TRI'
).split(' ');

/** Futures roots on the Futures page (helper/engine/futures_market.py SPECS). */
export const FUTURES: [string, string][] = [
  ['ES', 'E-mini S&P 500'], ['NQ', 'E-mini Nasdaq-100'], ['YM', 'E-mini Dow'], ['RTY', 'E-mini Russell 2000'], ['MES', 'Micro E-mini S&P 500'],
  ['MNQ', 'Micro E-mini Nasdaq-100'], ['ZT', '2-Year T-Note'], ['ZF', '5-Year T-Note'], ['ZN', '10-Year T-Note'], ['ZB', 'U.S. Treasury Bond'],
  ['SR3', '3-Month SOFR'], ['CL', 'Crude Oil (WTI)'], ['NG', 'Natural Gas'], ['RB', 'RBOB Gasoline'], ['HO', 'Heating Oil'], ['GC', 'Gold futures'],
  ['SI', 'Silver futures'], ['HG', 'Copper'], ['PL', 'Platinum'], ['ZC', 'Corn'], ['ZS', 'Soybeans'], ['ZW', 'Wheat'], ['ZL', 'Soybean Oil'],
  ['ZM', 'Soybean Meal'], ['LE', 'Live Cattle'], ['HE', 'Lean Hogs'], ['KC', 'Coffee'], ['SB', 'Sugar'], ['CC', 'Cocoa'], ['6E', 'Euro FX'],
  ['6J', 'Japanese Yen'], ['6B', 'British Pound'], ['6A', 'Australian Dollar'], ['6C', 'Canadian Dollar'], ['DX', 'U.S. Dollar Index'],
  ['BTC', 'Bitcoin futures'], ['MBT', 'Micro Bitcoin'], ['ETH', 'Ether futures'], ['VX', 'VIX futures'],
];

const SETTINGS_SECTIONS = ['Appearance', 'AI assistant', 'Data sources', 'Alerts', 'Trading', 'Helper', 'About'];

export const ACTIONS: ActionEntry[] = [
  { id: 'act:alert', title: 'New alert', subtitle: 'Price or % move alert', hint: 'n a', keywords: 'alert notify' },
  { id: 'act:ticket', title: 'Open order ticket', subtitle: 'Pre-fills the Trade page with the chart’s symbol; you still preview and confirm', keywords: 'trade buy order' },
  { id: 'act:ai-summary', title: 'AI summary of this page', subtitle: 'Runs the page’s AI summary button (or asks the assistant)', keywords: 'ai insight explain' },
  { id: 'act:ai', title: 'AI assistant', hint: 'Ctrl+I', keywords: 'ask claude chat' },
  { id: 'act:sync', title: 'Sync accounts (Webull)', subtitle: 'Saves your Webull holdings as portfolios; reads only', keywords: 'sync webull refresh holdings' },
  { id: 'act:health', title: 'Diagnostics: data health', subtitle: 'When each feed last updated', keywords: 'diagnostics status feeds' },
  { id: 'act:connection', title: 'Diagnostics: connection check', subtitle: 'Helper, Schwab login, keys', keywords: 'diagnostics helper status' },
  { id: 'act:shortcuts', title: 'Keyboard shortcuts', hint: '?', keywords: 'help keys' },
  ...SETTINGS_SECTIONS.map((s) => ({ id: `set:${s}`, title: `Settings: ${s}`, keywords: 'settings preferences' })),
];

export interface CommandDeps {
  pages: { route: string; label: string; group?: string }[];
  currentRoute(): string;
  openChart(ref: MarketRef): void;
  /** Goes to a page and, once it is built, calls one of its methods (e.g. Research open(symbol, tab)). */
  openPage(route: string, method?: string, ...args: unknown[]): void;
  toggleAssistant(): void;
  openHealth(): void;
}

let deps: CommandDeps | null = null;
let pending: Pending | null = null;
let closePalette: (() => void) | null = null;

/** Starts the command bar and the shortcuts (once, from main.ts). Returns the rail button. */
export function initCommandBar(d: CommandDeps): HTMLElement {
  deps = d;
  window.addEventListener(
    'keydown',
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const inField = !!target?.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
      // a dialog or a pinned ticker card owns the keyboard (the palette itself is neither, so Ctrl+K still closes it)
      const modalOpen = !closePalette && !!document.querySelector('.modal-backdrop, .ticker-card.pinned, .link-menu');
      const inPanel = !!target?.closest('[data-link-panel]:not([data-link-keys="own"])');
      const r = dispatchKey(pending, { key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, inField, inPanel, modalOpen }, Date.now());
      pending = r.pending;
      if (r.consume) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      if (!r.action) return;
      if (r.action === 'palette') return closePalette ? closePalette() : openPalette({ scope: focusedPanel() });
      if (r.action === 'help') return openShortcutSheet();
      if (r.action === 'ai') return d.toggleAssistant();
      if (closePalette) return;
      if (r.action === 'panel-type') return openPalette({ scope: focusedPanel(), text: e.key.toUpperCase() });
      if (r.action.startsWith('panel:')) {
        const which = r.action.slice(6);
        return focusPanel(which === 'next' ? { dir: 1 } : which === 'prev' ? { dir: -1 } : { index: Number(which) - 1 });
      }
      runId(r.action);
    },
    true,
  );
  return h(
    'button',
    { class: 'nav-btn cmd-nav', title: 'Command bar: type a ticker or a code like AAPL GP (press / or Ctrl+K)', 'aria-label': 'Command bar', 'aria-keyshortcuts': '/ Control+K Meta+K', onclick: () => openPalette() },
    icon('search', 22),
    h('span', { class: 'nav-label' }, 'Go ', h('kbd', { class: 'cmd-kbd' }, '/')),
  );
}

// ----- sources (refreshed when the palette opens) -----

let accountData: { at: number; portfolios: Sources['portfolios']; clients: Sources['clients']; holdings: SymbolEntry[] } | null = null;
async function loadAccounts(): Promise<void> {
  if (!helper.isConnected || (accountData && Date.now() - accountData.at < 60_000)) return;
  const [portfolios, clients] = await Promise.all([
    listDocs<Portfolio>('portfolios').catch(() => [] as (Portfolio & { id: string })[]),
    listDocs<{ name: string }>('clients').catch(() => [] as { name: string; id: string }[]),
  ]);
  const mine = myPortfolios(portfolios);
  accountData = {
    at: Date.now(),
    portfolios: portfolios.map((p) => ({ id: p.id, name: p.name, mine: mine.includes(p) })),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    holdings: combineHoldings(mine).filter((r) => r.kind === 'security' && normalizeTicker(r.symbol)).map((r) => ({ symbol: r.symbol, source: 'holding' as const })),
  };
}

const staticSymbols: SymbolEntry[] = [
  ...NASDAQ_100.map((s) => ({ symbol: s, source: 'nasdaq' as const })),
  ...FUTURES.map(([r, name]) => ({ symbol: `/${r}`, name, source: 'futures' as const })),
  ...Object.values(BOARDS).flatMap((groups) => groups.flatMap((g) => g.symbols.filter(([s]) => !s.startsWith('/')).map(([symbol, name]) => ({ symbol, name, source: 'board' as const })))),
];

function sources(search: SymbolEntry[]): Sources {
  return {
    symbols: [
      ...state.watchlist.map((r) => ({ symbol: r.symbol, source: 'watchlist' as const })),
      ...(accountData?.holdings ?? []),
      ...staticSymbols,
      ...search,
    ],
    pages: deps?.pages ?? [],
    portfolios: accountData?.portfolios ?? [],
    clients: accountData?.clients ?? [],
    actions: ACTIONS,
  };
}

// ----- running a command -----

const refFor = (symbol: string): MarketRef | null => (symbol.startsWith('/') ? null : guessMarket(symbol));

/** Carries out a command id: page:route, fn:CODE, tk:SYMBOL:CODE, pf:id (a model), ac:id (my account), cl:id, act:name, set:section. */
export async function runId(id: string) {
  const d = deps;
  if (!d) return;
  const [kind, ...rest] = id.split(':');
  const arg = rest.join(':');
  if (kind === 'page') location.hash = `#${arg}`;
  else if (kind === 'fn') runCode(arg, null);
  else if (kind === 'tk') {
    const cut = arg.lastIndexOf(':');
    runCode(arg.slice(cut + 1), arg.slice(0, cut));
  } else if (kind === 'pf') d.openPage('portfolio', 'open', arg);
  else if (kind === 'ac') d.openPage('account', 'open', arg);
  else if (kind === 'cl') d.openPage('clients', 'open', arg);
  else if (kind === 'set') (await import('./settings')).openSettings(arg);
  else if (kind === 'act') runAction(arg);
}

function chartRef(): MarketRef | null {
  const symbol = state.symbols[state.provider];
  return symbol ? { provider: state.provider, symbol } : null;
}

async function runAction(name: string) {
  const d = deps!;
  if (name === 'alert') {
    const { openAlertsDialog } = await import('./alerts');
    openAlertsDialog(d.currentRoute() === 'chart' ? (chartRef() ?? undefined) : undefined);
  } else if (name === 'ticket') {
    const ref = chartRef();
    const { openOrderTicket } = await import('../trade/webull');
    if (ref?.provider === 'schwab' && !/^[$/^]/.test(ref.symbol)) openOrderTicket({ symbol: ref.symbol, side: 'BUY' });
    else location.hash = '#trade';
  } else if (name === 'ai-summary') {
    const btn = [...document.querySelectorAll<HTMLButtonElement>('.views .ai-btn')].find((b) => b.offsetParent !== null && !b.disabled);
    if (btn) btn.click();
    else {
      toast('This page has no AI summary button, so the question is ready in the assistant');
      prefillAssistant('Summarise what is on my screen right now, in plain language.');
    }
  } else if (name === 'ai') d.toggleAssistant();
  else if (name === 'sync') {
    toast('Syncing Webull accounts…');
    const { syncAccounts } = await import('../portfolio/webullView');
    await syncAccounts('');
    accountData = null;
  } else if (name === 'health') d.openHealth();
  else if (name === 'connection') (await import('./settings')).openSettings('connection');
  else if (name === 'shortcuts') openShortcutSheet();
}

async function runCode(code: string, symbol: string | null) {
  const d = deps!;
  const c = findCode(code);
  if (!c) return;
  if (!symbol) {
    if (c.code === 'HELP') return openShortcutSheet();
    if (c.code === 'ALRT') {
      // on the Workspace: the panel last clicked or focused
      const ref = location.hash === '#chart/multi' ? (await import('../pages/workspacePage')).activeWorkspaceRef() : null;
      return (await import('./alerts')).openAlertsDialog(ref ?? undefined);
    }
    if (c.code === 'BONDS') return d.openPage('invest', 'open', 'bonds');
    if (CODE_ROUTE[c.code]) location.hash = `#${CODE_ROUTE[c.code]}`;
    return;
  }
  if (symbol.startsWith('/')) return d.openPage('futures', 'open', symbol.slice(1));
  const ref = refFor(symbol);
  if (c.code === 'GP') return ref && d.openChart(ref);
  if (c.code === 'DES') return d.openPage('research', 'open', symbol, 'overview');
  if (c.code === 'FA') return d.openPage('research', 'open', symbol, 'financials');
  if (c.code === 'CN') return openNews(symbol);
  if (c.code === 'OMON') return d.openPage('flow', 'open', symbol, 'options');
  if (c.code === 'TRADE') return (await import('../trade/webull')).openOrderTicket({ symbol, side: 'BUY' });
  if (c.code === 'ALRT') return (await import('./alerts')).openAlertsDialog(ref ?? undefined);
  if (c.code === 'WL' && ref) {
    if (state.watchlist.some((r) => r.provider === ref.provider && r.symbol === ref.symbol)) return toast(`${symbol} is already on your watchlist`);
    state.watchlist.push(ref);
    persist();
    toast(`Added ${symbol} to your watchlist`);
    return;
  }
  if (CODE_ROUTE[c.code]) location.hash = `#${CODE_ROUTE[c.code]}`;
}

/** CN for a ticker: its latest headlines (Google News and CNBC through the helper); a headline opens its summary. */
function openNews(symbol: string) {
  const list = h('div', { class: 'cmd-news' }, h('div', { class: 'muted pad' }, 'Loading headlines…'));
  openModal(`${symbol} news`, list, { wide: true, noAutofocus: true });
  loadNews([symbol]).then(
    async ({ items }) => {
      const { openNewsSummary } = await import('./newsSummary');
      const rows = items.sort((a, b) => b.published - a.published).slice(0, 20);
      list.replaceChildren(
        ...(rows.length
          ? rows.map((item) =>
              h('button', { type: 'button', class: 'cmd-news-row', onclick: () => openNewsSummary(item) }, h('b', {}, item.title), h('span', { class: 'muted small' }, `${item.source} · ${timeAgo(item.published)}`)),
            )
          : [h('div', { class: 'muted pad' }, 'No recent headlines.')]),
      );
    },
    () => list.replaceChildren(h('div', { class: 'muted pad' }, 'News appears when the helper is running.')),
  );
}

// ----- the palette -----

/**
 * Opens the command bar. With a scope (a focused panel), choosing a ticker changes that panel and every panel of its
 * link colour instead of opening the Chart page; other commands work as usual.
 */
export function openPalette(opts: { scope?: { id: string; label: string } | null; text?: string } = {}) {
  if (closePalette) return;
  const scope = opts.scope ?? null;
  const before = document.activeElement as HTMLElement | null;
  let recents = loadRecents();
  let search: SymbolEntry[] = [];
  let groups: ResultGroup[] = [];
  let items: ResultItem[] = [];
  let active = 0;
  let previewSym: string | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;

  const input = h('input', {
    class: 'cmd-input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'cmd-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Command: a ticker, a code like AAPL GP, or a page',
    placeholder: scope ? 'Ticker for this panel’s group (Enter), or any command…' : 'Ticker, code (AAPL GP, WEI, ECO) or page…',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
  });
  const list = h('div', { class: 'cmd-list', id: 'cmd-list', role: 'listbox', 'aria-label': 'Results' });
  const preview = h('div', { class: 'cmd-preview', hidden: true, 'aria-live': 'polite' });
  const status = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const box = h(
    'div',
    { class: 'cmd', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command bar' },
    scope ? scopeLine(scope) : '',
    h('div', { class: 'cmd-head' }, icon('search', 18), input, h('button', { type: 'button', class: 'cmd-kbd cmd-close', tabindex: -1, 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close() }, 'Esc')),
    h('div', { class: 'cmd-body' }, list, preview),
    h('div', { class: 'cmd-foot muted tiny' }, '↑↓ move · Enter run · Tab complete · Esc close · ? all shortcuts'),
    status,
  );
  const backdrop = h('div', { class: 'cmd-backdrop', onmousedown: (e: Event) => e.target === backdrop && close() }, box);

  function close(refocus = true) {
    clearTimeout(previewTimer);
    clearTimeout(searchTimer);
    backdrop.remove();
    closePalette = null;
    if (refocus && before?.isConnected) before.focus({ preventScroll: true });
  }
  closePalette = () => close();

  function render(keepId?: string) {
    groups = buildResults(input.value, sources(search), recents);
    items = flatten(groups);
    const keep = keepId ? items.findIndex((i) => i.id === keepId) : -1;
    active = keep >= 0 ? keep : 0;
    let n = 0;
    list.replaceChildren(
      ...groups.map((g, gi) =>
        h(
          'div',
          { class: 'cmd-group', role: 'group', 'aria-labelledby': `cmd-g${gi}` },
          h('div', { class: 'cmd-group-head', id: `cmd-g${gi}`, role: 'presentation' }, g.label),
          ...g.items.map((it) => {
            const i = n++;
            return h(
              'div',
              { class: 'cmd-opt', id: `cmd-o${i}`, role: 'option', 'aria-selected': 'false', onmousedown: (e: Event) => e.preventDefault(), onclick: () => choose(i), onmousemove: () => i !== active && select(i) },
              h('span', { class: 'cmd-title' }, it.title),
              it.subtitle ? h('span', { class: 'cmd-sub muted small' }, it.subtitle) : null,
              it.hint ? h('kbd', { class: 'cmd-hint' }, it.hint) : null,
            );
          }),
        ),
      ),
    );
    if (!items.length) list.append(h('div', { class: 'muted pad small' }, 'Nothing matches. Try a ticker (AAPL), a code (GP, DES, ECO) or a page name.'));
    status.textContent = items.length ? `${items.length} results` : 'No results';
    select(active);
  }

  function select(i: number) {
    active = Math.max(0, Math.min(i, items.length - 1));
    list.querySelectorAll('.cmd-opt').forEach((el, j) => {
      el.classList.toggle('active', j === active);
      el.setAttribute('aria-selected', String(j === active));
    });
    const el = list.querySelector<HTMLElement>(`#cmd-o${active}`);
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
    showPreview(items[active]?.symbol ?? null);
  }

  function showPreview(symbol: string | null) {
    if (symbol === previewSym) return;
    previewSym = symbol;
    clearTimeout(previewTimer);
    if (!symbol) {
      preview.hidden = true;
      preview.replaceChildren();
      return;
    }
    previewTimer = setTimeout(() => {
      preview.replaceChildren(tickerPreview(symbol));
      preview.hidden = false;
    }, 200);
  }

  function choose(i: number) {
    const it = items[i];
    if (!it) return;
    const linked = scope && /^tk:(.+):GP$/.exec(it.id);
    if (scope && linked) {
      close(true); // back to the panel
      links.set(scope.id, linked[1]);
      return;
    }
    recents = pushRecent(recents, { id: it.id, title: it.title, subtitle: it.subtitle });
    saveRecents(recents);
    close(false);
    void runId(it.id);
  }

  function queueSearch() {
    clearTimeout(searchTimer);
    const mine = ++searchSeq; // first, so a reply for older text is dropped even when no new search starts
    const q = input.value.trim();
    if (q.length < 2 || q.includes(' ') || !helper.isConnected) return;
    searchTimer = setTimeout(() => {
      engineRequest<{ results: { symbol: string; name: string }[] }>('invest.search', { query: q }, 15000).then(
        (r) => {
          if (mine !== searchSeq || !backdrop.isConnected) return;
          search = r.results.filter((x) => normalizeTicker(x.symbol)).map((x) => ({ symbol: x.symbol, name: x.name, source: 'search' as const }));
          render(items[active]?.id);
        },
        () => {},
      );
    }, 300);
  }

  input.addEventListener('input', () => {
    search = [];
    render();
    queueSearch();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) select((active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Home' && e.ctrlKey) select(0);
    else if (e.key === 'End' && e.ctrlKey) select(items.length - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (input.value) {
        input.value = '';
        search = [];
        render();
      } else close();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // focus stays in the bar; Tab completes instead
      e.stopPropagation(); // and no dialog's Tab trap underneath moves focus
      const it = items[active];
      if (it && !e.shiftKey && input.value !== it.complete) {
        input.value = it.complete;
        search = [];
        render();
        queueSearch();
      }
    }
  });

  document.body.append(backdrop);
  if (opts.text) input.value = opts.text;
  render();
  if (opts.text) queueSearch();
  input.focus();
  loadAccounts().then(() => backdrop.isConnected && render(items[active]?.id), () => {});
}

/** The palette's note when it is scoped to a panel: which group a ticker will change. */
function scopeLine(scope: { id: string; label: string }) {
  const c = links.colorOf(scope.id);
  return h(
    'div',
    { class: 'cmd-scope small' },
    h('i', { class: 'link-dot', 'data-color': c }),
    c === 'none' ? `${scope.label} (not linked): a ticker changes just this panel` : `${scope.label} · ${LINK_LABELS[c]} group: a ticker changes every ${LINK_LABELS[c]} panel`,
  );
}

// ----- the shortcut sheet -----

export function openShortcutSheet() {
  const body = h(
    'div',
    { class: 'shortcut-sheet' },
    ...SHORTCUT_SHEET.map((s) =>
      h('section', {}, h('h3', {}, s.title), h('dl', {}, ...s.rows.flatMap(([k, what]) => [h('dt', {}, ...k.split('  or  ').flatMap((part, i) => [i ? ' or ' : '', h('kbd', {}, part)])), h('dd', {}, what)]))),
    ),
    h(
      'section',
      {},
      h('h3', {}, 'Function codes (type in the command bar)'),
      h('dl', {}, ...CODES.flatMap((c) => [h('dt', {}, h('kbd', {}, c.code), ...(c.aliases ?? []).flatMap((a) => [' ', h('kbd', {}, a)])), h('dd', {}, `${c.label}${c.ticker ? (c.tickerOnly ? ' (after a ticker: AAPL WL)' : ' (alone, or after a ticker: AAPL ' + c.code + ')') : ''}`)])),
    ),
    h('p', { class: 'muted small' }, 'Shortcuts don’t fire while you type in a box. No key ever places an order: the Trade page’s confirm window always needs its button.'),
  );
  openModal('Keyboard shortcuts', body, { wide: true, noAutofocus: true });
}
