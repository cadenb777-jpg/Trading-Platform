/**
 * Security -> Search (#find, code FIND): the research front door, the way Schwab's research page works. One search box
 * for stocks, ETFs, mutual funds, bonds and private funds, by name or ticker (src/ui/instrumentSearch.ts); tabs narrow
 * it to one kind and say what opens for that kind, with links to the pages that already exist for it (no copies).
 */
import { FILTERS, instrumentSearch, type Kind } from '../ui/instrumentSearch';
import { h } from '../ui/dom';

const KEY = 'tp-find-filter';

/** What each kind opens, in plain words, and where to browse it in the platform. */
const GUIDE: Record<'all' | Kind, { opens: string; tips: string; links: [string, string, string][] }> = {
  all: {
    opens: 'Pick a result and press Enter: each kind opens its own page.',
    tips: 'Type a company or fund name (several words are fine) or a ticker. A 9-character code is looked up as a bond CUSIP.',
    links: [
      ['#screener', 'Stock screener', 'Filter stocks by valuation, growth and quality'],
      ['#invest', 'Investments', 'Every market at a glance: stocks, ETFs, bonds, alternatives, crypto, commodities'],
      ['#invest', 'Markets (big picture)', 'How each asset class is doing, with charts and statistics'],
    ],
  },
  stock: {
    opens: 'A stock opens its page: what the company does (YCharts), price and valuation, analysts, earnings, holders, options and news; “Company analysis” there has its SEC accounts, quality and valuation models.',
    tips: 'Try a name like “nvidia” or “bank of america”, or a ticker like MSFT.',
    links: [
      ['#screener', 'Stock screener', 'Filter stocks by valuation, growth and quality'],
      ['#invest/stocks', 'Stock markets', 'Indexes, sectors and the biggest movers'],
      ['#setups', 'Trade setups', 'Tested setups on the Nasdaq-100'],
    ],
  },
  etf: {
    opens: 'An ETF opens its fund page: what it is and how it invests, costs in dollars, benchmark and style, holdings, asset mix and sectors, returns, risk, income and money flows (YCharts), premium or discount to NAV.',
    tips: 'Try “s&p 500”, “total stock market”, “treasury” or a ticker like VOO.',
    links: [['#invest/etfs', 'ETF boards', 'Core, international, themes and income ETFs, live']],
  },
  mutual_fund: {
    opens: 'A mutual fund opens its fund page: what it is and how it invests, expense ratio and loads, minimums, share class, holdings, returns, risk, income and money flows (YCharts). Interval funds also show their repurchase dates.',
    tips: 'Mutual fund tickers have 5 letters ending in X (VFIAX). Names work too: “vanguard 500 index admiral”.',
    links: [],
  },
  bond: {
    opens: 'A bond CUSIP opens the bond lookup: issuer, coupon, maturity, price and yield.',
    tips: 'Type the 9-character CUSIP (e.g. 91282CLW9). For bond funds, search their name or ticker (AGG, BND) under ETFs.',
    links: [
      ['#invest/bonds/market', 'Bond market', 'Treasury yields and credit spreads'],
      ['#invest/bonds/curve', 'What the curve says', 'The fitted Treasury curve and recession odds'],
      ['#invest/bonds/auctions', 'Treasury auctions', 'Recent and upcoming auctions'],
    ],
  },
  alt: {
    opens: 'A private fund opens its detail: latest NAV, holdings, returns and SEC filings. “Search private funds” looks through every Form D at the SEC.',
    tips: 'Try a manager or fund name: Blackstone, Apollo, BREIT, private credit.',
    links: [['#invest/alts', 'Alternatives', 'Private funds, private credit and real estate']],
  },
  index: { opens: 'An index opens its page with the chart and statistics.', tips: 'Try “s&p 500” or “nasdaq”.', links: [] },
  crypto: { opens: 'A coin opens its page.', tips: 'Try bitcoin.', links: [] },
  other: { opens: '', tips: '', links: [] },
  ticker: { opens: '', tips: '', links: [] },
};

export function createFindPage() {
  let filter: 'all' | Kind = 'all';
  try {
    const saved = localStorage.getItem(KEY) as 'all' | Kind | null;
    if (saved && FILTERS.some((f) => f.id === saved)) filter = saved;
  } catch {
    /* not remembered */
  }
  const search = instrumentSearch({ inline: true, filter: () => filter });
  const tabs = h('div', { class: 'tabs find-tabs', role: 'tablist', 'aria-label': 'What to search' });
  const guide = h('div', { class: 'find-guide' });

  function draw() {
    tabs.replaceChildren(
      ...FILTERS.map((f) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `tab${f.id === filter ? ' active' : ''}`,
            'aria-selected': String(f.id === filter),
            onclick: () => {
              filter = f.id;
              try {
                localStorage.setItem(KEY, filter);
              } catch {
                /* not remembered */
              }
              draw();
              search.refresh();
              search.input.focus();
            },
          },
          f.label,
        ),
      ),
    );
    const g = GUIDE[filter];
    guide.replaceChildren(
      h('p', {}, g.opens),
      h('p', { class: 'muted small' }, g.tips),
      g.links.length
        ? h(
            'div',
            { class: 'find-links' },
            ...g.links.map(([href, title, about]) => h('a', { class: 'find-link', href }, h('b', {}, `${title} ›`), h('span', { class: 'muted small' }, about))),
          )
        : '',
    );
  }
  draw();

  const el = h(
    'div',
    { class: 'analysis-page find-page' },
    h('header', { class: 'ap-header' }, h('div', {}, h('h1', {}, 'Research'), h('p', { class: 'muted' }, 'One ticker in depth. Type a ticker or a name: the page knows whether it is a stock, ETF, mutual fund, bond or private fund and shows what matters for that kind. Markets has the big picture.'))),
    h('section', { class: 'panel find-panel' }, tabs, search.el, guide),
  );
  return {
    el,
    start() {
      setTimeout(() => search.input.focus(), 60);
    },
  };
}
