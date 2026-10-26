/** Macro: the economy at a glance (rates, inflation, jobs, growth, markets) and the Treasury yield curve. */
import { insightButton } from '../ai/insight';
import { clearEngineCache, engineRequest } from '../data/schwab';
import { createLineChart, pageFrame } from '../ui/charts';
import { h } from '../ui/dom';
import { openChartWindow } from '../ui/chartWindow';
import { openFredWindow } from '../ui/fredWindow';
import { yieldCurve, type CurvePoint } from '../ui/yieldCurve';
import { asOfStamp } from '../ui/dataHealth';

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
  data: { time: string; value: number }[];
}


type Range = '1y' | '5y' | 'max';
const RANGE_DAYS: Record<Range, number> = { '1y': 366, '5y': 5 * 366, max: 1e6 };

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

export function createMacroPage() {
  let range: Range = '5y';
  const loaded = new Map<string, Series>();
  const cards = new Map<string, { el: HTMLElement; chart: ReturnType<typeof createLineChart> | null; box: HTMLElement }>();
  let curve: CurvePoint[] = [];
  let catalog: CatalogEntry[] = [];
  const curvePanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Treasury yield curve')), h('div', { class: 'skeleton', style: 'height:260px' }));
  const note = h('p', { class: 'ap-note' });
  const stamp = h('span', { class: 'muted small' });
  const ai = insightButton(() => {
    if (!loaded.size) return null;
    const readings = [...loaded.values()].map((s) => ({ name: s.name, group: s.group, unit: s.unit, date: s.date, value: s.value, previous: s.previous, monthAgo: s.monthAgo, yearAgo: s.yearAgo }));
    return { topic: 'macro', symbol: '', title: 'AI read: the economy', data: { readings, yieldCurve: curve } };
  }, 'AI summary');
  const rangeButtons = (['1y', '5y', 'max'] as Range[]).map((r) => h('button', { 'data-range': r, onclick: () => setRange(r) }, r === 'max' ? 'Since 2006' : r === '1y' ? '1 year' : '5 years'));
  const frame = pageFrame('Macro', 'The economy at a glance, from the St. Louis Fed (FRED) and the US Treasury. Updates automatically.', [
    stamp,
    ai.button,
    h('div', { class: 'segmented' }, ...rangeButtons),
    h('button', { class: 'btn', title: 'Load fresh data now', onclick: () => (clearEngineCache('macro.'), load()) }, 'Refresh'),
  ]);

  function setRange(r: Range) {
    range = r;
    rangeButtons.forEach((b) => b.classList.toggle('active', b.dataset.range === range));
    for (const id of loaded.keys()) drawChart(id);
  }

  const cutoff = () => new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10);

  function drawChart(id: string) {
    const s = loaded.get(id);
    const card = cards.get(id);
    if (!s || !card) return;
    if (!card.chart) {
      card.box.classList.remove('skeleton');
      card.box.replaceChildren();
      card.chart = createLineChart(card.box, { height: 130, format: (v) => fmt(v, s.unit === 'K' ? '' : s.unit), title: s.name, expand: false });
      card.chart.chart.applyOptions({ rightPriceScale: { visible: false }, timeScale: { visible: false }, crosshair: { horzLine: { visible: false } } });
    }
    card.chart.set([{ name: s.name, color: '#2962ff', width: 2, data: s.data.filter((p) => p.time >= cutoff()) }]);
  }

  function fillCard(s: Series) {
    const card = cards.get(s.id);
    if (!card) return;
    card.el.classList.remove('loading');
    card.el.querySelector('.macro-value')!.replaceChildren(h('b', {}, fmt(s.value, s.unit)), h('span', { class: 'muted small asof', title: 'The date of the latest reading FRED has published' }, `${s.date} · FRED`));
    card.el.querySelector('.macro-changes')!.replaceChildren(...[change(s, s.monthAgo, '1m'), change(s, s.yearAgo, '1y')].filter((n): n is HTMLSpanElement => !!n));
    drawChart(s.id);
  }

  /** Full history in a chart window: daily data for rates and levels, the transformed series for yearly changes. */
  function openSeries(id: string) {
    const s = loaded.get(id);
    if (!s) return;
    const transformed = /yearly|annualised|added/i.test(s.name);
    if (!transformed) return openFredWindow(id, s.name, s.unit === 'K' ? '' : s.unit);
    openChartWindow({ title: s.name, subtitle: `FRED ${id} · latest ${s.date}`, lines: [{ name: s.name, color: '#2962ff', data: s.data }], format: (v) => fmt(v, s.unit), changeAs: s.unit === '%' || s.unit === 'K' ? 'points' : 'percent' });
  }

  function failCard(id: string, err: unknown) {
    const card = cards.get(id);
    if (!card) return;
    card.el.classList.remove('loading');
    card.box.classList.remove('skeleton');
    card.chart = null;
    card.box.replaceChildren(
      h('div', { class: 'macro-error' }, h('span', {}, (err as Error).message || 'Unavailable'), h('button', { class: 'btn small', onclick: () => loadSeries(id) }, 'Retry')),
    );
  }

  async function loadSeries(id: string) {
    try {
      const s = await engineRequest<Series>('macro.series', { series: id }, 45000);
      loaded.set(id, s);
      fillCard(s);
      return true;
    } catch (err) {
      failCard(id, err);
      return false;
    }
  }

  function skeleton() {
    cards.clear();
    const groups = [...new Set(catalog.map((c) => c.group))];
    frame.body.replaceChildren(
      ai.panel,
      curvePanel,
      ...groups.map((g) =>
        h(
          'section',
          {},
          h('h2', { class: 'group-title' }, g),
          h(
            'div',
            { class: 'macro-grid' },
            ...catalog
              .filter((c) => c.group === g)
              .map((c) => {
                const box = h('div', { class: 'skeleton', style: 'height:130px' });
                const el = h(
                  'div',
                  { class: 'panel macro-card loading clickable-card', title: 'Click for the full history: zoom, ranges, stats', onclick: () => openSeries(c.id) },
                  h('div', { class: 'muted small' }, c.name),
                  h('div', { class: 'macro-value' }, h('span', { class: 'skeleton', style: 'width:90px;height:28px' })),
                  h('div', { class: 'macro-changes small' }),
                  box,
                );
                cards.set(c.id, { el, box, chart: null });
                return el;
              }),
          ),
        ),
      ),
      note,
      h('p', { class: 'ap-note' }, 'Sources: Federal Reserve Bank of St. Louis (FRED) and treasury.gov. Green/red shows whether a change is usually good or bad news for the economy.'),
    );
  }

  async function loadCurve() {
    try {
      ({ curve } = await engineRequest<{ curve: CurvePoint[] }>('macro.curve', {}, 45000));
      const ten = curve.find((p) => p.label === '10Y')?.now;
      const two = curve.find((p) => p.label === '2Y')?.now;
      const spread = ten != null && two != null ? ten - two : 0;
      curvePanel.replaceChildren(
        h(
          'div',
          { class: 'panel-head' },
          h('h3', {}, 'Treasury yield curve'),
          asOfStamp('fred', { requestType: 'macro.curve', source: 'FRED / treasury.gov' }).el,
          h('span', { class: 'muted small' }, spread < 0 ? 'Inverted: short-term rates are above long-term ones, which has often come before recessions.' : 'Normal shape: longer loans pay more than short ones.'),
        ),
        yieldCurve(curve),
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
      rangeButtons.forEach((b) => b.classList.toggle('active', b.dataset.range === range));
      if (!started) {
        started = true;
        load();
      }
      // Economic data changes at most daily; check again every 30 minutes while the page is open.
      timer ??= setInterval(load, 30 * 60 * 1000);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
