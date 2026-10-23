/**
 * "Best setups" on the Home page: the helper's background scanner (every Nasdaq-100 stock plus the watchlist,
 * rescanned every 5 minutes). One tab per strategy, the weekly swing first. Each card says exactly when to get in,
 * where the stop and target are and when to get out, with a checklist (COT, z-score, tested record, earnings...).
 */
import { insightButton } from '../ai/insight';
import type { MarketRef } from '../data/quotes';
import { engineRequest, helper } from '../data/schwab';
import { state } from '../state';
import { pct as fmtPct } from '../ui/charts';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';

type StrategyKey = 'weekly_swing' | 'mean_reversion' | 'breakout';
type Tier = 'A' | 'B' | 'C';

interface Level {
  price: number;
  label: string;
}

interface Stats {
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgBars?: number | null;
  maxDrawdown?: number;
  grade?: string;
}

export interface Setup {
  symbol: string;
  strategy: StrategyKey;
  strategyName: string;
  direction: number;
  status: 'forming' | 'ready' | 'waiting' | 'in trade';
  statusText: string;
  signalDate: string;
  price: number;
  day: number | null;
  week: number | null;
  reasons: string[];
  score: number;
  tier: Tier | null;
  plan: {
    entryType: 'stop' | 'open';
    trigger: number;
    validUntil: string;
    stop: number;
    target: number | null;
    targetNote: string;
    maxHold: number;
    exitBy: string;
    exitRule: string;
    riskReward: number | null;
    riskPct: number | null;
    atr: number;
    horizon: string;
  };
  indicators: { z: number | null; willr: number | null; cot: number | null; cotView: 'agree' | 'against' | 'neutral' | null; weekly: number | null; wadRising: boolean | null; rsi2: number | null; adx: number | null };
  checks: { label: string; ok: boolean | null; detail: string }[];
  levels: { supports: Level[]; resistances: Level[] };
  stock: Stats;
  strategyStats: Stats & { randomEntryP: number | null };
  randomWalk?: { runs: number; p: number; verdict: 'edge' | 'maybe' | 'luck' };
  trade?: { entry: number; filled: string; pnl: number; daysHeld: number };
  earnings?: { date?: string; time?: string; inWindow?: boolean; unknown?: boolean } | null;
  news?: { headline: string; link?: string; source?: string; count: number; tone: number };
  smartMoney?: { text: string; points: number }[];
  bias?: { direction: 'up' | 'down' | 'flat'; winRate: number | null; samples: number } | null;
}

interface StrategyInfo {
  name: string;
  short: string;
  horizon: string;
  stocks: number;
  stats: Stats;
  randomEntry: { p: number; trades: number; verdict: 'edge' | 'maybe' | 'luck' } | null;
}

interface ScanResult {
  updated: number;
  session: 'open' | 'extended' | 'closed';
  universe?: string;
  scanned: number;
  skipped?: ({ symbol: string; reason: 'unknown' | 'temporary' } | string)[];
  regime: { qqqWeekly: number | null; qqqWeek: number | null; above50: number | null; vix: number | null; ndxCot: number | null };
  strategies?: Record<StrategyKey, StrategyInfo>;
  primary?: StrategyKey;
  setups: Setup[];
  filteredOut: { symbol: string; strategy?: string }[];
  nextScan?: number | null;
  scanning?: boolean;
}

const pct = (v: number | null | undefined, d = 1) => fmtPct(v, d);
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const REFRESH_MS = 60 * 1000; // the helper rescans every 5 minutes; checking every minute keeps the box current
const TIER_TEXT: Record<Tier, string> = {
  A: 'A-grade: the strategy beats random entries across the Nasdaq-100, this stock’s record isn’t losing, COT isn’t against it, no earnings in the holding period, and (weekly swing) the target is at least 1.5x the risk',
  B: 'B-grade: the strategy is profitable overall and nothing is against it, but not every A-grade check passed',
  C: 'C-grade: weak or untested: an idea to watch, not a trade',
};
const STRATEGY_TABS: { key: StrategyKey | 'all'; label: string }[] = [
  { key: 'weekly_swing', label: '★ Weekly swing' },
  { key: 'mean_reversion', label: 'Mean reversion' },
  { key: 'breakout', label: 'Breakout' },
  { key: 'all', label: 'All' },
];
const STRATEGY_HELP: Record<StrategyKey, string> = {
  weekly_swing:
    'Enter on the daily chart, exit within a week. Buys pullbacks in a weekly uptrend (sells rallies in a downtrend) when commercial hedgers lean the same way in the Nasdaq-100 futures (Williams COT index 60+), price is stretched from its 20-day mean (z-score beyond ±1), Williams %R turns back out of oversold/overbought and Williams Accumulation/Distribution confirms the money flow.',
  mean_reversion: 'Snap-backs after extreme short-term moves (RSI 2 and z-score) in the direction of the 200-day trend; out on a close back across the 5-day average or within 7 days.',
  breakout: 'New 20-day highs (lows) in a weekly trend with ADX and volume; the stop trails at the 10-day low (high), up to 4 weeks.',
};

export function createSetupsPanel(onOpenChart: (ref: MarketRef) => void) {
  let tab: StrategyKey | 'all' = 'weekly_swing';
  let bestOnly = true;
  let data: ScanResult | null = null;
  let loading = false;
  const body = h('div', { class: 'setups-body' }, h('div', { class: 'skeleton', style: 'height:150px' }));
  const regime = h('div', { class: 'setups-regime muted small' });
  const summary = h('div', { class: 'setups-summary' });
  const tabs = h('div', { class: 'segmented small setups-tabs' }, ...STRATEGY_TABS.map((t) => h('button', { class: t.key === tab ? 'active' : '', 'data-tab': t.key, onclick: () => setTab(t.key) }, t.label)));
  const filter = h('div', { class: 'segmented small' }, h('button', { class: 'active', 'data-best': '1', onclick: () => setBest(true) }, 'Best'), h('button', { 'data-best': '0', onclick: () => setBest(false) }, 'Everything'));
  const refreshBtn = h('button', { class: 'icon-btn', title: 'Scan again now', 'aria-label': 'Scan again', onclick: () => load(true) }, icon('refresh', 18));
  const ai = insightButton(
    () => (data ? { topic: 'scanner', symbol: '', title: 'AI desk note: best plays right now', data: { regime: data.regime, strategies: data.strategies, setups: data.setups.slice(0, 10), filteredOut: data.filteredOut } } : null),
    'AI desk note',
  );
  const el = h(
    'section',
    { class: 'panel setups-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, icon('spark', 20), ' Best setups'), h('span', { class: 'spacer' }), ai.button, refreshBtn),
    h('div', { class: 'setups-controls' }, tabs, filter),
    regime,
    summary,
    body,
    ai.panel,
    h('p', { class: 'muted tiny setups-note' }, 'Every Nasdaq-100 stock plus your watchlist, rescanned every 5 minutes by the helper. Signals and tested records, not certainties or advice; size each trade so the stop-out is affordable.'),
  );

  function setTab(t: StrategyKey | 'all') {
    tab = t;
    tabs.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  function setBest(v: boolean) {
    bestOnly = v;
    filter.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('active', (b.dataset.best === '1') === v));
    render();
  }

  async function load(refresh = false) {
    if (loading || !helper.isConnected) return;
    loading = true;
    if (refresh || !data)
      body.replaceChildren(h('div', { class: 'muted pad' }, refresh ? 'Scanning the market…' : 'The scanner is reading every Nasdaq-100 stock plus your watchlist. The first scan after the helper starts takes a couple of minutes (it reads Schwab gently so your charts stay fast).'));
    try {
      const symbols = state.watchlist.filter((r) => r.provider === 'schwab').map((r) => r.symbol);
      data = await engineRequest<ScanResult>('scanner.results', { symbols, refresh }, 300000);
      render();
    } catch (err) {
      if (data) render();
      else body.replaceChildren(h('div', { class: 'setups-error' }, h('b', {}, 'The market scanner isn’t running yet. '), (err as Error).message));
    } finally {
      loading = false;
    }
  }

  function render() {
    if (!data) return;
    if (!data.strategies) {
      regime.replaceChildren();
      summary.replaceChildren();
      body.replaceChildren(h('div', { class: 'setups-banner' }, h('b', {}, 'Update the helper to see the new Nasdaq-100 swing scanner. '), 'Download the ZIP from GitHub again, replace your helper folder and restart it.'));
      return;
    }
    const r = data.regime;
    regime.replaceChildren(
      h('span', {}, 'Nasdaq-100: ', h('b', { class: r.qqqWeekly === 1 ? 'up' : r.qqqWeekly === -1 ? 'down' : '' }, r.qqqWeekly === 1 ? 'weekly uptrend' : r.qqqWeekly === -1 ? 'weekly downtrend' : 'no clear weekly trend')),
      r.qqqWeek != null ? h('span', {}, 'week ', h('b', { class: r.qqqWeek >= 0 ? 'up' : 'down' }, pct(r.qqqWeek))) : '',
      r.above50 != null ? h('span', {}, `${Math.round(r.above50 * 100)}% of stocks above their 50-day average`) : '',
      r.ndxCot != null ? h('span', { title: 'Larry Williams COT index for commercial hedgers in Nasdaq-100 futures (26 weeks): 60+ leans bullish, 40- bearish' }, 'Futures commercials ', h('b', { class: r.ndxCot >= 60 ? 'up' : r.ndxCot <= 40 ? 'down' : '' }, `${r.ndxCot.toFixed(0)}/100`)) : '',
      r.vix != null ? h('span', {}, 'VIX ', h('b', { class: r.vix > 25 ? 'down' : r.vix < 15 ? 'up' : '' }, r.vix.toFixed(1))) : '',
      h('span', {}, `${data.scanned} stocks · scanned ${timeAgo(data.updated)}${data.scanning ? ' · scanning now…' : data.nextScan ? ` · next scan in ${Math.max(1, Math.round((data.nextScan - Date.now() / 1000) / 60))} min` : ''}`),
    );
    summary.replaceChildren(tab === 'all' ? '' : strategySummary(tab));

    const pool = data.setups.filter((s) => tab === 'all' || s.strategy === tab);
    const live = pool.filter((s) => s.status !== 'forming');
    const best = live.filter((s) => s.tier === 'A' || s.tier === 'B');
    const shown = bestOnly ? (best.length ? best : live).slice(0, 6) : pool;
    const note =
      bestOnly && shown.length && !best.length
        ? h('div', { class: 'setups-banner' }, h('b', {}, 'Nothing above C-grade here right now.'), ' These are the closest candidates: ideas to watch, not trades to take.')
        : bestOnly && pool.length > shown.length
          ? h('p', { class: 'muted tiny' }, `${pool.length - shown.length} more (forming today or lower grade) under “Everything”.`)
          : '';
    if (!shown.length) {
      const others = (Object.keys(STRATEGY_HELP) as StrategyKey[]).filter((k) => k !== tab).map((k) => [k, data!.setups.filter((s) => s.strategy === k).length] as const).filter(([, n]) => n);
      body.replaceChildren(
        h(
          'div',
          { class: 'setups-empty' },
          h('b', {}, tab === 'all' ? 'No setups right now.' : `No ${STRATEGY_TABS.find((t) => t.key === tab)?.label.replace('★ ', '').toLowerCase()} setups right now.`),
          h('span', { class: 'muted small' }, ' None of the stocks has every condition lined up. Sitting out is a position; the next scan is in a few minutes.'),
          ...others.map(([k, n]) => h('button', { class: 'btn small', onclick: () => setTab(k) }, `${n} ${STRATEGY_TABS.find((t) => t.key === k)?.label} →`)),
        ),
        skippedNote(data.skipped ?? []),
      );
      return;
    }
    body.replaceChildren(
      note,
      h('div', { class: 'setups-grid' }, ...shown.map(card)),
      data.filteredOut.length ? h('p', { class: 'muted tiny' }, `Filtered out ${data.filteredOut.length} setup${data.filteredOut.length === 1 ? '' : 's'} whose strategy lost money when tested on that stock: ${data.filteredOut.map((f) => f.symbol).join(', ')}.`) : '',
      skippedNote(data.skipped ?? []),
    );
  }

  /** The selected strategy's rules and pooled record across the Nasdaq-100, with the random-entry verdict. */
  function strategySummary(key: StrategyKey) {
    const info = data?.strategies?.[key];
    if (!info) return '';
    const s = info.stats;
    const re = info.randomEntry;
    const verdict = !re
      ? h('span', { class: 'muted' }, 'Too few past trades for the random-entry test.')
      : re.verdict === 'edge'
        ? h('b', { class: 'up' }, `Beats random entries (p = ${re.p.toFixed(2)})`)
        : re.verdict === 'maybe'
          ? h('b', { class: 'warn' }, `Some edge, not proven (p = ${re.p.toFixed(2)})`)
          : h('b', { class: 'down' }, `Not better than random entries lately (p = ${re.p.toFixed(2)}): treat its setups with caution`);
    return h(
      'div',
      { class: 'strategy-summary' },
      h('div', { class: 'small' }, h('b', {}, info.name), h('span', { class: 'muted' }, ` · ${info.horizon} · `), STRATEGY_HELP[key]),
      s.trades
        ? h(
            'div',
            { class: 'small strategy-record' },
            h('span', { class: 'muted' }, `Tested on ${info.stocks} stocks, about 2 years: `),
            h('b', {}, `${s.trades} trades`),
            ' · ',
            h('b', { class: (s.winRate ?? 0) >= 0.5 ? 'up' : 'down' }, `${Math.round((s.winRate ?? 0) * 100)}% winners`),
            ' · profit factor ',
            h('b', { class: (s.profitFactor ?? 0) >= 1.2 ? 'up' : (s.profitFactor ?? 0) < 1 ? 'down' : 'warn' }, String(s.profitFactor ?? '—')),
            ' · ',
            h('b', { class: (s.expectancy ?? 0) > 0 ? 'up' : 'down' }, `${pct(s.expectancy, 2)} per trade`),
            ' (after 0.1% costs) · ',
            verdict,
          )
        : h('div', { class: 'small muted' }, 'No past trades yet to test it on.'),
    );
  }

  function skippedNote(list: NonNullable<ScanResult['skipped']>) {
    const items = list.map((x) => (typeof x === 'string' ? { symbol: x, reason: 'unknown' as const } : x));
    const unknown = items.filter((x) => x.reason === 'unknown').map((x) => x.symbol);
    const temporary = items.filter((x) => x.reason === 'temporary').map((x) => x.symbol);
    const parts = [
      unknown.length ? `Schwab has no price history for ${unknown.join(', ')} (unknown, delisted or futures symbols); they're tried again tomorrow or when you press Scan again.` : '',
      temporary.length ? `Schwab didn't answer for ${temporary.join(', ')} this time; they're included in the next scan.` : '',
    ].filter(Boolean);
    return parts.length ? h('p', { class: 'muted tiny' }, parts.join(' ')) : '';
  }

  function card(s: Setup) {
    const long = s.direction > 0;
    const p = s.plan;
    const details = h('div', { class: 'setup-details', hidden: true });
    const entryText = p.entryType === 'stop' ? `${long ? 'above' : 'below'} ${formatPrice(p.trigger)}` : 'next open';
    return h(
      'div',
      { class: `setup-card ${long ? 'long' : 'short'}${s.status === 'forming' ? ' forming' : ''}` },
      h(
        'div',
        { class: 'setup-top' },
        h('button', { class: 'setup-symbol', title: 'Open chart', onclick: () => onOpenChart({ provider: 'schwab', symbol: s.symbol }) }, s.symbol),
        h('span', { class: `setup-side ${long ? 'bull' : 'bear'}` }, long ? '▲ BUY' : '▼ SELL'),
        s.tier ? h('i', { class: `tier tier-${s.tier}`, title: TIER_TEXT[s.tier] }, `${s.tier}-grade`) : '',
        h('span', { class: 'spacer' }),
        h(
          'span',
          { class: 'setup-price' },
          formatPrice(s.price),
          h('span', { class: (s.day ?? 0) >= 0 ? 'up' : 'down', title: 'Today' }, ` ${pct(s.day)}`),
          s.week != null ? h('span', { class: 'muted small', title: 'Past 5 trading days' }, ' · wk ', h('span', { class: s.week >= 0 ? 'up' : 'down' }, pct(s.week))) : '',
        ),
      ),
      h('div', { class: 'setup-meta small' }, h('span', { class: 'strategy-chip' }, s.strategyName), h('span', { class: `status-chip status-${s.status.replace(' ', '-')}` }, s.statusText)),
      s.trade
        ? h('div', { class: 'setup-trade small' }, `Entered ${formatPrice(s.trade.entry)} on ${shortDate(s.trade.filled)} · `, h('b', { class: s.trade.pnl >= 0 ? 'up' : 'down' }, `${pct(s.trade.pnl)} so far`), ` · day ${s.trade.daysHeld} of ${p.maxHold}`)
        : '',
      h(
        'div',
        { class: 'setup-levels' },
        s.trade
          ? h('span', {}, h('span', { class: 'muted' }, 'Entered '), h('b', {}, formatPrice(s.trade.entry)))
          : h('span', {}, h('span', { class: 'muted' }, long ? 'Buy ' : 'Sell '), h('b', {}, entryText)),
        h('span', {}, h('span', { class: 'muted' }, 'Stop '), h('b', { class: 'down' }, formatPrice(p.stop))),
        h('span', {}, h('span', { class: 'muted' }, 'Target '), h('b', { class: 'up' }, p.target != null ? formatPrice(p.target) : 'trail')),
        h('span', {}, h('span', { class: 'muted' }, 'Out by '), h('b', {}, shortDate(p.exitBy))),
      ),
      h(
        'ul',
        { class: 'setup-checks small' },
        ...s.checks.map((c) => h('li', { class: c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'neutral', title: c.detail }, h('i', {}, c.ok === true ? '✓' : c.ok === false ? '✗' : '•'), h('span', {}, c.label), h('span', { class: 'muted' }, ` ${c.detail}`))),
      ),
      s.randomWalk
        ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Random-walk test on this stock: '), h('b', { class: s.randomWalk.verdict === 'edge' ? 'up' : s.randomWalk.verdict === 'maybe' ? 'warn' : 'down' }, s.randomWalk.verdict === 'edge' ? 'likely a real edge' : s.randomWalk.verdict === 'maybe' ? 'inconclusive' : 'could be luck'), h('span', { class: 'muted' }, ` (p = ${s.randomWalk.p.toFixed(2)}, ${s.randomWalk.runs} shuffled histories)`))
        : '',
      s.bias && s.bias.direction !== 'flat'
        ? h('div', { class: 'setup-bias small' }, 'Next 30 min: ', h('b', { class: s.bias.direction === 'up' ? 'up' : 'down' }, s.bias.direction === 'up' ? 'leaning up' : 'leaning down'), s.bias.winRate != null ? h('span', { class: 'muted' }, ` · right ${Math.round(s.bias.winRate * 100)}% of ${s.bias.samples} recent times${s.bias.winRate < 0.55 ? ' (about a coin flip, so give it little weight)' : ''}`) : '')
        : '',
      h('button', { class: 'setup-more', onclick: () => ((details.hidden = !details.hidden), details.childElementCount || details.append(...detailView(s))) }, 'Details: why, exit rules, levels'),
      details,
    );
  }

  function detailView(s: Setup): (Node | string)[] {
    const p = s.plan;
    const st = s.stock;
    const i = s.indicators;
    return [
      h('h4', {}, 'Why this setup'),
      h('ul', { class: 'setup-reasons' }, ...s.reasons.map((r) => h('li', {}, r))),
      h('h4', {}, 'The plan'),
      h('p', { class: 'small' }, s.statusText, '.'),
      h('p', { class: 'small' }, p.exitRule),
      h(
        'p',
        { class: 'small' },
        `Stop ${formatPrice(p.stop)} · target ${p.target != null ? formatPrice(p.target) : '—'} (${p.targetNote})${p.riskReward != null ? ` · reward:risk ${p.riskReward.toFixed(1)}x` : ''}. ATR ${formatPrice(p.atr)}.`,
      ),
      p.riskPct
        ? h('p', { class: 'small muted' }, `Risk ${(p.riskPct * 100).toFixed(1)}% of the entry price per share: with $10,000 and 1% risked per trade that's about ${Math.max(1, Math.floor(100 / (p.riskPct * p.trigger)))} shares.`)
        : '',
      h('h4', {}, 'Readings on the signal day'),
      h(
        'p',
        { class: 'small' },
        [
          i.cot != null ? `COT commercials ${i.cot.toFixed(0)}/100` : 'COT n/a',
          i.z != null ? `z-score ${i.z.toFixed(2)}` : '',
          i.willr != null ? `Williams %R ${i.willr.toFixed(0)}` : '',
          i.wadRising != null ? `Williams A/D ${i.wadRising ? 'accumulating' : 'distributing'}` : '',
          i.weekly != null ? `weekly trend ${i.weekly > 0 ? 'up' : i.weekly < 0 ? 'down' : 'flat'}` : '',
          i.rsi2 != null ? `RSI(2) ${i.rsi2.toFixed(0)}` : '',
          i.adx != null ? `ADX ${i.adx.toFixed(0)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      h('h4', {}, 'Support & resistance'),
      h('div', { class: 'setup-sr small' }, h('div', {}, h('b', {}, 'Resistance'), ...s.levels.resistances.map((x) => h('div', {}, `${formatPrice(x.price)} · ${x.label}`))), h('div', {}, h('b', {}, 'Support'), ...s.levels.supports.map((x) => h('div', {}, `${formatPrice(x.price)} · ${x.label}`)))),
      s.smartMoney?.length ? h('div', {}, h('h4', {}, 'Institutional flow'), ...s.smartMoney.map((t) => h('p', { class: 'small' }, t.text))) : '',
      s.news ? h('div', {}, h('h4', {}, 'News'), h('p', { class: 'small' }, s.news.link ? h('a', { href: s.news.link, target: '_blank', rel: 'noopener' }, s.news.headline) : s.news.headline, h('span', { class: 'muted' }, ` · ${s.news.source ?? ''}`))) : '',
      st.trades
        ? h(
            'div',
            {},
            h('h4', {}, 'This strategy on this stock'),
            h('p', { class: 'small' }, `${st.trades} past trades: ${Math.round((st.winRate ?? 0) * 100)}% winners, ${pct(st.expectancy, 2)} per trade after costs, profit factor ${st.profitFactor ?? '—'}, held ${st.avgBars?.toFixed(1) ?? '—'} days on average. Grade: ${st.grade}.`),
          )
        : '',
    ];
  }

  let started = false;
  return {
    el,
    start() {
      if (!started) {
        started = true;
        setInterval(() => !el.closest('[hidden]') && load(), REFRESH_MS);
      }
      load();
    },
  };
}
