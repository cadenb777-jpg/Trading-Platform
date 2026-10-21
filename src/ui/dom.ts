type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny helper for building DOM elements: h('button', { class: 'btn', onclick: fn }, 'Click'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** Opens a dialog box. Returns a function that closes it. */
export function openModal(title: string, body: Node, opts: { wide?: boolean; onClose?: () => void } = {}): () => void {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
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
  backdrop.querySelector<HTMLInputElement>('input')?.focus();
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
