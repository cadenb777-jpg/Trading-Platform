/**
 * 12-hour or 24-hour clock for chart times (axis labels, crosshair, legend). 12-hour by default; the choice is kept
 * per browser and every chart repaints when it changes (event `tp:clock`). Pure formatting is tested.
 */
export type Clock = '12h' | '24h';
const KEY = 'tp-clock';

let current: Clock | null = null;

export function getClock(): Clock {
  if (current) return current;
  try {
    current = localStorage.getItem(KEY) === '24h' ? '24h' : '12h';
  } catch {
    current = '12h';
  }
  return current;
}

export function setClock(c: Clock) {
  current = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // private window: this visit only
  }
  window.dispatchEvent(new CustomEvent('tp:clock', { detail: c }));
}

/** "9:30 AM" / "12:00 PM" on the 12-hour clock, "09:30" on the 24-hour clock. */
export function clockText(hour: number, minute: number, clock: Clock = getClock()): string {
  const mm = String(minute).padStart(2, '0');
  if (clock === '24h') return `${String(hour).padStart(2, '0')}:${mm}`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`;
}
