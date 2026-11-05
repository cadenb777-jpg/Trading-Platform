/** Home's market pill and the greeting. The session rules (hours, NYSE holidays, early closes) live in ../market/sessions. */
import { sessionAt, sessionLabel } from '../market/sessions';

export type MarketPhase = 'pre' | 'open' | 'post' | 'closed';

const PHASE = { pre: 'pre', regular: 'open', after: 'post', closed: 'closed' } as const;

export function marketStatus(now = new Date()): { phase: MarketPhase; label: string } {
  return { phase: PHASE[sessionAt(now).session], label: sessionLabel(now) };
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
