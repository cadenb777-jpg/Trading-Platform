import { describe, expect, it } from 'vitest';
import { missedRecessions, nowWords, recessionStarts, recordWords, sahmSignals, sahmState, type MonthPoint } from './sahm';

/** Monthly points from a start month, one per value. */
function months(start: string, values: number[]): MonthPoint[] {
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  return values.map((value) => {
    const p = { time: `${y}-${String(m).padStart(2, '0')}-01`, value };
    m++;
    if (m > 12) (m = 1), y++;
    return p;
  });
}

describe('Sahm rule recession check', () => {
  // 30 months from Jan 2000: quiet, a recession starting Apr 2001 (month 16), the rule firing Jun 2001 (month 18),
  // staying high, falling back, then a second firing after 12 quiet months with no recession (a false alarm)
  const sahm = months('2000-01', [
    ...Array(17).fill(0.1), // Jan 2000 - May 2001
    0.53, 0.8, 1.1, // Jun - Aug 2001: fires once (Jun), stays above
    0.45, 0.6, // Sep - Oct 2001: one month below is the same episode (no new signal)
    ...Array(10).fill(0.2), // Nov 2001 - Aug 2002: quiet
    0.5, // Sep 2002: fires again
  ]);
  const usrec = months('2000-01', [...Array(15).fill(0), ...Array(8).fill(1), ...Array(10).fill(0)]);

  it('finds recession starts and each new crossing, matched to the nearest start', () => {
    expect(recessionStarts(usrec)).toEqual(['2001-04-01']);
    expect(sahmSignals(sahm, usrec)).toEqual([
      // Jun 2001 - Apr 2001 = 2 months after the start
      { date: '2001-06-01', value: 0.53, recessionStart: '2001-04-01', monthsFromStart: 2 },
      // Sep 2002 is 17 months after: outside the 6-month match, so a false alarm
      { date: '2002-09-01', value: 0.5, recessionStart: null, monthsFromStart: null },
    ]);
  });

  it('six quiet months make a new episode (the Aug 1981 recession after 1980)', () => {
    // FRED SAHMREALTIME, May - Nov 1981: below 0.50 for six months, then 0.80 in Nov 1981; NBER: recession from Aug 1981
    const s = months('1981-04', [0.83, 0.47, 0.1, 0, -0.13, 0.07, 0.4, 0.8]);
    const u = months('1981-04', [0, 0, 0, 0, 1, 1, 1, 1]);
    expect(sahmSignals(s, u)).toEqual([{ date: '1981-11-01', value: 0.8, recessionStart: '1981-08-01', monthsFromStart: 3 }]);
  });

  it('a reading above the line at the very start of the series is not a crossing', () => {
    expect(sahmSignals(months('1959-12', [0.77, 0.6, 0.4]), [])).toEqual([]);
  });

  it('says the record with misses, and today in words', () => {
    const s = sahmSignals(sahm, usrec);
    expect(recordWords(s, '2000-01-01', '2002-09-01')).toBe(
      'Since 2000 it has reached 0.50 twice. One came within 2 months of a recession’s start, mostly just after it had begun: it confirms a recession more than it forecasts one. One (Sep 2002) was not followed by a recession NBER has declared (its dates run to Sep 2002).',
    );
    expect(recordWords([], '1959-12-01', null)).toBe('It hasn’t reached 0.50 since 1959.');
    // the Apr 2001 recession began after the series did (testable) and was flagged
    const rec = missedRecessions(sahm, usrec, s);
    expect(rec).toEqual({ testable: ['2001-04-01'], missed: [] });
    expect(recordWords(s, '2000-01-01', null, rec)).toMatch(/it confirms a recession more than it forecasts one\. It flagged the one recession since 2001\./);
    // a recession with no signal near it is said as missed
    const quiet = months('2000-01', Array(30).fill(0.1));
    const miss = missedRecessions(quiet, usrec, sahmSignals(quiet, usrec));
    expect(miss).toEqual({ testable: ['2001-04-01'], missed: ['2001-04-01'] });
    // FRED SAHMREALTIME, checked live 2026-11-19: 0.00 for October 2026
    expect(nowWords({ time: '2026-10-01', value: 0 })).toBe('In Oct 2026 the 3-month average unemployment rate was 0.00 points above its low of the year before. That is 0.50 points short of the 0.50 line: no sign of a recession from jobs.');
    expect(nowWords({ time: '2024-07-01', value: 0.53 })).toMatch(/at or past the 0\.50 line the rule uses: by its record, a recession has probably begun\.$/);
    expect([sahmState(0.29), sahmState(0.3), sahmState(0.5)]).toEqual(['calm', 'watch', 'triggered']);
    // below zero (unemployment falling to new lows, as in 2021-22): said as below, the gap to the line from there
    expect(nowWords({ time: '2022-03-01', value: -0.4 })).toBe('In Mar 2022 the 3-month average unemployment rate was 0.40 points below its low of the year before: unemployment was still falling. That is 0.90 points short of the 0.50 line: no sign of a recession from jobs.');
  });
});
