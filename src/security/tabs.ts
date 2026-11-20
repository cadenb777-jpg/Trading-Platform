/**
 * The security view's tabs other than the chart (chartTab.ts): DES, FA, HDS, CN, OMON, DVD, BETA and Setups. Each
 * draws into the tab body from the shared loaders (data.ts), degrades panel by panel when a request fails ("—" with
 * the reason), and says where every figure comes from and when.
 */
import { hpTab } from './hpTab';
import { holderWords, holdersTable, sellersList } from './holdersView';
import { faGraph, togglePick } from './faGraph';
import { chainPanel } from './chainView';
import { rvTab } from './rvTab';
import { ratingChart, ratingWords, surpriseChart, surpriseWords, type Surprise } from './analysts';
import { combineHoldings, myPortfolios } from '../portfolio/account';
import { engineRequest, helper, worldReady, worldAvailable } from '../data/schwab';
import { optionsAnalyticsBlock } from '../flow/optionsAnalytics';
import { NASDAQ_100 } from '../ui/command';
import { h } from '../ui/dom';
import { tabDef, type SecTab } from './codes';
import {
  loadBoard,
  loadCompany,
  loadDaily,
  loadDividends,
  loadHolders,
  loadInsiders,
  loadNewsFor,
  loadOptions,
  loadBoards,
  loadPortfolios,
  loadScan,
  type CompanyData,
  type Setup,
} from './data';
import { DASH, fmtChange, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, fmtX, ok, tone } from './format';
import { sectorOf } from './related';
import { COMPANY_METRICS, FUND_METRICS, YCHARTS_HELPER_VERSION, yFormat, yPoints, ychartsId, ychartsKeySet, type YMetric } from '../data/ycharts';
import { FUND_HELPER_VERSION, costBand, costWords, isFundRow, loadFund, riskWords, stars, versusCategory, type FundProfile } from './fund';
import { dayKey, dividendSummary, keyLevels, pairedReturns, portfolioReturns, correlation, beta, riskWindow, type Close, type RiskWindow } from './stats';
import { fig, kvGrid, loadingNote, note, panel, reasonOf, type KV } from './ui';

export interface SecurityDeps {
  openChart(ref: { provider: 'schwab' | 'coinbase'; symbol: string }): void;
  openPage(route: string, method?: string, ...args: unknown[]): void;
}

export interface TabCtx {
  symbol: string;
  body: HTMLElement;
  /** False once the view moved to another symbol or tab (drop late replies). */
  still(): boolean;
  /** Loads another symbol (a peer) or switches tab in the same view. */
  open(symbol: string, tab?: SecTab): void;
  deps: SecurityDeps;
  /** What the AI summary reads for this tab (merged with the header's data). */
  share(key: string, data: unknown): void;
}

/** Indexes ($SPX), crypto pairs and futures have no SEC company data. */
export const isCompanyLike = (s: string) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(s);

const SEC = 'SEC EDGAR XBRL (company filings)';
const SCHWAB = 'Schwab market data';

/** A slot that takes the grid's full width (wide tables). */
const wideSlot = (el: HTMLElement) => (el.classList.add('sv-wide'), el);

/** A grid of panels. */
const grid = (...nodes: (Node | null | false)[]) => h('div', { class: 'sv-grid' }, ...nodes.filter((n): n is Node => !!n));

/** Fills a panel slot when its data arrives; a failure shows the reason in place. */
function slot(ctx: TabCtx, what: string, run: () => Promise<Node | Node[]>): HTMLElement {
  const el = h('div', { class: 'sv-slot' }, loadingNote(what));
  run().then(
    (n) => ctx.still() && el.replaceChildren(...(Array.isArray(n) ? n : [n])),
    (err) => ctx.still() && el.replaceChildren(h('section', { class: 'sv-panel' }, h('h3', { class: 'sv-panel-title' }, what[0].toUpperCase() + what.slice(1)), note(`Not available: ${reasonOf(err)}`, 'sv-error'))),
  );
  return el;
}

const money = (v: number | null | undefined) => fmtCompact(v, { money: true });

/** A plain number table with a label column (tabular figures, negative in red, "—" for blanks). */
function numTable(headers: string[], rows: { label: string | Node; cells: (string | Node)[]; cls?: string }[]): HTMLElement {
  return h(
    'div',
    { class: 'sv-table-wrap' },
    h(
      'table',
      { class: 'sv-table' },
      h('thead', {}, h('tr', {}, ...headers.map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', {}, ...rows.map((r) => h('tr', { class: r.cls ?? '' }, h('th', { scope: 'row' }, r.label), ...r.cells.map((c) => h('td', { class: 'num' }, typeof c === 'string' ? fig(c, { tone: c.startsWith('−') ? 'down' : '', reason: 'not reported for this period' }) : c))))),
    ),
  );
}

// ---------- DES ----------

/** Overview: a fund (ETF or mutual fund, by Schwab's type) gets the fund overview; anything else the company one. */
export function desTab(ctx: TabCtx) {
  ctx.body.replaceChildren(loadingNote('overview'));
  loadBoard(ctx.symbol)
    .then((b) => isFundRow(b?.row), () => false)
    .then((fund) => ctx.still() && (fund ? fundDes(ctx) : companyDes(ctx)));
}

function priceStatsSlot(ctx: TabCtx) {
  const s = ctx.symbol;
  return slot(ctx, 'price statistics', async () => {
        const [b, bars] = await Promise.all([loadBoard(s).catch(() => null), loadDaily(s)]);
        const k = keyLevels(bars);
        const row = b?.row;
        const last = row?.price ?? bars[bars.length - 1]?.close ?? null;
        const vsAvg = (avg: number | null) => (ok(avg) && ok(last) ? fmtPct(last / avg - 1, 1, true) : DASH);
        const rows: KV[] = [
          ['Previous close', fmtPrice(k.prevClose)],
          ['Day range', `${fmtPrice(k.dayLow)} – ${fmtPrice(k.dayHigh)}`],
          ['52-week high', fig(fmtPrice(row?.high52 ?? k.high52), { title: `${fmtPct(ok(last) && ok(row?.high52 ?? k.high52) ? last / (row?.high52 ?? k.high52)! - 1 : null, 1, true)} from the high` })],
          ['52-week low', fmtPrice(row?.low52 ?? k.low52)],
          ['50-day average', h('span', {}, fig(fmtPrice(k.sma50)), ' ', fig(vsAvg(k.sma50), { tone: tone(ok(last) && ok(k.sma50) ? last - k.sma50 : null), reason: 'needs 50 days' }))],
          ['200-day average', h('span', {}, fig(fmtPrice(k.sma200)), ' ', fig(vsAvg(k.sma200), { tone: tone(ok(last) && ok(k.sma200) ? last - k.sma200 : null), reason: 'needs 200 days' }))],
          ['ATR (14 days)', fig(fmtPrice(k.atr14), { title: 'Average daily range over the last 14 sessions (gaps included)', reason: 'needs 15 days' }), 'Average true range'],
          ['1 month', fig(fmtPct(row?.m1, 1, true), { tone: tone(row?.m1), reason: 'not in the board reply' })],
          ['3 months', fig(fmtPct(row?.m3, 1, true), { tone: tone(row?.m3), reason: 'not in the board reply' })],
          ['Year to date', fig(fmtPct(row?.ytd, 1, true), { tone: tone(row?.ytd), reason: 'not in the board reply' })],
          ['1 year', fig(fmtPct(row?.y1, 1, true), { tone: tone(row?.y1), reason: 'not in the board reply' })],
        ];
        ctx.share('keyLevels', k);
        return panel('Price statistics', `${SCHWAB} (daily bars and quotes)`, b?.asOf ?? (bars.length ? dayKey(bars[bars.length - 1].time) : null), kvGrid(rows));
      });
}

function eventsSlot(ctx: TabCtx, fund = false) {
  const s = ctx.symbol;
  return slot(ctx, 'events', async () => {
        const [company, divs, scan] = await Promise.all([
          !fund && isCompanyLike(s) ? loadCompany(s).catch(() => null) : Promise.resolve(null),
          loadDividends(s).catch(() => null),
          loadScan().catch(() => null),
        ]);
        let earn: { date?: string; time?: string } | null | undefined = setupsFor(scan, s).map((x) => x.setup.earnings).find((e) => e?.date);
        if (!earn && worldReady()) {
          // Finnhub's earnings calendar (free key) fills the date for companies the scanner doesn't cover.
          const f = await engineRequest<{ events?: { date: string; hour: string }[] }>('finnhub.earnings', { symbol: s, days: 31 }, 30000).catch(() => null);
          const next = f?.events?.[0];
          if (next) earn = { date: next.date, time: next.hour };
        }
        const dv = divs ? dividendSummary(divs.dividends, divs.closes[divs.closes.length - 1]?.[1] ?? null, new Date().toISOString().slice(0, 10)) : null;
        const lastDiv = divs?.dividends[divs.dividends.length - 1];
        return panel(
          'Events',
          'Scanner earnings check (Nasdaq-100) or Finnhub, SEC filings, Yahoo dividends',
          null,
          kvGrid([
...(fund ? [] : ([            ['Next earnings', fig(earn?.date ? `${fmtDate(earn.date)}${earn.time ? ` (${earn.time})` : ''}` : DASH, { reason: NASDAQ_100.includes(s) ? 'the scanner has no date for it yet' : 'free data has no earnings calendar; the scanner checks Nasdaq-100 members only' })],
            ['Last earnings filed', fig(company?.quote.lastEarnings ? fmtDate(company.quote.lastEarnings) : DASH, { reason: 'no 10-Q/10-K date in the reply' })]] as KV[])),
            ['Next ex-dividend (estimate)', fig(dv?.nextEx ? `~${fmtDate(dv.nextEx)}` : DASH, { reason: dv && dv.ttm ? 'too few payments to estimate' : 'no regular dividend' })],
            ['Last dividend', fig(lastDiv ? `$${fmtNum(lastDiv[1], 4)} · ex ${fmtDate(lastDiv[0])}` : DASH, { reason: 'no dividend history' })],
          ]),
        );
      });
}

/** A weight bar (0-100%) with its figure. */
const weightBar = (w: number | null | undefined, max = 1) =>
  h('span', { class: 'fd-bar' }, h('i', { style: `width:${Math.max(0, Math.min(100, ((w ?? 0) / (max || 1)) * 100)).toFixed(1)}%` }), h('b', {}, fmtPct(w, 1)));

/** Fund return figures: a signed percent; the gap to the category in points. */
const fp = (v: number | null | undefined) => fig(fmtPct(v, 2, true), { tone: tone(v), reason: 'not given for this period' });
const gapCell = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? fig(DASH, { reason: 'needs both figures' }) : fig(`${a - b >= 0 ? '+' : '−'}${Math.abs((a - b) * 100).toFixed(1)}`, { tone: tone(a - b), title: 'Percentage points ahead of (+) or behind (−) the category' });

function fundSlot(ctx: TabCtx, what: string, draw: (f: FundProfile) => Node | null) {
  return slot(ctx, what, async () => {
    if ((helper.version ?? 0) < FUND_HELPER_VERSION) throw new Error('fund information needs helper 93 (it installs by itself)');
    const f = await loadFund(ctx.symbol);
    ctx.share('fund', f);
    return draw(f) ?? h('span', {});
  });
}

const YAHOO = 'Yahoo Finance fund data';

/** The fund overview: profile and costs, objective, holdings, mix and sectors, characteristics, returns and risk. */
function fundDes(ctx: TabCtx) {
  const s = ctx.symbol;
  ctx.body.replaceChildren(
    grid(
      priceStatsSlot(ctx),
      fundSlot(ctx, 'fund profile', (f) => {
        const band = costBand(f.expenseRatio);
        return panel(
          'Fund profile',
          `${YAHOO}; Morningstar ratings as Yahoo shows them`,
          f.fetched,
          kvGrid([
            ['Type', f.legalType || (f.kind === 'etf' ? 'Exchange-traded fund' : 'Mutual fund')],
            ['Family', fig(f.family ?? DASH, { reason: 'not given' })],
            ['Category', fig(f.category ?? DASH, { reason: 'not given' })],
            ['Inception', fig(f.inception ? fmtDate(f.inception) : DASH, { reason: 'not given' })],
            ['Net assets', fig(money(f.netAssets), { reason: 'not given' })],
            ...(f.kind === 'mutualfund' || f.nav != null ? ([['NAV', fig(fmtPrice(f.nav), { reason: 'not given' })]] as KV[]) : []),
            ['Yield (12 months)', fig(fmtPct(f.yield, 2), { reason: 'no distributions in the last 12 months' })],
            ['Expense ratio', h('span', {}, fig(fmtPct(f.expenseRatio, 2), { reason: 'not given' }), band ? h('span', { class: 'muted small' }, ` · ${band}`) : ''), costWords(f.expenseRatio)],
            ...(f.grossExpenseRatio != null && f.grossExpenseRatio !== f.expenseRatio ? ([['Gross expense ratio', fmtPct(f.grossExpenseRatio, 2), 'Before fee waivers']] as KV[]) : []),
            ['Turnover', fig(fmtPct(f.turnover, 0), { reason: 'not given' }), 'Share of the portfolio replaced in a year: higher means more trading costs and taxable gains'],
            ...(f.frontLoad || f.deferredLoad ? ([['Sales loads', `${f.frontLoad ? `front ${fmtPct(f.frontLoad, 2)}` : ''}${f.frontLoad && f.deferredLoad ? ' · ' : ''}${f.deferredLoad ? `deferred ${fmtPct(f.deferredLoad, 2)}` : ''}`]] as KV[]) : []),
            ...(f.twelveB1 ? ([['12b-1 fee', fmtPct(f.twelveB1, 2), 'Yearly marketing fee inside the expense ratio']] as KV[]) : []),
            ...(f.minInvestment ? ([['Minimum investment', money(f.minInvestment)]] as KV[]) : []),
            ['Morningstar rating', fig(stars(f.morningstarRating) ?? DASH, { reason: 'not rated (needs 3 years of history)' })],
            ['Morningstar risk', fig(riskWords(f.morningstarRisk) ?? DASH, { reason: 'not rated' }), 'Downside risk against its category'],
            ['Beta (3 years)', fig(f.beta3y != null ? f.beta3y.toFixed(2) : DASH, { reason: 'needs 3 years' }), 'Moves against the S&P 500: 1.0 = in step'],
          ]),
        );
      }),
      fundSlot(ctx, 'objective', (f) =>
        panel('Objective', YAHOO, f.fetched, f.objective ? h('p', { class: 'sv-desc' }, f.objective) : note('The fund’s objective isn’t in the data. It is in the prospectus (the fund family’s website).'), h('p', { class: 'muted small' }, h('a', { href: f.url, target: '_blank', rel: 'noopener' }, 'Full fund page on Yahoo Finance ↗'))),
      ),
      wideSlot(
        fundSlot(ctx, 'top holdings', (f) => {
          if (!f.holdings.length) return panel('Top holdings', YAHOO, f.fetched, note('No holdings in the data for this fund.'));
          const max = Math.max(...f.holdings.map((x) => x.weight));
          return panel(
            `Top ${f.holdings.length} holdings`,
            `${YAHOO} (from the fund's latest published portfolio)`,
            f.fetched,
            h(
              'div',
              { class: 'sv-table-wrap' },
              h(
                'table',
                { class: 'sv-table fd-holdings' },
                h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Holding'), h('th', {}, 'Symbol'), h('th', { class: 'num' }, 'Weight'))),
                h(
                  'tbody',
                  {},
                  ...f.holdings.map((x, i) =>
                    h(
                      'tr',
                      x.symbol ? { class: 'tt-open', tabindex: 0, title: `Open ${x.symbol}`, onclick: () => ctx.open(x.symbol.split('.')[0]), onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && ctx.open(x.symbol.split('.')[0]) } : {},
                      h('td', { class: 'muted' }, String(i + 1)),
                      h('td', {}, x.name || x.symbol),
                      h('td', { class: 'sym' }, x.symbol || DASH),
                      h('td', { class: 'num' }, weightBar(x.weight, max)),
                    ),
                  ),
                ),
              ),
            ),
            f.holdingsShare ? h('p', { class: 'muted small' }, `These ${f.holdings.length} make up ${fmtPct(f.holdingsShare, 1)} of the fund.`) : null,
          );
        }),
      ),
      fundSlot(ctx, 'asset mix and sectors', (f) =>
        panel(
          'Asset mix and sectors',
          YAHOO,
          f.fetched,
          f.mix.length ? h('div', { class: 'fd-bars' }, ...f.mix.map((m) => h('div', { class: 'fd-row' }, h('span', {}, m.label), weightBar(m.weight)))) : note('No asset mix in the data.'),
          f.sectors.length
            ? h('div', { class: 'fd-bars' }, h('h4', { class: 'fd-sub' }, 'Sectors (stocks)'), ...f.sectors.map((x) => h('div', { class: 'fd-row' }, h('span', {}, x.sector), weightBar(x.weight, f.sectors[0].weight))))
            : null,
        ),
      ),
      fundSlot(ctx, 'characteristics', (f) => {
        const e = f.equity;
        const hasEq = Object.values(e).some((v) => v != null);
        const hasBd = f.bonds.duration != null || f.bonds.maturity != null || f.ratings.length > 0;
        if (!hasEq && !hasBd) return null;
        return panel(
          hasBd && !hasEq ? 'Bond characteristics' : 'Portfolio characteristics',
          YAHOO,
          f.fetched,
          hasEq
            ? kvGrid([
                ['Price / earnings', fig(fmtX(e.priceToEarnings), { reason: 'not given' })],
                ['Price / book', fig(fmtX(e.priceToBook), { reason: 'not given' })],
                ['Price / sales', fig(fmtX(e.priceToSales), { reason: 'not given' })],
                ['Price / cash flow', fig(fmtX(e.priceToCashflow), { reason: 'not given' })],
                ['Median market cap', fig(e.medianMarketCap != null ? money(e.medianMarketCap * 1e6) : DASH, { reason: 'not given' }), 'Of the stocks it holds (Yahoo reports it in millions)'],
                ['Earnings growth (3 years)', fig(fmtPct(e.threeYearEarningsGrowth, 1, true), { tone: tone(e.threeYearEarningsGrowth), reason: 'not given' })],
              ])
            : null,
          hasBd
            ? kvGrid([
                ['Duration', fig(f.bonds.duration != null ? `${f.bonds.duration.toFixed(1)} years` : DASH, { reason: 'not given' }), 'About how much prices fall (in %) if rates rise 1 point'],
                ['Average maturity', fig(f.bonds.maturity != null ? `${f.bonds.maturity.toFixed(1)} years` : DASH, { reason: 'not given' })],
              ])
            : null,
          f.ratings.length ? h('div', { class: 'fd-bars' }, h('h4', { class: 'fd-sub' }, 'Credit ratings'), ...f.ratings.map((r) => h('div', { class: 'fd-row' }, h('span', {}, r.rating), weightBar(r.weight)))) : null,
        );
      }),
      fundSlot(ctx, 'returns against the category', (f) => {
        if (!f.trailing.length) return panel('Returns', YAHOO, f.fetched, note('No return history in the data.'));
        return panel(
          'Returns against its category',
          `${YAHOO}${f.trailingAsOf ? `, total returns to ${fmtDate(f.trailingAsOf)}` : ''}`,
          f.fetched,
          numTable(['Period', 'Fund', 'Category', '+/− pts'], f.trailing.map((t) => ({ label: t.period, cells: [fp(t.fund), fp(t.category), gapCell(t.fund, t.category)] }))),
          versusCategory(f.trailing) ? h('p', { class: 'muted small' }, versusCategory(f.trailing)!) : null,
        );
      }),
      fundSlot(ctx, 'calendar years', (f) =>
        f.annual.length
          ? panel(
              'Calendar-year returns',
              YAHOO,
              f.fetched,
              numTable(['Year', 'Fund', 'Category'], f.annual.map((a) => ({ label: a.year, cells: [fp(a.fund), fp(a.category)] }))),
              f.yearsUp != null ? h('p', { class: 'muted small' }, `${f.yearsUp} years up, ${f.yearsDown ?? 0} down${f.best.oneYear != null ? `; best 12 months ${fmtPct(f.best.oneYear, 1, true)}, worst ${fmtPct(f.worst.oneYear, 1, true)}` : ''}.`) : null,
            )
          : null,
      ),
      fundSlot(ctx, 'risk against the category', (f) => {
        const r = f.risk.find((x) => x.years === '3y') ?? f.risk[0];
        if (!r) return null;
        const c = r.category ?? {};
        const n = (v: number | null | undefined, d = 2, unit = '') => fig(v == null ? DASH : `${v.toFixed(d)}${unit}`, { reason: 'not given' });
        return panel(
          `Risk (${r.years.replace('y', ' years')})`,
          `${YAHOO} (Morningstar risk statistics)`,
          f.fetched,
          numTable(['Measure', 'Fund', 'Category'], [
            { label: 'Standard deviation', cells: [n(r.stdDev, 2, '%'), n(c.stdDev, 2, '%')] },
            { label: 'Sharpe ratio', cells: [n(r.sharpeRatio), n(c.sharpeRatio)] },
            { label: 'Alpha', cells: [n(r.alpha), n(c.alpha)] },
            { label: 'Beta', cells: [n(r.beta), n(c.beta)] },
            { label: 'R-squared', cells: [n(r.rSquared, 1), n(c.rSquared, 1)] },
          ]),
          h('p', { class: 'muted small' }, 'Standard deviation: how much returns swing (yearly). Sharpe: return per unit of that swing. Alpha: return beyond what its beta would give. R-squared: how closely it follows its benchmark (100 = exactly).'),
        );
      }),
      ychartsSlot(ctx),
      eventsSlot(ctx, true),
    ),
  );
  void s;
}

/** YCharts figures (the owner's paid key): grouped label/value lists of what the plan returns; hidden without a key. */
function ychartsSlot(ctx: TabCtx) {
  return slot(ctx, 'YCharts', async () => {
    if ((helper.version ?? 0) < YCHARTS_HELPER_VERSION || !(await ychartsKeySet())) return [];
    const b = await loadBoard(ctx.symbol).catch(() => null);
    const mf = (b?.row?.assetType ?? '').toUpperCase() === 'MUTUAL_FUND';
    const kind = mf ? 'mutual_funds' : 'companies';
    const list: YMetric[] = mf ? FUND_METRICS : COMPANY_METRICS;
    const id = ychartsId(ctx.symbol, kind);
    const r = await yPoints(kind, [id], list.map((x) => x.code));
    const row = r.results[id] ?? Object.values(r.results)[0] ?? {};
    ctx.share('ycharts', row);
    const have = list.filter((x) => row[x.code]?.value != null);
    const missing = list.filter((x) => row[x.code]?.value == null);
    const groups = [...new Set(have.map((x) => x.group))];
    return panel(
      'YCharts',
      'YCharts API (your key)',
      r.fetched,
      ...(have.length
        ? groups.map((g) =>
            h('div', {}, h('h4', { class: 'fd-sub' }, g), kvGrid(have.filter((x) => x.group === g).map((x) => [x.label, fig(yFormat(row[x.code].value, x.format), { title: row[x.code].date ? `as of ${row[x.code].date}` : '' })] as KV))),
          )
        : [note(`YCharts returned none of these figures for ${id}: ${row[list[0].code]?.error ?? 'no data'}.`)]),
      missing.length && have.length ? h('p', { class: 'muted small' }, `Not in your YCharts plan or not reported for ${id}: ${missing.map((x) => x.label).join(', ')}.`) : null,
      h('p', { class: 'muted small' }, h('a', { href: `#ycharts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}` }, 'Chart any YCharts metric for it →')),
    );
  });
}

function companyDes(ctx: TabCtx) {
  const s = ctx.symbol;
  const company = isCompanyLike(s);
  ctx.body.replaceChildren(
    grid(
      priceStatsSlot(ctx),
      company
        ? slot(ctx, 'valuation', async () => {
            const d = await loadCompany(s);
            ctx.share('company', { profile: d.profile, valuation: d.valuation, ttm: d.ttm, quote: d.quote });
            const v = d.valuation;
            return panel(
              'Valuation',
              `${SEC}; price from Schwab`,
              d.filings?.[0]?.filed,
              kvGrid([
                ['Market cap', fig(money(v.marketCap), { reason: 'share count not in the filings' })],
                ['Enterprise value', fig(money(v.enterpriseValue), { reason: 'debt or cash not reported' }), 'Market cap + debt − cash'],
                ['Price / sales', fig(fmtX(v.ps), { reason: 'no revenue reported' })],
                ['Price / free cash flow', fig(fmtX(v.pfcf), { reason: 'free cash flow negative or not reported' })],
                ['EV / EBITDA', fig(fmtX(v.evEbitda), { reason: 'EBITDA negative or not reported' })],
                ['FCF yield', fig(fmtPct(v.fcfYield, 1), { reason: 'free cash flow not reported' })],
              ]),
            );
          })
        : null,
      company ? slot(ctx, 'analyst views', () => analystPanel(s)) : null,
      company ? slot(ctx, 'earnings vs estimates', () => earningsPanel(s)) : null,
      company
        ? slot(ctx, 'company description', async () => {
            const d = await loadCompany(s);
            const tenK = d.filings.find((f) => f.form === '10-K');
            const fye = d.profile.fiscalYearEnd;
            return panel(
              'Description',
              SEC,
              d.filings?.[0]?.filed,
              h('p', { class: 'sv-desc' }, h('b', {}, d.profile.name), ` trades on ${d.profile.exchange || 'a US exchange'}.`, d.profile.industry ? ` Industry (SEC SIC code): ${d.profile.industry}.` : ''),
              kvGrid([
                ['Sector', fig(sectorOf(s) ?? DASH, { reason: 'plain sectors are kept for Nasdaq-100 members only' })],
                ['Fiscal year ends', fig(fye && fye.length === 4 ? `${fye.slice(0, 2)}/${fye.slice(2)}` : DASH, { reason: 'not in the SEC profile' })],
                ['SEC CIK', String(d.profile.cik)],
                ['Latest annual report', tenK ? h('a', { href: tenK.url, target: '_blank', rel: 'noopener' }, `10-K filed ${fmtDate(tenK.filed)}`) : fig(DASH, { reason: 'no 10-K in the recent filings' })],
              ]),
              note('A full business description is in Item 1 of the 10-K (link above). Free data has no ready-made summary.'),
            );
          })
        : panel('Description', 'this platform', null, note('Indexes, funds without SEC company filings and crypto have no company description; the price, chart and risk tabs still work.')),
      company
        ? slot(ctx, 'fundamentals', async () => {
            const d = await loadCompany(s);
            const t = d.ttm;
            const margin = ok(t.revenue) && ok(t.netIncome) && t.revenue ? t.netIncome / t.revenue : null;
            return panel(
              'Fundamentals (last 12 months)',
              SEC,
              d.filings?.[0]?.filed,
              kvGrid([
                ['Revenue', money(t.revenue)],
                ['Net income', fig(money(t.netIncome), { tone: tone(t.netIncome) })],
                ['Net margin', fig(fmtPct(margin, 1), { tone: tone(margin) })],
                ['Free cash flow', fig(money(t.freeCashFlow), { tone: tone(t.freeCashFlow) })],
                ['Cash', money(d.valuation.cash)],
                ['Debt', money(d.valuation.debt)],
              ]),
            );
          })
        : null,
      ychartsSlot(ctx),
      eventsSlot(ctx),
    ),
  );
}

interface AnalystReply {
  needsKey?: boolean;
  note?: string;
  trends?: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; total: number; consensus: string; score?: number }[];
  fetched?: number;
}

/** Analyst recommendation trends (ANR) from Finnhub's free tier; a note pointing to Settings without a key. */
async function analystPanel(s: string): Promise<HTMLElement> {
  if (!(await worldAvailable())) {
    const why = helper.isConnected ? 'Analyst views need the updated helper (version 44 or newer).' : 'Analyst views appear when the helper is running.';
    return panel('Analyst views', 'Finnhub', null, note(why));
  }
  const r = await engineRequest<AnalystReply>('finnhub.recommendations', { symbol: s }, 30000);
  if (r.needsKey) return panel('Analyst views', 'Finnhub (free key)', null, note(r.note ?? 'Add a free Finnhub key in Settings > Data connections.'));
  const t = r.trends?.[0];
  if (!t) return panel('Analyst views', 'Finnhub', r.fetched ?? null, note('No analyst ratings published for this company.'));
  const prev = r.trends?.[1];
  const buys = t.strongBuy + t.buy;
  const sells = t.sell + t.strongSell;
  return panel(
    'Analyst views',
    `Finnhub · ${t.total} analysts, month of ${t.period.slice(0, 7)}`,
    r.fetched ?? null,
    h(
      'div',
      { class: 'anr' },
      h(
        'div',
        { class: 'anr-box' },
        h('span', { class: 'anr-label' }, 'Consensus'),
        h('b', { class: `anr-word ${(t.score ?? 0) >= 0.5 ? 'up' : (t.score ?? 0) <= -0.5 ? 'down' : ''}` }, t.consensus),
        h('dl', { class: 'kv' }, h('dt', {}, 'Buy'), h('dd', { class: 'up' }, String(buys)), h('dt', {}, 'Hold'), h('dd', {}, String(t.hold)), h('dt', {}, 'Sell'), h('dd', { class: 'down' }, String(sells)), h('dt', {}, 'Month before'), h('dd', {}, prev ? prev.consensus : DASH)),
      ),
      ratingChart(r.trends ?? []),
    ),
    h('p', { class: 'anr-words' }, ratingWords(r.trends ?? [])),
  );
}

interface SurpriseReply {
  needsKey?: boolean;
  note?: string;
  quarters?: Surprise[];
  fetched?: number;
}

/** Earnings per share reported vs the analysts' estimate, last quarters (EE / SURP), Finnhub free tier. */
async function earningsPanel(s: string): Promise<HTMLElement> {
  if (!(await worldAvailable())) return panel('Earnings vs estimates', 'Finnhub', null, note('Appears when the helper is running.'));
  let r: SurpriseReply;
  try {
    r = await engineRequest<SurpriseReply>('finnhub.surprises', { symbol: s }, 30000);
  } catch (err) {
    if (/unknown request|not in test/i.test(reasonOf(err))) return panel('Earnings vs estimates', 'Finnhub', null, note('Needs the updated helper (version 84 or newer).'));
    throw err;
  }
  if (r.needsKey) return panel('Earnings vs estimates', 'Finnhub (free key)', null, note(r.note ?? 'Add a free Finnhub key in Settings > Data connections.'));
  const q = r.quarters ?? [];
  if (!q.length) return panel('Earnings vs estimates', 'Finnhub', r.fetched ?? null, note('No reported quarters with an estimate for this company.'));
  return panel(
    'Earnings vs estimates',
    'Finnhub · earnings per share, reported vs expected',
    r.fetched ?? null,
    surpriseChart(q),
    h('p', { class: 'anr-words' }, surpriseWords(q)),
  );
}

// ---------- FA ----------

const PERIOD_KEY = 'tp-sec-fa-period';
const readPeriod = (): 'annual' | 'quarterly' => {
  try {
    return localStorage.getItem(PERIOD_KEY) === 'quarterly' ? 'quarterly' : 'annual';
  } catch {
    return 'annual';
  }
};

const RATIOS: [string, string, 'pct' | 'x'][] = [
  ['revenueGrowth', 'Revenue growth', 'pct'],
  ['epsGrowth', 'EPS growth', 'pct'],
  ['grossMargin', 'Gross margin', 'pct'],
  ['operatingMargin', 'Operating margin', 'pct'],
  ['netMargin', 'Net margin', 'pct'],
  ['fcfMargin', 'Free cash flow margin', 'pct'],
  ['roe', 'Return on equity', 'pct'],
  ['roa', 'Return on assets', 'pct'],
  ['currentRatio', 'Current ratio', 'x'],
  ['debtToEquity', 'Debt / equity', 'x'],
];

const FA_PICK_KEY = 'tp-sec-fa-graph';
const readFaPicked = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FA_PICK_KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 3) : ['revenue', 'netIncome'];
  } catch {
    return ['revenue', 'netIncome'];
  }
};
const saveFaPicked = (v: string[]) => {
  try {
    localStorage.setItem(FA_PICK_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
};
let faPicked = readFaPicked();

export function faTab(ctx: TabCtx) {
  const s = ctx.symbol;
  if (!isCompanyLike(s)) return ctx.body.replaceChildren(note('Financial statements are for companies that file with the SEC.'));
  let period = readPeriod();
  const host = h('div', {});
  const draw = (d: CompanyData) => {
    const st = d[period];
    const quarterly = period === 'quarterly';
    const cols = st.periods.slice(-(quarterly ? 8 : 6));
    const off = st.periods.length - cols.length;
    const head = ['', ...cols.map((p) => {
      const dt = new Date(`${p}T00:00:00Z`);
      return quarterly ? `${dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${String(dt.getUTCFullYear()).slice(2)}` : `FY${dt.getUTCFullYear()}`;
    })];
    const vals = (k: string) => (st.values[k] ?? []).slice(off);
    const fmt = (k: string, v: number | null) => (v == null ? DASH : k === 'epsDiluted' ? fmtChange(v).replace('+', '') : k === 'dilutedShares' ? fmtCompact(v) : money(v));
    // a line's name is a toggle: click it to chart it in the graph above (Bloomberg's FA graph mode)
    const lineLabel = (k: string) =>
      h('button', { type: 'button', class: `fa-pick ${faPicked.includes(k) ? 'on' : ''}`, 'aria-pressed': String(faPicked.includes(k)), title: faPicked.includes(k) ? 'Remove from the chart' : 'Chart this line', onclick: () => ((faPicked = togglePick(faPicked, k)), saveFaPicked(faPicked), draw(d)) }, h('i', { 'aria-hidden': 'true' }), d.labels[k] ?? k);
    const statement = (title: string, keys: string[]) => {
      const shown = keys.filter((k) => vals(k).some((v) => v != null));
      return panel(title, `${SEC}${quarterly ? '; Q4 = full year minus the first three quarters' : '; each 10-K'}`, d.filings?.[0]?.filed, shown.length ? numTable(head, shown.map((k) => ({ label: lineLabel(k), cells: vals(k).map((v) => fmt(k, v)), cls: ['netIncome', 'freeCashFlow', 'equity'].includes(k) ? 'total' : '' }))) : note('Not reported in the XBRL data.'));
    };
    const graphSeries = faPicked.filter((k) => vals(k).some((v) => v != null)).map((k) => ({ key: k, label: d.labels[k] ?? k, values: vals(k) }));
    // per share: from the statements (diluted shares)
    const sh = vals('dilutedShares');
    const perShare = (k: string) => vals(k).map((v, i) => (v != null && sh[i] ? v / sh[i]! : null));
    const ratioRows = RATIOS.filter(([k]) => (d.ratios[k] ?? []).some((v) => v != null)).map(([k, label, kind]) => ({
      label,
      cells: (d.ratios[k] ?? []).slice(-(cols.length)).map((v) => (kind === 'pct' ? fmtPct(v, 1, k.endsWith('Growth')) : v == null ? DASH : fmtNum(v, 2))),
    }));
    host.replaceChildren(
      h('div', { class: 'sv-subbar' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' }, ...(['annual', 'quarterly'] as const).map((p) => h('button', { type: 'button', class: p === period ? 'active' : '', 'aria-pressed': String(p === period), onclick: () => {
          period = p;
          try { localStorage.setItem(PERIOD_KEY, p); } catch { /* storage blocked */ }
          draw(d);
        } }, p === 'annual' ? 'Annual' : 'Quarterly'))),
        h('span', { class: 'muted small' }, 'US dollars. Figures as filed; blank lines are labels the company reports its own way.'),
      ),
      panel('Chart', SEC, d.filings?.[0]?.filed, faGraph(graphSeries, head.slice(1), (v) => money(v) ?? String(v))),
      statement('Income statement', d.sections.income),
      statement('Balance sheet', d.sections.balance),
      statement('Cash flow', d.sections.cashflow),
      panel('Per share (diluted)', `${SEC}; divided by diluted shares`, d.filings?.[0]?.filed, numTable(head, [
        { label: 'Earnings per share', cells: vals('epsDiluted').map((v) => (v == null ? DASH : fmtNum(v, 2))) },
        { label: 'Revenue per share', cells: perShare('revenue').map((v) => (v == null ? DASH : fmtNum(v, 2))) },
        { label: 'Free cash flow per share', cells: perShare('freeCashFlow').map((v) => (v == null ? DASH : fmtNum(v, 2))) },
        { label: 'Book value per share', cells: perShare('equity').map((v) => (v == null ? DASH : fmtNum(v, 2))) },
      ])),
      ratioRows.length && !quarterly ? panel('Margins, growth and returns', `${SEC}; worked out from the yearly statements`, d.filings?.[0]?.filed, numTable(['', ...d.annual.periods.slice(-cols.length).map((p) => `FY${p.slice(0, 4)}`)], ratioRows)) : quarterly ? note('Margins and growth are shown on the Annual view.') : '',
    );
    ctx.share('financials', { period, periods: cols, income: Object.fromEntries(d.sections.income.map((k) => [k, vals(k)])) });
  };
  ctx.body.replaceChildren(host);
  host.replaceChildren(loadingNote('financial statements from the SEC'));
  loadCompany(s).then((d) => ctx.still() && draw(d), (err) => ctx.still() && host.replaceChildren(note(`Not available: ${reasonOf(err)}`, 'sv-error')));
}

// ---------- HDS ----------

export function hdsTab(ctx: TabCtx) {
  const s = ctx.symbol;
  if (!isCompanyLike(s)) return ctx.body.replaceChildren(note('Holders are reported for US-listed company shares.'));
  ctx.body.replaceChildren(
    grid(
      slot(ctx, 'institutional holders (13F)', async () => {
        const d = await loadHolders(s);
        ctx.share('holders', d.quarters);
        const q = d.quarters[d.quarters.length - 1];
        const netBuyers = q.new != null ? (q.new ?? 0) + (q.added ?? 0) - (q.reduced ?? 0) - (q.soldOut ?? 0) : null;
        return panel(
          'Institutions (13F)',
          'SEC Form 13F (your Prospecting download); filed up to 45 days after each quarter',
          q.period,
          kvGrid([
            ['Filers holding it', fmtNum(q.holders, 0)],
            ['Shares held', fmtCompact(q.shares)],
            ['Value reported', money(q.value)],
            ['Net buyers (opened + added − reduced − sold out)', fig(netBuyers == null ? DASH : `${netBuyers > 0 ? '+' : ''}${fmtNum(netBuyers, 0)}`, { tone: tone(netBuyers), reason: 'needs two quarters' })],
          ]),
          numTable(['Quarter', ...d.quarters.map((x) => x.period)], [
            { label: 'Holders', cells: d.quarters.map((x) => fmtNum(x.holders, 0)) },
            { label: 'Shares', cells: d.quarters.map((x) => fmtCompact(x.shares)) },
            { label: 'Opened', cells: d.quarters.map((x) => (x.new == null ? DASH : fmtNum(x.new, 0))) },
            { label: 'Added', cells: d.quarters.map((x) => (x.added == null ? DASH : fmtNum(x.added, 0))) },
            { label: 'Reduced', cells: d.quarters.map((x) => (x.reduced == null ? DASH : fmtNum(x.reduced, 0))) },
            { label: 'Sold out', cells: d.quarters.map((x) => (x.soldOut == null ? DASH : fmtNum(x.soldOut, 0))) },
          ]),
          d.note ? note(d.note) : null,
        );
      }),
      slot(ctx, 'insider trades (Form 4)', async () => {
        const d = await loadInsiders(s);
        const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
        const recent = d.trades.filter((t) => (t.filed || t.date) >= yearAgo);
        const sum = (code: 'P' | 'S') => recent.filter((t) => t.code === code).reduce((a, t) => a + (t.value ?? 0), 0);
        const people = (code: 'P' | 'S') => new Set(recent.filter((t) => t.code === code).map((t) => t.insider)).size;
        ctx.share('insiders', { buys12m: sum('P'), sells12m: sum('S'), trades: d.trades.slice(-15) });
        const rows = [...d.trades].reverse().slice(0, 25);
        return panel(
          'Insiders (open-market trades)',
          'SEC Form 4, dated when filed (the day it became public)',
          d.trades[d.trades.length - 1]?.filed ?? null,
          kvGrid([
            ['Bought, last 12 months', fig(money(sum('P')), { tone: sum('P') ? 'up' : '' }), `${people('P')} insider(s)`],
            ['Sold, last 12 months', fig(money(sum('S')), { tone: sum('S') ? 'down' : '' }), `${people('S')} insider(s)`],
            ['Filings read', `${fmtNum(d.filings, 0)} since ${fmtDate(d.since)}`],
          ]),
          rows.length
            ? h('div', { class: 'sv-table-wrap' }, h('table', { class: 'sv-table' },
                h('thead', {}, h('tr', {}, ...['Filed', 'Insider', 'Role', '', 'Shares', 'Price', 'Value'].map((x, i) => h('th', { class: i >= 4 ? 'num' : '' }, x)))),
                h('tbody', {}, ...rows.map((t) => h('tr', {},
                  h('td', {}, fmtDate(t.filed || t.date)),
                  h('td', {}, t.insider),
                  h('td', { class: 'muted small' }, t.title || DASH),
                  h('td', {}, h('b', { class: t.code === 'P' ? 'up' : 'down' }, t.code === 'P' ? 'Buy' : 'Sell')),
                  h('td', { class: 'num' }, fmtCompact(t.shares)),
                  h('td', { class: 'num' }, fig(fmtPrice(t.price), { reason: 'no price on the filing' })),
                  h('td', { class: 'num' }, fig(money(t.value), { reason: 'no price on the filing' })),
                ))))
              )
            : note('No open-market insider buys or sells in the last two years. Planned sales and awards are left out.'),
        );
      }),
      wideSlot(slot(ctx, 'top holders (13F)', async () => {
        const d = await loadHolders(s);
        if (!d.top) return panel('Top holders', 'SEC Form 13F', null, note('Holder names arrive with the updated helper (version 89 or newer).'));
        if (!d.top.length) return panel('Top holders', 'SEC Form 13F', d.period ?? null, note('No 13F holders in the newest quarter of the download.'));
        ctx.share('topHolders', d.top.slice(0, 10).map((r) => ({ name: r.name, shares: r.shares, change: r.change, status: r.status })));
        return panel(
          'Top holders',
          `SEC Form 13F · quarter ending ${d.period}${d.prevPeriod ? `, change since ${d.prevPeriod}` : ''}`,
          d.period ?? null,
          h('p', { class: 'anr-words' }, holderWords(d.top)),
          holdersTable(d.top),
          d.sellers?.length ? h('div', { class: 'hds-sell-box' }, h('h4', {}, 'Biggest sellers last quarter'), sellersList(d.sellers)) : null,
        );
      }))
    ),
  );
}

// ---------- CN ----------

export function cnTab(ctx: TabCtx) {
  const s = ctx.symbol;
  ctx.body.replaceChildren(slot(ctx, 'headlines', async () => {
    const { items, at } = await loadNewsFor(s);
    const rows = [...items].sort((a, b) => b.published - a.published).slice(0, 40);
    ctx.share('news', rows.slice(0, 10).map((r) => ({ title: r.title, source: r.source, published: r.published, impact: r.impact })));
    const { openNewsSummary } = await import('../ui/newsSummary');
    const when = (t: number) => (t ? new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : DASH);
    return panel(
      'Company news',
      'Google News and CNBC (RSS), grouped and scored by the helper',
      at,
      rows.length
        ? h('ol', { class: 'sv-news' }, ...rows.map((item) => h('li', {}, h('button', { type: 'button', class: 'sv-news-row', onclick: () => openNewsSummary(item) },
            h('span', { class: `sv-impact ${item.impact}`, title: `Market impact: ${item.impact}` }),
            h('span', { class: 'sv-news-title' }, item.title),
            h('span', { class: 'muted tiny sv-news-meta' }, `${item.source} · ${when(item.published)}${item.alsoReportedBy.length ? ` · +${item.alsoReportedBy.length} outlets` : ''}`),
          ))))
        : note(`No recent headlines for ${s}.`),
    );
  }));
}

// ---------- OMON ----------

export function omonTab(ctx: TabCtx) {
  const s = ctx.symbol;
  ctx.body.replaceChildren(slot(ctx, 'options', async () => {
    const d = await loadOptions(s);
    const x = d.summary;
    ctx.share('options', { spot: d.spot, expiration: d.expiration, summary: x, unusual: d.unusual.slice(0, 8) });
    const em = x.expectedMove;
    const exp = (d.byExpiration ?? []).slice(0, 8);
    return [
      panel('Options summary', `Schwab option chain (${d.expiration} and nearer)`, Date.now(), kvGrid([
        ['Underlying', fmtPrice(d.spot)],
        ['Put/call volume', fig(fmtNum(x.putCallVolume), { reason: 'no call volume today' }), 'Above 1 = more puts traded than calls'],
        ['Put/call open interest', fig(fmtNum(x.putCallOi), { reason: 'no call open interest' })],
        ['ATM implied volatility', fig(fmtPct(x.atmIv, 1), { reason: 'no at-the-money quote' })],
        ['Max pain', fig(fmtPrice(x.maxPain), { reason: 'no open interest' }), 'The strike where option holders lose the most at expiry'],
        ['Expected move (to nearest expiry)', fig(em ? `±${fmtPrice(em.amount)} (${fmtPct(em.percent, 1)})` : DASH, { reason: 'no straddle price' })],
        ['Call / put volume', `${fmtCompact(x.callVolume)} / ${fmtCompact(x.putVolume)}`],
        ['Net gamma exposure', fig(money(x.netGex), { tone: tone(x.netGex) })],
      ])),
      chainPanel(s, d),
      exp.length
        ? panel('By expiration', 'Schwab option chain', Date.now(), numTable(['Expiry', 'Days', 'P/C vol', 'P/C OI', 'ATM IV', 'Max pain', 'Exp. move'], exp.map((e) => ({
            label: fmtDate(e.expiration),
            cells: [String(e.dte), fmtNum(e.putCallVolume), fmtNum(e.putCallOi), fmtPct(e.atmIv, 1), fmtPrice(e.maxPain), e.expectedMove ? `±${fmtPct(e.expectedMove.percent, 1)}` : DASH],
          }))))
        : null,
      panel('Unusual activity (volume well above open interest)', 'Schwab option chain', Date.now(), d.unusual.length
        ? numTable(['Contract', 'Volume', 'Open int.', 'Vol/OI', 'IV', 'Premium'], d.unusual.slice(0, 12).map((c) => ({
            label: `${c.type === 'call' ? 'C' : 'P'} ${fmtPrice(c.strike)} ${fmtDate(c.expiration)}`,
            cells: [fmtCompact(c.volume), fmtCompact(c.oi), fmtNum(c.ratio, 1), fmtPct(c.iv, 0), money(c.premium)],
          })))
        : note('Nothing unusual today.')),
      optionsAnalyticsBlock(s.replace(/^\$/, ''), undefined, { compact: true }),
      h('p', { class: 'small' }, h('button', { type: 'button', class: 'link-btn', onclick: () => ctx.deps.openPage('flow', 'open', s, 'options') }, 'Full option chain, strikes and gamma on Flow ›')),
    ].filter((n): n is HTMLElement => !!n);
  }));
}

// ---------- DVD ----------

export function dvdTab(ctx: TabCtx) {
  const s = ctx.symbol;
  ctx.body.replaceChildren(slot(ctx, 'dividends', async () => {
    const [d, company] = await Promise.all([loadDividends(s), isCompanyLike(s) ? loadCompany(s).catch(() => null) : Promise.resolve(null)]);
    const price = d.closes[d.closes.length - 1]?.[1] ?? null;
    const today = new Date().toISOString().slice(0, 10);
    const sum = dividendSummary(d.dividends, price, today);
    ctx.share('dividends', { ...sum, byYear: sum.byYear.slice(-6), totalReturn: company?.totalReturn });
    const tr = company?.totalReturn;
    const trRows: KV[] = tr
      ? ([1, 3, 5] as const).map((y) => [
          `${y} year${y > 1 ? 's (a year)' : ''}`,
          h('span', {}, fig(fmtPct(tr[`tr${y}y`], 1, true), { tone: tone(tr[`tr${y}y`]), reason: 'history too short' }), h('span', { class: 'muted small' }, ' price '), fig(fmtPct(tr[`price${y}y`], 1, true), { tone: tone(tr[`price${y}y`]), reason: 'history too short' })),
        ])
      : [];
    if (!d.dividends.length)
      return [panel('Dividends', 'Yahoo Finance dividend history (via the helper)', today, note(`${s} has paid no dividends in the last 5 years.`)), ...(trRows.length ? [panel('Total return', 'Schwab prices + Yahoo dividends, reinvested on the ex-date', today, kvGrid(trRows))] : [])];
    const years = sum.byYear.slice(-8);
    const thisYear = Number(today.slice(0, 4));
    const pays = [...d.dividends].reverse().slice(0, 16);
    return [
      grid(
        panel('Dividend summary', 'Yahoo Finance dividends; price Schwab', today, kvGrid([
          ['Yield (trailing 12 months)', fig(fmtPct(sum.yield), { reason: 'no price' })],
          ['Paid last 12 months', `$${fmtNum(sum.ttm, 4)}`],
          ['Payments a year', fmtNum(sum.perYear, 0)],
          ['Growth (5 years, a year)', fig(fmtPct(sum.growth5y, 1, true), { tone: tone(sum.growth5y), reason: 'needs 6 calendar years of payments' })],
          ['Next ex-date (estimate)', fig(sum.nextEx ? `~${fmtDate(sum.nextEx)}` : DASH, { reason: 'too few payments, or it stopped paying' }), 'The usual gap after the last payment; check the company announcement'],
        ])),
        trRows.length ? panel('Total return (dividends reinvested)', 'Schwab prices + Yahoo dividends, reinvested on the ex-date', today, kvGrid(trRows)) : null,
      ),
      panel('Per share by calendar year', 'Yahoo Finance dividends', today, numTable(['', ...years.map(([y]) => (y === thisYear ? `${y} (so far)` : String(y)))], [
        { label: 'Dividends', cells: years.map(([, v]) => `$${fmtNum(v, 4)}`) },
        { label: 'Change', cells: years.map(([y, v], i) => (i && y !== thisYear && years[i - 1][1] ? fmtPct(v / years[i - 1][1] - 1, 1, true) : DASH)) },
      ])),
      panel('Payment history', 'Yahoo Finance dividends (ex-dates)', today, numTable(['Ex-date', 'Per share'], pays.map(([dte, a]) => ({ label: fmtDate(dte), cells: [`$${fmtNum(a, 4)}`] })))),
    ];
  }));
}

// ---------- BETA / HP ----------

async function riskFreeRate(): Promise<{ rate: number; source: string }> {
  try {
    const d = await engineRequest<{ data: { time: string; value: number }[] }>('macro.series', { series: 'DGS3MO', raw: true, limit: 10 }, 30_000);
    const v = [...d.data].reverse().find((x) => ok(x.value))?.value;
    if (ok(v)) return { rate: v / 100, source: `3-month Treasury ${fmtNum(v, 2)}% (FRED DGS3MO)` };
  } catch {
    // FRED unreachable: an assumption, said so on the page
  }
  return { rate: 0.04, source: '4.00% assumed (FRED not reachable)' };
}

const closesOf = (bars: { time: number; close: number }[]): Close[] => bars.map((b) => [b.time, b.close]);

export function betaTab(ctx: TabCtx) {
  const s = ctx.symbol;
  const bench = s === 'SPY' ? 'QQQ' : 'SPY';
  ctx.body.replaceChildren(
    slot(ctx, 'risk statistics', async () => {
      const [mine, spy, rf] = await Promise.all([loadDaily(s), loadDaily(bench), riskFreeRate()]);
      const a = closesOf(mine);
      const b = closesOf(spy);
      const w = [riskWindow(a, b, 365, rf.rate, '1 year'), riskWindow(a, b, 3 * 365, rf.rate, '3 years')];
      ctx.share('risk', { benchmark: bench, riskFree: rf.rate, windows: w.map((x) => ({ ...x, maxDrawdown: x.maxDrawdown?.depth ?? null })) });
      const span = (x: RiskWindow) => (x.n ? ` (${x.n} days)` : '');
      const short = 'history shorter than the window';
      const ddText = (x: RiskWindow) => (x.maxDrawdown ? fig(fmtPct(x.maxDrawdown.depth, 1), { tone: x.maxDrawdown.depth < 0 ? 'down' : '' }) : fig(DASH, { reason: short }));
      return [
        panel(
          `Risk vs ${bench}`,
          `${SCHWAB} daily closes; simple daily returns, 252 days a year; risk-free ${rf.source}`,
          mine.length ? dayKey(mine[mine.length - 1].time) : null,
          numTable(['', ...w.map((x) => `${x.label}${span(x)}`)], [
            { label: `Beta vs ${bench}`, cells: w.map((x) => fig(fmtNum(x.beta), { reason: short, title: '1 = moves with the market; 1.5 = 50% more' })) },
            { label: `Correlation vs ${bench}`, cells: w.map((x) => fig(fmtNum(x.correlation), { reason: short })) },
            { label: 'Volatility (a year)', cells: w.map((x) => fig(fmtPct(x.vol, 1), { reason: short })) },
            { label: `${bench} volatility`, cells: w.map((x) => fig(fmtPct(x.benchVol, 1), { reason: short })) },
            { label: 'Return (3y: a year)', cells: w.map((x) => fig(fmtPct(x.ret, 1, true), { tone: tone(x.ret), reason: short })) },
            { label: 'Sharpe ratio', cells: w.map((x) => fig(fmtNum(x.sharpe), { tone: tone(x.sharpe), reason: short, title: 'Return above cash per unit of volatility' })) },
            { label: 'Sortino ratio', cells: w.map((x) => fig(fmtNum(x.sortino), { tone: tone(x.sortino), reason: short, title: 'Like Sharpe, counting only falls' })) },
            { label: 'Max drawdown', cells: w.map((x) => ddText(x)) },
          ]),
          note('Beta and correlation use the same trading days for both. Bloomberg’s BETA default is 2 years of weekly returns, so its number can differ.'),
        ),
        slot(ctx, 'correlation to your holdings', () => portfolioPanel(s, a)),
      ];
    }),
  );
}

/** Correlation and beta of the security to the owner's other holdings (value-weighted, today's weights). */
async function portfolioPanel(s: string, asset: Close[]): Promise<Node> {
  const all = await loadPortfolios().catch(() => []);
  const rows = combineHoldings(myPortfolios(all)).filter((r) => r.kind === 'security' && r.shares > 0 && isCompanyLike(r.symbol));
  const candidates = rows.filter((r) => r.symbol !== s);
  if (!candidates.length) return panel('Correlation to your holdings', 'your Account holdings', null, note('No share holdings on the Account page yet (import a statement or sync Webull).'));
  // the largest by value (shares × last price, one board request), so a big position in a cheap stock counts
  const prices = new Map((await loadBoards(candidates.map((r) => r.symbol)).catch(() => ({ rows: [] }))).rows.map((r) => [r.symbol, r.price]));
  const worth = (r: (typeof candidates)[number]) => r.shares * (prices.get(r.symbol) ?? (r.cost != null && r.shares ? r.cost / r.shares : 0));
  const others = [...candidates].sort((x, y) => worth(y) - worth(x)).slice(0, 15);
  const loaded = await Promise.all(others.map((r) => loadDaily(r.symbol).then((bars) => ({ r, bars }), () => null)));
  const ok2 = loaded.filter((x): x is NonNullable<typeof x> => !!x && x.bars.length > 1);
  const value = (x: (typeof ok2)[number]) => x.r.shares * x.bars[x.bars.length - 1].close;
  const total = ok2.reduce((t, x) => t + value(x), 0);
  if (!total) return panel('Correlation to your holdings', 'your Account holdings', null, note('No prices for your holdings right now.'));
  const port = portfolioReturns(ok2.map((x) => ({ weight: value(x), closes: closesOf(x.bars) })));
  const last = asset[asset.length - 1]?.[0] ?? 0;
  const p = pairedReturns(asset.filter(([t]) => t >= last - 365 * 86400), port);
  const held = rows.find((r) => r.symbol === s);
  const heldValue = held && asset.length ? held.shares * asset[asset.length - 1][1] : 0;
  return panel(
    'Correlation to your holdings',
    `your Account holdings (${ok2.length} largest by value, weighted by value at the latest close), ${SCHWAB}`,
    last ? dayKey(last) : null,
    kvGrid([
      ['Correlation (1 year, daily)', fig(fmtNum(correlation(p.a, p.b)), { reason: 'not enough shared history' }), '1 = always moves with your holdings; 0 = unrelated; below 0 = tends to offset them'],
      ['Beta to your holdings', fig(fmtNum(beta(p.a, p.b)), { reason: 'not enough shared history' })],
      ['Your holdings compared', `${ok2.length} positions · ${money(total)}`],
      ['This security in your accounts', heldValue ? `${money(heldValue)} · ${fmtPct(heldValue / (total + heldValue), 1)} of the total` : 'not held'],
    ]),
    p.days.length ? note(`From ${fmtDate(p.days[0])} to ${fmtDate(p.days[p.days.length - 1])} (${p.days.length} shared days).`) : null,
  );
}

// ---------- Setups ----------

const HORIZON_LABEL: Record<string, string> = { short: 'Short swing (hourly)', swing: 'Swing (daily)', position: 'Position (weekly)' };

function setupsFor(scan: Awaited<ReturnType<typeof loadScan>> | null, s: string): { horizon: string; setup: Setup }[] {
  return Object.entries(scan?.horizons ?? {}).flatMap(([horizon, r]) => (r?.setups ?? []).filter((x) => x.symbol === s).map((setup) => ({ horizon, setup })));
}

export function setTab(ctx: TabCtx) {
  const s = ctx.symbol;
  if (!NASDAQ_100.includes(s)) return ctx.body.replaceChildren(panel('Setups', 'the market scanner', null, note(`The scanner covers the Nasdaq-100 only, so ${s} has no setups. Try a member such as ${['AAPL', 'MSFT', 'NVDA'].filter((x) => x !== s)[0]}.`)));
  ctx.body.replaceChildren(slot(ctx, 'setups', async () => {
    const scan = await loadScan();
    if (scan.loading) return note('The first scan after starting the helper takes a few minutes. Check back soon.');
    const list = setupsFor(scan, s);
    ctx.share('setups', list.map(({ horizon, setup: x }) => ({ horizon, strategy: x.strategyName, direction: x.direction, status: x.status, tier: x.tier, plan: x.plan })));
    if (!list.length) return panel('Setups', 'the market scanner (Nasdaq-100, every 5 minutes)', scan.updated, note(`No strategy has a live signal on ${s} right now.`));
    return panel(
      'Setups',
      'the market scanner (Nasdaq-100, every 5 minutes); R is after costs',
      scan.updated,
      h('div', { class: 'sv-table-wrap' }, h('table', { class: 'sv-table' },
        h('thead', {}, h('tr', {}, ...['Time frame', 'Strategy', 'Side', 'Status', 'Grade', 'Entry', 'Stop', 'Target', 'R:R', ''].map((x, i) => h('th', { class: i >= 5 && i < 9 ? 'num' : '' }, x)))),
        h('tbody', {}, ...list.map(({ horizon, setup: x }) => h('tr', {},
          h('td', {}, HORIZON_LABEL[horizon] ?? horizon),
          h('td', {}, x.strategyName),
          h('td', {}, h('b', { class: x.direction > 0 ? 'up' : 'down' }, x.direction > 0 ? 'Long' : 'Short')),
          h('td', {}, x.statusText || x.status),
          h('td', {}, x.tier ? h('span', { class: `badge tier-${x.tier.toLowerCase()}` }, x.tier) : fig(DASH, { reason: x.why?.[0] ?? 'not graded' })),
          h('td', { class: 'num' }, fmtPrice(x.plan.trigger)),
          h('td', { class: 'num' }, fmtPrice(x.plan.stop)),
          h('td', { class: 'num' }, fig(fmtPrice(x.plan.target), { reason: x.plan.trail ? 'trailing exit' : 'no fixed target' })),
          h('td', { class: 'num' }, fig(fmtNum(x.plan.riskReward, 1), { reason: 'trailing exit' })),
          h('td', {}, h('button', { type: 'button', class: 'btn small', onclick: () => ctx.deps.openPage('setups', 'open', `${horizon}:${x.strategy}:${x.symbol}:${x.signalDate}`) }, 'Trade guide')),
        ))),
      )),
    );
  }));
}

export const TAB_RENDER: Record<Exclude<SecTab, 'gp'>, (ctx: TabCtx) => void> = {
  des: desTab,
  hp: hpTab,
  fa: faTab,
  rv: rvTab,
  hds: hdsTab,
  cn: cnTab,
  omon: omonTab,
  dvd: dvdTab,
  beta: betaTab,
  set: setTab,
};

/** The tab's mnemonic for labels ("FA"). */
export const codeOf = (t: SecTab) => tabDef(t).code;
