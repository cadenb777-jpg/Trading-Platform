/**
 * Options analytics (Flow > Options and the security view's OMON tab): our own Black-Scholes-Merton implied
 * volatility from each contract's mid price, the smile per expiry, the at-the-money term structure, the expected-move
 * band, the put/call skew and the greeks near the money. The maths is in the helper (engine/options_math.py, tested
 * against Hull's examples); this file draws it.
 */
import { engineRequest } from '../data/schwab';
import { dataTable, statCards } from '../ui/charts';
import { formatPrice, h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { THEME } from '../ui/theme';
import { xySvg } from '../ui/xyChart';

interface Greeks {
  mid: number | null;
  iv: number | null;
  model: number | null;
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  rho?: number;
}

interface SmileRow {
  strike: number;
  iv: number;
  callIv: number | null;
  putIv: number | null;
  schwabIv: number | null;
}

interface TermRow {
  expiration: string;
  dte: number;
  years: number;
  forward: number;
  atmIv: number | null;
  expectedMove: { amount: number; percent: number; low: number; high: number } | null;
  straddle: number | null;
  skew: { put25: number | null; call25: number | null; riskReversal: number | null };
  skew90110: number | null;
  points: number;
}

export interface OptionAnalytics {
  symbol: string;
  spot: number;
  rate: number;
  divYield: number;
  expiration: string;
  expirations: string[];
  years: number;
  term: TermRow[];
  smile: SmileRow[];
  greeks: { strike: number; call?: Greeks; put?: Greeks }[];
  asOf: string;
  sources: { chain: string; rate: string; dividend: string };
}

const vol = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const pts = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)} pts`);
const num = (v: number | null | undefined, d = 3) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** A self-loading block. `compact` (OMON) shows fewer greeks columns. */
export function optionsAnalyticsBlock(symbol: string, expiration?: string, opts: { compact?: boolean } = {}) {
  const el = h('div', { class: 'qp-options' }, h('section', { class: 'panel' }, h('div', { class: 'muted pad' }, 'Working out implied volatility, greeks and skew from the option chain…')));

  async function load(exp?: string) {
    try {
      const d = await engineRequest<OptionAnalytics>('quant.options', exp ? { symbol, expiration: exp } : { symbol }, 60000);
      draw(d);
    } catch (err) {
      el.replaceChildren(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Options analytics')), h('div', { class: 'ap-error' }, (err as Error).message)));
    }
  }

  function draw(d: OptionAnalytics) {
    const chosen = d.term.find((t) => t.expiration === d.expiration);
    const pick = h('select', { class: 'input', 'aria-label': 'Expiration' }, ...d.expirations.map((e) => h('option', { value: e, selected: e === d.expiration }, e)));
    pick.addEventListener('change', () => load(pick.value));
    const em = chosen?.expectedMove;
    const source = h(
      'p',
      { class: 'ap-note' },
      `Black-Scholes-Merton (European; Schwab's options are American, so deep in-the-money puts can read slightly off). IV from bid/ask mids by Newton's method with a bisection fallback. Rate ${vol(d.rate, 2)} (${d.sources.rate}); dividend yield ${vol(d.divYield, 2)} (${d.sources.dividend}). Source: ${d.sources.chain}, as of ${when(d.asOf)}.`,
    );
    const term = d.term.filter((t) => t.atmIv != null);
    const smileChart =
      d.smile.length >= 3
        ? xySvg(
            [
              { name: 'Our IV (out-of-the-money side)', color: THEME.viz1, points: d.smile.map((r) => ({ x: r.strike, y: r.iv * 100 })) },
              { name: 'Schwab IV', color: THEME.viz2, points: d.smile.filter((r) => r.schwabIv != null).map((r) => ({ x: r.strike, y: r.schwabIv! * 100 })) },
            ].filter((s) => s.points.length),
            { x: (v) => formatPrice(v), y: (v) => `${v.toFixed(1)}%`, marker: { x: d.spot, label: 'Price' }, xName: 'Strike' },
          )
        : h('p', { class: 'muted' }, 'Not enough quoted strikes for a smile at this expiry.');
    const termChart =
      term.length >= 2
        ? xySvg([{ name: 'At-the-money IV', color: THEME.viz1, points: term.map((t) => ({ x: t.dte, y: t.atmIv! * 100 })) }], { x: (v) => `${Math.round(v)}d`, y: (v) => `${v.toFixed(1)}%`, xName: 'Days to expiry' })
        : h('p', { class: 'muted' }, 'Needs at least two expirations.');
    const greekCols = opts.compact ? (['iv', 'delta', 'gamma', 'theta'] as const) : (['mid', 'iv', 'delta', 'gamma', 'vega', 'theta', 'rho'] as const);
    const head = { mid: 'Mid', iv: 'IV', delta: 'Delta', gamma: 'Gamma', vega: 'Vega', theta: 'Theta', rho: 'Rho' };
    const cell = (g: Greeks | undefined, k: (typeof greekCols)[number]) => (k === 'mid' ? formatPrice(g?.mid) : k === 'iv' ? vol(g?.iv) : num(g?.[k], k === 'gamma' ? 4 : 3));
    const nearest = d.greeks.reduce((b, r) => (Math.abs(r.strike - d.spot) < Math.abs(b - d.spot) ? r.strike : b), d.greeks[0]?.strike ?? 0);
    el.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Options analytics (Black-Scholes)'), h('span', { class: 'spacer' }), pick),
        statCards([
          { label: h('span', {}, 'At-the-money IV ', infoTip('impliedVol')), value: vol(chosen?.atmIv), hint: `Interpolated at the forward price ${formatPrice(chosen?.forward)}` },
          { label: 'Expected move (1 SD)', value: em ? `±${formatPrice(em.amount)}` : '—', hint: em ? `±${(em.percent * 100).toFixed(1)}% by ${d.expiration}: about a 68% chance of ending between ${formatPrice(em.low)} and ${formatPrice(em.high)}` : '' },
          { label: '1 SD band', value: em ? `${formatPrice(em.low)} – ${formatPrice(em.high)}` : '—', hint: chosen?.straddle != null ? `The at-the-money straddle costs ${formatPrice(chosen.straddle)} (about 0.8 SD)` : '' },
          { label: h('span', {}, 'Put/call skew (25Δ) ', infoTip('riskReversal')), value: pts(chosen?.skew.riskReversal), hint: `25-delta put ${vol(chosen?.skew.put25)} vs call ${vol(chosen?.skew.call25)}`, tone: chosen?.skew.riskReversal != null ? (chosen.skew.riskReversal > 0.04 ? 'down' : '') : '' },
          { label: '90% / 110% skew', value: pts(chosen?.skew90110), hint: 'IV 10% below the price minus IV 10% above' },
        ]),
        h('div', { class: opts.compact ? 'qp-stack' : 'two-col' }, h('div', {}, h('h4', {}, `IV smile (${d.expiration})`), smileChart), h('div', {}, h('h4', {}, 'At-the-money term structure'), termChart)),
      ),
      h(
        'div',
        { class: 'qp-stack' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'By expiry'), h('span', { class: 'muted small' }, 'Expected move = price × IV × √years')),
          dataTable(
            ['Expiry', 'Days', 'ATM IV', 'Expected move', 'Straddle', '25Δ skew'],
            d.term.slice(0, opts.compact ? 8 : 16).map((t) => [
              { v: t.expiration, cls: t.expiration === d.expiration ? 'label hl' : 'label' },
              String(t.dte),
              vol(t.atmIv),
              t.expectedMove ? `±${formatPrice(t.expectedMove.amount)} (${(t.expectedMove.percent * 100).toFixed(1)}%)` : '—',
              t.straddle != null ? formatPrice(t.straddle) : '—',
              pts(t.skew.riskReversal),
            ]),
            undefined,
            false,
          ),
        ),
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, `Greeks near the money (${d.expiration})`), h('span', { class: 'muted small' }, 'Both sides use the out-of-the-money option’s IV · vega per 1 vol point, theta per day, rho per 1% rate')),
          h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'data-table qp-greeks' },
              h('thead', {}, h('tr', {}, h('th', { colspan: greekCols.length, class: 'up' }, 'Calls'), h('th', {}, 'Strike'), h('th', { colspan: greekCols.length, class: 'down' }, 'Puts')), h('tr', {}, ...greekCols.map((k) => h('th', {}, head[k])), h('th', {}, ''), ...greekCols.map((k) => h('th', {}, head[k])))),
              h('tbody', {}, ...d.greeks.map((r) => h('tr', { class: r.strike === nearest ? 'hl' : '' }, ...greekCols.map((k) => h('td', {}, cell(r.call, k))), h('th', { class: 'qp-strike' }, formatPrice(r.strike)), ...greekCols.map((k) => h('td', {}, cell(r.put, k)))))),
            ),
          ),
        ),
      ),
      source,
    );
  }

  queueMicrotask(() => load(expiration));
  return el;
}

