/**
 * Messages between the chart and the indicator worker (src/chart/indicatorWorker.ts). Bars travel as one packed
 * Float64Array (6 numbers per bar) and each plot's values come back as their own Float64Array, so both directions are
 * plain memory copies instead of cloning thousands of objects. Pure functions, tested in workerProtocol.test.ts.
 */
import type { IndicatorDef, IndicatorParams } from '../indicators/types';
import type { Bar } from '../types';

const FIELDS = 6;

export interface ComputeJob {
  /** Chosen by the caller; comes back on the reply. */
  key: string;
  defId: string;
  params: IndicatorParams;
}

export interface ComputeRequest {
  id: number;
  bars: Float64Array;
  jobs: ComputeJob[];
}

/** One reply per job, sent as soon as that job is done. */
export type ComputeReply =
  | { id: number; key: string; values: Record<string, Float64Array>; ms: number }
  | { id: number; key: string; error: string };

export function packBars(bars: Bar[]): Float64Array {
  const out = new Float64Array(bars.length * FIELDS);
  for (let i = 0, o = 0; i < bars.length; i++, o += FIELDS) {
    const b = bars[i];
    out[o] = b.time;
    out[o + 1] = b.open;
    out[o + 2] = b.high;
    out[o + 3] = b.low;
    out[o + 4] = b.close;
    out[o + 5] = b.volume;
  }
  return out;
}

export function unpackBars(data: Float64Array): Bar[] {
  const bars: Bar[] = new Array(data.length / FIELDS);
  for (let i = 0, o = 0; i < bars.length; i++, o += FIELDS) {
    bars[i] = { time: data[o], open: data[o + 1], high: data[o + 2], low: data[o + 3], close: data[o + 4], volume: data[o + 5] };
  }
  return bars;
}

export const packValues = (values: Record<string, number[]>): Record<string, Float64Array> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Float64Array.from(v, (x) => (typeof x === 'number' ? x : NaN))]));

export const unpackValues = (values: Record<string, Float64Array>): Record<string, number[]> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.from(v)]));

/** The buffers to transfer (not copy) with a reply. */
export const transferables = (reply: ComputeReply): ArrayBuffer[] =>
  'values' in reply ? Object.values(reply.values).map((v) => v.buffer as ArrayBuffer) : [];

/** Runs every job of a request (the worker's whole job), calling `send` after each one. */
export function handleRequest(req: ComputeRequest, find: (id: string) => IndicatorDef | undefined, send: (reply: ComputeReply) => void, now: () => number = () => performance.now()) {
  const bars = unpackBars(req.bars);
  for (const job of req.jobs) {
    const def = find(job.defId);
    if (!def || def.external) {
      send({ id: req.id, key: job.key, error: `Indicator ${job.defId} can't run in the worker` });
      continue;
    }
    try {
      const t0 = now();
      const values = def.compute(bars, job.params);
      send({ id: req.id, key: job.key, values: packValues(values), ms: now() - t0 });
    } catch (err) {
      send({ id: req.id, key: job.key, error: (err as Error)?.message ?? String(err) });
    }
  }
}
