/**
 * The US stock market's sessions in New York time: pre-market 4:00-9:30, regular 9:30-16:00, after hours 16:00-20:00,
 * with the NYSE holidays and early closes (13:00, after hours to 17:00) for 2026-2027. The single source for "is the
 * market open" (status bar, Home's market pill, quotes); extend HOLIDAYS / EARLY_CLOSES each year from
 * https://www.nyse.com/markets/hours-calendars. Pure and tested (sessions.test.ts).
 */

export type Session = 'pre' | 'regular' | 'after' | 'closed';

/** NYSE full-day holidays (New York dates). */
export const HOLIDAYS: Record<string, string> = {
  '2026-01-01': 'New Year’s Day',
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': 'Washington’s Birthday',
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
  '2027-01-01': 'New Year’s Day',
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': 'Washington’s Birthday',
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving',
  '2027-12-24': 'Christmas (observed)',
};

/** Early closes: the regular session ends at 13:00 and after hours at 17:00. */
export const EARLY_CLOSES: Record<string, string> = {
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
  '2027-11-26': 'Day after Thanksgiving',
};

const PRE = 4 * 60;
const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const AFTER_END = 20 * 60;
const EARLY_CLOSE = 13 * 60;
const EARLY_AFTER_END = 17 * 60;

/** New York's date, weekday and wall-clock time for an instant (daylight saving from the time zone database). */
export function nyClock(now: Date): { date: string; weekday: string; minutes: number; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday), minutes: hour * 60 + Number(parts.minute), hhmm: `${String(hour).padStart(2, '0')}:${parts.minute}` };
}

const weekdayOf = (date: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** A weekday that isn't an NYSE holiday. */
export function isTradingDay(date: string): boolean {
  const wd = weekdayOf(date);
  return wd !== 'Sat' && wd !== 'Sun' && !HOLIDAYS[date];
}

/** The regular session's close on a trading day (minutes after midnight, New York). */
export const closeMinutes = (date: string) => (EARLY_CLOSES[date] ? EARLY_CLOSE : CLOSE);

export interface SessionInfo {
  session: Session;
  /** New York date and time ("2026-11-27", "10:42"). */
  date: string;
  nyTime: string;
  /** Today's holiday name, if any. */
  holiday?: string;
  /** Today closes early (13:00). */
  earlyClose: boolean;
  /** Minutes until the regular close (regular session only) or until the open (pre-market only). */
  minutesLeft?: number;
}

export function sessionAt(now: Date): SessionInfo {
  const { date, minutes, hhmm } = nyClock(now);
  const early = !!EARLY_CLOSES[date];
  const base = { date, nyTime: hhmm, earlyClose: early, ...(HOLIDAYS[date] ? { holiday: HOLIDAYS[date] } : {}) };
  if (!isTradingDay(date)) return { ...base, session: 'closed' };
  const close = closeMinutes(date);
  if (minutes >= OPEN && minutes < close) return { ...base, session: 'regular', minutesLeft: close - minutes };
  if (minutes >= PRE && minutes < OPEN) return { ...base, session: 'pre', minutesLeft: OPEN - minutes };
  if (minutes >= close && minutes < (early ? EARLY_AFTER_END : AFTER_END)) return { ...base, session: 'after' };
  return { ...base, session: 'closed' };
}

/** When the regular session next opens after `now`: "today", "tomorrow", a weekday ("Monday") or a date ("Nov 30"). */
export function nextOpenLabel(now: Date): string {
  const { date, minutes } = nyClock(now);
  let d = date;
  if (!(isTradingDay(d) && minutes < OPEN)) {
    d = addDays(d, 1);
    while (!isTradingDay(d)) d = addDays(d, 1);
  }
  if (d === date) return 'today';
  if (d === addDays(date, 1)) return 'tomorrow';
  const days = Math.round((Date.parse(d) - Date.parse(date)) / 86400000);
  const when = new Date(`${d}T12:00:00Z`);
  return days < 7 ? when.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const duration = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`);
const clock = (mins: number) => `${((Math.floor(mins / 60) + 11) % 12) + 1}:${String(mins % 60).padStart(2, '0')} ${mins >= 720 ? 'PM' : 'AM'}`;

/** A sentence for the session: "Market open · closes in 2h 5m", "Market closed (Thanksgiving) · opens tomorrow 9:30 AM ET". */
export function sessionLabel(now: Date): string {
  const s = sessionAt(now);
  if (s.session === 'regular') return `Market open · closes in ${duration(s.minutesLeft!)}${s.earlyClose ? ' (early close 1:00 PM ET)' : ''}`;
  if (s.session === 'pre') return `Pre-market · opens in ${duration(s.minutesLeft!)}`;
  if (s.session === 'after') return `After hours · closed at ${clock(closeMinutes(s.date))} ET`;
  return `Market closed${s.holiday ? ` (${s.holiday})` : ''} · opens ${nextOpenLabel(now)} 9:30 AM ET`;
}
