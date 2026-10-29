import { describe, expect, it } from 'vitest';
import { activeFilterCount, confidenceLabel, describeForm, emptyForm, formToQuery, MORE_TYPES, TYPE_SHORT, TYPE_TERM } from './logic';
import { foundText } from './sourcesPanel';

describe('public records for family offices', () => {
  it('sends the recent-liquidity filter and the new type', () => {
    const f = { ...emptyForm(), recentLiquidity: true, types: ['Possible single-family office' as const] };
    expect(formToQuery(f).query).toEqual({ recentLiquidity: true, types: ['Possible single-family office'] });
    expect(formToQuery(emptyForm()).query).toEqual({});
    expect(activeFilterCount(f)).toBe(2);
    expect(describeForm(f)).toBe('Single-family office?, recent liquidity event');
    expect(MORE_TYPES).toContain('Possible single-family office');
    expect(TYPE_TERM['Possible single-family office']).toBe('prSfo');
    expect(TYPE_SHORT['Possible single-family office']).toMatch(/\?$/); // reads as a question, never a fact
    expect(confidenceLabel('certain')).toBe('Strong signals');
  });

  it('says what each source found', () => {
    expect(foundText('sec_owners', { owners: 1200, filings: 1500 })).toBe('1,200 owners from 1,500 filings');
    expect(foundText('propublica', { foundations: 3, searches: 40 })).toBe('3 private foundations from 40 searches');
    expect(foundText('wikidata', {})).toBe('0 notable founders');
  });
});
