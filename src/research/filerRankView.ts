/**
 * Research overview: Among US companies = each reading's rank among every US SEC filer with $100 million or more of
 * assets (one row per reading: value, a 0-100 percentile track with the middle half shaded, plain words). Its own
 * request (research.filerrank, helper 88), painted when it arrives; maths in filerRank.ts and engine/filerrank.py.
 */
import { engineRequest, filerRankReady } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { day } from './debtDilution';
import { block, savedBeforeUpdate } from './panelBlock';
import { METRICS, missingWords, placeWords, standsOut, summaryWords, type FilerRank, type MetricInfo, type Ranked } from './filerRank';

function track(m: MetricInfo, r: Ranked): HTMLElement {
  const at = Math.max(0, Math.min(100, r.percentile));
  return h(
    'span',
    {
      class: 'fr-track',
      role: 'img',
      'aria-label': `${m.label}: ${m.format(r.value)}, ${placeWords(r)} US companies. Middle half of companies from ${m.format(r.p25)} to ${m.format(r.p75)}, median ${m.format(r.median)}.`,
      title: `Middle half of companies: ${m.format(r.p25)} to ${m.format(r.p75)} · median ${m.format(r.median)}`,
    },
    h('span', { class: 'fr-mid' }),
    h('span', { class: 'fr-median' }),
    h('span', { class: `fr-dot${standsOut(r) ? ' out' : ''}`, style: `left:${at.toFixed(1)}%` }),
  );
}

function row(m: MetricInfo, r: Ranked | null | undefined): HTMLElement {
  return h(
    'div',
    { class: 'fr-row', role: 'listitem' },
    h('span', { class: 'fr-label' }, m.label, infoTip(m.term)),
    h('b', { class: 'fr-value num' }, r ? m.format(r.value) : '—'),
    r ? track(m, r) : h('span', { class: 'fr-track empty', 'aria-hidden': 'true' }),
    h('span', { class: 'fr-words small muted' }, r ? `${placeWords(r)} · median ${m.format(r.median)}` : missingWords),
  );
}

export function filerRankPanel(cik: number | string | null | undefined): HTMLElement {
  const body = h('div', {}, h('p', { class: 'muted small' }, 'Ranking against every US company in the SEC’s files…'));
  const section = h(
    'section',
    { class: 'panel qe-panel fr-panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Among US companies'), h('span', { class: 'muted small' }, 'Each reading ranked against every US company that files with the SEC, not only against its own past')),
    block('Where it ranks', 'filerRank', body),
  );
  if (!filerRankReady()) {
    body.replaceChildren(savedBeforeUpdate(false));
    return section;
  }
  if (cik == null || cik === '') {
    body.replaceChildren(h('p', { class: 'muted small' }, 'No SEC number for this company, so it can’t be ranked.'));
    return section;
  }
  const failed = () => body.replaceChildren(h('p', { class: 'muted small' }, 'The SEC’s yearly files for every company couldn’t be loaded right now. Refresh to try again.'));
  engineRequest<FilerRank>('research.filerrank', { cik: Number(cik) }, 90_000).then((f) => {
    if (!f.company) {
      body.replaceChildren(h('p', { class: 'muted small' }, `This company isn’t in the SEC’s files for ${f.year} or ${f.year - 1} yet (no net income or operating cash flow for a fiscal year that fits either), so it can’t be ranked.`));
      return;
    }
    const sources = h(
      'p',
      { class: 'muted small' },
      `Fiscal year ending ${day(f.company.end)}, from the SEC’s XBRL frames for ${f.year} (`,
      ...(f.frames ?? []).flatMap((u, i) => [i ? ', ' : '', h('a', { href: u, target: '_blank', rel: 'noopener' }, u.split('/').slice(-3, -2)[0])]),
      `; refreshed weekly). Field: every filer with total assets of $${Math.round(f.minAssets / 1e6)} million or more at its year-end, all industries together; each reading needs the company to tag the lines it uses. Rank = share of the other companies below, ties counted half. Readings, not signals.`,
    );
    body.replaceChildren(
      h('p', { class: 'small' }, summaryWords(f)),
      ...(f.company.small ? [h('p', { class: 'muted small' }, `This company has less than $${Math.round(f.minAssets / 1e6)} million of assets, so it is ranked against a field of bigger companies.`)] : []),
      h('div', { class: 'fr-list', role: 'list', 'aria-label': 'Readings ranked among US companies' }, h('div', { class: 'fr-axis small muted', 'aria-hidden': 'true' }, h('span', {}), h('span', {}), h('span', { class: 'fr-axis-scale' }, h('span', {}, 'lowest'), h('span', {}, 'middle half'), h('span', {}, 'highest')), h('span', {})), ...METRICS.map((m) => row(m, f.metrics[m.key]))),
      sources,
    );
  }, failed);
  return section;
}
