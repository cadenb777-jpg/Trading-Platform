/**
 * Where a setup stands against the live price: still waiting, getting close, in the entry zone, run too far to
 * chase, already at the target, or failed. Used for the Setups page's live status and its entry alerts.
 *
 * The rules a disciplined swing trader uses: buy only when price confirms the signal (trades through the
 * trigger), never chase more than a quarter of the planned risk past it (the reward:risk the grade was based on
 * would be gone), and forget a setup once the stop level trades or the entry window has closed.
 */
import type { Setup } from './setupsPanel';

export type Zone = 'forming' | 'waiting' | 'approaching' | 'entry' | 'extended' | 'triggered' | 'target' | 'invalid' | 'expired';

export interface ZoneInfo {
  zone: Zone;
  /** Short label for lists and alerts. */
  label: string;
  /** One sentence on what to do. */
  detail: string;
  tone: 'up' | 'down' | 'warn' | '';
}

/** Zones of a setup that is over: the stop traded, the target was reached or the entry window closed. */
export const OVER_ZONES: readonly Zone[] = ['invalid', 'target', 'expired'];
/** Zones that still count as a live setup (the Setups counts, its Today list and open risk per sector). */
export const LIVE_ZONES: readonly Zone[] = ['waiting', 'approaching', 'entry', 'triggered'];
export const isOver = (z: Zone) => OVER_ZONES.includes(z);
export const isLive = (z: Zone) => LIVE_ZONES.includes(z);

/** How far past the entry (as a share of the planned risk) still counts as a fair fill. */
export const CHASE_LIMIT = 0.25;
/** How close (in ATRs) counts as "approaching" the trigger. */
export const NEAR_ATR = 0.3;

const money = (v: number) => `$${v.toFixed(v >= 100 ? 2 : v >= 1 ? 2 : 4)}`;

export function entryZone(s: Setup, price: number | null | undefined, today = new Date().toISOString().slice(0, 10)): ZoneInfo {
  const p = s.plan;
  const d = s.direction > 0 ? 1 : -1;
  const entry = s.trade?.entry ?? p.trigger;
  const risk = Math.abs(entry - p.stop);
  const side = d > 0 ? 'buy' : 'sell short';
  if (s.status === 'forming')
    return { zone: 'forming', label: 'Forming', detail: 'The signal only counts once this bar closes. Don\'t act yet.', tone: 'warn' };
  if (price == null || !Number.isFinite(price)) return { zone: 'waiting', label: 'No live price', detail: s.statusText, tone: '' };
  const beyond = (a: number, b: number) => (a - b) * d; // > 0 when a is past b in the trade's direction
  if (beyond(p.stop, price) >= 0) return { zone: 'invalid', label: 'Stop level hit', detail: `Price ${money(price)} is through the stop ${money(p.stop)}: the setup has failed. Skip it.`, tone: 'down' };
  if (p.target != null && beyond(price, p.target) >= 0) return { zone: 'target', label: 'At target', detail: `Price already reached the target ${money(p.target)}: the move is done. Don't enter now.`, tone: '' };
  if (!s.trade && s.status !== 'ready' && s.status !== 'waiting') return { zone: 'waiting', label: s.status, detail: s.statusText, tone: '' };
  if (!s.trade && today > p.validUntil) return { zone: 'expired', label: 'Entry window closed', detail: `The trigger wasn't hit by ${p.validUntil}. Let it go and wait for the next setup.`, tone: '' };
  const past = beyond(price, entry);
  if (s.trade) {
    // The scanner's paper trade: the strategy's signal triggered. It is never a position of the owner's.
    const when = `The strategy's signal triggered at ${money(entry)} on ${s.trade.filled} (the scanner follows it as a paper trade; it isn't a position of yours).`;
    if (past > CHASE_LIMIT * risk)
      return { zone: 'triggered', label: 'Triggered · too far to chase', detail: `${when} Price ${money(price)} has run ${money(past)} past it: buying now shrinks the reward and widens the risk. Wait for a pullback toward ${money(entry)} or skip it.`, tone: 'warn' };
    if (past >= 0)
      return { zone: 'triggered', label: `Triggered at ${money(entry)}`, detail: `${when} Price ${money(price)} is still within a fair fill of it: you can still ${side} with the stop at ${money(p.stop)}${p.target != null ? `, target ${money(p.target)}` : ''}.`, tone: 'up' };
    return { zone: 'triggered', label: `Triggered at ${money(entry)}`, detail: `${when} Price ${money(price)} is back ${money(-past)} ${d > 0 ? 'below' : 'above'} that level, still short of the stop ${money(p.stop)}.`, tone: '' };
  }
  if (p.entryType === 'open') return { zone: 'entry', label: `Enter at the open`, detail: `This strategy enters at the next ${s.unit ?? 'day'}'s open (about ${money(price)} now). Stop ${money(p.stop)}.`, tone: 'up' };
  if (past < 0) {
    const gap = -past;
    if (gap <= NEAR_ATR * p.atr)
      return { zone: 'approaching', label: 'Getting close', detail: `Price ${money(price)} is ${money(gap)} from the trigger ${money(entry)}. Get ready to ${side} if it trades through.`, tone: 'warn' };
    return { zone: 'waiting', label: 'Waiting for trigger', detail: `Price ${money(price)} needs to ${d > 0 ? 'rise' : 'fall'} ${money(gap)} (${((gap / price) * 100).toFixed(1)}%) to ${money(entry)} before you ${side}.`, tone: '' };
  }
  if (past <= CHASE_LIMIT * risk)
    return { zone: 'entry', label: 'Entry zone now', detail: `Price ${money(price)} has confirmed through ${money(entry)} and is still within a fair fill. This is the time to ${side} if you take it: stop ${money(p.stop)}${p.target != null ? `, target ${money(p.target)}` : ''}.`, tone: 'up' };
  return { zone: 'extended', label: 'Too far to chase', detail: `Price ${money(price)} has run ${money(past)} past the entry. Buying here shrinks the reward and widens the risk: wait for a pullback toward ${money(entry)} or skip it.`, tone: 'warn' };
}
