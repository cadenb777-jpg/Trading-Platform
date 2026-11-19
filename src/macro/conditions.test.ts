import { describe, expect, it } from 'vitest';
import { conditions, conditionsWords, nowcast, nowcastWords, quarterLabel } from './conditions';

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

describe('GDP nowcast', () => {
  // FRED GDPNOW and A191RL1Q225SBEA, checked live 2026-11-19
  const gdpnow = [
    { time: '2026-01-01', value: 1.2392 },
    { time: '2026-04-01', value: 1.54 },
    { time: '2026-07-01', value: 3.2721 },
    { time: '2026-10-01', value: 3.2093 },
  ];
  const gdp = [
    { time: '2026-01-01', value: 2.5 },
    { time: '2026-04-01', value: 2.2 },
    { time: '2026-07-01', value: 3.4 },
  ];

  it('the running quarter against the newest official one, with its record', () => {
    const n = nowcast(gdpnow, gdp)!;
    expect(quarterLabel('2026-10-01')).toBe('Q4 2026');
    expect(quarterLabel('2026-01-01')).toBe('Q1 2026');
    expect(n.running).toBe(true);
    // misses |1.2392 - 2.5| = 1.2608, |1.54 - 2.2| = 0.66, |3.2721 - 3.4| = 0.1279: median 0.66
    expect(n.record).toEqual({ n: 3, medianMiss: expect.closeTo(0.66, 6) });
    expect(nowcastWords(n)).toBe(
      'The Atlanta Fed’s GDPNow model puts real growth in Q4 2026 at 3.2% a year, from the data out so far; the official figure comes about a month after the quarter ends. The newest official figure: 3.4% for Q3 2026. Over 3 quarters its final estimate has been 0.7 points away from today’s official figures in a typical (median) quarter, so read it as a range, not a point.',
    );
  });

  it('after the official figure is out; nothing to say without data', () => {
    const n = nowcast(gdpnow.slice(0, 3), gdp)!;
    expect(n.running).toBe(false);
    expect(nowcastWords(n)).toMatch(/^GDPNow’s last estimate for Q3 2026 was 3\.3% a year; the official figure is out\./);
    // an even count: the median is the middle two averaged
    expect(nowcast(gdpnow.slice(0, 2), gdp)!.record!.medianMiss).toBeCloseTo((1.2608 + 0.66) / 2, 6);
    expect(nowcast([], gdp)).toBeNull();
    // the official series couldn't be loaded: whether the quarter is still running is unknown, so it isn't claimed
    const blind = nowcast(gdpnow, null)!;
    expect(blind.running).toBeNull();
    expect(nowcastWords(blind)).toBe('The Atlanta Fed’s GDPNow model’s latest estimate for Q4 2026 is 3.2% a year.');
    expect(nowcastWords(nowcast([{ time: '2026-10-01', value: -0.04 }], null)!)).toMatch(/is 0\.0% a year\.$/);
  });
});

describe('Financial conditions', () => {
  // weekly NFCI ending with FRED's 2026-10-30 / 11-06 / 11-13 readings (-0.470, -0.473, -0.478)
  const weeks = (vals: number[], last: string) => {
    const end = Date.parse(`${last}T00:00:00Z`);
    return vals.map((value, i) => ({ time: new Date(end - (vals.length - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10), value }));
  };
  const nfci = weeks([0.6, 0.2, -0.6, -0.55, -0.5, -0.44, -0.45, -0.46, -0.46, -0.46, -0.46, -0.47, -0.47, -0.47, -0.47, -0.47, -0.473, -0.478], '2026-11-13');
  const anfci = [{ time: '2026-11-13', value: -0.502 }];

  it('where today sits, how it moved, and the adjusted index', () => {
    const c = conditions(nfci, anfci)!;
    // looser (lower) than -0.478: -0.6, -0.55, -0.5 -> 3 of 18
    // tighter (higher): 0.6, 0.2, -0.44, -0.45, four -0.46, five -0.47 and -0.473 = 14; looser: -0.6, -0.55, -0.5 = 3
    expect([c.looser, c.tighter, c.weeks]).toEqual([3, 14, 18]);
    // 13 weeks back is -0.5 (position 4): -0.478 - (-0.5) = +0.022
    expect(c.change13w).toBeCloseTo(0.022, 9);
    expect(conditionsWords(c, day)).toBe(
      'In the week to Nov 13, 2026 the Chicago Fed’s index stood at −0.48: money and credit were looser than the index’s average since 1971 (zero). 17% of weeks since 2026 were looser, so it sits within its usual range. Little changed over the last 13 weeks. Allowing for the state of the economy (ANFCI), looser too, at −0.50.',
    );
  });

  it('the extremes, a tightening, no adjusted reading', () => {
    const loose = conditions(weeks([0.1, 0.2, 0.3, -0.9], '2026-11-13'), [])!;
    expect(conditionsWords(loose, day)).toMatch(/No week since 2026 was looser\./);
    // 1 of 20 weeks looser = 5%
    expect(conditionsWords(conditions(weeks([-1, ...Array(18).fill(0.5), -0.2], '2026-11-13'), [])!, day)).toMatch(/Only 5% of weeks since 2026 were looser\./);
    const tight = conditions(weeks([...Array(13).fill(-0.5), 0.4], '2026-11-13'), [])!;
    expect(conditionsWords(tight, day)).toMatch(/tighter than the index’s average since 1971 \(zero\)\. No week since 2026 was tighter\. Over the last 13 weeks conditions tightened by 0\.90\.$/);
    expect(conditions([], [])).toBeNull();
    // today ties the tightest earlier week: no week was tighter (ties are neither)
    const tie = conditions(weeks([-0.5, 0.2, 0.9, 0.9], '2026-11-13'), [])!;
    expect(conditionsWords(tie, day)).toMatch(/No week since 2026 was tighter\./);
    // -0.005 prints as -0.01 and is said as looser (one rounding rule for figure and side)
    const half = conditions(weeks([0.3, -0.3, -0.005], '2026-11-13'), [])!;
    expect(conditionsWords(half, day)).toMatch(/stood at −0\.01: money and credit were looser than/);
    // a reading that rounds to zero has no sign and no side
    const zero = conditions(weeks([0.3, -0.3, -0.004], '2026-11-13'), [{ time: '2026-11-13', value: 0.001 }])!;
    expect(conditionsWords(zero, day)).toMatch(/stood at 0\.00: money and credit were at the index’s average since 1971 \(zero\)\..*\(ANFCI\), average too, at 0\.00\.$/);
  });
});
