import { describe, expect, it } from 'vitest';
import { GRID_SLOTS, MAX_PANELS, PRESETS, deleteNamed, findLayout, loadWorkspaces, normalizeLayout, saveNamed, saveWorkspaces, type Workspaces } from './workspaceLayouts';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('workspace layouts', () => {
  it('has the three presets, each with enough panels for its grid', () => {
    expect(PRESETS.map((l) => l.name)).toEqual(['Morning', 'Trade', 'Research']);
    for (const l of PRESETS) {
      expect(l.panels).toHaveLength(MAX_PANELS);
      expect(GRID_SLOTS[l.grid]).toBeLessThanOrEqual(MAX_PANELS);
    }
  });

  it('cleans up a damaged layout', () => {
    const l = normalizeLayout({ name: '  Mine ', grid: '9x9', panels: [{ type: 'chart', link: 'red', symbol: ' nvda ', timeframe: '1h' }, { type: 'bogus', link: 'pink', symbol: 5, timeframe: '1s' }] });
    expect(l.name).toBe('Mine');
    expect(l.grid).toBe(PRESETS[0].grid);
    expect(l.panels).toHaveLength(MAX_PANELS);
    expect(l.panels[0]).toEqual({ type: 'chart', link: 'red', symbol: 'NVDA', timeframe: '1h' });
    expect(l.panels[1]).toEqual(PRESETS[0].panels[1]); // every bad field falls back (no second charts)
    expect(normalizeLayout(null)).toEqual(PRESETS[0]);
  });

  it('saves, replaces and deletes named layouts, and refuses preset names', () => {
    let w: Workspaces = { current: normalizeLayout(null), saved: [] };
    const mine = { ...PRESETS[2], grid: '2x1' as const };
    const r = saveNamed(w, mine, 'Earnings');
    if ('error' in r) throw new Error(r.error);
    w = r;
    expect(w.current.name).toBe('Earnings');
    expect(w.saved.map((l) => l.name)).toEqual(['Earnings']);
    const again = saveNamed(w, { ...mine, grid: '3x2' }, 'earnings');
    if ('error' in again) throw new Error(again.error);
    expect(again.saved).toHaveLength(1);
    expect(again.saved[0].grid).toBe('3x2');
    expect(saveNamed(w, mine, 'morning')).toHaveProperty('error');
    expect(saveNamed(w, mine, '  ')).toHaveProperty('error');
    // a found layout is a copy: changing it on screen doesn't change the saved one
    const found = findLayout(again, 'earnings') ?? findLayout(again, 'Earnings')!;
    found.panels[0].symbol = 'ZZZ';
    expect(again.saved[0].panels[0].symbol).toBe('AAPL');
    expect(findLayout(again, 'Trade')?.grid).toBe('1+2');
    expect(findLayout(again, 'Nope')).toBeNull();
    expect(deleteNamed(again, 'earnings').saved).toEqual([]);
  });

  it('round-trips through storage and survives storage that throws or holds junk', () => {
    const store = memory();
    const w: Workspaces = { current: { ...PRESETS[1] }, saved: [{ ...PRESETS[2], name: 'Deep dive' }] };
    expect(saveWorkspaces(w, store)).toBe(true);
    const back = loadWorkspaces(store);
    expect(back.current.name).toBe('Trade');
    expect(back.saved[0].name).toBe('Deep dive');
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadWorkspaces(broken).current).toEqual(PRESETS[0]);
    expect(saveWorkspaces(w, broken)).toBe(false);
    expect(saveWorkspaces(w, null)).toBe(false);
    store.setItem('tp-workspace', '{oops');
    expect(loadWorkspaces(store)).toEqual({ current: PRESETS[0], saved: [] });
  });
});
