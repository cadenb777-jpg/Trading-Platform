/**
 * Flow → Live flow: big off-exchange ("dark pool") prints from Alpaca and big options trades from Schwab chains on the
 * owner's chosen symbols, newest first, with phone/desktop alerts sent by the helper (engine/liveflow.py) even when
 * no tab is open. Settings: symbols (default: the watchlist's stocks), dollar thresholds, alerts on/off.
 */
import { engineRequest, helper } from '../data/schwab';
import { state } from '../state';
import { h } from '../ui/dom';
import { infoTip } from '../ui/glossary';

export const LIVEFLOW_HELPER_VERSION = 62;

export interface LiveConfig {
  symbols: string[];
  blockMin: number;
  optionMin: number;
  alert: boolean;
  darkPool: boolean;
  options: boolean;
}
export interface LiveEvent {
  kind: 'darkpool' | 'options';
  symbol: string;
  time: string;
  title: string;
  message: string;
  notional?: number;
  premium?: number;
  size?: number;
  price?: number;
  late?: string;
  type?: 'call' | 'put';
  side?: string;
  opening?: boolean;
}
export interface LiveState {
  config: LiveConfig;
  feed: LiveEvent[];
  status: { darkPool: string; options: string; lastRun: number | null; errors: Record<string, string> };
  alpaca: boolean;
  maxSymbols: number;
}

/** Stock symbols from the watchlist (pure, tested): crypto pairs and indexes left out, at most `max`. */
export function watchlistSymbols(refs: { provider: string; symbol: string }[], max: number): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const s = r.symbol.toUpperCase();
    if (r.provider === 'schwab' && /^[A-Z][A-Z.\-]{0,9}$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, max);
}

/** "$1.25M" style amounts (pure, tested). */
export function dollars(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function row(e: LiveEvent) {
  const amount = e.kind === 'darkpool' ? e.notional : e.premium;
  const tag = e.kind === 'darkpool' ? h('span', { class: 'lf-tag dark' }, 'Dark pool') : h('span', { class: `lf-tag ${e.type}` }, e.type === 'put' ? 'Puts' : 'Calls');
  return h(
    'li',
    { class: 'lf-row' },
    h('span', { class: 'lf-time muted small' }, timeOf(e.time)),
    tag,
    h('b', { class: 'lf-sym' }, e.symbol),
    h('span', { class: 'lf-amt num' }, dollars(amount)),
    h('span', { class: 'lf-msg small' }, e.message, e.late ? h('span', { class: 'muted' }, ' · late report') : ''),
  );
}

/** The Live flow view. Returns the element and a stop function (the poll ends when the tab is left). */
export function liveFlowView(): { el: HTMLElement; stop: () => void } {
  const el = h('div', { class: 'lf' });
  if ((helper.version ?? 0) < LIVEFLOW_HELPER_VERSION) {
    el.append(h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'Live flow arrives with the next helper update (it installs by itself).')));
    return { el, stop: () => {} };
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let editing = false;
  const statusLine = h('p', { class: 'small lf-status' });
  const list = h('ul', { class: 'lf-feed', 'aria-live': 'polite' });
  const form = h('form', { class: 'lf-form' });

  function fillForm(s: LiveState) {
    const c = s.config;
    const symbols = h('input', { class: 'input', name: 'symbols', value: (c.symbols.length ? c.symbols : watchlistSymbols(state.watchlist, s.maxSymbols)).join(', '), 'aria-label': 'Symbols to watch', placeholder: 'NVDA, TSLA, SPY' });
    const blockMin = h('input', { class: 'input', name: 'blockMin', type: 'number', min: '100000', step: '100000', value: String(c.blockMin), 'aria-label': 'Smallest dark-pool print in dollars' });
    const optionMin = h('input', { class: 'input', name: 'optionMin', type: 'number', min: '25000', step: '25000', value: String(c.optionMin), 'aria-label': 'Smallest options trade in dollars' });
    const check = (name: keyof LiveConfig, label: string) => h('label', { class: 'lf-check' }, h('input', { type: 'checkbox', name, checked: Boolean(c[name]) }), ` ${label}`);
    form.replaceChildren(
      h('label', { class: 'lf-field wide' }, h('span', { class: 'small muted' }, `Symbols (up to ${s.maxSymbols})`), symbols),
      h('label', { class: 'lf-field' }, h('span', { class: 'small muted' }, 'Dark-pool print at least ($)'), blockMin),
      h('label', { class: 'lf-field' }, h('span', { class: 'small muted' }, 'Options trade at least ($)'), optionMin),
      h('div', { class: 'lf-checks' }, check('darkPool', 'Dark-pool prints'), check('options', 'Options trades'), check('alert', 'Alert me (phone + desktop)')),
      h('button', { class: 'btn primary', type: 'submit' }, c.symbols.length ? 'Save' : 'Start watching'),
    );
    form.oninput = () => (editing = true);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const config = {
      symbols: String(f.get('symbols') || '').split(',').map((x) => x.trim()).filter(Boolean),
      blockMin: Number(f.get('blockMin')),
      optionMin: Number(f.get('optionMin')),
      darkPool: f.get('darkPool') === 'on',
      options: f.get('options') === 'on',
      alert: f.get('alert') === 'on',
    };
    try {
      const s = await engineRequest<LiveState>('liveflow.save', { config }, 20000);
      editing = false;
      shownForm = '';
      (document.activeElement as HTMLElement | null)?.blur?.();
      render(s);
    } catch (err) {
      statusLine.textContent = `Couldn’t save: ${(err as Error).message}`;
    }
  });

  let shownFeed = '';
  let shownForm = '';
  function render(s: LiveState) {
    const formKey = JSON.stringify(s.config);
    if (!editing && !form.contains(document.activeElement) && formKey !== shownForm) {
      shownForm = formKey;
      fillForm(s);
    }
    const errs = Object.entries(s.status.errors);
    statusLine.replaceChildren(
      h('b', {}, 'Dark pools: '), s.alpaca ? s.status.darkPool : 'needs your free Alpaca keys (Settings → Data connections)',
      ' · ', h('b', {}, 'Options: '), s.status.options,
      s.status.lastRun ? ` · checked ${new Date(s.status.lastRun * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '',
      errs.length ? h('span', { class: 'down' }, ` · ${errs.map(([k, v]) => `${k}: ${v}`).join('; ')}`) : '',
    );
    const feedKey = `${s.feed.length}:${s.feed[0]?.time ?? ''}:${s.feed[0]?.title ?? ''}:${s.config.symbols.length}`;
    if (feedKey === shownFeed) return; // nothing new: the list (and the scroll position) stay as they are
    shownFeed = feedKey;
    list.replaceChildren(...(s.feed.length ? s.feed.map(row) : [h('li', { class: 'muted small lf-empty' }, s.config.symbols.length ? 'Nothing big yet. Prints and trades above your thresholds appear here as they happen.' : 'Pick symbols above and press Start watching.')]));
  }

  let first = true;
  async function poll() {
    if (!first && !el.isConnected) return; // the first load runs before the view is on the page
    first = false;
    try {
      render(await engineRequest<LiveState>('liveflow.get', {}, 15000));
    } catch (err) {
      statusLine.textContent = `Couldn’t reach the helper: ${(err as Error).message}`;
    }
  }

  el.append(
    h(
      'section',
      { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', {}, 'Live flow', infoTip('liveFlow')), h('span', { class: 'muted small' }, 'Big off-exchange prints and big options trades on your symbols')),
      form,
      statusLine,
    ),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Feed'), h('span', { class: 'muted small' }, 'Newest first · updates every 10 seconds')), list,
      h('p', { class: 'muted small' }, 'Dark-pool prints show where a big trade happened, not who bought or sold. Options trades are volume added since the last 2-minute check (several trades can add up); “bought/sold” comes from where the price sat between bid and ask. Information, never orders.')),
  );
  poll();
  timer = setInterval(poll, 10000);
  return { el, stop: () => clearInterval(timer) };
}

