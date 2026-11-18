/**
 * Security → Options: the option chain, calls | strike | puts (Bloomberg OMON layout, owner's spec 7.8). One expiry at
 * a time (picker on top), the 16 strikes nearest the price, the price marked as a band between strikes, in-the-money
 * cells shaded, bid / ask / last / delta / volume / open interest per side. Schwab option chain (quotes from helper 87).
 */
import { engineRequest } from '../data/schwab';
import { h } from '../ui/dom';
import { chainWindow, hasQuotes, inTheMoney } from './chain';
import type { ChainStrike, OptionsReply } from './data';
import { fmtCompact } from './format';
import { note, panel, reasonOf } from './ui';

const px = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v <= 0 ? '—' : v.toFixed(2));
const dl = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const qty = (v: number | null | undefined) => (v ? fmtCompact(v) : '—');
const dateText = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });

function grid(d: OptionsReply): HTMLElement {
  const { rows, spotAt } = chainWindow(d.strikes, d.spot);
  if (!rows.length) return note('No strikes for this expiry.');
  const quotes = hasQuotes(rows);
  // columns: [class, header]; the bid/ask/delta/volume ones step aside on a phone (Last and Open int. stay)
  const cols: [string, string][] = quotes
    ? [['oc-x', 'Bid'], ['oc-x', 'Ask'], ['', 'Last'], ['oc-x', 'Delta'], ['oc-x', 'Volume'], ['', 'Open int.']]
    : [['', 'Volume'], ['', 'Open int.']];
  const side = (r: ChainStrike, s: 'call' | 'put') => {
    const itm = inTheMoney(s, r.strike, d.spot) ? ' itm' : '';
    const c = s === 'call';
    const vals = quotes
      ? [px(c ? r.callBid : r.putBid), px(c ? r.callAsk : r.putAsk), px(c ? r.callLast : r.putLast), dl(c ? r.callDelta : r.putDelta), qty(c ? r.callVolume : r.putVolume), qty(c ? r.callOi : r.putOi)]
      : [qty(c ? r.callVolume : r.putVolume), qty(c ? r.callOi : r.putOi)];
    const tds = vals.map((v, i) => h('td', { class: `num ${cols[i][0]}${itm}` }, v));
    return c ? tds : tds.reverse();
  };
  const heads = cols.map(([, x]) => x);
  const body: HTMLElement[] = [];
  rows.forEach((r, i) => {
    if (i === spotAt) body.push(h('tr', { class: 'oc-spot' }, h('td', { colspan: heads.length * 2 + 1 }, `${d.symbol || 'Price'} ${d.spot.toFixed(2)}`)));
    body.push(h('tr', {}, ...side(r, 'call'), h('th', { scope: 'row', class: 'oc-strike' }, r.strike.toFixed(r.strike % 1 ? 1 : 0)), ...side(r, 'put')));
  });
  if (spotAt === rows.length) body.push(h('tr', { class: 'oc-spot' }, h('td', { colspan: heads.length * 2 + 1 }, `${d.symbol || 'Price'} ${d.spot.toFixed(2)}`)));
  return h(
    'div',
    { class: 'sv-table-wrap' },
    h(
      'table',
      { class: 'oc-table' },
      h('thead', {}, h('tr', { class: 'oc-sides' }, h('th', { colspan: heads.length, class: 'oc-calls oc-wide' }, 'Calls'), h('th', { colspan: cols.filter(([k]) => !k).length, class: 'oc-calls oc-narrow' }, 'Calls'), h('th', { class: 'oc-strike' }, 'Strike'), h('th', { colspan: heads.length, class: 'oc-puts oc-wide' }, 'Puts'), h('th', { colspan: cols.filter(([k]) => !k).length, class: 'oc-puts oc-narrow' }, 'Puts')), h('tr', {}, ...cols.map(([k, x]) => h('th', { class: `num ${k}` }, x)), h('th', { class: 'oc-strike' }, ''), ...[...cols].reverse().map(([k, x]) => h('th', { class: `num ${k}` }, x)))),
      h('tbody', {}, ...body),
    ),
    quotes ? '' : note('Bid, ask, last and delta appear with the updated helper (version 87 or newer).'),
  );
}

export function chainPanel(symbol: string, first: OptionsReply): HTMLElement {
  const box = h('div', {}, grid(first));
  const pick = h(
    'select',
    { class: 'input oc-pick', 'aria-label': 'Expiry' },
    ...first.expirations.slice(0, 12).map((e) => h('option', { value: e, selected: e === first.expiration }, dateText(e))),
  ) as HTMLSelectElement;
  pick.addEventListener('change', async () => {
    box.replaceChildren(note('Loading this expiry…'));
    try {
      box.replaceChildren(grid(await engineRequest<OptionsReply>('flow.options', { symbol: symbol.replace(/^\$/, ''), expiration: pick.value }, 45_000)));
    } catch (err) {
      box.replaceChildren(note(`Not available: ${reasonOf(err)}`, 'sv-error'));
    }
  });
  return panel('Option chain', 'Schwab option chain · shaded = in the money', Date.now(), h('div', { class: 'oc-head' }, h('span', { class: 'muted small' }, 'Expiry'), pick), box);
}
