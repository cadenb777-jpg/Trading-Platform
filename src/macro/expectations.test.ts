import { describe, expect, it } from 'vitest';
import { curveWords, expectations, gapOf, gapWords, HORIZONS, jobs, jobsState, jobsWords, monthlyAverages, sharePct, shiftMonths, stateWords, type Point } from './expectations';

const p = (time: string, value: number): Point => ({ time, value });

// FRED, downloaded 2026-11-20: the Cleveland Fed's estimates for November 2025, October 2026 and November 2026
// (November 2026's was published on Nov 10, so it is built from data before November)
const EXPINF: Record<number, [number, number, number]> = {
  1: [2.70387514, 2.98009996, 3.04205808],
  2: [2.49947396, 2.87826931, 2.86513592],
  5: [2.33094326, 2.78016447, 2.71865337],
  10: [2.30712971, 2.73553113, 2.66630958],
  30: [2.4318941, 2.7029675, 2.65568621],
};
const model = new Map(HORIZONS.map((y) => [y as number, [p('2025-11-01', EXPINF[y][0]), p('2026-10-01', EXPINF[y][1]), p('2026-11-01', EXPINF[y][2])]]));

describe('Expected inflation', () => {
  it('moves months and rounds shares without reading 0% or 100% for some', () => {
    expect([shiftMonths('2026-01-01', -1), shiftMonths('2026-12', 1), shiftMonths('2026-11', -12)]).toEqual(['2025-12', '2027-01', '2025-11']);
    expect([sharePct(0, 250), sharePct(1, 250), sharePct(249, 250), sharePct(250, 250), sharePct(27, 250)]).toEqual([0, 1, 99, 100, 11]);
  });

  it('averages whole months only: the newest month in the data is left out', () => {
    const daily = [p('2026-09-30', 2.3), p('2026-10-01', 2.4), p('2026-10-02', 2.5), p('2026-10-05', Number.NaN), p('2026-11-02', 9)];
    const avg = monthlyAverages(daily);
    expect([...avg.keys()]).toEqual(['2026-09', '2026-10']);
    expect(avg.get('2026-10')).toBeCloseTo(2.45, 10);
    // a saved copy that stops on Oct 20 never counts October as whole
    expect([...monthlyAverages(daily.slice(0, 3)).keys()]).toEqual(['2026-09']);
  });

  it('reads the curve, a year earlier and the model against the month before’s breakeven', () => {
    // October 2026's 5-year breakeven averaged 2.39857 over 21 days (FRED T5YIE); here two days with that mean
    const be5 = [p('2026-10-01', 2.39857), p('2026-10-30', 2.39857), p('2026-11-19', 2.22)];
    const e = expectations(model, be5, [])!;
    expect(e.month).toBe('2026-11-01');
    expect(e.curve.map((c) => c.years)).toEqual([1, 2, 5, 10, 30]);
    expect(e.yearAgo![0].value).toBe(2.70387514);
    expect(e.gaps).toHaveLength(1); // no 10-year breakevens loaded: no 10-year gap
    const g = e.gaps[0];
    expect(g).toMatchObject({ years: 5, modelMonth: '2026-11-01', marketMonth: '2026-10-01', model: 2.71865337, breakeven: 2.39857, months: 1, lower: 0, higher: 0 });
    // 2.39857 - 2.71865337 = -0.32008337
    expect(g.gap).toBeCloseTo(-0.32008337, 8);
    expect(curveWords(e)).toBe(
      'In November 2026 the Cleveland Fed’s model expected inflation to average 3.04% over the next year and 2.66% over the next 30 years, so it expects inflation to be higher in the near term than over the long run. A year earlier: 2.70% and 2.43% (up 0.34 points and up 0.23 points).',
    );
    expect(gapWords(g)).toBe('5-year: the bond market’s breakeven averaged 2.40% in October 2026, 0.32 points below the model’s 2.72% for November 2026.');
  });

  it('reads the tilt from the figures as printed', () => {
    const flat = new Map(HORIZONS.map((y) => [y as number, [p('2026-11-01', y === 1 ? 2.664 : 2.656)]]));
    // 2.664 and 2.656 both print as 2.66%: the same, though the raw gap rounds to 0.01
    expect(curveWords(expectations(flat, [], [])!)).toMatch(/2\.66% over the next year and 2\.66% over the next 30 years, the same in the near term as over the long run\.$/);
  });

  it('places the gap among every month compared, by its own sign', () => {
    // twelve pairs: market 0.10 above the model eleven times, then 0.38 below (2.40 - 2.78)
    const months = Array.from({ length: 13 }, (_, i) => shiftMonths('2025-01', i));
    const m5 = months.map((m, i) => p(`${m}-01`, i < 12 ? 2.3 : 2.78));
    const be = months.map((m) => p(`${m}-15`, 2.4));
    const g = gapOf(5, m5, be)!;
    expect([g.months, g.marketMonth, g.modelMonth]).toEqual([12, '2025-12-01', '2026-01-01']);
    expect(g.typical).toBeCloseTo(0.1, 10);
    expect([g.lower, g.higher]).toEqual([0, 11]);
    expect(gapWords(g)).toBe(
      '5-year: the bond market’s breakeven averaged 2.40% in December 2025, 0.38 points below the model’s 2.78% for January 2026. Over the 12 months compared, the typical (median) gap was 0.10 points above the model; no month had a lower gap.',
    );
    // a market above the model with the lowest gap of the record still says "lower gap", never "below"
    expect(gapWords({ ...g, gap: 0.05, lower: 0, higher: 11 })).toMatch(/0\.05 points above the model’s 2\.78% for January 2026\..*no month had a lower gap\.$/);
    expect(gapWords({ ...g, gap: 0.4, lower: 11, higher: 0 })).toMatch(/no month had a higher gap\.$/);
    // live (FRED 2026-11-20): 5-year, 27 of 250 lower = 11%, within the usual range; 10-year, 12 of 250 = 5%
    expect(gapWords({ ...g, months: 250, lower: 27, higher: 222, typical: 0.01772 })).toMatch(/0\.02 points above the model, so today’s gap is within its usual range\.$/);
    expect(gapWords({ ...g, months: 250, lower: 12, higher: 237, typical: 0.07061 })).toMatch(/0\.07 points above the model; only 5% of months had a lower gap\.$/);
    expect(gapWords({ ...g, months: 250, lower: 237, higher: 12, typical: 0.07061 })).toMatch(/only 5% of months had a higher gap\.$/);
    expect(gapWords({ ...g, months: 250, lower: 249, higher: 0, typical: -0.004 })).toMatch(/gap was level with the model; no month had a higher gap\.$/);
  });

  it('needs every horizon in a month, else uses the month before', () => {
    const partial = new Map(model);
    partial.set(30, [p('2025-11-01', 2.4318941), p('2026-10-01', 2.7029675)]);
    const e = expectations(partial, [], [])!;
    expect(e.month).toBe('2026-10-01');
    expect(e.yearAgo).toBeNull(); // October 2025 isn't loaded
    expect(e.gaps).toEqual([]);
    expect(expectations(new Map(), [], [])).toBeNull();
  });
});

describe('Jobs market', () => {
  it('names the four states of Hakkio and Willis from the figures as printed', () => {
    expect(jobsState(0.37182, 0.26727)).toBe('strong-improving');
    expect(jobsState(0.37, -0.2)).toBe('strong-slowing');
    expect(jobsState(-0.5, 0.1)).toBe('weak-improving');
    expect(jobsState(-0.5, -0.1)).toBe('weak-slowing');
    expect(stateWords(0.37182, 0.26727)).toBe('Above average, gaining momentum');
    expect(stateWords(-0.5, -0.1)).toBe('Below average, losing momentum');
    // -0.004 prints as 0.00: at its average, never "weaker" or "stronger"
    expect(stateWords(-0.004, 0.004)).toBe('At its average, momentum at its usual pace');
  });

  it('reads October 2026 (FRED FRBKCLMCILA / FRBKCLMCIM, 2026-11-20)', () => {
    const level = [p('2026-06-01', 0.9), p('2026-07-01', 0.21785), p('2026-08-01', 0.3168), p('2026-09-01', 0.29428), p('2026-10-01', 0.37182)];
    const mom = [p('2026-09-01', 0.24811), p('2026-10-01', 0.26727)];
    const j = jobs(level, mom)!;
    expect(j).toMatchObject({ month: '2026-10-01', level: 0.37182, momentum: 0.26727, months: 5, higher: 1, since: '2026-06-01', state: 'strong-improving' });
    expect(j.change3m).toBeCloseTo(0.15397, 10); // 0.37182 - 0.21785
    expect(jobsWords(j)).toBe(
      'In October 2026 the Kansas City Fed’s reading of 24 labour measures stood at 0.37: more hiring and work than its long-run average (zero), with momentum at 0.27 (improving faster than usual). 20% of months since 2026 were stronger. Up 0.15 points over three months.',
    );
    // without the momentum reading for that month there is no state
    expect(jobs(level, [mom[0]])!.state).toBeNull();
    expect(jobs([], mom)).toBeNull();
  });

  it('says "as much as" at zero and never 0% for one stronger month', () => {
    const level = Array.from({ length: 250 }, (_, i) => p(`${shiftMonths('2006-01', i)}-01`, i === 0 ? 1 : i === 249 ? -0.004 : -1));
    const j = jobs(level, [])!;
    expect(j.higher).toBe(1);
    expect(jobsWords(j)).toMatch(/stood at 0\.00: about as much hiring and work as its long-run average \(zero\)\. 1% of months since 2006 were stronger\. Up 1\.00 points over three months\.$/);
  });
});
