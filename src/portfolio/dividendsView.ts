/** Dividends for a shares portfolio (like the Snowball app): income, yields, a 12-month calendar, and statement import. */
import { engineRequest } from '../data/schwab';
import { saveDoc } from '../data/store';
import { parseCsv } from '../invest/holdings';
import { dataTable, money, pct, pctU, statCards } from '../ui/charts';
import { h, openModal, toast } from '../ui/dom';
import { termLabel } from '../ui/glossary';
import { FIELD_LABELS, jsonToRows, parseStatement, type Columns, type Position, type StatementField } from './statement';
import type { Portfolio } from './types';

interface Upcoming {
  exDate: string;
  payDate: string;
  perShare: number;
  amount: number;
  exPassed: boolean;
}

interface DividendHolding {
  symbol: string;
  name: string;
  shares: number;
  price: number | null;
  value: number | null;
  cost: number | null;
  gain: number | null;
  gainPct: number | null;
  frequencyLabel: string;
  forward: number;
  yield: number | null;
  yieldOnCost: number | null;
  annualIncome: number;
  growth5y: number | null;
  nextExDate: string | null;
  nextPayDate: string | null;
  note: string;
  specialRecent: boolean;
  upcoming: Upcoming[];
}

interface Payment {
  symbol: string;
  exDate: string;
  payDate: string;
  perShare: number;
  amount: number;
}

export interface DividendReport {
  holdings: DividendHolding[];
  asOf: string;
  value: number;
  cost: number | null;
  gain: number | null;
  gainPct: number | null;
  annualIncome: number;
  monthly: number;
  yield: number | null;
  yieldOnCost: number | null;
  calendar: { month: string; total: number; payments: Payment[] }[];
}

const tone = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? 'up' : 'down');
const monthName = (key: string, withYear = false) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const est = () => h('span', { class: 'badge', title: 'Estimated from the usual timing and the latest payment' }, 'est.');

/** Fetches and draws the dividends view for a portfolio's share holdings into `out`. */
export async function renderDividends(out: HTMLElement, p: Portfolio) {
  const holdings = p.holdings
    .filter((x) => (x.kind ?? 'security') === 'security' && x.symbol.trim() && (x.shares ?? 0) > 0)
    .map((x) => ({ symbol: x.symbol.trim().toUpperCase(), shares: x.shares, costBasis: x.cost }));
  if ((p.mode ?? 'weight') !== 'shares' || !holdings.length) {
    out.replaceChildren(
      h('section', { class: 'panel' }, h('div', { class: 'empty-state' }, h('b', {}, 'Dividends need the number of shares you own.'), h('span', {}, 'Import a statement (left), or switch "Enter holdings as" to Shares and type them in.'))),
    );
    return;
  }
  out.replaceChildren(h('div', { class: 'muted pad' }, 'Reading dividend histories…'));
  try {
    const r = await engineRequest<DividendReport>('dividends.portfolio', { holdings }, 120000);
    draw(out, r, p.holdings.some((x) => x.kind === 'cash'));
  } catch (err) {
    out.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
  }
}

function draw(out: HTMLElement, r: DividendReport, hasCash: boolean) {
  const max = Math.max(1, ...r.calendar.map((m) => m.total));
  const detail = h('div', {});
  const bars: HTMLElement[] = [];
  const cells: HTMLElement[] = [];
  const pick = (i: number) => {
    bars.forEach((b, k) => b.classList.toggle('active', k === i));
    cells.forEach((c, k) => c.classList.toggle('active', k === i));
    const m = r.calendar[i];
    detail.replaceChildren(
      h('h4', {}, `${monthName(m.month, true)}: ${money(m.total)} expected`),
      m.payments.length
        ? dataTable(
            ['Symbol', 'Ex-date', 'Pay date', 'Per share', 'Amount'],
            m.payments.map((x) => [h('b', {}, x.symbol), h('span', {}, day(x.exDate), ' ', est()), h('span', {}, day(x.payDate), ' ', est()), { v: `$${x.perShare.toFixed(4)}`, cls: 'num' }, { v: money(x.amount), cls: 'num' }]),
            undefined,
            false,
          )
        : h('p', { class: 'muted small' }, 'No payments expected this month.'),
    );
  };
  r.calendar.forEach((m, i) => {
    const first = i === 0 || m.month.endsWith('-01');
    bars.push(
      h(
        'button',
        { class: 'div-bar', title: `${monthName(m.month, true)}: ${money(m.total)}`, onclick: () => pick(i) },
        h('span', { class: 'div-bar-value' }, m.total ? money(m.total) : ''),
        h('span', { class: 'div-bar-track' }, h('span', { class: 'div-bar-fill', style: `height:${(m.total / max) * 100}%` })),
        h('span', { class: 'div-bar-label' }, monthName(m.month), first ? h('small', {}, m.month.slice(2, 4)) : null),
      ),
    );
    const shown = m.payments.slice(0, 4);
    cells.push(
      h(
        'button',
        { class: 'div-cell', onclick: () => pick(i) },
        h('span', { class: 'div-cell-head' }, h('b', {}, monthName(m.month, first)), h('span', { class: 'num' }, money(m.total))),
        ...shown.map((x) => h('span', { class: 'div-cell-row' }, h('span', {}, x.symbol), h('span', { class: 'num muted' }, money(x.amount)))),
        m.payments.length > shown.length ? h('span', { class: 'muted small' }, `+${m.payments.length - shown.length} more`) : null,
        !m.payments.length ? h('span', { class: 'muted small' }, 'Nothing expected') : null,
      ),
    );
  });

  const today = r.asOf;
  const in30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
  const soon = r.holdings
    .flatMap((x) => x.upcoming.filter((u) => !u.exPassed && u.exDate <= in30).map((u) => ({ ...u, symbol: x.symbol })))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  const noteBadge = (x: DividendHolding) =>
    x.note ? h('span', { class: `badge ${/cut|stopped/.test(x.note) ? 'down' : ''}`, title: x.note }, x.note.replace('Latest dividend was cut', 'Cut').replace('Dividends seem to have stopped', 'Stopped').replace('No dividends', 'None')) : x.specialRecent ? h('span', { class: 'badge accent', title: 'Paid a one-off special dividend in the last year (not counted in the yield)' }, 'Special') : null;

  out.replaceChildren(
    statCards([
      { label: 'Yearly dividend income', value: money(r.annualIncome), hint: 'Expected over the next 12 months at the latest regular payments' },
      { label: 'Monthly average', value: money(r.monthly) },
      { label: termLabel('Portfolio yield', 'divyield'), value: pctU(r.yield), hint: 'Yearly income ÷ market value' },
      { label: termLabel('Yield on cost', 'yoc'), value: pctU(r.yieldOnCost), hint: 'Yearly income ÷ what you paid' },
      { label: 'Market value', value: money(r.value), hint: r.cost ? `Cost ${money(r.cost)}` : 'Add cost basis to see your gain' },
      { label: 'Gain', value: r.gain != null ? `${money(r.gain)} (${pct(r.gainPct, 1)})` : '—', tone: tone(r.gain), hint: 'Unrealized, on holdings with a cost basis' },
    ]),
    h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Income by month'), h('span', { class: 'muted small' }, 'Next 12 months, by estimated pay date. Tap a month for details.')),
      h('div', { class: 'div-bars' }, ...bars),
    ),
    h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Dividend calendar'), h('span', { class: 'muted small' }, termLabel('Ex-date', 'exdate'), ' · ', termLabel('Pay date', 'paydate'))),
      h('div', { class: 'div-cal' }, ...cells),
      detail,
    ),
    h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Upcoming ex-dates (next 30 days)'), h('span', { class: 'muted small' }, 'Own the shares before these days to get the payment')),
      soon.length
        ? dataTable(
            ['Ex-date', 'Symbol', 'Pay date', 'Amount'],
            soon.map((u) => [h('span', {}, day(u.exDate), ' ', est()), h('b', {}, u.symbol), day(u.payDate), { v: money(u.amount), cls: 'num' }]),
            undefined,
            false,
          )
        : h('div', { class: 'empty-state' }, 'No ex-dates expected in the next 30 days.'),
    ),
    h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Holdings')),
      dataTable(
        ['Symbol', 'Shares', 'Cost basis', 'Value', 'Gain', 'Yield', 'Yield on cost', 'Yearly income', 'Pays', 'Next ex-date', '5y growth'],
        r.holdings.map((x) => [
          { v: h('span', { title: x.name }, h('b', {}, x.symbol), ' ', noteBadge(x) ?? ''), cls: 'label' },
          { v: String(+x.shares.toFixed(4)), cls: 'num' },
          { v: money(x.cost), cls: 'num' },
          { v: money(x.value), cls: 'num' },
          { v: x.gainPct != null ? pct(x.gainPct, 1) : '—', cls: `num ${tone(x.gain)}` },
          { v: pctU(x.yield), cls: 'num' },
          { v: pctU(x.yieldOnCost), cls: 'num' },
          { v: money(x.annualIncome), cls: 'num' },
          x.frequencyLabel,
          x.nextExDate ? h('span', {}, day(x.nextExDate), ' ', est()) : '—',
          { v: pct(x.growth5y, 1), cls: `num ${tone(x.growth5y)}` },
        ]),
      ),
      h(
        'p',
        { class: 'ap-note' },
        'Yield = the latest regular dividend × payments per year ÷ price (one-off specials are left out). 5y growth is the yearly rate the dividend grew over five years. Future dates and amounts are estimates from each holding’s dividend history; pay dates are about 3 weeks after the ex-date.',
        hasCash ? ' Cash and money-market balances aren’t included.' : '',
      ),
    ),
  );
  pick(Math.max(0, r.calendar.findIndex((m) => m.payments.length)));
}

async function fileRows(file: File): Promise<string[][]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xls') throw new Error('This is the old Excel format. In Excel use File → Save As → .xlsx or .csv.');
  if (ext === 'xlsx' || ext === 'xlsm') {
    const { xlsxToCsv } = await import('../ai/files');
    return parseCsv((await xlsxToCsv(await file.arrayBuffer())).text.replace(/^# Sheet:.*$/gm, ''));
  }
  return parseCsv(await file.text());
}

const PDF_PROMPT =
  'Read the positions (holdings) table in the attached brokerage statement. Reply with ONLY a JSON array, no other text: ' +
  '[{"symbol": "ticker", "name": "description", "shares": number, "costBasis": total cost in dollars or null, "marketValue": number or null}]. ' +
  'Include cash and money-market lines with symbol "CASH". Add the same ticker from different accounts together. Use plain numbers (no $ or commas).';

/** Import a brokerage statement: pick a file, check the matched columns, save as a shares portfolio. */
export async function openStatementImport(onSaved: (p: Portfolio & { id: string }) => void) {
  const status = h('p', { class: 'muted small' });
  const file = h('input', { type: 'file', accept: '.csv,.xlsx,.xlsm,.txt', hidden: true });
  const pdf = h('input', { type: 'file', accept: '.pdf', hidden: true });
  let aiReady = false;
  try {
    const { getSettings } = await import('../ui/settings');
    aiReady = (await getSettings()).aiKeySet;
  } catch {
    /* helper offline: CSV still works once it's back */
  }
  const body = h(
    'div',
    {},
    h('p', {}, 'Download your positions from your broker as CSV or Excel (Schwab: Accounts → Positions → Export; Fidelity: Positions → Download; Vanguard, Robinhood and Webull have similar buttons) and choose it here. Nothing leaves your computer: the helper saves the portfolio in its own database.'),
    h(
      'div',
      { class: 'ap-controls' },
      h('button', { class: 'btn primary', onclick: () => file.click() }, 'Choose CSV or Excel file'),
      aiReady ? h('button', { class: 'btn', onclick: () => pdf.click() }, 'Read a PDF statement') : null,
      file,
      pdf,
    ),
    aiReady ? null : h('p', { class: 'muted small' }, 'Only have a PDF? Add your AI key in Settings to read PDF statements, or download CSV/Excel from your broker.'),
    status,
  );
  const close = openModal('Import a statement', body, { wide: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const rows = await fileRows(f);
      close();
      preview(rows, f.name.replace(/\.[^.]+$/, ''), onSaved);
    } catch (err) {
      status.textContent = `Couldn’t read ${f.name}: ${(err as Error).message}`;
    }
  });
  pdf.addEventListener('change', async () => {
    const f = pdf.files?.[0];
    if (!f) return;
    status.textContent = 'The AI is reading the statement (this can take a minute)…';
    let conversation = '';
    try {
      const { readAttachment } = await import('../ai/files');
      const { info: _info, ...attachment } = await readAttachment(f);
      const reply = await engineRequest<{ text: string; conversation: string }>('ai.chat', { message: PDF_PROMPT, attachments: [attachment] }, 300000);
      conversation = reply.conversation;
      const rows = jsonToRows(reply.text);
      close();
      preview(rows, f.name.replace(/\.[^.]+$/, ''), onSaved);
    } catch (err) {
      status.textContent = `Couldn’t read the PDF: ${(err as Error).message}`;
    } finally {
      if (conversation) engineRequest('ai.reset', { conversation }, 10000).catch(() => {});
    }
  });
}

function preview(rows: string[][], fileName: string, onSaved: (p: Portfolio & { id: string }) => void) {
  const first = parseStatement(rows);
  if (first.headerAt < 0) {
    openModal('No positions table found', h('p', {}, 'The file needs a heading row with a symbol column and a quantity/shares column. Download the "Positions" export from your broker (not transactions or a PDF).'));
    return;
  }
  let columns: Columns = { ...first.columns };
  let positions: Position[] = first.positions;
  const name = h('input', { class: 'input', value: fileName ? `${fileName}` : 'My dividend portfolio', 'aria-label': 'Portfolio name' });
  const tableBox = h('div', {});
  const summary = h('p', { class: 'muted small' });
  const redraw = () => {
    positions = parseStatement(rows, columns).positions;
    const stocks = positions.filter((x) => !x.cash);
    const cash = positions.find((x) => x.cash);
    summary.textContent = `${stocks.length} holding${stocks.length === 1 ? '' : 's'}${cash ? ` and ${money(cash.value)} cash` : ''}. ${stocks.some((x) => x.cost == null) ? 'Some rows have no cost basis: yield on cost and gain leave them out (you can type it in later).' : ''}`;
    tableBox.replaceChildren(
      dataTable(
        ['Symbol', 'Description', 'Shares', 'Cost basis', 'Market value'],
        positions.map((x) => [h('b', {}, x.symbol), x.name ?? '', { v: x.cash ? '—' : String(x.shares), cls: 'num' }, { v: money(x.cost), cls: 'num' }, { v: money(x.value), cls: 'num' }]),
        undefined,
        false,
      ),
    );
  };
  const select = (field: StatementField) => {
    const el = h('select', { class: 'input', 'aria-label': FIELD_LABELS[field] }, h('option', { value: '' }, '(not in file)'), ...first.headers.map((t, i) => h('option', { value: i, selected: columns[field] === i }, t || `Column ${i + 1}`)));
    el.addEventListener('change', () => {
      columns = { ...columns, [field]: el.value === '' ? undefined : Number(el.value) };
      redraw();
    });
    return h('label', { class: 'field' }, h('span', { class: 'muted small' }, FIELD_LABELS[field]), el);
  };
  redraw();
  const close = openModal(
    'Check the import',
    h(
      'div',
      {},
      h('p', { class: 'muted small' }, 'These columns were matched automatically. Fix any that are wrong.'),
      h('div', { class: 'field-grid' }, ...(Object.keys(FIELD_LABELS) as StatementField[]).filter((f) => f !== 'account').map(select)),
      summary,
      tableBox,
      h(
        'div',
        { class: 'ap-controls', style: 'margin-top:10px' },
        h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Save as'), name),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const stocks = positions.filter((x) => !x.cash);
              if (!stocks.length) return toast('No holdings to save. Check the Symbol and Shares columns.');
              const cash = positions.find((x) => x.cash);
              const p: Portfolio = {
                name: name.value.trim() || 'My dividend portfolio',
                benchmark: 'SPY',
                rebalance: 'none',
                mode: 'shares',
                holdings: [
                  ...stocks.map((x) => ({ symbol: x.symbol, name: x.name, weight: 0, assetClass: 'US stocks' as const, kind: 'security' as const, shares: x.shares, cost: x.cost })),
                  ...(cash?.value ? [{ symbol: 'CASH', name: 'Cash / money market', weight: 0, assetClass: 'Cash' as const, kind: 'cash' as const, amount: cash.value }] : []),
                ],
              };
              try {
                const saved = await saveDoc('portfolios', p);
                close();
                toast(`Saved "${saved.name}"`);
                onSaved(saved);
              } catch (err) {
                toast((err as Error).message);
              }
            },
          },
          'Save portfolio',
        ),
      ),
    ),
    { wide: true },
  );
}
