/** Clients and report branding, saved in the helper's database (never in the browser). */

export interface Client {
  id?: string;
  name: string;
  household?: string;
  accountName: string;
  /** A saved portfolio (Portfolios page) that this account follows. */
  portfolioId: string;
  /** Date the account started (YYYY-MM-DD). Returns before this date would be hypothetical. */
  inception: string;
  initialInvestment: number;
  /** Yearly advisory fee as a fraction (0.01 = 1%) so returns are shown net of fees. */
  fee: number;
  benchmark?: string;
  commentary?: string;
  reports?: { generated: string; asOf: string }[];
  /** Deposits minus withdrawals since the start date, for the change-in-value table. */
  netAdditions?: number;
  /** Investment objective shown in the summary, e.g. "Growth". */
  objective?: string;
  /** The client's alternatives from Investments > Alternatives > My alternatives (ids). */
  altIds?: string[];
  /** Which report sections to include (all on by default). */
  sections?: Partial<Record<ReportSection, boolean>>;
}

export type ReportSection = 'summary' | 'market' | 'performance' | 'risk' | 'allocation' | 'holdings' | 'income' | 'alternatives' | 'commentary';

export const REPORT_SECTIONS: [ReportSection, string][] = [
  ['summary', 'Executive summary & change in value'],
  ['market', 'Market overview'],
  ['performance', 'Performance & growth'],
  ['risk', 'Returns, risk & stress tests'],
  ['allocation', 'Asset allocation & liquidity'],
  ['holdings', 'Holdings detail'],
  ['income', 'Projected income'],
  ['alternatives', 'Alternative investments'],
  ['commentary', 'Commentary'],
];

export const OBJECTIVES = ['Capital preservation', 'Income', 'Balanced', 'Growth', 'Aggressive growth'];

export const ALT_DISCLOSURE =
  'Alternative investments (for example non-traded REITs, BDCs, interval funds and private funds) are illiquid or semi-liquid, may limit or suspend redemptions, and are valued at the most recent net asset value reported by the sponsor, which may be as of a prior date and is not a market price. Their returns in the performance figures are modelled with listed proxies named in this report; actual results differ. TVPI and DPI are based on the commitments, contributions, distributions and values recorded for this report.';

export interface Branding {
  id?: string;
  firmName: string;
  /** Logo as a data URL (PNG/JPG/SVG). */
  logo: string;
  primary: string;
  accent: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  reportTitle: string;
  disclosures: string;
}

export const DEFAULT_BRANDING: Branding = {
  id: 'default',
  firmName: 'Your Firm Name',
  logo: '',
  primary: '#1f3b57',
  accent: '#8fb8d8',
  address: '',
  phone: '',
  email: '',
  website: '',
  reportTitle: 'Portfolio Review',
  disclosures: [
    'Past performance does not guarantee future results. Investing involves risk, including the possible loss of principal.',
    'Performance is shown net of the advisory fee stated in this report, includes reinvested dividends where available, and does not reflect taxes. Returns for periods longer than one year are annualized.',
    'Account values assume no deposits or withdrawals after the initial investment and are calculated from the account’s target allocation, rebalanced on the schedule shown. Actual account results may differ because of the timing of cash flows, trading and fees.',
    'Benchmarks are unmanaged indices or index funds shown for comparison only. Their volatility and composition may differ materially from the account.',
    'Market data from Charles Schwab; dividend data from Yahoo Finance. Information is believed reliable but is not guaranteed. This report is for informational purposes and is not a substitute for official account statements from your custodian.',
  ].join('\n\n'),
};
