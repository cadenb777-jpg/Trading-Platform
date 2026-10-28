/**
 * Clients: one review page per client (holdings, performance net and gross of fees, risk vs their tolerance, drift vs
 * the target model, upcoming income, notes, one-click report), the client details editor, report branding, and
 * printable white-label performance reports. "CLIENT <name>" in the command bar opens a client's review.
 */
import { engineRequest } from '../data/schwab';
import { deleteDoc, listDocs, saveDoc } from '../data/store';
import type { AltHolding } from '../invest/holdings';
import { PRIVATE_FUNDS } from '../invest/catalog';
import { fetchPrices, priceMap, type PriceInfo } from '../portfolio/prices';
import { TEMPLATES, describeFees, holdingsPayload, isCashOrAlt, type Analysis, type FeeSchedule, type Portfolio } from '../portfolio/types';
import { buildReport, type FundFacts, type MarketRow } from '../reports/report';
import '../reports/report.css';
import { drawClientReview } from '../reports/clientReview';
import { RISK_LEVELS, defaultTolerance } from '../reports/review';
import { DEFAULT_BRANDING, OBJECTIVES, REPORT_SECTIONS, type Branding, type Client } from '../reports/types';
import { pageFrame } from '../ui/charts';
import { h, openModal, toast } from '../ui/dom';

const blankClient = (portfolioId = ''): Client => ({
  name: 'New client',
  household: '',
  accountName: '',
  portfolioId,
  inception: '',
  initialInvestment: 100000,
  fee: 0.01,
  commentary: '',
  reports: [],
});

/** Benchmarks for the report's market overview page. */
const MARKET: [string, string][] = [
  ['$SPX', 'S&P 500 (US large caps)'],
  ['$COMPX', 'Nasdaq Composite'],
  ['$RUT', 'Russell 2000 (US small caps)'],
  ['VXUS', 'International stocks'],
  ['VWO', 'Emerging markets'],
  ['AGG', 'US investment-grade bonds'],
  ['HYG', 'High-yield bonds'],
  ['MUB', 'Municipal bonds'],
  ['VNQ', 'Real estate (REITs)'],
  ['BIZD', 'Private credit (listed BDCs)'],
  ['GLD', 'Gold'],
  ['BIL', 'Cash (T-bills)'],
];

/** Puts report pages in a hidden container, opens the browser's print dialog (choose "Save as PDF"), then cleans up. */
function printReports(docs: HTMLElement[], title: string) {
  const root = h('div', { class: 'print-root' }, ...docs);
  document.body.append(root);
  document.body.classList.add('printing');
  const oldTitle = document.title;
  document.title = title;
  const done = () => {
    root.remove();
    document.body.classList.remove('printing');
    document.title = oldTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  // Give the logo and fonts a moment to load before printing.
  setTimeout(() => window.print(), 400);
}

/** Shrinks an uploaded logo so it stays small in the database but sharp in print. */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const url = String(reader.result);
      if (file.type === 'image/svg+xml') return resolve(url);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('That file is not an image'));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

export function createClientsPage() {
  let clients: (Client & { id: string })[] = [];
  let altHoldings: (AltHolding & { id: string })[] = [];
  let savedPortfolios: (Portfolio & { id: string })[] = [];
  /** Templates (e.g. Classic 60/40) can be picked straight away, without saving them first. */
  const templates = TEMPLATES.map((t) => ({ ...t, id: `template:${t.name}` }));
  let portfolios: (Portfolio & { id: string })[] = templates;
  let branding: Branding = { ...DEFAULT_BRANDING };
  let current: Client = blankClient();
  /** A client to select once the list has loaded (from the command bar). */
  let openId: string | null = null;
  const list = h('div', { class: 'pf-list', role: 'list', 'aria-label': 'Clients' });
  const editor = h('section', { class: 'panel' });
  const preview = h('div', { class: 'ap-body' });
  /** A saved client opens on its review; a new one (or Edit details) on the editor. */
  let mode: 'review' | 'edit' = 'review';
  const reviewHead = h('div', { class: 'rv-head' });
  const reviewBox = h('div', { class: 'rv-body' });
  const review = h('section', { class: 'rv', 'aria-label': 'Client review', hidden: true }, reviewHead, reviewBox);
  /** The last review's data, so saving a note or a setting redraws without asking the helper again. */
  let reviewData: { id: string; input: { portfolio: Portfolio; analysis: Analysis | null; analysisError?: string; prices: Record<string, PriceInfo> } } | null = null;
  let reviewRun = 0;
  const frame = pageFrame('Clients & Reports', 'Client accounts and white-label performance reports. Client data is stored by the helper on your computer.', [
    h('button', { class: 'btn', onclick: () => openBranding() }, 'Report branding'),
    h('button', { class: 'btn', onclick: () => batchPrint() }, 'Print all reports'),
  ]);
  frame.body.replaceChildren(h('div', { class: 'pf-layout' }, h('aside', { class: 'panel' }, list), h('div', { class: 'ap-body' }, review, editor, preview)));
  // Up / Down in the client list move between clients (the review follows)
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...list.querySelectorAll<HTMLButtonElement>('button[data-client]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    const id = next.dataset.client!;
    next.click();
    list.querySelector<HTMLElement>(`button[data-client="${CSS.escape(id)}"]`)?.focus();
  });

  async function refresh() {
    try {
      [clients, savedPortfolios] = await Promise.all([listDocs<Client>('clients'), listDocs<Portfolio>('portfolios')]);
      altHoldings = await listDocs<AltHolding>('alt_holdings').catch(() => []);
      portfolios = [...savedPortfolios, ...templates];
      const saved = await listDocs<Branding>('branding');
      branding = { ...DEFAULT_BRANDING, ...(saved.find((b) => b.id === 'default') ?? {}) };
    } catch (err) {
      review.hidden = true;
      editor.hidden = false;
      editor.replaceChildren(h('div', { class: 'ap-error' }, `${(err as Error).message.replace(/\.$/, '')}. Clients are saved by the helper on your computer.`));
      return;
    }
    if (!current.portfolioId && portfolios[0]) current.portfolioId = portfolios[0].id;
    const wanted = openId && clients.find((c) => c.id === openId);
    openId = null;
    if (wanted) {
      current = structuredClone(wanted);
      mode = 'review';
    } else if (!current.id && clients.length && mode === 'review') current = structuredClone(clients[0]); // open on the first client's review
    renderList();
    renderRight();
  }

  /** The review for a saved client, or the editor. */
  function renderRight() {
    const reviewing = mode === 'review' && !!current.id;
    review.hidden = !reviewing;
    editor.hidden = reviewing;
    if (reviewing) void renderReview();
    else renderEditor();
  }

  function renderList() {
    list.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => select(blankClient(portfolios[0]?.id)) }, '+ New client'),
      h('div', { class: 'muted small' }, 'Clients'),
      ...(clients.length
        ? clients.map((c) => h('button', { class: c.id === current.id ? 'active' : '', role: 'listitem', 'data-client': c.id, 'aria-current': c.id === current.id ? 'true' : undefined, onclick: () => select(structuredClone(c)) }, c.name, c.household ? h('div', { class: 'muted small', style: 'padding:0' }, c.household) : null))
        : [h('div', { class: 'muted small' }, 'No clients yet.')]),
    );
  }

  function select(c: Client) {
    current = c;
    mode = c.id ? 'review' : 'edit';
    renderList();
    renderRight();
    preview.replaceChildren();
  }

  const tolText = (c: Client) => {
    const r = RISK_LEVELS.find((x) => x.level === (c.riskTolerance ?? defaultTolerance(c.objective)))!;
    return `${r.label} risk${c.riskTolerance ? '' : ' (from the objective)'}`;
  };

  async function renderReview() {
    const c = current;
    const run = ++reviewRun;
    reviewHead.replaceChildren(
      h('div', { class: 'rv-title' }, h('h2', {}, c.name), h('span', { class: 'muted small' }, [c.household, c.accountName, c.objective, tolText(c)].filter(Boolean).join(' · '))),
      h(
        'div',
        { class: 'rv-actions' },
        h('button', { class: 'btn primary', title: 'Builds the white-label report and opens Print (choose Save as PDF)', onclick: () => printOne() }, 'Report (PDF)'),
        h('button', { class: 'btn', onclick: () => showPreview() }, 'Preview report'),
        h('button', { class: 'btn', onclick: () => ((mode = 'edit'), renderRight()) }, 'Edit details'),
      ),
    );
    const portfolio = portfolios.find((p) => p.id === c.portfolioId);
    if (!portfolio) {
      reviewBox.replaceChildren(h('div', { class: 'ap-error' }, `${c.name} has no portfolio (it may have been deleted). Choose one in Edit details.`));
      return;
    }
    if (reviewData?.id === c.id) return drawReview(); // a saved note or setting: redraw only
    reviewBox.replaceChildren(h('div', { class: 'muted pad' }, `Building ${c.name}'s review…`));
    const symbols = [...new Set(portfolios.filter((p) => p.id === c.portfolioId || p.id === c.targetId).flatMap((p) => p.holdings).filter((x) => !isCashOrAlt(x) && x.symbol.trim()).map((x) => x.symbol.trim().toUpperCase()))];
    const prices: Record<string, PriceInfo> = symbols.length ? await fetchPrices(symbols).catch(() => ({})) : {};
    let analysis: Analysis | null = null;
    let analysisError: string | undefined;
    try {
      analysis = await analyse(c, portfolio, prices);
    } catch (err) {
      analysisError = (err as Error).message;
    }
    if (run !== reviewRun || current.id !== c.id) return; // moved to another client meanwhile
    reviewData = { id: c.id!, input: { portfolio, analysis, analysisError, prices } };
    drawReview();
  }

  function drawReview() {
    if (!reviewData || reviewData.id !== current.id) return;
    const c = current;
    const own = reviewData.input.portfolio;
    const target = c.targetId ? (portfolios.find((p) => p.id === c.targetId) ?? null) : (own.mode ?? 'weight') === 'weight' ? own : null;
    drawClientReview(reviewBox, {
      ...reviewData.input,
      client: c,
      target,
      models: portfolios.filter((p) => (p.mode ?? 'weight') === 'weight'),
      save: (change) => void saveChange(change),
    });
  }

  /** Saves a change made on the review (tolerance, target model, notes) and redraws it. */
  async function saveChange(change: Partial<Client>) {
    Object.assign(current, change);
    try {
      current = await saveDoc('clients', current);
      clients = clients.map((x) => (x.id === current.id ? (structuredClone(current) as Client & { id: string }) : x));
      toast(change.notes != null ? 'Note saved' : `Saved ${current.name}`);
    } catch (err) {
      toast((err as Error).message);
    }
    void renderReview();
  }

  function field(label: string, input: HTMLElement, hint?: string) {
    return h('label', { class: 'field', title: hint ?? '' }, h('span', { class: 'muted small' }, label), input);
  }

  function renderEditor() {
    const c = current;
    const text = (key: 'name' | 'household' | 'accountName' | 'benchmark', placeholder = '') => {
      const el = h('input', { class: 'input', value: c[key] ?? '', placeholder });
      el.addEventListener('input', () => (c[key] = el.value));
      el.addEventListener('change', () => ((c[key] = el.value.trim()), (el.value = c[key] ?? '')));
      return el;
    };
    const pfSelect = h(
      'select',
      { class: 'input' },
      savedPortfolios.length ? h('optgroup', { label: 'My portfolios' }, ...savedPortfolios.map((p) => h('option', { value: p.id, selected: p.id === c.portfolioId }, p.name))) : null,
      h('optgroup', { label: 'Templates' }, ...templates.map((p) => h('option', { value: p.id, selected: p.id === c.portfolioId }, p.name))),
    );
    pfSelect.addEventListener('change', () => (c.portfolioId = pfSelect.value));
    const inception = h('input', { class: 'input', type: 'date', value: c.inception });
    inception.addEventListener('change', () => (c.inception = inception.value));
    const initial = h('input', { class: 'input', type: 'number', step: 1000, value: c.initialInvestment });
    initial.addEventListener('input', () => (c.initialInvestment = parseFloat(initial.value) || 0));
    const fees = feeEditor(c);
    const commentary = h('textarea', { class: 'input', rows: 5, placeholder: 'Optional market and portfolio commentary for this report. Leave a blank line between paragraphs.' });
    commentary.value = c.commentary ?? '';
    commentary.addEventListener('input', () => (c.commentary = commentary.value));
    const additions = h('input', { class: 'input', type: 'number', step: 1000, value: c.netAdditions ?? 0 });
    additions.addEventListener('input', () => (c.netAdditions = parseFloat(additions.value) || 0));
    const objective = h('select', { class: 'input' }, h('option', { value: '' }, '—'), ...OBJECTIVES.map((o) => h('option', { value: o, selected: o === c.objective }, o)));
    objective.addEventListener('change', () => (c.objective = objective.value || undefined));
    const tolerance = h('select', { class: 'input' }, h('option', { value: '' }, 'From the objective'), ...RISK_LEVELS.map((r) => h('option', { value: r.level, selected: r.level === c.riskTolerance }, `${r.level} · ${r.label}`)));
    tolerance.addEventListener('change', () => (c.riskTolerance = tolerance.value ? (Number(tolerance.value) as Client['riskTolerance']) : undefined));
    const targetModel = h('select', { class: 'input' }, h('option', { value: '' }, 'None'), ...portfolios.filter((p) => (p.mode ?? 'weight') === 'weight').map((p) => h('option', { value: p.id, selected: p.id === c.targetId }, p.name)));
    targetModel.addEventListener('change', () => (c.targetId = targetModel.value || undefined));
    const altBox = h(
      'div',
      { class: 'check-list' },
      ...(altHoldings.length
        ? altHoldings.map((x) => {
            const box = h('input', { type: 'checkbox', checked: !!c.altIds?.includes(x.id) });
            box.addEventListener('change', () => {
              const ids = new Set(c.altIds ?? []);
              if (box.checked) ids.add(x.id);
              else ids.delete(x.id);
              c.altIds = [...ids];
            });
            return h('label', { class: 'check-item' }, box, h('span', {}, x.fund, x.account ? h('span', { class: 'muted small' }, ` · ${x.account}`) : ''));
          })
        : [h('span', { class: 'muted small' }, 'None saved yet. Add them under Investments → Alternatives → My alternatives (or import an iCapital export), or add alternatives directly to the portfolio.')]),
    );
    const sectionBox = h(
      'div',
      { class: 'check-list' },
      ...REPORT_SECTIONS.map(([key, label]) => {
        const box = h('input', { type: 'checkbox', checked: c.sections?.[key] !== false });
        box.addEventListener('change', () => (c.sections = { ...c.sections, [key]: box.checked }));
        return h('label', { class: 'check-item' }, box, h('span', {}, label));
      }),
    );
    const history = c.reports?.length ? h('p', { class: 'muted small' }, `Reports generated: ${c.reports.slice(-5).reverse().map((r) => `${r.generated} (as of ${r.asOf})`).join(', ')}`) : '';
    editor.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, c.id ? `Edit ${c.name}` : 'New client'), h('span', { class: 'spacer' }), c.id ? h('button', { class: 'btn small', onclick: () => ((mode = 'review'), renderRight()) }, '← Back to review') : ''),
      h(
        'div',
        { class: 'field-grid' },
        field('Client name', text('name')),
        field('Household (optional)', text('household', 'e.g. The Smith Family')),
        field('Account name', text('accountName', 'e.g. Joint Brokerage')),
        field('Portfolio / model', pfSelect, 'The account follows this saved portfolio'),
        field('Account start date', inception, 'Performance is measured from here. Leave blank for a hypothetical long-term history.'),
        field('Initial investment ($)', initial),
        field('Benchmark (optional)', text('benchmark', 'Uses the portfolio’s benchmark')),
        field('Net additions since start ($)', additions, 'Deposits minus withdrawals, for the change-in-value table'),
        field('Investment objective', objective),
        field('Risk tolerance', tolerance, 'Compared with the portfolio’s volatility on the review'),
        field('Target model (for drift)', targetModel, 'The model this account should match; the review shows the drift'),
      ),
      h('div', { class: 'two-col', style: 'margin-top:12px' }, h('div', { class: 'field' }, h('span', { class: 'muted small' }, 'Alternative investments to include'), altBox), h('div', { class: 'field' }, h('span', { class: 'muted small' }, 'Report sections'), sectionBox)),
      fees,
      h('label', { class: 'field', style: 'margin-top:12px' }, h('span', { class: 'muted small' }, 'Commentary'), commentary),
      history,
      h(
        'div',
        { class: 'ap-controls', style: 'margin-top:12px' },
        h('span', { class: 'spacer' }),
        c.id ? h('button', { class: 'btn danger', onclick: remove }, 'Delete') : null,
        h('button', { class: 'btn', onclick: save }, 'Save'),
        h('button', { class: 'btn', onclick: () => showPreview() }, 'Preview report'),
        h('button', { class: 'btn primary', onclick: () => printOne() }, 'Print / Save PDF'),
      ),
    );
  }

  async function save() {
    try {
      for (const k of ['name', 'household', 'accountName', 'benchmark'] as const) if (typeof current[k] === 'string') current[k] = current[k]!.trim();
      current = await saveDoc('clients', current);
      toast(`Saved ${current.name}`);
      mode = 'review';
      reviewData = null; // portfolio, dates or fees may have changed
      await refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!current.id || !confirm(`Delete ${current.name}? Their saved details will be removed from this computer.`)) return;
    await deleteDoc('clients', current.id).catch((err) => toast((err as Error).message));
    current = blankClient(portfolios[0]?.id);
    mode = 'review';
    reviewData = null;
    await refresh();
  }

  async function build(c: Client) {
    const portfolio = portfolios.find((p) => p.id === c.portfolioId);
    if (!portfolio) throw new Error(`${c.name}: choose a portfolio for this client (its old portfolio may have been deleted).`);
    const on = (k: keyof NonNullable<Client['sections']>) => c.sections?.[k] !== false;
    // Live prices (for share counts and dividend yields); reports still build without them.
    let prices: Record<string, PriceInfo> = {};
    const symbols = portfolio.holdings.filter((x) => !isCashOrAlt(x) && x.symbol.trim()).map((x) => x.symbol);
    if (symbols.length) prices = await fetchPrices(symbols).catch(() => ({}));
    const alternatives = altHoldings.filter((x) => c.altIds?.includes(x.id));
    const [analysis, market, fundFacts] = await Promise.all([
      analyse(c, portfolio, prices),
      on('market') ? loadMarket() : Promise.resolve([] as MarketRow[]),
      on('alternatives') ? loadFundFacts(portfolio, alternatives) : Promise.resolve({}),
    ]);
    return { doc: buildReport({ client: c, portfolio, analysis, branding, prices, alternatives, fundFacts, market }), analysis };
  }

  /** The client's performance with fees (the same request as the report, so the browser reuses it for 5 minutes). */
  function analyse(c: Client, portfolio: Portfolio, prices: Record<string, PriceInfo>) {
    return engineRequest<Analysis>(
      'portfolio.analyze',
      { holdings: holdingsPayload(portfolio, priceMap(prices)), benchmark: c.benchmark?.trim() || portfolio.benchmark, rebalance: portfolio.rebalance, since: c.inception || undefined, fee: c.fee, feeSchedule: c.feeSchedule, initial: c.initialInvestment || undefined },
      120000,
    );
  }

  async function loadMarket(): Promise<MarketRow[]> {
    try {
      const { rows } = await engineRequest<{ rows: { symbol: string; m3?: number; ytd?: number; y1?: number }[] }>('invest.board', { symbols: MARKET.map(([s]) => s) }, 60000);
      return MARKET.map(([symbol, label]) => ({ symbol, label, ...rows.find((r) => r.symbol === symbol) }));
    } catch {
      return [];
    }
  }

  /** NAV per share, total return and distributions from SEC filings for the known funds in the report. */
  async function loadFundFacts(portfolio: Portfolio, alternatives: AltHolding[]): Promise<Record<string, FundFacts>> {
    const names = new Set<string>();
    for (const x of portfolio.holdings) if (x.kind === 'alt') names.add(PRIVATE_FUNDS.find((f) => f.id === x.fundId)?.name ?? x.name ?? x.symbol);
    for (const x of alternatives) names.add(PRIVATE_FUNDS.find((f) => f.short.toLowerCase() === x.fund.toLowerCase())?.name ?? x.fund);
    const out: Record<string, FundFacts> = {};
    await Promise.all(
      [...names].filter(Boolean).map(async (name) => {
        try {
          const d = await engineRequest<{ facts?: FundFacts | null }>('alts.fund', { name }, 90000); // same request (and cache entry) as the fund page
          if (d.facts) out[name.toLowerCase()] = d.facts;
        } catch {
          // Not every private fund files reports with the SEC; the report just leaves that row out.
        }
      }),
    );
    return out;
  }

  async function record(c: Client, asOf: string) {
    if (!c.id) return;
    c.reports = [...(c.reports ?? []), { generated: new Date().toISOString().slice(0, 10), asOf }].slice(-40);
    await saveDoc('clients', c).catch(() => {});
  }

  async function showPreview() {
    preview.replaceChildren(h('div', { class: 'muted pad' }, 'Building report…'));
    try {
      const { doc } = await build(current);
      preview.replaceChildren(h('div', { class: 'report-preview' }, doc));
    } catch (err) {
      preview.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  async function printOne() {
    toast('Building report…');
    try {
      const { doc, analysis } = await build(current);
      await record(current, analysis.end);
      printReports([doc], `${current.name} - ${branding.reportTitle} - ${analysis.end}`);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function batchPrint() {
    if (!clients.length) return toast('No saved clients yet.');
    const docs: HTMLElement[] = [];
    const failed: string[] = [];
    for (const [i, c] of clients.entries()) {
      toast(`Building report ${i + 1} of ${clients.length}: ${c.name}`);
      try {
        const { doc, analysis } = await build(c);
        docs.push(doc);
        await record(c, analysis.end);
      } catch {
        failed.push(c.name);
      }
    }
    if (failed.length) alert(`Skipped (check their portfolio): ${failed.join(', ')}`);
    if (docs.length) printReports(docs, `Client reports ${new Date().toISOString().slice(0, 10)}`);
  }

  function openBranding() {
    const b: Branding = { ...branding };
    const logoImg = h('img', { class: 'brand-logo-preview', alt: 'Logo' });
    const showLogo = () => {
      logoImg.src = b.logo || '';
      logoImg.hidden = !b.logo;
    };
    showLogo();
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        b.logo = await readLogo(f);
        showLogo();
      } catch (err) {
        toast((err as Error).message);
      }
    });
    const text = (key: Exclude<keyof Branding, 'id' | 'logo'>, type = 'text') => {
      const el = h('input', { class: 'input', type, value: b[key] });
      el.addEventListener('input', () => (b[key] = el.value));
      return el;
    };
    const disclosures = h('textarea', { class: 'input', rows: 8 });
    disclosures.value = b.disclosures;
    disclosures.addEventListener('input', () => (b.disclosures = disclosures.value));
    const importFile = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    importFile.addEventListener('change', async () => {
      const f = importFile.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text()) as Partial<Branding>;
        branding = { ...DEFAULT_BRANDING, ...data, id: 'default' };
        await saveDoc('branding', branding);
        toast('Branding imported');
        close();
        openBranding();
      } catch {
        toast('That file isn’t a branding file');
      }
    });
    const exportBranding = () => {
      const blob = new Blob([JSON.stringify({ ...b, id: undefined }, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'report-branding.json' });
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const body = h(
      'div',
      { class: 'brand-form' },
      h('div', { class: 'brand-logo-row' }, logoImg, h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Logo (PNG with a transparent background works best)'), file)),
      h(
        'div',
        { class: 'field-grid' },
        field('Firm name', text('firmName')),
        field('Report title', text('reportTitle')),
        field('Primary colour', text('primary', 'color')),
        field('Accent colour', text('accent', 'color')),
        field('Address', text('address')),
        field('Phone', text('phone')),
        field('Email', text('email')),
        field('Website', text('website')),
      ),
      field('Disclosures (blank line between paragraphs)', disclosures),
      h('p', { class: 'muted small' }, 'Reports that show performance to clients are regulated (for example the SEC Marketing Rule and your firm’s compliance policies). Have compliance review the disclosures before sending reports.'),
      h(
        'div',
        { class: 'ap-controls' },
        h('button', { class: 'btn', onclick: () => importFile.click() }, 'Import branding file'),
        importFile,
        h('button', { class: 'btn', onclick: exportBranding }, 'Export'),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                branding = await saveDoc('branding', { ...b, id: 'default' });
                toast('Branding saved');
                close();
                if (preview.childElementCount) showPreview();
              } catch (err) {
                toast((err as Error).message);
              }
            },
          },
          'Save branding',
        ),
      ),
    );
    const close = openModal('Report branding', body, { wide: true });
  }

  window.addEventListener('tp:data-changed', () => started && refresh());

  let started = false;
  return {
    el: frame.el,
    /** Opens a client (the command bar). */
    open(id: string) {
      openId = id;
      reviewData = null;
      if (started) void refresh();
    },
    start() {
      if (!started) {
        started = true;
        editor.replaceChildren(h('div', { class: 'muted pad' }, 'Loading…'));
      }
      refresh();
    },
  };
}

/**
 * Advisory fee editor: one rate, or tiers like tax brackets (each rate applies to the part of the account inside
 * its tier), billed monthly / quarterly / yearly, in arrears or in advance. Writes Client.feeSchedule (and keeps
 * Client.fee as the top rate for older parts of the app).
 */
function feeEditor(c: Client): HTMLElement {
  const sch: FeeSchedule = c.feeSchedule
    ? structuredClone(c.feeSchedule)
    : { tiers: [{ upTo: null, rate: c.fee || 0 }], billing: 'quarterly', timing: 'arrears' };
  const box = h('div', { class: 'fee-editor' });
  const save = () => {
    sch.tiers.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    c.feeSchedule = structuredClone(sch);
    c.fee = sch.tiers[0]?.rate ?? 0;
  };
  const draw = () => {
    save();
    const rows = sch.tiers.map((t, i) => {
      const last = i === sch.tiers.length - 1;
      const upTo = h('input', { class: 'input', type: 'number', step: 50000, min: 0, value: t.upTo ?? '', placeholder: 'and above', disabled: last, 'aria-label': 'Tier up to ($)' });
      upTo.addEventListener('change', () => {
        const v = parseFloat(upTo.value);
        t.upTo = Number.isFinite(v) && v > 0 ? v : t.upTo;
        draw();
      });
      const rate = h('input', { class: 'input', type: 'number', step: 0.05, min: 0, max: 5, value: +(t.rate * 100).toFixed(3), 'aria-label': 'Rate (% a year)' });
      rate.addEventListener('input', () => {
        const v = parseFloat(rate.value);
        t.rate = Number.isFinite(v) && v >= 0 ? Math.min(v, 5) / 100 : 0;
        if (Number.isFinite(v) && v > 5) rate.value = '5'; // show the 5% cap instead of silently using it
        save();
        summary.textContent = describeFees(sch);
      });
      const from = i === 0 ? 0 : sch.tiers[i - 1].upTo ?? 0;
      return h(
        'div',
        { class: 'fee-row' },
        h('span', { class: 'muted small' }, sch.tiers.length === 1 ? 'All assets' : i === 0 ? 'First' : `From $${from.toLocaleString('en-US')}`),
        sch.tiers.length > 1 ? h('label', { class: 'fee-cell' }, h('span', { class: 'muted tiny' }, last ? 'Up to' : 'Up to ($)'), upTo) : '',
        h('label', { class: 'fee-cell' }, h('span', { class: 'muted tiny' }, 'Rate (% a year)'), rate),
        sch.tiers.length > 1 ? h('button', { class: 'icon-btn', title: 'Remove this tier', 'aria-label': 'Remove tier', onclick: () => (sch.tiers.splice(i, 1), sch.tiers[sch.tiers.length - 1].upTo = null, draw()) }, '✕') : '',
      );
    });
    const addTier = h('button', {
      class: 'btn small',
      onclick: () => {
        const last = sch.tiers[sch.tiers.length - 1];
        const prev = sch.tiers.length > 1 ? sch.tiers[sch.tiers.length - 2].upTo ?? 0 : 0;
        last.upTo = Math.max(prev * 2, prev + 1_000_000);
        sch.tiers.push({ upTo: null, rate: Math.max(0, last.rate - 0.0025) });
        draw();
      },
    }, '+ Add a tier (breakpoint)');
    const billing = h('select', { class: 'input', 'aria-label': 'Billing frequency' }, ...(['quarterly', 'monthly', 'annual'] as const).map((b) => h('option', { value: b, selected: sch.billing === b }, b[0].toUpperCase() + b.slice(1))));
    billing.addEventListener('change', () => ((sch.billing = billing.value as FeeSchedule['billing']), draw()));
    const timing = h('select', { class: 'input', 'aria-label': 'Billing timing' }, h('option', { value: 'arrears', selected: sch.timing === 'arrears' }, 'In arrears (period-end value)'), h('option', { value: 'advance', selected: sch.timing === 'advance' }, 'In advance (period-start value)'));
    timing.addEventListener('change', () => ((sch.timing = timing.value as FeeSchedule['timing']), draw()));
    summary.textContent = describeFees(sch);
    box.replaceChildren(
      h('div', { class: 'panel-head' }, h('h4', {}, 'Advisory fee'), h('span', { class: 'muted small' }, 'Debited from the account each billing period; the report shows returns before and after fees and the fees paid')),
      ...rows,
      h('div', { class: 'fee-row' }, addTier, h('label', { class: 'fee-cell' }, h('span', { class: 'muted tiny' }, 'Billing'), billing), h('label', { class: 'fee-cell' }, h('span', { class: 'muted tiny' }, 'Timing'), timing)),
      summary,
    );
  };
  const summary = h('p', { class: 'small fee-summary' });
  draw();
  return box;
}
