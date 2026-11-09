/**
 * "Log in to Schwab": when Schwab refuses the saved login, the helper opens Schwab's login page on this computer and
 * uses the new login as soon as you approve it (no restart). This is the button and the notice at the top.
 */
import { helper } from '../data/schwab';
import { h, toast } from './dom';

/** The button: opens the Schwab login page and waits until you've approved it there. */
export function schwabLoginButton(cls = 'btn small primary'): HTMLButtonElement {
  const btn = h('button', { class: cls, type: 'button' }, 'Log in to Schwab') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Waiting for you in the Schwab page…';
    try {
      await helper.loginToSchwab();
      toast('Logged in to Schwab: live prices are back');
    } catch (err) {
      toast((err as Error).message || 'The Schwab login wasn’t finished. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log in to Schwab';
    }
  });
  return btn;
}

/** The notice under the top bar while Schwab needs a login (hidden otherwise). */
export function schwabLoginNotice(): HTMLElement {
  const el = h('div', { class: 'update-banner login-banner', role: 'status', hidden: true });
  const draw = () => {
    el.hidden = !helper.isConnected || !helper.needsSchwabLogin;
    if (el.hidden) return;
    el.replaceChildren(
      h('span', {}, h('b', {}, 'Schwab needs you to log in again. '), 'Live prices and charts are paused until you do. The login page opens on this computer; log in and approve, and prices come back by themselves.'),
      schwabLoginButton(),
    );
  };
  helper.onStatusChange(draw);
  helper.onAvailability(draw);
  return el;
}
