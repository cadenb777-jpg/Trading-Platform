/**
 * Check for updates (Settings → Connection check): updates install by themselves, and this button is for when
 * something seems wrong. It asks the helper to look now (git pull for a copy made with git, the GitHub download
 * otherwise) and says in plain words what happened and, when it failed, how to fix it.
 */
import { CHECK_UPDATES_HELPER_VERSION, helper, type UpdateCheck } from '../data/schwab';
import { h } from './dom';

/** What an old helper (before the button existed) needs: one manual update, then updates are automatic again. */
export function oldHelperSteps(version: number): string {
  return `Your helper is version ${version}, older than this button. One manual update fixes it for good: quit Trading Terminal completely (right-click its icon by the clock, then Quit), open PowerShell in your platform folder and run  git pull , then open Trading Terminal again. If your folder isn’t a git copy, download the project ZIP from GitHub again instead.`;
}

/** The result in plain words, with its tone. */
export function checkWords(r: UpdateCheck): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!r.ok) return { text: [r.message, r.fix].filter(Boolean).join(' Fix: '), tone: 'bad' };
  return { text: r.message, tone: r.restarting || r.changed ? 'warn' : 'ok' };
}

/** The last automatic git check's problem, when it has one (shown before anyone clicks). */
export function autoProblem(): string | null {
  const git = helper.update?.git;
  return git?.reason ? `The last automatic update didn’t work: ${git.reason}${git.fix ? ` Fix: ${git.fix}` : ''}` : null;
}

export function updateCheckRow(): HTMLElement {
  const result = h('p', { class: 'muted small update-check-result', role: 'status' });
  const problem = autoProblem();
  if (problem) {
    result.textContent = problem;
    result.dataset.tone = 'bad';
  }
  const btn = h('button', { class: 'btn small', type: 'button' }, 'Check for updates') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    const v = helper.version ?? 0;
    if (v < CHECK_UPDATES_HELPER_VERSION) {
      result.textContent = oldHelperSteps(v);
      result.dataset.tone = 'bad';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Checking…';
    result.textContent = 'Looking at GitHub for a newer version…';
    delete result.dataset.tone;
    try {
      const words = checkWords(await helper.checkForUpdates());
      result.textContent = words.text;
      result.dataset.tone = words.tone;
    } catch (err) {
      const msg = (err as Error).message;
      result.textContent = /doesn.t know/i.test(msg) ? oldHelperSteps(v) : `The check didn’t finish: ${msg}`;
      result.dataset.tone = 'bad';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check for updates';
    }
  });
  const how = helper.update?.mode === 'git' ? 'Your folder is a copy made with git: updates come from git pull every 10 minutes.' : 'Updates install by themselves at a quiet moment.';
  return h('div', { class: 'ap-controls update-check' }, btn, h('span', { class: 'muted small' }, `${how} Use this if the version looks wrong.`), result);
}
