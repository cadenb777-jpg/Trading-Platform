/**
 * Shared FRED plumbing for the Macro panels (conditionsView, expectationsView, underlyingView, wagesActivityView):
 * the raw request, the older-of-two-replies rule for as-of stamps, series links, the panel shell and the Retry line.
 * Its own module so the panel modules never import each other.
 */
import { engineRequest } from '../data/schwab';
import { h } from '../ui/dom';
import { openFredWindow } from '../ui/fredWindow';
import type { Point } from './conditions';

type Raw = { data: Point[] };
/** One FRED series and its reply (the reply carries the fetch time for the as-of stamp). The helper loads FRED from
 * 2006, so 8,000 readings keeps every daily reading it has (about 5,200 by 2026); `since` (helper 105) asks for the
 * full history from that date (older helpers ignore it and send 2006 onwards, which the panels' words then say). */
export const raw = (series: string, since?: string) =>
  engineRequest<Raw>('macro.series', { series, raw: true, limit: 8000, ...(since ? { since } : {}) }, 45_000).then((reply) => ({ reply, data: reply.data.filter((p) => Number.isFinite(p.value)) }));
type Prov = { provenance?: { fetchedAt?: number; stale?: boolean } };
/** The older of two replies (or the stale saved one), so a panel's stamp never looks fresher than its oldest figure. */
export const older = (a: unknown, b: unknown) => {
  const pa = (a as Prov)?.provenance;
  const pb = (b as Prov)?.provenance;
  if (!pb) return a;
  if (!pa) return b;
  if (pb.stale && !pa.stale) return b;
  if (pa.stale && !pb.stale) return a;
  return (pb.fetchedAt ?? Infinity) < (pa.fetchedAt ?? Infinity) ? b : a;
};
export const link = (id: string, name: string, unit: string) => h('button', { class: 'link-btn', type: 'button', onclick: () => openFredWindow(id, name, unit) }, id);

export function panel(title: string, sub: string, body: HTMLElement, stamp: HTMLElement) {
  return h('section', { class: 'panel cond-panel' }, h('div', { class: 'panel-head' }, h('h3', {}, title), h('span', { class: 'muted small' }, sub), h('span', { class: 'spacer' }), stamp), body);
}

/** A failure line with Retry, which builds the panel again in place. */
export function failed(section: () => HTMLElement, what: string, rebuild: () => HTMLElement): HTMLElement {
  return h(
    'p',
    { class: 'muted small' },
    `${what} couldn’t be loaded from FRED right now. `,
    h('button', { class: 'btn small', type: 'button', onclick: () => section().replaceWith(rebuild()) }, 'Retry'),
  );
}
