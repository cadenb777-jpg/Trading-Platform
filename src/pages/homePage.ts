/** The start screen: greeting, the three main US indexes, market news and the watchlist. */
import { CandlestickSeries, LineStyle, createChart, type IPriceLine, type UTCTimestamp } from 'lightweight-charts';
import { quoteChange, subscribeQuote, type MarketRef, type Quote } from '../data/quotes';
import { HELPER_OUTDATED, helper, loadNews, schwab, type NewsItem, type NewsSection } from '../data/schwab';
import { insightButton } from '../ai/insight';
import { createSetupsPanel } from '../home/setupsPanel';
import { createUpcomingPanel } from './calendarPage';
import { openNewsSummary } from '../ui/newsSummary';
import { persist, state } from '../state';
import { bucketStart, type Bar, type Timeframe } from '../types';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';
import { greeting, marketStatus } from '../ui/marketClock';
import { THEME, chartThemeOptions, followTheme } from '../ui/theme';
import { createWatchlist } from '../ui/watchlist';

const INDEXES: { symbol: string; name: string }[] = [
  { symbol: '$SPX', name: 'S&P 500' },
  { symbol: '$DJI', name: 'Dow Jones' },
  { symbol: '$COMPX', name: 'Nasdaq' },
];

const HELPER_GUIDE = 'https://github.com/cadenb777-jpg/Trading-Platform/blob/main/helper/README.md';
const NEWS_REFRESH_MS = 2 * 60 * 1000;

/** The bars from the most recent trading day(s), for the index card charts. */
function lastSessions(bars: Bar[], sessions: number): Bar[] {
  if (!bars.length) return [];
  const day = (t: number) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const days = [...new Set(bars.map((b) => day(b.time)))].slice(-sessions);
  return bars.filter((b) => days.includes(day(b.time)));
}

type CardRange = '1D' | '5D' | '1M';
const CARD_RANGES: Record<CardRange, { timeframe: Timeframe; sessions: number; label: string }> = {
  '1D': { timeframe: '10m', sessions: 1, label: '1 day, 10-minute candles' },
  '5D': { timeframe: '30m', sessions: 5, label: '5 days, 30-minute candles' },
  '1M': { timeframe: '1D', sessions: 22, label: '1 month, daily candles' },
};

const nyTime = (t: number, withDay: boolean) =>
  new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', ...(withDay ? { month: 'short', day: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' });
const nyDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const signed = (v: number, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function indexCard(index: { symbol: string; name: string }, onOpen: () => void) {
  const price = h('div', { class: 'idx-price' }, '—');
  const change = h('div', { class: 'idx-change' }, '');
  const chartBox = h('div', { class: 'idx-chart' });
  const legend = h('div', { class: 'idx-legend' });
  const rangePrev = h('span', {}, '');
  let range: CardRange = '1D';
  const rangeButtons = (Object.keys(CARD_RANGES) as CardRange[]).map((r) =>
    h('button', { class: r === range ? 'active' : '', title: CARD_RANGES[r].label, onclick: (e: Event) => (e.stopPropagation(), setRange(r)) }, r),
  );
  const card = h(
    'div',
    { class: 'idx-card', role: 'button', tabindex: 0, title: `Open ${index.name} chart`, onclick: onOpen, onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && e.target === card && onOpen() },
    h('div', { class: 'idx-head' }, h('span', { class: 'idx-name' }, index.name), h('span', { class: 'idx-sym' }, index.symbol.replace('$', ''))),
    h('div', { class: 'idx-quote' }, h('div', {}, price, change), h('div', { class: 'segmented tiny idx-ranges' }, ...rangeButtons)),
    h('div', { class: 'idx-chart-wrap' }, chartBox, legend),
    h('div', { class: 'idx-range' }, rangePrev),
  );

  // ----- Candles -----
  const daily = () => CARD_RANGES[range].timeframe === '1D';
  const chart = createChart(chartBox, {
    autoSize: true,
    ...chartThemeOptions(true),
    layout: { ...chartThemeOptions(true).layout, fontFamily: "'Inter', sans-serif", fontSize: 11, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, timeVisible: true, tickMarkFormatter: (t: number) => (daily() ? nyDate(t) : nyTime(t, range !== '1D').replace(/:00 /, ' ')) },
    localization: { timeFormatter: (t: number) => (daily() ? nyDate(t) : nyTime(t, true)), priceFormatter: (v: number) => formatPrice(v) },
    crosshair: { horzLine: { labelVisible: true }, vertLine: { labelVisible: false } },
    handleScroll: false,
    handleScale: false,
  });
  followTheme(chart, { transparent: true, hideVertGrid: true });
  const candles = chart.addSeries(CandlestickSeries, { upColor: THEME.up, downColor: THEME.down, borderVisible: false, wickUpColor: THEME.up, wickDownColor: THEME.down, priceLineVisible: false, lastValueVisible: true });
  let prevLine: IPriceLine | null = null;
  let bars: Bar[] = [];

  chart.subscribeCrosshairMove((param) => {
    const bar = param.time != null ? (param.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined) : undefined;
    if (!bar) return showLegend();
    const t = param.time as number;
    legend.replaceChildren(
      h('span', { class: 'muted' }, daily() ? nyDate(t) : nyTime(t, range !== '1D')),
      ` O ${formatPrice(bar.open)} H ${formatPrice(bar.high)} L ${formatPrice(bar.low)} C `,
      h('b', { class: bar.close >= bar.open ? 'up' : 'down' }, formatPrice(bar.close)),
    );
  });
  const showLegend = () => legend.replaceChildren(h('span', { class: 'muted' }, CARD_RANGES[range].label));

  let quote: Quote | undefined;
  let usingLastSession = false;
  let drawTimer: ReturnType<typeof setTimeout> | undefined;

  /** The bars with the live price folded into the newest candle (or a new one when a new period has started). */
  const liveBars = () => {
    if (!bars.length || quote?.last == null) return bars;
    const last = bars[bars.length - 1];
    const tf = CARD_RANGES[range].timeframe;
    const start = bucketStart(Math.floor(Date.now() / 1000), tf);
    const p = quote.last;
    // Only extend while the market session the bars belong to is still going (no candles after the close).
    if (start === last.time || (tf === '1D' && start <= last.time)) return [...bars.slice(0, -1), { ...last, close: p, high: Math.max(last.high, p), low: Math.min(last.low, p) }];
    if (marketStatus(new Date()).phase === 'open' && start > last.time) return [...bars, { time: start, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p, volume: 0 }];
    return bars;
  };

  const draw = () => {
    drawTimer = undefined;
    const data = liveBars();
    candles.applyOptions({ upColor: THEME.up, downColor: THEME.down, wickUpColor: THEME.up, wickDownColor: THEME.down });
    candles.setData(data.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    if (prevLine) candles.removePriceLine(prevLine);
    prevLine = range === '1D' && quote?.prevClose ? candles.createPriceLine({ price: quote.prevClose, color: '#8a8f9c', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: 'Prev close' }) : null;
    chart.timeScale().fitContent();
    const session = range === '1D' ? data : lastSessions(data, 1);
    const hi = session.length ? Math.max(...session.map((b) => b.high)) : null;
    const lo = session.length ? Math.min(...session.map((b) => b.low)) : null;
    rangePrev.textContent = quote?.prevClose
      ? `${usingLastSession ? 'At close · ' : ''}Prev close ${formatPrice(quote.prevClose)}${hi != null && lo != null && range === '1D' ? ` · Day range ${formatPrice(lo)} – ${formatPrice(hi)}` : ''}`
      : '';
    showLegend();
  };

  function setRange(r: CardRange) {
    range = r;
    rangeButtons.forEach((b) => b.classList.toggle('active', b.textContent === r));
    chart.applyOptions({ timeScale: { timeVisible: !daily() } });
    loadCandles();
  }

  const onQuote = (q: Quote) => {
    quote = q;
    usingLastSession = !!q.lastSession;
    const delta = quoteChange(q);
    price.textContent = formatPrice(q.last);
    change.textContent = delta ? `${signed(delta.change)} (${signed(delta.percent)}%)` : '';
    card.classList.toggle('up', !!delta && delta.change >= 0);
    card.classList.toggle('down', !!delta && delta.change < 0);
    drawTimer ??= setTimeout(draw, 1000);
  };

  let loading = 0;
  const loadCandles = async () => {
    const id = ++loading;
    const cfg = CARD_RANGES[range];
    try {
      const all = await schwab.loadHistory(index.symbol, cfg.timeframe, new AbortController().signal);
      if (id !== loading) return;
      bars = cfg.timeframe === '1D' ? all.slice(-cfg.sessions) : lastSessions(all, cfg.sessions);
    } catch {
      // The helper may still be starting; the card keeps showing the live price.
    }
    draw();
  };

  const snapshot = () => {
    const delta = quoteChange(quote);
    return quote?.last != null ? { index: index.name, last: quote.last, prevClose: quote.prevClose ?? null, changePercent: delta ? Number(delta.percent.toFixed(2)) : null } : null;
  };

  return { card, onQuote, loadSparkline: loadCandles, snapshot };
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
