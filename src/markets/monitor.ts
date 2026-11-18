/**
 * The Markets Monitor's data lists and pure helpers (tested in monitor.test.ts): the world's main stock markets with
 * their regular trading hours (clocks: open / lunch / closed), the regional equity board (US index ETFs plus
 * US-listed country ETFs, so one free Schwab quote covers every country; the board says "via ETF"), the currencies
 * and commodities board (ETFs that track them) and the sector sunburst's averages.
 */

export interface Exchange {
  city: string;
  tz: string;
  /** Regular session in local time, minutes after midnight. */
  open: number;
  close: number;
  /** Midday break (Hong Kong, Tokyo), local minutes. */
  lunch?: [number, number];
}

const hm = (h: number, m = 0) => h * 60 + m;

export const EXCHANGES: Exchange[] = [
  { city: 'New York', tz: 'America/New_York', open: hm(9, 30), close: hm(16) },
  { city: 'London', tz: 'Europe/London', open: hm(8), close: hm(16, 30) },
  { city: 'Frankfurt', tz: 'Europe/Berlin', open: hm(9), close: hm(17, 30) },
  { city: 'Hong Kong', tz: 'Asia/Hong_Kong', open: hm(9, 30), close: hm(16), lunch: [hm(12), hm(13)] },
  { city: 'Tokyo', tz: 'Asia/Tokyo', open: hm(9), close: hm(15, 30), lunch: [hm(11, 30), hm(12, 30)] },
  { city: 'Sydney', tz: 'Australia/Sydney', open: hm(10), close: hm(16) },
];

/** The local weekday (0 = Sunday), minutes after midnight and "13:41" clock text in a time zone. */
export function localTime(now: Date, tz: string): { day: number; minutes: number; text: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, minutes: hour * 60 + minute, text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

export type SessionState = 'open' | 'lunch' | 'closed';

/** Whether a market is in its regular session now (weekdays only; public holidays are not counted). */
export function sessionState(x: Exchange, now: Date): { state: SessionState; time: string; note: string } {
  const { day, minutes, text } = localTime(now, x.tz);
  const weekday = day >= 1 && day <= 5;
  const until = (m: number) => {
    const d = m - minutes;
    return d >= 60 ? `${Math.floor(d / 60)}h ${d % 60}m` : `${d}m`;
  };
  if (!weekday) return { state: 'closed', time: text, note: 'Weekend' };
  if (minutes < x.open) return { state: 'closed', time: text, note: `Opens in ${until(x.open)}` };
  if (minutes >= x.close) return { state: 'closed', time: text, note: 'Closed for the day' };
  if (x.lunch && minutes >= x.lunch[0] && minutes < x.lunch[1]) return { state: 'lunch', time: text, note: `Lunch break, back in ${until(x.lunch[1])}` };
  return { state: 'open', time: text, note: `Closes in ${until(x.close)}` };
}

export interface BoardSection {
  title: string;
  rows: [symbol: string, name: string][];
}

/** World equities by region. US rows are the index ETFs; other countries are US-listed iShares/Franklin country ETFs. */
export const WORLD: BoardSection[] = [
  {
    title: 'Americas',
    rows: [
      ['SPY', 'S&P 500'],
      ['QQQ', 'Nasdaq 100'],
      ['DIA', 'Dow Jones'],
      ['IWM', 'Russell 2000'],
      ['EWC', 'Canada'],
      ['EWZ', 'Brazil'],
      ['EWW', 'Mexico'],
    ],
  },
  {
    title: 'Europe, Middle East, Africa',
    rows: [
      ['EZU', 'Euro area'],
      ['EWU', 'United Kingdom'],
      ['EWG', 'Germany'],
      ['EWQ', 'France'],
      ['EWL', 'Switzerland'],
      ['EWI', 'Italy'],
      ['EWP', 'Spain'],
      ['KSA', 'Saudi Arabia'],
    ],
  },
  {
    title: 'Asia-Pacific',
    rows: [
      ['EWJ', 'Japan'],
      ['FXI', 'China large caps'],
      ['EWH', 'Hong Kong'],
      ['EWY', 'South Korea'],
      ['EWT', 'Taiwan'],
      ['INDA', 'India'],
      ['EWA', 'Australia'],
    ],
  },
];

/** Currencies (against the US dollar) and commodities, through the ETFs that track them. */
export const CROSS_ASSET: BoardSection[] = [
  {
    title: 'Currencies',
    rows: [
      ['UUP', 'US dollar index'],
      ['FXE', 'Euro'],
      ['FXY', 'Japanese yen'],
      ['FXB', 'British pound'],
      ['FXF', 'Swiss franc'],
      ['FXA', 'Australian dollar'],
    ],
  },
  {
    title: 'Commodities',
    rows: [
      ['GLD', 'Gold'],
      ['SLV', 'Silver'],
      ['USO', 'Crude oil (WTI)'],
      ['UNG', 'Natural gas'],
      ['CPER', 'Copper'],
      ['DBA', 'Agriculture'],
    ],
  },
  {
    title: 'Rates',
    rows: [
      ['SHY', 'Treasuries 1-3y'],
      ['IEF', 'Treasuries 7-10y'],
      ['TLT', 'Treasuries 20y+'],
      ['LQD', 'Investment-grade credit'],
      ['HYG', 'High-yield credit'],
    ],
  },
];

export const boardSymbols = (sections: BoardSection[]) => sections.flatMap((s) => s.rows.map(([sym]) => sym));

/** Average change per group with how many members have a price (equal weight; pure, tested). */
export function groupAverages(groups: Record<string, string[]>, change: (symbol: string) => number | null | undefined): { group: string; avg: number | null; priced: number; count: number }[] {
  return Object.entries(groups).map(([group, syms]) => {
    const vals = syms.map(change).filter((v): v is number => v != null && Number.isFinite(v));
    return { group, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, priced: vals.length, count: syms.length };
  });
}

/** The best and worst rows of a board (pure, tested): highest change first for "up", lowest first for "down". */
export function leaders<T extends { change: number | null | undefined }>(rows: T[], n = 3): { up: T[]; down: T[] } {
  const priced = rows.filter((r) => r.change != null && Number.isFinite(r.change));
  const sorted = [...priced].sort((a, b) => (b.change as number) - (a.change as number));
  return { up: sorted.slice(0, n).filter((r) => (r.change as number) > 0), down: sorted.reverse().slice(0, n).filter((r) => (r.change as number) < 0) };
}
