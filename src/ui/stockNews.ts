/**
 * A stock's news, from anywhere: the same headlines as the stock view's News tab (Google News and CNBC through the
 * helper, grouped and scored), in a window (`openStockNews`), a small card (`stockNewsCard`) or a button
 * (`newsButton`). A headline opens its summary; "All news and details" opens the stock view on its News tab.
 */
import { loadNews, type NewsItem } from '../data/schwab';
import { h, openModal, timeAgo } from './dom';
import { icon } from './icons';

/** The ticker the news feed searches for ("$SPX" -> "SPX", "BRK.B" stays). */
export const newsSymbol = (s: string) => s.trim().toUpperCase().replace(/^\$/, '');

/** Newest first, at most `limit`. */
export const latestFirst = (items: NewsItem[], limit: number) => [...items].sort((a, b) => b.published - a.published).slice(0, limit);

/** The headline rows: impact dot, title, source and age; a click opens the summary. */
function rows(items: NewsItem[]): HTMLElement {
  return h(
    'ol',
    { class: 'sv-news stock-news' },
    ...items.map((item) =>
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: 'sv-news-row', title: 'Read the summary', onclick: async () => (await import('./newsSummary')).openNewsSummary(item) },
          h('span', { class: `sv-impact ${item.impact}`, title: `Market impact: ${item.impact}` }),
          h('span', { class: 'sv-news-title' }, item.title),
          h('span', { class: 'muted small sv-news-meta' }, `${item.source}${item.published ? ` · ${timeAgo(item.published)}` : ''}${item.alsoReportedBy?.length ? ` · +${item.alsoReportedBy.length} outlets` : ''}`),
        ),
      ),
    ),
  );
}

const allNews = (symbol: string) =>
  h('button', { type: 'button', class: 'btn small', onclick: async () => (await import('../security/open')).openSecurity(symbol, 'CN') }, `All ${symbol} news and details`);

/** A window with the stock's latest 20 headlines. */
export function openStockNews(raw: string): void {
  const symbol = newsSymbol(raw);
  if (!symbol) return;
  const list = h('div', { class: 'stock-news-body' }, h('p', { class: 'muted pad' }, 'Loading headlines…'));
  const close = openModal(`${symbol} news`, h('div', {}, list, h('div', { class: 'ap-controls stock-news-foot' }, allNews(symbol))), { wide: true, noAutofocus: true });
  loadNews([symbol]).then(
    ({ items }) => list.replaceChildren(items.length ? rows(latestFirst(items, 20)) : h('p', { class: 'muted pad' }, `No recent headlines for ${symbol}.`)),
    () => list.replaceChildren(h('p', { class: 'muted pad' }, 'News appears when the helper is running.')),
  );
  void close;
}

/** A card with the latest few headlines and a "More news" button (for pages about one stock). */
export function stockNewsCard(raw: string, limit = 6): HTMLElement {
  const symbol = newsSymbol(raw);
  const body = h('div', {}, h('p', { class: 'muted small pad' }, 'Loading headlines…'));
  const card = h(
    'section',
    { class: 'panel stock-news-card' },
    h(
      'div',
      { class: 'panel-head' },
      h('h3', {}, `Latest ${symbol} news`),
      h('span', { class: 'muted small' }, 'Google News and CNBC · newest first'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn small', onclick: () => openStockNews(symbol) }, 'More news'),
    ),
    body,
  );
  loadNews([symbol]).then(
    ({ items }) => body.replaceChildren(items.length ? rows(latestFirst(items, limit)) : h('p', { class: 'muted small pad' }, `No recent headlines for ${symbol}.`)),
    () => body.replaceChildren(h('p', { class: 'muted small pad' }, 'News appears when the helper is running.')),
  );
  return card;
}

/** A "News" button for the stock a page is showing (`symbolNow` is read when clicked). */
export function newsButton(symbolNow: () => string, cls = 'btn'): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: `${cls} news-btn`, title: 'Latest news for this stock', 'aria-label': 'News for this stock', onclick: () => openStockNews(symbolNow()) },
    icon('news', 16),
    h('span', { class: 'news-btn-label' }, 'News'),
  ) as HTMLButtonElement;
}
