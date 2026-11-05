/**
 * Where the security view lives: the full page (#sec/AAPL/FA, built by main.ts) and the slide-over panel that any
 * ticker click opens (src/ui/tickerCard.ts). One shared Back/Forward history (codes.ts) for both; Alt+← / Alt+→ move
 * through it while a security view is on screen.
 *
 * `openSecurity(symbol, tab?)` is the one entry point (the command bar, ticker clicks, and later the AI assistant).
 */
import { h } from '../ui/dom';
import { cleanSymbol, createSecHistory, parseSecRoute, secHash, tabDef, tabForCode, type HistoryEntry, type SecTab } from './codes';
import type { SecurityDeps } from './tabs';
import type { SecurityView } from './view';

let deps: SecurityDeps = { openChart: () => {}, openPage: () => {} };
const history = createSecHistory();
/** True while Back/Forward loads an entry (so it isn't added to the history again). */
let replaying = false;

let pageView: SecurityView | null = null;
let pageShown = false;
let drawer: { el: HTMLElement; view: SecurityView; returnFocus: HTMLElement | null } | null = null;

/** Called once from main.ts with the app's chart and page openers. */
export function initSecurity(d: SecurityDeps) {
  deps = d;
  window.addEventListener('keydown', onKey, true);
  // other code can ask without importing this module: dispatchEvent(new CustomEvent('tp:open-security', { detail: { symbol, tab } }))
  window.addEventListener('tp:open-security', (e) => {
    const d2 = (e as CustomEvent<{ symbol?: string; tab?: string }>).detail ?? {};
    if (d2.symbol) void openSecurity(d2.symbol, d2.tab);
  });
}

const nav = {
  back: () => go(history.back()),
  forward: () => go(history.forward()),
  canBack: () => history.canBack,
  canForward: () => history.canForward,
  recents: () => history.recents(),
};

function go(e: HistoryEntry | null) {
  const view = activeView();
  if (!e || !view) return;
  replaying = true;
  try {
    view.load(e.symbol, e.tab);
  } finally {
    replaying = false;
  }
  view.paintNav();
}

const activeView = (): SecurityView | null => (drawer ? drawer.view : pageShown ? pageView : null);

function onShow(where: 'page' | 'panel', symbol: string, tab: SecTab, how: 'load' | 'tab') {
  if (!replaying) {
    if (how === 'load') history.visit({ symbol, tab });
    else history.setTab(tab);
  } else history.setTab(tab);
  if (where === 'page' && pageShown) {
    const want = secHash(symbol, tab);
    if (location.hash !== want) history_replace(want);
    document.title = `${symbol.replace(/^\$/, '')} ${tabDef(tab).code} · Trading Platform`;
  }
}

/** The browser's history.replaceState under another name (the security history above is ours). */
const history_replace = (hash: string) => window.history.replaceState(null, '', hash);

async function makeView(mode: 'page' | 'panel', extra: Node[] = []): Promise<SecurityView> {
  const { createSecurityView } = await import('./view');
  return createSecurityView({ mode, deps, nav, extra, onShow: (s, t, how) => onShow(mode, s, t, how) });
}

/**
 * Opens a security: on the security page when it's on screen, otherwise in the slide-over panel. `tab` is a tab id
 * or mnemonic ("fa", "FA", "HP"); unknown or missing = DES. Futures open the Futures page.
 */
export async function openSecurity(raw: string, tabOrCode?: string): Promise<void> {
  const s = (raw ?? '').trim().toUpperCase();
  if (s.startsWith('/')) return deps.openPage('futures', 'open', s.slice(1));
  const symbol = cleanSymbol(s);
  if (!symbol) return;
  const tab = tabForCode(tabOrCode) ?? undefined;
  if (pageShown && pageView) {
    pageView.load(symbol, tab ?? pageView.tab, true);
    return;
  }
  await openDrawer(symbol, tab);
}

/** The one slide-over (built once and reused: a new view per open would keep old ones alive through their links). */
let built: Promise<{ el: HTMLElement; view: SecurityView }> | null = null;
function buildDrawer() {
  built ??= (async () => {
    const expand = h('button', { type: 'button', class: 'btn small', title: 'Open this security as a full page', onclick: () => expandDrawer() }, '⤢ Full page');
    const close = h('button', { type: 'button', class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close the security panel', onclick: () => closeDrawer() }, '✕');
    const view = await makeView('panel', [expand, close]);
    return { el: h('aside', { class: 'sv-drawer', role: 'dialog', 'aria-label': 'Security' }, view.el), view };
  })();
  return built;
}

async function openDrawer(symbol: string, tab?: SecTab) {
  if (drawer) return drawer.view.load(symbol, tab, true);
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const { el, view } = await buildDrawer();
  if (drawer) return view.load(symbol, tab, true);
  el.classList.remove('open');
  document.body.append(el);
  document.body.classList.add('sv-drawer-open');
  drawer = { el, view, returnFocus };
  view.load(symbol, tab, true);
  requestAnimationFrame(() => el.classList.add('open'));
  const head = el.querySelector<HTMLElement>('.sv-name');
  head?.setAttribute('tabindex', '-1');
  head?.focus({ preventScroll: true });
}

/** Closes the slide-over: its live quote, chart and requests stop; the panel is kept for next time. */
export function closeDrawer() {
  if (!drawer) return;
  const { el, view, returnFocus } = drawer;
  drawer = null;
  view.stop();
  el.remove();
  document.body.classList.remove('sv-drawer-open');
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

function expandDrawer() {
  if (!drawer) return;
  const { symbol, tab } = drawer.view;
  closeDrawer();
  location.hash = secHash(symbol, tab);
}

function onKey(e: KeyboardEvent) {
  const view = activeView();
  if (!view) return;
  const modal = document.querySelector('.modal-backdrop, .cmd-palette, .ticker-card.pinned');
  if (e.key === 'Escape' && drawer && !modal) {
    e.preventDefault();
    closeDrawer();
    return;
  }
  if (!e.altKey || e.ctrlKey || e.metaKey || modal) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === 'ArrowLeft') nav.back();
  else nav.forward();
}

/** The #sec page (main.ts builds it on first visit). */
export async function createSecurityPage() {
  pageView = await makeView('page');
  const el = h('div', { class: 'analysis-page sv-page' }, h('h1', { class: 'sr-only' }, 'Security'), pageView.el);
  const view = pageView;
  return {
    el,
    start(sub = '') {
      closeDrawer();
      pageShown = true;
      const r = parseSecRoute(sub);
      const fallback = history.current ?? { symbol: 'AAPL', tab: 'des' as SecTab };
      const want = r ?? fallback;
      if (view.symbol === want.symbol) view.setTab(want.tab);
      else view.load(want.symbol, want.tab, !!r);
      view.paintNav();
    },
    stop() {
      pageShown = false;
      view.stop();
    },
  };
}
