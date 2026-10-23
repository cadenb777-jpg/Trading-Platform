/**
 * The latest figures each fund has published, researched on 2026-10-23 from its newest SEC filings (8-K, 424B3,
 * N-23C3A, 10-Q, N-CSR), press releases and fact sheets. Nothing here is estimated: a fund with no figure we could
 * confirm is left out. `verified: false` means the number came from a third-party summary of the fund's filings
 * and should be checked against the filing before relying on it.
 *
 * The helper's live SEC data takes over whenever it has a newer NAV. Update these by hand when funds publish
 * new figures (most non-traded REITs and BDCs announce NAV monthly, around the 15th-25th).
 */
export interface FundSnapshot {
  /** Date the figures are as of (YYYY-MM-DD) */
  asOf: string;
  nav?: { label: string; value: number }[];
  netAssets?: string;
  distribution?: string;
  notes?: string[];
  sources: { label: string; url: string }[];
  verified: boolean;
}

export const SNAPSHOTS_RESEARCHED = '2026-10-23';

export const FUND_SNAPSHOTS: Record<string, FundSnapshot> = {
  bcred: {
    asOf: '2026-09-30',
    nav: [{ label: 'Class I, S and D', value: 23.51 }],
    netAssets: 'About $41.1B (portfolio at fair value about $75.6B)',
    distribution: 'Monthly distribution cut to $0.18 per share in July 2026',
    notes: ['NAV has eased each month (23.60 at Aug 31).'],
    sources: [{ label: '8-K filed Oct 21, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001803498/000180349826000056/bcred-20261021.htm' }],
    verified: true,
  },
  breit: {
    asOf: '2026-09-30',
    nav: [{ label: 'Class I', value: 14.6488 }],
    notes: ['Sets the Nov 1 offering price. Aug 31: 14.6850; Jul 31: 14.6479.'],
    sources: [{ label: 'NAV supplement (424B3), September 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001662972/000166297226000154/breitnavseptember2026.htm' }],
    verified: true,
  },
  bxpe: {
    asOf: '2026-08-31',
    nav: [{ label: 'Class I (transactional)', value: 39.72 }],
    netAssets: 'About $19.3B',
    notes: ['End of 2025: 34.16.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=Blackstone+Private+Equity+Strategies+Fund&owner=include&count=40' }],
    verified: false,
  },
  cnlsc: {
    asOf: '2026-06-30',
    notes: ['Annualised NAV return since inception: Class I about 10.0%, Class FA 11.0%, Class S 12.0% (first half 2026).'],
    sources: [{ label: 'CNL Strategic Capital news releases', url: 'https://www.cnlstrategiccapital.com/news/cnl-strategic-capital-announces-operating-results-for-first-quarter-2026/' }],
    verified: false,
  },
  bxinfra: {
    asOf: '2026-09-30',
    nav: [
      { label: 'Class I Series I', value: 31.41 },
      { label: 'Class I Series II', value: 31.42 },
      { label: 'Class S', value: 30.93 },
      { label: 'Class D', value: 31.25 },
    ],
    netAssets: 'About $6.7B (program about $7.4B)',
    notes: ['Transactional NAV; Aug 31 Class I was 30.78.'],
    sources: [{ label: '8-K filed Oct 22, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0002030772/000203077226000032/bxinfra-20261022.htm' }],
    verified: true,
  },
  bmacx: {
    asOf: '2026-06-30',
    distribution: 'Annualised distribution rate 8.1% (Class I Advisory), 7.4% (Class S), June 2026',
    notes: ['All distributions since inception came from net investment income and short-term gains.'],
    sources: [{ label: 'Semi-annual report (N-CSRS)', url: 'https://www.sec.gov/Archives/edgar/data/0002032432/000139834426016555/fp0099567-1_ncsrsixbrl.htm' }],
    verified: true,
  },
  bxsl: {
    asOf: '2026-06-30',
    nav: [{ label: 'NAV per share', value: 25.53 }],
    netAssets: '$5.9B (investments $13.4B at fair value); debt-to-equity 1.28x',
    distribution: 'Q3 2026 dividend $0.77 per share',
    notes: ['Down from 26.26 at Mar 31 (unrealised losses and two restructurings). Non-accruals 1.8% of fair value.'],
    sources: [{ label: 'Q2 2026 results press release', url: 'https://www.bxsl.com/press-releases/article/blackstone-secured-lending-fund-reports-second-quarter-2026-results/' }],
    verified: true,
  },
  ocic: {
    asOf: '2026-08-31',
    nav: [
      { label: 'Class I', value: 9.14 },
      { label: 'Class D', value: 9.12 },
      { label: 'Class S', value: 9.11 },
    ],
    netAssets: 'About $18.7B',
    notes: ['Jul 31 Class I: 9.09.'],
    sources: [{ label: '8-K filed Sep 23, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001812554/000181255426000053/orcic-20260923.htm' }],
    verified: true,
  },
  orent: {
    asOf: '2026-07-31',
    nav: [
      { label: 'Class I', value: 10.7174 },
      { label: 'Class N', value: 10.7302 },
      { label: 'Class S', value: 10.6395 },
      { label: 'Class D', value: 10.4938 },
    ],
    netAssets: 'About $9.67B',
    sources: [{ label: '8-K filed Aug 17, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001944366/000194436626000070/osnl-20260817.htm' }],
    verified: true,
  },
  obdc: {
    asOf: '2026-06-30',
    nav: [{ label: 'NAV per share', value: 14.26 }],
    distribution: 'Dividends of $0.33 per share for the quarter (about 9.3% annualised)',
    notes: ['Down from 14.41 at Mar 31 (markdowns on a few names). Non-accruals 0.8% of fair value.'],
    sources: [{ label: 'June 30, 2026 results press release', url: 'https://www.blueowlcapitalcorporation.com/investors/news-events/press-releases/detail/94/blue-owl-capital-corporation-announces-june-30-2026' }],
    verified: true,
  },
  ads: {
    asOf: '2026-09-30',
    nav: [{ label: 'Class I, S and D', value: 23.78 }],
    netAssets: 'About $13.5B; leverage 0.96x',
    distribution: 'September distribution $0.18 per share (gross)',
    notes: ['Aug 31: 23.84.'],
    sources: [{ label: '8-K, October 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001837532/000119312526426842/d65634d8k.htm' }],
    verified: true,
  },
  aris: {
    asOf: '2026-07-31',
    nav: [
      { label: 'Class I', value: 21.0571 },
      { label: 'Class S', value: 21.2206 },
      { label: 'Class A-I', value: 21.6467 },
      { label: 'Class E', value: 21.7384 },
    ],
    sources: [{ label: 'NAV supplement (424B3), August 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001882850/000119312526394293/aris_august_2026_nav_-_4.htm' }],
    verified: true,
  },
  adref: {
    asOf: '2026-09-17',
    nav: [
      { label: 'Class I', value: 24.05 },
      { label: 'Class A', value: 23.35 },
    ],
    notes: ['Jun 18, 2026 (from the SEC repurchase filing): Class I 24.39, Class A 23.70.', 'Distributions move from quarterly to twice a year from Oct 1, 2026.'],
    sources: [
      { label: 'Repurchase offer (N-23C3A), September 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001597634/000139834426017504/fp0100957-1_n23c3a.htm' },
      { label: 'Repurchase offer (N-23C3A), June 2026', url: 'https://www.sec.gov/Archives/edgar/data/1597634/000139834426011363/fp0099548-1_n23c3a.htm' },
    ],
    verified: false,
  },
  adcf: {
    asOf: '2026-09-17',
    nav: [
      { label: 'Class A', value: 22.12 },
      { label: 'Class C', value: 22.12 },
    ],
    notes: ['Mar 31, 2026: Class A 22.45; Classes C, I and L 22.44.'],
    sources: [{ label: 'Repurchase offer (N-23C3A), September 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001676197/000139834426017500/fp0100957-2_n23c3a.htm' }],
    verified: true,
  },
  kfit: {
    asOf: '2026-08-31',
    nav: [{ label: 'NAV per share', value: 29.1 }],
    notes: ['Jun 30: 29.07.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=KKR+FS+Income+Trust&owner=include&count=40' }],
    verified: false,
  },
  kpec: {
    asOf: '2026-05-31',
    nav: [
      { label: 'Class I', value: 35.5 },
      { label: 'Class D', value: 35.22 },
      { label: 'Class S', value: 34.9 },
      { label: 'Class F/G/H', value: 37.73 },
    ],
    notes: ['Transactional NAV.'],
    sources: [{ label: '8-K filed Jun 18, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001957845/000195784526000053/kkr-20260618.htm' }],
    verified: true,
  },
  kinfra: {
    asOf: '2026-04-30',
    nav: [
      { label: 'Class I', value: 30.33 },
      { label: 'Class D', value: 30.31 },
      { label: 'Class U', value: 30.3 },
      { label: 'Class R', value: 30.35 },
      { label: 'Class F', value: 32.07 },
      { label: 'Class G/H', value: 35.74 },
    ],
    notes: ['Transactional NAV.'],
    sources: [{ label: '8-K filed May 21, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001948056/000194805626000039/kkr-20260521.htm' }],
    verified: true,
  },
  krest: {
    asOf: '2026-06-03',
    nav: [{ label: 'NAV per share', value: 23.27 }],
    notes: [
      'Q3 tender filled in full (repurchase price 22.82), ending two quarters of proration.',
      'KKR pledge: if NAV is below $27 on Jun 1, 2027 it cancels up to 7.7M of its own shares; incentive fee waived to mid-2027.',
    ],
    sources: [{ label: 'AltsWire news report', url: 'https://altswire.com/kkrs-krest-fully-satisfies-q3-redemptions-ending-two-quarter-proration-streak/' }],
    verified: false,
  },
  asif: {
    asOf: '2026-08-31',
    nav: [{ label: 'NAV per share', value: 26.74 }],
    notes: ['September 2026 tender: requests of 13.1% of shares, prorated.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=Ares+Strategic+Income+Fund&owner=include&count=40' }],
    verified: false,
  },
  aireit: {
    asOf: '2026-09-30',
    nav: [{ label: 'NAV per share', value: 13.3993 }],
    notes: ['Sets the Nov 1 price. Aug 31: 13.3703; Jun 30: 13.31; Dec 31, 2025: 13.13.'],
    sources: [{ label: '8-K (September 2026 NAV)', url: 'https://www.sec.gov/Archives/edgar/data/0001625941/000162828026066025/aire-20260930.htm' }],
    verified: true,
  },
  areit: {
    asOf: '2026-06-30',
    nav: [{ label: 'NAV per share', value: 8.22 }],
    netAssets: 'Total NAV about $3.95B (Sep 30)',
    notes: ['Dec 31, 2025: 8.04.'],
    sources: [
      { label: 'Quarterly report (10-Q), Jun 30, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001327978/000162828026056330/are-20260630.htm' },
      { label: '8-K (September 2026)', url: 'https://www.sec.gov/Archives/edgar/data/0001327978/000162828026066024/are-20260930.htm' },
    ],
    verified: true,
  },
  sreit: {
    asOf: '2026-09-30',
    nav: [
      { label: 'Class I', value: 19.16 },
      { label: 'Class S', value: 19.34 },
      { label: 'Class T', value: 19.34 },
      { label: 'Class D', value: 18.92 },
    ],
    notes: ['Sets the Nov 2 price. Aug 31 Class I: 19.27.'],
    sources: [{ label: 'NAV supplement (424B3) filed Oct 16, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001711929/000119312526424159/ck0001711929-20261016.htm' }],
    verified: true,
  },
  bii: {
    asOf: '2026-02-28',
    nav: [
      { label: 'Class I', value: 10.98 },
      { label: 'Class S', value: 10.95 },
      { label: 'Class D', value: 10.86 },
    ],
    distribution: 'Annualised net distribution rate 4.25% (Class I)',
    sources: [{ label: 'Brookfield fact sheet', url: 'https://privatewealth.brookfield.com/sites/default/files/funds/tender-offer-funds/fact-sheets-and-commentary/brookfield-infrastructure-income-fund-fact-sheet.pdf' }],
    verified: true,
  },
  brookreit: {
    asOf: '2026-04-30',
    nav: [{ label: 'Class I', value: 10.39 }],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=Brookfield+Real+Estate+Income+Trust&owner=include&count=40' }],
    verified: false,
  },
  hlend: {
    asOf: '2026-06-30',
    nav: [{ label: 'Tender price per share', value: 24.42 }],
    notes: ['Q2 tender paid 37.6% of requests; Q3 requests were about 11.5% of shares against a 5% cap.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=HPS+Corporate+Lending+Fund&owner=include&count=40' }],
    verified: false,
  },
  oscf: {
    asOf: '2026-06-30',
    nav: [{ label: 'NAV per share', value: 22.32 }],
    distribution: 'Monthly distribution cut to $0.16 in March 2026; Class I annualised net rate 8.60%',
    notes: ['Mar 31: 22.38; Dec 31, 2025: 23.09.'],
    sources: [{ label: 'Shareholder update, quarter ended Jun 30, 2026', url: 'https://osc.brookfield.com/sites/default/files/documents/OSC%20Shareholder%20Update%20for%20the%20Quarter%20Ended%20June%2030%202026.pdf' }],
    verified: true,
  },
  gpcf: {
    asOf: '2026-08-31',
    nav: [{ label: 'NAV per share', value: 24.28 }],
    distribution: 'Monthly distribution $0.1875 per share',
    notes: ['Current tender offer closes Oct 28, 2026.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=Golub+Capital+Private+Credit+Fund&owner=include&count=40' }],
    verified: false,
  },
  pif: {
    asOf: '2026-06-30',
    netAssets: 'Aggregate NAV about $3.09B',
    sources: [{ label: '8-K filed Jul 24, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001851322/000119312526321096/ck0001851322-20260724.htm' }],
    verified: true,
  },
  jpmreit: {
    asOf: '2026-06-30',
    nav: [
      { label: 'Class I', value: 10.61 },
      { label: 'Class D', value: 10.56 },
      { label: 'Class E', value: 11.53 },
      { label: 'Class T', value: 11.5 },
      { label: 'Class Y', value: 11.31 },
    ],
    netAssets: 'Total NAV about $1.12B',
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=J.P.+Morgan+Real+Estate+Income+Trust&owner=include&count=40' }],
    verified: false,
  },
  gspc: {
    asOf: '2026-08-31',
    nav: [{ label: 'Class I, S and D', value: 24.6 }],
    netAssets: 'About $9.6B',
    sources: [{ label: '8-K (August 2026 NAV)', url: 'https://www.sec.gov/Archives/edgar/data/0001920145/000119312526398142/d184442d8k.htm' }],
    verified: true,
  },
  ctac: {
    asOf: '2026-06-30',
    notes: ['About $177M of distributions paid in the first half of 2026.'],
    sources: [{ label: 'Semi-annual report (N-CSRS)', url: 'https://www.sec.gov/Archives/edgar/data/0001725472/000172547226000005/ctac-20260630.htm' }],
    verified: true,
  },
  capm: {
    asOf: '2026-03-31',
    notes: ['Fiscal year to Mar 31, 2026: net unrealised gains of $385.3M; net investment income of -$71.5M (normal for a fund of private funds).'],
    sources: [{ label: 'Annual report (N-CSR)', url: 'https://www.sec.gov/Archives/edgar/data/0001899610/000189961026000006/capm_202603xn-csr.htm' }],
    verified: true,
  },
  hlpaf: {
    asOf: '2026-06-30',
    nav: [{ label: 'Class I', value: 20.83 }],
    notes: ['Mar 31 (audited): 19.77.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=Hamilton+Lane+Private+Assets+Fund&owner=include&count=40' }],
    verified: false,
  },
  spring: {
    asOf: '2025-12-31',
    notes: ['2025 net return, Class I: 38.79%.', 'Repurchases capped at 2.5% of shares a quarter.'],
    sources: [{ label: 'StepStone fact card, February 2026', url: 'https://go.stepstonegroup.com/rs/664-QRQ-541/images/SPW%20US%20Firm%20Fact%20Card%20-%20Feb%202026.pdf' }],
    verified: true,
  },
  cclf: {
    asOf: '2026-07-23',
    nav: [{ label: 'NAV per share', value: 10.28 }],
    notes: ['Interval fund with a ticker (CCLFX), so Schwab shows the daily NAV when available.'],
    sources: [{ label: 'Third-party summary of the fund\'s filings: check them in the fund\'s SEC filings', url: 'https://www.sec.gov/cgi-bin/browse-edgar?company=Cliffwater+Corporate+Lending+Fund&owner=include&count=40' }],
    verified: false,
  },
  fpcf: {
    asOf: '2026-07-31',
    nav: [
      { label: 'Class I', value: 24.69 },
      { label: 'Class D', value: 24.69 },
      { label: 'Class S', value: 24.66 },
    ],
    netAssets: 'About $1.4B',
    sources: [{ label: '8-K filed Aug 27, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001920453/000119312526371231/ck0001920453-20260827.htm' }],
    verified: true,
  },
  ocredit: {
    asOf: '2026-06-30',
    nav: [{ label: 'All classes', value: 25.96 }],
    netAssets: 'About $1.64B; debt-to-equity about 0.93x',
    distribution: '$0.20 per share a month',
    sources: [{ label: '8-K, Jul 28, 2026', url: 'https://www.troweprice.com/content/dam/public/enterprise/cobrand/oha/insights/pdfs/trp-oha-select-private-credit-fund-8-k-july-28-2026.pdf' }],
    verified: true,
  },
  bcpc: {
    asOf: '2026-06-30',
    nav: [{ label: 'Class I', value: 25.89 }],
    netAssets: 'About $1.14B; leverage about 1.09x',
    sources: [{ label: '8-K filed Jul 24, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001899017/000119312526316035/ck0001899017-20260724.htm' }],
    verified: true,
  },
  pantheon: {
    asOf: '2026-05-31',
    nav: [{ label: 'Class 4', value: 30.07 }],
    sources: [{ label: 'Pantheon fact sheet (May)', url: 'https://www.pantheon.com/wp-content/uploads/2026/07/P-PEXX-Factsheet-Class-4-May.pdf' }],
    verified: false,
  },
  hgit: {
    asOf: '2026-05-31',
    nav: [{ label: 'NAV per share', value: 9.81 }],
    notes: ['56 properties, 95% leased, 30% leverage.'],
    sources: [{ label: '8-K filed Jun 15, 2026', url: 'https://www.sec.gov/Archives/edgar/data/0001585101/000162828026043110/hgit-20260615.htm' }],
    verified: true,
  },
};
