/**
 * The "Is the yield sustainable?" charts for one holding: a stacked bar per 12-month period (payout per share split
 * into earned / paid from your money, from market prices) and $10,000 invested (payouts reinvested vs price alone
 * vs payouts received). The owner's official return-of-capital figure, when entered, is drawn as its own bar so the
 * tax label is never confused with the price-based estimate. Maths in ./payoutSplit.ts.
 */
import { engineRequest } from '../data/schwab';
import { createLineChart, dataTable } from '../ui/charts';
import { h } from '../ui/dom';
import { onThemeChange, THEME } from '../ui/theme';
import { growthOf, overall, shortRange, splitRead, thin, yearlySplit, type Close, type Payment, type YearSplit } from './payoutSplit';

const perShare = (v: number) => `$${v.toFixed(v >= 10 ? 2 : 3)}`;
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Builds the charts into a box; `destroy` frees the line chart (call it when the window closes). */
export function payoutCharts(symbol: string, roc: { pct: number; year?: string } | null) {
  const box = h('div', { class: 'payout' }, h('p', { class: 'muted small' }, 'Reading five years of prices and payouts…'));
  let destroy = () => {};
  engineRequest<{ closes: Close[]; dividends: Payment[] }>('dividends.history', { symbol }, 60000).then(
    (d) => {
      if (!box.isConnected) return; // the window was closed meanwhile
      destroy = draw(box, d.closes, d.dividends, roc);
    },
    (err) => box.replaceChildren(h('p', { class: 'muted small' }, /unknown request/i.test((err as Error).message) ? 'Update the helper to see where the payouts came from.' : `Charts unavailable: ${(err as Error).message}`)),
  );
  return { el: box, destroy: () => destroy() };
}

function draw(box: HTMLElement, closes: Close[], divs: Payment[], roc: { pct: number; year?: string } | null): () => void {
  const splits = yearlySplit(closes, divs);
  const read = h('p', { class: 'payout-read' }, splitRead(splits));
  if (!splits.length) {
    box.replaceChildren(read);
    return () => {};
  }
  const tip = h('div', { class: 'payout-tip', role: 'status', 'aria-live': 'polite' });
  const show = (seg: HTMLElement, text: string) => {
    tip.textContent = text;
    tip.classList.add('on');
    const host = bars.getBoundingClientRect();
    const r = seg.getBoundingClientRect();
    tip.style.left = `${Math.max(0, Math.min(r.left - host.left + r.width / 2 - 110, host.width - 220))}px`;
    tip.style.top = `${r.top - host.top - 6}px`;
  };
  const hide = () => tip.classList.remove('on');
  const max = Math.max(...splits.map((s) => s.payout), 1e-9);
  const segment = (cls: string, value: number, label: string, text: string) =>
    value > 0
      ? h('span', {
          class: `payout-seg ${cls}`,
          style: `flex-grow:${value}`,
          tabindex: 0,
          role: 'img',
          'aria-label': text,
          onpointerenter: (e: Event) => show(e.currentTarget as HTMLElement, text),
          onpointerleave: hide,
          onfocus: (e: Event) => show(e.currentTarget as HTMLElement, text),
          onblur: hide,
        }, label)
      : null;
  const row = (s: YearSplit) =>
    h(
      'div',
      { class: 'payout-row' },
      h('span', { class: 'payout-label small' }, shortRange(s)),
      h(
        'span',
        { class: 'payout-track' },
        h(
          'span',
          { class: 'payout-bar', style: `width:${(s.payout / max) * 100}%` },
          segment('earned', s.earned, s.earned / s.payout >= 0.18 ? perShare(s.earned) : '', `${shortRange(s)}: ${perShare(s.earned)} a share earned (covered by the total return), ${pct0(1 - s.fromPriceShare)} of ${perShare(s.payout)} paid`),
          segment('fromprice', s.fromPrice, s.fromPriceShare >= 0.18 ? perShare(s.fromPrice) : '', `${shortRange(s)}: ${perShare(s.fromPrice)} a share paid from your money (the price fell ${perShare(s.startPrice - s.endPrice)}), ${pct0(s.fromPriceShare)} of ${perShare(s.payout)} paid${s.extraLoss > 0 ? `; the price fell ${perShare(s.extraLoss)} more than the payout` : ''}`),
        ),
      ),
      h('span', { class: 'payout-value small num' }, `${perShare(s.payout)} · ${pct0(s.fromPriceShare)}`),
    );
  const o = overall(splits);
  const bars = h(
    'div',
    { class: 'payout-bars', role: 'group', 'aria-label': 'Payout per share each 12 months, split into earned and paid from your money' },
    ...splits.map(row),
    roc
      ? h(
          'div',
          { class: 'payout-row payout-roc' },
          h('span', { class: 'payout-label small' }, `Officially ROC${roc.year ? ` (${roc.year})` : ''}`),
          h(
            'span',
            { class: 'payout-track' },
            h(
              'span',
              { class: 'payout-bar', style: 'width:100%' },
              segment('roc', roc.pct, roc.pct >= 0.18 ? pct0(roc.pct) : '', `Officially return of capital (fund's 19a/1099)${roc.year ? `, ${roc.year}` : ''}: ${pct0(roc.pct)} of the payouts. You entered this.`),
              segment('rest', 1 - roc.pct, '', `The rest, ${pct0(1 - roc.pct)}, was labelled income or gains for tax.`),
            ),
          ),
          h('span', { class: 'payout-value small num' }, pct0(roc.pct)),
        )
      : null,
    tip,
  );
  const legend = h(
    'div',
    { class: 'line-legend payout-legend' },
    h('span', {}, h('i', { class: 'earned' }), 'Earned (covered by total return)'),
    h('span', {}, h('i', { class: 'fromprice' }), 'Paid from your money (price drop)'),
    roc ? h('span', {}, h('i', { class: 'roc' }), 'Officially return of capital (fund’s 19a/1099)') : null,
  );
  const scale = h('p', { class: 'muted small' }, `Bars: payout per share each 12 months on its own (longest ${perShare(max)}); right: paid · share from your money that year. ${o.payout ? `Over the whole span ${perShare(o.payout)} a share was paid and the price went from ${perShare(splits[0].startPrice)} to ${perShare(splits[splits.length - 1].endPrice)}, so ${o.fromPrice > 0.005 * o.payout ? `${perShare(o.fromPrice)} of it` : 'none of it'} came from the price falling (a fall in one year that a later year made good doesn't count; the summary above reads it the same way).` : ''}`);
  const rocNote = roc
    ? h('p', { class: 'ap-note' }, 'The two measure different things: “Officially return of capital” is the fund’s tax label (what box 3 of your 1099-DIV says); “paid from your money” is the economic reading from prices (how much the price fell to fund the payout). A fund can label little ROC and still erode, or label a lot and hold its price.')
    : null;

  // $10,000 invested: three lines on one $ axis
  const growth = growthOf(closes.slice(closes.findIndex((c) => c[0] >= splits[0].from)), divs);
  const lineBox = h('div', { class: 'payout-line' });
  let chart: ReturnType<typeof createLineChart> | null = null;
  const setLines = () => {
    if (!chart) return;
    const pts = thin(growth);
    chart.set([
      { name: 'Total value (payouts reinvested)', color: THEME.viz1, data: pts.map((p) => ({ time: p.date, value: p.total })) },
      { name: 'Share price alone', color: THEME.viz2, data: pts.map((p) => ({ time: p.date, value: p.price })) },
      { name: 'Payouts received (added up)', color: THEME.viz3, data: pts.map((p) => ({ time: p.date, value: p.payouts })) },
    ]);
  };
  const stopTheme = onThemeChange(setLines);
  const last = growth[growth.length - 1];
  const lineRead = last
    ? h('p', { class: 'payout-read small' }, `$10,000 invested ${shortRange(splits[0]).split(' – ')[0]}: the shares alone are worth ${money(last.price)} now, the payouts added up to ${money(last.payouts)}, and with every payout reinvested it would be ${money(last.total)}.`)
    : null;

  const numbers = h(
    'details',
    { class: 'payout-numbers' },
    h('summary', {}, 'Show the numbers'),
    dataTable(
      ['12 months', 'Start price', 'End price', 'Paid / share', 'Earned', 'From your money', 'Share from your money'],
      splits.map((s) => [shortRange(s), { v: perShare(s.startPrice), cls: 'num' }, { v: perShare(s.endPrice), cls: 'num' }, { v: perShare(s.payout), cls: 'num' }, { v: perShare(s.earned), cls: 'num' }, { v: perShare(s.fromPrice), cls: 'num' }, { v: pct0(s.fromPriceShare), cls: 'num' }]),
      undefined,
      false,
    ),
  );
  box.replaceChildren(h('h4', {}, 'Where the payout came from'), read, legend, bars, scale, rocNote ?? '', h('h4', {}, '$10,000 invested'), lineRead ?? '', lineBox, numbers, h('p', { class: 'muted small' }, 'From market prices (not the fund’s NAV) and Yahoo payouts. “Earned” = the part of each payout the total return covered; the rest came back out of the price.'));
  // made once the box is on the page, so the chart measures its real width before fitting the dates
  chart = createLineChart(lineBox, { height: 240, format: money, title: '$10,000 invested', expand: false });
  setLines();
  return () => {
    stopTheme();
    chart?.remove();
  };
}
