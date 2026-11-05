/// <reference lib="webworker" />
/**
 * Calculates heavy indicators off the main thread, so long histories don't freeze scrolling while they compute.
 * Only built-in indicators run here (scripts and outside-data indicators stay on the page). Protocol: workerProtocol.ts.
 */
import { getIndicator } from '../indicators/library';
import { handleRequest, transferables, type ComputeRequest } from './workerProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<ComputeRequest>) => {
  handleRequest(e.data, getIndicator, (reply) => scope.postMessage(reply, transferables(reply)));
};
