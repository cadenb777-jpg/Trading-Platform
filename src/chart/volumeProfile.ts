/**
 * Volume profile: how much volume traded at each price level across the bars currently on
 * screen, drawn as horizontal bars along the right edge of the price chart. The busiest level is
 * the point of control (POC); the value area is the band holding 70% of the volume around it.
 */
import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Bar } from '../types';
import type { ChartView } from './ChartView';

const ROWS = 40;
const VALUE_AREA = 0.7;

export interface ProfileResult {
  rows: { low: number; high: number; volume: number }[];
  poc: number;
  valueLow: number;
  valueHigh: number;
}

/** Spreads each bar's volume evenly across the price rows its high-low range covers. */
export function computeProfile(bars: Bar[], rowCount = ROWS): ProfileResult | null {
  const valid = bars.filter((b) => b.volume > 0 && Number.isFinite(b.high) && Number.isFinite(b.low));
  if (valid.length < 2) return null;
  const top = Math.max(...valid.map((b) => b.high));
  const bottom = Math.min(...valid.map((b) => b.low));
  if (!(top > bottom)) return null;
  const step = (top - bottom) / rowCount;
  const rows = Array.from({ length: rowCount }, (_, i) => ({ low: bottom + i * step, high: bottom + (i + 1) * step, volume: 0 }));
  for (const b of valid) {
    const first = Math.min(rowCount - 1, Math.floor((b.low - bottom) / step));
    const last = Math.min(rowCount - 1, Math.floor((b.high - bottom) / step));
    const share = b.volume / (last - first + 1);
    for (let r = first; r <= last; r++) rows[r].volume += share;
  }
  let poc = 0;
  rows.forEach((r, i) => r.volume > rows[poc].volume && (poc = i));
  // Grow the value area outwards from the POC, adding the busier neighbour each time.
  const total = rows.reduce((sum, r) => sum + r.volume, 0);
  let lo = poc;
  let hi = poc;
  let inside = rows[poc].volume;
  while (inside < total * VALUE_AREA && (lo > 0 || hi < rowCount - 1)) {
    const below = lo > 0 ? rows[lo - 1].volume : -1;
    const above = hi < rowCount - 1 ? rows[hi + 1].volume : -1;
    if (above >= below) inside += rows[++hi].volume;
    else inside += rows[--lo].volume;
  }
  return { rows, poc, valueLow: lo, valueHigh: hi };
}

export class VolumeProfile {
  private enabled = false;
  private requestUpdate: (() => void) | null = null;

  constructor(private readonly view: ChartView) {
    view.attachPrimitive(this.primitive());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.requestUpdate?.();
  }

  private draw(ctx: CanvasRenderingContext2D, width: number) {
    if (!this.enabled) return;
    const profile = computeProfile(this.view.visibleBars());
    if (!profile) return;
    const max = Math.max(...profile.rows.map((r) => r.volume));
    const maxWidth = width * 0.22;
    profile.rows.forEach((row, i) => {
      const y1 = this.view.priceToY(row.high);
      const y2 = this.view.priceToY(row.low);
      if (y1 === null || y2 === null) return;
      const w = (row.volume / max) * maxWidth;
      const inValue = i >= profile.valueLow && i <= profile.valueHigh;
      ctx.fillStyle = i === profile.poc ? '#ff9800b3' : inValue ? '#2962ff59' : '#787b8640';
      ctx.fillRect(width - w, Math.min(y1, y2) + 0.5, w, Math.max(1, Math.abs(y2 - y1) - 1));
    });
    const pocRow = profile.rows[profile.poc];
    const pocPrice = (pocRow.low + pocRow.high) / 2;
    const y = this.view.priceToY(pocPrice);
    if (y === null) return;
    ctx.save();
    ctx.strokeStyle = '#ff9800';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
    ctx.font = "600 11px 'Inter', -apple-system, sans-serif";
    ctx.fillStyle = '#ff9800';
    ctx.fillText(`POC ${this.view.formatPrice(pocPrice)}`, width - maxWidth - 90, y - 4);
  }

  private primitive(): ISeriesPrimitive<Time> {
    const paneView: IPrimitivePaneView = {
      zOrder: () => 'bottom',
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width)),
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
    };
  }
}
