/** The start screen: greeting, the three main US indexes, market news and the watchlist. */
import { THEME } from '../chart/ChartView';
import { quoteChange, subscribeQuote, type MarketRef, type Quote } from '../data/quotes';
import { HELPER_OUTDATED, helper, loadNews, schwab, type NewsItem, type NewsSection } from '../data/schwab';
import { createUpcomingPanel } from './calendarPage';
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
  const card = h(
    'button',
    { class: 'idx-card', onclick: onOpen, title: `Open ${index.name} chart` },
    h('div', { class: 'idx-head' }, h('span', { class: 'idx-name' }, index.name), h('span', { class: 'idx-sym' }, index.symbol.replace('$', ''))),
    price,
    change,
    chartBox,
  );

  let closes: number[] = [];
  let quote: Quote | undefined;
  let drawTimer: ReturnType<typeof setTimeout> | undefined;

  const draw = () => {
    drawTimer = undefined;
    const delta = quoteChange(quote);
    const up = (delta?.change ?? 0) >= 0;
    const values = quote?.last != null && closes.length ? [...closes.slice(0, -1), quote.last] : closes;
    chartBox.replaceChildren(sparkline(values, quote?.prevClose ?? null, up ? THEME.up : THEME.down));
  };

  const onQuote = (q: Quote) => {
    quote = q;
    const delta = quoteChange(q);
    price.textContent = formatPrice(q.last);
    change.textContent = delta ? `${delta.change >= 0 ? '+' : ''}${formatPrice(delta.change)} (${delta.percent >= 0 ? '+' : ''}${delta.percent.toFixed(2)}%)` : '';
    card.classList.toggle('up', !!delta && delta.change >= 0);
    card.classList.toggle('down', !!delta && delta.change < 0);
    drawTimer ??= setTimeout(draw, 1000);
  };

  const loadSparkline = async () => {
    try {
      const bars = await schwab.loadHistory(index.symbol, '5m', new AbortController().signal);
      closes = lastSession(bars).map((b) => b.close);
      draw();
    } catch {
      // Shown once the helper is running; the card still shows the live price.
    }
  };

  return { card, onQuote, loadSparkline };
}

export function createHomePage(onOpenChart: (ref: MarketRef) => void, onOpenCalendar: () => void) {
  const greetingEl = h('h1', { class: 'greeting' });
  const dateEl = h('span', { class: 'muted' });
  const marketPill = h('span', { class: 'market-pill' });
  const bannerText = h('span', {});
  const banner = h('div', { class: 'helper-banner', hidden: true }, bannerText, ' ', h('a', { href: HELPER_GUIDE, target: '_blank', rel: 'noopener' }, 'Helper guide'));
  const showBanner = (up: boolean) => {
    banner.hidden = up && !helper.outdated;
    bannerText.replaceChildren(
      helper.outdated
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
  let importantOnly = true;
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
      'a',
      { class: `news-item impact-${item.impact}`, href: item.link, target: '_blank', rel: 'noopener noreferrer' },
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

  /** Picks and orders headlines for the current tab. "Top stories" ranks by market impact. */
  function visibleNews(items: NewsItem[]): NewsItem[] {
    let list = newsTab === 'top' || newsTab === 'watchlist' ? items : items.filter((i) => i.section === newsTab);
    if (importantOnly) list = list.filter((i) => i.impact !== 'low');
    if (newsTab === 'top') list = [...list].sort((a, b) => b.score - a.score);
    return list.slice(0, 40);
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
      newsList.replaceChildren(h('div', { class: 'muted pad' }, helper.outdated ? HELPER_OUTDATED : 'News appears here when the Schwab helper is running.'));
      newsFooter.textContent = '';
    }
  }

  const upcoming = createUpcomingPanel(onOpenCalendar);

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
      if (up && !helper.outdated) {
        refreshNews(true);
        upcoming.refresh();
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
