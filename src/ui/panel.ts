/**
 * One panel header for widgets and main cards: a title (with an optional icon), an optional as-of stamp, the panel's
 * own controls, and small icon actions (refresh, pop-out, collapse) always in the same order on the right.
 */
import { h } from './dom';
import { icon, type IconName } from './icons';

export interface PanelHeaderOptions {
  title: string;
  icon?: IconName;
  /** An as-of stamp (asOfStamp().el) or any small muted text. */
  asOf?: Node;
  /** The panel's own controls, between the title and the icon actions. */
  extra?: Node[];
  onRefresh?: () => void;
  /** Opens the full version (its page or a window). */
  onPopOut?: () => void;
  popOutLabel?: string;
  /** The body that collapses; the header gets a collapse button. */
  collapse?: { body: HTMLElement; collapsed?: boolean; onToggle?: (collapsed: boolean) => void };
  /** Leading content (e.g. a drag handle). */
  lead?: Node;
  /** The heading level (h2 / h3). */
  level?: 'h2' | 'h3';
}

export function panelHeader(o: PanelHeaderOptions): HTMLElement {
  const id = `ph-${Math.random().toString(36).slice(2, 9)}`;
  const actions: Node[] = [];
  const btn = (name: IconName, label: string, onclick: () => void, extra: Record<string, string> = {}) =>
    h('button', { type: 'button', class: 'icon-btn ph-act', title: label, 'aria-label': `${label}: ${o.title}`, onclick, ...extra }, icon(name, 16));
  if (o.onRefresh) actions.push(btn('refresh', 'Refresh', o.onRefresh));
  if (o.onPopOut) actions.push(btn('popout', o.popOutLabel ?? 'Open in full', o.onPopOut));
  if (o.collapse) {
    const c = o.collapse;
    let collapsed = !!c.collapsed;
    const toggle = btn('chevron', 'Collapse', () => set(!collapsed), { 'aria-controls': c.body.id || (c.body.id = `${id}-body`) });
    const set = (v: boolean, notify = true) => {
      collapsed = v;
      c.body.hidden = v;
      toggle.setAttribute('aria-expanded', String(!v));
      toggle.title = v ? 'Expand' : 'Collapse';
      toggle.classList.toggle('collapsed', v);
      if (notify) c.onToggle?.(v);
    };
    set(collapsed, false);
    actions.push(toggle);
  }
  return h(
    'div',
    { class: 'panel-head ph' },
    o.lead ?? null,
    h(o.level ?? 'h3', { class: 'ph-title', id }, o.icon ? icon(o.icon, 18) : null, o.icon ? ' ' : null, o.title),
    o.asOf ?? null,
    h('span', { class: 'spacer' }),
    ...(o.extra ?? []),
    actions.length ? h('span', { class: 'ph-actions' }, ...actions) : null,
  );
}
