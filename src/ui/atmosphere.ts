/**
 * The page's flowing background: five soft shapes of colour (dark blue, blue, sky, orange, amber) behind everything,
 * each drifting and brightening/dimming on its own slow loop. Colours come from the theme (--spot-* in style.css).
 *
 * Drawn into ONE small canvas that the browser stretches to the window (the shapes are soft, so a low resolution looks
 * the same), redrawn about 15 times a second (they move a few pixels a second, so that is smooth). The window then
 * blends a single light layer while you scroll, instead of five window-sized see-through layers: those five dropped
 * scrolling to about 10 frames a second in the desktop app; this keeps it at 60. Still for reduced motion; paused while
 * the page is hidden; hidden on the Chart page.
 */

export interface Spot {
  /** The colour variable in style.css. */
  color: string;
  /** Where the centre travels between (vw, vh), how big (scale) and turned (degrees), there and back. */
  from: { x: number; y: number; s: number; r?: number };
  to: { x: number; y: number; s: number; r?: number };
  /** Seconds for one way of the path, and of the brighten/dim. */
  move: number;
  pulse: number;
  /** Where the colour has faded out, as a part of the shape's radius. */
  fade: number;
}

/** The shapes, back to front (the same paths and timings the CSS version had). */
export const SPOTS: readonly Spot[] = [
  { color: '--spot-deep', from: { x: 55, y: 55, s: 1.1, r: 0 }, to: { x: 35, y: 40, s: 1.25, r: 25 }, move: 70, pulse: 23, fade: 0.72 },
  { color: '--spot-blue', from: { x: 15, y: 20, s: 0.95 }, to: { x: 45, y: 75, s: 1.15 }, move: 85, pulse: 19, fade: 0.7 },
  { color: '--spot-sky', from: { x: 90, y: 10, s: 0.8 }, to: { x: 65, y: 35, s: 1.05 }, move: 60, pulse: 29, fade: 0.7 },
  { color: '--spot-copper', from: { x: 8, y: 95, s: 0.9, r: -10 }, to: { x: 40, y: 60, s: 1.1, r: 15 }, move: 95, pulse: 17, fade: 0.7 },
  { color: '--spot-amber', from: { x: 95, y: 80, s: 0.7 }, to: { x: 70, y: 50, s: 0.95 }, move: 52, pulse: 26, fade: 0.68 },
];

/** Canvas pixels per window pixel, and redraws per second. */
export const SCALE = 1 / 8;
export const FPS = 15;

/** 0 → 1 → 0 over 2 × `seconds`, eased at both ends (CSS ease-in-out, alternate). */
export function wave(t: number, seconds: number): number {
  const phase = (t / seconds) % 2;
  const x = phase > 1 ? 2 - phase : phase;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/** A spot's place at time t (seconds): centre in window pixels, radii, turn (radians) and opacity. */
export function spotAt(spot: Spot, t: number, w: number, h: number) {
  const k = wave(t, spot.move);
  const mix = (a: number, b: number) => a + (b - a) * k;
  const vmax = Math.max(w, h) / 100;
  const s = mix(spot.from.s, spot.to.s);
  return {
    x: (mix(spot.from.x, spot.to.x) / 100) * w,
    y: (mix(spot.from.y, spot.to.y) / 100) * h,
    rx: 45 * vmax * s, // the shapes were 90vmax × 70vmax ellipses
    ry: 35 * vmax * s,
    turn: (mix(spot.from.r ?? 0, spot.to.r ?? 0) * Math.PI) / 180,
    alpha: 0.55 + 0.45 * wave(t, spot.pulse),
  };
}

/** Adds the layer once and keeps it moving. */
export function initAtmosphere() {
  if (document.querySelector('.atmos')) return;
  const layer = document.createElement('div');
  layer.className = 'atmos';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  layer.append(canvas);
  document.body.prepend(layer);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const offsets = SPOTS.map((s) => Math.random() * s.move * 2); // each shape starts somewhere along its loop
  const pulseOffsets = SPOTS.map((s) => Math.random() * s.pulse * 2);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let colors: string[] = [];
  let colorsRead = 0;
  const started = performance.now() / 1000;

  const draw = () => {
    const w = innerWidth;
    const h = innerHeight;
    const cw = Math.max(16, Math.round(w * SCALE));
    const ch = Math.max(16, Math.round(h * SCALE));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const now = performance.now() / 1000;
    if (!colors.length || now - colorsRead > 2) {
      // the theme may have changed (light/dark): read the colours again every couple of seconds
      const css = getComputedStyle(document.documentElement);
      colors = SPOTS.map((s) => css.getPropertyValue(s.color).trim() || 'transparent');
      colorsRead = now;
    }
    const t = still.matches ? 0 : now - started;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    SPOTS.forEach((spot, i) => {
      const p = spotAt(spot, t + offsets[i], w, h);
      const alpha = still.matches ? 0.8 : 0.55 + 0.45 * wave(t + pulseOffsets[i], spot.pulse);
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.scale(1, p.ry / p.rx); // an ellipse: a circle squashed
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
      g.addColorStop(0, colors[i]);
      g.addColorStop(spot.fade, 'transparent');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fillRect(-p.rx, -p.rx, p.rx * 2, p.rx * 2);
    });
    ctx.globalAlpha = 1;
  };

  let last = 0;
  const loop = (ms: number) => {
    requestAnimationFrame(loop);
    // nothing to do while the page is hidden, on the Chart page (no background there) or between the 15 updates
    if (document.hidden || ms - last < 1000 / FPS || document.body.dataset.route === 'chart') return;
    if (still.matches && last) return; // reduced motion: drawn once (and on resize below)
    last = ms;
    draw();
  };
  addEventListener('resize', () => draw());
  still.addEventListener?.('change', () => draw());
  draw();
  requestAnimationFrame(loop);
}

/** Marks the body with the current page, so styles can treat a page differently (the Chart page has no background). */
export function markRoute(route: string) {
  document.body.dataset.route = route;
}
