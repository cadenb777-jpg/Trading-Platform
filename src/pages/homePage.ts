/** The start screen: greeting, the three main US indexes, market news and the watchlist. */
import { THEME } from '../chart/ChartView';
import { quoteChange, subscribeQuote, type MarketRef, type Quote } from '../data/quotes';
import { HELPER_OUTDATED, helper, loadNews, schwab, type NewsItem, type NewsSection } from '../data/schwab';
import { insightButton } from '../ai/insight';
import { createSetupsPanel } from '../home/setupsPanel';
import { createUpcomingPanel } from './calendarPage';
import { openNewsSummary } from '../ui/newsSummary';
import { persist, state } from '../state';
import type { Bar } from '../types';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';
import { greeting, marketStatus } from '../ui/marketClock';
import { sparkline } from '../ui/sparkline';
import { createWatchlist } from '../ui/watchlist';

const INDEXES: { symbol: string; name: string }[] = [
  { symbol: '$SPX', name: 'S&P 500' },
  { symbol: '$DJI', name: 'Dow Jones' },
  { symbol: '$COMPX', name: 'Nasdaq' },
];

const HELPER_GUIDE = 'https://github.com/cadenb777-jpg/Trading-Platform/blob/main/helper/README.md';
const NEWS_REFRESH_MS = 2 * 60 * 1000;

/** The bars from the most recent trading day, for the index card mini charts. */
function lastSession(bars: Bar[]): Bar[] {
  if (!bars.length) return [];
  const day = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const lastDay = day(bars[bars.length - 1].time);
  return bars.filter((b) => day(b.time) === lastDay);
}

function indexCard(index: { symbol: string; name: string }, onOpen: () => void) {
  const price = h('div', { class: 'idx-price' }, '—');
  const change = h('div', { class: 'idx-change' }, '');
  const chartBox = h('div', { class: 'idx-chart' });
  const rangeHigh = h('span', {}, '');
  const rangeLow = h('span', {}, '');
  const rangePrev = h('span', {}, '');
  const axis = h('div', { class: 'idx-axis' }, rangeHigh, rangeLow);
  const card = h(
    'button',
    { class: 'idx-card', onclick: onOpen, title: `Open ${index.name} chart` },
    h('div', { class: 'idx-head' }, h('span', { class: 'idx-name' }, index.name), h('span', { class: 'idx-sym' }, index.symbol.replace('$', ''))),
    price,
    change,
    h('div', { class: 'idx-chart-wrap' }, chartBox, axis),
    h('div', { class: 'idx-range' }, rangePrev),
  );

  let closes: number[] = [];
  let quote: Quote | undefined;
  // Between sessions Schwab moves an index's "previous close" up to the latest close, so price - previous close is 0
  // (and older helpers send the stream's close, which does the same after 4 PM). Like Google Finance, show the latest
  // session's move then: measured from the close of the trading day before it, taken from the daily bars.
  let daily: Bar[] = [];
  let usingLastSession = false;
  const fixed = (q: Quote): Quote => {
    usingLastSession = false;
    if (q.last == null || daily.length < 2) return q;
    const zero = !q.prevClose || Math.abs(q.last - q.prevClose) <= q.last * 1e-6;
    if (!zero && (helper.version ?? 0) >= 10) return q;
    const lastBar = daily[daily.length - 1];
    // If the newest daily bar already closed at the current price, it is the latest session: compare with the day before.
    const prev = Math.abs(lastBar.close - q.last) <= q.last * 1e-4 ? daily[daily.length - 2].close : lastBar.close;
    // Sanity check: an index doesn't move 20% in a session, so anything bigger means the bars don't match the quote.
    if (!prev || Math.abs(prev - q.last) <= q.last * 1e-6 || Math.abs(prev / q.last - 1) > 0.2) return q;
    usingLastSession = marketStatus(new Date()).phase !== 'open';
    return { ...q, prevClose: prev };
  };
  let raw: Quote | undefined;
  let drawTimer: ReturnType<typeof setTimeout> | undefined;

  const draw = () => {
    drawTimer = undefined;
    const delta = quoteChange(quote);
    const up = (delta?.change ?? 0) >= 0;
    const values = quote?.last != null && closes.length ? [...closes.slice(0, -1), quote.last] : closes;
    chartBox.replaceChildren(sparkline(values, quote?.prevClose ?? null, up ? THEME.up : THEME.down));
    if (values.length) {
      rangeHigh.textContent = formatPrice(Math.max(...values));
      rangeLow.textContent = formatPrice(Math.min(...values));
    }
    rangePrev.textContent = quote?.prevClose ? `${usingLastSession ? 'Last session · ' : ''}Prev close ${formatPrice(quote.prevClose)} · Day range ${values.length ? `${formatPrice(Math.min(...values))} – ${formatPrice(Math.max(...values))}` : '—'}` : '';
  };

  const onQuote = (incoming: Quote) => {
    raw = incoming;
    const q = fixed(incoming);
    quote = q;
    const delta = quoteChange(q);
    price.textContent = formatPrice(q.last);
    change.textContent = delta ? `${delta.change >= 0 ? '+' : ''}${formatPrice(delta.change)} (${delta.percent >= 0 ? '+' : ''}${delta.percent.toFixed(2)}%)` : '';
    card.classList.toggle('up', !!delta && delta.change >= 0);
    card.classList.toggle('down', !!delta && delta.change < 0);
    drawTimer ??= setTimeout(draw, 1000);
  };

  const loadSparkline = async () => {
    const [intraday, days] = await Promise.allSettled([
      schwab.loadHistory(index.symbol, '5m', new AbortController().signal),
      schwab.loadHistory(index.symbol, '1D', new AbortController().signal),
    ]);
    // Either can fail while the helper is starting; the card still shows the live price.
    if (intraday.status === 'fulfilled') closes = lastSession(intraday.value).map((b) => b.close);
    if (days.status === 'fulfilled' && days.value.length) daily = days.value;
    if (raw) onQuote(raw);
    draw();
  };

  const snapshot = () => {
    const delta = quoteChange(quote);
    return quote?.last != null ? { index: index.name, last: quote.last, prevClose: quote.prevClose ?? null, changePercent: delta ? Number(delta.percent.toFixed(2)) : null } : null;
  };

  return { card, onQuote, loadSparkline, snapshot };
}

export function createHomePage(onOpenChart: (ref: MarketRef) => void, onOpenCalendar: () => void) {
  const greetingEl = h('h1', { class: 'greeting' });
  const dateEl = h('span', { class: 'muted' });
  const marketPill = h('span', { class: 'market-pill' });
  const bannerText = h('span', {});
  const banner = h('div', { class: 'helper-banner', hidden: true }, bannerText, ' ', h('a', { href: HELPER_GUIDE, target: '_blank', rel: 'noopener' }, 'Helper guide'));
  const showBanner = (up: boolean) => {
    banner.hidden = up && !helper.tooOld;
    bannerText.replaceChildren(
      helper.tooOld
        ? h('b', {}, HELPER_OUTDATED)
        : h('span', {}, h('b', {}, 'Live stock prices and news need the Schwab helper.'), ' Start it on this computer and this page connects automatically.'),
    );
  };

  const cards = INDEXES.map((index) => indexCard(index, () => onOpenChart({ provider: 'schwab', symbol: index.symbol })));

  // ---------- News ----------

  type NewsTab = 'top' | NewsSection | 'watchlist';
  const TABS: [NewsTab, string][] = [
    ['top', 'Top stories'],
    ['economy', 'Economy'],
    ['markets', 'Markets'],
    ['companies', 'Companies'],
    ['crypto', 'Crypto'],
    ['watchlist', 'My watchlist'],
  ];
  let newsTab: NewsTab = 'top';
  let importantOnly = false;
  let sortBy: 'latest' | 'impact' = 'latest';
  let general: { items: NewsItem[]; failed: string[] } | null = null;
  const newsList = h('div', { class: 'news-list', 'aria-live': 'polite' });
  const newsFooter = h('div', { class: 'news-foot muted small' });
  const tabs = h(
    'div',
    { class: 'tabs news-tabs', role: 'tablist' },
    ...TABS.map(([id, label]) => h('button', { class: `tab${newsTab === id ? ' active' : ''}`, role: 'tab', 'data-tab': id, onclick: () => setTab(id) }, label)),
  );
  const importantToggle = h('input', { type: 'checkbox', checked: importantOnly });
  importantToggle.addEventListener('change', () => {
    importantOnly = importantToggle.checked;
    showNews();
  });
  const sortButtons = (['latest', 'impact'] as const).map((k) =>
    h('button', { class: k === sortBy ? 'active' : '', onclick: () => setSort(k) }, k === 'latest' ? 'Latest' : 'Most important'),
  );
  function setSort(k: 'latest' | 'impact') {
    sortBy = k;
    sortButtons.forEach((b, i) => b.classList.toggle('active', (['latest', 'impact'] as const)[i] === k));
    showNews();
  }
  const refreshBtn = h('button', { class: 'icon-btn', title: 'Refresh news', 'aria-label': 'Refresh news', onclick: () => refreshNews(true) }, icon('refresh', 18));

  function setTab(id: NewsTab) {
    newsTab = id;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    if (id === 'watchlist') refreshNews();
    else showNews();
  }

  const IMPACT_LABEL = { high: 'High impact', medium: 'Medium', low: '' } as const;

  function newsItem(item: NewsItem) {
    return h(
      'button',
      { class: `news-item impact-${item.impact}`, onclick: () => openNewsSummary(item) },
      h(
        'div',
        { class: 'news-meta' },
        item.impact !== 'low' ? h('span', { class: `impact-badge ${item.impact}` }, IMPACT_LABEL[item.impact]) : null,
        h('span', { class: 'news-source' }, item.source),
        h('span', { class: 'muted' }, timeAgo(item.published)),
        item.alsoReportedBy.length ? h('span', { class: 'muted', title: `Also reported by ${item.alsoReportedBy.join(', ')}` }, `+${item.alsoReportedBy.length} sources`) : null,
        ...item.tags.map((t) => h('span', { class: 'news-tag' }, t)),
      ),
      h('div', { class: 'news-title' }, item.title),
      item.summary && item.summary !== item.title ? h('div', { class: 'news-summary' }, item.summary) : null,
    );
  }

  /** Picks and orders headlines for the current tab: newest first, or by market impact. */
  function visibleNews(items: NewsItem[]): NewsItem[] {
    let list = newsTab === 'top' || newsTab === 'watchlist' ? items : items.filter((i) => i.section === newsTab);
    if (importantOnly) list = list.filter((i) => i.impact !== 'low');
    list = [...list].sort((a, b) => (sortBy === 'latest' ? b.published - a.published : b.score - a.score || b.published - a.published));
    return list.slice(0, 50);
  }

  function renderNews(items: NewsItem[], failed: string[]) {
    const list = visibleNews(items);
    newsList.replaceChildren(...list.map(newsItem));
    if (!list.length) {
      newsList.append(h('div', { class: 'muted pad' }, importantOnly && items.length ? 'No market-moving headlines here right now. Untick "Important only" to see everything.' : 'No headlines right now.'));
    }
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    newsFooter.textContent = `Updated ${time} · Google News and CNBC${failed.length ? ` · couldn't reach ${failed.join(', ')}` : ''}`;
  }

  let watchNews: { items: NewsItem[]; failed: string[] } | null = null;
  function showNews() {
    const data = newsTab === 'watchlist' ? watchNews : general;
    if (data) renderNews(data.items, data.failed);
  }

  let newsRequest = 0;
  async function refreshNews(force = false) {
    const request = ++newsRequest;
    const wantWatchlist = newsTab === 'watchlist';
    if (!force && (wantWatchlist ? watchNews : general)) showNews();
    else if (!newsList.childElementCount) newsList.append(h('div', { class: 'muted pad' }, 'Loading headlines…'));
    const symbols = state.watchlist.filter((r) => r.provider === 'schwab' && !r.symbol.startsWith('$')).map((r) => r.symbol);
    try {
      const result = await loadNews(wantWatchlist ? (symbols.length ? symbols : ['SPY']) : []);
      if (wantWatchlist) watchNews = result;
      else general = result;
      if (request === newsRequest) showNews();
    } catch {
      if (request !== newsRequest) return;
      newsList.replaceChildren(h('div', { class: 'muted pad' }, helper.tooOld ? HELPER_OUTDATED : 'News appears here when the Schwab helper is running.'));
      newsFooter.textContent = '';
    }
  }

  const upcoming = createUpcomingPanel(onOpenCalendar);
  const setups = createSetupsPanel(onOpenChart);
  const marketRead = insightButton(() => {
    const indexes = cards.map((c) => c.snapshot()).filter(Boolean);
    if (!indexes.length && !general) return null;
    const headlines = (general?.items ?? [])
      .filter((i) => i.impact !== 'low')
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((i) => ({ title: i.title, source: i.source, impact: i.impact, section: i.section, published: new Date(i.published * 1000).toISOString() }));
    return { topic: 'market', symbol: '', title: 'AI market read', data: { asOf: new Date().toISOString(), session: marketStatus(new Date()).label, indexes, headlines } };
  }, 'AI market read');

  const watchlist = createWatchlist({ onSelect: onOpenChart });

  const el = h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'home-hero' },
      greetingEl,
      h('div', { class: 'hero-sub' }, dateEl, marketPill),
    ),
    banner,
    h('section', { class: 'idx-row', 'aria-label': 'Market indexes' }, ...cards.map((c) => c.card)),
    h('div', { class: 'home-ai-row' }, marketRead.button, h('span', { class: 'muted small' }, 'Bullish or bearish? A quick read of the indexes and the biggest headlines.')),
    marketRead.panel,
    setups.el,
    h(
      'div',
      { class: 'home-grid' },
      h(
        'section',
        { class: 'panel news-panel' },
        h(
          'div',
          { class: 'panel-head' },
          h('h3', {}, icon('news', 20), ' Market news'),
          h('span', { class: 'spacer' }),
          h('div', { class: 'segmented small' }, ...sortButtons),
          h('label', { class: 'toggle', title: 'Show only stories likely to move the market' }, importantToggle, ' Important only'),
          refreshBtn,
        ),
        tabs,
        newsList,
        newsFooter,
      ),
      h('div', { class: 'home-side' }, upcoming.el, h('div', { class: 'panel watch-panel' }, watchlist.el)),
    ),
  );

  function renderClock() {
    const now = new Date();
    greetingEl.replaceChildren(
      `${greeting(now)}, `,
      h(
        'button',
        {
          class: 'name-btn',
          title: 'Change your name',
          onclick: () => {
            const name = prompt('What should I call you?', state.userName)?.trim();
            if (!name) return;
            state.userName = name;
            persist();
            renderClock();
          },
        },
        state.userName,
      ),
    );
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const status = marketStatus(now);
    marketPill.textContent = status.label;
    marketPill.className = `market-pill ${status.phase}`;
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    renderClock();
    setInterval(renderClock, 30000);
    for (const [i, index] of INDEXES.entries()) subscribeQuote({ provider: 'schwab', symbol: index.symbol }, cards[i].onQuote);
    helper.onAvailability((up) => {
      showBanner(up);
      if (up && !helper.tooOld) {
        refreshNews(true);
        upcoming.refresh();
        setups.start();
        for (const c of cards) c.loadSparkline();
      }
    });
    setInterval(() => !el.hidden && helper.isConnected && refreshNews(true), NEWS_REFRESH_MS);
    setInterval(() => !el.hidden && helper.isConnected && upcoming.refresh(), 5 * 60 * 1000);
    setInterval(() => helper.isConnected && cards.forEach((c) => c.loadSparkline()), 5 * 60 * 1000);
    refreshNews();
  }

  return { el, start };
}
