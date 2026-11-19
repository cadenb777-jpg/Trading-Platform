/**
 * The terminal kit: the two pieces every terminal screen is built from.
 *   - termPanel: a glass panel with a thin title bar (amber function code, title, where the figures come from and
 *     when, an optional "open the full screen" link) and a body. One line (`note`) replaces empty boxes: a missing key
 *     or a failed source says so in the panel's footer instead of leaving a dead panel.
 *   - termTable: a dense table (fixed-width digits, right-aligned numbers, banded groups, numbered rows that open with
 *     Enter or "5" + Enter in the command bar). `set()` updates cells in place when the rows are the same, so live
 *     values change without the table being rebuilt, and changed numbers get one calm flash (flash.ts).
 */
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { numberRow } from '../ui/fnTile';
import { flash } from './flash';

export interface TermPanel {
  el: HTMLElement;
  body: HTMLElement;
  /** "Schwab · 10:42" on the right of the title bar. */
  source(text: string): void;
  /** One quiet line under the body (missing key, a source that failed); '' hides it. */
  note(text: string, action?: { label: string; run: () => void }): void;
}

export function termPanel(o: { code: string; title: string; tip?: string; cls?: string; link?: { label: string; open: () => void } }): TermPanel {
  const src = h('span', { class: 'tp-src' });
  const body = h('div', { class: 'tp-body' });
  const noteEl = h('div', { class: 'tp-note', hidden: true });
  const el = h(
    'section',
    { class: `tp ${o.cls ?? ''}`, 'aria-label': o.title },
    h(
      'header',
      { class: 'tp-head' },
      h('span', { class: 'tp-code' }, o.code),
      h('h3', { class: 'tp-title', title: o.tip ?? '' }, o.title),
      src,
      h('button', { type: 'button', class: 'tp-float', title: 'Pop out into a window', 'aria-label': `Pop out ${o.title}`, onclick: (e: Event) => {
        const target = (e.currentTarget as HTMLElement).closest<HTMLElement>('.tp');
        if (target) void import('../ui/floatPanel').then((m) => m.floatPanel(target, `${o.code} ${o.title}`));
      } }, icon('float', 13)),
      o.link ? h('button', { type: 'button', class: 'tp-link', title: `Open ${o.link.label.toLowerCase()}`, onclick: o.link.open }, o.link.label, h('span', { 'aria-hidden': 'true' }, ' ›')) : '',
    ),
    body,
    noteEl,
  );
  return {
    el,
    body,
    source: (text) => (src.textContent = text),
    note(text, action) {
      noteEl.hidden = !text;
      noteEl.replaceChildren(text, action ? h('button', { type: 'button', class: 'tp-note-act', onclick: action.run }, action.label) : '');
    },
  };
}

export type Tone = 'up' | 'down' | '';
export const toneOf = (v: number | null | undefined, eps = 5e-5): Tone => (v == null || !Number.isFinite(v) || Math.abs(v) < eps ? '' : v > 0 ? 'up' : 'down');

export interface Col<R> {
  label: string;
  /** Shown text. */
  text: (r: R) => string;
  /** Left-aligned (names); numbers are right-aligned. */
  left?: boolean;
  tone?: (r: R) => Tone;
  /** The number behind the text, for the change flash. */
  value?: (r: R) => number | null | undefined;
  /** Relative moves smaller than this don't flash (e.g. 0.0002). */
  minMove?: number;
  title?: string;
  cls?: string;
}

export interface TermRows<R> {
  /** Group title shown as a band above its rows ('' = no band). */
  title: string;
  rows: R[];
}

export interface TermTable<R> {
  el: HTMLTableElement;
  set(groups: TermRows<R>[]): void;
}

export function termTable<R>(o: {
  cols: Col<R>[];
  id: (r: R) => string;
  /** First row number; rows are numbered in order (omit for no numbers). */
  number?: number;
  label?: (r: R) => string;
  open?: (r: R) => void;
  rowTitle?: (r: R) => string;
  cls?: string;
}): TermTable<R> {
  const numbered = o.number != null;
  const head = h('tr', {}, numbered ? h('th', { class: 'tt-n', scope: 'col' }, '') : '', ...o.cols.map((c) => h('th', { scope: 'col', class: `${c.left ? 'l' : ''} ${c.cls ?? ''}`, title: c.title ?? '' }, c.label)));
  const tbody = h('tbody', {});
  const el = h('table', { class: `tt ${o.cls ?? ''}` }, h('thead', {}, head), tbody);
  let shape = '';
  let cells: { td: HTMLTableCellElement; value: number | null | undefined }[][] = [];

  const paint = (td: HTMLTableCellElement, c: Col<R>, r: R) => {
    td.textContent = c.text(r);
    td.className = `${c.left ? 'l' : ''} ${c.tone?.(r) ?? ''} ${c.cls ?? ''}`.trim();
  };

  function build(groups: TermRows<R>[]) {
    let n = o.number ?? 0;
    cells = [];
    const out: HTMLElement[] = [];
    for (const g of groups) {
      if (g.title) out.push(h('tr', { class: 'tt-band' }, h('th', { colspan: o.cols.length + (numbered ? 1 : 0), scope: 'colgroup' }, g.title)));
      for (const r of g.rows) {
        const tds = o.cols.map((c) => {
          const td = h('td', {});
          paint(td, c, r);
          return td;
        });
        cells.push(tds.map((td, i) => ({ td, value: o.cols[i].value?.(r) })));
        const tr = h('tr', { class: o.open ? 'tt-open' : '', title: o.rowTitle?.(r) ?? '' }, numbered ? h('td', { class: 'tt-n' }, `${n})`) : '', ...tds);
        if (o.open) {
          tr.tabIndex = 0;
          tr.addEventListener('click', () => o.open!(r));
          tr.addEventListener('keydown', (e) => e.key === 'Enter' && o.open!(r));
        }
        out.push(numbered ? numberRow(tr, n++, o.label?.(r) ?? o.id(r)) : tr);
      }
    }
    tbody.replaceChildren(...out);
  }

  return {
    el,
    set(groups) {
      const next = groups.map((g) => `${g.title}:${g.rows.map(o.id).join(',')}`).join('|');
      if (next !== shape) {
        shape = next;
        build(groups);
        return;
      }
      // same rows: update in place, flashing what changed
      let i = 0;
      for (const g of groups) {
        for (const r of g.rows) {
          o.cols.forEach((c, j) => {
            const cell = cells[i][j];
            const v = c.value?.(r);
            const before = cell.td.textContent;
            paint(cell.td, c, r);
            if (c.value && before !== cell.td.textContent) flash(cell.td, cell.value, v, c.minMove ?? 0);
            cell.value = v;
          });
          i++;
        }
      }
    },
  };
}

/** Basis points with a sign ("+4", "-12"); '—' when unknown. */
export const bp = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}`);
/** A percentage from a fraction with a sign ("+0.31"); '—' when unknown. */
export const pc = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}`);
/** A signed number ("+1.4"). */
export const sgn = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}`);
