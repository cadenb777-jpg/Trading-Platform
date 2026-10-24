/**
 * Investments: every kind of investment in one place, sectioned off (stocks, ETFs, bonds, alternatives,
 * crypto, commodities). Each section shows how that market is doing; one search box finds symbols,
 * private funds and anything Schwab or the SEC knows about.
 */
import { subscribeQuote, quoteChange, type MarketRef } from '../data/quotes';
import { clearEngineCache, engineRequest, helper } from '../data/schwab';
import { createAltsView } from '../invest/altsView';
import { createBondsView } from '../invest/bondsView';
import { BOARDS, CRYPTO_COINS, SECTIONS, searchCatalog, type Section } from '../invest/catalog';
import { boardInsight, boardTable, errorBox, loadBoard, openSymbolDetail, showSymbol, skeletonBoard, tone, type BoardRow, type InvestContext } from '../invest/shared';
import { pageFrame, pct } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
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
  const search = h('input', { class: 'input inv-search', type: 'search', placeholder: 'Search stocks, ETFs, bonds, funds, Blackstone, Blue Owl…', spellcheck: false, 'aria-label': 'Search investments' });
  const results = h('div', { class: 'inv-search-results', hidden: true, role: 'listbox' });
  const searchWrap = h('div', { class: 'inv-search-wrap' }, search, results);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;

  const frame = pageFrame('Investments', 'Stocks, ETFs, bonds, alternatives and private funds, with live market data. Click a section to see how that market is doing.', [
    searchWrap,
    h('button', { class: 'btn', title: 'Load fresh data now', onclick: () => (clearEngineCache(), showSection(section)) }, 'Refresh'),
  ]);

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

  function resultItem(main: string, sub: string, onPick: () => void) {
    return h(
      'button',
      {
        class: 'inv-result',
        role: 'option',
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: () => {
          results.hidden = true;
          onPick();
        },
      },
      h('b', {}, main),
      h('span', { class: 'muted small' }, sub),
    );
  }

  function renderResults(query: string, remote?: { symbol: string; name: string; assetType: string }[] | 'loading' | Error) {
    const { symbols, funds } = searchCatalog(query);
    const groups: Node[] = [];
    if (symbols.length)
      groups.push(
        h('div', { class: 'inv-result-group' }, 'On this page'),
        ...symbols.map((s) =>
          resultItem(`${showSymbol(s.symbol)} · ${s.label}`, SECTIONS.find((x) => x.id === s.section)?.label ?? '', () =>
            s.section === 'crypto' && s.symbol.includes('-') ? ctx.openChart({ provider: 'coinbase', symbol: s.symbol }) : openSymbolDetail(s.symbol, s.label, headlineRows.get(s.symbol), ctx),
          ),
        ),
      );
    if (funds.length)
      groups.push(
        h('div', { class: 'inv-result-group' }, 'Private & evergreen funds'),
        ...funds.map((f) => resultItem(`${f.short} · ${f.name}`, `${f.manager} · ${f.structure}`, () => (showSection('alts', false), alts.openFund(f)))),
      );
    groups.push(h('div', { class: 'inv-result-group' }, 'Everything at Schwab'));
    if (remote === 'loading') groups.push(h('div', { class: 'muted small inv-result-note' }, 'Searching Schwab…'));
    else if (remote instanceof Error) groups.push(h('div', { class: 'muted small inv-result-note' }, remote.message));
    else if (remote?.length)
      groups.push(
        ...remote.slice(0, 10).map((r) =>
          resultItem(`${r.symbol} · ${r.name}`, r.assetType.replace('_', ' ').toLowerCase(), () => openSymbolDetail(r.symbol, r.name || r.symbol, undefined, ctx)),
        ),
      );
    else if (remote) groups.push(h('div', { class: 'muted small inv-result-note' }, 'No matches at Schwab.'));
    groups.push(resultItem(`Search private funds for "${query}"`, 'Every Form D filed with the SEC (hedge, PE, venture, feeder funds)', () => (showSection('alts', false), alts.searchPrivate(query))));
    results.replaceChildren(...groups);
    results.hidden = false;
  }

  search.addEventListener('input', () => {
    const q = search.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      results.hidden = true;
      return;
    }
    renderResults(q, 'loading');
    const mine = ++searchSeq;
    searchTimer = setTimeout(() => {
      engineRequest<{ results: { symbol: string; name: string; assetType: string }[] }>('invest.search', { query: q }, 20000)
        .then((r) => mine === searchSeq && renderResults(q, r.results))
        .catch((err) => mine === searchSeq && renderResults(q, err as Error));
    }, 350);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') results.hidden = true;
    if (e.key === 'Enter') results.querySelector<HTMLButtonElement>('.inv-result')?.click();
  });
  search.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 150));
  search.addEventListener('focus', () => search.value.trim().length >= 2 && renderResults(search.value.trim()));

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
      boards.replaceChildren(...groups.map((g) => boardTable(g, rows, (s, l) => openSymbolDetail(s, l, rows.get(s), ctx))).filter((x): x is HTMLElement => !!x));
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
        const list = (title: string, rows: Mover[]) =>
          h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, title)),
            h(
              'table',
              { class: 'data-table inv-table' },
              h(
                'tbody',
                {},
                ...rows.map((m) =>
                  h(
                    'tr',
                    { class: 'clickable', onclick: () => openSymbolDetail(m.symbol, m.name || m.symbol, { ...m, price: m.price, change: m.change }, ctx) },
                    h('td', { class: 'label' }, h('div', { class: 'inv-name' }, h('b', {}, m.symbol), h('span', { class: 'muted small' }, m.name))),
                    h('td', {}, formatPrice(m.price)),
                    h('td', { class: tone(m.change) }, pct(m.change)),
                  ),
                ),
              ),
            ),
          );
        box.replaceChildren(h('h2', { class: 'group-title' }, 'Biggest movers today (S&P 500)'), h('div', { class: 'two-col' }, list('Gainers', up), list('Losers', down)));
      })
      .catch(() => box.replaceChildren());
  }

  function renderCrypto() {
    const rows = new Map<string, HTMLTableRowElement>();
    const table = h(
      'table',
      { class: 'data-table inv-table' },
      h('thead', {}, h('tr', {}, ...['Coin', 'Price', '24 hours'].map((t) => h('th', {}, t)))),
      h(
        'tbody',
        {},
        ...CRYPTO_COINS.map(([symbol, label]) => {
          const tr = h(
            'tr',
            { class: 'clickable', onclick: () => ctx.openChart({ provider: 'coinbase', symbol }) },
            h('td', { class: 'label', 'data-value': `${label} ${symbol}` }, h('div', { class: 'inv-name' }, h('b', {}, label), h('span', { class: 'muted small' }, symbol))),
            h('td', {}, '—'),
            h('td', {}, '—'),
          );
          rows.set(symbol, tr);
          return tr;
        }),
      ),
    );
    tableTools(table, { id: 'invest:crypto' }); // live prices re-sort and re-filter as they arrive
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
        tr.children[2].textContent = c ? pct(c.percent / 100) : '—';
        tr.children[2].className = c ? tone(c.percent) : '';
      });
    });
    loadBoard(BOARDS.crypto)
      .then((r) => section === 'crypto' && (ai.setRows(r), true) && boards.replaceChildren(...BOARDS.crypto.map((g) => boardTable(g, r, (s, l) => openSymbolDetail(s, l, r.get(s), ctx)))))
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
            boards.replaceChildren(...groups.map((g) => boardTable(g, rows, (s, l) => openSymbolDetail(s, l, rows.get(s), ctx))).filter((x): x is HTMLElement => !!x));
        })
        .catch(() => {});
    }
  }

  let started = false;
  return {
    el: frame.el,
    start() {
      if (!started) {
        started = true;
        showSection(section);
      } else if (section === 'crypto') renderCrypto();
      loadHeadlines();
      clearInterval(timer);
      timer = setInterval(refresh, REFRESH_MS);
    },
    stop() {
      clearInterval(timer);
      for (const stop of stopCrypto) stop();
      stopCrypto = [];
    },
  };
}
