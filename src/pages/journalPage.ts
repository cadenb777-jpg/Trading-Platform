/**
 * Journal page (#journal, command bar JRNL): the owner's own trades, built from Webull fills, broker exports and manual
 * entries (stored by the helper in platform.db, never in the browser). Views: Dashboard (equity curve, KPIs, P&L
 * calendar, breakdowns, R distribution), Trades (filters, bulk tags, detail with chart replay), Daily (pre-market plan
 * and review), Playbooks (rules checklists and adherence), Reports (monthly, realized gains estimate, CSV) and Import.
 * Maths: src/journal/stats.ts; broker formats: src/journal/importers.ts; helper: helper/engine/journal.py.
 * The journal never places orders; the AI coach only reads the owner's journal and shows its cost first.
 */
import { CandlestickSeries, ColorType, LineStyle, createChart, createSeriesMarkers, type IChartApi } from 'lightweight-charts';
import { renderMarkdown } from '../ai/markdown';
import { continueInAssistant } from '../ai/hub';
import { friendlyAiError } from '../ai/assistant';
import type { MarketRef } from '../data/quotes';
import { engineRequest, helper, journalReady, type EngineEvent } from '../data/schwab';
import { parseCsv } from '../invest/holdings';
import { IMPORT_FIELDS, PRESETS, GENERIC_PRESET, mapColumns, nyTime, parseExport, rowsToFills, type ImportColumns, type ImportField, type ImportFill, type Preset } from '../journal/importers';
import { journalSymbols } from '../journal/links';
import {
  BREAKDOWNS,
  MIN_TRADES,
  adherence,
  adherenceSummary,
  afterLoss,
  applyFilters,
  atrAt,
  avgPrice,
  breakdown,
  calendarMonth,
  computeStats,
  counted,
  dailyPnl,
  equityCurve,
  excursions,
  holdSeconds,
  monthly,
  nyParts,
  qtyOf,
  rHistogram,
  rOf,
  realizedLots,
  tradeDay,
  tradePnl,
  tradesCsv,
  type Filters,
  type Trade,
} from '../journal/stats';
import { cleanBars, type Bar } from '../types';
import { createLineChart, dataTable, pageFrame, statCards } from '../ui/charts';
import { activatableRows, h, openModal, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { THEME, followTheme } from '../ui/theme';

type View = 'dashboard' | 'trades' | 'daily' | 'playbooks' | 'reports' | 'import';
const VIEWS: [View, string][] = [['dashboard', 'Dashboard'], ['trades', 'Trades'], ['daily', 'Daily'], ['playbooks', 'Playbooks'], ['reports', 'Reports'], ['import', 'Import']];
const FILTER_KEY = 'tp-journal-filters';
const EMOTIONS = ['Calm', 'Confident', 'Focused', 'Patient', 'Anxious', 'Fearful', 'FOMO', 'Greedy', 'Impatient', 'Frustrated', 'Revenge', 'Bored', 'Tired'];
const MISTAKES = ['Chased entry', 'No stop', 'Moved stop', 'Oversized', 'Exited early', 'Held loser too long', 'Ignored plan', 'Overtraded', 'Traded news'];
const DAY_CHECKS = ['Checked the calendar and earnings', 'Marked key levels', 'Know my max loss for today', 'Only A/B setups from my playbooks'];
const STATS_DOC = 'https://github.com/cadenb777-jpg/Trading-Platform/blob/main/docs/research/setups-statistics.md';

interface Playbook {
  pbId: string;
  name: string;
  description: string;
  rules: string[];
}
interface ImportEntry {
  id: string;
  at: number;
  source: string;
  added: number;
  skipped: number;
  note?: string;
}
interface DayDoc {
  day: string;
  plan: string;
  review: string;
  lessons: string;
  mood: number;
  checklist: boolean[];
}
interface Coach {
  estimate: { costUsd: number; tokensIn: number; tokensOut: number; model: string };
  text?: string;
  conversation?: string;
}

const usd = (v: number | null | undefined, signed = false) =>
  v == null || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Math.abs(v) < 1000 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 })}`;
const pc = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
const fmtR = (t: Trade) => {
  const r = rOf(t);
  return r ? `${r.r >= 0 ? '+' : ''}${r.r.toFixed(2)}R${r.estimated ? '*' : ''}` : '—';
};
const when = (t: number) => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
function duration(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${Math.round(s / 86400)}d`;
}
const todayNY = () => nyParts(Date.now() / 1000).day;
function load<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? 'null') };
  } catch {
    return fallback;
  }
}
function download(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function createJournalPage(openChart: (ref: MarketRef) => void) {
  let view: View = 'dashboard';
  let trades: Trade[] = [];
  let playbooks: Playbook[] = [];
  let imports: ImportEntry[] = [];
  let loaded = false;
  let loadError = '';
  const filters: Filters = load<Filters>(FILTER_KEY, {});
  let month = todayNY().slice(0, 7);
  let breakdownKey = 'strategy';
  let selectedDay: string | null = null;
  const selected = new Set<string>();
  let sort: { col: string; dir: 1 | -1 } = { col: 'date', dir: -1 };
  let charts: { remove(): void }[] = [];

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Journal views' });
  const frame = pageFrame('Journal', 'Your own trades, from Webull, broker exports or typed in: what works, what doesn’t, and why.', [tabs]);
  frame.el.classList.add('jr-page');
  const filterBar = h('div', { class: 'jr-filters', role: 'group', 'aria-label': 'Filters' });
  const body = h('div', { class: 'jr-body' });
  frame.body.replaceChildren(filterBar, body);

  function drawTabs() {
    tabs.replaceChildren(
      ...VIEWS.map(([v, label]) =>
        h('button', { class: `tab${v === view ? ' active' : ''}`, role: 'tab', 'aria-selected': v === view ? 'true' : 'false', onclick: () => setView(v) }, label),
      ),
    );
  }
  function setView(v: View) {
    view = v;
    history.replaceState(null, '', v === 'dashboard' ? '#journal' : `#journal/${v}`);
    render();
  }
  function saveFilters() {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* per-viewer convenience only */
    }
  }

  async function reload() {
    try {
      const d = await engineRequest<{ trades: Trade[]; playbooks: Playbook[]; imports: ImportEntry[] }>('journal.list', {}, 30000);
      trades = d.trades;
      playbooks = d.playbooks;
      imports = d.imports;
      loadError = '';
      journalSymbols.clear();
      for (const t of trades) journalSymbols.add(t.symbol);
    } catch (err) {
      loadError = (err as Error).message;
    }
    loaded = true;
    render();
  }

  // ---------- filters ----------
  function drawFilters() {
    const show = view === 'dashboard' || view === 'trades' || view === 'reports';
    filterBar.hidden = !show || !trades.length;
    if (filterBar.hidden) return;
    const presets: [string, () => Filters][] = [
      ['All time', () => ({ from: '', to: '' })],
      ['This month', () => ({ from: `${todayNY().slice(0, 7)}-01`, to: '' })],
      ['Last 30 days', () => ({ from: nyParts(Date.now() / 1000 - 30 * 86400).day, to: '' })],
      ['This year', () => ({ from: `${todayNY().slice(0, 4)}-01-01`, to: '' })],
    ];
    const accounts = [...new Set(trades.map((t) => t.account))].sort();
    const input = (key: 'from' | 'to', label: string) =>
      h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, label), h('input', { class: 'input', type: 'date', value: filters[key] ?? '', onchange: (e: Event) => ((filters[key] = (e.target as HTMLInputElement).value), saveFilters(), render()) }));
    const symbol = h('input', { class: 'input jr-sym', placeholder: 'Symbol', value: filters.symbol ?? '', 'aria-label': 'Symbol' }) as HTMLInputElement;
    symbol.addEventListener('change', () => ((filters.symbol = symbol.value.trim().toUpperCase()), saveFilters(), render()));
    filterBar.replaceChildren(
      h('div', { class: 'segmented small' }, ...presets.map(([label, f]) => h('button', { type: 'button', onclick: () => (Object.assign(filters, f()), saveFilters(), render()) }, label))),
      input('from', 'From'),
      input('to', 'To'),
      symbol,
      accounts.length > 1
        ? h('select', { class: 'input', 'aria-label': 'Account', onchange: (e: Event) => ((filters.account = (e.target as HTMLSelectElement).value), saveFilters(), render()) },
            h('option', { value: '' }, 'All accounts'), ...accounts.map((a) => h('option', { value: a, selected: filters.account === a }, a)))
        : '',
      Object.values(filters).some(Boolean) ? h('button', { class: 'btn small ghost', onclick: () => (Object.keys(filters).forEach((k) => delete filters[k as keyof Filters]), saveFilters(), render()) }, 'Clear') : '',
    );
  }
  const shown = () => applyFilters(trades, filters);

  // ---------- render ----------
  function render() {
    for (const c of charts) c.remove();
    charts = [];
    drawTabs();
    if (!helper.isConnected && !loaded) return body.replaceChildren(h('div', { class: 'empty-state' }, 'Start the helper on your computer: the journal is kept there (never in the browser).'));
    if (!journalReady()) {
      filterBar.hidden = true;
      return body.replaceChildren(
        h('div', { class: 'empty-state' }, h('b', {}, 'Update the helper to use the journal. '), 'Your helper is an older version; use Update now in the banner (or download the project ZIP again and replace the helper folder).'),
      );
    }
    if (!loaded) return body.replaceChildren(h('div', { class: 'muted pad' }, 'Loading your journal…'));
    if (loadError) return body.replaceChildren(h('div', { class: 'ap-error' }, loadError));
    drawFilters();
    if (!trades.length && view !== 'import' && view !== 'daily' && view !== 'playbooks') return body.replaceChildren(firstRun());
    ({ dashboard: drawDashboard, trades: drawTrades, daily: drawDaily, playbooks: drawPlaybooks, reports: drawReports, import: drawImport })[view]();
  }

  function firstRun() {
    return h(
      'div',
      { class: 'empty-state jr-first' },
      h('h2', {}, 'Bring in your past trades'),
      h('p', {}, 'Import your Webull history (read-only, as far back as Webull allows), a CSV/Excel export from any broker, or type a trade in. Nothing is doubled if you import the same trades twice.'),
      h('div', { class: 'jr-row' }, h('button', { class: 'btn primary', onclick: () => setView('import') }, 'Import trades'), h('button', { class: 'btn', onclick: () => manualTrade() }, 'Add a trade by hand')),
    );
  }

  function honesty(n: number) {
    if (n >= MIN_TRADES) return h('p', { class: 'muted small jr-sample' }, `Based on ${n} closed trades.`);
    return h(
      'p',
      { class: 'jr-sample small' },
      h('b', {}, `Not enough trades yet: ${n} closed of ${MIN_TRADES}. `),
      'With fewer than 30 trades, win rate and profit factor swing a lot by luck, so read them as hints. ',
      h('a', { href: STATS_DOC, target: '_blank', rel: 'noopener' }, 'Why 30?'),
    );
  }

  // ---------- dashboard ----------
  function drawDashboard() {
    const list = shown();
    const s = computeStats(list);
    const curve = equityCurve(list);
    const chartBox = h('div', { class: 'jr-equity' });
    const best = list.filter(counted).sort((a, b) => tradePnl(b)!.net - tradePnl(a)!.net);
    const al = afterLoss(list);
    const alStats = computeStats(al.after);
    const adh = adherenceSummary(list);
    const hero = h(
      'section',
      { class: 'panel jr-hero' },
      h('div', { class: 'jr-hero-head' },
        h('div', {}, h('span', { class: 'stat-label' }, 'Net P&L after fees'), h('b', { class: `jr-big ${tone(s.net)}` }, usd(s.net, true))),
        h('div', { class: 'jr-hero-side muted small' }, `${s.n} closed · ${s.open} open${s.excluded ? ` · ${s.excluded} left out (opened before the journal or cost unknown)` : ''}`),
      ),
      chartBox,
      honesty(s.n),
    );
    const kpis = statCards([
      { label: 'Win rate', value: pc(s.winRate), hint: `${s.wins} won, ${s.losses} lost` },
      { label: h('span', {}, 'Profit factor ', infoTip('pf')), value: num2(s.profitFactor), hint: 'Money won ÷ money lost' },
      { label: 'Expectancy', value: usd(s.expectancy, true), tone: tone(s.expectancy), hint: s.expectancyR != null ? `${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(2)}R a trade (${s.nR} with an R)` : 'Average result a trade' },
      { label: 'Avg win / loss', value: `${usd(s.avgWin)} / ${usd(s.avgLoss)}`, hint: s.payoff != null ? `Payoff ratio ${s.payoff.toFixed(2)}` : '' },
      { label: 'Max drawdown', value: usd(s.maxDrawdown), tone: s.maxDrawdown < 0 ? 'down' : '', hint: 'Deepest fall from a high in the equity curve' },
      { label: 'Streak', value: s.currentStreak ? `${Math.abs(s.currentStreak)} ${s.currentStreak > 0 ? 'wins' : 'losses'}` : '—', hint: `Longest: ${s.maxConsecWins} wins, ${s.maxConsecLosses} losses` },
      { label: 'Sharpe / Sortino', value: `${num2(s.sharpe)} / ${num2(s.sortino)}`, hint: 'On daily P&L, yearly scale' },
      { label: 'Fees', value: usd(s.fees), hint: `Gross ${usd(s.gross, true)}` },
    ]);
    const pickRow = (t: Trade) => h('button', { class: 'jr-pick', type: 'button', onclick: () => openTrade(t) }, h('b', {}, t.symbol), h('span', { class: 'muted small' }, tradeDay(t)), h('span', { class: `num ${tone(tradePnl(t)!.net)}` }, usd(tradePnl(t)!.net, true)));
    const extremes = h(
      'section',
      { class: 'panel jr-extremes' },
      h('div', {}, h('h3', { class: 'section-label' }, 'Best trades'), ...best.slice(0, 3).map(pickRow)),
      h('div', {}, h('h3', { class: 'section-label' }, 'Worst trades'), ...best.slice(-3).reverse().map(pickRow)),
    );
    const checks = h(
      'section',
      { class: 'panel jr-checks' },
      h('h3', { class: 'section-label' }, 'Habits'),
      h('p', { class: 'small' }, adh.stop.n ? `Followed the stop on ${pc(adh.stop.rate)} of ${adh.stop.n} trades with a planned stop.` : 'No trades with a planned stop yet: add stops to see whether you honour them.'),
      h('p', { class: 'small' }, adh.sized.n ? `Sized within 1.5× your usual risk on ${pc(adh.sized.rate)} of ${adh.sized.n} trades.` : ''),
      al.after.length
        ? h('p', { class: 'small' }, `${al.after.length} trade${al.after.length === 1 ? '' : 's'} opened within an hour of a loss: net ${usd(alStats.net, true)}, ${pc(alStats.winRate)} won`, al.after.length < 10 ? ' (few trades: a hint only).' : '.')
        : '',
    );
    body.replaceChildren(hero, kpis, drawCalendar(list), h('div', { class: 'jr-grid2' }, extremes, checks), drawHistogram(list), drawBreakdown(list), coachPanel('period', list));
    const chart = createLineChart(chartBox, { height: 240, format: (v) => usd(v), title: 'Journal equity curve' });
    chart.set([
      { name: 'Net P&L', color: THEME.accent, data: curve.map((p, i) => ({ time: p.time + i * 1e-3, value: p.equity })).map((p) => ({ time: Math.round(p.time), value: p.value })).filter((p, i, a) => i === a.length - 1 || a[i + 1].time !== p.time) },
    ]);
    charts.push(chart);
  }

  function drawCalendar(list: Trade[]) {
    const daily = dailyPnl(list);
    const [y, m] = month.split('-').map(Number);
    const cal = calendarMonth(y, m, daily);
    const max = Math.max(1, ...[...daily.values()].map((d) => Math.abs(d.net)));
    const shift = (k: number) => {
      const d = new Date(Date.UTC(y, m - 1 + k, 1));
      month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      selectedDay = null;
      render();
    };
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const grid = h('div', { class: 'jr-cal', role: 'grid', 'aria-label': `P&L calendar, ${label}` },
      ...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Week'].map((d) => h('div', { class: 'jr-cal-head' }, d)),
      ...cal.weeks.flatMap((w) => [
        ...w.cells.map((c) => {
          if (!c) return h('div', { class: 'jr-cal-cell empty' });
          const v = c.cell?.net ?? 0;
          const cls = c.cell ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : '';
          return h(
            'button',
            { type: 'button', class: `jr-cal-cell ${cls}${selectedDay === c.day ? ' on' : ''}`, style: `--a:${c.cell ? (0.25 + 0.75 * Math.abs(v) / max).toFixed(2) : 0}`, 'aria-label': `${dayLabel(c.day)}: ${c.cell ? `${usd(v, true)}, ${c.cell.trades} trades` : 'no trades'}`, onclick: () => ((selectedDay = selectedDay === c.day ? null : c.day), render()) },
            h('span', { class: 'jr-cal-date' }, String(c.date)),
            c.cell ? h('b', {}, usd(v, true)) : '',
            c.cell ? h('span', { class: 'jr-cal-n' }, `${c.cell.trades} trade${c.cell.trades === 1 ? '' : 's'}`) : '',
          );
        }),
        h('div', { class: `jr-cal-week ${tone(w.net)}` }, w.trades ? usd(w.net, true) : ''),
      ]),
    );
    const drill = selectedDay ? dayDrill(selectedDay, list) : '';
    return h(
      'section',
      { class: 'panel jr-calendar' },
      h('div', { class: 'jr-cal-bar' },
        h('h3', { class: 'section-label' }, 'P&L calendar'),
        h('div', { class: 'jr-row' }, h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'), h('b', {}, label), h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, '›')),
        h('span', { class: 'muted small' }, `${usd(cal.net, true)} · ${cal.greenDays} green, ${cal.redDays} red days`),
      ),
      grid,
      drill,
    );
  }

  function dayDrill(day: string, list: Trade[]) {
    const dayTrades = list.filter((t) => tradeDay(t) === day);
    return h(
      'div',
      { class: 'jr-drill' },
      h('div', { class: 'jr-row' }, h('b', {}, dayLabel(day)), h('button', { class: 'btn small ghost', onclick: () => openDay(day) }, 'Daily notes')),
      dayTrades.length ? tradeTable(dayTrades, false) : h('p', { class: 'muted small' }, 'No trades closed this day.'),
    );
  }

  function drawHistogram(list: Trade[]) {
    const bins = rHistogram(list);
    const total = bins.reduce((a, b) => a + b.count, 0);
    const max = Math.max(1, ...bins.map((b) => b.count));
    return h(
      'section',
      { class: 'panel jr-hist' },
      h('h3', { class: 'section-label' }, 'R distribution ', infoTip('rmultiple')),
      total
        ? h('div', { class: 'jr-hist-bars', role: 'img', 'aria-label': `R distribution of ${total} trades` },
            ...bins.map((b) => h('div', { class: `jr-hist-col ${b.lo < 0 ? 'down' : 'up'}`, title: `${b.label}: ${b.count} trades` }, h('span', { class: 'jr-hist-n' }, b.count ? String(b.count) : ''), h('i', { style: `height:${(b.count / max) * 100}%` }), h('span', { class: 'jr-hist-x' }, b.label))))
        : h('p', { class: 'muted small' }, 'Add a planned stop to trades (or open them once, to estimate risk from the daily ATR) to see results in R.'),
      total ? h('p', { class: 'muted small' }, `${total} trades. R = result ÷ planned risk; * marks an estimate from one daily ATR when there was no stop.`) : '',
    );
  }

  function drawBreakdown(list: Trade[]) {
    const def = BREAKDOWNS[breakdownKey];
    const rows = breakdown(list, def.keys);
    return h(
      'section',
      { class: 'panel jr-breakdown' },
      h('div', { class: 'jr-row' },
        h('h3', { class: 'section-label' }, 'Breakdown'),
        h('select', { class: 'input', 'aria-label': 'Group by', onchange: (e: Event) => ((breakdownKey = (e.target as HTMLSelectElement).value), render()) },
          ...Object.entries(BREAKDOWNS).map(([k, b]) => h('option', { value: k, selected: k === breakdownKey }, b.label))),
      ),
      rows.length
        ? dataTable(['Group', 'Trades', 'Net', 'Win rate', 'Profit factor', 'Expectancy', 'Avg R'], rows.map((r) => [
            { v: r.key, cls: 'label' },
            { v: String(r.n), cls: `num${r.n < 10 ? ' muted' : ''}` },
            { v: usd(r.net, true), cls: `num ${tone(r.net)}` },
            { v: pc(r.winRate), cls: 'num' },
            { v: num2(r.profitFactor), cls: 'num' },
            { v: usd(r.expectancy, true), cls: 'num' },
            { v: r.avgR != null ? `${r.avgR.toFixed(2)}R` : '—', cls: 'num' },
          ]), undefined, { id: `journal:breakdown:${breakdownKey}` })
        : h('p', { class: 'muted small' }, 'No closed trades in this range.'),
      h('p', { class: 'muted small' }, 'Groups with under 10 trades are greyed: their figures are mostly luck.'),
    );
  }

  // ---------- trades ----------
  const SORTS: Record<string, (t: Trade) => number | string> = {
    date: (t) => t.closedAt ?? t.openedAt,
    symbol: (t) => t.symbol,
    net: (t) => tradePnl(t)?.net ?? -Infinity,
    r: (t) => rOf(t)?.r ?? -Infinity,
    hold: holdSeconds,
  };

  function tradeTable(list: Trade[], withSelect = true) {
    const sorted = [...list].sort((a, b) => {
      const x = SORTS[sort.col](a);
      const y = SORTS[sort.col](b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    const head = (col: string, label: string, numeric = false) =>
      h('th', { class: numeric ? 'num' : '', 'aria-sort': sort.col === col ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', { class: 'jr-sort', type: 'button', onclick: () => ((sort = { col, dir: sort.col === col ? ((-sort.dir) as 1 | -1) : -1 }), render()) }, label, sort.col === col ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''));
    const table = h(
      'table',
      { class: 'data-table jr-trades' },
      h('thead', {}, h('tr', {},
        withSelect ? h('th', {}, h('input', { type: 'checkbox', 'aria-label': 'Select all', checked: list.length > 0 && list.every((t) => selected.has(t.id)), onchange: (e: Event) => {
          const on = (e.target as HTMLInputElement).checked;
          for (const t of list) on ? selected.add(t.id) : selected.delete(t.id);
          render();
        } })) : '',
        head('date', 'Date'), head('symbol', 'Symbol'), h('th', {}, 'Side'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Entry'), h('th', { class: 'num' }, 'Exit'),
        head('net', 'Net', true), head('r', 'R', true), head('hold', 'Hold', true), h('th', {}, 'Strategy · tags'))),
      h('tbody', {}, ...sorted.map((t) => {
        const p = tradePnl(t);
        const row = h('tr', { class: 'jr-trade-row', onclick: (e: Event) => (e.target as HTMLElement).closest('input') || openTrade(t) },
          withSelect ? h('td', {}, h('input', { type: 'checkbox', 'aria-label': `Select ${t.symbol} ${tradeDay(t)}`, checked: selected.has(t.id), onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? selected.add(t.id) : selected.delete(t.id), render()) })) : '',
          h('td', {}, tradeDay(t)),
          h('td', { class: 'label' }, t.symbol, t.openedBefore ? h('span', { class: 'badge', title: 'Opened before the journal’s history (cost = the broker’s average)' }, 'before') : '', t.viaPlatform ? h('span', { class: 'badge', title: 'Placed on the Trade page' }, 'plan') : ''),
          h('td', {}, t.side === 'long' ? 'Long' : 'Short', t.status === 'open' ? h('span', { class: 'muted small' }, ' · open') : ''),
          h('td', { class: 'num' }, String(+qtyOf(t.entries).toFixed(4) || qtyOf(t.exits))),
          h('td', { class: 'num' }, avgPrice(t.entries)?.toFixed(2) ?? '—'),
          h('td', { class: 'num' }, avgPrice(t.exits)?.toFixed(2) ?? '—'),
          h('td', { class: `num ${tone(p?.net)}` }, p && t.exits.length ? usd(p.net, true) : '—'),
          h('td', { class: 'num' }, fmtR(t)),
          h('td', { class: 'num' }, t.status === 'closed' ? duration(holdSeconds(t)) : '—'),
          h('td', { class: 'small' }, [t.strategy, ...(t.tags ?? [])].filter(Boolean).join(' · ')),
        );
        return row;
      })),
    );
    activatableRows(table);
    return h('div', { class: 'table-wrap' }, table);
  }

  function drawTrades() {
    const list = shown();
    const tagInput = h('input', { class: 'input', placeholder: 'tag', 'aria-label': 'Tag for the selected trades' }) as HTMLInputElement;
    const bulk = async (mode: 'add' | 'remove') => {
      const tag = tagInput.value.trim();
      if (!tag || !selected.size) return toast('Select trades and type a tag');
      await engineRequest('journal.bulk_tag', { tradeIds: [...selected], [mode]: [tag] }).then(() => toast(`${mode === 'add' ? 'Tagged' : 'Untagged'} ${selected.size} trades`), (e) => toast((e as Error).message));
      selected.clear();
      reload();
    };
    const select = (key: keyof Filters, label: string, options: [string, string][]) =>
      h('select', { class: 'input', 'aria-label': label, onchange: (e: Event) => ((filters[key] = (e.target as HTMLSelectElement).value as never), saveFilters(), render()) },
        h('option', { value: '' }, label), ...options.map(([v, l]) => h('option', { value: v, selected: filters[key] === v }, l)));
    const tags = [...new Set(trades.flatMap((t) => t.tags ?? []))].sort();
    const strategies = [...new Set(trades.map((t) => t.strategy).filter(Boolean) as string[])].sort();
    const text = h('input', { class: 'input', type: 'search', placeholder: 'Search notes, tags…', value: filters.text ?? '', 'aria-label': 'Search' }) as HTMLInputElement;
    text.addEventListener('change', () => ((filters.text = text.value), saveFilters(), render()));
    body.replaceChildren(
      h('div', { class: 'jr-toolbar' },
        select('status', 'Open & closed', [['closed', 'Closed'], ['open', 'Open']]),
        select('side', 'Long & short', [['long', 'Long'], ['short', 'Short']]),
        select('result', 'Wins & losses', [['win', 'Wins'], ['loss', 'Losses']]),
        tags.length ? select('tag', 'Any tag', tags.map((t) => [t, t])) : '',
        strategies.length ? select('strategy', 'Any strategy', strategies.map((t) => [t, t])) : '',
        text,
        h('span', { class: 'jr-spacer' }),
        h('button', { class: 'btn', onclick: () => manualTrade() }, 'Add trade'),
        h('button', { class: 'btn ghost', onclick: () => download(`journal-trades-${todayNY()}.csv`, tradesCsv(list)) }, 'Export CSV'),
      ),
      selected.size
        ? h('div', { class: 'jr-bulk' }, h('b', {}, `${selected.size} selected`), tagInput, h('button', { class: 'btn small', onclick: () => bulk('add') }, 'Add tag'), h('button', { class: 'btn small ghost', onclick: () => bulk('remove') }, 'Remove tag'), h('button', { class: 'btn small ghost', onclick: () => (selected.clear(), render()) }, 'Clear'))
        : '',
      h('p', { class: 'muted small' }, `${list.length} trade${list.length === 1 ? '' : 's'}. Click one for the chart replay, notes and plan vs actual.`),
      list.length ? tradeTable(list) : h('div', { class: 'empty-state' }, 'No trades match these filters.'),
    );
  }

  // ---------- trade detail ----------
  function openTrade(t: Trade) {
    const box = h('div', { class: 'jr-detail' });
    const close = openModal(`${t.symbol} · ${t.side === 'long' ? 'Long' : 'Short'} · ${tradeDay(t)}`, box, { wide: true, noAutofocus: true, onClose: () => chart?.remove() });
    let chart: IChartApi | null = null;
    const p = tradePnl(t);
    const r = rOf(t);
    const a = adherence(t, trades);
    const entry = avgPrice(t.entries);
    const exit = avgPrice(t.exits);
    const chartBox = h('div', { class: 'jr-replay' }, h('div', { class: 'muted pad' }, 'Loading the chart…'));
    const changes: Partial<Trade> = {};
    const status = h('span', { class: 'muted small', role: 'status' });

    const summary = h('div', { class: 'jr-detail-head' },
      h('div', {}, h('span', { class: 'stat-label' }, t.status === 'open' ? 'Realized so far' : 'Net P&L'), h('b', { class: `jr-big ${tone(p?.net)}` }, p ? usd(p.net, true) : 'Cost unknown')),
      h('div', { class: 'jr-facts small' },
        h('span', {}, h('span', { class: 'muted' }, 'R '), fmtR(t)),
        h('span', {}, h('span', { class: 'muted' }, 'Size '), `${+qtyOf(t.entries).toFixed(4)}${t.multiplier !== 1 ? ` × ${t.multiplier}` : ''}`),
        h('span', {}, h('span', { class: 'muted' }, 'Hold '), t.status === 'closed' ? duration(holdSeconds(t)) : 'open'),
        h('span', {}, h('span', { class: 'muted' }, 'Fees '), usd(p?.fees ?? null)),
        h('span', {}, h('span', { class: 'muted' }, 'Account '), t.account),
      ),
      t.openedBefore ? h('p', { class: 'small jr-flag' }, t.costUnknown ? 'Shares bought before the journal’s history: the cost is unknown, so this trade is left out of the statistics.' : 'Opened before the journal’s history: the entry is the broker’s average cost, so this trade is left out of the statistics.') : '',
    );
    const row = (label: string, plan: string, actual: string, ok?: boolean | null) => h('tr', {}, h('th', {}, label), h('td', { class: 'num' }, plan), h('td', { class: `num ${ok === false ? 'down' : ''}` }, actual));
    const planTable = h('table', { class: 'data-table jr-plan' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Plan'), h('th', { class: 'num' }, 'Actual'))),
      h('tbody', {},
        row('Entry', t.plan?.setup ?? '—', entry?.toFixed(2) ?? '—'),
        row('Stop', t.plan?.stop?.toFixed(2) ?? 'none', a.followedStop == null ? '—' : a.followedStop ? 'respected' : 'went past it', a.followedStop),
        row('Target', t.plan?.target?.toFixed(2) ?? 'none', exit?.toFixed(2) ?? '—'),
        row('Result', t.plan?.stop != null && t.plan?.target != null && entry ? `${(Math.abs(t.plan.target - entry) / Math.abs(entry - t.plan.stop)).toFixed(1)}R planned` : '—', r ? `${r.r.toFixed(2)}R` : '—'),
        row('Size', 'usual risk', a.oversized == null ? '—' : a.oversized ? 'over 1.5× usual' : 'usual', a.oversized == null ? null : !a.oversized),
        row('MAE / MFE', '', t.mae != null ? `${usd(t.mae)} / ${usd(t.mfe ?? null, true)}` : '—'),
      ));
    const stopIn = h('input', { class: 'input', type: 'number', step: 'any', value: t.plan?.stop ?? '', 'aria-label': 'Planned stop' }) as HTMLInputElement;
    const targetIn = h('input', { class: 'input', type: 'number', step: 'any', value: t.plan?.target ?? '', 'aria-label': 'Planned target' }) as HTMLInputElement;
    const planChanged = () => (changes.plan = { ...(t.plan ?? {}), stop: stopIn.value === '' ? null : +stopIn.value, target: targetIn.value === '' ? null : +targetIn.value });
    stopIn.addEventListener('change', planChanged);
    targetIn.addEventListener('change', planChanged);

    const chips = (key: 'emotionsBefore' | 'emotionsAfter' | 'mistakes', options: string[]) => {
      const on = new Set(t[key] ?? []);
      return h('div', { class: 'jr-chips', role: 'group' }, ...options.map((o) =>
        h('button', { type: 'button', class: `chip${on.has(o) ? ' on' : ''}`, 'aria-pressed': on.has(o) ? 'true' : 'false', onclick: (e: Event) => {
          on.has(o) ? on.delete(o) : on.add(o);
          (e.currentTarget as HTMLElement).classList.toggle('on');
          (e.currentTarget as HTMLElement).setAttribute('aria-pressed', on.has(o) ? 'true' : 'false');
          changes[key] = [...on];
        } }, o)));
    };
    const field = (label: string, el: Node) => h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, label), el);
    const strategyIn = h('input', { class: 'input', value: t.strategy ?? '', list: 'jr-strategies', onchange: (e: Event) => (changes.strategy = (e.target as HTMLInputElement).value) });
    const tagsIn = h('input', { class: 'input', value: (t.tags ?? []).join(', '), placeholder: 'breakout, earnings', onchange: (e: Event) => (changes.tags = (e.target as HTMLInputElement).value.split(',').map((x) => x.trim()).filter(Boolean)) });
    const notesIn = h('textarea', { class: 'input jr-notes', rows: 5, placeholder: 'Why I took it, what happened, what I’d do differently…', onchange: (e: Event) => (changes.notes = (e.target as HTMLTextAreaElement).value) }, t.notes ?? '');
    let rating = t.rating ?? 0;
    const stars = h('div', { class: 'jr-stars', role: 'radiogroup', 'aria-label': 'Execution rating' });
    const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', role: 'radio', 'aria-checked': n === rating ? 'true' : 'false', 'aria-label': `${n} of 5`, class: n <= rating ? 'on' : '', onclick: () => ((rating = n), (changes.rating = n), drawStars()) }, '★')));
    drawStars();
    const pb = playbooks.find((x) => x.pbId === t.playbookId);
    const rulesBox = h('div', { class: 'jr-rules' });
    const drawRules = (book: Playbook | undefined) => {
      const ticks = [...(changes.rulesFollowed ?? t.rulesFollowed ?? [])];
      rulesBox.replaceChildren(...(book?.rules ?? []).map((rule, i) => h('label', { class: 'jr-rule small' }, h('input', { type: 'checkbox', checked: !!ticks[i], onchange: (e: Event) => ((ticks[i] = (e.target as HTMLInputElement).checked), (changes.rulesFollowed = book!.rules.map((_, j) => !!ticks[j]))) }), rule)));
    };
    drawRules(pb);
    const pbSelect = playbooks.length
      ? h('select', { class: 'input', onchange: (e: Event) => {
          changes.playbookId = (e.target as HTMLSelectElement).value;
          changes.rulesFollowed = [];
          drawRules(playbooks.find((x) => x.pbId === changes.playbookId));
        } }, h('option', { value: '' }, 'No playbook'), ...playbooks.map((x) => h('option', { value: x.pbId, selected: x.pbId === t.playbookId }, x.name)))
      : h('span', { class: 'muted small' }, 'Create playbooks on the Playbooks tab.');

    const shots = h('div', { class: 'jr-shots' });
    const drawShots = (names: string[]) => {
      shots.replaceChildren(...names.map((name) => {
        const img = h('img', { alt: `Screenshot for ${t.symbol}`, loading: 'lazy' }) as HTMLImageElement;
        engineRequest<{ data: string; mediaType: string }>('journal.screenshot', { name }).then((d) => (img.src = `data:${d.mediaType};base64,${d.data}`), () => (img.alt = 'Missing file'));
        return h('figure', {}, h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), img.src && window.open()?.document.write(`<img src="${img.src}" style="max-width:100%">`)) }, img),
          h('button', { class: 'icon-btn', 'aria-label': 'Delete screenshot', onclick: async () => {
            const d = await engineRequest<{ trade: Trade }>('journal.screenshot_delete', { tradeId: t.id, name });
            Object.assign(t, d.trade);
            drawShots(t.screenshots ?? []);
          } }, '✕'));
      }), drop);
    };
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, multiple: true }) as HTMLInputElement;
    const addImage = async (file: File) => {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Screenshots can be PNG, JPEG, WebP or GIF');
      const data = await new Promise<string>((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(',')[1] ?? '');
        fr.readAsDataURL(file);
      });
      try {
        const d = await engineRequest<{ trade: Trade }>('journal.screenshot_add', { tradeId: t.id, mediaType: file.type, data }, 60000);
        Object.assign(t, d.trade);
        drawShots(t.screenshots ?? []);
      } catch (err) {
        toast((err as Error).message);
      }
    };
    fileIn.addEventListener('change', () => [...(fileIn.files ?? [])].forEach(addImage));
    const drop = h('button', { type: 'button', class: 'jr-drop small', onclick: () => fileIn.click() }, 'Paste, drop or click to add a screenshot');
    box.addEventListener('paste', (e) => [...((e as ClipboardEvent).clipboardData?.files ?? [])].forEach(addImage));
    box.addEventListener('dragover', (e) => e.preventDefault());
    box.addEventListener('drop', (e) => (e.preventDefault(), [...((e as DragEvent).dataTransfer?.files ?? [])].forEach(addImage)));
    drawShots(t.screenshots ?? []);

    const save = async () => {
      if (!Object.keys(changes).length) return toast('Nothing changed');
      status.textContent = 'Saving…';
      try {
        const d = await engineRequest<{ trade: Trade }>('journal.save_trade', { tradeId: t.id, changes }, 20000);
        Object.assign(t, d.trade);
        for (const k of Object.keys(changes)) delete changes[k as keyof Trade];
        status.textContent = 'Saved';
        render();
      } catch (err) {
        status.textContent = (err as Error).message;
      }
    };
    const remove = async () => {
      if (!confirm(`Remove this ${t.symbol} trade from the journal? Importing the same history again won’t bring it back.`)) return;
      await engineRequest('journal.delete_trade', { tradeId: t.id }).catch((e) => toast((e as Error).message));
      close();
      reload();
    };

    box.replaceChildren(
      summary,
      chartBox,
      h('div', { class: 'jr-detail-grid' },
        h('section', {}, h('h3', { class: 'section-label' }, 'Plan vs actual'), planTable, h('div', { class: 'jr-row' }, field('Planned stop', stopIn), field('Planned target', targetIn)),
          h('h3', { class: 'section-label' }, 'Fills'),
          h('table', { class: 'data-table small' }, h('tbody', {}, ...[...t.entries.map((e) => ['In', e] as const), ...t.exits.map((e) => ['Out', e] as const)].sort((x, y) => x[1].time - y[1].time).map(([k, e]) =>
            h('tr', {}, h('td', {}, k), h('td', {}, when(e.time)), h('td', { class: 'num' }, `${+e.qty.toFixed(4)} @ ${e.price.toFixed(2)}`), h('td', { class: 'num muted' }, e.fees ? usd(e.fees) : ''))))),
        ),
        h('section', {},
          h('h3', { class: 'section-label' }, 'Review'),
          field('Strategy', strategyIn),
          h('datalist', { id: 'jr-strategies' }, ...[...new Set(trades.map((x) => x.strategy).filter(Boolean))].map((s) => h('option', { value: s! }))),
          field('Playbook', pbSelect),
          rulesBox,
          field('Tags (comma separated)', tagsIn),
          h('div', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Before the trade I felt'), chips('emotionsBefore', EMOTIONS)),
          h('div', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'After'), chips('emotionsAfter', EMOTIONS)),
          h('div', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Mistakes'), chips('mistakes', MISTAKES)),
          h('div', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Execution'), stars),
          field('Notes', notesIn),
          h('div', { class: 'jr-row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), status, h('span', { class: 'jr-spacer' }), h('button', { class: 'btn ghost danger', onclick: remove }, 'Remove trade')),
        ),
      ),
      h('h3', { class: 'section-label' }, 'Screenshots'),
      shots,
      fileIn,
      coachPanel('trade', [t]),
      h('div', { class: 'jr-row' }, h('button', { class: 'btn ghost small', onclick: () => (close(), openChart({ provider: 'schwab', symbol: t.symbol } as MarketRef)) }, 'Open in Chart')),
    );
    replay(t, chartBox).then((c) => (chart = c));
  }

  /** The trade's bars with entry/exit markers, stop/target and MAE/MFE lines; saves MAE/MFE and the ATR estimate. */
  async function replay(t: Trade, box: HTMLElement): Promise<IChartApi | null> {
    const end = t.closedAt ?? Date.now() / 1000;
    const ageDays = (Date.now() / 1000 - t.openedAt) / 86400;
    const span = end - t.openedAt;
    // intraday bars when the helper still has them, else daily
    const plan = span < 2 * 86400 && ageDays < 18 ? { resolution: '5m', days: 20, seconds: 300 } : span < 20 * 86400 && ageDays < 170 ? { resolution: '30m', days: 180, seconds: 1800 } : { resolution: '1D', days: Math.ceil(ageDays) + 60, seconds: 86400 };
    if (t.assetClass !== 'stock') {
      box.replaceChildren(h('p', { class: 'muted small pad' }, 'Chart replay covers stocks and ETFs (futures and options history isn’t available here).'));
      return null;
    }
    try {
      const reply = await helper.request({ type: 'history', symbol: t.symbol, resolution: plan.resolution, days: Math.min(plan.days, 365 * 15) });
      if (reply.type !== 'history') throw new Error('No history');
      const all: Bar[] = cleanBars(reply.bars);
      let daily = plan.resolution === '1D' ? all : null;
      const pad = plan.seconds * 40;
      const bars = all.filter((b) => b.time >= t.openedAt - pad && b.time <= end + pad);
      if (!bars.length || !box.isConnected) throw new Error('No bars around this trade');
      box.replaceChildren();
      const chart = createChart(box, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: THEME.text },
        grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
        rightPriceScale: { borderColor: THEME.border },
        timeScale: { borderColor: THEME.border, timeVisible: plan.seconds < 86400 },
      });
      followTheme(chart, { transparent: true, hideVertGrid: true });
      const series = chart.addSeries(CandlestickSeries, { upColor: THEME.up, downColor: THEME.down, wickUpColor: THEME.up, wickDownColor: THEME.down, borderVisible: false });
      series.setData(bars.map((b) => ({ time: b.time as never, open: b.open, high: b.high, low: b.low, close: b.close })));
      const barAt = (time: number) => (bars.filter((b) => b.time <= time).pop() ?? bars[0]).time;
      const long = t.side === 'long';
      createSeriesMarkers(series, [
        ...t.entries.map((e) => ({ time: barAt(e.time) as never, position: (long ? 'belowBar' : 'aboveBar') as never, color: THEME.accent, shape: (long ? 'arrowUp' : 'arrowDown') as never, text: `${long ? 'Buy' : 'Short'} ${+e.qty.toFixed(2)} @ ${e.price.toFixed(2)}` })),
        ...t.exits.map((e) => ({ time: barAt(e.time) as never, position: (long ? 'aboveBar' : 'belowBar') as never, color: THEME.viz2, shape: (long ? 'arrowDown' : 'arrowUp') as never, text: `Exit ${+e.qty.toFixed(2)} @ ${e.price.toFixed(2)}` })),
      ].sort((a, b) => (a.time as number) - (b.time as number)));
      const line = (price: number | null | undefined, color: string, title: string, style = LineStyle.Dashed) => price != null && series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
      line(avgPrice(t.entries), THEME.accent, 'Avg entry', LineStyle.Solid);
      line(t.plan?.stop, THEME.down, 'Stop');
      line(t.plan?.target, THEME.up, 'Target');
      const ex = excursions(t, all, plan.seconds);
      if (ex) {
        line(ex.maePrice, THEME.down, `MAE ${usd(ex.mae)}`, LineStyle.Dotted);
        line(ex.mfePrice, THEME.up, `MFE ${usd(ex.mfe, true)}`, LineStyle.Dotted);
      }
      chart.timeScale().fitContent();
      // the ATR estimate for R (only when there is no stop) needs daily bars before the entry
      let atr = t.atr ?? null;
      if (!t.plan?.stop && atr == null) {
        if (!daily) {
          const d = await helper.request({ type: 'history', symbol: t.symbol, resolution: '1D', days: Math.ceil(ageDays) + 60 }).catch(() => null);
          daily = d?.type === 'history' ? cleanBars(d.bars) : [];
        }
        atr = atrAt(daily, t.openedAt);
      }
      const changes: Partial<Trade> = {};
      if (ex && (t.mae == null || Math.abs((t.mae ?? 0) - ex.mae) > 0.005 || Math.abs((t.mfe ?? 0) - ex.mfe) > 0.005)) Object.assign(changes, { mae: ex.mae, mfe: ex.mfe, maePrice: ex.maePrice, mfePrice: ex.mfePrice, excursionSource: plan.resolution });
      if (atr != null && t.atr == null) changes.atr = atr;
      if (Object.keys(changes).length && t.status === 'closed') {
        engineRequest<{ trade: Trade }>('journal.save_trade', { tradeId: t.id, changes }).then((d) => Object.assign(t, d.trade), () => {});
      }
      box.append(h('p', { class: 'muted tiny jr-replay-note' }, `${plan.resolution === '1D' ? 'Daily' : plan.resolution} bars. MAE/MFE = the worst and best open P&L while the trade was on${plan.resolution === '1D' ? ' (daily bars: entry and exit days count in full, so they can overstate)' : ''}.`));
      return chart;
    } catch (err) {
      if (box.isConnected) box.replaceChildren(h('p', { class: 'muted small pad' }, `Chart unavailable: ${(err as Error).message}`));
      return null;
    }
  }

  // ---------- AI coach ----------
  function coachPanel(mode: 'trade' | 'period', list: Trade[]) {
    const out = h('div', { class: 'jr-coach-out' });
    const btn = h('button', { class: 'btn ai-btn' }, mode === 'trade' ? 'Review this trade (AI)' : 'AI review of this period') as HTMLButtonElement;
    const params = () => {
      if (mode === 'trade') return { mode, tradeId: list[0].id };
      const days = list.map(tradeDay).sort();
      const s = computeStats(list);
      return { mode, start: filters.from || days[0] || '', end: filters.to || days[days.length - 1] || '', label: filters.from ? `${filters.from} to ${filters.to || 'today'}` : 'all my trades',
        stats: { ...s, breakdownByHour: breakdown(list, BREAKDOWNS.hour.keys), byEmotion: breakdown(list, BREAKDOWNS.emotion.keys), byStrategy: breakdown(list, BREAKDOWNS.strategy.keys), afterLoss: computeStats(afterLoss(list).after), adherence: adherenceSummary(list) } };
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      out.replaceChildren(h('p', { class: 'muted small' }, 'Working out the cost…'));
      try {
        const est = await engineRequest<Coach>('journal.coach', params(), 30000);
        const e = est.estimate;
        out.replaceChildren(
          h('p', { class: 'small' }, `This sends ${mode === 'trade' ? 'the trade' : `${list.length} trades and their statistics`} to the AI (${e.model}): about ${e.tokensIn.toLocaleString()} tokens in and up to ${e.tokensOut.toLocaleString()} out, roughly $${e.costUsd.toFixed(3)} on your Anthropic account. It only reads; it never trades.`),
          h('div', { class: 'jr-row' }, h('button', { class: 'btn primary small', onclick: () => run() }, 'Run review'), h('button', { class: 'btn ghost small', onclick: () => out.replaceChildren() }, 'Cancel')),
        );
      } catch (err) {
        out.replaceChildren(h('p', { class: 'ap-error' }, friendlyAiError(err).text));
      }
      btn.disabled = false;
    });
    async function run() {
      const text = h('div', { class: 'ai-md' });
      const statusLine = h('p', { class: 'muted small' }, 'Reviewing…');
      out.replaceChildren(statusLine, text);
      let acc = '';
      try {
        const d = await engineRequest<Coach>('journal.coach', { ...params(), run: true }, 300000, (ev: EngineEvent) => {
          const e = ev as { type?: string; text?: string };
          if (e.type === 'text' && e.text) (acc += e.text), (text.innerHTML = renderMarkdown(acc));
        });
        statusLine.remove();
        text.innerHTML = renderMarkdown(d.text ?? '');
        out.append(h('div', { class: 'jr-row' }, h('button', { class: 'btn small ghost', onclick: () => continueInAssistant(d.conversation!, mode === 'trade' ? `Trade review: ${list[0].symbol}` : 'Journal review', d.text ?? '') }, 'Ask a follow-up in the assistant')));
      } catch (err) {
        out.replaceChildren(h('p', { class: 'ap-error' }, friendlyAiError(err).text));
      }
    }
    const saved = mode === 'trade' && list[0].review ? h('details', { class: 'jr-saved-review' }, h('summary', { class: 'small' }, 'Last AI review'), h('div', { class: 'ai-md small' })) : null;
    if (saved) (saved.querySelector('.ai-md') as HTMLElement).innerHTML = renderMarkdown(list[0].review!);
    return h('section', { class: 'panel jr-coach' }, h('div', { class: 'jr-row' }, h('h3', { class: 'section-label' }, 'AI coach'), btn), h('p', { class: 'muted small' }, mode === 'trade' ? 'Plan vs execution, mistakes, what went well and one lesson, from this trade’s facts only.' : 'Patterns in your own trades (time of day, trades after a loss, emotions, strategies), each with the trades it rests on.'), saved, out);
  }

  // ---------- manual entry ----------
  function manualTrade() {
    const f = {
      symbol: h('input', { class: 'input', placeholder: 'AAPL', 'aria-label': 'Symbol' }) as HTMLInputElement,
      side: h('select', { class: 'input', 'aria-label': 'Side' }, h('option', { value: 'long' }, 'Long (buy, then sell)'), h('option', { value: 'short' }, 'Short (sell, then buy back)')) as HTMLSelectElement,
      qty: h('input', { class: 'input', type: 'number', step: 'any', min: 0, 'aria-label': 'Quantity' }) as HTMLInputElement,
      entry: h('input', { class: 'input', type: 'number', step: 'any', 'aria-label': 'Entry price' }) as HTMLInputElement,
      entryAt: h('input', { class: 'input', type: 'datetime-local', 'aria-label': 'Entry time' }) as HTMLInputElement,
      exit: h('input', { class: 'input', type: 'number', step: 'any', 'aria-label': 'Exit price (blank = still open)' }) as HTMLInputElement,
      exitAt: h('input', { class: 'input', type: 'datetime-local', 'aria-label': 'Exit time' }) as HTMLInputElement,
      fees: h('input', { class: 'input', type: 'number', step: 'any', value: '0', 'aria-label': 'Total fees' }) as HTMLInputElement,
      account: h('input', { class: 'input', value: 'Manual', 'aria-label': 'Account' }) as HTMLInputElement,
    };
    const err = h('p', { class: 'ap-error', hidden: true });
    const toUnix = (v: string) => {
      const m = v.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
      return m ? nyTime(+m[1], +m[2], +m[3], +m[4], +m[5]) : NaN;
    };
    const add = async () => {
      const qty = +f.qty.value;
      const fees = +f.fees.value || 0;
      const fills: ImportFill[] = [];
      const long = f.side.value === 'long';
      const t1 = toUnix(f.entryAt.value);
      if (!f.symbol.value.trim() || !(qty > 0) || !(+f.entry.value >= 0) || f.entry.value === '' || !Number.isFinite(t1)) return ((err.hidden = false), (err.textContent = 'Fill in symbol, quantity, entry price and entry time.'));
      const hasExit = f.exit.value !== '';
      fills.push({ symbol: f.symbol.value.trim().toUpperCase(), side: long ? 'BUY' : 'SELL', ...(long ? {} : { open: 'short' as const }), qty, price: +f.entry.value, time: t1, fees: hasExit ? fees / 2 : fees, account: f.account.value || 'Manual' });
      if (hasExit) {
        const t2 = toUnix(f.exitAt.value);
        if (!Number.isFinite(t2) || t2 < t1) return ((err.hidden = false), (err.textContent = 'The exit time must be after the entry.'));
        fills.push({ symbol: fills[0].symbol, side: long ? 'SELL' : 'BUY', qty, price: +f.exit.value, time: t2, fees: fees / 2, account: fills[0].account });
      }
      try {
        await engineRequest('journal.import_fills', { source: 'manual', fills }, 30000);
        close();
        toast('Trade added');
        reload();
      } catch (e) {
        err.hidden = false;
        err.textContent = (e as Error).message;
      }
    };
    const field = (label: string, el: Node) => h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, label), el);
    const close = openModal('Add a trade', h('div', { class: 'jr-manual' },
      h('div', { class: 'jr-form' }, field('Symbol', f.symbol), field('Side', f.side), field('Quantity', f.qty), field('Account', f.account), field('Entry price', f.entry), field('Entry time (New York)', f.entryAt), field('Exit price (blank if still open)', f.exit), field('Exit time', f.exitAt), field('Fees (total $)', f.fees)),
      h('p', { class: 'muted small' }, 'Scale-ins and partial exits: add each fill through Import > file, or add the trade and its later fills here one at a time (same symbol and account join up first in, first out).'),
      err,
      h('button', { class: 'btn primary', onclick: add }, 'Add trade'),
    ));
  }

  // ---------- daily journal ----------
  let dayShown = todayNY();
  let days: Record<string, DayDoc> = {};
  async function openDay(day: string) {
    dayShown = day;
    setView('daily');
  }
  async function drawDaily() {
    body.replaceChildren(h('div', { class: 'muted pad' }, 'Loading…'));
    try {
      days = (await engineRequest<{ days: Record<string, DayDoc> }>('journal.days', {}, 20000)).days;
    } catch (err) {
      return body.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
    if (view !== 'daily') return;
    const doc: DayDoc = days[dayShown] ?? { day: dayShown, plan: '', review: '', lessons: '', mood: 0, checklist: [] };
    const dayTrades = trades.filter((t) => nyParts(t.openedAt).day === dayShown || tradeDay(t) === dayShown);
    const net = dayTrades.filter((t) => counted(t) && tradeDay(t) === dayShown).reduce((a, t) => a + tradePnl(t)!.net, 0);
    const date = h('input', { class: 'input', type: 'date', value: dayShown, 'aria-label': 'Day', onchange: (e: Event) => ((dayShown = (e.target as HTMLInputElement).value || todayNY()), drawDaily()) });
    const area = (key: 'plan' | 'review' | 'lessons', label: string, placeholder: string) =>
      h('label', { class: 'jr-field' }, h('span', { class: 'section-label' }, label), h('textarea', { class: 'input', rows: 5, placeholder, oninput: (e: Event) => (doc[key] = (e.target as HTMLTextAreaElement).value) }, doc[key]));
    let mood = doc.mood;
    const moodBox = h('div', { class: 'segmented small', role: 'radiogroup', 'aria-label': 'Mood' });
    const drawMood = () => moodBox.replaceChildren(...['😣', '🙁', '😐', '🙂', '😄'].map((m, i) => h('button', { type: 'button', role: 'radio', 'aria-checked': mood === i + 1 ? 'true' : 'false', 'aria-label': `Mood ${i + 1} of 5`, class: mood === i + 1 ? 'active' : '', onclick: () => ((mood = i + 1), (doc.mood = mood), drawMood()) }, m)));
    drawMood();
    const checks = DAY_CHECKS.map((c, i) => h('label', { class: 'jr-rule small' }, h('input', { type: 'checkbox', checked: !!doc.checklist[i], onchange: (e: Event) => (doc.checklist[i] = (e.target as HTMLInputElement).checked) }), c));
    const status = h('span', { class: 'muted small', role: 'status' });
    const recent = Object.keys(days).sort().reverse().slice(0, 12);
    body.replaceChildren(
      h('div', { class: 'jr-daily' },
        h('section', { class: 'panel' },
          h('div', { class: 'jr-row' }, date, h('span', { class: 'muted small' }, dayLabel(dayShown)), h('span', { class: 'jr-spacer' }), dayTrades.length ? h('b', { class: tone(net) }, `${usd(net, true)} · ${dayTrades.length} trades`) : h('span', { class: 'muted small' }, 'No trades')),
          h('h3', { class: 'section-label' }, 'Before the open'),
          ...checks,
          area('plan', 'Plan', 'Market read, the setups I’m watching, levels, what would make me stop for the day…'),
          h('h3', { class: 'section-label' }, 'After the close'),
          area('review', 'Review', 'What I did well, where I broke my rules, how the market behaved…'),
          area('lessons', 'Lesson', 'One thing to do differently tomorrow'),
          h('div', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Mood'), moodBox),
          h('div', { class: 'jr-row' }, h('button', { class: 'btn primary', onclick: async () => {
            status.textContent = 'Saving…';
            await engineRequest('journal.day_save', { day: dayShown, doc }).then(() => (status.textContent = 'Saved'), (e) => (status.textContent = (e as Error).message));
          } }, 'Save day'), status),
          dayTrades.length ? tradeTable(dayTrades, false) : '',
        ),
        h('aside', { class: 'panel jr-days' }, h('h3', { class: 'section-label' }, 'Recent days'),
          ...(recent.length ? recent.map((d) => h('button', { type: 'button', class: `jr-pick${d === dayShown ? ' on' : ''}`, onclick: () => ((dayShown = d), drawDaily()) }, h('span', {}, dayLabel(d)), h('span', { class: 'muted small' }, days[d].mood ? ['😣', '🙁', '😐', '🙂', '😄'][days[d].mood - 1] : ''))) : [h('p', { class: 'muted small' }, 'No notes yet.')])),
      ),
    );
  }

  // ---------- playbooks ----------
  function drawPlaybooks() {
    const card = (pb: Playbook) => {
      const mine = trades.filter((t) => t.playbookId === pb.pbId);
      const s = computeStats(mine);
      const full = mine.filter((t) => t.rulesFollowed?.length && t.rulesFollowed.every(Boolean));
      const broken = mine.filter((t) => t.rulesFollowed?.length && !t.rulesFollowed.every(Boolean));
      const fs = computeStats(full);
      const bs = computeStats(broken);
      return h('section', { class: 'panel jr-playbook' },
        h('div', { class: 'jr-row' }, h('h3', {}, pb.name), h('span', { class: 'jr-spacer' }), h('button', { class: 'btn small ghost', onclick: () => editPlaybook(pb) }, 'Edit')),
        pb.description ? h('p', { class: 'small' }, pb.description) : '',
        h('ol', { class: 'small' }, ...pb.rules.map((r) => h('li', {}, r))),
        h('p', { class: 'small' }, `${s.n} closed trades · net ${usd(s.net, true)} · ${pc(s.winRate)} won`),
        full.length || broken.length ? h('p', { class: 'small' }, `All rules followed: ${fs.n} trades, ${usd(fs.expectancy, true)} a trade · Rules broken: ${bs.n} trades, ${usd(bs.expectancy, true)} a trade${fs.n + bs.n < MIN_TRADES ? ' (too few to judge)' : ''}`) : h('p', { class: 'muted small' }, 'Tick the rules you followed on each trade to see whether following them pays.'),
      );
    };
    body.replaceChildren(
      h('div', { class: 'jr-row' }, h('p', { class: 'muted small' }, 'A playbook is a strategy written as a checklist. Tick the rules you followed on each trade; the journal compares trades that followed every rule with those that didn’t.'), h('span', { class: 'jr-spacer' }), h('button', { class: 'btn primary', onclick: () => editPlaybook() }, 'New playbook')),
      playbooks.length ? h('div', { class: 'jr-grid2' }, ...playbooks.map(card)) : h('div', { class: 'empty-state' }, 'No playbooks yet.'),
    );
  }
  function editPlaybook(pb?: Playbook) {
    const name = h('input', { class: 'input', value: pb?.name ?? '', placeholder: 'Pullback in an uptrend' }) as HTMLInputElement;
    const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'When it works and what it looks like' }, pb?.description ?? '') as HTMLTextAreaElement;
    const rules = h('textarea', { class: 'input', rows: 7, placeholder: 'One rule per line, e.g.\nPrice above the 200-day average\nStop below the last swing low\nRisk 0.5% of the account' }, (pb?.rules ?? []).join('\n')) as HTMLTextAreaElement;
    const close = openModal(pb ? 'Edit playbook' : 'New playbook', h('div', { class: 'jr-form1' },
      h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Name'), name),
      h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Description'), desc),
      h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Rules (one per line)'), rules),
      h('div', { class: 'jr-row' },
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            await engineRequest('journal.playbook_save', { playbook: { pbId: pb?.pbId, name: name.value, description: desc.value, rules: rules.value.split('\n') } });
            close();
            reload();
          } catch (e) {
            toast((e as Error).message);
          }
        } }, 'Save'),
        pb ? h('button', { class: 'btn ghost danger', onclick: async () => confirm(`Delete the playbook "${pb.name}"?`) && (await engineRequest('journal.playbook_delete', { pbId: pb.pbId }), close(), reload()) }, 'Delete') : '',
      ),
    ));
  }

  // ---------- reports ----------
  function drawReports() {
    const list = shown();
    const months = monthly(list);
    const years = [...new Set(realizedLots(trades).map((l) => l.sold.slice(0, 4)))].sort().reverse();
    let year = years[0] ?? todayNY().slice(0, 4);
    const lotsBox = h('div');
    const drawLots = () => {
      const lots = realizedLots(trades).filter((l) => l.sold.startsWith(year));
      const sum = (term: 'Short' | 'Long') => lots.filter((l) => l.term === term).reduce((a, l) => a + l.gain, 0);
      lotsBox.replaceChildren(
        statCards([
          { label: 'Short-term', value: usd(sum('Short'), true), tone: tone(sum('Short')) },
          { label: 'Long-term', value: usd(sum('Long'), true), tone: tone(sum('Long')) },
          { label: 'Lots', value: String(lots.length) },
        ]),
        lots.length
          ? dataTable(['Symbol', 'Account', 'Acquired', 'Sold', 'Qty', 'Proceeds', 'Cost', 'Gain', 'Term'], lots.map((l) => [
              { v: l.symbol, cls: 'label' }, l.account, l.acquired, l.sold, { v: String(+l.qty.toFixed(4)), cls: 'num' }, { v: usd(l.proceeds), cls: 'num' }, { v: usd(l.cost), cls: 'num' }, { v: usd(l.gain, true), cls: `num ${tone(l.gain)}` }, l.term,
            ]), undefined, { id: 'journal:lots' })
          : h('p', { class: 'muted small' }, 'No closed lots in this year.'),
        h('button', { class: 'btn ghost small', onclick: () => download(`realized-gains-estimate-${year}.csv`, ['symbol,account,acquired,sold,qty,proceeds,cost,gain,term', ...lots.map((l) => [l.symbol, l.account, l.acquired, l.sold, l.qty, l.proceeds.toFixed(2), l.cost.toFixed(2), l.gain.toFixed(2), l.term].join(','))].join('\n')) }, 'Download CSV'),
      );
    };
    drawLots();
    body.replaceChildren(
      h('section', { class: 'panel' }, h('div', { class: 'jr-row' }, h('h3', { class: 'section-label' }, 'Monthly summary'), h('span', { class: 'jr-spacer' }), h('button', { class: 'btn ghost small', onclick: () => download(`journal-trades-${todayNY()}.csv`, tradesCsv(list)) }, 'Export trades CSV')),
        months.length ? dataTable(['Month', 'Trades', 'Net', 'Win rate', 'Profit factor', 'Expectancy', 'Avg R'], months.map((r) => [{ v: r.key, cls: 'label' }, { v: String(r.n), cls: 'num' }, { v: usd(r.net, true), cls: `num ${tone(r.net)}` }, { v: pc(r.winRate), cls: 'num' }, { v: num2(r.profitFactor), cls: 'num' }, { v: usd(r.expectancy, true), cls: 'num' }, { v: r.avgR != null ? `${r.avgR.toFixed(2)}R` : '—', cls: 'num' }]), undefined, { id: 'journal:monthly' }) : h('p', { class: 'muted small' }, 'No closed trades in this range.'),
      ),
      h('section', { class: 'panel' },
        h('div', { class: 'jr-row' }, h('h3', { class: 'section-label' }, 'Realized gains'), h('select', { class: 'input', 'aria-label': 'Tax year', onchange: (e: Event) => ((year = (e.target as HTMLSelectElement).value), drawLots()) }, ...(years.length ? years : [year]).map((y) => h('option', { value: y }, y)))),
        h('p', { class: 'jr-flag small' }, h('b', {}, 'Estimate, not tax advice. '), 'Lot by lot, first in first out within each trade, after fees. Wash sales, corporate actions, futures’ 60/40 rule and your broker’s lot choices are not applied: your 1099-B is the record.'),
        lotsBox,
      ),
    );
  }

  // ---------- import ----------
  function drawImport() {
    const wbStatus = h('div', { class: 'small', role: 'status' });
    const runWebull = async (btn: HTMLButtonElement) => {
      btn.disabled = true;
      wbStatus.replaceChildren(h('span', { class: 'muted' }, 'Reading your Webull order history (paced to Webull’s limits; a long history takes a minute)…'));
      try {
        const r = await engineRequest<{ message: string; windowNote: string; notes: string[] }>('journal.import_webull', {}, 600000, (ev) => {
          const e = ev as { text?: string };
          if (e.text) wbStatus.replaceChildren(h('span', { class: 'muted' }, e.text));
        });
        const tag = await engineRequest<{ message: string }>('journal.import_orders_log', {}, 30000).catch(() => null);
        wbStatus.replaceChildren(h('p', {}, h('b', {}, r.message)), r.windowNote ? h('p', { class: 'muted' }, r.windowNote) : '', ...r.notes.map((n) => h('p', { class: 'muted' }, n)), tag ? h('p', { class: 'muted' }, tag.message) : '');
        reload();
      } catch (err) {
        wbStatus.replaceChildren(h('p', { class: 'ap-error' }, (err as Error).message));
      }
      btn.disabled = false;
    };
    const wbBtn = h('button', { class: 'btn primary' }, 'Import from Webull') as HTMLButtonElement;
    wbBtn.addEventListener('click', () => runWebull(wbBtn));
    const file = h('input', { type: 'file', accept: '.csv,.xlsx,.xlsm,.txt,.pdf', hidden: true }) as HTMLInputElement;
    const fileStatus = h('div', { class: 'small' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const rows = await fileRows(f, fileStatus);
        if (rows) preview(rows, f.name);
      } catch (err) {
        fileStatus.replaceChildren(h('p', { class: 'ap-error' }, (err as Error).message));
      }
    });
    body.replaceChildren(
      h('div', { class: 'jr-grid2' },
        h('section', { class: 'panel' },
          h('h3', { class: 'section-label' }, 'Webull'),
          h('p', { class: 'small' }, 'Reads every filled order in your Webull accounts as far back as Webull’s API allows (about 2 years), plus positions you held before that (at Webull’s average cost, marked “before” and left out of win-rate statistics until closed). Read-only: nothing is placed or changed. Orders you placed on the Trade page are tagged with their plan.'),
          wbBtn,
          wbStatus,
        ),
        h('section', { class: 'panel' },
          h('h3', { class: 'section-label' }, 'Broker export (CSV, Excel or PDF)'),
          h('p', { class: 'small' }, 'Webull, Schwab (including old TD Ameritrade files), Fidelity, Interactive Brokers, Robinhood or E*TRADE are recognised automatically; any other export works by matching its columns. You see a preview before anything is saved, and trades already in the journal are skipped.'),
          h('p', { class: 'muted small' }, 'Schwab: this platform uses Schwab for market data only (it has no trading access there), so Schwab and TD Ameritrade history comes from their CSV export.'),
          h('button', { class: 'btn', onclick: () => file.click() }, 'Choose file…'),
          file,
          fileStatus,
          h('details', { class: 'small' }, h('summary', {}, 'Where to find the export'), h('ul', {}, ...PRESETS.map((p) => h('li', {}, h('b', {}, p.label), `: ${p.note ?? ''}`)))),
        ),
      ),
      h('section', { class: 'panel' }, h('h3', { class: 'section-label' }, 'Import history'),
        imports.length
          ? dataTable(['When', 'Source', 'New', 'Already there', 'Note'], imports.map((i) => [new Date(i.at * 1000).toLocaleString(), i.source, { v: String(i.added), cls: 'num' }, { v: String(i.skipped), cls: 'num' }, { v: i.note ?? '', cls: 'small' }]), undefined, false)
          : h('p', { class: 'muted small' }, 'Nothing imported yet.')),
    );
  }

  async function fileRows(f: File, status: HTMLElement): Promise<string[][] | null> {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'xls') throw new Error('This is the old Excel format. In Excel use File → Save As → .xlsx or .csv.');
    if (ext === 'xlsx' || ext === 'xlsm') {
      const { xlsxToCsv } = await import('../ai/files');
      return parseCsv((await xlsxToCsv(await f.arrayBuffer())).text.replace(/^# Sheet:.*$/gm, ''));
    }
    if (ext === 'pdf') {
      const { getSettings } = await import('../ui/settings');
      if (!(await getSettings()).aiKeySet) throw new Error('Reading a PDF needs your AI key (Settings). Or download the CSV/Excel export from your broker instead.');
      const { readAttachment } = await import('../ai/files');
      status.replaceChildren(h('span', { class: 'muted' }, 'The AI is reading the PDF (about a minute)…'));
      const reply = await engineRequest<{ text: string }>('ai.chat', { message: PDF_PROMPT, attachments: [await readAttachment(f)] }, 300000);
      const csv = reply.text.match(/```(?:csv)?\n([\s\S]*?)```/)?.[1] ?? reply.text;
      status.replaceChildren(h('span', { class: 'muted' }, 'Check every row against the PDF before saving: the AI can misread a statement.'));
      return parseCsv(csv);
    }
    return parseCsv(await f.text());
  }

  function preview(rows: string[][], fileName: string) {
    const first = parseExport(rows);
    let preset: Preset = first.preset;
    let columns: ImportColumns = first.columns;
    const box = h('div', { class: 'jr-preview' });
    const close = openModal(`Import ${fileName}`, box, { wide: true, noAutofocus: true });
    const draw = () => {
      const res = rowsToFills(first.rows, first.headerAt, columns, preset);
      const headers = first.rows[first.headerAt] ?? [];
      const colSelect = (field: ImportField) =>
        h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, IMPORT_FIELDS[field]),
          h('select', { class: 'input', onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            columns = { ...columns, [field]: v === '' ? undefined : +v };
            draw();
          } }, h('option', { value: '' }, '—'), ...headers.map((x, i) => h('option', { value: String(i), selected: columns[field] === i }, x || `Column ${i + 1}`))));
      const save = h('button', { class: 'btn primary', disabled: !res.fills.length }, `Import ${res.fills.length} fills`) as HTMLButtonElement;
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const r = await engineRequest<{ message: string }>('journal.import_fills', { source: `csv:${preset.id}`, fills: res.fills, fileName }, 120000);
          close();
          toast(r.message);
          reload();
        } catch (err) {
          save.disabled = false;
          toast((err as Error).message);
        }
      });
      box.replaceChildren(
        h('div', { class: 'jr-row' },
          h('label', { class: 'jr-field' }, h('span', { class: 'muted small' }, 'Format'),
            h('select', { class: 'input', onchange: (e: Event) => {
              preset = [...PRESETS, GENERIC_PRESET].find((p) => p.id === (e.target as HTMLSelectElement).value) ?? GENERIC_PRESET;
              columns = mapColumns(headers, preset);
              draw();
            } }, ...[...PRESETS, GENERIC_PRESET].map((p) => h('option', { value: p.id, selected: p.id === preset.id }, p.label)))),
          h('span', { class: 'muted small' }, preset.id === first.preset.id ? 'Detected from the headings.' : 'Chosen by you.'),
        ),
        h('details', { class: 'small', open: preset.id === 'generic' }, h('summary', {}, 'Columns'), h('div', { class: 'jr-form' }, ...(['date', 'time', 'symbol', 'side', 'qty', 'price', 'fees', 'orderId', 'account'] as ImportField[]).map(colSelect))),
        h('p', { class: 'small' }, `${res.fills.length} fills read · ${res.skipped} rows that aren’t trades skipped${res.problems.length ? ` · ${res.problems.length} rows couldn’t be read` : ''}. Fills already in the journal (same order id, or same day, symbol, side, quantity and price from any source) are skipped when saving.`),
        res.problems.length ? h('details', { class: 'small' }, h('summary', {}, 'Rows not read'), h('ul', {}, ...res.problems.slice(0, 20).map((p) => h('li', {}, p)))) : '',
        res.fills.length
          ? dataTable(['Time (New York)', 'Symbol', 'Side', 'Qty', 'Price', 'Fees', 'Order id'], res.fills.slice(0, 50).map((x) => [when(x.time), { v: x.symbol, cls: 'label' }, `${x.side}${x.open ? ' (short)' : ''}`, { v: String(x.qty), cls: 'num' }, { v: String(x.price), cls: 'num' }, { v: x.fees ? x.fees.toFixed(2) : '', cls: 'num' }, x.orderId ?? '']), undefined, false)
          : h('p', { class: 'ap-error' }, 'No fills found: check the format and the columns above.'),
        res.fills.length > 50 ? h('p', { class: 'muted small' }, `Showing the first 50 of ${res.fills.length}.`) : '',
        h('div', { class: 'jr-row' }, save, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel')),
      );
    };
    draw();
  }

  return {
    el: frame.el,
    start(sub?: string) {
      const v = VIEWS.find(([k]) => k === sub)?.[0];
      if (v) view = v;
      if (!loaded) {
        render();
        helper.connect().then(() => reload(), () => render());
      } else render();
    },
    stop() {
      for (const c of charts) c.remove();
      charts = [];
    },
    /** From other pages: the trades in a symbol ({symbol, orderId?, sync?}); sync imports Webull fills first. */
    async open(detail: { symbol?: string; orderId?: string; sync?: boolean } = {}) {
      if (detail.symbol) filters.symbol = detail.symbol.toUpperCase();
      for (const k of ['from', 'to', 'tag', 'strategy', 'result', 'status', 'text'] as const) delete filters[k];
      saveFilters();
      view = 'trades';
      history.replaceState(null, '', '#journal/trades');
      if (detail.sync && journalReady()) {
        toast('Importing your latest Webull fills…');
        await engineRequest('journal.import_webull', {}, 600000).catch((e) => toast((e as Error).message));
      }
      await reload();
      const hit = detail.orderId ? trades.find((t) => [...t.entries, ...t.exits].some((p) => p.orderId === detail.orderId)) : null;
      if (hit) openTrade(hit);
    },
  };
}

const PDF_PROMPT =
  'This is a brokerage statement or trade confirmation. Extract every executed trade (buys, sells, short sales, buys to cover) as CSV with exactly these columns: Date,Time,Symbol,Side,Quantity,Price,Fees,Order ID. Date as YYYY-MM-DD, Time as HH:MM:SS New York time (blank if not shown), Side as Buy, Sell, Sell Short or Buy to Cover, Quantity positive. Leave out dividends, interest, transfers and fees that are not trades. Reply with only the CSV in one ```csv block, and nothing else.';
