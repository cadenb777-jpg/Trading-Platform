/**
 * Light and dark mode. The page colours are CSS variables (style.css, `:root[data-theme='light']`); charts drawn on a
 * canvas can't read CSS, so they take their colours from THEME and repaint when the theme changes (followTheme).
 */
import { ColorType, type IChartApi } from 'lightweight-charts';

export type ThemeName = 'dark' | 'light';

/** Canvas colours that mirror the CSS tokens in style.css (navy terminal in dark, paper and ink in light).
 * up/down: a blue-leaning green and a warm red, told apart by lightness as well as hue (colour-blind safe).
 * crosshair: the crosshair lines; viz1-3: categorical series colours (sky, copper, sea green), same as --viz-1..3. */
const PALETTES: Record<ThemeName, { background: string; text: string; grid: string; border: string; crosshair: string; up: string; down: string; accent: string; viz1: string; viz2: string; viz3: string }> = {
  dark: { background: '#071629', text: '#A9BED3', grid: '#0F2238', border: '#1B3550', crosshair: '#5E7FA3', up: '#2FBF95', down: '#F0645A', accent: '#7AC3EE', viz1: '#5AAAE6', viz2: '#E0803F', viz3: '#2FB58A' },
  light: { background: '#FFFFFF', text: '#3B4A5C', grid: '#EEF1F4', border: '#DDE3EA', crosshair: '#8A96A6', up: '#0E8A6A', down: '#C8402F', accent: '#123B68', viz1: '#1F5FA8', viz2: '#B4581F', viz3: '#178A64' },
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

/** Chart options for the current theme (a transparent background lets the panel colour show through). */
export function chartThemeOptions(transparent = false) {
  return {
    layout: { background: { type: ColorType.Solid, color: transparent ? 'transparent' : THEME.background }, textColor: THEME.text },
    grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
    rightPriceScale: { borderColor: THEME.border },
    timeScale: { borderColor: THEME.border },
    crosshair: {
      vertLine: { color: THEME.crosshair, labelBackgroundColor: THEME.border },
      horzLine: { color: THEME.crosshair, labelBackgroundColor: THEME.border },
    },
  };
}

/** Repaints a chart when the theme changes; stops once the chart has been removed. */
export function followTheme(chart: IChartApi, opts: { transparent?: boolean; hideVertGrid?: boolean; onChange?: () => void } = {}) {
  const stop = onThemeChange(() => {
    try {
      const o = chartThemeOptions(opts.transparent);
      if (opts.hideVertGrid) o.grid.vertLines = { color: 'transparent' };
      chart.applyOptions(o);
      opts.onChange?.();
    } catch {
      stop(); // the chart was removed
    }
  });
  return stop;
}
