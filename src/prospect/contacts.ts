/**
 * The "Contacts" section of a firm profile: people from the firm's own website (and filings) with their email label
 * chips and source links, main / direct phone lines, investment focus, the AI analyst (cost shown first), recent
 * changes from the watcher, the do-not-contact toggles and the watch star. Everything found waits in the Review tab;
 * approved items say "Reviewed by you on <date>".
 */
import { h, toast } from '../ui/dom';
import { openSettings } from '../ui/settings';
import { saveText } from './compare';
import {
  aiEstimate,
  aiProfile,
  checkEmails,
  contactsError,
  contactsExport,
  crawlFirm,
  estimateText,
  getContacts,
  LABEL_HELP,
  labelTone,
  optOutSet,
  reviewText,
  watchRun,
  watchSet,
  type ContactEmail,
  type ContactPhone,
  type ContactsView,
} from './contactsApi';

const ext = (href: string | null | undefined, text: string) => (href ? h('a', { href, target: '_blank', rel: 'noopener' }, text, ' ↗') : h('span', { class: 'muted' }, text));
const srcLine = (text: string) => h('p', { class: 'pr-src' }, text);
const host = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).pathname.replace(/\/$/, '') || '/' : '';
  } catch {
    return url ?? '';
  }
};

function reviewChip(f: { status?: string; reviewedOn?: string | null }) {
  const text = reviewText(f as { status?: 'pending' | 'approved' | 'rejected'; reviewedOn?: string | null });
  return h('span', { class: `pc-review ${f.status === 'approved' ? 'ok' : ''}` }, text);
}

function emailCell(e: ContactEmail | null, onOptOut: (email: string, on: boolean) => void) {
  if (!e) return h('span', { class: 'muted small' }, 'No email (no website domain yet)');
  const off = !!e.doNotContact;
  const toggle = h('button', { class: 'btn small ghost', title: off ? 'Remove from the do-not-contact list' : 'Never email this address (left out of exports)', onclick: () => onOptOut(e.email, !off) }, off ? 'Allow' : 'Do not contact');
  return h(
    'div',
    { class: 'pc-email' },
    off ? h('s', { class: 'muted' }, e.email) : e.label === 'published' ? h('a', { href: `mailto:${e.email}` }, e.email) : h('span', {}, e.email),
    ' ',
    h('span', { class: `badge ${labelTone(e.label)} pc-label`, title: e.note || LABEL_HELP[e.label] }, e.label),
    off ? h('span', { class: 'badge down pc-label' }, 'do not contact') : null,
    e.label === 'published' && e.sourceUrl ? h('span', { class: 'small' }, ' ', ext(e.sourceUrl, `on ${host(e.sourceUrl)}`)) : null,
    toggle,
  );
}

function phoneText(p: ContactPhone) {
  return h('span', { class: 'pc-phone' }, h('a', { href: `tel:${p.number.replace(/[^\d+]/g, '')}` }, p.number), ' ', h('span', { class: 'badge pc-label' }, p.kind === 'direct' ? 'direct line' : 'main line'));
}

export function contactsSection(firmId: string): HTMLElement {
  const body = h('div', { class: 'pc-body' }, h('div', { class: 'skeleton', style: 'height:80px' }));
  const el = h('section', { class: 'pr-sec pc-sec', 'aria-label': 'Contacts' }, h('h3', {}, 'Contacts from the firm\'s website'), body);
  let view: ContactsView | null = null;

  const load = async () => {
    try {
      view = await getContacts(firmId);
      draw();
    } catch (err) {
      body.replaceChildren(h('p', { class: 'ap-error' }, contactsError(err)));
    }
  };

  const optOutEmail = async (email: string, on: boolean) => {
    try {
      await optOutSet({ email }, on);
      toast(on ? `${email}: do not contact` : `${email}: allowed again`);
      await load();
    } catch (err) {
      toast(contactsError(err));
    }
  };

  function draw() {
    const v = view!;
    const progress = h('p', { class: 'muted small pc-progress', 'aria-live': 'polite' });
    const siteBox = h('input', { class: 'input', type: 'url', placeholder: 'https://firm-website.com', value: v.website ?? '', 'aria-label': 'Firm website' });
    const crawlBtn = h('button', { class: 'btn small primary' }, v.crawl ? 'Read the website again' : 'Find contacts');
    crawlBtn.onclick = async () => {
      crawlBtn.disabled = true;
      progress.textContent = 'Reading robots.txt first…';
      try {
        const typed = siteBox.value.trim();
        view = await crawlFirm(firmId, typed && typed !== v.website ? typed : undefined, (e) => (progress.textContent = e.text));
        const c = view.lastCrawl;
        toast(c ? `Read ${c.pages} page${c.pages === 1 ? '' : 's'}: ${c.counts.new ?? 0} new, ${c.counts.changed ?? 0} changed (see the Review tab)` : 'Done');
        draw();
      } catch (err) {
        progress.textContent = contactsError(err);
        crawlBtn.disabled = false;
      }
    };
    const star = h('button', { class: 'btn small', 'aria-pressed': String(v.watched), title: 'Re-check this firm every week (website and SEC facts)' }, v.watched ? '★ Watching' : '☆ Watch for changes');
    star.onclick = async () => {
      try {
        await watchSet(firmId, !v.watched);
        v.watched = !v.watched;
        star.textContent = v.watched ? '★ Watching' : '☆ Watch for changes';
        star.setAttribute('aria-pressed', String(v.watched));
      } catch (err) {
        toast(contactsError(err));
      }
    };
    const checkNow = h('button', { class: 'btn small ghost', title: 'Re-check SEC facts and re-read the website now' }, 'Check for changes now');
    checkNow.onclick = async () => {
      checkNow.disabled = true;
      try {
        const r = await watchRun(firmId, (e) => (progress.textContent = e.text));
        toast(r.note ?? 'Checked');
        await load();
      } catch (err) {
        progress.textContent = contactsError(err);
        checkNow.disabled = false;
      }
    };
    const firmOff = h('input', { type: 'checkbox', checked: v.optOut.firm });
    firmOff.onchange = async () => {
      try {
        await optOutSet({ firmId }, firmOff.checked);
        toast(firmOff.checked ? 'This firm is on the do-not-contact list' : 'Removed from the do-not-contact list');
        await load();
      } catch (err) {
        firmOff.checked = !firmOff.checked;
        toast(contactsError(err));
      }
    };
    const exportBtn = h('button', { class: 'btn small ghost', disabled: v.optOut.firm }, 'Export contacts (CSV)');
    exportBtn.onclick = async () => {
      try {
        const r = await contactsExport([firmId]);
        saveText(`contacts-${v.firmName.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}.csv`, r.csv);
      } catch (err) {
        toast(contactsError(err));
      }
    };

    const controls = h(
      'div',
      { class: 'pc-controls' },
      h('div', { class: 'pr-inline' }, siteBox, crawlBtn, star, checkNow),
      h(
        'div',
        { class: 'pr-inline' },
        h('label', { class: 'check-item' }, firmOff, h('span', {}, 'Do not contact this firm')),
        v.optOut.byNote ? h('span', { class: 'muted small' }, '(outreach status says "do not contact")') : null,
        exportBtn,
      ),
      progress,
    );

    const parts: (Node | null)[] = [controls];
    if (v.optOut.firm) parts.push(h('p', { class: 'pr-warn' }, 'Do not contact: this firm is left out of contact and firm exports. Its details stay here for reference.'));
    if (!v.crawl) {
      parts.push(
        h(
          'p',
          { class: 'pr-missing' },
          v.website
            ? `Not read yet. "Find contacts" reads up to 10 pages of ${v.website} (home, team, about, contact), obeying robots.txt, one page a second.`
            : 'Form ADV lists no website for this firm. Type it above to read it.',
        ),
      );
    } else {
      parts.push(
        srcLine(`Read ${v.crawl.at ?? ''}: ${v.crawl.pages} page${v.crawl.pages === 1 ? '' : 's'} of ${v.website ?? ''}${v.crawl.note ? `. ${v.crawl.note}` : ''}${v.lastWatch ? ` · last change check ${v.lastWatch}` : ''}`),
      );
      if (v.crawl.skipped.length) {
        parts.push(h('details', { class: 'pc-skipped' }, h('summary', { class: 'small muted' }, `${v.crawl.skipped.length} page(s) skipped`), h('ul', { class: 'small' }, ...v.crawl.skipped.map((s) => h('li', {}, `${s.url}: ${s.reason}`)))));
      }
    }

    // people
    if (v.people.length || v.filingPeople.length) {
      const rows = [
        ...v.people.map((p) =>
          h(
            'li',
            { class: 'pc-person' },
            h('div', { class: 'pc-person-head' }, h('b', {}, p.name), p.title ? h('span', { class: 'muted' }, ` · ${p.title}`) : null, p.previousTitle ? h('span', { class: 'badge warn pc-label' }, `was: ${p.previousTitle}`) : null, p.note ? h('span', { class: 'badge accent pc-label' }, 'new') : null),
            p.bio ? h('p', { class: 'pc-bio small' }, p.bio) : null,
            emailCell(p.email, optOutEmail),
            p.phones.length ? h('div', {}, ...p.phones.map(phoneText)) : null,
            h('div', { class: 'pc-meta small' }, ext(p.sourceUrl, `Source: ${host(p.sourceUrl)}`), ` · found ${p.foundAt ?? ''} · `, reviewChip(p)),
          ),
        ),
        ...v.filingPeople.map((p) =>
          h(
            'li',
            { class: 'pc-person' },
            h('div', { class: 'pc-person-head' }, h('b', {}, p.name), p.title ? h('span', { class: 'muted' }, ` · ${p.title}`) : null),
            emailCell(p.email, optOutEmail),
            h('div', { class: 'pc-meta small' }, `Source: ${p.source}${p.filed ? `, filed ${p.filed}` : ''} (not on the website)`),
          ),
        ),
      ];
      parts.push(h('h4', {}, `People (${v.people.length} on the website${v.filingPeople.length ? `, ${v.filingPeople.length} more from filings` : ''})`), h('ul', { class: 'pc-people' }, ...rows));
    }
    // email pattern and checks
    const d = v.domainCheck;
    parts.push(
      srcLine(
        [
          v.pattern ? `Email pattern: ${v.pattern.pattern} (from ${v.pattern.matched} published address${v.pattern.matched === 1 ? '' : 'es'}: ${v.pattern.examples.join(', ')}).` : v.domain ? 'No published personal address yet, so the pattern is unknown: guesses use first.last.' : '',
          d ? (d.mxOk ? `${v.domain} receives email (MX checked ${d.mxCheckedOn}).` : d.mxOk === false ? `${v.domain} has no mail servers.` : '') : '',
          d?.catchAll ? 'The mail server accepts any address (catch-all).' : '',
          d?.smtpNote && !d.catchAll ? d.smtpNote : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
    );
    if (v.smtpCheck && v.domain) {
      const chk = h('button', { class: 'btn small ghost' }, 'Check guesses with the mail server');
      chk.onclick = async () => {
        chk.disabled = true;
        try {
          view = await checkEmails(firmId);
          toast(view && 'lastCheck' in view ? (view as { lastCheck: { note: string; checked: number } }).lastCheck.note || `Checked ${(view as { lastCheck: { checked: number } }).lastCheck.checked}` : 'Checked');
          draw();
        } catch (err) {
          toast(contactsError(err));
          chk.disabled = false;
        }
      };
      parts.push(chk);
    } else if (v.domain) {
      parts.push(h('p', { class: 'pr-src' }, 'Mail-server check is off (Settings > Data sources). ', h('button', { class: 'btn small ghost', onclick: () => openSettings('Data sources') }, 'Settings')));
    }
    // general addresses and phones
    if (v.generalEmails.length || v.phones.length) {
      parts.push(
        h('h4', {}, 'Firm lines and addresses'),
        h(
          'ul',
          { class: 'pc-general' },
          ...v.phones.map((p) => h('li', {}, phoneText(p), ' ', h('span', { class: 'small' }, p.source === 'Form ADV' ? ext(p.sourceUrl, 'Form ADV') : ext(p.sourceUrl, `website ${host(p.sourceUrl)}`)), p.alsoOn ? h('span', { class: 'muted small' }, ' (also on the website)') : null)),
          ...v.generalEmails.map((e) => h('li', {}, emailCell(e, optOutEmail))),
        ),
      );
    }
    // focus
    if (v.focus) {
      parts.push(
        h('h4', {}, 'Investment focus (from the website)'),
        h('div', { class: 'chip-row' }, ...v.focus.tags.map((t) => h('a', { class: 'chip', href: t.url, target: '_blank', rel: 'noopener', title: `Mentioned on ${t.url}` }, t.tag))),
        ...v.focus.sentences.map((s) => h('blockquote', { class: 'pc-quote small' }, `“${s.text}” `, ext(s.url, host(s.url)))),
        h('div', { class: 'pc-meta small' }, reviewChip(v.focus)),
      );
    }
    // AI analyst
    const aiBox = h('div', { class: 'pc-ai' });
    const aiBtn = h('button', { class: 'btn small', disabled: !v.pagesSaved }, 'AI research profile');
    const aiCost = h('span', { class: 'muted small' }, v.pagesSaved ? 'Working out the cost…' : 'Read the website first');
    if (v.pagesSaved) {
      aiEstimate(firmId)
        .then((e) => {
          aiCost.textContent = e.aiKeySet ? `${estimateText(e)} with ${e.model}` : 'Needs your Anthropic key (Settings)';
          aiBtn.disabled = !e.aiKeySet;
        })
        .catch((err) => (aiCost.textContent = contactsError(err)));
    }
    aiBtn.onclick = async () => {
      aiBtn.disabled = true;
      try {
        const r = await aiProfile(firmId, (e) => (aiCost.textContent = e.text));
        toast(`${r.kept.length} cited facts saved for review${r.dropped.length ? `; ${r.dropped.length} without a matching source dropped` : ''}`);
        await load();
      } catch (err) {
        aiCost.textContent = contactsError(err);
        aiBtn.disabled = false;
      }
    };
    aiBox.append(h('div', { class: 'pr-inline' }, aiBtn, aiCost));
    if (v.aiFacts.length) {
      aiBox.append(
        h(
          'ul',
          { class: 'pc-ai-facts' },
          ...v.aiFacts.map((f) => h('li', {}, h('span', { class: 'badge pc-label' }, f.topic), ' ', f.text, ' ', h('span', { class: 'small' }, ext(f.sourceUrl, host(f.sourceUrl) || 'source')), ' ', reviewChip(f))),
        ),
      );
    }
    aiBox.append(srcLine('Drafted by Claude from the saved pages and SEC facts only. Each fact must quote its source; facts whose quote is not in that source are dropped. Review before use.'));
    parts.push(h('h4', {}, 'AI research analyst'), aiBox);
    // changes
    if (v.changes.length) {
      parts.push(h('h4', {}, 'Changes seen'), h('ul', { class: 'pc-changes small' }, ...v.changes.map((c) => h('li', {}, `${c.date ?? c.foundAt ?? ''}: ${c.summary} `, ext(c.sourceUrl, 'source'), ' ', reviewChip(c)))));
    }
    parts.push(srcLine('Only the firm\'s own public pages and SEC filings. Not used, on purpose: LinkedIn scraping, bought or leaked lists, people-search sites, personal cell numbers.'));
    body.replaceChildren(...parts.filter((x): x is Node => !!x));
  }

  load();
  return el;
}
