/**
 * Light and dark mode. The page colours are CSS variables (style.css, `:root[data-theme='light']`); charts drawn on a
 * canvas can't read CSS, so they take their colours from THEME and repaint when the theme changes (followTheme).
 */
import { ColorType, type IChartApi } from 'lightweight-charts';
import { attachSquareGrid } from '../chart/grid';

export type ThemeName = 'dark' | 'light';

/** Canvas colours that mirror the CSS tokens in style.css (navy terminal in dark, paper and ink in light).
 * up/down: a blue-leaning green and a warm red, told apart by lightness as well as hue (colour-blind safe).
 * crosshair: the crosshair lines; viz1-3: categorical series colours (sky, copper, sea green), same as --viz-1..3.
 * onFill: text on an up/down fill (the last-price tag); axisLabel: crosshair axis label boxes; frame: axis lines. */
const PALETTES: Record<ThemeName, { background: string; text: string; grid: string; border: string; crosshair: string; up: string; down: string; accent: string; viz1: string; viz2: string; viz3: string; onFill: string; axisLabel: string; frame: string }> = {
  dark: { background: '#071629', text: '#A9BED3', grid: '#46648A', border: '#1B3550', crosshair: '#5E7FA3', up: '#2FBF95', down: '#F0645A', accent: '#7AC3EE', viz1: '#5AAAE6', viz2: '#E0803F', viz3: '#2FB58A', onFill: '#04111F', axisLabel: '#2B5079', frame: '#24405F' },
  light: { background: '#FFFFFF', text: '#3B4A5C', grid: '#9AA6B5', border: '#DDE3EA', crosshair: '#8A96A6', up: '#0E8A6A', down: '#C8402F', accent: '#123B68', viz1: '#1F5FA8', viz2: '#B4581F', viz3: '#178A64', onFill: '#FFFFFF', axisLabel: '#123B68', frame: '#C3CCD7' },
};

const KEY = 'tp-theme';

/** Colours for canvas charts. Updated in place when the theme changes, so always read it at draw time. */
export const THEME = { ...PALETTES.dark };

let current: ThemeName = 'dark';
const listeners = new Set<() => void>();

export const currentTheme = () => current;

export function setTheme(name: ThemeName) {
  current = name;
  Object.assign(THEME, PALETTES[name]);
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // private window: the choice just isn't remembered
  }
  for (const fn of [...listeners]) fn();
}

/** Applies the saved theme (dark by default). Call once before the first page is built. */
export function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // ignore
  }
  setTheme(saved === 'light' ? 'light' : 'dark');
}

export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** '#RRGGBB' with an alpha (0-1) as rgba(). */
function withAlphaHex(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Chart options for the current theme (a transparent background lets the panel colour show through). */
export function chartThemeOptions(transparent = false) {
  return {
    // No library logo on our charts: the Apache-2.0 attribution lives in Settings > About and THIRD_PARTY_NOTICES.md.
    layout: {
      background: { type: ColorType.Solid, color: transparent ? 'transparent' : THEME.background },
      textColor: THEME.text,
      attributionLogo: false,
      panes: { separatorColor: THEME.frame, separatorHoverColor: withAlphaHex(THEME.accent, 0.35) },
    },
    // The square dotted grid is ours (src/chart/grid.ts, attached by followTheme): the library's grid stays off.
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { borderColor: THEME.frame },
    leftPriceScale: { borderColor: THEME.frame },
    timeScale: { borderColor: THEME.frame },
    crosshair: {
      vertLine: { color: THEME.crosshair, labelBackgroundColor: THEME.axisLabel },
      horzLine: { color: THEME.crosshair, labelBackgroundColor: THEME.axisLabel },
    },
  };
}

/** Repaints a chart when the theme changes; stops once the chart has been removed. */
/** What to do with empty space before the first bar (pure, tested): 'fit' refits the data to the width, 'left'
 * stretches the bars from the left edge and keeps the right edge (and the zoom), null when there is none. */
export function emptyLeftFix(range: { from: number; to: number } | null, mode: 'fit' | 'left'): { fit: true } | { from: number; to: number } | null {
  if (!range || range.from >= -1) return null;
  return mode === 'fit' ? { fit: true } : { from: -0.5, to: range.to };
}

/**
 * Keeps a chart's data filling its width. Charts are often built while their page is still hidden (pages load in the
 * background so they open at once) or before the window settles; fitted at zero width, the library then keeps the
 * candle spacing and pads the new width with an empty strip before the first candle. On every resize (page shown,
 * window resized, panel opened) that strip is closed. Returns a stop function.
 */
export function keepFilled(chart: IChartApi, mode: 'fit' | 'left' = 'fit'): () => void {
  let frame = 0;
  let observer: ResizeObserver | null = null;
  const check = () => {
    frame = 0;
    try {
      const ts = chart.timeScale();
      const fix = emptyLeftFix(ts.getVisibleLogicalRange(), mode);
      if (!fix) return;
      if ('fit' in fix) ts.fitContent();
      else ts.setVisibleLogicalRange(fix);
    } catch {
      observer?.disconnect(); // the chart was removed
    }
  };
  if (typeof ResizeObserver === 'undefined') return () => {};
  observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(check);
  });
  observer.observe(chart.chartElement());
  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
  };
}

export function followTheme(chart: IChartApi, opts: { transparent?: boolean; hideVertGrid?: boolean; onChange?: () => void; fill?: 'fit' | 'left' | false } = {}) {
  // Every chart, from creation: the theme's colours, no library watermark, and our square dotted grid.
  chart.applyOptions(chartThemeOptions(opts.transparent));
  attachSquareGrid(chart, { color: () => THEME.grid });
  const stopFill = opts.fill === false ? () => {} : keepFilled(chart, opts.fill ?? 'fit');
  const stop = onThemeChange(() => {
    try {
      const o = chartThemeOptions(opts.transparent);
      // every chart keeps the full square grid (hideVertGrid is kept for older callers but no longer hides it); the
      // grid reads THEME at draw time
      chart.applyOptions(o);
      opts.onChange?.();
    } catch {
      stop(); // the chart was removed
    }
  });
  // 12/24-hour clock switched (src/chart/clock.ts): redraw so the time labels change at once.
  const onClock = () => {
    try {
      chart.applyOptions({ layout: { textColor: chart.options().layout.textColor } });
    } catch {
      window.removeEventListener('tp:clock', onClock);
    }
  };
  window.addEventListener('tp:clock', onClock);
  return () => {
    window.removeEventListener('tp:clock', onClock);
    stopFill();
    stop();
  };
}
