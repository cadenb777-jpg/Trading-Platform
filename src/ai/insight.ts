/** "AI analysis" buttons: one-off reads of the data on screen, streamed into a panel. */
import { engineRequest } from '../data/schwab';
import { h } from '../ui/dom';
import { openSettings } from '../ui/settings';
import { friendlyAiError } from './assistant';
import { continueInAssistant } from './hub';
import { renderMarkdown } from './markdown';

export interface InsightRequest {
  topic: 'options' | 'insiders' | 'cot' | 'positioning' | 'research' | 'indicator' | 'chart' | 'scanner' | 'market' | 'macro' | 'bonds' | 'board' | 'fund' | 'backtest' | 'futures';
  symbol: string;
  title: string;
  data: unknown;
  market?: string;
  indicator?: string;
  timeframe?: string;
}

/** Streams an AI analysis into `target`. */
export async function runInsight(target: HTMLElement, req: InsightRequest) {
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
    body.innerHTML = renderMarkdown(result.text);
    actions.replaceChildren(
      h('button', { class: 'btn', onclick: () => continueInAssistant(result.conversation, req.title, result.text) }, 'Ask a follow-up'),
      h('span', { class: 'muted small' }, 'AI analysis of the data above. Not financial advice.'),
    );
  } catch (err) {
    cancelAnimationFrame(frame);
    const { text: message, needsKey } = friendlyAiError(err);
    body.replaceChildren(h('div', { class: 'ap-error' }, message));
    if (needsKey) actions.replaceChildren(h('button', { class: 'btn primary', onclick: () => openSettings('ai') }, 'Add API key'));
  }
}

/** A button plus the panel it fills. `getRequest` returns null when there's no data yet. */
export function insightButton(getRequest: () => InsightRequest | null, label = 'AI analysis') {
  const panel = h('section', { class: 'panel insight-panel', hidden: true });
  const button = h(
    'button',
    {
      class: 'btn ai-btn',
      onclick: () => {
        const req = getRequest();
        if (req) runInsight(panel, req);
      },
    },
    h('span', { class: 'ai-spark' }, '✦'),
    ` ${label}`,
  );
  return { button, panel };
}
