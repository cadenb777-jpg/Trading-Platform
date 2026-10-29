/**
 * The Prospecting page's Review tab: everything the website crawler, the AI analyst and the change watcher found
 * waits here as "pending" until the owner approves or rejects it. Approved items show on the profile as "Reviewed by
 * you on <date>"; rejected ones are hidden and stay rejected on the next crawl. Also: the change watcher's status and
 * the do-not-contact export of every crawled contact.
 */
import { h, toast } from '../ui/dom';
import { saveText } from './compare';
import { contactsError, contactsExport, reviewDecide, reviewList, watchRun, watchStatus, type FactStatus, type ReviewItem } from './contactsApi';

const KIND_LABEL: Record<ReviewItem['kind'], string> = { person: 'Person', email: 'Email', phone: 'Phone', focus: 'Focus', ai: 'AI fact', change: 'Change' };
const ORIGIN_LABEL: Record<ReviewItem['origin'], string> = { website: 'Website', ai: 'AI analyst', watch: 'Watcher' };

export function createReviewView(openFirm: (firmId: string) => void) {
  const el = h('div', { class: 'pc-review-view' });
  let status: FactStatus = 'pending';
  let items: ReviewItem[] = [];
  const picked = new Set<number>();

  async function draw() {
    el.replaceChildren(h('div', { class: 'skeleton', style: 'height:160px' }));
    let counts: Record<FactStatus, number> = { pending: 0, approved: 0, rejected: 0 };
    try {
      const r = await reviewList(status);
      items = r.items;
      counts = r.counts;
    } catch (err) {
      el.replaceChildren(h('p', { class: 'ap-error' }, contactsError(err)));
      return;
    }
    picked.clear();
    const tabs = h(
      'div',
      { class: 'chip-row', role: 'group', 'aria-label': 'Show items' },
      ...(['pending', 'approved', 'rejected'] as FactStatus[]).map((s) =>
        h('button', { type: 'button', class: `chip${s === status ? ' on' : ''}`, 'aria-pressed': String(s === status), onclick: () => ((status = s), draw()) }, `${s[0].toUpperCase()}${s.slice(1)} ${counts[s] ?? 0}`),
      ),
    );
    const decide = async (decision: 'approve' | 'reject' | 'undo', fids: number[]) => {
      if (!fids.length) return toast('Tick at least one item');
      try {
        await reviewDecide(fids, decision);
        toast(`${fids.length} item${fids.length === 1 ? '' : 's'} ${decision === 'undo' ? 'back to pending' : decision === 'approve' ? 'approved' : 'rejected'}`);
        draw();
      } catch (err) {
        toast(contactsError(err));
      }
    };
    const all = h('input', { type: 'checkbox', 'aria-label': 'Select all' });
    all.onchange = () => {
      el.querySelectorAll<HTMLInputElement>('input[data-fid]').forEach((box) => {
        box.checked = all.checked;
        const fid = Number(box.dataset.fid);
        if (all.checked) picked.add(fid);
        else picked.delete(fid);
      });
    };
    const actions =
      status === 'pending'
        ? [h('button', { class: 'btn small primary', onclick: () => decide('approve', [...picked]) }, 'Approve selected'), h('button', { class: 'btn small', onclick: () => decide('reject', [...picked]) }, 'Reject selected')]
        : [h('button', { class: 'btn small', onclick: () => decide('undo', [...picked]) }, 'Back to pending')];
    const table = items.length
      ? h(
          'table',
          { class: 'data-table pc-review-table' },
          h('thead', {}, h('tr', {}, h('th', {}, all), h('th', {}, 'Firm'), h('th', {}, 'What'), h('th', {}, 'Found by'), h('th', {}, 'Source'), h('th', {}, status === 'pending' ? 'Found' : 'Decided'), h('th', {}, ''))),
          h(
            'tbody',
            {},
            ...items.map((it) => {
              const box = h('input', { type: 'checkbox', 'data-fid': String(it.fid), 'aria-label': `Select: ${it.summary}` });
              box.onchange = () => (box.checked ? picked.add(it.fid) : picked.delete(it.fid));
              return h(
                'tr',
                {},
                h('td', {}, box),
                h('td', {}, h('button', { class: 'link-btn', onclick: () => openFirm(it.firmId) }, it.firmName)),
                h('td', {}, h('span', { class: 'badge pc-label' }, KIND_LABEL[it.kind] ?? it.kind), ' ', it.summary),
                h('td', { class: 'small' }, ORIGIN_LABEL[it.origin] ?? it.origin),
                h('td', { class: 'small' }, it.sourceUrl ? h('a', { href: it.sourceUrl, target: '_blank', rel: 'noopener' }, 'Open ↗') : '—'),
                h('td', { class: 'small' }, (status === 'pending' ? it.foundAt : it.decidedOn) ?? '—'),
                h(
                  'td',
                  { class: 'pc-row-actions' },
                  ...(status === 'pending'
                    ? [h('button', { class: 'btn small ghost', title: 'Approve', 'aria-label': 'Approve', onclick: () => decide('approve', [it.fid]) }, '✓'), h('button', { class: 'btn small ghost', title: 'Reject', 'aria-label': 'Reject', onclick: () => decide('reject', [it.fid]) }, '✕')]
                    : [h('button', { class: 'btn small ghost', onclick: () => decide('undo', [it.fid]) }, 'Undo')]),
                ),
              );
            }),
          ),
        )
      : h('div', { class: 'empty-state' }, status === 'pending' ? 'Nothing to review. Open a firm and press "Find contacts", or star firms to watch them.' : `No ${status} items.`);
    el.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Review'), h('span', { class: 'muted small' }, 'Website, AI and watcher findings wait here. Approved items show on the profile as "Reviewed by you on <date>".')),
        h('div', { class: 'pr-inline' }, tabs, ...actions),
        h('div', { class: 'table-wrap' }, table),
      ),
      await watchPanel(),
    );
  }

  async function watchPanel() {
    const box = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Change watcher')));
    try {
      const w = await watchStatus();
      const runBtn = h('button', { class: 'btn small', disabled: w.running }, w.running ? 'Checking…' : 'Check all now');
      runBtn.onclick = async () => {
        runBtn.disabled = true;
        try {
          await watchRun();
          toast('The watcher is checking in the background; new changes arrive here.');
        } catch (err) {
          toast(contactsError(err));
        }
      };
      const exportBtn = h('button', { class: 'btn small ghost' }, 'Export all contacts (CSV)');
      exportBtn.onclick = async () => {
        try {
          const r = await contactsExport();
          saveText(`prospect-contacts-${new Date().toISOString().slice(0, 10)}.csv`, r.csv);
          toast(`${r.rows} rows${r.skippedFirms || r.skippedEmails ? `; left out (do not contact): ${r.skippedFirms} firms, ${r.skippedEmails} emails` : ''}`);
        } catch (err) {
          toast(contactsError(err));
        }
      };
      box.append(
        h('p', { class: 'small' }, `Every ${w.everyDays} days the watcher re-checks starred and saved firms (up to ${w.max}): SEC facts (AUM, new filings, people in filings) and their websites (new people, title changes, page changes). Last run: ${w.lastRun ?? 'never'}; next: ${w.nextRun ?? '—'}.`),
        w.error ? h('p', { class: 'pr-warn' }, w.error) : '',
        h('div', { class: 'pr-inline' }, runBtn, exportBtn),
        w.firms.length
          ? h('ul', { class: 'pc-watch small' }, ...w.firms.map((f) => h('li', {}, h('button', { class: 'link-btn', onclick: () => openFirm(f.firmId) }, f.name), f.starred ? ' ★' : ' (saved)', ` · ${f.lastRun ? `checked ${f.lastRun}` : 'not checked yet'}${f.note ? ` · ${f.note}` : ''}`)))
          : h('p', { class: 'muted small' }, 'No firms watched yet: use "Watch for changes" on a profile, or save a note on a firm.'),
        h('p', { class: 'pr-src' }, 'The CSV keeps each email\'s label (published / pattern / guess / catch-all) and leaves out do-not-contact firms and addresses.'),
      );
    } catch (err) {
      box.append(h('p', { class: 'ap-error' }, contactsError(err)));
    }
    return box;
  }

  return { el, show: draw };
}
