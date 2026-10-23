import './style.css';
import { createCalendarPage } from './pages/calendarPage';
import { createBacktestPage } from './pages/backtestPage';
import { createChartPage } from './pages/chartPage';
import { createClientsPage } from './pages/clientsPage';
import { createFlowPage } from './pages/flowPage';
import { createHomePage } from './pages/homePage';
import { createMacroPage } from './pages/macroPage';
import { createMultiChartPage } from './pages/multiChartPage';
import { createPortfolioPage } from './pages/portfolioPage';
import { createResearchPage } from './pages/researchPage';
import { createScriptsPage } from './pages/scriptsPage';
import { createAssistant, type AssistantAction } from './ai/assistant';
import { setAssistantHub } from './ai/hub';
import { guessMarket, type MarketRef } from './data/quotes';
import { allIndicators } from './indicators/library';
import { persist, state } from './state';
import { TIMEFRAMES, type Timeframe } from './types';
import { startAlertWatcher, type PriceAlert } from './ui/alerts';
import { h, toast } from './ui/dom';
import { icon, type IconName } from './ui/icons';
import { openSettings } from './ui/settings';

interface Page {
  el: HTMLElement;
  start(): void;
  stop?(): void;
}

const openChart = (ref: MarketRef) => {
  chartPage.open(ref);
  location.hash = '#chart';
};

/** The pop-out AI window shows only the assistant, so it doesn't build (or save state from) the pages. */
const isAiWindow = location.hash === '#ai-window';

type PageEntry = { route: string; label: string; icon: IconName; title: string; page: Page };
let chartPage: ReturnType<typeof createChartPage>;
let pages: PageEntry[] = [];

function buildPages() {
  chartPage = createChartPage();
  pages = [
    { route: 'home', label: 'Home', icon: 'home', title: 'Trading Platform', page: createHomePage(openChart, () => (location.hash = '#calendar')) },
    { route: 'chart', label: 'Chart', icon: 'chart', title: '', page: chartPage },
    { route: 'multi', label: 'Multi', icon: 'grid', title: 'Multi-chart', page: createMultiChartPage(openChart) },
    { route: 'flow', label: 'Flow', icon: 'flow', title: 'Flow', page: createFlowPage() },
    { route: 'research', label: 'Research', icon: 'research', title: 'Research', page: createResearchPage() },
    { route: 'macro', label: 'Macro', icon: 'macro', title: 'Macro', page: createMacroPage() },
    { route: 'portfolio', label: 'Portfolios', icon: 'portfolio', title: 'Portfolios', page: createPortfolioPage() },
    { route: 'clients', label: 'Clients', icon: 'clients', title: 'Clients & Reports', page: createClientsPage() },
    { route: 'backtest', label: 'Backtest', icon: 'backtest', title: 'Backtest', page: createBacktestPage() },
    { route: 'calendar', label: 'Calendar', icon: 'calendar', title: 'Economic calendar', page: createCalendarPage() },
    {
      route: 'scripts',
      label: 'Scripts',
      icon: 'code',
      title: 'Scripts',
      page: createScriptsPage({
        onAddToChart: (defId) => {
          chartPage.addIndicatorById(defId);
          location.hash = '#chart';
        },
        onScriptSaved: (defId) => chartPage.refreshIndicatorsFor(defId),
      }),
    },
  ];
}

if (!isAiWindow) buildPages();

// ---------- AI assistant ----------

const AI_CHANNEL = 'tp-ai-actions';

function currentPage() {
  return pages.find((p) => location.hash === `#${p.route}`) ?? pages[0];
}

function aiContext(): Record<string, string> {
  const page = currentPage();
  return { page: page.label, symbol: state.symbols[state.provider] ?? '', timeframe: state.timeframe };
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
    chartPage.addIndicatorById(def.id);
    location.hash = '#chart';
    toast(`Added ${def.name}`);
    return;
  }
  if (a.action === 'create_alert' && a.symbol && typeof a.price === 'number') {
    const ref = guessMarket(a.symbol);
    if (!ref) return;
    const alert: PriceAlert = { id: Math.random().toString(36).slice(2, 10), provider: ref.provider, symbol: ref.symbol, condition: a.direction === 'below' ? 'below' : 'above', price: a.price, note: a.note ?? 'Set by AI', created: Date.now() };
    state.alerts.push(alert);
    persist();
    toast(`🔔 Alert set: ${ref.symbol} ${alert.condition} ${a.price}`);
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
  const drawer = h('aside', { class: 'ai-drawer', hidden: true, 'aria-label': 'AI assistant' });
  const assistant = createAssistant({
    mode: 'drawer',
    getContext: aiContext,
    onAction: runAction,
    onClose: () => toggleAssistant(false),
    onPopOut: () => {
      window.open(`${location.pathname}#ai-window`, 'tp-ai', 'popup,width=520,height=860');
      toggleAssistant(false);
    },
  });
  drawer.append(assistant.el);
  channel?.addEventListener('message', (e) => runAction(e.data as AssistantAction));

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
    h(
      'nav',
      { class: 'rail', 'aria-label': 'Main' },
      h('div', { class: 'brand', title: 'Trading Platform' }, '◆'),
      ...pages.map((p) =>
        h('a', { class: 'nav-btn', href: `#${p.route}`, 'data-route': p.route, title: p.label, 'aria-label': p.label }, icon(p.icon, 22), h('span', { class: 'nav-label' }, p.label)),
      ),
      h(
        'div',
        { class: 'rail-bottom' },
        aiBtn,
        h('button', { class: 'nav-btn', title: 'Settings', 'aria-label': 'Settings', onclick: () => openSettings() }, icon('gear', 22), h('span', { class: 'nav-label' }, 'Settings')),
      ),
    ),
    h('div', { class: 'views' }, ...pages.map((p) => p.page.el)),
    drawer,
  );

  window.addEventListener('hashchange', route);
  route();
  startAlertWatcher();
}

function route() {
  const current = currentPage();
  for (const p of pages) {
    p.page.el.hidden = p !== current;
    if (p !== current) p.page.stop?.();
  }
  document.querySelectorAll<HTMLElement>('.nav-btn[data-route]').forEach((b) => b.classList.toggle('active', b.dataset.route === current.route));
  current.page.start();
  if (current.title) document.title = current.title === 'Trading Platform' ? current.title : `${current.title} · Trading Platform`;
}
