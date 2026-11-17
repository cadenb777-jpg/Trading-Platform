/**
 * Research overview: Return on capital = ROIC by year against Moody's Baa yield (bars with a floor line), and R&D
 * counted as an investment. Reads the annual statements research.company returned (helper 83 adds current debt and
 * long-term securities) and the Baa yield from research.corpyields (its own request, painted when it arrives); maths
 * in roic.ts.
 */
import { engineRequest, roicReady } from '../data/schwab';
import { h } from '../ui/dom';
import { block, savedBeforeUpdate } from './panelBlock';
import { fact } from '../invest/moneyDeskView';
import { money } from '../ui/charts';
import { fy, pc, type Statements } from './debtDilution';
import { monthYear } from '../portfolio/optimiserText';
import type { CorpYields } from './obligations';
import { RD_LIFE, research, researchStaleWords, researchWords, returnOnCapital, roicStaleWords, roicWords, type Baa, type Roic } from './roic';

/** One bar per year on one scale; the Baa yield, once known, is a line across every track. */
function roicBars(r: Roic): { el: HTMLElement; setFloor: (baa: Baa) => void } {
  const years = r.history.slice(-8);
  const scaleMax = (floor: number) => Math.max(floor, ...years.map((y) => Math.abs(y.roic)), 0.01);
  const rows = years.map((y) => {
    const bar = h('span', { class: `roc-bar${y.roic < 0 ? ' neg' : ''}` });
    const track = h('span', { class: 'roc-track' }, bar);
    return { y, bar, track };
  });
  const paint = (floor: number) => {
    const max = scaleMax(floor);
    for (const { y, bar, track } of rows) {
      // a loss year draws its size in red rather than an empty track
      bar.style.width = `${Math.max(0, Math.min(100, (Math.abs(y.roic) / max) * 100)).toFixed(1)}%`;
      if (floor > 0) track.style.setProperty('--floor', `${((floor / max) * 100).toFixed(1)}%`);
    }
  };
  paint(0);
  const label = h('span', {});
  const key = h('div', { class: 'roc-key small muted', hidden: true }, h('i', { class: 'roc-floor-swatch', 'aria-hidden': 'true' }), label);
  const el = h(
    'div',
    { class: 'roc-bars' },
    h(
      'div',
      { role: 'list', 'aria-label': 'Return on invested capital by year' },
      ...rows.map(({ y, track }) =>
        h(
          'div',
          { class: 'roc-row', role: 'listitem', 'aria-label': `${fy(y.end)}: ${pc(y.roic, 1)} after tax`, title: `${fy(y.end)}: ${money(y.nopat)} operating profit after tax on ${money(y.capital)} invested` },
          h('span', { class: 'roc-year small muted' }, fy(y.end)),
          track,
          h('span', { class: `roc-val num small${y.roic < 0 ? ' down' : ''}` }, pc(y.roic, 0)),
        ),
      ),
    ),
    key,
  );
  return {
    el,
    setFloor: (baa) => {
      paint(baa.value / 100);
      el.classList.add('has-floor');
      key.hidden = false;
      label.textContent = `Moody’s Baa yield ${baa.value.toFixed(2)}% (what medium-grade companies pay to borrow)`;
    },
  };
}

export function roicPanel(a: Statements): HTMLElement {
  const fresh = 'currentDebt' in a.values;
  const r = fresh ? returnOnCapital(a) : null;
  const words = h('p', { class: 'small' });
  const source = h('span', {});

  let capital: HTMLElement;
  if (!fresh) capital = block('Return on invested capital', 'roic', savedBeforeUpdate(roicReady()));
  else if (!r) capital = block('Return on invested capital', 'roic', h('p', { class: 'muted small' }, 'The filings don’t show operating income and the balance sheet for two years in a row (some industries, such as oil majors and banks, don’t report an operating income line).'));
  else if ('lastShown' in r) capital = block('Return on invested capital', 'roic', h('p', { class: 'muted small' }, roicStaleWords(r)));
  else {
    const bars = roicBars(r);
    words.textContent = roicWords(r);
    // the Baa yield: its own request (FRED), painted when it arrives; never holds up the page
    engineRequest<CorpYields & { baa?: Baa | null }>('research.corpyields', {}, 30_000).then(
      (y) => {
        if (!y.baa) {
          source.textContent = ' Moody’s Baa yield couldn’t be loaded from FRED, so the borrowing-cost line isn’t shown.';
          return;
        }
        const baa = y.baa;
        bars.setFloor(baa);
        words.textContent = roicWords(r, baa);
        source.replaceChildren(' Baa yield: ', h('a', { href: `https://fred.stlouisfed.org/series/${baa.series}`, target: '_blank', rel: 'noopener' }, `Moody’s via FRED (${baa.series})`), `, ${monthYear(baa.date)}.`);
      },
      () => {
        source.textContent = ' Moody’s Baa yield couldn’t be loaded from FRED, so the borrowing-cost line isn’t shown.';
      },
    );
    capital = block(
      'Return on invested capital',
      'roic',
      h('div', { class: 'md-head' }, h('b', { class: `md-value num${r.latest.roic < 0 ? ' down' : ''}` }, pc(r.latest.roic, 1)), h('span', { class: 'muted small' }, `after tax on capital tied up in the business, ${fy(r.latest.end)}`)),
      bars.el,
      words,
      h(
        'p',
        { class: 'muted small' },
        'Operating income after tax over average invested capital (total assets less cash, short- and long-term investments and current liabilities other than debt), from the 10-K. ',
        source,
        ' A reading, not a signal.',
      ),
    );
  }

  const rd = fresh ? research(a) : null;
  const rnd = block(
    'Research as an investment',
    'rdCapital',
    ...(!fresh
      ? [savedBeforeUpdate(roicReady())]
      : !rd
        ? [h('p', { class: 'muted small' }, 'The filings don’t report research and development on a line of its own (many companies spend little on it, or include it in other costs).')]
        : 'lastShown' in rd
          ? [h('p', { class: 'muted small' }, researchStaleWords(rd))]
          : [
            h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, rd.ofSales != null ? pc(rd.ofSales, 1) : money(rd.rd)), h('span', { class: 'muted small' }, rd.ofSales != null ? `of sales spent on R&D, ${fy(rd.end)}` : `spent on R&D, ${fy(rd.end)}`)),
            h(
              'div',
              { class: 'md-facts' },
              fact('R&D', money(rd.rd), fy(rd.end)),
              ...(rd.growth5 != null ? [fact('Growth', `${pc(rd.growth5, 1, true)} a year`, 'last 5 years')] : []),
              ...(rd.adjusted != null && rd.reported != null ? [fact('Return on capital', pc(rd.adjusted, 1), `with R&D as investment (${pc(rd.reported, 1)} as reported)`)] : []),
            ),
            h('p', { class: 'small' }, researchWords(rd)),
            h('p', { class: 'muted small' }, `Research and development expense from the 10-K income statement; counted as an investment written off straight-line over ${RD_LIFE} years (Lev and Sougiannis 1996; Damodaran 1999), at the year’s tax rate. A reading, not a signal.`),
          ]),
  );

  return h(
    'section',
    { class: 'panel qe-panel roc-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Return on capital'), h('span', { class: 'muted small' }, 'Does each dollar tied up in the business earn more than borrowing costs, and how does research spending change the picture? Fiscal years from the company’s SEC filings (XBRL)')),
    h('div', { class: 'md-grid' }, capital, rnd),
  );
}
