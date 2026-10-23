/**
 * Indicators on any line chart (bond yields, FRED series, fund NAVs, board history...): the chart windows get an
 * "Indicators" menu with the studies that make sense on a single series of values (no highs, lows or volume):
 * moving averages, bands, RSI, MACD, z-score, rate of change... Each one is drawn on the window's first line,
 * over it (overlays) or in its own pane below (oscillators), and can be edited or removed.
 */
import { HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { defaultParams, getIndicator, indicatorLabel } from '../indicators/library';
import type { IndicatorDef, IndicatorParams } from '../indicators/types';
import type { Bar } from '../types';
import { h } from './dom';

/** Studies that only need one value per date. */
export const LINE_INDICATORS = ['sma', 'ema', 'wma', 'hma', 'dema', 'tema', 'alma', 'kama', 'linreg', 'bb', 'envelope', 'zchannel', 'rsi', 'macd', 'stochrsi', 'roc', 'mom', 'trix', 'stdev', 'bbpb', 'bbw', 'zscore'];

export function lineIndicators(): IndicatorDef[] {
  return LINE_INDICATORS.map((id) => getIndicator(id)).filter((d): d is IndicatorDef => !!d);
}

type Point = { time: string | number; value: number };

const toUnix = (t: string | number) => (typeof t === 'number' ? t : Date.parse(`${t}T00:00:00Z`) / 1000);

/** A line as bars (open = high = low = close = the value), so the chart page's indicator maths can run on it. */
export function barsFromLine(data: Point[]): Bar[] {
  return data.map((p) => ({ time: toUnix(p.time), open: p.value, high: p.value, low: p.value, close: p.value, volume: 0 }));
}

/** An indicator's plots on a line, as chart points in the line's own time format (warm-up values left out). */
export function computeOnLine(def: IndicatorDef, params: IndicatorParams, data: Point[]): Record<string, Point[]> {
  const out = def.compute(barsFromLine(data), params);
  return Object.fromEntries(
    def.plots.map((plot) => [plot.key, (out[plot.key] ?? []).map((v, i) => ({ time: data[i].time, value: v })).filter((p) => Number.isFinite(p.value))]),
  );
}

const PALETTE = ['#ff9800', '#e91e63', '#26c6da', '#8bc34a', '#ab47bc', '#ffd54f'];

interface Study {
  color: string;
  def: IndicatorDef;
  params: IndicatorParams;
  series: ISeriesApi<'Line' | 'Histogram'>[];
  /** Pane index at the last draw (0 = with the data line); re-read from the chart before each redraw. */
  pane: number;
}

/**
 * Adds the indicator menu to a chart window. `base` is the line the studies are calculated on. Returns the button
 * for the toolbar and the row of active studies (chips with edit / remove).
 */
export function indicatorMenu(chart: IChartApi, base: () => Point[], opts: { open?: boolean; format?: (v: number) => string } = {}) {
  const studies: Study[] = [];
  let added = 0;
  const chips = h('div', { class: 'win-studies' });
  const menu = h('div', { class: 'win-ind-menu', hidden: true });

  function draw(study: Study) {
    // The chart deletes a pane when its last series goes and renumbers the ones below, so a saved pane number goes
    // stale: read the study's pane from the chart, and keep it while its series are swapped.
    const keep = study.def.placement !== 'overlay' && study.series.length ? study.series[0].getPane() : null;
    keep?.setPreserveEmptyPane(true);
    if (study.def.placement !== 'overlay') study.pane = keep ? keep.paneIndex() : chart.panes().length;
    for (const s of study.series) chart.removeSeries(s);
    const values = computeOnLine(study.def, study.params, base());
    study.series = study.def.plots
      .filter((plot) => plot.type !== 'marker')
      .map((plot) => {
        const pane = study.def.placement === 'overlay' ? 0 : study.pane;
        // Oscillators have their own units (RSI 0-100, MACD...), not the chart's % or $ format.
        const own = pane ? { priceFormat: { type: 'custom' as const, formatter: (v: number) => v.toFixed(Math.abs(v) >= 100 ? 0 : 2), minMove: 0.01 } } : { priceFormat: { type: 'custom' as const, formatter: opts.format ?? ((v: number) => v.toFixed(2)), minMove: 0.0001 } };
        // Single-line studies get their own colour so they don't look like the data line itself.
        const color = study.def.plots.length === 1 ? study.color : plot.color;
        const s =
          plot.type === 'histogram'
            ? chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false, ...own }, pane)
            : chart.addSeries(LineSeries, { color, lineWidth: (plot.lineWidth ?? 1) as 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...own }, pane);
        const pts = values[plot.key] ?? [];
        s.setData((plot.type === 'histogram' && plot.colorBy === 'sign' ? pts.map((p) => ({ ...p, color: p.value >= 0 ? plot.color : (plot.negativeColor ?? '#ef5350') })) : pts) as never);
        return s;
      });
    keep?.setPreserveEmptyPane(false);
    const first = study.series[0];
    if (first && study.def.placement !== 'overlay') for (const level of study.def.levels ?? []) first.createPriceLine({ price: level, color: '#787b86', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
  }

  function remove(study: Study) {
    for (const s of study.series) chart.removeSeries(s);
    studies.splice(studies.indexOf(study), 1);
    renderChips();
  }

  function edit(study: Study, chip: HTMLElement) {
    const form = h(
      'div',
      { class: 'win-study-edit' },
      ...study.def.inputs
        .filter((i) => i.type === 'number')
        .map((i) => {
          const input = h('input', { class: 'input', type: 'number', value: study.params[i.key], min: i.type === 'number' ? i.min : undefined, max: i.type === 'number' ? i.max : undefined, step: i.type === 'number' ? (i.step ?? 1) : 1 }) as HTMLInputElement;
          input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (Number.isFinite(v) && v > 0) {
              study.params[i.key] = v;
              draw(study);
              label.textContent = indicatorLabel(study.def, study);
            }
          });
          return h('label', {}, h('span', { class: 'muted tiny' }, i.label), input);
        }),
    );
    const label = chip.querySelector('.win-study-name')!;
    const open = chip.nextElementSibling?.classList.contains('win-study-edit');
    chips.querySelectorAll('.win-study-edit').forEach((e) => e.remove());
    if (!open) chip.after(form);
  }

  function renderChips() {
    chips.replaceChildren(
      ...studies.map((study) => {
        const chip = h(
          'span',
          { class: 'win-study' },
          h('i', { style: `background:${study.def.plots.length === 1 ? study.color : study.def.plots[0]?.color}` }),
          h('span', { class: 'win-study-name', title: study.def.description }, indicatorLabel(study.def, study)),
          study.def.inputs.some((i) => i.type === 'number') ? h('button', { class: 'icon-btn tiny', title: 'Settings', 'aria-label': 'Settings', onclick: () => edit(study, chip) }, '⚙') : '',
          h('button', { class: 'icon-btn tiny', title: 'Remove', 'aria-label': 'Remove', onclick: () => remove(study) }, '✕'),
        );
        return chip;
      }),
    );
  }

  function add(def: IndicatorDef) {
    const study: Study = { def, params: defaultParams(def), series: [], pane: 0, color: PALETTE[added++ % PALETTE.length] };
    studies.push(study);
    draw(study);
    renderChips();
    menu.hidden = true;
  }

  const groups = new Map<string, IndicatorDef[]>();
  for (const d of lineIndicators()) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);
  menu.append(
    h('p', { class: 'muted tiny' }, 'Calculated on the first line in this chart.'),
    ...[...groups].map(([cat, defs]) => h('div', { class: 'win-ind-group' }, h('b', { class: 'tiny muted' }, cat), ...defs.map((d) => h('button', { class: 'win-ind-item', title: d.description, onclick: () => add(d) }, d.name)))),
  );
  const button = h('button', { class: 'btn small', title: 'Add indicators to this chart', onclick: () => (menu.hidden = !menu.hidden) }, 'ƒx Indicators');
  if (opts.open) menu.hidden = false;
  return { button, menu, chips };
}
