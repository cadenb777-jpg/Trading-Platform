/**
 * The page side of the indicator worker: one shared worker, started on first use. If it can't start or crashes, every
 * waiting calculation is rejected and `available` turns false, so charts fall back to calculating on the page.
 */
import type { Bar } from '../types';
import { packBars, unpackValues, type ComputeJob, type ComputeReply } from './workerProtocol';

type Values = Record<string, number[]>;

/** Milliseconds per bar each indicator took last time, to decide which ones are worth sending to the worker. */
const costPerBar = new Map<string, number>();

export function recordCost(defId: string, ms: number, bars: number) {
  if (bars > 0) costPerBar.set(defId, ms / bars);
}

/** Expected milliseconds for a full calculation on `bars` bars (undefined until measured once). */
export function expectedCost(defId: string, bars: number): number | undefined {
  const c = costPerBar.get(defId);
  return c === undefined ? undefined : c * bars;
}

class IndicatorWorkerClient {
  private worker: Worker | null = null;
  private broken = typeof Worker === 'undefined';
  private nextId = 1;
  private readonly waiting = new Map<string, { resolve: (v: Values) => void; reject: (e: Error) => void; defId: string; bars: number }>();

  get available() {
    return !this.broken;
  }

  private start(): Worker | null {
    if (this.worker || this.broken) return this.worker;
    try {
      this.worker = new Worker(new URL('./indicatorWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ComputeReply>) => this.onReply(e.data);
      this.worker.onerror = (e) => {
        e.preventDefault?.();
        this.fail(new Error(`Indicator worker stopped: ${e.message || 'unknown error'}`));
      };
    } catch {
      this.broken = true;
    }
    return this.worker;
  }

  /** Sends the bars once with every job; each promise settles as soon as its own job is done. */
  run(bars: Bar[], jobs: (ComputeJob & { defId: string })[]): Map<string, Promise<Values>> {
    const out = new Map<string, Promise<Values>>();
    const worker = this.start();
    const id = this.nextId++;
    for (const job of jobs) {
      out.set(
        job.key,
        new Promise<Values>((resolve, reject) => {
          if (!worker) return reject(new Error('No indicator worker'));
          this.waiting.set(`${id}:${job.key}`, { resolve, reject, defId: job.defId, bars: bars.length });
        }),
      );
    }
    if (worker) {
      const packed = packBars(bars);
      worker.postMessage({ id, bars: packed, jobs }, [packed.buffer]);
    }
    return out;
  }

  private onReply(reply: ComputeReply) {
    const key = `${reply.id}:${reply.key}`;
    const w = this.waiting.get(key);
    if (!w) return;
    this.waiting.delete(key);
    if ('error' in reply) w.reject(new Error(reply.error));
    else {
      recordCost(w.defId, reply.ms, w.bars);
      w.resolve(unpackValues(reply.values));
    }
  }

  private fail(err: Error) {
    this.broken = true;
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }
}

export const indicatorWorker = new IndicatorWorkerClient();
