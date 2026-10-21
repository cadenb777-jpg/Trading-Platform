/**
 * Wraps TradingView's open-source Lightweight Charts library: draws the candles and
 * keeps every indicator's lines in sync with the data.
 */
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { getIndicator } from '../indicators/library';
import type { IndicatorDef, IndicatorInstance, PlotDef } from '../indicators/types';
import type { Bar } from '../types';

type PlotSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

interface RenderedIndicator {
  instance: IndicatorInstance;
  def: IndicatorDef;
  series: Record<string, PlotSeries>;
  values: Record<string, number[]>;
  levels: IPriceLine[];
}

export const THEME = {
  background: '#131722',
  text: '#d1d4dc',
  grid: '#1e222d',
  border: '#2a2e39',
  up: '#26a69a',
  down: '#ef5350',
};

const time = (t: number) => t as UTCTimestamp;

function pricePrecision(price: number): number {
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 8;
}

export class ChartView {
  readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private bars: Bar[] = [];
  private readonly timeIndex = new Map<number, number>();
  private readonly indicators = new Map<string, RenderedIndicator>();
  private readonly paneObserver: ResizeObserver;

  /** Called with the bar index under the mouse (or the latest bar when the mouse leaves). */
  onHover: (index: number) => void = () => {};
  /** Called when panes are added, removed or resized, so legends can be repositioned. */
  onLayout: () => void = () => {};

  constructor(container: HTMLElement) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.background },
        textColor: THEME.text,
        panes: { separatorColor: THEME.border, separatorHoverColor: '#2962ff55', enableResize: true },
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: THEME.border },
      timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      borderVisible: false,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
    });
    this.chart.subscribeCrosshairMove((param) => {
      const idx = param.time === undefined ? undefined : this.timeIndex.get(param.time as number);
      this.onHover(idx ?? this.bars.length - 1);
    });
    this.paneObserver = new ResizeObserver(() => this.onLayout());
  }

  get barCount() {
    return this.bars.length;
  }

  barAt(index: number): Bar | undefined {
    return this.bars[index];
  }

  setBars(bars: Bar[]) {
    this.bars = bars;
    this.timeIndex.clear();
    bars.forEach((b, i) => this.timeIndex.set(b.time, i));
    const last = bars[bars.length - 1];
    const precision = last ? pricePrecision(last.close) : 2;
    this.candles.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
    this.candles.setData(bars.map((b) => ({ ...b, time: time(b.time) })));
    for (const r of this.indicators.values()) this.renderAll(r);
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 150), to: bars.length + 8 });
  }

  /**
   * Redraws bars from `startIndex` to the end, after live trades changed the last bar or
   * appended new ones to the array passed to setBars.
   */
  updateFrom(startIndex: number) {
    const start = Math.max(0, startIndex);
    for (const r of this.indicators.values()) r.values = r.def.compute(this.bars, r.instance.params);
    for (let i = start; i < this.bars.length; i++) {
      const bar = this.bars[i];
      this.timeIndex.set(bar.time, i);
      this.candles.update({ ...bar, time: time(bar.time) });
      for (const r of this.indicators.values()) {
        for (const plot of r.def.plots) r.series[plot.key].update(this.point(r, plot, i));
      }
    }
  }

  addIndicator(instance: IndicatorInstance) {
    const def = getIndicator(instance.defId);
    if (!def) return;
    const r: RenderedIndicator = { instance, def, series: {}, values: {}, levels: [] };
    const paneIndex = def.placement === 'separate' ? this.chart.panes().length : 0;
    for (const plot of def.plots) {
      const options = {
        color: instance.colors[plot.key] ?? plot.color,
        visible: instance.visible,
        priceLineVisible: false,
        lastValueVisible: def.placement !== 'volume',
        title: '',
        ...(def.placement === 'volume' ? { priceScaleId: 'volume', priceFormat: { type: 'volume' as const } } : {}),
      };
      const first = Object.values(r.series)[0];
      const pane = first?.getPane();
      const definition = plot.type === 'histogram' ? HistogramSeries : LineSeries;
      const lineOptions = plot.type === 'line' ? { lineWidth: plot.lineWidth ?? 2, crosshairMarkerRadius: 3 } : {};
      r.series[plot.key] = pane
        ? (pane.addSeries(definition as typeof LineSeries, { ...options, ...lineOptions }) as PlotSeries)
        : (this.chart.addSeries(definition as typeof LineSeries, { ...options, ...lineOptions }, paneIndex) as PlotSeries);
    }
    const firstSeries = Object.values(r.series)[0];
    if (def.placement === 'volume') {
      firstSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }
    if (def.placement === 'separate') {
      // Keep the price chart about three times taller than each indicator pane.
      const pane = firstSeries.getPane();
      this.chart.panes()[0].setStretchFactor(pane.getStretchFactor() * 3);
      firstSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    }
    r.levels = (def.levels ?? []).map((price) =>
      firstSeries.createPriceLine({ price, color: '#787b86', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' }),
    );
    this.indicators.set(instance.uid, r);
    this.renderAll(r);
    this.observePanes();
  }

  /** Applies changed settings (inputs, colours, visibility) to an indicator already on the chart. */
  updateIndicator(instance: IndicatorInstance) {
    const r = this.indicators.get(instance.uid);
    if (!r) return;
    r.instance = instance;
    for (const plot of r.def.plots) {
      r.series[plot.key].applyOptions({ color: instance.colors[plot.key] ?? plot.color, visible: instance.visible });
    }
    this.renderAll(r);
  }

  removeIndicator(uid: string) {
    const r = this.indicators.get(uid);
    if (!r) return;
    for (const s of Object.values(r.series)) this.chart.removeSeries(s);
    this.indicators.delete(uid);
    this.observePanes();
  }

  /** The indicator's plotted values at a bar index, in plot order. */
  valuesAt(uid: string, index: number): { title: string; value: number; color: string }[] {
    const r = this.indicators.get(uid);
    if (!r) return [];
    return r.def.plots.map((p) => ({
      title: p.title,
      value: r.values[p.key]?.[index] ?? NaN,
      color: r.instance.colors[p.key] ?? p.color,
    }));
  }

  /** Pixel offset from the top of the chart to the top of the pane an indicator is drawn in. */
  paneTop(uid: string): number {
    const r = this.indicators.get(uid);
    const series = r && Object.values(r.series)[0];
    const paneIndex = series ? series.getPane().paneIndex() : 0;
    return this.chart
      .panes()
      .slice(0, paneIndex)
      .reduce((sum, p) => sum + p.getHeight() + 1, 0);
  }

  private renderAll(r: RenderedIndicator) {
    r.values = this.bars.length ? r.def.compute(this.bars, r.instance.params) : {};
    for (const plot of r.def.plots) {
      r.series[plot.key].setData(this.bars.map((_, i) => this.point(r, plot, i)) as never);
    }
  }

  private point(r: RenderedIndicator, plot: PlotDef, i: number) {
    const bar = this.bars[i];
    const value = r.values[plot.key]?.[i];
    const t = time(bar.time) as Time;
    if (value === undefined || !Number.isFinite(value)) return { time: t };
    if (plot.type === 'histogram' && plot.colorBy) {
      const positive = plot.colorBy === 'sign' ? value >= 0 : bar.close >= bar.open;
      const color = positive ? (r.instance.colors[plot.key] ?? plot.color) : (plot.negativeColor ?? plot.color);
      return { time: t, value, color };
    }
    return { time: t, value };
  }

  private observePanes() {
    this.paneObserver.disconnect();
    for (const pane of this.chart.panes()) {
      const el = pane.getHTMLElement();
      if (el) this.paneObserver.observe(el);
    }
    requestAnimationFrame(() => this.onLayout());
  }
}
