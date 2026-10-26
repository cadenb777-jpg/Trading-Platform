type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Elements given a click handler through h() (the ticker card leaves their clicks alone). */
export const clickTargets = new WeakSet<Element>();

/** Tiny helper for building DOM elements: h('button', { class: 'btn', onclick: fn }, 'Click'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
      if (key === 'onclick') clickTargets.add(el);
    }
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/**
 * Makes a clickable row or card usable from the keyboard: Tab reaches it and Enter or Space does what a
 * click does. Keys pressed on a button or link inside it are left alone.
 */
export function activatable<T extends HTMLElement>(el: T): T {
  el.tabIndex = 0;
  el.classList.add('activatable');
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    el.click();
  });
  return el;
}

/** activatable() for every body row of a table whose rows open something on click. */
export function activatableRows(table: HTMLElement) {
  table.querySelectorAll<HTMLElement>('tbody tr').forEach(activatable);
}

/** Opens a dialog box. Returns a function that closes it. */
export function openModal(title: string, body: Node, opts: { wide?: boolean; onClose?: () => void; noAutofocus?: boolean } = {}): () => void {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab' && [...document.querySelectorAll('.modal-backdrop')].pop() === backdrop) {
      // keep Tab inside the top window (e.g. the order confirm window)
      const items = [...backdrop.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = backdrop.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && (document.activeElement === last || !inside)) (e.preventDefault(), first.focus());
    }
  };
  const backdrop = h(
    'div',
    { class: 'modal-backdrop', onmousedown: (e: Event) => e.target === backdrop && close() },
    h(
      'div',
      { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-header' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  if (opts.noAutofocus) backdrop.querySelector<HTMLElement>('.modal-header .icon-btn')?.focus();
  else backdrop.querySelector<HTMLInputElement>('input')?.focus();
  return close;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 2500);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (value / 1e3).toFixed(1) + 'K';
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toPrecision(4);
}

/**
 * Opens a small floating box under `anchor`. Closes on outside click, Escape, or when focus leaves it;
 * Escape and keyboard close put focus back on the anchor. Returns a close function.
 */
export function openPopover(anchor: HTMLElement, content: Node, opts: { align?: 'left' | 'right'; label?: string; onClose?: () => void } = {}): () => void {
  document.querySelector('.popover')?.dispatchEvent(new Event('close'));
  const el = h('div', { class: 'popover', role: 'dialog', 'aria-label': opts.label ?? anchor.getAttribute('aria-label') ?? anchor.textContent?.trim() ?? 'Menu' }, content);
  document.body.append(el);
  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const left = opts.align === 'right' ? rect.right - width : rect.left;
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  // Below the anchor, moved up when it would run off the bottom (e.g. the Data button low in the sidebar).
  el.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - el.offsetHeight - 8))}px`;
  let open = true;
  const close = (refocus = true) => {
    if (!open) return;
    open = false;
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey);
    if (refocus && hadFocus) anchor.focus();
    opts.onClose?.();
  };
  const outside = (n: EventTarget | null) => !(n instanceof Node && (el.contains(n) || anchor.contains(n)));
  const onDown = (e: Event) => outside(e.target) && close(false);
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  el.addEventListener('focusout', (e) => e.relatedTarget && outside(e.relatedTarget) && close(false));
  el.addEventListener('close', () => close(false));
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey);
  return () => close();
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return '';
  const s = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
