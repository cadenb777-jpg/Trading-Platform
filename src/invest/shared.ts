/** Pieces shared by the Investments page sections: market boards, the symbol detail window and error boxes. */
import { openAssistant } from '../ai/hub';
import { insightButton } from '../ai/insight';
import type { MarketRef } from '../data/quotes';
import { engineRequest } from '../data/schwab';
import { createLineChart, pct, rangeBar, statCards } from '../ui/charts';
import { activatable, formatPrice, h, openModal } from '../ui/dom';
import { termLabel } from '../ui/glossary';
import { openSettings } from '../ui/settings';
import { sparkline } from '../ui/sparkline';
import { withTableTools } from '../ui/tableTools';
import type { BoardGroup } from './catalog';

export interface BoardRow {
  symbol: string;
  name: string;
  assetType?: string;
  price: number | null;
  /** Today's change as a fraction (0.012 = +1.2%). */
  change: number | null;
  m1?: number | null;
  m3?: number | null;
  ytd?: number | null;
  y1?: number | null;
  /** 1-year total return (dividends reinvested); dividend payers only. */
  tr1y?: number | null;
  spark?: number[];
  high52?: number | null;
  low52?: number | null;
  divYield?: number | null;
  peRatio?: number | null;
  /** Set (unix seconds) when price/change are the latest session's close because the market is closed. */
  atClose?: number | null;
}

/** "AI summary" for a market board: reads the rows the board has loaded (null until then). */
export function boardInsight(label: string, groups: BoardGroup[]) {
  let seen: Map<string, BoardRow> | null = null;
  const ai = insightButton(() => {
    if (!seen) return null;
    const rows = seen;
    const data = groups.map((g) => ({
      group: g.title,
      rows: g.symbols.map(([s, name]) => rows.get(s) && { ...rows.get(s)!, name, spark: undefined }).filter((r) => r && r.price != null),
    }));
    return { topic: 'board', symbol: '', market: label, title: `AI read: ${label}`, data };
  });
  const row = h('div', { class: 'home-ai-row' }, ai.button, h('span', { class: 'muted small' }, `What's leading and lagging in ${label.toLowerCase()}?`));
  return { row, panel: ai.panel, setRows: (rows: Map<string, BoardRow>) => (seen = rows) };
}

const closeDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

export interface InvestContext {
  openChart(ref: MarketRef): void;
  openResearch(symbol: string): void;
}

export const tone = (v: number | null | undefined): 'up' | 'down' | '' => (v == null || !Number.isFinite(v) || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');
export const showSymbol = (s: string) => s.replace(/^\$/, '');
export const factSheetLink = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(`${query} fact sheet`)}`;

/** Loads one board request for several groups at once; returns rows by symbol. */
export async function loadBoard(groups: BoardGroup[]): Promise<Map<string, BoardRow>> {
  const symbols = [...new Set(groups.flatMap((g) => g.symbols.map(([s]) => s)))];
  const { rows } = await engineRequest<{ rows: BoardRow[] }>('invest.board', { symbols }, 90000);
  return new Map(rows.map((r) => [r.symbol, r]));
}

function pctCell(v: number | null | undefined) {
  return h('td', { class: tone(v) }, pct(v));
}

/** A market board: one row per symbol with price, today, 1 month, YTD, 1 year and a 3-month line. */
export function boardTable(group: BoardGroup, rows: Map<string, BoardRow>, onPick: (symbol: string, label: string) => void) {
  const items = group.symbols.filter(([s]) => !group.hideEmpty || rows.get(s)?.price != null);
  if (!items.length) return h('div', { hidden: true });
  return h(
    'section',
    { class: 'panel inv-board' },
    h('div', { class: 'panel-head' }, h('h3', {}, group.title), group.note ? h('span', { class: 'muted small' }, group.note) : null),
    h(
      'div',
      { class: 'table-wrap' },
      withTableTools(h(
        'table',
        { class: 'data-table inv-table' },
        h('thead', {}, h('tr', {}, ...['Name', 'Price', 'Today', '1 month', 'YTD', '1 year', termLabel('1Y total', 'totalreturn'), '3 months'].map((t) => h('th', {}, t)))),
        h(
          'tbody',
          {},
          ...items.map(([symbol, label]) => {
            const r = rows.get(symbol);
            const up = (r?.m3 ?? r?.change ?? 0) >= 0;
            return activatable(h(
              'tr',
              { class: 'clickable', onclick: () => onPick(symbol, label) },
              h('td', { class: 'label', 'data-value': `${label} ${showSymbol(symbol)}` }, h('div', { class: 'inv-name' }, h('b', {}, label), h('span', { class: 'muted small' }, showSymbol(symbol)))),
              h('td', { 'data-value': r?.price != null ? String(r.price) : '' }, r?.price != null ? formatPrice(r.price) : h('span', { class: 'muted small', title: 'Schwab has no price for this right now' }, 'No quote'), r?.atClose ? h('div', { class: 'muted tiny' }, `At close ${closeDate(r.atClose)}`) : ''),
              pctCell(r?.change),
              pctCell(r?.m1),
              pctCell(r?.ytd),
              pctCell(r?.y1),
              r?.tr1y != null && r.y1 != null ? h('td', { class: tone(r.tr1y), title: `Price ${pct(r.y1)} + dividends ${pct(r.tr1y - r.y1)}` }, pct(r.tr1y)) : h('td', { class: 'muted' }, '—'),
              h('td', { class: 'inv-spark' }, r?.spark && r.spark.length > 1 ? sparkline(r.spark, null, up ? '#26a69a' : '#ef5350') : ''),
            ));
          }),
        ),
      ), { id: `board:${group.title}`, columns: { '3 months': 'none' } }),
    ),
  );
}

export function skeletonBoard(group: BoardGroup) {
  return h(
    'section',
    { class: 'panel inv-board' },
    h('div', { class: 'panel-head' }, h('h3', {}, group.title)),
    ...group.symbols.slice(0, 6).map(() => h('div', { class: 'skeleton', style: 'height:28px;margin:6px 0' })),
  );
}

/** A friendly error with a Retry button (and a Settings button when the SEC email is missing). */
export function errorBox(err: unknown, retry?: () => void) {
  const message = (err as Error)?.message || String(err);
  return h(
    'div',
    { class: 'ap-error inv-error' },
    h('span', {}, message),
    h(
      'span',
      { class: 'inv-error-actions' },
      /SEC email|contact email|Settings/i.test(message) ? h('button', { class: 'btn small', onclick: () => openSettings() }, 'Open Settings') : null,
      retry ? h('button', { class: 'btn small', onclick: retry }, 'Retry') : null,
    ),
  );
}

/** The window that opens when you click a stock, ETF, index or fund on a board. */
export function openSymbolDetail(symbol: string, label: string, row: BoardRow | undefined, ctx: InvestContext) {
  const chartBox = h('div', { class: 'skeleton', style: 'height:240px' });
  const shown = showSymbol(symbol);
  const isIndex = symbol.startsWith('$');
  const isFuture = symbol.startsWith('/');
  const head = h(
    'div',
    { class: 'inv-detail-head' },
    h('div', {}, h('div', { class: 'muted small' }, `${shown}${row?.name && row.name.toLowerCase() !== label.toLowerCase() ? ` · ${row.name}` : ''}`), h('div', { class: 'inv-detail-price' }, h('b', {}, formatPrice(row?.price)), h('span', { class: tone(row?.change) }, `${pct(row?.change)} today`))),
  );
  const stats = statCards([
    { label: '1 month', value: pct(row?.m1), tone: tone(row?.m1) },
    { label: '3 months', value: pct(row?.m3), tone: tone(row?.m3) },
    { label: 'Year to date', value: pct(row?.ytd), tone: tone(row?.ytd) },
    { label: '1 year', value: pct(row?.y1), tone: tone(row?.y1) },
    ...(row?.tr1y != null ? [{ label: termLabel('1-yr total return', 'totalreturn'), value: pct(row.tr1y), tone: tone(row.tr1y) }] : []),
    ...(row?.divYield ? [{ label: 'Dividend yield', value: `${row.divYield.toFixed(2)}%` }] : []),
    ...(row?.peRatio ? [{ label: 'P/E', value: row.peRatio.toFixed(1) }] : []),
  ]);
  const range = row?.high52 && row?.low52 ? h('div', { class: 'inv-range' }, h('span', { class: 'muted small' }, '52-week range'), rangeBar(row.low52, row.high52, row.price, formatPrice)) : null;
  const actions = h(
    'div',
    { class: 'inv-actions' },
    !isFuture
      ? h('button', { class: 'btn primary', onclick: () => (close(), ctx.openChart({ provider: 'schwab', symbol })) }, 'Open chart')
      : null,
    !isIndex && !isFuture && (row?.assetType ?? 'EQUITY') === 'EQUITY' ? h('button', { class: 'btn', onclick: () => (close(), ctx.openResearch(symbol)) }, 'Company research') : null,
    !isIndex && !isFuture ? h('a', { class: 'btn', href: factSheetLink(`${shown} ${label}`), target: '_blank', rel: 'noopener' }, 'Find fact sheet ↗') : null,
    h('button', { class: 'btn ai-btn', onclick: () => (close(), openAssistant(`How is ${label} (${shown}) doing lately, and why? Use live data.`)) }, h('span', { class: 'ai-spark' }, '✦'), ' Ask AI'),
  );
  const body = h('div', { class: 'inv-detail' }, head, stats, range, chartBox, actions);
  // The chart is removed with the window (or never built if the window closed first), so repeatedly opening
  // details doesn't leave hidden charts (canvases and theme listeners) behind.
  let closed = false;
  let lineChart: ReturnType<typeof createLineChart> | null = null;
  const close = openModal(label, body, {
    wide: true,
    onClose: () => {
      closed = true;
      lineChart?.chart.remove();
      lineChart = null;
    },
  });
  if (isFuture) {
    chartBox.remove();
    return;
  }
  engineRequest<{ closes: [number, number][] }>('invest.history', { symbol }, 45000)
    .then(({ closes }) => {
      if (closed) return;
      chartBox.classList.remove('skeleton');
      const chart = (lineChart = createLineChart(chartBox, { height: 240, format: formatPrice }));
      const up = closes.length > 1 && closes[closes.length - 1][1] >= closes[0][1];
      chart.set([{ name: `${shown} · last 13 months`, color: up ? '#26a69a' : '#ef5350', data: closes.map(([t, c]) => ({ time: t, value: c })) }]);
    })
    .catch((err) => chartBox.replaceWith(errorBox(err)));
}
