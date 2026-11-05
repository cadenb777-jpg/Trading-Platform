/** The AI assistant chat: a panel docked on the right of any page, or its own pop-out window. */
import { aiActionsReady, engineRequest, type EngineEvent, type UiActionEvent, type UiCancelEvent } from '../data/schwab';
import type { ActionResult } from './actions';
import { h, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { openSettings } from '../ui/settings';
import { ACCEPTED_FILES, readAttachment, type Attachment } from './files';
import { renderMarkdown } from './markdown';
import { markTickers } from '../ui/markTickers';
import { AI_MODES, EQUILIBRIUM_STARTERS, modeLabel, type AiModeId } from './modes';

/** Maths rendering (KaTeX) for Equilibrium-Prime answers: downloaded only when that mode is used. */
type MathModule = typeof import('../strategy/math');
let mathModule: MathModule | null = null;
let mathLoad: Promise<MathModule> | null = null;
const loadMath = () => (mathLoad ??= import('../strategy/math').then((m) => (mathModule = m)));

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

/** One platform action the AI carried out, shown as a compact line under its message. */
export interface ChatStep {
  ok: boolean;
  message: string;
  undoId?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  files?: { name: string; info: string }[];
  error?: boolean;
  steps?: ChatStep[];
  /** The owner pressed Undo on this message's actions. */
  undone?: boolean;
}

/** How the assistant carries out the AI's platform actions (helper v42+); see actions.ts. */
export interface AssistantActions {
  run(name: string, args: Record<string, unknown>): Promise<ActionResult>;
  /** A question to confirm with the owner before running, or null. */
  confirmation(name: string, args: Record<string, unknown>): Promise<string | null>;
  /** Undoes these actions (newest first); resolves to how many were undone. */
  undo(undoIds: string[]): Promise<number>;
}

interface ChatState {
  conversation: string;
  messages: ChatMessage[];
  /** The assistant mode this chat uses ('' = the platform assistant). */
  mode?: AiModeId;
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

function loadState(key = STORE_KEY): ChatState {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw) as ChatState;
  } catch {
    // Storage can be unavailable (private windows); start fresh.
  }
  return { conversation: '', messages: [] };
}

function saveState(s: ChatState, key = STORE_KEY) {
  try {
    sessionStorage.setItem(key, JSON.stringify(s));
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
  /** Platform actions the AI can chain and undo (needs helper v42+; without it the one-way onAction is used). */
  actions?: AssistantActions;
  onClose?(): void;
  onPopOut?(): void;
  /** Where this chat is kept (a page's own chat uses its own key). */
  storeKey?: string;
  /** A chat locked to one mode (no mode menu), e.g. the Strategy Lab's Equilibrium-Prime panel. */
  fixedMode?: AiModeId;
  /** Text describing the model on the page, sent with each question (Strategy Lab: the current game). */
  getModel?(): string;
  /** The heading (default "AI Assistant"). */
  title?: string;
}

export function createAssistant(opts: AssistantOptions) {
  const storeKey = opts.storeKey ?? STORE_KEY;
  let chat = loadState(storeKey);
  if (opts.fixedMode !== undefined) chat.mode = opts.fixedMode;
  const mode = (): AiModeId => opts.fixedMode ?? chat.mode ?? '';
  const isMathMode = () => mode() === 'equilibrium_prime';
  const md = (text: string) => (isMathMode() && mathModule ? mathModule.renderMarkdownMathSync(text) : renderMarkdown(text));
  /** Typesets the maths in a finished answer (Equilibrium-Prime). */
  const typeset = (el: HTMLElement, text: string) => {
    if (!isMathMode()) return;
    loadMath()
      .then((m) => m.renderMarkdownMath(text))
      .then((html) => {
        el.innerHTML = html;
      })
      .catch(() => {});
  };
  if (isMathMode()) loadMath().catch(() => {});
  const save = () => saveState(chat, storeKey);
  let busy = false;
  let controller: AbortController | null = null;
  let attachments: Attachment[] = [];
  const suggestions = () => {
    if (mode() === 'equilibrium_prime') return EQUILIBRIUM_STARTERS;
    const own = opts.getSuggestions?.() ?? [];
    return own.length ? own : SUGGESTIONS;
  };
  const modeSelect = h(
    'select',
    { class: 'ai-mode', title: 'Assistant mode', 'aria-label': 'Assistant mode' },
    ...AI_MODES.map((m) => h('option', { value: m.id, title: m.blurb }, m.label)),
  );
  modeSelect.value = mode();
  const placeholder = () => (isMathMode() ? 'Describe the situation, or start with [SOLVE], [RED TEAM], [REDESIGN], [TUTOR]…' : 'Ask anything… e.g. “Why is NVDA down today?”');
  modeSelect.addEventListener('change', () => {
    newChat(modeSelect.value as AiModeId);
  });

  const list = h('div', { class: 'ai-messages', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'ai-input', rows: 1, placeholder: 'Ask anything… e.g. “Why is NVDA down today?”', 'aria-label': 'Message the AI assistant' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPTED_FILES, hidden: true });
  const chips = h('div', { class: 'ai-chips' });
  const sendBtn = h('button', { class: 'ai-send', title: 'Send (Enter)', 'aria-label': 'Send' }, '↑');
  const header = h(
    'header',
    { class: 'ai-head' },
    h('div', { class: 'ai-title' }, h('span', { class: 'ai-spark' }, '✦'), h('b', {}, opts.title ?? 'AI Assistant')),
    opts.fixedMode === undefined ? modeSelect : null,
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
    body.innerHTML = md(m.text);
    if (!m.error && !isMathMode()) markTickers(body); // tickers open the security view, as everywhere
    if (!m.error) typeset(body, m.text);
    return h('div', { class: 'ai-msg assistant' }, h('span', { class: 'ai-avatar' }, '✦'), h('div', { class: 'ai-msg-body' }, body, stepsLine(m)));
  }

  /** "✓ Opened AAPL 5m · ✓ Added RSI(9) — tuned for 5-minute bars · Undo" under the AI's message. */
  function stepsLine(m: ChatMessage): HTMLElement {
    const el = h('div', { class: 'ai-steps', hidden: !m.steps?.length });
    if (!m.steps?.length) return el;
    const parts: Node[] = [];
    m.steps.forEach((step, i) => {
      if (i) parts.push(h('span', { class: 'ai-step-sep', 'aria-hidden': 'true' }, ' · '));
      parts.push(h('span', { class: `ai-step ${step.ok ? 'ok' : 'failed'}${m.undone && step.undoId ? ' undone' : ''}` }, step.ok ? '✓ ' : '✕ ', step.message));
    });
    const undoIds = m.steps.filter((s) => s.ok && s.undoId).map((s) => s.undoId!);
    if (m.undone) parts.push(h('span', { class: 'ai-step-sep' }, ' · '), h('span', { class: 'muted' }, 'Undone'));
    else if (undoIds.length && opts.actions) {
      const undoBtn = h('button', { class: 'ai-undo', title: 'Put back what these actions changed' }, 'Undo');
      undoBtn.addEventListener('click', async () => {
        undoBtn.disabled = true;
        try {
          await opts.actions!.undo(undoIds);
          m.undone = true;
          save();
          el.replaceWith(stepsLine(m));
          toast('Undone');
        } catch (err) {
          undoBtn.disabled = false;
          toast(`Couldn’t undo: ${(err as Error).message}`);
        }
      });
      parts.push(h('span', { class: 'ai-step-sep', 'aria-hidden': 'true' }, ' · '), undoBtn);
    }
    el.append(...parts);
    return el;
  }

  function renderAll() {
    if (!chat.messages.length) {
      list.replaceChildren(
        h(
          'div',
          { class: 'ai-empty' },
          h('div', { class: 'ai-empty-mark' }, '✦'),
          h('h3', {}, isMathMode() ? 'Equilibrium-Prime' : 'How can I help?'),
          h(
            'p',
            { class: 'muted' },
            isMathMode()
              ? 'Describe a strategic situation, or attach the documents behind it (PDF or text) as sources. Start with a mode tag: [SOLVE], [RED TEAM], [REDESIGN], [TUTOR] or [SUMMARY MATRIX]. Every equilibrium it states is computed by the game engine and listed under the answer.'
              : 'I can see the page you’re on, so ask about anything on screen (“why is…”, “summarize this”). I also read live quotes, news, options flow, financials and the economy, build portfolios, open charts and set alerts.',
          ),
          h('div', { class: 'ai-suggestions' }, ...suggestions().map((s) => h('button', { class: 'ai-suggestion', onclick: () => ask(s) }, s))),
        ),
      );
      return;
    }
    list.replaceChildren(...chat.messages.map(bubble));
    list.scrollTop = list.scrollHeight;
  }

  function newChat(nextMode: AiModeId = mode()) {
    if (chat.conversation) engineRequest('ai.reset', { conversation: chat.conversation }).catch(() => {});
    chat = { conversation: '', messages: [], mode: opts.fixedMode ?? nextMode };
    modeSelect.value = mode();
    el.dataset.mode = mode();
    input.placeholder = placeholder();
    if (isMathMode()) loadMath().catch(() => {});
    save();
    renderAll();
    input.focus();
  }

  /** Identifies the running chat to the helper, so Stop also cancels its platform actions there (helper v42+). */
  let stopToken = '';
  function stop() {
    controller?.abort();
    if (stopToken && aiActionsReady()) engineRequest('ai.stop', { stopToken }, 10000).catch(() => {});
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
      replyEl.innerHTML = md(reply.text);
      if (!isMathMode()) markTickers(replyEl);
      if (showStatus) replyEl.append(status);
      list.scrollTop = list.scrollHeight;
    };
    const useActions = !!opts.actions && aiActionsReady();
    let chatSignal: AbortSignal | undefined;
    const stopped = () => chatSignal?.aborted ?? false;
    /** Actions the helper gave up on (timed out): never run them late. */
    const cancelled = new Set<string>();
    /**
     * Carries out one platform action the AI asked for, shows it, and sends the result back to the helper. It never
     * runs after Stop, after the helper gave up on it, or when a confirmation was answered after the helper's deadline.
     */
    const doAction = async (ev: UiActionEvent, received: number) => {
      const { callId, name, args } = ev;
      const late = () => cancelled.has(callId) || (ev.timeoutMs ? Date.now() - received > ev.timeoutMs - 2000 : false);
      let result: ActionResult;
      if (stopped()) result = { ok: false, name, message: 'Stopped, so nothing changed' };
      else if (late()) result = { ok: false, name, message: 'Timed out before it ran, so nothing changed' };
      else {
        const asked = await opts.actions!.confirmation(name, args).catch(() => null);
        const question = asked ?? (ev.confirm ? `Let the AI run "${name.replace(/_/g, ' ')}"?` : null);
        const allowed = !question || confirm(question);
        if (!allowed) result = { ok: false, name, message: 'The owner said no, so nothing changed' };
        else if (stopped()) result = { ok: false, name, message: 'Stopped, so nothing changed' };
        else if (late()) result = { ok: false, name, message: 'The confirmation came too late, so nothing changed. Ask again if you still want it' };
        else {
          try {
            result = await opts.actions!.run(name, args);
          } catch (err) {
            result = { ok: false, name, message: (err as Error).message };
          }
        }
      }
      if (!result.readOnly || !result.ok) {
        (reply.steps ??= []).push({ ok: result.ok, message: result.message, ...(result.undoId ? { undoId: result.undoId } : {}) });
        const old = replyEl.parentElement?.querySelector('.ai-steps');
        old?.replaceWith(stepsLine(reply));
        save();
      }
      await engineRequest('ai.ui_result', { callId, result }, 15000).catch(() => {});
    };
    let actionChain = Promise.resolve();
    const onEvent = (e: EngineEvent) => {
      const ui = e as EngineEvent | UiActionEvent | UiCancelEvent;
      if (ui.type === 'ui_cancel') {
        cancelled.add(ui.callId);
        return;
      }
      if (ui.type === 'ui_action') {
        const received = Date.now();
        if (useActions) actionChain = actionChain.then(() => doAction(ui, received));
        return;
      }
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
    chatSignal = controller.signal;
    stopToken = Math.random().toString(36).slice(2);
    try {
      const result = await engineRequest<{ conversation: string; text: string; actions: AssistantAction[] }>(
        'ai.chat',
        {
          conversation: chat.conversation,
          message: text,
          attachments: files.map(({ info: _info, ...a }) => a),
          context: opts.getContext(),
          ...(useActions ? { ui_actions: 1, stopToken } : {}),
          ...(mode() ? { mode: mode() } : {}),
          ...(mode() && opts.getModel ? { model: opts.getModel() } : {}),
        },
        180000,
        onEvent,
        controller.signal,
      );
      chat.conversation = result.conversation;
      reply.text = result.text || reply.text;
      await actionChain;
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
      save();
      renderAll();
    }
  }

  function ask(text: string) {
    input.value = text;
    send();
  }

  /** Continues a conversation started elsewhere (e.g. an AI analysis on the Flow page). */
  function continueConversation(conversation: string, title: string, answer: string) {
    chat = { conversation, messages: [{ role: 'user', text: title }, { role: 'assistant', text: answer }], mode: opts.fixedMode ?? '' };
    modeSelect.value = mode();
    el.dataset.mode = mode();
    save();
    renderAll();
    input.focus();
  }

  el.dataset.mode = mode();
  input.placeholder = placeholder();
  renderAll();
  /** Puts a question in the box without sending it (the owner presses Enter). */
  const prefill = (text: string) => {
    input.value = text;
    autosize();
    input.focus();
    input.setSelectionRange(text.length, text.length);
  };
  /** Attaches files as if picked with the paperclip (e.g. the Strategy Lab's sources). */
  const attach = (files: Attachment[]) => {
    attachments.push(...files);
    renderChips();
  };
  return { el, ask, prefill, attach, continueConversation, label: () => modeLabel(mode()), focus: () => input.focus(), reload: () => {
      if (!busy) {
        chat = loadState(storeKey);
        if (opts.fixedMode !== undefined) chat.mode = opts.fixedMode;
        modeSelect.value = mode();
        renderAll();
      }
    },
  };
}
