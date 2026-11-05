import { describe, expect, it } from 'vitest';
import { toneVsPeers, toneVsPrev } from './tone';

describe('good or bad', () => {
  it('growth is green, shrinking red, flat or plain numbers uncoloured', () => {
    expect(toneVsPrev('revenue', 110, 100)).toBe('up');
    expect(toneVsPrev('revenue', 90, 100)).toBe('down');
    expect(toneVsPrev('revenue', 100.2, 100)).toBe('');
    expect(toneVsPrev('totalAssets', 200, 100)).toBe('');
    expect(toneVsPrev('sga', 200, 100)).toBe('');
  });
  it('debt and dilution: lower is better; losses are red', () => {
    expect(toneVsPrev('longTermDebt', 80, 100)).toBe('up');
    expect(toneVsPrev('dilutedShares', 105, 100)).toBe('down');
    expect(toneVsPrev('netIncome', -5, -10)).toBe('down');
    expect(toneVsPrev('netIncome', 5, null)).toBe('');
  });
  it('against peers: cheaper multiples and better margins are green', () => {
    expect(toneVsPeers('pe', 15, 22)).toBe('up');
    expect(toneVsPeers('pe', 30, 22)).toBe('down');
    expect(toneVsPeers('pe', -4, 22)).toBe('');
    expect(toneVsPeers('netMargin', 0.25, 0.12)).toBe('up');
    expect(toneVsPeers('netMargin', 0.125, 0.12)).toBe('');
  });
});
