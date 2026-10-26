/**
 * "As of / source" stamps for data panels, and the Data button's health list (each feed's last success and state).
 * A stamp turns amber when its data is older than twice its feed's refresh interval. Bookkeeping in ../data/health.
 */
import { FEEDS, feedState, health, replyTime, isStale, onHealthChange, stampTime, type FeedId, type Health } from '../data/health';
import { alpacaKeysSaved, helper } from '../data/schwab';
import { h, openPopover } from './dom';

interface Stamp {
  el: HTMLElement;
  at: number | null;
  refreshMs: number;
  text: string;
}
const live = new Set<Stamp>();
let timer: ReturnType<typeof setInterval> | undefined;

function paint(s: Stamp, now = Date.now()) {
  const stale = isStale(s.at, s.refreshMs, now);
  s.el.classList.toggle('stale', stale);
  s.el.textContent = s.text + (stale ? ' · may be out of date' : '');
}

function watch(s: Stamp) {
  live.add(s);
  timer ??= setInterval(() => {
    for (const x of live) {
      if (x.el.isConnected) paint(x);
      else live.delete(x); // removed from the page (or never shown): forget it
    }
  }, 30_000);
}

export interface AsOfOptions {
  /** Override the stamp's source name ("Schwab", "SEC filing", ...). */
  source?: string;
  /** Override the refresh interval (ms) used for the amber "stale" colour; 0 = never stale. */
  refreshMs?: number;
  /** A word before the time: "as of" (default), "delayed", "end of day", "filed". */
  prefix?: string;
}

/**
 * A small muted "as of 10:42 · Schwab" for a panel header. `set(at)` updates it (ms or unix seconds; a date-only
 * string like "2026-09-30" is shown as is). `reply` = the engine reply shown: its own fetch time (replyTime).
 */
export function asOfStamp(feed: FeedId | null, opts: AsOfOptions & { reply?: unknown } = {}) {
  const el = h('span', { class: 'asof muted small', title: feed ? `${FEEDS[feed].label}: ${FEEDS[feed].about}` : '' });
  const s: Stamp = { el, at: null, refreshMs: opts.refreshMs ?? (feed ? FEEDS[feed].refreshMs : 0), text: '' };
  const source = opts.source ?? (feed ? FEEDS[feed].source : '');
  const api = {
    el,
    set(at: number | string | null | undefined, more: Partial<AsOfOptions> = {}) {
      const src = more.source ?? source;
      const prefix = more.prefix ?? opts.prefix ?? 'as of';
      if (more.refreshMs != null) s.refreshMs = more.refreshMs;
      if (at == null || at === '') {
        s.at = null;
        s.text = src;
      } else if (typeof at === 'string') {
        s.at = null; // a date (a filing, a report): its own age, never "stale"
        s.text = `${prefix} ${at}${src ? ` · ${src}` : ''}`;
      } else {
        s.at = at < 1e12 ? at * 1000 : at;
        s.text = `${prefix} ${stampTime(s.at)}${src ? ` · ${src}` : ''}`;
      }
      paint(s);
      return api;
    },
  };
  api.set(replyTime(opts.reply));
  watch(s);
  return api;
}

const STATE_TEXT: Record<Health, string> = { ok: 'Working', stale: 'Out of date', error: 'Failing', idle: 'Not used yet' };

function feedRow(id: FeedId) {
  const st = feedState(id);
  let state = health(id);
  let note = st.lastOk ? `Last success ${stampTime(st.lastOk)}` : 'No reply yet this session';
  if (id === 'alpaca' && alpacaKeysSaved() === false) note = 'Not set up (optional: add free keys in Settings)';
  if (state === 'error') note = `${st.lastError}${st.lastOk ? ` · last success ${stampTime(st.lastOk)}` : ''}`;
  if (state === 'idle' && id === 'alpaca' && alpacaKeysSaved()) note = 'Keys saved; used for older intraday charts';
  if (!helper.isConnected) state = st.lastOk ? 'stale' : 'idle';
  return h(
    'li',
    { class: `health-row health-${state}` },
    h('span', { class: 'health-dot', 'aria-hidden': 'true' }),
    h('div', {}, h('b', {}, FEEDS[id].label), ' ', h('span', { class: 'health-state' }, STATE_TEXT[state]), h('div', { class: 'muted small' }, note), h('div', { class: 'muted tiny' }, FEEDS[id].about)),
  );
}

/** The list of feeds, redrawn every few seconds while open. */
function healthList() {
  const list = h('ul', { class: 'health-list' });
  const head = h('div', { class: 'health-head' });
  const draw = () => {
    head.replaceChildren(
      h('b', {}, 'Data health'),
      h('div', { class: 'muted small' }, helper.isConnected ? `Helper connected${helper.version ? ` (version ${helper.version})` : ''}. Times are this browser session's.` : 'The helper isn’t connected, so nothing is updating.'),
    );
    list.replaceChildren(...(Object.keys(FEEDS) as FeedId[]).map(feedRow));
  };
  draw();
  return { el: h('div', { class: 'health-pop' }, head, list), draw };
}

/** Worst state across feeds that have been used (for the button's dot). */
export function overallHealth(): Health {
  if (!helper.isConnected) return 'idle';
  const all = (Object.keys(FEEDS) as FeedId[]).map((id) => health(id));
  return all.includes('error') ? 'error' : all.includes('stale') ? 'stale' : all.includes('ok') ? 'ok' : 'idle';
}

/** Opens the data health list under `anchor`. */
export function openDataHealth(anchor: HTMLElement) {
  const view = healthList();
  const t = setInterval(view.draw, 5000);
  const off = onHealthChange(view.draw);
  openPopover(anchor, view.el, { label: 'Data health', onClose: () => (clearInterval(t), off()) });
}

/** Keeps a status dot's class in step with the overall health. */
export function followHealth(dot: HTMLElement) {
  const draw = () => (dot.dataset.health = overallHealth());
  onHealthChange(draw);
  helper.onAvailability(draw);
  setInterval(draw, 30_000);
  draw();
}
