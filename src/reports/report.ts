/**
 * Builds a printable, white-label client report (US Letter pages) from a portfolio analysis, the account's
 * positions, its alternative investments and a market overview. Quiet design: white pages, one serif for
 * titles, hairline tables, brand colours only as accents. Long tables continue onto extra pages.
 */
import { STRUCTURES, PRIVATE_FUNDS, type PrivateFund } from '../invest/catalog';
import { holdingStats, type AltHolding } from '../invest/holdings';
import { analysisSymbol, isCashOrAlt, liquidityOf, positions, proxyNotes, type Analysis, type Holding, type Portfolio } from '../portfolio/types';
import { pct } from '../ui/charts';
import { h } from '../ui/dom';
import { barsSvg, donutSvg, lineSvg, mix } from './svg';
import { ALT_DISCLOSURE, type Branding, type Client, type ReportSection } from './types';

const GREY = '#b9c0c8';

const fmtPct = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const fmtSigned = pct;
const fmtMoney = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const fmtNum = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const fmtBig = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : fmtMoney(v));
const fmtX = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}x`);
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** SEC data about a fund (from the helper's alts.fund), when it could be loaded. */
export interface FundFacts {
  navPerShare?: { end: string; value: number }[];
  totalReturn?: { start?: string | null; end: string; value: number }[];
  distributions?: { start?: string | null; end: string; value: number }[];
  netAssets?: { end: string; value: number }[];
}

export interface MarketRow {
  symbol: string;
  label: string;
  m3?: number | null;
  ytd?: number | null;
  y1?: number | null;
}

export interface ReportInput {
  client: Client;
  portfolio: Portfolio;
  analysis: Analysis;
  branding: Branding;
  /** Live prices and dividend yields by symbol (optional). */
  prices?: Record<string, { price: number | null; yield: number | null }>;
  /** The client's alternatives from My alternatives. */
  alternatives?: AltHolding[];
  /** SEC fund data keyed by fund name (lower case). */
  fundFacts?: Record<string, FundFacts>;
  market?: MarketRow[];
}

/** One table with optional first-column labels and right-aligned numbers. */
function table(head: string[], rows: (string | Node)[][], opts: { emphasis?: number[]; muted?: number[] } = {}) {
  return h(
    'table',
    { class: `rpt-table${head.length >= 8 ? ' dense' : ''}` },
    head.some((c) => c) ? h('thead', {}, h('tr', {}, ...head.map((c) => h('th', {}, c)))) : null,
    h('tbody', {}, ...rows.map((r, i) => h('tr', { class: opts.emphasis?.includes(i) ? 'em' : opts.muted?.includes(i) ? 'mute' : '' }, ...r.map((c) => h('td', {}, c))))),
  );
}

function legend(items: { label: string; color: string; dash?: boolean }[]) {
  return h('div', { class: 'rpt-legend' }, ...items.map((i) => h('span', {}, h('i', { class: i.dash ? 'dash' : '', style: `background:${i.color}` }), i.label)));
}

function section(title: string, ...children: (Node | null | false | undefined)[]) {
  return h('section', { class: 'rpt-section' }, h('h3', {}, title), ...children.filter((c): c is Node => !!c));
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out.length ? out : [[]];
}

/** A unified view of one alternative investment, from the portfolio or from My alternatives. */
interface AltLine {
  name: string;
  strategy: string;
  fund?: PrivateFund;
  commitment: number | null;
  contributed: number | null;
  distributed: number | null;
  value: number | null;
  valueDate?: string;
}

export function buildReport({ client, portfolio, analysis: a, branding: b, prices = {}, alternatives = [], fundFacts = {}, market = [] }: ReportInput): HTMLElement {
  const on = (s: ReportSection) => client.sections?.[s] !== false;
  const primary = b.primary || '#1f3b57';
  const accent = b.accent || '#8fb8d8';
  const asOf = longDate(a.end);
  const hypothetical = !client.inception;
  const accountName = client.accountName || portfolio.name;
  const pages: HTMLElement[] = [];

  // ---- Values: real positions when entered as shares/dollars, otherwise modelled from the initial investment ----
  const priceOnly = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.price]));
  const pos = positions(portfolio, priceOnly);
  const initial = client.initialInvestment > 0 ? client.initialInvestment : 10000;
  const netAdditions = client.netAdditions ?? 0;
  const modelledEnd = (a.growth[a.growth.length - 1]?.value ?? 10000) * (initial / 10000);
  const valueScaleEarly = pos.total ?? modelledEnd;
  const altLines: AltLine[] = [];
  for (const x of portfolio.holdings.filter((x) => x.kind === 'alt')) {
    const row = pos.rows.find((r) => r.holding === x);
    // In percent mode positions have no dollar values, so model them from the weight like the other pages do.
    const v = row ? (row.value ?? row.weight * valueScaleEarly) : null;
    altLines.push({ name: x.name || x.symbol, strategy: x.assetClass, fund: PRIVATE_FUNDS.find((f) => f.id === x.fundId), commitment: x.commitment ?? null, contributed: x.contributed ?? null, distributed: x.distributed ?? null, value: v, valueDate: x.valueDate });
  }
  // An entry from My alternatives may be saved as "BCRED" while the portfolio holds "Blackstone Private Credit Fund".
  const sameFund = (x: AltHolding, p: Holding) => {
    const want = x.fund.trim().toLowerCase();
    const fund = PRIVATE_FUNDS.find((f) => f.id === p.fundId);
    return [p.name, p.symbol, fund?.name, fund?.short].some((n) => n && n.trim().toLowerCase() === want);
  };
  const portfolioAlts = portfolio.holdings.filter((x) => x.kind === 'alt');
  const extraAlts = alternatives.filter((x) => !portfolioAlts.some((p) => sameFund(x, p)));
  for (const x of extraAlts) {
    altLines.push({ name: x.fund, strategy: x.strategy || 'Alternative', fund: PRIVATE_FUNDS.find((f) => f.name.toLowerCase() === x.fund.toLowerCase() || f.short.toLowerCase() === x.fund.toLowerCase()), commitment: x.commitment, contributed: x.contributed, distributed: x.distributed, value: x.value, valueDate: x.valueDate });
  }
  const extraAltValue = extraAlts.reduce((s, x) => s + (x.value ?? 0), 0);
  const realValue = pos.total != null ? pos.total + extraAltValue : null;
  const endValue = realValue ?? modelledEnd + extraAltValue;
  const valueScale = realValue ?? modelledEnd;
  // With a start date and amount, the change in value starts from what was invested; otherwise (a hypothetical
  // history) it starts from the value that would have grown into today's value.
  const actualStart = !!client.inception && client.initialInvestment > 0;
  const beginning = actualStart || realValue == null ? initial : (endValue - netAdditions) / (1 + a.stats.totalReturn);
  const scale = beginning / 10000;
  const gain = endValue - beginning - netAdditions;

  /** A fund's yearly distribution rate from its SEC filings: last period's distributions per share, annualised, over NAV. */
  function distributionRate(x: Holding): number | null {
    const fund = PRIVATE_FUNDS.find((f) => f.id === x.fundId);
    const facts = fundFacts[(fund?.name ?? x.name ?? x.symbol).toLowerCase()];
    const dist = facts?.distributions?.[facts.distributions.length - 1];
    const nav = facts?.navPerShare?.[facts.navPerShare.length - 1];
    if (!dist?.start || !nav?.value) return null;
    const days = (Date.parse(dist.end) - Date.parse(dist.start)) / 86400000 + 1;
    return days > 20 ? (dist.value * (365 / days)) / nav.value : null;
  }

  // Each holding's dollar value (modelled from weights in percent mode) and estimated income.
  const detail = pos.rows
    .filter((r) => r.weight > 0)
    .map((r) => {
      const x = r.holding;
      const value = r.value ?? r.weight * valueScale;
      const info = prices[x.symbol.trim().toUpperCase()];
      const yld = x.yield ?? (x.kind === 'alt' ? distributionRate(x) : isCashOrAlt(x) ? null : (info?.yield ?? null));
      const stats = a.assets.find((s) => s.symbol === analysisSymbol(x));
      return { x, value, weight: r.weight, price: r.price, yld, income: yld != null ? value * yld : null, cagr: stats?.cagr ?? null, vol: stats?.volatility ?? null };
    })
    .sort((p, q) => q.value - p.value);
  const income = detail.reduce((s, d) => s + (d.income ?? 0), 0);
  const costTotal = portfolio.holdings.reduce((s, x) => s + (x.cost ?? 0), 0);

  const logo = () => (b.logo ? h('img', { class: 'rpt-logo', src: b.logo, alt: b.firmName }) : h('div', { class: 'rpt-wordmark', style: `color:${primary}` }, b.firmName));

  function page(title: string, ...content: (Node | null | false | undefined)[]) {
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

  const kpi = (label: string, value: string, sub?: string) => h('div', { class: 'rpt-kpi' }, h('div', { class: 'rpt-kpi-label' }, label), h('div', { class: 'rpt-kpi-value' }, value), sub ? h('div', { class: 'rpt-kpi-sub' }, sub) : null);

  // ---- Allocation figures (used on several pages) ----
  const byClass = new Map<string, number>();
  for (const d of detail) byClass.set(d.x.assetClass, (byClass.get(d.x.assetClass) ?? 0) + d.value);
  const extraClass = (x: AltHolding) => {
    const s = (x.strategy || '').toLowerCase();
    return s.includes('credit') ? 'Private credit' : s.includes('real estate') ? 'Private real estate' : s.includes('equity') || s.includes('venture') ? 'Private equity' : s.includes('infra') ? 'Infrastructure' : 'Alternatives';
  };
  for (const x of extraAlts) if (x.value) byClass.set(extraClass(x), (byClass.get(extraClass(x)) ?? 0) + x.value);
  const classTotal = [...byClass.values()].reduce((s, v) => s + v, 0) || 1;
  const classes = [...byClass.entries()].sort((p, q) => q[1] - p[1]).map(([label, v]) => [label, v / classTotal] as [string, number]);
  const shade = (i: number) => (i === 0 ? primary : i === 1 ? accent : mix(primary, '#ffffff', 0.25 + 0.5 * ((i - 2) / Math.max(1, classes.length - 2))));
  const liquidity = new Map<string, number>();
  for (const d of detail) liquidity.set(liquidityOf(d.x), (liquidity.get(liquidityOf(d.x)) ?? 0) + d.value);
  for (const x of extraAlts) {
    if (!x.value) continue;
    const l = liquidityOf({ kind: 'alt', assetClass: extraClass(x) as Holding['assetClass'] });
    liquidity.set(l, (liquidity.get(l) ?? 0) + x.value);
  }
  const liquidShare = (liquidity.get('Liquid') ?? 0) / classTotal;

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
        h('div', { class: 'rpt-cover-sub' }, accountName),
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

  // ---- Executive summary ----
  if (on('summary')) {
    page(
      'Executive Summary',
      h(
        'div',
        { class: 'rpt-kpis', style: `border-color:${accent}` },
        kpi('Total Value', fmtMoney(endValue), realValue != null ? 'Current market value' : `Modelled from ${fmtMoney(beginning)} invested`),
        kpi('Investment Gain', fmtMoney(gain), netAdditions ? `After ${fmtMoney(netAdditions)} net additions` : `${fmtSigned(a.stats.totalReturn)} cumulative`),
        kpi('Annualized Return', fmtPct(a.trailing.inception.portfolio), `${a.benchmark} ${fmtPct(a.trailing.inception.benchmark)}`),
        kpi('Year to Date', fmtPct(a.trailing.ytd.portfolio), `${a.benchmark} ${fmtPct(a.trailing.ytd.benchmark)}`),
      ),
      h(
        'div',
        { class: 'rpt-split top' },
        section(
          'Change in Value',
          table(
            ['', 'Since Inception'],
            [
              [actualStart || realValue == null ? 'Beginning value' : 'Starting value (hypothetical)', fmtMoney(beginning)],
              ['Net contributions / withdrawals', fmtMoney(netAdditions)],
              ['Investment gain / loss', fmtMoney(gain)],
              [h('b', {}, 'Ending value'), h('b', {}, fmtMoney(endValue))],
            ],
            { emphasis: [3] },
          ),
          h('p', { class: 'rpt-note' }, `${client.inception ? `Since ${longDate(client.inception)}.` : `Hypothetical, since ${longDate(a.start)}.`}${a.fee ? ` Net of a ${fmtPct(a.fee)} annual advisory fee.` : ''}`),
        ),
        section(
          'Account Profile',
          table(
            ['', ''],
            [
              ['Objective', client.objective || '—'],
              ['Benchmark', a.benchmark],
              ['Holdings', String(detail.length + extraAlts.length)],
              ['Estimated annual income', income ? `${fmtMoney(income)} (${fmtPct(income / endValue)})` : '—'],
              ['Liquid within days', fmtPct(liquidShare, 0)],
              ['Rebalancing', a.rebalance === 'none' ? 'Buy and hold' : a.rebalance],
            ],
          ),
        ),
      ),
      section(
        'Allocation Snapshot',
        h(
          'div',
          { class: 'rpt-split' },
          h('div', { class: 'rpt-donut small' }, donutSvg(classes.map(([label, value], i) => ({ label, value, color: shade(i) })), { top: fmtMoney(endValue), bottom: 'Total' })),
          h('div', { class: 'rpt-grow' }, table(['Asset Class', 'Weight', 'Value'], classes.slice(0, 8).map(([label, w], i) => [h('span', { class: 'rpt-swatch-label' }, h('i', { style: `background:${shade(i)}` }), label), fmtPct(w, 1), fmtMoney(endValue * w)]))),
        ),
      ),
    );
  }

  // ---- Market overview ----
  if (on('market') && market.length) {
    const r = (sym: string) => market.find((m) => m.symbol === sym);
    const line = (sym: string, name: string) => (r(sym)?.ytd != null ? `${name} ${fmtSigned(r(sym)!.ytd, 1)}` : null);
    const highlights = [line('$SPX', 'US large-cap stocks'), line('$RUT', 'small caps'), line('VXUS', 'international stocks'), line('AGG', 'US bonds'), line('GLD', 'gold')].filter(Boolean);
    page(
      'Market Overview',
      section(
        'Market Returns',
        table(['Index / Market', '3 Months', 'Year to Date', '1 Year'], market.map((m) => [m.label, fmtSigned(m.m3, 1), fmtSigned(m.ytd, 1), fmtSigned(m.y1, 1)])),
        h('p', { class: 'rpt-note' }, 'Price returns of the index or a representative index fund, as of the report date.'),
      ),
      highlights.length ? section('Highlights', h('p', { class: 'rpt-body' }, `Year to date: ${highlights.join(', ')}. The account returned ${fmtSigned(a.trailing.ytd.portfolio)} over the same period against ${fmtSigned(a.trailing.ytd.benchmark)} for its benchmark (${a.benchmark}).`)) : null,
    );
  }

  // ---- Performance ----
  const periods: [keyof Analysis['trailing'], string][] = [
    ['ytd', 'YTD'],
    ['1y', '1 Year'],
    ['3y', '3 Years'],
    ['5y', '5 Years'],
    ['10y', '10 Years'],
    ['inception', 'Since Inception'],
  ];
  if (on('performance')) {
    page(
      'Performance',
      section(
        'Trailing Returns',
        table(
          ['', ...periods.map(([, l]) => l)],
          [
            [h('b', {}, accountName), ...periods.map(([k]) => fmtPct(a.trailing[k].portfolio))],
            [`Benchmark (${a.benchmark})`, ...periods.map(([k]) => fmtPct(a.trailing[k].benchmark))],
            ['Difference', ...periods.map(([k]) => (a.trailing[k].portfolio != null && a.trailing[k].benchmark != null ? fmtSigned(a.trailing[k].portfolio! - a.trailing[k].benchmark!) : '—'))],
          ],
          { emphasis: [0], muted: [2] },
        ),
        h('p', { class: 'rpt-note' }, `Returns for periods longer than one year are annualized.${a.fee ? ` Net of a ${fmtPct(a.fee, 2)} annual advisory fee.` : ''} “—” means the account is younger than the period.`),
      ),
      section(
        `Growth of ${fmtMoney(beginning)}`,
        legend([
          { label: accountName, color: primary },
          { label: a.benchmark, color: GREY },
        ]),
        lineSvg(
          [
            { name: 'Portfolio', color: primary, width: 2, points: a.growth.map((p) => ({ time: p.time, value: p.value * scale })) },
            { name: a.benchmark, color: GREY, width: 1.4, points: a.benchmarkGrowth.map((p) => ({ time: p.time, value: p.value * scale })) },
          ],
          { money: true, height: 250, fill: true },
        ),
        h('p', { class: 'rpt-note' }, `Benchmark ending value ${fmtMoney((a.benchmarkGrowth[a.benchmarkGrowth.length - 1]?.value ?? 10000) * scale)}.`),
      ),
    );
  }

  // ---- Returns & risk ----
  if (on('risk')) {
    const years = a.calendar.slice(-10);
    const s = a.stats;
    const bs = a.benchmarkStats;
    page(
      'Returns & Risk',
      section(
        'Calendar Year Returns',
        legend([
          { label: accountName, color: primary },
          { label: a.benchmark, color: accent },
        ]),
        barsSvg(
          years.map((y) => (y.year === new Date(`${a.end}T00:00:00Z`).getUTCFullYear() ? `${y.year} YTD` : String(y.year))),
          [
            { name: 'Portfolio', color: primary, values: years.map((y) => y.portfolio) },
            { name: a.benchmark, color: accent, values: years.map((y) => y.benchmark) },
          ],
          { height: 170 },
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
              ['Worst month', fmtPct(s.worstMonth), fmtPct(bs.worstMonth)],
              ['Positive months', fmtPct(s.positiveMonths, 0), fmtPct(bs.positiveMonths, 0)],
            ],
          ),
        ),
        section(
          'Stress Tests',
          table(
            ['Historical Event', 'Portfolio', a.benchmark],
            a.stress.map((x) => [x.name, x.portfolio == null ? 'Before history' : fmtSigned(x.portfolio, 1), fmtSigned(x.benchmark, 1)]),
          ),
          h('p', { class: 'rpt-note' }, 'How the current allocation would have fared in past market crises.'),
        ),
      ),
      section(
        'Drawdown',
        lineSvg(
          [
            { name: 'Portfolio', color: primary, width: 1.6, points: a.drawdown },
            { name: a.benchmark, color: GREY, width: 1.1, points: a.benchmarkDrawdown },
          ],
          { percent: true, height: 150, fill: true },
        ),
      ),
    );
  }

  // ---- Allocation & liquidity ----
  if (on('allocation')) {
    const liq = ['Liquid', 'Semi-liquid', 'Illiquid'].map((l) => [l, (liquidity.get(l) ?? 0) / classTotal] as [string, number]).filter(([, v]) => v > 0);
    page(
      'Asset Allocation',
      h(
        'div',
        { class: 'rpt-split' },
        h('div', { class: 'rpt-donut' }, donutSvg(classes.map(([label, value], i) => ({ label, value, color: shade(i) })), { top: fmtMoney(endValue), bottom: 'Total value' })),
        h('div', { class: 'rpt-grow' }, table(['Asset Class', 'Weight', 'Value'], classes.map(([label, w], i) => [h('span', { class: 'rpt-swatch-label' }, h('i', { style: `background:${shade(i)}` }), label), fmtPct(w, 1), fmtMoney(endValue * w)]))),
      ),
      section(
        'Liquidity',
        table(['', 'Weight', 'Value', 'Typical access'], liq.map(([l, w]) => [l, fmtPct(w, 1), fmtMoney(endValue * w), l === 'Liquid' ? 'Sell any trading day' : l === 'Semi-liquid' ? 'Monthly or quarterly, limited and can be paused' : 'Locked up for years; returned as investments are sold'])),
      ),
      section('Concentration', table(['Largest Positions', 'Weight', 'Value'], detail.slice(0, 5).map((d) => [d.x.name ? `${d.x.symbol} · ${d.x.name}` : d.x.symbol, fmtPct(d.weight, 1), fmtMoney(d.value)]))),
    );
  }

  // ---- Holdings detail (continues across pages) ----
  if (on('holdings')) {
    const rows = detail.map((d) => {
      const gainLoss = d.x.cost != null && d.x.cost > 0 ? d.value - d.x.cost : null;
      return [
        h('span', {}, h('b', {}, d.x.symbol.toUpperCase()), d.x.name ? h('span', { class: 'rpt-sub' }, ` ${d.x.name}`) : ''),
        d.x.assetClass,
        d.x.shares != null && !isCashOrAlt(d.x) ? d.x.shares.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—',
        d.price != null ? d.price.toFixed(2) : '—',
        fmtMoney(d.value),
        fmtPct(d.weight, 1),
        d.x.cost != null ? fmtMoney(d.x.cost) : '—',
        gainLoss != null ? `${gainLoss >= 0 ? '+' : ''}${fmtMoney(gainLoss)}` : '—',
        fmtPct(d.cagr, 1),
      ];
    });
    const totalRow = [h('b', {}, 'Total'), '', '', '', h('b', {}, fmtMoney(detail.reduce((s, d) => s + d.value, 0))), '100.0%', costTotal ? fmtMoney(costTotal) : '—', costTotal ? fmtMoney(detail.reduce((s, d) => s + d.value, 0) - costTotal) : '—', ''];
    const parts = chunk(rows, 20);
    parts.forEach((part, i) =>
      page(
        i ? 'Holdings Detail (continued)' : 'Holdings Detail',
        table(['Holding', 'Asset Class', 'Shares', 'Price', 'Market Value', 'Weight', 'Cost Basis', 'Unrealized', 'Ann. Return'], i === parts.length - 1 ? [...part, totalRow] : part, { emphasis: i === parts.length - 1 ? [part.length] : [] }),
        i === parts.length - 1
          ? h('p', { class: 'rpt-note' }, `${realValue == null ? 'Values are modelled from the target allocation. ' : ''}Annualized returns since ${longDate(a.start)}${proxyNotes(portfolio).length ? `; ${proxyNotes(portfolio).join('; ')}` : ''}.`)
          : null,
      ),
    );
  }

  // ---- Income ----
  if (on('income') && detail.some((d) => d.yld != null)) {
    const byClassIncome = new Map<string, number>();
    for (const d of detail) if (d.income) byClassIncome.set(d.x.assetClass, (byClassIncome.get(d.x.assetClass) ?? 0) + d.income);
    const rows = detail.filter((d) => d.income).slice(0, 18);
    page(
      'Projected Income',
      h(
        'div',
        { class: 'rpt-kpis', style: `border-color:${accent}` },
        kpi('Estimated Annual Income', fmtMoney(income)),
        kpi('Portfolio Yield', fmtPct(income / endValue)),
        kpi('Monthly Average', fmtMoney(income / 12)),
        kpi('Largest Source', rows[0] ? rows[0].x.symbol : '—', rows[0] ? fmtMoney(rows[0].income) : ''),
      ),
      section('By Holding', table(['Holding', 'Market Value', 'Yield', 'Est. Annual Income'], rows.map((d) => [d.x.name ? `${d.x.symbol} · ${d.x.name}` : d.x.symbol, fmtMoney(d.value), fmtPct(d.yld), fmtMoney(d.income)]))),
      section('By Asset Class', table(['Asset Class', 'Est. Annual Income', 'Share'], [...byClassIncome.entries()].sort((p, q) => q[1] - p[1]).map(([c, v]) => [c, fmtMoney(v), fmtPct(v / (income || 1), 1)]))),
      h('p', { class: 'rpt-note' }, 'Estimates use current dividend yields, cash rates and fund distribution rates; actual income will differ and distributions may include return of capital.'),
    );
  }

  // ---- Alternatives ----
  if (on('alternatives') && altLines.length) {
    const t = altLines.reduce(
      (s, l) => ({ commitment: s.commitment + (l.commitment ?? 0), contributed: s.contributed + (l.contributed ?? 0), distributed: s.distributed + (l.distributed ?? 0), value: s.value + (l.value ?? 0) }),
      { commitment: 0, contributed: 0, distributed: 0, value: 0 },
    );
    const tot = holdingStats(t);
    const parts = chunk(altLines, 9);
    parts.forEach((part, i) => {
      const facts = part
        .map((l) => ({ l, f: fundFacts[l.name.toLowerCase()] ?? (l.fund ? fundFacts[l.fund.name.toLowerCase()] : undefined) }))
        .filter((x) => x.f && (x.f.navPerShare?.length || x.f.totalReturn?.length));
      page(
        i ? 'Alternative Investments (continued)' : 'Alternative Investments',
        i
          ? null
          : h(
              'div',
              { class: 'rpt-kpis', style: `border-color:${accent}` },
              kpi('Current Value', fmtMoney(t.value)),
              kpi('Committed', t.commitment ? fmtMoney(t.commitment) : '—', tot.unfunded ? `${fmtMoney(tot.unfunded)} unfunded` : ''),
              kpi('Distributions', altLines.some((l) => l.distributed != null) ? fmtMoney(t.distributed) : '—'),
              kpi('TVPI / DPI', `${fmtX(tot.tvpi)}`, `DPI ${fmtX(tot.dpi)}`),
            ),
        section(
          'Positions',
          table(
            ['Investment', 'Strategy', 'Committed', 'Paid In', 'Unfunded', 'Distributions', 'Value', 'As Of', 'TVPI'],
            part.map((l) => {
              const st = holdingStats(l);
              return [h('span', {}, h('b', {}, l.fund?.short ?? l.name), l.fund ? h('span', { class: 'rpt-sub' }, ` ${l.fund.name}`) : ''), l.strategy, fmtMoney(l.commitment), fmtMoney(l.contributed), fmtMoney(st.unfunded), fmtMoney(l.distributed), fmtMoney(l.value), l.valueDate || '—', fmtX(st.tvpi)];
            }),
          ),
        ),
        facts.length
          ? section(
              'Fund-Level Data (from SEC filings)',
              table(
                ['Fund', 'NAV per Share', 'Total Return', 'Distribution / Share', 'Fund Net Assets'],
                facts.map(({ l, f }) => {
                  const nav = f!.navPerShare?.[f!.navPerShare.length - 1];
                  const tr = f!.totalReturn?.[f!.totalReturn.length - 1];
                  const dist = f!.distributions?.[f!.distributions.length - 1];
                  const na = f!.netAssets?.[f!.netAssets.length - 1];
                  return [l.fund?.short ?? l.name, nav ? `$${nav.value.toFixed(2)} (${nav.end})` : '—', tr ? `${fmtSigned(tr.value)} (${tr.start ?? ''}–${tr.end})` : '—', dist ? `$${dist.value.toFixed(4)}` : '—', na ? fmtBig(na.value) : '—'];
                }),
              ),
            )
          : null,
        section(
          'Structure & Liquidity',
          ...[...new Set(part.map((l) => l.fund?.structure).filter(Boolean))].map((s) => h('p', { class: 'rpt-disclosure' }, h('b', {}, `${s}: `), STRUCTURES[s!])),
          part.some((l) => !l.fund) ? h('p', { class: 'rpt-disclosure' }, h('b', {}, 'Private funds: '), 'Drawdown-style private funds call committed capital over several years and return it as investments are sold; interests generally cannot be redeemed.') : null,
        ),
      );
    });
  }

  // ---- Commentary and disclosures ----
  const disclosures = (b.disclosures || '').split(/\n\s*\n/).filter((p) => p.trim());
  const showCommentary = on('commentary') && client.commentary?.trim();
  page(
    showCommentary ? 'Commentary & Disclosures' : 'Important Disclosures',
    showCommentary ? section('Commentary', ...client.commentary!.trim().split(/\n\s*\n/).map((p) => h('p', { class: 'rpt-body' }, p))) : null,
    section(
      'Important Disclosures',
      hypothetical
        ? h('p', { class: 'rpt-disclosure strong' }, `Performance before the account’s inception${client.inception ? ` on ${longDate(client.inception)}` : ''} is hypothetical. It was calculated by applying the target allocation to historical prices, does not represent actual trading, and has inherent limitations.`)
        : null,
      a.totalReturn ? null : h('p', { class: 'rpt-disclosure' }, `Dividend data was unavailable for ${a.priceOnly.join(', ')}; returns for these holdings are price-only and understate total return.`),
      altLines.length || portfolio.holdings.some((x: Holding) => x.kind === 'cash') ? h('p', { class: 'rpt-disclosure' }, ALT_DISCLOSURE) : null,
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
