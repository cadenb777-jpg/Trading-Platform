import { h, openPopover } from './dom';

/*
 * Excel-style header tools for any <table> with a <thead>: click a header to sort, type in the slim
 * filter row under the headers to filter, "Showing 12 of 100" + "Clear filters" while a filter is on.
 *
 *   tableTools(tableEl, { id: 'flow:unusual', columns: { Reading: 'text', '': 'none' } });
 *
 * - Column types are detected from the data (number / pick-list / text); `columns` overrides them by header text.
 * - A cell's value is its text, or its `data-value` attribute when set (use it when the text is not the value).
 * - Rows with class `total`, or with a different number of cells, stay at the bottom and are never filtered.
 * - Sort and filters are remembered per `id` in localStorage (a per-viewer convenience).
 * - Live data: when the rows change the sort and filters re-apply; when a table is rebuilt with the same id
 *   while you are typing in a filter box, the cursor moves to the new box.
 */

export type ColumnType = 'number' | 'text' | 'pick' | 'none';
export type ColumnFilter = { text?: string; min?: string; max?: string; hide?: string[] };
export type TableState = { sort?: { col: string; dir: 'asc' | 'desc' }; filters: Record<string, ColumnFilter> };
export type TableToolsOptions = {
  /** Remembers sort and filters under this name. */
  id: string;
  /** Override detected column types, keyed by header text ('' for a column with no header). */
  columns?: Record<string, ColumnType>;
  /** The filter row appears once the table has this many rows (or a filter is on). Default 5. */
  minRowsForFilters?: number;
};

// ---------- Pure logic (tested in tableTools.test.ts) ----------

const BLANK = /^(—|–|-|n\/a|na|none|no quote|)$/i;
const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** True for empty cells and placeholders like "—" or "n/a". */
export const isBlank = (s: string) => BLANK.test(s.trim());

/** "1.2%" -> 1.2, "$3.4B" -> 3.4e9, "−5" -> -5, "1.5×" -> 1.5, "(2)" -> -2. Anything else (words, dates, "—") -> null. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[−–]/g, '-').replace(/[,\s]/g, '');
  let negative = false;
  if (/^\(.+\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const m = s.match(/^([+-])?\$?([+-])?(\d+(?:\.\d+)?|\.\d+)(%|[kmbt]|×|x|bps?)?$/i);
  if (!m) return null;
  let v = parseFloat(m[3]) * (MULT[(m[4] ?? '').toLowerCase()] ?? 1);
  if (m[1] === '-' || m[2] === '-') v = -v;
  return negative ? -v : v;
}

/** Number when most filled cells are numbers; pick-list when few distinct values repeat; text otherwise. */
export function detectType(values: string[]): ColumnType {
  const filled = values.map((v) => v.trim()).filter((v) => !isBlank(v));
  if (!filled.length) return 'none';
  if (filled.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v)).length >= filled.length * 0.8) return 'text'; // ISO dates
  if (filled.filter((v) => parseNumber(v) != null).length >= filled.length * 0.8) return 'number';
  const distinct = new Set(filled).size;
  if (distinct <= 1) return 'none';
  return distinct <= 8 && distinct < filled.length ? 'pick' : 'text';
}

/** Is this filter doing anything for a column of this type? (Fields left over from another type don't count.) */
export function isActive(type: ColumnType, f?: ColumnFilter): boolean {
  if (!f) return false;
  if (type === 'number') return !!(f.min?.trim() || f.max?.trim());
  if (type === 'pick') return !!f.hide?.length;
  if (type === 'text') return !!f.text?.trim();
  return false;
}

/** Any filter on, given the columns' current types. */
export const hasFilters = (state: TableState, cols: { key: string; type: ColumnType }[]) => cols.some((c) => isActive(c.type, state.filters[c.key]));

const anyField = (f: ColumnFilter) => !!(f.text?.trim() || f.min?.trim() || f.max?.trim() || f.hide?.length);

/** Does one cell pass its column's filter? */
export function matches(value: string, type: ColumnType, f?: ColumnFilter): boolean {
  if (!isActive(type, f)) return true;
  if (type === 'number') {
    const n = parseNumber(value);
    const min = f!.min?.trim() ? parseNumber(f!.min) : null;
    const max = f!.max?.trim() ? parseNumber(f!.max) : null;
    if (min != null && (n == null || n < min)) return false;
    if (max != null && (n == null || n > max)) return false;
    return true;
  }
  if (type === 'pick') return !f!.hide?.includes(value.trim());
  return value.toLowerCase().includes((f!.text ?? '').trim().toLowerCase());
}

/** Compares two cells; blanks always go last whatever the direction. */
export function compareCells(a: string, b: string, type: ColumnType, dir: 'asc' | 'desc'): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (type === 'number') {
    const x = parseNumber(a);
    const y = parseNumber(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return (x - y) * sign;
  }
  const ba = isBlank(a);
  const bb = isBlank(b);
  if (ba || bb) return ba ? (bb ? 0 : 1) : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * sign;
}

/** Rows (cell text, in their original order) -> which rows to show, in what order (`null` = leave the order alone). */
export function tableView(rows: string[][], cols: { key: string; type: ColumnType }[], state: TableState) {
  const keep = rows.map((r) => cols.every((c, i) => matches(r[i] ?? '', c.type, state.filters[c.key])));
  const sortIndex = state.sort ? cols.findIndex((c) => c.key === state.sort!.col) : -1;
  let order: number[] | null = null;
  if (sortIndex >= 0 && cols[sortIndex].type !== 'none') {
    const { type } = cols[sortIndex];
    order = rows.map((_, i) => i).sort((i, j) => compareCells(rows[i][sortIndex] ?? '', rows[j][sortIndex] ?? '', type, state.sort!.dir) || i - j);
  }
  return { order, keep, shown: keep.filter(Boolean).length, total: rows.length };
}

/** Header click: numbers go biggest first -> smallest first -> off; text goes A-Z -> Z-A -> off. */
export function nextSort(state: TableState, col: string, type: ColumnType): TableState['sort'] {
  const first = type === 'number' ? 'desc' : 'asc';
  const second = first === 'desc' ? 'asc' : 'desc';
  if (state.sort?.col !== col) return { col, dir: first };
  return state.sort.dir === first ? { col, dir: second } : undefined;
}

const KEY = (id: string) => `tp.table.${id}`;

export function loadState(id: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): TableState {
  try {
    const raw = JSON.parse(storage?.getItem(KEY(id)) ?? 'null');
    if (raw && typeof raw === 'object' && raw.filters && typeof raw.filters === 'object') return { sort: raw.sort, filters: raw.filters };
  } catch {
    /* storage blocked or bad JSON: start fresh */
  }
  return { filters: {} };
}

export function saveState(id: string, state: TableState, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage) {
  try {
    if (!state.sort && !Object.values(state.filters).some(anyField)) storage?.removeItem(KEY(id));
    else storage?.setItem(KEY(id), JSON.stringify(state));
  } catch {
    /* private window or storage full: sorting and filtering still work for this visit */
  }
}

// ---------- DOM ----------

/** A cell's value: `data-value` when set, else its text (separate blocks joined with a space). */
function cellText(el: Element): string {
  const own = (el as HTMLElement).dataset?.value;
  if (own != null) return own;
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '');
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const block = /^(DIV|P|BR|LI)$/.test((node as Element).tagName);
      if (block) parts.push(' ');
      node.childNodes.forEach(walk);
      if (block) parts.push(' ');
    }
  };
  el.childNodes.forEach(walk);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Per table id: the remembered state, whether the phone filter row is open, and the filter box being typed in. */
type Shared = { state: TableState; open?: boolean; focus?: { el: HTMLInputElement; key: string } };
const registry = new Map<string, Shared>();

export function tableTools(table: HTMLTableElement, opts: TableToolsOptions) {
  const headRow = table.tHead?.rows[0];
  const body = table.tBodies[0];
  if (!headRow || !body) return { refresh() {}, destroy() {} };
  let shared = registry.get(opts.id);
  if (!shared) registry.set(opts.id, (shared = { state: loadState(opts.id) }));
  const { state } = shared;
  const minRows = opts.minRowsForFilters ?? 5;

  // Column keys are the header texts (made unique), so remembered filters follow the column, not its position.
  const seen = new Map<string, number>();
  const cols = [...headRow.cells].map((th, i) => {
    const label = cellText(th);
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    return { th, label, name: label || `column ${i + 1}`, key: n ? `${label} ${n + 1}` : label, type: 'none' as ColumnType, forced: opts.columns?.[label], button: null as HTMLButtonElement | null, cell: h('th', { class: 'tt-f' }) };
  });

  table.classList.add('tt');
  for (const c of cols) {
    if (!c.label || c.forced === 'none') continue; // no header text: filter only, nothing to click
    const arrow = h('span', { class: 'tt-arrow', 'aria-hidden': 'true' });
    c.button = h('button', { type: 'button', class: 'tt-sort', title: 'Sort' }, ...c.th.childNodes, arrow);
    c.button.addEventListener('click', () => {
      state.sort = nextSort(state, c.key, c.type);
      changed();
    });
    c.th.replaceChildren(c.button);
  }
  const filterRow = h('tr', { class: 'tt-filters' }, ...cols.map((c) => c.cell));
  headRow.after(filterRow);

  const count = h('span', { class: 'tt-count muted small', 'aria-live': 'polite' });
  const toggle = h('button', { type: 'button', class: 'btn small tt-toggle', 'aria-expanded': 'false' }, 'Filter');
  toggle.addEventListener('click', () => {
    shared!.open = table.classList.toggle('tt-open');
    toggle.setAttribute('aria-expanded', String(shared!.open));
  });
  if (shared.open) {
    table.classList.add('tt-open'); // a rebuilt table keeps the phone filter row open
    toggle.setAttribute('aria-expanded', 'true');
  }
  const clear = h('button', { type: 'button', class: 'btn small ghost tt-clear' }, 'Clear filters');
  clear.addEventListener('click', () => {
    state.filters = {};
    for (const c of cols) c.cell.dataset.type = ''; // rebuild the boxes empty
    changed();
  });
  table.createCaption().replaceChildren(h('div', { class: 'tt-bar' }, toggle, count, clear));

  function filterOf(key: string) {
    return (state.filters[key] ??= {});
  }

  function textBox(c: (typeof cols)[number], field: 'text' | 'min' | 'max', placeholder: string, label: string) {
    const input = h('input', { class: 'input tt-input', type: 'text', placeholder, 'aria-label': label, value: state.filters[c.key]?.[field] ?? '', 'data-key': `${c.key}\u0000${field}` });
    if (field !== 'text') input.setAttribute('inputmode', 'decimal');
    input.addEventListener('input', () => {
      filterOf(c.key)[field] = input.value;
      shared!.focus = { el: input, key: input.dataset.key! };
      changed();
    });
    input.addEventListener('focus', () => (shared!.focus = { el: input, key: input.dataset.key! }));
    input.addEventListener('blur', () => setTimeout(() => input.isConnected && shared!.focus?.el === input && (shared!.focus = undefined)));
    return input;
  }

  function pickButton(c: (typeof cols)[number], values: () => string[]) {
    const btn = h('button', { type: 'button', class: 'btn small tt-pick', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `Filter ${c.name}` });
    btn.addEventListener('click', () => {
      const all = [...new Set(values())].sort((a, b) => compareCells(a, b, 'text', 'asc'));
      const boxes = all.map((v) => {
        const box = h('input', { type: 'checkbox', checked: !filterOf(c.key).hide?.includes(v) });
        box.addEventListener('change', () => {
          const hide = new Set(filterOf(c.key).hide ?? []);
          if (box.checked) hide.delete(v);
          else hide.add(v);
          filterOf(c.key).hide = [...hide];
          changed();
        });
        return h('label', { class: 'tt-pick-item' }, box, h('span', {}, v || '(blank)'));
      });
      const setAll = (on: boolean) => {
        filterOf(c.key).hide = on ? [] : [...all];
        boxes.forEach((b) => ((b.firstChild as HTMLInputElement).checked = on));
        changed();
      };
      const list = h(
        'div',
        { class: 'tt-pick-list' },
        h('div', { class: 'tt-pick-actions' }, h('button', { type: 'button', class: 'link-btn', onclick: () => setAll(true) }, 'All'), h('button', { type: 'button', class: 'link-btn', onclick: () => setAll(false) }, 'None')),
        ...boxes,
      );
      btn.setAttribute('aria-expanded', 'true');
      openPopover(btn, list, { label: `Show ${c.name}`, onClose: () => btn.setAttribute('aria-expanded', 'false') });
      list.querySelector<HTMLInputElement>('input[type=checkbox]')?.focus();
    });
    return btn;
  }

  function buildFilter(c: (typeof cols)[number], values: () => string[]) {
    c.cell.dataset.type = c.type;
    if (c.type === 'number') c.cell.replaceChildren(h('div', { class: 'tt-range' }, textBox(c, 'min', 'Min', `Minimum ${c.name}`), textBox(c, 'max', 'Max', `Maximum ${c.name}`)));
    else if (c.type === 'pick') c.cell.replaceChildren(pickButton(c, values));
    else if (c.type === 'text') c.cell.replaceChildren(textBox(c, 'text', 'Contains', `Filter ${c.name}`));
    else c.cell.replaceChildren();
  }

  let current: string[][] = [];
  let original: HTMLTableRowElement[] = []; // the page's own row order, to go back to when sorting is switched off
  const observer = new MutationObserver((records) => {
    if (records.some((r) => !(r.target instanceof Node && (table.tHead?.contains(r.target) || table.caption?.contains(r.target))))) apply();
  });
  const watch = () => observer.observe(table, { childList: true, subtree: true, characterData: true });

  function apply() {
    observer.disconnect();
    const rows = [...body.rows];
    const known = new Set(original);
    if (rows.length !== original.length || rows.some((r) => !known.has(r))) original = rows; // the page changed the rows
    const all = original;
    const dataRows = all.filter((r) => r.cells.length === cols.length && !r.classList.contains('total'));
    const fixed = all.filter((r) => !dataRows.includes(r));
    const values = (current = dataRows.map((r) => [...r.cells].map(cellText)));

    cols.forEach((c, i) => {
      c.type = c.forced ?? detectType(values.map((v) => v[i]));
      if (c.cell.dataset.type !== c.type && !c.cell.contains(document.activeElement)) buildFilter(c, () => current.map((v) => v[i].trim()));
      if (c.button) c.button.disabled = c.type === 'none';
    });
    const view = tableView(values, cols, state);
    dataRows.forEach((r, i) => r.classList.toggle('tt-hide', !view.keep[i]));
    const wanted = view.order ? [...view.order.map((i) => dataRows[i]), ...fixed] : all;
    if (wanted.some((r, i) => body.rows[i] !== r)) body.append(...wanted);

    for (const c of cols) {
      const dir = state.sort?.col === c.key ? state.sort.dir : undefined;
      if (dir) c.th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      else c.th.removeAttribute('aria-sort');
      c.th.classList.toggle('tt-sorted', !!dir);
      const arrow = c.button?.querySelector('.tt-arrow');
      if (arrow) arrow.textContent = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '';
      if (c.type === 'pick') {
        const hidden = state.filters[c.key]?.hide?.length ?? 0;
        const btn = c.cell.querySelector('.tt-pick');
        if (btn) btn.textContent = hidden ? `${Math.max(0, new Set(values.map((v) => v[cols.indexOf(c)].trim())).size - hidden)} shown ▾` : 'All ▾';
      }
    }
    const active = hasFilters(state, cols);
    table.classList.toggle('tt-active', active);
    table.classList.toggle('tt-few', !active && dataRows.length < minRows);
    count.textContent = `Showing ${view.shown} of ${view.total}`;
    watch();
  }

  function changed() {
    saveState(opts.id, state);
    apply();
  }

  apply();

  // A rebuilt table (same id) takes over the filter box you were typing in.
  const was = shared.focus;
  if (was) {
    const at = was.el.selectionStart;
    requestAnimationFrame(() => {
      if (was.el.isConnected) return; // the old box is still there: nothing was rebuilt
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const next = [...filterRow.querySelectorAll<HTMLInputElement>('input')].find((i) => i.dataset.key === was.key);
      if (!next?.isConnected) return;
      next.focus();
      next.setSelectionRange(at ?? next.value.length, at ?? next.value.length);
    });
  }

  return {
    /** Re-apply sort and filters (only needed for changes the table can't see, e.g. a `data-value` update). */
    refresh: apply,
    destroy: () => observer.disconnect(),
  };
}

/** Same as tableTools, but returns the table so it can wrap an h('table', ...) call in place. */
export function withTableTools(table: HTMLTableElement, opts: TableToolsOptions): HTMLTableElement {
  tableTools(table, opts);
  return table;
}
