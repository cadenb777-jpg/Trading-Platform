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
}

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
