/**
 * The platform's self-check in the status bar (helper engine/selfcheck.py, every 30 minutes): a dot and "Self-check"
 * when everything passed, "Self-check: 2 problems" in amber otherwise. Clicking lists every check by area (security,
 * data, accuracy, speed) with its plain-language result, and can run the checks again now. Read-only: it never
 * changes anything.
 */
import { engineRequest, helper } from '../data/schwab';
import { h, openPopover } from './dom';

/** The helper version with the self-check (engine/selfcheck.py). */
export const SELFCHECK_HELPER_VERSION = 53;

export interface Check {
  id: string;
  area: 'security' | 'data' | 'accuracy' | 'speed';
  ok: boolean | null;
  detail: string;
}
export interface SelfCheckRun {
  at: number;
  ok: boolean;
  problems: number;
  checked: number;
  checks: Check[];
}

const AREAS: Check['area'][] = ['security', 'data', 'accuracy', 'speed'];
const AREA_LABEL: Record<Check['area'], string> = { security: 'Security', data: 'Data', accuracy: 'Accuracy', speed: 'Speed' };

/** The status bar's words and dot for a run (pure, tested). */
export function selfCheckLabel(run: SelfCheckRun | null): { text: string; state: 'ok' | 'stale' | 'idle' } {
  if (!run) return { text: 'Self-check', state: 'idle' };
  if (run.problems) return { text: `Self-check: ${run.problems} problem${run.problems === 1 ? '' : 's'}`, state: 'stale' };
  return { text: 'Self-check', state: 'ok' };
}

export const selfCheckReady = () => !helper.tooOld && (helper.version ?? 0) >= SELFCHECK_HELPER_VERSION;

export function selfCheckItem(): HTMLElement {
  let run: SelfCheckRun | null = null;
  const btn = h('button', { type: 'button', class: 'sb-item sb-selfcheck', title: 'The platform checks its own security, data, maths and speed every 30 minutes: open the results' }) as HTMLButtonElement;
  const draw = () => {
    btn.hidden = !helper.isConnected || !selfCheckReady();
    const l = selfCheckLabel(run);
    btn.replaceChildren(h('span', { class: 'sb-dot', 'data-state': l.state, 'aria-hidden': 'true' }), h('span', {}, l.text));
  };
  const load = (fresh = false) =>
    selfCheckReady() && helper.isConnected
      ? engineRequest<SelfCheckRun>(fresh ? 'selfcheck.run' : 'selfcheck.latest', {}, 120000).then((r) => ((run = r), draw()), () => undefined)
      : Promise.resolve();

  const list = (box: HTMLElement) => {
    if (!run) return box.replaceChildren(h('p', { class: 'muted small' }, 'No results yet: the first check runs a minute after the helper starts.'));
    const when = new Date(run.at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    box.replaceChildren(
      h('p', { class: 'muted small' }, `Last checked ${when}: ${run.checked} checks, ${run.problems ? `${run.problems} need attention` : 'all passed'}.`),
      ...AREAS.map((area) => {
        const rows = run!.checks.filter((c) => c.area === area);
        if (!rows.length) return '';
        return h(
          'section',
          { class: 'sc-area' },
          h('h4', {}, AREA_LABEL[area]),
          ...rows.map((c) =>
            h('div', { class: 'sc-row' }, h('span', { class: 'sb-dot', 'data-state': c.ok === null ? 'idle' : c.ok ? 'ok' : 'error', 'aria-hidden': 'true' }), h('span', {}, c.detail)),
          ),
        );
      }),
    );
  };
  btn.addEventListener('click', () => {
    const box = h('div', { class: 'sc-list' });
    list(box);
    const again = h('button', { class: 'btn small' }, 'Check again now') as HTMLButtonElement;
    again.addEventListener('click', () => {
      again.disabled = true;
      again.textContent = 'Checking…';
      void load(true).then(() => (list(box), (again.disabled = false), (again.textContent = 'Check again now')));
    });
    openPopover(btn, h('div', { class: 'sc-pop' }, h('h3', {}, 'Self-check'), box, again), { label: 'Self-check results' });
  });
  helper.onAvailability(() => (draw(), void load()));
  setInterval(() => void load(), 5 * 60 * 1000);
  draw();
  void load();
  return btn;
}
