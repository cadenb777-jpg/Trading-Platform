/**
 * Workspace layouts (Chart > Workspace): which panels sit in the grid, their type, link colour and symbol, and the
 * named layouts you save. Pure and tested in workspaceLayouts.test.ts; saved in this browser's localStorage (with
 * try/catch: a blocked storage just means nothing is remembered).
 */
import { TIMEFRAMES, type Timeframe } from '../types';
import { LINK_COLORS, type LinkColor } from './linkGroups';

export const PANEL_TYPES = ['chart', 'quote', 'news', 'facts', 'positions'] as const;
export type PanelType = (typeof PANEL_TYPES)[number];
export const PANEL_LABELS: Record<PanelType, string> = { chart: 'Chart', quote: 'Quote', news: 'News', facts: 'Research facts', positions: 'My position' };

export const GRIDS = ['1x1', '2x1', '2x2', '1+2', '3x2'] as const;
export type Grid = (typeof GRIDS)[number];
/** Panels shown by each grid. */
export const GRID_SLOTS: Record<Grid, number> = { '1x1': 1, '2x1': 2, '2x2': 4, '1+2': 3, '3x2': 6 };
export const GRID_LABELS: Record<Grid, string> = { '1x1': '1', '2x1': '2', '2x2': '4', '1+2': '1+2', '3x2': '6' };
export const GRID_TITLES: Record<Grid, string> = { '1x1': 'One panel', '2x1': 'Two side by side', '2x2': 'Four (2 by 2)', '1+2': 'One large and two small', '3x2': 'Six (3 by 2)' };
export const MAX_PANELS = 6;

export interface PanelConfig {
  type: PanelType;
  link: LinkColor;
  /** The panel's own symbol (used when it isn't linked, or its group has none yet). */
  symbol: string;
  timeframe: Timeframe;
}

export interface Layout {
  name: string;
  grid: Grid;
  /** Always MAX_PANELS long; a smaller grid shows the first few and keeps the rest for later. */
  panels: PanelConfig[];
}

const p = (type: PanelType, link: LinkColor, symbol: string, timeframe: Timeframe = '1D'): PanelConfig => ({ type, link, symbol, timeframe });

/** Ready-made layouts. Blue is the group everything else follows by default. */
export const PRESETS: Layout[] = [
  { name: 'Morning', grid: '2x2', panels: [p('chart', 'blue', 'SPY', '15m'), p('news', 'blue', 'SPY'), p('quote', 'blue', 'SPY'), p('chart', 'none', '$SPX', '1D'), p('positions', 'blue', 'SPY'), p('facts', 'blue', 'SPY')] },
  { name: 'Trade', grid: '1+2', panels: [p('chart', 'blue', 'SPY', '5m'), p('quote', 'blue', 'SPY'), p('positions', 'blue', 'SPY'), p('news', 'blue', 'SPY'), p('chart', 'none', 'QQQ', '5m'), p('facts', 'blue', 'SPY')] },
  { name: 'Research', grid: '3x2', panels: [p('chart', 'blue', 'AAPL', '1D'), p('facts', 'blue', 'AAPL'), p('news', 'blue', 'AAPL'), p('quote', 'blue', 'AAPL'), p('positions', 'blue', 'AAPL'), p('chart', 'blue', 'AAPL', '1W')] },
];
export const PRESET_NAMES = PRESETS.map((l) => l.name);

const isOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** A layout read back from storage made safe: unknown values replaced, always MAX_PANELS panels. */
export function normalizeLayout(raw: unknown, fallback: Layout = PRESETS[0]): Layout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Layout>;
  const panels = Array.isArray(r.panels) ? r.panels : [];
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : fallback.name,
    grid: isOf(GRIDS, r.grid) ? r.grid : fallback.grid,
    panels: Array.from({ length: MAX_PANELS }, (_, i) => {
      const x = (panels[i] && typeof panels[i] === 'object' ? panels[i] : {}) as Partial<PanelConfig>;
      const f = fallback.panels[i];
      return {
        type: isOf(PANEL_TYPES, x.type) ? x.type : f.type,
        link: isOf(LINK_COLORS, x.link) ? x.link : f.link,
        symbol: typeof x.symbol === 'string' && x.symbol.trim() ? x.symbol.trim().toUpperCase().slice(0, 16) : f.symbol,
        timeframe: isOf(TIMEFRAMES, x.timeframe) && !x.timeframe.endsWith('s') ? x.timeframe : f.timeframe,
      };
    }),
  };
}

export interface Workspaces {
  /** What's on screen now (its name is the layout it came from). */
  current: Layout;
  /** Your own named layouts (the presets aren't stored). */
  saved: Layout[];
}

export const WORKSPACE_KEY = 'tp-workspace';
type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

export function loadWorkspaces(store: KeyStore | null): Workspaces {
  try {
    const raw = store?.getItem(WORKSPACE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Workspaces>) : {};
    const saved = (Array.isArray(v.saved) ? v.saved : []).map((l) => normalizeLayout(l)).slice(0, 20);
    return { current: normalizeLayout(v.current), saved };
  } catch {
    return { current: normalizeLayout(null), saved: [] };
  }
}

export function saveWorkspaces(w: Workspaces, store: KeyStore | null): boolean {
  try {
    store?.setItem(WORKSPACE_KEY, JSON.stringify(w));
    return !!store;
  } catch {
    return false;
  }
}

const copy = (l: Layout): Layout => ({ ...l, panels: l.panels.map((x) => ({ ...x })) });

/** Saves `layout` under `name` (replacing one of that name, any case). Preset names can't be taken. */
export function saveNamed(w: Workspaces, layout: Layout, name: string): Workspaces | { error: string } {
  const n = name.trim().slice(0, 40);
  if (!n) return { error: 'Give the layout a name.' };
  if (PRESET_NAMES.some((x) => x.toLowerCase() === n.toLowerCase())) return { error: `"${n}" is a ready-made layout; pick another name.` };
  const entry = { ...copy(layout), name: n };
  const saved = [...w.saved.filter((l) => l.name.toLowerCase() !== n.toLowerCase()), entry];
  return { current: { ...copy(layout), name: n }, saved };
}

export function deleteNamed(w: Workspaces, name: string): Workspaces {
  return { ...w, saved: w.saved.filter((l) => l.name !== name) };
}

/** A saved layout or preset by name, as a fresh copy to put on screen. */
export function findLayout(w: Workspaces, name: string): Layout | null {
  const l = w.saved.find((x) => x.name === name) ?? PRESETS.find((x) => x.name === name);
  return l ? copy(l) : null;
}
