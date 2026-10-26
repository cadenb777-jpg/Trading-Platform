/**
 * The Account page's risk card (live weights, the helper's volatility / beta / value-at-risk / drawdown, a click-to-open
 * detail per position, the sector bars) and the folded Taxes section. Maths in ./risk.ts.
 */
import { pct, pctU, statCards } from '../ui/charts';
import { h } from '../ui/dom';
import { infoTip, termLabel } from '../ui/glossary';
import { concentration, dividendsThisYear, groupOf, sectorBreakdown, varDollars, warnings, type RiskInput, type RiskReport, type TaxReport, type TaxRow, type TaxType } from './risk';

const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
const signed = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${usd(Math.abs(v))}`);
const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const time = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * The live risk card. `update(rows)` redraws the live parts (weights, warnings, the dollar bad-day loss) from new
 * prices; the year-based figures come from the helper once per page load. `onSector` filters the holdings list.
 */
export function riskCard(report: RiskReport | null, error: string | null, onSector: (label: string | null) => void) {
  let rows: RiskInput[] = [];
  let picked: string | null = null;
  let sectorPicked: string | null = null;
  const stamp = h('span', { class: 'muted small' });
  const stats = h('div', { class: 'acct-stats' });
  const warn = h('div', { class: 'risk-warn' });
  const list = h('div', { class: 'risk-list', role: 'list' });
  const detail = h('div', { class: 'risk-detail', 'aria-live': 'polite' });
  const sectorsEl = h('div', { class: 'alloc-list risk-sectors' });
  const sectors = report?.sectors ?? {};

  function draw() {
    const c = concentration(rows);
    const s = report?.stats;
    const bad = report ? varDollars(report, rows) : null;
    const held = c.weights.length;
    stats.replaceChildren(
      statCards([
        { label: 'Largest position', value: c.largest ? `${c.largest.symbol} ${pctU(c.largest.weight, 1)}` : '—', hint: 'Its share of the money in this view (cash included in the total)' },
        { label: 'Top 5 holdings', value: pctU(c.top5, 0), hint: 'The five largest positions together' },
        { label: termLabel('Effective holdings', 'effholdings'), value: c.effective != null ? `${num(c.effective, 1)} of ${held}` : '—', hint: 'How many equal-sized holdings your mix behaves like' },
        { label: termLabel('Volatility (1 yr)', 'volatility'), value: pctU(s?.volatility, 1), hint: s ? 'Yearly swing; the S&P 500 is usually 15–20%' : (report?.note ?? error ?? '') },
        { label: termLabel('Beta vs SPY', 'beta'), value: num(s?.beta), hint: s?.beta != null ? `When SPY moves 1%, this money moved about ${num(s.beta)}%` : '' },
        {
          label: termLabel('Bad-day loss', 'var'),
          value: bad != null ? usd(bad) : '—',
          tone: bad ? 'down' : '',
          hint: bad != null ? `On a bad day (1 in 20), you could lose about ${usd(bad)} (${pctU(s?.var95, 1)})` : '',
        },
        { label: termLabel('Max drawdown (1 yr)', 'drawdown'), value: pct(s?.maxDrawdown, 1), tone: s ? 'down' : '', hint: s ? `High ${s.peak} → low ${s.trough}` : '' },
      ]),
    );
    const w = warnings(rows, sectors);
    warn.replaceChildren(...w.map((t) => h('p', { class: 'badge warn risk-badge' }, t)));
    const max = Math.max(1e-9, ...c.weights.map((x) => x.weight));
    list.replaceChildren(
      ...c.weights.map((x) =>
        h(
          'button',
          {
            type: 'button',
            role: 'listitem',
            class: `risk-row${picked === x.symbol ? ' active' : ''}`,
            'aria-expanded': picked === x.symbol,
            title: `${x.symbol}: ${usd(x.value)} · click for its own risk`,
            onclick: () => {
              picked = picked === x.symbol ? null : x.symbol;
              draw();
            },
          },
          h('b', { class: 'risk-sym' }, x.symbol),
          h('span', { class: 'alloc-track' }, h('span', { class: `alloc-fill${x.weight > 0.2 && sectors[x.symbol]?.sector !== 'Fund' ? ' over' : ''}`, style: `width:${(x.weight / max) * 100}%` })),
          h('span', { class: 'num' }, pctU(x.weight, 1)),
          h('span', { class: 'muted small risk-sector' }, sectorLabel(x.symbol)),
        ),
      ),
    );
    detail.replaceChildren(picked ? positionDetail(picked, c.weights.find((x) => x.symbol === picked)?.weight ?? null) : '');
    const groups = sectorBreakdown(rows, sectors);
    const gmax = Math.max(1e-9, ...groups.map((g) => g.weight));
    sectorsEl.replaceChildren(
      ...groups.map((g) =>
        h(
          'button',
          {
            type: 'button',
            class: `alloc-row risk-sector-row${sectorPicked === g.label ? ' active' : ''}`,
            'aria-pressed': sectorPicked === g.label,
            title: `${g.label}: ${usd(g.value)} (${g.symbols.join(', ')}) · click to show only these holdings`,
            onclick: () => {
              sectorPicked = sectorPicked === g.label ? null : g.label;
              onSector(sectorPicked);
              draw();
            },
          },
          h('span', { class: 'alloc-label' }, g.label),
          h('span', { class: 'alloc-track' }, h('span', { class: `alloc-fill${g.weight > 0.35 && !['Funds', 'Cash', 'Other'].includes(g.label) ? ' over' : ''}`, style: `width:${(g.weight / gmax) * 100}%` })),
          h('span', { class: 'alloc-value num' }, pctU(g.weight, 1)),
        ),
      ),
    );
    stamp.textContent = `Live prices · updated ${time()}`;
  }

  function sectorLabel(symbol: string) {
    const s = sectors[symbol];
    if (!s) return rows.some((r) => r.symbol === symbol && r.kind === 'alt') ? 'Alternative' : '';
    if (s.sector === 'Fund') return s.fundType ? `Fund · ${s.fundType}` : 'Fund';
    return s.sector;
  }

  function positionDetail(symbol: string, weight: number | null) {
    const a = report?.assets[symbol];
    const s = sectors[symbol];
    const why = !a
      ? report?.missing.includes(symbol)
        ? 'Less than a year of daily prices, so it’s left out of the risk figures.'
        : rows.some((r) => r.symbol === symbol && r.kind === 'alt')
          ? 'An alternative investment has no daily prices, so it’s left out of the risk figures.'
          : (report?.note ?? error ?? 'No risk figures yet.')
      : `${symbol} is ${pctU(weight, 1)} of the money and ${pctU(a.riskShare, 0)} of the swings${a.riskShare > (weight ?? 0) * 1.3 ? ': it moves more than the rest' : a.riskShare < (weight ?? 0) * 0.7 ? ': it calms the mix' : ''}.`;
    return h(
      'div',
      { class: 'risk-detail-box' },
      h('div', { class: 'acct-card-head' }, h('b', {}, symbol), h('span', { class: 'muted small' }, s ? `${sectorLabel(symbol)}${s.industry ? ` · ${s.industry}` : ''}${s.sic ? ` (SEC SIC ${s.sic})` : ''}` : '')),
      a
        ? statCards([
            { label: termLabel('Volatility', 'volatility'), value: pctU(a.volatility, 1), hint: 'Its own yearly swing' },
            { label: termLabel('Beta', 'beta'), value: num(a.beta), hint: 'Its move when SPY moves 1%' },
            { label: termLabel('Share of risk', 'riskshare'), value: pctU(a.riskShare, 1), hint: `Weight ${pctU(weight, 1)}` },
          ])
        : '',
      h('p', { class: 'muted small' }, why),
    );
  }

  const notes = h('div', { class: 'ap-note' });
  const say: string[] = [];
  if (report?.stats) say.push(`Risk figures use daily closes from ${report.stats.start} to ${report.stats.end}, as if today’s holdings were held all year; cash counts as zero risk.`);
  if (report?.missing.length) say.push(`Left out (less than a year of prices): ${report.missing.join(', ')}.`);
  if (report?.alts.length) say.push(`Left out (no daily prices): ${report.alts.join(', ')}.`);
  if (report?.note) say.push(report.note);
  if (error) say.push(`Risk figures unavailable: ${error}`);
  say.push('Sectors come from each company’s SEC industry code; funds are labelled from their name (not looked through); unknown = Other.');
  if (report?.sectorNote) say.push(report.sectorNote);
  notes.textContent = say.join(' ');

  const el = h(
    'section',
    { class: 'panel risk-card' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Risk'), stamp),
    stats,
    warn,
    h(
      'div',
      { class: 'acct-alloc' },
      h('div', {}, h('h4', {}, 'Positions ', h('span', { class: 'muted small' }, '(click one for its risk)')), list, detail),
      h('div', {}, h('h4', {}, 'By sector ', h('span', { class: 'muted small' }, '(click to filter holdings)')), sectorsEl),
    ),
    notes,
  );
  return {
    el,
    update(next: RiskInput[]) {
      rows = next;
      draw();
    },
    /** Clears the sector filter (e.g. from the holdings list's "Show all"). */
    clearSector() {
      sectorPicked = null;
      draw();
    },
  };
}

/** Which sector group a holding is in (for filtering the holdings list). */
export const holdingGroup = groupOf;

const TERM_TEXT: Record<TaxRow['term'], (r: TaxRow) => string> = {
  short: () => 'Short-term (bought in the last 31 days)',
  mixed: (r) => `${+(r.recentShares ?? 0).toFixed(4)} sh short-term (last 31 days); rest unknown`,
  unknown: () => 'Holding period unknown',
};

/**
 * The folded Taxes section. `setType` saves the owner's choice of an account's tax type. `divs` are the dividends
 * report's holdings (per-share payments) and `taxableShares` the shares held in taxable accounts.
 */
export function taxSection(
  report: TaxReport | null,
  error: string | null,
  accounts: { id: string; name: string; auto?: TaxType; chosen: TaxType | undefined }[],
  setType: (id: string, type: TaxType | undefined) => void,
  divs: { holdings: Parameters<typeof dividendsThisYear>[0] } | null,
  taxableShares: Record<string, number>,
) {
  const body = h('div', { class: 'tax-body' });
  const typeSelect = (a: (typeof accounts)[number]) => {
    const sel = h(
      'select',
      { class: 'input small', 'aria-label': `Tax type of ${a.name}` },
      ...[
        ['', a.auto ? `Auto (${TYPE_SHORT[a.auto]})` : 'Auto'],
        ['roth', 'Roth (tax-free)'],
        ['deferred', 'Traditional IRA (tax-deferred)'],
        ['taxable', 'Taxable (cash / margin)'],
      ].map(([v, label]) => h('option', { value: v, selected: (a.chosen ?? '') === v }, label)),
    );
    sel.addEventListener('change', () => setType(a.id, (sel.value || undefined) as TaxType | undefined));
    return sel;
  };
  if (!report) body.append(h('div', { class: 'ap-error' }, error ?? 'Tax view unavailable.'));
  else {
    body.append(
      h(
        'div',
        { class: 'acct-cards' },
        ...report.groups.map((g) =>
          h(
            'div',
            { class: 'acct-card' },
            h('div', { class: 'acct-card-head' }, h('b', {}, g.label), g.type !== 'taxable' ? infoTip('taxdeferred') : ''),
            h('div', { class: 'acct-card-value' }, usd(g.value)),
            h('div', { class: 'muted small' }, g.meaning),
            ...accounts
              .filter((a) => g.accounts.includes(a.name))
              .map((a) => h('label', { class: 'tax-acct small' }, h('span', {}, a.name), typeSelect(a))),
          ),
        ),
      ),
    );
    const taxable = report.groups.some((g) => g.type === 'taxable');
    if (!taxable) body.append(h('p', { class: 'ap-note' }, 'No taxable account in this view: inside a Roth or Traditional IRA, gains and dividends aren’t taxed each year, so there’s nothing to harvest.'));
    else {
      const income = divs ? dividendsThisYear(divs.holdings, taxableShares) : null;
      body.append(
        statCards([
          { label: 'Unrealized gains', value: signed(report.totals.gain), tone: 'up', hint: 'Taxable accounts only; taxed only when you sell' },
          { label: 'Unrealized losses', value: signed(report.totals.loss), tone: report.totals.loss ? 'down' : '', hint: 'Could offset gains if sold' },
          { label: termLabel('Harvestable losses', 'harvest'), value: signed(report.totals.harvest), tone: report.totals.harvest ? 'down' : '', hint: 'Holdings down more than $100' },
          {
            label: 'Dividends this year (est.)',
            value: income != null ? usd(income) : '—',
            hint: income != null ? 'Taxable accounts: paid so far this year plus expected by Dec 31, if the shares were held all year' : 'Dividend data unavailable',
          },
        ]),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data-table' },
            h('thead', {}, h('tr', {}, ...['Symbol', 'Account', 'Value', 'Cost', 'Gain / loss', 'Holding period', 'Flags'].map((t) => h('th', {}, t)))),
            h(
              'tbody',
              {},
              ...report.taxable.map((r) =>
                h(
                  'tr',
                  {},
                  h('td', { class: 'label' }, h('b', {}, r.symbol)),
                  h('td', { class: 'muted' }, r.account),
                  h('td', { class: 'num' }, usd(r.value)),
                  h('td', { class: 'num' }, r.cost != null ? usd(r.cost) : h('span', { class: 'muted', title: 'No cost basis from your broker or statement' }, 'unknown')),
                  h('td', { class: `num ${tone(r.gain)}` }, signed(r.gain)),
                  h('td', { class: 'small' }, TERM_TEXT[r.term](r)),
                  h(
                    'td',
                    { class: 'small' },
                    r.harvest ? h('span', { class: 'badge down', title: 'Down more than $100: selling would book a loss that can offset gains' }, 'Harvest candidate') : '',
                    r.washSale.length ? h('span', { class: 'badge warn', title: `Bought in the last ${report.buyDays} days in ${r.washSale.join(', ')}: selling at a loss now could be a wash sale (the loss is postponed).` }, 'Wash-sale risk', infoTip('washsale')) : '',
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      if (!report.taxable.length) body.append(h('p', { class: 'ap-note' }, 'The taxable accounts here hold only cash.'));
    }
    const notes = [
      report.buysNote,
      report.totals.noCost ? `${report.totals.noCost} holding${report.totals.noCost === 1 ? ' has' : 's have'} no cost basis, so no gain is shown.` : null,
      taxable ? 'The platform has no purchase lots: holding periods are known only for shares bought through Webull in the last 31 days. Long-term (over a year) can’t be confirmed here.' : null,
      report.notAdvice,
    ].filter(Boolean);
    body.append(h('p', { class: 'ap-note' }, notes.join(' ')));
  }
  return h('details', { class: 'panel tax-section' }, h('summary', { class: 'panel-head' }, h('h3', {}, 'Taxes'), h('span', { class: 'muted small' }, 'Estimate, not tax advice')), body);
}

const TYPE_SHORT: Record<TaxType, string> = { roth: 'Roth', deferred: 'Traditional IRA', taxable: 'taxable' };
