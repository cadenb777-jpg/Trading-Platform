/**
 * Account: just the owner's own money in one place (like the Snowball app). Every portfolio marked "This is my
 * account" is added together (the same symbol merged across accounts), or one account on its own (the switcher).
 * Per holding and account: day change, cost basis, price gain, dividends received (with how each figure was found),
 * total return, yield and income; a holding opens a detail window (accounts, dividends counted, the owner's purchase
 * date / dividends / return-of-capital entries, and "Is the yield sustainable?"). Display choices ($ / % / both) are
 * remembered on this device. Real money only: this is the one home for totals across accounts. Read-only: orders
 * are placed on the Trade page (one account at a time, preview → confirm). Import statement and Sync live here; model
 * portfolios and what-ifs are on Portfolios ("Analyse in Portfolios" opens an account there).
 */
import { listDocs, saveDoc } from '../data/store';
import { clearEngineCache, loadNews, type NewsItem } from '../data/schwab';
import { ALL_ACCOUNTS, allocation, combineHoldings, holdingNewsSymbols, dividendPayload, myPortfolios, partKey, pickAccounts, receivedPayload, todayChange, type AccountPart, type CombinedHolding } from '../portfolio/account';
import { drawDividends, fetchDividends, openStatementImport, type DividendHolding, type DividendReport } from '../portfolio/dividendsView';
import { fetchPrices, type PriceInfo } from '../portfolio/prices';
import { dayTotal, gainOf, methodLabel, methodOf, readPrefs, savePrefs, showChange, sumGains, type DisplayPrefs, type Gain, type Received, type ShowAs } from '../portfolio/returns';
import { fetchRisk, fetchTax, type RiskInput, type RiskReport, type TaxReport, type TaxType } from '../portfolio/risk';
import { holdingGroup, riskCard, taxSection } from '../portfolio/riskView';
import { isMine, type Holding, type Portfolio } from '../portfolio/types';
import { renderWebullCard, syncButton } from '../portfolio/webullView';
import { notice19aLink, periods, rocText, splitPeriod, yieldCheck, type YieldCheck } from '../portfolio/yieldQuality';
import { loadSnapshot } from '../trade/webull';
import { pct, pctU, statCards, pageFrame, dataTable } from '../ui/charts';
import { h, openModal, openPopover, timeAgo, toast } from '../ui/dom';
import { infoTip, termLabel } from '../ui/glossary';
import { openNewsSummary } from '../ui/newsSummary';
import { tableTools } from '../ui/tableTools';
import { tickerAttr } from '../ui/tickerCard';

type Saved = Portfolio & { id: string };

/** Per-device conveniences (the switcher's last choice, the shown columns): storage errors are ignored. */
const VIEW_KEY = 'tp-account-view';
const COLUMNS_KEY = 'tp-account-columns';
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function saveKey(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* only a convenience */
  }
}
const storage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
const tone = (v: number | null | undefined): 'up' | 'down' | '' => (v == null ? '' : v >= 0 ? 'up' : 'down');
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—');
const panel = (title: string | Node, note: string | Node, ...body: (Node | string | null)[]) =>
  h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), h('span', { class: 'muted small' }, note)), ...body);

/** One account's part of a holding, valued. */
interface PartView {
  part: AccountPart;
  value: number | null;
  today: number | null;
  gain: Gain;
  rec: Received | null;
}
/** One (combined) holding, valued. */
interface RowView {
  r: CombinedHolding;
  price: number | null;
  value: number | null;
  today: number | null;
  dayPct: number | null;
  info: DividendHolding | null;
  gain: Gain;
  method: ReturnType<typeof methodOf>;
  parts: PartView[];
  check: YieldCheck | null;
}

/** The holdings table's columns: key, header, shown by default. Symbol is always shown. */
const COLUMNS: { key: string; label: string; on: boolean }[] = [
  { key: 'shares', label: 'Shares', on: false },
  { key: 'avg', label: 'Avg cost', on: false },
  { key: 'price', label: 'Price', on: true },
  { key: 'value', label: 'Value', on: true },
  { key: 'weight', label: 'Weight', on: true },
  { key: 'today', label: 'Today', on: true },
  { key: 'cost', label: 'Cost basis', on: false },
  { key: 'gain', label: 'Price gain', on: true },
  { key: 'divs', label: 'Dividends', on: true },
  { key: 'total', label: 'Total return', on: true },
  { key: 'yield', label: 'Yield', on: true },
  { key: 'yoc', label: 'Yield on cost', on: false },
  { key: 'income', label: 'Income (12 mo)', on: false },
  { key: 'tr1y', label: '1Y total return', on: false },
  { key: 'accounts', label: 'Accounts', on: true },
];
function readColumns(): Set<string> {
  try {
    const saved = JSON.parse(readKey(COLUMNS_KEY) ?? 'null');
    if (Array.isArray(saved)) return new Set(saved.filter((k) => COLUMNS.some((c) => c.key === k)));
  } catch {
    /* defaults */
  }
  return new Set(COLUMNS.filter((c) => c.on).map((c) => c.key));
}

const METHOD_SHORT: Record<string, string> = { entered: 'entered', statement: 'statement', purchase: 'est.', tracked: 'est.', mixed: 'mixed', none: '' };

export function createAccountPage(openPortfolio: (id: string) => void, openTrade: (accountId: string, kind?: 'stocks' | 'futures') => void) {
  let prefs: DisplayPrefs = readPrefs(storage());
  let columns = readColumns();
  /** Redraws the parts that follow the display choices (set by each load). */
  let paint: () => void = () => {};
  // One-click switch for how changes and gains read everywhere on the page (remembered on this device).
  const showOpts: [ShowAs, string, string][] = [['pct', '%', 'Show changes and gains in percent'], ['usd', '$', 'Show changes and gains in dollars'], ['both', 'Both', 'Show dollars and percent']];
  const showSwitch = h('div', { class: 'segmented acct-show', role: 'group', 'aria-label': 'Show changes as' });
  const drawSwitch = () => {
    const current = prefs.day === prefs.gain ? prefs.day : null;
    showSwitch.replaceChildren(
      ...showOpts.map(([v, t, title]) =>
        h('button', { type: 'button', class: current === v ? 'active' : '', 'aria-pressed': current === v, title, onclick: () => {
          prefs = { day: v, gain: v };
          savePrefs(storage(), prefs);
          drawSwitch();
          paint();
        } }, t),
      ),
    );
  };
  drawSwitch();
  const frame = pageFrame('Account', 'Your real money only: every account of yours, added together (or one at a time), with gains, dividends, risk and allocation.', [
    showSwitch,
    h('button', { class: 'btn', title: 'Upload a positions export (CSV or Excel) from your broker; it becomes one of your accounts here', onclick: () => openStatementImport(imported) }, 'Import statement'),
    syncButton('Sync Webull', () => '', synced, syncNote),
    h('button', { class: 'btn', onclick: () => (clearEngineCache('dividends.'), load()) }, 'Refresh'),
  ]);
  let loading = 0;
  let view = readKey(VIEW_KEY) ?? ALL_ACCOUNTS;
  /** The live risk card's refresh (new prices every 30 s while the page is open and visible). */
  let live: (() => Promise<void>) | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let taxOpen = false;

  const fmtDay = (u: number | null | undefined, p: number | null | undefined) => showChange(u, p, prefs.day);
  const fmtGain = (u: number | null | undefined, p: number | null | undefined) => showChange(u, p, prefs.gain, 1);


  async function load() {
    const run = ++loading;
    live = null;
    paint = () => {};
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
      renderWebullCard(webull, synced, openTrade);
      return;
    }
    // Thumb through: every account combined, or one account's own makeup. Every figure below follows the choice.
    const picked = pickAccounts(mine, view);
    const chosen = picked.chosen;
    const single = picked.choice === ALL_ACCOUNTS ? null : chosen[0];
    const rows = combineHoldings(chosen);
    const symbols = rows.filter((r) => r.shares > 0).map((r) => r.symbol);
    const payload = dividendPayload(rows);
    const [pr, dv] = await Promise.allSettled([
      symbols.length ? fetchPrices(symbols) : Promise.resolve({}),
      payload.length ? fetchDividends(payload, receivedPayload(rows)) : Promise.reject(new Error('No share holdings, so there are no dividends to show.')),
    ]);
    if (run !== loading) return;
    const prices: Record<string, PriceInfo> = pr.status === 'fulfilled' ? pr.value : {};
    const report = dv.status === 'fulfilled' ? dv.value : null;
    const infoOf = (s: string) => report?.holdings.find((x) => x.symbol === s) ?? null;
    // Prices: the live quote, or the price the dividends request just read.
    const priceOf = (s: string) => prices[s]?.price ?? infoOf(s)?.price ?? null;
    const valued: RowView[] = rows.map((r) => {
      const price = r.shares ? priceOf(r.symbol) : null;
      const change = r.shares ? prices[r.symbol]?.change : null;
      const parts = r.parts.map((part): PartView => {
        const value = part.shares ? (price != null ? part.shares * price + part.amount : null) : part.amount;
        const rec = report?.received?.[partKey(part, r.symbol)] ?? null;
        return { part, value, today: part.shares ? todayChange(value, change) : null, gain: gainOf(r.kind === 'security' ? value : null, part.cost, rec?.amount), rec };
      });
      const value = r.shares ? (price != null ? r.shares * price + r.amount : null) : r.amount;
      const today = r.shares ? todayChange(value, change) : null;
      const gain = r.kind === 'security' ? sumGains(parts.map((x) => x.gain)) : gainOf(null, null, null);
      const info = r.kind === 'security' ? infoOf(r.symbol) : null;
      return {
        r,
        price,
        value,
        today,
        dayPct: change ?? null,
        info,
        gain,
        method: methodOf(parts.map((x) => x.rec?.method ?? 'none')),
        parts,
        check: info ? yieldCheck(info.yield, info) : null,
      };
    });
    const total = valued.reduce((s, x) => s + (x.value ?? 0), 0);
    const unpriced = valued.filter((x) => x.value == null).map((x) => x.r.symbol);
    const receivedKnown = !!report?.received;

    const divBox = h('div', { class: 'ap-body' });
    if (report) drawDividends(divBox, report, { hasCash: rows.some((r) => r.kind === 'cash'), stats: false, holdings: false });
    else divBox.replaceChildren(h('div', { class: 'ap-error' }, (dv as PromiseRejectedResult).reason?.message ?? 'Dividend data unavailable.'));

    // Risk: the helper measures the year (once per load); live prices keep the weights and dollar figures current.
    const riskRows = (v: { r: CombinedHolding; value: number | null }[]): RiskInput[] =>
      v.filter((x) => x.value != null && x.value > 0).map((x) => ({ symbol: x.r.symbol, value: x.value!, kind: x.r.kind === 'cash' ? 'cash' : x.r.kind === 'alt' ? 'alt' : 'security' }));
    const riskBox = h('div', {}, h('section', { class: 'panel' }, h('div', { class: 'muted pad' }, 'Measuring risk from a year of daily prices…')));
    const taxBox = h('div', {}, h('section', { class: 'panel' }, h('div', { class: 'muted pad' }, 'Working out the tax view…')));
    const overviewBox = h('div', {});
    const holdingsBox = h('div', {});
    const accountsBox = h('div', { class: 'acct-cards' });
    const newsBox = h('div', {});
    showHoldingsNews(newsBox, holdingNewsSymbols(chosen), run);
    let sectorOf: Record<string, RiskReport['sectors'][string]> = {};
    let filter: string | null = null;
    let card: ReturnType<typeof riskCard> | null = null;
    let types: (TaxType | undefined)[] = [];
    /** Webull buying power per account, read once per load (the cards are redrawn when display choices change). */
    const buyingPower = new Map<string, Promise<number | null>>();
    const buyingPowerOf = (id: string) => {
      if (!buyingPower.has(id)) buyingPower.set(id, loadSnapshot(id).then((s) => s.balances?.buyingPower ?? null, () => null));
      return buyingPower.get(id)!;
    };
    const drawHoldings = () => {
      const shown = filter ? valued.filter((x) => holdingGroup({ symbol: x.r.symbol, value: x.value ?? 0, kind: x.r.kind }, sectorOf) === filter) : valued;
      const colsBtn = h('button', { class: 'btn small', 'aria-haspopup': 'dialog' }, 'Columns') as HTMLButtonElement;
      colsBtn.addEventListener('click', () => openColumns(colsBtn, drawHoldings));
      holdingsBox.replaceChildren(
        panel(
          'Holdings',
          h(
            'span',
            { class: 'acct-filter' },
            filter
              ? h('span', {}, `${shown.length} in ${filter} `, h('button', { class: 'btn small', onclick: () => ((filter = null), card?.clearSector(), drawHoldings()) }, 'Show all'))
              : single
                ? `${rows.length} holding${rows.length === 1 ? '' : 's'} in ${single.name} · tap one for details `
                : `${rows.length} holding${rows.length === 1 ? '' : 's'} across ${chosen.length} account${chosen.length === 1 ? '' : 's'} · tap one for details `,
            colsBtn,
          ),
          holdingsTable(shown, total, !single),
          h(
            'p',
            { class: 'ap-note' },
            'Price gain = value − cost basis (not sold, so not taxed yet). Dividends = what the holding paid you: ',
            h('b', {}, 'entered'),
            ' or ',
            h('b', {}, 'statement'),
            ' figures are real records; ',
            h('b', {}, 'est.'),
            ' figures are Yahoo dividends × your shares since your purchase date or since the platform first saw the position (Webull gives average cost only: no purchase dates, lots or dividend history). Total return = price gain + dividends, on holdings with a cost basis.',
            receivedKnown ? '' : ' Update the helper to see dividends received.',
          ),
        ),
      );
    };
    const drawOverview = () => overviewBox.replaceChildren(overview(report, total, valued, single));
    const drawAccounts = () => accountsBox.replaceChildren(...chosen.map((p, i) => accountCard(p, valued, types[i], !single)));
    paint = () => {
      if (run !== loading) return;
      drawOverview();
      drawHoldings();
      drawAccounts();
    };
    paint();

    frame.body.replaceChildren(
      mine.length > 1 ? switcher(mine, picked.choice) : '',
      overviewBox,
      unpriced.length ? h('p', { class: 'badge warn' }, `No live price for ${unpriced.join(', ')}: left out of the totals. Check the helper is logged in to Schwab, then Refresh.`) : '',
      panel(single ? 'Account' : 'Accounts', 'Imported statements, synced Webull accounts and portfolios marked as yours', accountsBox, webull),
      holdingsBox,
      riskBox,
      newsBox,
      h('h2', { class: 'section-label acct-section' }, 'Dividends'),
      divBox,
      allocationPanel(valued),
      taxBox,
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
        const now = valued.map((x) => ({ r: x.r, value: x.r.shares ? (fresh[x.r.symbol]?.price ?? x.price) != null ? x.r.shares * (fresh[x.r.symbol]?.price ?? x.price)! + x.r.amount : null : x.r.amount }));
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
      (tr) => {
        if (run !== loading) return;
        types = tr.accounts.map((a) => a.type);
        drawAccounts();
        showTax(taxSection(tr, null, accountsForTax(tr), setType, report, taxableShares(tr)));
      },
      (err) => run === loading && showTax(taxSection(null, (err as Error).message, accountsForTax(null), setType, report, {})),
    );
    // Webull accounts that aren't one of the cards above (futures, not synced yet): combined view only
    if (!single) renderWebullCard(webull, synced, openTrade, undefined, chosen.map((p) => p.webullAccount ?? '').filter(Boolean));

    // ---------- pieces that use this load's data ----------

    function openColumns(anchor: HTMLElement, redraw: () => void) {
      const list = h(
        'div',
        { class: 'acct-cols' },
        ...COLUMNS.map((c) => {
          const box = h('input', { type: 'checkbox', checked: columns.has(c.key) }) as HTMLInputElement;
          box.addEventListener('change', () => {
            if (box.checked) columns.add(c.key);
            else columns.delete(c.key);
            saveKey(COLUMNS_KEY, JSON.stringify([...columns]));
            redraw();
          });
          return h('label', { class: 'acct-col' }, box, ' ', c.label);
        }),
        h(
          'button',
          {
            type: 'button',
            class: 'link-btn small',
            onclick: () => {
              columns = new Set(COLUMNS.filter((c) => c.on).map((c) => c.key));
              saveKey(COLUMNS_KEY, JSON.stringify([...columns]));
              redraw();
            },
          },
          'Default columns',
        ),
      );
      openPopover(anchor, list, { align: 'right', label: 'Columns to show' });
    }

    function holdingsTable(list: RowView[], sum: number, combined: boolean) {
      const shown = COLUMNS.filter((c) => columns.has(c.key) && (c.key !== 'accounts' || combined));
      const sorted = [...list].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const td = (text: Node | string, cls = 'num', value?: number | null) => h('td', { class: cls, ...(value != null && Number.isFinite(value) ? { 'data-value': value } : {}) }, text);
      const divCell = (x: RowView) => {
        if (x.r.kind !== 'security') return td('—');
        const label = METHOD_SHORT[x.method];
        const title = x.parts.map((p) => `${p.part.account}: ${usd(p.rec?.amount)} (${methodLabel(p.rec)})`).join('\n');
        return h('td', { class: 'num', title, ...(x.gain.dividends != null ? { 'data-value': x.gain.dividends } : {}) }, usd(x.gain.dividends), label ? h('span', { class: `acct-method ${x.method}` }, ` ${label}`) : '');
      };
      const yieldCell = (x: RowView) => {
        const y = x.info?.yield;
        if (x.r.kind !== 'security') return td('—');
        const flag = x.check?.erosion ? h('span', { class: `badge ${x.check.tone === 'bad' ? 'down' : 'warn'} acct-flag`, title: x.check.read }, 'check') : x.check && x.check.tone === 'ok' ? h('span', { class: 'badge up acct-flag', title: x.check.read }, 'covered') : '';
        return h('td', { class: 'num', ...(y != null ? { 'data-value': y } : {}) }, pctU(y), ' ', flag);
      };
      const cell = (x: RowView, key: string): HTMLElement => {
        const r = x.r;
        switch (key) {
          case 'shares': return td(r.shares ? String(+r.shares.toFixed(4)) : '—', 'num', r.shares || null);
          case 'avg': return td(r.shares && r.cost != null ? usd(r.cost / r.shares) : '—', 'num', r.shares && r.cost != null ? r.cost / r.shares : null);
          case 'price': return td(usd(x.price), 'num', x.price);
          case 'value': return td(usd(x.value), 'num', x.value);
          case 'weight': return td(x.value != null && sum ? pctU(x.value / sum, 1) : '—', 'num', x.value != null && sum ? x.value / sum : null);
          case 'today': return td(fmtDay(x.today, x.dayPct), `num ${tone(x.today)}`, prefs.day === 'pct' ? x.dayPct : x.today);
          case 'cost': return td(usd(x.gain.cost ?? r.cost), 'num', x.gain.cost ?? r.cost);
          case 'gain': return td(fmtGain(x.gain.priceGain, x.gain.priceGainPct), `num ${tone(x.gain.priceGain)}`, prefs.gain === 'pct' ? x.gain.priceGainPct : x.gain.priceGain);
          case 'divs': return divCell(x);
          case 'total': return td(fmtGain(x.gain.total, x.gain.totalPct), `num ${tone(x.gain.total)}`, prefs.gain === 'pct' ? x.gain.totalPct : x.gain.total);
          case 'yield': return yieldCell(x);
          case 'yoc': return td(pctU(x.info?.yieldOnCost), 'num', x.info?.yieldOnCost);
          case 'income': return td(usd(x.info?.annualIncome), 'num', x.info?.annualIncome);
          case 'tr1y': return td(pct(x.info?.tr1y, 1), `num ${tone(x.info?.tr1y)}`, x.info?.tr1y);
          // short and allowed to wrap, so the last column isn't cut off on a laptop screen (full names on hover)
          case 'accounts': return h('td', { class: 'muted small acct-accounts-cell', title: r.parts.map((x) => x.account).join('\n') }, r.parts.length === 1 ? r.parts[0].account.replace(/^Webull /, '').replace(/ \((Test|Live)\)$/, '') : `${r.parts.length} accounts`);
          default: return td('');
        }
      };
      const symbolCell = (x: RowView) =>
        h(
          'td',
          { class: 'label' },
          x.r.kind === 'security'
            ? h('button', { type: 'button', class: 'link-btn acct-sym', ...tickerAttr(x.r.symbol), title: `${x.r.name || x.r.symbol}: open details`, onclick: () => openHolding(x) }, x.r.symbol)
            : h('span', { title: x.r.name }, h('b', {}, x.r.symbol), h('span', { class: `holding-tag ${x.r.kind}` }, x.r.kind === 'cash' ? 'Cash' : 'Alt')),
        );
      // totals: today over priced holdings, gains over holdings with a cost basis (as in the headline cards)
      const all = sumGains(list.filter((x) => x.r.kind === 'security').map((x) => x.gain));
      const d = dayTotal(list);
      const income = list.reduce((s, x) => s + (x.info?.annualIncome ?? 0), 0);
      const totalCell = (key: string): HTMLElement => {
        switch (key) {
          case 'value': return td(usd(sum));
          case 'weight': return td(sum ? '100%' : '—');
          case 'today': return td(fmtDay(d.usd, d.pct), `num ${tone(d.usd)}`);
          case 'cost': return td(usd(all.cost));
          case 'gain': return td(fmtGain(all.priceGain, all.priceGainPct), `num ${tone(all.priceGain)}`);
          case 'divs': return td(usd(all.dividends));
          case 'total': return td(fmtGain(all.total, all.totalPct), `num ${tone(all.total)}`);
          case 'income': return td(usd(income));
          default: return td('');
        }
      };
      const table = h(
        'table',
        { class: 'data-table acct-holdings' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Symbol'), ...shown.map((c) => h('th', {}, c.key === 'total' ? termLabel(c.label, 'totalreturn') : c.key === 'yield' ? termLabel(c.label, 'divyield') : c.label)))),
        h(
          'tbody',
          {},
          ...sorted.map((x) => h('tr', {}, symbolCell(x), ...shown.map((c) => cell(x, c.key)))),
          list.length > 1 ? h('tr', { class: 'total' }, h('td', { class: 'label' }, h('b', {}, 'Total')), ...shown.map((c) => totalCell(c.key))) : '',
        ),
      );
      tableTools(table, { id: 'account:holdings2', columns: { Accounts: 'pick' } });
      return h('div', { class: 'table-wrap' }, table);
    }

    /** Snowball-style headline numbers, following the display choices. */
    function overview(r: DividendReport | null, sum: number, list: RowView[], one: Saved | null) {
      const cash = list.filter((x) => x.r.kind !== 'security' || !x.r.shares).reduce((s, x) => s + (x.value ?? 0), 0);
      const g = sumGains(list.filter((x) => x.r.kind === 'security').map((x) => x.gain));
      const d = dayTotal(list);
      const methods = list.flatMap((x) => x.parts.map((p) => p.rec?.method ?? 'none')).filter((m) => m !== 'none');
      const est = methods.filter((m) => m === 'tracked' || m === 'purchase').length;
      const firstSeen = list.flatMap((x) => x.parts.map((p) => (p.rec?.method === 'tracked' ? p.rec.since : null))).filter((s): s is string => !!s).sort()[0];
      const securities = list.filter((x) => x.r.kind === 'security').length;
      const withCost = list.filter((x) => x.r.kind === 'security' && x.gain.priceGain != null).length;
      const divHint = !receivedKnown
        ? 'Update the helper to see dividends received'
        : !methods.length
          ? 'Not known yet: set a purchase date or the dividends received on a holding'
          : est === methods.length
            ? `Estimated: Yahoo dividends × your shares${firstSeen ? ` since ${day(firstSeen)} (first seen)` : ''}${methods.some((m) => m === 'purchase') ? ' or your purchase dates' : ''}`
            : `${methods.length - est} from your records, ${est} estimated`;
      return h(
        'div',
        { class: 'acct-stats' },
        statCards([
          { label: one ? `${one.name} value` : 'Total value (all accounts)', value: usd(sum), hint: `${one ? `Only ${one.name}` : 'All your accounts added together'}${cash ? `; includes ${usd(cash)} cash and other amounts` : ''}` },
          { label: one ? 'Today' : 'Today (all accounts)', value: fmtDay(d.usd, d.pct), tone: tone(d.usd), hint: 'Change since yesterday’s close on your shares' },
          { label: 'Price gain', value: fmtGain(g.priceGain, g.priceGainPct), tone: tone(g.priceGain), hint: `Value − cost basis ${usd(g.cost)} (unrealized)${withCost < securities ? `, on ${withCost} of ${securities} holdings with a cost basis` : ''}` },
          { label: 'Dividends received', value: usd(g.dividends), hint: divHint },
          {
            label: termLabel('Total return', 'totalreturn'),
            value: fmtGain(g.total, g.totalPct),
            tone: tone(g.total),
            hint: `Price gain + dividends received, on holdings with a cost basis${r?.totalReturn?.tr1y != null ? ` · today’s holdings over the last year: ${pct(r.totalReturn.tr1y, 1)} (price only ${pct(r.totalReturn.price1y, 1)})` : ''}`,
          },
          { label: 'Yearly dividend income', value: usd(r?.annualIncome), hint: r ? `About ${usd(r.monthly)} a month over the next 12 months` : '' },
          { label: h('span', {}, termLabel('Yield', 'divyield'), ' · ', termLabel('on cost', 'yoc')), value: `${pctU(r?.yield)} · ${pctU(r?.yieldOnCost)}`, hint: 'Yearly income ÷ market value · on cost: income ÷ what you paid, only holdings with a cost basis' },
        ]),
      );
    }

    function accountCard(p: Saved, list: RowView[], type: TaxType | undefined, combined: boolean) {
      const mineParts = list.flatMap((x) => x.parts.filter((pp) => pp.part.portfolioId === p.id).map((pp) => ({ x, pp })));
      const value = mineParts.reduce((s, { pp }) => s + (pp.value ?? 0), 0);
      const d = dayTotal(mineParts.map(({ pp }) => pp));
      const g = sumGains(mineParts.filter(({ x }) => x.r.kind === 'security').map(({ pp }) => pp.gain));
      const cash = mineParts.filter(({ x }) => x.r.kind === 'cash').reduce((s, { pp }) => s + (pp.value ?? 0), 0);
      const n = p.holdings.filter((x) => x.symbol.trim()).length;
      const typeName = type === 'roth' ? 'Roth' : type === 'deferred' ? 'Traditional' : type === 'taxable' ? 'Taxable' : null;
      const bp = h('span', { class: 'num' }, p.webullAccount ? '…' : '—');
      if (p.webullAccount) buyingPowerOf(p.webullAccount).then((v) => (bp.textContent = usd(v)));
      const line = (label: string | Node, v: Node | string, cls = '') => h('div', { class: 'acct-line' }, h('span', { class: 'muted small' }, label), h('span', { class: `num ${cls}` }, v));
      const syncedAt = p.syncedAt ? Date.parse(p.syncedAt) / 1000 : 0;
      return h(
        'div',
        { class: 'acct-card' },
        h(
          'div',
          { class: 'acct-card-head' },
          h('b', {}, p.name),
          typeName ? h('span', { class: `badge ${type === 'taxable' ? '' : 'accent'}`, title: 'How this account is taxed (change it in the Taxes section)' }, typeName) : null,
          p.webullAccount ? h('span', { class: 'badge' }, 'Webull') : null,
        ),
        h('div', { class: 'acct-card-value' }, usd(value)),
        h(
          'div',
          { class: 'acct-lines' },
          line('Today', fmtDay(d.usd, d.pct), tone(d.usd)),
          line('Price gain', fmtGain(g.priceGain, g.priceGainPct), tone(g.priceGain)),
          line('Dividends received', usd(g.dividends)),
          line(termLabel('Total return', 'totalreturn'), fmtGain(g.total, g.totalPct), tone(g.total)),
          line('Cash', usd(cash)),
          p.webullAccount ? line('Buying power', bp) : null,
        ),
        h('div', { class: 'muted small' }, `${n} holding${n === 1 ? '' : 's'}${syncedAt ? ` · synced ${timeAgo(syncedAt)}` : ''}`),
        h(
          'div',
          { class: 'ap-controls' },
          combined ? h('button', { class: 'btn small', onclick: () => choose(p.id) }, 'View alone') : null,
          p.webullAccount ? syncButton('Sync', () => p.webullAccount!, synced, syncNote) : null,
          p.webullAccount ? h('button', { class: 'btn small', title: 'Positions, open orders and the order ticket for this account', onclick: () => openTrade(p.webullAccount!) }, 'Order in Trade') : null,
          h('button', { class: 'btn small', title: 'Backtest, stress-test and optimise this account’s mix, or edit its holdings', onclick: () => openPortfolio(p.id) }, 'Analyse in Portfolios'),
        ),
      );
    }

    /** The holding's detail: figures, its accounts with the owner's entries, dividends counted, the yield check. */
    function openHolding(x: RowView) {
      const r = x.r;
      const info = x.info;
      const check = info?.yield ? yieldCheck(info.yield, info, true) : null;
      const highYield = !!x.check;
      let close = () => {};
      const cleanups: (() => void)[] = [];
      const stats = statCards([
        { label: 'Value', value: usd(x.value), hint: `${+r.shares.toFixed(4)} shares at ${usd(x.price)}` },
        { label: 'Today', value: fmtDay(x.today, x.dayPct), tone: tone(x.today) },
        { label: 'Avg cost', value: r.shares && r.cost != null ? usd(r.cost / r.shares) : '—', hint: `Cost basis ${usd(r.cost)}` },
        { label: 'Price gain', value: fmtGain(x.gain.priceGain, x.gain.priceGainPct), tone: tone(x.gain.priceGain) },
        { label: 'Dividends received', value: usd(x.gain.dividends), hint: x.parts.length === 1 ? methodLabel(x.parts[0].rec) : `${x.parts.length} accounts` },
        { label: termLabel('Total return', 'totalreturn'), value: fmtGain(x.gain.total, x.gain.totalPct), tone: tone(x.gain.total) },
        { label: h('span', {}, termLabel('Yield', 'divyield'), ' · ', termLabel('on cost', 'yoc')), value: `${pctU(info?.yield)} · ${pctU(info?.yieldOnCost)}` },
        { label: 'Income next 12 months', value: usd(info?.annualIncome), hint: info?.nextExDate ? `Next ex-date about ${day(info.nextExDate)} · ${info.frequencyLabel}` : info?.frequencyLabel ?? '' },
      ]);
      const partsTable = dataTable(
        ['Account', 'Shares', 'Avg cost', 'Value', 'Price gain', 'Dividends', 'How', 'First seen'],
        x.parts.map((p) => [
          p.part.account,
          { v: String(+p.part.shares.toFixed(4)), cls: 'num' },
          { v: p.part.cost != null && p.part.shares ? usd(p.part.cost / p.part.shares) : '—', cls: 'num' },
          { v: usd(p.value), cls: 'num' },
          { v: fmtGain(p.gain.priceGain, p.gain.priceGainPct), cls: `num ${tone(p.gain.priceGain)}` },
          { v: usd(p.rec?.amount), cls: 'num' },
          h('span', { class: 'small' }, methodLabel(p.rec)),
          day(p.rec?.firstSeen ?? p.part.holdings.find((hh) => hh.seen?.length)?.seen?.[0]?.date),
        ]),
        undefined,
        false,
      );
      const payments = x.parts.flatMap((p) => (p.rec?.payments ?? []).map((pay) => ({ ...pay, account: p.part.account }))).sort((a, b) => b.exDate.localeCompare(a.exDate));
      const history = payments.length
        ? dataTable(
            ['Ex-date', ...(x.parts.length > 1 ? ['Account'] : []), 'Per share', 'Shares', 'Amount'],
            payments.slice(0, 40).map((p) => [day(p.exDate), ...(x.parts.length > 1 ? [p.account] : []), { v: `$${p.perShare.toFixed(4)}`, cls: 'num' }, { v: String(+p.shares.toFixed(4)), cls: 'num' }, { v: usd(p.amount), cls: 'num' }]),
            undefined,
            false,
          )
        : h('p', { class: 'muted small' }, receivedKnown ? 'No dividends counted yet for this holding.' : 'Update the helper to see the dividends counted.');
      const body = h(
        'div',
        { class: 'acct-detail' },
        h('p', { class: 'muted small' }, r.name || '', ' ', h('span', { ...tickerAttr(r.symbol), class: 'link-btn', 'data-ticker-click': 'pin' }, 'Quote card ›')),
        stats,
        check ? yieldPanel(r.symbol, check, info!, x, highYield, cleanups) : null,
        h('h4', {}, 'By account'),
        partsTable,
        h('p', { class: 'muted small' }, 'Lots (each purchase’s date and price) aren’t known: Webull and most exports give the average cost only.'),
        h('h4', {}, 'Your records'),
        ...x.parts.map((p) => entryForm(p, r.symbol, highYield || p.part.holdings.some((hh) => hh.rocPct != null), () => close())),
        h('h4', {}, 'Dividends counted'),
        history,
      );
      close = openModal(`${r.symbol}${r.name ? ` · ${r.name}` : ''}`, body, { wide: true, onClose: () => cleanups.forEach((f) => f()) });
    }

    /** "Is the yield sustainable?": distribution yield against total and price return, the plain read, ROC if entered. */
    function yieldPanel(symbol: string, check: YieldCheck, info: DividendHolding, x: RowView, open: boolean, cleanups: (() => void)[]) {
      const list = periods(info);
      const roc = x.parts.map((p) => p.part.holdings.find((hh) => hh.rocPct != null)).find(Boolean);
      // the charts load when the panel is first opened (one helper request for five years of prices and payouts)
      const charts = h('div', {});
      let loaded = false;
      const loadCharts = () => {
        if (loaded) return;
        loaded = true;
        void import('../portfolio/payoutCharts').then(({ payoutCharts }) => {
          const c = payoutCharts(symbol, roc?.rocPct != null ? { pct: Math.max(0, Math.min(1, roc.rocPct)), year: roc.rocYear } : null);
          cleanups.push(c.destroy);
          charts.replaceChildren(c.el);
        });
      };
      if (open) queueMicrotask(loadCharts);
      const el = h(
        'details',
        { class: 'panel acct-yield', open },
        h('summary', {}, h('b', {}, 'Is the yield sustainable?'), ' ', check.tone ? h('span', { class: `badge ${check.tone === 'ok' ? 'up' : check.tone === 'bad' ? 'down' : 'warn'}` }, check.tone === 'ok' ? 'Covered' : 'Paid partly from the price') : ''),
        h('p', {}, check.read),
        list.length
          ? dataTable(
              ['Period', 'Price return', 'Total return', 'Paid out', 'From price fall'],
              list.map((p) => {
                const sp = splitPeriod(p);
                const unit = p.yearly ? '/yr' : '';
                return [
                  p.label,
                  { v: `${pct(p.price, 1)}${unit}`, cls: `num ${tone(p.price)}` },
                  { v: `${pct(p.total, 1)}${unit}`, cls: `num ${tone(p.total)}` },
                  { v: `${pctU(sp.paid, 1)}${unit}`, cls: 'num' },
                  { v: sp.share == null ? '—' : `${pctU(sp.fromPrice, 1)}${unit} (${pctU(sp.share, 0)})`, cls: 'num' },
                ];
              }),
              undefined,
              false,
            )
          : '',
        h(
          'p',
          { class: 'ap-note' },
          'Today’s ', termLabel('distribution yield', 'distributionyield'), `: ${pctU(check.distYield, 1)} (latest payment × payments a year ÷ price). `,
          'Paid out = total return − price return (the payouts actually made). ',
          termLabel('From the price falling', 'naverosion'),
          ' = the part of those payouts the price drop paid for (none when the price held or rose). From market prices, not the fund’s NAV (closed-end funds can trade above or below it).',
        ),
        h(
          'p',
          { class: 'small' },
          termLabel('Return of capital', 'roc'),
          ': ',
          roc ? `${rocText(roc.rocPct, roc.rocYear)} ` : 'not known. Prices can’t show it. Enter it below from box 3 of your 1099-DIV or the fund’s Section 19(a) notice. ',
          h('a', { href: notice19aLink(symbol), target: '_blank', rel: 'noopener' }, 'Find its 19(a) notices on SEC EDGAR'),
        ),
        charts,
      );
      el.addEventListener('toggle', () => el.open && loadCharts());
      return el;
    }

    /** One account's entries for a holding: purchase date, dividends received so far, return of capital. Saved in the store. */
    function entryForm(p: PartView, symbol: string, pays: boolean, done: () => void) {
      const x = p.part.holdings.find((hh) => hh.purchaseDate || hh.dividends != null || hh.rocPct != null) ?? p.part.holdings[0];
      const date = h('input', { class: 'input', type: 'date', value: x?.purchaseDate ?? '', max: new Date().toISOString().slice(0, 10), 'aria-label': `${p.part.account} purchase date` }) as HTMLInputElement;
      const divs = h('input', { class: 'input', type: 'number', min: 0, step: 0.01, value: x?.dividendsSource === 'entered' && x.dividends != null ? x.dividends : '', placeholder: x?.dividendsSource === 'statement' ? `${usd(x.dividends)} (statement)` : 'e.g. 125.40', 'aria-label': `${p.part.account} dividends received` }) as HTMLInputElement;
      const roc = h('input', { class: 'input', type: 'number', min: 0, max: 100, step: 0.1, value: x?.rocPct != null ? +(x.rocPct * 100).toFixed(2) : '', placeholder: 'e.g. 40', 'aria-label': `${p.part.account} return of capital percent` }) as HTMLInputElement;
      const rocYear = h('input', { class: 'input', type: 'number', min: 2000, max: 2100, step: 1, value: x?.rocYear ?? '', placeholder: String(new Date().getFullYear() - 1), 'aria-label': `${p.part.account} return of capital year` }) as HTMLInputElement;
      const save = h('button', { class: 'btn primary small' }, 'Save') as HTMLButtonElement;
      save.addEventListener('click', async () => {
        const pid = p.part.portfolioId;
        const doc = pid ? (await listDocs<Portfolio>('portfolios').catch(() => [] as Saved[])).find((d) => d.id === pid) : undefined;
        if (!doc) return toast('This account isn’t saved yet, so there is nowhere to keep your entries.');
        const amount = divs.value.trim() === '' ? null : Number(divs.value);
        const rocPct = roc.value.trim() === '' ? null : Number(roc.value) / 100;
        if ((amount != null && !(amount >= 0)) || (rocPct != null && !(rocPct >= 0 && rocPct <= 1))) return toast('Check the numbers: dividends ≥ 0, return of capital 0–100%.');
        const today = new Date().toISOString().slice(0, 10);
        let found = false;
        // null clears a field (the helper drops it); the first holding of this symbol in the account carries the entries
        const holdings = doc.holdings.map((hh): Holding => {
          if (found || (hh.kind ?? 'security') !== 'security' || hh.symbol.trim().toUpperCase() !== symbol) return hh;
          found = true;
          const keepStatement = amount == null && hh.dividendsSource === 'statement';
          return {
            ...hh,
            purchaseDate: (date.value || null) as unknown as string,
            ...(keepStatement ? {} : { dividends: amount as unknown as number, dividendsSource: (amount == null ? null : 'entered') as unknown as 'entered', dividendsAsOf: (amount == null ? null : today) as unknown as string }),
            rocPct: rocPct as unknown as number,
            rocYear: (rocPct == null || !rocYear.value ? null : rocYear.value) as unknown as string,
          };
        });
        save.disabled = true;
        try {
          await saveDoc('portfolios', { ...doc, holdings });
          toast('Saved. Figures are updating.');
          done();
          load();
        } catch (err) {
          toast((err as Error).message);
        } finally {
          save.disabled = false;
        }
      });
      const field = (label: string | Node, input: HTMLElement) => h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), input);
      return h(
        'div',
        { class: 'acct-entry' },
        h('b', { class: 'small' }, p.part.account),
        h(
          'div',
          { class: 'field-grid' },
          field('Purchase date', date),
          field('Dividends received so far ($)', divs),
          pays ? field(h('span', {}, 'Return of capital %', infoTip('roc')), roc) : '',
          pays ? field('ROC tax year', rocYear) : '',
        ),
        h('div', { class: 'ap-controls' }, save, h('span', { class: 'muted small' }, 'Leave a box empty to clear it. Dividends you type count to today; later payments are added as estimates.')),
      );
    }
  }

  function choose(id: string) {
    if (id === view) return;
    view = id;
    saveKey(VIEW_KEY, view);
    load();
  }

  /** News on the holdings shown (combined or one account), most market-moving first (the helper's rank_news score). */
  async function showHoldingsNews(box: HTMLElement, symbols: string[], run: number) {
    if (!symbols.length) return;
    const body = h('div', { class: 'news-list acct-news' }, h('div', { class: 'muted pad' }, 'Loading headlines…'));
    box.replaceChildren(panel('News on your holdings', `${symbols.length > 6 ? `${symbols.slice(0, 6).join(', ')} and ${symbols.length - 6} more` : symbols.join(', ')} · most important first`, body));
    const row = (item: NewsItem) =>
      h(
        'button',
        { class: `news-item impact-${item.impact}`, onclick: () => openNewsSummary(item) },
        h('div', { class: 'news-meta' }, item.impact !== 'low' ? h('span', { class: `impact-badge ${item.impact}` }, item.impact === 'high' ? 'High impact' : 'Medium') : null, h('span', { class: 'news-source' }, item.source), h('span', { class: 'muted' }, timeAgo(item.published))),
        h('div', { class: 'news-title' }, item.title),
      );
    try {
      const { items } = await loadNews(symbols);
      if (run !== loading) return;
      const top = [...items].sort((a, b) => b.score - a.score || b.published - a.published).slice(0, 8);
      body.replaceChildren(...(top.length ? top.map(row) : [h('div', { class: 'muted pad' }, 'No recent headlines on these holdings.')]));
    } catch (err) {
      body.replaceChildren(h('div', { class: 'muted pad' }, `News unavailable: ${(err as Error).message}`));
    }
  }

  /** "All accounts (combined)" plus one button per account; the choice is remembered on this device. */
  function switcher(mine: Saved[], current: string) {
    const options = [{ id: ALL_ACCOUNTS, label: 'All accounts (combined)' }, ...mine.map((p) => ({ id: p.id, label: p.name }))];
    return h(
      'div',
      { class: 'segmented acct-switch', role: 'group', 'aria-label': 'Show account' },
      ...options.map((o) => h('button', { type: 'button', class: o.id === current ? 'active' : '', 'aria-pressed': o.id === current, onclick: () => choose(o.id) }, o.label)),
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
      h('p', { class: 'ap-note' }, 'Sectors are in the Risk card. Asset classes come from your portfolios (imports start as US stocks; change one in Portfolios).'),
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
          h('li', {}, h('b', {}, 'Import statement'), ' (above): a CSV or Excel positions export from your broker.'),
          h('li', {}, 'Or ', h('b', {}, 'Sync Webull'), ' (above): each live Webull account becomes one of yours.'),
          h('li', {}, 'Or type an account in by hand: Portfolios → a portfolio with share or dollar amounts → tick ', h('b', {}, 'This is my account'), '.'),
        ),
        all.length ? h('span', { class: 'muted small' }, `You have ${all.length} saved portfolio${all.length === 1 ? '' : 's'}; models and client portfolios stay on Portfolios.`) : null,
        h('button', { class: 'btn primary', onclick: () => openStatementImport(imported) }, 'Import statement'),
      ),
    );
  }

  /** A statement was imported (always marked as yours): show it on its own. */
  function imported(p: Saved) {
    view = p.id;
    saveKey(VIEW_KEY, view);
    load();
  }

  /** After a sync: always reload the cards (the toast from the sync says what was saved). */
  function synced() {
    load();
  }
  /** Added to the sync's toast: synced Test accounts only count here once marked as the owner's. */
  function syncNote(saved: Saved[]) {
    const notMine = saved.filter((p) => !isMine(p)).length;
    return notMine ? `${notMine === saved.length ? 'They are' : `${notMine} of them are`} Webull Test accounts, not counted here until you tick "This is my account" in Portfolios.` : '';
  }

  window.addEventListener('tp:data-changed', () => started && load());

  let started = false;
  return {
    el: frame.el,
    /** Shows one account on its own (the command bar's account entries). */
    open(id: string) {
      view = id;
      saveKey(VIEW_KEY, view);
      if (started) load();
    },
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
