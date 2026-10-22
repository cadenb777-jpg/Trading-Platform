/** Flow: options activity, insider trades and futures positioning (Commitment of Traders). */
import { engineRequest } from '../data/schwab';
import { barList, compact, createLineChart, money, pageFrame, statCards } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';

interface Contract {
  type: 'call' | 'put';
  symbol: string;
  expiration: string;
  dte: number;
  strike: number;
  last: number;
  volume: number;
  oi: number;
  iv: number | null;
  delta: number | null;
  ratio: number | null;
  premium: number;
  side: string;
}

interface OptionsData {
  symbol: string;
  spot: number;
  expirations: string[];
  expiration: string;
  summary: { callVolume: number; putVolume: number; putCallVolume: number | null; callOi: number; putOi: number; putCallOi: number | null; maxPain: number | null; atmIv: number | null; netGex: number };
  strikes: { strike: number; callVolume: number; putVolume: number; callOi: number; putOi: number }[];
  gex: { strike: number; gex: number }[];
  unusual: Contract[];
}

interface InsiderTrade {
  date: string;
  insider: string;
  title: string;
  code: string;
  type: string;
  shares: number;
  price: number | null;
  value: number | null;
  acquired: boolean;
  ownedAfter: number | null;
  link: string;
}

interface CotData {
  name: string;
  rows: { date: string; openInterest: number; specNet: number; commNet: number; smallNet: number }[];
  latest: { date: string; openInterest: number; specNet: number; commNet: number; specLong: number; specShort: number };
  weeklyChange: { specNet: number; commNet: number };
  specIndex: number | null;
  commIndex: number | null;
}

type Tab = 'options' | 'insiders' | 'cot';

export function createFlowPage() {
  let tab: Tab = 'options';
  const symbolInput = h('input', { class: 'input symbol', value: 'SPY', 'aria-label': 'Symbol', spellcheck: false });
  const cotSelect = h('select', { class: 'input', 'aria-label': 'Futures market' });
  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    ...(['options', 'insiders', 'cot'] as Tab[]).map((t) =>
      h('button', { class: `tab${t === tab ? ' active' : ''}`, 'data-tab': t, onclick: () => setTab(t) }, t === 'options' ? 'Options flow' : t === 'insiders' ? 'Insider trades' : 'Futures positioning (COT)'),
    ),
  );
  const loadBtn = h('button', { class: 'btn primary', onclick: () => load() }, 'Load');
  const frame = pageFrame('Flow', 'Where the big money is positioned: options activity, company insiders and futures traders.', [tabs, symbolInput, cotSelect, loadBtn]);
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  cotSelect.addEventListener('change', () => load());

  function setTab(t: Tab) {
    tab = t;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    symbolInput.hidden = t === 'cot';
    cotSelect.hidden = t !== 'cot';
    load();
  }

  async function load(expiration?: string) {
    const symbol = symbolInput.value.trim().toUpperCase();
    frame.loading();
    try {
      if (tab === 'options') renderOptions(await engineRequest<OptionsData>('flow.options', { symbol, expiration }));
      else if (tab === 'insiders') renderInsiders(await engineRequest('flow.insiders', { symbol }));
      else renderCot(await engineRequest<CotData>('flow.cot', { code: cotSelect.value }));
    } catch (err) {
      frame.error(err);
    }
  }

  function renderOptions(d: OptionsData) {
    const s = d.summary;
    const expSelect = h('select', { class: 'input' }, ...d.expirations.map((e) => h('option', { value: e, selected: e === d.expiration }, e)));
    expSelect.addEventListener('change', () => load(expSelect.value));
    const nearSpot = d.strikes.reduce((best, r) => (Math.abs(r.strike - d.spot) < Math.abs(best - d.spot) ? r.strike : best), d.strikes[0]?.strike ?? 0);
    const pcTone = (v: number | null) => (v == null ? '' : v > 1 ? 'down' : 'up');
    frame.body.replaceChildren(
      statCards([
        { label: `${d.symbol} price`, value: formatPrice(d.spot) },
        { label: 'Put/call volume', value: s.putCallVolume?.toFixed(2) ?? '—', hint: 'Above 1 = more puts than calls traded today (bearish tilt)', tone: pcTone(s.putCallVolume) },
        { label: 'Put/call open interest', value: s.putCallOi?.toFixed(2) ?? '—', tone: pcTone(s.putCallOi) },
        { label: `Max pain (${d.expiration})`, value: s.maxPain != null ? formatPrice(s.maxPain) : '—', hint: 'Price where the most options expire worthless; prices often drift toward it near expiry' },
        { label: 'At-the-money IV', value: s.atmIv != null ? `${s.atmIv.toFixed(1)}%` : '—', hint: 'Implied volatility: how big a move options are pricing in' },
        { label: 'Net gamma exposure', value: money(s.netGex), hint: 'Positive: dealers tend to dampen moves. Negative: moves can accelerate.', tone: s.netGex >= 0 ? 'up' : 'down' },
      ]),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Unusual options activity'), h('span', { class: 'muted small' }, 'Contracts trading more today than their open interest, biggest premium first')),
        d.unusual.length
          ? h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'data-table' },
                h('thead', {}, h('tr', {}, ...['Contract', 'Expiry', 'DTE', 'Volume', 'Open int.', 'Vol/OI', 'Last', 'Premium', 'Fill', 'IV', 'Delta'].map((c) => h('th', {}, c)))),
                h(
                  'tbody',
                  {},
                  ...d.unusual.map((c) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, h('b', { class: c.type === 'call' ? 'up' : 'down' }, `${formatPrice(c.strike)} ${c.type === 'call' ? 'Call' : 'Put'}`)),
                      h('td', {}, c.expiration),
                      h('td', {}, String(c.dte)),
                      h('td', {}, compact(c.volume)),
                      h('td', {}, compact(c.oi)),
                      h('td', {}, c.ratio == null ? 'new' : `${c.ratio.toFixed(1)}×`),
                      h('td', {}, formatPrice(c.last)),
                      h('td', {}, money(c.premium)),
                      h('td', { class: 'muted' }, c.side || '—'),
                      h('td', {}, c.iv != null ? `${c.iv.toFixed(0)}%` : '—'),
                      h('td', {}, c.delta != null ? c.delta.toFixed(2) : '—'),
                    ),
                  ),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'No unusual activity right now (common outside market hours).'),
      ),
      h(
        'div',
        { class: 'two-col' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Open interest by strike'), h('span', { class: 'spacer' }), expSelect),
          h('p', { class: 'muted small' }, 'Puts to the left (red), calls to the right (green). Big clusters often act as support or resistance.'),
          oiBars(d, nearSpot),
        ),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Gamma exposure by strike')),
          h('p', { class: 'muted small' }, 'All expirations. The biggest bars are levels where dealer hedging is heaviest.'),
          barList(
            d.gex.filter((g) => Math.abs(g.strike - d.spot) / d.spot < 0.15).reverse().map((g) => ({ label: formatPrice(g.strike), value: g.gex, highlight: g.strike === nearSpot ? 'spot' : '' })),
            money,
          ),
        ),
      ),
    );
  }

  function oiBars(d: OptionsData, nearSpot: number) {
    const max = Math.max(1, ...d.strikes.map((r) => Math.max(r.callOi, r.putOi)));
    return h(
      'div',
      { class: 'oi-bars' },
      ...[...d.strikes].reverse().map((r) =>
        h(
          'div',
          { class: `oi-row${r.strike === nearSpot ? ' spot' : ''}${r.strike === d.summary.maxPain ? ' pain' : ''}` },
          h('span', { class: 'oi-side put' }, h('span', { class: 'oi-fill', style: `width:${(r.putOi / max) * 100}%` }), h('span', { class: 'oi-num' }, compact(r.putOi))),
          h('span', { class: 'oi-strike' }, formatPrice(r.strike)),
          h('span', { class: 'oi-side call' }, h('span', { class: 'oi-fill', style: `width:${(r.callOi / max) * 100}%` }), h('span', { class: 'oi-num' }, compact(r.callOi))),
        ),
      ),
    );
  }

  function renderInsiders(d: { symbol: string; company: string; trades: InsiderTrade[]; summary: { buyValue: number; sellValue: number; buyers: number; sellers: number; since: string } }) {
    frame.body.replaceChildren(
      statCards([
        { label: 'Company', value: d.company },
        { label: 'Open-market buys', value: money(d.summary.buyValue), hint: `${d.summary.buyers} insider(s)`, tone: d.summary.buyValue ? 'up' : '' },
        { label: 'Open-market sells', value: money(d.summary.sellValue), hint: `${d.summary.sellers} insider(s)`, tone: d.summary.sellValue ? 'down' : '' },
        { label: 'Covering filings since', value: d.summary.since || '—' },
      ]),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Recent insider transactions'), h('span', { class: 'muted small' }, 'From SEC Form 4 filings. Open-market buys (P) are the strongest signal; most sales are planned or for taxes.')),
        d.trades.length
          ? h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'data-table' },
                h('thead', {}, h('tr', {}, ...['Date', 'Insider', 'Role', 'Type', 'Shares', 'Price', 'Value', 'Owned after', ''].map((c) => h('th', {}, c)))),
                h(
                  'tbody',
                  {},
                  ...d.trades.map((t) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, t.date),
                      h('td', {}, t.insider),
                      h('td', { class: 'muted' }, t.title || '—'),
                      h('td', {}, h('b', { class: t.code === 'P' ? 'up' : t.code === 'S' ? 'down' : '' }, t.type)),
                      h('td', {}, `${t.acquired ? '+' : '−'}${compact(t.shares)}`),
                      h('td', {}, t.price ? formatPrice(t.price) : '—'),
                      h('td', {}, money(t.value)),
                      h('td', {}, compact(t.ownedAfter)),
                      h('td', {}, h('a', { href: t.link, target: '_blank', rel: 'noopener' }, 'Filing')),
                    ),
                  ),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'No recent Form 4 filings.'),
      ),
    );
  }

  function renderCot(d: CotData) {
    const chartBox = h('div', {});
    const idx = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)} / 100`);
    frame.body.replaceChildren(
      statCards([
        { label: 'Report date', value: d.latest.date },
        { label: 'Speculators net', value: compact(d.latest.specNet), hint: `Week change ${compact(d.weeklyChange.specNet)}`, tone: d.latest.specNet >= 0 ? 'up' : 'down' },
        { label: 'Speculator index (3y)', value: idx(d.specIndex), hint: 'Near 100 = most bullish in 3 years; near 0 = most bearish. Extremes often precede reversals.' },
        { label: 'Commercials (hedgers) net', value: compact(d.latest.commNet), hint: `Week change ${compact(d.weeklyChange.commNet)}`, tone: d.latest.commNet >= 0 ? 'up' : 'down' },
        { label: 'Open interest', value: compact(d.latest.openInterest) },
      ]),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, `${d.name}: net positions (contracts)`), h('span', { class: 'muted small' }, 'Weekly CFTC report, released Fridays for the prior Tuesday')),
        chartBox,
      ),
    );
    const chart = createLineChart(chartBox, { height: 360 });
    chart.set([
      { name: 'Speculators (large)', color: '#2962ff', data: d.rows.map((r) => ({ time: r.date, value: r.specNet })) },
      { name: 'Commercials (hedgers)', color: '#ff9800', data: d.rows.map((r) => ({ time: r.date, value: r.commNet })) },
      { name: 'Small traders', color: '#787b86', width: 1, data: d.rows.map((r) => ({ time: r.date, value: r.smallNet })) },
    ]);
  }

  let started = false;
  return {
    el: frame.el,
    async start() {
      if (started) return;
      started = true;
      cotSelect.hidden = true;
      try {
        const { markets } = await engineRequest<{ markets: { code: string; name: string }[] }>('flow.cot_markets');
        cotSelect.replaceChildren(...markets.map((m) => h('option', { value: m.code }, m.name)));
      } catch {
        // Filled in once the helper is running.
      }
      load();
    },
  };
}
