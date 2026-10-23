/**
 * Settings: the AI key and model, the SEC email and an optional FRED key. Values go straight to the helper,
 * which saves them on this computer; keys are never stored in the browser or shown again.
 */
import { engineRequest } from '../data/schwab';
import { h, openModal, toast } from './dom';

export interface PlatformSettings {
  aiKeySet: boolean;
  fredKeySet: boolean;
  secContact: string;
  model: string;
  models: { id: string; name: string }[];
}

let cached: PlatformSettings | null = null;
const listeners = new Set<(s: PlatformSettings) => void>();

export async function getSettings(force = false): Promise<PlatformSettings> {
  if (!cached || force) cached = await engineRequest<PlatformSettings>('settings.get', {}, 10000);
  return cached;
}

export function onSettingsChange(fn: (s: PlatformSettings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function save(changes: Record<string, string>) {
  cached = await engineRequest<PlatformSettings>('settings.set', changes, 10000);
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

export async function openSettings(focus?: 'ai') {
  const body = h('div', { class: 'settings' }, h('div', { class: 'muted pad' }, 'Loading…'));
  const close = openModal('Settings', body, { wide: true });
  async function render() {
    let s: PlatformSettings;
    try {
      s = await getSettings(true);
    } catch (err) {
      body.replaceChildren(h('div', { class: 'ap-error' }, `${(err as Error).message}. Settings are saved by the helper, so start it first.`));
      return;
    }
    const model = h('select', { class: 'input' }, ...s.models.map((m) => h('option', { value: m.id, selected: m.id === s.model }, m.name)));
    model.addEventListener('change', async () => {
      await save({ model: model.value }).catch((err) => toast((err as Error).message));
      toast('AI model updated');
    });
    const email = h('input', { class: 'input', type: 'email', value: s.secContact, placeholder: 'you@example.com' });
    body.replaceChildren(
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
      h('p', { class: 'muted small' }, 'Everything here is saved by the helper in your user folder (.trading-platform), not in the browser or online.'),
    );
    if (focus === 'ai' && !s.aiKeySet) body.querySelector<HTMLInputElement>('input[type=password]')?.focus();
  }
  render();
  return close;
}
