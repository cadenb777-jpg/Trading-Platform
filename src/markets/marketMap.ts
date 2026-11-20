/**
 * The Nasdaq-100 market map (Monitor HEAT panel and the Desk "sectors" tile): one block per stock, grouped by sector,
 * block area = market cap (Schwab, helper 96's invest.caps, cached a day), colour = today's move from live quotes.
 * Before the caps arrive (or with an older helper) every block is the same size and the caption says so.
 */
import { engineRequest, helper } from '../data/schwab';
import { subscribeQuote } from '../data/quotes';
import { openSecurity } from '../security/open';
import { SECTOR_LISTS } from '../security/related';
import { h } from '../ui/dom';
import { treemap } from '../ui/viz';

export const CAPS_HELPER_VERSION = 96;

const sgn = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

export function nasdaqMap(o: { height?: number; title?: string; visible?: () => boolean; onLive?: (priced: number) => void } = {}) {
  const groups = Object.entries(SECTOR_LISTS).map(([label, syms]) => ({ label, items: syms.split(' ') }));
  const all = groups.flatMap((g) => g.items);
  const caption = h('span', {}, 'Block size: equal for now (market caps load from Schwab). Colour: today’s move, deepest at ±3%.');
  const map = treemap({ groups, title: o.title ?? 'Nasdaq-100 by sector', format: sgn, onItem: (s) => void openSecurity(s), caption, height: o.height });
  const changes = new Map<string, number>();
  let frame = 0;
  let stops: (() => void)[] = [];

  async function loadCaps() {
    if ((helper.version ?? 0) < CAPS_HELPER_VERSION) {
      caption.textContent = 'Block size: equal (market-cap sizing needs the helper update). Colour: today’s move, deepest at ±3%.';
      return;
    }
    try {
      const r = await engineRequest<{ caps: Record<string, number> }>('invest.caps', { symbols: all }, 60_000);
      const known = Object.values(r.caps).filter((v) => v > 0).sort((a, b) => a - b);
      if (known.length < all.length / 2) throw new Error('too few');
      const median = known[Math.floor(known.length / 2)];
      map.setWeights((s) => r.caps[s] ?? median);
      const missing = all.filter((s) => !r.caps[s]);
      caption.textContent = `Block size: market cap (Schwab)${missing.length ? `; ${missing.join(', ')} shown at a middle size (no cap reported)` : ''}. Colour: today’s move, deepest at ±3%. Click a block to open it.`;
    } catch {
      caption.textContent = 'Block size: equal (Schwab didn’t send market caps this time). Colour: today’s move, deepest at ±3%.';
    }
  }

  return {
    el: map.el,
    /** Starts live colours (and loads market caps once). */
    start() {
      if (stops.length) return;
      void loadCaps();
      stops = all.map((sym) =>
        subscribeQuote({ provider: 'schwab', symbol: sym }, (q) => {
          if (q.last != null && q.prevClose) changes.set(sym, q.last / q.prevClose - 1);
          if (!frame && (o.visible?.() ?? true))
            frame = requestAnimationFrame(() => {
              frame = 0;
              map.update((s) => changes.get(s));
              o.onLive?.(changes.size);
            });
        }),
      );
    },
    /** Repaints from the latest quotes (after being hidden). */
    repaint() {
      map.update((s) => changes.get(s));
    },
    stop() {
      stops.forEach((s) => s());
      stops = [];
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
