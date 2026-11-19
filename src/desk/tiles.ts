/**
 * What each Desk tile draws. Every tile fills its body and returns a function that stops it (live quotes, timers),
 * called when the tile is removed or the view changes. Built from the platform's existing pieces (the calendar's
 * upcoming list, the Fed odds panel, the curve chart, the sunburst) so the Desk adds a way to arrange them, not copies.
 */
import { engineRequest, helper, HELPER_NOT_RUNNING, loadNews } from '../data/schwab';
import { createMarketReadWidget } from '../term/readWidget';
import { subscribeQuote, guessMarket } from '../data/quotes';
import { fedOddsPanel } from '../edge/fedOdds';
import type { BoardRow } from '../invest/shared';
import { WORLD, boardSymbols, leaders } from '../markets/monitor';
import { createUpcomingPanel } from '../pages/calendarPage';
import { loadDaily } from '../security/data';
import { openSecurity } from '../security/open';
import { SECTOR_LISTS } from '../security/related';
import { pct } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { sunburst } from '../ui/viz';
import { curveTable, yieldCurve, type CurvePoint } from '../ui/yieldCurve';
import type { Tile } from './desk';

const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) < 5e-5 ? '' : v > 0 ? 'up' : 'down');
const waiting = (err: unknown) => h('p', { class: 'muted small' }, helper.status.status === 'live' ? `Couldn’t load: ${(err as Error).message}` : HELPER_NOT_RUNNING);
const openRow = (sym: string) => ({ tabindex: 0, title: `${sym}: open it`, onclick: () => void openSecurity(sym), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && openSecurity(sym)) });

/** One-year line chart of a ticker with its last price, change and range (daily closes). */
function chartTile(body: HTMLElement, sym: string) {
  body.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
  loadDaily(sym).then(
    (bars) => {
      const pts = bars.filter((b) => Number.isFinite(b.close)).slice(-252);
      if (pts.length < 3) return body.replaceChildren(h('p', { class: 'muted small' }, `No price history for ${sym}.`));
      const W = 600;
      const H = 190;
      const lo = Math.min(...pts.map((p) => p.low));
      const hi = Math.max(...pts.map((p) => p.high));
      const X = (i: number) => (i / (pts.length - 1)) * W;
      const Y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 16);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.close).toFixed(1)}`).join(' ');
      const first = pts[0].close;
      const last = pts[pts.length - 1].close;
      const up = last >= first;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('class', 'desk-chart');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${sym} over the last year: ${pct(last / first - 1, 1)}`);
      const area = document.createElementNS(ns, 'path');
      area.setAttribute('d', `${line} L${W} ${H} L0 ${H} Z`);
      area.setAttribute('class', `desk-area ${up ? 'up' : 'down'}`);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', line);
      path.setAttribute('class', `desk-line ${up ? 'up' : 'down'}`);
      svg.append(area, path);
      const prev = pts[pts.length - 2].close;
      body.replaceChildren(
        h(
          'div',
          { class: 'desk-chart-head', ...openRow(sym) },
          h('b', { class: 'desk-sym' }, sym.replace(/^\$/, '')),
          h('span', { class: 'num desk-last' }, formatPrice(last)),
          h('span', { class: `num ${tone(last / prev - 1)}` }, `${pct(last / prev - 1)} today`),
          h('span', { class: `num muted ${tone(last / first - 1)}` }, `${pct(last / first - 1, 1)} 1y`),
        ),
        svg,
        h('div', { class: 'desk-range muted small' }, h('span', {}, `1y low ${formatPrice(lo)}`), h('span', {}, `high ${formatPrice(hi)}`)),
      );
    },
    (err) => body.replaceChildren(waiting(err)),
  );
  return () => {};
}

/** Live prices for a list of tickers. */
function quotesTile(body: HTMLElement, syms: string[]) {
  if (!syms.length) {
    body.replaceChildren(h('p', { class: 'muted small' }, 'No tickers yet: use Edit tickers above.'));
    return () => {};
  }
  const stops: (() => void)[] = [];
  const rows = syms.map((sym) => {
    const last = h('td', { class: 'num' }, '—');
    const chg = h('td', { class: 'num' }, '');
    const ref = guessMarket(sym);
    if (ref)
      stops.push(
        subscribeQuote(ref, (q) => {
          if (q.last != null) last.textContent = formatPrice(q.last);
          const c = q.last != null && q.prevClose ? q.last / q.prevClose - 1 : null;
          chg.textContent = pct(c);
          chg.className = `num ${tone(c)}`;
        }),
      );
    return h('tr', { class: 'mon-row', ...openRow(sym) }, h('td', {}, h('b', { class: 'mon-name' }, sym.replace(/^\$/, ''))), last, chg);
  });
  body.replaceChildren(h('table', { class: 'mon-table desk-quotes' }, h('thead', {}, h('tr', {}, h('th', {}, 'Ticker'), h('th', { class: 'num' }, 'Last'), h('th', { class: 'num' }, 'Today'))), h('tbody', {}, ...rows)));
  return () => stops.forEach((s) => s());
}

function newsTile(body: HTMLElement, syms: string[]) {
  body.replaceChildren(h('div', { class: 'skeleton', style: 'height:160px' }));
  const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  loadNews(syms).then(
    ({ items }) => {
      const best = [...items].sort((a, b) => b.score - a.score).slice(0, 8);
      body.replaceChildren(
        best.length
          ? h(
              'ol',
              { class: 'mon-river' },
              ...best.map((it) =>
                h(
                  'li',
                  { class: `mon-story ${it.impact === 'high' ? 'hot' : ''}`, tabindex: 0, title: it.summary || it.title, onclick: () => window.open(it.link, '_blank', 'noopener') },
                  h('span', { class: 'num-col' }, '•'),
                  h('span', { class: 'mon-story-text' }, h('span', { class: 'mon-headline' }, it.title), h('span', { class: 'mon-meta' }, [it.published ? clock(it.published) : '', it.source].filter(Boolean).join(' · '))),
                ),
              ),
            )
          : h('p', { class: 'muted small' }, 'No headlines yet.'),
      );
    },
    (err) => body.replaceChildren(waiting(err)),
  );
  return () => {};
}

function worldTile(body: HTMLElement) {
  body.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
  engineRequest<{ rows: BoardRow[] }>('invest.board', { symbols: boardSymbols(WORLD) }, 90000).then(
    ({ rows }) => {
      const map = new Map(rows.map((r) => [r.symbol, r]));
      const named = WORLD.flatMap((s) => s.rows.map(([sym, name]) => ({ sym, name, change: map.get(sym)?.change ?? null, ytd: map.get(sym)?.ytd ?? null })));
      const l = leaders(named, 1);
      body.replaceChildren(
        h('p', { class: 'mon-words' }, l.up[0] ? h('span', {}, 'Best ', h('b', { class: 'up' }, `${l.up[0].name} ${pct(l.up[0].change, 1)}`)) : '', l.down[0] ? h('span', {}, ' · worst ', h('b', { class: 'down' }, `${l.down[0].name} ${pct(l.down[0].change, 1)}`)) : ''),
        h(
          'div',
          { class: 'desk-world-grid' },
          ...WORLD.map((sec) =>
            h(
              'table',
              { class: 'mon-table' },
              h('thead', {}, h('tr', { class: 'mon-band' }, h('th', { colspan: 3 }, sec.title))),
              h('tbody', {}, ...sec.rows.map(([sym, name]) => {
                const r = map.get(sym);
                return h('tr', { class: 'mon-row', ...openRow(sym) }, h('td', {}, h('span', { class: 'mon-name' }, name)), h('td', { class: `num ${tone(r?.change)}` }, pct(r?.change)), h('td', { class: `num ${tone(r?.ytd)}` }, pct(r?.ytd, 1)));
              })),
            ),
          ),
        ),
      );
    },
    (err) => body.replaceChildren(waiting(err)),
  );
  return () => {};
}

function sectorsTile(body: HTMLElement) {
  const groups = Object.entries(SECTOR_LISTS).map(([label, syms]) => ({ label, items: syms.split(' ') }));
  const changes = new Map<string, number>();
  const burst = sunburst({ groups, title: 'Nasdaq-100 by sector', centre: 'Nasdaq-100', format: (v) => pct(v, 2), onItem: (s) => void openSecurity(s), size: 300, hideTitle: true });
  body.replaceChildren(burst.el);
  let frame = 0;
  const stops = groups.flatMap((g) =>
    g.items.map((sym) =>
      subscribeQuote({ provider: 'schwab', symbol: sym }, (q) => {
        if (q.last != null && q.prevClose) changes.set(sym, q.last / q.prevClose - 1);
        if (!frame) frame = requestAnimationFrame(() => ((frame = 0), burst.update((s) => changes.get(s))));
      }),
    ),
  );
  return () => {
    stops.forEach((s) => s());
    cancelAnimationFrame(frame);
  };
}

function moversTile(body: HTMLElement) {
  engineRequest<{ up?: BoardRow[]; down?: BoardRow[] }>('invest.movers', { index: '$SPX' }, 60000).then(
    (m) => {
      const list = (title: string, rows: BoardRow[] = []) =>
        h('div', { class: 'mon-movers' }, h('h4', {}, title), h('ol', {}, ...rows.slice(0, 5).map((r) => h('li', openRow(r.symbol), h('span', { class: 'num-col' }, '•'), h('b', {}, r.symbol), h('span', { class: 'mon-mov-name' }, r.name ?? ''), h('span', { class: `num ${tone(r.change)}` }, pct(r.change, 1))))));
      body.replaceChildren(list('Up most', m.up), list('Down most', m.down));
    },
    (err) => body.replaceChildren(waiting(err)),
  );
  return () => {};
}

function curveTile(body: HTMLElement) {
  engineRequest<{ curve: CurvePoint[] }>('macro.curve', {}, 60000).then(
    ({ curve }) => body.replaceChildren(...(curve.length ? [yieldCurve(curve), curveTable(curve)] : [h('p', { class: 'muted small' }, 'No curve data yet.')])),
    (err) => body.replaceChildren(waiting(err)),
  );
  return () => {};
}

function notesTile(body: HTMLElement, text: string, save: (text: string) => void) {
  let timer = 0;
  const area = h('textarea', { class: 'input desk-notes', rows: 8, placeholder: 'Ideas, levels to watch, things to check…', 'aria-label': 'Notes' }) as HTMLTextAreaElement;
  area.value = text;
  area.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => save(area.value), 400);
  });
  body.replaceChildren(area, h('p', { class: 'muted small' }, 'Kept on this computer only.'));
  return () => {
    clearTimeout(timer);
    save(area.value);
  };
}

/** Draws a tile's content; returns its stop function. */
export function mountTile(t: Tile, body: HTMLElement, saveText: (text: string) => void): () => void {
  switch (t.type) {
    case 'read': {
      const w = createMarketReadWidget();
      body.replaceChildren(w.body, h('p', { class: 'fn-tile-foot' }, w.asOf));
      void w.refresh();
      const timer = window.setInterval(() => document.visibilityState === 'visible' && void w.refresh(), 60_000);
      return () => clearInterval(timer);
    }
    case 'chart':
      return chartTile(body, t.symbols?.[0] ?? 'SPY');
    case 'quotes':
      return quotesTile(body, t.symbols ?? []);
    case 'news':
      return newsTile(body, t.symbols ?? []);
    case 'world':
      return worldTile(body);
    case 'sectors':
      return sectorsTile(body);
    case 'movers':
      return moversTile(body);
    case 'events': {
      const up = createUpcomingPanel(() => (location.hash = '#calendar'));
      body.replaceChildren(up.el);
      void up.refresh();
      return () => {};
    }
    case 'fed':
      body.replaceChildren(fedOddsPanel());
      return () => {};
    case 'curve':
      return curveTile(body);
    case 'notes':
      return notesTile(body, t.text ?? '', saveText);
  }
}
