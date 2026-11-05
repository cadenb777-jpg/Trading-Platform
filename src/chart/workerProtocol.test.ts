import { describe, expect, it } from 'vitest';
import { defaultParams, getIndicator } from '../indicators/library';
import type { IndicatorDef } from '../indicators/types';
import type { Bar } from '../types';
import { JobQueue, PROTOCOL_VERSION, packBars, packValues, transferables, unpackBars, unpackValues, type ComputeJob, type ComputeReply, type ComputeRequest } from './workerProtocol';

const bars: Bar[] = Array.from({ length: 60 }, (_, i) => ({ time: 1700000000 + i * 60, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 100 + i }));

const request = (id: number, jobs: ComputeJob[], generation = 1, group = 'g'): ComputeRequest => ({ v: PROTOCOL_VERSION, type: 'compute', id, group, generation, bars: packBars(bars), jobs });

function drain(queue: JobQueue): ComputeReply[] {
  const out: ComputeReply[] = [];
  for (let r = queue.runNext(); r; r = queue.runNext()) out.push(r);
  return out;
}

describe('indicator worker protocol', () => {
  it('packs bars and values without losing anything (NaN included)', () => {
    expect(unpackBars(packBars(bars))).toEqual(bars);
    expect(packBars(bars).length).toBe(60 * 6);
    const values = { a: [NaN, 1.5, -2], b: [] };
    expect(unpackValues(packValues(values))).toEqual(values);
  });

  it('answers each job, in order, with the same values as computing on the page', () => {
    const ema = getIndicator('ema')!;
    const rsi = getIndicator('rsi')!;
    const queue = new JobQueue(getIndicator);
    expect(queue.receive(request(7, [{ key: 'x', defId: 'ema', params: defaultParams(ema) }, { key: 'y', defId: 'rsi', params: { ...defaultParams(rsi), length: 5 } }]))).toEqual([]);
    expect(queue.size).toBe(2);
    const [x, y] = drain(queue);
    expect([x.key, y.key]).toEqual(['x', 'y']);
    if (!('values' in x) || !('values' in y)) throw new Error('expected values');
    expect(unpackValues(x.values)).toEqual(ema.compute(bars, defaultParams(ema)));
    expect(unpackValues(y.values)).toEqual(rsi.compute(bars, { ...defaultParams(rsi), length: 5 }));
    expect(transferables(x)).toHaveLength(1);
    expect(x.ms).toBeGreaterThanOrEqual(0);
  });

  it('reports unknown, outside-data and failing indicators as errors, and carries on', () => {
    const broken = { id: 'boom', compute: () => { throw new Error('bad maths'); } } as unknown as IndicatorDef;
    const queue = new JobQueue((id) => (id === 'boom' ? broken : getIndicator(id)));
    queue.receive(request(1, [{ key: 'a', defId: 'nope', params: {} }, { key: 'b', defId: 'cot', params: {} }, { key: 'c', defId: 'boom', params: {} }, { key: 'd', defId: 'sma', params: { length: 3, source: 'close' } }]));
    const replies = drain(queue);
    expect(replies.map((r) => ('error' in r ? `${r.key}:error` : `${r.key}:ok`))).toEqual(['a:error', 'b:error', 'c:error', 'd:ok']);
    expect(replies[2]).toMatchObject({ error: 'bad maths' });
    expect(transferables(replies[0])).toEqual([]);
  });

  it('refuses another protocol version', () => {
    const queue = new JobQueue(getIndicator);
    const replies = queue.receive({ ...request(3, [{ key: 'a', defId: 'sma', params: {} }]), v: PROTOCOL_VERSION + 1 });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: 3, key: 'a' });
    expect('error' in replies[0]).toBe(true);
    expect(queue.size).toBe(0);
  });

  it('cancel drops queued jobs of older data for that chart only', () => {
    const queue = new JobQueue(getIndicator);
    const sma = { defId: 'sma', params: { length: 3, source: 'close' } };
    queue.receive(request(1, [{ key: 'old1', ...sma }, { key: 'old2', ...sma }], 1, 'chart-1'));
    queue.receive(request(2, [{ key: 'other', ...sma }], 1, 'chart-2'));
    queue.receive(request(3, [{ key: 'new', ...sma }], 2, 'chart-1'));
    queue.receive({ v: PROTOCOL_VERSION, type: 'cancel', group: 'chart-1', below: 2 });
    expect(drain(queue).map((r) => r.key)).toEqual(['other', 'new']);
  });
});
