/**
 * Setups: the scanner's own page. Pick a time frame (short swing on hourly bars, swing on daily bars, position on
 * weekly bars); see the evidence behind each strategy (pooled backtest, 1,000-run random-entry test, Monte Carlo,
 * and the COT + z-score edge study); browse every Nasdaq-100 setup in a sortable list; and open one to get its
 * live entry status, a chart with the entry, stop and target, and the step-by-step trade guide. Watched setups
 * follow the live price and alert when it is time to enter (or too late to chase).
 */
import { CandlestickSeries, ColorType, LineStyle, createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { subscribeQuote } from '../data/quotes';
import { engineRequest, helper, schwab } from '../data/schwab';
import type { MarketRef } from '../data/quotes';
import { entryZone, type Zone } from '../home/entryZone';
import type { Setup, StrategyInfo } from '../home/setupsPanel';
import { tradeGuideBody } from '../home/tradeGuide';
import type { Timeframe } from '../types';
import { pageFrame, pct as fmtPct } from '../ui/charts';
import { formatPrice, h, timeAgo, toast } from '../ui/dom';
import { THEME, followTheme } from '../ui/theme';

type Horizon = 'short' | 'swing' | 'position';
type StrategyKey = 'weekly_swing' | 'mean_reversion' | 'breakout';

interface EdgeStudy {
  events: number;
  groups: Record<string, { n: number; avg: number; win: number }>;
  test: { gap: number; p: number; runs: number; verdict: string } | null;
}

interface HorizonResult {
  scanned: number;
  updated: number;
  strategies: Record<StrategyKey, StrategyInfo>;
  setups: Setup[];
  filteredOut: { symbol: string }[];
  edge?: EdgeStudy | null;
  error?: string;
}

interface Scan {
  updated: number;
  session: string;
  scanned: number;
  partial?: boolean;
  scanning?: boolean;
  nextScan?: number | null;
  regime: { qqqWeekly: number | null; qqqWeek: number | null; above50: number | null; vix: number | null; ndxCot: number | null };
  horizons?: Partial<Record<Horizon, HorizonResult>>;
  horizonInfo?: Record<Horizon, { label: string; hold: string; bar: string; unit: string; higher: string }>;
  skipped?: { symbol: string; reason: string }[];
}

const HORIZONS: { key: Horizon; label: string; hold: string; tf: Timeframe; bars: string }[] = [
  { key: 'short', label: 'Short swing', hold: '1-3 days', tf: '1h', bars: 'hourly bars, daily trend filter' },
  { key: 'swing', label: 'Swing', hold: 'about 1 week', tf: '1D', bars: 'daily bars, weekly trend filter' },
  { key: 'position', label: 'Position', hold: '2-8 weeks', tf: '1W', bars: 'weekly bars, monthly trend filter' },
];
const STRATEGY_LABEL: Record<StrategyKey, string> = { weekly_swing: 'COT pullback', mean_reversion: 'Mean reversion', breakout: 'Breakout' };
const REFRESH_MS = 60_000;
const WATCH_KEY = 'tp-setups-watch';
const PREFS_KEY = 'tp-setups-prefs';
const pct = (v: number | null | undefined, d = 1) => fmtPct(v, d);
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${formatPrice(v)}`);
const idOf = (s: Setup) => `${s.horizon ?? 'swing'}:${s.strategy}:${s.symbol}:${s.signalDate}`;

function load<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window: not remembered */
  }
}

/** A short beep for alerts (no sound file needed). */
function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
  } catch {
    /* no audio */
  }
}

export function createSetupsPage(onOpenChart: (ref: MarketRef) => void) {
  const prefs = load(PREFS_KEY, { horizon: 'swing' as Horizon, strategy: 'all' as StrategyKey | 'all', grade: 'ab' as 'ab' | 'all', side: 'all' as 'all' | 'buy' | 'sell', sort: 'grade' as 'grade' | 'rr' | 'mc' | 'new', autoAlert: true });
  let data: Scan | null = null;
  let selected: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const watched = new Set<string>(load<string[]>(WATCH_KEY, []));
  const prices = new Map<string, number>();
  const zones = new Map<string, Zone>();
  const quoteStops = new Map<string, () => void>();
  const alerts: { at: number; text: string; tone: string }[] = [];

  const status = h('div', { class: 'sp-status muted small' });
  const horizonTabs = h('div', { class: 'segmented sp-horizons' }, ...HORIZONS.map((x) => h('button', { 'data-h': x.key, onclick: () => setPref('horizon', x.key) }, h('b', {}, x.label), h('span', { class: 'muted tiny' }, ` ${x.hold}`))));
  const notifyBtn = h('button', { class: 'btn', title: 'Let the platform show desktop notifications for entry alerts', onclick: askNotify }, 'Enable alerts');
  const refreshBtn = h('button', { class: 'btn', title: 'Scan again now', onclick: () => refresh(true) }, 'Scan now');
  const frame = pageFrame('Setups', 'Nasdaq-100 trade setups on three time frames, each tested with 1,000 simulations and checked against COT positioning.', [horizonTabs, notifyBtn, refreshBtn]);
  const evidence = h('section', { class: 'sp-evidence' });
  const filters = h('div', { class: 'sp-filters' });
  const list = h('div', { class: 'sp-list' });
  const detail = h('div', { class: 'sp-detail' }, h('p', { class: 'muted pad' }, 'Pick a setup on the left to see its live entry status, chart and step-by-step guide.'));
  const alertLog = h('div', { class: 'sp-alerts' });
  frame.body.replaceChildren(status, evidence, filters, h('div', { class: 'sp-main' }, h('div', { class: 'sp-left' }, list, alertLog), detail));

  function setPref<K extends keyof typeof prefs>(k: K, v: (typeof prefs)[K]) {
    prefs[k] = v;
    save(PREFS_KEY, prefs);
    if (k === 'horizon') selected = null;
    render();
    syncWatches();
  }

  async function askNotify() {
    if (!('Notification' in window)) return toast('This browser has no desktop notifications; alerts will show on the page with a sound.');
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Alerts on: you\'ll get a notification when a watched setup is ready to enter.' : 'Notifications are blocked; alerts will still show here with a sound.');
    render();
  }

  function horizon(): HorizonResult | undefined {
    return data?.horizons?.[prefs.horizon];
  }

  async function refresh(force = false) {
    if (!helper.isConnected && !force) {
      status.textContent = 'Waiting for the helper…';
    }
    try {
      data = await engineRequest<Scan>('scanner.results', force ? { refresh: true } : {}, force ? 900_000 : 600_000);
      render();
      syncWatches();
    } catch (err) {
      status.replaceChildren(h('span', { class: 'down' }, (err as Error).message));
    }
  }

  // ----- Rendering -----

  function render() {
    horizonTabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.h === prefs.horizon));
    notifyBtn.textContent = 'Notification' in window && Notification.permission === 'granted' ? 'Alerts on' : 'Enable alerts';
    const info = HORIZONS.find((x) => x.key === prefs.horizon)!;
    const hr = horizon();
    if (!data) {
      status.textContent = 'Loading the latest scan…';
      return;
    }
    if (!data.horizons) {
      status.replaceChildren(h('b', {}, 'Update the helper to use the Setups page. '), 'Download the ZIP from GitHub again, replace your helper folder and restart it.');
      return;
    }
    const r = data.regime;
    status.replaceChildren(
      h('span', {}, `${info.label}: ${info.bars}, hold ${info.hold}.`),
      h('span', {}, 'Nasdaq-100 ', h('b', { class: r.qqqWeekly === 1 ? 'up' : r.qqqWeekly === -1 ? 'down' : '' }, r.qqqWeekly === 1 ? 'weekly uptrend' : r.qqqWeekly === -1 ? 'weekly downtrend' : 'no clear trend'), r.qqqWeek != null ? ` (week ${pct(r.qqqWeek)})` : ''),
      r.ndxCot != null ? h('span', {}, 'Futures commercials ', h('b', { class: r.ndxCot >= 60 ? 'up' : r.ndxCot <= 40 ? 'down' : '' }, `${r.ndxCot.toFixed(0)}/100`)) : '',
      r.vix != null ? h('span', {}, `VIX ${r.vix.toFixed(1)}`) : '',
      h('span', {}, hr ? `${hr.scanned} stocks · scanned ${timeAgo(hr.updated)}` : 'this time frame is still loading…', data.scanning ? ' · scanning now…' : data.nextScan ? ` · next scan in ${Math.max(1, Math.round((data.nextScan - Date.now() / 1000) / 60))} min` : ''),
    );
    renderEvidence(hr);
    renderFilters();
    renderList(hr);
    renderDetail();
    renderAlerts();
  }

  function renderEvidence(hr: HorizonResult | undefined) {
    if (!hr) return evidence.replaceChildren(h('div', { class: 'skeleton', style: 'height:90px' }));
    const cards = (Object.keys(STRATEGY_LABEL) as StrategyKey[]).map((k) => {
      const st = hr.strategies[k];
      if (!st) return '';
      const s = st.stats;
      const re = st.randomEntry;
      const mc = st.monteCarlo;
      const verdict = !s.trades ? 'no trades yet' : (s.expectancy ?? 0) <= 0 ? 'loses money' : re?.verdict === 'edge' ? 'beats random entries' : re?.verdict === 'maybe' ? 'maybe better than random' : 'not proven vs random';
      const tone = !s.trades || (s.expectancy ?? 0) <= 0 ? 'down' : re?.verdict === 'edge' ? 'up' : 'warn';
      return h(
        'div',
        { class: `sp-card${prefs.strategy === k ? ' on' : ''}`, onclick: () => setPref('strategy', prefs.strategy === k ? 'all' : k), title: 'Show only this strategy' },
        h('div', { class: 'sp-card-head' }, h('b', {}, st.short || STRATEGY_LABEL[k]), h('span', { class: `sp-verdict ${tone}` }, verdict)),
        h('div', { class: 'sp-card-stats small' },
          h('span', {}, h('span', { class: 'muted' }, 'Trades '), String(s.trades)),
          h('span', {}, h('span', { class: 'muted' }, 'Win '), s.winRate != null ? `${Math.round(s.winRate * 100)}%` : '—'),
          h('span', {}, h('span', { class: 'muted' }, 'Avg '), pct(s.expectancy, 2)),
          h('span', {}, h('span', { class: 'muted' }, 'PF '), s.profitFactor != null ? String(s.profitFactor) : '—'),
        ),
        s.tStat != null
          ? h('div', { class: 'tiny' }, `t = ${s.tStat.toFixed(1)}${s.tradesNeeded ? ` · an average this size needs about ${s.tradesNeeded.toLocaleString()} trades to be clearly real (has ${s.trades.toLocaleString()})` : ''}`)
          : '',
        h('div', { class: 'muted tiny' },
          re ? `Random-entry test (${(re.runs ?? 1000).toLocaleString()} runs): p = ${re.p.toFixed(3)}. ` : '',
          mc ? `Next ${mc.horizon} trades (${mc.runs.toLocaleString()} block-bootstrap runs): ${Math.round(mc.profitable * 100)}% end ahead, typical ${pct(mc.median)}, bad case ${pct(mc.bad)}. ` : '',
          st.recent?.trades ? h('span', { class: (st.recent.expectancy ?? 0) > 0 ? 'up' : 'down' }, `Recent 30% of history only: ${st.recent.trades} trades, ${pct(st.recent.expectancy, 2)} per trade${(st.recent.expectancy ?? 0) > 0 !== (s.expectancy ?? 0) > 0 ? ' (different from the full test: treat with care)' : ''}.`) : ''),
      );
    });
    const e = hr.edge;
    const g = (k: string) => e?.groups[k];
    const row = (k: string, label: string) => {
      const x = g(k);
      return x ? h('tr', {}, h('td', {}, label), h('td', {}, String(x.n)), h('td', { class: x.avg >= 0 ? 'up' : 'down' }, pct(x.avg, 2)), h('td', {}, `${Math.round(x.win * 100)}%`)) : '';
    };
    const edge = h(
      'div',
      { class: 'sp-edge' },
      h('div', { class: 'sp-card-head' }, h('b', {}, 'COT + z-score edge study'), e?.test ? h('span', { class: `sp-verdict ${e.test.verdict === 'COT adds an edge' ? 'up' : e.test.verdict === 'COT may help' ? 'warn' : ''}` }, e.test.verdict) : h('span', { class: 'muted tiny' }, e ? 'not enough history yet' : '—')),
      h('p', { class: 'muted tiny' }, 'Every past time a stock stretched beyond its own z-score band in the trend\'s direction and turned back, split by what commercial hedgers were doing, with the return over the holding period after costs.'),
      e && Object.keys(e.groups).length
        ? h('table', { class: 'sp-edge-table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Commercials'), h('th', {}, 'Times'), h('th', {}, 'Avg'), h('th', {}, 'Win'))), h('tbody', {}, row('agree', 'Agreed'), row('neutral', 'Neutral'), row('against', 'Against'), row('none', 'No COT data')))
        : '',
      e?.test ? h('p', { class: 'tiny' }, `Agreed minus against: ${pct(e.test.gap, 2)} per trade; ${e.test.runs.toLocaleString()}-run permutation p = ${e.test.p.toFixed(3)}.`) : '',
    );
    evidence.replaceChildren(h('div', { class: 'sp-cards' }, ...cards, edge));
  }

  function renderFilters() {
    const seg = <T extends string>(key: 'grade' | 'side' | 'sort', options: [T, string][]) =>
      h('div', { class: 'segmented small' }, ...options.map(([v, label]) => h('button', { class: prefs[key] === v ? 'active' : '', onclick: () => setPref(key, v as never) }, label)));
    filters.replaceChildren(
      seg('grade', [['ab', 'A & B only'], ['all', 'All grades']]),
      seg('side', [['all', 'Buys & sells'], ['buy', 'Buys'], ['sell', 'Sells']]),
      h('label', { class: 'small muted' }, 'Sort ', h('select', { class: 'input small-select', onchange: (e: Event) => setPref('sort', (e.target as HTMLSelectElement).value as never) }, ...([['grade', 'Best grade'], ['rr', 'Reward:risk'], ['mc', 'Monte Carlo % ahead'], ['new', 'Newest']] as const).map(([v, l]) => h('option', { value: v, selected: prefs.sort === v }, l)))),
      h('label', { class: 'small sp-auto', title: 'Watch every A and B setup automatically and alert when one reaches its entry' }, h('input', { type: 'checkbox', checked: prefs.autoAlert, onchange: (e: Event) => (setPref('autoAlert', (e.target as HTMLInputElement).checked), syncWatches()) }), ' Alert me on A & B entries'),
      prefs.strategy !== 'all' ? h('button', { class: 'btn small', onclick: () => setPref('strategy', 'all') }, `${STRATEGY_LABEL[prefs.strategy]} only ✕`) : '',
    );
  }

  function visible(hr: HorizonResult): Setup[] {
    const rank = { A: 0, B: 1, C: 2 } as const;
    const out = hr.setups.filter(
      (s) =>
        (prefs.strategy === 'all' || s.strategy === prefs.strategy) &&
        (prefs.grade === 'all' || s.tier === 'A' || s.tier === 'B') &&
        (prefs.side === 'all' || (prefs.side === 'buy') === s.direction > 0),
    );
    const mc = (s: Setup) => s.monteCarlo?.profitable ?? -1;
    return out.sort((a, b) =>
      prefs.sort === 'rr' ? (b.plan.riskReward ?? 0) - (a.plan.riskReward ?? 0)
        : prefs.sort === 'mc' ? mc(b) - mc(a)
          : prefs.sort === 'new' ? Number(!!b.new) - Number(!!a.new) || b.signalDate.localeCompare(a.signalDate)
            : rank[a.tier ?? 'C'] - rank[b.tier ?? 'C'] || Number(a.status === 'forming') - Number(b.status === 'forming') || b.score - a.score,
    );
  }

  function renderList(hr: HorizonResult | undefined) {
    if (!hr) return list.replaceChildren(h('div', { class: 'skeleton', style: 'height:240px' }));
    if (hr.error) return list.replaceChildren(h('p', { class: 'muted pad' }, hr.error));
    const rows = visible(hr);
    if (!rows.length) {
      const all = hr.setups.length;
      return list.replaceChildren(
        h('div', { class: 'setups-empty' }, h('b', {}, all ? 'No A or B setups on this time frame right now.' : 'No setups on this time frame right now.'),
          h('span', { class: 'muted small' }, all ? ` ${all} lower-grade idea${all === 1 ? '' : 's'} under "All grades". ` : ' Nothing has every condition lined up. Sitting out is a position. '),
          all ? h('button', { class: 'btn small', onclick: () => setPref('grade', 'all') }, 'Show all grades') : ''),
      );
    }
    if (!selected || !rows.some((s) => idOf(s) === selected)) selected = idOf(rows[0]);
    list.replaceChildren(
      h('table', { class: 'sp-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Stock'), h('th', {}, 'Grade'), h('th', {}, 'Status'), h('th', { class: 'num' }, 'Entry'), h('th', { class: 'num' }, 'Stop'), h('th', { class: 'num' }, 'Target'), h('th', { class: 'num' }, 'R:R'), h('th', { class: 'num' }, 'MC ahead'))),
        h('tbody', {}, ...rows.map(row)),
      ),
      h('p', { class: 'muted tiny' }, `${rows.length} shown of ${hr.setups.length}. Signals come from finished ${HORIZONS.find((x) => x.key === prefs.horizon)!.bars.split(',')[0]}; the 5-minute scans update prices, triggers and grades.`),
    );
  }

  function row(s: Setup) {
    const id = idOf(s);
    const z = entryZone(s, prices.get(s.symbol) ?? s.price);
    const long = s.direction > 0;
    return h(
      'tr',
      { class: `${id === selected ? 'sel' : ''}`, onclick: () => ((selected = id), render()) },
      h('td', {}, h('button', { class: `sp-star${watched.has(id) ? ' on' : ''}`, title: watched.has(id) ? 'Stop watching' : 'Watch: alert me when it\'s time to enter', onclick: (e: Event) => (e.stopPropagation(), toggleWatch(s)) }, watched.has(id) ? '★' : '☆')),
      h('td', {}, h('b', {}, s.symbol), ' ', h('span', { class: `sp-side ${long ? 'up' : 'down'}` }, long ? 'BUY' : 'SELL'), s.new ? h('span', { class: 'new-chip' }, 'New') : '', s.conflict ? h('span', { class: 'sp-warn', title: `${s.conflict.strategy} says the opposite` }, ' ⚠') : '', h('div', { class: 'muted tiny' }, STRATEGY_LABEL[s.strategy as StrategyKey] ?? s.strategyName)),
      h('td', {}, s.tier ? h('i', { class: `tier tier-${s.tier}` }, s.tier) : ''),
      h('td', { class: z.tone }, z.label),
      h('td', { class: 'num' }, usd(s.trade?.entry ?? s.plan.trigger)),
      h('td', { class: 'num down' }, usd(s.plan.stop)),
      h('td', { class: 'num up' }, s.plan.target != null ? usd(s.plan.target) : 'trail'),
      h('td', { class: 'num' }, s.plan.riskReward != null ? `${s.plan.riskReward.toFixed(1)}x` : '—'),
      h('td', { class: 'num' }, s.monteCarlo ? `${Math.round(s.monteCarlo.profitable * 100)}%` : '—'),
    );
  }

  // ----- Detail: live status, chart, guide -----

  let chart: IChartApi | null = null;
  let detailId: string | null = null;

  function renderDetail() {
    const hr = horizon();
    const s = hr?.setups.find((x) => idOf(x) === selected);
    if (!s) {
      detailId = null;
      return;
    }
    const id = idOf(s);
    if (id === detailId) return updateLive(s); // keep the chart and the size calculator as they are
    detailId = id;
    chart?.remove();
    chart = null;
    const chartBox = h('div', { class: 'sp-chart' });
    const live = h('div', { class: 'sp-live' });
    const watchBtn = h('button', { class: 'btn small', onclick: () => (toggleWatch(s), render()) });
    const strat = hr!.strategies[s.strategy as StrategyKey];
    detail.replaceChildren(
      h('div', { class: 'sp-detail-head' }, h('h2', {}, s.symbol), h('span', { class: 'muted' }, `${s.strategyName} · ${HORIZONS.find((x) => x.key === prefs.horizon)!.label} · ${s.plan.holdText ?? s.plan.horizon}`), h('span', { class: 'spacer' }), watchBtn, h('button', { class: 'btn small', onclick: () => onOpenChart({ provider: 'schwab', symbol: s.symbol }) }, 'Open chart')),
      live,
      chartBox,
      evidenceLine(s),
      tradeGuideBody(s, strat, onOpenChart),
    );
    updateLive(s);
    drawChart(chartBox, s);
    if (!quoteStops.has(s.symbol)) watchQuote(s.symbol);
  }

  function evidenceLine(s: Setup) {
    const rw = s.randomWalk;
    const parts: (Node | string)[] = [];
    if (rw && 'pending' in rw) parts.push(`Random-walk test: running ${rw.runs.toLocaleString()} shuffled histories…`);
    else if (rw) {
      const q = (rw as { q?: number; tests?: number }).q;
      parts.push(`Random-walk test (${rw.runs.toLocaleString()} runs): p = ${rw.p.toFixed(3)}${q != null ? `, q = ${q.toFixed(3)} after correcting for ${(rw as { tests?: number }).tests} stocks tested at once` : ''}. `);
    }
    if (s.darkPool) parts.push(`Dark pool short volume: ${Math.round(s.darkPool.avg5 * 100)}% (5-day) vs ${Math.round(s.darkPool.avg40 * 100)}% (40-day). `);
    return parts.length ? h('p', { class: 'small sp-evidence-line' }, ...parts) : '';
  }

  function updateLive(s: Setup) {
    const live = detail.querySelector('.sp-live');
    const watchBtn = detail.querySelector<HTMLButtonElement>('.sp-detail-head .btn');
    if (watchBtn) watchBtn.textContent = watched.has(idOf(s)) ? '★ Watching' : '☆ Watch & alert';
    if (!live) return;
    const price = prices.get(s.symbol) ?? s.price;
    const z = entryZone(s, price);
    live.className = `sp-live zone-${z.zone}`;
    live.replaceChildren(h('div', {}, h('b', {}, z.label), h('span', { class: 'muted small' }, ` · ${usd(price)}${prices.has(s.symbol) ? ' live' : ' at the last scan'}`)), h('p', { class: 'small' }, z.detail));
  }

  async function drawChart(box: HTMLElement, s: Setup) {
    const tf = HORIZONS.find((x) => x.key === (s.horizon ?? prefs.horizon))!.tf;
    try {
      const bars = (await schwab.loadHistory(s.symbol, tf, new AbortController().signal)).slice(-150);
      if (!box.isConnected) return;
      chart = createChart(box, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: THEME.text, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: THEME.grid } },
        rightPriceScale: { borderColor: THEME.border },
        timeScale: { borderColor: THEME.border, timeVisible: tf === '1h' },
      });
      followTheme(chart, { transparent: true, hideVertGrid: true });
      const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, { upColor: THEME.up, downColor: THEME.down, wickUpColor: THEME.up, wickDownColor: THEME.down, borderVisible: false });
      series.setData(bars.map((b) => ({ time: b.time as never, open: b.open, high: b.high, low: b.low, close: b.close })));
      const line = (price: number, color: string, title: string) => series.createPriceLine({ price, color, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title });
      line(s.trade?.entry ?? s.plan.trigger, '#2962ff', s.trade ? 'Entered' : 'Entry');
      line(s.plan.stop, THEME.down, 'Stop');
      if (s.plan.target != null) line(s.plan.target, THEME.up, 'Target');
      chart.timeScale().fitContent();
    } catch (err) {
      box.replaceChildren(h('p', { class: 'muted small pad' }, `Chart unavailable: ${(err as Error).message}`));
    }
  }

  // ----- Watching and alerts -----

  function toggleWatch(s: Setup) {
    const id = idOf(s);
    if (watched.has(id)) watched.delete(id);
    else {
      watched.add(id);
      toast(`Watching ${s.symbol}: you'll get an alert when it's time to enter.`);
    }
    save(WATCH_KEY, [...watched]);
    syncWatches();
    render();
  }

  /** Setups followed live: the starred ones, plus every A and B setup when auto-alerts are on. */
  function followed(): Setup[] {
    const all = Object.values(data?.horizons ?? {}).flatMap((x) => x?.setups ?? []);
    return all.filter((s) => watched.has(idOf(s)) || (prefs.autoAlert && (s.tier === 'A' || s.tier === 'B') && s.status !== 'forming'));
  }

  function syncWatches() {
    const wanted = new Set(followed().map((s) => s.symbol));
    const hr = horizon();
    for (const s of hr ? visible(hr) : []) wanted.add(s.symbol); // so every row's status uses the live price
    for (const [sym, stop] of quoteStops) if (!wanted.has(sym)) (stop(), quoteStops.delete(sym));
    for (const sym of wanted) if (!quoteStops.has(sym)) watchQuote(sym);
    for (const s of followed()) checkZone(s, prices.get(s.symbol) ?? s.price, true);
  }

  function watchQuote(symbol: string) {
    quoteStops.set(symbol, subscribeQuote({ provider: 'schwab', symbol }, (q) => {
      if (!q.last) return;
      prices.set(symbol, q.last);
      for (const s of followed()) if (s.symbol === symbol) checkZone(s, q.last, false);
      const cur = horizon()?.setups.find((x) => idOf(x) === selected);
      if (cur?.symbol === symbol) updateLive(cur);
      relist();
    }));
  }

  // Redraw the list (its Status column follows live prices) at most once per animation frame.
  let relistQueued = false;
  function relist() {
    if (relistQueued) return;
    relistQueued = true;
    requestAnimationFrame(() => ((relistQueued = false), renderList(horizon())));
  }

  /** Alerts when a followed setup moves into "getting close" or "entry zone now" (once per change). */
  function checkZone(s: Setup, price: number, quiet: boolean) {
    const id = idOf(s);
    const z = entryZone(s, price);
    const before = zones.get(id);
    zones.set(id, z.zone);
    if (quiet || before === z.zone || !(z.zone === 'entry' || z.zone === 'approaching')) return;
    const text = `${s.symbol} ${s.direction > 0 ? 'BUY' : 'SELL'} (${s.tier}-grade, ${HORIZONS.find((x) => x.key === (s.horizon ?? 'swing'))!.label}): ${z.label}. ${z.detail}`;
    alerts.unshift({ at: Date.now(), text, tone: z.tone });
    alerts.splice(20);
    renderAlerts();
    beep();
    toast(`${s.symbol}: ${z.label}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`${s.symbol}: ${z.label}`, { body: z.detail, tag: id });
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    }
  }

  function renderAlerts() {
    alertLog.replaceChildren(
      h('h3', {}, 'Entry alerts'),
      alerts.length
        ? h('ul', { class: 'sp-alert-list small' }, ...alerts.map((a) => h('li', { class: a.tone }, h('span', { class: 'muted tiny' }, new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), ' ', a.text)))
        : h('p', { class: 'muted tiny' }, `Following ${followed().length} setup${followed().length === 1 ? '' : 's'} with live prices. An alert appears here (with a sound${'Notification' in window && Notification.permission === 'granted' ? ' and a notification' : ''}) when one gets close to or reaches its entry. Keep this tab open.`),
    );
  }

  return {
    el: frame.el,
    start() {
      refresh();
      timer ??= setInterval(() => refresh(), REFRESH_MS);
    },
    // Keep watching in the background so alerts still fire while you look at other pages.
  };
}
