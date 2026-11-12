/**
 * Flow → Options edge for one symbol (helper engine/optedge.py): the gamma flip level, implied vs realized volatility
 * (and the S&P 500's long record of the two) and the earnings move options price in against the stock's own past
 * reactions.
 */
import { formatPrice, h } from '../ui/dom';
import { money, pct, pctU, statCards } from '../ui/charts';
import { edgePanel, sourceLine } from './panel';

export interface OptEdge {
  symbol: string;
  spot: number;
  asOf: string;
  gamma: { flip: number | null; atSpot: number | null; curve: { price: number; gex: number }[]; above: boolean };
  vol: { iv30: number | null; rv20: number | null; gap: number | null; ivVsRvYear: number | null; rvPercentile: number | null };
  earnings: {
    past: { report: string; when: string; session: string; move: number }[];
    stats: { count: number; median: number; p75: number; max: number; mean: number } | null;
    upcoming: { date: string; hour: string; expiration: string; implied: number | null; straddle: number | null } | null;
    note: string;
  };
  market: { days: number; shareHigher: number; medianGap: number; meanGap: number; from: string; to: string } | null;
}

/** Plain readings (pure, tested). */
export function gammaRead(d: OptEdge): string {
  const { flip } = d.gamma;
  if (flip == null) return 'Dealer gamma doesn’t change sign within 15% of the price.';
  const dist = d.spot / flip - 1;
  return d.gamma.above
    ? `Price is ${pctU(dist, 1)} above the flip: dealer hedging tends to slow moves down here.`
    : `Price is ${pctU(-dist, 1)} below the flip: dealer hedging tends to speed moves up here.`;
}

export function volRead(v: OptEdge['vol']): string {
  if (v.iv30 == null || v.rv20 == null) return 'Not enough data to compare.';
  const rich = v.iv30 > v.rv20;
  const where = v.ivVsRvYear == null ? '' : ` Options price more movement than ${Math.round(v.ivVsRvYear * 100)}% of the last year’s 20-day readings.`;
  return `Options price ${pctU(v.iv30, 1)} a year; the stock actually moved ${pctU(v.rv20, 1)} over the last 20 days — options look ${rich ? 'expensive' : 'cheap'} against recent moves.${where}`;
}

export function earningsRead(e: OptEdge['earnings']): string {
  const s = e.stats;
  if (!e.upcoming?.implied) return s ? `Typical reaction to a report: ±${pctU(s.median, 1)} (median of the last ${s.count}), 1 in 4 bigger than ±${pctU(s.p75, 1)}.` : 'No earnings history to compare.';
  if (!s) return `Options price ±${pctU(e.upcoming.implied, 1)} for the report.`;
  const ratio = e.upcoming.implied / s.median;
  const word = ratio > 1.2 ? 'more than' : ratio < 0.8 ? 'less than' : 'about';
  return `Options price ±${pctU(e.upcoming.implied, 1)} for the ${e.upcoming.date} report — ${word} the stock’s typical ±${pctU(s.median, 1)} (median of the last ${s.count}).`;
}

function curveSvg(d: OptEdge) {
  const pts = d.gamma.curve;
  if (pts.length < 2) return '';
  const W = 600, H = 120;
  const xs = pts.map((p) => p.price), ys = pts.map((p) => p.gex);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yMax = Math.max(1e-9, ...ys.map(Math.abs));
  const X = (x: number) => ((x - x0) / (x1 - x0)) * W, Y = (y: number) => H / 2 - (y / yMax) * (H / 2 - 4);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'gex-curve');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Dealer gamma exposure at other prices');
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  add('line', { x1: '0', x2: String(W), y1: String(H / 2), y2: String(H / 2), class: 'zero' });
  add('polyline', { points: pts.map((p) => `${X(p.price).toFixed(1)},${Y(p.gex).toFixed(1)}`).join(' '), class: 'curve' });
  add('line', { x1: String(X(d.spot)), x2: String(X(d.spot)), y1: '0', y2: String(H), class: 'spot' });
  if (d.gamma.flip != null) add('line', { x1: String(X(d.gamma.flip)), x2: String(X(d.gamma.flip)), y1: '0', y2: String(H), class: 'flip' });
  return h('figure', { class: 'gex-fig' }, svg, h('figcaption', { class: 'muted small' }, `Total dealer gamma at prices ${formatPrice(x0)}–${formatPrice(x1)}. Solid line: price now; dashed: the flip.`));
}

export function optEdgePanel(symbol: string): HTMLElement {
  return edgePanel<OptEdge>({
    title: 'Options edge',
    term: 'gammaFlip',
    sub: 'Gamma flip · implied vs realized · earnings move',
    request: 'quant.optedge',
    params: { symbol },
    timeout: 90000,
    render(d, body) {
      const v = d.vol, e = d.earnings, s = e.stats;
      body.append(
        h('h4', { class: 'xe-sub' }, 'Where dealer hedging changes'),
        statCards([
          { label: 'Gamma flip', value: d.gamma.flip != null ? formatPrice(d.gamma.flip) : '—', hint: `Price ${formatPrice(d.spot)}` },
          { label: 'Dealer gamma at the price', value: money(d.gamma.atSpot), hint: 'Per 1% move', tone: d.gamma.atSpot == null ? '' : d.gamma.atSpot >= 0 ? 'up' : 'down' },
        ]),
        h('p', { class: 'small' }, gammaRead(d)),
        curveSvg(d),
        h('h4', { class: 'xe-sub' }, 'Implied vs realized volatility'),
        statCards([
          { label: '30-day implied', value: v.iv30 != null ? pctU(v.iv30, 1) : '—', hint: 'At-the-money options' },
          { label: '20-day realized', value: v.rv20 != null ? pctU(v.rv20, 1) : '—', hint: v.rvPercentile != null ? `Calmer than ${Math.round((1 - v.rvPercentile) * 100)}% of the last year` : '' },
          { label: 'Gap', value: v.gap != null ? `${v.gap >= 0 ? '+' : '−'}${(Math.abs(v.gap) * 100).toFixed(1)} pts` : '—', hint: 'Implied minus realized' },
        ]),
        h('p', { class: 'small' }, volRead(v)),
        d.market ? h('p', { class: 'small muted' }, `For scale: S&P 500 options (VIX) priced more movement than followed over the next month on ${Math.round(d.market.shareHigher * 100)}% of days from ${d.market.from.slice(0, 4)} to ${d.market.to.slice(0, 4)}, by a median ${d.market.medianGap.toFixed(1)} points — the volatility risk premium (NY Fed Staff Report 867).`) : '',
        h('h4', { class: 'xe-sub' }, 'Earnings move'),
        statCards([
          { label: 'Priced for next report', value: e.upcoming?.implied ? `±${pctU(e.upcoming.implied, 1)}` : '—', hint: e.upcoming ? `${e.upcoming.date}${e.upcoming.hour ? ` (${e.upcoming.hour === 'amc' ? 'after close' : e.upcoming.hour === 'bmo' ? 'before open' : e.upcoming.hour})` : ''} · ${e.upcoming.expiration} straddle` : 'Needs the report date' },
          { label: 'Typical past move', value: s ? `±${pctU(s.median, 1)}` : '—', hint: s ? `Median of ${s.count} · 75th percentile ±${pctU(s.p75, 1)}` : '' },
          { label: 'Biggest', value: s ? `±${pctU(s.max, 1)}` : '—' },
        ]),
        h('p', { class: 'small' }, earningsRead(e)),
        e.past.length
          ? h('div', { class: 'earn-moves', 'aria-label': 'Past report reactions' }, ...e.past.map((p) => h('span', { class: `earn-move ${p.move >= 0 ? 'up' : 'down'}`, title: `Report ${p.report} (${p.when === 'after' ? 'after the close' : p.when === 'before' ? 'before the open' : 'during the session'}); move on ${p.session}` }, `${p.session.slice(2, 7)} ${pct(p.move, 1)}`)))
          : '',
        e.note ? h('p', { class: 'muted small' }, e.note) : '',
        sourceLine(`Schwab option chain and prices; report times from SEC 8-K Item 2.02. Flip assumes dealers are long calls and short puts — a common simplification. Information, not a signal · ${new Date(d.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      );
    },
  });
}
