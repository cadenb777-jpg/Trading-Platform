/**
 * The function tile: the shared frame of every monitor box (owner's Bloomberg spec, 7.0): a thin title bar whose
 * link ("All markets ›", in plain words; owner: no command codes needed) opens the full screen, the body, and a
 * footer with where the figures come from and when. Rows can carry a number (Bloomberg's "type 5 <GO>"): typing that number in the command bar opens
 * the row (numberedOnPage / runNumbered).
 */
import { h } from './dom';
import { icon } from './icons';

export interface FnTile {
  el: HTMLElement;
  body: HTMLElement;
  /** The footer line ("Schwab quotes · 10:42"). */
  foot(text: string): void;
}

export function fnTile(o: { title: string; link?: string; open?: () => void; linkTitle?: string; actions?: Node[]; body?: Node; source?: string; cls?: string; tip?: string }): FnTile {
  const body = h('div', { class: 'fn-tile-body' }, o.body ?? '');
  const foot = h('div', { class: 'fn-tile-foot' }, o.source ?? '');
  const el = h(
    'section',
    { class: `fn-tile ${o.cls ?? ''}`, 'aria-label': o.title },
    h(
      'header',
      { class: 'fn-tile-head' },
      h('h3', { title: o.tip ?? '' }, o.title),
      ...(o.actions ?? []),
      h('button', { type: 'button', class: 'icon-btn fn-tile-float', title: 'Pop out into a window', 'aria-label': `Pop out ${o.title}`, onclick: (e: Event) => {
        const target = (e.currentTarget as HTMLElement).closest<HTMLElement>('.fn-tile');
        if (target) void import('./floatPanel').then((m) => m.floatPanel(target, o.title));
      } }, icon('float', 14)),
      o.link
        ? h('button', { type: 'button', class: 'fn-tile-link', title: o.linkTitle ?? `Open ${o.link.toLowerCase()}`, onclick: () => o.open?.() }, o.link, h('span', { 'aria-hidden': 'true' }, ' ›'))
        : '',
    ),
    body,
    foot,
  );
  return { el, body, foot: (text) => (foot.textContent = text) };
}

/** Marks a clickable row with its number (shown in the row's first cell) so "5" + Enter in the command bar opens it. */
export function numberRow<T extends HTMLElement>(row: T, n: number, label: string): T {
  row.dataset.num = String(n);
  row.dataset.numLabel = label;
  return row;
}

const visible = (el: HTMLElement) => !!(el.offsetParent || el.getClientRects().length);

/** The numbered rows on the page in view (pure over the DOM it is given). */
export function numberedOnPage(root: ParentNode = document): { n: number; label: string }[] {
  return [...root.querySelectorAll<HTMLElement>('.app-main [data-num]')].filter(visible).map((el) => ({ n: Number(el.dataset.num), label: el.dataset.numLabel ?? '' }));
}

/** Opens numbered row n on the page in view; false when there is none. */
export function runNumbered(n: number): boolean {
  const el = [...document.querySelectorAll<HTMLElement>(`.app-main [data-num="${n}"]`)].find(visible);
  if (!el) return false;
  el.scrollIntoView({ block: 'nearest' });
  el.click();
  return true;
}
