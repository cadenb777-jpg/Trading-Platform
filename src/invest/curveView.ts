/**
 * Bonds → What the curve says (helper bonds.curvefit): the fitted Treasury curve with today's yields on it, each
 * maturity's distance from the curve against its own usual range, forward rates, inflation breakevens and the
 * yield-curve recession odds. Every block names its source and date. Readings and maths: curveFit.ts / engine/curvefit.py.
 */
import { engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openFredWindow } from '../ui/fredWindow';
import { asOfStamp } from '../ui/dataHealth';
import { termPremiumBlock } from './ratesDeskView';
import { supplyBlock } from './moneyDeskView';
import {
  bp,
  changeBp,
  gapScale,
  monthName,
  oddsWord,
  pct2,
  recordWords,
  shapeWords,
  side,
  standoutWords,
  UNUSUAL_Z,
  type CurveFit,
  type CurveRow,
  type Recession,
} from './curveFit';

export const CURVE_HELPER_VERSION = 61;
export const curveReady = () => !helper.tooOld && (helper.version ?? 0) >= CURVE_HELPER_VERSION;

const NS = 'http://www.w3.org/2000/svg';
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

/** The fitted par curve (line), the forward curve (dashed) and Treasury's yields (dots), maturities on a square-root
 *  scale so the bills aren't squeezed into a corner. */
function curveChart(d: CurveFit, width: number): HTMLElement {
  // drawn at the width it is shown, so labels stay readable on a phone
  const W = Math.round(Math.min(960, Math.max(300, width || 640)));
  const H = W < 520 ? 220 : 280;
  const pad = { l: 46, r: 14, t: 14, b: 30 };
  const maxT = 30;
  const x = (t: number) => pad.l + (Math.sqrt(t) / Math.sqrt(maxT)) * (W - pad.l - pad.r);
  const vals = [...d.rows.map((r) => r.yield), ...d.curve.map((c) => c.par), ...d.curve.map((c) => c.forward)];
  const lo = Math.floor(Math.min(...vals) * 4) / 4 - 0.1;
  const hi = Math.ceil(Math.max(...vals) * 4) / 4 + 0.1;
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cf-svg', role: 'img', 'aria-label': `Fitted Treasury curve on ${day(d.date)}: ${shapeWords(d.rows)}` });
  const step = [0.25, 0.5, 1].find((s) => (hi - lo) / s <= 7) ?? 2;
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'cf-grid' }));
    svg.append(svgEl('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'cf-axis' }, `${v.toFixed(2)}%`));
  }
  let lastX = -Infinity;
  for (const [t, label] of [[1 / 12, '1M'], [0.5, '6M'], [1, '1Y'], [2, '2Y'], [5, '5Y'], [10, '10Y'], [20, '20Y'], [30, '30Y']] as [number, string][]) {
    if (x(t) - lastX < 30) continue; // no crowded labels on a narrow chart
    lastX = x(t);
    svg.append(svgEl('text', { x: x(t), y: H - 9, 'text-anchor': 'middle', class: 'cf-axis' }, label));
  }
  const path = (key: 'par' | 'forward') => d.curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.years).toFixed(1)},${y(c[key]).toFixed(1)}`).join('');
  svg.append(svgEl('path', { d: path('forward'), class: 'cf-forward' }));
  svg.append(svgEl('path', { d: path('par'), class: 'cf-fitted' }));
  for (const r of d.rows) {
    const unusual = r.z != null && Math.abs(r.z) >= UNUSUAL_Z;
    const g = svgEl('g', { class: `cf-dot${unusual ? ` unusual ${side(r)}` : ''}` });
    g.append(svgEl('line', { x1: x(r.years), x2: x(r.years), y1: y(r.fitted), y2: y(r.yield), class: 'cf-stem' }));
    g.append(svgEl('circle', { cx: x(r.years), cy: y(r.yield), r: unusual ? 5 : 3.5 }));
    g.append(svgEl('title', {}, `${r.label}: ${pct2(r.yield)} · curve ${pct2(r.fitted)} · ${bp(r.gapBp)} off the curve (usually ${bp(r.usualBp)}) · ${r.reading}`));
    svg.append(g);
  }
  return h(
    'figure',
    { class: 'cf-figure' },
    svg,
    h(
      'figcaption',
      { class: 'cf-legend small' },
      h('span', { class: 'cf-key dot' }, 'Treasury yields'),
      h('span', { class: 'cf-key fitted' }, 'Fitted curve'),
      h('span', { class: 'cf-key forward' }, 'Forward rates (what the curve implies for later)'),
    ),
  );
}

/** Each maturity's gap from the curve on one shared scale, with its usual band (mean ± 2.5 SD over a year). */
function gapTable(d: CurveFit): HTMLElement {
  const pos = gapScale(d.rows);
  const bar = (r: CurveRow) => {
    const band =
      r.usualBp != null && r.sdBp != null
        ? h('i', { class: 'cf-band', style: `left:${pos(r.usualBp - UNUSUAL_Z * r.sdBp)}%;right:${100 - pos(r.usualBp + UNUSUAL_Z * r.sdBp)}%` })
        : '';
    const usual = r.usualBp != null ? h('i', { class: 'cf-usual', style: `left:${pos(r.usualBp)}%` }) : '';
    const now = h('i', { class: `cf-now ${r.z != null && Math.abs(r.z) >= UNUSUAL_Z ? side(r) : ''}`, style: `left:${pos(r.gapBp)}%` });
    return h('span', { class: 'cf-range', role: 'img', 'aria-label': `${bp(r.gapBp)} off the curve; usual range ${r.usualBp != null && r.sdBp != null ? `${bp(r.usualBp - UNUSUAL_Z * r.sdBp)} to ${bp(r.usualBp + UNUSUAL_Z * r.sdBp)}` : 'not known yet'}` }, h('i', { class: 'cf-zero' }), band, usual, now);
  };
  return h(
    'div',
    { class: 'cf-table-wrap' },
    h(
      'table',
      { class: 'data-table cf-table' },
      h('caption', { class: 'sr-only' }, 'Each Treasury maturity against the fitted curve'),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Maturity'),
          h('th', { scope: 'col', class: 'num' }, 'Yield'),
          h('th', { scope: 'col', class: 'num cf-wide' }, 'Curve'),
          h('th', { scope: 'col', class: 'num' }, 'Off the curve'),
          h('th', { scope: 'col', class: 'cf-range-head' }, h('span', {}, h('small', {}, '← rich'), 'Today vs usual', h('small', {}, 'cheap →'))),
          h('th', { scope: 'col', class: 'cf-wide' }, 'Reading'),
        ),
      ),
      h(
        'tbody',
        {},
        ...d.rows.map((r) => {
          const unusual = r.z != null && Math.abs(r.z) >= UNUSUAL_Z;
          return h(
            'tr',
            { class: unusual ? 'cf-unusual' : '' },
            h('th', { scope: 'row' }, r.label),
            h('td', { class: 'num' }, pct2(r.yield)),
            h('td', { class: 'num muted cf-wide' }, pct2(r.fitted)),
            h('td', { class: 'num' }, bp(r.gapBp)),
            h('td', { class: 'cf-range-cell' }, bar(r)),
            h('td', { class: `small cf-wide ${unusual ? 'cf-read-strong' : 'muted'}` }, r.reading),
          );
        }),
      ),
    ),
  );
}

function forwardsBlock(d: CurveFit): HTMLElement {
  return h('div', { class: 'cf-table-wrap' }, h(
    'table',
    { class: 'data-table cf-small-table' },
    h('caption', { class: 'cf-caption' }, 'Forward rates', infoTip('forwardRate')),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Rate'), h('th', { scope: 'col', class: 'num' }, 'Now'), h('th', { scope: 'col', class: 'num' }, d.monthAgoDate ? `vs ${day(d.monthAgoDate)}` : 'Month ago'))),
    h('tbody', {}, ...d.forwards.map((f) => h('tr', {}, h('th', { scope: 'row' }, f.label), h('td', { class: 'num' }, pct2(f.rate)), h('td', { class: 'num muted' }, changeBp(f.rate, f.monthAgo))))),
  ));
}

function breakevenBlock(d: CurveFit): HTMLElement {
  if (!d.breakevens.length)
    return h('p', { class: 'muted small' }, d.realDate ? `Breakevens wait for Treasury’s real yields for ${day(d.date)} (latest ${day(d.realDate)}).` : 'Treasury’s real (TIPS) yields are unavailable right now.');
  return h('div', { class: 'cf-table-wrap' }, h(
    'table',
    { class: 'data-table cf-small-table' },
    h('caption', { class: 'cf-caption' }, 'Inflation the market is paying for', infoTip('breakeven')),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Maturity'), h('th', { scope: 'col', class: 'num cf-wide' }, 'Treasury'), h('th', { scope: 'col', class: 'num cf-wide' }, 'TIPS (real)'), h('th', { scope: 'col', class: 'num' }, 'Breakeven'), h('th', { scope: 'col', class: 'num' }, '1-month change'))),
    h(
      'tbody',
      {},
      ...d.breakevens.map((b) =>
        h('tr', {}, h('th', { scope: 'row' }, b.label), h('td', { class: 'num muted cf-wide' }, pct2(b.nominal)), h('td', { class: 'num muted cf-wide' }, pct2(b.real)), h('td', { class: 'num' }, pct2(b.breakeven)), h('td', { class: 'num muted' }, changeBp(b.breakeven, b.monthAgo))),
      ),
    ),
  ));
}

/** The last 36 months of recession odds as bars, with the alarm level marked. */
function oddsBars(rec: Recession): HTMLElement {
  const W = 360;
  const H = 70;
  const n = rec.history.length;
  const bw = W / Math.max(1, n);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H + 16}`, class: 'cf-odds-svg', role: 'img', 'aria-label': `Recession odds by month, ${monthName(rec.history[0]?.month ?? '')} to ${monthName(rec.history[n - 1]?.month ?? '')}` });
  rec.history.forEach((m, i) => {
    const hgt = Math.max(1, m.p * H);
    const r = svgEl('rect', { x: i * bw + 1, y: H - hgt, width: Math.max(1, bw - 2), height: hgt, class: m.p >= rec.alarm ? 'cf-odds-bar high' : 'cf-odds-bar' });
    r.append(svgEl('title', {}, `${monthName(m.month)}: ${Math.round(m.p * 100)}% (10y − 3m ${m.spread.toFixed(2)} pts)`));
    svg.append(r);
  });
  svg.append(svgEl('line', { x1: 0, x2: W, y1: H - rec.alarm * H, y2: H - rec.alarm * H, class: 'cf-alarm' }));
  svg.append(svgEl('text', { x: W - 2, y: H - rec.alarm * H - 3, 'text-anchor': 'end', class: 'cf-axis' }, `${Math.round(rec.alarm * 100)}%`));
  if (n) {
    svg.append(svgEl('text', { x: 0, y: H + 13, class: 'cf-axis' }, monthName(rec.history[0].month)));
    svg.append(svgEl('text', { x: W, y: H + 13, 'text-anchor': 'end', class: 'cf-axis' }, monthName(rec.history[n - 1].month)));
  }
  return svg as unknown as HTMLElement;
}

function recessionBlock(rec: Recession | null, notes: string[]): HTMLElement {
  if (!rec || rec.probability == null)
    return h('p', { class: 'muted small' }, notes.find((n) => n.startsWith('Recession')) ?? 'Recession odds are unavailable right now.');
  const p = rec.probability;
  return h(
    'div',
    { class: 'cf-rec' },
    h(
      'div',
      { class: 'cf-rec-head' },
      h('b', { class: `cf-rec-value num${p >= 0.4 ? ' down' : ''}` }, `${Math.round(p * 100)}%`),
      h(
        'div',
        {},
        h('div', { class: 'cf-rec-word' }, `${oddsWord(p)} odds of a U.S. recession within 12 months`),
        h(
          'div',
          { class: 'muted small' },
          rec.spread != null ? `10-year minus 3-month Treasury: ${rec.spread >= 0 ? '+' : '−'}${Math.abs(rec.spread).toFixed(2)} points (${monthName(rec.month)}, ${rec.monthDays} day${rec.monthDays === 1 ? '' : 's'} so far)` : '',
        ),
      ),
    ),
    oddsBars(rec),
    h('p', { class: 'small' }, recordWords(rec)),
    h(
      'p',
      { class: 'muted small' },
      `Model: chance = N(${rec.a.toFixed(2)} ${rec.b < 0 ? '−' : '+'} ${Math.abs(rec.b).toFixed(2)} × spread), fitted here on ${rec.n} months (${monthName(rec.fitFrom)} – ${monthName(rec.fitTo)}) of FRED data against NBER recession dates.${rec.auc != null ? ` Out of sample it ranked months before recessions above other months ${Math.round(rec.auc * 100)}% of the time.` : ''} One input, so a reading, not a forecast.`,
    ),
    h('button', { type: 'button', class: 'link-btn small', onclick: () => openFredWindow('T10Y3M', '10-year minus 3-month Treasury spread') }, 'See the spread’s full history'),
  );
}

/** The whole tab. */
export function createCurveView(): { el: HTMLElement; load: (force?: boolean) => void } {
  const stamp = asOfStamp(null, { prefix: 'Treasury curve of' });
  const body = h('div', { class: 'cf-body' }, h('div', { class: 'skeleton', style: 'height:320px' }));
  const el = h(
    'div',
    { class: 'cf-view' },
    h('div', { class: 'cf-intro' }, h('p', { class: 'muted small' }, 'A smooth curve is fitted through today’s Treasury yields, the way the Federal Reserve builds its own. Maturities that sit unusually far above it are cheap next to their neighbours; below it, rich.'), stamp.el),
    body,
  );
  let loading = false;
  let waiting: (() => void) | null = null;
  function load(force = false) {
    if (loading) return;
    if (!curveReady()) {
      body.replaceChildren(h('p', { class: 'muted small' }, helper.isConnected ? 'Arrives with the next helper update (it installs by itself).' : 'Start the helper to see the fitted curve.'));
      // load as soon as a (new enough) helper says hello, while the tab is on screen
      waiting ??= helper.onStatusChange(() => {
        if (!curveReady()) return;
        waiting?.();
        waiting = null;
        if (el.isConnected) load();
      });
      return;
    }
    loading = true;
    if (force || !body.querySelector('.cf-grid-2')) body.replaceChildren(h('div', { class: 'skeleton', style: 'height:320px' }));
    engineRequest<CurveFit>('bonds.curvefit', {}, 120_000)
      .then((d) => {
        // a daily curve: stamped with its own date (never "stale" between Treasury's daily posts)
        stamp.set(day(d.date), { source: 'U.S. Treasury, FRED' });
        body.replaceChildren(
          h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel-head' }, h('h3', {}, 'The fitted curve', infoTip('curveFit')), h('span', { class: 'muted small' }, `${shapeWords(d.rows)} Fit error ${d.rmseBp.toFixed(1)} bp on ${day(d.date)}.`)),
            // measured when shown; hidden (the page left while loading) = draw at the desktop size
            curveChart(d, body.clientWidth > 0 ? body.clientWidth - 32 : 640),
            h('p', { class: `small cf-headline${d.rows.some((r) => r.z != null && Math.abs(r.z) >= UNUSUAL_Z) ? ' strong' : ''}` }, standoutWords(d.rows)),
            gapTable(d),
            h('p', { class: 'muted small' }, `“Usual” = the maturity’s average distance from the curve on ${Math.max(0, d.fittedDays - 1)} weekly fits over the past year; the band is ± ${UNUSUAL_Z} standard deviations. Some maturities always sit off the curve (supply, liquidity), which is why each is judged against its own year. Source: U.S. Treasury daily par yield curve, ${day(d.date)}.`),
          ),
          h(
            'div',
            { class: 'cf-grid-2' },
            h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Recession odds from the curve', infoTip('recessionModel')), h('span', { class: 'muted small' }, 'The yield-curve model central banks track')), recessionBlock(d.recession, d.notes)),
            h(
              'section',
              { class: 'panel' },
              h('div', { class: 'panel-head' }, h('h3', {}, 'What the curve implies'), h('span', { class: 'muted small' }, 'Rates for later, and inflation priced in')),
              forwardsBlock(d),
              breakevenBlock(d),
              h('p', { class: 'muted small' }, `Forwards from the fitted curve (${day(d.date)}). Breakeven = Treasury yield − TIPS real yield at the same maturity (Treasury real yield curve, ${day(d.realDate)}); it includes risk and liquidity premiums, so it is inflation compensation, not a forecast.`),
              termPremiumBlock(),
              supplyBlock(),
            ),
          ),
          d.notes.length ? h('p', { class: 'muted small' }, d.notes.join(' ')) : '',
          h(
            'p',
            { class: 'muted small cf-sources' },
            'Sources: ',
            ...d.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.name), s.asOf ? ` (${s.asOf})` : '']),
            '. Method: Nelson-Siegel-Svensson (Gürkaynak, Sack and Wright 2006); recession probit (Estrella and Mishkin 1998).',
          ),
        );
      })
      .catch((err: Error) => body.replaceChildren(h('div', { class: 'setups-banner' }, h('b', {}, 'Couldn’t load the curve: '), err.message, ' ', h('button', { type: 'button', class: 'link-btn', onclick: () => load(true) }, 'Try again'))))
      .finally(() => (loading = false));
  }
  return { el, load };
}
