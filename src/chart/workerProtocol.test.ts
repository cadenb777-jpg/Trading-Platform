import { describe, expect, it } from 'vitest';
import { defaultParams, getIndicator } from '../indicators/library';
import type { IndicatorDef } from '../indicators/types';
import type { Bar } from '../types';
import { handleRequest, packBars, packValues, transferables, unpackBars, unpackValues, type ComputeReply } from './workerProtocol';

const bars: Bar[] = Array.from({ length: 60 }, (_, i) => ({ time: 1700000000 + i * 60, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 100 + i }));

describe('indicator worker protocol', () => {
  it('packs bars and values without losing anything (NaN included)', () => {
    expect(unpackBars(packBars(bars))).toEqual(bars);
    expect(packBars(bars).length).toBe(60 * 6);
    const values = { a: [NaN, 1.5, -2], b: [] };
    expect(unpackValues(packValues(values))).toEqual(values);
  });

  it('answers each job with the same values as computing on the page', () => {
    const replies: ComputeReply[] = [];
    const ema = getIndicator('ema')!;
    const rsi = getIndicator('rsi')!;
    handleRequest(
      { id: 7, bars: packBars(bars), jobs: [{ key: 'x', defId: 'ema', params: defaultParams(ema) }, { key: 'y', defId: 'rsi', params: { ...defaultParams(rsi), length: 5 } }] },
      getIndicator,
      (r) => replies.push(r),
    );
    expect(replies.map((r) => [r.id, r.key])).toEqual([
      [7, 'x'],
      [7, 'y'],
    ]);
    const [x, y] = replies;
    if (!('values' in x) || !('values' in y)) throw new Error('expected values');
    expect(unpackValues(x.values)).toEqual(ema.compute(bars, defaultParams(ema)));
    expect(unpackValues(y.values)).toEqual(rsi.compute(bars, { ...defaultParams(rsi), length: 5 }));
    expect(transferables(x)).toHaveLength(1);
    expect(x.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports unknown, outside-data and failing indicators as errors, and carries on', () => {
    const replies: ComputeReply[] = [];
    const broken = { id: 'boom', external: undefined, compute: () => { throw new Error('bad maths'); } } as unknown as IndicatorDef;
    const find = (id: string) => (id === 'boom' ? broken : getIndicator(id));
    handleRequest(
      { id: 1, bars: packBars(bars), jobs: [{ key: 'a', defId: 'nope', params: {} }, { key: 'b', defId: 'cot', params: {} }, { key: 'c', defId: 'boom', params: {} }, { key: 'd', defId: 'sma', params: { length: 3, source: 'close' } }] },
      find,
      (r) => replies.push(r),
    );
    expect(replies.map((r) => ('error' in r ? `${r.key}:error` : `${r.key}:ok`))).toEqual(['a:error', 'b:error', 'c:error', 'd:ok']);
    expect(replies[2]).toMatchObject({ error: 'bad maths' });
    expect(transferables(replies[0])).toEqual([]);
  });
});
