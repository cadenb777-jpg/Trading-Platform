import { describe, expect, it } from 'vitest';
import { yearSentence } from './yearBars';

const pts = (...v: (number | null)[]) => v.map((value, i) => ({ label: `FY${2021 + i}`, value }));

describe('year-by-year sentence', () => {
  it('growth per year and how many years grew', () => {
    // 100 -> 121 over 2 years = 10% a year; both years grew
    expect(yearSentence(pts(100, 110, 121))).toBe('Up 10.0% a year over 2 years · grew in 2 of 2 years');
  });
  it('a falling series says down', () => expect(yearSentence(pts(200, 150, 100))).toBe('Down 29.3% a year over 2 years · grew in 0 of 2 years'));
  it('a loss in the latest year is said plainly', () => expect(yearSentence(pts(50, 20, -10))).toBe('A loss in FY2023 · grew in 0 of 2 years'));
  it('turning a loss into a profit', () => expect(yearSentence(pts(-30, 5, 40))).toBe('A loss in FY2021, positive now · grew in 2 of 2 years'));
  it('skips years with no figure', () => expect(yearSentence(pts(100, null, 121))).toBe('Up 10.0% a year over 2 years · grew in 1 of 1 year'));
  it('one year or none', () => {
    expect(yearSentence(pts(null, 42))).toBe('FY2022 is the only year reported so far.');
    expect(yearSentence(pts(null, null))).toBe('No yearly figures in the filings.');
  });
});
