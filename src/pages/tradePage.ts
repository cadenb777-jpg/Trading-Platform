/**
 * Trade page (#trade): place Webull stock orders. Left: symbol search and a watchlist with live Schwab quotes.
 * Centre: the symbol's candlestick chart (1D / 5m) with your average cost and open orders as lines. Right: the order
 * ticket (src/trade/ticket.ts). Below: positions, open orders (Cancel) and recent fills.
 *
 * Every order goes through the shared preview -> confirm window (src/trade/webull.ts); this page never places one by
 * itself and no key places an order (B/S switch side, Enter previews, Esc closes). The account refreshes with one
 * webull.snapshot request every 30 s while the page is open and the tab is visible (the helper paces Webull).
 */
import { CandlestickSeries, ColorType, LineStyle, createChart, type IChartApi, type IPriceLine, type ISeriesApi } from 'lightweight-charts';
import { quoteChange, subscribeQuote, type Quote } from '../data/quotes';
import { engineRequest, schwab } from '../data/schwab';
import { state } from '../state';
import { createTicket, type TicketQuote } from '../trade/ticket';
import { cancelOrder, envBadge, friendly, loadSnapshot, OPEN, orderPrice, takePrefill, usd, type Order, type PlacedOrder, type Snapshot, type TicketPrefill } from '../trade/webull';
import { dataTable } from '../ui/charts';
import { formatPrice, h, timeAgo, toast } from '../ui/dom';
import { THEME, followTheme } from '../ui/theme';

const WATCH_KEY = 'tp-trade-watch';
const SYMBOL_KEY = 'tp-trade-symbol';
const PROTECT_KEY = 'tp-trade-protect';
const REFRESH_MS = 30_000;
const DEFAULT_WATCH = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'SPY', 'QQQ'];

function load<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* only a convenience */
  }
}
const pctText = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');

export function createTradePage() {
  let snap: Snapshot | null = null;
  let accountId = '';
  let loadedAt = 0;
  let started = false;
  let symbol = (load<string>(SYMBOL_KEY, '') || DEFAULT_WATCH[0]).toUpperCase();
  let tf: '1D' | '5m' = '1D';
  const watch: string[] = (() => {
    const saved = load<string[] | null>(WATCH_KEY, null);
    if (Array.isArray(saved) && saved.length) return saved;
    const fromApp = state.watchlist.filter((r) => r.provider === 'schwab').map((r) => r.symbol);
    return fromApp.length ? fromApp.slice(0, 12) : [...DEFAULT_WATCH];
  })();
  const quotes = new Map<string, Quote>();
  const books = new Map<string, { bid: number | null; ask: number | null; name: string; last: number | null }>();
  const quoteStops = new Map<string, () => void>();
  const protect = load<Record<string, number>>(PROTECT_KEY, {});

  // ----- layout -----
  const envSlot = h('span', { class: 'tr-env' }, h('span', { class: 'badge' }, 'Webull…'));
  const acctSlot = h('span', { class: 'tr-acct' });
  const statsSlot = h('div', { class: 'tr-stats' });
  const updated = h('span', { class: 'muted tiny tr-updated' });
  const refreshBtn = h('button', { class: 'btn small', title: 'Refresh the account now', onclick: () => refresh(true) }, 'Refresh') as HTMLButtonElement;
  const top = h('header', { class: 'tr-top' }, h('h1', {}, 'Trade'), envSlot, acctSlot, statsSlot, h('span', { class: 'spacer' }), updated, refreshBtn);
  const notice = h('div', { class: 'tr-notice' });

  const search = h('input', { class: 'input', placeholder: 'Search symbol or company', autocomplete: 'off', spellcheck: false, 'aria-label': 'Search symbol' }) as HTMLInputElement;
  const results = h('div', { class: 'tr-results', role: 'listbox' });
  const watchList = h('div', { class: 'tr-watch-list' });
  const watchPanel = h('section', { class: 'panel tr-watch' }, h('div', { class: 'tr-search' }, search, results), h('h4', { class: 'section-label' }, 'Watchlist'), watchList);

  const chartTitle = h('div', { class: 'tr-chart-title' });
  const tfEl = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Chart time frame' });
  const chartBox = h('div', { class: 'tr-chart-box' });
  const chartPanel = h('section', { class: 'panel tr-chart' }, h('div', { class: 'tr-chart-head' }, chartTitle, h('span', { class: 'spacer' }), tfEl), chartBox);

  const protectSlot = h('div', { class: 'tr-protect-slot' });
  const ticket = createTicket({
    snapshot: () => snap,
    quote: (s) => quoteFor(s),
    onSymbol: (s) => select(s, false),
    onPlaced: placed,
  });
  const ticketPanel = h('section', { class: 'panel tr-ticket' }, protectSlot, ticket.el);

  const tabs: { key: 'positions' | 'open' | 'fills'; label: string }[] = [
    { key: 'positions', label: 'Positions' },
    { key: 'open', label: 'Open orders' },
    { key: 'fills', label: 'Recent fills' },
  ];
  let tab: (typeof tabs)[number]['key'] = 'positions';
  const tabsEl = h('div', { class: 'tabs tr-tabs', role: 'tablist' });
  const listBody = h('div', { class: 'tr-list-body' });
  const listsPanel = h('section', { class: 'panel tr-lists' }, tabsEl, listBody);

  const grid = h('div', { class: 'tr-grid' }, watchPanel, chartPanel, ticketPanel, listsPanel);
  const el = h('div', { class: 'analysis-page trade-page' }, top, notice, grid);

  // ----- quotes -----
  function quoteFor(s: string): TicketQuote | null {
    const live = quotes.get(s);
    const book = books.get(s);
    const last = live?.last ?? book?.last ?? null;
    return last == null && !book ? null : { last, bid: book?.bid ?? null, ask: book?.ask ?? null };
  }

  function followQuotes() {
    const wanted = new Set([...watch, symbol]);
    for (const [s, stop] of quoteStops) if (!wanted.has(s)) (stop(), quoteStops.delete(s));
    for (const s of wanted) {
      if (quoteStops.has(s)) continue;
      quoteStops.set(
        s,
        subscribeQuote({ provider: 'schwab', symbol: s }, (q) => {
          quotes.set(s, q);
          drawWatchRow(s);
          if (s === symbol) {
            drawTitle();
            liveBar(q);
            ticket.refresh();
          }
        }),
      );
    }
  }

  /** Bid/ask and the name for the chosen symbol (Schwab quote via invest.board; the browser reuses it for 20 s). */
  async function loadBook(s: string) {
    try {
      const { rows } = await engineRequest<{ rows: { symbol: string; name?: string; price: number | null; bid?: number | null; ask?: number | null }[] }>('invest.board', { symbols: [s] }, 30000);
      const r = rows[0];
      if (r) books.set(s, { bid: r.bid ?? null, ask: r.ask ?? null, name: r.name ?? '', last: r.price });
    } catch {
      /* the live stream still gives the last price */
    }
    if (s === symbol) (drawTitle(), ticket.refresh());
  }

  // ----- watchlist and search -----
  const rowEls = new Map<string, HTMLElement>();
  function drawWatch() {
    rowEls.clear();
    watchList.replaceChildren(
      ...watch.map((s) => {
        const row = h('div', { class: `tr-wrow${s === symbol ? ' on' : ''}`, role: 'button', tabindex: 0, onclick: () => select(s), onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') select(s); } });
        rowEls.set(s, row);
        drawWatchRow(s);
        return row;
      }),
    );
    if (!watch.length) watchList.append(h('p', { class: 'muted small' }, 'Search above to add symbols.'));
  }
  function drawWatchRow(s: string) {
    const row = rowEls.get(s);
    if (!row) return;
    const q = quotes.get(s);
    const ch = quoteChange(q);
    const held = snap?.positions?.some((p) => p.symbol === s && p.qty > 0);
    row.replaceChildren(
      h('span', { class: 'tr-wsym' }, s, held ? h('span', { class: 'tr-held', title: 'You hold this' }, '●') : null),
      h('span', { class: 'num tr-wlast' }, q?.last != null ? formatPrice(q.last) : '—'),
      h('span', { class: `num tr-wchg ${tone(ch?.percent)}` }, ch ? pctText(ch.percent) : ''),
      h('button', { class: 'icon-btn tr-wdel', type: 'button', title: `Remove ${s}`, 'aria-label': `Remove ${s}`, onclick: (e: Event) => (e.stopPropagation(), removeWatch(s)) }, '✕'),
    );
  }
  function addWatch(s: string) {
    if (!watch.includes(s)) watch.unshift(s);
    save(WATCH_KEY, watch);
  }
  function removeWatch(s: string) {
    const i = watch.indexOf(s);
    if (i >= 0) watch.splice(i, 1);
    save(WATCH_KEY, watch);
    drawWatch();
    followQuotes();
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < 2) return results.replaceChildren();
    searchTimer = setTimeout(async () => {
      const mine = ++searchSeq;
      try {
        const r = await engineRequest<{ results: { symbol: string; name: string; assetType: string }[] }>('invest.search', { query: q }, 20000);
        if (mine !== searchSeq) return;
        results.replaceChildren(
          ...r.results
            .filter((x) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(x.symbol) && x.assetType !== 'MUTUAL_FUND')
            .slice(0, 8)
            .map((x) => h('button', { type: 'button', class: 'tr-result', role: 'option', onclick: () => pick(x.symbol) }, h('b', {}, x.symbol), h('span', { class: 'muted small' }, x.name))),
        );
      } catch {
        results.replaceChildren();
      }
    }, 300);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const first = results.querySelector<HTMLButtonElement>('.tr-result');
      const typed = search.value.trim().toUpperCase();
      if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(typed)) pick(typed);
      else first?.click();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      search.value = '';
      results.replaceChildren();
      search.blur();
    }
  });
  function pick(s: string) {
    search.value = '';
    results.replaceChildren();
    addWatch(s);
    select(s);
  }

  /** Makes a symbol the page's symbol: chart, quote, ticket. */
  function select(s: string, toTicket = true) {
    s = s.toUpperCase();
    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(s)) return;
    const changed = s !== symbol;
    symbol = s;
    save(SYMBOL_KEY, s);
    if (toTicket) ticket.setSymbol(s);
    rowEls.forEach((row, k) => row.classList.toggle('on', k === s));
    followQuotes();
    drawTitle();
    if (changed || !series) drawChart();
    loadBook(s);
  }

  // ----- chart -----
  let chart: IChartApi | null = null;
  let series: ISeriesApi<'Candlestick'> | null = null;
  let lines: IPriceLine[] = [];
  let lastBar: { time: number; open: number; high: number; low: number; close: number } | null = null;
  let chartSeq = 0;

  function drawTitle() {
    const q = quotes.get(symbol);
    const ch = quoteChange(q);
    const book = books.get(symbol);
    const last = q?.last ?? book?.last ?? null;
    chartTitle.replaceChildren(
      h('b', { class: 'tr-sym' }, symbol),
      h('span', { class: 'muted small tr-name' }, book?.name ?? ''),
      h('span', { class: 'num tr-price' }, last != null ? usd(last) : '—'),
      h('span', { class: `num small ${tone(ch?.change)}` }, ch ? `${ch.change >= 0 ? '+' : '−'}${formatPrice(Math.abs(ch.change))} (${pctText(ch.percent)})` : ''),
    );
  }

  function drawTf() {
    tfEl.replaceChildren(
      ...(['1D', '5m'] as const).map((t) =>
        h('button', { type: 'button', class: t === tf ? 'active' : '', 'aria-pressed': t === tf, onclick: () => ((tf = t), drawTf(), drawChart()) }, t === '1D' ? 'Daily' : '5 min'),
      ),
    );
  }

  async function drawChart() {
    const mine = ++chartSeq;
    const s = symbol;
    try {
      const bars = (await schwab.loadHistory(s, tf, new AbortController().signal)).slice(tf === '1D' ? -260 : -390);
      if (mine !== chartSeq) return;
      if (!chart) {
        chartBox.replaceChildren();
        chart = createChart(chartBox, {
          autoSize: true,
          layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: THEME.text },
          grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
          rightPriceScale: { borderColor: THEME.border },
          timeScale: { borderColor: THEME.border },
        });
        followTheme(chart, { transparent: true, hideVertGrid: true });
        series = chart.addSeries(CandlestickSeries, { upColor: THEME.up, downColor: THEME.down, wickUpColor: THEME.up, wickDownColor: THEME.down, borderVisible: false });
      }
      chart.applyOptions({ timeScale: { timeVisible: tf !== '1D' } });
      const data = bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
      series!.setData(data.map((d) => ({ ...d, time: d.time as never })));
      lastBar = data.length ? { ...data[data.length - 1] } : null;
      chart.timeScale().fitContent();
      drawLines();
    } catch (err) {
      if (mine !== chartSeq) return;
      chart?.remove();
      chart = null;
      series = null;
      lines = [];
      chartBox.replaceChildren(h('p', { class: 'muted small pad' }, `Chart unavailable: ${friendly(err)}`));
    }
  }

  /** Average cost and open orders for the symbol as price lines. */
  function drawLines() {
    if (!series) return;
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    const add = (price: number, color: string, title: string, style = LineStyle.Dashed) => lines.push(series!.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    const pos = snap?.positions?.find((p) => p.symbol === symbol && p.qty > 0);
    if (pos?.avgCost) add(pos.avgCost, THEME.accent, `Avg cost · ${pos.qty}`, LineStyle.Solid);
    for (const o of (snap?.open ?? []).filter((x) => x.symbol === symbol && OPEN.test(x.status))) {
      const color = o.side === 'BUY' ? THEME.up : THEME.down;
      const left = (o.qty ?? 0) - o.filled;
      if (o.stopPrice != null) add(o.stopPrice, color, `${o.side === 'BUY' ? 'Buy' : 'Sell'} stop ${left}`);
      if (o.limitPrice != null) add(o.limitPrice, color, `${o.side === 'BUY' ? 'Buy' : 'Sell'} limit ${left}`);
    }
  }

  /** The live price moves the last candle (no new bars are added between refreshes). */
  function liveBar(q: Quote) {
    if (!series || !lastBar || q.last == null) return;
    lastBar = { ...lastBar, close: q.last, high: Math.max(lastBar.high, q.last), low: Math.min(lastBar.low, q.last) };
    series.update({ ...lastBar, time: lastBar.time as never });
  }

  // ----- account -----
  let refreshing: Promise<void> | null = null;
  let queued = false;
  function refresh(force = false): Promise<void> {
    // A forced refresh (after an order or cancel) asked while one is on its way runs again right after it, so the
    // page doesn't keep the answer that started before the order.
    if (refreshing) {
      if (force) queued = true;
      return refreshing;
    }
    if (!force && Date.now() - loadedAt < REFRESH_MS - 1000) return Promise.resolve();
    refreshBtn.disabled = true;
    refreshing = (async () => {
      try {
        const next = await loadSnapshot(accountId || undefined);
        snap = next;
        loadedAt = Date.now();
        if (next.ok) accountId = next.accountId ?? accountId;
      } catch (err) {
        snap = null;
        loadedAt = Date.now();
        showError(friendly(err));
        return;
      } finally {
        refreshing = null;
        refreshBtn.disabled = false;
        if (queued) {
          queued = false;
          setTimeout(() => refresh(true));
        }
      }
      drawAccount();
    })();
    return refreshing;
  }

  function showError(message: string) {
    envSlot.replaceChildren(h('span', { class: 'badge warn' }, 'Not connected'));
    acctSlot.replaceChildren();
    statsSlot.replaceChildren();
    notice.replaceChildren(setupSteps(message, false));
    grid.classList.add('tr-offline');
    drawLists();
  }

  function drawAccount() {
    if (!snap) return;
    if (!snap.ok) {
      envSlot.replaceChildren(envBadge(snap.env));
      notice.replaceChildren(setupSteps(snap.message, !!snap.busy));
      grid.classList.add('tr-offline');
      statsSlot.replaceChildren();
      acctSlot.replaceChildren();
      drawLists();
      return;
    }
    grid.classList.remove('tr-offline');
    el.classList.toggle('tr-is-live', snap.env === 'live');
    envSlot.replaceChildren(envBadge(snap.env));
    if (snap.accounts.length > 1) {
      const sel = h('select', { class: 'input', 'aria-label': 'Account' }, ...snap.accounts.map((a) => h('option', { value: a.id, selected: a.id === accountId }, a.label))) as HTMLSelectElement;
      sel.addEventListener('change', () => ((accountId = sel.value), refresh(true)));
      acctSlot.replaceChildren(sel);
    } else acctSlot.replaceChildren(h('span', { class: 'muted small' }, snap.account ?? ''));
    const b = snap.balances;
    const today = (snap.positions ?? []).reduce<number | null>((t, p) => (p.dayGain == null ? t : (t ?? 0) + p.dayGain), null);
    const stat = (label: string, value: string, cls = '', title = '') => h('div', { class: 'tr-stat', title }, h('span', { class: 'muted tiny' }, label), h('b', { class: `num ${cls}` }, value));
    statsSlot.replaceChildren(
      stat('Account value', usd(b?.value)),
      stat('Buying power', usd(b?.buyingPower), '', 'What you can spend on new orders now'),
      stat('Today', today == null ? '—' : `${today >= 0 ? '+' : ''}${usd(today)}`, tone(today), 'Change in your positions’ value today (Schwab prices)'),
      stat('Orders today', `${snap.placedToday ?? '?'} / ${snap.limits.maxPerDay}`, '', `Max ${usd(snap.limits.maxOrder)} per order (Settings)`),
    );
    const errs = Object.values(snap.errors ?? {});
    notice.replaceChildren(
      snap.env === 'live' ? h('p', { class: 'wb-warning small' }, 'LIVE: orders placed here use real money in your Webull account.') : '',
      ...[...new Set(errs)].map((e) => h('div', { class: 'ap-error' }, e)),
    );
    for (const s of rowEls.keys()) drawWatchRow(s);
    drawProtect();
    drawLines();
    drawLists();
    ticket.refresh();
    tickUpdated();
  }

  function tickUpdated() {
    // the helper's fetch time (it reuses Webull answers for up to 20 s), not when the browser asked
    const asOf = snap?.ok ? snap.asOf : null;
    updated.textContent = asOf ? `As of ${new Date(asOf * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : '';
    updated.title = asOf ? `Fetched from Webull ${timeAgo(asOf)}` : '';
  }

  function setupSteps(message: string, busy: boolean) {
    if (busy) return h('div', { class: 'empty-state tr-setup' }, h('b', {}, 'Webull is busy right now.'), h('span', {}, message));
    return h(
      'div',
      { class: 'empty-state tr-setup' },
      h('b', {}, 'Connect Webull to trade here'),
      h('span', { class: 'muted' }, message),
      h(
        'ol',
        { class: 'tr-steps' },
        h('li', {}, 'Start the helper on your computer (the start file in the project folder).'),
        h('li', {}, 'In the Webull app or website, open API Management and create an App Key and App Secret (free).'),
        h('li', {}, 'Open Settings → Webull, paste both keys and press Test connection. Test (practice money) is the default.'),
        h('li', {}, 'Come back here: your account, positions and the order ticket appear.'),
      ),
      h('button', { class: 'btn primary', onclick: async () => (await import('../ui/settings')).openSettings() }, 'Open Settings'),
    );
  }

  // ----- protect after a buy -----
  function placed(order: PlacedOrder, protectStop: number | null, ok: boolean) {
    if (ok && order.side === 'BUY' && protectStop && protectStop > 0) protect[order.symbol] = protectStop;
    if (ok && order.side === 'SELL' && order.orderType.startsWith('STOP')) delete protect[order.symbol];
    save(PROTECT_KEY, protect);
    refresh(true);
  }

  function drawProtect() {
    const items = Object.entries(protect).filter(([s]) => {
      const pos = snap?.positions?.find((p) => p.symbol === s && p.qty > 0);
      const open = (snap?.open ?? []).filter((o) => o.symbol === s && OPEN.test(o.status));
      const guarded = open.some((o) => o.side === 'SELL' && o.stopPrice != null);
      const waiting = open.some((o) => o.side === 'BUY'); // the buy hasn't filled yet
      return pos && !guarded && !waiting;
    });
    protectSlot.replaceChildren(
      ...items.map(([s, stop]) => {
        const pos = snap!.positions!.find((p) => p.symbol === s)!;
        return h(
          'div',
          { class: 'tr-protect' },
          h('div', {}, h('b', {}, `Protect ${s}?`), h('span', { class: 'muted small' }, ` You hold ${pos.qty}. A stop sell at ${usd(stop)} gets you out if it falls there.`)),
          h('div', { class: 'tr-protect-actions' },
            h('button', { class: 'btn small primary', type: 'button', onclick: () => (select(s), ticket.fill({ symbol: s, side: 'SELL', orderType: 'STOP', stopPrice: stop, qty: pos.qty, tif: 'GTC' }), ticket.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })) }, 'Fill stop order'),
            h('button', { class: 'btn small ghost', type: 'button', title: 'Hide this', onclick: () => (delete protect[s], save(PROTECT_KEY, protect), drawProtect()) }, 'Not now'),
          ),
        );
      }),
    );
  }

  // ----- lists -----
  function drawTabs() {
    const count = { positions: snap?.positions?.length ?? 0, open: (snap?.open ?? []).length, fills: fills().length };
    tabsEl.replaceChildren(
      ...tabs.map((t) => h('button', { type: 'button', class: `tab${t.key === tab ? ' active' : ''}`, role: 'tab', 'aria-selected': t.key === tab, onclick: () => ((tab = t.key), drawLists()) }, t.label, snap?.ok ? h('span', { class: 'tr-count' }, String(count[t.key])) : null)),
    );
  }
  const fills = () => (snap?.recent ?? []).filter((o) => o.filled > 0 || /FILLED/.test(o.status));

  function drawLists() {
    drawTabs();
    if (!snap?.ok) return listBody.replaceChildren(h('p', { class: 'muted small pad' }, 'Your positions and orders show here once Webull is connected.'));
    const err = (k: string) => h('div', { class: 'ap-error' }, snap?.errors?.[k] ?? 'Not available right now.');
    if (tab === 'positions') {
      const rows = snap.positions;
      if (!rows) return listBody.replaceChildren(err('positions'));
      if (!rows.length) return listBody.replaceChildren(h('div', { class: 'empty-state' }, 'No positions yet. Your first fill shows here.'));
      const table = dataTable(
        ['Symbol', 'Shares', 'Avg cost', 'Price', 'Today', 'Total P&L', 'Value'],
        rows.map((p) => {
          const totalPct = p.gain != null && p.cost ? (p.gain / p.cost) * 100 : null;
          return [
            { v: h('button', { type: 'button', class: 'link-btn', title: `Load ${p.symbol}` }, p.symbol), cls: 'label' },
            { v: p.qty.toLocaleString('en-US'), cls: 'num' },
            { v: usd(p.avgCost), cls: 'num' },
            { v: usd(p.price), cls: 'num' },
            { v: p.dayGain == null ? '—' : `${p.dayGain >= 0 ? '+' : ''}${usd(p.dayGain)}`, cls: `num ${tone(p.dayGain)}` },
            { v: p.gain == null ? '—' : `${p.gain >= 0 ? '+' : ''}${usd(p.gain)}${totalPct != null ? ` (${pctText(totalPct)})` : ''}`, cls: `num ${tone(p.gain)}` },
            { v: usd(p.value), cls: 'num' },
          ];
        }),
        undefined,
        { id: 'trade:positions' },
      );
      table.classList.add('tr-clickable');
      table.addEventListener('click', (e) => {
        const tr = (e.target as HTMLElement).closest('tbody tr');
        const s = tr?.querySelector('td')?.textContent?.trim();
        if (s) select(s);
      });
      return listBody.replaceChildren(table);
    }
    if (tab === 'open') {
      const rows = snap.open;
      if (!rows) return listBody.replaceChildren(err('orders'));
      if (!rows.length) return listBody.replaceChildren(h('div', { class: 'empty-state' }, 'No open orders.'));
      return listBody.replaceChildren(
        dataTable(
          ['Symbol', 'Side', 'Qty', 'Type', 'Price', 'Time in force', 'Status', ''],
          rows.map((o) => [
            { v: o.symbol, cls: 'label' },
            { v: o.side, cls: o.side === 'BUY' ? 'up' : 'down' },
            { v: `${o.filled ? `${o.filled}/` : ''}${o.qty ?? '—'}`, cls: 'num' },
            o.type.replace(/_/g, ' ').toLowerCase(),
            orderPrice(o),
            o.tif,
            { v: o.status.replace(/_/g, ' ').toLowerCase(), cls: 'wb-warn' },
            cancelButton(o),
          ]),
          undefined,
          { id: 'trade:open' },
        ),
      );
    }
    const rows = fills();
    if (!snap.recent) return listBody.replaceChildren(err('orders'));
    if (!rows.length) return listBody.replaceChildren(h('div', { class: 'empty-state' }, 'No fills in the last 7 days.'));
    return listBody.replaceChildren(
      dataTable(
        ['Symbol', 'Side', 'Filled', 'Type', 'Price', 'Status', 'Time'],
        rows.map((o) => [
          { v: o.symbol, cls: 'label' },
          { v: o.side, cls: o.side === 'BUY' ? 'up' : 'down' },
          { v: `${o.filled || o.qty || '—'}`, cls: 'num' },
          o.type.replace(/_/g, ' ').toLowerCase(),
          orderPrice(o),
          o.status.replace(/_/g, ' ').toLowerCase(),
          o.placedAt ? new Date(o.placedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
        ]),
        undefined,
        { id: 'trade:fills' },
      ),
    );
  }

  function cancelButton(o: Order) {
    if (!o.orderId) return '';
    const btn = h('button', { class: 'btn small', type: 'button' }, 'Cancel') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (await cancelOrder(o)) refresh(true);
      else btn.disabled = false;
    });
    return btn;
  }

  // ----- keyboard: B / S switch side, Enter previews; never a one-key place -----
  function onKey(e: KeyboardEvent) {
    if (!started || el.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-backdrop')) return; // the confirm window has its own buttons; keys never place
    const target = e.target instanceof HTMLElement ? e.target : document.body;
    const typing = target.closest('input, select, textarea, [contenteditable="true"]');
    const key = e.key.toLowerCase();
    if (!typing && (key === 'b' || key === 's')) {
      e.preventDefault();
      ticket.setSide(key === 'b' ? 'BUY' : 'SELL');
    } else if (e.key === 'Enter' && !typing && !target.closest('button, a, [role="button"]')) {
      // (inside the ticket's fields Enter submits its form, which previews)
      e.preventDefault();
      ticket.preview();
    } else if (e.key === 'Escape' && typing) {
      (target as HTMLElement).blur();
    }
  }

  function usePrefill(p: TicketPrefill | null) {
    if (!p) return;
    if (p.symbol) (addWatch(p.symbol.toUpperCase()), drawWatch(), select(p.symbol, false));
    ticket.fill(p);
    toast('Order ticket filled in. Check it, then Preview.');
  }

  // ----- start / stop -----
  let timer: ReturnType<typeof setInterval> | undefined;
  const onVisible = () => document.visibilityState === 'visible' && started && refresh();
  window.addEventListener('tp:trade-prefill', () => started && usePrefill(takePrefill()));
  drawTf();
  drawWatch();
  ticket.setSymbol(symbol);
  drawLists();

  return {
    el,
    start() {
      started = true;
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisible);
      clearInterval(timer);
      timer = setInterval(() => {
        tickUpdated();
        if (document.visibilityState === 'visible') refresh();
      }, 5000);
      followQuotes();
      if (!series) select(symbol, false);
      refresh();
      usePrefill(takePrefill());
    },
    stop() {
      started = false;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
      for (const stop of quoteStops.values()) stop();
      quoteStops.clear();
    },
  };
}
