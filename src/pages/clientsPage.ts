/** Clients: client accounts, report branding, and printable white-label performance reports. */
import { engineRequest } from '../data/schwab';
import { deleteDoc, listDocs, saveDoc } from '../data/store';
import { holdingsPayload, type Analysis, type Portfolio } from '../portfolio/types';
import { buildReport } from '../reports/report';
import '../reports/report.css';
import { DEFAULT_BRANDING, type Branding, type Client } from '../reports/types';
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
  let portfolios: (Portfolio & { id: string })[] = [];
  let branding: Branding = { ...DEFAULT_BRANDING };
  let current: Client = blankClient();
  const list = h('div', { class: 'pf-list' });
  const editor = h('section', { class: 'panel' });
  const preview = h('div', { class: 'ap-body' });
  const frame = pageFrame('Clients & Reports', 'Client accounts and white-label performance reports. Client data is stored by the helper on your computer.', [
    h('button', { class: 'btn', onclick: () => openBranding() }, 'Report branding'),
    h('button', { class: 'btn', onclick: () => batchPrint() }, 'Print all reports'),
  ]);
  frame.body.replaceChildren(h('div', { class: 'pf-layout' }, h('aside', { class: 'panel' }, list), h('div', { class: 'ap-body' }, editor, preview)));

  async function refresh() {
    try {
      [clients, portfolios] = await Promise.all([listDocs<Client>('clients'), listDocs<Portfolio>('portfolios')]);
      const saved = await listDocs<Branding>('branding');
      branding = { ...DEFAULT_BRANDING, ...(saved.find((b) => b.id === 'default') ?? {}) };
    } catch (err) {
      editor.replaceChildren(h('div', { class: 'ap-error' }, `${(err as Error).message}. Start the helper to manage clients.`));
      return;
    }
    if (!current.portfolioId && portfolios[0]) current.portfolioId = portfolios[0].id;
    renderList();
    renderEditor();
  }

  function renderList() {
    list.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => select(blankClient(portfolios[0]?.id)) }, '+ New client'),
      h('div', { class: 'muted small' }, 'Clients'),
      ...(clients.length
        ? clients.map((c) => h('button', { class: c.id === current.id ? 'active' : '', onclick: () => select(structuredClone(c)) }, c.name, c.household ? h('div', { class: 'muted small', style: 'padding:0' }, c.household) : null))
        : [h('div', { class: 'muted small' }, 'No clients yet.')]),
    );
  }

  function select(c: Client) {
    current = c;
    renderList();
    renderEditor();
    preview.replaceChildren();
  }

  function field(label: string, input: HTMLElement, hint?: string) {
    return h('label', { class: 'field', title: hint ?? '' }, h('span', { class: 'muted small' }, label), input);
  }

  function renderEditor() {
    const c = current;
    const text = (key: 'name' | 'household' | 'accountName' | 'benchmark', placeholder = '') => {
      const el = h('input', { class: 'input', value: c[key] ?? '', placeholder });
      el.addEventListener('input', () => (c[key] = el.value));
      return el;
    };
    const pfSelect = h(
      'select',
      { class: 'input' },
      ...(portfolios.length ? portfolios.map((p) => h('option', { value: p.id, selected: p.id === c.portfolioId }, p.name)) : [h('option', { value: '' }, 'Save a portfolio on the Portfolios page first')]),
    );
    pfSelect.addEventListener('change', () => (c.portfolioId = pfSelect.value));
    const inception = h('input', { class: 'input', type: 'date', value: c.inception });
    inception.addEventListener('change', () => (c.inception = inception.value));
    const initial = h('input', { class: 'input', type: 'number', step: 1000, value: c.initialInvestment });
    initial.addEventListener('input', () => (c.initialInvestment = parseFloat(initial.value) || 0));
    const fee = h('input', { class: 'input', type: 'number', step: 0.05, value: +(c.fee * 100).toFixed(3) });
    fee.addEventListener('input', () => (c.fee = (parseFloat(fee.value) || 0) / 100));
    const commentary = h('textarea', { class: 'input', rows: 5, placeholder: 'Optional market and portfolio commentary for this report. Leave a blank line between paragraphs.' });
    commentary.value = c.commentary ?? '';
    commentary.addEventListener('input', () => (c.commentary = commentary.value));
    const history = c.reports?.length ? h('p', { class: 'muted small' }, `Reports generated: ${c.reports.slice(-5).reverse().map((r) => `${r.generated} (as of ${r.asOf})`).join(', ')}`) : '';
    editor.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', {}, 'Client')),
      h(
        'div',
        { class: 'field-grid' },
        field('Client name', text('name')),
        field('Household (optional)', text('household', 'e.g. The Smith Family')),
        field('Account name', text('accountName', 'e.g. Joint Brokerage')),
        field('Portfolio / model', pfSelect, 'The account follows this saved portfolio'),
        field('Account start date', inception, 'Performance is measured from here. Leave blank for a hypothetical long-term history.'),
        field('Initial investment ($)', initial),
        field('Advisory fee (% a year)', fee, 'Returns are shown net of this fee'),
        field('Benchmark (optional)', text('benchmark', 'Uses the portfolio’s benchmark')),
      ),
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
      current = await saveDoc('clients', current);
      toast(`Saved ${current.name}`);
      await refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove() {
    if (!current.id || !confirm(`Delete ${current.name}? Their saved details will be removed from this computer.`)) return;
    await deleteDoc('clients', current.id).catch((err) => toast((err as Error).message));
    current = blankClient(portfolios[0]?.id);
    await refresh();
  }

  async function build(c: Client) {
    const portfolio = portfolios.find((p) => p.id === c.portfolioId);
    if (!portfolio) throw new Error(`${c.name}: choose a saved portfolio for this client.`);
    const analysis = await engineRequest<Analysis>(
      'portfolio.analyze',
      { holdings: holdingsPayload(portfolio), benchmark: c.benchmark?.trim() || portfolio.benchmark, rebalance: portfolio.rebalance, since: c.inception || undefined, fee: c.fee },
      120000,
    );
    return { doc: buildReport({ client: c, portfolio, analysis, branding }), analysis };
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

  let started = false;
  return {
    el: frame.el,
    start() {
      if (!started) {
        started = true;
        editor.replaceChildren(h('div', { class: 'muted pad' }, 'Loading…'));
      }
      refresh();
    },
  };
}

