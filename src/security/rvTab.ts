/**
 * Security → Peers (Bloomberg RV, owner's spec 7.17): the company highlighted on the first row, its peers below
 * (biggest first), the peer median and average at the bottom, then a scatter of sales growth against a chosen multiple
 * with a fitted line, so you can see at a glance whether the company is dear or cheap for its growth.
 * Data: quant.comps (SEC XBRL trailing 12 months, Schwab prices); peers chosen from the same SEC industry code.
 */
import { engineRequest } from '../data/schwab';
import type { CompRow, CompsReply } from '../research/comps';
import { h } from '../ui/dom';
import { fmtCompact } from './format';
import { linearFit, PEER_COLUMNS, peerStats, peerWords, type PeerField } from './peers';
import type { TabCtx } from './tabs';
import { note, panel, reasonOf } from './ui';

const fmt = (v: number | null | undefined, kind: 'money' | 'x' | 'pct') =>
  v == null || !Number.isFinite(v) ? '—' : kind === 'money' ? fmtCompact(v, { money: true }) : kind === 'x' ? (v > 0 ? `${v.toFixed(1)}×` : 'n/m') : `${(v * 100).toFixed(1)}%`;

const SCATTER_Y: [PeerField, string][] = [
  ['pe', 'P/E'],
  ['evEbitda', 'EV/EBITDA'],
  ['ps', 'P/S'],
];

export function rvTab(ctx: TabCtx) {
  const s = ctx.symbol;
  const body = h('div', {}, note('Finding peers in the same industry and reading their filings (can take a minute the first time)…'));
  ctx.body.replaceChildren(body);
  let yField: PeerField = 'pe';

  engineRequest<CompsReply>('quant.comps', { symbol: s }, 180000).then(
    (r) => {
      if (!ctx.still()) return;
      ctx.share('peers', { target: r.target, peers: r.peers.map((p) => p.symbol), industry: r.industry });
      const peers = [...r.peers].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      const statRow = (label: string, pick: 'median' | 'mean') =>
        h('tr', { class: 'rv-stat' }, h('th', { scope: 'row' }, label), ...PEER_COLUMNS.map((c) => h('td', { class: 'num' }, fmt(peerStats(peers, c.key)[pick], c.kind))));
      // the company's figures coloured against the peer median: green = better (cheaper multiple, higher growth/margin)
      const vsMedian = (c: (typeof PEER_COLUMNS)[number], v: number | null) => {
        const m = peerStats(peers, c.key).median;
        if (v == null || m == null || c.kind === 'money' || (c.kind === 'x' && v <= 0)) return '';
        const better = c.kind === 'x' ? v < m : v > m;
        return better ? 'up' : 'down';
      };
      const line = (row: CompRow, target: boolean) =>
        h(
          'tr',
          { class: target ? 'rv-target' : 'rv-peer', tabindex: target ? -1 : 0, title: target ? '' : `${row.name}: open it`, onclick: () => void (!target && ctx.open(row.symbol, 'rv')), onkeydown: (e: Event) => void (!target && (e as KeyboardEvent).key === 'Enter' && ctx.open(row.symbol, 'rv')) },
          h('th', { scope: 'row' }, h('b', {}, row.symbol), h('span', { class: 'rv-name' }, row.name)),
          ...PEER_COLUMNS.map((c) => h('td', { class: `num ${target ? vsMedian(c, row[c.key]) : ''}` }, fmt(row[c.key], c.kind))),
        );
      const table = h(
        'div',
        { class: 'sv-table-wrap' },
        h(
          'table',
          { class: 'rv-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Company'), ...PEER_COLUMNS.map((c) => h('th', { class: 'num', title: c.tip }, c.label)))),
          h('tbody', {}, line(r.target, true), ...peers.map((p) => line(p, false))),
          h('tfoot', {}, statRow('Peer median', 'median'), statRow('Peer average', 'mean')),
        ),
      );
      const plotBox = h('div', { class: 'rv-plot' });
      const drawPlot = () => plotBox.replaceChildren(scatterPlot(r.target, peers, yField));
      const picker = h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Multiple on the scatter' },
        ...SCATTER_Y.map(([k, label]) => {
          const b = h('button', { type: 'button', class: k === yField ? 'active' : '', onclick: () => ((yField = k), picker.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)), drawPlot()) }, label);
          return b;
        }),
      );
      drawPlot();
      body.replaceChildren(
        panel(
          `${r.industry || 'Industry'} peers`,
          `SEC EDGAR XBRL (last 12 months) · Schwab prices · peers: ${r.peerSource || 'same SEC industry code'}`,
          r.asOf,
          h('p', { class: 'anr-words rv-words' }, peerWords(r.target, peers)),
          table,
          r.failed.length ? note(`Left out (no usable filings): ${r.failed.map((f) => f.symbol).join(', ')}`) : null,
        ),
        panel('Growth against value', 'SEC EDGAR XBRL (last 12 months) · Schwab prices', r.asOf, h('div', { class: 'rv-plot-head' }, h('span', { class: 'muted small' }, 'Vertical axis:'), picker), plotBox, h('p', { class: 'anr-words' }, 'Each dot is a company; the dashed line is the peer trend. Above the line = valued higher than its growth alone suggests; below = lower.')),
      );
    },
    (err) => ctx.still() && body.replaceChildren(panel('Peers', 'SEC EDGAR XBRL', null, note(`Not available: ${reasonOf(err)}`, 'sv-error'))),
  );
}

/** Scatter: x = sales growth, y = the multiple; the company in the accent colour, the fitted line dashed. */
function scatterPlot(target: CompRow, peers: CompRow[], y: PeerField): Node {
  const pts = [target, ...peers]
    .map((r) => ({ r, x: r.revenueGrowth, y: r[y] }))
    .filter((p): p is { r: CompRow; x: number; y: number } => p.x != null && Number.isFinite(p.x) && p.y != null && Number.isFinite(p.y) && p.y > 0 && p.y < 200);
  if (pts.length < 3) return note('Not enough peers with both figures to draw this.');
  const W = 640;
  const H = 300;
  const pad = { l: 46, r: 16, t: 14, b: 36 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys) * 1.1;
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / (y1 || 1)) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text != null) n.textContent = text;
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rv-svg', role: 'img', 'aria-label': 'Sales growth against the chosen multiple for the company and its peers' });
  for (let i = 0; i <= 4; i++) {
    const v = (y1 / 4) * i;
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'rv-grid' }), el('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'rv-axis' }, `${v.toFixed(0)}×`));
  }
  for (let i = 0; i <= 4; i++) {
    const v = x0 + ((x1 - x0) / 4) * i;
    svg.append(el('text', { x: X(v), y: H - 14, 'text-anchor': 'middle', class: 'rv-axis' }, `${(v * 100).toFixed(0)}%`));
  }
  svg.append(el('text', { x: (pad.l + W - pad.r) / 2, y: H - 1, 'text-anchor': 'middle', class: 'rv-axis' }, 'Sales growth →'));
  const fit = linearFit(pts.filter((p) => p.r !== target));
  if (fit) svg.append(el('line', { x1: X(x0), y1: Y(fit.a + fit.b * x0), x2: X(x1), y2: Y(fit.a + fit.b * x1), class: 'rv-fit' }));
  for (const p of pts) {
    const isT = p.r === target;
    const g = el('g', { class: isT ? 'rv-dot target' : 'rv-dot' });
    g.append(el('title', {}, `${p.r.symbol}: growth ${(p.x * 100).toFixed(1)}%, ${p.y.toFixed(1)}×`), el('circle', { cx: X(p.x), cy: Y(p.y), r: isT ? 7 : 5 }), el('text', { x: X(p.x) + 9, y: Y(p.y) + 4, class: 'rv-label' }, p.r.symbol));
    svg.append(g);
  }
  return svg;
}
