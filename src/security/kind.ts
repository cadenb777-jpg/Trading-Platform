/**
 * Is a ticker a fund (ETF or mutual fund)? Asked by the security view before it picks its layout, as fast as possible:
 *   1. what the research search already said about it this session (no request at all);
 *   2. helper 102's invest.kind: one live quote's type (cached a week in the helper);
 *   3. older helpers: the board row (quote + a year of closes and dividends: slow, the old way).
 */
import { engineRequest, helper } from '../data/schwab';
import { loadBoard } from './data';
import { isFundRow } from './fund';

export const KIND_HELPER_VERSION = 102;
const KEY = 'tp-kind-hints';
const memo = new Map<string, Promise<boolean>>();

function hints(): Record<string, 'fund' | 'other'> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Remembers what a search result said a ticker is (fund or not) for this session. */
export function rememberKind(symbol: string, fund: boolean) {
  try {
    const all = hints();
    all[symbol.toUpperCase()] = fund ? 'fund' : 'other';
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* not remembered: the quick check still works */
  }
}

export function isFundSymbol(symbol: string): Promise<boolean> {
  const s = symbol.toUpperCase();
  const hint = hints()[s];
  if (hint) return Promise.resolve(hint === 'fund');
  let p = memo.get(s);
  if (!p) {
    p = ((helper.version ?? 0) >= KIND_HELPER_VERSION
      ? engineRequest<{ assetType: string; assetSubType: string }>('invest.kind', { symbol: s }, 20_000).then((r) => isFundRow(r))
      : loadBoard(s).then((b) => isFundRow(b?.row))
    ).catch(() => loadBoard(s).then((b) => isFundRow(b?.row), () => false));
    memo.set(s, p);
    void p.then((fund) => rememberKind(s, fund));
  }
  return p;
}
