/**
 * The status bar along the bottom (thin and calm): the helper and its version, the main feeds (Schwab, Webull, SEC),
 * the last request's latency, the New York market session, the last update and READY / BUSY. Each item opens its
 * detail: the Data health list or Settings. The session maths is pure and tested (statusBar.test.ts).
 */
import { FEEDS, getActivity, health, onActivity, onHealthChange, type FeedId, type Health } from '../data/health';
import { helper } from '../data/schwab';
import { h } from './dom';

export type Session = 'pre' | 'regular' | 'after' | 'closed';

const PRE = 4 * 60;
const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const AFTER_END = 20 * 60;

/** New York's weekday and wall-clock time for an instant (daylight saving handled by the time zone database). */
export function newYorkClock(now: Date): { weekday: string; minutes: number; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  return { weekday: String(parts.weekday), minutes: hour * 60 + Number(parts.minute), hhmm: `${String(hour).padStart(2, '0')}:${parts.minute}` };
}

/** The US stock session at an instant: pre 4:00-9:30, regular 9:30-16:00, after 16:00-20:00 New York time (weekdays; holidays not included). */
export function marketSession(now: Date): { session: Session; label: string; nyTime: string } {
  const { weekday, minutes, hhmm } = newYorkClock(now);
  const label = (s: Session) => ({ pre: 'Pre-market', regular: 'Regular session', after: 'After hours', closed: 'Closed' })[s];
  let session: Session = 'closed';
  if (weekday !== 'Sat' && weekday !== 'Sun') {
    if (minutes >= OPEN && minutes < CLOSE) session = 'regular';
    else if (minutes >= PRE && minutes < OPEN) session = 'pre';
    else if (minutes >= CLOSE && minutes < AFTER_END) session = 'after';
  }
  return { session, label: label(session), nyTime: hhmm };
}

/** Short latency text: "48 ms", "1.2 s". */
export function latencyText(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

// ---------- the bar ----------

const FEED_ITEMS: [FeedId, string][] = [
  ['quotes', 'Schwab'],
  ['webull', 'Webull'],
  ['sec', 'SEC'],
];
const HEALTH_WORD: Record<Health, string> = { ok: 'working', stale: 'out of date', error: 'failing', idle: 'not used yet' };

export interface StatusDeps {
  openHealth(anchor: HTMLElement): void;
  openSettings(section?: string): void;
}

export function createStatusBar(d: StatusDeps): HTMLElement {
  const item = (cls: string, title: string, onclick: (e: Event) => void, ...children: (Node | string)[]) =>
    h('button', { type: 'button', class: `sb-item ${cls}`, title, onclick }, ...children);
  const dot = (state: string) => h('span', { class: 'sb-dot', 'data-state': state, 'aria-hidden': 'true' });

  const helperBtn = item('sb-helper', 'The helper on your computer: open the connection check', () => d.openSettings('connection'));
  const feeds = h('span', { class: 'sb-feeds' });
  const latency = item('sb-lat', 'How long the last request to the helper took: open Data health', (e) => d.openHealth(e.currentTarget as HTMLElement));
  const session = item('sb-session', 'US stock market session, New York time', (e) => d.openHealth(e.currentTarget as HTMLElement));
  const updated = item('sb-updated', 'When the last data arrived: open Data health', (e) => d.openHealth(e.currentTarget as HTMLElement));
  const ready = h('span', { class: 'sb-ready', role: 'status', 'aria-live': 'polite' });

  function draw() {
    const up = helper.isConnected;
    const v = helper.version;
    helperBtn.replaceChildren(dot(up ? (helper.outdated ? 'stale' : 'ok') : 'error'), h('span', {}, up ? `Helper${v ? ` v${v}` : ''}` : 'Helper offline'));
    feeds.replaceChildren(
      ...FEED_ITEMS.map(([id, label]) => {
        const st = up ? health(id) : 'idle';
        return item('sb-feed', `${FEEDS[id].label}: ${HEALTH_WORD[st]}. Open Data health`, (e) => d.openHealth(e.currentTarget as HTMLElement), dot(st), h('span', {}, label));
      }),
    );
    const a = getActivity();
    latency.replaceChildren(h('span', { class: 'sb-key' }, 'LAT'), ' ', latencyText(a.lastLatencyMs));
    const s = marketSession(new Date());
    session.dataset.session = s.session;
    session.replaceChildren(dot(s.session === 'regular' ? 'ok' : s.session === 'closed' ? 'idle' : 'stale'), h('span', {}, `${s.label} · NY ${s.nyTime}`));
    updated.replaceChildren(h('span', { class: 'sb-key' }, 'UPD'), ' ', a.lastAt ? new Date(a.lastAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—');
    const busy = a.inflight > 0;
    ready.dataset.state = !up ? 'offline' : busy ? 'busy' : 'ready';
    ready.textContent = !up ? 'OFFLINE' : busy ? 'BUSY' : 'READY';
    ready.title = !up ? 'The helper isn’t connected' : busy ? `${a.inflight} request${a.inflight === 1 ? '' : 's'} on the way` : 'Nothing waiting';
  }

  // BUSY flickers for quick requests: show it only after a short wait
  let pendingDraw: ReturnType<typeof setTimeout> | undefined;
  onActivity(() => {
    clearTimeout(pendingDraw);
    pendingDraw = setTimeout(draw, getActivity().inflight > 0 ? 250 : 0);
  });
  onHealthChange(draw);
  helper.onAvailability(draw);
  helper.onUpdateChange(draw);
  setInterval(draw, 15_000);
  draw();
  return h('footer', { class: 'status-bar', 'aria-label': 'Status' }, helperBtn, feeds, h('span', { class: 'spacer' }), latency, updated, session, ready);
}
