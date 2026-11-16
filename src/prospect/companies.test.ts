import { describe, expect, it } from 'vitest';
import { companyLinks, toQuery } from './companies';

describe('company finder', () => {
  it('turns the form into a request (money words understood)', () => {
    expect(toQuery({ text: ' grill ', group: 'restaurants', state: 'TX', revenueMin: '5m', revenueMax: '$250K', jobsMin: '20', noNonprofits: true })).toEqual({
      sort: 'revenue', offset: 0, limit: 100, text: 'grill', group: 'restaurants', state: 'TX', revenueMin: 5e6, revenueMax: 250e3, jobsMin: 20, noNonprofits: true,
    });
    expect(toQuery({ revenueMin: 'lots' }).revenueMin).toBeUndefined();
  });
  it('links each company to a web search and its state registry search', () => {
    const l = companyLinks({ name: "Joe's Grill", city: 'Austin', state: 'TX' });
    expect(l.web).toContain("Joe's%20Grill%20Austin%20TX".replace("'", '%27').replace('%27', "'"));
    expect(l.opencorporates).toBe('https://opencorporates.com/companies/us_tx?q=Joe\'s%20Grill');
  });
});
