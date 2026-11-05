import { describe, expect, it } from 'vitest';
import { CONNECTIONS, NO_KEY_SOURCES, rowModel } from './connections';
import type { PlatformSettings } from './settings';

const base: PlatformSettings = { aiKeySet: false, fredKeySet: false, secContact: '', model: 'claude-opus-5-5', models: [] };
const newHelper: PlatformSettings = { ...base, blsKeySet: false, beaKeySet: true, eiaKeySet: false, censusKeySet: false, finnhubKeySet: false, alpacaSet: false };
const conn = (id: string) => CONNECTIONS.find((c) => c.id === id)!;

describe('Data connections rows', () => {
  it('lists every connection once, each with what it unlocks, an https sign-up link and a free-tier limit', () => {
    expect(CONNECTIONS.map((c) => c.id).sort()).toEqual(['ai', 'alpaca', 'bea', 'bls', 'census', 'eia', 'finnhub', 'fred', 'sec']);
    for (const c of CONNECTIONS) {
      expect(c.unlocks.length, c.id).toBeGreaterThan(20);
      expect(c.signup, c.id).toMatch(/^https:\/\//);
      expect(c.limit, c.id).toBeTruthy();
      expect(c.fields.length, c.id).toBeGreaterThan(0);
    }
    expect(NO_KEY_SOURCES).toEqual(['World Bank', 'IMF', 'OECD', 'ECB', 'US Treasury', 'SEC', 'Polymarket', 'Kalshi']);
  });

  it('keeps the existing settings field names (backward compatible)', () => {
    const fields = CONNECTIONS.flatMap((c) => c.fields.map((f) => f.field));
    for (const f of ['aiKey', 'fredKey', 'secContact', 'alpacaKeyId', 'alpacaSecret', 'beaKey', 'blsKey', 'eiaKey', 'censusKey', 'finnhubKey']) expect(fields).toContain(f);
  });

  it('masks keys: only the SEC email is a plain field, a saved key shows "Saved" and never its value', () => {
    expect(CONNECTIONS.flatMap((c) => c.fields).filter((f) => !f.secret).map((f) => f.field)).toEqual(['secContact']);
    const m = rowModel(conn('bea'), newHelper);
    expect(m.placeholders[0]).toMatch(/^Saved/);
    expect(m.dot).toBe('ok');
    expect(m.canTest).toBe(true);
    expect(m.canRemove).toBe(true);
  });

  it('a missing key is "Not set" (or optional) and cannot be tested', () => {
    expect(rowModel(conn('eia'), newHelper)).toMatchObject({ dot: 'off', status: '○ Not set', canTest: false, canRemove: false });
    expect(rowModel(conn('bls'), newHelper).status).toBe('○ Optional, not set');
  });

  it('shows the last test: testing, connected or the reason', () => {
    expect(rowModel(conn('bea'), newHelper, 'testing')).toMatchObject({ dot: 'testing', canTest: false });
    expect(rowModel(conn('bea'), newHelper, { ok: true, message: 'Connected.' })).toMatchObject({ dot: 'ok', status: '✓ Connected', message: 'Connected.' });
    expect(rowModel(conn('bea'), newHelper, { ok: false, message: 'BEA: The UserId provided is not valid.' })).toMatchObject({ dot: 'bad', status: '✗ Not working' });
  });

  it('an older helper that does not know a connection says so instead of offering a box', () => {
    const m = rowModel(conn('finnhub'), base);
    expect(m.supported).toBe(false);
    expect(m.status).toBe('Needs the updated helper');
    expect(rowModel(conn('fred'), base).supported).toBe(true);
  });

  it('the SEC email reads as set, can be tested but not removed', () => {
    expect(rowModel(conn('sec'), { ...newHelper, secContact: 'me@example.com' })).toMatchObject({ status: '● Set', canTest: true, canRemove: false });
  });
});
