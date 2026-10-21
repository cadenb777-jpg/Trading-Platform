import { loadAlpacaKeys, saveAlpacaKeys } from '../storage';
import { h, openModal, toast } from './dom';

export function openSettings(onSaved: () => void) {
  const keys = loadAlpacaKeys();
  const keyInput = h('input', { id: 'alpaca-key', class: 'input', autocomplete: 'off', spellcheck: false, value: keys?.key ?? '', placeholder: 'PK...' });
  const secretInput = h('input', { id: 'alpaca-secret', class: 'input', type: 'password', autocomplete: 'off', value: keys?.secret ?? '' });

  const save = () => {
    const key = keyInput.value.trim();
    const secret = secretInput.value.trim();
    if (!key || !secret) {
      toast('Enter both the key and the secret');
      return;
    }
    saveAlpacaKeys({ key, secret });
    toast('Alpaca keys saved');
    close();
    onSaved();
  };
  const clear = () => {
    saveAlpacaKeys(null);
    keyInput.value = '';
    secretInput.value = '';
    toast('Alpaca keys removed');
  };

  const body = h(
    'div',
    { class: 'form' },
    h('div', { class: 'form-section' }, 'Stock data (Alpaca, free)'),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'Sign up free at ', h('a', { href: 'https://alpaca.markets', target: '_blank', rel: 'noopener' }, 'alpaca.markets'), '.'),
      h('li', {}, 'In the dashboard, switch to your ', h('b', {}, 'Paper'), ' account.'),
      h('li', {}, 'Find ', h('b', {}, 'API Keys'), ' on the right side and click ', h('b', {}, 'Generate New Keys'), '.'),
      h('li', {}, 'Paste the Key and Secret below.'),
    ),
    h('label', { class: 'form-row', for: 'alpaca-key' }, h('span', {}, 'API Key'), keyInput),
    h('label', { class: 'form-row', for: 'alpaca-secret' }, h('span', {}, 'Secret'), secretInput),
    h('p', { class: 'muted small' }, 'Your keys are saved only in this browser and are sent only to Alpaca. Never share them or put them in your code.'),
    h(
      'div',
      { class: 'modal-actions' },
      keys ? h('button', { class: 'btn danger', onclick: clear }, 'Remove keys') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
    ),
  );
  const close = openModal('Settings', body);
}
