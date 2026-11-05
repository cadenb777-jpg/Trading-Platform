/**
 * Macro > World: the shapes the helper sends (world.table, world.panel) and the pure helpers the page uses:
 * grouping countries by region (like Bloomberg's WEI/ECO), number formatting, change wording and sparkline paths.
 */

export interface WorldCell {
  value: number;
  /** '2025' for yearly figures, 'YYYY-MM-01' for monthly ones. */
  period: string;
  previous: number | null;
  source: string;
  /** How current the figure is, ready to show: 'updated 2026-10-15' (World Bank), the WEO edition (IMF) or 'downloaded 2026-11-05'. */
  asOf: string;
  data: { time: string; value: number }[];
  /** IMF forecasts: next year's figure. */
  next?: number | null;
  nextPeriod?: string;
  /** IMF forecasts: where the projection starts in `data`. */
  forecastFrom?: string;
  /** OECD CLI: Expansion / Downturn / Slowdown / Recovery. */
  phase?: string;
}

export interface WorldRow {
  code: string;
  name: string;
  region: string;
  cells: Record<string, WorldCell | null>;
}

export interface WorldIndicator {
  key: string;
  name: string;
  unit: string;
  source: string;
  freq: string;
}

export interface WorldTable {
  countries: { code: string; name: string; region: string }[];
  regions: string[];
  indicators: WorldIndicator[];
  rows: WorldRow[];
  errors: Record<string, string>;
  fetched: number | null;
}

export interface PanelSeries {
  id: string;
  name: string;
  unit: string;
  group: string;
  source: string;
  date: string | null;
  value: number | null;
  previous: number | null;
  data: { time: string; value: number }[];
  note?: string;
}

export interface WorldPanel {
  source: string;
  title: string;
  link: string;
  series: PanelSeries[];
  errors?: Record<string, string>;
  fetched?: number;
  needsKey?: boolean;
  signup?: string;
  note?: string;
  tip?: string;
  auctions?: { term: string; type: string; auctionDate: string; yield: number | null; bidToCover: number | null }[];
}

export const REGION_ORDER = ['Americas', 'Europe', 'Asia-Pacific'];

/** Rows grouped by region in the WEI order (Americas, Europe, Asia-Pacific; anything else last), keeping each
 * region's rows in the order given, and only the countries in `selected` (all when empty). */
export function groupByRegion<T extends { region: string; code: string }>(rows: T[], selected: string[] = [], order = REGION_ORDER): { region: string; rows: T[] }[] {
  const keep = selected.length ? rows.filter((r) => selected.includes(r.code)) : rows;
  const regions = [...order, ...[...new Set(keep.map((r) => r.region))].filter((r) => !order.includes(r))];
  return regions.map((region) => ({ region, rows: keep.filter((r) => r.region === region) })).filter((g) => g.rows.length);
}

/** A figure for the table: '2.8%', '−0.1%', '112%' for debt, '100.3' for the CLI. */
export function fmtWorld(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (unit === '% GDP') return `${sign}${a.toFixed(0)}%`;
  if (unit === '%') return `${sign}${a.toFixed(1)}%`;
  if (unit === 'pts') return `${v >= 0 ? '+' : '−'}${a.toFixed(2)} pts`;
  if (unit === 'K') return `${sign}${Math.round(a).toLocaleString('en-US')}K`;
  if (unit === '$T') return `$${a.toFixed(2)}T`;
  if (unit === '$B') return `$${Math.round(a).toLocaleString('en-US')}B`;
  if (unit === '$') return `$${a.toFixed(2)}`;
  if (unit === 'M bbl') return `${a.toFixed(1)}M bbl`;
  if (unit === 'h') return `${a.toFixed(1)} h`;
  return `${sign}${a >= 100 ? a.toFixed(1) : a.toFixed(a >= 10 ? 2 : 4)}`;
}

/** A period for display: '2025', 'Sep 2026', '2026 Q2' (quarterly when `quarterly`), or a full date. */
export function fmtPeriod(p: string | null | undefined, quarterly = false): string {
  if (!p) return '';
  if (/^\d{4}$/.test(p)) return p;
  const [y, m, d] = p.split('-').map(Number);
  if (quarterly) return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return d && d !== 1 ? `${month} ${d}, ${y}` : `${month} ${y}`;
}

/** The change from the previous reading in words ('+0.3 pts', '−12K'); null without a previous reading. */
export function changeText(value: number | null, previous: number | null, unit: string): string | null {
  if (value == null || previous == null) return null;
  const d = value - previous;
  if (Math.abs(d) < 1e-9) return 'unchanged';
  const s = d >= 0 ? '+' : '−';
  if (unit === '%' || unit === '% GDP' || unit === 'pts') return `${s}${Math.abs(d).toFixed(2)} pts`;
  if (unit === 'K') return `${s}${Math.round(Math.abs(d)).toLocaleString('en-US')}K`;
  if (unit === '$T') return `${s}$${(Math.abs(d) * 1000).toFixed(0)}B`;
  if (unit === '$B') return `${s}$${Math.abs(d).toFixed(0)}B`;
  if (!previous) return `${s}${Math.abs(d).toFixed(2)}`;
  return `${s}${((Math.abs(d) / Math.abs(previous)) * 100).toFixed(1)}%`;
}

/** SVG path ('M x y L ...') for a sparkline of `values` in a w×h box (2px inset); '' with fewer than 2 points. */
export function sparkPath(values: number[], w = 72, h = 20): string {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const step = (w - 4) / (v.length - 1);
  return v.map((x, i) => `${i ? 'L' : 'M'}${(2 + i * step).toFixed(1)} ${(h - 2 - ((x - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
}

/** Which countries to show: saved choice filtered to known codes, or all. */
export function pickCountries(saved: string[] | null | undefined, all: string[]): string[] {
  const keep = (saved ?? []).filter((c) => all.includes(c));
  return keep.length ? keep : [...all];
}
