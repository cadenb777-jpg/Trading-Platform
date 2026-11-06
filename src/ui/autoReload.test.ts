import { describe, expect, it } from 'vitest';
import { quietNow, scriptName } from './autoReload';

describe('auto reload', () => {
  it('reads the built script name from the page', () => {
    expect(scriptName('<script type="module" crossorigin src="/trading-platform/assets/index-AbC123.js"></script>')).toBe('index-AbC123.js');
    expect(scriptName('<script type="module" src="/src/main.ts"></script>')).toBe('');
  });
  it('waits for a quiet moment', () => {
    const doc = (hidden: boolean, tag = 'BODY', dialog = false) =>
      ({ hidden, activeElement: { tagName: tag }, querySelector: () => (dialog ? {} : null) }) as unknown as Document;
    expect(quietNow(doc(true), 0, 1)).toBe(true); // background tab
    expect(quietNow(doc(true, 'INPUT'), 0, 1)).toBe(false); // background tab, but left mid-typing
    expect(quietNow(doc(true), 0, 1, '#trade')).toBe(false); // never on the Trade page (order ticket)
    expect(quietNow(doc(true, 'BODY', true), 0, 1)).toBe(false); // a window is open (e.g. order confirm)
    expect(quietNow(doc(false), 0, 30_000)).toBe(false); // touched 30 s ago
    expect(quietNow(doc(false), 0, 61_000)).toBe(true);
    expect(quietNow(doc(false, 'INPUT'), 0, 120_000)).toBe(false); // typing in a field
  });
});
