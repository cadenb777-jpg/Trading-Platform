/**
 * Builds a printable, white-label client report (US Letter pages) from a portfolio analysis.
 * Quiet design: white pages, one serif for titles, hairline tables, brand colours only as accents.
 */
import type { Analysis, Portfolio } from '../portfolio/types';
import { h } from '../ui/dom';
import { barsSvg, donutSvg, lineSvg, mix } from './svg';
import type { Branding, Client } from './types';

const GREY = '#b9c0c8';

const fmtPct = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const fmtMoney = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const fmtNum = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export interface ReportInput {
  client: Client;
  portfolio: Portfolio;
  analysis: Analysis;
  branding: Branding;
}

/** One table with optional first-column labels and right-aligned numbers. */
function table(head: string[], rows: (string | Node)[][], opts: { emphasis?: number[]; muted?: number[] } = {}) {
  return h(
    'table',
    { class: 'rpt-table' },
    h('thead', {}, h('tr', {}, ...head.map((c) => h('th', {}, c)))),
    h('tbody', {}, ...rows.map((r, i) => h('tr', { class: opts.emphasis?.includes(i) ? 'em' : opts.muted?.includes(i) ? 'mute' : '' }, ...r.map((c) => h('td', {}, c))))),
  );
}

function legend(items: { label: string; color: string; dash?: boolean }[]) {
  return h('div', { class: 'rpt-legend' }, ...items.map((i) => h('span', {}, h('i', { class: i.dash ? 'dash' : '', style: `background:${i.color}` }), i.label)));
}

function section(title: string, ...children: (Node | null)[]) {
  return h('section', { class: 'rpt-section' }, h('h3', {}, title), ...children.filter((c): c is Node => !!c));
}

export function buildReport({ client, portfolio, analysis: a, branding: b }: ReportInput): HTMLElement {
  const primary = b.primary || '#1f3b57';
  const accent = b.accent || '#8fb8d8';
  const asOf = longDate(a.end);
  const hypothetical = !client.inception;
  const initial = client.initialInvestment > 0 ? client.initialInvestment : 10000;
  const scale = initial / 10000;
  const endValue = (a.growth[a.growth.length - 1]?.value ?? 10000) * scale;
  const benchEnd = (a.benchmarkGrowth[a.benchmarkGrowth.length - 1]?.value ?? 10000) * scale;
  const pages: HTMLElement[] = [];

  const logo = () => (b.logo ? h('img', { class: 'rpt-logo', src: b.logo, alt: b.firmName }) : h('div', { class: 'rpt-wordmark', style: `color:${primary}` }, b.firmName));

  function page(title: string, ...content: (Node | null)[]) {
    const el = h(
      'div',
      { class: 'rpt-page' },
      h('header', { class: 'rpt-head' }, logo(), h('div', { class: 'rpt-head-meta' }, h('div', {}, client.name), h('div', {}, `As of ${asOf}`))),
      h('div', { class: 'rpt-rule', style: `background:${accent}` }),
      h('h2', { class: 'rpt-title', style: `color:${primary}` }, title),
      ...content.filter((c): c is Node => !!c),
      h('footer', { class: 'rpt-foot' }, h('span', {}, [b.firmName, b.phone, b.website].filter(Boolean).join('  ·  ')), h('span', { class: 'rpt-pageno' })),
    );
    pages.push(el);
    return el;
  }

  // ---- Cover ----
  pages.push(
    h(
      'div',
      { class: 'rpt-page rpt-cover' },
      h('div', { class: 'rpt-cover-logo' }, logo()),
      h(
        'div',
        { class: 'rpt-cover-body' },
        h('div', { class: 'rpt-cover-rule', style: `background:${accent}` }),
        h('div', { class: 'rpt-eyebrow', style: `color:${primary}` }, b.reportTitle || 'Portfolio Review'),
        h('h1', {}, client.name),
        client.household ? h('div', { class: 'rpt-cover-sub' }, client.household) : null,
        h('div', { class: 'rpt-cover-sub' }, client.accountName || portfolio.name),
        h('div', { class: 'rpt-cover-date' }, `As of ${asOf}`),
      ),
      h(
        'div',
        { class: 'rpt-cover-foot' },
        h('div', { class: 'rpt-cover-firm', style: `color:${primary}` }, b.firmName),
        h('div', {}, b.address),
        h('div', {}, [b.phone, b.email, b.website].filter(Boolean).join('  ·  ')),
      ),
    ),
  );

  // ---- Summary ----
  const periods: [keyof Analysis['trailing'], string][] = [
    ['ytd', 'YTD'],
    ['1y', '1 Year'],
    ['3y', '3 Years'],
    ['5y', '5 Years'],
    ['10y', '10 Years'],
    ['inception', 'Since Inception'],
  ];
  const kpi = (label: string, value: string, sub?: string) => h('div', { class: 'rpt-kpi' }, h('div', { class: 'rpt-kpi-label' }, label), h('div', { class: 'rpt-kpi-value' }, value), sub ? h('div', { class: 'rpt-kpi-sub' }, sub) : null);
  page(
    'Portfolio Summary',
    h(
      'div',
      { class: 'rpt-kpis', style: `border-color:${accent}` },
      kpi('Ending Value', fmtMoney(endValue), `Initial investment ${fmtMoney(initial)}`),
      kpi('Net Gain', fmtMoney(endValue - initial), fmtPct(a.stats.totalReturn) + ' cumulative'),
      kpi('Annualized Return', fmtPct(a.trailing.inception.portfolio), `Since ${longDate(a.start)}`),
      kpi('Year to Date', fmtPct(a.trailing.ytd.portfolio), `${a.benchmark} ${fmtPct(a.trailing.ytd.benchmark)}`),
    ),
    section(
      'Performance',
      table(
        ['', ...periods.map(([, l]) => l)],
        [
          [h('b', {}, client.accountName || portfolio.name), ...periods.map(([k]) => fmtPct(a.trailing[k].portfolio))],
          [`Benchmark (${a.benchmark})`, ...periods.map(([k]) => fmtPct(a.trailing[k].benchmark))],
          [
            'Difference',
            ...periods.map(([k]) => {
              const p = a.trailing[k].portfolio;
              const q = a.trailing[k].benchmark;
              return p != null && q != null ? `${p - q >= 0 ? '+' : ''}${fmtPct(p - q)}` : '—';
            }),
          ],
        ],
        { emphasis: [0], muted: [2] },
      ),
      h('p', { class: 'rpt-note' }, `Returns for periods longer than one year are annualized.${a.fee ? ` Net of a ${fmtPct(a.fee, 2)} annual advisory fee.` : ''} “—” means the account is younger than the period.`),
    ),
    section(
      `Growth of ${fmtMoney(initial)}`,
      legend([
        { label: client.accountName || portfolio.name, color: primary },
        { label: a.benchmark, color: GREY },
      ]),
      lineSvg(
        [
          { name: 'Portfolio', color: primary, width: 2, points: a.growth.map((p) => ({ time: p.time, value: p.value * scale })) },
          { name: a.benchmark, color: GREY, width: 1.4, points: a.benchmarkGrowth.map((p) => ({ time: p.time, value: p.value * scale })) },
        ],
        { money: true, height: 250, fill: true },
      ),
      h('p', { class: 'rpt-note' }, `Benchmark ending value ${fmtMoney(benchEnd)}.`),
    ),
  );

  // ---- Allocation ----
  const byClass = new Map<string, number>();
  const total = portfolio.holdings.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0) || 1;
  for (const x of portfolio.holdings) if (x.weight > 0) byClass.set(x.assetClass, (byClass.get(x.assetClass) ?? 0) + x.weight / total);
  const classes = [...byClass.entries()].sort((p, q) => q[1] - p[1]);
  const shade = (i: number) => (i === 0 ? primary : i === 1 ? accent : mix(primary, '#ffffff', 0.25 + 0.5 * ((i - 2) / Math.max(1, classes.length - 2))));
  const assetBySymbol = new Map(a.assets.map((x) => [x.symbol, x]));
  page(
    'Asset Allocation',
    h(
      'div',
      { class: 'rpt-split' },
      h('div', { class: 'rpt-donut' }, donutSvg(classes.map(([label, value], i) => ({ label, value, color: shade(i) })), { top: fmtMoney(endValue), bottom: 'Total value' })),
      h(
        'div',
        { class: 'rpt-grow' },
        table(
          ['Asset Class', 'Weight', 'Value'],
          classes.map(([label, w], i) => [h('span', { class: 'rpt-swatch-label' }, h('i', { style: `background:${shade(i)}` }), label), fmtPct(w, 1), fmtMoney(endValue * w)]),
        ),
      ),
    ),
    section(
      'Holdings',
      table(
        ['Holding', 'Asset Class', 'Target Weight', 'Annualized Return', 'Volatility', 'Share of Risk'],
        portfolio.holdings
          .filter((x) => x.weight > 0)
          .sort((p, q) => q.weight - p.weight)
          .map((x) => {
            const s = assetBySymbol.get(x.symbol.toUpperCase());
            return [h('b', {}, x.symbol.toUpperCase()), x.assetClass, fmtPct(x.weight / total, 1), fmtPct(s?.cagr), fmtPct(s?.volatility, 1), fmtPct(s?.riskContribution, 1)];
          }),
      ),
      h('p', { class: 'rpt-note' }, `Holding returns are annualized since ${longDate(a.start)}. Share of risk shows how much of the portfolio’s ups and downs comes from each holding. Rebalanced ${a.rebalance === 'none' ? 'never (buy and hold)' : a.rebalance}.`),
    ),
  );

  // ---- Risk and history ----
  const years = a.calendar.slice(-10);
  const s = a.stats;
  const bs = a.benchmarkStats;
  page(
    'Returns & Risk',
    section(
      'Calendar Year Returns',
      legend([
        { label: client.accountName || portfolio.name, color: primary },
        { label: a.benchmark, color: accent },
      ]),
      barsSvg(
        years.map((y) => (y.year === new Date(`${a.end}T00:00:00Z`).getUTCFullYear() ? `${y.year} YTD` : String(y.year))),
        [
          { name: 'Portfolio', color: primary, values: years.map((y) => y.portfolio) },
          { name: a.benchmark, color: accent, values: years.map((y) => y.benchmark) },
        ],
        { height: 200 },
      ),
      table(
        ['', ...years.map((y) => String(y.year))],
        [
          [h('b', {}, 'Portfolio'), ...years.map((y) => fmtPct(y.portfolio, 1))],
          [a.benchmark, ...years.map((y) => fmtPct(y.benchmark, 1))],
        ],
        { emphasis: [0] },
      ),
    ),
    h(
      'div',
      { class: 'rpt-split top' },
      section(
        'Risk Statistics',
        table(
          ['', 'Portfolio', a.benchmark],
          [
            ['Annualized volatility', fmtPct(s.volatility), fmtPct(bs.volatility)],
            ['Sharpe ratio', fmtNum(s.sharpe), fmtNum(bs.sharpe)],
            ['Sortino ratio', fmtNum(s.sortino), fmtNum(bs.sortino)],
            ['Maximum drawdown', fmtPct(s.maxDrawdown), fmtPct(bs.maxDrawdown)],
            ['Beta', fmtNum(s.beta), '1.00'],
            ['Correlation', fmtNum(s.correlation), '1.00'],
            ['Best month', fmtPct(s.bestMonth), fmtPct(bs.bestMonth)],
            ['Worst month', fmtPct(s.worstMonth), fmtPct(bs.worstMonth)],
          ],
        ),
      ),
      section(
        'Drawdown',
        lineSvg(
          [
            { name: 'Portfolio', color: primary, width: 1.6, points: a.drawdown },
            { name: a.benchmark, color: GREY, width: 1.1, points: a.benchmarkDrawdown },
          ],
          { percent: true, height: 260, fill: true, width: 400 },
        ),
        h('p', { class: 'rpt-note' }, 'Decline from the previous high at each point in time.'),
      ),
    ),
  );

  // ---- Commentary and disclosures ----
  const disclosures = (b.disclosures || '').split(/\n\s*\n/).filter((p) => p.trim());
  page(
    client.commentary?.trim() ? 'Commentary & Disclosures' : 'Important Disclosures',
    client.commentary?.trim() ? section('Commentary', ...client.commentary.trim().split(/\n\s*\n/).map((p) => h('p', { class: 'rpt-body' }, p))) : null,
    section(
      'Important Disclosures',
      hypothetical
        ? h('p', { class: 'rpt-disclosure strong' }, `Performance before the account’s inception${client.inception ? ` on ${longDate(client.inception)}` : ''} is hypothetical. It was calculated by applying the target allocation to historical prices, does not represent actual trading, and has inherent limitations.`)
        : null,
      a.totalReturn ? null : h('p', { class: 'rpt-disclosure' }, `Dividend data was unavailable for ${a.priceOnly.join(', ')}; returns for these holdings are price-only and understate total return.`),
      ...disclosures.map((p) => h('p', { class: 'rpt-disclosure' }, p)),
      h('p', { class: 'rpt-disclosure' }, `Report period ${longDate(a.start)} to ${asOf}. Prepared ${longDate(new Date().toISOString().slice(0, 10))}.`),
    ),
  );

  pages.forEach((p, i) => {
    const n = p.querySelector('.rpt-pageno');
    if (n) n.textContent = `${i + 1} / ${pages.length}`;
  });
  return h('div', { class: 'rpt-doc', style: `--rpt-primary:${primary};--rpt-accent:${accent}` }, ...pages);
}
