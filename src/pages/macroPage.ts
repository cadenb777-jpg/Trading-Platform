/** Macro: the US economy, laid out the way macro desks read it: today's regime (growth and inflation, each speeding up or
 * slowing), the key numbers, Fed rate odds and net liquidity, the Treasury curve, then one compact monitor of every
 * series (latest, 1-month and 1-year change, 2-year trend, where it sits in its own history). World tab: macroWorld.ts. */
import { insightButton } from '../ai/insight';
import { clearEngineCache, engineRequest } from '../data/schwab';
import { pageFrame } from '../ui/charts';
import { activatable, h } from '../ui/dom';
import { openChartWindow } from '../ui/chartWindow';
import { openFredWindow } from '../ui/fredWindow';
import { yieldCurve, curveTable, type CurvePoint } from '../ui/yieldCurve';
import { asOfStamp } from '../ui/dataHealth';
import { infoTip } from '../ui/glossary';
import { fedOddsPanel } from '../edge/fedOdds';
import { netLiquidityPanel } from '../edge/netLiquidity';
import { sahmPanel } from '../macro/sahmView';
import { rightNowPanels } from '../macro/conditionsView';
import { percentileNow, regime, sparkPoints, valueAgo, type Point, type RegimeInput } from '../macro/monitor';
import { createWorldTab } from './macroWorld';

interface Series {
  id: string;
  name: string;
  group: string;
  unit: string;
  upGood: boolean | null;
  date: string;
  value: number;
  previous: number | null;
  monthAgo: number | null;
  yearAgo: number | null;
  data: Point[];
}

/** The key numbers at the top. */
const KEY = ['DFF', 'DGS10', 'T10Y2Y', 'CPIAUCSL', 'UNRATE', 'BAMLH0A0HYM2'];
const SHORT: Record<string, string> = { DFF: 'Fed funds', DGS10: '10-year yield', T10Y2Y: '10y − 2y', CPIAUCSL: 'Inflation (CPI)', UNRATE: 'Unemployment', BAMLH0A0HYM2: 'Junk bond spread', DGS2: '2-year yield', MORTGAGE30US: '30y mortgage', T10YIE: '10y inflation exp.', PCEPILFE: 'Core PCE', VIXCLS: 'VIX', DTWEXBGS: 'Dollar index', DCOILWTICO: 'Oil (WTI)', ICSA: 'Jobless claims', PAYEMS: 'Jobs added', GDPC1: 'Real GDP growth' };

function fmt(v: number | null | undefined, unit: string) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === '%') return `${v.toFixed(2)}%`;
  if (unit === '$') return `$${v.toFixed(2)}`;
  if (unit === 'K') return `${v >= 0 ? '+' : ''}${Math.round(v)}K`;
  return Math.abs(v) >= 10000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2);
}

function change(s: Series, then: number | null, label: string) {
  if (then == null) return null;
  const diff = s.value - then;
  const tiny = s.unit === '%' || s.unit === 'K' ? Math.abs(diff) < 0.005 : Math.abs(diff) < Math.abs(then) * 0.0005;
  const sign = diff >= 0 ? '+' : '−';
  // Rates are compared in points, monthly job gains in thousands (a % change of a number that can go negative means
  // nothing), everything else in %.
  const text = tiny
    ? 'unchanged'
    : s.unit === '%'
      ? `${sign}${Math.abs(diff).toFixed(2)} pts`
      : s.unit === 'K'
        ? `${sign}${Math.round(Math.abs(diff))}K`
        : then > 0 && s.value > 0
          ? `${sign}${((Math.abs(diff) / then) * 100).toFixed(1)}%`
          : `${sign}${Math.abs(diff).toFixed(2)}`;
  const tone = s.upGood == null || tiny ? '' : diff > 0 === s.upGood ? 'up' : 'down';
  return h('span', { class: tone }, `${text} ${label}`);
}

interface CatalogEntry {
  id: string;
  name: string;
  group: string;
  unit: string;
}

/** Runs async jobs with at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await job(queue.shift()!);
  }));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const lastN = (s: Series | undefined, n: number) => (s ? s.data.slice(-n).map((p) => p.value) : []);
const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);

/** Growth and inflation votes from the loaded series (3-month changes; thresholds in each series' own units). */
function regimeInputs(get: (id: string) => Series | undefined): [RegimeInput[], RegimeInput[]] {
  const pay = get('PAYEMS'), claims = get('ICSA'), retail = get('RSAFS'), gdp = get('GDPC1');
  const cpi = get('CPIAUCSL'), pce = get('PCEPILFE'), be = get('T10YIE');
  const ago = (s: Series | undefined, days: number) => (s ? diff(s.value, valueAgo(s.data, days)) : null);
  return [
    [
      { name: 'Jobs added (3-month vs 12-month average)', change: diff(avg(lastN(pay, 3)), avg(lastN(pay, 12))), threshold: 25 },
      { name: 'Jobless claims (4-week vs 26-week average)', change: diff(avg(lastN(claims, 4)), avg(lastN(claims, 26))), threshold: 10000, sign: -1 },
      { name: 'Retail sales growth (3 months)', change: ago(retail, 91), threshold: 0.5 },
      { name: 'GDP growth (latest vs prior year)', change: gdp ? diff(gdp.value, avg(lastN(gdp, 5).slice(0, -1))) : null, threshold: 0.5 },
    ],
    [
      { name: 'CPI inflation (3 months)', change: ago(cpi, 91), threshold: 0.15 },
      { name: 'Core PCE inflation (3 months)', change: ago(pce, 91), threshold: 0.15 },
      { name: 'Inflation expectations (3 months)', change: ago(be, 91), threshold: 0.1 },
    ],
  ];
}

function spark(data: Point[]) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 28');
  svg.setAttribute('class', 'mm-spark');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', sparkPoints(data, 120, 28));
  svg.append(line);
  return svg;
}

/** Where today's reading sits in its history since 2006: a bar with a marker and a word. */
function rankCell(p: number | null) {
  if (p == null) return h('span', { class: 'muted' }, '—');
  const word = p >= 0.9 ? 'near high' : p <= 0.1 ? 'near low' : p >= 0.67 ? 'high' : p <= 0.33 ? 'low' : 'middle';
  return h('span', { class: 'mm-rank', title: `Higher than ${Math.round(p * 100)}% of readings since 2006` }, h('span', { class: 'mm-rank-bar' }, h('i', { style: `left:${(p * 100).toFixed(0)}%` })), h('span', { class: 'small muted' }, word));
}

/** The rates board (Bloomberg BTMM-style): the key series in four groups, one dense tile each. */
export const BOARD: { title: string; ids: string[] }[] = [
  { title: 'Rates', ids: ['DFF', 'DGS2', 'DGS10', 'T10Y2Y', 'MORTGAGE30US'] },
  { title: 'Credit & inflation', ids: ['BAMLH0A0HYM2', 'T10YIE', 'CPIAUCSL', 'PCEPILFE'] },
  { title: 'Markets', ids: ['VIXCLS', 'DTWEXBGS', 'DCOILWTICO'] },
  { title: 'Jobs & growth', ids: ['UNRATE', 'ICSA', 'PAYEMS', 'GDPC1'] },
];

export function createMacroPage() {
  const loaded = new Map<string, Series>();
  const rows = new Map<string, HTMLTableRowElement>();
  let curve: CurvePoint[] = [];
  let catalog: CatalogEntry[] = [];
  const curvePanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Treasury yield curve')), h('div', { class: 'skeleton', style: 'height:260px' }));
  const readPanel = h('section', { class: 'panel mm-read' }, h('div', { class: 'skeleton', style: 'height:150px' }));
  // sized like the finished board, so nothing below jumps when it fills in
  const boardPanel = h('section', { class: 'panel mm-board-panel' }, h('div', { class: 'skeleton', style: 'height:300px' }));
  function renderBoard() {
    const tile = (id: string) => {
      const s = loaded.get(id);
      if (!s) return h('div', { class: 'mm-tile muted' }, h('span', { class: 'mm-tile-name' }, SHORT[id] ?? id), h('b', {}, '—'));
      return h(
        'button',
        { type: 'button', class: 'mm-tile', title: `${s.name}: open its history`, onclick: () => rows.get(id)?.click() },
        h('span', { class: 'mm-tile-name' }, SHORT[id] ?? s.name.replace(/\s*\(.*\)$/, '')),
        h('b', { class: 'mm-tile-value' }, fmt(s.value, s.unit)),
        h('span', { class: 'mm-tile-chg small' }, change(s, s.monthAgo, '1m') ?? ''),
        spark(s.data.slice(-260)),
        h('span', { class: 'mm-tile-rank' }, rankCell(percentileNow(s.data))),
      );
    };
    boardPanel.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, 'Rates & markets board'), h('span', { class: 'muted small' }, 'Latest reading, change over a month (green/red: good/bad news for the economy), the last year, and where it sits since 2006. Click a tile for its history.')),
      h('div', { class: 'mm-board' }, ...BOARD.map((g) => h('div', { class: 'mm-group' }, h('div', { class: 'mm-group-title' }, g.title), h('div', { class: 'mm-tiles' }, ...g.ids.map(tile))))),
    );
  }
  const note = h('p', { class: 'ap-note' });
  const stamp = h('span', { class: 'muted small' });
  const ai = insightButton(() => {
    if (!loaded.size) return null;
    const readings = [...loaded.values()].map((s) => ({ name: s.name, group: s.group, unit: s.unit, date: s.date, value: s.value, previous: s.previous, monthAgo: s.monthAgo, yearAgo: s.yearAgo }));
    return { topic: 'macro', symbol: '', title: 'AI read: the economy', data: { readings, yieldCurve: curve } };
  });
  const frame = pageFrame('Macro', 'The economy the way macro desks read it: the regime, the Fed, liquidity, the curve and every key series. From FRED and the US Treasury.', [
    stamp,
    ai.button,
    h('button', { class: 'btn', title: 'Load fresh data now', onclick: () => (clearEngineCache('macro.'), load()) }, 'Refresh'),
  ]);

  // Tabs: the US dashboard (FRED) and World (macroWorld.ts). The choice is remembered in this browser.
  type Tab = 'us' | 'world';
  const world = createWorldTab();
  world.el.hidden = true;
  let tab: Tab = /world/.test(location.hash) ? 'world' : (() => {
    try {
      return localStorage.getItem('tp-macro-tab') === 'world' ? 'world' : 'us';
    } catch {
      return 'us';
    }
  })();
  const tabButtons = (['us', 'world'] as Tab[]).map((t) =>
    h('button', { class: 'tab', role: 'tab', 'data-tab': t, onclick: () => setTab(t) }, t === 'us' ? 'United States' : 'World'),
  );
  const tabBar = h('div', { class: 'tabs macro-tabs', role: 'tablist', 'aria-label': 'Macro views' }, ...tabButtons);
  frame.el.insertBefore(tabBar, frame.body);
  frame.el.append(world.el);
  function setTab(t: Tab) {
    tab = t;
    try {
      localStorage.setItem('tp-macro-tab', t);
    } catch {
      /* not saved */
    }
    tabButtons.forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === t);
      b.setAttribute('aria-selected', String(b.dataset.tab === t));
    });
    frame.body.hidden = t !== 'us';
    world.el.hidden = t !== 'world';
    // The header's range, AI and Refresh buttons belong to the US dashboard; World has its own.
    const controls = frame.el.querySelector<HTMLElement>('.ap-header .ap-controls');
    if (controls) controls.hidden = t !== 'us';
    if (t === 'world') world.start();
    else if (!started) {
      started = true;
      load();
    }
  }

  /** Full history in a chart window: daily data for rates and levels, the transformed series for yearly changes. */
  function openSeries(id: string) {
    const s = loaded.get(id);
    if (!s) return;
    const transformed = /yearly|annualised|added/i.test(s.name);
    if (!transformed) return openFredWindow(id, s.name, s.unit === 'K' ? '' : s.unit);
    openChartWindow({ title: s.name, subtitle: `FRED ${id} · latest ${s.date}`, lines: [{ name: s.name, color: '#2962ff', data: s.data }], format: (v) => fmt(v, s.unit), changeAs: s.unit === '%' || s.unit === 'K' ? 'points' : 'percent' });
  }

  function fillRow(s: Series) {
    const tr = rows.get(s.id);
    if (!tr) return;
    tr.classList.remove('loading');
    tr.replaceChildren(
      h('th', { scope: 'row' }, s.name),
      h('td', { class: 'num mm-val' }, fmt(s.value, s.unit)),
      h('td', { class: 'num' }, change(s, s.monthAgo, '') ?? '—'),
      h('td', { class: 'num' }, change(s, s.yearAgo, '') ?? '—'),
      h('td', { class: 'mm-trend' }, spark(s.data)),
      h('td', {}, rankCell(percentileNow(s.data))),
      h('td', { class: 'muted small mm-date' }, s.date),
    );
  }

  function failRow(id: string, err: unknown) {
    const tr = rows.get(id);
    const name = catalog.find((c) => c.id === id)?.name ?? id;
    tr?.replaceChildren(h('th', { scope: 'row' }, name), h('td', { colspan: 6, class: 'muted small' }, (err as Error).message || 'Unavailable', ' ', h('button', { class: 'btn small', onclick: (e: Event) => (e.stopPropagation(), loadSeries(id)) }, 'Retry')));
  }

  async function loadSeries(id: string) {
    try {
      const s = await engineRequest<Series>('macro.series', { series: id }, 45000);
      loaded.set(id, s);
      fillRow(s);
      return true;
    } catch (err) {
      failRow(id, err);
      return false;
    }
  }

  /** Today's read: the regime quadrant, the votes behind it and the six key numbers. */
  function renderRead() {
    const r = regime(...regimeInputs((id) => loaded.get(id)));
    const pos = (v: number) => `${(50 + Math.max(-1, Math.min(1, v)) * 42).toFixed(1)}%`;
    const arrow = (d: string) => (d === 'rising' ? '↑ speeding up' : d === 'falling' ? '↓ slowing' : '→ steady');
    const key = KEY.map((id) => loaded.get(id)).filter((s): s is Series => !!s);
    readPanel.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, 'Today’s read', infoTip('macroRegime')), h('span', { class: 'muted small' }, 'Growth and inflation, each speeding up or slowing over the last 3 months')),
      h(
        'div',
        { class: 'mm-read-grid' },
        h(
          'div',
          { class: 'mm-quad', role: 'img', 'aria-label': `Regime: ${r.label}` },
          h('span', { class: 'q tl' }, 'Stagflation'),
          h('span', { class: 'q tr' }, 'Reflation'),
          h('span', { class: 'q bl' }, 'Slowdown'),
          h('span', { class: 'q br' }, 'Goldilocks'),
          h('span', { class: 'axis x' }, 'Growth →'),
          h('span', { class: 'axis y' }, 'Inflation →'),
          h('i', { class: 'dot', style: `left:${pos(r.growthScore)};bottom:${pos(r.inflationScore)}` }),
        ),
        h(
          'div',
          { class: 'mm-read-text' },
          h('div', { class: 'mm-regime' }, r.label),
          h('p', { class: 'small' }, r.meaning),
          h('p', { class: 'small' }, h('b', {}, 'Growth '), arrow(r.growth), ' · ', h('b', {}, 'Inflation '), arrow(r.inflation)),
          h(
            'details',
            { class: 'mm-votes' },
            h('summary', { class: 'small muted' }, `What it’s based on (${r.votes.length} readings)`),
            h('ul', {}, ...r.votes.map((v) => h('li', { class: 'small' }, `${v.name}: ${v.direction === 'rising' ? 'up' : v.direction === 'falling' ? 'down' : 'flat'}`))),
            h('p', { class: 'small muted' }, 'A framing, not a forecast: regimes change, and the "historically" notes are tendencies.'),
          ),
        ),
      ),
      h(
        'div',
        { class: 'mm-keys' },
        ...key.map((s) =>
          activatable(
            h(
              'div',
              { class: 'mm-key clickable-card', title: 'Click for the full history', onclick: () => openSeries(s.id) },
              h('span', { class: 'mm-key-label' }, SHORT[s.id] ?? s.name),
              h('span', { class: 'mm-key-value' }, fmt(s.value, s.unit)),
              h('span', { class: 'small' }, change(s, s.monthAgo, '1m') ?? ''),
            ),
          ),
        ),
      ),
    );
  }

  function skeleton() {
    rows.clear();
    const groups = [...new Set(catalog.map((c) => c.group))];
    const head = h('thead', {}, h('tr', {}, ...['Series', 'Latest', '1 month', '1 year', '2-year trend', 'Vs history since 2006', 'As of'].map((c, i) => h('th', { scope: 'col', class: i >= 1 && i <= 3 ? 'num' : '' }, c))));
    const bodies = groups.map((g) =>
      h(
        'tbody',
        {},
        h('tr', { class: 'mm-group' }, h('th', { colspan: 7, scope: 'colgroup' }, g)),
        ...catalog
          .filter((c) => c.group === g)
          .map((c) => {
            const tr = h('tr', { class: 'loading clickable-row', title: 'Click for the full history', onclick: () => openSeries(c.id) }, h('th', { scope: 'row' }, c.name), h('td', { colspan: 6 }, h('span', { class: 'skeleton', style: 'display:block;height:14px;width:60%' })));
            activatable(tr);
            rows.set(c.id, tr);
            return tr;
          }),
      ),
    );
    frame.body.replaceChildren(
      ai.panel,
      readPanel,
      // the Sahm rule, real time, with its record against NBER recession dates
      sahmPanel(),
      // this quarter's growth nowcast and financial conditions, side by side
      rightNowPanels(),
      boardPanel,
      h('div', { class: 'xe-grid' }, fedOddsPanel(), netLiquidityPanel()),
      curvePanel,
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Macro monitor'), h('span', { class: 'muted small' }, 'Green/red: whether the change is usually good or bad news for the economy. Click a row for its full history.')),
        h('div', { class: 'ar-scroll' }, h('table', { class: 'mm-table' }, head, ...bodies)),
      ),
      note,
      h('p', { class: 'ap-note' }, 'Sources: Federal Reserve Bank of St. Louis (FRED), treasury.gov, Schwab (fed funds futures).'),
    );
  }

  async function loadCurve() {
    try {
      const reply = await engineRequest<{ curve: CurvePoint[] }>('macro.curve', {}, 45000);
      ({ curve } = reply);
      const ten = curve.find((p) => p.label === '10Y')?.now;
      const two = curve.find((p) => p.label === '2Y')?.now;
      const spread = ten != null && two != null ? ten - two : 0;
      curvePanel.replaceChildren(
        h(
          'div',
          { class: 'panel-head' },
          h('h3', {}, 'Treasury yield curve'),
          asOfStamp('fred', { reply, source: 'FRED / treasury.gov' }).el,
          h('span', { class: 'muted small' }, spread < 0 ? 'Inverted: short-term rates are above long-term ones, which has often come before recessions.' : 'Normal shape: longer loans pay more than short ones.'),
        ),
        yieldCurve(curve),
        curveTable(curve),
      );
    } catch (err) {
      curvePanel.replaceChildren(h('div', { class: 'panel-head' }, h('h3', {}, 'Treasury yield curve')), h('div', { class: 'macro-error' }, (err as Error).message, h('button', { class: 'btn small', onclick: loadCurve }, 'Retry')));
    }
  }

  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    try {
      if (!catalog.length) {
        frame.loading('Connecting…');
        catalog = (await engineRequest<{ series: CatalogEntry[] }>('macro.catalog', {}, 15000)).series;
        skeleton();
      }
      note.textContent = '';
      const failures: string[] = [];
      await Promise.all([
        loadCurve(),
        pool(catalog, 6, async (c) => {
          if (!(await loadSeries(c.id))) failures.push(c.name);
        }),
      ]);
      renderRead();
      renderBoard();
      stamp.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      if (failures.length) note.textContent = `Couldn't load ${failures.length} series. If this keeps happening, add a free FRED API key in Settings (gear icon) for a faster, more reliable connection.`;
    } catch (err) {
      frame.error(err);
    } finally {
      loading = false;
    }
  }

  let started = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    el: frame.el,
    start() {
      setTab(tab);
      // Economic data changes at most daily; check again every 30 minutes while the page is open.
      timer ??= setInterval(load, 30 * 60 * 1000);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
