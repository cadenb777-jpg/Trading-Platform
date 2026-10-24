/**
 * Settings: the AI key and model, the SEC email, an optional FRED key and optional Alpaca keys (free price history). Values go straight to the helper,
 * which saves them on this computer; keys are never stored in the browser or shown again.
 */
import { LATEST_HELPER_VERSION, engineRequest, helper, setAlpacaConnected } from '../data/schwab';
import { h, openModal, toast } from './dom';

export interface PlatformSettings {
  aiKeySet: boolean;
  fredKeySet: boolean;
  /** Both Alpaca keys are saved (missing from helpers without Alpaca support; the keys themselves are never sent back). */
  alpacaSet?: boolean;
  secContact: string;
  model: string;
  models: { id: string; name: string }[];
  /** Open the platform in Chrome when the helper finishes starting (helper version 9+). */
  openBrowser?: boolean;
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

async function save(changes: Record<string, string | boolean>) {
  cached = await engineRequest<PlatformSettings>('settings.set', changes, 10000);
  setAlpacaConnected(!!cached.alpacaSet);
  for (const fn of listeners) fn(cached);
  return cached;
}

function keyRow(label: string, help: Node, isSet: boolean, field: 'aiKey' | 'fredKey', placeholder: string, refresh: () => void) {
  const input = h('input', { class: 'input', type: 'password', placeholder: isSet ? 'Saved ✓ (paste a new key to replace it)' : placeholder, autocomplete: 'off', spellcheck: false });
  const status = h('span', { class: `key-status ${isSet ? 'ok' : ''}` }, isSet ? '● Connected' : '○ Not set');
  return h(
    'div',
    { class: 'settings-row' },
    h('div', { class: 'settings-label' }, h('b', {}, label), status),
    help,
    h(
      'div',
      { class: 'ap-controls' },
      input,
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            if (!input.value.trim()) return toast('Paste the key first');
            try {
              await save({ [field]: input.value.trim() });
              toast('Saved');
              refresh();
            } catch (err) {
              toast((err as Error).message);
            }
          },
        },
        'Save',
      ),
      isSet
        ? h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                await save({ [field]: '' }).catch((err) => toast((err as Error).message));
                refresh();
              },
            },
            'Remove',
          )
        : null,
    ),
  );
}

interface AlpacaStatus {
  ok: boolean;
  keysSet: boolean;
  message: string;
  earliest: string | null;
}

/** Alpaca: free price history back to 2016 (market data only, never trading). Key ID + secret, saved together. */
function alpacaRow(isSet: boolean, refresh: () => void): HTMLElement {
  const keyId = h('input', { class: 'input', type: 'password', placeholder: isSet ? 'Saved ✓ (paste a new key ID to replace it)' : 'API key ID', autocomplete: 'off', spellcheck: false });
  const secret = h('input', { class: 'input', type: 'password', placeholder: isSet ? 'Saved ✓ (paste a new secret to replace it)' : 'Secret key', autocomplete: 'off', spellcheck: false });
  const status = h('span', { class: `key-status ${isSet ? 'ok' : ''}` }, isSet ? '● Saved' : '○ Not set');
  const result = h('p', { class: 'muted small' });
  const test = async () => {
    result.textContent = 'Testing…';
    try {
      const r = await engineRequest<AlpacaStatus>('alpaca.status', {}, 20000);
      result.textContent = r.ok ? `✓ ${r.message}${r.earliest ? ` (earliest bar found: ${r.earliest})` : ''}` : `✗ ${r.message}`;
    } catch (err) {
      const message = (err as Error).message;
      result.textContent = /doesn.t know|latest helper/i.test(message) ? 'Your helper is too old for Alpaca: download the project ZIP again to update it.' : `✗ ${message}`;
    }
  };
  return h(
    'div',
    { class: 'settings-row' },
    h('div', { class: 'settings-label' }, h('b', {}, 'Alpaca (free history, optional)'), status),
    h(
      'p',
      { class: 'muted small' },
      'Free account at alpaca.markets; used only for intraday price history back to 2016, so charts (30-minute and hourly, about 3 years), the Setups scanner's hourly time frame (about 3 years of 30-minute bars) and the AI assistant can look further back than Schwab keeps. Never used for trading. Get the two keys at ',
      h('a', { href: 'https://app.alpaca.markets/dashboard/overview', target: '_blank', rel: 'noopener' }, 'app.alpaca.markets'),
      ' (sign up, then on the Home page find "API Keys" and click Generate New Keys; copy both before closing).',
    ),
    h('div', { class: 'ap-controls' }, keyId),
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
            if (keyId.value.trim()) changes.alpacaKeyId = keyId.value.trim();
            if (secret.value.trim()) changes.alpacaSecret = secret.value.trim();
            if (!isSet && !(changes.alpacaKeyId && changes.alpacaSecret)) return toast('Paste both the key ID and the secret');
            if (!Object.keys(changes).length) return toast('Paste the new key first');
            try {
              const s = await save(changes);
              if (s.alpacaSet === undefined) return toast('Your helper is too old for Alpaca: download the project ZIP again to update it.');
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
                await save({ alpacaKeyId: '', alpacaSecret: '' }).catch((err) => toast((err as Error).message));
                refresh();
              },
            },
            'Remove',
          )
        : null,
    ),
    result,
  );
}

/** A quick health check of the helper connection, shown at the top of Settings. */
function connectionCheck(): HTMLElement {
  const rows: [string, string, 'ok' | 'warn' | 'bad'][] = [];
  if (!helper.isConnected) {
    rows.push(['Schwab helper', 'Not running. Double-click start-windows.bat (or start-mac.command) in your helper folder.', 'bad']);
  } else {
    const v = helper.version ?? 0;
    rows.push(['Schwab helper', `Running, version ${v}${v < LATEST_HELPER_VERSION ? ` (newest is ${LATEST_HELPER_VERSION}: download the project ZIP again to update)` : ' (up to date)'}`, v < LATEST_HELPER_VERSION ? 'warn' : 'ok']);
    const st = helper.status;
    rows.push(['Schwab data', st.status === 'live' ? 'Streaming live prices' : st.message || st.status, st.status === 'live' ? 'ok' : st.status === 'error' ? 'bad' : 'warn']);
    for (const p of helper.problems) rows.push(['Feature unavailable', p, 'bad']);
    if (helper.logPath) rows.push(['Log file', helper.logPath, 'ok']);
  }
  return h(
    'div',
    { class: 'settings-row' },
    h('div', { class: 'settings-label' }, h('b', {}, 'Connection check')),
    ...rows.map(([label, text, tone]) => h('div', { class: `check-row ${tone}` }, h('span', { class: 'check-dot' }), h('b', {}, label), h('span', {}, text))),
    helper.problems.length ? h('p', { class: 'muted small' }, 'If something says unavailable, close the helper window and start it again. If that doesn’t help, send me the log file above.') : null,
  );
}

export async function openSettings(focus?: 'ai') {
  const body = h('div', { class: 'settings' }, h('div', { class: 'muted pad' }, 'Loading…'));
  const close = openModal('Settings', body, { wide: true });
  async function render() {
    let s: PlatformSettings;
    try {
      s = await getSettings(true);
    } catch (err) {
      body.replaceChildren(connectionCheck(), h('div', { class: 'ap-error' }, `${(err as Error).message}`));
      return;
    }
    const model = h('select', { class: 'input' }, ...s.models.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.name)));
    model.addEventListener('change', async () => {
      await save({ model: model.value }).catch((err) => toast((err as Error).message));
      toast('AI model updated');
    });
    const email = h('input', { class: 'input', type: 'email', value: s.secContact, placeholder: 'you@example.com' });
    body.replaceChildren(
      connectionCheck(),
      h('h3', { class: 'settings-section' }, 'AI assistant'),
      keyRow(
        'Anthropic API key',
        h(
          'p',
          { class: 'muted small' },
          'Powers the AI assistant and AI analysis buttons. Get a key at ',
          h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'),
          ' (sign up, add a little credit under Billing, then Create Key). Typical personal use costs a few dollars a month; the low-cost model costs much less.',
        ),
        s.aiKeySet,
        'aiKey',
        'sk-ant-…',
        render,
      ),
      h('div', { class: 'settings-row' }, h('div', { class: 'settings-label' }, h('b', {}, 'AI model')), h('p', { class: 'muted small' }, 'Best gives the most thorough answers. Fast and low-cost is about 40× cheaper and fine for quick questions.'), model),
      h('h3', { class: 'settings-section' }, 'Data sources'),
      h(
        'div',
        { class: 'settings-row' },
        h('div', { class: 'settings-label' }, h('b', {}, 'SEC email'), h('span', { class: `key-status ${s.secContact ? 'ok' : ''}` }, s.secContact ? '● Set' : '○ Not set')),
        h('p', { class: 'muted small' }, 'The SEC requires a contact email for downloading company financials and insider trades. It is only sent to sec.gov.'),
        h(
          'div',
          { class: 'ap-controls' },
          email,
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                try {
                  await save({ secContact: email.value.trim() });
                  toast('Saved');
                  render();
                } catch (err) {
                  toast((err as Error).message);
                }
              },
            },
            'Save',
          ),
        ),
      ),
      keyRow(
        'FRED API key (optional)',
        h(
          'p',
          { class: 'muted small' },
          'The Macro page works without it. A free key makes economic data load faster and more reliably: ',
          h('a', { href: 'https://fredaccount.stlouisfed.org/apikeys', target: '_blank', rel: 'noopener' }, 'get one here'),
          ' (free account, takes a minute).',
        ),
        s.fredKeySet,
        'fredKey',
        '32 letters and numbers',
        render,
      ),
      alpacaRow(!!s.alpacaSet, render),
      h('h3', { class: 'settings-section' }, 'Helper'),
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
      h('p', { class: 'muted small' }, 'Everything here is saved by the helper in your user folder (.trading-platform), not in the browser or online.'),
    );
    if (focus === 'ai' && !s.aiKeySet) body.querySelector<HTMLInputElement>('input[type=password]')?.focus();
  }
  render();
  return close;
}
