import { describe, expect, it } from 'vitest';
import { billShareFlag, bn, bp, fundingEdgeLine, fundingWords, mortgageWords, ord, supplyWords, type Funding, type Mortgage, type MoneyReply, type Supply } from './moneyDesk';

// Live values (FRED / Fiscal Data, Nov 10-12, 2026)
const funding: Funding = {
  date: '2026-11-10', sofr: 3.89, iorb: 3.9, spreadBp: -1, spreadPct: 85.1, dispersionBp: 14, dispersionPct: 33.5, high30Bp: 7,
  from: '2021-07-29', days: 1300, reading: 'calm', series: [],
};
const mortgage: Mortgage = { date: '2026-11-12', mortgage: 7.11, tenYear: 4.98, spreadBp: 213, percentile: 81.26, medianBp: 167, yearAgoBp: 211, from: '1971-04-02', weeks: 2900, series: [] };
const supply: Supply = {
  date: '2026-11-10', heldByPublic: 32.8e12, change30: 352.37, change91: 617.74, change365: 2186.86, pacePerYear: 2477.76,
  billShare: 0.2296, billShareNew3m: 0.56506, billShareNew12m: 0.366, mspdDate: '2026-10-31',
};

describe('Money and supply', () => {
  it('formats basis points, dollars and ordinals', () => {
    expect(bp(-0.9999)).toBe('−1 bp');
    expect(bp(5.2)).toBe('+5 bp');
    expect(bp(0.2)).toBe('0 bp');
    expect(bn(352.37)).toBe('$352 billion');
    expect(bn(2477.76)).toBe('$2.48 trillion');
    expect(bn(-40)).toBe('−$40 billion');
    expect(bn(null)).toBe('—');
    expect([ord(1), ord(2), ord(3), ord(11), ord(12), ord(85.1), ord(93)]).toEqual(['1st', '2nd', '3rd', '11th', '12th', '85th', '93rd']);
  });

  it('reads funding calm or tight', () => {
    expect(fundingWords(funding)).toBe('Overnight money backed by Treasuries (SOFR 3.89%) costs 1 bp less than banks earn at the Fed (IORB 3.90%). Calm: cash is plentiful.');
    const tight = { ...funding, sofr: 3.96, spreadBp: 6, spreadPct: 96.2, reading: 'tight' as const };
    expect(fundingWords(tight)).toMatch(/costs 6 bp more than banks earn.*higher than on 96% of days since 2021: cash is getting scarce/);
    expect(fundingEdgeLine({ funding } as MoneyReply)).toBeNull();
    const line = fundingEdgeLine({ funding: tight } as MoneyReply)!;
    expect([line.label, line.value, line.tone, line.href, line.detail]).toEqual(['Overnight money is tight', '+6 bp', 'down', '#invest/bonds/market', "SOFR over the Fed's IORB, 96th percentile since 2021"]);
    expect(fundingEdgeLine(null)).toBeNull();
  });

  it('reads the mortgage spread against its history', () => {
    expect(mortgageWords(mortgage)).toBe('Homebuyers pay 2.13 points over the 10-year Treasury (7.11% vs 4.98%), more than on 81% of weeks since 1971; the usual gap is 1.67 points.');
  });

  it('reads the borrowing pace and the bill share', () => {
    expect(supplyWords(supply)).toBe(
      "The government added $352 billion of debt held by the public in the last 30 days ($2.48 trillion a year at the last 3 months' pace). Bills were 57% of the new marketable debt in the last 3 months and are 23% of all of it; Treasury's advisers have pointed to roughly 15%–20% over time.",
    );
    expect(billShareFlag(supply)).toBe('Bills are 23% of marketable debt, above the 15%–20% range: more borrowing is short-term.');
    expect(billShareFlag({ ...supply, billShare: 0.18 })).toBe('');
    expect(billShareFlag({ ...supply, billShare: 0.12 })).toMatch(/below the 15%–20% range/);
    expect(supplyWords({ ...supply, pacePerYear: null, billShare: null })).toBe('The government added $352 billion of debt held by the public in the last 30 days.');
  });
});

describe('Edge today with money', () => {
  it('adds the funding line only when tight', async () => {
    const { edgeLines } = await import('../home/edge');
    const calm = { funding: { ...funding } } as MoneyReply;
    expect(edgeLines({ money: calm })).toEqual([]);
    const tight = { funding: { ...funding, spreadBp: 6, spreadPct: 96, reading: 'tight' as const } } as MoneyReply;
    expect(edgeLines({ money: tight }).map((l) => l.label)).toEqual(['Overnight money is tight']);
  });
});

describe('Month-end funding', () => {
  it('says a month-end bump is normal and keeps it off Home', async () => {
    const me = { ...funding, sofr: 3.95, spreadBp: 5, spreadPct: 97, reading: 'month-end' as const };
    expect(fundingWords(me)).toMatch(/it is a month-end.*not a warning on its own\.$/);
    expect(fundingEdgeLine({ funding: me } as MoneyReply)).toBeNull();
  });
});
