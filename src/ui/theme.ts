/**
 * Light and dark mode. The page colours are CSS variables (style.css, `:root[data-theme='light']`); charts drawn on a
 * canvas can't read CSS, so they take their colours from THEME and repaint when the theme changes (followTheme).
 */
import { ColorType, type IChartApi } from 'lightweight-charts';

export type ThemeName = 'dark' | 'light';

/** viz1-3: categorical series colours for multi-line charts (blue, orange, aqua; validated for colour-blind
 * separation in each mode, same as --viz-1..3 in style.css). */
const PALETTES: Record<ThemeName, { background: string; text: string; grid: string; border: string; up: string; down: string; accent: string; viz1: string; viz2: string; viz3: string }> = {
  dark: { background: '#131722', text: '#d1d4dc', grid: '#1e222d', border: '#2a2e39', up: '#26a69a', down: '#ef5350', accent: '#2962ff', viz1: '#3987e5', viz2: '#d95926', viz3: '#199e70' },
  light: { background: '#ffffff', text: '#2a2f3a', grid: '#eef0f4', border: '#d6dbe3', up: '#26a69a', down: '#ef5350', accent: '#2962ff', viz1: '#2a78d6', viz2: '#eb6834', viz3: '#1baf7a' },
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
