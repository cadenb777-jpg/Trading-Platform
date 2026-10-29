/** The Settings window's switch for the optional mail-server (SMTP) check of guessed prospect emails (off by default). */
import { h, toast } from '../ui/dom';

export function smtpCheckRow(checked: boolean, save: (on: boolean) => Promise<unknown>): HTMLElement {
  const box = h('input', { type: 'checkbox', checked });
  box.addEventListener('change', async () => {
    try {
      await save(box.checked);
      toast(box.checked ? 'Mail-server check on: use "Check guesses with the mail server" on a firm\'s contacts' : 'Mail-server check off');
    } catch (err) {
      box.checked = !box.checked;
      toast((err as Error).message);
    }
  });
  return h(
    'div',
    { class: 'settings-row' },
    h('label', { class: 'check-item' }, box, h('b', {}, 'Prospecting: check guessed emails with the mail server')),
    h(
      'p',
      { class: 'muted small' },
      'Off by default. When on, the helper asks a firm\'s mail server (port 25) whether a guessed address exists, without sending anything. ' +
        'Many home internet providers block port 25, so it often can\'t connect; and "catch-all" servers accept every address, which makes the answer meaningless (the platform tests a random address first and says so). ' +
        'Even a "yes" is not the same as an address the firm published.',
    ),
  );
}
