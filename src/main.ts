import './installLocaleGuard';
import './style.css';
import { createChartPage } from './pages/chartPage';
import { createHomePage } from './pages/homePage';
import { createAssistant, type AssistantAction, type AssistantActions } from './ai/assistant';
import { confirmationFor, needsConfirmation, runAction as runUiAction, setUndoPrefix, undoActions, type ActionResult } from './ai/actions';
import { ACTION_TAB_KEY, addressedTo, groupByOwner } from './ai/tabs';
import { createActionEnv } from './ai/actionsEnv';
import { setAssistantHub } from './ai/hub';
import { guessMarket, type MarketRef } from './data/quotes';
import { LATEST_HELPER_VERSION, helper } from './data/schwab';
import { allIndicators } from './indicators/library';
import { persist, state } from './state';
import { TIMEFRAMES, type Timeframe } from './types';
import { createPriceAlert, openAlertsDialog, startAlertWatcher } from './ui/alerts';
import { h, toast, openPopover } from './ui/dom';
import { startAutoReload } from './ui/autoReload';
import { icon } from './ui/icons';
import { PAGES as NAV_PAGES, SECTIONS, pageOf, sectionPages, sectionTarget, type NavPage, type PageRoute, type SectionId } from './ui/nav';
import { openLaunchpad } from './ui/launchpad';
import { createStatusBar } from './ui/statusBar';
import { openSettings } from './ui/settings';
import { initTheme } from './ui/theme';
import { initAtmosphere, markRoute } from './ui/atmosphere';
import { buddySettings, initBuddy } from './ui/buddy';
import { PAGE_SUGGESTIONS, screenText } from './ai/screen';
import { followHealth, openDataHealth } from './ui/dataHealth';
import { initTickerCards } from './ui/tickerCard';
import { initCommandBar, openPalette, runId } from './ui/command';
import { captureConsoleErrors } from './diagnostics';
import { resolveHash } from './routes';
import { createSecurityPage, initSecurity, openSecurity } from './security/open';
import { STRATEGY_PAGE } from './strategy/nav';

captureConsoleErrors(); // kept for Settings > Send diagnostics

initTheme();
initAtmosphere();
initBuddy();

interface Page {
  el: HTMLElement;
  /** sub = the part of the hash after the page ("multi" in #chart/multi). */
  start(sub?: string): void;
  stop?(): void;
}

/** The pop-out AI window shows only the assistant, so it doesn't build (or save state from) the pages. */
const isAiWindow = location.hash === '#ai-window';

let chartPage: ReturnType<typeof createChartPage> | null = null;
/** Where pages are added when they're first built. */
let appViews: HTMLElement | null = null;
/** Counts page switches, so a slow-loading page doesn't appear after the user moved on. */
let routeRequest = 0;
/** Updates the rail and sub-tabs for the page shown (set once the shell is built). */
let shellRoute: (route: string, hash: string) => void = () => {};
/** The chart page is built on first use (opening a chart from anywhere, or the AI adding an indicator). */
function getChartPage() {
  chartPage ??= createChartPage();
  return chartPage;
}

const openChart = (ref: MarketRef) => {
  getChartPage().open(ref);
  location.hash = '#chart';
};

/** Opens the Research page on a company (from the Investments page, for example). */
const openResearch = (symbol: string) => openPageWith('research', 'open', symbol);

/** Opens a saved portfolio on the Portfolios page (from the Account page: "Analyse in Portfolios"). */
const openPortfolio = (id: string) => openPageWith('portfolio', 'open', id);

/** Goes to a page and, once it's built, calls one of its methods (e.g. the Research page's open(symbol, tab)). */
function openPageWith(route: string, method?: string, ...args: unknown[]) {
  const entry = pages.find((p) => p.route === route);
  if (!entry) return;
  location.hash = `#${route}`;
  if (method) ensurePage(entry).then((page) => (page as unknown as Record<string, ((...a: unknown[]) => void) | undefined>)[method]?.(...args));
}

/** The chart's Backtest button: open the backtester with the chart's symbol, timeframe and indicators. */
window.addEventListener('tp:backtest-chart', () => {
  const entry = pages.find((p) => p.route === 'backtest');
  if (!entry) return;
  location.hash = '#backtest';
  ensurePage(entry).then((page) => (page as Page & { fromChart?(): void }).fromChart?.());
});

/** "Journal this trade" (Trade fills, ticker card, security view): the journal on that symbol (detail: {symbol, orderId?, sync?}). */
window.addEventListener('tp:open-journal', (e) => openPageWith('journal', 'open', (e as CustomEvent).detail ?? {}));

/** "See all on Futures" from a COT summary line: the Futures page's COT panel on that market (or stock). */
window.addEventListener('tp:open-cot', (e) => openPageWith('futures', 'openCot', (e as CustomEvent).detail ?? {}));

/**
 * Each page is built the first time it's opened (and its code downloaded then), so the platform starts
 * quickly instead of building every page at launch. Which pages exist, their section, label and code live in the
 * nav registry (src/ui/nav.ts); LOADERS says how to build each one (typed by PageRoute, so a registered page
 * without a loader fails the build).
 */
interface PageEntry extends NavPage {
  create: () => Page | Promise<Page>;
  page?: Page;
  loading?: Promise<Page>;
}

const LOADERS: Record<PageRoute, () => Page | Promise<Page>> = {
  home: () => createHomePage(openChart, () => (location.hash = '#calendar'), openPageWith),
  invest: async () => (await import('./pages/investmentsPage')).createInvestmentsPage({ openChart, openResearch, openPage: openPageWith }),
  futures: async () => (await import('./pages/futuresPage')).createFuturesPage(),
  macro: async () => (await import('./pages/macroPage')).createMacroPage(),
  calendar: async () => (await import('./pages/calendarPage')).createCalendarPage(),
  flow: async () => (await import('./pages/flowPage')).createFlowPage(),
  // Chart | Multi | Scripts are modes of one page (#chart, #chart/multi, #chart/scripts; #multi and #scripts redirect)
  chart: async () => (await import('./pages/chartWorkspace')).createChartWorkspace(getChartPage(), openChart, openResearch),
  research: async () => (await import('./pages/researchPage')).createResearchPage(),
  setups: async () => (await import('./pages/setupsPage')).createSetupsPage(openChart),
  backtest: async () => (await import('./pages/backtestPage')).createBacktestPage(),
  // the Strategy Lab (game theory + Equilibrium-Prime)
  strategy: STRATEGY_PAGE.load,
  // the security view (#sec/AAPL/FA): opened from any ticker (slide-over) and its "Full page" button
  sec: () => createSecurityPage(),
  account: async () => (await import('./pages/accountPage')).createAccountPage(openPortfolio, (id, kind) => openPageWith('trade', 'open', id, kind)),
  portfolio: async () => (await import('./pages/portfolioPage')).createPortfolioPage(),
  trade: async () => (await import('./pages/tradePage')).createTradePage(),
  journal: async () => (await import('./pages/journalPage')).createJournalPage(openChart),
  clients: async () => (await import('./pages/clientsPage')).createClientsPage(),
  prospect: async () => (await import('./pages/prospectPage')).createProspectPage(),
};

const pages: PageEntry[] = (NAV_PAGES as readonly NavPage[]).map((p) => ({ ...p, create: LOADERS[p.route as PageRoute] }));

// ---------- AI assistant ----------

const AI_CHANNEL = 'tp-ai-actions';

/** The route with its mode, e.g. 'chart/multi' (keys PAGE_SUGGESTIONS and tells the AI which Chart mode is open). */
function routeKey() {
  const { route, sub } = resolveHash(location.hash, ROUTES());
  return sub && route === 'chart' ? `${route}/${sub}` : route;
}
const MODE_LABELS: Record<string, string> = { 'chart/multi': 'Chart (Multi-chart mode)', 'chart/scripts': 'Chart (Scripts mode: indicator editor)' };

function aiContext(): Record<string, string> {
  const page = currentPage();
  const key = routeKey();
  return { page: MODE_LABELS[key] ?? page.label, route: key, symbol: state.symbols[state.provider] ?? '', timeframe: state.timeframe, screen: screenText(page.page?.el) };
}

/** Carries out something the AI asked for (open a chart, add an indicator, set an alert...). */
function runAction(a: AssistantAction) {
  if (a.action === 'refresh') {
    window.dispatchEvent(new CustomEvent('tp:data-changed', { detail: a.what }));
    return;
  }
  if (a.action === 'open_page' && a.page) {
    location.hash = `#${a.page}`;
    return;
  }
  if (a.action === 'open_chart' && a.symbol) {
    const ref = guessMarket(a.symbol);
    if (!ref) return;
    if (a.timeframe && (TIMEFRAMES as string[]).includes(a.timeframe)) {
      state.timeframe = a.timeframe as Timeframe;
      persist();
    }
    openChart(ref);
    return;
  }
  if (a.action === 'add_indicator' && a.indicator) {
    const q = a.indicator.toLowerCase();
    const defs = allIndicators();
    const def = defs.find((d) => d.shortName.toLowerCase() === q || d.name.toLowerCase() === q) ?? defs.find((d) => `${d.name} ${d.shortName}`.toLowerCase().includes(q));
    if (!def) return toast(`Couldn't find an indicator called "${a.indicator}"`);
    getChartPage().addIndicatorById(def.id);
    location.hash = '#chart';
    toast(`Added ${def.name}`);
    return;
  }
  if (a.action === 'create_alert' && a.symbol && typeof a.price === 'number') {
    const ref = guessMarket(a.symbol);
    if (!ref) return;
    const condition = a.direction === 'below' ? 'below' : 'above';
    createPriceAlert(ref, condition, a.price, a.note ?? 'Set by AI').then(
      (where) => toast(`🔔 Alert set: ${ref.symbol} ${condition} ${a.price}${where === 'helper' ? ' (works with the platform closed)' : ''}`),
      (err) => toast((err as Error).message),
    );
  }
}

let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel(AI_CHANNEL);
} catch {
  // Older browsers: the pop-out window simply can't control the main window.
}

/** The AI's platform actions (src/ai/actions.ts) carried out on this window's state and pages. */
const actionEnv = createActionEnv({
  syncChart: () => chartPage?.sync(),
  openChart,
  navigate: (route) => (location.hash = `#${route}`),
  currentRoute: routeKey,
  routes: ROUTES,
});
/** This tab's id: the pop-out AI window sends its actions to the main tab the owner focused last (src/ai/tabs.ts). */
const tabId = Math.random().toString(36).slice(2, 10);
setUndoPrefix(tabId);
const localActions: AssistantActions = {
  run: (name, args) => runUiAction(actionEnv, name, args),
  confirmation: async (name, args) => confirmationFor(actionEnv, name, args),
  undo: undoActions,
};

/** In the pop-out AI window the main platform window carries out the actions; this asks it and waits for the answer. */
function channelActions(ch: BroadcastChannel): AssistantActions {
  const waiting = new Map<string, (value: unknown) => void>();
  ch.addEventListener('message', (e) => {
    const d = e.data as { kind?: string; reqId?: string; value?: unknown };
    if (d?.kind === 'reply' && d.reqId && waiting.has(d.reqId)) {
      waiting.get(d.reqId)!(d.value);
      waiting.delete(d.reqId);
    }
  });
  const target = () => {
    try {
      return localStorage.getItem(ACTION_TAB_KEY) ?? '';
    } catch {
      return '';
    }
  };
  const ask = <T>(msg: Record<string, unknown>, fallback: T, to = target(), ms = 30000) =>
    new Promise<T>((resolve) => {
      if (!to) return resolve(fallback);
      const reqId = Math.random().toString(36).slice(2);
      waiting.set(reqId, resolve as (v: unknown) => void);
      ch.postMessage({ ...msg, reqId, target: to });
      setTimeout(() => waiting.delete(reqId) && resolve(fallback), ms);
    });
  const notDone = (name: string): ActionResult => ({ ok: false, name, message: 'The main platform window didn’t answer (is it open?), so nothing changed' });
  return {
    run: (name, args) => ask<ActionResult>({ kind: 'run', name, args }, notDone(name)),
    // Asked of the tab that will run it (its own state); if it can't answer, the owner is still asked.
    confirmation: (name, args) => ask<string | null>({ kind: 'confirm', name, args }, needsConfirmation(name) ? `Let the AI run "${name.replace(/_/g, ' ')}"?` : null, target(), 10000),
    undo: async (ids) => {
      let done = 0;
      for (const [owner, own] of groupByOwner(ids)) done += await ask<number>({ kind: 'undo', ids: own }, 0, owner);
      return done;
    },
  };
}

if (isAiWindow) {
  // The assistant in its own window: actions are carried out by the main platform window.
  document.title = 'AI Assistant · Trading Platform';
  document.body.classList.add('ai-window-body');
  const assistant = createAssistant({
    mode: 'window',
    getContext: () => ({ page: 'AI assistant window', symbol: state.symbols[state.provider] ?? '', timeframe: state.timeframe }),
    onAction: (a) => channel?.postMessage(a),
    actions: channel ? channelActions(channel) : undefined,
  });
  document.querySelector('#app')!.append(assistant.el);
  assistant.focus();
} else {
  const views = h('div', { class: 'views' });
  const updateBanner = h('div', { class: 'update-banner', hidden: true, role: 'status' });
  let bannerDismissed = false;
  let updateError = '';
  /** What the new helper adds, by the version you have. */
  const updateReason = (v: number) =>
    v < 6 ? 'Charts and prices work; Flow, Research, Macro, Portfolios, Investments and the AI need the update. ' : v < 8 ? 'The new Investments page (bonds, alternatives, private funds) and the new start screen need it. ' : v < 9 ? 'It starts faster and opens the platform in Chrome when it’s ready. ' : v < 10 ? 'It adds the market scanner, AI page summaries and corrected daily changes. ' : v < 11 ? 'The scanner now backtests the exact plan on each card, retries symbols after hiccups and is gentler on Schwab; Investments shows at-close values. ' : v < 12 ? 'It adds the Nasdaq-100 swing scanner (weekly swing with COT, z-score and Williams; mean reversion; breakouts) every 5 minutes, RIA fee schedules in client reports and fresher fund data. ' : v < 21 ? 'It adds the free Alpaca history option (Settings), a faster and steadier helper and fixes. ' : v < 22 ? 'It reworks the Setups scanner: honest tests (trades from the same week count as one bet, results after costs, corrected for many tests), 15 years of daily history, hourly history kept for good, simpler rules and weekly rule tests on your own data. ' : v < 23 ? 'The AI assistant can now see the page you’re on, so you can ask about anything on screen. ' : v < 24 ? 'It adds dividend tracking (import a statement, yields, income calendar). ' : v < 25 ? 'It fixes dividend estimates after raises and for twice-a-year payers. ' : v < 26 ? 'It adds Webull: view and sync your account, and place orders (Test first). ' : v < 27 ? 'It fixes Webull "too many requests" and adds the Trade page. ' : v < 28 ? 'It adds total return (with dividends) to Account, Investments and Research. ' : v < 29 ? 'It rebuilds the portfolio optimizer (shrinkage, risk parity, resampling, walk-forward test) and shows cash as Cash. ' : v < 30 ? 'It adds one-click helper updates and shows each Webull account (Roth IRA, Traditional IRA, Cash, Margin) separately, with a combined view, plus account risk, sectors and a tax view. ' : v < 31 ? 'It adds the Futures page: the whole futures market by sector, what’s moving, term structure and who is positioned how (COT), and futures trading in your Webull futures account (Trade page, Futures switch; off until you type FUTURES in Settings). Updates are checked every 10 minutes. ' : v < 32 ? 'It adds alerts that work with the platform closed, sent free to your phone by ntfy or Telegram (set up in Settings), and news on your holdings. The Account risk card opens charts of the daily swings behind its numbers. ' : v < 33 ? 'The portfolio optimizer now tests young holdings too: before a holding existed, its history is estimated from a similar long-running fund, and it shows how firmly the data pins down each suggested weight. The Account page adds dividends received and total gain per holding and account, display choices (% or $), a holding detail with purchase date and dividend entry, and an "Is the yield sustainable?" check with charts for high-yield funds. Futures prices are matched more reliably.' : v < 34 ? 'It adds Send diagnostics (Settings and the Data button): one file, with keys and account numbers masked, to upload in your Claude chat when something isn’t working. It adds a Sources check: a fund’s NAV or a price is compared across free sources (Schwab, SEC filings, Yahoo, Nasdaq), each shown with its time and link, plus a confidence meter. The portfolio optimizer gets professional goals (most diversified, hierarchical risk parity, smallest bad months, target volatility, income, stay close to a benchmark), advanced limits, an efficient frontier and a side-by-side test of every goal. ' : v < 35 ? 'It adds Prospecting (Business > Prospects): search, map and compare RIAs, exempt advisers, family offices and 13F managers from free SEC data, with notes and outreach status. ' : v < 36 ? 'It fixes the Prospecting download of the SEC Form ADV data (people and private funds). ' : v < 37 ? 'The weekly Schwab login now opens the login page by itself (no Enter key needed in the helper window). ' : v < 38 ? 'It makes Prospecting downloads complete and reliable (retry failed parts, 3 years of Form D, 2 years of 13F totals, current Form ADV owners and private funds from IAPD, state-registered advisers in beta). ' : v < 39 ? 'It fixes the Prospecting download of private funds from the SEC Form ADV data. ' : v < 40 ? 'It adds the Smart money chart indicators: insider buying and selling (SEC Form 4) and 13F institutional holders for a stock. ' : v < 41 ? 'It adds family offices from other public records (5%+ owners, foundations, legal-entity links, big sales) and firm contacts from their own websites with clear labels, an AI research analyst, a weekly change check, a review queue and a do-not-contact list (Prospects). ' : v < 42 ? 'The AI assistant can now make changes for you: open charts and stocks, switch time frames, add and tune indicators, set alerts and more, each with Undo (it never trades). ' : v < 43 ? 'It adds the trading journal (your past Webull trades imported, broker file imports, statistics, calendar, trade replay, playbooks, AI coach) and better fund/stock detection on Investments. ' : v < 44 ? 'It adds world economic data and prediction-market odds, plug-in data connections in Settings, the Strategy Lab (game theory), valuation and portfolio risk tools, options analytics and a faster, more reliable data layer. ' : v < 45 ? 'It fixes Webull screens that said the reply was "not in the expected format" (orders and account value now read correctly). ' : v < 46 ? 'From now on helper updates install by themselves at a quiet moment (no Update button); the version is shown at the bottom left. ' : 'It includes bug fixes. ';
  async function updateNow() {
    updateError = '';
    try {
      await helper.installUpdate();
    } catch (err) {
      updateError = (err as Error).message;
    }
    showUpdateBanner();
  }
  /** A slim notice when a newer helper is available; everything that works with the old one keeps working. */
  /** After the helper updated itself: a short note with the new version (the status bar keeps showing it). */
  function noteNewVersion() {
    const v = helper.version;
    if (v == null) return;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem('tp:helperVersionSeen')) || 0;
      localStorage.setItem('tp:helperVersionSeen', String(v));
    } catch {
      return; // no storage: skip the note rather than repeat it on every connect
    }
    if (seen && v > seen) toast(`Helper updated to v${v}`);
  }

  function showUpdateBanner() {
    const v = helper.version;
    const up = helper.update;
    const busy = up?.state === 'updating' || up?.state === 'restarting';
    // automatic updates: nothing to click, so no banner (the status bar shows the version and a note says when it changed);
    // a failed automatic update still shows the banner with its reason and a Try again button
    const automatic = !!up?.auto && up.state !== 'failed' && !updateError;
    updateBanner.hidden = v == null || automatic || (!busy && (bannerDismissed || !helper.outdated));
    if (updateBanner.hidden || v == null) return;
    const dismiss = h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => ((bannerDismissed = true), showUpdateBanner()) }, '✕');
    if (!up) {
      // Helpers older than the self-update need one last manual download.
      updateBanner.replaceChildren(
        h('span', {}, h('b', {}, `Helper update available (you have version ${v}, newest is ${LATEST_HELPER_VERSION}). `), updateReason(v), 'After this one, updates are a single click. '),
        h('a', { href: 'https://github.com/cadenb777-jpg/Trading-Platform', target: '_blank', rel: 'noopener' }, 'Get it: Code → Download ZIP, replace your helper folder, restart it'),
        dismiss,
      );
      return;
    }
    if (busy) {
      updateBanner.replaceChildren(h('span', {}, h('b', {}, up.message || 'Updating the helper...'), up.state === 'restarting' ? ' The page reconnects by itself in a few seconds.' : ' Keep the helper window open.'));
      return;
    }
    const error = updateError || (up.state === 'failed' ? up.message : '');
    updateBanner.replaceChildren(
      h('span', {}, h('b', {}, `Update available (v${v} → v${up.latest}). `), error ? `${error} ` : updateReason(v)),
      h('button', { class: 'btn small primary', onclick: () => void updateNow() }, error ? 'Try again' : 'Update now'),
      dismiss,
    );
  }
  appViews = views;
  const drawer = h('aside', { class: 'ai-drawer', hidden: true, 'aria-label': 'AI assistant' });
  const assistant = createAssistant({
    mode: 'drawer',
    getContext: aiContext,
    getSuggestions: () => PAGE_SUGGESTIONS[routeKey()] ?? [],
    onAction: runAction,
    actions: localActions,
    onClose: () => toggleAssistant(false),
    onPopOut: () => {
      window.open(`${location.pathname}#ai-window`, 'tp-ai', 'popup,width=520,height=860');
      toggleAssistant(false);
    },
  });
  drawer.append(assistant.el);
  // The pop-out AI window's requests: platform actions (with a reply) or, from older pages, one-way actions.
  // Only the main tab the owner focused last answers the pop-out (so nothing runs twice in two tabs).
  const claimActions = () => {
    try {
      localStorage.setItem(ACTION_TAB_KEY, tabId);
    } catch {
      // private window: the pop-out then can't reach this tab
    }
  };
  window.addEventListener('focus', claimActions);
  try {
    if (document.hasFocus() || !localStorage.getItem(ACTION_TAB_KEY)) claimActions();
  } catch {
    // storage unavailable
  }
  // The pop-out AI window's requests: platform actions (with a reply) or, from older pages, one-way actions.
  channel?.addEventListener('message', async (e) => {
    const d = e.data as { kind?: string; reqId?: string; target?: string; name?: string; args?: Record<string, unknown>; ids?: string[] };
    if (!d?.kind) return runAction(e.data as AssistantAction);
    if (!addressedTo(d, tabId)) return;
    const reply = (value: unknown) => channel?.postMessage({ kind: 'reply', reqId: d.reqId, value });
    if (d.kind === 'run') reply(await localActions.run(String(d.name), d.args ?? {}));
    else if (d.kind === 'confirm') reply(await localActions.confirmation(String(d.name), d.args ?? {}));
    else if (d.kind === 'undo') reply(await localActions.undo(d.ids ?? []));
  });

  initSecurity({ openChart, openPage: openPageWith });
  initTickerCards({ openChart, openResearch, openSecurity: (s) => void openSecurity(s) });

  // ---------- the shell: section rail, sub-tabs, command field, launchpad, status bar ----------

  const railBtn = (cls: string, label: string, iconName: Parameters<typeof icon>[0], title: string, onclick: (e: Event) => void, extra: Record<string, string> = {}) =>
    h('button', { type: 'button', class: `nav-btn ${cls}`, title, 'aria-label': label, onclick, ...extra }, icon(iconName, 20), h('span', { class: 'nav-label' }, label));

  const aiBtn = railBtn('ai-nav rail-sec', 'AI', 'spark', 'AI assistant (Ctrl+I)', () => toggleAssistant(), { 'aria-keyshortcuts': 'Control+I Meta+I', 'data-section': 'ai' });
  function toggleAssistant(show: boolean = drawer.hidden === true) {
    drawer.hidden = !show;
    aiBtn.classList.toggle('active', show);
    aiBtn.setAttribute('aria-pressed', String(show));
    document.body.classList.toggle('ai-open', show);
    if (show) {
      assistant.reload();
      assistant.focus();
    }
    window.dispatchEvent(new Event('resize'));
  }
  setAssistantHub({
    open: (question) => {
      toggleAssistant(true);
      if (question) assistant.ask(question);
    },
    prefill: (text) => {
      toggleAssistant(true);
      assistant.prefill(text);
    },
    continueConversation: (conversation, title, answer) => {
      assistant.continueConversation(conversation, title, answer);
      toggleAssistant(true);
    },
  });

  const healthDot = h('span', { class: 'health-badge', 'aria-hidden': 'true' });
  const healthBtn = railBtn('health-nav rail-util', 'Data', 'pulse', 'Data health: when each feed last updated', () => openDataHealth(healthBtn));
  healthBtn.append(healthDot);
  followHealth(healthDot);
  const launch = () => openLaunchpad((id) => void runId(id));

  // The command bar (/ or Ctrl/Cmd+K), the launchpad (Ctrl/Cmd+L) and the global shortcuts (g h, n a, ?, Ctrl/Cmd+I)
  initCommandBar({
    pages: [
      ...pages.filter((p) => !p.hidden).map((p) => ({ route: p.route, label: p.label, code: p.code, keywords: p.keywords, group: SECTIONS.find((s) => s.id === p.section)?.label })),
      // the Chart page's modes (they used to be pages)
      { route: 'chart/multi', label: 'Workspace (linked panels)', group: 'Chart mode' },
      { route: 'chart/scripts', label: 'Scripts (indicator editor)', group: 'Chart mode' },
      { route: 'prospect/map', label: 'Prospect map (radius search)', group: 'Prospecting' },
      { route: 'prospect/compare', label: 'Compare prospects', group: 'Prospecting' },
      { route: 'prospect/data', label: 'Prospect data downloads', group: 'Prospecting' },
    ],
    currentRoute: () => currentPage().route,
    openChart,
    openPage: openPageWith,
    toggleAssistant: () => toggleAssistant(),
    openHealth: () => openDataHealth(healthBtn),
    openLaunchpad: launch,
  });

  // The rail: the six sections (the AI is the fifth; Settings and Data sit at the bottom), collapsible to icons.
  const RAIL_KEY = 'tp-rail-collapsed';
  const LAST_KEY = 'tp-nav-last';
  const readJson = <T,>(key: string, fallback: T): T => {
    try {
      return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeJson = (key: string, v: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // private window: not remembered
    }
  };
  let lastBySection = readJson<Partial<Record<SectionId, string>>>(LAST_KEY, {});
  const sectionLinks = SECTIONS.filter((s) => s.id !== 'ai').map((s) =>
    h(
      'a',
      { class: 'nav-btn rail-sec', href: `#${sectionTarget(s.id, lastBySection)}`, 'data-section': s.id, title: `${s.label}: ${s.about}`, 'aria-label': s.label },
      icon(s.icon, 20),
      h('span', { class: 'nav-label' }, s.label),
    ),
  );
  // Every page by name under its section heading, so anything is one click away (phones keep the section bar).
  const pageLinks: HTMLElement[] = [];
  const tree = h(
    'div',
    { class: 'rail-tree' },
    ...SECTIONS.filter((s) => s.id !== 'ai').map((s) =>
      h(
        'div',
        { class: 'rail-tree-group', role: 'group', 'aria-label': s.label },
        h('div', { class: 'rail-head', title: s.about }, s.label),
        ...sectionPages(s.id).map((p) => {
          const a = h('a', { class: 'nav-btn rail-page', href: `#${p.route}`, 'data-route': p.route, title: `${p.about} (code ${p.code})` }, icon(p.icon, 16), h('span', { class: 'nav-label' }, p.label));
          pageLinks.push(a);
          return a;
        }),
      ),
    ),
  );
  const rail = h(
    'nav',
    { class: 'rail', 'aria-label': 'Pages' },
    h('div', { class: 'brand', title: 'Trading Platform' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '◆'), h('span', { class: 'brand-name' }, 'Terminal')),
    h('div', { class: 'rail-sections' }, ...sectionLinks),
    tree,
    aiBtn,
    railBtn('rail-launch', 'Launchpad', 'grid', 'Launchpad: every page and function (Ctrl+Shift+L, g l, or Ctrl+L when not typing)', launch, { 'aria-keyshortcuts': 'Control+Shift+L Meta+Shift+L' }),
    h(
      'div',
      { class: 'rail-bottom' },
      railBtn('rail-util buddy-nav', 'Buddy', 'paw', 'Market buddy: show or hide him, name and colours', (e) => {
        const btn = e.currentTarget as HTMLElement;
        openPopover(btn, buddySettings(), { align: 'left', label: 'Market buddy' });
      }),
      railBtn('rail-util', 'Alerts', 'bell', 'Alerts', () => openAlertsDialog()),
      healthBtn,
      railBtn('rail-util', 'Settings', 'gear', 'Settings', () => openSettings()),
      railBtn('rail-util rail-collapse', 'Collapse', 'chevron', 'Collapse or expand the menu', () => setRailCollapsed(!document.body.classList.contains('rail-collapsed'))),
    ),
  );
  function setRailCollapsed(v: boolean) {
    document.body.classList.toggle('rail-collapsed', v);
    const b = rail.querySelector('.rail-collapse');
    b?.setAttribute('aria-pressed', String(v));
    b?.querySelector('.nav-label')?.replaceChildren(v ? 'Expand' : 'Collapse');
    writeJson(RAIL_KEY, v);
    window.dispatchEvent(new Event('resize'));
  }
  setRailCollapsed(readJson(RAIL_KEY, false));

  // The top row: the section's pages as sub-tabs (with their codes as hints), the command field and the launchpad.
  const sectionName = h('span', { class: 'shell-section' });
  const subTabs = h('nav', { class: 'sub-tabs', 'aria-label': 'Pages in this section' });
  let drawnSection: SectionId | null = null;
  function drawSubTabs(route: string) {
    const page = pageOf(route);
    const section = page?.section ?? 'markets';
    if (section !== drawnSection) {
      drawnSection = section;
      const sec = SECTIONS.find((s) => s.id === section)!;
      sectionName.textContent = sec.label;
      subTabs.setAttribute('aria-label', `${sec.label} pages`);
      subTabs.replaceChildren(
        ...sectionPages(section).map((p) => h('a', { class: 'sub-tab', href: `#${p.route}`, 'data-route': p.route, title: `${p.about} (code ${p.code})` }, h('span', {}, p.label), h('span', { class: 'code-hint', 'aria-hidden': 'true' }, p.code))),
      );
    }
    subTabs.querySelectorAll<HTMLElement>('.sub-tab').forEach((t) => {
      const on = t.dataset.route === route;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    subTabs.querySelector<HTMLElement>('.sub-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const top = h(
    'div',
    { class: 'shell-top' },
    sectionName,
    subTabs,
    h(
      'button',
      { type: 'button', class: 'cmd-field', title: 'Command bar: a ticker, a code like AAPL GP or WEI, or a page (press / or Ctrl+K)', 'aria-label': 'Command bar', 'aria-keyshortcuts': '/ Control+K Meta+K', onclick: () => openPalette() },
      icon('search', 16),
      h('span', { class: 'cmd-field-text' }, 'Ticker, code or page'),
      h('kbd', {}, '/'),
    ),
  );

  // Moving between pages: the rail's active section, its link (to the last page visited there) and the sub-tabs.
  shellRoute = (route: string, hash: string) => {
    const section = pageOf(route)?.section ?? 'markets';
    if (pageOf(route) && !pageOf(route)!.hidden) {
      lastBySection = { ...lastBySection, [section]: hash.replace(/^#/, '') };
      writeJson(LAST_KEY, lastBySection);
    }
    for (const a of sectionLinks) {
      const id = a.dataset.section as SectionId;
      a.href = `#${sectionTarget(id, lastBySection)}`;
      const on = id === section;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    for (const a of pageLinks) {
      const on = a.dataset.route === route;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    drawSubTabs(route);
  };

  document.querySelector('#app')!.append(
    h('a', { class: 'skip-link', href: '#content', onclick: (e: Event) => (e.preventDefault(), focusPageHeading()) }, 'Skip to content'),
    rail,
    h('main', { class: 'app-main', id: 'content', tabindex: -1 }, top, updateBanner, views, createStatusBar({ openHealth: (a) => openDataHealth(a), openSettings: (s) => void openSettings(s) })),
    drawer,
  );
  helper.onAvailability(showUpdateBanner);
  helper.onUpdateChange(showUpdateBanner);
  helper.onAvailability(noteNewVersion);
  // new site versions load by themselves at a quiet moment (also when the helper is newer than this page)
  startAutoReload(() => ((helper.version ?? 0) > LATEST_HELPER_VERSION ? (helper.version ?? 0) : 0));

  window.addEventListener('hashchange', route);
  window.addEventListener('hashchange', () => { if (!drawer.hidden) assistant.reload(); }); // page-specific example questions
  route();
  startAlertWatcher();
}

/** The page routes (a function declaration, so code that runs before this line can use it). */
function ROUTES() {
  return pages.map((p) => p.route);
}

function currentPage() {
  const { route } = resolveHash(location.hash, ROUTES());
  return pages.find((p) => p.route === route) ?? pages[0];
}

/** Builds a page the first time it's needed and adds it to the screen. */
function ensurePage(entry: PageEntry): Promise<Page> {
  if (entry.page) return Promise.resolve(entry.page);
  entry.loading ??= Promise.resolve(entry.create()).then((page) => {
    entry.page = page;
    page.el.hidden = true;
    appViews?.append(page.el);
    return page;
  });
  return entry.loading;
}

async function route() {
  // old routes (#multi, #scripts, #portfolio/webull, #flow/cot...) are replaced by their new home, so bookmarks work
  const where = resolveHash(location.hash, ROUTES());
  if (where.redirected) history.replaceState(null, '', where.hash);
  const current = currentPage();
  markRoute(current.route);
  const mine = ++routeRequest;
  shellRoute(current.route, where.hash);
  if (current.title) document.title = current.title === 'Trading Platform' ? current.title : `${current.title} · Trading Platform`;
  let page: Page;
  try {
    page = await ensurePage(current);
  } catch {
    // The page's code couldn't be downloaded (e.g. offline or the site was just updated): reload once.
    toast('Couldn’t load that page. Refreshing…');
    setTimeout(() => location.reload(), 1200);
    return;
  }
  if (mine !== routeRequest) return; // the user already moved on to another page
  for (const p of pages) {
    if (!p.page) continue;
    p.page.el.hidden = p !== current;
    if (p !== current) p.page.stop?.();
  }
  page.start(where.sub);
  // After a page switch (not the first load), move keyboard and screen-reader focus to the new page's heading.
  if (!firstRoute) focusPageHeading();
  firstRoute = false;
}

let firstRoute = true;

/** Focuses the open page's heading (or the content area when it has none, like the chart). */
function focusPageHeading() {
  const el = currentPage().page?.el.querySelector<HTMLElement>('h1') ?? document.querySelector<HTMLElement>('#content');
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
}
