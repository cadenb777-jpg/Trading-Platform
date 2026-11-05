/** US stock market sessions (Eastern time): pre-market 4:00-9:30, regular 9:30-16:00, after-hours 16:00-20:00. */
import type { IPanePrimitive, IPanePrimitivePaneView, PaneAttachedParameter, Time } from 'lightweight-charts';
import { sessionDay } from '../indicators/session';
import type { Bar } from '../types';
import { THEME } from '../ui/theme';
import type { ChartView } from './ChartView';
import { withAlpha } from './frame';

const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
const memo = new Map<number, boolean>();

/** True when a bar starting at `time` (UTC seconds) is inside regular trading hours on a weekday. */
export function isRegularHours(time: number): boolean {
  const hit = memo.get(time);
  if (hit !== undefined) return hit;
  const parts = Object.fromEntries(eastern.formatToParts(new Date(time * 1000)).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const regular = parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && minutes >= 570 && minutes < 960;
  if (memo.size > 50000) memo.clear();
  memo.set(time, regular);
  return regular;
}

/** Keeps only regular-hours bars (for when extended hours are switched off). */
export function regularHoursOnly(bars: Bar[]): Bar[] {
  return bars.filter((b) => isRegularHours(b.time));
}

/**
 * Guide prices for the session of the last bar ("today" = its New York day): today's regular-hours open, and the
 * regular-hours close of the session before. Before today's 9:30 open (pre-market, overnight, a weekend or holiday
 * gap) there is no open yet, and Prev close is the last regular close. Null where the bars don't reach that far.
 */
export function sessionGuides(barAt: (i: number) => Bar | undefined, count: number): { todayOpen: number | null; prevClose: number | null } {
  const ny = { _market: 'schwab' };
  const last = barAt(count - 1);
  if (!last) return { todayOpen: null, prevClose: null };
  const today = sessionDay(last.time, ny);
  let todayOpen: number | null = null;
  for (let i = count - 1; i >= 0; i--) {
    const b = barAt(i)!;
    if (!isRegularHours(b.time)) continue;
    if (sessionDay(b.time, ny) === today) todayOpen = b.open;
    else return { todayOpen, prevClose: b.close };
  }
  return { todayOpen, prevClose: null };
}

/**
 * Shades pre-market and after-hours bars so they stand apart from the regular session, and marks the previous
 * close and today's open with faint guide lines. A pane primitive on the price pane, so it stays put when the chart
 * type (main series) changes.
 */
export class SessionShading {
  private enabled = false;
  private guides = false;
  private readonly views: IPanePrimitivePaneView[] = [
    {
      zOrder: () => 'bottom',
      renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width, mediaSize.height)) }),
    },
  ];
  private requestUpdate: (() => void) | null = null;
  private cache: { key: string; value: ReturnType<typeof sessionGuides> } | null = null;

  constructor(private readonly view: ChartView) {
    view.chart.panes()[0]?.attachPrimitive(this.primitive());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.requestUpdate?.();
  }

  /** Prev close / today's open lines, for intraday stock charts (with or without extended hours). */
  setGuides(on: boolean) {
    this.guides = on;
    this.requestUpdate?.();
  }

  private draw(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.enabled) this.drawShading(ctx, height);
    if (this.guides) this.drawGuides(ctx, width);
  }

  private drawShading(ctx: CanvasRenderingContext2D, height: number) {
    const bars = this.view.visibleBars();
    if (bars.length < 2) return;
    const spacing = this.view.barSpacing();
    ctx.fillStyle = withAlpha(THEME.text, 0.045);
    let runStart: number | null = null;
    let runEnd = 0;
    const flush = () => {
      if (runStart === null) return;
      ctx.fillRect(runStart - spacing / 2, 0, runEnd - runStart + spacing, height);
      runStart = null;
    };
    for (const b of bars) {
      const x = this.view.timeToX(b.time);
      if (x === null) continue;
      if (isRegularHours(b.time)) flush();
      else {
        runStart ??= x;
        runEnd = x;
      }
    }
    flush();
  }

  private drawGuides(ctx: CanvasRenderingContext2D, width: number) {
    const n = this.view.barCount;
    const last = this.view.barAt(n - 1);
    if (!last) return;
    const key = `${n}:${this.view.barAt(0)?.time}:${last.time}`;
    if (this.cache?.key !== key) this.cache = { key, value: sessionGuides((i) => this.view.barAt(i), n) };
    const { prevClose, todayOpen } = this.cache.value;
    ctx.save();
    ctx.font = "11px 'Inter', -apple-system, sans-serif";
    ctx.textBaseline = 'bottom';
    ctx.setLineDash([1, 4]);
    ctx.lineWidth = 1;
    const color = withAlpha(THEME.crosshair, 0.7);
    const lines: { y: number; text: string }[] = [];
    const yOf = (p: number | null) => (p === null ? null : this.view.priceToY(p));
    const yOpen = yOf(todayOpen);
    const yPrev = yOf(prevClose);
    for (const y of [yOpen, yPrev]) {
      if (y === null) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.stroke();
    }
    // Labels closer than 14px would overlap: one merged label instead.
    if (yOpen !== null && yPrev !== null && Math.abs(yOpen - yPrev) < 14) {
      const [o, p] = [this.view.formatPrice(todayOpen!), this.view.formatPrice(prevClose!)];
      lines.push({ y: Math.min(yOpen, yPrev), text: o === p ? `Open/Prev ${o}` : `Open ${o} · Prev ${p}` });
    } else {
      if (yPrev !== null) lines.push({ y: yPrev, text: `Prev close ${this.view.formatPrice(prevClose!)}` });
      if (yOpen !== null) lines.push({ y: yOpen, text: `Open ${this.view.formatPrice(todayOpen!)}` });
    }
    ctx.fillStyle = withAlpha(THEME.text, 0.55);
    // At the pane's right edge (inside it, never on the price scale where it would cover the scale's own labels).
    for (const { y, text } of lines) ctx.fillText(text, width - ctx.measureText(text).width - 8, y - 2);
    ctx.restore();
  }

  private primitive(): IPanePrimitive<Time> {
    return {
      attached: ({ requestUpdate }: PaneAttachedParameter<Time>) => {
        this.requestUpdate = requestUpdate;
      },
      detached: () => {
        this.requestUpdate = null;
      },
      paneViews: () => this.views,
    };
  }
}
