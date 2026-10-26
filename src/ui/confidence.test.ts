import { describe, expect, it } from 'vitest';
import { ageText, chipText, confidenceLabel, formatCheckValue, meterPercent, meterText, rubricTitle, statusWords } from './confidence';

describe('confidence meter formatting', () => {
  it('shows whole percents, clamped, never rounding up', () => {
    expect(meterPercent(0.653)).toBe(65);
    expect(meterPercent(0.6)).toBe(60);
    expect(meterPercent(0.97)).toBe(97);
    expect(meterPercent(0.009)).toBe(0);
    expect(meterPercent(1.4)).toBe(100);
    expect(meterPercent(-1)).toBe(0);
    expect(meterPercent(null)).toBe(0);
    expect(meterPercent(NaN)).toBe(0);
    expect(meterText(0.653)).toBe('65% confident');
  });

  it('labels like the helper (80% High, 55% Medium)', () => {
    expect(confidenceLabel(0.8)).toBe('High');
    expect(confidenceLabel(0.799)).toBe('Medium');
    expect(confidenceLabel(0.55)).toBe('Medium');
    expect(confidenceLabel(0.54)).toBe('Low');
    expect(confidenceLabel(0.9, false)).toBe('None');
  });

  it('formats values by unit', () => {
    expect(formatCheckValue(230.1, 'usd')).toBe('$230.10');
    expect(formatCheckValue(1234.5, 'usd')).toBe('$1,234.50');
    expect(formatCheckValue(0.4512, 'usd')).toBe('$0.4512');
    expect(formatCheckValue(0.0045, 'pct')).toBe('0.45%');
    expect(formatCheckValue(0.0006, 'pct')).toBe('0.060%');
    expect(formatCheckValue(null, 'usd')).toBe('—');
  });

  it('describes ages in words', () => {
    const now = Date.UTC(2026, 9, 26, 12) ;
    const t = now / 1000;
    expect(ageText(t - 30, now)).toBe('just now');
    expect(ageText(t - 600, now)).toBe('10 min ago');
    expect(ageText(t - 5 * 3600, now)).toBe('5 h ago');
    expect(ageText(t - 3 * 86400, now)).toBe('3 days ago');
    expect(ageText(Date.UTC(2026, 8, 30, 20) / 1000, now)).toBe('on 2026-09-30');
    expect(ageText(null, now)).toBe('time not given');
  });

  it('chip text before and after a check', () => {
    expect(chipText(null)).toBe('Sources');
    expect(chipText({ score: 0.877, best: 230 })).toBe('Sources · 87%');
    expect(chipText({ score: 0, best: null })).toBe('Sources · none');
  });

  it('plain words and the rubric tooltip', () => {
    expect(statusWords('conflict')).toBe('Sources disagree');
    expect(rubricTitle(['a', 'b'])).toBe('How the confidence is scored:\n• a\n• b');
  });
});
