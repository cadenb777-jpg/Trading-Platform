import { describe, expect, it } from 'vitest';
import { addTile, addView, cleanSymbols, currentView, deleteView, moveTile, nextSpan, parseDesk, removeTile, renameView, starterDesk, updateTile } from './desk';

describe('desk layout', () => {
  it('falls back to the starter views on damaged data and keeps only valid tiles', () => {
    expect(parseDesk('not json').views.map((v) => v.name)).toEqual(['Morning', 'Trading']);
    expect(parseDesk(JSON.stringify({ views: [] })).views).toHaveLength(2);
    const d = parseDesk(JSON.stringify({ current: 'x', views: [{ id: 'a', name: 'Mine', tiles: [{ id: '1', type: 'chart', span: 7, symbols: ['aapl', 'bad ticker!', 'AAPL'] }, { id: '2', type: 'nope', span: 4 }] }] }));
    expect(d.current).toBe('a');
    expect(d.views[0].tiles).toEqual([{ id: '1', type: 'chart', span: 6, symbols: ['AAPL'] }]);
  });
  it('cleans ticker lists', () => {
    expect(cleanSymbols('aapl, msft  $spx /es nvda nvda')).toEqual(['AAPL', 'MSFT', '$SPX', '/ES', 'NVDA']);
    expect(cleanSymbols(42)).toEqual([]);
  });
  it('adds, renames and deletes views (never the last one)', () => {
    let d = addView(starterDesk(), '  Night  ');
    expect(currentView(d).name).toBe('Night');
    d = renameView(d, d.current, 'Evening');
    expect(currentView(d).name).toBe('Evening');
    const night = d.current;
    d = deleteView(d, night);
    expect(d.views.map((v) => v.name)).toEqual(['Morning', 'Trading']);
    expect(d.current).toBe('v-trading');
    expect(deleteView(deleteView(d, 'v-trading'), 'v-morning').views).toHaveLength(1);
  });
  it('adds, moves, resizes and removes tiles in the current view', () => {
    let d = addTile(starterDesk(), 'quotes', ['tsla', 'f']);
    const v = currentView(d);
    const t = v.tiles[v.tiles.length - 1];
    expect(t).toMatchObject({ type: 'quotes', span: 4, symbols: ['TSLA', 'F'] });
    d = moveTile(d, t.id, -1);
    expect(currentView(d).tiles.at(-2)!.id).toBe(t.id);
    expect(moveTile(d, currentView(d).tiles[0].id, -1)).toEqual(d); // already first
    d = updateTile(d, t.id, { span: nextSpan(4) });
    expect(currentView(d).tiles.find((x) => x.id === t.id)!.span).toBe(6);
    d = removeTile(d, t.id);
    expect(currentView(d).tiles.some((x) => x.id === t.id)).toBe(false);
    expect(nextSpan(12)).toBe(3);
  });
});
