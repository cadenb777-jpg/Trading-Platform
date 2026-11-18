/** Shared pieces of the Research overview's reading panels (Debt and dilution, Earnings quality, Cash health,
 * Balance-sheet quality). */
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { pc } from './debtDilution';

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

/** Rates side by side on one scale (Taxes and operating leverage, Against bonds). A negative rate draws no bar; its
 * label still shows it. kind = 'one' | 'two' | 'base' (first, second and reference colours). */
export function rateBars(rows: { label: string; rate: number; kind: 'one' | 'two' | 'base' }[], label: string, digits = 1): HTMLElement {
  const max = Math.max(...rows.map((r) => r.rate), 0.001);
  return h(
    'div',
    { class: 'rb-bars', role: 'list', 'aria-label': label },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'rb-row', role: 'listitem', 'aria-label': `${r.label}: ${pc(r.rate, digits)}` },
        h('span', { class: 'rb-label small muted' }, r.label),
        h('span', { class: 'rb-track' }, h('span', { class: `rb-bar ${r.kind}`, style: `width:${Math.max(0, Math.min(100, (r.rate / max) * 100)).toFixed(1)}%` })),
        h('span', { class: 'rb-val num small' }, pc(r.rate, digits)),
      ),
    ),
  );
}
