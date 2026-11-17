import { describe, expect, it } from 'vitest';
import { isExplanation } from './quiet';

describe('calm reading', () => {
  it('turns long explanations into tips and leaves short notes visible', () => {
    expect(isExplanation('Company financials from SEC filings, key ratios and a valuation calculator.', false)).toBe(true);
    expect(isExplanation('as of 10:42 · Schwab', false)).toBe(false);
    expect(isExplanation('Some long text with a link inside it that should stay as it is', true)).toBe(false);
  });
});
