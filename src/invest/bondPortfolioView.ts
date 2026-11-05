/**
 * Bonds > Bond calculator: a small portfolio of bonds with its duration, convexity, dollar DV01 and key-rate
 * durations against today's Treasury curve (FRED). The maths is in bondRisk.ts (tested).
 */
import { dataTable, money, numberField, statCards } from '../ui/charts';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import type { CurvePoint } from '../ui/yieldCurve';
import { labelYears } from './bonds';
import { portfolioKeyRates, portfolioRisk, type BondPosition } from './bondRisk';

const DEFAULTS: BondPosition[] = [
  { name: '2-year Treasury', face: 25000, coupon: 0.04, years: 2, frequency: 2, yield: 0.039 },
  { name: '5-year corporate', face: 25000, coupon: 0.05, years: 5, frequency: 2, yield: 0.048 },
  { name: '10-year Treasury', face: 25000, coupon: 0.0425, years: 10, frequency: 2, yield: 0.042 },
  { name: '20-year zero', face: 25000, coupon: 0, years: 20, frequency: 0, yield: 0.046 },
];

const keyLabel = (k: number) => (k < 1 ? `${Math.round(k * 12)}M` : `${k}Y`);

export function bondPortfolioPanel(loadCurve: () => Promise<CurvePoint[]>) {
  const bonds = DEFAULTS.map((b) => ({ ...b }));
  const rowsBox = h('div', { class: 'qp-bonds' });
  const out = h('div', {});
  const krd = h('div', {}, h('div', { class: 'muted pad' }, 'Loading the Treasury curve…'));
  let curve: { years: number; yield: number }[] | null = null;
  let curveDate = '';

  function drawRows() {
    rowsBox.replaceChildren(
      ...bonds.map((b, k) =>
        h(
          'div',
          { class: 'qp-bond' },
          h('input', { class: 'input', value: b.name, 'aria-label': 'Bond name', oninput: (e: Event) => ((b.name = (e.target as HTMLInputElement).value), update()) }),
          numberField('Face ($)', b.face, (v) => ((b.face = Math.max(0, v)), update()), { step: 1000 }),
          numberField('Coupon', b.coupon, (v) => ((b.coupon = Math.max(0, v)), (b.frequency = v > 0 ? b.frequency || 2 : 0), update()), { percent: true, step: 0.125 }),
          numberField('Years', b.years, (v) => ((b.years = Math.max(0.25, v)), update()), { step: 0.25 }),
          numberField('Yield', b.yield, (v) => ((b.yield = v), update()), { percent: true, step: 0.05 }),
          h('button', { class: 'btn small', 'aria-label': `Remove ${b.name}`, onclick: () => (bonds.splice(k, 1), drawRows(), update()) }, 'Remove'),
        ),
      ),
      h('button', { class: 'btn small', onclick: () => (bonds.push({ name: `Bond ${bonds.length + 1}`, face: 10000, coupon: 0.045, years: 7, frequency: 2, yield: 0.045 }), drawRows(), update()) }, 'Add bond'),
    );
  }

  function update() {
    const live = bonds.filter((b) => b.face > 0 && b.years > 0);
    if (!live.length) {
      out.replaceChildren(h('p', { class: 'muted' }, 'Add a bond with a face amount.'));
      krd.replaceChildren();
      return;
    }
    const r = portfolioRisk(live);
    out.replaceChildren(
      statCards([
        { label: 'Market value', value: money(r.marketValue), hint: 'Including accrued interest' },
        { label: 'Modified duration', value: r.modifiedDuration.toFixed(2), hint: '% the portfolio moves for a 1% parallel move in yields (value-weighted)' },
        { label: 'Macaulay duration', value: `${r.macaulayDuration.toFixed(2)} yrs` },
        { label: 'Convexity', value: r.convexity.toFixed(1) },
        { label: 'DV01', value: money(r.dv01), hint: 'Dollar change for a 0.01% move in all yields' },
        { label: 'If yields rise 1%', value: money(-r.marketValue * (r.modifiedDuration * 0.01 - 0.5 * r.convexity * 0.0001)), tone: 'down', hint: 'Duration and convexity estimate' },
      ]),
      dataTable(
        ['Bond', 'Value', 'Weight', 'Mod. duration', 'Convexity', 'DV01'],
        r.rows.map((x) => [{ v: x.name, cls: 'label' }, money(x.value), `${(x.weight * 100).toFixed(1)}%`, x.modifiedDuration.toFixed(2), x.convexity.toFixed(1), money(x.dv01)]),
        undefined,
        false,
      ),
    );
    if (!curve) return;
    const k = portfolioKeyRates(live, curve);
    const max = Math.max(0.01, ...k.durations.map(Math.abs));
    krd.replaceChildren(
      h(
        'div',
        { class: 'qp-krd' },
        ...k.keys.map((key, i) =>
          h(
            'div',
            { class: 'qp-krdcol', title: `${keyLabel(key)}: ${k.durations[i].toFixed(3)} (a 1% rise in only the ${keyLabel(key)} rate costs about ${money(r.marketValue * k.durations[i] * 0.01)})` },
            h('span', { class: 'qp-krdbar' }, h('i', { style: `height:${(Math.abs(k.durations[i]) / max) * 100}%` })),
            h('span', { class: 'qp-krdval' }, k.durations[i].toFixed(2)),
            h('span', { class: 'muted small' }, keyLabel(key)),
          ),
        ),
      ),
      dataTable(
        ['Bond', ...k.keys.map(keyLabel), 'Total'],
        [
          ...live.map((b, i) => [{ v: b.name, cls: 'label' }, ...k.perBond[i].durations.map((x) => (Math.abs(x) < 0.005 ? '' : x.toFixed(2))), k.perBond[i].effective.toFixed(2)]),
          [{ v: h('b', {}, 'Portfolio'), cls: 'label' }, ...k.durations.map((x) => h('b', {}, x.toFixed(2))), h('b', {}, k.effective.toFixed(2))],
        ],
        (i) => (i === live.length ? 'total' : ''),
        false,
      ),
      h('p', { class: 'muted small' }, `Each bond is priced off the Treasury curve (${curveDate ? `FRED, ${curveDate}` : 'FRED'}) plus its own constant spread; one key rate at a time is moved 0.01% with the move fading to zero at the neighbouring keys. The key rates add up to the effective duration.`),
    );
  }

  drawRows();
  update();
  loadCurve().then(
    (pts) => {
      curve = pts.map((p) => ({ years: labelYears(p.label) ?? NaN, yield: p.now / 100 })).filter((p) => Number.isFinite(p.years) && Number.isFinite(p.yield));
      curveDate = pts[0]?.date ?? '';
      if (curve.length < 3) {
        curve = null;
        krd.replaceChildren(h('p', { class: 'muted' }, 'The Treasury curve has too few points for key-rate durations.'));
        return;
      }
      update();
    },
    (err) => krd.replaceChildren(h('div', { class: 'ap-error' }, `Key-rate durations need the Treasury curve: ${(err as Error).message}`)),
  );

  return [
    h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Bond portfolio: duration and convexity'), h('span', { class: 'muted small' }, 'Your own bonds; change any number')),
      rowsBox,
      out,
    ),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Key-rate durations ', infoTip('keyRateDuration')), h('span', { class: 'muted small' }, 'Where on the Treasury curve the rate risk sits')), krd),
  ];
}
