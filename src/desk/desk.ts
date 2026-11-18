/**
 * The Desk (Bloomberg Launchpad, owner's spec 7.19): your own screens built from tiles, saved as named views you switch
 * between. This file is the layout state and its edits, pure and tested (desk.test.ts); deskPage.ts draws the tiles.
 * Saved per device in localStorage (a layout preference, like Home's widgets), checked on read so a damaged entry
 * falls back to the starter views.
 */

export type TileType = 'chart' | 'quotes' | 'news' | 'sectors' | 'world' | 'movers' | 'events' | 'fed' | 'curve' | 'notes';
export const SPANS = [3, 4, 6, 8, 12] as const;
export type Span = (typeof SPANS)[number];

export interface Tile {
  id: string;
  type: TileType;
  span: Span;
  /** Ticker(s): one for a chart, several for a quote list, optional for news. */
  symbols?: string[];
  /** Notes text. */
  text?: string;
}
export interface View {
  id: string;
  name: string;
  tiles: Tile[];
}
export interface Desk {
  v: 1;
  views: View[];
  current: string;
}

export const TILE_TYPES: { type: TileType; title: string; span: Span; needs?: 'one' | 'many'; about: string }[] = [
  { type: 'chart', title: 'Chart', span: 6, needs: 'one', about: 'A one-year price chart of any ticker' },
  { type: 'quotes', title: 'Quote monitor', span: 4, needs: 'many', about: 'Live prices for the tickers you list' },
  { type: 'news', title: 'News', span: 4, about: 'Top headlines, or news on the tickers you list' },
  { type: 'world', title: 'World equities', span: 6, about: 'Stock markets by region today' },
  { type: 'sectors', title: 'Nasdaq-100 by sector', span: 4, about: 'Sector sunburst, live' },
  { type: 'movers', title: 'S&P 500 movers', span: 4, about: 'Biggest gainers and losers today' },
  { type: 'events', title: 'Economic events', span: 4, about: 'The next releases and their forecasts' },
  { type: 'fed', title: 'Fed rate odds', span: 6, about: 'Cut / hold / hike odds by meeting and the rate path' },
  { type: 'curve', title: 'Yield curve', span: 6, about: 'Treasury curve today, a month and a year ago' },
  { type: 'notes', title: 'Notes', span: 4, about: 'Your own notes (kept on this computer)' },
];
export const tileType = (t: TileType) => TILE_TYPES.find((x) => x.type === t)!;

export const DESK_KEY = 'tp-desk';
let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const starterDesk = (): Desk => ({
  v: 1,
  current: 'v-morning',
  views: [
    {
      id: 'v-morning',
      name: 'Morning',
      tiles: [
        { id: 't1', type: 'world', span: 6 },
        { id: 't2', type: 'sectors', span: 3 },
        { id: 't3', type: 'events', span: 3 },
        { id: 't4', type: 'chart', span: 6, symbols: ['SPY'] },
        { id: 't5', type: 'news', span: 6 },
      ],
    },
    {
      id: 'v-trading',
      name: 'Trading',
      tiles: [
        { id: 't6', type: 'chart', span: 8, symbols: ['QQQ'] },
        { id: 't7', type: 'quotes', span: 4, symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'] },
        { id: 't9', type: 'fed', span: 8 },
        { id: 't8', type: 'movers', span: 4 },
        { id: 't11', type: 'news', span: 8, symbols: [] },
        { id: 't10', type: 'notes', span: 4, text: '' },
      ],
    },
  ],
});

const TICKER = /^[A-Z$/][A-Z0-9.\-/]{0,11}$/;
export const cleanSymbols = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [])
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => TICKER.test(s))
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 20);

/** Reads a saved desk, keeping only valid views and tiles; anything unreadable gives the starter desk. */
export function parseDesk(raw: string | null | undefined): Desk {
  try {
    const d = JSON.parse(raw ?? '');
    if (!d || !Array.isArray(d.views)) return starterDesk();
    const views: View[] = [];
    for (const v of d.views) {
      if (!v || typeof v.id !== 'string' || typeof v.name !== 'string' || !Array.isArray(v.tiles)) continue;
      const tiles: Tile[] = [];
      for (const t of v.tiles) {
        if (!t || typeof t.id !== 'string' || !TILE_TYPES.some((x) => x.type === t.type)) continue;
        const span = (SPANS as readonly number[]).includes(t.span) ? (t.span as Span) : tileType(t.type).span;
        const tile: Tile = { id: t.id, type: t.type, span };
        if (t.symbols) tile.symbols = cleanSymbols(t.symbols);
        if (typeof t.text === 'string') tile.text = t.text.slice(0, 5000);
        tiles.push(tile);
      }
      views.push({ id: v.id, name: v.name.slice(0, 40) || 'View', tiles });
    }
    if (!views.length) return starterDesk();
    return { v: 1, views, current: views.some((v) => v.id === d.current) ? d.current : views[0].id };
  } catch {
    return starterDesk();
  }
}

const mapView = (d: Desk, id: string, f: (v: View) => View): Desk => ({ ...d, views: d.views.map((v) => (v.id === id ? f(v) : v)) });
export const currentView = (d: Desk) => d.views.find((v) => v.id === d.current) ?? d.views[0];

export function addView(d: Desk, name: string): Desk {
  const id = newId('v-');
  return { ...d, views: [...d.views, { id, name: name.trim().slice(0, 40) || `View ${d.views.length + 1}`, tiles: [] }], current: id };
}
export const renameView = (d: Desk, id: string, name: string): Desk => mapView(d, id, (v) => ({ ...v, name: name.trim().slice(0, 40) || v.name }));
/** Deletes a view (never the last one); the one before it becomes current. */
export function deleteView(d: Desk, id: string): Desk {
  if (d.views.length < 2) return d;
  const i = d.views.findIndex((v) => v.id === id);
  const views = d.views.filter((v) => v.id !== id);
  return { ...d, views, current: d.current === id ? views[Math.max(0, i - 1)].id : d.current };
}
export function addTile(d: Desk, type: TileType, symbols: string[] = []): Desk {
  const t: Tile = { id: newId('t-'), type, span: tileType(type).span };
  if (tileType(type).needs || type === 'news') t.symbols = cleanSymbols(symbols);
  if (type === 'notes') t.text = '';
  return mapView(d, d.current, (v) => ({ ...v, tiles: [...v.tiles, t] }));
}
export const removeTile = (d: Desk, tileId: string): Desk => mapView(d, d.current, (v) => ({ ...v, tiles: v.tiles.filter((t) => t.id !== tileId) }));
export const updateTile = (d: Desk, tileId: string, patch: Partial<Omit<Tile, 'id' | 'type'>>): Desk =>
  mapView(d, d.current, (v) => ({ ...v, tiles: v.tiles.map((t) => (t.id === tileId ? { ...t, ...patch } : t)) }));
/** Moves a tile one place earlier (-1) or later (+1) in the reading order. */
export function moveTile(d: Desk, tileId: string, dir: -1 | 1): Desk {
  return mapView(d, d.current, (v) => {
    const i = v.tiles.findIndex((t) => t.id === tileId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= v.tiles.length) return v;
    const tiles = [...v.tiles];
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    return { ...v, tiles };
  });
}
export const nextSpan = (s: Span): Span => SPANS[(SPANS.indexOf(s) + 1) % SPANS.length];
