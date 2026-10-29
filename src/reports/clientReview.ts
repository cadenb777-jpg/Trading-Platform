/**
 * The client review (Clients page): one screen per client with holdings, performance net and gross of fees, risk
 * against the client's risk tolerance, allocation drift against the target model, the income it should pay, notes,
 * and a one-click report. The maths is in review.ts (tested); this file only draws.
 */
import { dataTable, statCards } from '../ui/charts';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { tickerAttr } from '../ui/tickerCard';
import type { PriceInfo } from '../portfolio/prices';
import { describeFees, isCashOrAlt, positions, type Analysis, type Portfolio } from '../portfolio/types';
import { allocationDrift, defaultTolerance, incomeEstimate, riskFit, RISK_LEVELS, sinceStart } from './review';
import type { Client } from './types';

export interface ReviewInput {
  client: Client;
  portfolio: Portfolio;
  /** The target model for drift (null = none chosen). */
  target: Portfolio | null;
  /** Models the target can be picked from. */
  models: (Portfolio & { id: string })[];
  analysis: Analysis | null;
  analysisError?: string;
  prices: Record<string, PriceInfo>;
  /** Saves a change to the client (tolerance, target, notes) and redraws. */
  save(change: Partial<Client>): void;
}

const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `$${Math.round(v).toLocaleString('en-US')}`);
const pct = (v: number | null | undefined, d = 1, sign = false) => (v == null || !Number.isFinite(v) ? '—' : `${sign && v >= 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%`);
const tone = (v: number | null | undefined): '' | 'up' | 'down' => (v == null ? '' : v >= 0 ? 'up' : 'down');

/** The account's value: live (shares or dollars), else modelled from the initial investment and the growth line. */
function accountValue(i: ReviewInput, liveTotal: number | null): { value: number | null; modelled: boolean } {
  if (liveTotal != null) return { value: liveTotal, modelled: false };
  const g = i.analysis?.growth;
  if (g?.length && i.client.initialInvestment) return { value: i.analysis?.fees?.endValueNet ?? (i.client.initialInvestment * g[g.length - 1].value) / g[0].value, modelled: true };
  return { value: null, modelled: true };
}

export function drawClientReview(box: HTMLElement, i: ReviewInput) {
  const { client: c, portfolio, analysis: a } = i;
  const priceOf = Object.fromEntries(Object.entries(i.prices).map(([k, v]) => [k, v.price]));
  const pos = positions(portfolio, priceOf);
  const { value: total, modelled } = accountValue(i, pos.total);
  const valueOf = (w: number, v: number | null) => v ?? (total != null ? w * total : null);

  // ----- performance (net and gross of fees) -----
  const t = a?.trailing;
  const g = a?.gross?.trailing;
  const since = sinceStart(a, c.initialInvestment);
  const kpis = statCards([
    {
      label: modelled ? 'Account value (modelled)' : 'Account value',
      value: money(total),
      hint: modelled
        ? `${c.initialInvestment ? `${money(c.initialInvestment)} invested ${a?.start ?? ''} grown at the model’s returns, net of fees${since?.years ? ` (${since.years.toFixed(1)} years)` : ''}` : 'From the model’s returns'}: the model has no share amounts`
        : `Live prices · ${portfolio.name}`,
    },
    {
      label: 'Since start, net · per year (annualised)',
      value: t?.inception.portfolio != null ? `${pct(t.inception.portfolio, 1, true)}/yr` : '—',
      tone: tone(t?.inception.portfolio),
      hint: [
        since?.cumulative != null ? `${pct(since.cumulative, 1, true)} in all${since.years ? ` over ${since.years.toFixed(1)} years` : ''}${a?.start ? ` (from ${a.start})` : ''}` : '',
        g ? `gross ${pct(g.inception, 1, true)}/yr before fees` : 'no fee applied',
      ].filter(Boolean).join(' · '),
    },
    { label: 'YTD, net', value: pct(t?.ytd.portfolio, 1, true), tone: tone(t?.ytd.portfolio), hint: g ? `Gross ${pct(g.ytd, 1, true)} · benchmark ${pct(t?.ytd.benchmark, 1, true)}` : `Benchmark ${pct(t?.ytd.benchmark, 1, true)}` },
    { label: '1 year, net', value: pct(t?.['1y'].portfolio, 1, true), tone: tone(t?.['1y'].portfolio), hint: g ? `Gross ${pct(g['1y'], 1, true)}` : '' },
    { label: 'Fees paid', value: money(a?.fees?.total), hint: a?.fees?.effectiveRate != null ? `${pct(a.fees.effectiveRate, 2)} a year effective · ${c.feeSchedule ? describeFees(c.feeSchedule) : `${pct(c.fee, 2)} a year`}` : 'Since the start date' },
  ]);

  // ----- risk vs tolerance -----
  const level = c.riskTolerance ?? defaultTolerance(c.objective);
  const vol = a?.stats.volatility ?? null;
  const fit = vol != null ? riskFit(vol, level) : null;
  const tolSelect = h('select', { class: 'input', 'aria-label': 'Risk tolerance' }, ...RISK_LEVELS.map((r) => h('option', { value: r.level, selected: r.level === level }, `${r.level} · ${r.label}`))) as HTMLSelectElement;
  tolSelect.addEventListener('change', () => i.save({ riskTolerance: Number(tolSelect.value) as Client['riskTolerance'] }));
  const scaleMax = 0.25;
  const band = RISK_LEVELS.find((r) => r.level === level)!;
  const bar = h(
    'div',
    { class: 'rv-scale', role: 'img', 'aria-label': fit ? fit.text : 'Volatility not available yet' },
    ...RISK_LEVELS.map((r) => h('span', { class: `rv-seg${r.level === level ? ' on' : ''}`, style: `flex:${(Math.min(r.max ?? scaleMax, scaleMax) - r.min) / scaleMax}`, title: `${r.level} ${r.label}: ${pct(r.min, 0)}${r.max != null ? `-${pct(r.max, 0)}` : '+'} a year` }, String(r.level))),
    vol != null ? h('i', { class: `rv-mark ${fit?.status}`, style: `left:${Math.min(vol / scaleMax, 1) * 100}%`, title: `This portfolio: ${pct(vol)} a year` }) : '',
  );
  const risk = h(
    'section',
    { class: 'panel rv-card' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Risk vs tolerance', infoTip('volatility')), h('span', { class: 'spacer' }), h('label', { class: 'small muted rv-inline' }, 'Tolerance ', tolSelect)),
    bar,
    h('p', { class: `small rv-fit ${fit?.status ?? ''}` }, fit ? h('b', {}, fit.status === 'within' ? 'Within tolerance. ' : fit.status === 'above' ? 'Above tolerance. ' : 'Below tolerance. ') : '', fit?.text ?? (i.analysisError ? `Risk isn’t available: ${i.analysisError}` : 'Working out the risk…')),
    a
      ? h('div', { class: 'rv-facts small' },
          h('span', {}, 'Max drawdown ', h('b', { class: 'down' }, pct(a.stats.maxDrawdown))),
          h('span', {}, 'Beta ', h('b', {}, a.stats.beta != null ? a.stats.beta.toFixed(2) : '—')),
          h('span', {}, 'Worst month ', h('b', { class: 'down' }, pct(a.stats.worstMonth))),
          h('span', { class: 'muted' }, `Band ${pct(band.min, 0)}${band.max != null ? `-${pct(band.max, 0)}` : '+'} a year`))
      : '',
  );

  // ----- allocation drift vs target -----
  const byClass = new Map<string, number>();
  for (const r of pos.rows) {
    const v = valueOf(r.weight, r.value);
    if (v != null && v > 0) byClass.set(r.holding.assetClass, (byClass.get(r.holding.assetClass) ?? 0) + v);
  }
  const targetSelect = h(
    'select',
    { class: 'input', 'aria-label': 'Target model' },
    h('option', { value: '' }, 'Choose a target model…'),
    ...i.models.filter((m) => m.id !== c.portfolioId || (portfolio.mode ?? 'weight') === 'weight').map((m) => h('option', { value: m.id, selected: m.id === (i.target as { id?: string } | null)?.id }, m.name)),
  ) as HTMLSelectElement;
  targetSelect.addEventListener('change', () => i.save({ targetId: targetSelect.value || undefined }));
  let driftBody: Node;
  if (!i.target) {
    driftBody = h('p', { class: 'muted small' }, 'Pick the model this account should match to see how far it has drifted and what to trade to rebalance.');
  } else if ((portfolio.mode ?? 'weight') === 'weight' && i.target === portfolio) {
    driftBody = h('p', { class: 'muted small' }, 'This account is entered as target weights, so it can’t drift. Enter it as shares or dollars (Portfolios) to track drift against this model.');
  } else {
    const tgt = new Map<string, number>();
    for (const r of positions(i.target, priceOf).rows) tgt.set(r.holding.assetClass, (tgt.get(r.holding.assetClass) ?? 0) + r.weight);
    const d = allocationDrift([...byClass].map(([label, value]) => ({ label, value })), [...tgt].map(([label, weight]) => ({ label, weight })));
    driftBody = h(
      'div',
      {},
      h('p', { class: `small rv-fit ${d.outside ? 'above' : 'within'}` }, h('b', {}, d.outside ? `${d.outside} asset class${d.outside === 1 ? '' : 'es'} outside ±5 points. ` : 'On target. '), `Largest drift ${(d.maxDrift * 100).toFixed(1)} points.`),
      dataTable(
        ['Asset class', 'Now', 'Target', 'Drift', 'To rebalance'],
        d.rows.map((r) => [
          { v: r.label, cls: 'label' },
          { v: pct(r.current), cls: 'num' },
          { v: pct(r.target), cls: 'num' },
          { v: `${r.drift >= 0 ? '+' : '−'}${Math.abs(r.drift * 100).toFixed(1)} pts`, cls: `num ${r.status === 'ok' ? '' : 'warn'}` },
          { v: r.trade == null || Math.abs(r.trade) < 1 ? '—' : `${r.trade > 0 ? 'Buy' : 'Sell'} ${money(Math.abs(r.trade))}`, cls: 'num' },
        ]),
        undefined,
        false,
      ),
    );
  }
  const drift = h('section', { class: 'panel rv-card' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Allocation vs target'), h('span', { class: 'spacer' }), targetSelect), driftBody);

  // ----- holdings and income -----
  const incomeRows = pos.rows.map((r) => {
    const x = r.holding;
    const v = valueOf(r.weight, r.value) ?? 0;
    const info = i.prices[x.symbol.trim().toUpperCase()];
    return { symbol: x.kind === 'cash' ? 'Cash' : x.symbol, value: v, yld: x.yield ?? (isCashOrAlt(x) ? null : (info?.yield ?? null)), r };
  });
  const inc = incomeEstimate(incomeRows);
  const holdings = h(
    'section',
    { class: 'panel rv-card rv-wide' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Holdings'), h('span', { class: 'muted small' }, `${portfolio.name}${modelled ? ' · values modelled from weights' : ''}`)),
    dataTable(
      ['Holding', 'Class', 'Value', 'Weight', 'Yield', 'Est. income'],
      incomeRows
        .filter((x) => x.r.weight > 0)
        .sort((p, q) => q.value - p.value)
        .map((x) => [
          { v: x.r.holding.kind === 'security' || !x.r.holding.kind ? h('b', tickerAttr(x.r.holding.symbol), x.r.holding.symbol) : x.r.holding.name || x.symbol, cls: 'label' },
          x.r.holding.assetClass,
          { v: money(x.value), cls: 'num' },
          { v: pct(x.r.weight), cls: 'num' },
          { v: x.yld != null ? pct(x.yld, 2) : '—', cls: 'num' },
          { v: x.yld != null ? money(x.value * x.yld) : '—', cls: 'num' },
        ]),
      undefined,
      { id: 'clients:review-holdings' },
    ),
  );
  const income = h(
    'section',
    { class: 'panel rv-card' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Upcoming income'), h('span', { class: 'muted small' }, 'next 12 months')),
    h('div', { class: 'rv-income' }, h('div', {}, h('span', { class: 'muted tiny' }, 'Estimated'), h('b', { class: 'num' }, money(inc.annual))), h('div', {}, h('span', { class: 'muted tiny' }, 'A month'), h('b', { class: 'num' }, money(inc.monthly))), h('div', {}, h('span', { class: 'muted tiny' }, 'Yield'), h('b', { class: 'num' }, pct(inc.yield, 2)))),
    inc.top.length ? h('p', { class: 'small' }, 'Biggest payers: ', inc.top.map((x) => `${x.symbol} ${money(x.income)}`).join(' · ')) : h('p', { class: 'muted small' }, 'No yields known for these holdings yet.'),
    h('p', { class: 'muted tiny' }, `From current dividend yields and cash rates${inc.unknown.length ? `; no yield for ${inc.unknown.slice(0, 3).join(', ')}` : ''}. Actual payments differ.`),
  );

  // ----- notes -----
  const notes = h('textarea', { class: 'input', rows: 4, placeholder: 'Meeting notes, goals, things to follow up…', 'aria-label': 'Client notes' }) as HTMLTextAreaElement;
  notes.value = c.notes ?? '';
  const saveNotes = h('button', { class: 'btn small', onclick: () => i.save({ notes: notes.value.trim(), notesUpdated: new Date().toISOString().slice(0, 10) }) }, 'Save note');
  const last = c.reports?.length ? c.reports[c.reports.length - 1] : null;
  const notesCard = h(
    'section',
    { class: 'panel rv-card' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Notes'), c.notesUpdated ? h('span', { class: 'muted small' }, `updated ${c.notesUpdated}`) : '', h('span', { class: 'spacer' }), saveNotes),
    notes,
    h('p', { class: 'muted tiny' }, last ? `Last report ${last.generated} (data as of ${last.asOf}) · ${c.reports!.length} on record.` : 'No report generated yet.'),
  );

  box.replaceChildren(
    kpis,
    a?.priceOnly?.length ? h('p', { class: 'muted tiny' }, `Price-only returns (no dividend data) for ${a.priceOnly.join(', ')}.`) : '',
    i.analysisError ? h('div', { class: 'ap-error' }, i.analysisError) : '',
    h('div', { class: 'rv-grid' }, risk, drift, holdings, income, notesCard),
  );
}
