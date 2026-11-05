/// <reference lib="webworker" />
/**
 * Calculates heavy indicators off the main thread, so long histories don't freeze scrolling while they compute.
 * Only built-in indicators run here (scripts and outside-data indicators stay on the page). One job per task, so a
 * cancel for an old symbol is read before the next queued job starts. Protocol: workerProtocol.ts.
 */
import { getIndicator } from '../indicators/library';
import { JobQueue, transferables, type ComputeReply, type WorkerMessage } from './workerProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const queue = new JobQueue(getIndicator);
const send = (reply: ComputeReply) => scope.postMessage(reply, transferables(reply));
let pumping = false;

function step() {
  const reply = queue.runNext();
  if (reply) send(reply);
  if (queue.size) setTimeout(step, 0);
  else pumping = false;
}

scope.onmessage = (e: MessageEvent<WorkerMessage>) => {
  queue.receive(e.data).forEach(send);
  if (!pumping && queue.size) {
    pumping = true;
    setTimeout(step, 0);
  }
};
