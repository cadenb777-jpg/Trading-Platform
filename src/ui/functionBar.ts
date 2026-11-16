/**
 * The function keys: numbered actions for a page ("1 Refresh · 2 Export · 3 AI summary"), Bloomberg style. Since the
 * revamp they are one "Actions" button in the page header that opens them as a menu (a numbered row repeating the
 * page's buttons was clutter); number keys 1-9 still run them when nothing is being typed and no dialog is open. A page opts in with
 * `functionBar([...])` (or `pageFrame(...).functions([...])`) and places the returned element under its title; only
 * the bar on the page that is showing answers the keys. The key logic is pure and tested (functionBar.test.ts).
 */
import { h } from './dom';
import { icon, type IconName } from './icons';
import { pageOf } from './nav';

export interface FnAction {
  label: string;
  /** Return the request's promise: the chip then shows a spinner and ignores presses until it settles. */
  run(): unknown;
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
  /** Focus is somewhere other than the page itself (the body or inside the page's own view). */
  focusOutside?: boolean;
  /** A dialog, palette, drawer, slide-over, pop-out chart window or pinned card is open. */
  overlayOpen?: boolean;
}

/** Which chip (0-based) a key press runs, or null. Only plain 1-9, only on the page itself, never with an overlay open. */
export function fnKeyIndex(k: FnKey, count: number): number | null {
  if (k.ctrl || k.meta || k.alt || k.inField || k.focusOutside || k.overlayOpen) return null;
  if (!/^[1-9]$/.test(k.key)) return null;
  const i = Number(k.key) - 1;
  return i < count ? i : null;
}

/**
 * Wraps an action so it runs once at a time: while the promise it returns is pending, further presses are ignored
 * (pressing 3 three times sends one request). `onBusy` shows and hides the spinner. Returns whether it ran.
 */
export function inFlightGuard(run: () => unknown, onBusy: (busy: boolean) => void = () => {}): () => boolean {
  let busy = false;
  return () => {
    if (busy) return false;
    const r = run();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      busy = true;
      onBusy(true);
      const done = () => {
        busy = false;
        onBusy(false);
      };
      (r as Promise<unknown>).then(done, done);
    }
    return true;
  };
}

/** Things that sit over the page and own the keyboard while open. */
const OVERLAYS = '.modal-backdrop, .cmd-backdrop, .cmd-palette, .ticker-card.pinned, .popover, .sv-drawer, .pr-drawer, .ai-drawer, .chart-window, [role="dialog"], [aria-modal="true"]';

function overlayOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some((el) => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0);
}

const triggers = new WeakMap<HTMLElement, (() => boolean)[]>();
let listening = false;

const FIELD = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="listbox"]';

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat) return;
    // the bar on the page that is showing (pages that are hidden have no layout)
    // the actions are a header menu now (revamp); the keys work for the page that is showing, menu open or not
    const bar = [...document.querySelectorAll<HTMLElement>('.views .fn-bar')].find((b) => {
      const view = b.closest<HTMLElement>('.views > *');
      return !!view && !view.hidden && view.getClientRects().length > 0;
    });
    const run = bar ? triggers.get(bar) : undefined;
    if (!bar || !run) return;
    const active = document.activeElement;
    const view = bar.closest('.views > *');
    const onPage = !active || active === document.body || active === document.documentElement || active.id === 'content' || !!view?.contains(active);
    const target = e.target instanceof Element ? e.target : null;
    const i = fnKeyIndex({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, inField: !!target?.closest(FIELD), focusOutside: !onPage, overlayOpen: overlayOpen() }, run.length);
    if (i == null) return;
    e.preventDefault();
    const chip = bar.querySelectorAll<HTMLButtonElement>('.fn-chip')[i];
    if (!chip || chip.disabled) return;
    chip.classList.add('pressed');
    setTimeout(() => chip.classList.remove('pressed'), 160);
    run[i]();
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
  const chips = list.map((a, i) =>
    h(
      'button',
      { type: 'button', class: 'fn-chip', title: `${a.title ?? a.label} (key ${i + 1})`, 'aria-keyshortcuts': String(i + 1) },
      h('span', { class: 'fn-num', 'aria-hidden': 'true' }, String(i + 1)),
      a.icon ? icon(a.icon, 14) : null,
      h('span', { class: 'fn-label' }, a.label),
    ),
  );
  // one run at a time per chip: a chip that sends a request shows a spinner and ignores presses until it answers
  const run = list.map((a, i) =>
    inFlightGuard(
      () => a.run(),
      (busy) => {
        chips[i].disabled = busy;
        chips[i].classList.toggle('busy', busy);
        if (busy) chips[i].setAttribute('aria-busy', 'true');
        else chips[i].removeAttribute('aria-busy');
      },
    ),
  );
  chips.forEach((c, i) => c.addEventListener('click', () => void run[i]()));
  // one header button that opens the actions as a menu (the numbered row was a second set of the page's buttons)
  const menu = h(
    'div',
    { class: 'fn-menu', role: 'menu', hidden: true },
    h('div', { class: 'fn-chips', role: 'group', 'aria-label': `${opts.label ?? 'Page functions'} (press 1-${list.length})` }, ...chips),
    related.length
      ? h(
          'nav',
          { class: 'fn-related', 'aria-label': 'Related pages' },
          h('span', { class: 'fn-related-label' }, 'Go to'),
          ...related.map((p) => h('a', { class: 'fn-rel', href: `#${p.route}`, title: p.about }, h('span', { class: 'code-hint' }, p.code), ` ${p.label}`)),
        )
      : null,
  );
  const toggle = h('button', { type: 'button', class: 'btn fn-toggle', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: `Page actions (keys 1-${list.length})` }, icon('grid', 14), ' Actions');
  const close = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) chips[0]?.focus();
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.fn-chip, .fn-rel')) close();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !bar.contains(e.target as Node)) close();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      toggle.focus();
    }
  });
  const bar = h('div', { class: 'fn-bar' }, toggle, menu);
  triggers.set(bar, run);
  return bar;
}
