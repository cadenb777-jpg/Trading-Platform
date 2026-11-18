/**
 * Markets > Monitor (MON): the whole market on one screen, Bloomberg-cockpit style (owner's spec 7.5: several small
 * titled tables tiled on one page, no scrolling on a wide screen). Left to right, most important first:
 *   - world market clocks (open / lunch / closed),
 *   - world equities by region (WEI): numbered rows, last, today, YTD, a 1-year sparkline,
 *   - the Nasdaq-100 as a sector sunburst (IMAP), live, equal weight,
 *   - today's S&P 500 movers (MOV),
 *   - currencies, commodities and rates (through the ETFs that track them),
 *   - the top headlines, numbered (TOP).
 * Every tile's link opens the full screen; every row has a number ("5" + Enter in the search bar opens it).
 * Free data only: Schwab quotes and daily closes (invest.board), Schwab movers, Google News / CNBC RSS.
 */
import { engineRequest, HELPER_NOT_RUNNING, helper, loadNews, type NewsItem } from '../data/schwab';
import { subscribeQuote } from '../data/quotes';
import { CROSS_ASSET, EXCHANGES, WORLD, boardSymbols, leaders, sessionState, type BoardSection } from '../markets/monitor';
import { SECTOR_LISTS } from '../security/related';
import { openSecurity } from '../security/open';
import type { BoardRow } from '../invest/shared';
import { pct } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { fnTile, numberRow } from '../ui/fnTile';
import { sparkline } from '../ui/sparkline';
import { sunburst } from '../ui/viz';

const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) < 5e-5 ? '' : v > 0 ? 'up' : 'down');
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function createMonitorPage() {
  const clocks = h('div', { class: 'mon-clocks', role: 'list', 'aria-label': 'World market clocks' });
  const go = (route: string) => () => (location.hash = `#${route}`);

  const wei = fnTile({ title: 'World equities', link: 'All markets', open: go('invest'), cls: 'mon-wei', tip: 'Today, year to date and the last year for the main stock markets' });
  const sun = fnTile({ title: 'Nasdaq-100 by sector', link: 'Heat maps', open: go('invest'), cls: 'mon-sun' });
  const mov = fnTile({ title: 'S&P 500 movers', link: 'More movers', open: go('invest'), cls: 'mon-mov' });
  const cross = fnTile({ title: 'Currencies, commodities & rates', link: 'Rates board', linkTitle: 'Open the rates and money-markets board (Macro)', open: go('macro'), cls: 'mon-cross' });
  const top = fnTile({ title: 'Top news', link: 'All news', linkTitle: 'Open all news (Today)', open: go('home'), cls: 'mon-news' });

  const el = h(
    'div',
    { class: 'analysis-page monitor-page' },
    h('header', { class: 'ap-header' }, h('div', {}, h('h1', {}, 'Market monitor'), h('p', { class: 'muted' }, 'The whole market on one screen. Click any row to open it (or type its number in the search bar).'))),
    clocks,
    h('div', { class: 'mon-grid' }, wei.el, sun.el, mov.el, cross.el, top.el),
  );

  // ---------- clocks ----------
  const drawClocks = () => {
    const now = new Date();
    clocks.replaceChildren(
      ...EXCHANGES.map((x) => {
        const s = sessionState(x, now);
        return h(
          'div',
          { class: `mon-clock ${s.state}`, role: 'listitem', title: `${x.city}: ${s.note} (regular hours; public holidays are not counted)` },
          h('span', { class: 'mon-city' }, x.city),
          h('b', { class: 'num' }, s.time),
          h('span', { class: 'mon-state' }, h('i', { 'aria-hidden': 'true' }), s.state === 'open' ? 'Open' : s.state === 'lunch' ? 'Lunch' : 'Closed'),
        );
      }),
    );
  };

  // ---------- boards (world equities; currencies, commodities, rates) ----------
  const boardTable = (sections: BoardSection[], rows: Map<string, BoardRow>, first: number, withYtd: boolean, showSym = true) => {
    let n = first;
    const head = h('tr', {}, h('th', { class: 'num-col' }, '#'), h('th', {}, 'Market'), h('th', { class: 'num' }, 'Last'), h('th', { class: 'num' }, 'Today'), withYtd ? h('th', { class: 'num' }, 'YTD') : '', h('th', { class: 'spark-col' }, '1 year'));
    const body: HTMLElement[] = [];
    for (const sec of sections) {
      body.push(h('tr', { class: 'mon-band' }, h('th', { colspan: withYtd ? 6 : 5, scope: 'colgroup' }, sec.title)));
      for (const [sym, name] of sec.rows) {
        const r = rows.get(sym);
        const sp = r?.spark?.filter((v) => Number.isFinite(v)) ?? [];
        const tr = h(
          'tr',
          { class: 'mon-row', tabindex: 0, title: `${name} (${sym}): open it`, onclick: () => void openSecurity(sym), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && openSecurity(sym)) },
          h('td', { class: 'num-col' }, String(n)),
          h('td', {}, h('span', { class: 'mon-name' }, name), showSym ? h('span', { class: 'mon-sym' }, sym) : ''),
          h('td', { class: 'num' }, r?.price != null ? formatPrice(r.price) : '—'),
          h('td', { class: `num ${tone(r?.change)}` }, pct(r?.change)),
          withYtd ? h('td', { class: `num ${tone(r?.ytd)}` }, pct(r?.ytd, 1)) : '',
          h('td', { class: 'spark-col' }, sp.length > 2 ? sparkline(sp, sp[0], (sp.at(-1) ?? 0) >= sp[0] ? 'var(--up)' : 'var(--down)') : ''),
        );
        body.push(numberRow(tr, n++, name));
      }
    }
    return h('table', { class: 'mon-table' }, h('thead', {}, head), h('tbody', {}, ...body));
  };

  const worldSummary = (rows: Map<string, BoardRow>) => {
    const named = WORLD.flatMap((s) => s.rows.map(([sym, name]) => ({ name, change: rows.get(sym)?.change ?? null })));
    const l = leaders(named, 1);
    const up = named.filter((x) => (x.change ?? 0) > 0).length;
    const priced = named.filter((x) => x.change != null).length;
    if (!priced) return '';
    return h(
      'p',
      { class: 'mon-words' },
      `${up} of ${priced} markets up today`,
      l.up[0] ? h('span', {}, ' · best ', h('b', { class: 'up' }, `${l.up[0].name} ${pct(l.up[0].change, 1)}`)) : '',
      l.down[0] ? h('span', {}, ' · worst ', h('b', { class: 'down' }, `${l.down[0].name} ${pct(l.down[0].change, 1)}`)) : '',
    );
  };

  let boardsAsOf = 0;
  async function loadBoards() {
    const symbols = [...boardSymbols(WORLD), ...boardSymbols(CROSS_ASSET)];
    try {
      const { rows, asOf } = await engineRequest<{ rows: BoardRow[]; asOf?: number }>('invest.board', { symbols }, 90000);
      const map = new Map(rows.map((r) => [r.symbol, r]));
      boardsAsOf = asOf ?? Date.now() / 1000;
      wei.body.replaceChildren(worldSummary(map), boardTable(WORLD, map, 1, true));
      cross.body.replaceChildren(boardTable(CROSS_ASSET, map, 31, false, false));
      wei.foot(`Schwab quotes · countries through US-listed ETFs · ${clock(boardsAsOf)}`);
      cross.foot(`Schwab quotes of the ETFs that track each market · ${clock(boardsAsOf)}`);
    } catch (err) {
      const msg = helper.status.status === 'live' ? (err as Error).message : HELPER_NOT_RUNNING;
      wei.body.replaceChildren(h('p', { class: 'ap-error' }, msg));
      cross.body.replaceChildren(h('p', { class: 'muted' }, 'Waiting for the helper.'));
    }
  }

  // ---------- movers ----------
  async function loadMovers() {
    try {
      const m = await engineRequest<{ up?: BoardRow[]; down?: BoardRow[] }>('invest.movers', { index: '$SPX' }, 60000);
      let n = 51;
      const list = (title: string, rows: BoardRow[] = []) =>
        h(
          'div',
          { class: 'mon-movers' },
          h('h4', {}, title),
          rows.length
            ? h(
                'ol',
                {},
                ...rows.slice(0, 5).map((r) =>
                  numberRow(
                    h(
                      'li',
                      { tabindex: 0, title: `${r.name || r.symbol}: open it`, onclick: () => void openSecurity(r.symbol), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && openSecurity(r.symbol)) },
                      h('span', { class: 'num-col' }, String(n)),
                      h('b', {}, r.symbol),
                      h('span', { class: 'mon-mov-name' }, r.name ?? ''),
                      h('span', { class: `num ${tone(r.change)}` }, pct(r.change, 1)),
                    ),
                    n++,
                    r.symbol,
                  ),
                ),
              )
            : h('p', { class: 'muted small' }, 'None yet (the market may not have opened).'),
        );
      mov.body.replaceChildren(list('Up most', m.up), list('Down most', m.down));
      mov.foot(`Schwab movers · ${clock(Date.now() / 1000)}`);
    } catch (err) {
      mov.body.replaceChildren(h('p', { class: 'muted' }, helper.status.status === 'live' ? (err as Error).message : 'Waiting for the helper.'));
    }
  }

  // ---------- sector sunburst (live) ----------
  const groups = Object.entries(SECTOR_LISTS).map(([label, syms]) => ({ label, items: syms.split(' ') }));
  const changes = new Map<string, number>();
  const burst = sunburst({
    groups,
    title: 'Today by stock and sector',
    centre: 'Nasdaq-100',
    format: (v) => pct(v, 2),
    onItem: (sym) => void openSecurity(sym),
    caption: 'Inner ring: sectors. Outer ring: each stock (equal weight). Deeper colour = bigger move. Click a slice to open it.',
    size: 320,
    hideTitle: true,
  });
  sun.body.append(burst.el);
  let frame = 0;
  const redraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      burst.update((s) => changes.get(s));
      sun.foot(`Schwab live quotes · ${changes.size} of ${groups.reduce((a, g) => a + g.items.length, 0)} priced`);
    });
  };
  let unsubs: (() => void)[] = [];
  const listen = () => {
    if (unsubs.length) return;
    unsubs = groups.flatMap((g) =>
      g.items.map((sym) =>
        subscribeQuote({ provider: 'schwab', symbol: sym }, (q) => {
          if (q.last != null && q.prevClose) changes.set(sym, q.last / q.prevClose - 1);
          redraw();
        }),
      ),
    );
    redraw();
  };

  // ---------- news ----------
  async function loadTop() {
    try {
      const { items } = await loadNews();
      const best = [...items].sort((a, b) => b.score - a.score).slice(0, 9);
      let n = 71;
      const row = (it: NewsItem) =>
        numberRow(
          h(
            'li',
            { class: `mon-story ${it.impact === 'high' ? 'hot' : ''}`, tabindex: 0, title: it.summary || it.title, onclick: () => window.open(it.link, '_blank', 'noopener'), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && window.open(it.link, '_blank', 'noopener')) },
            h('span', { class: 'num-col' }, String(n)),
            h('span', { class: 'mon-story-text' }, h('span', { class: 'mon-headline' }, it.title), h('span', { class: 'mon-meta' }, [it.published ? clock(it.published) : '', it.source].filter(Boolean).join(' · '))),
          ),
          n++,
          it.title,
        );
      top.body.replaceChildren(best.length ? h('ol', { class: 'mon-river' }, ...best.map(row)) : h('p', { class: 'muted' }, 'No headlines yet.'));
      top.foot('Google News and CNBC, ranked by likely market impact');
    } catch (err) {
      top.body.replaceChildren(h('p', { class: 'muted' }, helper.status.status === 'live' ? (err as Error).message : 'Waiting for the helper.'));
    }
  }

  // skeletons sized like the final content (no layout jump)
  for (const t of [wei, cross, mov, top]) t.body.replaceChildren(h('div', { class: 'skeleton mon-skel' }));
  drawClocks();

  let timers: number[] = [];
  return {
    el,
    start() {
      drawClocks();
      void loadBoards();
      void loadMovers();
      void loadTop();
      listen();
      timers = [
        window.setInterval(drawClocks, 30_000),
        window.setInterval(() => void loadBoards(), 60_000),
        window.setInterval(() => void loadMovers(), 120_000),
        window.setInterval(() => void loadTop(), 300_000),
      ];
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
      unsubs.forEach((u) => u());
      unsubs = [];
    },
  };
}
