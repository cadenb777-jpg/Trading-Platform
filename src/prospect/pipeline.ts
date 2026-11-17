/**
 * Prospects → Pipeline: every firm the owner has given an outreach status, as a board of columns (Contacted, Meeting,
 * Client; "Not contacted" holds firms with notes but no outreach yet; "Do not contact" is folded at the end). Each card
 * is the firm's name, its last update and the first line of its notes; ← → move it a stage (saved by the helper, like
 * the status picker in the firm profile) and clicking it opens the firm. Counts sit in each column head.
 */
import { OUTREACH, type Outreach, type ProspectNote } from '../data/prospect';
import { h } from '../ui/dom';

export const STAGES: Outreach[] = ['not contacted', 'contacted', 'meeting', 'client'];
const LABEL: Record<Outreach, string> = { 'not contacted': 'Not contacted', contacted: 'Contacted', meeting: 'Meeting', client: 'Client', 'do not contact': 'Do not contact' };

/** Notes grouped by stage, newest first (pure, tested). */
export function pipelineColumns(notes: ProspectNote[]): Record<Outreach, ProspectNote[]> {
  const out = Object.fromEntries(OUTREACH.map((o) => [o, [] as ProspectNote[]])) as Record<Outreach, ProspectNote[]>;
  for (const n of notes) (out[n.status] ?? out['not contacted']).push(n);
  for (const o of OUTREACH) out[o].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  return out;
}

/** The stage a card moves to with ← or → (null at either end; "do not contact" doesn't move). */
export function nextStage(status: Outreach, dir: 1 | -1): Outreach | null {
  const i = STAGES.indexOf(status);
  if (i < 0) return null;
  return STAGES[i + dir] ?? null;
}

const when = (t?: number) => (t ? new Date(t * (t < 1e12 ? 1000 : 1)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

export function pipelineBoard(o: { notes: ProspectNote[]; open: (id: string) => void; save: (n: ProspectNote) => Promise<void> }): HTMLElement {
  const cols = pipelineColumns(o.notes);
  const card = (n: ProspectNote) => {
    const move = (dir: 1 | -1) => {
      const to = nextStage(n.status, dir);
      if (to) void o.save({ ...n, status: to });
    };
    const firstLine = (n.notes ?? '').split('\n').find((l) => l.trim()) ?? '';
    return h(
      'article',
      { class: 'pl-card', tabindex: 0, role: 'button', title: `${n.firmName}: open the firm`, onclick: () => o.open(n.id), onkeydown: (e: Event) => void ((e as KeyboardEvent).key === 'Enter' && o.open(n.id)) },
      h('b', { class: 'pl-name' }, n.firmName),
      firstLine ? h('span', { class: 'pl-note' }, firstLine) : '',
      h(
        'div',
        { class: 'pl-foot' },
        h('span', { class: 'pl-date' }, when(n.updated)),
        n.status !== 'do not contact'
          ? h(
              'span',
              { class: 'pl-move' },
              h('button', { type: 'button', class: 'icon-btn', title: 'Move back a stage', 'aria-label': `Move ${n.firmName} back`, disabled: !nextStage(n.status, -1), onclick: (e: Event) => (e.stopPropagation(), move(-1)) }, '←'),
              h('button', { type: 'button', class: 'icon-btn', title: 'Move on a stage', 'aria-label': `Move ${n.firmName} on`, disabled: !nextStage(n.status, 1), onclick: (e: Event) => (e.stopPropagation(), move(1)) }, '→'),
            )
          : '',
      ),
    );
  };
  const column = (s: Outreach) =>
    h(
      'section',
      { class: `pl-col pl-${s.replace(/ /g, '-')}`, 'aria-label': LABEL[s] },
      h('div', { class: 'pl-col-head' }, h('span', {}, LABEL[s]), h('b', {}, String(cols[s].length))),
      ...(cols[s].length ? cols[s].map(card) : [h('p', { class: 'pl-empty' }, s === 'not contacted' ? 'Firms you add notes to land here.' : '—')]),
    );
  const total = o.notes.length;
  return h(
    'div',
    { class: 'pl' },
    total
      ? h('div', { class: 'pl-board' }, ...STAGES.map(column))
      : h('p', { class: 'muted' }, 'No firms in your pipeline yet. Open a firm (Advisers or Companies) and set its outreach status to start one.'),
    cols['do not contact'].length ? h('details', { class: 'pl-dnc' }, h('summary', {}, `Do not contact (${cols['do not contact'].length})`), h('div', { class: 'pl-dnc-list' }, ...cols['do not contact'].map(card))) : '',
  );
}
