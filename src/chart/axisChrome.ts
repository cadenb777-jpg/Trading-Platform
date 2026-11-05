/**
 * Our own drawing on top of the chart library, so the chart reads as the platform's and not as a stock library chart:
 * - the last-price tag on the price axis (a bold rounded tag, green or red by the last candle, no flashing),
 * - on intraday stock charts, thin lines at each regular-session open (green) and close (red), and the session
 *   times on the time axis in colour: pre-market start (sky), open (green), close (red), after-hours end (copper).
 * One series primitive on the main series (ChartView moves it when the chart type changes).
 */
import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { THEME } from '../ui/theme';
import { withAlpha } from './frame';
import { dayKey } from './range';
import { sessionPhase } from './session';
import { clockText } from './clock';
import type { Bar } from '../types';

/** Digits from a font with equal-width figures (see chartFeel.css), everything else in Inter. */
export const CHART_FONT = "'TP Figures', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export interface ChromeHost {
  bars(): Bar[];
  /** Session separators apply (intraday stock bars). */
  sessions(): boolean;
  formatPrice(p: number): string;
  priceToY(p: number): number | null;
  indexToX(i: number): number | null;
  visibleRange(): { from: number; to: number } | null;
}

type Ctx = CanvasRenderingContext2D;

interface SessionMark {
  /** The first bar of the new part of the day. */
  i: number;
  kind: 'pre' | 'open' | 'close' | 'postEnd';
  t: number;
}

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
  private readonly timeAxis = [view((c, w, h) => this.drawSessionTimes(c, w, h))];
  /** Session changes in the bars, recomputed only when the data changes. */
  private sessionCache: { key: string; marks: SessionMark[] } | null = null;

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

  /** Where the session changes: pre-market starts, the regular session opens and closes, after-hours ends. */
  private marks(): SessionMark[] {
    const bars = this.host.bars();
    const key = `${bars.length}:${bars[0]?.time}:${bars[bars.length - 1]?.time}`;
    if (this.sessionCache?.key === key) return this.sessionCache.marks;
    const marks: SessionMark[] = [];
    for (let i = 1; i < bars.length; i++) {
      const a = sessionPhase(bars[i - 1].time);
      const b = sessionPhase(bars[i].time);
      const newDay = dayKey(bars[i].time, 'America/New_York') !== dayKey(bars[i - 1].time, 'America/New_York');
      if (b === 'regular' && (a !== 'regular' || newDay)) marks.push({ i, kind: 'open', t: bars[i].time });
      else if (a === 'regular' && b !== 'regular') marks.push({ i, kind: 'close', t: bars[i].time });
      else {
        if (a === 'post' && b !== 'post') marks.push({ i, kind: 'postEnd', t: bars[i].time });
        if (b === 'pre' && a !== 'pre') marks.push({ i, kind: 'pre', t: bars[i].time });
      }
    }
    this.sessionCache = { key, marks };
    return marks;
  }

  private markX(i: number): number | null {
    const here = this.host.indexToX(i);
    const before = this.host.indexToX(i - 1);
    return here === null || before === null ? null : (here + before) / 2;
  }

  /** Thin lines at each regular-session open (green) and close (red) on intraday stock charts. */
  private drawSessions(ctx: Ctx, _width: number, height: number) {
    if (!this.host.sessions()) return;
    const range = this.host.visibleRange();
    if (!range || this.host.bars().length < 2) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const m of this.marks()) {
      if (m.kind !== 'open' && m.kind !== 'close') continue;
      if (m.i < range.from - 1 || m.i > range.to + 1) continue;
      const x = this.markX(m.i);
      if (x === null) continue;
      ctx.strokeStyle = withAlpha(m.kind === 'open' ? THEME.up : THEME.down, 0.4);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The session times on the time axis, second row, in their colours (skipped where they would overlap). */
  private drawSessionTimes(ctx: Ctx, width: number, height: number) {
    if (!this.host.sessions() || height < 34) return;
    const range = this.host.visibleRange();
    if (!range) return;
    // zoomed far out (many days on screen) the times would only crowd the axis
    const opens = this.marks().filter((m) => m.kind === 'open' && m.i >= range.from && m.i <= range.to).length;
    if (opens > width / 140) return;
    const colour: Record<SessionMark['kind'], string> = { pre: THEME.accent, open: THEME.up, close: THEME.down, postEnd: THEME.viz2 };
    ctx.save();
    ctx.font = `600 11.5px ${CHART_FONT}`;
    ctx.textBaseline = 'top';
    let right = -Infinity;
    for (const m of this.marks()) {
      if (m.i < range.from || m.i > range.to) continue;
      const x = this.markX(m.i);
      if (x === null) continue;
      const d = new Date(m.t * 1000);
      const text = clockText(d.getHours(), d.getMinutes());
      const w = ctx.measureText(text).width;
      const left = Math.round(x - w / 2);
      if (left < 2 || left + w > width - 2 || left < right + 8) continue;
      ctx.fillStyle = colour[m.kind];
      ctx.fillRect(Math.round(x), 0, 1, 4); // a tick up to the line
      ctx.fillText(text, left, height - 16);
      right = left + w;
    }
    ctx.restore();
  }
}
