/**
 * Account: just the owner's own money in one place (like the Snowball app). Every portfolio marked "This is my
 * account" is added together (the same symbol merged across accounts); the dividend figures come from the helper's
 * dividends.portfolio request and are drawn by the Portfolios page's dividends view. Read-only: orders stay in the
 * Webull view's preview → confirm ticket.
 */
import { listDocs, saveDoc } from '../data/store';
import { ALL_ACCOUNTS, allocation, combineHoldings, combinedValue, dividendPayload, myPortfolios, pickAccounts, todayChange, type CombinedHolding } from '../portfolio/account';
import { drawDividends, fetchDividends, totalReturnCell, type DividendReport } from '../portfolio/dividendsView';
import { fetchPrices, priceMap, type PriceInfo } from '../portfolio/prices';
import { fetchRisk, fetchTax, type RiskInput, type RiskReport, type TaxReport, type TaxType } from '../portfolio/risk';
import { holdingGroup, riskCard, taxSection } from '../portfolio/riskView';
import { isMine, positions, type Portfolio } from '../portfolio/types';
import { renderWebullCard } from '../portfolio/webullView';
import { dataTable, money, pageFrame, pct, pctU, statCards } from '../ui/charts';
import { h, toast } from '../ui/dom';
import { termLabel } from '../ui/glossary';
import { tickerAttr } from '../ui/tickerCard';

type Saved = Portfolio & { id: string };

/** The switcher's last choice (a portfolio id or "all"): a convenience, so storage errors are ignored. */
const VIEW_KEY = 'tp-account-view';
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) ?? ALL_ACCOUNTS;
  } catch {
    return ALL_ACCOUNTS;
  }
}
function saveView(v: string) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* only a convenience */
  }
}

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
  let view = readView();
  /** The live risk card's refresh (new prices every 30 s while the page is open and visible). */
  let live: (() => Promise<void>) | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let taxOpen = false;

  async function load() {
    const run = ++loading;
    live = null;
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
    // Thumb through: every account combined, or one account's own makeup. Every figure below follows the choice.
    const picked = pickAccounts(mine, view);
    const chosen = picked.chosen;
    const single = picked.choice === ALL_ACCOUNTS ? null : chosen[0];
    const rows = combineHoldings(chosen);
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

    // Risk: the helper measures the year (once per load); live prices keep the weights and dollar figures current.
    const riskRows = (v: typeof valued): RiskInput[] =>
      v.filter((x) => x.value != null && x.value > 0).map((x) => ({ symbol: x.r.symbol, value: x.value!, kind: x.r.kind === 'cash' ? 'cash' : x.r.kind === 'alt' ? 'alt' : 'security' }));
    const riskBox = h('div', {}, h('section', { class: 'panel' }, h('div', { class: 'muted pad' }, 'Measuring risk from a year of daily prices…')));
    const taxBox = h('div', {}, h('section', { class: 'panel' }, h('div', { class: 'muted pad' }, 'Working out the tax view…')));
    const holdingsBox = h('div', {});
    let sectorOf: Record<string, RiskReport['sectors'][string]> = {};
    let filter: string | null = null;
    let card: ReturnType<typeof riskCard> | null = null;
    const drawHoldings = () => {
      const shown = filter ? valued.filter((x) => holdingGroup({ symbol: x.r.symbol, value: x.value ?? 0, kind: x.r.kind }, sectorOf) === filter) : valued;
      holdingsBox.replaceChildren(
        panel(
          'Holdings',
          filter
            ? h('span', { class: 'acct-filter' }, `${shown.length} in ${filter} `, h('button', { class: 'btn small', onclick: () => ((filter = null), card?.clearSector(), drawHoldings()) }, 'Show all'))
            : single
              ? `${rows.length} holding${rows.length === 1 ? '' : 's'} in ${single.name}`
              : `${rows.length} holding${rows.length === 1 ? '' : 's'} across ${chosen.length} account${chosen.length === 1 ? '' : 's'}`,
          holdingsTable(shown, total, report),
        ),
      );
    };
    drawHoldings();

    frame.body.replaceChildren(
      mine.length > 1 ? switcher(mine, picked.choice) : '',
      overview(report, total, today, todayBase ? (today ?? 0) / todayBase : null, rows, single),
      unpriced.length ? h('p', { class: 'badge warn' }, `No live price for ${unpriced.join(', ')}: left out of the totals. Check the helper is logged in to Schwab, then Refresh.`) : '',
      riskBox,
      holdingsBox,
      h('h2', { class: 'section-label acct-section' }, 'Dividends'),
      divBox,
      allocationPanel(valued),
      taxBox,
      panel(single ? 'Account' : 'Accounts', 'Marked "This is my account" in Portfolios', h('div', { class: 'acct-cards' }, ...chosen.map((p) => accountCard(p, prices, report))), webull),
    );

    fetchRisk(riskRows(valued)).then(
      (rr) => showRisk(rr, null),
      (err) => showRisk(null, (err as Error).message),
    );
    function showRisk(rr: RiskReport | null, error: string | null) {
      if (run !== loading) return;
      sectorOf = rr?.sectors ?? {};
      card = riskCard(rr, error, (label) => {
        filter = label;
        drawHoldings();
        if (label) holdingsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      card.update(riskRows(valued));
      riskBox.replaceChildren(card.el);
      // live: new prices move the weights, warnings and the dollar bad-day loss
      live = async () => {
        const fresh = await fetchPrices(symbols);
        if (run !== loading || !card) return;
        const now = valued.map((x) => ({ ...x, value: combinedValue(x.r, fresh[x.r.symbol]?.price ?? priceOf(x.r.symbol)) }));
        card.update(riskRows(now));
      };
    }

    // Taxes: each chosen account with its holdings' values (taxable ones get gains, harvest and wash-sale checks).
    const valueOf = (x: Saved['holdings'][number], mode: string) =>
      mode === 'shares' && x.kind !== 'cash' && x.kind !== 'alt' ? ((priceOf(x.symbol.trim().toUpperCase()) ?? NaN) * (x.shares ?? 0) || null) : (x.amount ?? 0);
    const taxAccounts = chosen.map((p) => ({
      name: p.name,
      taxType: p.taxType,
      webullAccount: p.webullAccount,
      webullClass: p.webullClass,
      holdings: p.holdings
        .filter((x) => x.symbol.trim())
        .map((x) => ({ symbol: x.kind === 'cash' ? 'CASH' : x.symbol.trim().toUpperCase(), shares: p.mode === 'shares' && x.kind !== 'cash' && x.kind !== 'alt' ? (x.shares ?? 0) : 0, value: valueOf(x, p.mode ?? 'weight'), cost: x.cost ?? null, kind: x.kind ?? 'security' })),
    }));
    // the helper decides each account's type (one rule, in tax.py); its reply comes back in the order sent
    const taxableShares = (tr: TaxReport) => {
      const out: Record<string, number> = {};
      taxAccounts.forEach((a, i) => {
        if (tr.accounts[i]?.type === 'taxable') for (const x of a.holdings) if (x.shares) out[x.symbol] = (out[x.symbol] ?? 0) + x.shares;
      });
      return out;
    };
    const accountsForTax = (tr: TaxReport | null) => chosen.map((p, i) => ({ id: p.id, name: p.name, auto: tr?.accounts[i]?.auto, chosen: p.taxType }));
    const setType = async (id: string, type: TaxType | undefined) => {
      const p = all.find((x) => x.id === id);
      if (!p) return;
      try {
        await saveDoc('portfolios', { ...p, taxType: type });
        toast('Saved. The Taxes section now treats it that way.');
        load();
      } catch (err) {
        toast((err as Error).message);
      }
    };
    // the fold stays as the owner left it across reloads (switching accounts, changing an account's tax type)
    const showTax = (el: HTMLDetailsElement) => {
      el.open = taxOpen;
      el.addEventListener('toggle', () => (taxOpen = el.open));
      taxBox.replaceChildren(el);
    };
    fetchTax(taxAccounts).then(
      (tr) => run === loading && showTax(taxSection(tr, null, accountsForTax(tr), setType, report, taxableShares(tr))),
      (err) => run === loading && showTax(taxSection(null, (err as Error).message, accountsForTax(null), setType, report, {})),
    );
    // the Webull balances card follows the choice too: all Webull accounts, the chosen one, or none
    if (!single) renderWebullCard(webull, synced, () => openPortfolio('webull'));
    else if (single.webullAccount) renderWebullCard(webull, synced, () => openPortfolio('webull'), single.webullAccount);
  }

  /** "All accounts (combined)" plus one button per account; the choice is remembered on this device. */
  function switcher(mine: Saved[], current: string) {
    const options = [{ id: ALL_ACCOUNTS, label: 'All accounts (combined)' }, ...mine.map((p) => ({ id: p.id, label: p.name }))];
    return h(
      'div',
      { class: 'segmented acct-switch', role: 'group', 'aria-label': 'Show account' },
      ...options.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: o.id === current ? 'active' : '',
            'aria-pressed': o.id === current,
            onclick: () => {
              if (o.id === view) return;
              view = o.id;
              saveView(view);
              load();
            },
          },
          o.label,
        ),
      ),
    );
  }

  /** Snowball-style headline numbers. Gain, income and yields come from the helper's dividends report (share holdings). */
  function overview(r: DividendReport | null, total: number, today: number | null, todayPct: number | null, rows: CombinedHolding[], single: Saved | null) {
    const cash = rows.filter((x) => x.kind !== 'security' || !x.shares).reduce((s, x) => s + x.amount, 0);
    return h(
      'div',
      { class: 'acct-stats' },
      statCards([
        { label: 'Total value', value: usd(total), hint: cash ? `Includes ${usd(cash)} cash and other amounts` : single ? `Only ${single.name}` : 'All your accounts added together' },
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
          { v: h('span', { title: r.name }, h('b', r.kind === 'security' ? tickerAttr(r.symbol) : {}, r.symbol), r.kind !== 'security' ? h('span', { class: `holding-tag ${r.kind}` }, r.kind === 'cash' ? 'Cash' : 'Alt') : ''), cls: 'label' },
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
      h('p', { class: 'ap-note' }, 'Sectors are in the Risk card at the top. Asset classes come from your portfolios (imports start as US stocks; change one in Portfolios).'),
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
      clearInterval(timer);
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') live?.().catch(() => undefined); // a missed tick just waits for the next
      }, 30000);
    },
    stop() {
      started = false;
      clearInterval(timer);
    },
  };
}
