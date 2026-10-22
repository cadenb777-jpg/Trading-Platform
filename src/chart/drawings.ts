/**
 * Drawing tools (trend lines, Fibonacci, etc.). Drawings are stored as time + price points so
 * they stay in place when you zoom, scroll or change timeframe, and are drawn on the chart's
 * canvas through a Lightweight Charts "primitive".
 */
import type { IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { ChartView } from './ChartView';

export type DrawingType = 'trend' | 'ray' | 'hline' | 'vline' | 'rect' | 'fib' | 'long' | 'short';
export type Tool = DrawingType | 'cursor';

export interface DrawingPoint {
  time: number;
  price: number;
}

/**
 * A drawing's points. Long/short positions store [entry, target, stop]; target and stop share
 * the time where the position box ends.
 */
export interface Drawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  color: string;
}

export const DRAWING_TOOLS: { id: Tool; label: string; shortcut?: string }[] = [
  { id: 'cursor', label: 'Cursor', shortcut: 'Esc' },
  { id: 'trend', label: 'Trend line' },
  { id: 'ray', label: 'Ray' },
  { id: 'hline', label: 'Horizontal line' },
  { id: 'vline', label: 'Vertical line' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'fib', label: 'Fib retracement' },
  { id: 'long', label: 'Long position (take profit & stop loss)' },
  { id: 'short', label: 'Short position (take profit & stop loss)' },
];

/** Clicks needed to place each drawing. */
const POINTS: Record<DrawingType, number> = { trend: 2, ray: 2, hline: 1, vline: 1, rect: 2, fib: 2, long: 1, short: 1 };
const DEFAULT_COLOR: Record<DrawingType, string> = {
  trend: '#2962ff',
  ray: '#2962ff',
  hline: '#f7a600',
  vline: '#9c27b0',
  rect: '#26a69a',
  fib: '#787b86',
  long: '#26a69a',
  short: '#ef5350',
};
const PROFIT = '#26a69a';
const LOSS = '#ef5350';
/** New positions span this many bars, with the stop this many pixels from entry and a 2:1 target. */
const POSITION_BARS = 25;
const POSITION_RISK_PX = 40;
const FIB_LEVELS: [number, string][] = [
  [0, '#787b86'],
  [0.236, '#f23645'],
  [0.382, '#ff9800'],
  [0.5, '#4caf50'],
  [0.618, '#089981'],
  [0.786, '#2962ff'],
  [1, '#787b86'],
];
const HIT = 6;
const HANDLE = 7;

interface Screen {
  x: number;
  y: number;
}

interface Hit {
  id: string;
  /** Index of the grabbed point, or -1 when the whole drawing is grabbed. */
  handle: number;
}

const newId = () => Math.random().toString(36).slice(2, 10);

function distToSegment(p: Screen, a: Screen, b: Screen): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A far-away point along the line from a through b, used to draw rays to the chart edge. */
function extend(a: Screen, b: Screen): Screen {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = 100000 / Math.max(Math.abs(dx), Math.abs(dy), 1);
  return { x: a.x + dx * k, y: a.y + dy * k };
}

const fibPrice = (d: Drawing, level: number) => d.points[1].price + (d.points[0].price - d.points[1].price) * level;
const isPosition = (d: Drawing) => d.type === 'long' || d.type === 'short';

/** Risk/reward numbers for a long or short position drawing. */
export function positionStats(d: Drawing) {
  const [entry, target, stop] = d.points.map((p) => p.price);
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  return {
    targetPct: ((target - entry) / entry) * 100,
    stopPct: ((stop - entry) / entry) * 100,
    ratio: risk ? reward / risk : 0,
  };
}

export class DrawingManager {
  drawings: Drawing[] = [];
  tool: Tool = 'cursor';
  magnet = false;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private draft: Drawing | null = null;
  private draftStart: Screen | null = null;
  private drag: { hit: Hit; start: Screen; original: Screen[] } | null = null;
  private consuming = false;
  private requestUpdate: (() => void) | null = null;

  /** Called after drawings are added, moved or removed, so they can be saved. */
  onChange: (drawings: Drawing[]) => void = () => {};
  /** Called when the active tool changes (e.g. back to the cursor after drawing). */
  onToolChange: (tool: Tool) => void = () => {};

  constructor(
    private readonly view: ChartView,
    private readonly container: HTMLElement,
  ) {
    view.attachPrimitive(this.primitive());
    const capture = { capture: true };
    container.addEventListener('pointerdown', (e) => this.onPointerDown(e), capture);
    // The chart listens to mouse and touch events; stop them reaching it while we handle a drawing.
    for (const type of ['mousedown', 'touchstart'] as const) {
      container.addEventListener(type, (e) => this.consuming && e.stopPropagation(), { capture: true, passive: true });
    }
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  get selected(): Drawing | undefined {
    return this.drawings.find((d) => d.id === this.selectedId);
  }

  setDrawings(drawings: Drawing[]) {
    this.drawings = drawings;
    this.selectedId = null;
    this.hoverId = null;
    this.draft = null;
    this.redraw();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.draft = null;
    this.container.style.cursor = tool === 'cursor' ? '' : 'crosshair';
    this.onToolChange(tool);
    this.redraw();
  }

  deleteSelected(): boolean {
    if (!this.selectedId) return false;
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
    this.selectedId = null;
    this.changed();
    return true;
  }

  clearAll() {
    this.drawings = [];
    this.selectedId = null;
    this.changed();
  }

  /** Keyboard shortcuts: Delete removes the selected drawing, Escape cancels. */
  handleKey(e: KeyboardEvent): boolean {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.deleteSelected()) return true;
    if (e.key === 'Escape' && (this.draft || this.tool !== 'cursor' || this.selectedId)) {
      this.selectedId = null;
      this.setTool('cursor');
      return true;
    }
    return false;
  }

  redraw() {
    this.requestUpdate?.();
  }

  // ---------- Mouse handling ----------

  private local(e: PointerEvent): (Screen & { inside: boolean }) | null {
    const pane = this.view.mainPaneElement();
    if (!pane) return null;
    const rect = pane.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
  }

  private toPoint(x: number, y: number, useMagnet = this.magnet): DrawingPoint | null {
    if (useMagnet) return this.view.snap(x, y);
    const time = this.view.xToTime(x);
    const price = this.view.yToPrice(y);
    return time === null || price === null ? null : { time, price };
  }

  private consume(e: Event) {
    this.consuming = true;
    e.preventDefault();
    e.stopPropagation();
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const pos = this.local(e);
    if (!pos?.inside) return;

    if (this.tool !== 'cursor') {
      const point = this.toPoint(pos.x, pos.y);
      if (!point) return;
      this.consume(e);
      if (this.draft) {
        this.draft.points[this.draft.points.length - 1] = point;
        this.finishDraft();
        return;
      }
      const type = this.tool;
      if (type === 'long' || type === 'short') {
        const position = this.newPosition(type, point, pos.y);
        if (!position) return;
        this.draft = position;
        this.finishDraft();
        return;
      }
      this.draft = { id: newId(), type, color: DEFAULT_COLOR[type], points: POINTS[type] === 1 ? [point] : [point, { ...point }] };
      this.draftStart = pos;
      if (POINTS[type] === 1) this.finishDraft();
      else this.redraw();
      return;
    }

    const hit = this.hitTest(pos);
    this.selectedId = hit?.id ?? null;
    if (hit) {
      this.consume(e);
      const drawing = this.drawings.find((d) => d.id === hit.id)!;
      this.drag = { hit, start: pos, original: drawing.points.map((p) => this.toScreen(p) ?? { x: 0, y: 0 }) };
    }
    this.redraw();
  }

  private onPointerMove(e: PointerEvent) {
    const pos = this.local(e);
    if (!pos) return;
    if (this.draft) {
      const point = this.toPoint(pos.x, pos.y);
      if (point) {
        this.draft.points[this.draft.points.length - 1] = point;
        this.redraw();
      }
      return;
    }
    if (this.drag) {
      const drawing = this.drawings.find((d) => d.id === this.drag!.hit.id);
      if (!drawing) return;
      const { hit, start, original } = this.drag;
      if (hit.handle >= 0) {
        const point = this.toPoint(pos.x, pos.y);
        if (point) {
          drawing.points[hit.handle] = point;
          // Target and stop share the box's right edge.
          if (isPosition(drawing) && hit.handle > 0) drawing.points[3 - hit.handle].time = point.time;
        }
      } else {
        const dx = pos.x - start.x;
        const dy = pos.y - start.y;
        const moved = original.map((o) => this.toPoint(o.x + dx, o.y + dy, false));
        if (moved.every(Boolean)) drawing.points = moved as DrawingPoint[];
      }
      this.redraw();
      return;
    }
    if (this.tool === 'cursor') {
      const hit = pos.inside ? this.hitTest(pos) : null;
      if ((hit?.id ?? null) !== this.hoverId) {
        this.hoverId = hit?.id ?? null;
        this.redraw();
      }
      this.container.style.cursor = hit ? (hit.handle >= 0 ? 'grab' : 'move') : '';
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.consuming = false;
    if (this.drag) {
      this.drag = null;
      this.changed();
      return;
    }
    const pos = this.local(e);
    // Support press-drag-release as well as click, move, click.
    if (this.draft && this.draftStart && pos && Math.hypot(pos.x - this.draftStart.x, pos.y - this.draftStart.y) > 6) {
      this.finishDraft();
    }
  }

  private finishDraft() {
    if (!this.draft) return;
    this.drawings.push(this.draft);
    this.selectedId = this.draft.id;
    this.draft = null;
    this.draftStart = null;
    this.setTool('cursor');
    this.changed();
  }

  private newPosition(type: 'long' | 'short', entry: DrawingPoint, y: number): Drawing | null {
    const startLogical = this.view.timeToLogical(entry.time);
    const end = startLogical === null ? null : this.view.logicalToTime(startLogical + POSITION_BARS);
    const riskPrice = this.view.yToPrice(y + (type === 'long' ? POSITION_RISK_PX : -POSITION_RISK_PX));
    if (end === null || riskPrice === null) return null;
    const risk = entry.price - riskPrice;
    return {
      id: newId(),
      type,
      color: DEFAULT_COLOR[type],
      points: [entry, { time: end, price: entry.price + 2 * risk }, { time: end, price: riskPrice }],
    };
  }

  private changed() {
    this.redraw();
    this.onChange(this.drawings);
  }

  // ---------- Geometry ----------

  private toScreen(p: DrawingPoint): Screen | null {
    const x = this.view.timeToX(p.time);
    const y = this.view.priceToY(p.price);
    return x === null || y === null ? null : { x, y };
  }

  private hitTest(pos: Screen): Hit | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const pts = d.points.map((p) => this.toScreen(p));
      if (pts.some((p) => !p)) continue;
      const s = pts as Screen[];
      if (d.id === this.selectedId || d.id === this.hoverId) {
        const handle = s.findIndex((p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= HANDLE);
        if (handle >= 0) return { id: d.id, handle };
      }
      if (this.hitsBody(d, s, pos)) return { id: d.id, handle: -1 };
    }
    return null;
  }

  private hitsBody(d: Drawing, s: Screen[], p: Screen): boolean {
    switch (d.type) {
      case 'trend':
        return distToSegment(p, s[0], s[1]) <= HIT;
      case 'ray':
        return distToSegment(p, s[0], extend(s[0], s[1])) <= HIT;
      case 'hline':
        return Math.abs(p.y - s[0].y) <= HIT;
      case 'vline':
        return Math.abs(p.x - s[0].x) <= HIT;
      case 'rect': {
        const [x1, x2] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x)];
        const [y1, y2] = [Math.min(s[0].y, s[1].y), Math.max(s[0].y, s[1].y)];
        return p.x >= x1 - HIT && p.x <= x2 + HIT && p.y >= y1 - HIT && p.y <= y2 + HIT;
      }
      case 'long':
      case 'short': {
        const [x1, x2] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x)];
        const [y1, y2] = [Math.min(s[1].y, s[2].y), Math.max(s[1].y, s[2].y)];
        return p.x >= x1 - HIT && p.x <= x2 + HIT && p.y >= y1 - HIT && p.y <= y2 + HIT;
      }
      case 'fib': {
        const [x1, x2] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x)];
        if (p.x < x1 - HIT || p.x > x2 + HIT) return false;
        return FIB_LEVELS.some(([level]) => {
          const y = this.view.priceToY(fibPrice(d, level));
          return y !== null && Math.abs(p.y - y) <= HIT;
        });
      }
    }
  }

  // ---------- Rendering ----------

  private draw(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
    for (const d of all) {
      const pts = d.points.map((p) => this.toScreen(p));
      if (pts.some((p) => !p)) continue;
      const s = pts as Screen[];
      const active = d.id === this.selectedId || d.id === this.hoverId || d === this.draft;
      ctx.save();
      ctx.strokeStyle = d.color;
      ctx.lineWidth = active ? 2 : 1.5;
      this.drawShape(ctx, d, s, width, height);
      ctx.restore();
      if (active) for (const p of s) this.drawHandle(ctx, p, d.color);
    }
  }

  private drawShape(ctx: CanvasRenderingContext2D, d: Drawing, s: Screen[], width: number, height: number) {
    const line = (a: Screen, b: Screen) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    switch (d.type) {
      case 'trend':
        line(s[0], s[1]);
        break;
      case 'ray':
        line(s[0], extend(s[0], s[1]));
        break;
      case 'hline':
        line({ x: 0, y: s[0].y }, { x: width, y: s[0].y });
        break;
      case 'vline':
        line({ x: s[0].x, y: 0 }, { x: s[0].x, y: height });
        break;
      case 'rect': {
        const x = Math.min(s[0].x, s[1].x);
        const y = Math.min(s[0].y, s[1].y);
        const w = Math.abs(s[1].x - s[0].x);
        const h = Math.abs(s[1].y - s[0].y);
        ctx.fillStyle = d.color + '26';
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case 'long':
      case 'short':
        this.drawPosition(ctx, d, s);
        break;
      case 'fib': {
        const x1 = Math.min(s[0].x, s[1].x);
        const x2 = Math.max(s[0].x, s[1].x);
        ctx.font = "11px 'Inter', -apple-system, sans-serif";
        ctx.textBaseline = 'bottom';
        let prevY: number | null = null;
        for (const [level, color] of FIB_LEVELS) {
          const price = fibPrice(d, level);
          const y = this.view.priceToY(price);
          if (y === null) continue;
          if (prevY !== null) {
            ctx.fillStyle = color + '1a';
            ctx.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY));
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          line({ x: x1, y }, { x: x2, y });
          ctx.fillStyle = color;
          ctx.fillText(`${level} (${this.view.formatPrice(price)})`, x1 + 4, y - 2);
          prevY = y;
        }
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = d.color;
        line(s[0], s[1]);
        break;
      }
    }
  }

  private drawPosition(ctx: CanvasRenderingContext2D, d: Drawing, s: Screen[]) {
    const [entry, target, stop] = s;
    const x1 = Math.min(entry.x, target.x);
    const width = Math.abs(target.x - entry.x);
    const stats = positionStats(d);
    ctx.fillStyle = PROFIT + '33';
    ctx.fillRect(x1, Math.min(entry.y, target.y), width, Math.abs(target.y - entry.y));
    ctx.fillStyle = LOSS + '33';
    ctx.fillRect(x1, Math.min(entry.y, stop.y), width, Math.abs(stop.y - entry.y));
    ctx.strokeStyle = '#d1d4dc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, entry.y);
    ctx.lineTo(x1 + width, entry.y);
    ctx.stroke();

    const label = (text: string, y: number, color: string, below: boolean) => {
      ctx.font = "600 11px 'Inter', -apple-system, sans-serif";
      const w = ctx.measureText(text).width + 12;
      const x = x1 + width / 2 - w / 2;
      const top = below ? y + 4 : y - 22;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, top, w, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 6, top + 9);
    };
    const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const targetAbove = target.y < entry.y;
    label(`Target ${this.view.formatPrice(d.points[1].price)} (${pct(stats.targetPct)})`, target.y, PROFIT, !targetAbove);
    label(`Stop ${this.view.formatPrice(d.points[2].price)} (${pct(stats.stopPct)})`, stop.y, LOSS, targetAbove);
    label(`${d.type === 'long' ? 'Long' : 'Short'} · R:R ${stats.ratio.toFixed(2)}`, entry.y, '#2a2e39', targetAbove);
  }

  private drawHandle(ctx: CanvasRenderingContext2D, p: Screen, color: string) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#131722';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  private primitive(): ISeriesPrimitive<Time> {
    const paneView: IPrimitivePaneView = {
      zOrder: () => 'top',
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width, mediaSize.height)),
      }),
    };
    return {
      attached: ({ requestUpdate }: SeriesAttachedParameter<Time>) => {
        this.requestUpdate = requestUpdate;
      },
      detached: () => {
        this.requestUpdate = null;
      },
      paneViews: () => [paneView],
      // Show the price of horizontal lines on the price axis, like TradingView.
      priceAxisViews: () =>
        this.drawings
          .filter((d) => d.type === 'hline')
          .map(
            (d): ISeriesPrimitiveAxisView => ({
              coordinate: () => this.view.priceToY(d.points[0].price) ?? -100,
              text: () => this.view.formatPrice(d.points[0].price),
              textColor: () => '#ffffff',
              backColor: () => d.color,
            }),
          ),
    };
  }
}
