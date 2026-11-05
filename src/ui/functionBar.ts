/**
 * The function bar: a row of numbered chips under a page's title ("1 Refresh · 2 Export · 3 AI summary"), Bloomberg
 * style. Number keys 1-9 run them when nothing is being typed and no dialog is open. A page opts in with
 * `functionBar([...])` (or `pageFrame(...).functions([...])`) and places the returned element under its title; only
 * the bar on the page that is showing answers the keys. The key logic is pure and tested (functionBar.test.ts).
 */
import { h } from './dom';
import { icon, type IconName } from './icons';
import { pageOf } from './nav';

export interface FnAction {
  label: string;
  run(): void;
  /** A tooltip (what it does). */
  title?: string;
  icon?: IconName;
}

export interface FnKey {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  /** Focus is in a text field, list box or editable area. */
  inField?: boolean;
  /** A dialog, palette or pinned card owns the keyboard. */
  modalOpen?: boolean;
}

/** Which chip (0-based) a key press runs, or null. Only plain 1-9, never while typing or with a dialog open. */
export function fnKeyIndex(k: FnKey, count: number): number | null {
  if (k.ctrl || k.meta || k.alt || k.inField || k.modalOpen) return null;
  if (!/^[1-9]$/.test(k.key)) return null;
  const i = Number(k.key) - 1;
  return i < count ? i : null;
}

const bars = new WeakMap<HTMLElement, FnAction[]>();
let listening = false;

const FIELD = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="listbox"]';

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat) return;
    // the bar on the page that is showing (pages that are hidden have no layout)
    const bar = [...document.querySelectorAll<HTMLElement>('.views .fn-bar')].find((b) => b.offsetParent !== null);
    const actions = bar ? bars.get(bar) : undefined;
    if (!actions) return;
    const target = e.target instanceof Element ? e.target : null;
    const i = fnKeyIndex(
      { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, inField: !!target?.closest(FIELD), modalOpen: !!document.querySelector('.modal-backdrop, .cmd-palette, .ticker-card.pinned, .popover') },
      actions.length,
    );
    if (i == null) return;
    e.preventDefault();
    const chip = bar!.querySelectorAll<HTMLButtonElement>('.fn-chip')[i];
    if (chip?.disabled) return;
    chip?.classList.add('pressed');
    setTimeout(() => chip?.classList.remove('pressed'), 160);
    actions[i].run();
  });
}

export interface FnBarOptions {
  /** What the toolbar is called for screen readers. */
  label?: string;
  /** Related pages (routes), shown as small links with their codes on the right ("Related: JRNL Journal"). */
  related?: string[];
}

/** The bar element: numbered chips (at most nine), then the related pages. */
export function functionBar(actions: FnAction[], opts: FnBarOptions = {}): HTMLElement {
  listen();
  const list = actions.slice(0, 9);
  const related = (opts.related ?? []).map(pageOf).filter((p): p is NonNullable<typeof p> => !!p);
  const bar = h(
    'div',
    { class: 'fn-bar' },
    h(
      'div',
      { class: 'fn-chips', role: 'toolbar', 'aria-label': `${opts.label ?? 'Page functions'} (press 1-${list.length})` },
      ...list.map((a, i) =>
        h(
          'button',
          { type: 'button', class: 'fn-chip', title: `${a.title ?? a.label} (key ${i + 1})`, 'aria-keyshortcuts': String(i + 1), onclick: () => a.run() },
          h('span', { class: 'fn-num', 'aria-hidden': 'true' }, String(i + 1)),
          a.icon ? icon(a.icon, 14) : null,
          h('span', { class: 'fn-label' }, a.label),
        ),
      ),
    ),
    related.length
      ? h(
          'nav',
          { class: 'fn-related', 'aria-label': 'Related pages' },
          h('span', { class: 'fn-related-label' }, 'Related'),
          ...related.map((p) => h('a', { class: 'fn-rel', href: `#${p.route}`, title: p.about }, h('span', { class: 'code-hint' }, p.code), ` ${p.label}`)),
        )
      : null,
  );
  bars.set(bar, list);
  return bar;
}
