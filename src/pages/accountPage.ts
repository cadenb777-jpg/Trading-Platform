/**
 * Account: just the owner's own money in one place (like the Snowball app). Every portfolio marked "This is my
 * account" is added together (the same symbol merged across accounts); the dividend figures come from the helper's
 * dividends.portfolio request and are drawn by the Portfolios page's dividends view. Read-only: orders stay in the
 * Webull view's preview → confirm ticket.
 */
import { listDocs } from '../data/store';
import { allocation, combineHoldings, combinedValue, dividendPayload, myPortfolios, todayChange, type CombinedHolding } from '../portfolio/account';
import { drawDividends, fetchDividends, totalReturnCell, type DividendReport } from '../portfolio/dividendsView';
import { fetchPrices, priceMap, type PriceInfo } from '../portfolio/prices';
import { isMine, positions, type Portfolio } from '../portfolio/types';
import { renderWebullCard } from '../portfolio/webullView';
import { dataTable, money, pageFrame, pct, pctU, statCards } from '../ui/charts';
import { h, toast } from '../ui/dom';
import { termLabel } from '../ui/glossary';

type Saved = Portfolio & { id: string };

const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
const signed = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${usd(Math.abs(v))}`);
const tone = (v: number | null | undefined): 'up' | 'down' | '' => (v == null ? '' : v >= 0 ? 'up' : 'down');
const panel = (title: string, note: string | Node, ...body: (Node | string | null)[]) =>
  h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), h('span', { class: 'muted small' }, note)), ...body);

export function createAccountPage(openPortfolio: (id: string) => void) {
  const frame = pageFrame('Account', 'Just your own money: every account you marked as yours, added together, with dividends and allocation.', [
    h('button', { class: 'btn', onclick: () => load() }, 'Refresh'),
  ]);
  let loading = 0;

  async function load() {
    const run = ++loading;
    frame.loading('Adding up your accounts…');
    let all: Saved[];
    try {
      all = await listDocs<Portfolio>('portfolios');
    } catch (err) {
      return frame.error(err);
    }
    const mine = myPortfolios(all);
    const webull = h('div', { class: 'acct-cards acct-webull' });
    if (!mine.length) {
      frame.body.replaceChildren(emptyState(all), webull);
      renderWebullCard(webull, synced, () => openPortfolio('webull'));
      return;
    }
    const rows = combineHoldings(mine);
    const symbols = rows.filter((r) => r.shares > 0).map((r) => r.symbol);
    const payload = dividendPayload(rows);
    const [pr, dv] = await Promise.allSettled([symbols.length ? fetchPrices(symbols) : Promise.resolve({}), payload.length ? fetchDividends(payload) : Promise.reject(new Error('No share holdings, so there are no dividends to show.'))]);
    if (run !== loading) return;
    const prices: Record<string, PriceInfo> = pr.status === 'fulfilled' ? pr.value : {};
    const report = dv.status === 'fulfilled' ? dv.value : null;
    // Prices: the live quote, or the price the dividends request just read.
    const priceOf = (s: string) => prices[s]?.price ?? report?.holdings.find((x) => x.symbol === s)?.price ?? null;
    const valued = rows.map((r) => {
      const value = combinedValue(r, priceOf(r.symbol));
      return { r, value, today: r.shares ? todayChange(value, prices[r.symbol]?.change) : null };
    });
    const total = valued.reduce((s, x) => s + (x.value ?? 0), 0);
    const unpriced = valued.filter((x) => x.value == null).map((x) => x.r.symbol);
    const today = valued.some((x) => x.today != null) ? valued.reduce((s, x) => s + (x.today ?? 0), 0) : null;
    const todayBase = valued.reduce((s, x) => s + (x.today != null && x.value != null ? x.value - x.today : 0), 0);

    const divBox = h('div', { class: 'ap-body' });
    if (report) drawDividends(divBox, report, { hasCash: rows.some((r) => r.kind === 'cash'), stats: false });
    else divBox.replaceChildren(h('div', { class: 'ap-error' }, (dv as PromiseRejectedResult).reason?.message ?? 'Dividend data unavailable.'));

    frame.body.replaceChildren(
      overview(report, total, today, todayBase ? (today ?? 0) / todayBase : null, rows),
      unpriced.length ? h('p', { class: 'badge warn' }, `No live price for ${unpriced.join(', ')}: left out of the totals. Check the helper is logged in to Schwab, then Refresh.`) : '',
      panel(
        'Holdings',
        `${rows.length} holding${rows.length === 1 ? '' : 's'} across ${mine.length} account${mine.length === 1 ? '' : 's'}`,
        holdingsTable(valued, total, report),
      ),
      h('h2', { class: 'section-label acct-section' }, 'Dividends'),
      divBox,
      allocationPanel(valued),
      panel('Accounts', 'Marked "This is my account" in Portfolios', h('div', { class: 'acct-cards' }, ...mine.map((p) => accountCard(p, prices, report))), webull),
    );
    renderWebullCard(webull, synced, () => openPortfolio('webull'));
  }

  /** Snowball-style headline numbers. Gain, income and yields come from the helper's dividends report (share holdings). */
  function overview(r: DividendReport | null, total: number, today: number | null, todayPct: number | null, rows: CombinedHolding[]) {
    const cash = rows.filter((x) => x.kind !== 'security' || !x.shares).reduce((s, x) => s + x.amount, 0);
    return h(
      'div',
      { class: 'acct-stats' },
      statCards([
        { label: 'Total value', value: usd(total), hint: cash ? `Includes ${usd(cash)} cash and other amounts` : 'All your accounts added together' },
        { label: 'Total cost', value: usd(r?.cost), hint: 'What you paid for the shares (where your broker gave a cost basis)' },
        { label: 'Gain', value: r?.gain != null ? `${signed(r.gain)} (${pct(r.gainPct, 1)})` : '—', tone: tone(r?.gain), hint: 'Value − cost, on holdings with a cost basis' },
        {
          label: termLabel('1-yr total return', 'totalreturn'),
          value: pct(r?.totalReturn?.tr1y, 1),
          tone: tone(r?.totalReturn?.tr1y),
          hint: r?.totalReturn?.tr1y != null ? `Price only ${pct(r.totalReturn.price1y, 1)} · if today’s holdings were held all year` : 'Needs a year of price history',
        },
        { label: 'Today', value: today != null ? `${signed(today)} (${pct(todayPct, 2)})` : '—', tone: tone(today), hint: 'Change since yesterday’s close on your shares' },
        { label: 'Yearly dividend income', value: usd(r?.annualIncome), hint: 'Expected over the next 12 months at the latest regular payments' },
        { label: 'Monthly average', value: usd(r?.monthly) },
        { label: termLabel('Portfolio yield', 'divyield'), value: pctU(r?.yield), hint: 'Yearly income ÷ market value of your shares' },
        { label: termLabel('Yield on cost', 'yoc'), value: pctU(r?.yieldOnCost), hint: 'Yearly income ÷ what you paid' },
      ]),
    );
  }

  function holdingsTable(valued: { r: CombinedHolding; value: number | null; today: number | null }[], total: number, report: DividendReport | null) {
    const sorted = [...valued].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const accounts = (r: CombinedHolding) => {
      if (r.parts.length === 1) return h('span', { class: 'muted' }, r.parts[0].account);
      return h(
        'details',
        { class: 'acct-parts' },
        h('summary', {}, `${r.parts.length} accounts`),
        ...r.parts.map((a) => h('div', { class: 'small' }, `${a.account}: ${a.shares ? `${+a.shares.toFixed(4)} sh` : usd(a.amount)}`)),
      );
    };
    return dataTable(
      ['Symbol', 'Shares', 'Price', 'Value', 'Weight', 'Today', 'Gain', '1Y total return', 'Accounts'],
      sorted.map(({ r, value, today }) => {
        const gain = r.cost != null && value != null ? value - r.cost : null;
        return [
          { v: h('span', { title: r.name }, h('b', {}, r.symbol), r.kind !== 'security' ? h('span', { class: `holding-tag ${r.kind}` }, r.kind === 'cash' ? 'Cash' : 'Alt') : ''), cls: 'label' },
          { v: r.shares ? String(+r.shares.toFixed(4)) : '—', cls: 'num' },
          { v: r.shares && value != null ? usd((value - r.amount) / r.shares) : '—', cls: 'num' },
          { v: usd(value), cls: 'num' },
          { v: value != null && total ? pctU(value / total, 1) : '—', cls: 'num' },
          { v: signed(today), cls: `num ${tone(today)}` },
          { v: gain != null ? `${signed(gain)} (${pct(r.cost ? gain / r.cost : null, 1)})` : '—', cls: `num ${tone(gain)}` },
          r.kind === 'security' ? totalReturnCell(report?.holdings.find((x) => x.symbol === r.symbol) ?? {}) : '—',
          accounts(r),
        ];
      }),
      undefined,
      { id: 'account:holdings' },
    );
  }

  function allocationPanel(valued: { r: CombinedHolding; value: number | null }[]) {
    const byHolding = allocation(valued, (x) => x.r.symbol, (x) => x.value);
    const top = byHolding.slice(0, 10);
    const rest = byHolding.slice(10);
    if (rest.length) top.push({ label: `Other (${rest.length})`, value: rest.reduce((s, x) => s + x.value, 0), weight: rest.reduce((s, x) => s + x.weight, 0) });
    const byClass = allocation(valued, (x) => x.r.assetClass, (x) => x.value);
    const list = (items: { label: string; value: number; weight: number }[]) => {
      const max = Math.max(1e-9, ...items.map((x) => x.weight));
      return h(
        'div',
        { class: 'alloc-list' },
        ...items.map((x) =>
          h(
            'div',
            { class: 'alloc-row', title: `${x.label}: ${usd(x.value)}` },
            h('span', { class: 'alloc-label' }, x.label),
            h('span', { class: 'alloc-track' }, h('span', { class: 'alloc-fill', style: `width:${(x.weight / max) * 100}%` })),
            h('span', { class: 'alloc-value num' }, pctU(x.weight, 1)),
          ),
        ),
      );
    };
    return panel(
      'Allocation',
      'Share of your total value',
      h('div', { class: 'acct-alloc' }, h('div', {}, h('h4', {}, 'By holding'), list(top)), h('div', {}, h('h4', {}, 'By asset class'), list(byClass))),
      h('p', { class: 'ap-note' }, 'By sector isn’t shown: there’s no free sector data for every holding. Asset classes come from your portfolios (imports start as US stocks; change one in Portfolios).'),
    );
  }

  function accountCard(p: Saved, prices: Record<string, PriceInfo>, r: DividendReport | null) {
    const pm = { ...Object.fromEntries((r?.holdings ?? []).map((x) => [x.symbol, x.price])), ...priceMap(prices) };
    const { total } = positions(p, pm);
    const n = p.holdings.filter((x) => x.symbol.trim()).length;
    return h(
      'div',
      { class: 'acct-card' },
      h('div', { class: 'acct-card-head' }, h('b', {}, p.name), p.webullAccount ? h('span', { class: 'badge' }, 'Webull') : null),
      h('div', { class: 'acct-card-value' }, money(total)),
      h('div', { class: 'muted small' }, `${n} holding${n === 1 ? '' : 's'}${p.syncedAt ? ` · synced ${new Date(p.syncedAt).toLocaleDateString()}` : ''}`),
      h('div', { class: 'ap-controls' }, h('button', { class: 'btn small', onclick: () => openPortfolio(p.id) }, 'Open in Portfolios')),
    );
  }

  function emptyState(all: Saved[]) {
    return h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'empty-state acct-empty' },
        h('b', {}, 'Nothing here yet: no portfolio is marked as your own account.'),
        h(
          'ol',
          {},
          h('li', {}, 'Import a statement: Portfolios → ', h('b', {}, 'Import statement'), ' (CSV or Excel from your broker). It’s marked as yours automatically.'),
          h('li', {}, 'Or sync Webull: Portfolios → ', h('b', {}, 'Webull'), ' → ', h('b', {}, 'Sync to Portfolios'), ' (a live account counts as yours).'),
          h('li', {}, 'Or open any saved portfolio with share or dollar amounts and tick ', h('b', {}, 'This is my account'), '.'),
        ),
        all.length ? h('span', { class: 'muted small' }, `You have ${all.length} saved portfolio${all.length === 1 ? '' : 's'}; client portfolios stay off this page.`) : null,
        h('a', { class: 'btn primary', href: '#portfolio' }, 'Go to Portfolios'),
      ),
    );
  }

  function synced(p: Saved) {
    if (!isMine(p)) toast('A Webull Test account isn’t counted as yours. Tick "This is my account" in Portfolios to include it.');
    load();
  }

  window.addEventListener('tp:data-changed', () => started && load());

  let started = false;
  return {
    el: frame.el,
    /** Reloads every time the page is opened, so changes made in Portfolios show up. */
    start() {
      started = true;
      load();
    },
  };
}
