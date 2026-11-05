/**
 * "Go to": where a row on the Investments page leads into the rest of the platform (the security view's tabs, Chart,
 * Research, Flow, watchlist, alerts, the assistant, the journal). One list per kind of thing, shown the same way in the
 * mini chart popover, the expanded row and the right-click / ⋯ menu (src/invest/rowInteract.ts). Reasoning in
 * docs/research/investments-interaction.md ("Go to").
 *
 * Security items open the security view (src/security/open.ts, `openSecurity(symbol, code)`); if it fails they fall
 * back to the page that already covers it (symbol window, Chart, Research, Flow).
 */
import { openAssistant } from '../ai/hub';
import { guessMarket, type MarketRef } from '../data/quotes';
import { persist, state } from '../state';
import { openAlertsDialog } from '../ui/alerts';
import { openSecurity as openSecurityView } from '../security/open';
import { h, toast } from '../ui/dom';
import { CATALOG_ETFS } from './catalog';
import { listDocs } from '../data/store';
import type { Portfolio } from '../portfolio/types';
import { heldPosition } from '../ui/tickerCard';
import { icon, type IconName } from '../ui/icons';

export interface GoAction {
  id: string;
  label: string;
  icon: IconName;
  /** Bloomberg-style mnemonic shown as a hint (FA, CN, ...). */
  code?: string;
  /** Single-letter shortcut while the row is focused or its popover is open. */
  key?: string;
  /** Tooltip: what it opens. */
  hint: string;
  run(): void;
  /** Shown as pressed (Compare when the row is in it). */
  pressed?: boolean;
}

export interface GoContext {
  openChart(ref: MarketRef): void;
  openResearch(symbol: string): void;
  /** main.ts openPageWith: go to a page and call one of its methods. */
  openPage?(route: string, method?: string, ...args: unknown[]): void;
}

/** How many actions show as buttons; the rest go under "More". */
export const PRIMARY = 5;

/** Opens the security view on a tab (DES, GP, FA ...); `fallback` if that fails. */
export function openSecurity(symbol: string, code: string | undefined, fallback: () => void) {
  Promise.resolve()
    .then(() => openSecurityView(symbol, code))
    .catch(fallback);
}

const routeExists = (route: string) => !!document.querySelector(`.nav-btn[data-route="${route}"]`);

// ---------- your position (the ticker card's "You hold") ----------

let portfolios: { at: number; value: Promise<Portfolio[]> } | null = null;
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 1000 ? 0 : 2 });

/** "You hold 12 sh · $2,760" across your own accounts (client portfolios excluded), or null when not held. */
export async function heldText(symbol: string, price: number | null): Promise<string | null> {
  if (!portfolios || Date.now() - portfolios.at > 60_000) portfolios = { at: Date.now(), value: listDocs<Portfolio>('portfolios').catch(() => [] as Portfolio[]) };
  const held = heldPosition(symbol, await portfolios.value);
  if (!held) return null;
  const parts = [held.shares ? `${+held.shares.toFixed(4)} sh` : '', held.amount ? money(held.amount) : ''].filter(Boolean).join(' + ');
  const value = held.amount + (price != null ? held.shares * price : 0);
  const where = held.accounts.length > 1 ? ` in ${held.accounts.length} accounts` : held.accounts[0]?.account ? ` in ${held.accounts[0].account}` : '';
  return `You hold ${parts}${price != null && value ? ` · ${money(value)}` : ''}${where}`;
}

// ---------- shared items ----------

export function compareAction(): GoAction {
  return { id: 'compare', label: 'Compare', icon: 'positioning', hint: 'Add to Compare (Shift+click a row)', run: () => {} };
}

export function watchlistAction(ref: MarketRef | null): GoAction | null {
  if (!ref) return null;
  const on = () => state.watchlist.some((r) => r.provider === ref.provider && r.symbol === ref.symbol);
  return {
    id: 'watch',
    label: on() ? 'Watching' : 'Watchlist',
    icon: 'star',
    hint: on() ? `${ref.symbol} is on your watchlist` : `Add ${ref.symbol} to your watchlist`,
    pressed: on(),
    run: () => {
      if (on()) return toast(`${ref.symbol} is already on your watchlist`);
      state.watchlist.push(ref);
      persist();
      toast(`Added ${ref.symbol} to your watchlist`);
    },
  };
}

export function alertAction(ref: MarketRef | null, price: number | null | undefined): GoAction | null {
  if (!ref) return null;
  return { id: 'alert', label: 'Alert', icon: 'bell', hint: `Set a price alert on ${ref.symbol}`, run: () => void openAlertsDialog(ref, price ?? null) };
}

export function aiAction(question: string): GoAction {
  return { id: 'ai', label: 'Ask AI', icon: 'spark', hint: 'Ask the assistant about it (live data)', run: () => openAssistant(question) };
}

// ---------- stocks, ETFs, indexes, futures ----------

export type SymbolKind = 'stock' | 'fund' | 'index' | 'future';

/**
 * Schwab calls ETFs "EQUITY" too; its assetSubType ('ETF', 'ETN', 'COE' ...) tells them apart (helpers that send it).
 * Without it, the catalog's ETF groups decide. Mutual funds and other non-equity types are funds.
 */
export function symbolKind(symbol: string, assetType?: string, assetSubType?: string): SymbolKind {
  if (symbol.startsWith('/')) return 'future';
  if (symbol.startsWith('$') || assetType === 'INDEX') return 'index';
  if (assetType && assetType !== 'EQUITY') return 'fund'; // MUTUAL_FUND, ...
  if (assetSubType) return /^(ETF|ETN)$/i.test(assetSubType) ? 'fund' : 'stock';
  return CATALOG_ETFS.has(symbol.toUpperCase()) ? 'fund' : 'stock';
}

/**
 * The "Go to" list for a listed symbol, best first (the first PRIMARY become buttons). `detail` is the symbol window
 * this page already had (the fallback for Overview); `price` seeds the alert.
 */
export function symbolActions(symbol: string, label: string, kind: SymbolKind, ctx: GoContext, detail: () => void, price?: number | null): GoAction[] {
  const shown = symbol.replace(/^\$/, '');
  const ref = symbol.startsWith('/') ? null : guessMarket(symbol);
  const page = (route: string, method: string, ...args: unknown[]) => (ctx.openPage ? ctx.openPage(route, method, ...args) : (location.hash = `#${route}`));
  const go = (code: string, fallback: () => void) => () => openSecurity(symbol, code, fallback);
  const chartPage = () => ctx.openChart({ provider: 'schwab', symbol });

  const overview: GoAction = { id: 'des', label: 'Overview', icon: 'info', code: 'DES', hint: 'Security overview', run: go('DES', detail) };
  const chart: GoAction = { id: 'gp', label: 'Chart', icon: 'chart', code: 'GP', key: 'c', hint: 'Price chart (security view)', run: go('GP', chartPage) };
  const financials: GoAction = { id: 'fa', label: 'Financials', icon: 'profile', code: 'FA', key: 'f', hint: 'Income, balance sheet, cash flow', run: go('FA', () => page('research', 'open', symbol, 'financials')) };
  const research: GoAction = { id: 'research', label: 'Research', icon: 'research', key: 'r', hint: `Company research for ${shown}`, run: () => ctx.openResearch(symbol) };
  const news: GoAction = {
    id: 'cn',
    label: 'News',
    icon: 'news',
    code: 'CN',
    key: 'n',
    hint: `News on ${shown}`,
    run: go('CN', () => window.open(`https://news.google.com/search?q=${encodeURIComponent(`${shown} ${label}`)}`, '_blank', 'noopener')),
  };
  const holders: GoAction = { id: 'hds', label: 'Holders', icon: 'account', code: 'HDS', hint: 'Institutional holders and insiders', run: go('HDS', () => page('flow', 'open', symbol, 'insiders')) };
  const options: GoAction = { id: 'omon', label: 'Options', icon: 'flow', code: 'OMON', hint: 'Options monitor', run: go('OMON', () => page('flow', 'open', symbol, 'options')) };
  const dividends: GoAction = { id: 'dvd', label: 'Dividends', icon: 'calendar', code: 'DVD', hint: 'Dividend history and yield', run: go('DVD', detail) };
  // Pre-fills the Trade page's ticket only; nothing is placed from here (preview and confirm happen there).
  const trade: GoAction = { id: 'trade', label: 'Trade', icon: 'trade', hint: `Open the order ticket with ${shown} filled in (you still preview and confirm)`, run: () => void import('../trade/webull').then((m) => m.openOrderTicket({ symbol, side: 'BUY' })) };
  const chartPageAction: GoAction = { id: 'chartpage', label: 'Chart page', icon: 'candles', hint: 'Open on the Chart page (indicators, drawings)', run: chartPage };
  const journal: GoAction | null = routeExists('journal') ? { id: 'journal', label: 'Journal', icon: 'clients', hint: `Your journal trades in ${shown}`, run: () => page('journal', 'open', symbol) } : null;
  const ai = aiAction(`How is ${label} (${shown}) doing lately, and why? Use live data.`);
  const rest = [compareAction(), watchlistAction(ref), alertAction(ref, price), trade, ai, journal];

  let list: (GoAction | null)[];
  if (kind === 'stock') list = [overview, chart, financials, news, research, holders, options, dividends, chartPageAction, ...rest];
  else if (kind === 'fund') list = [overview, chart, news, dividends, compareAction(), holders, options, chartPageAction, watchlistAction(ref), alertAction(ref, price), trade, ai, journal];
  else if (kind === 'index') list = [overview, chart, news, compareAction(), ai, chartPageAction, watchlistAction(ref), alertAction(ref, price)];
  else
    list = [
      { ...chartPageAction, label: 'Chart', key: 'c' },
      { id: 'futures', label: 'Futures', icon: 'futures', hint: 'The Futures page (curve, COT positioning)', run: () => page('futures', 'open', symbol.slice(1)) },
      ai,
    ];
  // Same id twice (compare in rest): keep the first.
  const seen = new Set<string>();
  return list.filter((a): a is GoAction => !!a && !seen.has(a.id) && !!seen.add(a.id));
}

export function coinActions(symbol: string, label: string, ctx: GoContext): GoAction[] {
  const ref: MarketRef = { provider: 'coinbase', symbol };
  return [
    { id: 'gp', label: 'Chart', icon: 'chart', code: 'GP', key: 'c', hint: 'Live chart (Coinbase)', run: () => ctx.openChart(ref) },
    compareAction(),
    watchlistAction(ref)!,
    alertAction(ref, null)!,
    aiAction(`How is ${label} (${symbol}) doing lately, and why? Use live data.`),
  ];
}

// ---------- the bar and the menu ----------

/** The first PRIMARY actions as labelled icon buttons, then "More" for the rest. */
export function actionBar(actions: GoAction[], opts: { title: string; tabbable?: boolean }): HTMLElement {
  const primary = actions.slice(0, PRIMARY);
  const more = actions.slice(PRIMARY);
  const tab = opts.tabbable ? undefined : '-1';
  const button = (a: GoAction) =>
    h(
      'button',
      {
        type: 'button',
        class: 'go-btn',
        title: `${a.hint}${a.code ? ` · ${a.code}` : ''}${a.key ? ` · press ${a.key.toUpperCase()}` : ''}`,
        'aria-pressed': a.pressed != null ? String(a.pressed) : undefined,
        'aria-keyshortcuts': a.key?.toUpperCase(),
        tabindex: tab,
        'data-go': a.id,
        onclick: (e: Event) => (e.stopPropagation(), a.run()),
      },
      icon(a.icon, 16),
      h('span', { class: 'go-label' }, a.label),
      a.code ? h('span', { class: 'go-code' }, a.code) : null,
    );
  const bar = h('div', { class: 'go-bar', role: 'group', 'aria-label': `Go to: ${opts.title}` }, ...primary.map(button));
  if (more.length) {
    const btn = h('button', { type: 'button', class: 'go-btn go-more', title: 'More places to go (right-click a row)', 'aria-haspopup': 'menu', tabindex: tab }, h('span', { class: 'go-dots', 'aria-hidden': 'true' }, '⋯'), h('span', { class: 'go-label' }, 'More'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGoMenu(more, btn, opts.title);
    });
    bar.append(btn);
  }
  return bar;
}

let menuClose: (() => void) | null = null;

/** A small menu of actions at a point (right-click) or under an element (⋯ / More). Arrow keys move, Esc closes. */
export function openGoMenu(actions: GoAction[], at: HTMLElement | { x: number; y: number }, title: string, returnFocus?: HTMLElement) {
  menuClose?.();
  const items = actions.map((a) =>
    h(
      'button',
      { type: 'button', role: 'menuitem', class: 'go-item', tabindex: '-1', title: a.hint, 'aria-keyshortcuts': a.key?.toUpperCase() },
      icon(a.icon, 16),
      h('span', { class: 'go-item-label' }, a.label, a.pressed ? h('span', { class: 'sr-only' }, ' (on)') : null),
      h('span', { class: 'go-code' }, [a.code, a.key?.toUpperCase()].filter(Boolean).join(' · ')),
    ),
  );
  const menu = h('div', { class: 'go-menu', role: 'menu', 'aria-label': `Go to: ${title}` }, h('div', { class: 'go-menu-title muted tiny', 'aria-hidden': 'true' }, title), ...items);
  document.body.append(menu);
  const rect = at instanceof HTMLElement ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const w = menu.offsetWidth;
  const ht = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(at instanceof HTMLElement ? rect.right - w : rect.left, vw - w - 8))}px`;
  menu.style.top = `${Math.max(8, rect.bottom + ht + 4 > vh - 8 ? rect.top - ht - 4 : rect.bottom + 4)}px`;
  const back = returnFocus ?? (at instanceof HTMLElement ? at : null);
  const close = (refocus = false) => {
    if (!menu.isConnected) return;
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    if (menuClose === closer) menuClose = null;
    if (refocus) back?.focus({ preventScroll: true });
  };
  const closer = () => close();
  menuClose = closer;
  const onDown = (e: Event) => !menu.contains(e.target as Node) && close();
  document.addEventListener('pointerdown', onDown, true);
  items.forEach((b, i) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      actions[i].run();
    }),
  );
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    else if (e.key === 'Home') items[0].focus();
    else if (e.key === 'End') items[items.length - 1].focus();
    else if (e.key === 'Escape' || e.key === 'Tab') close(true);
    else {
      const hit = actions.findIndex((a) => a.key === e.key.toLowerCase());
      if (hit < 0) return;
      close();
      actions[hit].run();
    }
    e.preventDefault();
    e.stopPropagation();
  });
  menu.addEventListener('focusout', (e) => !(e.relatedTarget instanceof Node && menu.contains(e.relatedTarget)) && setTimeout(() => !menu.contains(document.activeElement) && close(), 0));
  items[0]?.focus({ preventScroll: true });
}

export const closeGoMenu = () => menuClose?.();
