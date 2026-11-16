import { describe, expect, it } from 'vitest';
import { insightKey, recentInsight, rememberInsight, RECENT_MS } from './insight';

describe('automatic AI summaries', () => {
  it('reuses a read for the same page and symbol for 30 minutes, then writes a new one', () => {
    const key = insightKey({ topic: 'research', symbol: 'AAPL', title: 'Research: AAPL' });
    expect(key).toBe('research|AAPL|Research: AAPL');
    rememberInsight(key, 'read', 'conv', 1_000);
    expect(recentInsight(key, 1_000 + RECENT_MS - 1)?.text).toBe('read');
    expect(recentInsight(key, 1_000 + RECENT_MS)).toBeNull();
    expect(recentInsight(insightKey({ topic: 'research', symbol: 'MSFT', title: 'Research: MSFT' }), 1_000)).toBeNull();
  });
});
