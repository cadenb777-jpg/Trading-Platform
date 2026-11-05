/**
 * Calendar extras: prediction-market odds (Polymarket + Kalshi, read only) next to events and in their own panel,
 * and an earnings calendar from Finnhub when its free key is saved. Odds are crowd prices, not advice; the
 * platform never bets or trades on these markets.
 */
import { engineRequest, worldAvailable } from '../data/schwab';
import { filterMarkets, fmtVolume, oddsSummary, pct, type EventOdds, type FedGroup, type OddsCategory, type PredictionMarket, type PredictionsReply } from '../macro/odds';
import { NASDAQ_100 } from '../ui/command';
import { asOfStamp } from '../ui/dataHealth';
import { h, timeAgo } from '../ui/dom';

let cache: { at: number; value: PredictionsReply } | null = null;

/** The helper's prediction markets (kept a minute here; the helper caches 5 minutes). Null on older helpers. */
export async function getPredictions(force = false): Promise<PredictionsReply | null> {
  if (!(await worldAvailable())) return null;
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = await engineRequest<PredictionsReply>('predictions.markets', { limit: 500 }, 45000);
  cache = { at: Date.now(), value };
  return value;
}

const isoAgo = (iso: string) => (iso ? timeAgo(Date.parse(iso) / 1000) : '');

/** The Odds cell of a calendar row. */
export function oddsCell(o: EventOdds): HTMLElement {
  const text = oddsSummary(o);
  const title = !o
    ? 'No matching prediction market'
    : o.kind === 'fed'
      ? o.groups.map((g) => `${g.source}: cut ${pct(g.odds.cut)}, hold ${pct(g.odds.hold)}, hike ${pct(g.odds.hike)}${g.updated ? ` (updated ${isoAgo(g.updated)})` : ''}`).join('\n')
      : o.markets.map((m) => `${m.source}: ${m.question} ${pct(m.yes)}`).join('\n');
  return h('span', { class: `cal-odds${o ? '' : ' muted'}`, 'data-label': 'Odds', title }, text || '—');
}

/** Cut / hold / hike as a stacked bar with labels. */
export function fedBar(g: FedGroup): HTMLElement {
  const parts = (['cut', 'hold', 'hike'] as const).filter((k) => g.odds[k] >= 0.005);
  return h(
    'div',
    { class: 'po-fed' },
    h('div', { class: 'po-bar', role: 'img', 'aria-label': parts.map((k) => `${k} ${pct(g.odds[k])}`).join(', ') },
      ...parts.map((k) => h('span', { class: `po-seg po-${k}`, style: `width:${(g.odds[k] * 100).toFixed(1)}%` }))),
    h('div', { class: 'po-legend small' }, ...parts.map((k) => h('span', { class: `po-key po-${k}` }, h('i'), `${k[0].toUpperCase()}${k.slice(1)} ${pct(g.odds[k])}`))),
  );
}

/** The prediction-market part of an event's details window. */
export function oddsDetails(o: EventOdds): HTMLElement | null {
  if (!o) return null;
  const items =
    o.kind === 'fed'
      ? o.groups.map((g) =>
          h('div', { class: 'po-item' },
            h('div', { class: 'small' }, h('b', {}, g.source), ` · ${g.title}`, h('span', { class: 'muted' }, ` · ${fmtVolume(g.volume, g.source)}${g.updated ? ` · updated ${isoAgo(g.updated)}` : ''} · `), h('a', { href: g.url, target: '_blank', rel: 'noopener' }, 'Open market ↗')),
            fedBar(g)))
      : o.markets.map((m) =>
          h('div', { class: 'po-item small' }, h('b', {}, pct(m.yes)), ` ${m.question} `,
            h('span', { class: 'muted' }, `· ${m.source} · ${fmtVolume(m.volume, m.source)}${m.updated ? ` · updated ${isoAgo(m.updated)}` : ''} · `),
            h('a', { href: m.url, target: '_blank', rel: 'noopener' }, 'Open ↗')));
  return h('div', {}, h('div', { class: 'summary-head' }, 'Prediction markets'), ...items,
    h('p', { class: 'muted tiny' }, 'Crowd prices from Polymarket and Kalshi (public data, read only). A price of 62¢ means the crowd sees about a 62% chance. Not advice.'));
}

/** The Prediction Markets panel with category / source / search filters. */
export function createMarketsPanel() {
  let data: PredictionsReply | null = null;
  let category: OddsCategory | 'all' = 'fed';
  let source = 'all';
  let query = '';
  const stamp = asOfStamp(null, { source: 'Polymarket · Kalshi', refreshMs: 15 * 60_000 });
  const fed = h('div', { class: 'po-meetings' });
  const list = h('div', { class: 'po-list' });
  const note = h('p', { class: 'small po-note' });
  const cats: [OddsCategory | 'all', string][] = [['fed', 'Fed'], ['macro', 'Macro'], ['politics', 'Politics'], ['all', 'All']];
  const catButtons = cats.map(([c, label]) => h('button', { class: 'chip', 'data-cat': c, onclick: () => ((category = c), render()) }, label));
  const sourceSelect = h('select', { class: 'input', 'aria-label': 'Market source' }, h('option', { value: 'all' }, 'Both sources'), h('option', { value: 'Polymarket' }, 'Polymarket'), h('option', { value: 'Kalshi' }, 'Kalshi'));
  sourceSelect.addEventListener('change', () => ((source = sourceSelect.value), render()));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search questions', 'aria-label': 'Search prediction markets' });
  search.addEventListener('input', () => ((query = search.value), render()));
  const el = h(
    'section',
    { class: 'panel po-panel', id: 'prediction-markets' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Prediction markets'), stamp.el),
    h('p', { class: 'muted small' }, 'What traders on Polymarket and Kalshi are paying for each outcome, read as the crowd’s odds. Read only: the platform never bets or trades.'),
    h('div', { class: 'po-filters' }, ...catButtons, sourceSelect, search),
    fed,
    list,
    note,
  );

  function marketRow(m: PredictionMarket) {
    return h(
      'a',
      { class: 'po-row', href: m.url, target: '_blank', rel: 'noopener', title: `${m.event}\nCloses ${m.closes ? m.closes.slice(0, 10) : 'not given'}` },
      h('b', { class: 'po-yes' }, pct(m.yes)),
      h('span', { class: 'po-q' }, m.question),
      h('span', { class: 'muted small po-meta' }, `${m.source} · ${fmtVolume(m.volume, m.source)}${m.updated ? ` · ${isoAgo(m.updated)}` : ''}`),
    );
  }

  function render() {
    catButtons.forEach((b) => {
      b.classList.toggle('on', b.dataset.cat === category);
      b.setAttribute('aria-pressed', String(b.dataset.cat === category));
    });
    if (!data) return;
    const groups = data.fed.filter((g) => source === 'all' || g.source === source).slice(0, 4);
    fed.replaceChildren(
      ...(category === 'fed' || category === 'all'
        ? groups.map((g) =>
            h('a', { class: 'po-meeting', href: g.url, target: '_blank', rel: 'noopener' },
              h('div', { class: 'small' }, h('b', {}, `FOMC ${g.meeting ? new Date(`${g.meeting}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`), h('span', { class: 'muted' }, ` · ${g.source} · ${fmtVolume(g.volume, g.source)}`)),
              fedBar(g)))
        : []),
    );
    const shown = filterMarkets(data.markets, { category, source, query });
    list.replaceChildren(...shown.slice(0, 40).map(marketRow));
    if (!shown.length) list.append(h('p', { class: 'muted small pad' }, 'No open markets match these filters.'));
    const errs = Object.entries(data.errors);
    note.className = `small po-note${errs.length ? ' warn' : ' muted'}`;
    note.textContent = [shown.length > 40 ? `Showing the 40 busiest of ${shown.length}.` : '', ...errs.map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' ');
  }

  return {
    el,
    set(reply: PredictionsReply | null, error?: string) {
      data = reply;
      if (reply) stamp.set(reply.fetched);
      if (!reply) {
        fed.replaceChildren();
        list.replaceChildren(h('p', { class: 'muted small pad' }, error ?? 'Prediction markets need the updated helper (version 44 or newer).'));
      }
      render();
    },
  };
}

interface EarningsEvent {
  symbol: string;
  date: string;
  hour: string;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
}

/** Upcoming earnings from Finnhub (free key). Nasdaq-100 by default; "All companies" shows the rest. */
export function createEarningsPanel() {
  let all = false;
  let events: EarningsEvent[] = [];
  const list = h('div', { class: 'po-list' });
  const stamp = asOfStamp(null, { source: 'Finnhub', refreshMs: 0 });
  const toggle = h('button', { class: 'chip', 'aria-pressed': 'false', onclick: () => ((all = !all), render()) }, 'All companies');
  const el = h('section', { class: 'panel po-panel', id: 'earnings-calendar' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Earnings (next two weeks)'), stamp.el, toggle), list);

  function render() {
    toggle.classList.toggle('on', all);
    toggle.setAttribute('aria-pressed', String(all));
    const shown = all ? events : events.filter((e) => NASDAQ_100.includes(e.symbol));
    list.replaceChildren(
      ...shown.slice(0, 60).map((e) =>
        h('div', { class: 'po-row' },
          h('b', { class: 'po-yes' }, e.symbol),
          h('span', { class: 'po-q' }, `${new Date(`${e.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${e.hour ? `, ${e.hour}` : ''}`),
          h('span', { class: 'muted small po-meta' }, e.epsEstimate != null ? `EPS est. ${e.epsEstimate.toFixed(2)}${e.epsActual != null ? ` · actual ${e.epsActual.toFixed(2)}` : ''}` : ''))),
    );
    if (!shown.length) list.append(h('p', { class: 'muted small pad' }, all ? 'No earnings dates in the next two weeks.' : 'No Nasdaq-100 earnings in the next two weeks. Try "All companies".'));
  }

  async function refresh() {
    if (!(await worldAvailable())) {
      el.hidden = true;
      return;
    }
    try {
      const r = await engineRequest<{ needsKey?: boolean; note?: string; signup?: string; events: EarningsEvent[]; fetched?: number }>('finnhub.earnings', { days: 14 }, 45000);
      el.hidden = false;
      if (r.needsKey) {
        toggle.hidden = true;
        list.replaceChildren(
          h('p', { class: 'muted small' }, r.note ?? ''),
          h('div', { class: 'ap-controls' },
            r.signup ? h('a', { class: 'btn', href: r.signup, target: '_blank', rel: 'noopener' }, 'Get a free key ↗') : '',
            h('button', { class: 'btn primary', onclick: () => void import('../ui/settings').then((m) => m.openSettings('data')) }, 'Add it in Settings')),
        );
        return;
      }
      toggle.hidden = false;
      events = r.events;
      stamp.set(r.fetched ?? null);
      render();
    } catch (err) {
      el.hidden = false;
      list.replaceChildren(h('p', { class: 'macro-error small' }, (err as Error).message));
    }
  }
  window.addEventListener('tp:data-connection', (e) => (e as CustomEvent).detail?.id === 'finnhub' && void refresh());
  return { el, refresh };
}
