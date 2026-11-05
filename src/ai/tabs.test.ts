import { describe, expect, it } from 'vitest';
import { resetUndo, runAction, setUndoPrefix, type ActionEnv } from './actions';
import { addressedTo, groupByOwner, undoOwner } from './tabs';

describe('one tab answers the pop-out', () => {
  it('only the targeted tab answers; untargeted messages are ignored', () => {
    expect(addressedTo({ kind: 'run', target: 'tabA' }, 'tabA')).toBe(true);
    expect(addressedTo({ kind: 'run', target: 'tabA' }, 'tabB')).toBe(false);
    expect(addressedTo({ kind: 'run' }, 'tabA')).toBe(false);
  });

  it('undo ids name their tab, never clash across tabs, and group for undo', async () => {
    const env = {
      state: { provider: 'schwab', symbols: {}, timeframe: '1D', chartType: 'candles', indicators: [], watchlist: [] },
      persist() {},
      syncChart() {},
      guessMarket: (s: string) => ({ provider: 'schwab', symbol: s.toUpperCase() }),
    } as unknown as ActionEnv;
    resetUndo();
    setUndoPrefix('tabA');
    const a = await runAction(env, 'add_to_watchlist', { symbol: 'MSFT' });
    setUndoPrefix('tabB');
    const b = await runAction(env, 'add_to_watchlist', { symbol: 'NVDA' });
    expect(a.undoId).not.toBe(b.undoId);
    expect(undoOwner(a.undoId!)).toBe('tabA');
    expect(undoOwner(b.undoId!)).toBe('tabB');
    expect([...groupByOwner([a.undoId!, b.undoId!, 'junk']).entries()]).toEqual([
      ['tabA', [a.undoId]],
      ['tabB', [b.undoId]],
    ]);
    setUndoPrefix('local');
  });
});
