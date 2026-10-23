/**
 * Alternatives: how the alternatives market is doing (listed managers, BDCs, REITs, hedge-fund style funds),
 * a directory of evergreen private funds with live SEC data for each, a search of every private fund that
 * has filed a Form D, the newest private funds raising money, and a tracker for your own alternatives
 * (e.g. from iCapital), saved by the helper on this computer.
 */
import { openAssistant } from '../ai/hub';
import { FUND_SNAPSHOTS, SNAPSHOTS_RESEARCHED, type FundSnapshot } from './fundSnapshots';
import { insightButton } from '../ai/insight';
import { engineRequest } from '../data/schwab';
import { barList, createLineChart, dataTable, money, pct, statCards } from '../ui/charts';
import { formatPrice, h, openModal, toast } from '../ui/dom';
import { BOARDS, MANAGER_SITES, PRIVATE_FUNDS, STRATEGIES, STRUCTURES, type PrivateFund, type Strategy } from './catalog';
import { holdingStats, parseCsv, rowsToHoldings, totals, type AltHolding } from './holdings';
import { boardInsight, boardTable, errorBox, factSheetLink, loadBoard, openSymbolDetail, skeletonBoard, tone, type BoardRow, type InvestContext } from './shared';

type Tab = 'market' | 'funds' | 'search' | 'latest' | 'mine';
const TABS: [Tab, string][] = [
  ['market', 'Alts market'],
  ['funds', 'Private fund directory'],
  ['search', 'Search all private funds'],
  ['latest', 'New funds raising money'],
  ['mine', 'My alternatives'],
];

interface Fact {
  end: string;
  start?: string | null;
  value: number;
  filed: string;
}

interface FundData {
  cik: number;
  secName: string;
  entityType: string;
  category: string;
  sic: string;
  website: string;
  state: string;
  formerNames: string[];
  filings: { form: string; filed: string; reportDate: string; description: string; url: string }[];
  formDCount: number;
  errors: Record<string, string>;
  facts?: { navPerShare: Fact[]; netAssets: Fact[]; investments: Fact[]; totalAssets: Fact[]; totalReturn: Fact[]; distributions: Fact[] } | null;
  nport?: {
    name: string;
    date: string;
    netAssets: number | null;
    totalAssets: number | null;
    returns: { classId: string; months: (number | null)[] }[];
    holdingsCount: number;
    topHoldings: { name: string; title: string; value: number | null; pct: number | null; category: string }[];
    mix: { label: string; pct: number }[];
    filed: string;
    url: string;
  } | null;
  formD?: FormD | null;
  navNotes?: { text: string; form: string; filed: string; url: string }[] | null;
  schwab?: BoardRow[] | null;
}

interface FormD {
  name: string;
  entityType: string;
  city: string;
  state: string;
  yearOfInc: string;
  industry: string;
  fundType: string;
  sizeRange: string;
  exemptions: string[];
  firstSale: string;
  minimum: number | null;
  offering: number | null;
  offeringText: string;
  sold: number | null;
  remaining: number | null;
  investors: number | null;
  nonAccredited: boolean;
  people: { name: string; roles: string[] }[];
  placementAgents: string[];
  filed?: string;
  url?: string;
}

interface PrivateHit {
  cik: number;
  name: string;
  filed: string;
  form?: string;
  location?: string;
  fundType?: string;
  sold?: number | null;
  offering?: number | null;
  offeringText?: string;
  minimum?: number | null;
  investors?: number | null;
  state?: string;
  amendment?: boolean;
}

const EXEMPTIONS: Record<string, string> = {
  '3C': 'Investment Company Act section 3(c) (private fund)',
  '3C.1': 'Section 3(c)(1): up to 100 accredited investors',
  '3C.7': 'Section 3(c)(7): qualified purchasers only ($5M+ in investments)',
  '06b': 'Rule 506(b): no public advertising',
  '06c': 'Rule 506(c): may advertise; investors must be verified as accredited',
  '04': 'Rule 504',
};

const usd = (v: number | null | undefined) => (v == null ? '—' : money(v));
const avg = (values: (number | null | undefined)[]) => {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const secLink = (cik: number) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`;

export function createAltsView(ctx: InvestContext) {
  let tab: Tab = 'market';
  let strategy: Strategy | 'All' = 'All';
  let fundFilter = '';
  let searchQuery = '';
  let holdings: AltHolding[] = [];
  const body = h('div', { class: 'inv-sub' });
  const tabs = h('div', { class: 'tabs inv-tabs', role: 'tablist' }, ...TABS.map(([t, label]) => h('button', { class: `tab${t === tab ? ' active' : ''}`, 'data-tab': t, onclick: () => setTab(t) }, label)));
  const el = h('div', { class: 'inv-section' }, tabs, body);

  function setTab(t: Tab) {
    tab = t;
    tabs.hidden = false;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  function render() {
    tabs.hidden = false;
    if (tab === 'market') return renderMarket();
    if (tab === 'funds') return renderDirectory();
    if (tab === 'search') return renderSearch();
    if (tab === 'latest') return renderLatest();
    return renderMine();
  }

  // ----- Alts market -----

  function renderMarket() {
    const groups = BOARDS.alts;
    const pulse = h('div', { class: 'skeleton', style: 'height:96px' });
    const boards = h('div', { class: 'inv-boards' }, ...groups.map(skeletonBoard));
    const ai = boardInsight('Alternatives', groups);
    body.replaceChildren(
      ai.row,
      ai.panel,
      h('p', { class: 'muted inv-lead' }, 'Private funds don\'t trade, so the alternatives market is read through what does: the managers\' stocks, listed private credit (BDCs), REITs and hedge-fund style ETFs. Open the Private fund directory for the funds themselves.'),
      pulse,
      boards,
    );
    loadBoard(groups)
      .then((rows) => {
        ai.setRows(rows);
        pulse.classList.remove('skeleton');
        pulse.replaceChildren(
          statCards(
            groups.map((g) => {
              const r = g.symbols.map(([s]) => rows.get(s));
              const today = avg(r.map((x) => x?.change));
              const ytd = avg(r.map((x) => x?.ytd));
              return { label: g.title.replace(' (listed)', '').replace(' (listed BDCs)', ''), value: pct(today), tone: tone(today), hint: `Average today · YTD ${pct(ytd, 1)}` };
            }),
          ),
        );
        boards.replaceChildren(...groups.map((g) => boardTable(g, rows, (s, l) => openSymbolDetail(s, l, rows.get(s), ctx))));
      })
      .catch((err) => {
        pulse.replaceChildren(errorBox(err, renderMarket));
        boards.replaceChildren();
      });
  }

  // ----- Directory -----

  function renderDirectory() {
    const grid = h('div', { class: 'fund-grid' });
    const filterInput = h('input', { class: 'input', placeholder: 'Filter: name, manager, BDC, REIT…', value: fundFilter, style: 'width:260px' });
    const chips = h(
      'div',
      { class: 'chip-row' },
      ...(['All', ...STRATEGIES] as (Strategy | 'All')[]).map((s) => h('button', { class: `chip${s === strategy ? ' on' : ''}`, onclick: () => ((strategy = s), renderDirectory()) }, s)),
    );
    const draw = () => {
      const q = fundFilter.toLowerCase();
      const list = PRIVATE_FUNDS.filter((f) => (strategy === 'All' || f.strategy === strategy) && (!q || `${f.name} ${f.short} ${f.manager} ${f.structure}`.toLowerCase().includes(q)));
      grid.replaceChildren(
        ...list.map((f) =>
          h(
            'button',
            { class: 'fund-card', onclick: () => openFund(f) },
            h('span', { class: 'fund-card-top' }, h('b', {}, f.short), h('span', { class: 'fund-badge' }, f.structure)),
            h('span', { class: 'fund-card-name' }, f.name),
            h('span', { class: 'muted small' }, `${f.manager} · ${f.strategy}`),
          ),
        ),
        list.length ? '' : h('p', { class: 'muted' }, 'No funds match. Try "Search all private funds" to search every fund filed with the SEC.'),
      );
    };
    filterInput.addEventListener('input', () => ((fundFilter = filterInput.value), draw()));
    draw();
    body.replaceChildren(
      h('div', { class: 'ap-controls inv-filter' }, chips, filterInput),
      grid,
      h('p', { class: 'muted small' }, 'Well-known evergreen funds sold through advisors and platforms like iCapital. Each one opens with its latest NAV, holdings, returns and filings straight from the SEC. Not a recommendation.'),
    );
  }

  // ----- Fund detail -----

  async function openFund(f: PrivateFund | { cik: number; name: string }) {
    const catalog = 'id' in f ? f : PRIVATE_FUNDS.find((p) => p.name.toLowerCase() === f.name.toLowerCase());
    const title = catalog ? `${catalog.short} · ${catalog.name}` : f.name;
    tabs.hidden = true;
    const back = h('button', { class: 'btn', onclick: () => render() }, '← Back');
    const content = h('div', { class: 'fund-detail' }, h('div', { class: 'skeleton', style: 'height:120px' }), h('div', { class: 'skeleton', style: 'height:260px' }));
    body.replaceChildren(
      h('div', { class: 'fund-head' }, back, h('div', {}, h('h2', {}, title), h('p', { class: 'muted' }, catalog ? `${catalog.manager} · ${catalog.strategy} · ${catalog.structure}` : 'Private fund (SEC Form D filer)'))),
      content,
    );
    body.scrollIntoView({ block: 'start' });
    const params: Record<string, unknown> = 'cik' in f ? { cik: f.cik, name: f.name } : { name: f.name, ticker: catalog?.ticker };
    try {
      const data = await engineRequest<FundData>('alts.fund', params, 90000);
      if (!content.isConnected) return;
      content.replaceChildren(...fundSections(data, catalog, 'cik' in f ? f.name : f.name));
    } catch (err) {
      if (content.isConnected) content.replaceChildren(errorBox(err, () => openFund(f)), catalog ? aboutPanel(catalog) : '');
    }
  }

  function aboutPanel(f: PrivateFund) {
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, `How it works: ${f.structure}`)), h('p', { class: 'muted' }, STRUCTURES[f.structure]));
  }

  function snapshotPanel(snap: FundSnapshot): Node {
    return h(
      'section',
      { class: 'panel fund-snapshot' },
      h(
        'div',
        { class: 'panel-head' },
        h('h3', {}, 'Latest published figures'),
        h('span', { class: 'muted small' }, `As of ${snap.asOf}`),
        snap.verified
          ? h('span', { class: 'snap-badge ok', title: 'Read from the fund\'s own filing or report' }, 'From the fund\'s filing')
          : h('span', { class: 'snap-badge warn', title: 'From a third-party summary of the fund\'s filings: check the filing before relying on it' }, 'Third-party summary: check the filing'),
      ),
      snap.nav?.length
        ? h('div', { class: 'snap-navs' }, ...snap.nav.map((n) => h('div', { class: 'snap-nav' }, h('span', { class: 'muted small' }, n.label), h('b', {}, `$${n.value.toFixed((String(n.value).split('.')[1]?.length ?? 0) > 2 ? 4 : 2)}`))))
        : '',
      snap.netAssets ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Size: '), snap.netAssets) : '',
      snap.distribution ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Distributions: '), snap.distribution) : '',
      ...(snap.notes ?? []).map((n) => h('p', { class: 'small' }, n)),
      h('p', { class: 'muted tiny' }, 'Source: ', ...snap.sources.flatMap((src, i) => [i ? ' · ' : '', h('a', { href: src.url, target: '_blank', rel: 'noopener' }, `${src.label} ↗`)]), ` · researched ${SNAPSHOTS_RESEARCHED}`),
    );
  }

  function fundSections(d: FundData, f: PrivateFund | undefined, name: string): Node[] {
    const out: Node[] = [];
    const displayName = f?.name ?? d.secName ?? name;
    const site = f?.site ?? (d.website ? (d.website.startsWith('http') ? d.website : `https://${d.website}`) : f ? MANAGER_SITES[f.manager] : '');
    const ai = insightButton(() => ({
      topic: 'fund',
      symbol: displayName,
      title: `AI summary: ${displayName}`,
      data: {
        fund: f ? { name: f.name, manager: f.manager, strategy: f.strategy, structure: f.structure } : { name: displayName },
        secName: d.secName,
        facts: d.facts ? Object.fromEntries(Object.entries(d.facts).map(([k, v]) => [k, v.slice(-8)])) : null,
        nport: d.nport ? { date: d.nport.date, netAssets: d.nport.netAssets, totalAssets: d.nport.totalAssets, returns: d.nport.returns, holdingsCount: d.nport.holdingsCount, mix: d.nport.mix, topHoldings: d.nport.topHoldings.slice(0, 10) } : null,
        formD: d.formD,
        navNotes: d.navNotes?.slice(0, 4),
        listedShares: d.schwab?.map(({ spark: _spark, ...r }) => r),
        recentFilings: d.filings.slice(0, 10).map(({ form, filed, reportDate }) => ({ form, filed, reportDate })),
      },
    }), 'AI summary');
    out.push(
      h(
        'div',
        { class: 'inv-actions' },
        site ? h('a', { class: 'btn', href: site, target: '_blank', rel: 'noopener' }, f?.site ? 'Fund website ↗' : 'Website ↗') : null,
        h('a', { class: 'btn', href: factSheetLink(displayName), target: '_blank', rel: 'noopener' }, 'Find fact sheet ↗'),
        h('a', { class: 'btn', href: secLink(d.cik), target: '_blank', rel: 'noopener' }, 'All SEC filings ↗'),
        h('button', { class: 'btn', onclick: () => editHolding({ fund: displayName, manager: f?.manager, strategy: f?.strategy, cik: d.cik, commitment: null, contributed: null, distributed: null, value: null }) }, '+ Add to my alternatives'),
        h('button', { class: 'btn ai-btn', onclick: () => openAssistant(`Give me a rundown of ${displayName}${f ? ` (${f.short}, ${f.manager})` : ''}: what it invests in, its latest NAV and performance, distributions, liquidity terms and main risks. Use its SEC filings and recent news.`) }, h('span', { class: 'ai-spark' }, '✦'), ' Ask AI'),
        ai.button,
      ),
      ai.panel,
    );

    // Headline numbers.
    const facts = d.facts;
    const nav = facts?.navPerShare ?? [];
    const lastNav = nav[nav.length - 1];
    const prevNav = nav[nav.length - 2];
    const yearAgoNav = lastNav ? [...nav].reverse().find((n) => n.end <= shiftYear(lastNav.end)) : undefined;
    const netAssets = facts?.netAssets?.[facts.netAssets.length - 1];
    const ret = facts?.totalReturn?.[facts.totalReturn.length - 1];
    const dist = facts?.distributions?.[facts.distributions.length - 1];
    const invest = facts?.investments?.[facts.investments.length - 1];
    // The SEC's machine-readable data leaves out figures reported per share class, which is how most big
    // non-traded funds report NAV now. A NAV from there that is many months old is labelled as such, and the
    // fund's own NAV announcements (quoted from its latest filings) are shown first instead.
    const staleNav = !!lastNav && Date.now() - Date.parse(lastNav.end) > 270 * 86400 * 1000;
    const cards = [
      lastNav && !staleNav ? { label: 'NAV per share', value: `$${lastNav.value.toFixed(2)}`, hint: `As of ${lastNav.end}${prevNav ? ` · ${pct(lastNav.value / prevNav.value - 1)} vs prior report` : ''}` } : null,
      lastNav && staleNav
        ? { label: 'NAV per share (old)', value: `$${lastNav.value.toFixed(2)}`, tone: '' as const, hint: `Last one in the SEC's structured data is from ${lastNav.end}; the fund now reports NAV by share class. Latest NAVs are quoted below.` }
        : null,
      lastNav && yearAgoNav && !staleNav ? { label: 'NAV change, 1 year', value: pct(lastNav.value / yearAgoNav.value - 1), tone: tone(lastNav.value / yearAgoNav.value - 1), hint: 'Price only, before distributions' } : null,
      ret ? { label: 'Total return', value: pct(ret.value), tone: tone(ret.value), hint: `${ret.start ?? ''} → ${ret.end} (with distributions)` } : null,
      dist ? { label: 'Distributions per share', value: `$${dist.value.toFixed(4)}`, hint: `${dist.start ?? ''} → ${dist.end}` } : null,
      netAssets ? { label: 'Net assets', value: usd(netAssets.value), hint: `As of ${netAssets.end}` } : d.nport?.netAssets ? { label: 'Net assets', value: usd(d.nport.netAssets), hint: `As of ${d.nport.date}` } : null,
      invest ? { label: 'Investments (fair value)', value: usd(invest.value), hint: `As of ${invest.end}` } : null,
      ...(d.schwab ?? []).slice(0, 2).map((r) => ({ label: `${r.symbol} price (Schwab)`, value: formatPrice(r.price), tone: tone(r.change), hint: `${pct(r.change)} today · 1y ${pct(r.y1)}` })),
    ].filter((c): c is NonNullable<typeof c> => !!c);
    const snap = f ? FUND_SNAPSHOTS[f.id] : undefined;
    // Show the researched figures unless the SEC's live data already has a newer NAV.
    if (snap && !(lastNav && !staleNav && lastNav.end > snap.asOf)) out.push(snapshotPanel(snap));
    if (cards.length) out.push(statCards(cards));
    else if (d.formD && !d.filings.some((x) => ['10-K', '10-Q', 'NPORT-P', 'N-CSR'].includes(x.form)))
      out.push(h('p', { class: 'muted' }, 'Private funds don\'t report NAV or returns publicly; what is public is their Form D below (money raised, investors, minimum). The manager\'s fact sheet or your iCapital statements have the performance.'));
    else out.push(h('p', { class: 'muted' }, 'This fund doesn\'t publish NAV figures in a format the SEC makes machine-readable. Its NAV announcements and filings are below; the fund website and fact sheet have the rest.'));

    const navNotesBlock = () => {
      if (!d.navNotes?.length) return;
      out.push(
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Latest NAV announcements'), h('span', { class: 'muted small' }, 'Quoted from the fund\'s recent filings')),
          ...d.navNotes.map((n) => h('blockquote', { class: 'nav-note' }, n.text, h('div', { class: 'muted small' }, `${n.form} filed ${n.filed} · `, h('a', { href: n.url, target: '_blank', rel: 'noopener' }, 'Open filing ↗')))),
        ),
      );
    };
    if (staleNav) navNotesBlock();
    if (nav.length > 1) {
      const box = h('div');
      out.push(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'NAV per share over time'), h('span', { class: 'muted small' }, staleNav ? `From quarterly and annual reports, up to ${lastNav!.end}` : 'From quarterly and annual reports')), box));
      requestAnimationFrame(() => createLineChart(box, { height: 220, format: (v) => `$${v.toFixed(2)}` }).set([{ name: 'NAV per share', color: '#2962ff', data: nav.map((n) => ({ time: n.end, value: n.value })) }]));
    }

    if (!staleNav) navNotesBlock();

    if (d.nport) {
      const p = d.nport;
      out.push(
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, `Portfolio as of ${p.date}`), h('span', { class: 'muted small' }, 'From Form N-PORT (public with a 60-day delay) · '), h('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'small' }, 'Open ↗')),
          statCards([
            { label: 'Net assets', value: usd(p.netAssets) },
            { label: 'Total assets', value: usd(p.totalAssets) },
            { label: 'Holdings', value: p.holdingsCount.toLocaleString('en-US') },
          ]),
          p.returns.length
            ? h('div', {}, h('h4', {}, 'Monthly total returns (last 3 months of the report)'), dataTable(['Share class', 'Month 1', 'Month 2', 'Month 3'], p.returns.map((r) => [{ v: r.classId || '—', cls: 'label' }, ...r.months.map((m) => ({ v: m == null ? '—' : `${m.toFixed(2)}%`, cls: tone(m) }))])))
            : null,
          h(
            'div',
            { class: 'two-col' },
            p.mix.length ? h('div', {}, h('h4', {}, 'What it owns'), barList(p.mix.map((m) => ({ label: m.label, value: m.pct })), (v) => `${v.toFixed(1)}%`)) : h('div'),
            p.topHoldings.length ? h('div', {}, h('h4', {}, 'Largest holdings'), dataTable(['Holding', '% of fund', 'Value'], p.topHoldings.map((x) => [{ v: x.name || x.title, cls: 'label' }, x.pct != null ? `${x.pct.toFixed(2)}%` : '—', usd(x.value)]))) : h('div'),
          ),
        ),
      );
    }

    if (d.formD) {
      const fd = d.formD;
      out.push(
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Private offering (Form D)'), h('span', { class: 'muted small' }, `${d.formDCount} Form D filing${d.formDCount === 1 ? '' : 's'}${fd.filed ? ` · latest ${fd.filed}` : ''}`), fd.url ? h('a', { href: fd.url, target: '_blank', rel: 'noopener', class: 'small' }, 'Open ↗') : null),
          statCards([
            { label: 'Fund type', value: fd.fundType || fd.industry || '—' },
            { label: 'Amount raised', value: usd(fd.sold) },
            { label: 'Offering size', value: fd.offering ? usd(fd.offering) : fd.offeringText || '—' },
            { label: 'Investors so far', value: fd.investors != null ? Math.round(fd.investors).toLocaleString('en-US') : '—' },
            { label: 'Minimum investment', value: fd.minimum ? usd(fd.minimum) : '—' },
            { label: 'First sale', value: fd.firstSale || '—' },
          ]),
          fd.exemptions.length ? h('p', { class: 'small' }, h('b', {}, 'Who can invest: '), fd.exemptions.map((e) => EXEMPTIONS[e] ?? e).join(' · ')) : null,
          fd.placementAgents.length ? h('p', { class: 'small' }, h('b', {}, 'Sold through: '), fd.placementAgents.join(', ')) : null,
          fd.people.length ? h('p', { class: 'small muted' }, h('b', {}, 'People named: '), fd.people.map((x) => `${x.name}${x.roles.length ? ` (${x.roles.join(', ')})` : ''}`).join('; ')) : null,
        ),
      );
    }

    if (f) out.push(aboutPanel(f));
    if (f?.managerTicker) {
      const row = h('div', { class: 'skeleton', style: 'height:44px' });
      out.push(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, `${f.manager}'s stock`), h('span', { class: 'muted small' }, 'How the market values the manager')), row));
      loadBoard([{ title: '', symbols: [[f.managerTicker, f.manager]] }])
        .then((rows) => {
          const r = rows.get(f.managerTicker!);
          row.classList.remove('skeleton');
          row.replaceChildren(
            h(
              'button',
              { class: 'manager-row', onclick: () => openSymbolDetail(f.managerTicker!, f.manager, r, ctx) },
              h('b', {}, `${f.managerTicker} · ${formatPrice(r?.price)}`),
              h('span', { class: tone(r?.change) }, `${pct(r?.change)} today`),
              h('span', { class: tone(r?.ytd) }, `YTD ${pct(r?.ytd, 1)}`),
              h('span', { class: tone(r?.y1) }, `1 year ${pct(r?.y1, 1)}`),
            ),
          );
        })
        .catch(() => row.replaceWith(h('p', { class: 'muted small' }, 'Manager stock price unavailable right now.')));
    }

    if (d.filings.length)
      out.push(
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', {}, 'Recent SEC filings'), h('span', { class: 'muted small' }, `${d.secName} · CIK ${d.cik}`)),
          dataTable(['Filed', 'Form', 'Period', 'Description', ''], d.filings.map((x) => [x.filed, h('b', {}, x.form), x.reportDate || '—', { v: x.description || formLabel(x.form), cls: 'label' }, h('a', { href: x.url, target: '_blank', rel: 'noopener' }, 'Open')])),
        ),
      );
    const missing = Object.entries(d.errors).filter(([k]) => k !== 'schwab');
    if (missing.length) out.push(h('p', { class: 'muted small' }, `Some data couldn't be loaded: ${missing.map(([k, v]) => `${k} (${v})`).join('; ')}`));
    out.push(h('p', { class: 'muted small' }, 'Private fund values are reported monthly or quarterly, not live. Figures come from the fund\'s SEC filings; check the fund\'s offering documents before investing.'));
    return out;
  }

  // ----- Search every private fund (Form D) -----

  function renderSearch() {
    const input = h('input', { class: 'input', placeholder: 'Fund or manager name, e.g. "Blue Owl" or "iCapital"', value: searchQuery, style: 'width:320px' });
    const results = h('div');
    const go = (q = input.value.trim()) => {
      searchQuery = q;
      input.value = q;
      if (q.length < 3) return;
      results.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
      engineRequest<{ results: PrivateHit[] }>('alts.search_private', { query: q }, 45000)
        .then(({ results: rows }) =>
          results.replaceChildren(
            rows.length
              ? hitTable(rows, ['Name', 'Latest Form D', 'Location'], (r) => [r.filed, r.location || '—'])
              : h('p', { class: 'muted' }, `No Form D filings mention "${q}".`),
          ),
        )
        .catch((err) => results.replaceChildren(errorBox(err, () => go(q))));
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    body.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Search every private fund')),
        h('p', { class: 'muted small' }, 'Every private fund raising money in the US (hedge funds, private equity, venture, real estate, feeder funds) files a Form D with the SEC. Search by fund name, manager, or a placement agent like iCapital to find feeder funds.'),
        h('div', { class: 'ap-controls' }, input, h('button', { class: 'btn primary', onclick: () => go() }, 'Search')),
        h('div', { class: 'chip-row' }, ...['iCapital', 'Blackstone', 'Blue Owl', 'Apollo', 'KKR', 'Ares', 'Carlyle', 'Brookfield'].map((q) => h('button', { class: 'chip', onclick: () => go(q) }, q))),
      ),
      results,
    );
    if (searchQuery) go(searchQuery);
  }

  function hitTable(rows: PrivateHit[], headers: string[], cells: (r: PrivateHit) => (string | Node)[]) {
    return h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'data-table' },
          h('thead', {}, h('tr', {}, ...headers.map((t) => h('th', {}, t)))),
          h('tbody', {}, ...rows.map((r) => h('tr', { class: 'clickable', onclick: () => openFund({ cik: r.cik, name: r.name }) }, h('td', { class: 'label' }, h('b', {}, r.name)), ...cells(r).map((c) => h('td', {}, c))))),
        ),
      ),
    );
  }

  // ----- Newest private funds -----

  function renderLatest() {
    body.replaceChildren(h('p', { class: 'muted inv-lead' }, 'Private funds that filed a Form D in the last day or two: new funds opening and existing funds reporting more money raised. Amounts are what the fund reported so far.'), h('div', { class: 'skeleton', style: 'height:300px' }));
    engineRequest<{ results: PrivateHit[] }>('alts.latest_private', {}, 90000)
      .then(({ results }) =>
        body.replaceChildren(
          body.firstChild!,
          results.length
            ? hitTable(results, ['Fund', 'Type', 'Raised so far', 'Minimum', 'Investors', 'Filed', 'State'], (r) => [
                r.fundType || '—',
                r.sold ? usd(r.sold) : '—',
                r.minimum ? usd(r.minimum) : '—',
                r.investors != null ? String(Math.round(r.investors)) : '—',
                `${r.filed}${r.amendment ? ' (update)' : ''}`,
                r.state || '—',
              ])
            : h('p', { class: 'muted' }, 'No new private fund filings right now. Check back later today.'),
        ),
      )
      .catch((err) => body.replaceChildren(body.firstChild!, errorBox(err, renderLatest)));
  }

  // ----- My alternatives -----

  async function loadHoldings() {
    holdings = (await engineRequest<{ docs: AltHolding[] }>('store.list', { collection: 'alt_holdings' }, 20000)).docs;
  }

  function renderMine() {
    body.replaceChildren(h('div', { class: 'skeleton', style: 'height:200px' }));
    loadHoldings()
      .then(drawMine)
      .catch((err) => body.replaceChildren(errorBox(err, renderMine)));
  }

  function drawMine() {
    const file = h('input', { type: 'file', accept: '.csv,.xlsx,.xlsm,.txt', hidden: true });
    file.addEventListener('change', () => file.files?.[0] && importFile(file.files[0]));
    const t = totals(holdings);
    const x = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}×`);
    body.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel-head' },
          h('h3', {}, 'My alternative investments'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', onclick: () => file.click() }, 'Import from iCapital / spreadsheet'),
          h('button', { class: 'btn primary', onclick: () => editHolding() }, '+ Add investment'),
          file,
        ),
        holdings.length
          ? h(
              'div',
              {},
              statCards([
                { label: 'Current value', value: usd(t.value) },
                { label: 'Committed', value: usd(t.commitment) },
                { label: 'Unfunded (still to be called)', value: usd(t.unfunded) },
                { label: 'Distributions received', value: usd(t.distributed) },
                { label: 'TVPI', value: x(t.tvpi), hint: 'Total value ÷ money paid in' },
                { label: 'Gain', value: usd(t.gain), tone: tone(t.gain) },
              ]),
              dataTable(
                ['Investment', 'Account', 'Committed', 'Paid in', 'Unfunded', 'Distributions', 'Value', 'As of', 'TVPI', 'DPI', ''],
                [
                  ...holdings.map((hd) => {
                    const s = holdingStats(hd);
                    const match = PRIVATE_FUNDS.find((p) => p.name.toLowerCase() === hd.fund.toLowerCase() || p.short.toLowerCase() === hd.fund.toLowerCase());
                    return [
                      { v: h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), match ? openFund(match) : hd.cik ? openFund({ cik: hd.cik, name: hd.fund }) : openFund({ cik: 0, name: hd.fund })) }, hd.fund), cls: 'label' },
                      hd.account || '—',
                      usd(hd.commitment),
                      usd(hd.contributed),
                      usd(s.unfunded),
                      usd(hd.distributed),
                      usd(hd.value),
                      hd.valueDate || '—',
                      x(s.tvpi),
                      x(s.dpi),
                      h('span', { class: 'row-actions' }, h('button', { class: 'btn small', onclick: () => editHolding(hd) }, 'Edit'), h('button', { class: 'btn small', onclick: () => removeHolding(hd) }, 'Delete')),
                    ];
                  }),
                  [{ v: 'Total', cls: 'label' }, '', usd(t.commitment), usd(t.contributed), usd(t.unfunded), usd(t.distributed), usd(t.value), '', x(t.tvpi), x(t.dpi), ''],
                ],
                (i) => (i === holdings.length ? 'total' : ''),
              ),
            )
          : h(
              'div',
              { class: 'empty-state' },
              h('p', {}, 'Track your private funds here: commitments, capital calls, distributions and current value.'),
              h('p', { class: 'muted small' }, 'iCapital doesn\'t offer a public connection for personal accounts, so bring your positions in with "Import": in iCapital, download your holdings or capital account summary as Excel/CSV, then pick that file here. Columns are matched by their headings (fund name, commitment, contributions, distributions, NAV).'),
            ),
        h('p', { class: 'muted small' }, 'Saved by the helper on this computer (in its platform database), not in the browser or online.'),
      ),
    );
  }

  function editHolding(existing?: Partial<AltHolding>) {
    const v = { fund: '', commitment: null, contributed: null, distributed: null, value: null, ...existing } as AltHolding;
    const text = (label: string, key: 'fund' | 'manager' | 'strategy' | 'account' | 'valueDate' | 'notes', type = 'text') => {
      const input = h('input', { class: 'input', type, value: (v[key] as string) ?? '' });
      input.addEventListener('input', () => ((v as unknown as Record<string, string>)[key] = input.value));
      return h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), input);
    };
    const num = (label: string, key: 'commitment' | 'contributed' | 'distributed' | 'value') => {
      const input = h('input', { class: 'input', type: 'number', step: 1000, value: v[key] ?? '' });
      input.addEventListener('input', () => (v[key] = input.value === '' ? null : +input.value));
      return h('label', { class: 'field' }, h('span', { class: 'muted small' }, label), input);
    };
    const form = h(
      'div',
      { class: 'field-grid' },
      text('Investment / fund name', 'fund'),
      text('Manager', 'manager'),
      text('Strategy', 'strategy'),
      text('Account', 'account'),
      num('Commitment ($)', 'commitment'),
      num('Paid in / called ($)', 'contributed'),
      num('Distributions received ($)', 'distributed'),
      num('Current value / NAV ($)', 'value'),
      text('Value as of', 'valueDate', 'date'),
      text('Notes', 'notes'),
    );
    const close = openModal(
      existing?.id ? 'Edit investment' : 'Add investment',
      h(
        'div',
        {},
        form,
        h(
          'div',
          { class: 'inv-actions' },
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                if (!v.fund.trim()) return toast('Enter the investment name');
                try {
                  await engineRequest('store.save', { collection: 'alt_holdings', doc: v }, 20000);
                  close();
                  toast('Saved');
                  tab = 'mine';
                  setTab('mine');
                } catch (err) {
                  toast((err as Error).message);
                }
              },
            },
            'Save',
          ),
        ),
      ),
    );
  }

  async function removeHolding(hd: AltHolding) {
    if (!hd.id || !confirm(`Delete ${hd.fund} from your alternatives?`)) return;
    try {
      await engineRequest('store.delete', { collection: 'alt_holdings', docId: hd.id }, 20000);
      renderMine();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function importFile(file: File) {
    let rows: string[][];
    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'xlsx' || ext === 'xlsm') {
        const { xlsxToCsv } = await import('../ai/files');
        rows = parseCsv((await xlsxToCsv(await file.arrayBuffer())).text.replace(/^# Sheet:.*$/gm, ''));
      } else rows = parseCsv(await file.text());
    } catch (err) {
      return toast(`Couldn't read ${file.name}: ${(err as Error).message}`);
    }
    const { holdings: found, headers, columns } = rowsToHoldings(rows);
    if (!found.length)
      return openModal(
        'Nothing to import',
        h('p', {}, 'No rows with a fund name and an amount were found. The file needs a heading row with a fund/investment name column and at least one of: commitment, contributions/paid-in, NAV/value.'),
      );
    const used = Object.entries(columns).map(([k, i]) => `${headers[i!]} → ${k}`);
    const close = openModal(
      `Import ${found.length} investment${found.length === 1 ? '' : 's'}`,
      h(
        'div',
        {},
        h('p', { class: 'muted small' }, `Columns matched: ${used.join(' · ')}`),
        dataTable(['Investment', 'Committed', 'Paid in', 'Distributions', 'Value', 'As of'], found.map((x) => [{ v: x.fund, cls: 'label' }, usd(x.commitment), usd(x.contributed), usd(x.distributed), usd(x.value), x.valueDate || '—'])),
        h(
          'div',
          { class: 'inv-actions' },
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                try {
                  for (const x of found) {
                    const same = holdings.find((e) => e.fund.toLowerCase() === x.fund.toLowerCase() && (e.account ?? '') === (x.account ?? ''));
                    await engineRequest('store.save', { collection: 'alt_holdings', doc: { ...same, ...x, id: same?.id } }, 20000);
                  }
                  close();
                  toast(`Imported ${found.length}`);
                  setTab('mine');
                } catch (err) {
                  toast((err as Error).message);
                }
              },
            },
            'Import (updates matching funds)',
          ),
        ),
      ),
      { wide: true },
    );
  }

  return {
    el,
    show(sub?: Tab) {
      if (sub) tab = sub;
      setTab(tab);
    },
    openFund,
    searchPrivate(query: string) {
      searchQuery = query;
      setTab('search');
    },
    refresh() {
      if (tab === 'market' && !tabs.hidden) renderMarket();
    },
  };
}

function shiftYear(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function formLabel(form: string) {
  return (
    {
      '10-K': 'Annual report',
      '10-Q': 'Quarterly report',
      '8-K': 'Current report (news, NAV updates)',
      '424B3': 'Prospectus supplement (often the monthly NAV)',
      '497': 'Prospectus update',
      'NPORT-P': 'Monthly portfolio holdings',
      'N-CSR': 'Annual shareholder report',
      'N-CSRS': 'Semi-annual shareholder report',
      D: 'Private offering notice',
      'D/A': 'Private offering update',
      'N-2': 'Registration statement',
      'SC TO-I': 'Tender offer (share repurchase)',
    } as Record<string, string>
  )[form] ?? '';
}
