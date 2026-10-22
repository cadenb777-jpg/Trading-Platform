/** Small reusable charts for analysis pages: date line charts (Lightweight Charts) and bar lists. */
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { THEME } from '../chart/ChartView';
import { h } from './dom';

export interface LineSpec {
  name: string;
  color: string;
  /** Points with dates as 'YYYY-MM-DD' (or unix seconds). */
  data: { time: string | number; value: number }[];
  width?: 1 | 2 | 3;
}

/** A line chart over dates, sized to its container. Returns a function to replace the lines. */
export function createLineChart(container: HTMLElement, opts: { percent?: boolean; height?: number; format?: (v: number) => string } = {}) {
  container.classList.add('line-chart');
  if (opts.height) container.style.height = `${opts.height}px`;
  const chart: IChartApi = createChart(container, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: THEME.text, fontFamily: "'Inter', sans-serif", fontSize: 12, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: { borderColor: THEME.border },
    handleScroll: false,
    handleScale: false,
    localization: { priceFormatter: opts.format ?? ((v: number) => (opts.percent ? `${v.toFixed(1)}%` : compact(v))) },
  });
  let series: ISeriesApi<'Line'>[] = [];
  const legend = h('div', { class: 'line-legend' });
  container.append(legend);
  return {
    chart,
    set(lines: LineSpec[]) {
      for (const s of series) chart.removeSeries(s);
      series = lines.map((l) => {
        const s = chart.addSeries(LineSeries, {
          color: l.color,
          lineWidth: l.width ?? 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        s.setData(l.data.filter((p) => Number.isFinite(p.value)) as never);
        return s;
      });
      legend.replaceChildren(...lines.map((l) => h('span', {}, h('i', { style: `background:${l.color}` }), l.name)));
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
export function statCards(items: { label: string; value: string; hint?: string; tone?: 'up' | 'down' | '' }[]) {
  return h(
    'div',
    { class: 'stat-cards' },
    ...items.map((i) => h('div', { class: 'stat-card', title: i.hint ?? '' }, h('span', { class: 'muted small' }, i.label), h('b', { class: i.tone ?? '' }, i.value), i.hint ? h('span', { class: 'muted small stat-hint' }, i.hint) : null)),
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

export const pct = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);

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
