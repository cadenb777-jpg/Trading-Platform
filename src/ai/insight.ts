/** "AI summary" buttons (one label on every page): one-off reads of the data on screen, streamed into a panel. */
import { engineRequest, helper } from '../data/schwab';
import { h } from '../ui/dom';
import { openSettings } from '../ui/settings';
import { friendlyAiError } from './assistant';
import { continueInAssistant } from './hub';
import { renderMarkdown } from './markdown';
import { markTickers } from '../ui/markTickers';

export interface InsightRequest {
  topic: 'options' | 'insiders' | 'cot' | 'positioning' | 'research' | 'indicator' | 'chart' | 'scanner' | 'market' | 'macro' | 'bonds' | 'board' | 'fund' | 'backtest' | 'futures' | 'prospect' | 'world';
  symbol: string;
  title: string;
  data: unknown;
  market?: string;
  indicator?: string;
  timeframe?: string;
}

/** Recent summaries by page + symbol + title: reopening a page within this time shows the same read (no new AI call). */
const RECENT = new Map<string, { text: string; conversation: string; at: number }>();
export const RECENT_MS = 30 * 60_000;
export const insightKey = (r: Pick<InsightRequest, 'topic' | 'symbol' | 'title'>) => `${r.topic}|${r.symbol}|${r.title}`;
/** A stored read still fresh at `now` (pure apart from the map; tested). */
export function recentInsight(key: string, now = Date.now()) {
  const hit = RECENT.get(key);
  return hit && now - hit.at < RECENT_MS ? hit : null;
}
export function rememberInsight(key: string, text: string, conversation: string, now = Date.now()) {
  RECENT.set(key, { text, conversation, at: now });
}

/** Streams an AI analysis into `target` (or shows the recent one for the same page and symbol unless `fresh`). */
export async function runInsight(target: HTMLElement, req: InsightRequest, fresh = false) {
  const body = h('div', { class: 'md insight-body' }, h('div', { class: 'ai-status' }, h('span', { class: 'ai-dots' }, h('i'), h('i'), h('i')), h('span', {}, 'Analysing…')));
  const actions = h('div', { class: 'insight-actions' });
  const fold = h('button', { class: 'icon-btn', title: 'Minimize', 'aria-label': 'Minimize', 'aria-expanded': 'true' }, '–');
  fold.onclick = () => {
    const open = body.hidden; // hidden now = minimized, so this click opens it
    body.hidden = actions.hidden = !open;
    fold.textContent = open ? '–' : '+';
    fold.title = fold.ariaLabel = open ? 'Minimize' : 'Expand';
    fold.setAttribute('aria-expanded', String(open));
  };
  const close = h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => (target.hidden = true) }, '✕');
  target.replaceChildren(
    h('div', { class: 'insight-head' }, h('span', { class: 'ai-spark' }, '✦'), h('b', {}, req.title), h('span', { class: 'insight-controls' }, fold, close)),
    body,
    actions,
  );
  target.hidden = false;
  const key = insightKey(req);
  const done = (result: { text: string; conversation: string }, at?: number) => {
    body.innerHTML = renderMarkdown(result.text);
    markTickers(body);
    actions.replaceChildren(
      h('button', { class: 'btn', onclick: () => continueInAssistant(result.conversation, req.title, result.text) }, 'Ask a follow-up'),
      h('span', { class: 'muted small' }, `AI analysis of the data above${at ? `, written ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. Not financial advice.`),
    );
  };
  const kept = fresh ? null : recentInsight(key);
  if (kept) {
    done(kept, kept.at);
    return;
  }
  let text = '';
  let frame = 0;
  try {
    const { title: _title, ...params } = req;
    const result = await engineRequest<{ conversation: string; text: string }>('ai.insight', params, 120000, (e) => {
      if (e.type !== 'text') return;
      text += e.text;
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), (body.innerHTML = renderMarkdown(text))));
    });
    cancelAnimationFrame(frame);
    rememberInsight(key, result.text, result.conversation);
    done(result);
  } catch (err) {
    cancelAnimationFrame(frame);
    const { text: message, needsKey } = friendlyAiError(err);
    body.replaceChildren(h('div', { class: 'ap-error' }, message));
    if (needsKey) actions.replaceChildren(h('button', { class: 'btn primary', onclick: () => openSettings('ai') }, 'Add API key'));
  }
}

/**
 * Moves the summary panel to sit directly under the row that holds its button, wherever the page first put it: the
 * row is the button's nearest ancestor whose parent stacks its children (not a side-by-side flex row).
 */
export function placeUnder(button: HTMLElement, panel: HTMLElement) {
  if (!button.isConnected) return; // a button only clicked from a function bar: the panel stays where the page put it
  let row: HTMLElement = button;
  while (row.parentElement && row.parentElement !== document.body) {
    const parent = row.parentElement;
    const s = getComputedStyle(parent);
    const sideBySide = (s.display.includes('flex') && !s.flexDirection.startsWith('column')) || s.display.startsWith('inline');
    if (!sideBySide) break;
    row = parent;
  }
  if (row.nextElementSibling !== panel) row.after(panel);
}

/** A button plus the panel it fills. `getRequest` returns null when there's no data yet. */
/** Whether summaries may run by themselves: the helper is connected and the AI key is saved (checked once a minute). */
let aiCheck: { at: number; ok: Promise<boolean> } | null = null;
function aiReady(): Promise<boolean> {
  if (helper.version == null) return Promise.resolve(false);
  if (!aiCheck || Date.now() - aiCheck.at > 60_000) {
    aiCheck = { at: Date.now(), ok: engineRequest<{ aiKeySet?: boolean }>('settings.get', {}, 10000).then((s) => !!s.aiKeySet, () => false) };
  }
  return aiCheck.ok;
}

/**
 * The page's AI summary. It writes itself (owner: "don't ask me to click"): once the page is showing and its data has
 * loaded, the read streams into the panel under the button; a new symbol gets a new read; the same page and symbol
 * within RECENT_MS show the stored read (no new AI call). The button refreshes it; closing the panel keeps it closed
 * for that symbol. Without an AI key nothing runs by itself.
 */
export function insightButton(getRequest: () => InsightRequest | null, label = 'AI summary') {
  const panel = h('section', { class: 'panel insight-panel', hidden: true });
  let shownKey = '';
  let closedKey = '';
  const button = h(
    'button',
    {
      class: 'btn ai-btn',
      title: 'Write a fresh AI summary of this page',
      onclick: () => {
        const req = getRequest();
        placeUnder(button, panel);
        if (!req) {
          // never a dead button: say what it is waiting for
          panel.hidden = false;
          panel.replaceChildren(h('p', { class: 'muted small' }, 'Nothing to read yet: the AI summary needs this page’s prices or headlines, which haven’t loaded. Try again in a moment.'));
          return;
        }
        shownKey = insightKey(req);
        closedKey = '';
        runInsight(panel, req, true);
      },
    },
    h('span', { class: 'ai-spark' }, '✦'),
    ` ${label}`,
  );
  // remember a close so the read doesn't come back for the same symbol
  panel.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.insight-controls .icon-btn[aria-label="Close"]')) closedKey = shownKey;
  });
  let gone = 0;
  const tick = async () => {
    // a button the page threw away (re-drawn) stops checking after a minute
    if (!button.isConnected) {
      if (++gone > 30) clearInterval(timer);
      return;
    }
    gone = 0;
    if (button.offsetParent === null || document.hidden) return;
    const req = getRequest();
    if (!req) return;
    const key = insightKey(req);
    if (key === shownKey || key === closedKey) return;
    if (!(await aiReady())) return;
    shownKey = key;
    placeUnder(button, panel);
    void runInsight(panel, req);
  };
  const timer = setInterval(() => void tick(), 2000);
  return { button, panel };
}
