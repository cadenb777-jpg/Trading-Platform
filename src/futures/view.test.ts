import { describe, expect, it } from 'vitest';
import { cotSummaryText, cotTone, curveReading, daysUntil, futuresPrice, heatStrength, sigmaText, tickDecimals } from './view';

describe('futures view helpers', () => {
  it('shows as many decimals as the tick', () => {
    expect(tickDecimals(0.25)).toBe(2);
    expect(tickDecimals(0.0001)).toBe(4);
    expect(tickDecimals(1 / 64)).toBe(6);
    expect(tickDecimals(5)).toBe(0);
    expect(tickDecimals(0.0000005)).toBe(7);
    expect(futuresPrice(6812.25, 0.25)).toBe('6,812.25');
    expect(futuresPrice(112345, 5)).toBe('112,345');
    expect(futuresPrice(1.16455, 0.00005)).toBe('1.16455');
    expect(futuresPrice(4.1234, 0.0001)).toBe('4.1234');
    expect(futuresPrice(112.515625, 1 / 64)).toBe('112.5156');
    expect(futuresPrice(0.0065231, 0.0000005)).toBe('0.0065231');
    expect(futuresPrice(null, 0.25)).toBe('unavailable');
  });

  it('tints heat tiles up to a 2% move', () => {
    expect(heatStrength(0)).toBe(0);
    expect(heatStrength(-0.01)).toBe(0.5);
    expect(heatStrength(0.05)).toBe(1);
    expect(heatStrength(null)).toBe(0);
  });

  it('writes moves in standard deviations', () => {
    expect(sigmaText(2.345)).toBe('+2.3σ');
    expect(sigmaText(-1.04)).toBe('-1.0σ');
    expect(sigmaText(-0.01)).toBe('0.0σ');
    expect(sigmaText(null)).toBe('—');
  });

  it('explains the curve, with SOFR read as rates', () => {
    expect(curveReading('contango', 'CL')).toMatch(/cost more/);
    expect(curveReading('backwardation', 'CL')).toMatch(/tight supply/);
    expect(curveReading('contango', 'SR3')).toMatch(/lower interest rates/);
    expect(curveReading(null, 'ES')).toBe('');
  });

  it('marks commercials at extremes and counts days', () => {
    expect(cotTone(85)).toBe('up');
    expect(cotTone(15)).toBe('down');
    expect(cotTone(50)).toBe('');
    expect(daysUntil('2026-11-01', new Date(2026, 9, 26))).toBe(6);
  });
});

describe('cotSummaryText (the one-line COT summary on Flow and Research)', () => {
  it('reads the latest week and flags extremes', () => {
    const rows = [
      { date: '2026-10-13', specIndex: 50, commIndex: 50 },
      { date: '2026-10-20', specIndex: 12, commIndex: 85 },
    ];
    expect(cotSummaryText({ market: 'Nasdaq-100', rows })).toBe('Nasdaq-100 futures: hedgers 85 / 100 (crowded long), speculators 12 / 100 (crowded short) · CFTC 2026-10-20');
  });
  it('says so when there is no report', () => {
    expect(cotSummaryText({ market: 'Gold', rows: [] })).toBe('No COT report for Gold yet.');
    expect(cotSummaryText({ market: 'Gold', rows: [{ date: '2026-10-20', specIndex: null, commIndex: 40 }] })).toBe('Gold futures: hedgers 40 / 100, speculators — · CFTC 2026-10-20');
  });
});
