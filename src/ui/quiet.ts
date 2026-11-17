/**
 * Calm reading (owner, 2026-11-17: "there is so much reading"): long explanations under page titles and beside
 * panel headings become a small "i" that shows the text on hover or focus. The text stays in the page (hidden), so
 * code that updates it keeps working and screen readers still reach it through the tip's label, read fresh each time.
 * Short notes (a date, a count, "as of 10:42") stay visible. Runs on pages as they are added (one observer on the
 * page area, only new nodes are looked at).
 */
import { h } from './dom';

/** Long enough to be an explanation rather than a status (pure, tested). */
export function isExplanation(text: string, hasChildren: boolean): boolean {
  return !hasChildren && text.trim().length > 48;
}

const SELECTOR = '.ap-header p, .panel-head > .muted.small, .panel-head > span.muted, .panel > p.muted.small, .panel > p.muted, .panel > p.ap-note, .stat-card > .stat-hint';

function quieten(el: HTMLElement) {
  if (el.dataset.quiet || el.closest('.no-quiet')) return;
  el.dataset.quiet = '1';
  if (!isExplanation(el.textContent ?? '', el.childElementCount > 0)) return;
  const tip = h('span', { class: 'quiet-tip', tabindex: 0, role: 'button', 'aria-label': 'About this' }, 'i');
  const sync = () => {
    const text = (el.textContent ?? '').trim();
    tip.title = text;
    tip.setAttribute('aria-label', text);
  };
  sync();
  tip.addEventListener('mouseenter', sync);
  tip.addEventListener('focus', sync);
  el.classList.add('quiet-hidden');
  el.after(tip);
  // a page title's tip sits next to the title; a panel's explanation sits next to the panel's heading
  const header = el.closest('.ap-header');
  if (header) header.querySelector('h1')?.append(tip);
  else if (el.classList.contains('stat-hint')) el.parentElement?.querySelector('.stat-label')?.append(tip);
  else if (!el.closest('.panel-head')) el.closest('.panel')?.querySelector(':scope > .panel-head h3')?.append(tip);
}

export function quietTexts(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach(quieten);
}

/** Watches the page area: anything added later (pages built on first visit, panels drawn after data) is quietened. */
export function watchQuiet(area: HTMLElement) {
  quietTexts(area);
  let queued: HTMLElement[] = [];
  let frame = 0;
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) queued.push(n);
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const batch = queued;
        queued = [];
        for (const n of batch) {
          if (!n.isConnected) continue;
          if (n.matches(SELECTOR)) quieten(n);
          quietTexts(n);
        }
      });
  }).observe(area, { childList: true, subtree: true });
}
