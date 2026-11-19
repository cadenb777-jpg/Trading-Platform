/**
 * Markets > Monitor (MON): the whole market on one screen in the terminal layout (owner, 2026-11-19: "I'm digging
 * that model"). Three columns of dense glass panels that fill the window, most important first, and a numbered tab row
 * that widens one asset class to the whole screen:
 *   WEI  world equities (live)          FUT  futures across assets: today's move, the move in standard deviations,
 *   IMAP US sectors against the S&P 500      1 week, 1 month and where speculators are positioned (CFTC)
 *        (live)                        READ why it's moving: one read across all the panels (rules, src/term/read.ts)
 *                                      MOV  S&P 500 movers
 *   GC   Treasury curve with bp changes and spreads · WIRP Fed path · CORR 20-day correlations against a year · TOP news
 * Numbers update in place with one calm flash when they change (src/term/flash.ts). A missing source says so in one
 * line at the foot of its panel; nothing is made up. Every row is numbered: "5" + Enter in the command bar opens it.
 */
import { engineRequest, HELPER_NOT_RUNNING, helper, loadNews, type NewsItem } from '../data/schwab';
import { subscribeQuote } from '../data/quotes';
import { rememberReply, savedReply, savedThenFresh } from '../data/saved';
import { EXCHANGES, WORLD, boardSymbols, sessionState } from '../markets/monitor';
import { SECTOR_LISTS } from '../security/related';
import { openSecurity } from '../security/open';
import type { BoardRow } from '../invest/shared';
import type { FedOdds } from '../edge/fedOdds';
import { formatPrice, h } from '../ui/dom';
import { sunburst } from '../ui/viz';
import { bp, pc, sgn, termPanel, termTable, toneOf, type TermPanel } from '../term/kit';
import { marketRead, spread, type CurvePoint, type FutRow } from '../term/read';
import { alignedReturns, corrMatrix, type Closes } from '../term/corr';

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const errText = (err: unknown) => (helper.isConnected ? (err as Error).message : HELPER_NOT_RUNNING);
const shortDate = (iso: string) => (iso ? new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

const SECTORS: [string, string][] = [
  ['XLK', 'Technology'], ['XLC', 'Communications'], ['XLY', 'Discretionary'], ['XLF', 'Financials'], ['XLI', 'Industrials'], ['XLV', 'Health care'],
  ['XLP', 'Staples'], ['XLE', 'Energy'], ['XLB', 'Materials'], ['XLRE', 'Real estate'], ['XLU', 'Utilities'],
];
/** The futures shown on the overview (the FX & commodities tab shows every market on the board). */
const KEY_FUTURES = new Set(['ES', 'NQ', 'RTY', 'ZT', 'ZN', 'ZB', 'CL', 'NG', 'GC', 'SI', 'HG', 'ZC', '6E', '6J', 'DX', 'BTC', 'VX']);
/** Short market names for the dense futures table (the full contract name is in the row's tooltip). */
const FUT_NAMES: Record<string, string> = {
  ES: 'S&P 500', NQ: 'Nasdaq 100', YM: 'Dow', RTY: 'Russell 2000', ZT: 'UST 2Y', ZF: 'UST 5Y', ZN: 'UST 10Y', ZB: 'UST bond', SR3: 'SOFR 3M',
  CL: 'WTI crude', NG: 'Natural gas', RB: 'Gasoline', HO: 'Heating oil', GC: 'Gold', SI: 'Silver', HG: 'Copper', PL: 'Platinum',
  ZC: 'Corn', ZS: 'Soybeans', ZW: 'Wheat', ZL: 'Soy oil', ZM: 'Soy meal', LE: 'Live cattle', HE: 'Lean hogs', KC: 'Coffee', SB: 'Sugar', CC: 'Cocoa',
  '6E': 'EUR/USD', '6J': 'JPY/USD', '6B': 'GBP/USD', '6A': 'AUD/USD', '6C': 'CAD/USD', DX: 'Dollar index', BTC: 'Bitcoin', ETH: 'Ether', VX: 'VIX futures',
};
const FUT_ORDER = ['Equity index', 'Rates', 'Energy', 'Metals', 'Ags', 'FX', 'Crypto', 'Volatility'];
const CORR_SET: [string, string][] = [['SPY', 'SPX'], ['TLT', 'Bonds'], ['UUP', 'USD'], ['GLD', 'Gold'], ['USO', 'Oil']];

type View = 'overview' | 'equities' | 'rates' | 'cross' | 'movers' | 'news';
const VIEWS: [View, string][] = [['overview', 'Overview'], ['equities', 'Equities'], ['rates', 'Rates'], ['cross', 'FX & commodities'], ['movers', 'Movers'], ['news', 'News']];

interface Fut extends FutRow {
  symbol: string;
  full?: string;
  price: number | null;
}

export function createMonitorPage() {
  const go = (route: string) => () => (location.hash = `#${route}`);
  const panel = (o: Parameters<typeof termPanel>[0], views: View[]) => {
    const p = termPanel(o);
    p.el.dataset.views = views.join(' ');
    return p;
  };

  // ---------- panels ----------
  const wei = panel({ code: 'WEI', title: 'World equity markets', cls: 'm-wei', link: { label: 'All markets', open: go('invest') }, tip: 'Countries through the US-listed ETFs that track them' }, ['overview', 'equities']);
  const sec = panel({ code: 'IMAP', title: 'US sectors vs S&P 500', cls: 'm-sec' }, ['overview', 'equities']);
  const heat = panel({ code: 'HEAT', title: 'Nasdaq-100 by sector', cls: 'm-heat' }, ['equities']);
  const fut = panel({ code: 'FUT', title: 'Futures across assets', cls: 'm-fut', link: { label: 'Futures', open: go('futures') }, tip: 'σ = today’s move in daily standard deviations · Spec = speculators’ net position against the last 3 years (0 = most short, 100 = most long), CFTC' }, ['overview', 'cross']);
  const read = panel({ code: 'READ', title: 'Why it’s moving', cls: 'm-read', tip: 'Worked out from the numbers on this screen by fixed rules (not AI)' }, ['overview', 'cross', 'rates']);
  const mov = panel({ code: 'MOV', title: 'S&P 500 movers', cls: 'm-mov', link: { label: 'More', open: go('invest') } }, ['overview', 'movers', 'equities']);
  const gc = panel({ code: 'GC', title: 'US Treasury curve', cls: 'm-gc', link: { label: 'Bonds', open: go('invest') } }, ['overview', 'rates']);
  const wirp = panel({ code: 'WIRP', title: 'Fed path (futures)', cls: 'm-wirp', link: { label: 'Fed odds', open: go('macro') } }, ['overview', 'rates']);
  const corr = panel({ code: 'CORR', title: 'Correlation 20d / 1y', cls: 'm-corr', tip: 'Daily moves over the last 20 sessions; the year’s figure in brackets. A big gap means a relationship has changed.' }, ['overview', 'rates', 'cross']);
  const top = panel({ code: 'TOP', title: 'Top news', cls: 'm-top', link: { label: 'All news', open: go('home') } }, ['overview', 'news']);

  // ---------- command strip, clocks, tabs ----------
  const clocks = h('div', { class: 'term-clocks', 'aria-label': 'World market clocks' });
  const drawClocks = () =>
    clocks.replaceChildren(
      ...EXCHANGES.map((x) => {
        const s = sessionState(x, new Date());
        return h('span', { class: `term-clock ${s.state}`, title: `${x.city}: ${s.note}` }, h('b', {}, x.city.slice(0, 3).toUpperCase()), ` ${s.time} `, h('i', {}, s.state === 'open' ? 'OPEN' : s.state === 'lunch' ? 'LUNCH' : 'CLSD'));
      }),
    );
  const grid = h('div', { class: 'mon2-grid', 'data-view': 'overview' },
    h('div', { class: 'mon2-col' }, wei.el, sec.el, heat.el),
    h('div', { class: 'mon2-col' }, fut.el, read.el, mov.el),
    h('div', { class: 'mon2-col' }, gc.el, wirp.el, corr.el, top.el),
  );
  const tabs = h('div', { class: 'term-tabs', role: 'tablist', 'aria-label': 'Monitor views' });
  let view: View = 'overview';
  const drawTabs = () =>
    tabs.replaceChildren(
      ...VIEWS.map(([v, label], i) =>
        h('button', { type: 'button', role: 'tab', class: v === view ? 'on' : '', 'aria-selected': String(v === view), onclick: () => setView(v) }, h('b', {}, `${i + 1})`), ` ${label}`),
      ),
    );
  const setView = (v: View) => {
    view = v;
    grid.dataset.view = v;
    drawTabs();
    if (futRows.length) drawFut();
  };
  drawTabs();
  const onKey = (e: KeyboardEvent) => {
    // 1-6 switch tabs when nothing is being typed (numbers typed in the command bar open rows instead)
    const t = e.target as HTMLElement | null;
    if (e.altKey || e.ctrlKey || e.metaKey || (t && (t.closest('input, textarea, select, [contenteditable]') || t.isContentEditable))) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length && el.offsetParent) setView(VIEWS[n - 1][0]);
  };

  const el = h(
    'div',
    { class: 'term-page monitor2' },
    h('div', { class: 'term-cmd' }, h('span', { class: 'term-fn' }, 'MON'), h('h1', { class: 'term-title' }, 'World markets monitor'), clocks),
    tabs,
    grid,
  );

  // ---------- WEI: world equities (board + live quotes) ----------
  const board = new Map<string, BoardRow>();
  const weiTable = termTable<[string, string]>({
    id: ([s]) => s,
    number: 1,
    label: ([, n]) => n,
    open: ([s]) => void openSecurity(s),
    rowTitle: ([s, n]) => `${n} (${s}): open it`,
    cols: [
      { label: 'Market', left: true, text: ([, n]) => n },
      { label: 'Last', text: ([s]) => (board.get(s)?.price != null ? formatPrice(board.get(s)!.price!) : '—'), value: ([s]) => board.get(s)?.price, minMove: 0.0002 },
      { label: '%Chg', text: ([s]) => pc(board.get(s)?.change), tone: ([s]) => toneOf(board.get(s)?.change) },
      { label: '1M%', text: ([s]) => pc(board.get(s)?.m1, 1), tone: ([s]) => toneOf(board.get(s)?.m1) },
      { label: 'YTD%', text: ([s]) => pc(board.get(s)?.ytd, 1), tone: ([s]) => toneOf(board.get(s)?.ytd) },
      { label: '1Y%', text: ([s]) => pc(board.get(s)?.y1, 1), tone: ([s]) => toneOf(board.get(s)?.y1) },
    ],
  });
  wei.body.append(weiTable.el);
  const drawWei = () => weiTable.set(WORLD.map((g) => ({ title: g.title, rows: g.rows })));

  const spy = () => board.get('SPY')?.change ?? null;
  const rel = (s: string) => (board.get(s)?.change != null && spy() != null ? board.get(s)!.change! - spy()! : null);
  const rel3 = (s: string) => {
    const a = board.get(s)?.m3, b = board.get('SPY')?.m3;
    return a != null && b != null ? (1 + a) / (1 + b) - 1 : null;
  };
  const secTable = termTable<[string, string]>({
    id: ([s]) => s,
    number: 31,
    label: ([, n]) => n,
    open: ([s]) => void openSecurity(s),
    cols: [
      { label: 'Sector', left: true, text: ([, n]) => n },
      { label: '%1D', text: ([s]) => pc(board.get(s)?.change), tone: ([s]) => toneOf(board.get(s)?.change), value: ([s]) => board.get(s)?.price, minMove: 0.0002 },
      { label: 'vs SPX', text: ([s]) => pc(rel(s)), tone: ([s]) => toneOf(rel(s)) },
      { label: '%1M', text: ([s]) => pc(board.get(s)?.m1, 1), tone: ([s]) => toneOf(board.get(s)?.m1) },
      { label: '3M vs SPX', text: ([s]) => pc(rel3(s), 1), tone: ([s]) => toneOf(rel3(s)), title: '3-month return relative to the S&P 500' },
    ],
  });
  sec.body.append(secTable.el);
  const drawSec = () => {
    const rows = [...SECTORS].sort((a, b) => (rel(b[0]) ?? -9) - (rel(a[0]) ?? -9));
    secTable.set([{ title: '', rows }]);
  };

  async function loadBoard() {
    const symbols = [...boardSymbols(WORLD), ...SECTORS.map(([s]) => s)];
    try {
      await savedThenFresh<{ rows: BoardRow[]; asOf?: number }>('invest.board', { symbols }, 90000, ({ rows, asOf }, _at, old) => {
        for (const r of rows) board.set(r.symbol, { ...board.get(r.symbol), ...r });
        drawWei();
        drawSec();
        wei.source(`Schwab · ${clock(asOf ?? Date.now() / 1000)}`);
        sec.source(`ranked vs S&P · ${clock(asOf ?? Date.now() / 1000)}`);
        wei.note('');
        drawRead();
        if (old) wei.source('saved copy · refreshing…');
      });
    } catch (err) {
      wei.note(errText(err));
    }
  }

  // live quotes move Last and %Chg between board refreshes
  let quoteUnsubs: (() => void)[] = [];
  let liveFrame = 0;
  const liveRedraw = () => {
    if (liveFrame) return;
    liveFrame = requestAnimationFrame(() => {
      liveFrame = 0;
      drawWei();
      drawSec();
    });
  };
  const listenQuotes = () => {
    if (quoteUnsubs.length) return;
    quoteUnsubs = [...boardSymbols(WORLD), ...SECTORS.map(([s]) => s)].map((sym) =>
      subscribeQuote({ provider: 'schwab', symbol: sym }, (q) => {
        const r = board.get(sym);
        if (!r || q.last == null) return;
        r.price = q.last;
        if (q.prevClose) r.change = q.last / q.prevClose - 1;
        liveRedraw();
      }),
    );
  };

  // ---------- HEAT: Nasdaq-100 sunburst (Equities tab) ----------
  const groups = Object.entries(SECTOR_LISTS).map(([label, syms]) => ({ label, items: syms.split(' ') }));
  const changes = new Map<string, number>();
  const burst = sunburst({ groups, title: 'Today by stock and sector', centre: 'Nasdaq-100', format: (v) => sgn(v * 100, 2) + '%', onItem: (s) => void openSecurity(s), caption: 'Inner ring: sectors. Outer ring: each stock (equal weight).', size: 300, hideTitle: true });
  heat.body.append(burst.el);
  let heatUnsubs: (() => void)[] = [];
  let heatFrame = 0;
  const listenHeat = () => {
    if (heatUnsubs.length) return;
    heatUnsubs = groups.flatMap((g) =>
      g.items.map((sym) =>
        subscribeQuote({ provider: 'schwab', symbol: sym }, (q) => {
          if (q.last != null && q.prevClose) changes.set(sym, q.last / q.prevClose - 1);
          if (!heatFrame) heatFrame = requestAnimationFrame(() => ((heatFrame = 0), burst.update((s) => changes.get(s)), heat.source(`live · ${changes.size} priced`)));
        }),
      ),
    );
  };

  // ---------- FUT: futures across assets ----------
  let futRows: Fut[] = [];
  const futTable = termTable<Fut>({
    id: (r) => r.root,
    number: 51,
    label: (r) => r.name,
    open: () => (location.hash = '#futures'),
    rowTitle: (r) => `${r.full ?? r.name} (${r.symbol})${r.positioning?.date ? ` · CFTC ${r.positioning.date}` : ''}`,
    cols: [
      { label: 'Market', left: true, text: (r) => r.name },
      { label: 'Last', text: (r) => (r.price != null ? formatPrice(r.price) : '—'), value: (r) => r.price, minMove: 0.0002 },
      { label: '%Chg', text: (r) => pc(r.change), tone: (r) => toneOf(r.change) },
      { label: 'σ', text: (r) => sgn(r.sigma), tone: (r) => (r.sigma != null && Math.abs(r.sigma) >= 2 ? toneOf(r.sigma) : ''), title: 'Today’s move in daily standard deviations (2 or more is unusual)' },
      { label: '1W%', text: (r) => pc(r.w1, 1), tone: (r) => toneOf(r.w1) },
      { label: '1M%', text: (r) => pc(r.m1, 1), tone: (r) => toneOf(r.m1) },
      { label: 'Spec', text: (r) => (r.positioning?.specIndex != null ? String(Math.round(r.positioning.specIndex)) : '—'), cls: 'spec', title: 'Speculators’ net position against the last 3 years: 0 = most short, 100 = most long (CFTC)' },
    ],
  });
  fut.body.append(futTable.el);
  const drawFut = () => {
    const all = view === 'cross';
    const rows = futRows.filter((r) => (all ? !/^M[A-Z]/.test(r.root) : KEY_FUTURES.has(r.root)));
    futTable.set(FUT_ORDER.map((s) => ({ title: s, rows: rows.filter((r) => r.sector === s) })).filter((g) => g.rows.length));
  };
  async function loadFutures() {
    try {
      await savedThenFresh<{ rows: Fut[]; asOf: number; errors: Record<string, string> }>('futures.board', {}, 90000, (b, _at, old) => {
        futRows = b.rows.map((r) => ({ ...r, full: r.name, name: FUT_NAMES[r.root] ?? r.name }));
        drawFut();
        fut.source(`Schwab · CFTC · ${clock(b.asOf)}`);
        fut.note(Object.values(b.errors ?? {}).join(' '));
        drawRead();
        if (old) fut.source('saved copy · refreshing…');
      });
    } catch (err) {
      fut.note(errText(err));
    }
  }

  // ---------- GC: Treasury curve ----------
  let curve: (CurvePoint & { date?: string })[] = [];
  const gcTable = termTable<{ label: string; now: number | null; m: number | null; y: number | null; spread?: boolean }>({
    id: (r) => r.label,
    cols: [
      { label: 'Tenor', left: true, text: (r) => r.label },
      { label: 'Yield', text: (r) => (r.now == null ? '—' : r.spread ? bp(r.now) : r.now.toFixed(2)), value: (r) => r.now },
      { label: '1M bp', text: (r) => bp(r.m), cls: 'dim' },
      { label: '1Y bp', text: (r) => bp(r.y), cls: 'dim' },
    ],
  });
  gc.body.append(gcTable.el);
  async function loadCurve() {
    try {
      await savedThenFresh<{ curve: (CurvePoint & { date?: string })[] }>('macro.curve', {}, 60000, (d, _at, old) => {
        curve = d.curve ?? [];
        const diff = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? (a - b) * 100 : null);
        const tenors = curve.map((c) => ({ label: c.label, now: c.now, m: diff(c.now, c.monthAgo), y: diff(c.now, c.yearAgo) }));
        const sp = (a: string, b: string) => {
          const n = spread(curve, a, b), m = spread(curve, a, b, 'monthAgo'), y = spread(curve, a, b, 'yearAgo');
          const t = (x: string) => (x.endsWith('Y') ? `${x.slice(0, -1)}s` : x.toLowerCase());
          return { label: `${t(a)}${t(b)}`, now: n, m: n != null && m != null ? n - m : null, y: n != null && y != null ? n - y : null, spread: true };
        };
        gcTable.set([{ title: '', rows: tenors }, { title: 'Spreads (bp)', rows: [sp('2Y', '10Y'), sp('3M', '10Y'), sp('5Y', '30Y')].filter((r) => r.now != null) }]);
        gc.source(`Treasury · ${shortDate(curve[0]?.date ?? '')}`);
        gc.note('');
        drawRead();
        if (old) gc.source('saved copy · refreshing…');
      });
    } catch (err) {
      gc.note(errText(err));
    }
  }

  // ---------- WIRP: Fed path ----------
  let fedLine: { change: number; by: string } | null = null;
  const wirpTable = termTable<FedOdds['meetings'][number] & { effr: number }>({
    id: (m) => m.date,
    cols: [
      { label: 'Meeting', left: true, text: (m) => new Date(`${m.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + (m.tentative ? '*' : ''), title: 'An asterisk marks a meeting date the Fed has not confirmed yet' },
      { label: 'Implied', text: (m) => m.after.toFixed(2), value: (m) => m.after },
      { label: 'Δ bp', text: (m) => bp(m.expectedChange * 100), cls: 'dim', title: 'Change priced in from today' },
      { label: 'P(cut)', text: (m) => `${Math.round(m.pCut * 100)}%` },
      { label: 'P(hike)', text: (m) => `${Math.round(m.pHike * 100)}%`, cls: 'dim' },
    ],
  });
  wirp.body.append(wirpTable.el);
  async function loadFed() {
    try {
      await savedThenFresh<FedOdds>('macro.fedodds', {}, 60000, (d, _at, old) => {
        const ms = d.meetings.slice(0, 6).map((m) => ({ ...m, effr: d.effr }));
        wirpTable.set([{ title: '', rows: ms }]);
        const third = d.meetings[Math.min(2, d.meetings.length - 1)];
        fedLine = third ? { change: third.expectedChange, by: new Date(`${third.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) } : null;
        wirp.source(`EFFR ${d.effr.toFixed(2)} · ${shortDate(d.asOf)}`);
        wirp.note('');
        drawRead();
        if (old) wirp.source('saved copy · refreshing…');
      });
    } catch (err) {
      wirp.note(errText(err));
    }
  }

  // ---------- CORR: correlations ----------
  /** Daily closes: the saved copy when it is from today (correlations barely move within a day), else the helper. */
  const historyFast = async (symbol: string): Promise<Closes> => {
    const s = savedReply<{ closes: Closes }>('invest.history', { symbol });
    if (s && Date.now() - s.at < 12 * 3600_000) return s.data.closes;
    const d = await engineRequest<{ closes: Closes }>('invest.history', { symbol }, 60000);
    rememberReply('invest.history', { symbol }, d);
    return d.closes;
  };
  async function loadCorr() {
    try {
      const got = await Promise.all(CORR_SET.map(([s]) => historyFast(s).catch(() => [] as Closes)));
      const series: Record<string, Closes> = {};
      CORR_SET.forEach(([, name], i) => got[i].length && (series[name] = got[i]));
      const { names, rows } = alignedReturns(series);
      if (names.length < 2 || rows.length < 25) {
        corr.note('Not enough daily history yet to measure correlations.');
        return;
      }
      const short = corrMatrix(names, rows, 20);
      const year = corrMatrix(names, rows, 0);
      const cell = (v: number | null, y: number | null, diag: boolean) => {
        if (diag) return h('td', { class: 'c-diag' }, '·');
        if (v == null) return h('td', {}, '—');
        const changed = y != null && Math.abs(v - y) >= 0.4;
        const tint = v >= 0 ? 'var(--viz-1)' : 'var(--viz-2)';
        const two = (x: number) => x.toFixed(2).replace(/^(-?)0\./, '$1.');
        return h('td', { class: changed ? 'c-changed' : '', style: `background:color-mix(in srgb, ${tint} ${Math.round(Math.abs(v) * 42)}%, transparent)`, title: `20 days ${v.toFixed(2)} · 1 year ${y?.toFixed(2) ?? '—'}${changed ? ' · changed a lot' : ''}` }, two(v), h('small', {}, y != null ? two(y) : '—'));
      };
      corr.body.replaceChildren(
        h('table', { class: 'tt corr-tt' },
          h('thead', {}, h('tr', {}, h('th', {}), ...names.map((n) => h('th', {}, n)))),
          h('tbody', {}, ...names.map((n, i) => h('tr', {}, h('td', { class: 'l' }, n), ...names.map((_, j) => cell(short[i][j], year[i][j], i === j))))),
        ),
      );
      corr.source('ETFs · daily closes');
      corr.note('Blue = move together, orange = move opposite. Outlined: 20 days differs from the year by 0.4 or more.');
    } catch (err) {
      corr.note(errText(err));
    }
  }

  // ---------- READ ----------
  function drawRead() {
    const markets: Record<string, number | null | undefined> = {};
    for (const s of ['SPY', 'IWM', 'EWJ', 'FXI']) markets[s] = board.get(s)?.change;
    const lines = marketRead({
      futures: futRows,
      curve,
      fed: fedLine,
      sectorsVsSpx: SECTORS.map(([s, name]) => ({ name, rel: rel(s) })).filter((x): x is { name: string; rel: number } => x.rel != null),
      markets,
    });
    read.body.replaceChildren(
      lines.length
        ? h('dl', { class: 'term-read' }, ...lines.flatMap((l) => [h('dt', {}, l.label), h('dd', {}, l.text)]))
        : h('p', { class: 'term-empty' }, 'The read appears once prices, futures and the curve have loaded.'),
    );
  }
  drawRead();

  // ---------- MOV ----------
  const movTable = termTable<BoardRow>({
    id: (r) => r.symbol,
    number: 81,
    label: (r) => r.symbol,
    open: (r) => void openSecurity(r.symbol),
    cols: [
      { label: 'Symbol', left: true, text: (r) => r.symbol, cls: 'sym' },
      { label: 'Name', left: true, text: (r) => r.name ?? '', cls: 'dim' },
      { label: 'Last', text: (r) => (r.price != null ? formatPrice(r.price) : '—'), value: (r) => r.price },
      { label: '%Chg', text: (r) => pc(r.change), tone: (r) => toneOf(r.change) },
    ],
  });
  mov.body.append(movTable.el);
  async function loadMovers() {
    try {
      await savedThenFresh<{ up?: BoardRow[]; down?: BoardRow[] }>('invest.movers', { index: '$SPX' }, 60000, (m, _at, old) => {
        movTable.set([{ title: 'Up most', rows: (m.up ?? []).slice(0, 5) }, { title: 'Down most', rows: (m.down ?? []).slice(0, 5) }]);
        mov.source(`Schwab · ${clock(Date.now() / 1000)}`);
        mov.note(m.up?.length || m.down?.length ? '' : 'No movers yet (the market may not have opened).');
        if (old) mov.source('saved copy · refreshing…');
      });
    } catch (err) {
      mov.note(errText(err));
    }
  }

  // ---------- TOP ----------
  async function loadTop() {
    try {
      const { items } = await loadNews();
      const best = [...items].sort((a, b) => b.score - a.score).slice(0, 14);
      let n = 101;
      const row = (it: NewsItem) => {
        const li = h(
          'li',
          { class: `term-story ${it.impact === 'high' ? 'hot' : ''}`, tabindex: 0, title: it.summary || it.title, onclick: () => window.open(it.link, '_blank', 'noopener'), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && window.open(it.link, '_blank', 'noopener')) },
          h('span', { class: 'tt-n' }, `${n})`),
          h('span', { class: 'term-headline' }, it.title),
          h('span', { class: 'term-meta' }, it.published ? clock(it.published) : ''),
        );
        li.dataset.num = String(n);
        li.dataset.numLabel = it.title;
        n++;
        return li;
      };
      top.body.replaceChildren(best.length ? h('ol', { class: 'term-river' }, ...best.map(row)) : h('p', { class: 'term-empty' }, 'No headlines yet.'));
      top.source('Google News · CNBC · by impact');
      top.note('');
    } catch (err) {
      top.note(errText(err));
    }
  }

  // skeleton rows until data arrives (sized like the content, no jump)
  const allPanels: TermPanel[] = [wei, sec, fut, gc, wirp, corr, mov, top];
  for (const p of allPanels) if (!p.body.textContent) p.body.append(h('div', { class: 'skeleton term-skel' }));
  const clearSkel = () => el.querySelectorAll('.term-skel').forEach((s) => s.remove());
  drawWei();
  drawSec();
  drawClocks();

  let timers: number[] = [];
  return {
    el,
    start() {
      drawClocks();
      document.addEventListener('keydown', onKey);
      void Promise.allSettled([loadBoard(), loadFutures(), loadCurve(), loadFed(), loadCorr(), loadMovers(), loadTop()]).then(clearSkel);
      listenQuotes();
      listenHeat();
      timers = [
        window.setInterval(drawClocks, 30_000),
        window.setInterval(() => void loadBoard(), 60_000),
        window.setInterval(() => void loadFutures(), 60_000),
        window.setInterval(() => void loadMovers(), 120_000),
        window.setInterval(() => void loadTop(), 300_000),
        window.setInterval(() => void (loadCurve(), loadFed()), 600_000),
        window.setInterval(() => void loadCorr(), 3_600_000),
      ];
    },
    stop() {
      document.removeEventListener('keydown', onKey);
      timers.forEach(clearInterval);
      timers = [];
      [...quoteUnsubs, ...heatUnsubs].forEach((u) => u());
      quoteUnsubs = [];
      heatUnsubs = [];
    },
  };
}
