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

export type SessionPhase = 'pre' | 'regular' | 'post' | 'closed';
const phaseMemo = new Map<number, SessionPhase>();

/**
 * Which part of the US stock day a bar starting at `time` falls in (New York time): pre-market 4:00-9:30, regular
 * 9:30-16:00, after-hours 16:00-20:00, otherwise closed (overnight and weekends). Holidays are not looked up here.
 */
export function sessionPhase(time: number): SessionPhase {
  const hit = phaseMemo.get(time);
  if (hit) return hit;
  const parts = Object.fromEntries(eastern.formatToParts(new Date(time * 1000)).map((p) => [p.type, p.value]));
  const m = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
  const phase: SessionPhase = weekend ? 'closed' : m >= 240 && m < 570 ? 'pre' : m >= 570 && m < 960 ? 'regular' : m >= 960 && m < 1200 ? 'post' : 'closed';
  if (phaseMemo.size > 50000) phaseMemo.clear();
  phaseMemo.set(time, phase);
  return phase;
}

/** Shading colour (with alpha) for a phase, or null for the regular session. Pre-market sky, after-hours copper. */
export function phaseShade(phase: SessionPhase): string | null {
  if (phase === 'pre') return withAlpha(THEME.accent, 0.075);
  if (phase === 'post') return withAlpha(THEME.viz2, 0.08);
  if (phase === 'closed') return withAlpha(THEME.text, 0.05);
  return null;
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
  private readonly views: IPanePrimitivePaneView[] = [
    {
      zOrder: () => 'bottom',
      renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.height)) }),
    },
  ];
  private requestUpdate: (() => void) | null = null;

  constructor(private readonly view: ChartView) {
    view.chart.panes()[0]?.attachPrimitive(this.primitive());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.requestUpdate?.();
  }

  private draw(ctx: CanvasRenderingContext2D, height: number) {
    if (this.enabled) this.drawShading(ctx, height);
  }

  private drawShading(ctx: CanvasRenderingContext2D, height: number) {
    const bars = this.view.visibleBars();
    if (bars.length < 2) return;
    const spacing = this.view.barSpacing();
    // one rectangle per run of bars in the same phase: pre-market, after-hours and overnight each get their own tint
    let run: { phase: SessionPhase; start: number; end: number } | null = null;
    const flush = () => {
      const fill = run && phaseShade(run.phase);
      if (run && fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(run.start - spacing / 2, 0, run.end - run.start + spacing, height);
      }
      run = null;
    };
    for (const b of bars) {
      const x = this.view.timeToX(b.time);
      if (x === null) continue;
      const phase = sessionPhase(b.time);
      if (run && (run as { phase: SessionPhase }).phase !== phase) flush();
      if (run) (run as { end: number }).end = x;
      else run = { phase, start: x, end: x };
    }
    flush();
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
