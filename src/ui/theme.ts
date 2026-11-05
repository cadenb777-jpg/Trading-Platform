/**
 * Light and dark mode. The page colours are CSS variables (style.css, `:root[data-theme='light']`); charts drawn on a
 * canvas can't read CSS, so they take their colours from THEME and repaint when the theme changes (followTheme).
 */
import { ColorType, LineStyle, type IChartApi } from 'lightweight-charts';

export type ThemeName = 'dark' | 'light';

/** Canvas colours that mirror the CSS tokens in style.css (navy terminal in dark, paper and ink in light).
 * up/down: a blue-leaning green and a warm red, told apart by lightness as well as hue (colour-blind safe).
 * crosshair: the crosshair lines; viz1-3: categorical series colours (sky, copper, sea green), same as --viz-1..3.
 * onFill: text on an up/down fill (the last-price tag); axisLabel: crosshair axis label boxes; frame: axis lines. */
const PALETTES: Record<ThemeName, { background: string; text: string; grid: string; border: string; crosshair: string; up: string; down: string; accent: string; viz1: string; viz2: string; viz3: string; onFill: string; axisLabel: string; frame: string }> = {
  dark: { background: '#071629', text: '#A9BED3', grid: '#2C4260', border: '#1B3550', crosshair: '#5E7FA3', up: '#2FBF95', down: '#F0645A', accent: '#7AC3EE', viz1: '#5AAAE6', viz2: '#E0803F', viz3: '#2FB58A', onFill: '#04111F', axisLabel: '#2B5079', frame: '#24405F' },
  light: { background: '#FFFFFF', text: '#3B4A5C', grid: '#CBD3DD', border: '#DDE3EA', crosshair: '#8A96A6', up: '#0E8A6A', down: '#C8402F', accent: '#123B68', viz1: '#1F5FA8', viz2: '#B4581F', viz3: '#178A64', onFill: '#FFFFFF', axisLabel: '#123B68', frame: '#C3CCD7' },
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
    // Bloomberg-style square grid: dotted lines at every price tick and every time tick, on every chart.
    grid: { vertLines: { visible: true, color: THEME.grid, style: LineStyle.Dotted }, horzLines: { visible: true, color: THEME.grid, style: LineStyle.Dotted } },
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
export function followTheme(chart: IChartApi, opts: { transparent?: boolean; hideVertGrid?: boolean; onChange?: () => void } = {}) {
  chart.applyOptions({ layout: { attributionLogo: false } }); // every chart: no library watermark
  const stop = onThemeChange(() => {
    try {
      const o = chartThemeOptions(opts.transparent);
      // every chart keeps the full square grid (hideVertGrid is kept for older callers but no longer hides it)
      chart.applyOptions(o);
      opts.onChange?.();
    } catch {
      stop(); // the chart was removed
    }
  });
  return stop;
}
