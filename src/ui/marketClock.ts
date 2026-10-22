/** US stock market hours (Eastern Time). Market holidays aren't included yet. */

export type MarketPhase = 'pre' | 'open' | 'post' | 'closed';

function easternNow(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { weekday: parts.weekday as string, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const duration = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);

const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const PRE = 4 * 60;
const POST_END = 20 * 60;

export function marketStatus(now = new Date()): { phase: MarketPhase; label: string } {
  const { weekday, minutes } = easternNow(now);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  if (weekend) return { phase: 'closed', label: 'Market closed · opens Monday 9:30 AM ET' };
  if (minutes >= OPEN && minutes < CLOSE) return { phase: 'open', label: `Market open · closes in ${duration(CLOSE - minutes)}` };
  if (minutes >= PRE && minutes < OPEN) return { phase: 'pre', label: `Pre-market · opens in ${duration(OPEN - minutes)}` };
  if (minutes >= CLOSE && minutes < POST_END) return { phase: 'post', label: 'After hours · closed at 4:00 PM ET' };
  const nextDay = minutes >= POST_END && weekday === 'Fri' ? 'Monday' : minutes >= POST_END ? 'tomorrow' : 'today';
  return { phase: 'closed', label: `Market closed · opens ${nextDay} 9:30 AM ET` };
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
