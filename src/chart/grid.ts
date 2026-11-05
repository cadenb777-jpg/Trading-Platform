/**
 * The square dotted grid (Bloomberg look), drawn by us on every chart instead of the library's grid:
 * - crisp 1-device-pixel dots every 4 CSS pixels, aligned to the screen's pixels (no blurred half-pixel dashes);
 * - horizontal lines at the price axis' own label steps (the library's tick maths, `priceTickSpan`), halved when that
 *   brings the cells closer to square;
 * - vertical lines at calendar boundaries (years, quarters, months, weeks, days; days, hours and minutes intraday),
 *   at the level whose spacing is closest to the horizontal spacing, so the cells come out close to square;
 * - our own time-axis labels at those vertical lines, with the year on a second row under the first label of each year.
 * One controller per chart (attachSquareGrid, called by followTheme for every chart); pure parts are tested.
 */
import { clockText } from './clock';
import type { IChartApi, IPaneApi, IPanePrimitive, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesType, Time } from 'lightweight-charts';

// ---------- Pure maths ----------

/**
 * The price step between axis labels, as Lightweight Charts 5 computes it (PriceTickMarkBuilder.tickSpan): the
 * smallest of three "nice number" ladders whose step is at least one label height apart.
 */
export function priceTickSpan(high: number, low: number, heightPx: number, markHeightPx: number, base: number): number {
  if (!(high > low) || heightPx <= 0) return 0;
  const maxTickSpan = ((high - low) * markHeightPx) / heightPx;
  return Math.min(...[[2, 2.5, 2], [2, 2, 2.5], [2.5, 2, 2]].map((d) => ladder(base, d, high, low, maxTickSpan)));
}

function ladder(base: number, integral: number[], high: number, low: number, maxTickSpan: number): number {
  const eps = 1e-14;
  const ge = (a: number, b: number) => a - b > -eps;
  const minMove = base === 0 ? 0 : 1 / base;
  let span = Math.pow(10, Math.max(0, Math.ceil(Math.log10(high - low))));
  let i = 0;
  let c = integral[0];
  while (ge(span, minMove) && span > minMove + eps && ge(span, maxTickSpan * c) && ge(span, 1)) {
    span /= c;
    c = integral[++i % integral.length];
  }
  if (span <= minMove + eps) span = minMove;
  span = Math.max(1, span);
  if (Math.abs(span - 1) < eps) {
    const fractional = [2, 2.5, 2];
    i = 0;
    c = fractional[0];
    while (ge(span, maxTickSpan * c) && span > minMove + eps) {
      span /= c;
      c = fractional[++i % fractional.length];
    }
  }
  return span;
}

export type Zone = 'utc' | 'local';
export type Level = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'h4' | 'h1' | 'm30' | 'm15' | 'm5' | 'm1';

export const DAILY_LEVELS: Level[] = ['year', 'quarter', 'month', 'week', 'day'];
export const INTRADAY_LEVELS: Level[] = ['year', 'month', 'week', 'day', 'h4', 'h1', 'm30', 'm15', 'm5', 'm1'];

function parts(t: number, zone: Zone) {
  const d = new Date(t * 1000);
  return zone === 'utc'
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }
    : { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), wd: d.getDay() };
}

/** A number that changes exactly when a boundary of `level` is crossed. */
export function levelKey(t: number, level: Level, zone: Zone): number {
  const p = parts(t, zone);
  const day = Date.UTC(p.y, p.mo, p.d) / 86400000; // the zone's calendar day as a day number
  switch (level) {
    case 'year':
      return p.y;
    case 'quarter':
      return p.y * 4 + Math.floor(p.mo / 3);
    case 'month':
      return p.y * 12 + p.mo;
    case 'week':
      return Math.floor((day + 3) / 7); // weeks start on Monday (day 0 = Thursday 1 Jan 1970)
    case 'day':
      return day;
    case 'h4':
      return day * 6 + Math.floor(p.h / 4);
    case 'h1':
      return day * 24 + p.h;
    default: {
      const n = Number(level.slice(1));
      return day * 1440 + Math.floor((p.h * 60 + p.mi) / n);
    }
  }
}

/** Bar indexes in [from, to] where a new `level` period starts (the first bar of the data counts as one). */
export function boundaries(times: number[], from: number, to: number, level: Level, zone: Zone): number[] {
  const out: number[] = [];
  const start = Math.max(0, from);
  const end = Math.min(times.length - 1, to);
  let prev = start > 0 ? levelKey(times[start - 1], level, zone) : NaN;
  for (let i = start; i <= end; i++) {
    const k = levelKey(times[i], level, zone);
    if (k !== prev && i > 0) out.push(i);
    prev = k;
  }
  return out;
}

/**
 * The level whose lines fall closest (on a log scale) to `targetPx` apart, given `pxPerBar`; null when no level has
 * a boundary on screen. Ties go to the coarser level.
 */
export function chooseLevel(times: number[], from: number, to: number, pxPerBar: number, targetPx: number, levels: Level[], zone: Zone): { level: Level; indexes: number[] } | null {
  let best: { level: Level; indexes: number[]; score: number } | null = null;
  const bars = Math.max(1, to - from);
  for (const level of levels) {
    const indexes = boundaries(times, from, to, level, zone);
    if (!indexes.length) continue;
    const spacing = (bars * pxPerBar) / indexes.length;
    const score = Math.abs(Math.log(spacing / targetPx));
    if (!best || score < best.score - 1e-9) best = { level, indexes, score };
    if (spacing < targetPx / 3) break; // finer levels only get denser
  }
  return best && { level: best.level, indexes: best.indexes };
}

const fmtMonth = new Map<Zone, Intl.DateTimeFormat>();
const fmtMonthDay = new Map<Zone, Intl.DateTimeFormat>();
const fmt = (cache: Map<Zone, Intl.DateTimeFormat>, zone: Zone, o: Intl.DateTimeFormatOptions) => {
  let f = cache.get(zone);
  if (!f) cache.set(zone, (f = new Intl.DateTimeFormat('en-US', { ...o, ...(zone === 'utc' ? { timeZone: 'UTC' } : {}) })));
  return f;
};

/** The label for a vertical line: the year, a month, a date ("Nov 10") or a clock time (12- or 24-hour, clock.ts). */
export function gridLabel(t: number, level: Level, zone: Zone): string {
  if (level === 'year') return String(parts(t, zone).y);
  if (level === 'quarter' || level === 'month') return fmt(fmtMonth, zone, { month: 'short' }).format(t * 1000);
  if (level === 'week' || level === 'day') return fmt(fmtMonthDay, zone, { month: 'short', day: 'numeric' }).format(t * 1000);
  const p = parts(t, zone);
  return clockText(p.h, p.mi);
}

/** Year row: which labels (by position in the list) get the year under them: the first, then each new year. */
export function yearRow(times: number[], zone: Zone): { at: number; year: number }[] {
  const out: { at: number; year: number }[] = [];
  let year = NaN;
  times.forEach((t, i) => {
    const y = parts(t, zone).y;
    if (y !== year) out.push({ at: i, year: y });
    year = y;
  });
  return out;
}

/** '2024-01-05', a BusinessDay or unix seconds -> unix seconds. */
export function timeToUnix(t: Time): number {
  if (typeof t === 'number') return t;
  if (typeof t === 'string') return Date.parse(`${t}T00:00:00Z`) / 1000;
  return Date.UTC(t.year, t.month - 1, t.day) / 1000;
}

/** Daily or longer data (median gap of 20 hours or more): dates are read in UTC. */
export function isDaily(times: number[]): boolean {
  if (times.length < 2) return true;
  const gaps: number[] = [];
  for (let i = Math.max(1, times.length - 60); i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] >= 20 * 3600;
}

// ---------- Drawing ----------

/** Dot pitch in CSS pixels. */
const PITCH = 4;

interface Layout {
  key: string;
  /** Vertical line x positions (CSS px) and their labels. */
  xs: number[];
  labelTimes: number[];
  level: Level;
  zone: Zone;
  /** Pixels between horizontal lines in the price pane (for squaring the other panes). */
  cell: number;
}

export interface SquareGridOptions {
  color: () => string;
}

const panesWithGrid = new WeakSet<HTMLElement>();

class SquareGrid {
  private times: number[] = [];
  private timesDirty = true;
  private daily = true;
  private source: ISeriesApi<SeriesType> | null = null;
  private layout: Layout | null = null;
  private readonly labels: ISeriesPrimitive<Time>;
  private labelHost: ISeriesApi<SeriesType> | null = null;
  private scheduled = false;
  private readonly onData = () => (this.timesDirty = true);

  constructor(
    private readonly chart: IChartApi,
    private readonly opts: SquareGridOptions,
  ) {
    const self = this;
    this.labels = {
      timeAxisPaneViews: () => [self.view((ctx, size) => self.drawLabels(ctx, size.width, size.height))],
    } as ISeriesPrimitive<Time>;
    this.ensure();
    // New data, panes or series: re-check on the next frame (cheap when nothing changed).
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => this.scheduleEnsureIfNeeded());
    chart.timeScale().subscribeSizeChange(() => this.scheduleEnsureIfNeeded());
  }

  private view(draw: (ctx: CanvasRenderingContext2D, size: { width: number; height: number }, hpr: number, vpr: number) => void, bitmap = false): IPrimitivePaneView {
    return {
      zOrder: () => 'bottom',
      renderer: () => ({
        draw: (target) =>
          bitmap
            ? target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => draw(context, bitmapSize, horizontalPixelRatio, verticalPixelRatio))
            : target.useMediaCoordinateSpace(({ context, mediaSize }) => draw(context, mediaSize, 1, 1)),
      }),
    };
  }

  /** Attaches to panes added since, and keeps the time labels on a series that is still on the chart. */
  ensure() {
    this.scheduled = false;
    let panes: IPaneApi<Time>[];
    try {
      panes = this.chart.panes();
    } catch {
      return; // chart removed
    }
    for (const pane of panes) {
      const el = pane.getHTMLElement();
      if (!el || panesWithGrid.has(el)) continue;
      panesWithGrid.add(el);
      const primitive: IPanePrimitive<Time> = { paneViews: () => [this.view((ctx, size, hpr, vpr) => this.drawPane(pane, ctx, size, hpr, vpr), true)] };
      pane.attachPrimitive(primitive);
    }
    const first = panes[0]?.getSeries()[0] ?? null;
    if (first && first !== this.labelHost) {
      try {
        this.labelHost?.detachPrimitive(this.labels);
      } catch {
        // its series is gone
      }
      first.attachPrimitive(this.labels);
      this.labelHost = first;
    }
    if (first !== this.source) {
      try {
        this.source?.unsubscribeDataChanged(this.onData);
      } catch {
        // gone
      }
      this.source = first;
      first?.subscribeDataChanged(this.onData);
      this.timesDirty = true;
    }
  }

  private scheduleEnsure() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => this.ensure());
  }

  private readTimes(): number[] {
    if (!this.timesDirty || !this.source) return this.times;
    this.timesDirty = false;
    try {
      this.times = this.source.data().map((d) => timeToUnix(d.time));
    } catch {
      this.times = [];
    }
    this.daily = isDaily(this.times);
    return this.times;
  }

  /** Horizontal line prices for a pane: the axis label step, or half of it when that is closer to `cell` px. */
  private hLines(pane: IPaneApi<Time>, height: number, cell: number | null): { ys: number[]; spanPx: number } {
    const series = pane.getSeries().find((s) => (s.options().priceScaleId ?? 'right') === 'right' && s.options().visible) ?? pane.getSeries()[0];
    if (!series) return { ys: [], spanPx: 0 };
    const top = series.coordinateToPrice(0);
    const bottom = series.coordinateToPrice(height - 1);
    if (top === null || bottom === null) return { ys: [], spanPx: 0 };
    const high = Math.max(top as number, bottom as number);
    const low = Math.min(top as number, bottom as number);
    const layout = this.chart.options().layout;
    const density = series.priceScale().options().tickMarkDensity ?? 2.5;
    const pf = series.options().priceFormat as { type: string; minMove?: number; precision?: number };
    const minMove = pf.minMove ?? (pf.type === 'volume' ? 1 : pf.precision !== undefined ? 10 ** -pf.precision : 0.01);
    const base = Math.round(1 / minMove);
    const span = priceTickSpan(high, low, height, Math.ceil(layout.fontSize * density), base);
    if (!span) return { ys: [], spanPx: 0 };
    const spanPx = (span / (high - low)) * height;
    const step = cell && Math.abs(Math.log(spanPx / 2 / cell)) < Math.abs(Math.log(spanPx / cell)) && spanPx / 2 >= 14 ? span / 2 : span;
    const ys: number[] = [];
    for (let p = Math.ceil(low / step) * step; p <= high; p += step) {
      const y = series.priceToCoordinate(p);
      if (y !== null) ys.push(y);
      if (ys.length > 200) break;
    }
    return { ys, spanPx };
  }

  private computeLayout(pane0: IPaneApi<Time>, width: number, height: number): Layout | null {
    const ts = this.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    const times = this.readTimes();
    if (!range || !times.length) return null;
    const { spanPx } = this.hLines(pane0, height, null);
    const key = `${range.from.toFixed(3)}:${range.to.toFixed(3)}:${width}:${height}:${times.length}:${spanPx.toFixed(1)}`;
    if (this.layout?.key === key) return this.layout;
    const from = Math.max(0, Math.ceil(range.from));
    const to = Math.min(times.length - 1, Math.floor(range.to));
    const zone: Zone = this.daily ? 'utc' : 'local';
    const pxPerBar = to > from ? ((ts.logicalToCoordinate(to as never) ?? 0) - (ts.logicalToCoordinate(from as never) ?? 0)) / (to - from) : ts.options().barSpacing;
    const pick = chooseLevel(times, from, to, pxPerBar, spanPx || 60, this.daily ? DAILY_LEVELS : INTRADAY_LEVELS, zone);
    const xs: number[] = [];
    const labelTimes: number[] = [];
    for (const i of pick?.indexes ?? []) {
      // between the period's first bar and the bar before (the library maps whole bar indexes only)
      const x = ts.logicalToCoordinate(i as never);
      if (x === null) continue;
      xs.push(x - pxPerBar / 2);
      labelTimes.push(times[i]);
    }
    const cell = xs.length > 1 ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) : spanPx;
    // Past the data (the empty space right of the last candle, or left of the first) there are no calendar
    // boundaries: carry the lines on at the same spacing so the cells stay square there too (no labels).
    if (xs.length && cell >= 8) {
      const dataEnd = (ts.logicalToCoordinate((times.length - 1) as never) ?? width) + pxPerBar / 2;
      for (let x = xs[xs.length - 1] + cell; x < width; x += cell) if (x > dataEnd) (xs.push(x), labelTimes.push(NaN));
      const dataStart = (ts.logicalToCoordinate(0 as never) ?? 0) - pxPerBar / 2;
      const before: number[] = [];
      for (let x = xs[0] - cell; x > 0; x -= cell) if (x < dataStart) before.unshift(x);
      xs.unshift(...before);
      labelTimes.unshift(...before.map(() => NaN));
    }
    this.layout = { key, xs, labelTimes, level: pick?.level ?? 'day', zone, cell };
    // for checks: the cell size in CSS pixels (horizontal x vertical spacing)
    try {
      this.chart.chartElement().dataset.gridCell = `${Math.round(cell)}x${Math.round(this.hLines(pane0, height, cell).ys.reduce((d, y, i, a) => (i ? Math.min(d, Math.abs(y - a[i - 1])) : d), Infinity))}`;
    } catch {
      // ignore
    }
    return this.layout;
  }

  private drawPane(pane: IPaneApi<Time>, ctx: CanvasRenderingContext2D, bitmap: { width: number; height: number }, hpr: number, vpr: number) {
    if (pane.paneIndex() === 0) this.scheduleEnsureIfNeeded();
    const width = bitmap.width / hpr;
    const height = bitmap.height / vpr;
    const pane0 = this.chart.panes()[0];
    const layout = pane0 ? this.computeLayout(pane0, width, pane0.getHeight()) : null;
    const { ys } = this.hLines(pane, height, layout?.cell ?? null);
    const dot = Math.max(1, Math.round(hpr));
    const pitchX = Math.max(2, Math.round(PITCH * hpr));
    const pitchY = Math.max(2, Math.round(PITCH * vpr));
    ctx.save();
    ctx.fillStyle = this.opts.color();
    ctx.beginPath();
    for (const y of ys) {
      const yb = Math.round(y * vpr);
      for (let x = 0; x < bitmap.width; x += pitchX) ctx.rect(x, yb, dot, dot);
    }
    for (const x of layout?.xs ?? []) {
      const xb = Math.round(x * hpr);
      if (xb < 0 || xb >= bitmap.width) continue;
      for (let y = 0; y < bitmap.height; y += pitchY) ctx.rect(xb, y, dot, dot);
    }
    ctx.fill();
    ctx.restore();
  }

  private scheduleEnsureIfNeeded() {
    const panes = this.chart.panes();
    const first = panes[0]?.getSeries()[0] ?? null;
    if (first !== this.labelHost || panes.some((p) => !panesWithGrid.has(p.getHTMLElement()!))) this.scheduleEnsure();
  }

  /** Our time-axis labels at the vertical lines, and the year row under the first label of each year. */
  private drawLabels(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const layout = this.layout;
    if (!layout) return;
    const o = this.chart.options().layout;
    const size = o.fontSize;
    ctx.save();
    ctx.font = `${size}px ${o.fontFamily}`;
    ctx.fillStyle = o.textColor;
    ctx.textBaseline = 'top';
    const placed: { x: number; t: number }[] = [];
    let right = -Infinity;
    layout.xs.forEach((x, i) => {
      if (!Number.isFinite(layout.labelTimes[i])) return; // a line carried past the data
      const text = gridLabel(layout.labelTimes[i], layout.level, layout.zone);
      const w = ctx.measureText(text).width;
      const left = Math.round(x - w / 2);
      if (left < 2 || left + w > width - 2 || left < right + 10) return;
      ctx.fillText(text, left, 6);
      right = left + w;
      placed.push({ x: left, t: layout.labelTimes[i] });
    });
    // the year row (daily-type levels only: intraday charts use that row for the session times, axisChrome.ts)
    if (layout.zone === 'utc' && layout.level !== 'year' && height >= size * 2 + 10) {
      ctx.font = `600 ${size - 2}px ${o.fontFamily}`;
      ctx.globalAlpha = 0.8;
      for (const { at, year } of yearRow(placed.map((p) => p.t), layout.zone)) ctx.fillText(String(year), placed[at].x, 8 + size);
    }
    ctx.restore();
  }
}

/**
 * Puts the square dotted grid (and our time-axis labels) on a chart, replacing the library's grid and labels.
 * Safe to call once per chart; panes added later get the grid on the next frame.
 */
export function attachSquareGrid(chart: IChartApi, opts: SquareGridOptions) {
  chart.applyOptions({
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    timeScale: { tickMarkFormatter: () => '', ticksVisible: false, minimumHeight: Math.max(chart.options().timeScale.minimumHeight ?? 0, chart.options().layout.fontSize * 2 + 16) },
  });
  return new SquareGrid(chart, opts);
}
