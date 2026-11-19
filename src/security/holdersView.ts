/**
 * Security → Holders: the biggest institutional holders by name (Bloomberg HDS, owner's spec 7.16) with what each did
 * last quarter, and the biggest sellers. SEC Form 13F from the Prospecting download (helper 89 sends the names).
 */
import { h } from '../ui/dom';
import type { HolderRow } from './data';
import { fmtCompact } from './format';

const STATUS: Record<NonNullable<HolderRow['status']>, string> = { new: 'New', added: 'Added', reduced: 'Cut', same: 'Held', soldOut: 'Sold out' };

/** "The 10 biggest holders own 41% of the shares reported on 13F; 6 added, 3 cut, 1 new." (pure, tested) */
export function holderWords(top: HolderRow[]): string {
  if (!top.length) return '';
  const ten = top.slice(0, 10);
  const share = ten.reduce((a, r) => a + (r.share ?? 0), 0);
  const count = (s: HolderRow['status']) => ten.filter((r) => r.status === s).length;
  const moves = [count('added') && `${count('added')} added`, count('reduced') && `${count('reduced')} cut`, count('new') && `${count('new')} new`, count('same') && `${count('same')} unchanged`].filter(Boolean);
  return `The ${ten.length} biggest holders own ${Math.round(share * 100)}% of the shares reported on 13F${moves.length ? `; last quarter ${moves.join(', ')}` : ''}.`;
}

const signed = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtCompact(Math.abs(v))}`);
const tone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down');
const tag = (s: HolderRow['status']) => (s ? h('span', { class: `hds-tag ${s}` }, STATUS[s]) : '');

export function holdersTable(top: HolderRow[]): HTMLElement {
  return h(
    'div',
    { class: 'sv-table-wrap' },
    h(
      'table',
      { class: 'rv-table hds-table' },
      h('thead', {}, h('tr', {}, h('th', { class: 'num-col' }, '#'), h('th', {}, 'Holder'), h('th', { class: 'num' }, 'Shares'), h('th', { class: 'num' }, 'Value'), h('th', { class: 'num', title: 'Part of all shares reported on 13F' }, 'Of 13F'), h('th', { class: 'num' }, 'Change'), h('th', {}, ''))),
      h(
        'tbody',
        {},
        ...top.map((r, i) =>
          h(
            'tr',
            {},
            h('td', { class: 'num-col' }, String(i + 1)),
            h('th', { scope: 'row' }, h('span', { class: 'hds-name', title: r.name }, r.name)),
            h('td', { class: 'num' }, fmtCompact(r.shares)),
            h('td', { class: 'num' }, r.value != null ? fmtCompact(r.value, { money: true }) : '—'),
            h('td', { class: 'num' }, r.share != null ? `${(r.share * 100).toFixed(1)}%` : '—'),
            h('td', { class: `num ${tone(r.change)}` }, signed(r.change)),
            h('td', {}, tag(r.status)),
          ),
        ),
      ),
    ),
  );
}

export function sellersList(rows: HolderRow[]): HTMLElement {
  return h(
    'ol',
    { class: 'hds-sellers' },
    ...rows.map((r) => h('li', {}, h('span', { class: 'hds-name', title: r.name }, r.name), h('span', { class: 'num down' }, signed(r.change)), tag(r.status))),
  );
}
