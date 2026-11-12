import { describe, expect, it } from 'vitest';
import { edgeLines } from '../home/edge';
import { bp, changeBp, curveEdgeLine, gapScale, monthName, oddsWord, recordWords, shapeWords, side, standouts, standoutWords, type CurveFit, type CurveRow, type Recession } from './curveFit';

const row = (label: string, y: number, gapBp: number, z: number | null, usualBp: number | null = 0, sdBp: number | null = 2): CurveRow => ({
  label, years: 1, yield: y, fitted: y - gapBp / 100, gapBp, usualBp, sdBp, z, days: 52, reading: '',
});

// 2026-11-10 shape (U.S. Treasury par curve): 2Y 4.73, 10Y 4.98; 3Y 3 bp under the curve, z -2.87.
const rows = [row('3M', 4.3, 6.2, 2.4), row('2Y', 4.73, 0.6, -0.6), row('3Y', 4.74, -3.0, -2.87), row('10Y', 4.98, -3.5, -0.4)];

const rec: Recession = {
  probability: 0.1287, spread: 0.684, monthDays: 7, month: '2026-11', a: -0.75, b: -0.56, n: 790, auc: 0.82, testFrom: '1981-01',
  fitFrom: '1959-01', fitTo: '2025-10', history: [{ month: '2026-10', spread: 0.8, p: 0.11 }], alarm: 0.3,
  record: {
    recessions: [{ start: '1960-05', flagged: false }, { start: '1970-01', flagged: true }, { start: '2008-01', flagged: true }],
    falseAlarms: [{ from: '1966-10', to: '1966-10', recession: false, judged: true }, { from: '2022-12', to: '2024-10', recession: false, judged: true }],
    open: [],
  },
};

describe('What the curve says', () => {
  it('formats basis points with a real minus sign', () => {
    expect(bp(6.24)).toBe('+6.2 bp');
    expect(bp(-3.03)).toBe('−3.0 bp');
    expect(bp(-0.04)).toBe('0.0 bp');
    expect(bp(null)).toBe('—');
    expect(changeBp(4.89, 5.0)).toBe('−11 bp');
    expect(changeBp(4.89, null)).toBe('—');
  });

  it('reads the slope and only calls 2.5 SD unusual', () => {
    expect(shapeWords(rows)).toBe('Upward sloping: the 10-year pays 25 bp more than the 2-year.');
    expect(shapeWords([row('2Y', 4.9, 0, 0), row('10Y', 4.5, 0, 0)])).toBe('Inverted: the 10-year pays 40 bp less than the 2-year.');
    expect(shapeWords([row('2Y', 4.9, 0, 0), row('10Y', 4.95, 0, 0)])).toBe('Nearly flat: the 10-year pays 5 bp more than the 2-year.');
    expect(standouts(rows).map((r) => r.label)).toEqual(['3Y']);
    expect(side(rows[2])).toBe('rich');
    expect(side(rows[0])).toBe('cheap');
    expect(standoutWords(rows)).toBe('3Y is unusually rich (−3.0 bp off the curve, usually 0.0 bp).');
    expect(standoutWords([row('2Y', 4.7, 1, 1)])).toBe('Every maturity sits within its usual distance of the fitted curve.');
    expect(standoutWords([row('2Y', 4.7, 1, null)])).toMatch(/26 weeks/);
  });

  it('puts the usual band and today on one shared scale', () => {
    // widest reach: 3M at 6.2 bp vs bands 0 ± 2.5 x 2 = 5 -> scale 6.2 x 1.08
    const pos = gapScale(rows);
    expect(pos(0)).toBe(50);
    expect(pos(6.2)).toBeCloseTo(50 + 50 / 1.08, 6);
    expect(pos(-1000)).toBe(0);
  });

  it('states the recession model’s record, false alarms included', () => {
    expect(recordWords(rec)).toBe('Tested since 1981 using only what was known at the time: its odds reached 30% before 2 of 3 recessions, with 2 false alarms (latest Dec 2022–Oct 2024).');
    expect(recordWords({ ...rec, record: { ...rec.record, falseAlarms: [] } })).toMatch(/and no false alarms\.$/);
    expect(oddsWord(0.13)).toBe('Low');
    expect(oddsWord(0.3)).toBe('Moderate');
    expect(oddsWord(0.55)).toBe('High');
    expect(monthName('2026-11')).toBe('Nov 2026');
  });

  it('adds one line to Home’s Edge today, linking to the tab', () => {
    const d = { date: '2026-11-10', rows, recession: rec } as unknown as CurveFit;
    const line = curveEdgeLine(d)!;
    expect([line.label, line.value, line.tone, line.href]).toEqual(['Recession odds, next 12 months', '13%', '', '#invest/bonds/curve']);
    expect(line.detail).toBe('10y − 3m +0.68 pts · 3Y unusually rich vs the curve');
    expect(curveEdgeLine({ ...d, recession: { ...rec, probability: 0.45 } } as CurveFit)!.tone).toBe('down');
    expect(curveEdgeLine({ ...d, recession: null } as unknown as CurveFit)).toBeNull();
    expect(curveEdgeLine(null)).toBeNull();
    expect(edgeLines(null, null, d).map((l) => l.label)).toEqual(['Recession odds, next 12 months']);
  });
});
