/**
 * Our own drawing on top of the chart library, so the chart reads as the platform's and not as a stock library chart:
 * - the last-price tag on the price axis (a bold rounded tag, green or red by the last candle, no flashing),
 * - the year row under the time axis labels (yearMarks in axis.ts),
 * - thin session separators at each New York day open on intraday stock charts.
 * One series primitive on the main series (ChartView moves it when the chart type changes).
 */
import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { THEME } from '../ui/theme';
import type { AxisOptions } from './axis';
import { yearMarks } from './axis';
import { withAlpha } from './frame';
import { dayKey } from './range';
import type { Bar } from '../types';

/** Digits from a font with equal-width figures (see chartFeel.css), everything else in Inter. */
export const CHART_FONT = "'TP Figures', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export interface ChromeHost {
  bars(): Bar[];
  axis(): AxisOptions;
  /** Session separators apply (intraday stock bars). */
  sessions(): boolean;
  formatPrice(p: number): string;
  priceToY(p: number): number | null;
  indexToX(i: number): number | null;
  visibleRange(): { from: number; to: number } | null;
}

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const view = (draw: (ctx: Ctx, width: number, height: number) => void, zOrder: 'bottom' | 'normal' | 'top' = 'normal'): IPrimitivePaneView => ({
  zOrder: () => zOrder,
  renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => draw(context, mediaSize.width, mediaSize.height)) }),
});

export class ChartChrome implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private readonly pane = [view((c, w, h) => this.drawSessions(c, w, h), 'bottom')];
  private readonly priceAxis = [view((c, w) => this.drawLastTag(c, w))];
  private readonly timeAxis = [view((c, w, h) => this.drawYears(c, w, h))];
  /** Day keys of the bars, recomputed only when the data changes. */
  private sessionCache: { key: string; starts: number[] } | null = null;
  private times: number[] = [];
  private timesFor: Bar[] | null = null;

  constructor(private readonly host: ChromeHost) {}

  attached({ requestUpdate }: SeriesAttachedParameter<Time>) {
    this.requestUpdate = requestUpdate;
  }
  detached() {
    this.requestUpdate = null;
  }
  update() {
    this.requestUpdate?.();
  }
  paneViews() {
    return this.pane;
  }
  priceAxisPaneViews() {
    return this.priceAxis;
  }
  timeAxisPaneViews() {
    return this.timeAxis;
  }

  /** The last price in a bold tag: green while the latest candle is up, red while it is down. */
  private drawLastTag(ctx: Ctx, width: number) {
    const bars = this.host.bars();
    const last = bars[bars.length - 1];
    if (!last) return;
    const y = this.host.priceToY(last.close);
    if (y === null) return;
    const up = last.close >= last.open;
    const text = this.host.formatPrice(last.close);
    ctx.save();
    ctx.font = `600 13px ${CHART_FONT}`;
    const h = 20;
    const top = Math.round(y - h / 2);
    roundRect(ctx, 2, top, width - 4, h, 4);
    ctx.fillStyle = up ? THEME.up : THEME.down;
    ctx.fill();
    ctx.fillStyle = THEME.onFill;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 9, top + h / 2 + 0.5);
    ctx.restore();
  }

  /** The year under the first label of each year (and at the left edge for the first year on screen). */
  private drawYears(ctx: Ctx, width: number, height: number) {
    const range = this.host.visibleRange();
    const bars = this.host.bars();
    if (!range || !bars.length || this.host.axis().years) return;
    if (this.timesFor !== bars || this.times.length !== bars.length) {
      this.timesFor = bars;
      this.times = bars.map((b) => b.time);
    }
    const times = this.times;
    const marks = yearMarks(times, range.from, range.to, this.host.axis());
    ctx.save();
    ctx.font = `600 11px ${CHART_FONT}`;
    ctx.fillStyle = withAlpha(THEME.text, 0.75);
    ctx.textBaseline = 'bottom';
    const placed: { x: number; edge: boolean }[] = [];
    for (const m of marks) {
      const x = this.host.indexToX(m.index);
      if (x === null) continue;
      placed.push({ x: m.edge ? 6 : x, edge: m.edge });
    }
    let right = -Infinity;
    marks.forEach((m, i) => {
      const p = placed[i];
      if (!p) return;
      const next = placed[i + 1];
      if (p.edge && next && next.x - p.x < 56) return; // a real year boundary right beside the edge says it already
      const text = String(m.year);
      const w = ctx.measureText(text).width;
      const x = p.edge ? p.x : Math.min(width - w - 2, Math.max(2, p.x - w / 2));
      if (x < right + 12) return; // never overlap the year before
      right = x + w;
      ctx.fillText(text, x, height - 3);
    });
    ctx.restore();
  }

  /** A thin vertical line where each New York trading day opens (intraday stock charts). */
  private drawSessions(ctx: Ctx, _width: number, height: number) {
    if (!this.host.sessions()) return;
    const bars = this.host.bars();
    const range = this.host.visibleRange();
    if (!range || bars.length < 2) return;
    const key = `${bars.length}:${bars[0].time}:${bars[bars.length - 1].time}`;
    if (this.sessionCache?.key !== key) {
      const starts: number[] = [];
      let prev = '';
      bars.forEach((b, i) => {
        const k = dayKey(b.time, 'America/New_York');
        if (k !== prev && i > 0) starts.push(i);
        prev = k;
      });
      this.sessionCache = { key, starts };
    }
    ctx.save();
    ctx.strokeStyle = withAlpha(THEME.crosshair, 0.45);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const i of this.sessionCache.starts) {
      if (i < range.from - 1 || i > range.to + 1) continue;
      const x = this.host.indexToX(i - 0.5);
      if (x === null) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
      ctx.stroke();
    }
    ctx.restore();
  }
}
