/** Economic calendar: Fed decisions, CPI, jobs reports and more, with forecast, previous and actual. */
import { HELPER_NOT_RUNNING, helper, loadCalendar, loadNews, type CalendarEvent } from '../data/schwab';
import { h, openModal, timeAgo } from '../ui/dom';
import { icon } from '../ui/icons';
import { openNewsSummary } from '../ui/newsSummary';

const REFRESH_MS = 10 * 60 * 1000;
const COUNTRIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'CHF', 'NZD'];
const IMPACTS = ['high', 'medium', 'low'] as const;

/** Plain-English notes for the events that move markets most. Matched against the event title. */
const EVENT_INFO: [RegExp, string][] = [
  [/fomc.*minutes/i, 'Detailed notes from the last Fed meeting. Markets look for hints about future rate changes.'],
  [/fomc|federal funds/i, "The Federal Reserve's interest-rate decision. Higher rates usually weigh on stocks; any surprise moves every market. Watch the press conference 30 minutes later too."],
  [/core pce|pce price/i, "The Fed's preferred inflation measure. Hotter than forecast tends to push bond yields up and stocks down."],
  [/cpi/i, 'Consumer Price Index: how fast prices are rising (inflation). Hotter than forecast tends to push yields up and stocks down.'],
  [/ppi/i, 'Producer Price Index: inflation at the wholesale level, often an early hint for CPI.'],
  [/non-farm|nonfarm/i, 'Jobs added last month (excluding farms). The biggest monthly economic report: a strong number signals a healthy economy but can mean fewer rate cuts.'],
  [/unemployment rate/i, 'Share of people looking for work who cannot find it. Rising unemployment can signal a slowing economy.'],
  [/unemployment claims|jobless claims/i, 'Weekly count of new unemployment claims, the most up-to-date read on layoffs.'],
  [/gdp/i, 'Gross Domestic Product: total growth of the economy. Two negative quarters in a row is a common definition of recession.'],
  [/retail sales/i, 'How much shoppers spent. Consumer spending drives about two-thirds of the US economy.'],
  [/ism|pmi/i, 'Survey of purchasing managers. Above 50 means the sector is growing, below 50 shrinking.'],
  [/jolts|job openings/i, 'Number of open jobs. Shows how tight the labour market is.'],
  [/consumer (confidence|sentiment)/i, 'How optimistic consumers feel, which hints at future spending.'],
  [/fed chair|powell|speaks/i, 'A speech by a central banker. Markets listen for hints about interest rates.'],
];

export function explainEvent(title: string): string | null {
  return EVENT_INFO.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

/** Turns values like "0.3%", "250K", "-1.2B" or "<0.1%" into numbers for comparing actual vs forecast. */
export function parseValue(text: string): number | null {
  const m = text.replace(/[<>,\s]/g, '').match(/^(-?\d+(?:\.\d+)?)([KMBT%]?)$/i);
  if (!m) return null;
  const scale: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return Number(m[1]) * (scale[m[2].toUpperCase()] ?? 1);
}

export function compareActual(e: CalendarEvent): 'above' | 'below' | 'inline' | null {
  const actual = parseValue(e.actual);
  const forecast = parseValue(e.forecast);
  if (actual === null || forecast === null) return null;
  if (actual === forecast) return 'inline';
  return actual > forecast ? 'above' : 'below';
}

// ---------- Shared data ----------

let cache: { events: CalendarEvent[]; failed: string[]; at: number } | null = null;
let inFlight: Promise<{ events: CalendarEvent[]; failed: string[] }> | null = null;

export async function getCalendar(force = false) {
  if (!force && cache && Date.now() - cache.at < REFRESH_MS / 2) return cache;
  inFlight ??= loadCalendar().finally(() => (inFlight = null));
  const result = await inFlight;
  cache = { ...result, at: Date.now() };
  return cache;
}

// ---------- Pieces ----------

const dayKey = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const timeText = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function countdown(t: number): string {
  const s = t - Date.now() / 1000;
  if (s <= 0) return '';
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `in ${Math.floor(s / 86400)}d`;
}

const impactDots = (impact: CalendarEvent['impact']) =>
  h('span', { class: `impact impact-${impact}`, title: `${impact[0].toUpperCase()}${impact.slice(1)} impact` }, h('i'), h('i'), h('i'));

function valueCell(e: CalendarEvent) {
  const cmp = compareActual(e);
  return h('span', { class: `cal-actual ${cmp ?? ''}`, title: cmp ? `Actual came in ${cmp === 'inline' ? 'in line with' : cmp === 'above' ? 'higher than' : 'lower than'} the forecast` : '' }, e.actual || '—');
}

export function openEventDetails(e: CalendarEvent) {
  const cmp = compareActual(e);
  const info = explainEvent(e.title);
  const related = h('div', { class: 'related-news' }, h('div', { class: 'muted small' }, 'Finding related headlines…'));
  const released = e.time <= Date.now() / 1000;
  const verdict = !released
    ? `Scheduled ${countdown(e.time)}.`
    : cmp === null
      ? e.actual
        ? 'Released.'
        : 'Released. The actual number appears here once the feed updates (usually within minutes).'
      : cmp === 'inline'
        ? 'Came in exactly as forecast.'
        : `Came in ${cmp === 'above' ? 'higher' : 'lower'} than the forecast. Whether that's good or bad depends on the report (see below).`;
  openModal(
    e.title,
    h(
      'div',
      { class: 'event-detail' },
      h(
        'div',
        { class: 'event-meta' },
        impactDots(e.impact),
        h('span', {}, `${e.country} · ${dayKey(e.time)} · ${timeText(e.time)}`),
      ),
      h(
        'div',
        { class: 'event-values' },
        h('div', {}, h('span', { class: 'muted small' }, 'Actual'), valueCell(e)),
        h('div', {}, h('span', { class: 'muted small' }, 'Forecast'), h('b', {}, e.forecast || '—')),
        h('div', {}, h('span', { class: 'muted small' }, 'Previous'), h('b', {}, e.previous || '—')),
      ),
      h('p', { class: `event-verdict ${cmp ?? ''}` }, verdict),
      info ? h('p', {}, info) : null,
      h('div', { class: 'summary-head' }, 'Related news'),
      related,
    ),
    { wide: true },
  );
  const query = `${e.title.replace(/\b[mqy]\/[mqy]\b/gi, '')} ${e.country === 'USD' ? 'US' : e.country}`;
  loadNews([], query)
    .then(({ items }) => {
      related.replaceChildren(
        ...items.slice(0, 5).map((item) =>
          h(
            'button',
            { class: 'related-item', onclick: () => openNewsSummary(item) },
            h('span', { class: 'news-source' }, item.source),
            h('span', { class: 'muted small' }, ` ${timeAgo(item.published)}`),
            h('div', {}, item.title),
          ),
        ),
      );
      if (!items.length) related.replaceChildren(h('div', { class: 'muted small' }, 'No recent headlines about this event.'));
    })
    .catch(() => related.replaceChildren(h('div', { class: 'muted small' }, 'Related news appears when the Schwab helper is running.')));
}

function eventRow(e: CalendarEvent, compact = false) {
  const past = e.time <= Date.now() / 1000;
  return h(
    'button',
    { class: `cal-row${past ? ' past' : ''}${compact ? ' compact' : ''}`, onclick: () => openEventDetails(e) },
    h('span', { class: 'cal-time' }, timeText(e.time), compact ? h('span', { class: 'muted small' }, ` ${countdown(e.time)}`) : null),
    h('span', { class: 'cal-country' }, e.country),
    impactDots(e.impact),
    h('span', { class: 'cal-title' }, e.title),
    compact ? null : valueCell(e),
    compact ? null : h('span', { class: 'cal-num' }, e.forecast || '—'),
    compact ? null : h('span', { class: 'cal-num muted' }, e.previous || '—'),
  );
}

/** Small "Coming up" list for the home page: the next important US events. */
export function createUpcomingPanel(onSeeAll: () => void) {
  const list = h('div', { class: 'cal-upcoming' });
  const el = h(
    'section',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h3', {}, 'Coming up'), h('span', { class: 'spacer' }), h('button', { class: 'link-btn', onclick: onSeeAll }, 'Full calendar →')),
    list,
  );
  const refresh = async () => {
    try {
      const { events } = await getCalendar();
      const now = Date.now() / 1000;
      const next = events.filter((e) => e.time > now - 3600 && e.country === 'USD' && e.impact === 'high').slice(0, 6);
      list.replaceChildren(...next.map((e) => h('div', {}, h('div', { class: 'muted small cal-day' }, dayKey(e.time)), eventRow(e, true))));
      if (!next.length) list.append(h('div', { class: 'muted small pad' }, 'No major US events in the next two weeks.'));
    } catch {
      list.replaceChildren(h('div', { class: 'muted small pad' }, 'The calendar appears when the Schwab helper is running.'));
    }
  };
  return { el, refresh };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const localDay = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function createCalendarPage() {
  const impacts = new Set<string>(['high', 'medium']);
  let country = 'USD';
  let view: 'list' | 'month' = 'list';
  let month = new Date();
  month = new Date(month.getFullYear(), month.getMonth(), 1);
  let selectedDay: Date | null = null;
  const body = h('div', { class: 'cal-body' });
  const foot = h('div', { class: 'muted small cal-foot' });
  const countrySelect = h(
    'select',
    { class: 'input', 'aria-label': 'Country' },
    h('option', { value: 'ALL' }, 'All countries'),
    ...COUNTRIES.map((c) => h('option', { value: c, selected: c === country }, c)),
  );
  countrySelect.addEventListener('change', () => {
    country = countrySelect.value;
    render();
  });
  const impactButtons = IMPACTS.map((imp) => {
    const btn = h('button', { class: `chip${impacts.has(imp) ? ' on' : ''}`, 'aria-pressed': impacts.has(imp) }, impactDots(imp), ` ${imp[0].toUpperCase()}${imp.slice(1)}`);
    btn.addEventListener('click', () => {
      if (impacts.has(imp)) impacts.delete(imp);
      else impacts.add(imp);
      btn.classList.toggle('on', impacts.has(imp));
      btn.setAttribute('aria-pressed', String(impacts.has(imp)));
      render();
    });
    return btn;
  });
  const viewTabs = h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': 'Calendar view' },
    h('button', { class: 'tab active', 'data-view': 'list', onclick: () => setView('list') }, 'List'),
    h('button', { class: 'tab', 'data-view': 'month', onclick: () => setView('month') }, 'Month'),
  );

  function setView(next: typeof view) {
    view = next;
    viewTabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === next));
    render();
  }

  const listPanel = h(
    'div',
    { class: 'panel cal-panel' },
    h('div', { class: 'cal-columns muted small' }, h('span', {}, 'Time'), h('span', {}, ''), h('span', {}, 'Impact'), h('span', {}, 'Event'), h('span', {}, 'Actual'), h('span', {}, 'Forecast'), h('span', {}, 'Previous')),
    body,
  );
  const monthPanel = h('div', { class: 'month-view' });

  const el = h(
    'div',
    { class: 'calendar-page' },
    h(
      'header',
      { class: 'cal-header' },
      h('div', {}, h('h1', {}, 'Economic calendar'), h('p', { class: 'muted' }, 'Events that move the market. Click any event for details. Times are shown in your time zone.')),
      h('div', { class: 'cal-filters' }, viewTabs, ...impactButtons, countrySelect),
    ),
    listPanel,
    monthPanel,
    foot,
  );

  let events: CalendarEvent[] = [];
  const filtered = () => events.filter((e) => (impacts.has(e.impact) || e.impact === 'holiday') && (country === 'ALL' || e.country === country));

  function renderList(shown: CalendarEvent[]) {
    const now = Date.now() / 1000;
    const days = new Map<string, CalendarEvent[]>();
    for (const e of shown) days.set(dayKey(e.time), [...(days.get(dayKey(e.time)) ?? []), e]);
    const nextEvent = shown.find((e) => e.time > now);
    body.replaceChildren(
      ...[...days].map(([day, list]) =>
        h(
          'div',
          { class: 'cal-day-group' },
          h('div', { class: 'cal-day-head' }, day),
          ...list.map((e) => {
            const row = eventRow(e);
            if (e === nextEvent) row.classList.add('next');
            return row;
          }),
        ),
      ),
    );
    if (!shown.length) body.append(h('div', { class: 'muted pad' }, events.length ? 'No events match these filters.' : 'Loading…'));
    if (nextEvent) requestAnimationFrame(() => body.querySelector('.cal-row.next')?.scrollIntoView({ block: 'center' }));
  }

  function renderMonth(shown: CalendarEvent[]) {
    const byDay = new Map<string, CalendarEvent[]>();
    for (const e of shown) byDay.set(localDay(e.time), [...(byDay.get(localDay(e.time)) ?? []), e]);
    const todayKey = localDay(Date.now() / 1000);
    const first = new Date(month);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const cells: Node[] = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      if (i >= 35 && day.getMonth() !== first.getMonth()) break;
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const list = byDay.get(key) ?? [];
      const top = [...list].sort((a, b) => ['high', 'medium', 'low', 'holiday'].indexOf(a.impact) - ['high', 'medium', 'low', 'holiday'].indexOf(b.impact)).slice(0, 3);
      const selected = selectedDay && day.toDateString() === selectedDay.toDateString();
      cells.push(
        h(
          'button',
          {
            class: `day-cell${day.getMonth() !== first.getMonth() ? ' other' : ''}${key === todayKey ? ' today' : ''}${selected ? ' selected' : ''}${list.length ? ' has-events' : ''}`,
            'aria-label': `${day.toDateString()}: ${list.length} events`,
            onclick: () => {
              selectedDay = day;
              render();
            },
          },
          h('span', { class: 'day-num' }, String(day.getDate())),
          ...top.map((e) => h('span', { class: `day-event impact-${e.impact}` }, h('i'), e.title)),
          list.length > 3 ? h('span', { class: 'day-more muted' }, `+${list.length - 3} more`) : null,
        ),
      );
    }
    const dayList = selectedDay ? byDay.get(localDay(selectedDay.getTime() / 1000)) ?? [] : [];
    monthPanel.replaceChildren(
      h(
        'div',
        { class: 'month-head' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => ((month = new Date(month.getFullYear(), month.getMonth() - 1, 1)), render()) }, h('span', { class: 'flip' }, icon('chevron', 22))),
        h('h2', {}, month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => ((month = new Date(month.getFullYear(), month.getMonth() + 1, 1)), render()) }, h('span', { class: 'flip-right' }, icon('chevron', 22))),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => ((month = new Date(new Date().getFullYear(), new Date().getMonth(), 1)), (selectedDay = new Date()), render()) }, 'Today'),
      ),
      h('div', { class: 'month-grid' }, ...WEEKDAYS.map((d) => h('div', { class: 'weekday muted small' }, d)), ...cells),
      selectedDay
        ? h(
            'div',
            { class: 'panel day-detail' },
            h('div', { class: 'cal-day-head' }, dayKey(selectedDay.getTime() / 1000)),
            ...(dayList.length ? dayList.map((e) => eventRow(e)) : [h('div', { class: 'muted pad' }, 'No events on this day (with the current filters).')]),
          )
        : h('p', { class: 'muted small' }, 'Click a day to see its events.'),
    );
  }

  function render() {
    listPanel.hidden = view !== 'list';
    monthPanel.hidden = view !== 'month';
    const shown = filtered();
    if (view === 'list') renderList(shown);
    else renderMonth(shown);
  }

  async function refresh(force = false) {
    try {
      const result = await getCalendar(force);
      events = result.events;
      foot.textContent = `Detailed events (forecast, previous, actual) come from Forex Factory and cover the current week. Fed rate decisions are shown for the whole year.${result.failed.length ? ' Could not reach Forex Factory just now.' : ''}`;
      render();
    } catch (err) {
      body.replaceChildren(h('div', { class: 'muted pad' }, (err as Error).message || HELPER_NOT_RUNNING));
      monthPanel.replaceChildren(h('div', { class: 'muted pad' }, (err as Error).message || HELPER_NOT_RUNNING));
    }
  }

  let started = false;
  function start() {
    if (!started) {
      started = true;
      setInterval(() => !el.hidden && refresh(true), REFRESH_MS);
      helper.onAvailability((up) => up && !el.hidden && refresh());
      render();
    }
    refresh();
  }

  return { el, start };
}
