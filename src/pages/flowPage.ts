/** Flow: options activity, insider trades and futures positioning (Commitment of Traders). */
import { insightButton, type InsightRequest } from '../ai/insight';
import { engineRequest } from '../data/schwab';
import { barList, compact, createLineChart, dataTable, money, pageFrame, pct, statCards } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { withTableTools } from '../ui/tableTools';
import { xySvg } from '../ui/xyChart';
import { tickerAttr } from '../ui/tickerCard';
import { asOfStamp } from '../ui/dataHealth';

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

/** Put/call figures for a group of contracts (all, one expiration, or a days-to-expiry bucket). */
interface FlowStats {
  callVolume: number;
  putVolume: number;
  putCallVolume: number | null;
  callOi: number;
  putOi: number;
  putCallOi: number | null;
  callPremium?: number;
  putPremium?: number;
  putCallPremium?: number | null;
  otmCallVolume?: number;
  otmPutVolume?: number;
  putCallOtm?: number | null;
  contracts?: number;
}

interface ExpectedMove {
  strike: number;
  amount: number;
  percent: number | null;
}

interface OptionsData {
  symbol: string;
  spot: number;
  expirations: string[];
  expiration: string;
  summary: FlowStats & { maxPain: number | null; atmIv: number | null; netGex: number; expectedMove?: ExpectedMove | null; strikesPerExpiration?: number };
  byExpiration?: (FlowStats & { expiration: string; dte: number; maxPain: number | null; atmIv: number | null; expectedMove: ExpectedMove | null })[];
  byDte?: (FlowStats & { label: string })[];
  strikes: { strike: number; callVolume: number; putVolume: number; callOi: number; putOi: number; callIv?: number | null; putIv?: number | null }[];
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

interface CotSymbolData {
  symbol: string;
  code: string;
  market: string;
  reason: string;
  rows: { date: string; specNet: number; commNet: number; smallNet: number; openInterest: number; specIndex: number | null; commIndex: number | null }[];
}

interface ShortVolumeData {
  symbol: string;
  rows: { date: string; short: number; total: number; ratio: number }[];
  latest: { date: string; ratio: number };
  avg5: number;
  avgAll: number;
}

interface PositioningData {
  symbol: string;
  shortVolume: ShortVolumeData | null;
  cot: CotSymbolData | null;
  options: { spot: number; expiration: string; summary: OptionsData['summary']; unusual: Contract[]; topStrikes: OptionsData['strikes'] } | null;
  insiders: { company: string; summary: { buyValue: number; sellValue: number; buyers: number; sellers: number; since: string }; trades: InsiderTrade[] } | null;
  errors: Record<string, string>;
}

type Tab = 'positioning' | 'options' | 'insiders' | 'cot';
const TAB_LABELS: Record<Tab, string> = { positioning: 'Stock positioning', options: 'Options flow', insiders: 'Insider trades', cot: 'Futures positioning (COT)' };

const ratioText = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const pcTone = (v: number | null | undefined) => (v == null ? '' : v > 1 ? 'down' : v < 0.7 ? 'up' : '');
/** A plain-language reading of a put/call ratio for a single stock (index products normally run higher). */
const pcReading = (v: number | null | undefined) => (v == null ? 'No volume yet' : v < 0.5 ? 'Strongly bullish' : v < 0.7 ? 'Bullish lean' : v <= 1 ? 'Neutral' : v <= 1.5 ? 'Bearish lean' : 'Strongly bearish');

export function createFlowPage() {
  let tab: Tab = 'positioning';
  /** The data on screen, handed to the AI analysis button. */
  let lastInsight: InsightRequest | null = null;
  const symbolInput = h('input', { class: 'input symbol', value: 'NVDA', 'aria-label': 'Symbol', spellcheck: false });
  const cotSelect = h('select', { class: 'input', 'aria-label': 'Futures market' }, h('option', { value: '' }, 'Use the stock’s related market'));
  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    ...(Object.keys(TAB_LABELS) as Tab[]).map((t) => h('button', { class: `tab${t === tab ? ' active' : ''}`, 'data-tab': t, onclick: () => setTab(t) }, TAB_LABELS[t])),
  );
  const loadBtn = h('button', { class: 'btn primary', onclick: () => load() }, 'Load');
  const stamp = h('span', { class: 'muted small' });
  const ai = insightButton(() => lastInsight);
  const frame = pageFrame('Flow', 'Where the big money is positioned: short selling, options, company insiders and futures traders.', [tabs, symbolInput, cotSelect, loadBtn, ai.button, stamp]);
  symbolInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  cotSelect.addEventListener('change', () => load());

  function setTab(t: Tab) {
    tab = t;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    cotSelect.hidden = t !== 'cot';
    load();
  }

  let request = 0;
  /** The options expiration the user picked, kept across automatic refreshes. */
  let chosenExpiration: string | undefined;
  async function load(expiration?: string, quiet = false) {
    if (expiration !== undefined || !quiet) chosenExpiration = expiration;
    expiration = chosenExpiration;
    const symbol = symbolInput.value.trim().toUpperCase();
    const mine = ++request;
    if (!quiet) {
      frame.loading(tab === 'positioning' ? `Gathering short selling, options, insider and futures data for ${symbol}…` : 'Loading…');
      ai.panel.hidden = true;
      lastInsight = null;
    }
    try {
      if (tab === 'options') {
        const d = await engineRequest<OptionsData>('flow.options', { symbol, expiration });
        if (mine !== request) return;
        renderOptions(d);
        lastInsight = { topic: 'options', symbol: d.symbol, title: `Options flow read: ${d.symbol}`, data: { ...d, strikes: d.strikes, gex: d.gex.filter((g) => Math.abs(g.strike - d.spot) / d.spot < 0.15) } };
      } else if (tab === 'insiders') {
        const d = await engineRequest<Parameters<typeof renderInsiders>[0]>('flow.insiders', { symbol });
        if (mine !== request) return;
        renderInsiders(d);
        lastInsight = { topic: 'insiders', symbol: d.symbol, title: `Insider activity read: ${d.symbol}`, data: { ...d, trades: d.trades.slice(0, 40) } };
      } else if (tab === 'cot') {
        if (cotSelect.value) {
          const d = await engineRequest<CotData>('flow.cot', { code: cotSelect.value });
          if (mine !== request) return;
          renderCot(d);
          lastInsight = { topic: 'cot', symbol: d.name, market: d.name, title: `Positioning read: ${d.name}`, data: { latest: d.latest, weeklyChange: d.weeklyChange, specIndex: d.specIndex, commIndex: d.commIndex, recent: d.rows.slice(-26) } };
        } else {
          const d = await engineRequest<CotSymbolData>('flow.cot_for_symbol', { symbol });
          if (mine !== request) return;
          renderCotForSymbol(d);
          lastInsight = { topic: 'cot', symbol: d.symbol, market: d.market, title: `Futures positioning read: ${d.symbol} (${d.market})`, data: { reason: d.reason, recent: d.rows.slice(-26) } };
        }
      } else {
        const d = await engineRequest<PositioningData>('flow.positioning', { symbol }, 90000);
        if (mine !== request) return;
        renderPositioning(d);
        lastInsight = { topic: 'positioning', symbol: d.symbol, title: `Positioning read: ${d.symbol}`, data: { ...d, cot: d.cot && { market: d.cot.market, reason: d.cot.reason, recent: d.cot.rows.slice(-12) } } };
      }
      frame.body.append(ai.panel);
      stamp.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    } catch (err) {
      if (mine === request && !quiet) frame.error(err);
    }
  }

  function renderOptions(d: OptionsData) {
    const s = d.summary;
    const expSelect = h('select', { class: 'input' }, ...d.expirations.map((e) => h('option', { value: e, selected: e === d.expiration }, e)));
    expSelect.addEventListener('change', () => load(expSelect.value));
    const nearSpot = d.strikes.reduce((best, r) => (Math.abs(r.strike - d.spot) < Math.abs(best - d.spot) ? r.strike : best), d.strikes[0]?.strike ?? 0);
    const noVolume = s.callVolume + s.putVolume === 0;
    const em = s.expectedMove;
    frame.body.replaceChildren(
      noVolume ? h('div', { class: 'ap-note' }, 'No options have traded yet today (Schwab resets volume each morning), so volume-based ratios are blank. Open interest is from the last session.') : '',
      statCards([
        { label: h('span', tickerAttr(d.symbol), `${d.symbol} price`), value: formatPrice(d.spot) },
        { label: 'Put/call volume', value: ratioText(s.putCallVolume), hint: `${compact(s.putVolume)} puts vs ${compact(s.callVolume)} calls traded today · ${pcReading(s.putCallVolume)}`, tone: pcTone(s.putCallVolume) },
        { label: 'Put/call by premium ($)', value: ratioText(s.putCallPremium), hint: s.callPremium != null ? `${money(s.putPremium ?? 0)} in puts vs ${money(s.callPremium)} in calls · money-weighted, so big trades count more` : '', tone: pcTone(s.putCallPremium) },
        { label: 'Put/call, out-of-the-money', value: ratioText(s.putCallOtm), hint: 'Bets on a move: OTM puts (downside) vs OTM calls (upside)', tone: pcTone(s.putCallOtm) },
        { label: 'Put/call open interest', value: ratioText(s.putCallOi), hint: `${compact(s.putOi)} puts vs ${compact(s.callOi)} calls held open · slower-moving positioning`, tone: pcTone(s.putCallOi) },
        { label: `Expected move (${d.expiration})`, value: em ? `±${formatPrice(em.amount)}` : '—', hint: em && em.percent != null ? `±${(em.percent * 100).toFixed(1)}% · range ${formatPrice(d.spot - em.amount)} – ${formatPrice(d.spot + em.amount)} (at-the-money straddle)` : 'From the at-the-money straddle price' },
        { label: `Max pain (${d.expiration})`, value: s.maxPain != null ? formatPrice(s.maxPain) : '—', hint: 'Price where the most options expire worthless; prices often drift toward it near expiry' },
        { label: 'At-the-money IV', value: s.atmIv != null ? `${s.atmIv.toFixed(1)}%` : '—', hint: 'Implied volatility: how big a move options are pricing in (yearly)' },
        { label: 'Net gamma exposure', value: money(s.netGex), hint: 'Positive: dealers tend to dampen moves. Negative: moves can accelerate.', tone: s.netGex >= 0 ? 'up' : 'down' },
      ]),
      d.byDte?.length || d.byExpiration?.length
        ? h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, 'Put/call breakdown'), h('span', { class: 'muted small' }, `Covers the ${s.strikesPerExpiration ?? 'nearest'} strikes around the price for every expiration${s.contracts ? ` (${s.contracts.toLocaleString('en-US')} contracts)` : ''}. For single stocks, below ~0.7 leans bullish and above ~1.0 leans bearish; index ETFs normally run higher because puts are used as insurance.`)),
            d.byDte?.length ? h('div', {}, h('h4', {}, 'By time to expiry'), flowTable(d.byDte.map((b) => ({ label: b.label, stats: b })))) : null,
            d.byExpiration?.length
              ? h(
                  'div',
                  {},
                  h('h4', {}, 'By expiration'),
                  flowTable(
                    d.byExpiration.slice(0, 16).map((e) => ({ label: `${e.expiration} (${e.dte}d)`, stats: e, extra: [e.expectedMove ? `±${formatPrice(e.expectedMove.amount)}` : '—', e.maxPain != null ? formatPrice(e.maxPain) : '—', e.atmIv != null ? `${e.atmIv.toFixed(1)}%` : '—'] })),
                    ['Expected move', 'Max pain', 'ATM IV'],
                  ),
                )
              : null,
          )
        : '',
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Unusual options activity'), h('span', { class: 'muted small' }, 'Contracts trading more today than their open interest, biggest premium first')),
        d.unusual.length
          ? h(
              'div',
              { class: 'table-wrap' },
              withTableTools(h(
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
              ), { id: 'flow:unusual' }),
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
          h('p', { class: 'muted small' }, 'Puts to the left (red), calls to the right (green). Big clusters often act as support or resistance. Hover a row for exact numbers.'),
          oiBars(d, nearSpot),
        ),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, `Volume by strike (${d.expiration})`)),
          h('p', { class: 'muted small' }, 'Where today’s trading is concentrated. Hover a row for exact numbers.'),
          volumeBars(d, nearSpot),
        ),
      ),
      h(
        'div',
        { class: 'two-col' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, `Volatility smile (${d.expiration})`)),
          h('p', { class: 'muted small' }, 'Implied volatility by strike. A steeper left side (puts) means traders pay up for crash protection.'),
          ivSmile(d),
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

  /** Put/call table rows: volume, open interest, premium and OTM ratios with a plain-language reading. */
  function flowTable(rows: { label: string; stats: FlowStats; extra?: string[] }[], extraHead: string[] = []) {
    return dataTable(
      ['', 'Call vol', 'Put vol', 'P/C vol', 'P/C premium', 'P/C OTM', 'Call OI', 'Put OI', 'P/C OI', 'Reading', ...extraHead],
      rows.map(({ label, stats: x, extra = [] }) => [
        { v: label, cls: 'label' },
        compact(x.callVolume),
        compact(x.putVolume),
        { v: ratioText(x.putCallVolume), cls: pcTone(x.putCallVolume) },
        { v: ratioText(x.putCallPremium ?? null), cls: pcTone(x.putCallPremium ?? null) },
        { v: ratioText(x.putCallOtm ?? null), cls: pcTone(x.putCallOtm ?? null) },
        compact(x.callOi),
        compact(x.putOi),
        { v: ratioText(x.putCallOi), cls: pcTone(x.putCallOi) },
        { v: pcReading(x.putCallPremium ?? x.putCallVolume), cls: pcTone(x.putCallPremium ?? x.putCallVolume) },
        ...extra,
      ]),
    );
  }

  function volumeBars(d: OptionsData, nearSpot: number) {
    const rows = d.strikes.filter((r) => Math.abs(r.strike - d.spot) / d.spot < 0.2);
    const max = Math.max(1, ...rows.map((r) => Math.max(r.callVolume, r.putVolume)));
    return h(
      'div',
      { class: 'oi-bars' },
      ...[...rows].reverse().map((r) =>
        h(
          'div',
          { class: `oi-row${r.strike === nearSpot ? ' spot' : ''}`, title: `Strike ${formatPrice(r.strike)}: ${r.putVolume.toLocaleString('en-US')} puts, ${r.callVolume.toLocaleString('en-US')} calls traded today` },
          h('span', { class: 'oi-side put' }, h('span', { class: 'oi-fill', style: `width:${(r.putVolume / max) * 100}%` }), h('span', { class: 'oi-num' }, compact(r.putVolume))),
          h('span', { class: 'oi-strike' }, formatPrice(r.strike)),
          h('span', { class: 'oi-side call' }, h('span', { class: 'oi-fill', style: `width:${(r.callVolume / max) * 100}%` }), h('span', { class: 'oi-num' }, compact(r.callVolume))),
        ),
      ),
    );
  }

  /** IV by strike as an SVG line chart (calls and puts), with the current price marked and hover values. */
  function ivSmile(d: OptionsData) {
    const pts = d.strikes.filter((r) => Math.abs(r.strike - d.spot) / d.spot < 0.25 && (r.callIv || r.putIv));
    if (pts.length < 3) return h('p', { class: 'muted' }, 'Not enough implied-volatility data for this expiration.');
    return xySvg(
      [
        { name: 'Calls', color: '#26a69a', points: pts.filter((r) => r.callIv).map((r) => ({ x: r.strike, y: r.callIv! })) },
        { name: 'Puts', color: '#ef5350', points: pts.filter((r) => r.putIv).map((r) => ({ x: r.strike, y: r.putIv! })) },
      ],
      { x: (v) => formatPrice(v), y: (v) => `${v.toFixed(1)}%`, marker: { x: d.spot, label: 'Price' }, xName: 'Strike' },
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
          { class: `oi-row${r.strike === nearSpot ? ' spot' : ''}${r.strike === d.summary.maxPain ? ' pain' : ''}`, title: `Strike ${formatPrice(r.strike)}: ${r.putOi.toLocaleString('en-US')} puts, ${r.callOi.toLocaleString('en-US')} calls open${r.strike === d.summary.maxPain ? ' · max pain' : ''}` },
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
              withTableTools(h(
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
              ), { id: 'flow:insiders' }),
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

  function renderCotForSymbol(d: CotSymbolData) {
    const latest = d.rows[d.rows.length - 1];
    const prev = d.rows[d.rows.length - 2] ?? latest;
    const idx = (v: number | null) => (v == null ? '—' : `${v.toFixed(0)} / 100`);
    const chartBox = h('div', {});
    const netBox = h('div', {});
    frame.body.replaceChildren(
      h('div', { class: 'callout' }, h('b', {}, h('span', tickerAttr(d.symbol), d.symbol), ` → ${d.market} futures. `), d.reason, ' The CFTC only publishes positioning for futures, so this is the closest view of how big traders are positioned for this stock’s market.'),
      statCards([
        { label: 'Report date', value: latest.date },
        { label: 'Speculator index (3y)', value: idx(latest.specIndex), hint: 'Near 100 = most bullish in 3 years; near 0 = most bearish. Extremes often come before reversals.', tone: (latest.specIndex ?? 50) >= 50 ? 'up' : 'down' },
        { label: 'Hedger index (3y)', value: idx(latest.commIndex), hint: 'Commercial hedgers usually trade against the trend; their extremes are often the better signal.' },
        { label: 'Speculators net', value: compact(latest.specNet), hint: `Week change ${compact(latest.specNet - prev.specNet)}`, tone: latest.specNet >= 0 ? 'up' : 'down' },
        { label: 'Open interest', value: compact(latest.openInterest) },
      ]),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Positioning index (0-100, 3-year range)'), asOfStamp('cftc').set(latest.date, { prefix: 'report', source: 'CFTC (weekly)' }).el, h('span', { class: 'muted small' }, 'Above 80 or below 20 = crowded')), chartBox),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Net positions (contracts)')), netBox),
    );
    const recent = d.rows.slice(-260);
    createLineChart(chartBox, { height: 280, format: (v) => v.toFixed(0) }).set([
      { name: 'Speculators', color: '#2962ff', data: recent.map((r) => ({ time: r.date, value: r.specIndex ?? NaN })) },
      { name: 'Hedgers', color: '#ff9800', data: recent.map((r) => ({ time: r.date, value: r.commIndex ?? NaN })) },
    ]);
    createLineChart(netBox, { height: 260 }).set([
      { name: 'Speculators (large)', color: '#2962ff', data: recent.map((r) => ({ time: r.date, value: r.specNet })) },
      { name: 'Commercials (hedgers)', color: '#ff9800', data: recent.map((r) => ({ time: r.date, value: r.commNet })) },
      { name: 'Small traders', color: '#787b86', width: 1, data: recent.map((r) => ({ time: r.date, value: r.smallNet })) },
    ]);
  }

  function renderPositioning(d: PositioningData) {
    const sv = d.shortVolume;
    const cot = d.cot;
    const lastCot = cot?.rows[cot.rows.length - 1];
    const o = d.options;
    const ins = d.insiders;
    const shortBox = h('div', {});
    const cotBox = h('div', {});
    const unavailable = (key: string) => h('p', { class: 'muted small' }, `Unavailable: ${d.errors[key] ?? 'no data'}`);
    const insiderNet = ins ? ins.summary.buyValue - ins.summary.sellValue : null;
    frame.body.replaceChildren(
      statCards([
        { label: 'Short volume today', value: sv ? pct(sv.latest.ratio, 1).replace('+', '') : '—', hint: sv ? `${sv.latest.date}. Share of the day’s volume that was short sales (FINRA). Around 40-50% is normal.` : d.errors.shortVolume, tone: sv ? (sv.latest.ratio > sv.avgAll + 0.05 ? 'down' : sv.latest.ratio < sv.avgAll - 0.05 ? 'up' : '') : '' },
        { label: 'Short volume 5-day vs 40-day', value: sv ? `${(sv.avg5 * 100).toFixed(1)}% vs ${(sv.avgAll * 100).toFixed(1)}%` : '—', hint: 'Rising short volume can mean more selling pressure (or market makers hedging heavy buying).', tone: sv ? (sv.avg5 > sv.avgAll ? 'down' : 'up') : '' },
        { label: `Futures speculators (${cot?.market ?? 'related market'})`, value: lastCot?.specIndex != null ? `${lastCot.specIndex.toFixed(0)} / 100` : '—', hint: cot?.reason ?? d.errors.cot, tone: lastCot?.specIndex != null ? (lastCot.specIndex >= 50 ? 'up' : 'down') : '' },
        { label: 'Options put/call (volume)', value: o?.summary.putCallVolume?.toFixed(2) ?? '—', hint: 'Above 1 = more puts than calls traded today', tone: o?.summary.putCallVolume != null ? (o.summary.putCallVolume > 1 ? 'down' : 'up') : '' },
        { label: 'Max pain', value: o?.summary.maxPain != null ? formatPrice(o.summary.maxPain) : '—', hint: o ? `Expiry ${o.expiration}; price ${formatPrice(o.spot)}` : d.errors.options },
        { label: 'Insider open-market buys − sells', value: insiderNet != null ? money(insiderNet) : '—', hint: ins ? `${ins.summary.buyers} buyer(s), ${ins.summary.sellers} seller(s) since ${ins.summary.since}` : d.errors.insiders, tone: insiderNet != null ? (insiderNet > 0 ? 'up' : insiderNet < 0 ? 'down' : '') : '' },
      ]),
      h(
        'div',
        { class: 'two-col' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Daily short-sale volume'), h('span', { class: 'muted small' }, 'FINRA, % of volume')), sv ? shortBox : unavailable('shortVolume')),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, cot ? `Futures positioning: ${cot.market}` : 'Futures positioning'), h('span', { class: 'muted small' }, '3-year index, 0-100')), cot ? cotBox : unavailable('cot')),
      ),
      h(
        'div',
        { class: 'two-col' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Biggest options strikes'), o ? h('span', { class: 'muted small' }, `Expiry ${o.expiration}`) : null),
          o ? dataTable(['Strike', 'Call OI', 'Put OI', 'Call vol', 'Put vol'], o.topStrikes.map((r) => [h('b', {}, formatPrice(r.strike)), compact(r.callOi), compact(r.putOi), compact(r.callVolume), compact(r.putVolume)])) : unavailable('options'),
        ),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Latest insider trades')),
          ins ? (ins.trades.length ? dataTable(['Date', 'Insider', 'Type', 'Value'], ins.trades.slice(0, 8).map((t) => [t.date, t.insider, { v: t.type, cls: t.code === 'P' ? 'up' : t.code === 'S' ? 'down' : '' }, money(t.value)])) : h('p', { class: 'muted' }, 'No recent filings.')) : unavailable('insiders'),
        ),
      ),
    );
    if (sv) {
      createLineChart(shortBox, { height: 240, format: (v) => `${v.toFixed(0)}%` }).set([
        { name: 'Short volume %', color: '#ef5350', data: sv.rows.map((r) => ({ time: r.date, value: r.ratio * 100 })) },
        { name: '40-day average', color: '#787b86', width: 1, data: sv.rows.map((r) => ({ time: r.date, value: sv.avgAll * 100 })) },
      ]);
    }
    if (cot) {
      const recent = cot.rows.slice(-104);
      createLineChart(cotBox, { height: 240, format: (v) => v.toFixed(0) }).set([
        { name: 'Speculators', color: '#2962ff', data: recent.map((r) => ({ time: r.date, value: r.specIndex ?? NaN })) },
        { name: 'Hedgers', color: '#ff9800', data: recent.map((r) => ({ time: r.date, value: r.commIndex ?? NaN })) },
      ]);
    }
  }

  let started = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    el: frame.el,
    /** Opens a symbol, optionally on a tab (the command bar's OMON). */
    open(symbol: string, on?: Tab) {
      symbolInput.value = symbol;
      if (on && on in TAB_LABELS) {
        tab = on;
        tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === on));
        cotSelect.hidden = on !== 'cot';
      }
      if (started) load(); // otherwise start() loads it
    },
    async start() {
      // Options and positioning change during the day: refresh quietly every minute while the page is open.
      timer ??= setInterval(() => (tab === 'options' || tab === 'positioning') && !frame.el.hidden && load(undefined, true), 60000);
      if (started) return;
      started = true;
      cotSelect.hidden = true;
      try {
        const { markets } = await engineRequest<{ markets: { code: string; name: string }[] }>('flow.cot_markets');
        cotSelect.append(...markets.map((m) => h('option', { value: m.code }, m.name)));
      } catch {
        // Filled in once the helper is running.
      }
      load();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
