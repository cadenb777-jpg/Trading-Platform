/**
 * Related securities for the security view's "Related" row (Bloomberg's RV peer group, simplified): Nasdaq-100 peers
 * in the same plain sector (the same lists as helper/engine/scanner.py _SECTOR_LISTS; a test checks they match), a
 * sector ETF, the broad index ETF, and the futures market whose COT positioning covers the stock.
 */

export const SECTOR_LISTS: Record<string, string> = {
  Semiconductors: 'NVDA AVGO AMD ASML QCOM TXN AMAT LRCX MU ADI KLAC INTC ARM MRVL NXPI MCHP ON GFS',
  Software: 'MSFT ADBE INTU PANW CRWD SNPS CDNS FTNT ADSK WDAY ROP TEAM DDOG ZS MDB PLTR APP TTD MSTR SHOP',
  'Hardware & IT services': 'AAPL CSCO CTSH CDW',
  Communication: 'GOOGL META NFLX TMUS CMCSA CHTR EA TTWO WBD',
  Consumer: 'AMZN TSLA COST PEP BKNG SBUX MELI PDD ABNB MAR ORLY ROST LULU DASH MDLZ KDP MNST KHC CCEP',
  'Health care': 'AZN ISRG AMGN GILD VRTX REGN IDXX DXCM BIIB GEHC',
  Industrials: 'HON ADP CTAS CSX PCAR CPRT PAYX FAST ODFL VRSK AXON TRI',
  'Utilities, energy & materials': 'CEG AEP XEL EXC FANG BKR LIN',
  'Financials & real estate': 'PYPL CSGP',
};

/** A sector ETF for each plain sector (liquid, free to chart). */
export const SECTOR_ETF: Record<string, [string, string]> = {
  Semiconductors: ['SMH', 'VanEck Semiconductor ETF'],
  Software: ['IGV', 'iShares Expanded Tech-Software ETF'],
  'Hardware & IT services': ['XLK', 'Technology Select Sector SPDR'],
  Communication: ['XLC', 'Communication Services Select Sector SPDR'],
  Consumer: ['XLY', 'Consumer Discretionary Select Sector SPDR'],
  'Health care': ['XLV', 'Health Care Select Sector SPDR'],
  Industrials: ['XLI', 'Industrial Select Sector SPDR'],
  'Utilities, energy & materials': ['XLU', 'Utilities Select Sector SPDR'],
  'Financials & real estate': ['XLF', 'Financial Select Sector SPDR'],
};

const SECTOR_OF: Record<string, string> = Object.fromEntries(Object.entries(SECTOR_LISTS).flatMap(([name, syms]) => syms.split(' ').map((s) => [s, name])));

export const sectorOf = (symbol: string): string | null => SECTOR_OF[symbol.toUpperCase()] ?? null;

export interface Related {
  sector: string | null;
  peers: string[];
  etfs: [string, string][];
  /** The futures market for the COT reading ("/NQ" for Nasdaq-100 members, else "/ES"). */
  futures: [string, string];
}

/** Peers (up to `max`, the symbol itself left out), ETFs and the COT future for a symbol. */
export function relatedFor(symbol: string, max = 8): Related {
  const s = symbol.toUpperCase();
  const sector = sectorOf(s);
  const peers = sector ? SECTOR_LISTS[sector].split(' ').filter((p) => p !== s).slice(0, max) : [];
  const etfs: [string, string][] = [];
  if (sector) etfs.push(SECTOR_ETF[sector]);
  etfs.push(sector ? ['QQQ', 'Invesco QQQ (Nasdaq-100)'] : ['SPY', 'SPDR S&P 500 ETF']);
  return { sector, peers, etfs: etfs.filter(([e]) => e !== s), futures: sector ? ['/NQ', 'E-mini Nasdaq-100'] : ['/ES', 'E-mini S&P 500'] };
}
