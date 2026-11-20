/** Shared shell for the edge panels: a heading, a body that loads on its own, and the helper-version gate. */
import { ARRIVES_WITH_UPDATE, engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';

export const EDGE_HELPER_VERSION = 59;

export function edgePanel<T>(opts: { title: string; sub: string; term?: string; request: string; params?: Record<string, unknown>; timeout?: number; minVersion?: number; render: (d: T, body: HTMLElement) => void; className?: string }): HTMLElement {
  const body = h('div', { class: 'xe-body' }, h('div', { class: 'skeleton', style: 'height:120px' }));
  const el = h(
    'section',
    { class: `panel xe-panel ${opts.className ?? ''}` },
    h('div', { class: 'panel-head' }, h('h3', {}, opts.title, opts.term ? infoTip(opts.term) : ''), h('span', { class: 'muted small' }, opts.sub)),
    body,
  );
  if ((helper.version ?? 0) < (opts.minVersion ?? EDGE_HELPER_VERSION)) {
    body.replaceChildren(h('p', { class: 'muted small' }, ARRIVES_WITH_UPDATE));
    return el;
  }
  engineRequest<T>(opts.request, opts.params ?? {}, opts.timeout ?? 60000).then(
    (d) => {
      body.replaceChildren();
      opts.render(d, body);
    },
    (err: Error) => body.replaceChildren(h('p', { class: 'muted small' }, `Couldn’t load: ${err.message}`)),
  );
  return el;
}

/** "Source · time" line under a panel. */
export function sourceLine(...parts: (string | Node)[]): HTMLElement {
  return h('p', { class: 'muted small xe-source' }, ...parts);
}
