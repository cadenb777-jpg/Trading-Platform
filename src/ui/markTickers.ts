/**
 * Marks the tickers in rendered text (AI replies) with data-ticker, so a click opens the security view like
 * everywhere else. Only "$AAPL", "(NASDAQ: AAPL)" forms and known symbols (Nasdaq-100, your watchlist) are marked;
 * code, links and buttons are left alone. `tickerRuns` is pure and tested.
 */
import { state } from '../state';
import { NASDAQ_100 } from './command';
import { TICKER_ATTR, tickersIn } from './tickerCard';

/** The text split into plain runs and ticker runs ({ text, symbol }). */
export function tickerRuns(text: string, known: Iterable<string>): { text: string; symbol?: string }[] {
  const found = tickersIn(text, known, 30);
  if (!found.length) return [{ text }];
  const alt = found.map((s) => s.replace('.', '\\.')).join('|');
  const re = new RegExp(`(^|[^A-Za-z0-9$])(\\$?(?:${alt}))(?![A-Za-z0-9])`, 'g');
  const out: { text: string; symbol?: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index! + m[1].length;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: m[2], symbol: m[2].replace(/^\$/, '') });
    at = start + m[2].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

const SKIP = 'code, pre, a, button, [data-ticker]';

export function markTickers(root: HTMLElement) {
  const known = [...NASDAQ_100, ...state.watchlist.filter((r) => r.provider === 'schwab').map((r) => r.symbol)];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(n.parentElement?.closest(SKIP))) nodes.push(n as Text);
  for (const n of nodes) {
    const runs = tickerRuns(n.data, known);
    if (runs.length < 2 && !runs[0]?.symbol) continue;
    n.replaceWith(
      ...runs.map((r) => {
        if (!r.symbol) return document.createTextNode(r.text);
        const el = document.createElement('span');
        el.setAttribute(TICKER_ATTR, r.symbol);
        el.className = 'ai-ticker';
        el.textContent = r.text;
        return el;
      }),
    );
  }
}
