/** Macro: the economy at a glance (rates, inflation, jobs, growth, markets) and the Treasury yield curve. */
import { engineRequest } from '../data/schwab';
import { createLineChart, pageFrame } from '../ui/charts';
import { h } from '../ui/dom';

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

interface CurvePoint {
  label: string;
  now: number;
  monthAgo: number | null;
  yearAgo: number | null;
  date: string;
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
  const text = s.unit === '%' ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} pts` : `${diff >= 0 ? '+' : ''}${then ? ((diff / Math.abs(then)) * 100).toFixed(1) : '0'}%`;
  const tiny = s.unit === '%' ? Math.abs(diff) < 0.005 : Math.abs(diff) < Math.abs(then) * 0.0005;
  const tone = s.upGood == null || tiny ? '' : diff > 0 === s.upGood ? 'up' : 'down';
  return h('span', { class: tone }, `${text} ${label}`);
}

/** The yield curve as a small SVG line chart: one line per date. */
function yieldCurve(points: CurvePoint[]) {
  const W = 640;
  const H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 30 };
  const lines: { key: 'now' | 'monthAgo' | 'yearAgo'; name: string; color: string; dash?: string }[] = [
    { key: 'now', name: 'Today', color: '#2962ff' },
    { key: 'monthAgo', name: '1 month ago', color: '#9598a1', dash: '4 4' },
    { key: 'yearAgo', name: '1 year ago', color: '#ff9800', dash: '2 4' },
  ];
  const values = points.flatMap((p) => lines.map((l) => p[l.key]).filter((v): v is number => v != null));
  const lo = Math.floor(Math.min(...values) * 2) / 2 - 0.25;
  const hi = Math.ceil(Math.max(...values) * 2) / 2 + 0.25;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + ((hi - v) * (H - pad.t - pad.b)) / (hi - lo);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'curve-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  const step = [0.25, 0.5, 1, 2, 5].find((st) => (hi - lo) / st <= 8) ?? 10;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'curve-grid' });
    add('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'curve-label' }, `${v.toFixed(1)}%`);
  }
  points.forEach((p, i) => add('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'curve-label' }, p.label));
  for (const l of [...lines].reverse()) {
    const pts = points.map((p, i) => (p[l.key] == null ? null : `${x(i)},${y(p[l.key]!)}`)).filter(Boolean);
    add('polyline', { points: pts.join(' '), fill: 'none', stroke: l.color, 'stroke-width': l.key === 'now' ? 2.5 : 1.5, 'stroke-dasharray': l.dash ?? '' });
    if (l.key === 'now') points.forEach((p, i) => add('circle', { cx: x(i), cy: y(p.now), r: 3.5, fill: l.color }));
  }
  const legend = h('div', { class: 'line-legend static' }, ...lines.map((l) => h('span', {}, h('i', { style: `background:${l.color}` }), l.name)));
  return h('div', { class: 'curve-wrap' }, legend, svg);
}

export function createMacroPage() {
  let range: Range = '5y';
  let series: Series[] = [];
  let curve: CurvePoint[] = [];
  let failed: string[] = [];
  const rangeButtons = (['1y', '5y', 'max'] as Range[]).map((r) => h('button', { 'data-range': r, onclick: () => setRange(r) }, r === 'max' ? 'Since 2006' : r.replace('y', ' years').replace('1 years', '1 year')));
  const frame = pageFrame('Macro', 'The economy at a glance, from the St. Louis Fed (FRED). Updated as new data is released.', [
    h('div', { class: 'segmented' }, ...rangeButtons),
    h('button', { class: 'btn', onclick: () => load() }, 'Refresh'),
  ]);

  function setRange(r: Range) {
    range = r;
    render();
  }

  async function load() {
    frame.loading('Loading economic data…');
    try {
      const d = await engineRequest<{ series: Series[]; curve: CurvePoint[]; failed: string[] }>('macro.dashboard', {}, 90000);
      ({ series, curve, failed } = d);
      render();
    } catch (err) {
      frame.error(err);
    }
  }

  function render() {
    rangeButtons.forEach((b) => b.classList.toggle('active', b.dataset.range === range));
    if (!series.length) return;
    const cutoff = new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10);
    const groups = [...new Set(series.map((s) => s.group))];
    const charts: [HTMLElement, Series][] = [];
    const spread = series.find((s) => s.id === 'T10Y2Y');
    const nodes: (Node | null)[] = [
      curve.length
        ? h(
            'section',
            { class: 'panel' },
            h(
              'div',
              { class: 'panel-head' },
              h('h3', {}, 'Treasury yield curve'),
              h('span', { class: 'muted small' }, spread && spread.value < 0 ? 'Inverted: short-term rates above long-term ones, which has often come before recessions.' : 'Normal shape: longer loans pay more than short ones.'),
            ),
            yieldCurve(curve),
          )
        : null,
      ...groups.map((g) =>
        h(
          'section',
          {},
          h('h2', { class: 'group-title' }, g),
          h(
            'div',
            { class: 'macro-grid' },
            ...series
              .filter((s) => s.group === g)
              .map((s) => {
                const box = h('div', {});
                charts.push([box, s]);
                return h(
                  'div',
                  { class: 'panel macro-card' },
                  h('div', { class: 'muted small' }, s.name),
                  h('div', { class: 'macro-value' }, h('b', {}, fmt(s.value, s.unit)), h('span', { class: 'muted small' }, s.date)),
                  h('div', { class: 'macro-changes small' }, change(s, s.monthAgo, '1m'), change(s, s.yearAgo, '1y')),
                  box,
                );
              }),
          ),
        ),
      ),
      failed.length ? h('p', { class: 'ap-note' }, `Couldn't load: ${failed.join(', ')}.`) : null,
      h('p', { class: 'ap-note' }, 'Source: Federal Reserve Bank of St. Louis (FRED). Green/red shows whether a change is usually good or bad news for the economy.'),
    ];
    frame.body.replaceChildren(...nodes.filter((n): n is Node => n !== null));
    for (const [box, s] of charts) {
      const chart = createLineChart(box, { height: 130, format: (v) => fmt(v, s.unit === 'K' ? '' : s.unit) });
      chart.chart.applyOptions({ rightPriceScale: { visible: false }, timeScale: { visible: false }, crosshair: { horzLine: { visible: false } } });
      chart.set([{ name: '', color: '#2962ff', width: 2, data: s.data.filter((p) => p.time >= cutoff) }]);
    }
  }

  let started = false;
  return {
    el: frame.el,
    start() {
      rangeButtons.forEach((b) => b.classList.toggle('active', b.dataset.range === range));
      if (started) return;
      started = true;
      load();
    },
  };
}
