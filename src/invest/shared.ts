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
import { loadState, withTableTools } from '../ui/tableTools';
import type { BoardGroup } from './catalog';
import { asOfStamp } from '../ui/dataHealth';
import { rangeForColumn } from './miniMath';
import { interactive, type MiniItem } from './rowInteract';
import { openSecurity, symbolActions, symbolKind } from './goTo';

export interface BoardRow {
  symbol: string;
  name: string;
  assetType?: string;
  /** Schwab's assetSubType ('ETF', 'COE', ...); sent by newer helpers only. */
  assetSubType?: string;
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
  /** When the helper made this board reply (unix seconds). */
  asOf?: number;
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
  /** Go to a page and call one of its methods (main.ts openPageWith), for the rows' "Go to" actions. */
  openPage?(route: string, method?: string, ...args: unknown[]): void;
}

export const tone = (v: number | null | undefined): 'up' | 'down' | '' => (v == null || !Number.isFinite(v) || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');
export const showSymbol = (s: string) => s.replace(/^\$/, '');
export const factSheetLink = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(`${query} fact sheet`)}`;

/** Loads one board request for several groups at once; returns rows by symbol. */
export async function loadBoard(groups: BoardGroup[]): Promise<Map<string, BoardRow>> {
  const symbols = [...new Set(groups.flatMap((g) => g.symbols.map(([s]) => s)))];
  const { rows, asOf } = await engineRequest<{ rows: BoardRow[]; asOf?: number }>('invest.board', { symbols }, 90000);
  return new Map(rows.map((r) => [r.symbol, { ...r, asOf }]));
}

/** A % cell; a missing value is "—" with the reason on hover and for screen readers (never NaN). */
function pctCell(v: number | null | undefined, why: string) {
  if (v == null || !Number.isFinite(v)) return naCell(why);
  return h('td', { class: tone(v) }, pct(v));
}

/** "—" plus why it's missing. `data-value` stays empty so sorting and filtering treat it as blank. */
export function naCell(why: string) {
  return h('td', { class: 'muted', 'data-value': '', title: why }, h('span', { 'aria-hidden': 'true' }, '—'), h('span', { class: 'sr-only' }, why));
}

/** Why a board row has no value for a period. */
function missingWhy(symbol: string, r: BoardRow | undefined) {
  if (symbol.startsWith('/')) return 'Schwab has no daily history for futures';
  if (!r) return 'Not in the latest reply from Schwab';
  if (r.price == null) return 'No quote right now';
  return 'Not enough price history for this period';
}

/**
 * Opens a symbol's full view: the security view when this build has one (goTo.ts), otherwise the symbol window below.
 * Futures always use the window.
 */
export function openSymbol(symbol: string, label: string, row: BoardRow | undefined, ctx: InvestContext) {
  if (symbol.startsWith('/')) return openSymbolDetail(symbol, label, row, ctx);
  openSecurity(symbol, undefined, () => openSymbolDetail(symbol, label, row, ctx));
}

/** What a board row shows in its mini chart and expanded view. */
export function boardItem(symbol: string, label: string, r: BoardRow | undefined, open: () => void, ctx?: InvestContext): MiniItem {
  return {
    actions: ctx ? () => symbolActions(symbol, label, symbolKind(symbol, r?.assetType, r?.assetSubType), ctx, () => openSymbolDetail(symbol, label, r, ctx), r?.price) : undefined,
    key: symbol,
    label,
    sub: showSymbol(symbol),
    live: r ? { price: r.price, high52: r.high52, low52: r.low52 } : undefined,
    held: symbol.startsWith('$') || symbol.startsWith('/') ? undefined : symbol,
    source: symbol.startsWith('/') ? { kind: 'none', reason: 'Schwab has no daily history for futures; the price here is live only.' } : { kind: 'symbol', symbol },
    mode: 'price',
    open,
    facts: () => [
      { label: 'Price', value: r?.price != null ? formatPrice(r.price) : '—' },
      { label: 'Today', value: pct(r?.change) },
      ...(r?.tr1y != null ? [{ label: '1-yr total return', value: pct(r.tr1y) }] : []),
      ...(r?.divYield ? [{ label: 'Dividend yield', value: `${r.divYield.toFixed(2)}%` }] : []),
      ...(r?.peRatio ? [{ label: 'P/E', value: r.peRatio.toFixed(1) }] : []),
    ],
  };
}

/**
 * A market board: one row per symbol with price, today, 1 month, YTD, 1 year and a 3-month line. Rows follow the
 * page's interaction model (rowInteract.ts): hover for a mini chart, Space to expand, Shift+click to compare.
 */
export function boardTable(group: BoardGroup, rows: Map<string, BoardRow>, onPick: (symbol: string, label: string) => void, ctx?: InvestContext) {
  const items = group.symbols.filter(([s]) => !group.hideEmpty || rows.get(s)?.price != null);
  if (!items.length) return h('div', { hidden: true });
  const id = `board:${group.title}`;
  const entries: [HTMLElement, MiniItem][] = [];
  const table = withTableTools(h(
    'table',
    { class: 'data-table inv-table' },
    h('thead', {}, h('tr', {}, ...['Name', 'Price', 'Today', '1 month', 'YTD', '1 year', termLabel('1Y total', 'totalreturn'), '3 months'].map((t) => h('th', {}, t)))),
    h(
      'tbody',
      {},
      ...items.map(([symbol, label]) => {
        const r = rows.get(symbol);
        const why = missingWhy(symbol, r);
        const up = (r?.m3 ?? r?.change ?? 0) >= 0;
        const tr = activatable(h(
          'tr',
          { class: 'clickable' },
          h('td', { class: 'label', 'data-value': `${label} ${showSymbol(symbol)}` }, h('div', { class: 'inv-name' }, h('b', {}, label), h('span', { class: 'muted small' }, showSymbol(symbol)))),
          h('td', { 'data-value': r?.price != null ? String(r.price) : '' }, r?.price != null ? formatPrice(r.price) : h('span', { class: 'muted small', title: 'Schwab has no price for this right now' }, 'No quote'), r?.atClose ? h('div', { class: 'muted tiny' }, `At close ${closeDate(r.atClose)}`) : ''),
          pctCell(r?.change, r?.price == null ? 'No quote right now' : 'No change reported'),
          pctCell(r?.m1, why),
          pctCell(r?.ytd, why),
          pctCell(r?.y1, why),
          r?.tr1y != null && r.y1 != null ? h('td', { class: tone(r.tr1y), title: `Price ${pct(r.y1)} + dividends ${pct(r.tr1y - r.y1)}` }, pct(r.tr1y)) : naCell(symbol.startsWith('/') || symbol.startsWith('$') ? 'No dividends (index or future)' : 'Pays no dividend, or not enough history'),
          h('td', { class: 'inv-spark' }, r?.spark && r.spark.length > 1 ? sparkline(r.spark, null, up ? '#26a69a' : '#ef5350') : ''),
        ));
        entries.push([tr, boardItem(symbol, label, r, () => onPick(symbol, label), ctx)]);
        return tr;
      }),
    ),
  ), { id, columns: { '3 months': 'none' } });
  interactive(table, entries, { boardId: id, expandable: true, defaultRange: () => rangeForColumn(loadState(id).sort?.col) });
  return h(
    'section',
    { class: 'panel inv-board' },
    h('div', { class: 'panel-head' }, h('h3', {}, group.title), group.note ? h('span', { class: 'muted small' }, group.note) : null, boardStamp(items.map(([s]) => rows.get(s)))),
    h('div', { class: 'table-wrap' }, table),
  );
}

/** "as of 10:42 · Schwab", or the session's close when the market is shut. */
function boardStamp(rows: (BoardRow | undefined)[]) {
  const closed = rows.find((r) => r?.atClose)?.atClose;
  const stamp = asOfStamp('quotes').set(rows.find((r) => r?.asOf)?.asOf);
  if (closed) stamp.set(closed, { prefix: 'close', refreshMs: 0 });
  return stamp.el;
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
