/**
 * Prospecting (#prospect): an in-house FINTRX-style database of RIAs, exempt advisers, family offices and 13F
 * managers built by the helper from free SEC data (helper/engine/prospect.py). Search with filters and a radius,
 * a map for geofencing, a firm profile drawer, compare 2-5 firms, and a Data panel for downloads and freshness.
 * Saved searches and notes / outreach status are stored by the helper (store collections prospect_searches and
 * prospect_notes), never in the browser. Modes: #prospect (search), #prospect/map, #prospect/compare,
 * #prospect/data, #prospect/firm/<id>.
 */
import { clearEngineCache } from '../data/schwab';
import {
  prospectExport,
  prospectGeocode,
  prospectIngest,
  prospectSearch,
  prospectStatus,
  type FirmType,
  type ProspectFirm,
  type ProspectNote,
  type ProspectQuery,
  type ProspectSource,
  type ProspectStatus,
} from '../data/prospect';
import { deleteDoc, listDocs, saveDoc } from '../data/store';
import { pageFrame } from '../ui/charts';
import { activatable, h, openModal, openPopover, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openSettings } from '../ui/settings';
import { tableTools } from '../ui/tableTools';
import { renderCompare, saveText } from '../prospect/compare';
import { loadProfile, typeBadge, type ProfileContext } from '../prospect/profile';
import {
  CLIENT_FILTERS,
  CLIENT_LABELS,
  countText,
  dateText,
  describeForm,
  emptyForm,
  FIRST_DOWNLOAD_SIZE,
  formToQuery,
  headerSummary,
  lastFiling,
  MAIN_TYPES,
  moneyText,
  MORE_TYPES,
  parseMiles,
  parsePlace,
  parseRadiusPhrase,
  quarterText,
  RESULT_COLUMNS,
  SOURCE_INFO,
  sourceFreshness,
  TYPE_SHORT,
  activeFilterCount,
  type SearchForm,
  type SortKey,
} from '../prospect/logic';

type Mode = 'search' | 'map' | 'compare' | 'data';
const MODES: { id: Mode; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'map', label: 'Map' },
  { id: 'compare', label: 'Compare' },
  { id: 'data', label: 'Data' },
];
const SORTS: { id: SortKey | ''; label: string }[] = [
  { id: '', label: 'Best fit (AUM)' },
  { id: 'aum', label: 'AUM, largest first' },
  { id: 'value13f', label: '13F value' },
  { id: 'clients', label: 'Most clients' },
  { id: 'funds', label: 'Private fund assets' },
  { id: 'filed', label: 'Latest filing' },
  { id: 'name', label: 'Name A-Z' },
  { id: 'distance', label: 'Distance (radius)' },
  { id: 'position', label: 'Position size (holds)' },
];
const PAGE = 100;
const NUM_COLS = new Set(['aum', 'clients', 'value13f', 'employees', 'funds']);
const MAP_LIMIT = 2000;
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');

// per-viewer conveniences (safe to lose): the last form, chosen columns, the compare list
const LS = { form: 'tp.prospect.form', cols: 'tp.prospect.cols', compare: 'tp.prospect.compare' };
function load<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function keep(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window: fine for this visit */
  }
}

/** "1.2 GB on disk", "35 MB on disk", "under 1 MB on disk", "empty". */
function sizeText(status: ProspectStatus | null) {
  const mb = status?.sizeMb ?? 0;
  if (!(status?.counts?.firms ?? 0) && mb < 1) return 'empty';
  return `${mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : mb >= 1 ? `${Math.round(mb)} MB` : 'under 1 MB'} on disk`;
}

interface SavedSearch {
  id: string;
  name: string;
  form: SearchForm;
}

export function createProspectPage() {
  let mode: Mode = 'search';
  const form: SearchForm = { ...emptyForm(), ...load<Partial<SearchForm>>(LS.form, {}) };
  let status: ProspectStatus | null = null;
  let statusError = '';
  let results: { total: number; rows: ProspectFirm[]; note?: string; query: ProspectQuery } | null = null;
  let searching = 0;
  let centrePoint: { lat: number; lon: number; label: string } | null = null;
  const notes = new Map<string, ProspectNote>();
  let saved: SavedSearch[] = [];
  const compare: { id: string; name: string }[] = load(LS.compare, []);
  const columns: Record<string, boolean> = { ...Object.fromEntries(RESULT_COLUMNS.map((c) => [c.key, c.on])), ...load<Record<string, boolean>>(LS.cols, {}) };
  const ingesting = new Map<string, string>(); // source -> live progress line
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  // ---------- frame ----------
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Prospecting views' });
  const frame = pageFrame('Prospecting', 'RIAs, exempt advisers and family offices from free SEC filings (Form ADV, 13F, Form D). Every fact shows its source and date; family-office labels are educated guesses, never certain.', [tabs]);
  frame.el.classList.add('pr-page');
  const strip = h('div', { class: 'pr-strip', 'aria-label': 'Data freshness' });
  const views: Record<Mode, HTMLElement> = { search: h('div', { class: 'pr-view' }), map: h('div', { class: 'pr-view' }), compare: h('div', { class: 'pr-view' }), data: h('div', { class: 'pr-view' }) };
  frame.body.replaceChildren(strip, ...Object.values(views));

  // ---------- profile drawer ----------
  const drawerBody = h('div', { class: 'pr-drawer-body' });
  const drawerClose = h('button', { class: 'icon-btn', 'aria-label': 'Close profile', title: 'Close (Esc)' }, '✕');
  const drawer = h('aside', { class: 'pr-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Firm profile', hidden: true }, h('div', { class: 'pr-drawer-bar' }, h('span', { class: 'muted small' }, 'Firm profile'), drawerClose), drawerBody);
  const scrim = h('div', { class: 'pr-scrim', hidden: true });
  frame.el.append(scrim, drawer);
  let drawerReturn: HTMLElement | null = null;
  const closeDrawer = () => {
    if (drawer.hidden) return;
    drawer.hidden = scrim.hidden = true;
    if (location.hash.startsWith('#prospect/firm/')) history.replaceState(null, '', mode === 'search' ? '#prospect' : `#prospect/${mode}`);
    drawerReturn?.focus();
  };
  drawerClose.onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .popover')) (e.stopPropagation(), closeDrawer());
    else if (e.key === 'Tab') {
      // keep Tab inside the profile while it is open (it is a modal dialog)
      const items = [...drawer.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !drawer.contains(at))) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && (at === last || !drawer.contains(at))) (e.preventDefault(), first.focus());
    }
  });
  // focus that lands on the page behind the open profile comes back to it (other windows, like the AI or the
  // command bar, sit outside the page and keep their focus)
  frame.el.addEventListener('focusin', (e) => {
    if (drawer.hidden || drawer.contains(e.target as Node)) return;
    drawerClose.focus();
  });
  const profileCtx: ProfileContext = {
    inCompare: (id) => compare.some((c) => c.id === id),
    toggleCompare: (id, name) => toggleCompare(id, name),
    note: (id) => notes.get(id) ?? null,
    saveNote: async (note) => {
      const doc = await saveDoc<ProspectNote>('prospect_notes', note);
      notes.set(note.id, doc);
      refreshOutreachCells();
    },
    get peopleNote() {
      return status?.peopleNote ?? null;
    },
  };
  function openFirm(id: string) {
    drawerReturn = document.activeElement instanceof HTMLElement && !drawer.contains(document.activeElement) ? document.activeElement : null;
    drawer.hidden = scrim.hidden = false;
    history.replaceState(null, '', `#prospect/firm/${encodeURIComponent(id)}`);
    loadProfile(drawerBody, id, profileCtx);
  }

  // ---------- tabs ----------
  function drawTabs() {
    tabs.replaceChildren(
      ...MODES.map((m) =>
        h(
          'button',
          { class: `tab${m.id === mode ? ' active' : ''}`, role: 'tab', 'aria-selected': String(m.id === mode), onclick: () => setMode(m.id, true) },
          m.label,
          m.id === 'compare' && compare.length ? h('span', { class: 'badge accent pr-tab-count' }, String(compare.length)) : null,
          m.id === 'data' && status?.job?.running ? h('span', { class: 'badge warn pr-tab-count' }, '…') : null,
        ),
      ),
    );
  }
  function setMode(next: Mode, push = false) {
    mode = next;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== mode;
    if (push) history.replaceState(null, '', mode === 'search' ? '#prospect' : `#prospect/${mode}`);
    drawTabs();
    if (mode === 'map') showMap();
    if (mode === 'compare') drawCompare();
    if (mode === 'data') drawData();
  }

  // ---------- freshness strip ----------
  function drawStrip() {
    if (statusError) {
      strip.replaceChildren(h('span', { class: 'ap-error pr-strip-err' }, statusError));
      return;
    }
    if (!status) {
      strip.replaceChildren(h('span', { class: 'muted small' }, 'Checking the prospect database…'));
      return;
    }
    const chip = (key: string, label: string) => {
      const f = sourceFreshness(status, key);
      return h('button', { type: 'button', class: `pr-fresh ${f.state}`, title: `${label}: ${f.text}`, onclick: () => setMode('data', true) }, h('i', { 'aria-hidden': 'true' }), h('b', {}, label), ' ', f.state === 'missing' ? 'not downloaded' : f.state === 'running' ? 'downloading…' : f.date ? (key === '13f' ? `to ${dateText(f.date)}` : dateText(f.date)) : 'loaded', f.state === 'due' ? ' · refresh due' : '');
    };
    strip.replaceChildren(
      chip('adv', 'ADV list'),
      chip('adv_full', 'People & funds'),
      chip('13f', '13F'),
      chip('formd', 'Form D'),
      h('span', { class: 'muted small' }, `${countText(status.counts.firms ?? 0)} firms · ${sizeText(status)}`),
    );
  }

  async function refreshStatus() {
    try {
      status = await prospectStatus();
      statusError = '';
    } catch (err) {
      statusError = (err as Error).message;
    }
    drawStrip();
    drawTabs();
    if (mode === 'data') drawData();
    const running = !!status?.job?.running;
    if (running && !pollTimer) pollTimer = setInterval(() => (clearEngineCache('prospect.status'), refreshStatus()), 3000);
    if (!running && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
      clearEngineCache('prospect.');
      if (results) runSearch();
    }
  }

  // ---------- search form ----------
  const input = (key: 'text' | 'city' | 'zip' | 'miles' | 'near' | 'aumMin' | 'aumMax' | 'holds' | 'minPosition', label: string, attrs: Record<string, string> = {}) => {
    const el = h('input', { class: 'input', type: 'text', value: form[key], 'aria-label': label, ...attrs });
    el.addEventListener('input', () => (form[key] = el.value));
    el.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), runSearch()));
    return el;
  };
  const field = (label: string | Node, ...controls: Node[]) => h('label', { class: 'field pr-field' }, h('span', { class: 'muted small' }, label), ...controls);
  const chipToggle = (label: string, on: () => boolean, flip: () => void, title?: string) => {
    const b = h('button', { type: 'button', class: `chip${on() ? ' on' : ''}`, 'aria-pressed': String(on()), title: title ?? '' }, label);
    b.onclick = () => {
      flip();
      b.classList.toggle('on', on());
      b.setAttribute('aria-pressed', String(on()));
      updateFilterCount();
    };
    return b;
  };
  const typeChip = (t: FirmType) => chipToggle(TYPE_SHORT[t], () => form.types.includes(t), () => (form.types = form.types.includes(t) ? form.types.filter((x) => x !== t) : [...form.types, t]), t);
  const stateSel = h('select', { class: 'input', 'aria-label': 'State' }, h('option', { value: '' }, 'Any state'), ...STATES.map((s) => h('option', { value: s, selected: form.state === s }, s)));
  stateSel.onchange = () => (form.state = stateSel.value);
  const sortSel = h('select', { class: 'input', 'aria-label': 'Sort' }, ...SORTS.map((s) => h('option', { value: s.id, selected: form.sort === s.id }, s.label)));
  sortSel.onchange = () => ((form.sort = sortSel.value as SortKey | ''), runSearch());
  const box13f = h('input', { type: 'checkbox', checked: form.has13f });
  box13f.onchange = () => ((form.has13f = box13f.checked), updateFilterCount());
  const boxFunds = h('input', { type: 'checkbox', checked: form.hasPrivateFunds });
  boxFunds.onchange = () => ((form.hasPrivateFunds = boxFunds.checked), updateFilterCount());
  const textBox = input('text', 'Name, person, CRD or CIK', { placeholder: 'Firm, person, CRD or CIK  (or "25 miles of 10022")', type: 'search' });
  const milesBox = input('miles', 'Radius in miles', { placeholder: '25', inputmode: 'decimal' });
  const nearBox = input('near', 'Centre: ZIP, address or lat, lon', { placeholder: 'ZIP or street address' });
  const savedSel = h('select', { class: 'input', 'aria-label': 'Saved searches' });
  const filterCount = h('span', { class: 'badge accent', hidden: true });
  const filtersToggle = h('button', { type: 'button', class: 'btn small pr-filters-toggle', 'aria-expanded': 'false' }, 'Search filters ', filterCount);
  const filters = h(
    'form',
    { class: 'panel pr-filters', 'aria-label': 'Search filters', onsubmit: (e: Event) => (e.preventDefault(), runSearch()) },
    field('Search', textBox),
    h('div', { class: 'pr-field' }, h('span', { class: 'muted small' }, 'Type ', infoTip('prConfidence')), h('div', { class: 'chip-row pr-chips' }, ...MAIN_TYPES.map(typeChip), ...MORE_TYPES.map(typeChip))),
    h('div', { class: 'pr-row2' }, field('State', stateSel), field('City', input('city', 'City'))),
    h('div', { class: 'pr-row2' }, field('ZIP starts with', input('zip', 'ZIP code', { inputmode: 'numeric' })), field('Sort', sortSel)),
    h('fieldset', { class: 'pr-fieldset' }, h('legend', { class: 'muted small' }, 'Within a radius ', infoTip('prRadius')), h('div', { class: 'pr-radius-row' }, milesBox, h('span', { class: 'muted small' }, 'miles of'), nearBox)),
    h('div', { class: 'pr-row2' }, field(h('span', {}, 'AUM from ', infoTip('prAum')), input('aumMin', 'AUM minimum', { placeholder: 'e.g. 100m' })), field('AUM up to', input('aumMax', 'AUM maximum', { placeholder: 'e.g. 5b' }))),
    h('div', { class: 'pr-field' }, h('span', { class: 'muted small' }, 'Serves (Form ADV client types)'), h('div', { class: 'chip-row pr-chips' }, ...CLIENT_FILTERS.map((c) => chipToggle(c === 'hnw' ? 'High net worth' : CLIENT_LABELS[c], () => form.clientTypes.includes(c), () => (form.clientTypes = form.clientTypes.includes(c) ? form.clientTypes.filter((x) => x !== c) : [...form.clientTypes, c]))))),
    h('div', { class: 'pr-checks' }, h('label', {}, box13f, ' Files 13F'), h('label', {}, boxFunds, ' Has private funds')),
    h('div', { class: 'pr-row2' }, field(h('span', {}, 'Holds (13F) ', infoTip('pr13f')), input('holds', 'Holds ticker or CUSIP', { placeholder: 'AAPL or CUSIP' })), field('Min position', input('minPosition', 'Minimum position', { placeholder: 'e.g. 1m' }))),
    h('div', { class: 'pr-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Search'), h('button', { type: 'button', class: 'btn ghost', onclick: () => resetForm() }, 'Reset')),
    h('div', { class: 'pr-saved' }, field('Saved searches', savedSel), h('div', { class: 'pr-inline' }, h('button', { type: 'button', class: 'btn small', onclick: () => saveSearch() }, 'Save this search'), h('button', { type: 'button', class: 'btn small ghost', onclick: () => deleteSaved() }, 'Delete'))),
  );
  filtersToggle.onclick = () => {
    const open = filters.classList.toggle('open');
    filtersToggle.setAttribute('aria-expanded', String(open));
  };
  function updateFilterCount() {
    const n = activeFilterCount(form);
    filterCount.hidden = !n;
    filterCount.textContent = String(n);
  }
  function resetForm() {
    Object.assign(form, emptyForm());
    rebuildFilters();
    runSearch();
  }
  /** Puts the form object back into the controls (after a preset, a saved search or reset). */
  function rebuildFilters() {
    for (const [el, key] of [[textBox, 'text'], [milesBox, 'miles'], [nearBox, 'near']] as const) el.value = form[key];
    filters.querySelectorAll<HTMLInputElement>('input[type=text], input[type=search]').forEach((el) => {
      const k = ({ City: 'city', 'ZIP code': 'zip', 'AUM minimum': 'aumMin', 'AUM maximum': 'aumMax', 'Holds ticker or CUSIP': 'holds', 'Minimum position': 'minPosition' } as Record<string, keyof SearchForm>)[el.getAttribute('aria-label') ?? ''];
      if (k) el.value = String(form[k]);
    });
    stateSel.value = form.state;
    sortSel.value = form.sort;
    box13f.checked = form.has13f;
    boxFunds.checked = form.hasPrivateFunds;
    filters.querySelectorAll<HTMLButtonElement>('.pr-chips .chip').forEach((b) => {
      const label = b.textContent ?? '';
      const type = (Object.keys(TYPE_SHORT) as FirmType[]).find((t) => TYPE_SHORT[t] === label);
      const client = CLIENT_FILTERS.find((c) => (c === 'hnw' ? 'High net worth' : CLIENT_LABELS[c]) === label);
      const on = type ? form.types.includes(type) : client ? form.clientTypes.includes(client) : false;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    updateFilterCount();
  }

  async function loadSaved() {
    try {
      saved = await listDocs<SavedSearch>('prospect_searches');
    } catch {
      saved = [];
    }
    savedSel.replaceChildren(h('option', { value: '' }, saved.length ? `Choose (${saved.length})…` : 'None saved yet'), ...saved.map((s) => h('option', { value: s.id }, s.name)));
  }
  savedSel.onchange = () => {
    const s = saved.find((x) => x.id === savedSel.value);
    if (!s) return;
    Object.assign(form, emptyForm(), s.form);
    rebuildFilters();
    runSearch();
  };
  function saveSearch() {
    const name = h('input', { class: 'input', type: 'text', value: describeForm(form).slice(0, 80), 'aria-label': 'Name for this search' });
    const close = openModal(
      'Save this search',
      h(
        'form',
        {
          class: 'pr-save-form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            try {
              const doc = await saveDoc<SavedSearch>('prospect_searches', { id: saved.find((s) => s.name === name.value.trim())?.id, name: name.value.trim() || 'Search', form: { ...form } } as SavedSearch);
              await loadSaved();
              savedSel.value = doc.id;
              toast('Search saved (by the helper, on your computer)');
              close();
            } catch (err) {
              toast(`Couldn't save: ${(err as Error).message}`);
            }
          },
        },
        h('p', { class: 'muted small' }, 'Saved by the helper on your computer, so it is there in any browser.'),
        name,
        h('div', { class: 'pr-inline' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save')),
      ),
    );
  }
  async function deleteSaved() {
    const s = saved.find((x) => x.id === savedSel.value);
    if (!s) return toast('Choose a saved search first');
    await deleteDoc('prospect_searches', s.id).catch((err) => toast((err as Error).message));
    await loadSaved();
  }

  // ---------- results ----------
  const resultHead = h('div', { class: 'panel-head pr-res-head' });
  const resultBody = h('div', { class: 'pr-res-body' });
  const results$ = h('section', { class: 'panel pr-results', 'aria-label': 'Results' }, resultHead, resultBody);
  views.search.append(h('div', { class: 'pr-search' }, h('div', { class: 'pr-filter-col' }, filtersToggle, filters), results$));

  /** Resolves the radius centre (geocoding a street address through the helper) and builds the request. */
  async function buildQuery(): Promise<{ query: ProspectQuery; problems: string[] }> {
    const phrase = parseRadiusPhrase(form.text);
    if (phrase && !form.near.trim()) {
      // "25 miles of 10022" typed in the search box: move it to the radius fields
      form.miles = String(phrase.miles);
      form.near = phrase.place.kind === 'zip' ? phrase.place.zip : phrase.place.kind === 'address' ? phrase.place.address : `${phrase.place.lat}, ${phrase.place.lon}`;
      form.text = '';
      rebuildFilters();
    }
    const place = parsePlace(form.near);
    let point: { lat: number; lon: number } | null = null;
    if (place?.kind === 'address') {
      if (centrePoint?.label === form.near.trim()) point = centrePoint;
      else {
        try {
          const g = await prospectGeocode(form.near.trim());
          centrePoint = { lat: g.lat, lon: g.lon, label: form.near.trim() };
          point = centrePoint;
          toast(`Found: ${g.label}`);
        } catch (err) {
          return { query: formToQuery(form).query, problems: [(err as Error).message] };
        }
      }
    }
    return formToQuery(form, point);
  }

  async function runSearch(more = false) {
    const mine = ++searching;
    // "Load more" continues the search on screen, even if the form was edited since (a new search needs Search)
    const prev = more ? results : null;
    if (!prev) keep(LS.form, form);
    const { query, problems } = prev ? { query: prev.query, problems: [] as string[] } : await buildQuery();
    if (mine !== searching) return;
    if (!more) resultBody.replaceChildren(h('div', { class: 'skeleton', style: 'height:280px' }));
    resultHead.replaceChildren(h('h3', {}, 'Searching…'));
    try {
      const offset = more && results ? results.rows.length : 0;
      const r = await prospectSearch({ ...query, limit: PAGE, offset });
      if (mine !== searching) return;
      results = { total: r.total, rows: more && results ? [...results.rows, ...r.rows] : r.rows, note: r.note, query };
      drawResults(problems);
      if (mode === 'map') showMap();
    } catch (err) {
      if (mine !== searching) return;
      resultHead.replaceChildren(h('h3', {}, 'Results'));
      resultBody.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    }
  }

  function outreachCell(id: string) {
    const n = notes.get(id);
    return h('td', { 'data-col': 'outreach', 'data-value': n?.status ?? '' }, n && n.status !== 'not contacted' ? h('span', { class: `badge ${n.status === 'client' ? 'up' : n.status === 'do not contact' ? 'down' : 'accent'}` }, n.status) : '');
  }
  function refreshOutreachCells() {
    resultBody.querySelectorAll<HTMLTableRowElement>('tbody tr[data-firm]').forEach((tr) => {
      const old = tr.querySelector('td[data-col=outreach]');
      if (old) old.replaceWith(outreachCell(tr.dataset.firm!));
    });
  }

  function cell(key: string, f: ProspectFirm): HTMLTableCellElement {
    const td = (value: Node | string, sortValue?: string | number | null, cls = '') => h('td', { 'data-col': key, class: cls, ...(sortValue != null ? { 'data-value': String(sortValue) } : {}) }, value);
    switch (key) {
      case 'type':
        return td(typeBadge(f.type, f.confidence, false), TYPE_SHORT[f.type]);
      case 'place':
        return td([f.city, f.state].filter(Boolean).join(', ') || '—', undefined);
      case 'aum':
        return td(f.aumTotal != null ? moneyText(f.aumTotal) : '—', f.aumTotal ?? '', 'num');
      case 'clients':
        return td(countText(f.clientsTotal), f.clientsTotal ?? '', 'num');
      case 'people':
        return td(
          f.topPeople?.length ? h('span', { class: 'pr-people' }, ...f.topPeople.map((p) => h('span', { class: p.keyTitle ? 'pr-key-title' : '', title: `${p.name}, ${p.title || 'no title'} (${p.source})` }, p.title || p.name))) : h('span', { class: 'muted small' }, 'None in filings'),
          f.topPeople?.map((p) => `${p.title} ${p.name}`).join('; ') ?? '',
        );
      case 'value13f':
        return td(f.value13f != null ? h('span', {}, moneyText(f.value13f), h('span', { class: 'muted small' }, ` ${quarterText(f.period13f)}`)) : '—', f.value13f ?? '', 'num');
      case 'filed':
        return td(lastFiling(f) || '—', lastFiling(f));
      case 'employees':
        return td(countText(f.employees), f.employees ?? '', 'num');
      case 'funds':
        return td(f.funds ? `${f.funds} · ${moneyText(f.fundsGav, 'GAV n/r')}` : '—', f.fundsGav ?? (f.funds || ''), 'num');
      case 'crd':
        return td([f.crd ? `CRD ${f.crd}` : '', f.cik ? `CIK ${f.cik}` : ''].filter(Boolean).join(' · ') || '—');
      case 'phone':
        return td(f.phone || '—');
      case 'website':
        return td(f.website ? h('a', { href: /^https?:/i.test(f.website) ? f.website : `https://${f.website}`, target: '_blank', rel: 'noopener' }, f.website.replace(/^https?:\/\//i, '')) : '—');
      case 'outreach':
        return outreachCell(f.id);
      default:
        return td('');
    }
  }

  function drawResults(problems: string[] = []) {
    if (!results) return;
    const r = results;
    const extra = [r.query.near ? { key: 'distance', label: 'Miles' } : null, r.query.holds ? { key: 'position', label: 'Position' } : null].filter(Boolean) as { key: string; label: string }[];
    const cols = RESULT_COLUMNS.filter((c) => columns[c.key]);
    const colBtn = h('button', { class: 'btn small', 'aria-haspopup': 'dialog' }, 'Columns ▾');
    colBtn.onclick = () => {
      const list = h(
        'div',
        { class: 'pr-col-list' },
        ...RESULT_COLUMNS.map((c) => {
          const box = h('input', { type: 'checkbox', checked: columns[c.key] });
          box.onchange = () => {
            columns[c.key] = box.checked;
            keep(LS.cols, columns);
            drawResults();
          };
          return h('label', { class: 'tt-pick-item' }, box, h('span', {}, c.label));
        }),
      );
      openPopover(colBtn, list, { label: 'Choose columns', align: 'right' });
      list.querySelector('input')?.focus();
    };
    const exportBtn = h('button', { class: 'btn small', onclick: () => exportCsv() }, 'Export CSV');
    const cmpBtn = h('button', { class: 'btn small', disabled: compare.length < 2, onclick: () => setMode('compare', true) }, `Compare (${compare.length})`);
    const mapBtn = h('button', { class: 'btn small', onclick: () => setMode('map', true) }, 'Show on map');
    resultHead.replaceChildren(
      h('h3', {}, r.total ? `${countText(r.total)} firm${r.total === 1 ? '' : 's'}` : 'No firms'),
      h('span', { class: 'muted small pr-desc' }, describeForm(form)),
      h('span', { class: 'pr-head-actions' }, colBtn, exportBtn, mapBtn, cmpBtn),
    );
    const notices = [...problems, ...(r.note ? [r.note] : [])];
    if (!r.rows.length) {
      const empty = (status?.counts.firms ?? 0) === 0;
      resultBody.replaceChildren(
        ...notices.map((n) => h('p', { class: 'pr-warn' }, n)),
        h('div', { class: 'empty-state' }, empty ? h('div', {}, h('p', {}, 'The prospect database is empty.'), h('button', { class: 'btn primary', onclick: () => setMode('data', true) }, 'Open the Data panel to download')) : 'No firm matches these filters. Try a wider radius or fewer filters.'),
      );
      return;
    }
    const table = h(
      'table',
      { class: 'data-table pr-table' },
      h('thead', {}, h('tr', {}, h('th', { class: 'pr-pick' }, h('span', { class: 'sr-only' }, 'Compare')), h('th', {}, 'Name'), ...cols.map((c) => h('th', { class: NUM_COLS.has(c.key) ? 'num' : '' }, c.label)), ...extra.map((c) => h('th', { class: 'num' }, c.label)))),
      h(
        'tbody',
        {},
        ...r.rows.map((f) => {
          const pick = h('input', { type: 'checkbox', checked: compare.some((c) => c.id === f.id), 'aria-label': `Compare ${f.name}`, title: 'Add to compare (2-5 firms)' });
          pick.onclick = (e) => e.stopPropagation();
          pick.onchange = () => {
            toggleCompare(f.id, f.name);
            pick.checked = compare.some((c) => c.id === f.id);
          };
          const tr = h(
            'tr',
            { 'data-firm': f.id, onclick: (e: Event) => !(e.target as HTMLElement).closest('a, input, button') && openFirm(f.id) },
            h('td', { class: 'pr-pick' }, pick),
            h('td', { 'data-value': f.name }, h('b', { class: 'pr-name' }, f.name), f.otherNames?.length ? h('span', { class: 'muted small pr-aka' }, f.otherNames[0]) : null),
            ...cols.map((c) => cell(c.key, f)),
            ...extra.map((c) => (c.key === 'distance' ? h('td', { class: 'num', 'data-value': String(f.distanceMiles ?? '') }, f.distanceMiles != null ? `${f.distanceMiles.toFixed(1)}${f.geo === 'zip' ? ' ≈' : ''}` : '—') : h('td', { class: 'num', 'data-value': String(f.position ?? '') }, moneyText(f.position, '—')))),
          );
          return activatable(tr);
        }),
      ),
    );
    tableTools(table, { id: 'prospect:results', columns: { Compare: 'none', '': 'none' } });
    resultBody.replaceChildren(
      ...notices.map((n) => h('p', { class: 'pr-warn' }, n)),
      h('div', { class: 'table-wrap pr-table-wrap' }, table),
      h(
        'div',
        { class: 'pr-inline pr-more' },
        h('span', { class: 'muted small' }, `Showing ${countText(r.rows.length)} of ${countText(r.total)}. Click a row for the profile. Column filters apply to the rows loaded here.${r.query.near ? ' ≈ = placed at its ZIP centre.' : ''}`),
        r.rows.length < r.total ? h('button', { class: 'btn small', onclick: () => runSearch(true) }, `Load ${Math.min(PAGE, r.total - r.rows.length)} more`) : null,
      ),
    );
  }

  async function exportCsv() {
    try {
      const { query } = await buildQuery();
      const r = await prospectExport({ ...query, limit: 5000 });
      saveText(`prospects-${new Date().toISOString().slice(0, 10)}.csv`, r.csv);
      toast(r.total > r.count ? `Exported the first ${countText(r.count)} of ${countText(r.total)} (5,000 max)` : `Exported ${countText(r.count)} firms`);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  // ---------- compare ----------
  function toggleCompare(id: string, name: string) {
    const i = compare.findIndex((c) => c.id === id);
    if (i >= 0) compare.splice(i, 1);
    else if (compare.length >= 5) return toast('Compare takes up to 5 firms: remove one first');
    else compare.push({ id, name });
    keep(LS.compare, compare);
    drawTabs();
    const btn = resultHead.querySelector<HTMLButtonElement>('.pr-head-actions button:last-child');
    if (btn) {
      btn.textContent = `Compare (${compare.length})`;
      btn.disabled = compare.length < 2;
    }
    if (mode === 'compare') drawCompare();
  }
  const compareBox = h('div', { class: 'ap-body' });
  const compareChips = h('div', { class: 'chip-row pr-cmp-chips' });
  views.compare.append(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Firms to compare'), h('span', { class: 'muted small' }, 'Tick 2-5 firms in Search results or use "Add to compare" in a profile.')), compareChips), compareBox);
  let compareKey = '';
  function drawCompare() {
    compareChips.replaceChildren(
      ...compare.map((c) => h('span', { class: 'chip on' }, h('button', { type: 'button', class: 'link-btn', onclick: () => openFirm(c.id) }, c.name), h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove ${c.name}`, onclick: () => toggleCompare(c.id, c.name) }, '✕'))),
      compare.length ? '' : h('span', { class: 'muted small' }, 'No firms picked yet.'),
    );
    const key = compare.map((c) => c.id).join('|');
    if (compare.length < 2) {
      compareKey = '';
      compareBox.replaceChildren(h('div', { class: 'empty-state' }, 'Pick at least 2 firms (up to 5) to compare them side by side.'));
      return;
    }
    if (key === compareKey) return;
    compareKey = key;
    renderCompare(compareBox, compare.map((c) => c.id), openFirm);
  }

  // ---------- map ----------
  const mapBox = h('div', { class: 'pr-map', role: 'region', 'aria-label': 'Map of firms' });
  const mapInfo = h('div', { class: 'pr-map-info' });
  const mapTiles = h('p', { class: 'pr-warn', hidden: true }, 'Map tiles could not load (offline or blocked). Firms still show at their positions on a plain background.');
  const mapMiles = h('input', { class: 'input', type: 'text', inputmode: 'decimal', 'aria-label': 'Radius in miles', placeholder: '25' });
  const mapNear = h('input', { class: 'input', type: 'text', 'aria-label': 'Centre: ZIP or address', placeholder: 'ZIP or street address' });
  const mapGo = h('button', { class: 'btn primary small', type: 'submit' }, 'Search area');
  const mapClear = h('button', { class: 'btn ghost small', type: 'button' }, 'Clear radius');
  views.map.append(
    h(
      'section',
      { class: 'panel' },
      h(
        'form',
        {
          class: 'pr-map-bar',
          onsubmit: (e: Event) => {
            e.preventDefault();
            form.miles = mapMiles.value;
            form.near = mapNear.value;
            rebuildFilters();
            runSearch();
          },
        },
        h('span', { class: 'muted small' }, 'Within'),
        mapMiles,
        h('span', { class: 'muted small' }, 'miles of'),
        mapNear,
        mapGo,
        mapClear,
        h('span', { class: 'muted small' }, 'or click the map to search around a point.'),
      ),
      mapInfo,
      mapTiles,
      mapBox,
    ),
  );
  mapClear.onclick = () => {
    form.miles = form.near = '';
    rebuildFilters();
    runSearch();
  };
  let mapApi: import('../prospect/map').ProspectMap | null = null;
  let mapLoading: Promise<void> | null = null;
  let mapKey = '';
  async function showMap() {
    mapMiles.value = form.miles;
    mapNear.value = form.near;
    if (!mapApi) {
      mapLoading ??= import('../prospect/map').then(({ createProspectMap }) => {
        mapApi = createProspectMap(mapBox, {
          onOpen: openFirm,
          onPickCentre: (lat, lon) => {
            form.near = `${lat}, ${lon}`;
            form.miles = form.miles || '25';
            rebuildFilters();
            runSearch();
          },
          milesForPick: () => parseMiles(form.miles) ?? 25,
          onTiles: (ok) => (mapTiles.hidden = ok),
        });
      });
      try {
        await mapLoading;
      } catch (err) {
        mapBox.replaceChildren(h('div', { class: 'ap-error' }, `The map couldn't load: ${(err as Error).message}`));
        return;
      }
    }
    requestAnimationFrame(() => mapApi?.resize());
    if (!results) return;
    const key = JSON.stringify(results.query);
    if (key === mapKey) return;
    mapKey = key;
    mapInfo.replaceChildren(h('span', { class: 'muted small' }, 'Loading map points…'));
    try {
      const r = await prospectSearch({ ...results.query, limit: MAP_LIMIT, offset: 0 });
      const located = r.rows.filter((f) => f.lat != null);
      const approx = located.filter((f) => f.geo === 'zip').length;
      const near = results.query.near;
      const centre = r.centre && near ? { ...r.centre, miles: near.miles } : null;
      mapApi?.setFirms(r.rows, centre);
      mapInfo.replaceChildren(
        h('span', { class: 'small' }, h('b', {}, countText(located.length)), ` of ${countText(r.total)} firms have a map location`, r.total > MAP_LIMIT ? ` (first ${countText(MAP_LIMIT)} shown)` : '', approx ? `; ${countText(approx)} placed at their ZIP centre (approximate)` : '', '. '),
        h('span', { class: 'pr-legend' }, ...[['ria', 'RIA'], ['era', 'Exempt adviser'], ['mfo', 'Multi-family office'], ['fo', 'Family office?'], ['other', 'Other']].map(([k, label]) => h('span', {}, h('i', { class: `pr-pin pr-pin-${k}`, 'aria-hidden': 'true' }), label))),
        located.length < r.total ? h('span', { class: 'muted small' }, ' Missing pins need "Map locations" in the Data panel.') : '',
      );
    } catch (err) {
      mapKey = '';
      mapInfo.replaceChildren(h('span', { class: 'ap-error' }, (err as Error).message));
    }
  }

  // ---------- data panel ----------
  const dataBox = h('div', { class: 'pr-data-grid' });
  const dataHead = h('div', { class: 'panel-head' });
  views.data.append(h('section', { class: 'panel' }, dataHead, h('p', { class: 'muted small' }, 'Downloads come straight from the SEC and US Census (free, public). The SEC asks for your email in Settings; downloads run one at a time, politely paced. Nothing leaves your computer.'), dataBox));

  function confirmFirst(source: ProspectSource): Promise<boolean> {
    const fresh = !status || (status.counts.firms ?? 0) === 0;
    const big = source === 'all' || source === 'adv_full' || source === '13f';
    if (!fresh && !big) return Promise.resolve(true);
    if (!fresh && sourceFreshness(status, source).state !== 'missing') return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        close();
        resolve(ok);
      };
      const close = openModal(
        source === 'all' ? 'Download the prospect database' : 'Download this source',
        h(
          'div',
          { class: 'pr-confirm' },
          h('p', {}, h('b', {}, `The full database needs about ${FIRST_DOWNLOAD_SIZE}.`), ' The Form ADV data is about 1 GB to download and 13F holdings about 400 MB a quarter; downloads are deleted after loading.'),
          h('p', {}, 'A first full download takes roughly 20-60 minutes, mostly waiting on the SEC. You can keep using the platform; progress shows here. If it stops, pressing Download again resumes.'),
          h('p', { class: 'muted small' }, `Free space on your computer: check before starting. Database now: ${sizeText(status)}.`),
          h('div', { class: 'pr-inline' }, h('button', { class: 'btn primary', onclick: () => finish(true) }, 'Start download'), h('button', { class: 'btn ghost', onclick: () => finish(false) }, 'Cancel')),
        ),
        { onClose: () => finish(false), noAutofocus: true },
      );
    });
  }

  async function ingest(source: ProspectSource) {
    if (!(await confirmFirst(source))) return;
    ingesting.set(source, 'Starting…');
    drawData();
    if (!pollTimer) pollTimer = setInterval(() => (clearEngineCache('prospect.status'), refreshStatus()), 3000);
    try {
      await prospectIngest(source, (e) => {
        if (e.type !== 'status') return;
        ingesting.set(source, e.text);
        const line = dataBox.querySelector<HTMLElement>(`[data-progress="${source}"]`);
        if (line) line.textContent = e.text;
        else drawData();
      });
      toast('Download finished: the firm list was rebuilt');
    } catch (err) {
      const msg = (err as Error).message;
      if (/SEC email|contact email/i.test(msg)) {
        openModal('SEC email needed', h('div', {}, h('p', {}, msg), h('button', { class: 'btn primary', onclick: () => openSettings() }, 'Open Settings')), { noAutofocus: true });
      } else toast(msg);
    } finally {
      ingesting.delete(source);
      clearEngineCache('prospect.');
      await refreshStatus();
      if (results) runSearch();
    }
  }

  function drawData() {
    const running = !!status?.job?.running || ingesting.size > 0;
    dataHead.replaceChildren(
      h('h3', {}, 'Data sources'),
      h('span', { class: 'muted small' }, status ? `${countText(status.counts.firms ?? 0)} firms · ${countText(status.counts.people ?? 0)} people · ${countText(status.counts.holdings_13f ?? 0)} 13F positions · ${sizeText(status)}` : ''),
      h('button', { class: 'btn primary small', disabled: running, onclick: () => ingest('all') }, (status?.counts.firms ?? 0) ? 'Refresh everything' : 'Download everything'),
      h('button', { class: 'btn ghost small', onclick: () => (clearEngineCache('prospect.status'), refreshStatus()) }, 'Recheck'),
      ingesting.has('all') || (status?.job?.running && status.job.source === 'all')
        ? h('p', { class: 'pr-progress small', 'data-progress': 'all', role: 'status' }, ingesting.get('all') ?? status?.job?.stage ?? 'Working…')
        : '',
    );
    if (statusError) {
      dataBox.replaceChildren(h('div', { class: 'ap-error' }, statusError));
      return;
    }
    dataBox.replaceChildren(
      ...SOURCE_INFO.map((s) => {
        const f = sourceFreshness(status, s.key);
        const live = ingesting.get(s.key) ?? (status?.job?.running && status.job.source === s.key ? status.job.stage : '');
        const checks = s.key === 'geo' ? null : headerSummary(status?.headers?.[s.key] ?? null);
        const info = status?.sources?.[s.key] as Record<string, unknown> | null | undefined;
        return h(
          'article',
          { class: `pr-source ${f.state}` },
          h('div', { class: 'pr-source-head' }, h('h4', {}, s.label), h('span', { class: `badge ${f.state === 'fresh' ? 'up' : f.state === 'due' ? 'warn' : f.state === 'running' ? 'accent' : ''}` }, { fresh: 'Up to date', due: 'Refresh due', missing: 'Not downloaded', running: 'Downloading' }[f.state])),
          h('p', { class: 'small' }, s.what),
          h('p', { class: 'small' }, h('b', {}, f.text)),
          s.key === 'adv_full' ? h('p', { class: 'pr-strip-note small' }, status?.peopleNote ?? 'The SEC\'s bulk Form ADV data (people and private funds) ended at 31 Dec 2024 when this was built; the panel shows the date of the newest release once loaded. Check IAPD for later changes.') : null,
          s.key === '13f' && info ? h('p', { class: 'muted small' }, `Two newest quarters kept for changes. ${countText(status?.counts.filers_13f ?? 0)} managers loaded.`) : null,
          checks ? h('p', { class: `small ${checks.ok ? 'up' : 'down'}` }, checks.ok ? '✓ ' : '✕ ', 'Header self-check: ', checks.text) : s.key !== 'geo' ? h('p', { class: 'muted small' }, 'Header self-check runs on the first download.') : null,
          h('p', { class: 'muted small' }, `${s.cadence} · ${s.size}`),
          live ? h('p', { class: 'pr-progress small', 'data-progress': s.key, role: 'status' }, live) : null,
          h('button', { class: 'btn small', disabled: running, onclick: () => ingest(s.key) }, f.state === 'missing' ? 'Download' : 'Refresh'),
        );
      }),
    );
    if (status?.job?.error && !running) dataBox.prepend(h('p', { class: 'pr-warn' }, `Last download: ${status.job.error}`));
  }

  // ---------- notes ----------
  async function loadNotes() {
    try {
      for (const n of await listDocs<ProspectNote>('prospect_notes')) notes.set(n.id, n);
      refreshOutreachCells();
    } catch {
      /* no helper yet: notes appear once it connects */
    }
  }

  // ---------- start ----------
  let started = false;
  drawTabs();
  drawStrip();
  rebuildFilters();
  setMode('search');
  return {
    el: frame.el,
    start(sub?: string) {
      const [m, ...rest] = (sub ?? '').split('/');
      if (!started || !status) {
        started = true;
        refreshStatus();
        loadSaved();
        loadNotes();
        if (!results) runSearch();
      }
      if (m === 'firm' && rest.length) {
        setMode(mode);
        openFirm(decodeURIComponent(rest.join('/')));
      } else if ((MODES.map((x) => x.id) as string[]).includes(m)) setMode(m as Mode);
      else if (!m) setMode('search');
    },
    stop() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      closeDrawer();
    },
    /** From the command bar: PROS [text], FO [text] (family offices), RIA [text]. */
    preset(kind: 'all' | 'fo' | 'ria', text = '') {
      Object.assign(form, emptyForm());
      if (kind === 'fo') form.types = ['Likely family office', 'Multi-family office'];
      if (kind === 'ria') form.types = ['Registered RIA'];
      form.text = text;
      rebuildFilters();
      setMode('search', true);
      runSearch();
    },
    open(firmId: string) {
      openFirm(firmId);
    },
  };
}
