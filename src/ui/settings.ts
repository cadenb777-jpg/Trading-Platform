import { buddySettings } from './buddy';
/**
 * Settings: Data connections (src/ui/connections.ts: the AI key, SEC email, FRED, BEA, BLS, EIA, Census, Finnhub and Alpaca),
 * the AI model, Webull (trading:
 * keys, Test/Live, order limits) and where alerts are sent (ntfy, Telegram). Values go straight to the helper,
 * which saves them on this computer; keys are never stored in the browser or shown again.
 */
import { chartEffectsSetting, reducedMotion, setChartEffects } from '../chart/frame';
import { LATEST_HELPER_VERSION, engineRequest, helper, prospectContactsReady, setAlpacaConnected } from '../data/schwab';
import { smtpCheckRow } from '../prospect/smtpSetting';
import { dataConnectionsSection } from './connections';
import { deliverySummary } from './alertsLogic';
import { diagnosticsButton } from './diagnostics';
import { h, openModal, toast } from './dom';
import { currentTheme, setTheme, type ThemeName } from './theme';

export interface PlatformSettings {
  aiKeySet: boolean;
  fredKeySet: boolean;
  /** Free data keys (helper 44+; undefined on older helpers). Only whether each is saved; never the key. */
  blsKeySet?: boolean;
  beaKeySet?: boolean;
  eiaKeySet?: boolean;
  censusKeySet?: boolean;
  finnhubKeySet?: boolean;
  /** Both Alpaca keys are saved (missing from helpers without Alpaca support; the keys themselves are never sent back). */
  alpacaSet?: boolean;
  /** Webull App Key + Secret saved (helper 26+); the keys themselves are never sent back. */
  webullSet?: boolean;
  webullEnv?: 'test' | 'live';
  webullMaxOrder?: number;
  webullMaxPerDay?: number;
  /** Futures trading switched on (typed FUTURES; helper 31+) and its contract limits. */
  webullFutures?: boolean;
  webullFuturesMaxContracts?: number;
  webullFuturesMaxPerDay?: number;
  /** Where alerts are sent (helper 32+): ntfy topic / Telegram bot saved. The topic and token are never sent back. */
  ntfySet?: boolean;
  ntfyCustomServer?: boolean;
  telegramSet?: boolean;
  secContact: string;
  model: string;
  models: { id: string; name: string }[];
  /** Open the platform in Chrome when the helper finishes starting (helper version 9+). */
  openBrowser?: boolean;
  /** Install helper updates without asking (default off; helpers with the self-update only). */
  autoUpdate?: boolean;
  /** Prospecting: the optional mail-server (SMTP) check of guessed emails (off by default). */
  prospectSmtpCheck?: boolean;
}

let cached: PlatformSettings | null = null;
const listeners = new Set<(s: PlatformSettings) => void>();

export async function getSettings(force = false): Promise<PlatformSettings> {
  if (!cached || force) cached = await engineRequest<PlatformSettings>('settings.get', {}, 10000);
  setAlpacaConnected(!!cached.alpacaSet);
  return cached;
}

export function onSettingsChange(fn: (s: PlatformSettings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function save(changes: Record<string, string | number | boolean>) {
  cached = await engineRequest<PlatformSettings>('settings.set', changes, 10000);
  setAlpacaConnected(!!cached.alpacaSet);
  for (const fn of listeners) fn(cached);
  window.dispatchEvent(new CustomEvent('tp:settings-saved')); // e.g. the Trade page re-reads its limits
  return cached;
}

const secretInput = (isSet: boolean, placeholder: string, label: string) =>
  h('input', { class: 'input', type: 'password', placeholder: isSet ? 'Saved ✓ (paste a new one to replace it)' : placeholder, autocomplete: 'off', spellcheck: false, 'aria-label': label });

/** A long random ntfy topic (anyone who knows the topic can read the alerts, so it works like a password). */
export function randomTopic(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `tp-alerts-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)}`;
}

/** Alerts: free phone delivery by ntfy or Telegram. The topic and token stay in the helper. */
function alertsRow(s: PlatformSettings, refresh: () => void): HTMLElement {
  const result = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const run = async (work: () => Promise<unknown>, done = 'Saved') => {
    try {
      await work();
      toast(done);
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const topic = secretInput(!!s.ntfySet, 'Topic: long and random', 'ntfy topic');
  const server = h('input', { class: 'input', placeholder: s.ntfyCustomServer ? 'Own server saved ✓ (empty = keep it)' : 'Server (optional; empty = ntfy.sh)', autocomplete: 'off', spellcheck: false, 'aria-label': 'ntfy server' });
  const token = secretInput(!!s.telegramSet, 'Bot token from BotFather', 'Telegram bot token');
  const chat = h('input', { class: 'input', placeholder: s.telegramSet ? 'Chat saved ✓' : 'Chat id (or use Find my chat)', autocomplete: 'off', spellcheck: false, 'aria-label': 'Telegram chat id' });
  const status = (on: boolean | undefined) => h('span', { class: `key-status ${on ? 'ok' : ''}` }, on ? '● Set up' : '○ Not set');
  const test = async () => {
    result.textContent = 'Sending a test…';
    try {
      const r = await engineRequest<{ results: Record<string, string> }>('alerts.test', {}, 30000);
      result.textContent = [deliverySummary(r.results).text, r.results.note].filter(Boolean).join(' · ');
    } catch (err) {
      result.textContent = `✗ ${(err as Error).message}`;
    }
  };
  return h(
    'div',
    { class: 'settings-row', id: 'settings-alerts' },
    h('p', { class: 'muted small' }, 'Stock alerts are checked by the helper, so they fire even when the platform is closed (the helper must be running). Pick one or both free ways to get them on your phone. Alerts only tell you something: they never place or change orders.'),
    h('div', { class: 'settings-label' }, h('b', {}, 'ntfy (easiest)'), status(s.ntfySet)),
    h(
      'ol',
      { class: 'muted small settings-steps' },
      h('li', {}, 'Install the free ntfy app (', h('a', { href: 'https://ntfy.sh', target: '_blank', rel: 'noopener' }, 'ntfy.sh'), ', on iPhone and Android).'),
      h('li', {}, 'Click "Make one" for a long random topic (anyone who knows it can read your alerts, so treat it like a password), then Save.'),
      h('li', {}, 'In the app, tap +, "Subscribe to topic" and type the same topic. Then click Send test.'),
    ),
    h(
      'div',
      { class: 'ap-controls' },
      topic,
      h('button', { class: 'btn', onclick: () => ((topic.type = 'text'), (topic.value = randomTopic()), topic.select()) }, 'Make one'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            const changes: Record<string, string> = {};
            if (topic.value.trim()) changes.ntfyTopic = topic.value.trim();
            if (server.value.trim()) changes.ntfyServer = server.value.trim();
            if (!Object.keys(changes).length) return toast('Enter the topic first');
            return run(() => save(changes));
          },
        },
        'Save',
      ),
      s.ntfySet ? h('button', { class: 'btn', onclick: () => confirm('Remove the ntfy phone alerts? Alerts stop reaching your phone until you set it up again.') && run(() => save({ ntfyTopic: '', ntfyServer: '' }), 'Removed') }, 'Remove') : null,
    ),
    h('div', { class: 'ap-controls' }, server),
    h('div', { class: 'settings-label' }, h('b', {}, 'Telegram'), status(s.telegramSet)),
    h(
      'ol',
      { class: 'muted small settings-steps' },
      h('li', {}, 'In Telegram, open ', h('a', { href: 'https://t.me/BotFather', target: '_blank', rel: 'noopener' }, '@BotFather'), ', send /newbot and follow the questions. It gives you a token (numbers, a colon, a long code).'),
      h('li', {}, 'Paste the token here and Save.'),
      h('li', {}, 'Open your new bot in Telegram and press Start (or send it "hi"), then click Find my chat.'),
    ),
    h(
      'div',
      { class: 'ap-controls' },
      token,
      h('button', { class: 'btn primary', onclick: () => (token.value.trim() ? run(() => save({ telegramToken: token.value.trim() })) : toast('Paste the token first')) }, 'Save'),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            try {
              const r = await engineRequest<{ name: string }>('alerts.telegram_link', {}, 20000);
              // Show who it found and save only once the owner says it's them.
              result.replaceChildren(
                `Found the chat of "${r.name}". Is that you? `,
                h('button', { class: 'btn small primary', onclick: () => run(async () => { cached = await engineRequest<PlatformSettings>('alerts.telegram_link', { confirm: true }, 20000); }, 'Telegram linked: click Send test') }, 'Yes, use it'),
              );
            } catch (err) {
              result.textContent = `✗ ${(err as Error).message}`;
            }
          },
        },
        'Find my chat',
      ),
      s.telegramSet ? h('button', { class: 'btn', onclick: () => confirm('Remove the Telegram alerts? Alerts stop reaching Telegram until you set it up again.') && run(() => save({ telegramToken: '', telegramChat: '' }), 'Removed') }, 'Remove') : null,
    ),
    h('div', { class: 'ap-controls' }, chat, h('button', { class: 'btn', onclick: () => (chat.value.trim() ? run(() => save({ telegramChat: chat.value.trim() })) : toast('Type the chat id first')) }, 'Save chat id')),
    h('div', { class: 'ap-controls' }, h('button', { class: 'btn', onclick: test }, 'Send test')),
    result,
  );
}

interface WebullStatus {
  ok: boolean;
  message: string;
  env: 'test' | 'live';
}

/** Typed confirmation before Webull switches to real money. */
function confirmLive(done: () => void) {
  const input = h('input', { class: 'input', placeholder: 'Type LIVE', autocomplete: 'off', spellcheck: false, 'aria-label': 'Type LIVE to confirm' }) as HTMLInputElement;
  const go = h('button', { class: 'btn danger', disabled: true }, 'Switch to Live') as HTMLButtonElement;
  input.addEventListener('input', () => (go.disabled = input.value !== 'LIVE'));
  const close = openModal(
    'Switch Webull to Live?',
    h(
      'div',
      { class: 'settings' },
      h('p', { class: 'wb-warning' }, 'Live means real money. Orders you place from the platform will be sent to your real Webull account and can lose money.'),
      h('p', { class: 'muted small' }, 'Every order still needs a preview and a confirm, and your maximum order value and orders-per-day limits still apply. You can switch back to Test at any time.'),
      h('p', { class: 'muted small' }, 'Use your own App Key and Secret from Webull (the shared test keys only work in Test).'),
      h('div', { class: 'ap-controls' }, input, go),
    ),
  );
  go.addEventListener('click', async () => {
    try {
      await save({ webullEnv: 'live', webullLiveConfirm: 'LIVE' });
      toast('Webull is now LIVE (real money)');
      close();
      done();
    } catch (err) {
      toast((err as Error).message);
    }
  });
}

/** Typed confirmation before futures trading is switched on. */
function confirmFutures(done: () => void) {
  const input = h('input', { class: 'input', placeholder: 'Type FUTURES', autocomplete: 'off', spellcheck: false, 'aria-label': 'Type FUTURES to confirm' }) as HTMLInputElement;
  const go = h('button', { class: 'btn danger', disabled: true }, 'Enable futures trading') as HTMLButtonElement;
  input.addEventListener('input', () => (go.disabled = input.value !== 'FUTURES'));
  const close = openModal(
    'Enable futures trading?',
    h(
      'div',
      { class: 'settings' },
      h('p', { class: 'wb-warning' }, 'Futures can lose more than you put in. A small price move on a full-size contract can cost thousands of dollars.'),
      h('p', { class: 'muted small' }, 'Orders go only to your Webull futures account, one contract at a time by default, and every order still needs a preview and a confirm. Real money also needs Live (type LIVE). You can switch futures off at any time.'),
      h('div', { class: 'ap-controls' }, input, go),
    ),
  );
  go.addEventListener('click', async () => {
    try {
      await save({ webullFutures: true, webullFuturesConfirm: 'FUTURES' });
      toast('Futures trading is on');
      close();
      done();
    } catch (err) {
      toast((err as Error).message);
    }
  });
}

/** Webull: the only place orders can be sent from. Keys, Test/Live (Live needs typed LIVE) and the order limits. */
function webullRow(s: PlatformSettings, refresh: () => void): HTMLElement {
  const isSet = !!s.webullSet;
  const live = s.webullEnv === 'live';
  const key = h('input', { class: 'input', type: 'password', placeholder: isSet ? 'Saved ✓ (paste a new App Key to replace it)' : 'App Key', autocomplete: 'off', spellcheck: false, 'aria-label': 'Webull App Key' });
  const secret = h('input', { class: 'input', type: 'password', placeholder: isSet ? 'Saved ✓ (paste a new App Secret to replace it)' : 'App Secret', autocomplete: 'off', spellcheck: false, 'aria-label': 'Webull App Secret' });
  const result = h('p', { class: 'muted small' });
  const maxOrder = h('input', { class: 'input', type: 'number', min: 1, step: 100, value: s.webullMaxOrder ?? 1000, 'aria-label': 'Max order value ($)' }) as HTMLInputElement;
  const maxDay = h('input', { class: 'input', type: 'number', min: 1, max: 100, step: 1, value: s.webullMaxPerDay ?? 10, 'aria-label': 'Max orders per day' }) as HTMLInputElement;
  const futOn = !!s.webullFutures;
  const futMax = h('input', { class: 'input', type: 'number', min: 1, max: 20, step: 1, value: s.webullFuturesMaxContracts ?? 1, 'aria-label': 'Max contracts per order' }) as HTMLInputElement;
  const futDay = h('input', { class: 'input', type: 'number', min: 1, max: 50, step: 1, value: s.webullFuturesMaxPerDay ?? 3, 'aria-label': 'Max contracts per day' }) as HTMLInputElement;
  const test = async () => {
    result.textContent = 'Testing…';
    try {
      const r = await engineRequest<WebullStatus>('webull.status', {}, 30000);
      result.textContent = `${r.ok ? '✓' : '✗'} ${r.message}`;
    } catch (err) {
      const message = (err as Error).message;
      result.textContent = /doesn.t know|latest helper|update/i.test(message) ? 'Your helper is too old for Webull: download the project ZIP again to update it.' : `✗ ${message}`;
    }
  };
  const envSeg = h(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': 'Webull environment' },
    h(
      'button',
      {
        class: live ? '' : 'active',
        onclick: async () => {
          if (!live) return;
          try {
            await save({ webullEnv: 'test' });
            toast('Webull is back on Test (no real money)');
          } catch (err) {
            toast((err as Error).message);
          }
          refresh();
        },
      },
      'Test (no real money)',
    ),
    h('button', { class: live ? 'active wb-live' : '', onclick: () => (live ? null : confirmLive(refresh)) }, 'Live (real money)'),
  );
  return h(
    'div',
    { class: 'settings-row' },
    h('div', { class: 'settings-label' }, h('b', {}, 'Webull (trading, optional)'), h('span', { class: `key-status ${isSet ? 'ok' : ''}` }, isSet ? '● Saved' : '○ Not set'), live ? h('span', { class: 'badge down' }, 'LIVE') : h('span', { class: 'badge' }, 'TEST')),
    h(
      'p',
      { class: 'muted small' },
      'Place stock orders on the Trade page; view and sync your accounts on the Account page (Sync Webull). Apply for API access and create an App Key and App Secret on ',
      h('a', { href: 'https://developer.webull.com/apis/docs/getting-started', target: '_blank', rel: 'noopener' }, 'Webull’s developer site'),
      '. Start in Test: Webull’s test environment uses shared test keys listed on its SDK page and no real money. The AI assistant can never place orders.',
    ),
    h('div', { class: 'ap-controls' }, key),
    h(
      'div',
      { class: 'ap-controls' },
      secret,
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const changes: Record<string, string> = {};
            if (key.value.trim()) changes.webullAppKey = key.value.trim();
            if (secret.value.trim()) changes.webullAppSecret = secret.value.trim();
            if (!isSet && !(changes.webullAppKey && changes.webullAppSecret)) return toast('Paste both the App Key and the App Secret');
            if (!Object.keys(changes).length) return toast('Paste the new key first');
            try {
              const r = await save(changes);
              if (r.webullSet === undefined) return toast('Your helper is too old for Webull: download the project ZIP again to update it.');
              toast('Saved');
              refresh();
            } catch (err) {
              toast((err as Error).message);
            }
          },
        },
        'Save',
      ),
      h('button', { class: 'btn', onclick: test }, 'Test connection'),
      isSet
        ? h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                await save({ webullAppKey: '', webullAppSecret: '' }).catch((err) => toast((err as Error).message));
                refresh();
              },
            },
            'Remove',
          )
        : null,
    ),
    result,
    h('div', { class: 'settings-label' }, h('b', {}, 'Environment')),
    envSeg,
    live ? h('p', { class: 'muted small' }, 'Live: orders use real money in your Webull account.') : h('p', { class: 'muted small' }, 'Test: orders go to Webull’s practice environment. Nothing real is bought or sold.'),
    h('div', { class: 'settings-label' }, h('b', {}, 'Order limits')),
    h('p', { class: 'muted small' }, 'Safety limits checked by the helper before every order. An order above the maximum value, or after the daily number of orders, is refused.'),
    h(
      'div',
      { class: 'ap-controls' },
      h('label', { class: 'wb-field' }, h('span', { class: 'muted tiny' }, 'Max order value ($)'), maxOrder),
      h('label', { class: 'wb-field' }, h('span', { class: 'muted tiny' }, 'Max orders per day'), maxDay),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            try {
              await save({ webullMaxOrder: Number(maxOrder.value), webullMaxPerDay: Number(maxDay.value) });
              toast('Limits saved');
            } catch (err) {
              toast((err as Error).message);
            }
          },
        },
        'Save limits',
      ),
    ),
    s.webullFutures === undefined
      ? ''
      : h(
          'div',
          { class: 'settings-sub' },
          h('div', { class: 'settings-label' }, h('b', {}, 'Futures trading'), futOn ? h('span', { class: 'badge down' }, 'ON') : h('span', { class: 'badge' }, 'OFF')),
          h('p', { class: 'muted small' }, 'Off by default. When on, the Trade page can send futures orders to your Webull futures account only. Futures can lose more than you put in.'),
          h(
            'div',
            { class: 'ap-controls' },
            futOn
              ? h('button', { class: 'btn', onclick: async () => (await save({ webullFutures: false }).catch((err) => toast((err as Error).message)), toast('Futures trading is off'), refresh()) }, 'Switch off futures trading')
              : h('button', { class: 'btn danger', onclick: () => confirmFutures(refresh) }, 'Enable futures trading'),
          ),
          h(
            'div',
            { class: 'ap-controls' },
            h('label', { class: 'wb-field' }, h('span', { class: 'muted tiny' }, 'Max contracts per order'), futMax),
            h('label', { class: 'wb-field' }, h('span', { class: 'muted tiny' }, 'Max contracts per day'), futDay),
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  try {
                    await save({ webullFuturesMaxContracts: Number(futMax.value), webullFuturesMaxPerDay: Number(futDay.value) });
                    toast('Futures limits saved');
                  } catch (err) {
                    toast((err as Error).message);
                  }
                },
              },
              'Save futures limits',
            ),
          ),
        ),
  );
}

/** A quick health check of the helper connection, shown at the top of Settings. */
function connectionCheck(): HTMLElement {
  const rows: [string, string, 'ok' | 'warn' | 'bad'][] = [];
  if (!helper.isConnected) {
    rows.push(['Schwab helper', 'Not running. Double-click start-windows.bat (or start-mac.command) in your helper folder.', 'bad']);
  } else {
    const v = helper.version ?? 0;
    const newest = helper.update ? Math.max(v, helper.update.latest ?? 0) : LATEST_HELPER_VERSION;
    const how = helper.update ? 'click Update now in the banner at the top' : 'download the project ZIP again to update';
    rows.push(['Schwab helper', `Running, version ${v}${v < newest ? ` (newest is ${newest}: ${how})` : ' (up to date)'}`, v < newest ? 'warn' : 'ok']);
    const st = helper.status;
    rows.push(['Schwab data', st.status === 'live' ? 'Streaming live prices' : st.message || st.status, st.status === 'live' ? 'ok' : st.status === 'error' ? 'bad' : 'warn']);
    for (const p of helper.problems) rows.push(['Feature unavailable', p, 'bad']);
    if (helper.logPath) rows.push(['Log file', helper.logPath, 'ok']);
  }
  return h(
    'div',
    { class: 'settings-row', id: 'settings-connection' },
    h('div', { class: 'settings-label' }, h('b', {}, 'Connection check')),
    ...rows.map(([label, text, tone]) => h('div', { class: `check-row ${tone}` }, h('span', { class: 'check-dot' }), h('b', {}, label), h('span', {}, text))),
    helper.problems.length ? h('p', { class: 'muted small' }, 'If something says unavailable, close the helper window and start it again. If that doesn’t help, send me the log file above.') : null,
  );
}

/** Send diagnostics: saves one masked file to upload in a Claude chat when something isn't working. */
function diagnosticsRow(): HTMLElement {
  return h(
    'div',
    { class: 'settings-row' },
    h('div', { class: 'settings-label' }, h('b', {}, 'Something not working?')),
    h('p', { class: 'muted small' }, 'Save a diagnostics file (recent errors, data sources, the helper log; keys and account numbers masked) and upload it in your Claude chat.'),
    h('div', { class: 'ap-controls' }, diagnosticsButton()),
  );
}

const DOCS = 'https://github.com/cadenb777-jpg/trading-platform/blob/main/';

/** About: the plain disclaimer and links to the legal drafts and licences. */
function aboutSection(): HTMLElement {
  const link = (label: string, path: string) => h('a', { href: DOCS + path, target: '_blank', rel: 'noopener' }, label);
  return h(
    'div',
    { class: 'settings-row' },
    h('h3', { class: 'settings-section' }, 'About'),
    h('p', { class: 'muted small' }, 'For the owner’s own use. Not investment advice. Market data may be delayed or wrong; check prices with your broker before trading.'),
    h(
      'p',
      { class: 'muted small' },
      link('Disclaimer', 'docs/legal/DISCLAIMER.md'), ' · ', link('Privacy', 'docs/legal/PRIVACY.md'), ' · ', link('Terms', 'docs/legal/TERMS.md'), ' · ',
      link('Licences', 'THIRD_PARTY_NOTICES.md'), ' · Charts by ', h('a', { href: 'https://www.tradingview.com/', target: '_blank', rel: 'noopener' }, 'TradingView Lightweight Charts™'),
    ),
  );
}

/** Appearance: light or dark (saved in this browser, works without the helper). */
function appearanceRow(): HTMLElement[] {
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' });
  const draw = () =>
    seg.replaceChildren(
      ...(['dark', 'light'] as ThemeName[]).map((t) =>
        h('button', { type: 'button', class: currentTheme() === t ? 'active' : '', 'aria-pressed': String(currentTheme() === t), onclick: () => (setTheme(t), draw()) }, t === 'dark' ? 'Dark' : 'Light'),
      ),
    );
  draw();
  return [h('h3', { class: 'settings-section' }, 'Appearance'), h('div', { class: 'settings-row' }, h('div', { class: 'settings-label' }, h('b', {}, 'Theme')), seg), ...chartRows()];
}

/** Chart: one switch for the decorative motion (saved in this browser). "Reduce motion" in the system turns it off. */
function chartRows(): HTMLElement[] {
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Chart effects' });
  const draw = () =>
    seg.replaceChildren(
      ...[true, false].map((on) =>
        h('button', { type: 'button', class: chartEffectsSetting() === on ? 'active' : '', 'aria-pressed': String(chartEffectsSetting() === on), onclick: () => (setChartEffects(on), draw()) }, on ? 'On' : 'Off'),
      ),
    );
  draw();
  return [
    h('h3', { class: 'settings-section' }, 'Chart'),
    h(
      'div',
      { class: 'settings-row' },
      h('div', { class: 'settings-label' }, h('b', {}, 'Chart effects'), h('span', { class: 'muted' }, ' Crosshair glow and selected-drawing glow.' + (reducedMotion() ? ' Off while your system asks for reduced motion.' : ''))),
      seg,
    ),
  ];
}

/** `focus`: 'ai' (the key box), 'alerts', 'connection' (the check at the top) or a section heading such as 'Trading'. */
/** The tab shown last (kept while the page is open). */
let lastTab = 'General';

/** Settings as tabs down the left (one section at a time, so the window stays short and orderly). */
function tabbed(groups: [string, Node[]][], want?: string): HTMLElement {
  const shown = groups.filter(([, nodes]) => nodes.length);
  let current = shown.find(([label]) => label === (want ?? lastTab))?.[0] ?? shown[0][0];
  const pane = h('div', { class: 'settings-pane', role: 'tabpanel' });
  const tabs = shown.map(([label]) => h('button', { type: 'button', class: 'settings-tab', role: 'tab', 'data-tab': label, onclick: () => show(label) }, label));
  function show(label: string) {
    current = lastTab = label;
    pane.replaceChildren(...(shown.find(([l]) => l === label)?.[1] ?? []));
    pane.scrollTop = 0;
    tabs.forEach((t) => {
      const on = t.dataset.tab === label;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
    });
  }
  show(current);
  return h('div', { class: 'settings-tabs' }, h('nav', { class: 'settings-nav', role: 'tablist', 'aria-label': 'Settings sections' }, ...tabs), pane);
}

/** Which tab an openSettings(focus) call means. */
function tabFor(focus?: string): string | undefined {
  if (!focus) return undefined;
  const f = focus.toLowerCase();
  // 'ai' is asked for when the Anthropic key is missing: its box is under Data connections
  if (f === 'data' || f === 'ai') return 'Data connections';
  if (f === 'ai-model') return 'AI';
  if (f === 'alerts') return 'Alerts';
  if (f === 'connection' || f === 'helper' || f === 'about') return 'Help';
  if (f === 'trading' || f === 'webull') return 'Trading';
  return 'General';
}

/** The market buddy's settings, as a section of General. */
function buddyBlock(): HTMLElement {
  return h('div', {}, h('h3', { class: 'settings-section' }, 'Market buddy'), h('div', { class: 'settings-row' }, buddySettings()));
}

export async function openSettings(focus?: string) {
  const body = h('div', { class: 'settings' }, h('div', { class: 'muted pad' }, 'Loading…'));
  const close = openModal('Settings', body, { wide: true });
  async function render() {
    let s: PlatformSettings;
    try {
      s = await getSettings(true);
    } catch (err) {
      body.replaceChildren(tabbed([['General', [...appearanceRow(), buddyBlock()]], ['Help', [connectionCheck(), h('div', { class: 'ap-error' }, `${(err as Error).message}`), diagnosticsRow(), aboutSection()]]], tabFor(focus)));
      return;
    }
    const model = h('select', { class: 'input' }, ...s.models.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.name)));
    model.addEventListener('change', async () => {
      await save({ model: model.value }).catch((err) => toast((err as Error).message));
      toast('AI model updated');
    });
    body.replaceChildren(
      tabbed(
        [
          ['General', [...appearanceRow(), buddyBlock(), h('h3', { class: 'settings-section' }, 'Helper'),
      (() => {
        const box = h('input', { type: 'checkbox', checked: s.openBrowser !== false });
        box.addEventListener('change', async () => {
          await save({ openBrowser: box.checked }).catch((err) => toast((err as Error).message));
          toast(box.checked ? 'The helper will open the platform when it starts' : 'The helper won’t open the browser');
        });
        return h(
          'div',
          { class: 'settings-row' },
          h('label', { class: 'check-item' }, box, h('b', {}, 'Open the platform in Chrome when the helper starts')),
          h('p', { class: 'muted small' }, 'Skipped automatically when the platform is already open in a tab. Uses your default browser if Chrome isn’t installed.'),
        );
      })(),
      ...(helper.update
        ? [(() => {
            const box = h('input', { type: 'checkbox', checked: !!s.autoUpdate });
            box.addEventListener('change', async () => {
              await save({ autoUpdate: box.checked }).catch((err) => toast((err as Error).message));
              toast(box.checked ? 'New helper versions will install by themselves' : 'The helper will ask before updating');
            });
            return h(
              'div',
              { class: 'settings-row' },
              h('label', { class: 'check-item' }, box, h('b', {}, 'Install updates automatically')),
              h('p', { class: 'muted small' }, 'On (recommended): the helper checks every 2 minutes and installs a new version by itself, waiting until nothing is loading and no order is waiting for your Confirm; the page reconnects and the bottom bar shows the new version. Off: you get an "Update now" button. Your settings and data are kept either way.'),
            );
          })()]
        : []),
          ]],
          ['Data connections', dataConnectionsSection(s, { save, refresh: render })],
          ['AI', [
            h('h3', { class: 'settings-section' }, 'AI assistant'),
            h('div', { class: 'settings-row' }, h('div', { class: 'settings-label' }, h('b', {}, 'AI model')), h('p', { class: 'muted small' }, 'Best gives the most thorough answers. Fast and low-cost is about 40× cheaper and fine for quick questions. The Anthropic key is under Data connections.'), model),
            ...(s.prospectSmtpCheck !== undefined && prospectContactsReady() ? [smtpCheckRow(s.prospectSmtpCheck, (on) => save({ prospectSmtpCheck: on }))] : []),
          ]],
          ['Alerts', s.ntfySet !== undefined ? [h('h3', { class: 'settings-section' }, 'Alerts'), alertsRow(s, render)] : []],
          ['Trading', [h('h3', { class: 'settings-section' }, 'Trading'), webullRow(s, render)]],
          ['Help', [
            connectionCheck(),
            diagnosticsRow(),
            h('p', { class: 'muted small' }, 'Everything here is saved by the helper in your user folder (.trading-platform), not in the browser or online.'),
            aboutSection(),
          ]],
        ],
        tabFor(focus),
      ),
    );
    if (focus === 'ai' && !s.aiKeySet) body.querySelector<HTMLInputElement>('[data-connection=ai] input')?.focus();
    if (focus === 'data') body.querySelector('#settings-data')?.scrollIntoView({ block: 'start' });
    if (focus === 'alerts') body.querySelector('#settings-alerts')?.scrollIntoView({ block: 'start' });
    else if (focus === 'connection') body.querySelector('#settings-connection')?.scrollIntoView({ block: 'start' });
    else if (focus && focus !== 'ai') [...body.querySelectorAll<HTMLElement>('h3.settings-section')].find((el) => el.textContent?.trim().toLowerCase() === focus.toLowerCase())?.scrollIntoView({ block: 'start' });
  }
  render();
  return close;
}
