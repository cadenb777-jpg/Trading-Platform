/**
 * The firm profile (shown in the Prospecting page's side drawer): identifiers with IAPD / EDGAR links, type with its
 * reasons and confidence, AUM history, client mix, people with titles and sources, private funds, the latest 13F
 * (weights, quarter-on-quarter changes, sector mix), Form D offerings, matched and possible records, notes and
 * outreach status (saved by the helper) and a first-call AI brief. Every fact says where it came from and when;
 * missing data says what is missing.
 */
import { insightButton } from '../ai/insight';
import { OUTREACH, prospectAdvPdf, prospectFirm, type ClientType, type Outreach, type ProspectNote, type ProspectPosition, type ProspectProfile } from '../data/prospect';
import { dataTable, statCards } from '../ui/charts';
import { h, toast } from '../ui/dom';
import { infoTip, termLabel } from '../ui/glossary';
import { tickerAttr } from '../ui/tickerCard';
import { columnChart, shareBar, shareList } from './charts';
import { CHANGE_TONE, CHANGE_WORDS, CLIENT_LABELS, confidenceLabel, confidenceTone, countText, dateText, moneyText, quarterText, TYPE_SHORT, TYPE_TERM, weightText } from './logic';

export interface ProfileContext {
  inCompare(id: string): boolean;
  toggleCompare(id: string, name: string): void;
  note(id: string): ProspectNote | null;
  saveNote(note: ProspectNote): Promise<void>;
  /** "People and private funds as of <date>" from prospect.status (the SEC bulk Form ADV data lags). */
  peopleNote: string | null;
}

const section = (title: string | Node, ...children: (Node | string | null | false)[]) => h('section', { class: 'pr-sec' }, h('h3', {}, title), ...children);
const srcLine = (text: string) => h('p', { class: 'pr-src' }, text);
const missing = (text: string) => h('p', { class: 'pr-missing' }, text);
const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text, ' ↗');

/** The type badge with its confidence word (and the glossary "i"). */
export function typeBadge(type: ProspectProfile['type'], confidence: string, withTip = true) {
  return h(
    'span',
    { class: 'pr-type' },
    h('span', { class: `badge pr-type-${TYPE_TERM[type] ?? 'x'}` }, TYPE_SHORT[type] ?? type),
    h('span', { class: `badge ${confidenceTone(confidence)}` }, confidenceLabel(confidence)),
    withTip ? infoTip(TYPE_TERM[type] ?? 'prConfidence') : null,
  );
}

function holdingName(p: ProspectPosition) {
  const name = p.issuer || p.cusip;
  return p.ticker
    ? h('span', { class: 'pr-hold' }, h('b', { ...tickerAttr(p.ticker), class: 'pr-ticker' }, p.ticker), ' ', h('span', { class: 'muted' }, name))
    : h('span', { class: 'pr-hold' }, h('span', {}, name), ' ', h('span', { class: 'muted small' }, p.cusip));
}

export function renderProfile(p: ProspectProfile, ctx: ProfileContext): HTMLElement {
  const filed = p.filingDate ? `Form ADV filed ${dateText(p.filingDate, true)}` : '';
  const crdLink = p.crd ? ext(`https://adviserinfo.sec.gov/firm/summary/${p.crd}`, `CRD ${p.crd}`) : null;
  const cikLink = p.cik ? ext(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${p.cik}`, `CIK ${p.cik}`) : null;
  const ids = h(
    'div',
    { class: 'pr-ids' },
    crdLink ?? h('span', { class: 'muted' }, 'No CRD (not in Form ADV)'),
    p.secNumber ? h('span', {}, `SEC # ${p.secNumber}`) : null,
    cikLink ?? h('span', { class: 'muted' }, 'No CIK (no 13F / Form D linked)'),
    p.website ? ext(/^https?:/i.test(p.website) ? p.website : `https://${p.website}`, p.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')) : null,
    p.phone ? h('a', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, p.phone) : null,
  );
  const address = [p.street, [p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' · ');

  // ----- header actions
  const compareBtn = h('button', { class: 'btn small', 'aria-pressed': String(ctx.inCompare(p.id)) }, ctx.inCompare(p.id) ? 'In compare ✓' : 'Add to compare');
  compareBtn.onclick = () => {
    ctx.toggleCompare(p.id, p.name);
    compareBtn.textContent = ctx.inCompare(p.id) ? 'In compare ✓' : 'Add to compare';
    compareBtn.setAttribute('aria-pressed', String(ctx.inCompare(p.id)));
  };
  const ai = insightButton(() => ({ topic: 'prospect', symbol: p.name, title: `First-call brief: ${p.name}`, data: briefData(p, ctx) }), 'AI summary');
  ai.button.title = 'Summarise this firm for a first call (uses only the filings below)';

  // ----- key facts
  const facts = statCards([
    { label: termLabel('Regulatory AUM', 'prAum'), value: moneyText(p.aumTotal), hint: p.aumTotal != null ? filed || 'Form ADV' : p.crd ? 'Not in the adviser list' : 'Not an SEC adviser (no Form ADV)' },
    { label: 'Discretionary', value: moneyText(p.aumDisc), hint: p.aumDisc != null ? 'Form ADV Item 5.F' : 'Not reported' },
    { label: 'Clients', value: countText(p.clientsTotal, 'Not reported'), hint: p.clientsTotal != null ? 'Form ADV Item 5.D' : '' },
    { label: 'Employees', value: countText(p.employees, 'Not reported'), hint: p.employees != null ? 'Form ADV Item 5.A' : '' },
    { label: termLabel('13F value', 'pr13f'), value: p.value13f != null ? moneyText(p.value13f) : p.has13f ? 'Notice only' : 'No 13F', hint: p.period13f ? `${quarterText(p.period13f)} 13F` : 'Files no 13F holdings' },
    { label: termLabel('Private funds', 'prGav'), value: p.funds ? `${p.funds} · ${moneyText(p.fundsGav, 'GAV n/r')}` : 'None', hint: p.funds ? `Schedule D 7.B.(1)${ctx.peopleNote ? ' (bulk data date below)' : ''}` : 'None in Form ADV data' },
  ]);

  // ----- why this type
  const why = section(
    h('span', {}, 'Why this type ', infoTip('prConfidence')),
    h('div', { class: 'pr-why' }, typeBadge(p.type, p.confidence), h('ul', {}, ...(p.reasons.length ? p.reasons : ['No reasons recorded']).map((r) => h('li', {}, r)))),
    p.type === 'Likely family office' || p.type === 'Multi-family office' ? srcLine('Family-office labels are educated guesses from names and the Form ADV client mix. Single-family offices are exempt from adviser registration, so many never appear in public data.') : null,
  );

  // ----- AUM history
  const hist = p.aumHistory.filter((r) => r.aum != null || r.clients != null);
  const aum = section(
    'Regulatory AUM over time',
    hist.length >= 2
      ? columnChart(
          hist.map((r) => ({ label: dateText(r.date), value: r.aum, tip: `${dateText(r.date)} adviser list: ${moneyText(r.aum)} AUM${r.clients != null ? `, ${countText(r.clients)} clients` : ''}${r.filed ? ` (Form ADV filed ${dateText(r.filed, true)})` : ''}` })),
          (v) => moneyText(v, '0').replace('.0M', 'M'),
          { name: `Regulatory AUM by monthly adviser list for ${p.name}` },
        )
      : null,
    hist.length >= 2
      ? srcLine(`Source: SEC monthly adviser lists (${hist.length} lists, ${dateText(hist[0].date)} to ${dateText(hist[hist.length - 1].date)}). Each list shows the AUM in the adviser's latest Form ADV at that time.`)
      : missing(p.crd ? 'Only one adviser list loaded so far: history builds up as monthly lists are downloaded.' : 'No Form ADV, so no AUM history (13F value is shown above instead).'),
  );

  // ----- client mix
  const mix = Object.entries(p.clientMix ?? {}) as [ClientType, { count: number | null; fewerThan5: boolean | null; aum: number | null }][];
  const totalClients = p.clientsTotal ?? mix.reduce((n, [, m]) => n + (m.count ?? 0), 0);
  const totalAum = mix.reduce((n, [, m]) => n + (m.aum ?? 0), 0) || p.aumTotal || 0;
  mix.sort((a, b) => (b[1].aum ?? 0) - (a[1].aum ?? 0) || (b[1].count ?? 0) - (a[1].count ?? 0));
  const clients = section(
    'Client mix',
    mix.length
      ? dataTable(
          ['Client type', 'Clients', 'Share of clients', 'AUM', 'Share of AUM'],
          mix.map(([k, m]) => [
            CLIENT_LABELS[k] ?? k,
            m.fewerThan5 ? 'fewer than 5' : countText(m.count),
            shareBar(totalClients && m.count != null ? m.count / totalClients : null, totalClients && m.count != null ? weightText(m.count / totalClients, 0) : '—', `${CLIENT_LABELS[k]}: share of client count`),
            moneyText(m.aum, '—'),
            shareBar(totalAum && m.aum != null ? m.aum / totalAum : null, totalAum && m.aum != null ? weightText(m.aum / totalAum, 0) : '—', `${CLIENT_LABELS[k]}: share of regulatory AUM`),
          ]),
          undefined,
          false,
        )
      : null,
    mix.length ? srcLine(`Source: Form ADV Item 5.D${p.filingDate ? `, filed ${dateText(p.filingDate, true)}` : ''}.`) : missing(p.crd ? 'The adviser list had no client breakdown for this firm (exempt advisers don\'t report it).' : 'No Form ADV, so no client mix.'),
  );

  // ----- people
  const people = section(
    h('span', {}, 'People in filings ', infoTip('prPeople')),
    p.people.length
      ? dataTable(
          ['Name', 'Title', 'Source', 'Filed', 'Ownership'],
          p.people.map((x) => [
            h('span', {}, x.name, x.keyTitle ? h('span', { class: 'badge accent pr-key-badge', title: 'CIO or portfolio manager title' }, 'Investment lead') : null),
            x.title || '—',
            x.source,
            dateText(x.filed, true),
            x.ownership || '—',
          ]),
          (i) => (p.people[i].keyTitle ? 'pr-key' : ''),
          { id: 'prospect:people' },
        )
      : null,
    p.people.length ? srcLine(`${ctx.peopleNote ?? 'People come from Form ADV Schedule A/B, 13F signatures and Form D related persons.'} Names and titles only: filings carry no emails or direct lines.`) : missing(`No people found. ${p.crd ? 'Download "Form ADV full data" in the Data panel for owners and officers.' : 'This firm files no Form ADV; only a 13F signer or Form D related persons would show here.'}`),
  );

  // ----- newer Form ADV from IAPD (the SEC bulk data ended Dec 2024)
  const pdf = p.advPdf;
  const newer = p.crd && p.type !== 'State-registered RIA' && p.filingDate && (!pdf?.bulkDate || p.filingDate > pdf.bulkDate);
  const pdfBox = h('div', { class: 'pr-adv-pdf small', 'data-adv-pdf': pdf?.status ?? 'none' });
  const drawPdf = (busy = false, msg = '') => {
    const read = pdf?.status === 'ok' && pdf.pdfDate && pdf.pdfDate >= (p.filingDate || '');
    pdfBox.replaceChildren(
      h(
        'p',
        { class: 'pr-src' },
        read
          ? `People and private funds read from the firm's Form ADV PDF on IAPD (filing of ${dateText(pdf!.pdfDate!, true)}).${pdf!.note ? ` Note: ${pdf!.note}.` : ''}`
          : pdf?.status === 'unreadable'
            ? `The firm's Form ADV PDF on IAPD couldn't be read (${pdf.note}). Open it from Sources below.`
            : newer
              ? `This firm filed Form ADV on ${dateText(p.filingDate, true)}, after the SEC bulk data${pdf?.bulkDate ? ` (${dateText(pdf.bulkDate, true)})` : ''}. Its newer owners, officers and funds are read from IAPD in the background${pdf?.status === 'failed' ? ` (last try failed: ${pdf.note})` : ''}.`
              : '',
        msg ? h('b', {}, ` ${msg}`) : null,
      ),
      newer && !read
        ? h('button', {
            class: 'btn small ghost',
            disabled: busy,
            onclick: async () => {
              drawPdf(true, 'Reading the PDF from IAPD…');
              try {
                const r = await prospectAdvPdf(p.id);
                if (r.status === 'ok') {
                  toast(`Read ${r.people ?? 0} people and ${r.funds ?? 0} private funds from IAPD`);
                  await loadProfile(pdfBox.closest<HTMLElement>('.pr-profile')?.parentElement ?? pdfBox, p.id, ctx);
                  return;
                }
                drawPdf(false, r.note);
              } catch (err) {
                drawPdf(false, (err as Error).message);
              }
            },
          }, 'Read the newest Form ADV from IAPD now')
        : '',
    );
  };
  drawPdf();
  people.append(pdfBox);

  // ----- private funds
  const funds = section(
    'Private funds',
    p.privateFunds.length
      ? dataTable(
          ['Fund', 'Type', 'Gross assets', 'Beneficial owners', 'Fund ID', 'Filed'],
          p.privateFunds.map((f) => [f.name, f.fundType || '—', moneyText(f.gav, 'Not reported'), countText(f.owners), f.fundId || '—', dateText(f.filed, true)]),
          undefined,
          { id: 'prospect:funds' },
        )
      : missing(p.crd ? 'No private funds in the Form ADV data loaded (Schedule D 7.B.(1)).' : 'No Form ADV, so no private-fund list.'),
    p.privateFunds.length
      ? srcLine(p.privateFunds.some((f) => f.source === 'iapd') ? 'Source: Form ADV Schedule D 7.B.(1), read from the firm\'s Form ADV PDF on IAPD (dates per fund).' : `Source: Form ADV Schedule D 7.B.(1). ${ctx.peopleNote ?? ''}`)
      : null,
  );

  // ----- 13F
  const th = p.holdings13f;
  let thSection: HTMLElement;
  if (!th.period || !th.positions) {
    thSection = section(
      '13F holdings',
      missing(
        th.reportedBy?.length
          ? `Files 13F notices only: its holdings are reported by ${th.reportedBy.join(', ')}.`
          : p.has13f
            ? 'Only a 13F notice (holdings reported by another manager) or no positions in the loaded quarters.'
            : 'No 13F: the firm holds under $100M in listed US securities, or its holdings are reported by another manager.',
      ),
    );
  } else {
    const positions = th.positions;
    let filter: string | null = null;
    let showAll = false;
    const tableBox = h('div', {});
    const counts = th.changes ?? {};
    const chips = h(
      'div',
      { class: 'chip-row', role: 'group', 'aria-label': 'Show positions by change' },
      ...['all', 'new', 'added', 'trimmed', 'exited', 'unchanged']
        .filter((k) => k === 'all' || counts[k])
        .map((k) => {
          const chip = h('button', { type: 'button', class: `chip${k === 'all' ? ' on' : ''}`, 'aria-pressed': String(k === 'all'), 'data-change': k }, k === 'all' ? `All ${countText(th.count ?? positions.length)}` : `${CHANGE_WORDS[k]} ${counts[k]}`);
          chip.onclick = () => {
            filter = k === 'all' ? null : k;
            chips.querySelectorAll('.chip').forEach((c) => (c.classList.toggle('on', c === chip), c.setAttribute('aria-pressed', String(c === chip))));
            drawTable();
          };
          return chip;
        }),
    );
    const drawTable = () => {
      const rows = positions.filter((x) => !filter || x.change === filter);
      const shown = showAll || filter ? rows : rows.slice(0, 15);
      const max = Math.max(...positions.map((x) => x.weight), 0.0001);
      tableBox.replaceChildren(
        dataTable(
          ['Holding', 'Class', 'Value', 'Weight', 'Change', 'Shares', 'Share change'],
          shown.map((x) => [
            holdingName(x),
            `${x.class || '—'}${x.putCall ? ` (${x.putCall})` : ''}`,
            { v: moneyText(x.change === 'exited' ? x.previousValue : x.value, '—'), cls: 'num' },
            shareBar(x.weight / max, weightText(x.weight), `Weight in the ${quarterText(th.period)} 13F`),
            x.change ? h('span', { class: `badge ${CHANGE_TONE[x.change] ?? ''}` }, CHANGE_WORDS[x.change] ?? x.change) : h('span', { class: 'muted small' }, 'No earlier quarter'),
            { v: countText(x.shares), cls: 'num' },
            { v: x.change && x.change !== 'new' && x.previousShares != null ? `${x.shareChange >= 0 ? '+' : '−'}${countText(Math.abs(x.shareChange))}` : '—', cls: 'num' },
          ]),
          undefined,
          { id: 'prospect:13f' },
        ),
        rows.length > shown.length ? h('button', { class: 'btn small ghost', onclick: () => ((showAll = true), drawTable()) }, `Show all ${rows.length} positions`) : '',
      );
    };
    drawTable();
    const sectors = Object.entries(th.sectors ?? {});
    thSection = section(
      h('span', {}, `13F holdings, ${quarterText(th.period)} `, infoTip('pr13f')),
      h(
        'p',
        { class: 'pr-lede' },
        `${moneyText(th.total)} across ${countText(th.count)} positions`,
        th.previousPeriod ? ` · compared with ${quarterText(th.previousPeriod)}` : ' · no earlier quarter loaded, so no changes yet',
        th.turnover != null ? h('span', {}, ' · turnover ', h('b', {}, weightText(th.turnover, 0)), infoTip('prTurnover')) : null,
      ),
      chips,
      h(
        'div',
        { class: 'pr-13f-grid' },
        tableBox,
        sectors.length
          ? h(
              'div',
              { class: 'pr-sectors' },
              h('h4', {}, 'Sector mix'),
              shareList(sectors.map(([s, w]) => ({ label: s, value: w / Math.max(...sectors.map(([, v]) => v)), text: weightText(w, 0), tip: `${s}: ${weightText(w)} of long stock value` })), 'Sector mix'),
              srcLine('Sectors from SEC industry (SIC) codes of the issuers matched to a ticker (up to 40 per firm); "Not mapped" is value without a match.'),
            )
          : null,
      ),
      th.otherManagers?.length ? srcLine(`Other managers included in this filing: ${th.otherManagers.map((m) => m.name).join(', ')}.`) : null,
      trend13f(th.history),
      srcLine(`Source: SEC Form 13F data set, quarter ended ${dateText(th.period, true)}. Values in dollars; changes by share count (1% tolerance). Shows long and option positions as filed; 13F covers listed US securities only (no cash, bonds, private assets or foreign shares).`),
    );
  }

  // ----- Form D
  const offerings = section(
    'Form D offerings',
    p.formDOfferings.length
      ? dataTable(
          ['Issuer', 'Fund type', 'Filed', 'Offering size', 'Sold', 'Investors', 'Minimum', ''],
          p.formDOfferings.map((o) => [
            o.name,
            o.fundType || '—',
            dateText(o.filed, true),
            moneyText(o.offering, 'Indefinite'),
            moneyText(o.sold, '—'),
            countText(o.investors),
            moneyText(o.minimum, '—'),
            ext(`https://www.sec.gov/Archives/edgar/data/${o.cik}/${o.accession.replace(/-/g, '')}/`, 'Filing'),
          ]),
          undefined,
          { id: 'prospect:formd' },
        )
      : missing('No Form D offerings linked (only offerings in the loaded Form D quarter are matched).'),
    p.formDOfferings.length ? srcLine('Source: SEC Form D data set. Linked by CIK or by a fund name that matches this adviser\'s private funds.') : null,
  );

  // ----- matches
  const linked = p.links.filter((l) => l.status === 'linked');
  const possible = p.links.filter((l) => l.status === 'possible');
  const matches = section(
    h('span', {}, 'Records joined into this firm ', infoTip('prMatch')),
    linked.length ? dataTable(['Source', 'Record', 'Name in that source', 'How matched', 'Score'], linked.map((l) => [l.source, l.sourceKey, l.name, l.method, l.score.toFixed(2)]), undefined, false) : missing('No linked records.'),
    possible.length
      ? h(
          'div',
          { class: 'pr-possible' },
          h('h4', {}, `Possible matches (${possible.length}), not merged`),
          dataTable(['Source', 'Record', 'Name in that source', 'Why it might match', 'Score'], possible.map((l) => [l.source, l.sourceKey, l.name, l.method, l.score.toFixed(2)]), undefined, false),
          srcLine('Similar name and place, but not close enough to treat as the same organization. Check before relying on them.'),
        )
      : null,
  );

  // ----- notes and outreach
  const saved = ctx.note(p.id);
  const status = h('select', { class: 'input', 'aria-label': 'Outreach status' }, ...OUTREACH.map((o) => h('option', { value: o, selected: (saved?.status ?? 'not contacted') === o }, o[0].toUpperCase() + o.slice(1))));
  const notes = h('textarea', { class: 'input pr-notes', rows: 4, placeholder: 'Notes for this firm (saved by the helper on your computer)', 'aria-label': 'Notes' });
  notes.value = saved?.notes ?? '';
  const savedAt = h('span', { class: 'muted small' }, saved?.updated ? `Saved ${new Date(saved.updated * 1000).toLocaleString('en-US')}` : '');
  const save = async () => {
    try {
      await ctx.saveNote({ id: p.id, firmName: p.name, status: status.value as Outreach, notes: notes.value });
      savedAt.textContent = `Saved ${new Date().toLocaleString('en-US')}`;
    } catch (err) {
      toast(`Couldn't save: ${(err as Error).message}`);
    }
  };
  status.onchange = save;
  const outreach = section('Notes and outreach', h('div', { class: 'pr-outreach' }, h('label', { class: 'field' }, h('span', { class: 'muted small' }, 'Status'), status), notes, h('div', { class: 'pr-inline' }, h('button', { class: 'btn small primary', onclick: save }, 'Save notes'), savedAt)));

  const sources = section('Sources', h('ul', { class: 'pr-links' }, ...p.sources.map((s) => h('li', {}, ext(s.url, s.label)))), srcLine('Public SEC and Census data only. Check IAPD for the latest filing before a meeting.'));

  return h(
    'article',
    { class: 'pr-profile' },
    h(
      'header',
      { class: 'pr-prof-head' },
      h('h2', { tabindex: -1 }, p.name),
      p.otherNames.length ? h('p', { class: 'muted small' }, `Also filed as: ${p.otherNames.slice(0, 4).join('; ')}`) : null,
      h('div', { class: 'pr-prof-meta' }, typeBadge(p.type, p.confidence), h('span', { class: 'muted' }, address || 'No address on file')),
      ids,
      h('div', { class: 'pr-prof-actions' }, compareBtn, ai.button),
    ),
    ai.panel,
    facts,
    why,
    outreach,
    aum,
    clients,
    people,
    thSection,
    funds,
    offerings,
    matches,
    sources,
  );
}

/** 13F total value by quarter (up to 8 quarters): the trend in listed securities. */
function trend13f(history: ProspectProfile['holdings13f']['history']) {
  const rows = (history ?? []).filter((x) => x.value != null);
  if (rows.length < 2) return null;
  return h(
    'div',
    { class: 'pr-13f-trend' },
    h('h4', {}, '13F value by quarter'),
    dataTable(['Quarter', '13F value', 'Positions'], rows.map((x) => [quarterText(x.period), { v: moneyText(x.value), cls: 'num' }, { v: countText(x.positions), cls: 'num' }]), undefined, { id: 'prospect:13f-trend' }),
    srcLine('Totals from each quarter\'s 13F filing (positions are kept for the latest 2 quarters only).'),
  );
}

/** What the AI brief gets: the profile without long tables (top 25 positions, 30 people). */
function briefData(p: ProspectProfile, ctx: ProfileContext) {
  const { positions, ...h13 } = p.holdings13f;
  return {
    ...p,
    people: p.people.slice(0, 30),
    holdings13f: { ...h13, topPositions: (positions ?? []).slice(0, 25).map((x) => ({ ticker: x.ticker, issuer: x.issuer, weight: x.weight, value: x.value, change: x.change })) },
    peopleDataAsOf: ctx.peopleNote,
  };
}

/** Loads a firm into `body`, with a skeleton first and the error spelled out. */
export async function loadProfile(body: HTMLElement, firmId: string, ctx: ProfileContext) {
  body.replaceChildren(h('div', { class: 'skeleton', style: 'height:120px' }), h('div', { class: 'skeleton', style: 'height:240px;margin-top:12px' }));
  try {
    const p = await prospectFirm(firmId);
    body.replaceChildren(renderProfile(p, ctx));
    body.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return p;
  } catch (err) {
    body.replaceChildren(h('div', { class: 'ap-error' }, (err as Error).message));
    return null;
  }
}

