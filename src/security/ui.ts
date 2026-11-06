/**
 * Small DOM pieces for the security view: a figure (tabular, coloured, "—" with the reason on hover), a label/value
 * grid, and a panel whose footer always says where its numbers come from and when.
 */
import { h } from '../ui/dom';
import { DASH, fmtDate } from './format';
import { HELPER_NOT_RUNNING } from '../data/schwab';

/** A figure. A missing value ("—") carries its reason as a tooltip and for screen readers. */
export function fig(text: string, opts: { tone?: string; title?: string; reason?: string; strong?: boolean } = {}): HTMLElement {
  const missing = text === DASH || text === '';
  const title = missing ? `Not available: ${opts.reason ?? 'no data'}` : opts.title;
  return h(
    opts.strong ? 'b' : 'span',
    { class: `sv-num${opts.tone && !missing ? ` ${opts.tone}` : ''}${missing ? ' sv-na' : ''}`, title, 'aria-label': missing ? `not available: ${opts.reason ?? 'no data'}` : undefined },
    missing ? DASH : text,
  );
}

export type KV = [label: string | Node, value: Node | string, hint?: string];

/** A two-column list of label / figure rows. */
export function kvGrid(rows: KV[], cls = ''): HTMLElement {
  return h(
    'dl',
    { class: `sv-kv ${cls}` },
    ...rows.flatMap(([label, value, hint]) => [h('dt', { title: hint ?? '' }, label), h('dd', {}, typeof value === 'string' ? fig(value) : value)]),
  );
}

/** "as of 15:42" (today), "as of 4 Nov 15:42", or the date as given for a date-only string. */
export function asOfText(at: number | string | null | undefined): string {
  if (at == null || at === '') return '';
  if (typeof at === 'string') return fmtDate(at);
  const ms = at > 1e12 ? at : at * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Date().toDateString() === d.toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

/** A panel with a title (and optional mnemonic) and a "Source · as of" footer. */
export function panel(title: string, source: string, asOf: number | string | null | undefined, ...children: (Node | string | null | undefined | false)[]): HTMLElement {
  const when = asOfText(asOf);
  return h(
    'section',
    { class: 'sv-panel' },
    h('h3', { class: 'sv-panel-title' }, title),
    ...children,
    h('p', { class: 'sv-source muted tiny' }, `Source: ${source}${when ? ` · as of ${when}` : ''}`),
  );
}

/** A muted note in place of a panel's content. */
export const note = (text: string, cls = '') => h('p', { class: `sv-note muted small ${cls}` }, text);

/** A loading placeholder. */
export const loadingNote = (what: string) => h('p', { class: 'sv-note muted small', 'aria-busy': 'true' }, `Loading ${what}…`);

/** The error text for a failed request, in plain words. */
/** The error's message, shortened. The long "helper isn't running" text becomes one short line (each card would repeat it). */
export const reasonOf = (err: unknown) => {
  const msg = ((err as Error)?.message || String(err || 'unknown error')).replace(/\s+/g, ' ');
  return msg === HELPER_NOT_RUNNING ? 'the helper isn\'t running. Start it, then reload this page.' : msg.slice(0, 240);
};
