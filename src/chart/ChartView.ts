/**
 * Wraps TradingView's open-source Lightweight Charts library: draws the price series and
 * keeps every indicator's lines in sync with the data.
 */
import { MARKET_PARAM } from '../indicators/session';
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
import { externalData } from '../indicators/external';
import { THEME, followTheme } from '../ui/theme';
import { easeOutCubic, reducedMotion, withAlpha } from './frame';
import { firstDifference, newTailState, tailUpdate, type TailState } from './incremental';
import { LivePrice } from './livePrice';
import { expectedCost, indicatorWorker, recordCost } from './workerClient';
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
  /** Live-tick tail recompute state (incremental.ts). */
  tail: TailState;
  /** Worker calculation in flight (its token, 0 = none), and the first bar changed since it was sent. */
  request: number;
  dirtyFrom: number | null;
  /** Hover highlight: 1 = normal, lower = dimmed while another indicator is highlighted. */
  opacity: number;
  /** Drawn thicker because it is the highlighted one. */
  lifted?: boolean;
  /** The opacity its per-point histogram colours were last drawn with. */
  colored?: number;
}

/** What the crosshair is over, for hover cards and highlights. */
export interface PointerInfo {
  /** Bar index under the crosshair. */
  index: number;
  x: number;
  y: number;
  paneIndex: number;
  /** The crosshair point snapped to the bar's nearest open/high/low/close (price pane only). */
  snappedY: number | null;
  /** The indicator whose line is under the cursor, if any. */
  hoveredUid: string | null;
}

/** Bars from which heavy indicators move to the worker, and how slow (ms) counts as heavy. */
const WORKER_MIN_BARS = 2000;
const HEAVY_MS = 12;
/** Live ticks redraw indicator lines at most this often (the candle itself redraws every frame). */
const INDICATOR_INTERVAL_MS = 100;
/** Opacity of the other indicators while one is highlighted. */
const DIM = 0.22;

export { THEME } from '../ui/theme';

const time = (t: number) => t as UTCTimestamp;
const plotVisible = (instance: IndicatorInstance, key: string) => instance.visible && !instance.hiddenPlots?.includes(key);

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
  /** The symbol on the chart, for indicators that load outside data (e.g. COT positioning). */
  symbol = '';
  /** The chart's market (provider id): session indicators use UTC days for crypto, New York days for stocks. */
  market = '';
  private readonly timeIndex = new Map<number, number>();
  private readonly indicators = new Map<string, RenderedIndicator>();
  private readonly primitives: ISeriesPrimitive<Time>[] = [];
  private markersApi: ISeriesMarkersPluginApi<Time> | null = null;
  private readonly paneObserver: ResizeObserver;
  private readonly stopTheme: () => void;
  /** Layer over the chart canvas for DOM effects (pulse, hover card); never takes the mouse. */
  readonly overlay: HTMLElement;
  private readonly livePrice: LivePrice;
  private readonly useWorker: boolean;
  /** Bumped by every setBars so late worker results for old data are dropped. */
  private dataGeneration = 0;
  private highlighted: string | null = null;
  private highlightKey = '';
  private fitFrame = 0;
  private disposed = false;
  private indicatorFrom: number | null = null;
  private indicatorTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private lastIndicatorFlush = 0;

  /** Called with the bar index under the mouse (or the latest bar when the mouse leaves). */
  onHover: (index: number) => void = () => {};
  /** Called with what the crosshair is over (null when it leaves the chart). */
  onPointer: (info: PointerInfo | null) => void = () => {};
  /** Called after live ticks updated the indicator values (they follow ticks a little behind the candle). */
  onValues: () => void = () => {};
  /** Called when the chart can't draw its data (with the reason), so the page can say so instead of staying blank. */
  onDataError: (message: string) => void = (message) => console.error(message);
  /** Called when panes are added, removed or resized, so legends can be repositioned. */
  onLayout: () => void = () => {};

  constructor(container: HTMLElement, options: { worker?: boolean } = {}) {
    this.useWorker = options.worker ?? true;
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
      // The crosshair snaps to the nearest open/high/low/close; a flick of the chart glides to a stop.
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      kineticScroll: { mouse: true, touch: true },
      // Denser price labels (smaller steps between them) than the library's default.
      rightPriceScale: { borderColor: THEME.border, tickMarkDensity: 1.6 },
      timeScale: { borderColor: THEME.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    this.stopTheme = followTheme(this.chart, {
      onChange: () => {
        this.chart.applyOptions({ layout: { panes: { separatorColor: THEME.border } } });
        this.recolorMain();
      },
    });
    this.overlay = document.createElement('div');
    this.overlay.className = 'chart-fx';
    container.append(this.overlay);
    this.livePrice = new LivePrice(
      {
        priceToY: (p) => this.priceToY(p),
        timeToX: (t) => this.chart.timeScale().timeToCoordinate(t as UTCTimestamp),
        formatPrice: (p) => this.formatPrice(p),
        lastBar: () => this.bars[this.bars.length - 1] ?? null,
      },
      this.overlay,
    );
    this.main = this.createMainSeries('candles');
    this.attachPrimitive(this.livePrice.primitive);
    this.chart.subscribeCrosshairMove((param) => {
      const idx = param.time === undefined ? undefined : this.timeIndex.get(param.time as number);
      this.onHover(idx ?? this.bars.length - 1);
      this.onPointer(idx === undefined || !param.point ? null : this.pointerInfo(idx, param.point, param.paneIndex ?? 0, param.hoveredInfo?.series));
    });
    this.paneObserver = new ResizeObserver(() => this.onLayout());
  }

  private pointerInfo(index: number, point: { x: number; y: number }, paneIndex: number, hovered: unknown): PointerInfo {
    const bar = this.bars[index];
    let snappedY: number | null = null;
    if (paneIndex === 0 && bar) {
      for (const price of [bar.open, bar.high, bar.low, bar.close]) {
        const y = this.priceToY(price);
        if (y !== null && (snappedY === null || Math.abs(y - point.y) < Math.abs(snappedY - point.y))) snappedY = y;
      }
    }
    let hoveredUid: string | null = null;
    if (hovered) {
      for (const r of this.indicators.values()) if (Object.values(r.series).includes(hovered as PlotSeries)) hoveredUid = r.instance.uid;
    }
    return { index, x: point.x, y: point.y, paneIndex, snappedY, hoveredUid };
  }

  /** Removes the chart and everything it listens to (for pages that throw a chart away). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.fitFrame);
    this.cancelIndicatorFlush();
    this.paneObserver.disconnect();
    this.stopTheme();
    this.indicators.clear();
    this.chart.remove();
    this.overlay.remove();
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

  setBars(bars: Bar[], timeframe: Timeframe, refit = true) {
    // A new symbol or timeframe cross-fades from a snapshot of the old chart instead of flashing.
    if (refit && this.bars.length && bars !== this.bars) this.crossFade();
    this.dataGeneration++;
    this.cancelIndicatorFlush();
    this.bars = bars;
    this.timeframe = timeframe;
    this.timeIndex.clear();
    bars.forEach((b, i) => this.timeIndex.set(b.time, i));
    this.chart.applyOptions({ timeScale: { secondsVisible: TIMEFRAME_SECONDS[timeframe] < 60 } });
    this.applyPriceFormat();
    this.heikin = [];
    this.updateHeikin(0);
    try {
      this.main.setData(this.bars.map((_, i) => this.mainPoint(i)) as never);
    } catch (err) {
      this.onDataError(`The chart couldn't draw this data: ${(err as Error).message}`);
    }
    for (const r of this.indicators.values()) {
      r.tail = newTailState();
      try {
        this.renderAll(r, false);
      } catch (err) {
        console.error(`Indicator ${r.def.name} failed`, err);
      }
    }
    // Markers are collected once for all indicators instead of once per indicator.
    try {
      this.refreshMarkers();
    } catch (err) {
      console.error('Indicator signals failed', err);
    }
    if (refit) this.fit(false);
    this.livePrice.update(false);
    this.refreshPrimitives();
  }

  /** Lays a snapshot of the current chart over it and fades it out while the new data draws underneath. */
  private crossFade() {
    if (reducedMotion() || this.disposed) return;
    let shot: HTMLCanvasElement;
    try {
      shot = this.chart.takeScreenshot();
    } catch {
      return;
    }
    shot.className = 'chart-crossfade';
    this.overlay.append(shot);
    const fade = shot.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    if (fade) fade.onfinish = () => shot.remove();
    else shot.remove();
  }

  /**
   * Shows the latest ~150 bars and turns auto-scale back on for every price axis, so the y-axis
   * (and its price steps) fit the candles. Dragging the price axis turns auto-scale off, so this
   * runs on every new symbol or timeframe and from the toolbar's Fit button.
   */
  fit(animate = true) {
    const n = this.bars.length;
    const target = { from: Math.max(0, n - 150), to: n + 8 };
    for (const pane of this.chart.panes()) {
      for (const series of pane.getSeries()) series.priceScale().applyOptions({ autoScale: true });
    }
    cancelAnimationFrame(this.fitFrame);
    const ts = this.chart.timeScale();
    const from = ts.getVisibleLogicalRange();
    if (!animate || !from || reducedMotion() || !n) return ts.setVisibleLogicalRange(target);
    // Glide to the latest bars instead of jumping.
    const start = performance.now();
    const step = () => {
      const k = easeOutCubic((performance.now() - start) / 320);
      ts.setVisibleLogicalRange({ from: from.from + (target.from - from.from) * k, to: from.to + (target.to - from.to) * k });
      if (k < 1) this.fitFrame = requestAnimationFrame(step);
    };
    this.fitFrame = requestAnimationFrame(step);
  }

  /**
   * Redraws bars from `startIndex` to the end, after live trades changed the last bar or
   * appended new ones to the array passed to setBars.
   */
  updateFrom(startIndex: number) {
    try {
      this.updateRange(startIndex);
    } catch (err) {
      // A live update the chart rejected (e.g. out of order): redraw everything from the bars instead.
      console.warn('Live update failed, redrawing the chart', err);
      this.setBars(this.bars, this.timeframe, false);
    }
  }

  private updateRange(startIndex: number) {
    const start = Math.max(0, startIndex);
    if (start === 0 && this.bars.length === 1) this.applyPriceFormat();
    this.updateHeikin(start);
    for (let i = start; i < this.bars.length; i++) {
      this.timeIndex.set(this.bars[i].time, i);
      this.main.update(this.mainPoint(i) as never);
    }
    this.livePrice.update(true);
    this.queueIndicators(start);
  }

  /**
   * Indicator lines follow live ticks at most every INDICATOR_INTERVAL_MS. The library rebuilds a series' whole point
   * list on every update, so with 20 indicator series and fast trades this is most of the per-frame cost; the candle
   * and the last price still move every frame.
   */
  private queueIndicators(start: number) {
    this.indicatorFrom = Math.min(this.indicatorFrom ?? start, start);
    const wait = INDICATOR_INTERVAL_MS - (performance.now() - this.lastIndicatorFlush);
    if (wait <= 0) this.flushIndicators();
    else if (!this.indicatorTimer) {
      this.indicatorTimer = setTimeout(() => {
        this.indicatorTimer = 0;
        this.flushIndicators();
      }, wait);
    }
  }

  private cancelIndicatorFlush() {
    clearTimeout(this.indicatorTimer);
    this.indicatorTimer = 0;
    this.indicatorFrom = null;
  }

  private flushIndicators() {
    const start = this.indicatorFrom;
    this.cancelIndicatorFlush();
    if (start === null || this.disposed) return;
    this.lastIndicatorFlush = performance.now();
    try {
      this.updateIndicators(start);
    } catch (err) {
      console.warn('Live indicator update failed, redrawing them', err);
      for (const r of this.indicators.values()) this.renderAll(r, false);
      this.refreshMarkers();
    }
    this.onValues();
  }

  private updateIndicators(start: number) {
    let markers = false;
    for (const r of this.indicators.values()) {
      if (r.request) {
        // A worker calculation is running: it is redone for these bars when it lands.
        r.dirtyFrom = Math.min(r.dirtyFrom ?? start, start);
        continue;
      }
      if (this.runsInWorker(r)) {
        this.computeInWorker(r);
        continue;
      }
      const old = r.values;
      // Live ticks only change the end: recompute just the tail when that gives the same answer, else everything.
      const tail = start > 0 ? this.computeTail(r, start) : null;
      const next = tail ?? this.computeTimed(r);
      r.values = next;
      const from = tail ? start : Math.min(start, firstDifference(old, next));
      if (from < start) this.drawIndicator(r); // an indicator that rewrote older bars (e.g. a confirmed pivot)
      else {
        for (let i = start; i < this.bars.length; i++) {
          for (const plot of r.def.plots) r.series[plot.key]?.update(this.point(r, plot, i));
        }
      }
      // Signals are re-collected only when one appeared, moved or went away.
      const markerKeys = r.def.plots.filter((p) => p.type === 'marker').map((p) => p.key);
      if (!markers && markerKeys.length) {
        const pick = (v: Record<string, number[]>) => Object.fromEntries(markerKeys.map((k) => [k, v[k] ?? []]));
        markers = firstDifference(pick(old), pick(next), from) !== Infinity;
      }
    }
    if (markers) this.refreshMarkers();
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

  /** Pixels between bars at the current zoom. */
  barSpacing(): number {
    return this.chart.timeScale().options().barSpacing;
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
    const r: RenderedIndicator = { instance, def, placement, series: {}, values: {}, levels: [], tail: newTailState(), request: 0, dirtyFrom: null, opacity: 1 };
    const paneIndex = placement === 'separate' ? this.chart.panes().length : 0;
    // An oscillator moved onto the price chart gets its own invisible scale so it doesn't squash the candles.
    const ownScale = placement === 'overlay' && def.placement === 'separate';
    for (const plot of def.plots.filter((p) => p.type !== 'marker')) {
      const options = {
        color: instance.colors[plot.key] ?? plot.color,
        visible: plotVisible(instance, plot.key),
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
      firstSeries.createPriceLine({ price, color: '#787b86', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '', lineVisible: instance.visible && !instance.hideLevels }),
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
    // Only what changed: new colours or visibility restyle the series without recomputing or recreating them.
    const inputs = (i: IndicatorInstance) => JSON.stringify([i.params, i.timeframe ?? null]);
    const looks = (i: IndicatorInstance) => JSON.stringify([i.visible, i.hiddenPlots ?? [], i.colors]);
    const recompute = inputs(r.instance) !== inputs(instance);
    const restyled = looks(r.instance) !== looks(instance);
    r.instance = instance;
    this.styleIndicator(r);
    for (const level of r.levels) level.applyOptions({ lineVisible: instance.visible && !instance.hideLevels });
    if (recompute) {
      r.tail = newTailState();
      this.renderAll(r);
    } else if (restyled) {
      if (r.def.plots.some((p) => p.type === 'histogram' && p.colorBy)) this.drawIndicator(r);
      if (r.def.plots.some((p) => p.type === 'marker')) this.refreshMarkers();
    }
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
    r.request = 0;
    for (const s of Object.values(r.series)) this.chart.removeSeries(s);
    this.indicators.delete(uid);
    if (this.highlighted === uid) this.highlight(null);
    this.refreshMarkers();
    this.observePanes();
  }

  /** The indicator's plotted values at a bar index, in plot order. */
  valuesAt(uid: string, index: number): { key: string; title: string; value: number; color: string; hidden: boolean }[] {
    const r = this.indicators.get(uid);
    if (!r) return [];
    return r.def.plots.filter((p) => p.type !== 'marker').map((p) => ({
      key: p.key,
      title: p.title,
      value: r.values[p.key]?.[index] ?? NaN,
      color: r.instance.colors[p.key] ?? p.color,
      hidden: !!r.instance.hiddenPlots?.includes(p.key),
    }));
  }

  /** A signal plot's value at a bar (0 or NaN = no signal there). */
  markerValueAt(uid: string, key: string, index: number): number {
    const v = this.indicators.get(uid)?.values[key]?.[index];
    return v !== undefined && Number.isFinite(v) ? v : 0;
  }

  /** Crosshair snapping to open/high/low/close (on by default; off while drawing freehand). */
  setCrosshairMagnet(on: boolean) {
    this.chart.applyOptions({ crosshair: { mode: on ? CrosshairMode.MagnetOHLC : CrosshairMode.Normal } });
  }

  /** Everything needed to explain an indicator on this chart: its bars and the full value series per plot. */
  indicatorSnapshot(uid: string): { bars: Bar[]; values: Record<string, number[]> } | null {
    const r = this.indicators.get(uid);
    return r ? { bars: this.bars, values: r.values } : null;
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

  /**
   * Highlights one indicator: its lines get thicker and, with `dimOthers`, the other indicators fade back (hovering a
   * legend row). null restores everything. One restyle, no animation: every restyle makes the library rebuild each
   * series' points, so the legend does the easing in CSS instead.
   */
  highlight(uid: string | null, dimOthers = true) {
    if (uid !== null && !this.indicators.has(uid)) uid = null;
    const key = uid === null ? '' : `${uid}:${dimOthers}`;
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    this.highlighted = uid;
    for (const r of this.indicators.values()) {
      const opacity = uid === null || r.instance.uid === uid || !dimOthers ? 1 : DIM;
      const lifted = r.instance.uid === uid;
      if (opacity === r.opacity && lifted === !!r.lifted) continue;
      r.opacity = opacity;
      r.lifted = lifted;
      this.styleIndicator(r);
    }
  }

  // ---------- Internals ----------

  /**
   * Colours, widths and visibility of an indicator's series, with the hover highlight applied. Coloured histogram
   * bars carry their colour per point, so they are redrawn when their opacity changes.
   */
  private styleIndicator(r: RenderedIndicator) {
    for (const plot of r.def.plots) {
      const color = r.instance.colors[plot.key] ?? plot.color;
      r.series[plot.key]?.applyOptions({
        color: r.opacity < 1 ? withAlpha(color, r.opacity) : color,
        visible: plotVisible(r.instance, plot.key),
        ...(plot.type === 'line' ? { lineWidth: Math.min(4, this.lineWidth(r.instance, plot) + (r.lifted ? 1 : 0)) as 1 | 2 | 3 | 4 } : {}),
      });
    }
    if (r.colored !== r.opacity) {
      r.colored = r.opacity;
      if (r.def.plots.some((p) => p.type === 'histogram' && p.colorBy)) this.drawIndicator(r);
    }
  }

  /** Re-applies THEME colours to the price series after a light/dark switch. */
  private recolorMain() {
    const { up, down, accent } = THEME;
    const options: Record<ChartType, object> = {
      candles: { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down },
      heikin: { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down },
      hollow: { downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down },
      bars: { upColor: up, downColor: down },
      line: { color: accent },
      area: { lineColor: accent, topColor: withAlpha(accent, 0.35), bottomColor: withAlpha(accent, 0) },
    };
    this.main.applyOptions(options[this.chartType] as never);
    this.livePrice.update(false);
  }

  private createMainSeries(type: ChartType): ISeriesApi<SeriesType> {
    const { up, down, accent } = THEME;
    // LivePrice draws the last-price line and label (animated), so the library's own stay off.
    const common = { priceLineVisible: false, lastValueVisible: false };
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
        return this.chart.addSeries(AreaSeries, { ...common, lineColor: accent, topColor: withAlpha(accent, 0.35), bottomColor: withAlpha(accent, 0), lineWidth: 2 }, 0);
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
    const params = this.params(r);
    const symbol = this.symbol;
    const ext = externalData(r.def, symbol, () => {
      // Redraw when the outside data arrives, if the chart still shows the same symbol.
      if (this.symbol === symbol && this.indicators.get(r.instance.uid) === r) {
        this.renderAll(r);
        this.onLayout(); // refresh legends (values, or why the data is unavailable)
      }
    });
    const tf = r.instance.timeframe;
    if (!tf || TIMEFRAME_SECONDS[tf] <= TIMEFRAME_SECONDS[this.timeframe]) return r.def.compute(this.bars, params, ext);
    const higher = regroupBars(this.bars, tf);
    const values = r.def.compute(higher, params, ext);
    const keys = Object.keys(values);
    const out: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, []]));
    let j = 0;
    for (const bar of this.bars) {
      const start = bucketStart(bar.time, tf);
      while (j < higher.length - 1 && higher[j].time < start) j++;
      for (const k of keys) out[k].push(values[k][j]);
    }
    return out;
  }

  private renderAll(r: RenderedIndicator, markers = true) {
    r.request = 0;
    r.dirtyFrom = null;
    if (this.runsInWorker(r)) {
      // A heavy indicator on a long history: drawn when the worker is done instead of freezing the page.
      r.values = {};
      this.drawIndicator(r);
      this.computeInWorker(r);
      if (markers) this.refreshMarkers();
      return;
    }
    r.values = this.computeTimed(r);
    this.drawIndicator(r);
    if (markers) this.refreshMarkers();
  }

  private drawIndicator(r: RenderedIndicator) {
    for (const plot of r.def.plots) {
      r.series[plot.key]?.setData(this.bars.map((_, i) => this.point(r, plot, i)) as never);
    }
  }

  private params(r: RenderedIndicator) {
    return { ...defaultParams(r.def), ...r.instance.params, [MARKET_PARAM]: this.market };
  }

  /** A full calculation, timed so the next long history can tell whether it belongs in the worker. */
  private computeTimed(r: RenderedIndicator): Record<string, number[]> {
    const t0 = performance.now();
    const values = this.compute(r);
    if (!r.instance.timeframe && this.bars.length) recordCost(r.def.id, performance.now() - t0, this.bars.length);
    return values;
  }

  private higherTimeframe(r: RenderedIndicator) {
    const tf = r.instance.timeframe;
    return !!tf && TIMEFRAME_SECONDS[tf] > TIMEFRAME_SECONDS[this.timeframe];
  }

  /** The live-tick shortcut (incremental.ts); null when a full calculation is needed. */
  private computeTail(r: RenderedIndicator, start: number): Record<string, number[]> | null {
    if (r.def.external || this.higherTimeframe(r)) return null;
    const params = this.params(r);
    try {
      return tailUpdate((bars) => r.def.compute(bars, params), this.bars, r.values, start, r.tail);
    } catch {
      r.tail.fullOnly = true;
      return null;
    }
  }

  /** Built-in indicators that are slow on this many bars (or not measured yet) run in the worker. */
  private runsInWorker(r: RenderedIndicator): boolean {
    if (!this.useWorker || !indicatorWorker.available || this.bars.length < WORKER_MIN_BARS) return false;
    if (r.def.external || r.def.category === 'My scripts' || this.higherTimeframe(r)) return false;
    const cost = expectedCost(r.def.id, this.bars.length);
    return cost === undefined || cost > HEAVY_MS;
  }

  private computeInWorker(r: RenderedIndicator) {
    const token = (r.request = (r.request % 1e9) + 1);
    const generation = this.dataGeneration;
    const n = this.bars.length;
    r.dirtyFrom = null;
    const job = indicatorWorker.run(this.bars, [{ key: r.instance.uid, defId: r.def.id, params: this.params(r) }]).get(r.instance.uid)!;
    const current = () => !this.disposed && r.request === token && this.dataGeneration === generation && this.indicators.get(r.instance.uid) === r;
    job.then(
      (values) => {
        if (!current()) return;
        r.request = 0;
        // Bars added while it ran keep their previous values until the follow-up calculation lands.
        for (const key of Object.keys(values)) {
          for (let i = n; i < this.bars.length; i++) values[key].push(r.values[key]?.[i] ?? NaN);
        }
        r.values = values;
        this.drawIndicator(r);
        if (r.def.plots.some((p) => p.type === 'marker')) this.refreshMarkers();
        this.onLayout(); // legends show the new values
        if (r.dirtyFrom !== null) this.computeInWorker(r);
      },
      () => {
        if (!current()) return;
        // No worker after all: calculate here.
        r.request = 0;
        r.values = this.computeTimed(r);
        this.drawIndicator(r);
        this.refreshMarkers();
        this.onLayout();
      },
    );
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
      return { time: t, value, color: r.opacity < 1 ? withAlpha(color, r.opacity) : color };
    }
    return { time: t, value };
  }

  /** Collects every visible indicator's signals into arrows/dots on the candles. */
  private refreshMarkers() {
    const list: SeriesMarker<Time>[] = [];
    for (const r of this.indicators.values()) {
      if (!r.instance.visible) continue;
      for (const plot of r.def.plots) {
        if (plot.type !== 'marker' || r.instance.hiddenPlots?.includes(plot.key)) continue;
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
