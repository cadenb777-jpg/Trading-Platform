import { describe, expect, it } from 'vitest';
import { PRIVATE_FUNDS } from './catalog';
import { FUND_SNAPSHOTS } from './fundSnapshots';

describe('fund snapshots', () => {
  it('belong to funds in the directory and cite a source with a date', () => {
    const ids = new Set(PRIVATE_FUNDS.map((f) => f.id));
    for (const [id, s] of Object.entries(FUND_SNAPSHOTS)) {
      expect(ids.has(id), id).toBe(true);
      expect(s.asOf, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.sources.length, id).toBeGreaterThan(0);
      for (const n of s.nav ?? []) expect(n.value > 0 && n.value < 1000, id).toBe(true);
    }
  });
});
