/**
 * "Why it's moving" for Home (T6): the Monitor's cross-market read under the greeting. Additive, not duplicative: the
 * greeting strip already shows the futures prices, so this shows only what they mean together (src/term/read.ts:
 * regime, curve, Fed, unusual moves, crowded positioning, leadership, haven demand). Opens from the saved copy at once
 * (src/data/saved.ts) and refreshes every minute while Home is open.
 */
import type { FedOdds } from '../edge/fedOdds';
import type { BoardRow } from '../invest/shared';
import { helper } from '../data/schwab';
import { savedThenFresh } from '../data/saved';
import { h } from '../ui/dom';
import { marketRead, type CurvePoint, type FutRow } from './read';

const SECTORS: [string, string][] = [
  ['XLK', 'Technology'], ['XLC', 'Communications'], ['XLY', 'Discretionary'], ['XLF', 'Financials'], ['XLI', 'Industrials'], ['XLV', 'Health care'],
  ['XLP', 'Staples'], ['XLE', 'Energy'], ['XLB', 'Materials'], ['XLRE', 'Real estate'], ['XLU', 'Utilities'],
];
const SHORT: Record<string, string> = { ES: 'S&P futures', NQ: 'Nasdaq futures', CL: 'WTI crude', GC: 'Gold', DX: 'Dollar', ZN: '10Y note', VX: 'VIX futures', NG: 'Natural gas', SI: 'Silver', HG: 'Copper', BTC: 'Bitcoin', '6J': 'Yen', '6E': 'Euro' };

export function createMarketReadWidget() {
  const body = h('div', { class: 'home-read' }, h('p', { class: 'term-empty' }, 'The read appears once prices, futures and the curve have loaded.'));
  const asOf = h('span', { class: 'muted small' });
  const board = new Map<string, BoardRow>();
  let futures: FutRow[] = [];
  let curve: CurvePoint[] = [];
  let fed: { change: number; by: string } | null = null;

  const draw = () => {
    const spy = board.get('SPY')?.change ?? null;
    const markets: Record<string, number | null | undefined> = {};
    for (const s of ['SPY', 'IWM', 'EWJ', 'FXI']) markets[s] = board.get(s)?.change;
    const lines = marketRead({
      futures,
      curve,
      fed,
      sectorsVsSpx: spy == null ? [] : SECTORS.map(([s, name]) => ({ name, rel: (board.get(s)?.change ?? NaN) - spy })).filter((x) => Number.isFinite(x.rel)),
      markets,
    });
    if (!lines.length) return;
    body.replaceChildren(h('dl', { class: 'term-read' }, ...lines.flatMap((l) => [h('dt', {}, l.label), h('dd', {}, l.text)])));
  };

  async function refresh() {
    if (!helper.isConnected) return;
    const stamp = (at: number, old: boolean) => (asOf.textContent = old ? 'saved copy · refreshing…' : `Rules, not AI · ${new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
    await Promise.allSettled([
      savedThenFresh<{ rows: FutRow[] }>('futures.board', {}, 90000, (b, at, old) => {
        futures = b.rows.map((r) => ({ ...r, name: SHORT[r.root] ?? r.name }));
        draw();
        stamp(at, old);
      }),
      savedThenFresh<{ curve: CurvePoint[] }>('macro.curve', {}, 60000, (d) => ((curve = d.curve ?? []), draw())),
      savedThenFresh<FedOdds>('macro.fedodds', {}, 60000, (d) => {
        const third = d.meetings[Math.min(2, d.meetings.length - 1)];
        fed = third ? { change: third.expectedChange, by: new Date(`${third.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) } : null;
        draw();
      }),
      savedThenFresh<{ rows: BoardRow[] }>('invest.board', { symbols: ['SPY', 'IWM', 'EWJ', 'FXI', ...SECTORS.map(([s]) => s)] }, 90000, (d) => {
        for (const r of d.rows) board.set(r.symbol, r);
        draw();
      }),
    ]);
  }

  return { body, asOf, refresh };
}
