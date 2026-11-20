import { describe, expect, it } from 'vitest';
import { costBand, costWords, isFundRow, riskWords, stars, versusCategory } from './fund';

describe('funds', () => {
  it('knows an ETF or mutual fund from Schwab’s types', () => {
    expect(isFundRow({ assetType: 'EQUITY', assetSubType: 'ETF' })).toBe(true);
    expect(isFundRow({ assetType: 'MUTUAL_FUND', assetSubType: '' })).toBe(true);
    expect(isFundRow({ assetType: 'EQUITY', assetSubType: 'COE' })).toBe(false);
    expect(isFundRow(null)).toBe(false);
  });
  it('turns an expense ratio into dollars and a band', () => {
    expect(costWords(0.0003)).toBe('$3 a year on every $10,000 invested');
    expect(costWords(0.0095)).toBe('$95 a year on every $10,000 invested');
    expect(costWords(0.00035)).toBe('$3.5 a year on every $10,000 invested');
    expect(costBand(0.0003)).toBe('very low');
    expect(costBand(0.012)).toBe('high');
    expect(costWords(null)).toBe('');
  });
  it('says ratings and the category comparison in words', () => {
    expect(stars(4)).toBe('★★★★☆');
    expect(riskWords(3)).toBe('Average');
    expect(versusCategory([{ period: '1 year', fund: 0.21, category: 0.19 }, { period: '3 years (a year)', fund: 0.09, category: 0.08 }])).toBe('Ahead of its category by 1.0 points a year over 3 years.');
    expect(versusCategory([])).toBeNull();
  });
});
