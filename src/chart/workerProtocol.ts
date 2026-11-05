/**
 * Messages between the chart and the indicator worker (src/chart/indicatorWorker.ts). Bars travel as one packed
 * Float64Array (6 numbers per bar) and each plot's values come back as their own Float64Array, so both directions are
 * plain memory copies instead of cloning thousands of objects. The worker queues jobs and runs one per task, so a
 * `cancel` sent for an old symbol drops its queued jobs before they run. Pure, tested in workerProtocol.test.ts.
 */
import type { IndicatorDef, IndicatorParams } from '../indicators/types';
import type { Bar } from '../types';

/** Bump when a message's shape changes; the worker refuses requests from another version. */
export const PROTOCOL_VERSION = 1;

const FIELDS = 6;

export interface ComputeJob {
  /** Chosen by the caller; comes back on the reply. */
  key: string;
  defId: string;
  params: IndicatorParams;
}

export interface ComputeRequest {
  v: number;
  type: 'compute';
  id: number;
  /** Who asked (one chart) and for which data (its setBars generation), so old work can be cancelled. */
  group: string;
  generation: number;
  bars: Float64Array;
  jobs: ComputeJob[];
}

/** Drops this group's queued jobs from generations below `below` (the chart moved on to new data). */
export interface CancelRequest {
  v: number;
  type: 'cancel';
  group: string;
  below: number;
}

export type WorkerMessage = ComputeRequest | CancelRequest;

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

/** The worker's job list: requests are queued, cancels drop queued jobs, `runNext` calculates one job. */
export class JobQueue {
  private items: { req: ComputeRequest; job: ComputeJob }[] = [];
  private readonly decoded = new WeakMap<ComputeRequest, Bar[]>();

  constructor(private readonly find: (id: string) => IndicatorDef | undefined, private readonly now: () => number = () => performance.now()) {}

  get size() {
    return this.items.length;
  }

  /** Takes a message; returns replies to send right away (requests from another protocol version are refused). */
  receive(msg: WorkerMessage): ComputeReply[] {
    if (msg.v !== PROTOCOL_VERSION) {
      return msg.type === 'compute' ? msg.jobs.map((j) => ({ id: msg.id, key: j.key, error: `Indicator worker speaks protocol ${PROTOCOL_VERSION}, not ${msg.v}` })) : [];
    }
    if (msg.type === 'cancel') this.items = this.items.filter((it) => it.req.group !== msg.group || it.req.generation >= msg.below);
    else for (const job of msg.jobs) this.items.push({ req: msg, job });
    return [];
  }

  /** Calculates the oldest queued job (null when there is none). */
  runNext(): ComputeReply | null {
    const item = this.items.shift();
    if (!item) return null;
    const { req, job } = item;
    const def = this.find(job.defId);
    if (!def || def.external) return { id: req.id, key: job.key, error: `Indicator ${job.defId} can't run in the worker` };
    let bars = this.decoded.get(req);
    if (!bars) this.decoded.set(req, (bars = unpackBars(req.bars)));
    try {
      const t0 = this.now();
      const values = def.compute(bars, job.params);
      return { id: req.id, key: job.key, values: packValues(values), ms: this.now() - t0 };
    } catch (err) {
      return { id: req.id, key: job.key, error: (err as Error)?.message ?? String(err) };
    }
  }
}
