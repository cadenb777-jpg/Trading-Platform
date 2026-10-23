/** US stock market sessions (Eastern time): pre-market 4:00-9:30, regular 9:30-16:00, after-hours 16:00-20:00. */
import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Bar } from '../types';
import type { ChartView } from './ChartView';

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

/** Shades pre-market and after-hours bars so they stand apart from the regular session. */
export class SessionShading {
  private enabled = false;
  private requestUpdate: (() => void) | null = null;

  constructor(private readonly view: ChartView) {
    view.attachPrimitive(this.primitive());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.requestUpdate?.();
  }

  private draw(ctx: CanvasRenderingContext2D, height: number) {
    if (!this.enabled) return;
    const bars = this.view.visibleBars();
    if (bars.length < 2) return;
    const spacing = this.view.barSpacing();
    ctx.fillStyle = 'rgba(120, 123, 134, 0.09)';
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

  private primitive(): ISeriesPrimitive<Time> {
    return {
      attached: ({ requestUpdate }: SeriesAttachedParameter<Time>) => {
        this.requestUpdate = requestUpdate;
      },
      detached: () => {
        this.requestUpdate = null;
      },
      paneViews: () => [
        {
          zOrder: () => 'bottom',
          renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.height)) }),
        },
      ],
    };
  }
}
