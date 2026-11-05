/** Stock, fund, index or future: picks a row's "Go to" list (goTo.ts). Pure; tested in symbolKind.test.ts. */
import { CATALOG_ETFS } from './catalog';

export type SymbolKind = 'stock' | 'fund' | 'index' | 'future';

/**
 * Schwab calls ETFs "EQUITY" too; its assetSubType ('ETF', 'ETN', 'COE' ...) tells them apart (helpers that send it).
 * Without it, the catalog's ETF groups decide. Mutual funds and other non-equity types are funds.
 */
export function symbolKind(symbol: string, assetType?: string, assetSubType?: string): SymbolKind {
  if (symbol.startsWith('/')) return 'future';
  if (symbol.startsWith('$') || assetType === 'INDEX') return 'index';
  if (assetType && assetType !== 'EQUITY') return 'fund'; // MUTUAL_FUND, ...
  if (assetSubType) return /^(ETF|ETN)$/i.test(assetSubType) ? 'fund' : 'stock';
  return CATALOG_ETFS.has(symbol.toUpperCase()) ? 'fund' : 'stock';
}
