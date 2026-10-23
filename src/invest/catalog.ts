/**
 * What the Investments page shows: the market boards for each section, and a directory of well-known
 * evergreen private funds (non-traded REITs and BDCs, interval and tender-offer funds). Fund data itself comes
 * live from SEC filings through the helper; this list only names the funds and describes them.
 */

export type Section = 'overview' | 'stocks' | 'etfs' | 'bonds' | 'alts' | 'crypto' | 'commodities';

export interface BoardGroup {
  title: string;
  note?: string;
  /** [symbol, short label] */
  symbols: [string, string][];
  /** Hide rows Schwab has no price for (e.g. futures outside trading hours). */
  hideEmpty?: boolean;
}

export const SECTIONS: { id: Section; label: string; blurb: string; headline: [string, string] }[] = [
  { id: 'overview', label: 'All markets', blurb: 'Every asset class at a glance', headline: ['$SPX', 'S&P 500'] },
  { id: 'stocks', label: 'Stocks', blurb: 'Indexes, sectors, biggest movers', headline: ['$COMPX', 'Nasdaq'] },
  { id: 'etfs', label: 'ETFs', blurb: 'Core, international, themes, income', headline: ['VTI', 'Total US market'] },
  { id: 'bonds', label: 'Bonds', blurb: 'Yields, Treasuries, CUSIP lookup, calculator', headline: ['AGG', 'US bonds'] },
  { id: 'alts', label: 'Alternatives', blurb: 'Private funds, private credit, real estate', headline: ['PSP', 'Listed private equity'] },
  { id: 'crypto', label: 'Crypto', blurb: 'Coins, crypto ETFs and stocks', headline: ['IBIT', 'Bitcoin ETF'] },
  { id: 'commodities', label: 'Commodities', blurb: 'Gold, oil, metals, farm goods', headline: ['GLD', 'Gold'] },
];

export const BOARDS: Record<Exclude<Section, 'crypto'>, BoardGroup[]> & { crypto: BoardGroup[] } = {
  overview: [
    {
      title: 'Market pulse',
      note: 'One benchmark for each kind of investment.',
      symbols: [
        ['$SPX', 'US large companies (S&P 500)'],
        ['$COMPX', 'Nasdaq Composite'],
        ['$RUT', 'US small companies (Russell 2000)'],
        ['VXUS', 'International stocks'],
        ['VWO', 'Emerging markets'],
        ['AGG', 'US investment-grade bonds'],
        ['TLT', 'Long-term Treasuries'],
        ['HYG', 'High-yield bonds'],
        ['MUB', 'Municipal bonds'],
        ['BIZD', 'Private credit (BDCs)'],
        ['PSP', 'Listed private equity'],
        ['VNQ', 'Real estate (REITs)'],
        ['QAI', 'Hedge-fund style (multi-strategy)'],
        ['GLD', 'Gold'],
        ['USO', 'Oil'],
        ['IBIT', 'Bitcoin'],
        ['$VIX', 'Volatility (VIX)'],
      ],
    },
  ],
  stocks: [
    { title: 'Major indexes', symbols: [['$SPX', 'S&P 500'], ['$DJI', 'Dow Jones'], ['$COMPX', 'Nasdaq Composite'], ['$RUT', 'Russell 2000'], ['$VIX', 'VIX (fear gauge)']] },
    {
      title: 'Sectors',
      note: 'The S&P 500 split into its 11 sectors (SPDR sector ETFs).',
      symbols: [
        ['XLK', 'Technology'], ['XLC', 'Communication'], ['XLY', 'Consumer discretionary'], ['XLF', 'Financials'], ['XLV', 'Health care'],
        ['XLI', 'Industrials'], ['XLE', 'Energy'], ['XLP', 'Consumer staples'], ['XLB', 'Materials'], ['XLU', 'Utilities'], ['XLRE', 'Real estate'],
      ],
    },
    {
      title: 'Largest companies',
      symbols: [
        ['NVDA', 'Nvidia'], ['MSFT', 'Microsoft'], ['AAPL', 'Apple'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta'], ['AVGO', 'Broadcom'],
        ['TSLA', 'Tesla'], ['JPM', 'JPMorgan'], ['LLY', 'Eli Lilly'], ['V', 'Visa'], ['WMT', 'Walmart'], ['XOM', 'Exxon Mobil'],
      ],
    },
  ],
  etfs: [
    { title: 'Core US', symbols: [['SPY', 'S&P 500'], ['VOO', 'S&P 500 (Vanguard)'], ['VTI', 'Total US market'], ['QQQ', 'Nasdaq-100'], ['IWM', 'Russell 2000'], ['DIA', 'Dow Jones'], ['RSP', 'S&P 500 equal weight']] },
    { title: 'International', symbols: [['VXUS', 'Total international'], ['VEA', 'Developed markets'], ['VWO', 'Emerging markets'], ['EFA', 'EAFE'], ['EWJ', 'Japan'], ['INDA', 'India'], ['FXI', 'China large caps']] },
    { title: 'Dividends & income', symbols: [['SCHD', 'US dividend'], ['VYM', 'High dividend yield'], ['DGRO', 'Dividend growth'], ['JEPI', 'Equity premium income'], ['JEPQ', 'Nasdaq premium income']] },
    { title: 'Themes', symbols: [['SMH', 'Semiconductors'], ['IGV', 'Software'], ['XBI', 'Biotech'], ['ITA', 'Aerospace & defense'], ['ARKK', 'Innovation'], ['ICLN', 'Clean energy'], ['URA', 'Uranium']] },
    { title: 'Bond ETFs', symbols: [['BND', 'Total bond market'], ['AGG', 'US aggregate'], ['SGOV', '0-3 month T-bills'], ['IEF', '7-10 year Treasuries'], ['TLT', '20+ year Treasuries'], ['LQD', 'Corporate bonds'], ['HYG', 'High yield'], ['MUB', 'Municipal']] },
  ],
  bonds: [
    { title: 'Treasuries', symbols: [['SGOV', '0-3 month T-bills'], ['SHY', '1-3 years'], ['IEI', '3-7 years'], ['IEF', '7-10 years'], ['TLT', '20+ years'], ['TIP', 'Inflation-protected (TIPS)']] },
    { title: 'Core & corporate', symbols: [['AGG', 'US aggregate'], ['BND', 'Total bond market'], ['LQD', 'Investment-grade corporate'], ['VCIT', 'Intermediate corporate'], ['HYG', 'High yield'], ['JNK', 'High yield (SPDR)']] },
    { title: 'Municipal', symbols: [['MUB', 'National munis'], ['VTEB', 'Tax-exempt bonds'], ['HYD', 'High-yield munis'], ['SUB', 'Short-term munis']] },
    { title: 'Loans, CLOs & global', symbols: [['BKLN', 'Senior loans'], ['SRLN', 'Senior loans (SPDR)'], ['JAAA', 'AAA CLOs'], ['EMB', 'Emerging-market bonds'], ['BNDX', 'International bonds (hedged)']] },
  ],
  alts: [
    {
      title: 'Alternative asset managers',
      note: 'The firms that run the private funds; their stocks move with fundraising and deal activity.',
      symbols: [['BX', 'Blackstone'], ['KKR', 'KKR'], ['APO', 'Apollo'], ['ARES', 'Ares'], ['OWL', 'Blue Owl'], ['CG', 'Carlyle'], ['TPG', 'TPG'], ['BN', 'Brookfield'], ['HLNE', 'Hamilton Lane'], ['STEP', 'StepStone']],
    },
    {
      title: 'Private credit (listed BDCs)',
      note: 'Business development companies lend to private companies — the public version of private credit funds.',
      symbols: [['BIZD', 'BDC index ETF'], ['ARCC', 'Ares Capital'], ['OBDC', 'Blue Owl Capital Corp'], ['BXSL', 'Blackstone Secured Lending'], ['FSK', 'FS KKR Capital'], ['MAIN', 'Main Street Capital'], ['HTGC', 'Hercules Capital'], ['GBDC', 'Golub Capital BDC']],
    },
    { title: 'Private equity & venture (listed)', symbols: [['PSP', 'Global listed private equity'], ['XOVR', 'Private-public crossover']] },
    { title: 'Real estate', symbols: [['VNQ', 'US REITs'], ['PLD', 'Prologis (industrial)'], ['O', 'Realty Income (net lease)'], ['AMT', 'American Tower'], ['EQIX', 'Equinix (data centers)'], ['WELL', 'Welltower (healthcare)']] },
    { title: 'Infrastructure', symbols: [['IGF', 'Global infrastructure'], ['PAVE', 'US infrastructure'], ['AMLP', 'Energy pipelines (MLPs)']] },
    { title: 'Hedge-fund style', symbols: [['QAI', 'Multi-strategy'], ['DBMF', 'Managed futures'], ['KMLM', 'Managed futures (KFA)'], ['MNA', 'Merger arbitrage'], ['BTAL', 'Anti-beta (market neutral)']] },
  ],
  crypto: [
    { title: 'Crypto funds & stocks', symbols: [['IBIT', 'iShares Bitcoin Trust'], ['FBTC', 'Fidelity Bitcoin'], ['ETHA', 'iShares Ethereum'], ['COIN', 'Coinbase'], ['MSTR', 'Strategy (MicroStrategy)'], ['HOOD', 'Robinhood'], ['MARA', 'MARA Holdings']] },
  ],
  commodities: [
    { title: 'Metals', symbols: [['GLD', 'Gold'], ['IAU', 'Gold (iShares)'], ['SLV', 'Silver'], ['PPLT', 'Platinum'], ['CPER', 'Copper']] },
    { title: 'Energy', symbols: [['USO', 'Crude oil (WTI)'], ['BNO', 'Brent oil'], ['UNG', 'Natural gas'], ['UGA', 'Gasoline']] },
    { title: 'Agriculture', symbols: [['DBA', 'Agriculture basket'], ['CORN', 'Corn'], ['WEAT', 'Wheat'], ['SOYB', 'Soybeans']] },
    { title: 'Broad baskets', symbols: [['DBC', 'Commodity index'], ['PDBC', 'Commodity strategy'], ['GSG', 'S&P GSCI']] },
    { title: 'Futures (live)', note: 'Front-month futures prices from Schwab.', hideEmpty: true, symbols: [['/GC', 'Gold'], ['/SI', 'Silver'], ['/CL', 'Crude oil'], ['/NG', 'Natural gas'], ['/HG', 'Copper'], ['/ZC', 'Corn']] },
  ],
};

/** Live crypto prices from Coinbase (24-hour change). */
export const CRYPTO_COINS: [string, string][] = [
  ['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['SOL-USD', 'Solana'], ['XRP-USD', 'XRP'], ['DOGE-USD', 'Dogecoin'],
  ['ADA-USD', 'Cardano'], ['AVAX-USD', 'Avalanche'], ['LINK-USD', 'Chainlink'], ['LTC-USD', 'Litecoin'],
];

export type Structure = 'Non-traded REIT' | 'Non-traded BDC' | 'Non-traded LLC' | 'Interval fund' | 'Tender-offer fund' | 'Evergreen private fund' | 'Listed BDC';
export type Strategy = 'Private credit' | 'Real estate' | 'Private equity' | 'Infrastructure' | 'Venture & growth';

/** How each kind of fund typically works (terms vary by fund; the fund's prospectus has the real ones). */
export const STRUCTURES: Record<Structure, string> = {
  'Non-traded REIT':
    'Owns real estate directly and is valued monthly (NAV) instead of trading on an exchange. You buy at the monthly NAV; withdrawals usually go through a share repurchase plan, typically limited to about 2% of NAV a month and 5% a quarter, and it can be limited or paused.',
  'Non-traded BDC':
    'A business development company that lends to private, mostly mid-sized companies (private credit). Priced at a monthly NAV with monthly subscriptions; liquidity usually comes from quarterly repurchase offers, typically up to 5% of shares.',
  'Non-traded LLC':
    'A company that buys and holds controlling stakes in private businesses (private equity), sold to individual investors instead of trading on an exchange. It files 10-Ks and 10-Qs like a public company, sets a NAV per share for each share class (usually monthly), and offers limited quarterly share repurchases that can be cut or paused.',
  'Interval fund':
    'An SEC-registered fund that must offer to buy back a set share (5–25%) of its shares at regular intervals, usually quarterly. Often has a ticker and a daily NAV, and is open to non-accredited investors.',
  'Tender-offer fund':
    'An SEC-registered fund whose board decides each quarter whether to offer to buy back shares (commonly up to 5%). Usually needs accredited or qualified investors and has a monthly NAV.',
  'Evergreen private fund':
    'A perpetual private fund for accredited or qualified investors: monthly subscriptions, monthly NAV, and limited quarterly liquidity that can be gated. Typically sold through private banks and platforms like iCapital.',
  'Listed BDC': 'A business development company that trades on the stock exchange, so it has a live price that can be above or below its NAV.',
};

export interface PrivateFund {
  id: string;
  name: string;
  short: string;
  manager: string;
  managerTicker?: string;
  strategy: Strategy;
  structure: Structure;
  /** The fund's own website, where only well known. */
  site?: string;
  ticker?: string;
}

const fund = (id: string, name: string, short: string, manager: string, strategy: Strategy, structure: Structure, extra: Partial<PrivateFund> = {}): PrivateFund => ({
  id, name, short, manager, strategy, structure, managerTicker: MANAGER_TICKERS[manager], ...extra,
});

export const MANAGER_TICKERS: Record<string, string> = {
  Blackstone: 'BX', 'Blue Owl': 'OWL', Apollo: 'APO', KKR: 'KKR', Ares: 'ARES', Brookfield: 'BN', Oaktree: 'BN', HPS: 'BLK',
  'Morgan Stanley': 'MS', 'J.P. Morgan': 'JPM', 'Goldman Sachs': 'GS', Carlyle: 'CG', 'Hamilton Lane': 'HLNE', StepStone: 'STEP',
  'T. Rowe Price': 'TROW', Invesco: 'IVZ', AMG: 'AMG',
};

export const MANAGER_SITES: Record<string, string> = {
  Blackstone: 'https://www.blackstone.com', 'Blue Owl': 'https://www.blueowl.com', Apollo: 'https://www.apollo.com', KKR: 'https://www.kkr.com',
  Ares: 'https://www.aresmgmt.com', Starwood: 'https://www.starwoodcapital.com', Brookfield: 'https://www.brookfield.com', HPS: 'https://www.hpspartners.com',
  Oaktree: 'https://www.oaktreecapital.com', Golub: 'https://golubcapital.com', 'Morgan Stanley': 'https://www.morganstanley.com', 'J.P. Morgan': 'https://am.jpmorgan.com',
  'Goldman Sachs': 'https://am.gs.com', Carlyle: 'https://www.carlyle.com', 'Hamilton Lane': 'https://www.hamiltonlane.com', StepStone: 'https://www.stepstonegroup.com',
  'Partners Group': 'https://www.partnersgroup.com', Cliffwater: 'https://www.cliffwater.com', Fidelity: 'https://www.fidelity.com', 'T. Rowe Price': 'https://www.troweprice.com',
  Nuveen: 'https://www.nuveen.com', Invesco: 'https://www.invesco.com', iCapital: 'https://icapital.com', PIMCO: 'https://www.pimco.com', 'Bain Capital': 'https://www.baincapital.com',
  AMG: 'https://www.amg.com', Hines: 'https://www.hines.com', 'CNL Financial Group': 'https://www.cnl.com',
};

export const PRIVATE_FUNDS: PrivateFund[] = [
  fund('breit', 'Blackstone Real Estate Income Trust', 'BREIT', 'Blackstone', 'Real estate', 'Non-traded REIT', { site: 'https://www.breit.com' }),
  fund('bcred', 'Blackstone Private Credit Fund', 'BCRED', 'Blackstone', 'Private credit', 'Non-traded BDC', { site: 'https://www.bcred.com' }),
  fund('bxpe', 'Blackstone Private Equity Strategies Fund', 'BXPE', 'Blackstone', 'Private equity', 'Evergreen private fund'),
  fund('cnlsc', 'CNL Strategic Capital', 'CNL SC', 'CNL Financial Group', 'Private equity', 'Non-traded LLC', { site: 'https://www.cnlstrategiccapital.com' }),
  fund('bxinfra', 'Blackstone Infrastructure Strategies', 'BXINFRA', 'Blackstone', 'Infrastructure', 'Evergreen private fund'),
  fund('bmacx', 'Blackstone Private Multi-Asset Credit and Income Fund', 'BMACX', 'Blackstone', 'Private credit', 'Interval fund'),
  fund('bxsl', 'Blackstone Secured Lending Fund', 'BXSL', 'Blackstone', 'Private credit', 'Listed BDC', { ticker: 'BXSL' }),
  fund('ocic', 'Blue Owl Credit Income Corp', 'OCIC', 'Blue Owl', 'Private credit', 'Non-traded BDC'),
  fund('otic', 'Blue Owl Technology Income Corp', 'OTIC', 'Blue Owl', 'Private credit', 'Non-traded BDC'),
  fund('orent', 'Blue Owl Real Estate Net Lease Trust', 'ORENT', 'Blue Owl', 'Real estate', 'Non-traded REIT'),
  fund('obdc', 'Blue Owl Capital Corporation', 'OBDC', 'Blue Owl', 'Private credit', 'Listed BDC', { ticker: 'OBDC' }),
  fund('ads', 'Apollo Debt Solutions BDC', 'ADS', 'Apollo', 'Private credit', 'Non-traded BDC'),
  fund('aris', 'Apollo Realty Income Solutions', 'ARIS', 'Apollo', 'Real estate', 'Non-traded REIT'),
  fund('adref', 'Apollo Diversified Real Estate Fund', 'Diversified RE', 'Apollo', 'Real estate', 'Interval fund'),
  fund('adcf', 'Apollo Diversified Credit Fund', 'Diversified Credit', 'Apollo', 'Private credit', 'Interval fund'),
  fund('kfit', 'KKR FS Income Trust', 'K-FIT', 'KKR', 'Private credit', 'Non-traded BDC'),
  fund('kpec', 'KKR Private Equity Conglomerate', 'K-PEC', 'KKR', 'Private equity', 'Evergreen private fund'),
  fund('kinfra', 'KKR Infrastructure Conglomerate', 'K-INFRA', 'KKR', 'Infrastructure', 'Evergreen private fund'),
  fund('krest', 'KKR Real Estate Select Trust', 'KREST', 'KKR', 'Real estate', 'Tender-offer fund'),
  fund('asif', 'Ares Strategic Income Fund', 'ASIF', 'Ares', 'Private credit', 'Non-traded BDC'),
  fund('aireit', 'Ares Industrial Real Estate Income Trust', 'AIREIT', 'Ares', 'Real estate', 'Non-traded REIT'),
  fund('areit', 'Ares Real Estate Income Trust', 'AREIT', 'Ares', 'Real estate', 'Non-traded REIT'),
  fund('apmf', 'Ares Private Markets Fund', 'APMF', 'Ares', 'Private equity', 'Tender-offer fund'),
  fund('sreit', 'Starwood Real Estate Income Trust', 'SREIT', 'Starwood', 'Real estate', 'Non-traded REIT'),
  fund('bii', 'Brookfield Infrastructure Income Fund', 'BII', 'Brookfield', 'Infrastructure', 'Tender-offer fund'),
  fund('brookreit', 'Brookfield Real Estate Income Trust', 'Brookfield REIT', 'Brookfield', 'Real estate', 'Non-traded REIT'),
  fund('hlend', 'HPS Corporate Lending Fund', 'HLEND', 'HPS', 'Private credit', 'Non-traded BDC'),
  fund('oscf', 'Oaktree Strategic Credit Fund', 'OSCF', 'Oaktree', 'Private credit', 'Non-traded BDC'),
  fund('gpcf', 'Golub Capital Private Credit Fund', 'GPCF', 'Golub', 'Private credit', 'Non-traded BDC'),
  fund('pif', 'North Haven Private Income Fund', 'PIF', 'Morgan Stanley', 'Private credit', 'Non-traded BDC'),
  fund('jpmreit', 'J.P. Morgan Real Estate Income Trust', 'JPMREIT', 'J.P. Morgan', 'Real estate', 'Non-traded REIT'),
  fund('gspc', 'Goldman Sachs Private Credit Corp', 'GS Private Credit', 'Goldman Sachs', 'Private credit', 'Non-traded BDC'),
  fund('gsredi', 'Goldman Sachs Real Estate Diversified Income Fund', 'GS RE Income', 'Goldman Sachs', 'Real estate', 'Interval fund'),
  fund('ctac', 'Carlyle Tactical Private Credit Fund', 'CTAC', 'Carlyle', 'Private credit', 'Interval fund'),
  fund('capm', 'Carlyle AlpInvest Private Markets Fund', 'CAPM', 'Carlyle', 'Private equity', 'Tender-offer fund'),
  fund('hlpaf', 'Hamilton Lane Private Assets Fund', 'Private Assets Fund', 'Hamilton Lane', 'Private equity', 'Tender-offer fund'),
  fund('spring', 'StepStone Private Venture and Growth Fund', 'SPRING', 'StepStone', 'Venture & growth', 'Tender-offer fund'),
  fund('pgpe', 'Partners Group Private Equity (Master Fund)', 'PG Master Fund', 'Partners Group', 'Private equity', 'Tender-offer fund'),
  fund('cclf', 'Cliffwater Corporate Lending Fund', 'CCLFX', 'Cliffwater', 'Private credit', 'Interval fund', { ticker: 'CCLFX' }),
  fund('fpcf', 'Fidelity Private Credit Fund', 'Fidelity Private Credit', 'Fidelity', 'Private credit', 'Non-traded BDC'),
  fund('ocredit', 'T. Rowe Price OHA Select Private Credit Fund', 'OCREDIT', 'T. Rowe Price', 'Private credit', 'Non-traded BDC'),
  fund('ncpcap', 'Nuveen Churchill Private Capital Income Fund', 'NC-PCAP', 'Nuveen', 'Private credit', 'Non-traded BDC'),
  fund('inreit', 'Invesco Real Estate Income Trust', 'INREIT', 'Invesco', 'Real estate', 'Non-traded REIT'),
  fund('ikpm', 'iCapital KKR Private Markets Fund', 'iCapital KKR PM', 'iCapital', 'Private equity', 'Tender-offer fund'),
  fund('pflex', 'PIMCO Flexible Credit Income Fund', 'PIMCO Flex Credit', 'PIMCO', 'Private credit', 'Interval fund'),
  fund('bcpc', 'Bain Capital Private Credit', 'BCPC', 'Bain Capital', 'Private credit', 'Non-traded BDC'),
  fund('pantheon', 'AMG Pantheon Fund', 'AMG Pantheon', 'AMG', 'Private equity', 'Tender-offer fund'),
  fund('hgit', 'Hines Global Income Trust', 'Hines Global', 'Hines', 'Real estate', 'Non-traded REIT'),
];

export const STRATEGIES: Strategy[] = ['Private credit', 'Real estate', 'Private equity', 'Infrastructure', 'Venture & growth'];

/** Everything searchable on the Investments page: listed symbols with their labels, and the fund directory. */
export function searchCatalog(query: string): { symbols: { symbol: string; label: string; section: Section }[]; funds: PrivateFund[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { symbols: [], funds: [] };
  const seen = new Set<string>();
  const symbols: { symbol: string; label: string; section: Section }[] = [];
  for (const [section, groups] of Object.entries(BOARDS) as [Section, BoardGroup[]][]) {
    for (const g of groups)
      for (const [symbol, label] of g.symbols) {
        if (seen.has(symbol)) continue;
        const sym = symbol.toLowerCase().replace(/^[$/]/, '');
        if (sym.startsWith(q) || label.toLowerCase().includes(q)) {
          seen.add(symbol);
          symbols.push({ symbol, label, section });
        }
      }
  }
  for (const [symbol, label] of CRYPTO_COINS)
    if (symbol.toLowerCase().startsWith(q) || label.toLowerCase().includes(q)) symbols.push({ symbol, label, section: 'crypto' });
  symbols.sort((a, b) => Number(b.symbol.toLowerCase().replace(/^[$/]/, '') === q) - Number(a.symbol.toLowerCase().replace(/^[$/]/, '') === q));
  const funds = PRIVATE_FUNDS.filter((f) => `${f.name} ${f.short} ${f.manager} ${f.strategy} ${f.structure}`.toLowerCase().includes(q));
  return { symbols: symbols.slice(0, 12), funds: funds.slice(0, 12) };
}
