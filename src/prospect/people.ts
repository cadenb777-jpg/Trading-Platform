/**
 * Prospects → firm detail → People: everyone the filings name (Form ADV owners and officers, 13F signers, Form D
 * related persons) plus every registered adviser at the firm from IAPD (helper prospect.individuals, read when the firm
 * is opened, kept a week), sorted into levels so the mid-level people (portfolio managers, advisers, vice presidents)
 * are as easy to find as the owners. Level chips and a name/title search filter the table.
 */
import { clearEngineCache, engineRequest, helper } from '../data/schwab';
import type { ProspectProfile } from '../data/prospect';
import { dataTable } from '../ui/charts';
import { h } from '../ui/dom';
import { dateText } from './logic';

export const INDIVIDUALS_HELPER_VERSION = 77;
export type Person = ProspectProfile['people'][number];
export type Level = 'exec' | 'senior' | 'mid' | 'staff' | 'unknown';
export const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'exec', label: 'Owners & executives', hint: 'Owners, founders, partners, C-suite, presidents, principals' },
  { id: 'senior', label: 'Senior', hint: 'Managing directors, senior and executive vice presidents, heads of, directors' },
  { id: 'mid', label: 'Mid-level', hint: 'Vice presidents, portfolio managers, wealth and investment advisers, managers' },
  { id: 'staff', label: 'Staff', hint: 'Analysts, associates, assistants, registered representatives' },
  { id: 'unknown', label: 'No title', hint: 'Named in a filing without a title' },
];
export const IAPD_SOURCE = 'IAPD registered individuals';

const EXEC = /\b(owner|founder|co-?founder|chair(man|woman|person)?|ceo|cfo|coo|cio|cco|cto|chief|(?<!vice[\s-])president|principal|managing (member|partner)|general partner|executive director|trustee|sole member)\b/i;
const SENIOR = /\b(managing director|md|senior vice president|svp|executive vice president|evp|head of|director|partner|senior portfolio manager|senior managing)\b/i;
const MID = /\b(vice president|vp|avp|portfolio manager|adviser representative|advisor|adviser|wealth|relationship manager|manager|planner|trader|strategist|economist|counsel|controller|senior (analyst|associate))\b/i;
const STAFF = /\b(analyst|associate|assistant|coordinator|specialist|representative|administrator|intern|operations|client service|paraplanner)\b/i;

/** The level of a person from their title (pure, tested). Owners/officers lists without a usable title count as
 * executives; a registered adviser with no title is mid-level. */
export function seniority(title: string | null | undefined, source = ''): Level {
  const t = (title ?? '').replace(/\(.*\)/, ' ');
  if (/\bvice president\b/i.test(t) && !/\b(senior|executive|evp|svp)\b/i.test(t)) return 'mid';
  if (EXEC.test(t)) return 'exec';
  if (SENIOR.test(t)) return 'senior';
  if (MID.test(t)) return 'mid';
  if (STAFF.test(t)) return 'staff';
  if (/ADV Schedule|Form ADV PDF/i.test(source)) return 'exec';
  return 'unknown';
}

/** "JANE Q DOE" -> "Jane Q Doe" (IAPD names are upper case); mixed-case names are kept. */
export function displayName(name: string) {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : name;
}

const tokens = (name: string) => new Set(name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1));

/** Filing people first; an IAPD row is dropped when a filing already names the same person (2+ name words shared). */
export function mergePeople(people: Person[]): Person[] {
  const named = people.filter((p) => p.source !== IAPD_SOURCE).map((p) => tokens(p.name));
  return people.filter((p) => {
    if (p.source !== IAPD_SOURCE) return true;
    const t = tokens(p.name);
    return !named.some((n) => [...t].filter((w) => n.has(w)).length >= 2);
  });
}

export function levelCounts(people: Person[]) {
  const out: Record<Level, number> = { exec: 0, senior: 0, mid: 0, staff: 0, unknown: 0 };
  for (const p of people) out[seniority(p.title, p.source)]++;
  return out;
}

/** The People table with level chips, search and the IAPD read; `onEmpty` text is shown when nobody is known. */
export function peopleBody(p: ProspectProfile, onEmpty: () => Node, srcText: string): HTMLElement {
  let all = mergePeople(p.people);
  let level: Level | 'all' = 'all';
  let query = '';
  const chips = h('div', { class: 'chip-row pr-levels', role: 'group', 'aria-label': 'Filter people by level' });
  const search = h('input', { class: 'input pr-team-search', type: 'search', placeholder: 'Name or title', 'aria-label': 'Search people' }) as HTMLInputElement;
  const table = h('div', {});
  const status = h('p', { class: 'pr-src' });
  const draw = () => {
    const counts = levelCounts(all);
    const chip = (id: Level | 'all', label: string, n: number, hint = '') =>
      h('button', { class: `chip${level === id ? ' on' : ''}`, 'aria-pressed': String(level === id), title: hint, disabled: id !== 'all' && !n, onclick: () => ((level = id), draw()) }, `${label} `, h('span', { class: 'muted' }, String(n)));
    chips.replaceChildren(chip('all', 'Everyone', all.length), ...LEVELS.filter((l) => l.id !== 'unknown' || counts.unknown).map((l) => chip(l.id, l.label, counts[l.id], l.hint)));
    const q = query.trim().toLowerCase();
    const rows = all.filter((x) => (level === 'all' || seniority(x.title, x.source) === level) && (!q || `${x.name} ${x.title}`.toLowerCase().includes(q)));
    table.replaceChildren(
      rows.length
        ? dataTable(
            ['Name', 'Title', 'Level', 'Source', 'Filed'],
            rows.map((x) => [
              h('span', {}, displayName(x.name), x.keyTitle ? h('span', { class: 'badge accent pr-key-badge', title: 'CIO or portfolio manager title' }, 'Investment lead') : null),
              x.title || '—',
              LEVELS.find((l) => l.id === seniority(x.title, x.source))!.label,
              /^https:\/\//.test(x.sourceRef ?? '') ? h('a', { href: x.sourceRef, target: '_blank', rel: 'noopener noreferrer' }, x.source) : x.source,
              x.filed ? dateText(x.filed, true) : '—',
            ]),
            (i) => (rows[i].keyTitle ? 'pr-key' : ''),
            { id: 'prospect:people' },
          )
        : all.length
          ? h('p', { class: 'muted small' }, 'Nobody matches this filter.')
          : onEmpty(),
    );
  };
  search.addEventListener('input', () => ((query = search.value), draw()));
  draw();
  const iapdCount = () => all.filter((x) => x.source === IAPD_SOURCE).length;
  const note = () => `${srcText} Registered advisers come from IAPD (the SEC adviser site, read when you open the firm, refreshed weekly; ${iapdCount()} not already named in filings). Names and titles only: filings carry no emails or direct lines.`;
  status.textContent = note();
  if (p.crd && (helper.version ?? 0) >= INDIVIDUALS_HELPER_VERSION) {
    status.textContent = `${note()} Reading the firm’s registered advisers from IAPD…`;
    engineRequest<{ people: Person[]; total: number | null }>('prospect.individuals', { firmId: p.id }, 120000).then(
      (r) => {
        const fresh = r.people.map((x) => ({ ...x, keyTitle: false, filed: '', ownership: '' }));
        all = mergePeople([...p.people.filter((x) => x.source !== IAPD_SOURCE), ...fresh]);
        clearEngineCache('prospect.firm');
        draw();
        status.textContent = note() + (r.total != null && r.total > 500 ? ` IAPD lists ${r.total} people for this firm; the first 500 were read.` : '');
      },
      (err: Error) => (status.textContent = `${note()} Couldn’t read IAPD: ${err.message}`),
    );
  } else if (p.crd) status.textContent = `${note()} The registered advisers list arrives with the next helper update (it installs by itself).`;
  return h('div', { class: 'pr-team' }, h('div', { class: 'pr-team-bar' }, chips, search), table, status);
}
