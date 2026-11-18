/**
 * Research overview: Against bonds = the stock's earnings yield beside the 10-year real Treasury yield (two bars on one
 * scale, the gap as the headline). The yield comes from research.corpyields (helper 85 adds DFII10), its own request
 * painted when it arrives; maths in againstBonds.ts.
 */
import { engineRequest, realYieldReady } from '../data/schwab';
import { h } from '../ui/dom';
import { block, rateBars, savedBeforeUpdate } from './panelBlock';
import type { CorpYields } from './obligations';
import { againstBonds, againstWords, noEarningsWords } from './againstBonds';

/** pe: the tear sheet's own P/E (the filings' earnings over the price, else Schwab's). */
export function againstBondsPanel(pe: number | null | undefined): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Loading today’s real Treasury yield from FRED…'));
  const section = h(
    'section',
    { class: 'panel qe-panel ab-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Against bonds'), h('span', { class: 'muted small' }, 'What the stock earns per dollar of its price against what an inflation-protected Treasury pays')),
    block('Earnings yield vs the real bond yield', 'earningsVsReal', body),
  );
  if (!realYieldReady()) {
    body.replaceChildren(savedBeforeUpdate(false));
    return section;
  }
  engineRequest<CorpYields>('research.corpyields', {}, 30_000).then(
    (y) => {
      // a reply saved before the helper update has no real10 at all (FRED failing sends null)
      if (!('real10' in y)) {
        body.replaceChildren(savedBeforeUpdate(true));
        return;
      }
      const r = y.real10;
      if (!r) {
        body.replaceChildren(h('p', { class: 'muted small' }, 'The 10-year real Treasury yield couldn’t be loaded from FRED right now.'));
        return;
      }
      const x = againstBonds(pe, r);
      const source = h(
        'p',
        { class: 'muted small' },
        `Earnings yield = 1 ÷ P/E (diluted earnings over the last twelve months from SEC filings, over the price when this company’s figures were loaded: at most 5 minutes ago, Refresh updates it). Real yield: `,
        h('a', { href: `https://fred.stlouisfed.org/series/${r.series}`, target: '_blank', rel: 'noopener' }, `10-year TIPS via FRED (${r.series})`),
        '. Asness (2003) on comparing earnings with the real, not the nominal, yield. A reading, not a signal.',
      );
      if (!x) {
        body.replaceChildren(h('p', { class: 'small' }, noEarningsWords), source);
        return;
      }
      body.replaceChildren(
        h('div', { class: 'md-head' }, h('b', { class: 'md-value num' }, `${x.gap > 0 ? '+' : x.gap < 0 ? '−' : ''}${Math.abs(x.gap * 100).toFixed(1)} pts`), h('span', { class: 'muted small' }, 'earnings yield over the real 10-year yield')),
        rateBars([{ label: 'Stock earns', rate: x.earningsYield, kind: 'one' }, { label: 'Real bond pays', rate: x.real, kind: 'two' }], 'Earnings yield and real Treasury yield', 2),
        h('p', { class: 'small' }, againstWords(x, r)),
        source,
      );
    },
    () => body.replaceChildren(h('p', { class: 'muted small' }, 'The 10-year real Treasury yield couldn’t be loaded from FRED right now.')),
  );
  return section;
}
