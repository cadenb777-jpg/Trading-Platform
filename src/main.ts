import './style.css';
import { createChartPage } from './pages/chartPage';
import { createHomePage } from './pages/homePage';
import { createAssistant, type AssistantAction } from './ai/assistant';
import { setAssistantHub } from './ai/hub';
import { guessMarket, type MarketRef } from './data/quotes';
import { LATEST_HELPER_VERSION, helper } from './data/schwab';
import { allIndicators } from './indicators/library';
import { persist, state } from './state';
import { TIMEFRAMES, type Timeframe } from './types';
import { createPriceAlert, openAlertsDialog, startAlertWatcher } from './ui/alerts';
import { h, toast } from './ui/dom';
import { icon, type IconName } from './ui/icons';
import { openSettings } from './ui/settings';
import { initTheme } from './ui/theme';
import { PAGE_SUGGESTIONS, screenText } from './ai/screen';
import { followHealth, openDataHealth } from './ui/dataHealth';
import { initTickerCards } from './ui/tickerCard';

initTheme();

interface Page {
  el: HTMLElement;
  start(): void;
  stop?(): void;
}

/** The pop-out AI window shows only the assistant, so it doesn't build (or save state from) the pages. */
const isAiWindow = location.hash === '#ai-window';

let chartPage: ReturnType<typeof createChartPage> | null = null;
/** Where pages are added when they're first built. */
let appViews: HTMLElement | null = null;
/** Counts page switches, so a slow-loading page doesn't appear after the user moved on. */
let routeRequest = 0;
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
const openResearch = (symbol: string) => {
  const entry = pages.find((p) => p.route === 'research');
  if (!entry) return;
  location.hash = '#research';
  ensurePage(entry).then((page) => (page as Page & { open?(symbol: string): void }).open?.(symbol));
};

/** Opens a saved portfolio (or, with 'webull', the Webull view) on the Portfolios page (from the Account page). */
const openPortfolio = (id: string) => {
  const entry = pages.find((p) => p.route === 'portfolio');
  if (!entry) return;
  location.hash = '#portfolio';
  ensurePage(entry).then((page) => (page as Page & { open?(id: string): void }).open?.(id));
};

/** The chart's Backtest button: open the backtester with the chart's symbol, timeframe and indicators. */
window.addEventListener('tp:backtest-chart', () => {
  const entry = pages.find((p) => p.route === 'backtest');
  if (!entry) return;
  location.hash = '#backtest';
  ensurePage(entry).then((page) => (page as Page & { fromChart?(): void }).fromChart?.());
});

/**
 * Each page is built the first time it's opened (and its code downloaded then), so the platform starts
 * quickly instead of building every page at launch.
 */
interface PageEntry {
  route: string;
  /** Which part of the menu it sits in (a thin divider separates the groups). */
  group: keyof typeof GROUPS;
  label: string;
  icon: IconName;
  title: string;
  create: () => Page | Promise<Page>;
  page?: Page;
  loading?: Promise<Page>;
}

const GROUPS = { markets: 'Markets', analyse: 'Analyse', money: 'My money' } as const;

const pages: PageEntry[] = [
  { route: 'home', group: 'markets', label: 'Home', icon: 'home', title: 'Trading Platform', create: () => createHomePage(openChart, () => (location.hash = '#calendar')) },
  {
    route: 'invest',
    group: 'markets',
    label: 'Invest',
    icon: 'invest',
    title: 'Investments',
    create: async () => (await import('./pages/investmentsPage')).createInvestmentsPage({ openChart, openResearch }),
  },
  { route: 'futures', group: 'markets', label: 'Futures', icon: 'futures', title: 'Futures', create: async () => (await import('./pages/futuresPage')).createFuturesPage() },
  { route: 'macro', group: 'markets', label: 'Macro', icon: 'macro', title: 'Macro', create: async () => (await import('./pages/macroPage')).createMacroPage() },
  { route: 'calendar', group: 'markets', label: 'Calendar', icon: 'calendar', title: 'Economic calendar', create: async () => (await import('./pages/calendarPage')).createCalendarPage() },
  { route: 'chart', group: 'analyse', label: 'Chart', icon: 'chart', title: '', create: () => getChartPage() },
  { route: 'multi', group: 'analyse', label: 'Multi', icon: 'grid', title: 'Multi-chart', create: async () => (await import('./pages/multiChartPage')).createMultiChartPage(openChart) },
  { route: 'setups', group: 'analyse', label: 'Setups', icon: 'target', title: 'Setups', create: async () => (await import('./pages/setupsPage')).createSetupsPage(openChart) },
  { route: 'research', group: 'analyse', label: 'Research', icon: 'research', title: 'Research', create: async () => (await import('./pages/researchPage')).createResearchPage() },
  { route: 'flow', group: 'analyse', label: 'Flow', icon: 'flow', title: 'Flow', create: async () => (await import('./pages/flowPage')).createFlowPage() },
  { route: 'backtest', group: 'analyse', label: 'Backtest', icon: 'backtest', title: 'Backtest', create: async () => (await import('./pages/backtestPage')).createBacktestPage() },
  {
    route: 'scripts',
    group: 'analyse',
    label: 'Scripts',
    icon: 'code',
    title: 'Scripts',
    create: async () =>
      (await import('./pages/scriptsPage')).createScriptsPage({
        onAddToChart: (defId) => {
          getChartPage().addIndicatorById(defId);
          location.hash = '#chart';
        },
        onScriptSaved: (defId) => getChartPage().refreshIndicatorsFor(defId),
      }),
  },
  { route: 'account', group: 'money', label: 'Account', icon: 'account', title: 'Account', create: async () => (await import('./pages/accountPage')).createAccountPage(openPortfolio) },
  { route: 'portfolio', group: 'money', label: 'Portfolios', icon: 'portfolio', title: 'Portfolios', create: async () => (await import('./pages/portfolioPage')).createPortfolioPage() },
  { route: 'trade', group: 'money', label: 'Trade', icon: 'trade', title: 'Trade', create: async () => (await import('./pages/tradePage')).createTradePage() },
  { route: 'clients', group: 'money', label: 'Clients', icon: 'clients', title: 'Clients & Reports', create: async () => (await import('./pages/clientsPage')).createClientsPage() },
];

// ---------- AI assistant ----------

const AI_CHANNEL = 'tp-ai-actions';

function aiContext(): Record<string, string> {
  const page = currentPage();
  return { page: page.label, route: page.route, symbol: state.symbols[state.provider] ?? '', timeframe: state.timeframe, screen: screenText(page.page?.el) };
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

if (isAiWindow) {
  // The assistant in its own window: actions are carried out by the main platform window.
  document.title = 'AI Assistant · Trading Platform';
  document.body.classList.add('ai-window-body');
  const assistant = createAssistant({
    mode: 'window',
    getContext: () => ({ page: 'AI assistant window', symbol: state.symbols[state.provider] ?? '', timeframe: state.timeframe }),
    onAction: (a) => channel?.postMessage(a),
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
    v < 6 ? 'Charts and prices work; Flow, Research, Macro, Portfolios, Investments and the AI need the update. ' : v < 8 ? 'The new Investments page (bonds, alternatives, private funds) and the new start screen need it. ' : v < 9 ? 'It starts faster and opens the platform in Chrome when it’s ready. ' : v < 10 ? 'It adds the market scanner, AI page summaries and corrected daily changes. ' : v < 11 ? 'The scanner now backtests the exact plan on each card, retries symbols after hiccups and is gentler on Schwab; Investments shows at-close values. ' : v < 12 ? 'It adds the Nasdaq-100 swing scanner (weekly swing with COT, z-score and Williams; mean reversion; breakouts) every 5 minutes, RIA fee schedules in client reports and fresher fund data. ' : v < 21 ? 'It adds the free Alpaca history option (Settings), a faster and steadier helper and fixes. ' : v < 22 ? 'It reworks the Setups scanner: honest tests (trades from the same week count as one bet, results after costs, corrected for many tests), 15 years of daily history, hourly history kept for good, simpler rules and weekly rule tests on your own data. ' : v < 23 ? 'The AI assistant can now see the page you’re on, so you can ask about anything on screen. ' : v < 24 ? 'It adds dividend tracking (import a statement, yields, income calendar). ' : v < 25 ? 'It fixes dividend estimates after raises and for twice-a-year payers. ' : v < 26 ? 'It adds Webull: view and sync your account, and place orders (Test first). ' : v < 27 ? 'It fixes Webull "too many requests" and adds the Trade page. ' : v < 28 ? 'It adds total return (with dividends) to Account, Investments and Research. ' : v < 29 ? 'It rebuilds the portfolio optimizer (shrinkage, risk parity, resampling, walk-forward test) and shows cash as Cash. ' : v < 30 ? 'It adds one-click helper updates and shows each Webull account (Roth IRA, Traditional IRA, Cash, Margin) separately, with a combined view, plus account risk, sectors and a tax view. ' : v < 31 ? 'It adds the Futures page: the whole futures market by sector, what’s moving, term structure and who is positioned how (COT), and futures trading in your Webull futures account (Trade page, Futures switch; off until you type FUTURES in Settings). Updates are checked every 10 minutes. ' : v < 32 ? 'It adds alerts that work with the platform closed, sent free to your phone by ntfy or Telegram (set up in Settings), and news on your holdings. The Account risk card opens charts of the daily swings behind its numbers. ' : v < 33 ? 'The portfolio optimizer now tests young holdings too: before a holding existed, its history is estimated from a similar long-running fund, and it shows how firmly the data pins down each suggested weight. The Account page adds dividends received and total gain per holding and account, display choices (% or $), a holding detail with purchase date and dividend entry, and an "Is the yield sustainable?" check with charts for high-yield funds. Futures prices are matched more reliably.' : v < 34 ? 'It adds a Sources check: a fund’s NAV or a price is compared across free sources (Schwab, SEC filings, Yahoo, Nasdaq), each shown with its time and link, plus a confidence meter. ' : 'It includes bug fixes. ';
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
  function showUpdateBanner() {
    const v = helper.version;
    const up = helper.update;
    const busy = up?.state === 'updating' || up?.state === 'restarting';
    updateBanner.hidden = v == null || (!busy && (bannerDismissed || !helper.outdated));
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
    getSuggestions: () => PAGE_SUGGESTIONS[currentPage().route] ?? [],
    onAction: runAction,
    onClose: () => toggleAssistant(false),
    onPopOut: () => {
      window.open(`${location.pathname}#ai-window`, 'tp-ai', 'popup,width=520,height=860');
      toggleAssistant(false);
    },
  });
  drawer.append(assistant.el);
  channel?.addEventListener('message', (e) => runAction(e.data as AssistantAction));

  const healthDot = h('span', { class: 'health-badge', 'aria-hidden': 'true' });
  const healthBtn = h(
    'button',
    { class: 'nav-btn health-nav', title: 'Data health: when each feed last updated', 'aria-label': 'Data health', onclick: () => openDataHealth(healthBtn) },
    icon('pulse', 22),
    healthDot,
    h('span', { class: 'nav-label' }, 'Data'),
  );
  followHealth(healthDot);
  initTickerCards({ openChart, openResearch });
  const aiBtn = h('button', { class: 'nav-btn ai-nav', title: 'AI assistant (Ctrl+K)', 'aria-label': 'AI assistant', onclick: () => toggleAssistant() }, icon('spark', 24), h('span', { class: 'nav-label' }, 'AI'));
  function toggleAssistant(show: boolean = drawer.hidden === true) {
    drawer.hidden = !show;
    aiBtn.classList.toggle('active', show);
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
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggleAssistant();
    }
  });

  document.querySelector('#app')!.append(
    h('a', { class: 'skip-link', href: '#content', onclick: (e: Event) => (e.preventDefault(), focusPageHeading()) }, 'Skip to content'),
    h(
      'nav',
      { class: 'rail', 'aria-label': 'Main' },
      h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
      ...pages.flatMap((p, i) => [
        p.group !== pages[i - 1]?.group ? h('div', { class: 'rail-group', role: 'separator', 'aria-label': GROUPS[p.group], title: GROUPS[p.group] }) : null,
        h('a', { class: 'nav-btn', href: `#${p.route}`, 'data-route': p.route, title: p.label, 'aria-label': p.label }, icon(p.icon, 22), h('span', { class: 'nav-label' }, p.label)),
      ]),
      h(
        'div',
        { class: 'rail-bottom' },
        aiBtn,
        h('button', { class: 'nav-btn', title: 'Alerts', 'aria-label': 'Alerts', onclick: () => openAlertsDialog() }, icon('bell', 22), h('span', { class: 'nav-label' }, 'Alerts')),
        healthBtn,
        h('button', { class: 'nav-btn', title: 'Settings', 'aria-label': 'Settings', onclick: () => openSettings() }, icon('gear', 22), h('span', { class: 'nav-label' }, 'Settings')),
      ),
    ),
    h('main', { class: 'app-main', id: 'content', tabindex: -1 }, updateBanner, views),
    drawer,
  );
  helper.onAvailability(showUpdateBanner);
  helper.onUpdateChange(showUpdateBanner);

  window.addEventListener('hashchange', route);
  window.addEventListener('hashchange', () => { if (!drawer.hidden) assistant.reload(); }); // page-specific example questions
  route();
  startAlertWatcher();
}

function currentPage() {
  return pages.find((p) => location.hash === `#${p.route}`) ?? pages[0];
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
  const current = currentPage();
  const mine = ++routeRequest;
  document.querySelectorAll<HTMLElement>('.nav-btn[data-route]').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === current.route);
    if (b.dataset.route === current.route) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  // On phones the menu is a sideways-scrolling bar: bring the current page's button into view.
  if (matchMedia('(max-width: 700px)').matches) document.querySelector<HTMLElement>('.nav-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
  page.start();
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
