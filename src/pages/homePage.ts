/**
 * The start screen: the greeting hero with the overnight strip, then a widget dashboard the owner arranges (indexes,
 * my accounts, what needs attention, setups, news, the week's calendar, the watchlist; src/home/widgets.ts).
 */
import { CandlestickSeries, LineStyle, TickMarkType, createChart, type IPriceLine, type UTCTimestamp } from 'lightweight-charts';
import { quoteChange, subscribeQuote, type MarketRef, type Quote } from '../data/quotes';
import { HELPER_OUTDATED, helper, loadNews, schwab, type NewsItem, type NewsSection } from '../data/schwab';
import { insightButton } from '../ai/insight';
import { briefKeys, createMorningBrief } from '../home/morningBrief';
import { briefNeedsLoad } from '../home/brief';
import { createUpcomingPanel } from './calendarPage';
import { openNewsSummary } from '../ui/newsSummary';
import { listDocs } from '../data/store';
import { holdingNewsSymbols } from '../portfolio/account';
import type { Portfolio } from '../portfolio/types';
import { persist, state } from '../state';
import { bucketStart, type Bar, type Timeframe } from '../types';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { functionBar } from '../ui/functionBar';
import { panelHeader } from '../ui/panel';
import { LAYOUT_KEY, WIDGETS, addWidget, defaultLayout, hiddenWidgets, moveWidget, nextSpan, parseLayout, removeWidget, updateWidget, type Layout, type WidgetId } from '../home/widgets';
import type { ReadySetup } from '../home/brief';
import { greeting, marketStatus } from '../ui/marketClock';
import { createTickerTape } from '../home/tickerTape';
import { THEME, chartThemeOptions, followTheme } from '../ui/theme';
import { createWatchlist } from '../ui/watchlist';
import { tickerAttr, tickersIn } from '../ui/tickerCard';
import { isStockSymbol, linkPanel, links } from '../ui/linkGroups';

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
/** Short axis labels for the small cards: "Mon 27" where a new session starts (the chart marks a new UTC day there,
 *  which is the same day in New York during market hours), "10:30" otherwise, "Oct 3" on daily candles. */
export function cardTick(t: number, tickType: TickMarkType, range: '1D' | '5D' | '1M') {
  if (range === '1M') return nyDate(t);
  const d = new Date(t * 1000);
  if (range === '5D' && tickType <= TickMarkType.DayOfMonth)
    return `${d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' })} ${d.toLocaleDateString('en-US', { timeZone: 'America/New_York', day: 'numeric' })}`;
  return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?[AP]M$/, '');
}
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
    h('div', { class: 'idx-head' }, h('span', { class: 'idx-name' }, index.name), h('span', { class: 'idx-sym', ...tickerAttr(index.symbol) }, index.symbol.replace('$', ''))),
    h('div', { class: 'idx-quote' }, h('div', {}, price, change), h('div', { class: 'segmented tiny idx-ranges' }, ...rangeButtons)),
    h('div', { class: 'idx-chart-wrap' }, chartBox, legend),
    h('div', { class: 'idx-range' }, rangePrev),
  );

  // ----- Candles -----
  const daily = () => CARD_RANGES[range].timeframe === '1D';
  const chart = createChart(chartBox, {
    autoSize: true,
    ...chartThemeOptions(true),
    layout: { ...chartThemeOptions(true).layout, fontFamily: "'Inter', sans-serif", fontSize: 11 },
    // the square dotted grid comes from chartThemeOptions + followTheme (src/chart/grid.ts)
    rightPriceScale: { borderVisible: false, entireTextOnly: true, scaleMargins: { top: 0.18, bottom: 0.08 } }, // entireTextOnly: no half-cut labels at the edges
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, timeVisible: true, tickMarkMaxCharacterLength: 6, tickMarkFormatter: (t: number, type: TickMarkType) => cardTick(t, type, range) },
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
    // Just the line: its price is written under the chart, and an axis tag would cover the scale's own labels.
    prevLine = range === '1D' && quote?.prevClose ? candles.createPriceLine({ price: quote.prevClose, color: THEME.crosshair, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' }) : null;
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

export function createHomePage(onOpenChart: (ref: MarketRef) => void, onOpenCalendar: () => void, openPage: (route: string, method?: string, ...args: unknown[]) => void) {
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

  type NewsTab = 'top' | NewsSection | 'watchlist' | 'holdings' | 'linked';
  const TABS: [NewsTab, string][] = [
    ['top', 'Top stories'],
    ['economy', 'Economy'],
    ['markets', 'Markets'],
    ['companies', 'Companies'],
    ['crypto', 'Crypto'],
    ['watchlist', 'My watchlist'],
    ['holdings', 'My holdings'],
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
  // The news link chip: a tab with the headlines for the linked group's stock (it changes with the Chart, Research...)
  const linkedTab = h('button', { class: 'tab', role: 'tab', 'data-tab': 'linked', hidden: true, onclick: () => setTab('linked') });
  tabs.append(linkedTab);
  const linkedSymbol = () => {
    const s = links.symbolFor('news');
    return s && isStockSymbol(s) ? s : null;
  };
  function drawLinkedTab() {
    const s = linkedSymbol();
    linkedTab.hidden = !s;
    linkedTab.textContent = s ? `${s} news` : '';
    linkedTab.title = s ? `Headlines for ${s}, the symbol of this panel's link colour` : '';
    if (!s && newsTab === 'linked') setTab('top');
  }
  const newsLink = linkPanel({ id: 'news', label: 'Home news', accepts: isStockSymbol, apply: () => (drawLinkedTab(), newsTab === 'linked' && !el.hidden && refreshNews(true)) });
  links.onColorChange((id) => id === 'news' && drawLinkedTab());
  drawLinkedTab();
  let linkedNews: { symbol: string; items: NewsItem[]; failed: string[] } | null = null;
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

  function setTab(id: NewsTab) {
    newsTab = id;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    // Holdings news is ranked by market impact (rank_news) unless you pick Latest.
    if (id === 'holdings' && !holdingsNews) setSort('impact');
    if (id === 'watchlist' || id === 'holdings' || id === 'linked') refreshNews();
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
        ...tickersIn(item.title, state.watchlist.filter((r) => r.provider === 'schwab').map((r) => r.symbol)).map((t) =>
          h('span', { class: 'news-chip', ...tickerAttr(t), title: `${t}: hover or tap for a quick look` }, t),
        ),
      ),
      h('div', { class: 'news-title' }, item.title),
      item.summary && item.summary !== item.title ? h('div', { class: 'news-summary' }, item.summary) : null,
    );
  }

  /** Picks and orders headlines for the current tab: newest first, or by market impact. */
  function visibleNews(items: NewsItem[]): NewsItem[] {
    let list = newsTab === 'top' || newsTab === 'watchlist' || newsTab === 'holdings' || newsTab === 'linked' ? items : items.filter((i) => i.section === newsTab);
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
  let holdingsNews: { items: NewsItem[]; failed: string[] } | null = null;
  /** Set when there are no holdings to fetch news for (explains how to add them). */
  let holdingsEmpty = false;
  function showNews() {
    if (newsTab === 'holdings' && holdingsEmpty) {
      newsList.replaceChildren(h('div', { class: 'muted pad' }, 'No holdings yet. On the Account page, import a statement or sync Webull: news on those stocks then shows here.'));
      newsFooter.textContent = '';
      return;
    }
    const data = newsTab === 'watchlist' ? watchNews : newsTab === 'holdings' ? holdingsNews : newsTab === 'linked' ? linkedNews : general;
    if (data) renderNews(data.items, data.failed);
  }

  let newsRequest = 0;
  async function refreshNews(force = false) {
    const request = ++newsRequest;
    const tab = newsTab === 'watchlist' || newsTab === 'holdings' || newsTab === 'linked' ? newsTab : 'general';
    const linked = linkedSymbol();
    const have = tab === 'watchlist' ? watchNews : tab === 'holdings' ? holdingsNews : tab === 'linked' ? (linkedNews?.symbol === linked ? linkedNews : null) : general;
    if (!force && have) showNews();
    else if (!newsList.childElementCount || tab === 'holdings') newsList.replaceChildren(h('div', { class: 'muted pad' }, 'Loading headlines…'));
    const symbols = state.watchlist.filter((r) => r.provider === 'schwab' && !r.symbol.startsWith('$')).map((r) => r.symbol);
    try {
      if (tab === 'linked') {
        if (!linked) return;
        const result = await loadNews([linked]);
        linkedNews = { symbol: linked, ...result };
        if (request === newsRequest) showNews();
        return;
      }
      if (tab === 'holdings') {
        const held = holdingNewsSymbols(await listDocs<Portfolio>('portfolios'));
        holdingsEmpty = !held.length;
        if (holdingsEmpty) return request === newsRequest ? showNews() : undefined;
        holdingsNews = await loadNews(held);
        if (request === newsRequest) showNews();
        return;
      }
      const result = await loadNews(tab === 'watchlist' ? (symbols.length ? symbols : ['SPY']) : []);
      if (tab === 'watchlist') watchNews = result;
      else general = result;
      if (request === newsRequest) showNews();
    } catch {
      if (request !== newsRequest) return;
      newsList.replaceChildren(h('div', { class: 'muted pad' }, helper.tooOld ? HELPER_OUTDATED : 'News appears here when the Schwab helper is running.'));
      newsFooter.textContent = '';
    }
  }

  const upcoming = createUpcomingPanel(onOpenCalendar);
  const marketRead = insightButton(() => {
    const indexes = cards.map((c) => c.snapshot()).filter(Boolean);
    if (!indexes.length && !general) return null;
    const headlines = (general?.items ?? [])
      .filter((i) => i.impact !== 'low')
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((i) => ({ title: i.title, source: i.source, impact: i.impact, section: i.section, published: new Date(i.published * 1000).toISOString() }));
    return { topic: 'market', symbol: '', title: 'AI market read', data: { asOf: new Date().toISOString(), session: marketStatus(new Date()).label, indexes, headlines } };
  });

  const watchlist = createWatchlist({ onSelect: onOpenChart });

  // ---------- widgets (src/home/widgets.ts: layout saved per device) ----------

  const setupsBody = h('div', { class: 'brief-body' }, h('p', { class: 'muted small' }, 'Setups appear here once the scanner has run.'));
  function drawSetups(info: { ready: ReadySetup[]; waiting: number; loading: boolean }) {
    const entry = info.ready.filter((r) => r.zone === 'entry').length;
    setupsBody.replaceChildren(
      h(
        'a',
        { class: 'wd-figure', href: '#setups', title: 'Open Setups' },
        h('b', {}, String(info.ready.length)),
        h('span', { class: 'muted small' }, info.loading ? 'the first scan is running' : `ready now${entry ? ` (${entry} in the entry zone)` : ''} · ${info.waiting} A/B waiting`),
      ),
      info.ready.length
        ? h(
            'ul',
            { class: 'brief-list' },
            ...info.ready.slice(0, 3).map((r) => {
              const st = r.setup;
              const id = `${st.horizon ?? r.horizon}:${st.strategy}:${st.symbol}:${st.signalDate}`;
              return h(
                'li',
                {},
                h(
                  'button',
                  { type: 'button', class: `brief-row ${r.zone === 'entry' ? 'up' : 'warn'}`, onclick: () => openPage('setups', 'open', id) },
                  h('span', { class: 'brief-main' }, h('b', tickerAttr(st.symbol), st.symbol), ` ${st.tier} · ${r.label}`),
                  h('span', { class: 'muted small' }, `$${formatPrice(st.plan.trigger)}`),
                ),
              );
            }),
          )
        : h('p', { class: 'muted small' }, 'Nothing is in or near its entry zone right now.'),
    );
  }
  const brief = createMorningBrief({ openChart: onOpenChart, openPage, onScan: drawSetups });

  // the calendar and watchlist cards bring their own heads: their controls move into the widget's head
  upcoming.el.querySelector(':scope > .panel-head')?.remove();
  upcoming.el.classList.remove('panel');
  const wlHead = watchlist.el.querySelector<HTMLElement>(':scope > .panel-head');
  const wlExtra = wlHead ? [...wlHead.children].filter((c) => !c.matches('h3, .spacer')) : [];
  wlHead?.remove();

  interface WidgetParts {
    body: Node[];
    icon?: IconName;
    extra?: Node[];
    asOf?: Node;
    onRefresh?: () => void;
    open?: { label: string; go: () => void };
    cls?: string;
  }
  const parts: Record<WidgetId, WidgetParts> = {
    indexes: {
      icon: 'chart',
      body: [
        h('div', { class: 'idx-row', role: 'group', 'aria-label': 'Market indexes' }, ...cards.map((c) => c.card)),
        h('div', { class: 'home-ai-row' }, marketRead.button, h('span', { class: 'muted small' }, 'A quick read of the indexes and the biggest headlines.')),
        marketRead.panel,
      ],
      onRefresh: () => cards.forEach((c) => c.loadSparkline()),
      open: { label: 'Open Investments', go: () => (location.hash = '#invest') },
      cls: 'wd-bare',
    },
    accounts: { icon: 'account', body: [brief.accountsBody], asOf: brief.stamp, onRefresh: () => void brief.refresh(), open: { label: 'Open Account', go: () => (location.hash = '#account') } },
    brief: {
      icon: 'bell',
      body: [brief.attentionBody],
      extra: [brief.attentionCount],
      onRefresh: () => void brief.refresh(),
      open: { label: 'Open alerts', go: () => void import('../ui/alerts').then((m) => m.openAlertsDialog()) },
    },
    setups: { icon: 'target', body: [setupsBody], onRefresh: () => void brief.refresh(), open: { label: 'Open Setups', go: () => (location.hash = '#setups') } },
    news: {
      icon: 'news',
      body: [tabs, newsList, newsFooter],
      extra: [newsLink.chip, h('div', { class: 'segmented small' }, ...sortButtons), h('label', { class: 'toggle', title: 'Show only stories likely to move the market' }, importantToggle, ' Important only')],
      onRefresh: () => refreshNews(true),
      cls: 'news-panel',
    },
    events: { icon: 'calendar', body: [upcoming.el], onRefresh: () => upcoming.refresh(), open: { label: 'Open the calendar', go: onOpenCalendar } },
    watchlist: { icon: 'list', body: [watchlist.el], extra: wlExtra, open: { label: 'Open the chart', go: () => (location.hash = '#chart') }, cls: 'watch-panel' },
  };

  let layout = readLayout();
  let editing = false;
  const grid = h('div', { class: 'wd-grid' });
  const editBar = h('div', { class: 'wd-editbar', hidden: true, role: 'region', 'aria-label': 'Customise Home' });
  const frames = new Map<WidgetId, HTMLElement>();

  function readLayout(): Layout {
    try {
      return parseLayout(localStorage.getItem(LAYOUT_KEY));
    } catch {
      return defaultLayout();
    }
  }
  function saveLayout(next: Layout) {
    layout = next;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // private window: the layout lasts until the page closes
    }
    drawGrid();
  }

  function frameFor(id: WidgetId): HTMLElement {
    const have = frames.get(id);
    if (have) return have;
    const def = WIDGETS.find((w) => w.id === id)!;
    const p = parts[id];
    const body = h('div', { class: 'wd-body' }, ...p.body);
    const handle = h(
      'button',
      { type: 'button', class: 'icon-btn wd-handle wd-edit', title: 'Drag to move (or use the arrow keys)', 'aria-label': `Move ${def.title} (arrow keys)`, onkeydown: (e: Event) => keyMove(id, e as KeyboardEvent) },
      icon('grid', 14),
    );
    const sizeBtn = h('button', {
      type: 'button',
      class: 'btn small ghost wd-edit wd-size',
      title: 'Change the width',
      onclick: () => {
        const it = layout.items.find((i) => i.id === id);
        if (it) saveLayout(updateWidget(layout, id, { span: nextSpan(it.span) }));
      },
    });
    const removeBtn = h('button', { type: 'button', class: 'icon-btn wd-edit', title: 'Remove from Home', 'aria-label': `Remove ${def.title}`, onclick: () => saveLayout(removeWidget(layout, id)) }, icon('close', 14));
    const head = panelHeader({
      title: def.title,
      icon: p.icon,
      lead: handle,
      asOf: p.asOf,
      extra: [...(p.extra ?? []), sizeBtn, removeBtn],
      onRefresh: p.onRefresh,
      onPopOut: p.open?.go,
      popOutLabel: p.open?.label,
      collapse: { body, collapsed: !!layout.items.find((i) => i.id === id)?.collapsed, onToggle: (c) => saveLayout(updateWidget(layout, id, { collapsed: c })) },
    });
    const frame = h('section', { class: `panel wd ${p.cls ?? ''}`, 'data-widget': id, 'aria-label': def.title }, head, body);
    // dragging starts only from the handle
    handle.addEventListener('pointerdown', () => (frame.draggable = true));
    frame.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      frame.classList.add('dragging');
    });
    frame.addEventListener('dragend', () => {
      frame.draggable = false;
      frame.classList.remove('dragging');
      grid.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    });
    frame.addEventListener('dragover', (e) => {
      if (!grid.querySelector('.dragging')) return;
      e.preventDefault();
      frame.classList.add('drop-target');
    });
    frame.addEventListener('dragleave', () => frame.classList.remove('drop-target'));
    frame.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = layout.items.findIndex((i) => i.id === e.dataTransfer?.getData('text/plain'));
      const to = layout.items.findIndex((i) => i.id === id);
      if (from >= 0 && to >= 0 && from !== to) saveLayout(moveWidget(layout, from, to));
    });
    frames.set(id, frame);
    return frame;
  }

  function keyMove(id: WidgetId, e: KeyboardEvent) {
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = layout.items.findIndex((i) => i.id === id);
    saveLayout(moveWidget(layout, from, from + dir));
    frames.get(id)?.querySelector<HTMLElement>('.wd-handle')?.focus();
  }

  function drawGrid() {
    grid.replaceChildren(
      ...layout.items.map((it) => {
        const f = frameFor(it.id);
        f.style.setProperty('--span', String(it.span));
        f.dataset.span = String(it.span);
        f.classList.toggle('wd-tall', !!WIDGETS.find((w) => w.id === it.id)?.tall && !it.collapsed);
        const size = f.querySelector('.wd-size');
        if (size) size.textContent = `${it.span}/12`;
        return f;
      }),
    );
    if (!layout.items.length) grid.append(h('p', { class: 'muted pad wd-empty' }, 'Home is empty. Press Customise (key 2) to add widgets back.'));
    grid.classList.toggle('editing', editing);
    const hidden = hiddenWidgets(layout);
    editBar.replaceChildren(
      h('div', {}, h('b', {}, 'Customise Home'), h('div', { class: 'muted small' }, 'Drag a handle (or use its arrow keys) to reorder, change widths or remove. Saved on this device.')),
      h('span', { class: 'spacer' }),
      ...hidden.map((w) => h('button', { type: 'button', class: 'btn small', title: w.about, onclick: () => saveLayout(addWidget(layout, w.id)) }, icon('plus', 14), ` ${w.title}`)),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => saveLayout(defaultLayout()) }, 'Reset to default'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => setEditing(false) }, 'Done'),
    );
  }
  function setEditing(v: boolean) {
    editing = v;
    editBar.hidden = !v;
    drawGrid();
  }
  drawGrid();

  const fnBar = functionBar(
    [
      { label: 'Refresh', icon: 'refresh', title: 'Reload the brief, news, events and index charts', run: () => (cards.forEach((c) => c.loadSparkline()), Promise.all([brief.refresh(), refreshNews(true), upcoming.refresh()])) },
      { label: 'Customise', icon: 'grid', title: 'Add, remove, reorder and resize widgets', run: () => setEditing(!editing) },
      { label: 'AI market read', icon: 'spark', run: () => marketRead.button.click() },
      { label: 'Calendar', icon: 'calendar', run: onOpenCalendar },
    ],
    { label: 'Home functions', related: ['invest', 'setups', 'account'] },
  );

  const el = h(
    'div',
    { class: 'home' },
    h(
      'header',
      { class: 'home-hero' },
      createTickerTape().el,
      h('div', { class: 'hero-left' }, greetingEl, h('div', { class: 'hero-sub' }, dateEl, marketPill)),
      brief.strip,
    ),
    fnBar,
    banner,
    editBar,
    grid,
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

  /** News on my holdings first when I hold anything (the morning question), otherwise the top stories. */
  let tabPicked = false;
  async function pickNewsTab() {
    if (!tabPicked && newsTab === 'top') {
      tabPicked = true;
      const held = await listDocs<Portfolio>('portfolios').then(holdingNewsSymbols, () => []);
      if (held.length && newsTab === 'top') return setTab('holdings');
    }
    refreshNews(true);
  }

  let started = false;
  /** Everything that needs the helper: news, events, the brief and the index sparklines. */
  function loadAll() {
    void pickNewsTab();
    upcoming.refresh();
    void brief.refresh();
    for (const c of cards) c.loadSparkline();
  }
  function start() {
    if (started) {
      // Shown again: a brief older than two minutes is reloaded (the timer below only runs while Home is open);
      // otherwise the accounts card is redrawn, so it follows a % / $ / Both change made on Account meanwhile.
      if (!helper.tooOld && briefNeedsLoad(brief.loadedAt(), Date.now() / 1000, helper.isConnected)) void brief.refresh();
      else brief.repaint();
      return void (newsTab === 'linked' && linkedNews?.symbol !== linkedSymbol() && refreshNews());
    }
    started = true;
    renderClock();
    setInterval(renderClock, 30000);
    for (const [i, index] of INDEXES.entries()) subscribeQuote({ provider: 'schwab', symbol: index.symbol }, cards[i].onQuote);
    helper.onAvailability((up) => {
      showBanner(up);
      if (up && !helper.tooOld) loadAll();
    });
    // onAvailability only fires on a change: when Home isn't the first page, the helper is already connected.
    if (helper.isConnected) {
      showBanner(true);
      if (!helper.tooOld) loadAll();
    }
    setInterval(() => !el.hidden && helper.isConnected && refreshNews(true), NEWS_REFRESH_MS);
    setInterval(() => !el.hidden && helper.isConnected && upcoming.refresh(), 5 * 60 * 1000);
    setInterval(() => !el.hidden && helper.isConnected && document.visibilityState === 'visible' && void brief.refresh(), 2 * 60 * 1000);
    briefKeys(el);
    setInterval(() => helper.isConnected && cards.forEach((c) => c.loadSparkline()), 5 * 60 * 1000);
    refreshNews();
  }

  return { el, start };
}
