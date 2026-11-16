/**
 * Prospects → Companies: US private businesses of every industry (restaurants, construction, medical practices...)
 * from the SBA's free loan lists, newest first (7(a)/504 quarterly, PPP 2020-21; helper engine/companies.py), with an estimated revenue range. Filters: industry,
 * state, city, ZIP, employees, revenue, name; sortable; links out to a web search and OpenCorporates for each company.
 */
import { engineRequest, helper } from '../data/schwab';
import { dataTable } from '../ui/charts';
import { h, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { moneyText } from './logic';

export const COMPANIES_HELPER_VERSION = 79;
export interface Company {
  id: string; name: string; address: string; city: string; state: string; zip: string; naics: string; sector: string;
  jobs: number | null; loan: number | null; draws: number; payroll: number | null;
  revenue: { low: number; likely: number; high: number } | null;
  businessType: string; age: string; franchise: string; nonprofit: boolean; approved: string; lender: string; forgiven: number | null;
  sources: string[]; firstSeen: string; lastSeen: string; basis: string;
}
export interface CompaniesStatus {
  count: number; recent?: number; newest?: string | null; problems?: string[]; built: string | null; source: string; method: string;
  byGroup: Record<string, number>; groups: { id: string; label: string }[];
  job: { running: boolean; text: string; error: string; done: number };
}
export interface CompanyQuery {
  text?: string; group?: string; naics?: string; state?: string; city?: string; zip?: string;
  jobsMin?: string; seenSince?: string; revenueMin?: string; revenueMax?: string; franchise?: boolean; noNonprofits?: boolean; sort?: string; offset?: number;
}

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');
const PAGE = 100;
const LS = 'tp.companies.form';

/** "Restaurants · Austin, TX" style line, and the web links for one company (pure, tested). */
export function companyLinks(c: Pick<Company, 'name' | 'city' | 'state'>) {
  const q = encodeURIComponent(`${c.name} ${c.city} ${c.state}`);
  return {
    web: `https://www.google.com/search?q=${q}`,
    opencorporates: `https://opencorporates.com/companies/us_${c.state.toLowerCase()}?q=${encodeURIComponent(c.name)}`,
  };
}

/** The request sent to the helper from the form (numbers like "5m" / "250k" understood). */
export function toQuery(f: CompanyQuery): Record<string, unknown> {
  const money = (v?: string) => {
    const m = String(v ?? '').trim().toLowerCase().replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([kmb]?)$/);
    return m ? Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] ?? 1) : undefined;
  };
  const q: Record<string, unknown> = { sort: f.sort || 'revenue', offset: f.offset ?? 0, limit: PAGE };
  for (const k of ['text', 'group', 'naics', 'state', 'city', 'zip', 'seenSince'] as const) if (f[k]?.trim()) q[k] = f[k]!.trim();
  if (f.jobsMin && Number(f.jobsMin) > 0) q.jobsMin = Number(f.jobsMin);
  if (money(f.revenueMin)) q.revenueMin = money(f.revenueMin);
  if (money(f.revenueMax)) q.revenueMax = money(f.revenueMax);
  if (f.franchise) q.franchise = true;
  if (f.noNonprofits) q.noNonprofits = true;
  return q;
}

function loadForm(): CompanyQuery {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function saveForm(f: CompanyQuery) {
  try {
    localStorage.setItem(LS, JSON.stringify({ ...f, offset: 0 }));
  } catch {
    /* fine */
  }
}

export function createCompaniesView() {
  const el = h('div', { class: 'co-view' });
  const form: CompanyQuery = { noNonprofits: true, ...loadForm(), offset: 0 };
  let status: CompaniesStatus | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const head = h('div', { class: 'co-head' });
  const filters = h('div', { class: 'co-filters' });
  const results = h('div', { class: 'co-results' });

  const input = (key: keyof CompanyQuery, label: string, placeholder = '', width = '') => {
    const i = h('input', { class: 'input', value: String(form[key] ?? ''), placeholder, 'aria-label': label, style: width ? `width:${width}` : '' }) as HTMLInputElement;
    i.addEventListener('input', () => ((form as Record<string, unknown>)[key] = i.value, (form.offset = 0), later()));
    return h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), i);
  };
  const select = (key: 'group' | 'state' | 'sort' | 'seenSince', label: string, options: [string, string][]) => {
    const s = h('select', { class: 'input', 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: v, selected: (form[key] ?? '') === v }, t))) as HTMLSelectElement;
    s.addEventListener('change', () => ((form[key] = s.value), (form.offset = 0), run()));
    return h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), s);
  };
  const check = (key: 'franchise' | 'noNonprofits', label: string) => {
    const c = h('input', { type: 'checkbox', checked: !!form[key] }) as HTMLInputElement;
    c.addEventListener('change', () => ((form[key] = c.checked), (form.offset = 0), run()));
    return h('label', { class: 'co-check small' }, c, ` ${label}`);
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  };

  function drawFilters() {
    const groups = status?.groups ?? [];
    filters.replaceChildren(
      input('text', 'Name or franchise', 'e.g. grill, roofing'),
      select('group', 'Industry', [['', 'All industries'], ...groups.map((g) => [g.id, `${g.label}${status?.byGroup[g.id] ? ` (${status.byGroup[g.id].toLocaleString()})` : ''}`] as [string, string])]),
      input('naics', 'NAICS code', 'e.g. 722511', '110px'),
      select('state', 'State', [['', 'All'], ...STATES.map((s) => [s, s] as [string, string])]),
      input('city', 'City', '', '140px'),
      input('zip', 'ZIP', '', '90px'),
      input('jobsMin', 'Employees from', '', '90px'),
      input('revenueMin', 'Est. revenue from', 'e.g. 5m', '110px'),
      input('revenueMax', 'to', 'e.g. 50m', '110px'),
      select('seenSince', 'Active since', [['', 'Any time'], ...[0, 1, 2, 3].map((k) => { const y = String(new Date().getFullYear() - k); return [y, `${y} or later`] as [string, string]; })]),
      select('sort', 'Sort', [['revenue', 'Estimated revenue'], ['newest', 'Newest activity'], ['jobs', 'Employees'], ['loan', 'Latest loan'], ['name', 'Name A-Z']]),
      h('div', { class: 'co-checks' }, check('noNonprofits', 'Hide nonprofits'), check('franchise', 'Franchises only')),
    );
  }

  function drawHead() {
    const s = status;
    const busy = s?.job.running;
    head.replaceChildren(
      h('p', { class: 'muted small' },
        s?.count
          ? `${s.count.toLocaleString()} private companies${s.recent ? ` (${s.recent.toLocaleString()} active since last year)` : ''} · newest record ${s.newest ?? '—'} · ${s.source}${s.built ? ` · loaded ${s.built.slice(0, 10)}` : ''}. `
          : 'No company list on this computer yet. ',
        infoTip('coRevenue'),
      ),
      busy ? h('p', { class: 'small' }, h('b', {}, s!.job.text || 'Downloading…')) : s?.job.error ? h('p', { class: 'small warn-text' }, `Last download failed: ${s.job.error}`) : '',
      !busy && s?.problems?.length ? h('p', { class: 'small warn-text' }, `Some sources didn’t download last time: ${s.problems.join('; ')}`) : '',
      h('button', { class: `btn small ${s?.count ? 'ghost' : 'primary'}`, disabled: !!busy, onclick: download }, s?.count ? 'Refresh the list' : 'Download the company lists (free SBA data, ~700 MB, 10-20 minutes)'),
    );
  }

  async function download() {
    try {
      await engineRequest('companies.download', {}, 30000);
      toast('Downloading the company list in the background');
      void poll();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function poll() {
    status = await engineRequest<CompaniesStatus>('companies.status', { refresh: 1 }, 30000).catch(() => status);
    drawHead();
    if (status?.job.running) setTimeout(() => void poll(), 3000);
    else if (status?.count) {
      drawFilters();
      void run();
    }
  }

  async function run() {
    saveForm(form);
    if (!status?.count) return;
    results.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
    try {
      const r = await engineRequest<{ total: number; rows: Company[] }>('companies.search', toQuery(form), 30000);
      draw(r);
    } catch (err) {
      results.replaceChildren(h('p', { class: 'muted small' }, `Couldn’t search: ${(err as Error).message}`));
    }
  }

  function draw(r: { total: number; rows: Company[] }) {
    const off = form.offset ?? 0;
    const rows = r.rows.map((c) => {
      const links = companyLinks(c);
      return [
        h('span', {}, h('b', {}, c.name), c.franchise ? h('span', { class: 'badge pr-key-badge', title: 'Franchise' }, c.franchise) : null,
          h('div', { class: 'muted small' }, h('a', { href: links.web, target: '_blank', rel: 'noopener noreferrer' }, 'Web'), ' · ', h('a', { href: links.opencorporates, target: '_blank', rel: 'noopener noreferrer' }, 'OpenCorporates'))),
        { v: c.sector || '—', title: `NAICS ${c.naics}` },
        `${c.city}, ${c.state} ${c.zip}`,
        c.jobs != null ? c.jobs.toLocaleString() : '—',
        c.revenue ? { v: `~${moneyText(c.revenue.likely)}`, title: `Range ${moneyText(c.revenue.low)} – ${moneyText(c.revenue.high)}. Estimate: ${c.basis}` } : '—',
        { v: c.lastSeen || '—', title: `Sources: ${(c.sources ?? []).join(', ')} · ${c.draws} loan${c.draws > 1 ? 's' : ''} since ${c.firstSeen}${c.lender ? ` · latest lender ${c.lender}` : ''}` },
        { v: moneyText(c.loan, '—'), title: `Latest loan${c.approved ? `, approved ${c.approved}` : ''}` },
        c.businessType || '—',
      ];
    });
    results.replaceChildren(
      h('p', { class: 'muted small' }, `${r.total.toLocaleString()} companies${r.total > PAGE ? ` · showing ${off + 1}–${Math.min(off + PAGE, r.total)}` : ''}. Employees come from each company’s newest loan record (see Last seen).`),
      rows.length ? dataTable(['Company', 'Industry', 'Location', 'Employees', 'Est. revenue / yr', 'Last seen', 'Loan', 'Type'], rows, undefined, { id: 'prospect:companies' }) : h('p', { class: 'muted small' }, 'No company matches these filters. Try a wider area or a lower revenue.'),
      r.total > PAGE
        ? h('div', { class: 'co-pager' },
            h('button', { class: 'btn small ghost', disabled: off === 0, onclick: () => ((form.offset = Math.max(0, off - PAGE)), run()) }, 'Previous'),
            h('button', { class: 'btn small ghost', disabled: off + PAGE >= r.total, onclick: () => ((form.offset = off + PAGE), run()) }, 'Next'))
        : '',
    );
  }

  function show() {
    if ((helper.version ?? 0) < COMPANIES_HELPER_VERSION) {
      el.replaceChildren(h('p', { class: 'muted' }, 'The company finder arrives with the next helper update.'));
      return;
    }
    if (!el.childElementCount) el.append(h('section', { class: 'panel' }, head, filters), results);
    void poll();
  }
  return { el, show };
}
