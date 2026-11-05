/**
 * The navigation registry: every page in one list, grouped into six sections. The rail shows the sections, each
 * page shows its section's pages as a sub-tab row, and the command bar, launchpad and AI read the same list.
 *
 * Adding a page: add one entry here (route, section, label, a short unique code and keywords) and its loader in
 * main.ts (LOADERS, typed by PageRoute, so the build fails if one is missing). Pure and tested (nav.test.ts).
 */
import type { IconName } from './icons';

export type SectionId = 'markets' | 'analyze' | 'money' | 'business' | 'ai';

export interface Section {
  id: SectionId;
  label: string;
  icon: IconName;
  /** One line for the launchpad and tooltips. */
  about: string;
}

export const SECTIONS: readonly Section[] = [
  { id: 'markets', label: 'Markets', icon: 'macro', about: 'What the market is doing: indexes, investments, futures, the economy and money flows' },
  { id: 'analyze', label: 'Analyze', icon: 'research', about: 'Charts, company research, trade setups and strategy testing' },
  { id: 'money', label: 'Money', icon: 'account', about: 'Your own accounts, model portfolios, orders and journal' },
  { id: 'business', label: 'Business', icon: 'clients', about: 'Clients, reports and prospecting for the advisory business' },
  { id: 'ai', label: 'AI', icon: 'spark', about: 'The AI assistant: ask about anything on screen' },
];

export interface NavPage {
  /** The hash route (#invest). */
  route: string;
  section: SectionId;
  /** The sub-tab label. */
  label: string;
  /** The browser tab title ('' = the page sets its own). */
  title: string;
  /** Bloomberg-style function code, unique across pages ('' for hidden pages). */
  code: string;
  icon: IconName;
  /** Extra words people may search for. */
  keywords: string;
  /** One line for the launchpad. */
  about: string;
  /** Reached by links and codes only (not a sub-tab). */
  hidden?: boolean;
}

export const PAGES = [
  // Markets
  { route: 'home', section: 'markets', label: 'Home', title: 'Trading Platform', code: 'BRF', icon: 'home', keywords: 'dashboard brief widgets indexes news morning', about: 'Your dashboard: brief, indexes, news, setups and accounts' },
  { route: 'invest', section: 'markets', label: 'Investments', title: 'Investments', code: 'INV', icon: 'invest', keywords: 'stocks etfs bonds alternatives private funds boards', about: 'Stocks, ETFs, bonds, alternatives and private funds' },
  { route: 'futures', section: 'markets', label: 'Futures', title: 'Futures', code: 'FUT', icon: 'futures', keywords: 'contracts commodities term structure cot', about: 'The futures market by sector, curves and positioning' },
  { route: 'macro', section: 'markets', label: 'Macro', title: 'Macro', code: 'MACRO', icon: 'macro', keywords: 'economy fred rates inflation yields', about: 'The economy at a glance (FRED, Treasury)' },
  { route: 'calendar', section: 'markets', label: 'Calendar', title: 'Economic calendar', code: 'ECO', icon: 'calendar', keywords: 'economic releases fomc events', about: 'This week’s economic releases and FOMC dates' },
  { route: 'flow', section: 'markets', label: 'Flow', title: 'Flow', code: 'FLOW', icon: 'flow', keywords: 'short selling options insiders smart money', about: 'Short selling, options and insiders' },
  // Analyze
  { route: 'chart', section: 'analyze', label: 'Chart', title: '', code: 'GP', icon: 'chart', keywords: 'graph price candles indicators drawings', about: 'The full chart with indicators and drawings' },
  { route: 'research', section: 'analyze', label: 'Research', title: 'Research', code: 'RES', icon: 'research', keywords: 'company financials sec valuation ratios', about: 'Company financials, ratios and valuation' },
  { route: 'setups', section: 'analyze', label: 'Setups', title: 'Setups', code: 'SET', icon: 'target', keywords: 'scanner signals nasdaq trade ideas', about: 'Nasdaq-100 trade setups, tested after costs' },
  { route: 'backtest', section: 'analyze', label: 'Backtest', title: 'Backtest', code: 'BTST', icon: 'backtest', keywords: 'strategy test monte carlo sweep', about: 'Test a strategy on history, then stress-test it' },
  { route: 'strategy', section: 'analyze', label: 'Strategy Lab', title: 'Strategy Lab', code: 'LAB', icon: 'code', keywords: 'strategy lab build rules walk forward', about: 'Build and check your own strategies' },
  { route: 'sec', section: 'analyze', label: 'Security', title: 'Security', code: '', icon: 'research', keywords: 'security view', about: 'One security in depth', hidden: true },
  // Money
  { route: 'account', section: 'money', label: 'Account', title: 'Account', code: 'ACCT', icon: 'account', keywords: 'holdings dividends total value my money', about: 'Your real accounts added together' },
  { route: 'portfolio', section: 'money', label: 'Portfolios', title: 'Portfolios', code: 'PORT', icon: 'portfolio', keywords: 'model optimizer what-if', about: 'Model portfolios, what-ifs and the optimizer' },
  { route: 'trade', section: 'money', label: 'Trade', title: 'Trade', code: 'TRADE', icon: 'trade', keywords: 'order ticket webull buy sell positions', about: 'Orders and positions (preview, then confirm)' },
  { route: 'journal', section: 'money', label: 'Journal', title: 'Trading journal', code: 'JRNL', icon: 'journal', keywords: 'trades diary review playbook win rate', about: 'Your trades: statistics, calendar, playbooks' },
  // Business
  { route: 'clients', section: 'business', label: 'Clients', title: 'Clients & Reports', code: 'CLIENT', icon: 'clients', keywords: 'client report household ria fees', about: 'Client accounts and performance reports' },
  { route: 'prospect', section: 'business', label: 'Prospects', title: 'Prospecting', code: 'PROS', icon: 'prospect', keywords: 'prospecting ria family office form adv 13f lead', about: 'RIAs and family offices from SEC filings' },
] as const satisfies readonly NavPage[];

export type PageRoute = (typeof PAGES)[number]['route'];

/** Functions that aren't pages: a page's mode, the AI, settings and the data list. `target` is a command id (command.ts runId). */
export interface NavFunction {
  code: string;
  label: string;
  section: SectionId | 'system';
  icon: IconName;
  keywords: string;
  target: string;
}

export const FUNCTIONS: readonly NavFunction[] = [
  { code: 'WEI', label: 'World indices', section: 'markets', icon: 'chart', keywords: 'indexes indices markets home', target: 'page:home' },
  { code: 'COT', label: 'COT positioning', section: 'markets', icon: 'positioning', keywords: 'commitment traders hedgers cftc', target: 'page:futures/cot' },
  { code: 'BONDS', label: 'Bonds and yields', section: 'markets', icon: 'invest', keywords: 'treasuries yields auctions cusip', target: 'fn:BONDS' },
  { code: 'DES', label: 'Security overview', section: 'analyze', icon: 'research', keywords: 'company profile security description add a ticker aapl des', target: 'fn:DES' },
  { code: 'MULTI', label: 'Workspace', section: 'analyze', icon: 'grid', keywords: 'multi chart grid side by side linked panels', target: 'page:chart/multi' },
  { code: 'SCRIPT', label: 'Scripts', section: 'analyze', icon: 'code', keywords: 'pine script editor indicator code', target: 'page:chart/scripts' },
  { code: 'ALRT', label: 'Alerts', section: 'analyze', icon: 'bell', keywords: 'alert notify price', target: 'act:alert' },
  { code: 'FO', label: 'Family offices', section: 'business', icon: 'prospect', keywords: 'family office single multi prospect', target: 'fn:FO' },
  { code: 'RIA', label: 'Registered advisers', section: 'business', icon: 'prospect', keywords: 'ria registered investment adviser', target: 'fn:RIA' },
  { code: 'AI', label: 'AI assistant', section: 'ai', icon: 'spark', keywords: 'ask claude chat explain', target: 'act:ai' },
  { code: 'AISUM', label: 'AI page summary', section: 'ai', icon: 'spark', keywords: 'insight explain summary', target: 'act:ai-summary' },
  { code: 'DATA', label: 'Data health', section: 'system', icon: 'pulse', keywords: 'diagnostics status feeds schwab sec webull', target: 'act:health' },
  { code: 'PREF', label: 'Settings', section: 'system', icon: 'gear', keywords: 'settings preferences keys theme', target: 'set:' },
  { code: 'PUP', label: 'Market buddy (show or hide)', section: 'system', icon: 'spark', keywords: 'dog pet buddy mascot bull', target: 'act:buddy' },
  { code: 'HELP', label: 'Keyboard shortcuts', section: 'system', icon: 'info', keywords: 'help keys shortcuts', target: 'act:shortcuts' },
];

/** Every route the app answers. */
export const ROUTES: readonly string[] = PAGES.map((p) => p.route);

export const pageOf = (route: string): NavPage | undefined => (PAGES as readonly NavPage[]).find((p) => p.route === route);

/** The pages shown as sub-tabs for a section. */
export const sectionPages = (id: SectionId): NavPage[] => (PAGES as readonly NavPage[]).filter((p) => p.section === id && !p.hidden);

export const sectionOf = (route: string): SectionId => pageOf(route)?.section ?? 'markets';

/** Which page a rail section opens: the one last visited there (when it is still a page of that section), else its first. */
export function sectionTarget(id: SectionId, last: Partial<Record<SectionId, string>> = {}): string | null {
  const pages = sectionPages(id);
  const remembered = last[id];
  if (remembered && pages.some((p) => p.route === remembered.split('/')[0])) return remembered;
  return pages[0]?.route ?? null;
}
