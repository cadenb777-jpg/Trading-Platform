import { describe, expect, it } from 'vitest';
import { fallbackNotice, valueGapNote } from './accountNotes';

describe('fallbackNotice', () => {
  it('names the account asked for and the one shown', () => {
    expect(fallbackNotice('Futures ••9999', 'Roth IRA ••1234')).toBe('Futures ••9999 can’t be traded here; showing Roth IRA ••1234.');
    expect(fallbackNotice('', '')).toBe('That account can’t be traded here; showing your first stock account.');
  });
});

describe('valueGapNote', () => {
  it('says nothing when the two values agree (within $1 or 0.1%)', () => {
    expect(valueGapNote('Roth IRA ••1234', 8000, 8000.9)).toBeNull();
    expect(valueGapNote('Roth IRA ••1234', 100000, 100050)).toBeNull();
    expect(valueGapNote('Roth IRA ••1234', null, 8000)).toBeNull();
    expect(valueGapNote('Roth IRA ••1234', 8000, NaN)).toBeNull();
  });
  it('shows both figures when they differ', () => {
    expect(valueGapNote('Roth IRA ••1234', 7820, 8112)).toBe('Webull values Roth IRA ••1234 at $7,820; at live Schwab prices (as the Account page shows it) it is $8,112. The gap is price timing: Webull’s figure can lag the live quotes.');
  });
});
