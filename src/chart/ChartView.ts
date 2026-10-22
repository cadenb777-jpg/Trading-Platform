/**
 * Wraps TradingView's open-source Lightweight Charts library: draws the price series and
 * keeps every indicator's lines in sync with the data.
 */
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesPrimitive,
  type Logical,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { defaultParams, getIndicator } from '../indicators/library';
import type { IndicatorDef, IndicatorInstance, PlotDef } from '../indicators/types';
import { TIMEFRAME_SECONDS, bucketStart, regroupBars, type Bar, type Timeframe } from '../types';

type PlotSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

export type ChartType = 'candles' | 'hollow' | 'heikin' | 'bars' | 'line' | 'area';

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'hollow', label: 'Hollow candles' },
  { id: 'heikin', label: 'Heikin Ashi' },
  { id: 'bars', label: 'Bars (OHLC)' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];

type Placement = 'overlay' | 'volume' | 'separate';

interface RenderedIndicator {
  instance: IndicatorInstance;
  def: IndicatorDef;
  placement: Placement;
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
  accent: '#2962ff',
};

const time = (t: number) => t as UTCTimestamp;

function pricePrecision(price: number): number {
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 8;
}

export class ChartView {
  readonly chart: IChartApi;
  private main: ISeriesApi<SeriesType>;
  private chartType: ChartType = 'candles';
  private bars: Bar[] = [];
  private heikin: Bar[] = [];
  private timeframe: Timeframe = '15m';
  private readonly timeIndex = new Map<number, number>();
  private readonly indicators = new Map<string, RenderedIndicator>();
  private readonly primitives: ISeriesPrimitive<Time>[] = [];
  private markersApi: ISeriesMarkersPluginApi<Time> | null = null;
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
        fontSize: 13,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        panes: { separatorColor: THEME.border, separatorHoverColor: '#2962ff55', enableResize: true },
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      // Denser price labels (smaller steps between them) than the library's default.
      rightPriceScale: { borderColor: THEME.border, tickMarkDensity: 1.6 },
      timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    this.main = this.createMainSeries('candles');
    this.chart.subscribeCrosshairMove((param) => {
      const idx = param.time === undefined ? undefined : this.timeIndex.get(param.time as number);
      this.onHover(idx ?? this.bars.length - 1);
    });
    this.paneObserver = new ResizeObserver(() => this.onLayout());
  }

  get barCount() {
    return this.bars.length;
  }

  /** The bars currently scrolled into view. */
  visibleBars(): Bar[] {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (!range) return this.bars;
    return this.bars.slice(Math.max(0, Math.floor(range.from)), Math.max(0, Math.ceil(range.to) + 1));
  }

  barAt(index: number): Bar | undefined {
    return this.bars[index];
  }

  get currentTimeframe() {
    return this.timeframe;
  }

  setBars(bars: Bar[], timeframe: Timeframe) {
    this.bars = bars;
    this.timeframe = timeframe;
    this.timeIndex.clear();
    bars.forEach((b, i) => this.timeIndex.set(b.time, i));
    this.chart.applyOptions({ timeScale: { secondsVisible: TIMEFRAME_SECONDS[timeframe] < 60 } });
    this.applyPriceFormat();
    this.heikin = [];
    this.updateHeikin(0);
    this.main.setData(this.bars.map((_, i) => this.mainPoint(i)) as never);
    for (const r of this.indicators.values()) this.renderAll(r);
    this.fit();
    this.refreshPrimitives();
  }

  /**
   * Shows the latest ~150 bars and turns auto-scale back on for every price axis, so the y-axis
   * (and its price steps) fit the candles. Dragging the price axis turns auto-scale off, so this
   * runs on every new symbol or timeframe and from the toolbar's Fit button.
   */
  fit() {
    const n = this.bars.length;
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 8 });
    for (const pane of this.chart.panes()) {
      for (const series of pane.getSeries()) series.priceScale().applyOptions({ autoScale: true });
    }
  }

  /**
   * Redraws bars from `startIndex` to the end, after live trades changed the last bar or
   * appended new ones to the array passed to setBars.
   */
  updateFrom(startIndex: number) {
    const start = Math.max(0, startIndex);
    if (start === 0 && this.bars.length === 1) this.applyPriceFormat();
    this.updateHeikin(start);
    for (const r of this.indicators.values()) r.values = this.compute(r);
    for (let i = start; i < this.bars.length; i++) {
      this.timeIndex.set(this.bars[i].time, i);
      this.main.update(this.mainPoint(i) as never);
      for (const r of this.indicators.values()) {
        for (const plot of r.def.plots) r.series[plot.key]?.update(this.point(r, plot, i));
      }
    }
    this.refreshMarkers();
  }

  setChartType(type: ChartType) {
    if (type === this.chartType) return;
    this.chartType = type;
    const old = this.main;
    // Add the new series before removing the old one so the price pane is never empty.
    this.markersApi?.detach();
    this.markersApi = null;
    this.main = this.createMainSeries(type);
    this.applyPriceFormat();
    this.main.setData(this.bars.map((_, i) => this.mainPoint(i)) as never);
    for (const p of this.primitives) {
      old.detachPrimitive(p);
      this.main.attachPrimitive(p);
    }
    this.chart.removeSeries(old);
    this.refreshMarkers();
  }

  // ---------- Drawing-tool support ----------

  attachPrimitive(primitive: ISeriesPrimitive<Time>) {
    this.primitives.push(primitive);
    this.main.attachPrimitive(primitive);
  }

  /** Converts a time to a fractional bar position, extrapolating before the first and after the last bar. */
  timeToLogical(t: number): number | null {
    const bars = this.bars;
    if (!bars.length) return null;
    const step = TIMEFRAME_SECONDS[this.timeframe];
    const last = bars.length - 1;
    if (t <= bars[0].time) return (t - bars[0].time) / step;
    if (t >= bars[last].time) return last + (t - bars[last].time) / step;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - bars[lo].time) / (bars[hi].time - bars[lo].time);
  }

  logicalToTime(logical: number): number | null {
    const bars = this.bars;
    if (!bars.length) return null;
    const step = TIMEFRAME_SECONDS[this.timeframe];
    const last = bars.length - 1;
    if (logical <= 0) return bars[0].time + logical * step;
    if (logical >= last) return bars[last].time + (logical - last) * step;
    const i = Math.floor(logical);
    return bars[i].time + (logical - i) * (bars[i + 1].time - bars[i].time);
  }

  timeToX(t: number): number | null {
    const logical = this.timeToLogical(t);
    return logical === null ? null : this.chart.timeScale().logicalToCoordinate(logical as Logical);
  }

  xToTime(x: number): number | null {
    const logical = this.chart.timeScale().coordinateToLogical(x);
    return logical === null ? null : this.logicalToTime(logical);
  }

  priceToY(price: number): number | null {
    return this.main.priceToCoordinate(price);
  }

  yToPrice(y: number): number | null {
    return this.main.coordinateToPrice(y);
  }

  /** Moves a point onto the nearest bar's open, high, low or close (the "magnet"). */
  snap(x: number, y: number): { time: number; price: number } | null {
    const logical = this.chart.timeScale().coordinateToLogical(x);
    if (logical === null || !this.bars.length) return null;
    const i = Math.min(this.bars.length - 1, Math.max(0, Math.round(logical)));
    const bar = this.bars[i];
    let best = bar.close;
    let bestDist = Infinity;
    for (const price of [bar.open, bar.high, bar.low, bar.close]) {
      const py = this.priceToY(price);
      if (py !== null && Math.abs(py - y) < bestDist) {
        bestDist = Math.abs(py - y);
        best = price;
      }
    }
    return { time: bar.time, price: best };
  }

  formatPrice(price: number): string {
    return this.main.priceFormatter().format(price);
  }

  /** The element covering the main price pane, used to read mouse positions for drawing. */
  mainPaneElement(): HTMLElement | null {
    return this.chart.panes()[0]?.getHTMLElement() ?? null;
  }

  // ---------- Indicators ----------

  addIndicator(instance: IndicatorInstance) {
    const def = getIndicator(instance.defId);
    if (!def) return;
    const markersOnly = def.plots.every((p) => p.type === 'marker');
    const placement: Placement = def.placement === 'volume' ? 'volume' : markersOnly ? 'overlay' : (instance.placement ?? def.placement);
    const r: RenderedIndicator = { instance, def, placement, series: {}, values: {}, levels: [] };
    const paneIndex = placement === 'separate' ? this.chart.panes().length : 0;
    // An oscillator moved onto the price chart gets its own invisible scale so it doesn't squash the candles.
    const ownScale = placement === 'overlay' && def.placement === 'separate';
    for (const plot of def.plots.filter((p) => p.type !== 'marker')) {
      const options = {
        color: instance.colors[plot.key] ?? plot.color,
        visible: instance.visible,
        priceLineVisible: false,
        lastValueVisible: placement !== 'volume',
        title: '',
        ...(placement === 'volume' ? { priceScaleId: 'volume', priceFormat: { type: 'volume' as const } } : {}),
        ...(ownScale ? { priceScaleId: `ind-${instance.uid}`, lastValueVisible: false } : {}),
      };
      const first = Object.values(r.series)[0];
      const pane = first?.getPane();
      const definition = plot.type === 'histogram' ? HistogramSeries : LineSeries;
      const dots = plot.style === 'dots' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 } : {};
      const lineOptions = plot.type === 'line' ? { lineWidth: this.lineWidth(instance, plot), crosshairMarkerRadius: 3, ...dots } : {};
      r.series[plot.key] = pane
        ? (pane.addSeries(definition as typeof LineSeries, { ...options, ...lineOptions }) as PlotSeries)
        : (this.chart.addSeries(definition as typeof LineSeries, { ...options, ...lineOptions }, paneIndex) as PlotSeries);
    }
    const firstSeries = Object.values(r.series)[0];
    if (!firstSeries) {
      // Signals only (markers on the candles): nothing else to set up.
      this.indicators.set(instance.uid, r);
      this.renderAll(r);
      return;
    }
    if (placement === 'volume') {
      firstSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    }
    if (ownScale) {
      firstSeries.priceScale().applyOptions({ scaleMargins: { top: 0.65, bottom: 0.05 } });
    }
    if (placement === 'separate') {
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

  /** Applies changed settings (inputs, colours, visibility, placement) to an indicator already on the chart. */
  updateIndicator(instance: IndicatorInstance) {
    const r = this.indicators.get(instance.uid);
    if (!r) return;
    const placement = r.def.placement === 'volume' ? 'volume' : (instance.placement ?? r.def.placement);
    if (placement !== r.placement) {
      this.removeIndicator(instance.uid);
      this.addIndicator(instance);
      return;
    }
    r.instance = instance;
    for (const plot of r.def.plots) {
      r.series[plot.key]?.applyOptions({
        color: instance.colors[plot.key] ?? plot.color,
        visible: instance.visible,
        ...(plot.type === 'line' ? { lineWidth: this.lineWidth(instance, plot) } : {}),
      });
    }
    this.renderAll(r);
  }

  isSeparatePane(uid: string): boolean {
    return this.indicators.get(uid)?.placement === 'separate';
  }

  /** Removes any indicator on the chart whose id isn't in `keep`. */
  removeMissingIndicators(keep: Set<string>) {
    for (const uid of [...this.indicators.keys()]) if (!keep.has(uid)) this.removeIndicator(uid);
  }

  removeIndicator(uid: string) {
    const r = this.indicators.get(uid);
    if (!r) return;
    for (const s of Object.values(r.series)) this.chart.removeSeries(s);
    this.indicators.delete(uid);
    this.refreshMarkers();
    this.observePanes();
  }

  /** The indicator's plotted values at a bar index, in plot order. */
  valuesAt(uid: string, index: number): { title: string; value: number; color: string }[] {
    const r = this.indicators.get(uid);
    if (!r) return [];
    return r.def.plots.filter((p) => p.type !== 'marker').map((p) => ({
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

  // ---------- Internals ----------

  private createMainSeries(type: ChartType): ISeriesApi<SeriesType> {
    const { up, down, accent } = THEME;
    const common = { priceLineVisible: true };
    switch (type) {
      case 'hollow':
        return this.chart.addSeries(
          CandlestickSeries,
          { ...common, upColor: 'rgba(0,0,0,0)', downColor: down, borderVisible: true, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down },
          0,
        );
      case 'bars':
        return this.chart.addSeries(BarSeries, { ...common, upColor: up, downColor: down, thinBars: false }, 0);
      case 'line':
        return this.chart.addSeries(LineSeries, { ...common, color: accent, lineWidth: 2 }, 0);
      case 'area':
        return this.chart.addSeries(AreaSeries, { ...common, lineColor: accent, topColor: 'rgba(41,98,255,0.35)', bottomColor: 'rgba(41,98,255,0)', lineWidth: 2 }, 0);
      default:
        return this.chart.addSeries(
          CandlestickSeries,
          { ...common, upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down },
          0,
        );
    }
  }

  private applyPriceFormat() {
    // Leave the bottom fifth for volume bars so they don't cover the candles.
    this.main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    const last = this.bars[this.bars.length - 1];
    const precision = last ? pricePrecision(last.close) : 2;
    this.main.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
  }

  private updateHeikin(start: number) {
    this.heikin.length = Math.min(this.heikin.length, start);
    for (let i = this.heikin.length; i < this.bars.length; i++) {
      const b = this.bars[i];
      const prev = this.heikin[i - 1];
      const close = (b.open + b.high + b.low + b.close) / 4;
      const open = prev ? (prev.open + prev.close) / 2 : (b.open + b.close) / 2;
      this.heikin.push({ time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume });
    }
  }

  private mainPoint(i: number) {
    const bar = this.chartType === 'heikin' ? this.heikin[i] : this.bars[i];
    if (this.chartType === 'line' || this.chartType === 'area') return { time: time(bar.time), value: bar.close };
    return { time: time(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  }

  private refreshPrimitives() {
    for (const p of this.primitives) p.updateAllViews?.();
  }

  private lineWidth(instance: IndicatorInstance, plot: PlotDef) {
    return (instance.lineWidths?.[plot.key] ?? plot.lineWidth ?? 2) as 1 | 2 | 3 | 4;
  }

  /**
   * Calculates an indicator. When it has its own higher timeframe, the bars are combined into
   * that timeframe first and each chart bar shows the value of the higher bar it falls inside.
   */
  private compute(r: RenderedIndicator): Record<string, number[]> {
    if (!this.bars.length) return {};
    // Any setting missing from a saved layout (e.g. a script gained a new input) uses its default.
    const params = { ...defaultParams(r.def), ...r.instance.params };
    const tf = r.instance.timeframe;
    if (!tf || TIMEFRAME_SECONDS[tf] <= TIMEFRAME_SECONDS[this.timeframe]) return r.def.compute(this.bars, params);
    const higher = regroupBars(this.bars, tf);
    const values = r.def.compute(higher, params);
    const out: Record<string, number[]> = Object.fromEntries(Object.keys(values).map((k) => [k, []]));
    let j = 0;
    for (const bar of this.bars) {
      const start = bucketStart(bar.time, tf);
      while (j < higher.length - 1 && higher[j].time < start) j++;
      for (const k of Object.keys(values)) out[k].push(values[k][j]);
    }
    return out;
  }

  private renderAll(r: RenderedIndicator) {
    r.values = this.compute(r);
    for (const plot of r.def.plots) {
      r.series[plot.key]?.setData(this.bars.map((_, i) => this.point(r, plot, i)) as never);
    }
    this.refreshMarkers();
  }

  private point(r: RenderedIndicator, plot: PlotDef, i: number) {
    const bar = this.bars[i];
    const value = r.values[plot.key]?.[i];
    const t = time(bar.time) as Time;
    if (value === undefined || !Number.isFinite(value)) return { time: t };
    if (plot.type === 'histogram' && plot.colorBy) {
      const prev = r.values[plot.key]?.[i - 1];
      const positive =
        plot.colorBy === 'sign' ? value >= 0 : plot.colorBy === 'change' ? !(prev !== undefined && value < prev) : bar.close >= bar.open;
      const color = positive ? (r.instance.colors[plot.key] ?? plot.color) : (plot.negativeColor ?? plot.color);
      return { time: t, value, color };
    }
    return { time: t, value };
  }

  /** Collects every visible indicator's signals into arrows/dots on the candles. */
  private refreshMarkers() {
    const list: SeriesMarker<Time>[] = [];
    for (const r of this.indicators.values()) {
      if (!r.instance.visible) continue;
      for (const plot of r.def.plots) {
        if (plot.type !== 'marker') continue;
        const color = r.instance.colors[plot.key] ?? plot.color;
        r.values[plot.key]?.forEach((v, i) => {
          const bar = this.bars[i];
          if (!bar || !Number.isFinite(v) || v === 0) return;
          list.push({ time: time(bar.time), position: plot.marker?.position ?? 'aboveBar', shape: plot.marker?.shape ?? 'circle', color, text: plot.marker?.text ?? '' });
        });
      }
    }
    list.sort((a, b) => (a.time as number) - (b.time as number));
    if (this.markersApi) this.markersApi.setMarkers(list);
    else if (list.length) this.markersApi = createSeriesMarkers(this.main, list);
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
