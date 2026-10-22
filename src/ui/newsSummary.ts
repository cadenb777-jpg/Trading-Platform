/** The "smart summary" window shown when you click a headline, instead of leaving the app. */
import { loadSummary, type NewsItem } from '../data/schwab';
import { h, openModal, timeAgo } from './dom';

/** Why a topic matters to the market, shown above the article's key points. */
const WHY_IT_MATTERS: Record<string, string> = {
  Fed: 'Interest-rate news affects every stock: lower rates tend to lift prices, higher rates weigh on them.',
  Inflation: 'Inflation drives what the Fed does next, so hotter or cooler numbers can move the whole market.',
  Jobs: 'The job market shows how strong the economy is and shapes the Fed\'s next rate decision.',
  Growth: 'Signals whether the economy is speeding up or slowing down, which affects company profits.',
  Trade: 'Tariffs and trade deals change costs for companies and can hit whole sectors at once.',
  Bonds: 'Bond yields compete with stocks; rising yields often pressure growth and tech stocks.',
  Earnings: 'Company results and outlooks move that stock directly, and big names can move the indexes.',
  'Mega-cap': 'The largest companies make up a big share of the S&P 500 and Nasdaq, so they move the indexes.',
  Deals: 'Mergers, buyouts and IPOs can move the companies involved and their competitors.',
  'Market move': 'A move in the major indexes. Check whether it comes with news or is just trading.',
  Oil: 'Oil prices affect energy stocks, transport costs and inflation.',
  Metals: 'Gold and other metals are watched as safe havens and inflation signals.',
  Crypto: 'News that can move bitcoin and the wider crypto market.',
  Geopolitics: 'Political events add uncertainty, which can raise volatility across markets.',
};

export function openNewsSummary(item: NewsItem) {
  const body = h('div', { class: 'summary-body' }, h('div', { class: 'muted pad' }, 'Reading the article…'));
  const why = item.tags.map((t) => WHY_IT_MATTERS[t]).filter(Boolean)[0];
  const openLink = h('a', { class: 'btn', href: item.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open full article');

  openModal(
    item.source,
    h(
      'div',
      { class: 'summary' },
      h(
        'div',
        { class: 'news-meta' },
        item.impact !== 'low' ? h('span', { class: `impact-badge ${item.impact}` }, item.impact === 'high' ? 'High impact' : 'Medium') : null,
        h('span', { class: 'muted' }, timeAgo(item.published)),
        ...item.tags.map((t) => h('span', { class: 'news-tag' }, t)),
      ),
      h('h3', { class: 'summary-title' }, item.title),
      why ? h('div', { class: 'why' }, h('b', {}, 'Why it matters: '), why) : null,
      body,
      item.alsoReportedBy.length ? h('p', { class: 'muted small' }, `Also reported by ${item.alsoReportedBy.join(', ')}.`) : null,
      h('div', { class: 'modal-actions' }, h('span', { class: 'spacer' }), openLink),
    ),
    { wide: true },
  );

  loadSummary(item)
    .then((summary) => {
      openLink.setAttribute('href', summary.url || item.link);
      const points = summary.points.length ? summary.points : summary.description ? [summary.description] : [];
      body.replaceChildren(
        h('div', { class: 'summary-head' }, 'Key takeaways'),
        points.length ? h('ul', { class: 'takeaways' }, ...points.map((p) => h('li', {}, p))) : h('p', { class: 'muted' }, 'This article has no readable text (it may be a video or behind a paywall).'),
        h('p', { class: 'muted small' }, `Automatic summary: the most informative sentences from the article${summary.words ? ` (${Math.max(1, Math.round(summary.words / 230))} min read)` : ''}.`),
      );
    })
    .catch((err: Error) => {
      body.replaceChildren(
        ...(item.summary ? [h('p', {}, item.summary)] : []),
        h('p', { class: 'muted small' }, `Couldn't read the full article here (${err.message.replace(/^Could not open the article: /, '')}). Use "Open full article" to read it on the publisher's site.`),
      );
    });
}
