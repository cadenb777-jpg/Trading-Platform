import { describe, expect, it } from 'vitest';
import { TERMS } from '../ui/glossary';
import { GOALS, cleanViews, compareNote, compareRows, figureRows, pctOrDash, randomWalkLine, rowName } from './goals';
import { niceTicks, tickDecimals } from './optimiserCharts';
import type { GoalResult, Optimisation, WalkForwardRow } from './types';

const row = (key: WalkForwardRow['key'], sharpe: number): WalkForwardRow => ({ key, return: 0.05, volatility: 0.1, maxDrawdown: -0.2, sharpe, turnover: 0.1 }) as WalkForwardRow;
const goal = (key: GoalResult['key'], p: number, runs = 100): GoalResult => ({
  key, weights: [0.5, 0.5], expectedReturn: 0.07, volatility: 0.12, yield: 0.021, maxDrawdown: -0.25, cvar: 0.08, trackingError: null, riskContributions: [0.6, 0.4],
  stability: { runs: 10, low: [0.4, 0.4], high: [0.6, 0.6] }, randomWalk: { method: key, runs, edge: 0.1, p },
});

const result = {
  walkForward: { windowYears: 3, days: 1000, short: false, rows: [row('current', 0.4), row('equal', 0.45), row('growth', 0.3), row('risk_parity', 0.6), row('hrp', 0.5)] },
  goals: [goal('growth', 1, 0), goal('risk_parity', 0.04), goal('hrp', 0.3)],
} as unknown as Optimisation;

describe('optimiser goals', () => {
  it('has a name, a one-line explanation and a glossary term for every goal', () => {
    expect(GOALS).toHaveLength(9);
    for (const g of GOALS) {
      expect(g.line.length).toBeGreaterThan(20);
      expect(TERMS[g.term], g.term).toBeTruthy();
    }
    for (const t of ['efficientFrontier', 'riskContribution', 'trackingError', 'turnover', 'sectorCap', 'lookback', 'returnEstimate', 'tradingCosts', 'cvarMonth', 'optViews']) expect(TERMS[t], t).toBeTruthy();
    expect(rowName('current')).toBe('Your current mix');
    expect(rowName('risk_parity')).toBe('Even risk');
  });

  it('ranks goals by out-of-sample Sharpe and keeps p only when shuffles ran', () => {
    const rows = compareRows(result);
    expect(rows.map((x) => x.key)).toEqual(['risk_parity', 'hrp', 'growth']);
    expect(rows.map((x) => x.beatCurrent)).toEqual([true, true, false]);
    expect(rows.find((x) => x.key === 'growth')!.p).toBeNull();
    expect(compareNote(result)).toContain('2 of 3 goals beat your current mix');
    expect(compareNote(result)).toContain('(1 here)');
    expect(compareNote({ ...result, walkForward: null } as Optimisation)).toBe('');
  });

  it('formats before/after figures and the random-walk line', () => {
    const cur = { ...goal('growth', 1), yield: null, trackingError: null };
    const rows = figureRows(cur, goal('hrp', 0.3));
    expect(rows.map((r) => r.label)).toEqual(['Expected return / yr', 'Volatility / yr', 'Dividend yield', 'Worst drop (history)', 'Bad-month loss (CVaR 95%)']);
    expect(rows[2]).toMatchObject({ now: '—', next: '2.10%' });
    expect(rows[4].next).toBe('-8.0%');
    expect(randomWalkLine({ method: 'hrp', runs: 100, edge: 0.1, p: 0.0495 }, 'HRP')).toContain('In 4 of 100');
    expect(randomWalkLine({ method: 'hrp', runs: 0, edge: -0.1, p: 1 }, 'HRP')).toContain('Not needed');
    expect(pctOrDash(undefined)).toBe('—');
  });

  it('cleans views: upper-case symbols, % to fractions, confidence kept in range, blanks dropped', () => {
    expect(cleanViews([{ symbol: ' gld', ret: '8', confidence: 0.6 }, { symbol: 'VTI', ret: '', confidence: 0.5 }, { symbol: 'X', ret: '5', confidence: 2 }])).toEqual([
      { symbol: 'GLD', return: 0.08, confidence: 0.6 },
      { symbol: 'X', return: 0.05, confidence: 0.99 },
    ]);
  });

  it('makes clean percent ticks', () => {
    expect(niceTicks(0.031, 0.142)).toEqual([0.05, 0.1]);
    expect(niceTicks(0.0, 0.2)).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
    expect(niceTicks(0.104, 0.121)).toEqual([0.105, 0.11, 0.115, 0.12]);
    expect(tickDecimals([0.105, 0.11])).toBe(1);
    expect(tickDecimals([0.1, 0.2])).toBe(0);
  });
});
