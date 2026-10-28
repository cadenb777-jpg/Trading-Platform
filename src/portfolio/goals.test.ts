import { describe, expect, it } from 'vitest';
import { TERMS } from '../ui/glossary';
import { GOALS, cleanViews, compareName, compareNote, compareRows, compareVerdict, defaultMaxWeight, figureRows, pctOrDash, randomWalkLine, rowName, vsText } from './goals';
import { niceTicks, tickDecimals } from './optimiserCharts';
import type { GoalResult, Optimisation, WalkForwardRow } from './types';

const row = (key: WalkForwardRow['key'], sharpe: number): WalkForwardRow => ({ key, return: 0.05, volatility: 0.1, maxDrawdown: -0.2, sharpe, turnover: 0.1 }) as WalkForwardRow;
const goal = (key: GoalResult['key'], p: number, runs = 100): GoalResult => ({
  key, weights: [0.5, 0.5], expectedReturn: 0.07, volatility: 0.12, yield: 0.021, maxDrawdown: -0.25, cvar: 0.08, trackingError: null, riskContributions: [0.6, 0.4],
  stability: { runs: 10, low: [0.4, 0.4], high: [0.6, 0.6] }, randomWalk: { method: key, runs, edge: 0.1, p },
});

const result = {
  walkForward: { windowYears: 3, days: 1000, short: false, rows: [row('current', 0.4), row('equal', 0.45), row('growth', 0.3), row('risk_parity', 0.6), row('hrp', 0.5)] },
  goals: [goal('growth', 1, 0), { ...goal('risk_parity', 0.04), randomWalk: { method: 'risk_parity', runs: 100, edge: 0.1, p: 0.04, pAdjusted: 0.08, family: 3 } }, goal('hrp', 0.3)],
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

  it('lists goals in goal order (Even risk first), merges identical ones and uses Holm-adjusted p', () => {
    const rows = compareRows(result);
    expect(rows.map((x) => x.key)).toEqual(['risk_parity', 'growth', 'hrp']);
    expect(rows.map((x) => x.beatCurrent)).toEqual([true, false, true]);
    expect(rows.find((x) => x.key === 'growth')!.p).toBeNull();
    expect(rows.find((x) => x.key === 'risk_parity')!.p).toBe(0.08);
    expect(compareNote(result)).toContain('2 of 3 distinct goals beat your current mix');
    expect(compareNote(result)).toContain('(1 here)');
    expect(compareNote({ ...result, walkForward: null } as Optimisation)).toBe('');
    const merged = { ...result, goals: [...result.goals!, { ...goal('min_var', 0.5), sameAs: 'risk_parity' }] } as Optimisation;
    merged.walkForward = { ...merged.walkForward!, rows: [...merged.walkForward!.rows, row('min_var', 0.6)] };
    const m = compareRows(merged);
    expect(m).toHaveLength(3);
    expect(compareName(m[0])).toBe('Even risk (same weights: Lowest volatility)');
  });

  it('says whether any goal clearly beats Even risk (2 standard errors)', () => {
    const withVs = (vs: { diff: number; se: number }[]) =>
      ({ ...result, goals: result.goals!.map((g) => ({ ...g, vsEvenRisk: g.key === 'risk_parity' ? null : vs[g.key === 'growth' ? 0 : 1] })) }) as Optimisation;
    expect(compareVerdict(withVs([{ diff: 0.1, se: 0.08 }, { diff: -0.05, se: 0.04 }]))).toContain('No goal clearly beats Even risk: every difference');
    expect(compareVerdict(withVs([{ diff: 0.3, se: 0.1 }, { diff: 0.0, se: 0.04 }]))).toContain('Best return for the risk beat Even risk');
    expect(compareVerdict(withVs([{ diff: -0.3, se: 0.1 }, { diff: 0.0, se: 0.04 }]))).toContain('did clearly worse');
    expect(vsText({ diff: -0.05, se: 0.04 })).toBe('−0.05 ± 0.04');
    expect(vsText(null)).toBe('baseline');
    expect(defaultMaxWeight(3)).toBeCloseTo(2 / 3 > 0.5 ? 0.5 : 2 / 3);
    expect(defaultMaxWeight(6)).toBeCloseTo(1 / 3);
    expect(defaultMaxWeight(12)).toBe(0.25);
  });

  it('formats before/after figures and the random-walk line', () => {
    const cur = { ...goal('growth', 1), yield: null, trackingError: null };
    const rows = figureRows(cur, goal('hrp', 0.3));
    expect(rows.map((r) => r.label)).toEqual(['Expected return / yr', 'Volatility / yr', 'Dividend yield', 'Worst drop', 'Bad-month loss (CVaR 95%)']);
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
