import { describe, expect, it } from 'vitest';
import { coverWord, coverWords, interestCover, ladder, ladderWords, looksLikeSplit, payouts, payoutWords, shareChange, shareCount, sharesWords, usd, type Maturities, type Statements } from './debtDilution';

// Apple's 10-K figures as the SEC company facts give them (fiscal years end late September; FY2017 is before the
// 2020 4-for-1 split, later years are restated), checked live 2026-11-13.
const aapl: Statements = {
  periods: ['2017-09-30', '2018-09-29', '2019-09-28', '2020-09-26', '2021-09-25', '2022-09-24', '2023-09-30', '2024-09-28', '2025-09-27', '2026-09-26'],
  values: {
    dilutedShares: [5251692000, 20000435000, 18595651000, 17528214000, 16864919000, 16325819000, 15812547000, 15408095000, 15004697000, 14720306000],
    buybacks: [32.9e9, 72.738e9, 66.897e9, 72.358e9, 85.971e9, 89.402e9, 77.55e9, 94.949e9, 90.711e9, 86.39e9],
    stockComp: [4.84e9, 5.34e9, 6.068e9, 6.829e9, 7.906e9, 9.038e9, 10.833e9, 11.688e9, 12.863e9, 13.789e9],
    dividends: [12.769e9, 13.712e9, 14.119e9, 14.081e9, 14.467e9, 14.841e9, 15.025e9, 15.234e9, 15.421e9, 15.721e9],
    revenue: [229.234e9, 265.595e9, 260.174e9, 274.515e9, 365.817e9, 394.328e9, 383.285e9, 391.035e9, 416.161e9, 478.834e9],
    operatingIncome: [61.344e9, 70.898e9, 63.93e9, 66.288e9, 108.949e9, 119.437e9, 114.301e9, 123.216e9, 133.05e9, 158.063e9],
    // Apple last tagged interest expense on its own line in FY2023
    interestExpense: [2.323e9, 3.24e9, 3.576e9, 2.873e9, 2.645e9, 2.931e9, 3.933e9, null, null, null],
  },
};
const aaplLadder: Maturities = {
  asOf: '2026-09-26', filed: '2026-11-03', accession: '0000320193-26-000026', form: '10-K',
  buckets: { next12: 9.991e9, year2: 9.3e9, year3: 5.175e9, year4: 4.956e9, year5: 3.75e9, after5: 45.506e9 },
};
// Coca-Cola FY2025 10-K: no "after year five" tag
const koLadder: Maturities = {
  asOf: '2025-12-31', filed: '2026-02-20', accession: '0001628280-26-010047', form: '10-K',
  buckets: { next12: 1.822e9, year2: 4.817e9, year3: 2.923e9, year4: 2.955e9, year5: 3.411e9, after5: null },
};

describe('Share count', () => {
  it('compounds the change per year and stops at the 2020 split', () => {
    const s = shareChange(aapl)!;
    expect(s.latestEnd).toBe('2026-09-26');
    // 14,720,306,000 / 15,004,697,000 - 1 = -1.8953%
    expect(s.changes.map((c) => c.years)).toEqual([1, 3, 5]);
    expect(s.changes[0].rate).toBeCloseTo(-0.0189535, 6);
    // (14,720,306,000 / 15,812,547,000)^(1/3) - 1 = -2.3576%
    expect(s.changes[1].rate).toBeCloseTo(-0.0235762, 6);
    // (14,720,306,000 / 16,864,919,000)^(1/5) - 1 = -2.6835%
    expect(s.changes[2].rate).toBeCloseTo(-0.0268349, 6);
    expect(s.breakAfter).toBe('2017-09-30');
    expect(sharesWords(s)).toBe('The share count is shrinking 2.7% a year over 5 years (FY2021 to FY2026); −1.9% in the last year. Each share owns a growing slice of the company.');
  });

  it('never compares across a split', () => {
    const cut = { periods: aapl.periods.slice(0, 4), values: { dilutedShares: aapl.values.dilutedShares.slice(0, 4) } };
    const s = shareChange(cut)!;
    // FY2018 -> FY2020 only: 2 years, so the 1-year change and nothing longer
    expect(s.changes.map((c) => c.years)).toEqual([1]);
    expect(shareChange({ periods: ['2025-12-31'], values: { dilutedShares: [null] } })).toBeNull();
    const grow = { periods: ['2020', '2021', '2022', '2023', '2024', '2025'], values: { dilutedShares: [100, 104, 108, 112, 117, 122] } };
    expect(sharesWords(shareChange(grow)!)).toMatch(/growing 4\.1% a year over 5 years.*\+4\.3% in the last year\. Each share owns a shrinking slice/);
  });

  it('counts heavy real dilution, only skipping split-like ratios', () => {
    // Apple FY2017 -> FY2018: 20,000,435,000 / 5,251,692,000 = 3.808, within 8% of a 4-for-1 split
    expect(looksLikeSplit(20000435000 / 5251692000)).toBe(true);
    expect(looksLikeSplit(0.5)).toBe(true); // 1-for-2 reverse split
    expect([looksLikeSplit(1.5), looksLikeSplit(1.7), looksLikeSplit(1.0)]).toEqual([false, false, false]);
    // a share sale of +50% in the last year is dilution, not a break: (150/100) - 1
    const sale = { periods: ['2023', '2024', '2025'], values: { dilutedShares: [98e6, 100e6, 150e6] } };
    const s = shareChange(sale)!;
    expect(s.breakAfter).toBeNull();
    expect(s.changes.map((c) => [c.years, c.rate])).toEqual([[1, 0.5]]);
    expect(sharesWords(s)).toBe('The share count is growing 50.0% a year over 1 year (FY2024 to FY2025). Each share owns a shrinking slice: new shares are diluting owners.');
    // 1-year change that rounds to zero carries no sign
    const flat = { periods: ['2019', '2020', '2021', '2022', '2023', '2024', '2025'], values: { dilutedShares: [100e6, 99e6, 98e6, 97e6, 96e6, 95.03e6, 95e6] } };
    expect(sharesWords(shareChange(flat)!)).toMatch(/; 0\.0% in the last year\./);
    expect([shareCount(14720306000), shareCount(4.2e6), shareCount(950000)]).toEqual(['14.72 billion', '4.2 million', '950,000']);
    expect(sharesWords(shareChange({ periods: ['2025'], values: { dilutedShares: [4.2e6] } })!)).toBe('4.2 million diluted shares in FY2025.');
  });
});

describe('Buybacks against stock pay', () => {
  it('works out the FY2026 yields and the part that offsets stock pay', () => {
    // illustrative market value $4 trillion (the page uses today's price x shares)
    const p = payouts(aapl, 4e12)!;
    expect(p.end).toBe('2026-09-26');
    expect(p.buybackYield).toBeCloseTo(86.39e9 / 4e12, 10); // 2.16%
    expect(p.shareholderYield).toBeCloseTo((86.39e9 + 15.721e9) / 4e12, 10); // 2.55%
    expect(p.sbcOfRevenue).toBeCloseTo(0.028797, 6); // 13.789 / 478.834
    expect(p.sbcOfBuybacks).toBeCloseTo(0.159613, 6); // 13.789 / 86.39
    expect(p.netBuybackYield).toBeCloseTo((86.39e9 - 13.789e9) / 4e12, 10);
    expect(payoutWords(p)).toBe(
      "In FY2026 the company spent $86.4 billion buying back shares and paid $15.7 billion in dividends: 2.6% of today's market value. It also paid staff $13.8 billion in stock (2.9% of sales), so 16% of the buyback only offsets shares handed to staff.",
    );
    expect(payouts(aapl, null)!.buybackYield).toBeNull();
  });

  it('says when stock pay outruns the buybacks', () => {
    const a = { periods: ['2025-12-31'], values: { buybacks: [1e9], stockComp: [2.5e9], revenue: [20e9], dividends: [null] } };
    expect(payoutWords(payouts(a, 50e9)!)).toBe("In FY2025 the company spent $1.0 billion buying back shares: 2.0% of today's market value. It also paid staff $2.5 billion in stock (12.5% of sales), more than the buybacks: they don't even offset the new shares.");
    expect(payouts({ periods: ['2025'], values: {} }, 1e9)).toBeNull();
  });

  it('keeps a missing buyback line unknown, never zero', () => {
    const a = { periods: ['2025-12-31'], values: { buybacks: [null], stockComp: [0.5e9], revenue: [10e9], dividends: [0.2e9] } };
    const p = payouts(a, 20e9)!;
    expect([p.buybacks, p.buybackYield, p.shareholderYield, p.netBuybackYield, p.sbcOfBuybacks]).toEqual([null, null, null, null, null]);
    expect(p.dividendYield).toBeCloseTo(0.01, 10);
    expect(payoutWords(p)).toBe("In FY2025 the company paid $200 million in dividends: 1.0% of today's market value. It also paid staff $500 million in stock (5.0% of sales). The filing has no share buyback line that year, so buybacks are unknown, not zero.");
  });
});

describe('Debt', () => {
  it('reads the maturity ladder', () => {
    const l = ladder(aaplLadder)!;
    expect(l.known).toBeCloseTo(78.678e9, 0);
    expect(l.dueIn2).toBeCloseTo(19.291e9, 0);
    expect(l.dueIn2Share).toBeCloseTo(0.245189, 6); // 19.291 / 78.678
    expect(ladderWords(l, aaplLadder, 57.7e9)).toBe(
      'The FY2026 10-K schedules $78.7 billion of debt principal. $19.3 billion is due within 2 years (25% of it). Cash and short-term investments cover that 3.0 times over.',
    );
    expect(ladderWords(l, aaplLadder, 9.6455e9)).toMatch(/cover only 50% of it: the rest must come from profits or new borrowing\.$/);
  });

  it('never pretends a partial table is complete', () => {
    const l = ladder(koLadder)!;
    expect(l.complete).toBe(false);
    expect(l.dueIn2Share).toBeNull();
    expect(ladderWords(l, koLadder, null)).toBe("The FY2025 10-K schedules $15.9 billion of debt principal in the years it lists (it doesn't break out every year). $6.6 billion is due within 2 years.");
    expect(ladder(null)).toBeNull();
    expect(ladder({ ...koLadder, buckets: { next12: null, year2: null, year3: null, year4: null, year5: null, after5: null } })).toBeNull();
  });

  it('covers interest from the newest year that reports both, and says when it is old', () => {
    const c = interestCover(aapl)!;
    // FY2023: 114,301 / 3,933 = 29.06
    expect([c.end, c.stale, c.newestEnd]).toEqual(['2023-09-30', true, '2026-09-26']);
    expect(c.times).toBeCloseTo(29.06204, 4);
    expect(coverWords(c)).toBe("Operating profit covers interest 29.1 times (FY2023: $114 billion vs $3.9 billion). Since then the filings don't show interest expense on its own line, so the newest year (FY2026) can't be checked.");
    // Coca-Cola FY2025: 13,762 / 1,654 = 8.32
    const ko = interestCover({ periods: ['2025-12-31'], values: { operatingIncome: [13.762e9], interestExpense: [1.654e9] } })!;
    expect(coverWords(ko)).toBe('Operating profit covers interest 8.3 times (FY2025: $13.8 billion vs $1.7 billion): very strong.');
    expect([coverWord(1.2), coverWord(2), coverWord(5)]).toEqual(['thin: profits barely pay the interest', 'tight', 'comfortable']);
    expect(interestCover({ periods: ['2025'], values: { operatingIncome: [1e9], interestExpense: [null] } })).toBeNull();
    // an operating loss is never called a "cover"
    const loss = interestCover({ periods: ['2025-12-31'], values: { operatingIncome: [-500e6], interestExpense: [200e6] } })!;
    expect(coverWords(loss)).toBe('FY2025 had an operating loss of $500 million: no operating profit to pay $200 million of interest, so it came from cash or borrowing.');
  });

  it('writes dollars in words', () => {
    expect([usd(86.39e9), usd(158.063e9), usd(1.654e12), usd(746e6), usd(-2e9), usd(null)]).toEqual(['$86.4 billion', '$158 billion', '$1.65 trillion', '$746 million', '−$2.0 billion', '—']);
  });
});
