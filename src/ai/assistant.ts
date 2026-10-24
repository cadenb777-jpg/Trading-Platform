/** The AI assistant chat: a panel docked on the right of any page, or its own pop-out window. */
import { engineRequest, type EngineEvent } from '../data/schwab';
import { h, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { openSettings } from '../ui/settings';
import { ACCEPTED_FILES, readAttachment, type Attachment } from './files';
import { renderMarkdown } from './markdown';

export interface AssistantAction {
  action: 'open_chart' | 'open_page' | 'add_indicator' | 'create_alert' | 'refresh';
  symbol?: string;
  timeframe?: string;
  page?: string;
  indicator?: string;
  price?: number;
  direction?: 'above' | 'below';
  note?: string;
  what?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  files?: { name: string; info: string }[];
  error?: boolean;
}

interface ChatState {
  conversation: string;
  messages: ChatMessage[];
}

const STORE_KEY = 'tp:ai:chat';
const SUGGESTIONS = [
  'Why is NVDA moving today?',
  'Summarize today’s market in 5 bullet points',
  'Build a low-cost 60/40 ETF portfolio and save it',
  'What does the yield curve say about recession risk?',
  'Give me a game plan for SPY based on options flow',
  'Compare AAPL and MSFT valuations',
];

function loadState(): ChatState {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as ChatState;
  } catch {
    // Storage can be unavailable (private windows); start fresh.
  }
  return { conversation: '', messages: [] };
}

function saveState(s: ChatState) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Not critical.
  }
}

export function friendlyAiError(err: unknown): { text: string; needsKey: boolean } {
  const message = (err as Error).message || String(err);
  if (message === 'NO_AI_KEY') return { text: 'The AI assistant needs your Anthropic API key. Add it in Settings to get started.', needsKey: true };
  return { text: message, needsKey: false };
}

export interface AssistantOptions {
  mode: 'drawer' | 'window';
  getContext(): Record<string, string>;
  /** Example questions for the page the user is on; falls back to the general list. */
  getSuggestions?(): string[];
  onAction(action: AssistantAction): void;
  onClose?(): void;
  onPopOut?(): void;
}

export function createAssistant(opts: AssistantOptions) {
  let chat = loadState();
  let busy = false;
  let controller: AbortController | null = null;
  let attachments: Attachment[] = [];
  const suggestions = () => { const own = opts.getSuggestions?.() ?? []; return own.length ? own : SUGGESTIONS; };

  const list = h('div', { class: 'ai-messages', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'ai-input', rows: 1, placeholder: 'Ask anything… e.g. “Why is NVDA down today?”', 'aria-label': 'Message the AI assistant' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPTED_FILES, hidden: true });
  const chips = h('div', { class: 'ai-chips' });
  const sendBtn = h('button', { class: 'ai-send', title: 'Send (Enter)', 'aria-label': 'Send' }, '↑');
  const header = h(
    'header',
    { class: 'ai-head' },
    h('div', { class: 'ai-title' }, h('span', { class: 'ai-spark' }, '✦'), h('b', {}, 'AI Assistant')),
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'New chat', 'aria-label': 'New chat', onclick: () => newChat() }, icon('plus', 18)),
    h('button', { class: 'icon-btn', title: 'AI settings', 'aria-label': 'AI settings', onclick: () => openSettings('ai') }, icon('gear', 18)),
    opts.mode === 'drawer' && opts.onPopOut ? h('button', { class: 'icon-btn', title: 'Pop out into its own window', 'aria-label': 'Pop out', onclick: () => opts.onPopOut?.() }, icon('popout', 18)) : null,
    opts.mode === 'drawer' ? h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close assistant', onclick: () => opts.onClose?.() }, icon('close', 18)) : null,
  );
  const el = h(
    'div',
    { class: `ai-panel ${opts.mode}` },
    header,
    list,
    h(
      'div',
      { class: 'ai-composer' },
      chips,
      h(
        'div',
        { class: 'ai-input-row' },
        h('button', { class: 'icon-btn', title: 'Attach files: Excel, CSV, PDF, images', 'aria-label': 'Attach files', onclick: () => fileInput.click() }, icon('clip', 18)),
        input,
        sendBtn,
        fileInput,
      ),
      h('div', { class: 'ai-foot muted' }, 'Uses live platform data. Analysis, not financial advice. It can’t place trades.'),
    ),
  );

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, input.scrollHeight)}px`;
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener('click', () => (busy ? stop() : send()));
  fileInput.addEventListener('change', async () => {
    for (const file of [...(fileInput.files ?? [])]) {
      try {
        attachments.push(await readAttachment(file));
      } catch (err) {
        toast((err as Error).message);
      }
    }
    fileInput.value = '';
    renderChips();
  });
  // Drag and drop files onto the panel.
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    for (const file of [...(e.dataTransfer?.files ?? [])]) {
      try {
        attachments.push(await readAttachment(file));
      } catch (err) {
        toast((err as Error).message);
      }
    }
    renderChips();
  });

  function renderChips() {
    chips.replaceChildren(
      ...attachments.map((a, i) =>
        h('span', { class: 'ai-chip' }, icon('clip', 14), `${a.name} · ${a.info}`, h('button', { 'aria-label': `Remove ${a.name}`, onclick: () => (attachments.splice(i, 1), renderChips()) }, '✕')),
      ),
    );
  }

  function bubble(m: ChatMessage) {
    if (m.role === 'user') {
      return h(
        'div',
        { class: 'ai-msg user' },
        m.files?.length ? h('div', { class: 'ai-msg-files' }, ...m.files.map((f) => h('span', { class: 'ai-chip' }, icon('clip', 14), `${f.name} · ${f.info}`))) : null,
        h('div', { class: 'ai-bubble' }, m.text),
      );
    }
    const body = h('div', { class: `ai-bubble md${m.error ? ' error' : ''}` });
    body.innerHTML = renderMarkdown(m.text);
    return h('div', { class: 'ai-msg assistant' }, h('span', { class: 'ai-avatar' }, '✦'), body);
  }

  function renderAll() {
    if (!chat.messages.length) {
      list.replaceChildren(
        h(
          'div',
          { class: 'ai-empty' },
          h('div', { class: 'ai-empty-mark' }, '✦'),
          h('h3', {}, 'How can I help?'),
          h('p', { class: 'muted' }, 'I can see the page you’re on, so ask about anything on screen (“why is…”, “summarize this”). I also read live quotes, news, options flow, financials and the economy, build portfolios, open charts and set alerts.'),
          h('div', { class: 'ai-suggestions' }, ...suggestions().map((s) => h('button', { class: 'ai-suggestion', onclick: () => ask(s) }, s))),
        ),
      );
      return;
    }
    list.replaceChildren(...chat.messages.map(bubble));
    list.scrollTop = list.scrollHeight;
  }

  function newChat() {
    if (chat.conversation) engineRequest('ai.reset', { conversation: chat.conversation }).catch(() => {});
    chat = { conversation: '', messages: [] };
    saveState(chat);
    renderAll();
    input.focus();
  }

  function stop() {
    controller?.abort();
  }

  function setBusy(b: boolean) {
    busy = b;
    sendBtn.textContent = b ? '■' : '↑';
    sendBtn.title = b ? 'Stop' : 'Send (Enter)';
    el.classList.toggle('busy', b);
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input.value).trim();
    if (busy || (!text && !attachments.length)) return;
    const files = attachments;
    attachments = [];
    renderChips();
    input.value = '';
    autosize();
    chat.messages.push({ role: 'user', text: text || 'Please analyse the attached file(s).', files: files.map((f) => ({ name: f.name, info: f.info })) });
    const reply: ChatMessage = { role: 'assistant', text: '' };
    chat.messages.push(reply);
    renderAll();
    const replyEl = list.lastElementChild!.querySelector('.ai-bubble') as HTMLElement;
    const status = h('div', { class: 'ai-status' }, h('span', { class: 'ai-dots' }, h('i'), h('i'), h('i')), h('span', {}, 'Thinking…'));
    replyEl.replaceChildren(status);
    let frame = 0;
    let showStatus = true;
    const paint = () => {
      frame = 0;
      replyEl.innerHTML = renderMarkdown(reply.text);
      if (showStatus) replyEl.append(status);
      list.scrollTop = list.scrollHeight;
    };
    const onEvent = (e: EngineEvent) => {
      if (e.type === 'text') {
        reply.text += e.text;
        showStatus = false;
      } else {
        (status.lastElementChild as HTMLElement).textContent = e.text;
        showStatus = true;
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    setBusy(true);
    controller = new AbortController();
    try {
      const result = await engineRequest<{ conversation: string; text: string; actions: AssistantAction[] }>(
        'ai.chat',
        { conversation: chat.conversation, message: text, attachments: files.map(({ info: _info, ...a }) => a), context: opts.getContext() },
        180000,
        onEvent,
        controller.signal,
      );
      chat.conversation = result.conversation;
      reply.text = result.text || reply.text;
      for (const action of result.actions) opts.onAction(action);
    } catch (err) {
      if ((err as Error).name === 'AbortError') reply.text += reply.text ? '\n\n_(Stopped.)_' : '_(Stopped.)_';
      else {
        const { text: message, needsKey } = friendlyAiError(err);
        reply.text = (reply.text ? `${reply.text}\n\n` : '') + message;
        reply.error = true;
        if (needsKey) setTimeout(() => openSettings('ai'), 300);
      }
    } finally {
      setBusy(false);
      cancelAnimationFrame(frame);
      saveState(chat);
      renderAll();
    }
  }

  function ask(text: string) {
    input.value = text;
    send();
  }

  /** Continues a conversation started elsewhere (e.g. an AI analysis on the Flow page). */
  function continueConversation(conversation: string, title: string, answer: string) {
    chat = { conversation, messages: [{ role: 'user', text: title }, { role: 'assistant', text: answer }] };
    saveState(chat);
    renderAll();
    input.focus();
  }

  renderAll();
  return { el, ask, continueConversation, focus: () => input.focus(), reload: () => {
      if (!busy) {
        chat = loadState();
        renderAll();
      }
    },
  };
}
