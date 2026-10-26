/**
 * The ticker card: hover (desktop, 300 ms), tap or focus any element with `data-ticker="AAPL"` for a small card with
 * the name, price and day change, a 3-month line, your position across accounts, and actions (Open chart, Trade,
 * Research, Ask AI). Clicking a ticker that isn't inside a button or link pins the card. Esc closes it.
 * One delegated set of listeners on document (initTickerCards in main.ts), so a page only adds the attribute.
 * Trade only pre-fills the Trade page's ticket; nothing is ever placed from here.
 */
import { openAssistant } from '../ai/hub';
import { fetchedAt } from '../data/health';
import { guessMarket, type MarketRef } from '../data/quotes';
import { engineRequest, helper } from '../data/schwab';
import { listDocs } from '../data/store';
import type { BoardRow } from '../invest/shared';
import { combineHoldings, myPortfolios } from '../portfolio/account';
import type { Portfolio } from '../portfolio/types';
import { asOfStamp } from './dataHealth';
import { formatPrice, h } from './dom';
import { sparkline } from './sparkline';
import { THEME } from './theme';

export const TICKER_ATTR = 'data-ticker';
const SHOW_DELAY = 300;
const HIDE_DELAY = 250;

/** The attribute to spread into h(): `h('b', tickerAttr('AAPL'), 'AAPL')`. */
export const tickerAttr = (symbol: string) => ({ [TICKER_ATTR]: symbol });

/** A cleaned-up symbol (upper case; $SPX, /ES, BRK.B, BTC-USD allowed), or null when it isn't one. */
export function normalizeTicker(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  return /^[$/^]?[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(s) && s !== 'CASH' ? s : null;
}

/** The bits of an element this module reads, so the rules below can be tested without a browser. */
export interface TickerNode {
  tagName: string;
  getAttribute(name: string): string | null;
  parentElement: TickerNode | null;
  classList?: { contains(c: string): boolean };
}

/** The nearest element (itself or an ancestor, up to 6 levels) carrying a valid data-ticker. */
export function findTicker<T extends TickerNode>(start: T | null): { el: T; symbol: string } | null {
  let el: TickerNode | null = start;
  for (let i = 0; el && i < 7; i++, el = el.parentElement) {
    const raw = el.getAttribute?.(TICKER_ATTR);
    if (raw != null) {
      const symbol = normalizeTicker(raw);
      return symbol ? { el: el as T, symbol } : null;
    }
  }
  return null;
}

const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'option']);
/** A button, link or clickable row: something with its own click action. */
const isInteractive = (el: TickerNode) => INTERACTIVE.has(el.tagName) || ROLES.has(el.getAttribute('role') ?? '') || !!el.classList?.contains('clickable');

/**
 * What a click on a ticker does: 'pin' opens the pinned card (and stops the click), 'pass' leaves the page's own
 * click alone (a watchlist row still opens its chart). A tap always pins on touch screens, which have no hover.
 * `data-ticker-click="pin|pass"` overrides.
 */
export function clickMode(ticker: TickerNode, pointerType: string): 'pin' | 'pass' {
  const forced = ticker.getAttribute('data-ticker-click');
  if (forced === 'pin' || forced === 'pass') return forced;
  if (pointerType === 'touch') return 'pin';
  for (let el: TickerNode | null = ticker, i = 0; el && i < 8; el = el.parentElement, i++) if (isInteractive(el)) return 'pass';
  return 'pin';
}

/** Words in capitals that look like tickers but aren't, when matched without a "$" or exchange prefix. */
const NOT_TICKERS = new Set(['A', 'I', 'AI', 'CEO', 'CFO', 'IPO', 'ETF', 'GDP', 'CPI', 'PPI', 'FED', 'FOMC', 'US', 'USA', 'UK', 'EU', 'SEC', 'IT', 'ON', 'ALL', 'NOW', 'ARE', 'CAN', 'SO', 'BE', 'OR', 'AT', 'TV', 'EV', 'Q1', 'Q2', 'Q3', 'Q4']);

/**
 * Ticker symbols named in a headline: "$AAPL", "(NASDAQ: AAPL)", "(AAPL)", and any of `known` (e.g. your watchlist)
 * written as a whole word. In order of appearance, at most `max`.
 */
export function tickersIn(text: string, known: Iterable<string> = [], max = 4): string[] {
  const found: { at: number; s: string }[] = [];
  const add = (at: number, raw: string) => {
    const s = normalizeTicker(raw);
    if (s && !found.some((f) => f.s === s)) found.push({ at, s });
  };
  for (const m of text.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z])?)\b/g)) add(m.index!, m[1]);
  for (const m of text.matchAll(/\((?:(?:NASDAQ|NYSE|NYSEARCA|AMEX|CBOE)\s*:\s*)?([A-Z]{1,5}(?:\.[A-Z])?)\)/g)) if (!NOT_TICKERS.has(m[1])) add(m.index!, m[1]);
  for (const m of text.matchAll(/\b(?:NASDAQ|NYSE)\s*:\s*([A-Z]{1,5})\b/g)) add(m.index!, m[1]);
  for (const k of known) {
    const s = normalizeTicker(k);
    if (!s || s.length < 2 || NOT_TICKERS.has(s) || /^[$/^]/.test(s)) continue;
    const m = new RegExp(`(^|[^A-Za-z0-9$])${s.replace('.', '\\.')}(?![A-Za-z0-9])`).exec(text);
    if (m) add(m.index + m[1].length, s);
  }
  return found.sort((a, b) => a.at - b.at).slice(0, max).map((f) => f.s);
}

export interface HeldPosition {
  shares: number;
  /** Dollar amounts (dollars-mode holdings). */
  amount: number;
  accounts: { account: string; shares: number; amount: number }[];
}

/** Your position in `symbol` across your own portfolios (client portfolios excluded), or null when not held. */
export function heldPosition(symbol: string, portfolios: Portfolio[]): HeldPosition | null {
  const row = combineHoldings(myPortfolios(portfolios)).find((r) => r.symbol === symbol.toUpperCase() && r.kind !== 'cash');
  if (!row || (!row.shares && !row.amount)) return null;
  return { shares: row.shares, amount: row.amount, accounts: row.parts.map((p) => ({ account: p.account, shares: p.shares, amount: p.amount })) };
}

// ---------- the card (browser only) ----------

export interface TickerActions {
  openChart(ref: MarketRef): void;
  openResearch(symbol: string): void;
}
let actions: TickerActions = { openChart: () => {}, openResearch: () => {} };

let portfolios: { at: number; value: Promise<Portfolio[]> } | null = null;
function myAccounts(): Promise<Portfolio[]> {
  if (!portfolios || Date.now() - portfolios.at > 60_000) {
    const value = listDocs<Portfolio>('portfolios').catch(() => [] as Portfolio[]);
    portfolios = { at: Date.now(), value };
  }
  return portfolios.value;
}

const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v >= 1000 ? 0 : 2 });
const pctText = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}%`;
const shareText = (n: number) => `${+n.toFixed(4)} sh`;

interface Open {
  symbol: string;
  anchor: HTMLElement;
  card: HTMLElement;
  pinned: boolean;
  /** Opened by keyboard focus: Tab moves into the card. */
  byFocus: boolean;
}
let open: Open | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let lastPointer = 'mouse';
/** The anchor focus just returned to from the card: don't reopen until focus leaves it. */
let quiet: HTMLElement | null = null;
let cardSeq = 0;

function place(card: HTMLElement, anchor: HTMLElement) {
  if (window.innerWidth <= 560) {
    card.classList.add('sheet'); // phones: a sheet along the bottom of the screen
    card.style.left = card.style.top = '';
    return;
  }
  card.classList.remove('sheet');
  const r = anchor.getBoundingClientRect();
  const w = card.offsetWidth;
  const hgt = card.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8 ? r.top - hgt - 6 : below;
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(8, top)}px`;
}

/** Closes the card. A pending hover elsewhere still opens (a late scroll event must not cancel it). */
function close(refocus = false) {
  clearTimeout(hideTimer);
  if (!open) return;
  const { card, anchor } = open;
  const hadFocus = card.contains(document.activeElement);
  open = null; // first: removing the card moves focus, and the focusout handler must see it closed
  card.remove();
  anchor.removeAttribute('aria-describedby');
  if (refocus || hadFocus) {
    const back = focusTarget(anchor);
    quiet = back;
    back.focus({ preventScroll: true });
  }
}

/** The element keyboard focus lands on for this ticker (the ticker itself, or the row/button around it). */
const focusTarget = (el: HTMLElement): HTMLElement => (el.tabIndex >= 0 ? el : (el.closest<HTMLElement>('[tabindex], a, button') ?? el));

function show(symbol: string, anchor: HTMLElement, opts: { pinned: boolean; byFocus: boolean }) {
  clearTimeout(hideTimer);
  if (open && open.symbol === symbol && open.anchor === anchor) {
    if (opts.pinned && !open.pinned) {
      open.pinned = true;
      open.card.classList.add('pinned');
      open.card.setAttribute('role', 'dialog');
      (open.card.querySelector('.tc-actions button') as HTMLElement | null)?.focus({ preventScroll: true });
    }
    return;
  }
  close();
  const card = buildCard(symbol, opts.pinned);
  document.body.append(card);
  place(card, anchor);
  open = { symbol, anchor, card, pinned: opts.pinned, byFocus: opts.byFocus };
  anchor.setAttribute('aria-describedby', card.id);
  if (opts.pinned) (card.querySelector('.tc-actions button') as HTMLElement | null)?.focus({ preventScroll: true });
}

function buildCard(symbol: string, pinned: boolean) {
  const id = `ticker-card-${++cardSeq}`;
  const ref = guessMarket(symbol);
  const crypto = ref?.provider === 'coinbase';
  const index = symbol.startsWith('$') || symbol.startsWith('^');
  const future = symbol.startsWith('/');
  const name = h('div', { class: 'tc-name muted small' }, crypto ? 'Crypto (Coinbase)' : '');
  const price = h('div', { class: 'tc-price' }, h('span', { class: 'skeleton', style: 'display:inline-block;width:110px;height:20px' }));
  const spark = h('div', { class: 'tc-spark', 'aria-hidden': 'true' });
  const sparkLabel = h('div', { class: 'muted tiny' });
  const pos = h('div', { class: 'tc-pos' });
  const facts = h('div', { class: 'tc-facts muted small' });
  const stamp = asOfStamp('quotes');
  const btn = (label: string, title: string, run: () => void) =>
    h('button', { type: 'button', class: 'btn small', title, onclick: () => (close(), run()) }, label);
  const card = h(
    'div',
    { id, class: `ticker-card${pinned ? ' pinned' : ''}`, role: pinned ? 'dialog' : 'tooltip', 'aria-label': `${symbol} quick look` },
    h(
      'div',
      { class: 'tc-head' },
      h('b', { class: 'tc-sym' }, symbol.replace(/^\$/, '')),
      stamp.el,
      h('button', { type: 'button', class: 'icon-btn tc-close', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close(true) }, '✕'),
    ),
    name,
    price,
    spark,
    sparkLabel,
    pos,
    facts,
    h(
      'div',
      { class: 'tc-actions' },
      ref ? btn('Open chart', `Open ${symbol} on the Chart page`, () => actions.openChart(ref)) : '',
      !crypto && !index && !future
        ? btn('Trade', 'Opens the Trade page with this symbol filled in. You still preview and confirm; nothing is placed from here.', async () =>
            (await import('../trade/webull')).openOrderTicket({ symbol, side: 'BUY' }),
          )
        : '',
      !crypto && !index && !future ? btn('Research', `Company research for ${symbol}`, () => actions.openResearch(symbol)) : '',
      btn('Ask AI', `Ask the assistant about ${symbol}`, () =>
        openAssistant(`Give me a quick read on ${symbol}: what it is, how it has been trading lately, and anything I should know before buying or selling.`),
      ),
    ),
  );
  card.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  card.addEventListener('pointerleave', () => !open?.pinned && scheduleHide());
  void fill();
  return card;

  async function fill() {
    const still = () => card.isConnected;
    if (crypto) {
      price.replaceChildren(h('span', { class: 'muted small' }, 'Live crypto prices are on the chart.'));
    } else if (!helper.isConnected && !(await helper.connect().then(() => true, () => false))) {
      price.replaceChildren(h('span', { class: 'muted small' }, 'Prices appear when the helper is running.'));
    } else {
      try {
        const { rows } = await engineRequest<{ rows: BoardRow[] }>('invest.board', { symbols: [symbol] }, 30000);
        if (!still()) return;
        const r = rows[0];
        stamp.set(fetchedAt('invest.board'), r?.atClose ? { prefix: 'close', refreshMs: 0 } : {});
        if (r?.name) name.textContent = r.name;
        price.replaceChildren(
          r?.price != null ? h('span', { class: 'tc-last' }, formatPrice(r.price)) : h('span', { class: 'muted small' }, 'No quote right now'),
          r?.change != null ? h('span', { class: `tc-chg ${r.change >= 0 ? 'up' : 'down'}` }, `${pctText(r.change)} today`) : '',
        );
        if (r?.spark && r.spark.length > 1) {
          const up = r.spark[r.spark.length - 1] >= r.spark[0];
          spark.replaceChildren(sparkline(r.spark, null, up ? THEME.up : THEME.down));
          sparkLabel.textContent = `3 months${r.m3 != null ? `: ${pctText(r.m3)}` : ''}`;
        }
        const f = [
          r?.divYield ? `Dividend yield ${r.divYield.toFixed(2)}%` : '',
          r?.peRatio ? `P/E ${r.peRatio.toFixed(1)}` : '',
          r?.high52 && r?.low52 ? `52-week ${formatPrice(r.low52)}–${formatPrice(r.high52)}` : '',
        ].filter(Boolean);
        facts.textContent = f.join(' · ');
      } catch (err) {
        if (still()) price.replaceChildren(h('span', { class: 'muted small' }, (err as Error).message || 'No quote right now'));
      }
    }
    const held = heldPosition(symbol, await myAccounts());
    if (!still() || !held) return;
    const last = Number((price.querySelector('.tc-last')?.textContent ?? '').replace(/[^0-9.]/g, '')) || null;
    const value = held.amount + (last ? held.shares * last : 0);
    pos.replaceChildren(
      h('div', {}, h('b', {}, 'You hold '), held.shares ? shareText(held.shares) : '', held.shares && held.amount ? ' + ' : '', held.amount ? money(held.amount) : '', value && last ? ` · ${money(value)}` : ''),
      held.accounts.length > 1
        ? h('ul', { class: 'tc-accts muted small' }, ...held.accounts.map((a) => h('li', {}, `${a.account}: ${a.shares ? shareText(a.shares) : money(a.amount)}`)))
        : h('div', { class: 'muted small' }, `in ${held.accounts[0]?.account ?? 'your account'}`),
    );
    if (open?.card === card) place(card, open.anchor);
  }
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => !open?.pinned && close(), HIDE_DELAY);
}

const inCard = (n: EventTarget | null) => !!open && n instanceof Node && open.card.contains(n);
const asEl = (n: EventTarget | null) => (n instanceof Element ? (n as HTMLElement) : null);

/** Starts the delegated listeners (once, from main.ts) with the app's chart and research openers. */
export function initTickerCards(a: TickerActions) {
  actions = a;
  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType || 'mouse';
    if (open && !inCard(e.target) && !findTicker(asEl(e.target))) close();
  }, true);
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    if (inCard(e.target)) return clearTimeout(hideTimer);
    const t = findTicker(asEl(e.target));
    if (!t) return;
    clearTimeout(showTimer);
    if (open?.anchor === t.el) return clearTimeout(hideTimer);
    showTimer = setTimeout(() => show(t.symbol, t.el, { pinned: false, byFocus: false }), SHOW_DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const t = findTicker(asEl(e.target));
    if (!t) return;
    const to = asEl(e.relatedTarget);
    if (to && t.el.contains(to)) return;
    clearTimeout(showTimer);
    if (open && open.anchor === t.el && !open.pinned && !inCard(to)) scheduleHide();
  });
  document.addEventListener('click', (e) => {
    if (inCard(e.target)) return;
    const t = findTicker(asEl(e.target));
    if (!t || clickMode(t.el, lastPointer) === 'pass') return;
    e.preventDefault();
    e.stopPropagation();
    if (open?.anchor === t.el && open.pinned) return close();
    show(t.symbol, t.el, { pinned: true, byFocus: false });
  }, true);
  document.addEventListener('focusin', (e) => {
    const target = asEl(e.target);
    if (!target || inCard(target)) return;
    if (quiet && quiet === target) return;
    quiet = null;
    const t = findTicker(target) ?? (() => {
      const inner = target.querySelector?.<HTMLElement>(`[${TICKER_ATTR}]`);
      const symbol = normalizeTicker(inner?.getAttribute(TICKER_ATTR));
      return inner && symbol ? { el: inner, symbol } : null;
    })();
    if (!t) return;
    // only keyboard focus (a mouse click focuses too, and hover already handles that)
    if (!target.matches(':focus-visible')) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(t.symbol, t.el, { pinned: false, byFocus: true }), SHOW_DELAY);
  });
  document.addEventListener('focusout', (e) => {
    clearTimeout(showTimer);
    if (!open || open.pinned) return;
    const to = e.relatedTarget;
    if (inCard(to)) return;
    if (to instanceof Node && open.anchor.contains(to)) return;
    if (inCard(e.target) || open.anchor.contains(e.target as Node) || focusTarget(open.anchor).contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      clearTimeout(showTimer);
      close(inCard(document.activeElement) || open.byFocus);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...open.card.querySelectorAll<HTMLElement>('button')];
    const active = document.activeElement as HTMLElement | null;
    if (!inCard(active)) {
      // from the ticker, Tab steps into the card's actions
      if (!e.shiftKey && active && focusTarget(open.anchor) === active && items.length) {
        e.preventDefault();
        items.find((b) => !b.classList.contains('tc-close'))?.focus();
      }
      return;
    }
    const i = items.indexOf(active!);
    if ((e.shiftKey && i <= 0) || (!e.shiftKey && i === items.length - 1)) {
      e.preventDefault();
      close(true);
    }
  }, true);
  document.addEventListener('scroll', (e) => open && !open.pinned && !inCard(e.target) && close(), true);
  window.addEventListener('resize', () => open && place(open.card, open.anchor));
  window.addEventListener('hashchange', () => (clearTimeout(showTimer), close()));
}
