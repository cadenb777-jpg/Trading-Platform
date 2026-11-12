/**
 * Research → Financials → As reported: any company's statements exactly as its own 10-K / 10-Q lays them out (its lines,
 * its order, its words), with the parts it reports under a line (net sales → products / services) and every note's
 * detail table (Inventories, Debt, Revenue, Segments ...). Read by the helper from the filing's XBRL layout files
 * (engine/asreported.py); nothing is mapped to a template, so nothing the company reports is dropped.
 */
import { engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
import { money } from '../ui/charts';

export const ASREPORTED_HELPER_VERSION = 58;

export interface ArItem {
  role: string;
  title: string;
  kind: 'income' | 'balance' | 'cashflow' | 'equity' | 'details';
  group: 'statement' | 'details';
}
export interface ArRow {
  kind: 'heading' | 'line' | 'total' | 'member';
  label: string;
  depth: number;
  concept: string;
  axis?: string;
  values: (number | null)[];
}
export interface ArColumn {
  start: string | null;
  end: string;
}
export interface AsReported {
  symbol: string;
  company: string;
  form: string;
  filed: string;
  source: string;
  items: ArItem[];
  chosen: ArItem & { columns: ArColumn[]; rows: ArRow[] };
}

const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

/** A column heading (pure, tested): a year or quarter ending on a date, or a balance on a date. */
export function columnLabel(c: ArColumn): string {
  if (!c.start) return day(c.end, { month: 'short', day: 'numeric', year: 'numeric' });
  const days = (Date.parse(c.end) - Date.parse(c.start)) / 86400000;
  const end = day(c.end, { month: 'short', year: 'numeric' });
  return days > 300 ? `Year to ${end}` : days > 150 ? `6 mo to ${end}` : days > 70 && days < 120 ? `Qtr to ${end}` : `To ${end}`;
}

/** A figure (pure, tested): money for amounts, plain for per-share and small numbers such as share counts in a note. */
export function figure(v: number | null, concept: string): string {
  if (v == null || !Number.isFinite(v)) return '';
  if (/PerShare|Percent|Rate|Ratio/i.test(concept)) return Math.abs(v) < 1 && /Percent|Rate|Ratio/i.test(concept) ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);
  if (/Shares|NumberOf/i.test(concept)) return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  return money(v);
}

/** The picker's groups (pure, tested): the main statements, then the notes alphabetically. */
export function pickerGroups(items: ArItem[]) {
  return [
    { label: 'Statements', items: items.filter((i) => i.group === 'statement') },
    { label: 'Note details', items: items.filter((i) => i.group === 'details') },
  ].filter((g) => g.items.length);
}

const chosenRole = new Map<string, string>();

function table(d: AsReported): HTMLElement {
  const { columns, rows } = d.chosen;
  return h(
    'div',
    { class: 'ar-scroll' },
    h(
      'table',
      { class: 'ar-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), ...columns.map((c) => h('th', { scope: 'col', class: 'num' }, columnLabel(c))))),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            { class: `ar-${r.kind}` },
            h(
              'th',
              { scope: 'row', style: `padding-left:${0.5 + r.depth * 1.1}rem`, title: r.axis ? `${r.axis}: ${r.label}` : r.concept },
              r.kind === 'member' ? h('span', { class: 'ar-arrow', 'aria-hidden': 'true' }, '↳ ') : '',
              r.label,
            ),
            ...r.values.map((v) => h('td', { class: `num${v != null && v < 0 ? ' neg' : ''}` }, figure(v, r.concept))),
          ),
        ),
      ),
    ),
  );
}

/** The As reported view for one company; `quarterly` picks the latest 10-Q instead of the 10-K. */
export function asReportedPanel(symbol: string, quarterly: boolean): HTMLElement {
  const body = h('div', { class: 'ar-body' }, h('p', { class: 'muted small' }, `Reading ${symbol}’s latest ${quarterly ? '10-Q' : '10-K'} from the SEC…`));
  const el = h('section', { class: 'panel ar-panel' }, body);
  if ((helper.version ?? 0) < ASREPORTED_HELPER_VERSION) {
    body.replaceChildren(h('p', { class: 'muted small' }, 'As reported arrives with the next helper update (it installs by itself).'));
    return el;
  }
  const key = `${symbol}:${quarterly}`;
  const load = (role?: string) => {
    body.classList.add('ar-loading');
    engineRequest<AsReported>('research.asreported', { symbol, period: quarterly ? 'quarter' : 'annual', ...(role ? { role } : {}) }, 120000).then(
      (d) => {
        chosenRole.set(key, d.chosen.role);
        body.classList.remove('ar-loading');
        const picker = h(
          'select',
          { class: 'ar-pick', 'aria-label': 'Statement or note', onchange: (e: Event) => load((e.target as HTMLSelectElement).value) },
          ...pickerGroups(d.items).map((g) =>
            h('optgroup', { label: g.label }, ...g.items.map((i) => h('option', { value: i.role, selected: i.role === d.chosen.role }, i.title))),
          ),
        );
        body.replaceChildren(
          h('div', { class: 'panel-head' }, h('h3', {}, 'As reported'), picker),
          d.chosen.rows.length ? table(d) : h('p', { class: 'muted small' }, 'This part of the filing has no figures.'),
          h(
            'p',
            { class: 'muted small ar-source' },
            `${d.company} · the company’s own lines and words · ↳ = parts it reports under the line above · `,
            h('a', { href: d.source, target: '_blank', rel: 'noopener' }, `${d.form} filed ${d.filed}`),
          ),
        );
      },
      (err: Error) => {
        body.classList.remove('ar-loading');
        body.replaceChildren(h('p', { class: 'muted small' }, `Couldn’t read the filing: ${err.message}`));
      },
    );
  };
  load(chosenRole.get(key));
  return el;
}
