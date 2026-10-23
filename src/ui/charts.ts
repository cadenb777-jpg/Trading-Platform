/** Small reusable charts for analysis pages: date line charts (Lightweight Charts) and bar lists. */
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { THEME } from '../chart/ChartView';
import { attachTooltip, isDailySeries, openChartWindow, toUnix } from './chartWindow';
import { h } from './dom';

export interface LineSpec {
  name: string;
  color: string;
  /** Points with dates as 'YYYY-MM-DD' (or unix seconds). */
  data: { time: string | number; value: number }[];
  width?: 1 | 2 | 3;
}

/**
 * A line chart over dates, sized to its container, with a hover tooltip (date + values) and an expand button that
 * opens the same lines in a floating window with zoom, ranges and stats. Returns a function to replace the lines.
 */
export function createLineChart(container: HTMLElement, opts: { percent?: boolean; height?: number; format?: (v: number) => string; title?: string; expand?: boolean } = {}) {
  container.classList.add('line-chart');
  if (opts.height) container.style.height = `${opts.height}px`;
  const format = opts.format ?? ((v: number) => (opts.percent ? `${v.toFixed(1)}%` : compact(v)));
  const chart: IChartApi = createChart(container, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: THEME.text, fontFamily: "'Inter', sans-serif", fontSize: 12, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: { borderColor: THEME.border },
    handleScroll: false,
    handleScale: false,
    localization: { priceFormatter: format },
  });
  let series: { series: ISeriesApi<'Line'>; name: string; color: string }[] = [];
  let current: LineSpec[] = [];
  const legend = h('div', { class: 'line-legend' });
  container.append(legend);
  attachTooltip(chart, container, () => series, format, () => isDailySeries((current[0]?.data ?? []).map((p) => toUnix(p.time as never))));
  if (opts.expand !== false) {
    container.append(
      h(
        'button',
        {
          class: 'chart-expand',
          title: 'Open in a window: zoom, ranges, stats',
          'aria-label': 'Expand chart',
          onclick: (e: Event) => {
            e.stopPropagation();
            openChartWindow({ title: opts.title || current.map((l) => l.name).filter(Boolean).join(' vs ') || 'Chart', lines: current, format });
          },
        },
        '⤢',
      ),
    );
  }
  return {
    chart,
    set(lines: LineSpec[]) {
      current = lines;
      for (const s of series) chart.removeSeries(s.series);
      series = lines.map((l) => {
        const s = chart.addSeries(LineSeries, {
          color: l.color,
          lineWidth: l.width ?? 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        s.setData(l.data.filter((p) => Number.isFinite(p.value)) as never);
        return { series: s, name: l.name, color: l.color };
      });
      legend.replaceChildren(...lines.filter((l) => l.name).map((l) => h('span', {}, h('i', { style: `background:${l.color}` }), l.name)));
      chart.timeScale().fitContent();
    },
  };
}

/** Horizontal bars for a list of labelled values (positive and negative), e.g. gamma by strike. */
export function barList(rows: { label: string; value: number; highlight?: string }[], format: (v: number) => string) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return h(
    'div',
    { class: 'bar-list' },
    ...rows.map((r) =>
      h(
        'div',
        { class: `bar-row${r.highlight ? ` ${r.highlight}` : ''}` },
        h('span', { class: 'bar-label' }, r.label),
        h(
          'span',
          { class: 'bar-track' },
          h('span', { class: `bar-fill ${r.value >= 0 ? 'pos' : 'neg'}`, style: `width:${(Math.abs(r.value) / max) * 50}%;${r.value >= 0 ? 'left:50%' : `right:50%`}` }),
        ),
        h('span', { class: 'bar-value' }, format(r.value)),
      ),
    ),
  );
}

/** A grid of headline numbers ("stat cards"). */
export function statCards(items: { label: string; value: string; hint?: string; tone?: 'up' | 'down' | ''; node?: Node }[]) {
  return h(
    'div',
    { class: 'stat-cards' },
    ...items.map((i) =>
      h(
        'div',
        { class: 'stat-card', title: i.hint ?? '' },
        h('span', { class: 'stat-label' }, i.label),
        i.node ?? h('b', { class: `stat-value ${i.tone ?? ''}` }, i.value),
        i.hint ? h('span', { class: 'muted small stat-hint' }, i.hint) : null,
      ),
    ),
  );
}

/** A low-to-high range with a marker for the current value (e.g. a 52-week range). */
export function rangeBar(low: number, high: number, current: number | null | undefined, format: (v: number) => string) {
  const pos = current != null && high > low ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100)) : null;
  return h(
    'div',
    { class: 'range-bar' },
    h('div', { class: 'range-track' }, pos != null ? h('span', { class: 'range-dot', style: `left:${pos}%` }) : null),
    h('div', { class: 'range-labels' }, h('span', {}, format(low)), pos != null ? h('span', { class: 'range-pos' }, `${pos.toFixed(0)}%`) : null, h('span', {}, format(high))),
  );
}

export const money = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

export const pct = (v: number | null | undefined, digits = 2) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const text = (v * 100).toFixed(digits);
  // A value that rounds to zero is shown as plain 0 (never "-0.0%" or "+0.0%").
  if (Number(text) === 0) return `${(0).toFixed(digits)}%`;
  return `${v > 0 ? '+' : ''}${text}%`;
};

/** Like pct but without a + sign, for things that are never negative (volatility, weights). */
export const pctU = (v: number | null | undefined, digits = 2) => pct(v, digits).replace('+', '');

export const compact = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(abs < 10 ? 2 : 0);
};

/** Shared frame for analysis pages: title, controls, and a body that shows loading/errors. */
export function pageFrame(title: string, subtitle: string, controls: Node[]) {
  const body = h('div', { class: 'ap-body' });
  const el = h(
    'div',
    { class: 'analysis-page' },
    h('header', { class: 'ap-header' }, h('div', {}, h('h1', {}, title), h('p', { class: 'muted' }, subtitle)), h('div', { class: 'ap-controls' }, ...controls)),
    body,
  );
  return {
    el,
    body,
    loading(text = 'Loading…') {
      body.replaceChildren(h('div', { class: 'muted pad' }, text));
    },
    error(err: unknown) {
      body.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message || String(err)));
    },
  };
}

type Cell = Node | string | { v: Node | string; cls?: string };

/** A scrolling table. Cells can be text, elements, or { v, cls } to add a class (e.g. 'up', 'label'). */
export function dataTable(headers: string[], rows: Cell[][], rowClass?: (i: number) => string) {
  const cell = (c: Cell, tag: 'td' | 'th' = 'td') =>
    typeof c === 'object' && c !== null && 'v' in c ? h(tag, { class: c.cls ?? '' }, c.v) : h(tag, {}, c as Node | string);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data-table' },
      h('thead', {}, h('tr', {}, ...headers.map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows.map((r, i) => h('tr', { class: rowClass?.(i) ?? '' }, ...r.map((c) => cell(c))))),
    ),
  );
}

/** A labelled number input. Percent inputs show 8 for 0.08. */
export function numberField(label: string, value: number, onChange: (v: number) => void, opts: { percent?: boolean; step?: number; hint?: string } = {}) {
  const shown = opts.percent ? +(value * 100).toFixed(2) : +value.toFixed(Math.abs(value) >= 1000 ? 0 : 4);
  const input = h('input', { class: 'input', type: 'number', step: opts.step ?? (opts.percent ? 0.1 : 1), value: Number.isFinite(shown) ? shown : '' });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(opts.percent ? v / 100 : v);
  });
  return h('label', { class: 'field', title: opts.hint ?? '' }, h('span', { class: 'muted small' }, label), h('span', { class: 'field-input' }, input, opts.percent ? h('span', { class: 'muted' }, '%') : null));
}

/** A small SVG scatter/line chart with % axes, e.g. an efficient frontier (risk on x, return on y). */
export function scatterChart(
  layers: { name: string; color: string; points: { x: number; y: number; label?: string }[]; line?: boolean; size?: number }[],
  axes: { x: string; y: string },
) {
  const W = 500;
  const H = 300;
  const pad = { l: 52, r: 20, t: 14, b: 40 };
  const all = layers.flatMap((l) => l.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const span = (lo: number, hi: number) => (hi - lo || Math.abs(hi) || 0.01) * 0.08;
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(...xs) + span(Math.min(...xs), Math.max(...xs));
  const y0 = Math.min(...ys) - span(Math.min(...ys), Math.max(...ys));
  const y1 = Math.max(...ys) + span(Math.min(...ys), Math.max(...ys));
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'curve-svg');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
    return el;
  };
  const ticks = (lo: number, hi: number) => {
    const step = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5].find((s) => (hi - lo) / s <= 7) ?? 1;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return out;
  };
  for (const v of ticks(y0, y1)) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'curve-grid' });
    add('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'curve-label' }, `${(v * 100).toFixed(0)}%`);
  }
  for (const v of ticks(x0, x1)) add('text', { x: X(v), y: H - 22, 'text-anchor': 'middle', class: 'curve-label' }, `${(v * 100).toFixed(0)}%`);
  add('text', { x: (W + pad.l) / 2, y: H - 4, 'text-anchor': 'middle', class: 'curve-label' }, axes.x);
  add('text', { x: 12, y: (H - pad.b) / 2, 'text-anchor': 'middle', class: 'curve-label', transform: `rotate(-90 12 ${(H - pad.b) / 2})` }, axes.y);
  for (const l of layers) {
    if (l.line && l.points.length > 1) add('polyline', { points: l.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' '), fill: 'none', stroke: l.color, 'stroke-width': 2 });
    else
      for (const p of l.points) {
        add('circle', { cx: X(p.x), cy: Y(p.y), r: l.size ?? 5, fill: l.color });
        if (p.label) add('text', { x: X(p.x) + 8, y: Y(p.y) + 4, class: 'curve-label strong' }, p.label);
      }
  }
  const legend = h('div', { class: 'line-legend static' }, ...layers.map((l) => h('span', {}, h('i', { style: `background:${l.color}` }), l.name)));
  return h('div', { class: 'curve-wrap' }, legend, svg);
}
