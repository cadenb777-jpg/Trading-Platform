import { describe, expect, it } from 'vitest';
import { WIDGETS, addWidget, defaultLayout, hiddenWidgets, moveWidget, nextSpan, parseLayout, removeWidget, updateWidget } from './widgets';

describe('Home widget layout', () => {
  it('starts with every widget at its default width', () => {
    expect(defaultLayout().items.map((i) => i.id)).toEqual(WIDGETS.map((w) => w.id));
  });

  it('reads saved layouts defensively', () => {
    expect(parseLayout(null)).toEqual(defaultLayout());
    expect(parseLayout('not json')).toEqual(defaultLayout());
    expect(parseLayout('{"v":2,"items":[]}')).toEqual(defaultLayout());
    const l = parseLayout(JSON.stringify({ v: 1, items: [{ id: 'news', span: 12 }, { id: 'nope', span: 4 }, { id: 'news', span: 4 }, { id: 'accounts', span: 5, collapsed: true }] }));
    expect(l.items).toEqual([{ id: 'news', span: 12 }, { id: 'accounts', span: 4, collapsed: true }]);
    expect(parseLayout('{"v":1,"items":[]}').items).toEqual([]); // an emptied Home stays empty
  });

  it('moves, removes, adds and resizes', () => {
    const d = defaultLayout();
    const moved = moveWidget(d, 0, 2);
    expect(moved.items.slice(0, 3).map((i) => i.id)).toEqual(['accounts', 'brief', 'indexes']);
    expect(moveWidget(d, 0, 99).items.at(-1)!.id).toBe('indexes');
    expect(moveWidget(d, 5, -3).items[0].id).toBe('events');
    const less = removeWidget(d, 'news');
    expect(less.items.some((i) => i.id === 'news')).toBe(false);
    expect(hiddenWidgets(less).map((w) => w.id)).toEqual(['news']);
    expect(addWidget(less, 'news').items.at(-1)).toEqual({ id: 'news', span: 8 });
    expect(addWidget(d, 'news')).toBe(d);
    expect(nextSpan(4)).toBe(6);
    expect(nextSpan(12)).toBe(4);
    expect(updateWidget(d, 'news', { collapsed: true }).items.find((i) => i.id === 'news')?.collapsed).toBe(true);
  });
});
