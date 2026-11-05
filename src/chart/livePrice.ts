/**
 * The last-price line and price-axis label, animated: the line glides to each new price, the label flashes green or red
 * for a moment when the price ticks up or down, and a soft ring pulses on the latest candle. Replaces the library's own
 * last-value label (a series primitive, so it follows the main series). Canvas colours come from THEME; with "reduce
 * motion" the line jumps and nothing pulses.
 */
import type { ISeriesPrimitive, ISeriesPrimitiveAxisView, IPrimitivePaneView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { THEME } from '../ui/theme';
import { approach, easeOutCubic, mixColor, reducedMotion, withAlpha } from './frame';

export interface LivePriceHost {
  priceToY(price: number): number | null;
  timeToX(time: number): number | null;
  formatPrice(price: number): string;
  /** The latest bar's time, open and close (null when the chart is empty). */
  lastBar(): { time: number; open: number; close: number } | null;
}

const GLIDE_MS = 90;
const FLASH_MS = 200;

export class LivePrice {
  private shown = NaN;
  private target = NaN;
  private direction = 0;
  private flashAt = -Infinity;
  private lastFrame = 0;
  private animating = false;
  private requestUpdate: (() => void) | null = null;
  readonly primitive: ISeriesPrimitive<Time>;
  /** A DOM ring on the latest candle: a CSS animation, so pulsing costs no chart redraws. */
  private readonly pulse: HTMLElement;
  private ring: Animation | null = null;

  constructor(
    private readonly host: LivePriceHost,
    overlay: HTMLElement,
  ) {
    this.pulse = document.createElement('div');
    this.pulse.className = 'live-pulse';
    this.pulse.append(document.createElement('i'), document.createElement('b'));
    this.pulse.hidden = true;
    overlay.append(this.pulse);
    const paneView: IPrimitivePaneView = {
      zOrder: () => 'top',
      renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.width)) }),
    };
    const axisView: ISeriesPrimitiveAxisView = {
      coordinate: () => this.y() ?? -100,
      text: () => (Number.isFinite(this.target) ? this.host.formatPrice(this.target) : ''),
      textColor: () => '#ffffff',
      backColor: () => this.labelColor(),
      visible: () => Number.isFinite(this.target) && this.y() !== null,
    };
    this.primitive = {
      attached: ({ requestUpdate }: SeriesAttachedParameter<Time>) => {
        this.requestUpdate = requestUpdate;
      },
      detached: () => {
        this.requestUpdate = null;
      },
      paneViews: () => [paneView],
      priceAxisViews: () => [axisView],
      updateAllViews: () => this.placePulse(),
    };
  }

  /** Call after the bars change. `tick` = a live trade (animate); otherwise the line jumps (new symbol, history load). */
  update(tick: boolean) {
    const bar = this.host.lastBar();
    const price = bar?.close ?? NaN;
    if (!tick || !Number.isFinite(this.shown) || reducedMotion()) {
      this.shown = price;
      this.target = price;
      this.direction = 0;
      this.pulse.hidden = true;
      this.requestUpdate?.();
      return;
    }
    if (price !== this.target) {
      this.direction = price > this.target ? 1 : -1;
      this.flashAt = performance.now();
      this.restartPulse();
    }
    this.target = price;
    this.animate();
  }

  private animate() {
    if (this.animating) return;
    this.animating = true;
    this.lastFrame = performance.now();
    const step = () => {
      const now = performance.now();
      this.shown = approach(this.shown, this.target, now - this.lastFrame, GLIDE_MS);
      this.lastFrame = now;
      this.requestUpdate?.();
      if (this.shown !== this.target || now - this.flashAt < FLASH_MS) requestAnimationFrame(step);
      else this.animating = false;
    };
    requestAnimationFrame(step);
  }

  private y(): number | null {
    return Number.isFinite(this.shown) ? this.host.priceToY(this.shown) : null;
  }

  private baseColor(): string {
    const bar = this.host.lastBar();
    return bar && bar.close < bar.open ? THEME.down : THEME.up;
  }

  private labelColor(): string {
    const base = this.baseColor();
    const age = performance.now() - this.flashAt;
    if (!this.direction || age >= FLASH_MS) return base;
    // Starts as a bright flash in the tick's direction and fades back to the candle colour.
    const flash = mixColor(this.direction > 0 ? THEME.up : THEME.down, '#ffffff', 0.25);
    return mixColor(base, flash, 1 - easeOutCubic(age / FLASH_MS));
  }

  private draw(ctx: CanvasRenderingContext2D, width: number) {
    const y = this.y();
    if (y === null) return;
    const color = this.baseColor();
    const age = performance.now() - this.flashAt;
    const glow = this.direction && age < FLASH_MS ? 1 - age / FLASH_MS : 0;
    ctx.save();
    if (glow > 0) {
      // A soft band that fades out after each tick.
      const band = ctx.createLinearGradient(0, y - 10, 0, y + 10);
      band.addColorStop(0, withAlpha(color, 0));
      band.addColorStop(0.5, withAlpha(this.direction > 0 ? THEME.up : THEME.down, 0.18 * glow));
      band.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, y - 10, width, 20);
    }
    ctx.strokeStyle = withAlpha(color, 0.85);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  private restartPulse() {
    const p = this.pulse;
    p.hidden = false;
    p.style.setProperty('--pulse', this.direction > 0 ? THEME.up : THEME.down);
    this.placePulse();
    this.ring?.cancel();
    // Web Animations run on the compositor: no layout, no chart redraw.
    this.ring = p.firstElementChild?.animate?.(
      [
        { transform: 'scale(0.4)', opacity: 0.75 },
        { transform: 'scale(2.2)', opacity: 0 },
      ],
      { duration: 200, easing: 'ease-out' },
    ) ?? null;
  }

  private placePulse() {
    if (this.pulse.hidden) return;
    const bar = this.host.lastBar();
    const x = bar ? this.host.timeToX(bar.time) : null;
    const y = bar ? this.host.priceToY(bar.close) : null;
    if (x === null || y === null) {
      this.pulse.style.opacity = '0';
      return;
    }
    this.pulse.style.opacity = '';
    this.pulse.style.transform = `translate(${x}px, ${y}px)`;
  }
}
