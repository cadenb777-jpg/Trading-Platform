/**
 * "Best setups" on the Home page: the helper's background market scanner, shown simply. By default only A-grade
 * plays (tested profitable on that stock, reward at least 1.5x risk, several signals agreeing); one click shows the
 * full reasoning, levels, institutional flow and track record.
 */
import { insightButton } from '../ai/insight';
import type { MarketRef } from '../data/quotes';
import { engineRequest, helper } from '../data/schwab';
import { state } from '../state';
import { formatPrice, h, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';

interface Level {
  price: number;
  label: string;
}

export interface Setup {
  symbol: string;
  price: number;
  score: number;
  direction: number;
  tier: 'A' | 'B' | 'C' | null;
  summary: string;
  reasons: { text: string; points: number }[];
  levels: {
    entry: number;
    trigger: number;
    entryNote: string;
    stop: number;
    stopNote: string;
    target1: number;
    target1Note: string;
    target2: number;
    target2Note: string;
    riskReward: number;
    atr: number;
    exitNote: string;
    supports: Level[];
    resistances: Level[];
  } | null;
  backtest: { trades: number; winRate: number | null; profitFactor: number | null; expectancy: number | null; avgR: number | null; avgBars: number | null; maxLosingStreak: number; grade: string; rules: string } | null;
  bias: { direction: 'up' | 'down' | 'flat'; winRate: number | null; samples: number; asOf: number } | null;
  week: number | null;
  day: number | null;
  options?: { putCallPremium: number; expectedMove?: { amount: number; percent: number | null } | null; expiration: string };
  news?: { headline: string; link?: string; source?: string; count: number; tone: number };
  cot?: { market: string; commercialIndex: number };
  smartMoney?: string[];
}

interface ScanResult {
  updated: number;
  session: 'open' | 'extended' | 'closed';
  scanned: number;
  regime: { spyScore: number | null; spyWeek: number | null; vix: number | null; uptrendShare: number };
  setups: Setup[];
  filteredOut: { symbol: string }[];
  method: { stopAtr: number; targetAtr: number; maxHold: number };
}

const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const REFRESH_MS = 2 * 60 * 1000;

export function createSetupsPanel(onOpenChart: (ref: MarketRef) => void) {
  let showAll = false;
  let data: ScanResult | null = null;
  let loading = false;
  const body = h('div', { class: 'setups-body' }, h('div', { class: 'skeleton', style: 'height:150px' }));
  const regime = h('div', { class: 'setups-regime muted small' });
  const toggle = h('div', { class: 'segmented small' }, h('button', { class: 'active', 'data-all': '0', onclick: () => setAll(false) }, 'Best only'), h('button', { 'data-all': '1', onclick: () => setAll(true) }, 'All setups'));
  const refreshBtn = h('button', { class: 'icon-btn', title: 'Scan again now', 'aria-label': 'Scan again', onclick: () => load(true) }, icon('refresh', 18));
  const ai = insightButton(() => (data ? { topic: 'scanner', symbol: '', title: 'AI desk note: best plays right now', data: { regime: data.regime, session: data.session, setups: data.setups.slice(0, 8), filteredOut: data.filteredOut, method: data.method } } : null), 'AI desk note');
  const el = h(
    'section',
    { class: 'panel setups-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, icon('spark', 20), ' Best setups'), h('span', { class: 'spacer' }), toggle, ai.button, refreshBtn),
    regime,
    body,
    ai.panel,
    h('p', { class: 'muted tiny setups-note' }, 'From the helper’s background scanner (rescans every 10 minutes while the market is open). Signals and tested track records, not certainties or advice; size positions so a stop-out is affordable.'),
  );

  function setAll(v: boolean) {
    showAll = v;
    toggle.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('active', (b.dataset.all === '1') === v));
    render();
  }

  async function load(refresh = false) {
    if (loading || !helper.isConnected) return;
    loading = true;
    if (refresh || !data) body.replaceChildren(h('div', { class: 'muted pad' }, refresh ? 'Scanning the market…' : 'The scanner is reading about 30 stocks plus your watchlist on several timeframes. The first scan after the helper starts takes about a minute.'));
    try {
      const symbols = state.watchlist.filter((r) => r.provider === 'schwab').map((r) => r.symbol);
      data = await engineRequest<ScanResult>('scanner.results', { symbols, refresh }, 240000);
      render();
    } catch (err) {
      body.replaceChildren(h('div', { class: 'muted pad' }, (err as Error).message));
    } finally {
      loading = false;
    }
  }

  function render() {
    if (!data) return;
    const r = data.regime;
    regime.replaceChildren(
      h('span', {}, 'Market: ', h('b', { class: (r.spyScore ?? 0) > 0 ? 'up' : (r.spyScore ?? 0) < 0 ? 'down' : '' }, (r.spyScore ?? 0) >= 3 ? 'S&P 500 trending up' : (r.spyScore ?? 0) <= -3 ? 'S&P 500 trending down' : 'S&P 500 mixed')),
      h('span', {}, `S&P week ${pct(r.spyWeek)}`),
      r.vix != null ? h('span', {}, `VIX ${r.vix.toFixed(1)}${r.vix > 25 ? ' (fearful)' : r.vix < 15 ? ' (calm)' : ''}`) : '',
      h('span', {}, `${Math.round(r.uptrendShare * 100)}% of ${data.scanned} scanned stocks in uptrends`),
      h('span', {}, `updated ${timeAgo(data.updated)}`),
    );
    const list = data.setups.filter((s) => showAll || s.tier === 'A');
    const shown = showAll ? list : list.slice(0, 4);
    if (!shown.length) {
      body.replaceChildren(
        h(
          'div',
          { class: 'setups-empty' },
          h('b', {}, 'No A-grade setups right now.'),
          h('span', { class: 'muted small' }, ` Nothing passed every filter (tested profitable, reward ≥ 1.5× risk, several signals agreeing). Sitting out is a position. `),
          h('button', { class: 'btn small', onclick: () => setAll(true) }, `See ${data.setups.length} weaker setups`),
        ),
      );
      return;
    }
    body.replaceChildren(h('div', { class: 'setups-grid' }, ...shown.map(card)), data.filteredOut.length ? h('p', { class: 'muted tiny' }, `Filtered out ${data.filteredOut.length} signal${data.filteredOut.length === 1 ? '' : 's'} that lost money when tested on that stock: ${data.filteredOut.map((f) => f.symbol).join(', ')}.`) : '');
  }

  function card(s: Setup) {
    const long = s.direction > 0;
    const lv = s.levels;
    const bt = s.backtest;
    const details = h('div', { class: 'setup-details', hidden: true });
    const el = h(
      'div',
      { class: `setup-card ${long ? 'long' : 'short'}` },
      h(
        'div',
        { class: 'setup-top' },
        h('button', { class: 'setup-symbol', title: 'Open chart', onclick: () => onOpenChart({ provider: 'schwab', symbol: s.symbol }) }, s.symbol),
        h('span', { class: `setup-side ${long ? 'up' : 'down'}` }, long ? 'BUY' : 'SELL', s.tier ? h('i', { class: `tier tier-${s.tier}` }, s.tier) : ''),
        h('span', { class: 'spacer' }),
        h('span', { class: 'setup-price' }, formatPrice(s.price), h('span', { class: (s.day ?? 0) >= 0 ? 'up' : 'down' }, ` ${pct(s.day)}`)),
      ),
      h('div', { class: 'setup-why' }, s.summary),
      lv
        ? h(
            'div',
            { class: 'setup-levels' },
            h('span', {}, h('span', { class: 'muted' }, 'Entry '), h('b', {}, `${long ? '>' : '<'} ${formatPrice(lv.trigger)}`)),
            h('span', {}, h('span', { class: 'muted' }, 'Stop '), h('b', { class: 'down' }, formatPrice(lv.stop))),
            h('span', {}, h('span', { class: 'muted' }, 'Target '), h('b', { class: 'up' }, formatPrice(lv.target1))),
            h('span', {}, h('span', { class: 'muted' }, 'R:R '), h('b', {}, `${lv.riskReward.toFixed(1)}`)),
          )
        : '',
      bt && bt.trades ? h('div', { class: 'setup-track small' }, `Tested 3 yrs: won ${Math.round((bt.winRate ?? 0) * 100)}% of ${bt.trades} trades · ${pct(bt.expectancy, 2)} avg/trade · profit factor ${bt.profitFactor ?? '—'}`) : h('div', { class: 'setup-track small muted' }, 'Too few past signals to test'),
      s.bias && s.bias.direction !== 'flat' ? h('div', { class: 'setup-bias small' }, `Next 30 min: `, h('b', { class: s.bias.direction === 'up' ? 'up' : 'down' }, s.bias.direction === 'up' ? 'leaning up' : 'leaning down'), s.bias.winRate != null ? h('span', { class: 'muted' }, ` · right ${Math.round(s.bias.winRate * 100)}% of ${s.bias.samples} recent times${s.bias.winRate < 0.55 ? ' (no better than a coin flip lately, so give it little weight)' : ''}`) : '') : '',
      h('button', { class: 'setup-more', onclick: () => ((details.hidden = !details.hidden), details.childElementCount || details.append(...detailView(s))) }, 'Details'),
      details,
    );
    return el;
  }

  function detailView(s: Setup): (Node | string)[] {
    const lv = s.levels;
    const bt = s.backtest;
    return [
      h('h4', {}, 'Signals'),
      h('ul', { class: 'setup-reasons' }, ...s.reasons.map((r) => h('li', { class: r.points * s.direction > 0 ? 'up' : r.points * s.direction < 0 ? 'down' : 'muted' }, r.text))),
      lv
        ? h(
            'div',
            {},
            h('h4', {}, 'Plan'),
            h('p', { class: 'small' }, lv.entryNote, '.'),
            h('p', { class: 'small' }, `Stop ${formatPrice(lv.stop)} (${lv.stopNote}). Targets ${formatPrice(lv.target1)} (${lv.target1Note}) and ${formatPrice(lv.target2)} (${lv.target2Note}). ATR ${formatPrice(lv.atr)}.`),
            h('p', { class: 'small muted' }, lv.exitNote, '.'),
            h('h4', {}, 'Support & resistance'),
            h('div', { class: 'setup-sr small' }, h('div', {}, h('b', {}, 'Resistance'), ...lv.resistances.map((x) => h('div', {}, `${formatPrice(x.price)} · ${x.label}`))), h('div', {}, h('b', {}, 'Support'), ...lv.supports.map((x) => h('div', {}, `${formatPrice(x.price)} · ${x.label}`)))),
          )
        : '',
      s.smartMoney?.length || s.cot || s.options
        ? h(
            'div',
            {},
            h('h4', {}, 'Institutional flow'),
            ...(s.smartMoney ?? []).map((t) => h('p', { class: 'small' }, t)),
            s.cot ? h('p', { class: 'small muted' }, `Commercial hedgers in ${s.cot.market}: Williams COT ${s.cot.commercialIndex.toFixed(0)} (0-100, 26 weeks)`) : '',
            s.options ? h('p', { class: 'small muted' }, `Options put/call by premium ${s.options.putCallPremium.toFixed(2)}${s.options.expectedMove ? ` · expected move by ${s.options.expiration} ±${formatPrice(s.options.expectedMove.amount)}` : ''}`) : '',
          )
        : '',
      s.news ? h('div', {}, h('h4', {}, 'News'), h('p', { class: 'small' }, s.news.link ? h('a', { href: s.news.link, target: '_blank', rel: 'noopener' }, s.news.headline) : s.news.headline, h('span', { class: 'muted' }, ` · ${s.news.source ?? ''} · ${s.news.count} recent headline${s.news.count === 1 ? '' : 's'}, tone ${s.news.tone > 0 ? 'positive' : s.news.tone < 0 ? 'negative' : 'neutral'}`))) : '',
      bt && bt.trades ? h('div', {}, h('h4', {}, 'Track record'), h('p', { class: 'small' }, `${bt.trades} past signals: ${Math.round((bt.winRate ?? 0) * 100)}% winners, average ${bt.avgR?.toFixed(2) ?? '—'}R and ${pct(bt.expectancy, 2)} per trade, held ${bt.avgBars?.toFixed(0) ?? '—'} days on average, worst losing streak ${bt.maxLosingStreak}. Grade: ${bt.grade}.`), h('p', { class: 'small muted' }, bt.rules, '.')) : '',
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
