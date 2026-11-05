/**
 * The security view (Bloomberg-style: load one security, every tab acts on it). Used twice with one code path: the
 * full page (#sec/AAPL/FA) and the slide-over panel that opens when a ticker is clicked anywhere (open.ts).
 * Header: name, exchange, live last and change, day range, 52-week range bar, market cap, your position across
 * accounts. Then the action bar, the tabs with their mnemonics, the tab body and the Related row.
 * Trade only pre-fills the Trade page's ticket; nothing is ever placed from here.
 */
import { insightButton } from '../ai/insight';
import { openCotOnFutures } from '../futures/cot';
import { subscribeQuote } from '../data/quotes';
import { helper } from '../data/schwab';
import { combineHoldings, myPortfolios } from '../portfolio/account';
import { persist, state } from '../state';
import type { Timeframe } from '../types';
import { h, toast } from '../ui/dom';
import { linkPanel } from '../ui/linkGroups';
import { tickerAttr } from '../ui/tickerCard';
import { chartTab, type ChartTab } from './chartTab';
import { DEFAULT_TAB, SEC_TABS, tabDef, type SecTab } from './codes';
import { forget, loadBoard, loadCompany, loadDaily, loadPortfolios } from './data';
import { DASH, fmtChange, fmtCompact, fmtNum, fmtPct, fmtPrice, ok, tone } from './format';
import { relatedFor } from './related';
import { keyLevels } from './stats';
import { TAB_RENDER, isCompanyLike, type SecurityDeps } from './tabs';
import { asOfText, fig } from './ui';

export interface ViewOptions {
  mode: 'page' | 'panel';
  deps: SecurityDeps;
  /** The view loaded a security or changed tab (the host updates history and the hash). */
  onShow(symbol: string, tab: SecTab, how: 'load' | 'tab'): void;
  /** Extra buttons in the top bar (panel: expand, close). */
  extra?: Node[];
  /** Back / Forward (the shared history); null when there is nowhere to go. */
  nav: { back(): void; forward(): void; canBack(): boolean; canForward(): boolean; recents(): string[] };
}

export function createSecurityView(o: ViewOptions) {
  let symbol = '';
  let tab: SecTab = DEFAULT_TAB;
  let seq = 0;
  /** Counts security loads (the header's late replies are dropped; a tab switch doesn't cancel them). */
  let loadSeq = 0;
  let stopQuote = () => {};
  let chart: ChartTab | null = null;
  let shared: Record<string, unknown> = {};

  // ----- top bar: back / forward / recent / symbol box / link chip -----
  const backBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Back to the previous security (Alt+←)', 'aria-label': 'Previous security', onclick: () => o.nav.back() }, '←');
  const fwdBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Forward (Alt+→)', 'aria-label': 'Next security', onclick: () => o.nav.forward() }, '→');
  const recent = h('select', { class: 'input sv-recent', 'aria-label': 'Recent securities', title: 'Recent securities' });
  recent.addEventListener('change', () => recent.value && load(recent.value, DEFAULT_TAB));
  const input = h('input', { class: 'input sv-symbol', 'aria-label': 'Load a security', placeholder: 'Ticker', spellcheck: false, autocapitalize: 'characters', maxlength: 15 });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const [sym, code] = input.value.trim().toUpperCase().split(/\s+/);
    const t = SEC_TABS.find((x) => x.code === code || x.aliases?.includes(code ?? ''))?.id;
    if (sym) load(sym, t ?? DEFAULT_TAB, true);
  });
  const link = linkPanel({
    id: `security-${o.mode}`,
    label: o.mode === 'page' ? 'Security view' : 'Security panel',
    accepts: (s) => !s.startsWith('/'),
    apply: (s) => s !== symbol && load(s, tab),
    active: () => el.isConnected && el.getClientRects().length > 0,
  });

  // ----- header -----
  const nameEl = h('h2', { class: 'sv-name' });
  const metaEl = h('div', { class: 'sv-meta muted small' });
  const lastEl = h('b', { class: 'sv-last sv-num' });
  const chgEl = h('span', { class: 'sv-chg sv-num' });
  const asOfEl = h('span', { class: 'muted tiny sv-asof' });
  const statsEl = h('div', { class: 'sv-headstats' });
  const posEl = h('div', { class: 'sv-position', hidden: true });

  const tabsEl = h('div', { class: 'sv-tabs', role: 'tablist', 'aria-label': 'Security functions' });
  const body = h('div', { class: 'sv-body', role: 'tabpanel' });
  const related = h('div', { class: 'sv-related' });
  const ai = insightButton(() =>
    symbol
      ? { topic: 'research', symbol: symbol.replace(/^\$/, ''), title: `Security summary: ${symbol}`, data: { tab: tabDef(tab).label, ...shared } }
      : null,
  );

  const actions = h(
    'div',
    { class: 'sv-actions' },
    h('button', { type: 'button', class: 'btn small', onclick: () => addToWatchlist() }, '+ Watchlist'),
    h('button', { type: 'button', class: 'btn small', onclick: async () => (await import('../ui/alerts')).openAlertsDialog({ provider: 'schwab', symbol }, last) }, 'Alert'),
    h('button', { type: 'button', class: 'btn small', title: 'The full Chart page with this symbol and timeframe', onclick: () => openInChart() }, 'Open in Chart'),
    h('button', { type: 'button', class: 'btn small', title: 'Fills in the Trade page’s ticket. You still preview and confirm there; nothing is placed from here.', onclick: async () => isCompanyLike(symbol) ? (await import('../trade/webull')).openOrderTicket({ symbol, side: 'BUY' }) : toast('The order ticket takes US stocks and ETFs') }, 'Trade ticket'),
    ai.button,
    h('button', { type: 'button', class: 'btn small ghost', title: 'Load fresh data', onclick: () => (forget(symbol), load(symbol, tab, false, true)) }, 'Refresh'),
  );

  const el = h(
    'div',
    { class: `sv sv-${o.mode}` },
    h('div', { class: 'sv-top' }, backBtn, fwdBtn, recent, input, link.chip, h('span', { class: 'spacer' }), ...(o.extra ?? [])),
    h(
      'header',
      { class: 'sv-head' },
      h('div', { class: 'sv-title' }, nameEl, metaEl),
      h('div', { class: 'sv-quote' }, lastEl, chgEl, asOfEl),
      statsEl,
      posEl,
    ),
    actions,
    tabsEl,
    body,
    ai.panel,
    related,
  );

  let last: number | null = null;
  let prevClose: number | null = null;
  let quoteAt: number | null = null;

  function paintQuote() {
    lastEl.textContent = fmtPrice(last);
    lastEl.title = last == null ? 'Not available: no quote yet' : '';
    const chg = ok(last) && ok(prevClose) ? last - prevClose : null;
    const pc = ok(chg) && prevClose ? chg / prevClose : null;
    chgEl.textContent = chg == null ? DASH : `${fmtChange(chg)}  ${fmtPct(pc, 2, true)}`;
    chgEl.className = `sv-chg sv-num ${tone(chg)}`;
    asOfEl.textContent = quoteAt ? `Schwab · ${asOfText(quoteAt)}` : '';
  }

  function paintNav() {
    backBtn.disabled = !o.nav.canBack();
    fwdBtn.disabled = !o.nav.canForward();
    const list = o.nav.recents();
    recent.replaceChildren(h('option', { value: '' }, 'Recent'), ...list.map((s) => h('option', { value: s }, s.replace(/^\$/, ''))));
    recent.value = '';
  }

  function paintTabs() {
    tabsEl.replaceChildren(
      ...SEC_TABS.map((t) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `sv-tab${t.id === tab ? ' active' : ''}`,
            'aria-selected': String(t.id === tab),
            title: `${t.label} (${t.code}: type “${symbol.replace(/^\$/, '')} ${t.code}” in the command bar)`,
            onclick: () => setTab(t.id),
          },
          h('span', {}, t.label),
          h('kbd', { class: 'sv-code' }, t.code),
        ),
      ),
    );
    requestAnimationFrame(() => tabsEl.querySelector<HTMLElement>('.sv-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  /** The header's figures: one stat row, then the position. */
  async function fillHeader(mine: number) {
    const still = () => mine === loadSeq;
    const stat = (label: string, node: Node | string, hint?: string) => h('div', { class: 'sv-hstat', title: hint ?? '' }, h('span', { class: 'muted tiny' }, label), typeof node === 'string' ? fig(node) : node);
    const range = (lo: number | null, hi: number | null, cur: number | null) => {
      if (!ok(lo) || !ok(hi) || hi <= lo) return fig(DASH, { reason: 'no range yet' });
      const p = ok(cur) ? Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100)) : null;
      return h(
        'div',
        { class: 'sv-range', title: p == null ? '' : `${p.toFixed(0)}% of the way from the low to the high` },
        h('span', { class: 'sv-num tiny' }, fmtPrice(lo)),
        h('span', { class: 'sv-range-track' }, p == null ? null : h('i', { style: `left:${p}%` })),
        h('span', { class: 'sv-num tiny' }, fmtPrice(hi)),
      );
    };
    const [board, bars, company] = await Promise.all([
      loadBoard(symbol).catch(() => null),
      loadDaily(symbol).catch(() => null),
      isCompanyLike(symbol) ? loadCompany(symbol).catch((err: Error) => err) : Promise.resolve(null),
    ]);
    if (!still()) return;
    const row = board?.row ?? null;
    const k = bars?.length ? keyLevels(bars) : null;
    const co = company instanceof Error ? null : company;
    nameEl.replaceChildren(h('span', { class: 'sv-sym' }, symbol.replace(/^\$/, '')), ' ', h('span', { class: 'sv-fullname' }, row?.name || co?.profile.name || ''));
    metaEl.textContent = [co?.profile.exchange, row?.assetType, co?.profile.industry].filter(Boolean).join(' · ') || (helper.isConnected ? '' : 'Prices appear when the helper is running.');
    if (last == null) {
      last = row?.price ?? bars?.[bars.length - 1]?.close ?? null;
      quoteAt = board?.asOf ?? null;
    }
    if (prevClose == null) prevClose = row?.price != null && row.change != null ? row.price / (1 + row.change) : (k?.prevClose ?? null);
    paintQuote();
    shared.quote = { last, prevClose, high52: row?.high52 ?? k?.high52, low52: row?.low52 ?? k?.low52, peRatio: row?.peRatio, divYield: row?.divYield, name: row?.name };
    const mc = co?.valuation.marketCap ?? null;
    statsEl.replaceChildren(
      stat('Day range', range(k?.dayLow ?? null, k?.dayHigh ?? null, last), 'The latest session’s low and high (Schwab daily bar)'),
      stat('52-week range', range(row?.low52 ?? k?.low52 ?? null, row?.high52 ?? k?.high52 ?? null, last)),
      stat('Market cap', fig(fmtCompact(mc, { money: true }), { reason: company instanceof Error ? company.message : isCompanyLike(symbol) ? 'share count not in the SEC data' : 'not a company' }), 'Price × shares outstanding (SEC)'),
      stat('P/E', fig(row?.peRatio && row.peRatio > 0 ? `${fmtNum(row.peRatio, 1)}×` : DASH, { reason: 'no profit, or not a company' })),
      stat('Div. yield', fig(row?.divYield ? `${fmtNum(row.divYield, 2)}%` : DASH, { reason: 'no dividend' })),
    );
    // your position, across your own accounts (client portfolios left out)
    const pfs = await loadPortfolios().catch(() => []);
    if (!still()) return;
    const held = combineHoldings(myPortfolios(pfs)).find((r) => r.symbol === symbol && r.kind !== 'cash');
    posEl.hidden = !held;
    if (!held) return;
    const value = held.amount + (ok(last) ? held.shares * last : 0);
    const gain = held.cost != null && held.shares && ok(last) ? held.shares * last - held.cost : null;
    posEl.replaceChildren(
      h('b', {}, 'Your position'),
      h('span', {}, held.shares ? `${fmtNum(held.shares, held.shares % 1 ? 4 : 0)} sh` : '', held.amount ? ` ${fmtCompact(held.amount, { money: true })}` : ''),
      h('span', {}, 'Value ', fig(fmtCompact(value || null, { money: true }), { reason: 'no price' })),
      held.cost != null && held.shares ? h('span', {}, 'Avg cost ', fig(fmtPrice(held.cost / held.shares))) : '',
      gain != null ? h('span', {}, 'P/L ', fig(`${fmtChange(gain, 0)} (${fmtPct(held.cost ? gain / held.cost : null, 1, true)})`, { tone: tone(gain) })) : '',
      h('span', { class: 'muted small', title: held.parts.map((p) => `${p.account}: ${p.shares ? `${+p.shares.toFixed(4)} sh` : fmtCompact(p.amount, { money: true })}`).join('\n') }, held.parts.length > 1 ? `in ${held.parts.length} accounts` : `in ${held.parts[0]?.account ?? 'your account'}`),
    );
    shared.position = { shares: held.shares, value, cost: held.cost, accounts: held.parts.map((p) => p.account) };
  }

  function fillRelated() {
    const r = relatedFor(symbol);
    const chip = (s: string, title = '') => h('button', { type: 'button', class: 'sv-rel', ...tickerAttr(s), title, onclick: () => load(s, tab) }, s);
    related.replaceChildren(
      h('span', { class: 'muted small sv-rel-label' }, 'Related'),
      ...(r.peers.length ? [h('span', { class: 'muted tiny' }, `${r.sector} peers:`), ...r.peers.map((p) => chip(p))] : []),
      h('span', { class: 'muted tiny' }, 'ETFs:'),
      ...r.etfs.map(([e, name]) => chip(e, name)),
      h('span', { class: 'muted tiny' }, 'Futures (COT):'),
      h('button', { type: 'button', class: 'sv-rel', title: `${r.futures[1]}: who is positioned how (Futures page)`, onclick: () => openCotOnFutures({ symbol: symbol.replace(/^\$/, '') }) }, r.futures[0]),
    );
  }

  function renderTab() {
    const mine = seq;
    chart?.destroy();
    chart = null;
    const ctx = {
      symbol,
      body,
      still: () => mine === seq && el.isConnected,
      open: (s: string, t?: SecTab) => load(s, t ?? tab),
      deps: o.deps,
      share: (key: string, data: unknown) => (shared[key] = data),
    };
    body.setAttribute('aria-label', `${tabDef(tab).label} (${tabDef(tab).code})`);
    if (tab === 'gp') {
      chart = chartTab(symbol, ctx.still);
      body.replaceChildren(chart.el);
    } else TAB_RENDER[tab](ctx);
  }

  function setTab(t: SecTab) {
    if (t === tab && body.childElementCount) return;
    tab = t;
    seq++;
    paintTabs();
    renderTab();
    o.onShow(symbol, tab, 'tab');
  }

  /** Loads a security on a tab. `publish` = the user picked it here (linked panels follow). */
  function load(raw: string, t: SecTab = DEFAULT_TAB, publish = false, force = false) {
    const s = raw.trim().toUpperCase();
    if (!s) return;
    if (s.startsWith('/')) {
      o.deps.openPage('futures', 'open', s.slice(1));
      return;
    }
    if (s === symbol && !force) return setTab(t);
    symbol = s;
    tab = t;
    seq++;
    shared = {};
    last = prevClose = quoteAt = null;
    input.value = s.replace(/^\$/, '');
    nameEl.replaceChildren(h('span', { class: 'sv-sym' }, s.replace(/^\$/, '')));
    metaEl.textContent = '';
    statsEl.replaceChildren();
    posEl.hidden = true;
    ai.panel.hidden = true;
    paintQuote();
    paintTabs();
    renderTab();
    fillRelated();
    void fillHeader(++loadSeq);
    stopQuote();
    stopQuote = subscribeQuote({ provider: 'schwab', symbol: s }, (q) => {
      if (q.last == null) return;
      last = q.last;
      if (q.prevClose) prevClose = q.prevClose;
      quoteAt = Date.now();
      paintQuote();
    });
    if (publish) link.publish(s);
    o.onShow(symbol, tab, 'load');
    paintNav();
  }

  function addToWatchlist() {
    const ref = { provider: 'schwab' as const, symbol };
    if (state.watchlist.some((r) => r.provider === ref.provider && r.symbol === ref.symbol)) return toast(`${symbol} is already on your watchlist`);
    state.watchlist.push(ref);
    persist();
    toast(`Added ${symbol} to your watchlist`);
  }

  function openInChart() {
    const tf: Timeframe = chart?.timeframe() ?? '1D';
    state.timeframe = tf;
    persist();
    o.deps.openChart({ provider: 'schwab', symbol });
  }

  return {
    el,
    load,
    setTab,
    paintNav,
    get symbol() {
      return symbol;
    },
    get tab() {
      return tab;
    },
    /** The view was hidden or closed: stop live quotes and the chart. */
    stop() {
      stopQuote();
      stopQuote = () => {};
      chart?.destroy();
      chart = null;
      seq++;
      loadSeq++;
      symbol = '';
    },
    focus() {
      input.focus({ preventScroll: true });
    },
  };
}

export type SecurityView = ReturnType<typeof createSecurityView>;
