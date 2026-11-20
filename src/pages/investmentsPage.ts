/**
 * Investments: every kind of investment in one place, sectioned off (stocks, ETFs, bonds, alternatives,
 * crypto, commodities). Each section shows how that market is doing; one search box finds symbols,
 * private funds and anything Schwab or the SEC knows about.
 */
import { subscribeQuote, quoteChange, type MarketRef } from '../data/quotes';
import { clearEngineCache, engineRequest, helper } from '../data/schwab';
import { createAltsView } from '../invest/altsView';
import { createBondsView } from '../invest/bondsView';
import { BOARDS, CRYPTO_COINS, PRIVATE_FUNDS, SECTIONS, type Section } from '../invest/catalog';
import { instrumentSearch } from '../ui/instrumentSearch';
import { boardInsight, boardItem, boardTable, errorBox, loadBoard, openSymbol, skeletonBoard, tone, type BoardRow, type InvestContext } from '../invest/shared';
import { closeFloating, interactive, resetInteractions, type MiniItem } from '../invest/rowInteract';
import { coinActions } from '../invest/goTo';
import { pageFrame, pct } from '../ui/charts';
import { activatable, formatPrice, h } from '../ui/dom';
import { tableTools } from '../ui/tableTools';

const SECTION_KEY = 'tp-invest-section';
const REFRESH_MS = 60000;

interface Mover {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
}

function savedSection(): Section {
  try {
    const s = localStorage.getItem(SECTION_KEY) as Section | null;
    return s && SECTIONS.some((x) => x.id === s) ? s : 'overview';
  } catch {
    return 'overview';
  }
}

export function createInvestmentsPage(ctx: InvestContext) {
  let section: Section = savedSection();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopCrypto: (() => void)[] = [];
  let headlineRows = new Map<string, BoardRow>();
  const bonds = createBondsView(ctx);
  const alts = createAltsView(ctx);

  // ----- Search -----
  // the one research search (src/ui/instrumentSearch.ts, also Security -> Search): name or ticker, every kind
  const finder = instrumentSearch({ placeholder: 'Search by name or ticker: stocks, ETFs, funds, bonds, Blackstone, Blue Owl…' });
  const search = finder.input;
  const searchWrap = h('div', { class: 'inv-search-wrap' }, finder.el);

  const frame = pageFrame('Investments', 'Stocks, ETFs, bonds, alternatives and private funds, with live market data. Click a section to see how that market is doing.', [
    searchWrap,
  ]);
  frame.functions(
    [
      // the boards load inside their own panels; holding the chip for 2 s keeps repeated presses from resending
      { label: 'Refresh', icon: 'refresh', title: 'Load fresh data now', run: () => (clearEngineCache(), showSection(section), new Promise((r) => setTimeout(r, 2000))) },
      { label: 'Search', icon: 'search', title: 'Search stocks, ETFs, bonds and funds', run: () => search.focus() },
      { label: 'Overview', run: () => showSection('overview') },
      { label: 'Bonds', run: () => showSection('bonds') },
      { label: 'Alternatives', run: () => showSection('alts') },
    ],
    ['research', 'macro', 'account'],
  );

  const cards = h(
    'nav',
    { class: 'inv-cards', 'aria-label': 'Investment types' },
    ...SECTIONS.map((s) =>
      h(
        'button',
        { class: 'inv-card', 'data-section': s.id, onclick: () => showSection(s.id), onmouseenter: () => prefetch(s.id) },
        h('span', { class: 'inv-card-title' }, s.label),
        h('span', { class: 'inv-card-value' }, h('span', { class: 'skeleton', style: 'width:70px;height:18px' })),
        h('span', { class: 'muted small' }, s.blurb),
      ),
    ),
  );
  const view = h('div', { class: 'inv-view' });
  frame.body.replaceChildren(cards, view);


  // ----- Section cards (headline numbers) -----

  async function loadHeadlines() {
    const symbols = SECTIONS.map((s) => s.headline);
    try {
      headlineRows = await loadBoard([{ title: '', symbols }]);
    } catch {
      return;
    }
    for (const s of SECTIONS) {
      const r = headlineRows.get(s.headline[0]);
      const box = cards.querySelector(`[data-section="${s.id}"] .inv-card-value`);
      box?.replaceChildren(h('span', { class: 'muted small' }, s.headline[1]), h('b', { class: tone(r?.change) }, pct(r?.change)));
    }
  }

  // ----- Sections -----

  /** Starts loading a section's boards before it's clicked (the reply is cached, so the click shows it at once). */
  function prefetch(id: Section) {
    const groups = (BOARDS as Partial<Record<Section, typeof BOARDS.stocks>>)[id];
    if (groups?.length) loadBoard(groups).catch(() => {});
  }
  // A few seconds after the page opens, quietly load the other sections too.
  setTimeout(() => SECTIONS.forEach((x, i) => setTimeout(() => helper.isConnected && document.visibilityState === 'visible' && prefetch(x.id), i * 1500)), 4000);

  function showSection(next: Section, render = true) {
    section = next;
    try {
      localStorage.setItem(SECTION_KEY, next);
    } catch {
      // private window: just don't remember it
    }
    cards.querySelectorAll<HTMLElement>('.inv-card').forEach((c) => c.classList.toggle('active', c.dataset.section === next));
    closeFloating();
    for (const stop of stopCrypto) stop();
    stopCrypto = [];
    if (next === 'bonds') {
      view.replaceChildren(bonds.el);
      if (render) bonds.show();
    } else if (next === 'alts') {
      view.replaceChildren(alts.el);
      if (render) alts.show();
    } else if (next === 'crypto') renderCrypto();
    else renderBoards(next);
  }

  function renderBoards(id: Exclude<Section, 'bonds' | 'alts' | 'crypto'>) {
    const groups = BOARDS[id];
    const boards = h('div', { class: 'inv-boards' }, ...groups.map(skeletonBoard));
    const extra = h('div');
    const label = SECTIONS.find((x) => x.id === id)?.label ?? id;
    const ai = boardInsight(label, groups);
    view.replaceChildren(ai.row, ai.panel, boards, extra);
    const draw = (rows: Map<string, BoardRow>) => {
      if (section !== id) return;
      ai.setRows(rows);
      boards.replaceChildren(...groups.map((g) => boardTable(g, rows, (s, l) => openSymbol(s, l, rows.get(s), ctx), ctx)).filter((x): x is HTMLElement => !!x));
    };
    loadBoard(groups)
      .then(draw)
      .catch((err) => section === id && boards.replaceChildren(errorBox(err, () => renderBoards(id))));
    if (id === 'stocks') renderMovers(extra);
  }

  function renderMovers(box: HTMLElement) {
    engineRequest<{ up: Mover[]; down: Mover[] }>('invest.movers', { index: '$SPX' }, 30000)
      .then(({ up, down }) => {
        if (!up.length && !down.length) return;
        const list = (title: string, rows: Mover[]) => {
          const entries: [HTMLElement, MiniItem][] = [];
          const table = h(
            'table',
            { class: 'data-table inv-table' },
            h(
              'tbody',
              {},
              ...rows.map((m) => {
                const row: BoardRow = { ...m, price: m.price, change: m.change };
                const tr = activatable(h(
                  'tr',
                  { class: 'clickable' },
                  h('td', { class: 'label' }, h('div', { class: 'inv-name' }, h('b', {}, m.symbol), h('span', { class: 'muted small' }, m.name))),
                  h('td', {}, formatPrice(m.price)),
                  h('td', { class: tone(m.change) }, pct(m.change)),
                ));
                entries.push([tr, { ...boardItem(m.symbol, m.name || m.symbol, row, () => openSymbol(m.symbol, m.name || m.symbol, row, ctx), ctx), sub: m.symbol }]);
                return tr;
              }),
            ),
          );
          interactive(table, entries, { boardId: `movers:${title}`, expandable: true, defaultRange: () => '1M' });
          return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title)), table);
        };
        box.replaceChildren(h('h2', { class: 'group-title' }, 'Biggest movers today (S&P 500)'), h('div', { class: 'two-col' }, list('Gainers', up), list('Losers', down)));
      })
      .catch(() => box.replaceChildren());
  }

  function renderCrypto() {
    const rows = new Map<string, HTMLTableRowElement>();
    const entries: [HTMLElement, MiniItem][] = [];
    const table = h(
      'table',
      { class: 'data-table inv-table' },
      h('thead', {}, h('tr', {}, ...['Coin', 'Price', '24 hours'].map((t) => h('th', {}, t)))),
      h(
        'tbody',
        {},
        ...CRYPTO_COINS.map(([symbol, label]) => {
          const tr = activatable(h(
            'tr',
            { class: 'clickable' },
            h('td', { class: 'label', 'data-value': `${label} ${symbol}` }, h('div', { class: 'inv-name' }, h('b', {}, label), h('span', { class: 'muted small' }, symbol))),
            h('td', { class: 'muted', title: 'Waiting for the first price from Coinbase' }, '—'),
            h('td', { class: 'muted', title: 'Waiting for the first price from Coinbase' }, '—'),
          ));
          rows.set(symbol, tr);
          entries.push([tr, { key: symbol, label, sub: symbol, source: { kind: 'coin', symbol }, mode: 'price', open: () => ctx.openChart({ provider: 'coinbase', symbol }), actions: () => coinActions(symbol, label, ctx) }]);
          return tr;
        }),
      ),
    );
    tableTools(table, { id: 'invest:crypto' }); // live prices re-sort and re-filter as they arrive
    interactive(table, entries, { boardId: 'invest:crypto', expandable: true, defaultRange: () => '1M' });
    const boards = h('div', { class: 'inv-boards' }, ...BOARDS.crypto.map(skeletonBoard));
    const ai = boardInsight('Crypto', BOARDS.crypto);
    view.replaceChildren(ai.row, ai.panel, h('section', { class: 'panel inv-board' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Coins (live from Coinbase)'), h('span', { class: 'muted small' }, 'Click one to open its chart')), h('div', { class: 'table-wrap' }, table)), boards);
    stopCrypto = CRYPTO_COINS.map(([symbol]) => {
      const ref: MarketRef = { provider: 'coinbase', symbol };
      return subscribeQuote(ref, (q) => {
        const tr = rows.get(symbol);
        if (!tr) return;
        const c = quoteChange(q);
        tr.children[1].textContent = formatPrice(q.last);
        tr.children[1].className = '';
        tr.children[1].removeAttribute('title');
        tr.children[2].textContent = c ? pct(c.percent / 100) : '—';
        tr.children[2].className = c ? tone(c.percent) : 'muted';
        if (c) tr.children[2].removeAttribute('title');
        else tr.children[2].setAttribute('title', 'Coinbase has not sent a 24-hour open yet');
      });
    });
    loadBoard(BOARDS.crypto)
      .then((r) => section === 'crypto' && (ai.setRows(r), true) && boards.replaceChildren(...BOARDS.crypto.map((g) => boardTable(g, r, (s, l) => openSymbol(s, l, r.get(s), ctx), ctx))))
      .catch((err) => section === 'crypto' && boards.replaceChildren(errorBox(err, renderCrypto)));
  }

  /** Quietly refreshes prices on the visible section. */
  function refresh() {
    if (document.hidden) return;
    loadHeadlines();
    if (section === 'bonds') bonds.refresh();
    else if (section === 'alts') alts.refresh();
    else if (section !== 'crypto') {
      const groups = BOARDS[section];
      loadBoard(groups)
        .then((rows) => {
          const boards = view.querySelector('.inv-boards');
          if (boards && section !== 'crypto' && section !== 'bonds' && section !== 'alts' && BOARDS[section] === groups)
            boards.replaceChildren(...groups.map((g) => boardTable(g, rows, (s, l) => openSymbol(s, l, rows.get(s), ctx), ctx)).filter((x): x is HTMLElement => !!x));
        })
        .catch(() => {});
    }
  }

  let started = false;
  let appliedSub = '';
  return {
    el: frame.el,
    /** Opens a section (the command bar's BONDS / WB). */
    open(next: Section) {
      if (!SECTIONS.some((s) => s.id === next)) return;
      if (started) showSection(next);
      else section = next; // start() shows it
    },
    start(sub = '') {
      // deep link: #invest/<section>[/<tab>], e.g. #invest/bonds/curve from Home's Edge today. Applied only when the
      // link changes, so coming Back to the page keeps the section and tab the person moved to since.
      const fresh = sub !== appliedSub;
      appliedSub = sub;
      const [want, tab, arg] = sub.split('/');
      const deep = fresh && SECTIONS.some((s) => s.id === want) ? (want as Section) : null;
      const bondTab = deep === 'bonds' && bonds.hasTab(tab) ? tab : null;
      const value = arg ? decodeURIComponent(arg) : '';
      if (deep) {
        started = true;
        // the research search opens a bond by CUSIP (#invest/bonds/lookup/<CUSIP>), a private fund
        // (#invest/alts/fund/<catalog id>) or a search of every Form D (#invest/alts/search/<words>)
        const altFund = deep === 'alts' && tab === 'fund' ? PRIVATE_FUNDS.find((f) => f.id === value) : undefined;
        showSection(deep, !bondTab && !altFund && !(deep === 'alts' && tab === 'search' && value));
        if (bondTab === 'lookup' && value) bonds.lookup(value);
        else if (bondTab) bonds.openTab(bondTab);
        if (altFund) void alts.openFund(altFund);
        else if (deep === 'alts' && tab === 'search' && value) alts.searchPrivate(value);
      } else if (!started) {
        started = true;
        showSection(section);
      } else if (section === 'crypto') renderCrypto();
      loadHeadlines();
      clearInterval(timer);
      timer = setInterval(refresh, REFRESH_MS);
    },
    stop() {
      clearInterval(timer);
      resetInteractions();
      for (const stop of stopCrypto) stop();
      stopCrypto = [];
    },
  };
}
