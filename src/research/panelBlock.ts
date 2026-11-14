/** Shared pieces of the Research overview's reading panels (Debt and dilution, Earnings quality, Cash health,
 * Balance-sheet quality). */
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';

/** One titled block of a panel: amber caption with its glossary "i", then the body. */
export function block(title: string, term: string, ...body: (Node | string)[]) {
  return h('div', { class: 'md-block' }, h('div', { class: 'cf-caption' }, title, infoTip(term)), h('div', { class: 'md-body' }, ...body));
}

/** The reply lacks lines a newer helper sends: either the helper is older, or the page holds a reply saved before the
 * update (it fills in at the next refresh). */
export function savedBeforeUpdate(helperReady: boolean): HTMLElement {
  return h(
    'p',
    { class: 'muted small' },
    helperReady ? 'This page is showing data saved before your helper update. It fills in when the company’s data next refreshes (Refresh, or within 5 minutes).' : 'Arrives with the next helper update (it installs by itself).',
  );
}
