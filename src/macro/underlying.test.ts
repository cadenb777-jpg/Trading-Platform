import { describe, expect, it } from 'vitest';
import { MEASURES, paceFromAnnualRates, paceFromLevels, probRecord, probWords, row, underlyingWords, yearlyFromLevels, type Point, type Row } from './underlying';

const p = (time: string, value: number): Point => ({ time, value });
const m = (k: string) => MEASURES.find((x) => x.key === k)!;

describe('Underlying inflation', () => {
  it('compounds three monthly annual rates (FRED MEDCPIM158SFRBCLE, Aug-Oct 2026)', () => {
    const med = [p('2026-08-01', 2.1041087807), p('2026-09-01', 2.8081575376), p('2026-10-01', 3.6649805553)];
    // ((1.021041)(1.028082)(1.036650))^(1/12 x 4) - 1 = 2.8571%: the same as the index level's 3-month pace below
    expect(paceFromAnnualRates(med)!.pace).toBeCloseTo(2.8571, 3);
    // MEDCPIM094SFRBCLE index, Jul-Oct 2026: (376.0800699661 / 373.440784623172)^4 - 1 = 2.8571%
    const idx = [p('2026-07-01', 373.440784623172), p('2026-08-01', 374.0893534779), p('2026-09-01', 374.9537025076), p('2026-10-01', 376.0800699661)];
    expect(paceFromLevels(idx)!.pace).toBeCloseTo(2.8571, 3);
    // a gap in the months: no pace
    expect(paceFromAnnualRates([med[0], med[2], p('2026-11-01', 3)])).toBeNull();
    expect(paceFromAnnualRates(med.slice(1))).toBeNull();
  });

  it('works out 12-month rates from an index, now and a year earlier', () => {
    const idx = [p('2024-10-01', 100), p('2025-10-01', 103), p('2026-10-01', 105.06)];
    const y = yearlyFromLevels(idx)!;
    expect(y.month).toBe('2026-10-01');
    expect(y.now).toBeCloseTo(2, 10); // 105.06 / 103
    expect(y.yearAgo).toBeCloseTo(3, 10);
    expect(yearlyFromLevels([p('2026-10-01', 105)])!.now).toBeNull();
    // FRED CPIAUCSL has no October 2025 (BLS published none): no 12-month rate for October 2026, and it says which
    const gap = yearlyFromLevels([p('2025-09-01', 324.245), p('2025-11-01', 325.063), p('2026-10-01', 337.476)])!;
    expect([gap.now, gap.missing]).toEqual([null, '2025-10-01']);
    // a year on (October 2027) the gap sits behind "a year earlier" instead, and is named there
    const later = yearlyFromLevels([p('2024-10-01', 315.6), p('2025-09-01', 324.245), p('2025-11-01', 325.063), p('2026-10-01', 337.476), p('2027-10-01', 345)])!;
    expect(later.now).toBeCloseTo((345 / 337.476 - 1) * 100, 10);
    expect([later.yearAgo, later.yearAgoMissing, later.missing]).toEqual([null, '2025-10-01', null]);
    expect(yearlyFromLevels([])).toBeNull();
  });

  it('builds a row from the published series', () => {
    const year = [p('2025-10-01', 3.27614491336918), p('2026-10-01', 2.799156584)];
    const monthly = [p('2026-08-01', 2.1041087807), p('2026-09-01', 2.8081575376), p('2026-10-01', 3.6649805553)];
    const r = row(m('median'), year, monthly)!;
    expect(r).toMatchObject({ month: '2026-10-01', year: 2.799156584, yearAgo: 3.27614491336918 });
    expect(r.pace3).toBeCloseTo(2.8571, 3);
    // the monthly series a month behind the 12-month one: no pace for a different month
    expect(row(m('median'), year, monthly.slice(0, 2))!.pace3).toBeNull();
    // CPI from its index (FRED CPIAUCSL)
    const cpi = [p('2025-10-01', 324.248), p('2026-07-01', 332.778), p('2026-08-01', 334.0), p('2026-09-01', 335.5), p('2026-10-01', 337.476)];
    const c = row(m('cpi'), cpi, [])!;
    expect(c.year).toBeCloseTo((337.476 / 324.248 - 1) * 100, 10);
    expect(c.pace3).toBeCloseTo((Math.pow(337.476 / 332.778, 4) - 1) * 100, 10);
  });

  it('reads the three measures together (FRED, 2026-11-20)', () => {
    const rows: Row[] = [
      { measure: m('median'), month: '2026-10-01', year: 2.799156584, yearAgo: 3.276, pace3: 2.8571 },
      { measure: m('sticky'), month: '2026-10-01', year: 3.059467681, yearAgo: 3.078, pace3: 3.7553 },
      { measure: m('trimmed'), month: '2026-09-01', year: 2.26, yearAgo: 2.76, pace3: 2.2659 },
    ];
    // 3-month vs 12-month at one decimal: 2.9 > 2.8, 3.8 > 3.1, 2.3 = 2.3 -> 2 faster, 0 slower
    expect(underlyingWords(rows)).toBe(
      'Over 12 months the underlying measures run at 2.3% to 3.1%; all three are above 2%. Over the last 3 months 2 of the 3 ran faster than their 12-month rate and none slower: no clear turn yet. The Fed’s 2% goal is for PCE inflation; CPI measures usually run a few tenths higher.',
    );
    const up = rows.map((r) => ({ ...r, pace3: r.year! + 0.5 }));
    expect(underlyingWords(up)).toMatch(/all three have run faster than its 12-month rate: underlying inflation has picked up lately\./);
    const down = rows.map((r) => ({ ...r, year: 1.9, pace3: 1.5 }));
    expect(underlyingWords(down)).toMatch(/run at 1\.9%; none of all three is above 2%\. Over the last 3 months all three have run slower/);
    expect(underlyingWords([])).toBe('None of the underlying inflation measures could be loaded right now.');
  });
});

describe('Recession probability', () => {
  // months from 1969-01: USREC 1 for 1970-01..1970-11 and 1973-12..1975-03 (two recessions), 0 otherwise
  const months = Array.from({ length: 96 }, (_, i) => `${1969 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`);
  const inRec = (t: string) => (t >= '1970-01-01' && t <= '1970-11-01') || (t >= '1973-12-01' && t <= '1975-03-01');
  const usrec = months.map((t) => p(t, inRec(t) ? 1 : 0));

  it('sorts crossings into on time, repeats, late and false alarms', () => {
    // crosses at 1970-01 (on time), again at 1970-08 after six months below (a repeat), at 1972-03 (no recession: a
    // false alarm) and at 1974-07 (seven months into the 1973 recession: late)
    const high = new Set(['1970-01-01', '1970-08-01', '1972-03-01', '1974-07-01']);
    const prob = months.map((t) => p(t, high.has(t) ? 60 : 5));
    const r = probRecord(prob, usrec)!;
    expect(r.onTime.map((s) => s.date)).toEqual(['1970-01-01']);
    expect(r.late).toEqual([{ date: '1974-07-01', value: 60, recessionStart: '1973-12-01', monthsIn: 7 }]);
    expect(r.alarms.map((s) => s.date)).toEqual(['1972-03-01']);
    expect([r.testable, r.missed]).toEqual([['1970-01-01', '1973-12-01'], []]);
    expect(probWords(r, true, '1976-12-01')).toBe(
      'For Dec 1976 the model puts the chance that the US economy was in recession at 5.0%. Since 1970 it crossed 50% in the same month as the start of 1 of 2 recessions. It was late for the one starting Dec 1973 (Jul 1974, 7 months in). 1 false alarm (Mar 1972), by NBER dates to Dec 1976. The history is smoothed with later data, so this record is better than it looked at the time.',
    );
  });

  it('names a recession it never crossed for, and a clean record', () => {
    const prob = months.map((t) => p(t, t === '1970-02-01' ? 0.4 * 200 : 0.4));
    const r = probRecord(prob, usrec)!;
    expect(r.missed).toEqual(['1973-12-01']);
    expect(probWords(r, true, null)).toMatch(/within 1 month of the start of 1 of 2 recessions\. It never crossed for the one starting Dec 1973\. No false alarms\./);
    const clean = probRecord(prob.slice(0, 40), usrec)!; // through Apr 1972: one recession to test
    expect(probWords(clean, true, null)).toMatch(/^For Apr 1972 .* at 0\.4%\. Since 1970 it crossed 50% within 1 month of the start of the one recession\. No false alarms\./);
    // live (FRED RECPROUSM156N, 2026-11-20): 0.40% for September 2026
    expect(probWords({ ...r, latest: p('2026-09-01', 0.4) }, false, null)).toBe(
      'For Sep 2026 the model puts the chance that the US economy was in recession at 0.4%. Its record needs the NBER recession dates (FRED USREC), which couldn’t be loaded right now.',
    );
    expect(probRecord([], usrec)).toBeNull();
  });

  it('counts recessions, not crossings; says "both"; leaves out a recession already under way', () => {
    // two on-time crossings for the 1970 recession (Jul 1969, six months before, and Feb 1970 after six quiet months), one for 1973's
    const high = new Set(['1969-07-01', '1970-02-01', '1974-01-01']);
    const r = probRecord(months.map((t) => p(t, high.has(t) ? 60 : 5)), usrec)!;
    expect(r.onTime).toHaveLength(3);
    expect(probWords(r, true, null)).toMatch(/Since 1970 it crossed 50% within 6 months of the start of both recessions\. No false alarms\./);
    // NBER dates that begin mid-recession (Jan 1970 already 1): a crossing then is neither a call nor an alarm
    const lateStart = usrec.filter((x) => x.time >= '1970-03-01');
    const r2 = probRecord(months.map((t) => p(t, t === '1970-06-01' ? 60 : 5)), lateStart)!;
    expect([r2.onTime, r2.late, r2.alarms]).toEqual([[], [], []]);
  });
});
