/**
 * The Data tab's "Public records for family offices" panel: one row per free public source the helper reads to find
 * single-family offices that never file Form ADV (helper/engine/prospect_sources.py): last refresh, what it found,
 * any error, and a Refresh button. "Refresh all" runs every source and then links the records to firms.
 */
import { prospectSourcesReady, prospectSourcesRefresh, prospectSourcesStatus, type PublicSourceKey, type PublicSourcesStatus } from '../data/prospect';
import { clearEngineCache, HELPER_UPDATE_FOR_FEATURE } from '../data/schwab';
import { h, openModal, toast } from '../ui/dom';
import { infoTip } from '../ui/glossary';
import { openSettings } from '../ui/settings';
import { countText, dateText } from './logic';

/** "3 days ago" / "today" from a unix time in seconds. */
function ago(at: number, nowMs = Date.now()) {
  const days = Math.floor(Math.max(0, nowMs / 1000 - at) / 86400);
  return days < 1 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
}

/** What a source found last time, in a few words (the helper's own counts). */
export function foundText(key: PublicSourceKey, last: Record<string, unknown>): string {
  const n = (k: string) => countText(Number(last[k] ?? 0));
  switch (key) {
    case 'sec_owners':
      return `${n('owners')} owners from ${n('filings')} filings`;
    case 'liquidity':
      return `${n('events')} events (${n('form144')} Form 144, ${n('form8k')} 8-K, ${n('s1')} S-1)`;
    case 'gleif':
      return `${n('matched')} of ${n('looked')} entities matched, ${n('parents')} parents`;
    case 'propublica':
      return `${n('foundations')} private foundations from ${n('searches')} searches`;
    case 'wikidata':
      return `${n('people')} notable founders`;
  }
}

/** Builds the panel; it loads its own status and refreshes the firm list through `onChanged` after a run. */
export function publicSourcesPanel(onChanged: () => void): HTMLElement & { reload: () => Promise<void> } {
  let status: PublicSourcesStatus | null = null;
  let error = '';
  const live = new Map<string, string>();
  const body = h('div', { class: 'pr-data-grid' });
  const head = h('div', { class: 'panel-head' });
  const panel = h(
    'section',
    { class: 'panel pr-public', 'aria-label': 'Public records for family offices' },
    head,
    h('p', { class: 'muted small' }, 'Single-family offices never file Form ADV. These free sources find their traces instead: 5%+ stakes, insider filings, family foundations, holding structures, notable founders and recent sales. Each run reads the last 30 days of SEC filings (politely paced) and links what it finds to firms; labels are educated guesses, never certain.'),
    body,
  );

  async function load() {
    if (!prospectSourcesReady()) {
      error = HELPER_UPDATE_FOR_FEATURE;
      draw();
      return;
    }
    try {
      clearEngineCache('prospect.sources.status');
      status = await prospectSourcesStatus();
      error = '';
    } catch (err) {
      const msg = (err as Error).message;
      error = /doesn't know|needs the updated/i.test(msg) ? HELPER_UPDATE_FOR_FEATURE : msg;
    }
    draw();
  }

  async function refresh(key?: PublicSourceKey) {
    const id = key ?? 'all';
    live.set(id, 'Starting…');
    draw();
    try {
      await prospectSourcesRefresh(key ? [key] : undefined, (e) => {
        if (e.type !== 'status') return;
        live.set(id, e.text);
        const line = panel.querySelector<HTMLElement>(`[data-progress="pub-${id}"]`);
        if (line) line.textContent = e.text;
        else draw();
      });
      toast('Public records refreshed and linked to firms');
      onChanged();
    } catch (err) {
      const msg = (err as Error).message;
      if (/SEC email|contact email/i.test(msg)) openModal('SEC email needed', h('div', {}, h('p', {}, msg), h('button', { class: 'btn primary', onclick: () => openSettings() }, 'Open Settings')), { noAutofocus: true });
      else toast(msg);
    } finally {
      live.delete(id);
      await load();
    }
  }

  function draw() {
    const running = live.size > 0 || !!status?.job?.running;
    const c = status?.counts;
    head.replaceChildren(
      h('h3', {}, 'Public records for family offices ', infoTip('prSfo')),
      c ? h('span', { class: 'muted small' }, `${countText(c.possibleSfo)} possible single-family offices · ${countText(c.signals)} evidence items · ${countText(c.liquidity)} with a recent liquidity event`) : '',
      h('button', { class: 'btn small', disabled: running || !!error, onclick: () => refresh() }, 'Refresh all'),
      live.has('all') ? h('p', { class: 'pr-progress small', 'data-progress': 'pub-all', role: 'status' }, live.get('all') ?? '') : '',
    );
    if (error) {
      body.replaceChildren(h('p', { class: 'pr-warn small' }, error));
      return;
    }
    if (!status) {
      body.replaceChildren(h('p', { class: 'muted small' }, 'Checking public records…'));
      return;
    }
    body.replaceChildren(
      ...status.sources.map((s) => {
        const last = s.last;
        const state = live.has(s.key) || live.has('all') || status?.job?.current === s.key ? 'running' : !last ? 'missing' : last.ok ? 'fresh' : 'failed';
        return h(
          'article',
          { class: `pr-source ${state}`, 'data-public-source': s.key },
          h('div', { class: 'pr-source-head' }, h('h4', {}, s.label), h('span', { class: `badge ${{ fresh: 'up', running: 'accent', failed: 'down', missing: '' }[state]}` }, { fresh: 'Loaded', running: 'Refreshing', failed: 'Failed', missing: 'Not refreshed yet' }[state])),
          h('p', { class: 'small' }, s.what),
          last
            ? h('p', { class: 'small' }, h('b', {}, `Last refresh ${ago(last.at)}`), last.ok ? ` · ${foundText(s.key, last)}` : '', last.sourceDate ? ` · filings to ${dateText(String(last.sourceDate), true)}` : '')
            : h('p', { class: 'muted small' }, 'Never refreshed.'),
          last && !last.ok && last.error ? h('p', { class: 'pr-fail small', role: 'alert' }, h('b', {}, 'Why: '), last.error) : null,
          live.has(s.key) ? h('p', { class: 'pr-progress small', 'data-progress': `pub-${s.key}`, role: 'status' }, live.get(s.key) ?? '') : null,
          h('button', { class: 'btn small', disabled: running, onclick: () => refresh(s.key) }, last ? 'Refresh' : 'Refresh now'),
        );
      }),
      status.applied ? h('p', { class: 'muted small' }, `Last linking ${ago(status.applied.at)}: ${countText(status.applied.newFirms)} new possible single-family offices, ${countText(status.applied.upgraded)} 13F / Form D filers relabelled, evidence on ${countText(status.applied.linkedFirms)} firms.`) : '',
    );
  }

  draw();
  load();
  return Object.assign(panel, { reload: load });
}
