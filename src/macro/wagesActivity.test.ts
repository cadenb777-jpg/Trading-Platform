import { describe, expect, it } from 'vitest';
import { activity, activityWords, wageWords, wages, type Point } from './wagesActivity';

const p = (time: string, value: number): Point => ({ time, value });

describe('Wage growth', () => {
  // FRED, 2026-11-20: FRBATLWGT3MMAUMHWGO 3.9 (Sep 2026), 4.2 (Sep 2025); MEDCPIM159SFRBCLE Jul-Sep 2026
  const tracker = [p('2025-09-01', 4.2), p('2026-06-01', 3.6), p('2026-07-01', 3.8), p('2026-08-01', 4.1), p('2026-09-01', 3.9)];
  const median = [p('2026-07-01', 2.69355252969239), p('2026-08-01', 2.5794196607), p('2026-09-01', 2.6104464786)];

  it('reads the pay rise against a year earlier and against median prices over the same three months', () => {
    const w = wages(tracker, median)!;
    expect(w).toMatchObject({ month: '2026-09-01', value: 3.9, yearAgo: 4.2, months: 5, higher: 2, since: '2025-09-01' });
    // (2.6936 + 2.5794 + 2.6104) / 3 = 2.6278 -> 2.6; 3.9 - 2.6 = 1.3 as printed (one value for the chip and the words)
    expect(w.cpi).toBeCloseTo(2.6278062229974632, 12);
    expect(w.real).toBe(1.3);
    expect(wageWords(w, 'loaded')).toBe(
      'In Sep 2026 the typical (median) pay rise was 3.9% over a year, for the same people a year apart, down from 4.2% a year before. With median prices up 2.6% over the same three months, pay ran 1.3 points ahead of prices (roughly). 40% of months since 2025 were faster.',
    );
  });

  it('reads the gap from the figures as printed, every way', () => {
    // 4.9 - 0.25: the raw gap 4.65 would print 4.7, but 4.9 - 0.3 (as printed) = 4.6, and that is what both show
    expect(wages([p('2026-09-01', 4.9)], [p('2026-07-01', 0.25), p('2026-08-01', 0.25), p('2026-09-01', 0.25)])!.real).toBe(4.6);
    const slow = wages([p('2025-09-01', 3.9), p('2026-09-01', 3.9)], median.map((x) => ({ ...x, value: 4.2 })))!;
    expect(slow.real).toBe(-0.3);
    expect(wageWords(slow, 'loaded')).toMatch(/the same pace as a year before\. With median prices up 4\.2% over the same three months, pay ran 0\.3 points behind prices \(roughly\)\./);
    const even = wages([p('2026-09-01', 2.6)], median)!;
    expect(wageWords(even, 'loaded')).toMatch(/for the same people a year apart\. With median prices up 2\.6% over the same three months, pay kept pace with prices\./);
  });

  it('never fills a missing month', () => {
    // September's median CPI not out yet: the three months aren't all there
    const w = wages(tracker.slice(1), median.slice(0, 2))!;
    expect([w.yearAgo, w.cpi, w.real]).toEqual([null, null, null]);
    expect(wageWords(w, 'loaded')).toMatch(/Median CPI doesn’t yet cover all three months to Sep 2026, so there is no real pay reading\./);
    expect(wageWords(w, 'empty')).toMatch(/FRED sent no median CPI readings, so there is no real pay reading\./);
    expect(wageWords(w, 'failed')).toMatch(/Median CPI couldn’t be loaded, so there is no real pay reading\./);
    // a gap month in the tracker: the year-ago reading is looked up by date, never by position
    expect(wages([p('2025-08-01', 9), p('2025-10-01', 4.1), p('2026-09-01', 3.9)], [])!.yearAgo).toBeNull();
    expect(wages([], median)).toBeNull();
  });
});

describe('National activity', () => {
  // FRED, 2026-11-20: CFNAIMA3 0.02 0.02 0.01 0.03 (Jun-Sep 2026); CFNAI 0.07 for Sep 2026
  const ma3 = [p('2026-06-01', 0.02), p('2026-07-01', 0.02), p('2026-08-01', 0.01), p('2026-09-01', 0.03)];

  it('reads the 3-month average against trend', () => {
    const a = activity(ma3, [p('2026-09-01', 0.07)])!;
    expect(a).toMatchObject({ month: '2026-09-01', ma3: 0.03, monthly: 0.07, months: 4, stronger: 0, weaker: 3 });
    expect(activityWords(a)).toBe(
      'Over the three months to Sep 2026 the Chicago Fed’s index of 85 activity measures averaged 0.03: the economy grew at about its trend pace (zero). Sep 2026 alone: 0.07. No 3-month stretch since 2026 was stronger.',
    );
    // live: 362 of 713 stretches since 1967 stronger, 339 weaker
    expect(activityWords({ ...a, months: 713, stronger: 362, weaker: 339, since: '1967-05-01' })).toMatch(/51% of 3-month stretches since 1967 were stronger and 48% weaker\.$/);
  });

  it('says faster or slower than trend beyond a tenth, by the figure as printed', () => {
    expect(activityWords({ ...activity(ma3, [])!, ma3: -0.7, stronger: 3, weaker: 0 })).toMatch(/averaged −0\.70: the economy grew slower than its trend pace \(zero\)\. No 3-month stretch since 2026 was weaker\.$/);
    expect(activityWords({ ...activity(ma3, [])!, ma3: 0.1, stronger: 1, weaker: 2 })).toMatch(/averaged 0\.10: the economy grew faster than its trend pace/);
    // 0.096 prints as 0.10: it reads as faster, as printed
    expect(activityWords({ ...activity(ma3, [])!, ma3: 0.096, stronger: 1, weaker: 2 })).toMatch(/averaged 0\.10: the economy grew faster/);
    expect(activity([], [])).toBeNull();
    // no single-month reading: the words leave it out; a negative month prints with a real minus
    expect(activityWords(activity(ma3, [])!)).not.toMatch(/alone/);
    expect(activityWords(activity(ma3, [p('2026-09-01', -0.08)])!)).toMatch(/Sep 2026 alone: −0\.08\./);
  });
});
