import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEngineCache, engineRequest, helper, stableKey } from './schwab';

afterEach(() => {
  vi.restoreAllMocks();
  clearEngineCache();
});

describe('engine reply cache', () => {
  it('builds the same key whatever the key order, keeping nested fields', () => {
    expect(stableKey({ b: 1, a: { y: [1, { q: 2, p: 1 }], x: 'k' } })).toBe(stableKey({ a: { x: 'k', y: [1, { p: 1, q: 2 }] }, b: 1 }));
    expect(stableKey({ holdings: [{ symbol: 'A', weight: 1 }] })).not.toBe(stableKey({ holdings: [{ symbol: 'B', weight: 1 }] }));
  });

  it('reuses a recent read-only reply and joins one already in flight', async () => {
    const spy = vi.spyOn(helper, 'request').mockResolvedValue({ type: 'engine', data: { ok: 1 } } as never);
    const [a, b] = await Promise.all([engineRequest('macro.curve'), engineRequest('macro.curve')]);
    expect(a).toEqual({ ok: 1 });
    expect(b).toEqual({ ok: 1 });
    await engineRequest('macro.curve');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never caches saves, failures or explicit refreshes', async () => {
    const spy = vi.spyOn(helper, 'request').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ type: 'engine', data: 1 } as never);
    await expect(engineRequest('bonds.market')).rejects.toThrow('offline');
    await engineRequest('bonds.market');
    await engineRequest('store.save', { collection: 'x' });
    await engineRequest('store.save', { collection: 'x' });
    await engineRequest('bonds.market', { refresh: true });
    expect(spy).toHaveBeenCalledTimes(5);
  });
});
