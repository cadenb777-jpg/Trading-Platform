import { describe, expect, it } from 'vitest';
import { creditHeadline, family, scoreAuctions, scoreSentence, termPremiumSentence, type AuctionRow, type CreditRow } from './ratesDesk';

const auction = (date: string, btc: number, dealers: number, indirect: number, extra: Partial<AuctionRow> = {}): AuctionRow => ({
  cusip: 'X', type: 'Note', term: '10-Year', auctionDate: date, issueDate: date, maturityDate: `${Number(date.slice(0, 4)) + 10}${date.slice(4)}`,
  yield: 4.5, bidToCover: btc, reopening: false, tips: false, frn: false, dealers, direct: 100 - dealers - indirect, indirect, ...extra,
});

describe('Auction scorecard', () => {
  it('groups maturities into families, reopenings included', () => {
    // Fiscal Data, Oct 2026: "9-Year 10-Month" reopening issued Oct 15, 2026, maturing Aug 15, 2036 -> 10-year family
    expect(family({ issueDate: '2026-10-15', maturityDate: '2036-08-15' })).toBe(10);
    expect(family({ issueDate: '2026-10-15', maturityDate: '2029-10-15' })).toBe(3);
    expect(family({ issueDate: '2026-10-15', maturityDate: '2056-08-15' })).toBe(30);
    expect(family({ issueDate: '2026-10-15', maturityDate: '2041-10-15' })).toBeNull(); // 15 years: no family
    expect(family({ issueDate: '', maturityDate: '' })).toBeNull();
  });

  it('scores each auction against the 6 before it (hand-worked)', () => {
    // six past auctions: bid-to-cover 2.4,2.5,2.6,2.4,2.5,2.6 (mean 2.5, SD sqrt(0.04/5)=0.0894); dealers 15,16,14,15,16,14 %
    const past = [2.4, 2.5, 2.6, 2.4, 2.5, 2.6].map((b, i) => auction(`2026-0${i + 1}-10`, b, [15, 16, 14, 15, 16, 14][i], 70));
    const strong = auction('2026-07-10', 2.7, 10, 75);
    const [s] = scoreAuctions([...past, strong]);
    expect(s.family).toBe(10);
    expect(s.prior).toBe(6);
    expect(s.bidToCover.usual).toBeCloseTo(2.5, 10);
    expect(s.bidToCover.z).toBeCloseTo(0.2 / Math.sqrt(0.04 / 5), 6);
    expect(s.dealerShare.usual).toBeCloseTo(0.15, 10);
    expect(s.read).toBe('strong');
    expect(scoreSentence(s)).toBe('2.70× bids for every dollar sold (usually 2.50×); dealers kept 10% (usually 15%); indirect bidders took 75% (usually 70%).');
    const [w] = scoreAuctions([...past, auction('2026-07-10', 2.3, 22, 60)]);
    expect(w.read).toBe('weak');
    const [u] = scoreAuctions([...past, auction('2026-07-10', 2.5, 15, 70)]);
    expect(u.read).toBe('usual');
  });

  it('leaves out TIPS, floating-rate notes, bills and rows without the bidder split; needs 4 past auctions', () => {
    const rows = [
      auction('2026-01-10', 2.5, 15, 70, { tips: true }),
      auction('2026-01-11', 2.5, 15, 70, { frn: true }),
      auction('2026-01-12', 2.5, 15, 70, { type: 'Bill' }),
      auction('2026-01-13', 2.5, 15, 70, { dealers: null }),
      auction('2026-02-10', 2.5, 15, 70),
    ];
    const out = scoreAuctions(rows);
    expect(out).toHaveLength(1);
    expect(out[0].read).toBe('not enough history');
    expect(out[0].bidToCover.usual).toBeNull();
  });
});

describe('Credit spreads by rating', () => {
  const row = (rating: string, step: Partial<NonNullable<CreditRow['step']>> | null): CreditRow => ({
    rating, series: '', grade: 'ig', spread: 1, from: '2023-11-13', step: step ? { to: 'BB', bp: 108, date: '2026-11-11', percentile: 50, low: 100, high: 200, monthAgo: null, reading: 'in its usual range', ...step } : undefined,
  });

  it('names the most unusual notch', () => {
    expect(creditHeadline([row('A', { to: 'BBB', percentile: 40 }), row('BBB', { percentile: 3, reading: 'unusually tight' })])).toBe(
      'Moving from BBB to BB pays 108 bp more, less than on 97% of days since Nov 2023: that notch of risk is cheaply paid.',
    );
    expect(creditHeadline([row('BBB', { percentile: 96, reading: 'unusually wide' })])).toMatch(/more than on 96% of days.*well paid\.$/);
    expect(creditHeadline([row('BBB', { percentile: 60 })])).toBe('Every step between ratings is within its usual range since Nov 2023.');
    expect(creditHeadline([row('BBB', null)])).toBe('Not enough spread history to compare yet.');
  });
});

describe('Term premium', () => {
  it('splits the 10-year yield in words (FRED, Nov 6, 2026)', () => {
    const t = { date: '2026-11-06', yield: 4.8869, premium: 0.8738, expected: 4.0131, monthAgo: 0.95, yearAgo: null, percentile: 61.6, from: '1990-01-02', history: [] };
    expect(termPremiumSentence(t)).toBe(
      "Of the model's 10-year yield of 4.89%, about 4.01% is the average short-term rate it expects over 10 years and 0.87% is extra pay for lending long. That premium is higher than on 62% of days since 1990.",
    );
  });
});
