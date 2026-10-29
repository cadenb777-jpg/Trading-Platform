"""
Alternative investments from SEC EDGAR (free). Evergreen and semi-liquid funds (non-traded REITs and BDCs,
interval and tender-offer funds) file regular reports: NAV per share and net assets (XBRL), monthly holdings
and returns (Form N-PORT), and monthly NAV announcements (prospectus supplements / 8-Ks). Every private fund
raising money in the US files a Form D: fund type, amount raised, minimum investment and number of investors.
"""
import asyncio
import datetime as dt
import html
import re
import urllib.parse
import xml.etree.ElementTree as ET

from . import sec
from .core import EngineError, handler

EFTS = 'https://efts.sec.gov/LATEST/search-index'
LATEST_FORM_D = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&company=&dateb=&owner=include&start=0&count=60&output=atom'
FORM_D_URL = 'https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/primary_doc.xml'
FILING_FORMS = {'10-K', '10-Q', '8-K', '424B3', '497', 'N-CSR', 'N-CSRS', 'NPORT-P', 'D', 'D/A', 'N-2', 'N-2/A', 'POS AM',
                '10-K/A', '10-Q/A', 'SC TO-I', 'N-23C3A', 'N-CEN', 'S-11', 'S-11/A', '1-K', '1-SA'}
ASSET_CATEGORIES = {
    'EC': 'Stocks', 'EP': 'Preferred stock', 'DBT': 'Bonds & debt', 'LON': 'Loans', 'ABS-MBS': 'Mortgage-backed',
    'ABS-ASBS': 'Asset-backed', 'ABS-CBDO': 'CLOs & CDOs', 'ABS-O': 'Other asset-backed', 'STIV': 'Cash & short-term',
    'RE': 'Real estate', 'COMM': 'Commodities', 'SN': 'Structured notes', 'DE': 'Equity derivatives',
    'DIR': 'Rate derivatives', 'DCR': 'Credit derivatives', 'DFE': 'Currency derivatives', 'DCO': 'Commodity derivatives',
    'DO': 'Other derivatives', 'OT': 'Other',
}
NOISE_WORDS = {'inc', 'llc', 'lp', 'l', 'p', 'corp', 'corporation', 'co', 'the', 'ltd', 'trust', 'fund', 'company'}


def _local(tag):
    return tag.rsplit('}', 1)[-1]


def _find(root, name):
    for el in root.iter():
        if _local(el.tag) == name:
            return el
    return None


def _text(root, *path):
    """Text of the first element found by following local names (e.g. 'offeringSalesAmounts', 'totalAmountSold')."""
    node = root
    for name in path:
        node = _find(node, name) if node is not None else None
    return (node.text or '').strip() if node is not None and node.text else ''


def _num(value):
    try:
        return float(str(value).replace(',', ''))
    except (TypeError, ValueError):
        return None


def _words(name):
    return [w for w in re.sub(r'[^a-z0-9 ]', ' ', name.lower()).split() if w not in NOISE_WORDS]


def name_score(wanted, candidate):
    """How well an SEC company name matches the name we're looking for (0..1)."""
    a, b = _words(wanted), set(_words(candidate))
    if not a:
        return 0.0
    hits = sum(1 for w in a if w in b)
    return hits / len(a) - 0.02 * max(0, len(b) - len(a))


async def efts(ctx, params):
    return (await sec.sec_get(ctx, f'{EFTS}?{urllib.parse.urlencode(params)}')).json()


def _cik_from_display(display):
    m = re.search(r'\(CIK (\d+)\)', display or '')
    return int(m.group(1)) if m else None


def _clean_display(display):
    return re.sub(r'\s*\(CIK \d+\)\s*', '', re.sub(r'\s*\([A-Z0-9, -]{1,20}\)\s*(?=\(CIK)', ' ', display or '')).strip()


async def resolve(ctx, name):
    """Finds a fund's SEC CIK number from its name."""
    async def load():
        candidates = []
        try:
            data = await efts(ctx, {'keysTyped': name})
            for hit in data.get('hits', {}).get('hits', []):
                src = hit.get('_source', {})
                try:
                    candidates.append((int(str(hit.get('_id', '')).lstrip('0') or 0), src.get('entity') or src.get('display_name') or ''))
                except ValueError:
                    continue
        except EngineError:
            raise
        except Exception:
            pass
        if not candidates or max(name_score(name, n) for _, n in candidates) < 0.75:
            data = await efts(ctx, {'q': f'"{name}"'})
            for hit in data.get('hits', {}).get('hits', []):
                src = hit.get('_source', {})
                for display in src.get('display_names', []):
                    cik = _cik_from_display(display)
                    if cik:
                        candidates.append((cik, _clean_display(display)))
        scored = sorted(((name_score(name, n), cik, n) for cik, n in candidates if cik), reverse=True)
        if not scored or scored[0][0] < 0.6:
            raise EngineError(f'Couldn\'t find "{name}" in SEC filings.')
        return {'cik': scored[0][1], 'name': scored[0][2]}
    return await ctx.cached(('fund-cik', name.lower()), 30 * 86400, load, persist=True)


# ---------- Reports ----------

def _series(gaap, tag, unit):
    """One XBRL fact over time from 10-K/10-Q filings: [{end, start?, value, filed}] (latest filing per period)."""
    entries = (gaap.get(tag) or {}).get('units', {}).get(unit) or []
    by_period = {}
    for e in entries:
        if not str(e.get('form', '')).startswith(('10-K', '10-Q')) or e.get('val') is None:
            continue
        key = (e.get('start'), e['end'])
        if key not in by_period or e.get('filed', '') > by_period[key]['filed']:
            by_period[key] = {'end': e['end'], 'start': e.get('start'), 'value': e['val'], 'filed': e.get('filed', '')}
    return sorted(by_period.values(), key=lambda r: (r['end'], r['start'] or ''))[-40:]


def fund_facts_from(company_facts):
    gaap = company_facts.get('facts', {}).get('us-gaap', {})

    def first(*options):
        # Funds switch XBRL tags over the years (and an old tag keeps its old data), so take whichever candidate
        # has the most recent period, not simply the first one that has any data.
        found = [s for s in (_series(gaap, t, u) for t, u in options) if s]
        return max(found, key=lambda s: s[-1]['end']) if found else []
    return {
        'navPerShare': first(('NetAssetValuePerShare', 'USD/shares')),
        'netAssets': first(('AssetsNet', 'USD'), ('StockholdersEquity', 'USD')),
        'investments': first(('InvestmentOwnedAtFairValue', 'USD')),
        'totalAssets': first(('Assets', 'USD')),
        'totalReturn': first(('InvestmentCompanyTotalReturn', 'pure')),
        'distributions': first(('InvestmentCompanyDistributionToShareholdersPerShare', 'USD/shares'),
                               ('DistributionMadeToLimitedPartnerDistributionsPaidPerUnit', 'USD/shares'),
                               ('CommonStockDividendsPerShareDeclared', 'USD/shares')),
    }


async def fund_facts(ctx, cik):
    async def load():
        return fund_facts_from(await sec._json(ctx, sec.FACTS_URL.format(cik=cik)))
    return await ctx.cached(('fund-facts', cik), 12 * 3600, load, persist=True, stale_ok=True)


def parse_nport(xml_text):
    """Monthly portfolio report (Form N-PORT): size, monthly returns, biggest holdings and asset mix."""
    root = ET.fromstring(xml_text)
    holdings = []
    for inv in root.iter():
        if _local(inv.tag) != 'invstOrSec':
            continue
        cat = _text(inv, 'assetCat')
        if not cat:
            cond = _find(inv, 'assetConditional')
            cat = cond.get('assetCat', 'OT') if cond is not None else 'OT'
        holdings.append({'name': _text(inv, 'name') or _text(inv, 'title'), 'title': _text(inv, 'title'),
                         'value': _num(_text(inv, 'valUSD')), 'pct': _num(_text(inv, 'pctVal')), 'category': cat})
    mix = {}
    for hld in holdings:
        label = ASSET_CATEGORIES.get(hld['category'], hld['category'] or 'Other')
        mix[label] = mix.get(label, 0) + (hld['pct'] or 0)
    returns = []
    for el in root.iter():
        if _local(el.tag) == 'monthlyTotReturn':
            returns.append({'classId': el.get('classId', ''), 'months': [_num(el.get(k)) for k in ('rtn1', 'rtn2', 'rtn3')]})
    return {
        'name': _text(root, 'seriesName') or _text(root, 'regName'),
        'date': _text(root, 'repPdDate'),
        'netAssets': _num(_text(root, 'netAssets')),
        'totalAssets': _num(_text(root, 'totAssets')),
        'returns': returns,
        'holdingsCount': len(holdings),
        'topHoldings': sorted(holdings, key=lambda x: x['pct'] or 0, reverse=True)[:12],
        'mix': sorted(({'label': k, 'pct': v} for k, v in mix.items() if v > 0.05), key=lambda x: -x['pct']),
    }


def parse_form_d(xml_text):
    """A Form D (private fund or company raising money): what it is, how much it raised, from how many investors."""
    root = ET.fromstring(xml_text)
    people = []
    for person in root.iter():
        if _local(person.tag) != 'relatedPersonInfo':
            continue
        name = ' '.join(x for x in (_text(person, 'firstName'), _text(person, 'lastName')) if x)
        roles = [r.text.strip() for r in person.iter() if _local(r.tag) == 'relationship' and r.text]
        if name:
            # relationshipClarification is the filer's own words, often the title ("Managing Member of the GP").
            people.append({'name': name, 'roles': roles, 'title': _text(person, 'relationshipClarification')})
    brokers = sorted({r.text.strip() for r in root.iter() if _local(r.tag) == 'recipientName' and r.text and r.text.strip() not in ('None', 'N/A')})
    exempt = _find(root, 'federalExemptionsExclusions')
    exemptions = [i.text.strip() for i in (list(exempt) if exempt is not None else []) if i.text]
    first_sale = _text(root, 'dateOfFirstSale', 'value') or ('Yet to occur' if _find(root, 'yetToOccur') is not None else '')
    return {
        'name': _text(root, 'primaryIssuer', 'entityName'),
        'entityType': _text(root, 'primaryIssuer', 'entityType'),
        'city': _text(root, 'issuerAddress', 'city'),
        'state': _text(root, 'issuerAddress', 'stateOrCountryDescription'),
        'yearOfInc': _text(root, 'yearOfInc', 'value'),
        'industry': _text(root, 'industryGroupType'),
        'fundType': _text(root, 'investmentFundType'),
        'sizeRange': _text(root, 'aggregateNetAssetValueRange') or _text(root, 'revenueRange'),
        'exemptions': exemptions,
        'amendment': _text(root, 'isAmendment') == 'true',
        'firstSale': first_sale,
        'moreThanOneYear': _text(root, 'moreThanOneYear') == 'true',
        'minimum': _num(_text(root, 'minimumInvestmentAccepted')),
        'offering': _num(_text(root, 'totalOfferingAmount')),
        'offeringText': _text(root, 'totalOfferingAmount'),
        'sold': _num(_text(root, 'totalAmountSold')),
        'remaining': _num(_text(root, 'totalRemaining')),
        'investors': _num(_text(root, 'totalNumberAlreadyInvested')),
        'nonAccredited': _text(root, 'hasNonAccreditedInvestors') == 'true',
        'salesCommission': _num(_text(root, 'salesCommissions', 'dollarAmount')),
        'people': people[:12],
        'placementAgents': brokers[:10],
        'signedBy': _text(root, 'signatureBlock', 'nameOfSigner'),
        'signedDate': _text(root, 'signatureBlock', 'signatureDate'),
    }


def _raw_document(document):
    # The listed document is often a styled HTML view; the raw XML has the same name without the style folder.
    return re.sub(r'^xsl[^/]+/', '', document)


async def latest_nport(ctx, cik, filings):
    f = next((f for f in filings if f['form'] == 'NPORT-P'), None)
    if not f:
        return None
    url = sec.filing_url(cik, f['accession'], _raw_document(f['document']))
    async def load():
        return parse_nport((await sec.sec_get(ctx, url)).text)
    data = await ctx.cached(('nport', f['accession']), 365 * 86400, load, persist=True)
    return {**data, 'filed': f['filed'], 'url': sec.filing_url(cik, f['accession'], f['document'])}


async def form_d(ctx, cik, accession, document='primary_doc.xml'):
    url = sec.filing_url(cik, accession, _raw_document(document))
    async def load():
        return parse_form_d((await sec.sec_get(ctx, url)).text)
    return await ctx.cached(('form-d', accession), 365 * 86400, load, persist=True)


NAV_SENTENCE = re.compile(r'(net asset value|\bNAV\b)[^.]{0,160}?per (share|unit)|per (share|unit)[^.]{0,60}?(net asset value|\bNAV\b)', re.I)


def nav_sentences(page, limit=3):
    """Sentences that state a NAV per share (with a dollar amount) in a filing's text."""
    text = html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?is)<(script|style).*?</\1>', ' ', page)))
    text = re.sub(r'\s+', ' ', text)
    out = []
    for sentence in re.split(r'(?<=[.;])\s+(?=[A-Z(])', text):
        if len(sentence) < 30 or len(sentence) > 700 or not re.search(r'\$\s?\d', sentence) or not NAV_SENTENCE.search(sentence):
            continue
        if sentence not in out:
            out.append(sentence.strip())
        if len(out) >= limit:
            break
    return out


_MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
_NAV_PHRASE = re.compile(r'(net asset value|\bNAV\b)\s*(\(\s*“?"?NAV"?”?\s*\)\s*)?per (share|unit)', re.I)
_DATE = re.compile(rf'\b({_MONTHS})\s+(\d{{1,2}}),\s*(20\d\d)')
_CLASS_VALUE = re.compile(r'\bClass\s+([A-Z](?:-[A-Z])?|[A-Z][a-z]?)(?:\s+Series\s+(I{1,3}|[A-Z]))?(?:\s+(?:Common\s+)?(?:Shares|Units|shares|units))?'
                          r'[^$\d.]{0,40}\$\s?(\d{1,3}(?:\.\d{2,4}))')
_SINGLE_VALUE = re.compile(r'(?:was|of|is|equal(?:ed)? to|were)\s+\$\s?(\d{1,3}\.\d{2,4})')


def nav_points(page):
    """NAV per share figures with their dates from one filing: [(iso date, class label, value)]. Reads monthly NAV
    announcements like "NAV per share as of September 30, 2026 ... Class I Shares $14.6488" or "the NAV per share
    for each class ... as of September 30, 2026 was $23.51"."""
    text = html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'(?is)<(script|style).*?</\1>', ' ', page)))
    text = re.sub(r'\s+', ' ', text)
    out = []
    for m in _NAV_PHRASE.finditer(text):
        d = _DATE.search(text, m.end(), m.end() + 220) or _DATE.search(text, max(0, m.start() - 160), m.start())
        if not d:
            continue
        day = dt.date(int(d.group(3)), _MONTHS.split('|').index(d.group(1)) + 1, int(d.group(2))).isoformat()
        window = text[max(m.end(), d.end()):max(m.end(), d.end()) + 900]
        nxt = _DATE.search(window)  # stop at the next date so an older table's numbers aren't mixed in
        if nxt and nxt.start() > 40:
            window = window[:nxt.start()]
        found = False
        for c in _CLASS_VALUE.finditer(window):
            label = f"Class {c.group(1)}" + (f" Series {c.group(2)}" if c.group(2) else '')
            v = float(c.group(3))
            if 1 <= v < 1000:
                out.append((day, label, v))
                found = True
        if not found:
            single = _SINGLE_VALUE.search(window[:200])
            if single and 1 <= float(single.group(1)) < 1000:
                out.append((day, 'All classes', float(single.group(1))))
    return list(dict.fromkeys(out))


def nav_series(points, today=None):
    """One monthly NAV line from many filings' points: Class I if the fund has it (the class advisors use),
    otherwise the one reported most often. Drops readings that are far from the class's typical value."""
    today = today or dt.date.today()
    oldest = (today - dt.timedelta(days=4 * 365)).isoformat()
    recent = [p for p in points if oldest <= p[0] <= today.isoformat()]
    if not recent:
        return None
    by_class = {}
    for day, label, v in recent:
        by_class.setdefault(label, {})[day] = v
    pick = next((c for c in ('Class I', 'Class I Series I', 'All classes') if c in by_class), None)
    pick = pick or max(by_class, key=lambda c: len(by_class[c]))
    vals = sorted(by_class[pick].values())
    mid = vals[len(vals) // 2]
    line = [{'date': d, 'value': v} for d, v in sorted(by_class[pick].items()) if abs(v / mid - 1) < 0.4]
    if not line:
        return None
    latest = line[-1]['date']
    classes = sorted({label: v for label, (d, v) in ((c, max(ds.items())) for c, ds in by_class.items()) if d == latest}.items())
    return {'cls': pick, 'points': line, 'latestByClass': [{'cls': c, 'value': v, 'date': latest} for c, v in classes]}


async def nav_data(ctx, cik, filings):
    """{'notes': NAV sentences quoted from recent filings, 'history': a monthly NAV line (nav_series) or None}."""
    # Big non-traded funds file many prospectus supplements; the monthly NAV one isn't always among the newest few.
    # The newest quarterly and annual reports (10-Q / 10-K) state NAV per share for every share class too.
    # The monthly NAV announcements over the last couple of years also give a modern NAV history (navHistory),
    # which most big funds no longer report in the SEC's structured data. Each filing is read once and cached.
    monthly = [f for f in filings if f['form'] in ('424B3', '8-K', '497')]
    picks = monthly[:16] + [f for f in filings if f['form'] == '10-Q'][:3] + [f for f in filings if f['form'] == '10-K'][:1]

    async def one(f):
        url = sec.filing_url(cik, f['accession'], f['document'])
        async def load():
            page = (await sec.sec_get(ctx, url)).text[:4_000_000 if f['form'] in ('10-Q', '10-K') else 800_000]
            return {'sentences': nav_sentences(page), 'points': nav_points(page)}
        try:
            found = await ctx.cached(('nav-read', f['accession']), 365 * 86400, load, persist=True)
        except Exception:
            return [], []
        return [{'text': t, 'form': f['form'], 'filed': f['filed'], 'url': url} for t in found['sentences']], found['points']

    results = await asyncio.gather(*(one(f) for f in picks))
    history = nav_series([tuple(p) for _, pts in results for p in pts])
    notes, seen = [], set()
    for n in (n for ns, _ in results for n in ns):
        if n['text'] not in seen:  # the same NAV sentence is often repeated in the next filing
            seen.add(n['text'])
            notes.append(n)
    notes.sort(key=lambda n: n['filed'], reverse=True)  # newest first, whichever kind of filing it came from
    return {'notes': notes[:6], 'history': history}


async def schwab_classes(ctx, name, ticker=None):
    """Share classes of the fund that Schwab quotes (interval funds and some others trade like mutual funds)."""
    from . import invest
    symbols = [ticker.upper()] if ticker else []
    if not symbols:
        try:
            client = ctx.schwab
            words = ' '.join(_words(name)[:4]) or name
            response = await client.get_instruments([words], client.Instrument.Projection.DESCRIPTION_SEARCH)
            if response.status_code == 200:
                for item in (response.json() or {}).get('instruments', []):
                    if item.get('assetType') in ('MUTUAL_FUND', 'CLOSED_END_FUND', 'EQUITY') and name_score(name, item.get('description', '')) >= 0.8:
                        symbols.append(item['symbol'])
        except Exception:
            return []
    if not symbols:
        return []
    board = await invest.board(ctx, {'symbols': symbols[:6]})
    return [r for r in board['rows'] if r.get('price')]


@handler('alts.fund')
async def fund(ctx, msg):
    """Everything public about one fund: SEC reports (NAV, net assets, holdings, returns), Form D and Schwab quotes."""
    name = str(msg.get('name') or '').strip()
    cik = msg.get('cik')
    try:
        cik = int(cik) if cik else None
    except (TypeError, ValueError):
        cik = None
    if not cik:
        if not name:
            raise EngineError('No fund given')
        cik = (await resolve(ctx, name))['cik']
    subs = await sec.submissions(ctx, cik)
    all_filings = sec.recent_filings(subs, limit=400)
    filings = [{**f, 'url': sec.filing_url(cik, f['accession'], f['document'])} for f in all_filings if f['form'] in FILING_FORMS]
    forms = {f['form'] for f in all_filings}
    latest_d = next((f for f in all_filings if f['form'] in ('D', 'D/A')), None)

    tasks = {
        'facts': fund_facts(ctx, cik) if forms & {'10-K', '10-Q'} else None,
        'nport': latest_nport(ctx, cik, all_filings),
        'formD': form_d(ctx, cik, latest_d['accession'], latest_d['document']) if latest_d else None,
        'navData': nav_data(ctx, cik, all_filings),
        'schwab': schwab_classes(ctx, subs.get('name') or name, msg.get('ticker')),
    }
    keys = [k for k, t in tasks.items() if t is not None]
    results = await asyncio.gather(*(tasks[k] for k in keys), return_exceptions=True)
    out = {'cik': cik, 'secName': subs.get('name', ''), 'entityType': subs.get('entityType', ''),
           'category': subs.get('category', ''), 'sic': subs.get('sicDescription', ''), 'website': subs.get('website', ''),
           'state': (subs.get('addresses', {}).get('business') or {}).get('stateOrCountry', ''),
           'formerNames': [n.get('name') for n in subs.get('formerNames', [])][:3],
           'filings': filings[:30], 'formDCount': sum(1 for f in all_filings if f['form'] in ('D', 'D/A')), 'errors': {}}
    for key, result in zip(keys, results):
        if isinstance(result, Exception):
            out['errors'][key] = str(result)
            out[key] = None
        else:
            out[key] = result
    nav = out.pop('navData', None) or {}
    out['navNotes'], out['navHistory'] = nav.get('notes'), nav.get('history')
    if 'navData' in out['errors']:
        out['errors']['navNotes'] = out['errors'].pop('navData')
    if latest_d and out.get('formD'):
        out['formD'] = {**out['formD'], 'filed': latest_d['filed'], 'url': sec.filing_url(cik, latest_d['accession'], latest_d['document'])}
    return out


def _hit_rows(data):
    rows = {}
    for hit in data.get('hits', {}).get('hits', []):
        src = hit.get('_source', {})
        display = (src.get('display_names') or [''])[0]
        cik = _cik_from_display(display) or (int(src['ciks'][0]) if src.get('ciks') else None)
        if not cik:
            continue
        row = {'cik': cik, 'name': _clean_display(display), 'filed': src.get('file_date', ''), 'form': src.get('form') or src.get('root_form', ''),
               'accession': src.get('adsh', ''), 'location': (src.get('biz_locations') or [''])[0]}
        if cik not in rows or row['filed'] > rows[cik]['filed']:
            rows[cik] = row
    return sorted(rows.values(), key=lambda r: r['filed'], reverse=True)


@handler('alts.search_private')
async def search_private(ctx, msg):
    """Searches every Form D on EDGAR (private funds and companies raising money) by name or text."""
    query = str(msg.get('query') or '').strip()
    if len(query) < 3:
        raise EngineError('Type at least 3 letters')
    async def load():
        data = await efts(ctx, {'q': f'"{query}"', 'forms': 'D,D/A'})
        return _hit_rows(data)[:60]
    rows = await ctx.cached(('form-d-search', query.lower()), 6 * 3600, load, persist=True, stale_ok=True)
    return {'query': query, 'results': rows}


def parse_atom(xml_text):
    """Latest-filings feed: [(cik, accession, filed, title)]."""
    root = ET.fromstring(xml_text)
    out = []
    for entry in root.iter():
        if _local(entry.tag) != 'entry':
            continue
        link = next((el.get('href', '') for el in entry.iter() if _local(el.tag) == 'link'), '')
        m = re.search(r'/data/(\d+)/(\d{18})/', link)
        if not m:
            continue
        title = _text(entry, 'title')
        out.append((int(m.group(1)), m.group(2), _text(entry, 'updated')[:10], re.sub(r'^D(/A)?\s*-\s*', '', title)))
    return out


@handler('alts.latest_private')
async def latest_private(ctx, msg):
    """Private funds that just filed a Form D (new money being raised), newest first."""
    async def load():
        entries = parse_atom((await sec.sec_get(ctx, LATEST_FORM_D)).text)
        seen, picks = set(), []
        for cik, accession, filed, title in entries:
            if cik not in seen:
                seen.add(cik)
                picks.append((cik, accession, filed, title))

        async def one(item):
            cik, accession, filed, title = item
            try:
                d = await form_d(ctx, cik, accession)
            except Exception:
                return None
            if d['industry'] != 'Pooled Investment Fund':
                return None
            return {'cik': cik, 'name': d['name'] or re.sub(r'\s*\(\d+\).*$', '', title), 'filed': filed,
                    'fundType': d['fundType'], 'sold': d['sold'], 'offering': d['offering'], 'offeringText': d['offeringText'],
                    'minimum': d['minimum'], 'investors': d['investors'], 'state': d['state'], 'amendment': d['amendment'],
                    'url': sec.filing_url(cik, f'{accession[:10]}-{accession[10:12]}-{accession[12:]}', 'primary_doc.xml')}
        rows = await asyncio.gather(*(one(p) for p in picks[:45]))
        return [r for r in rows if r]
    return {'results': await ctx.cached('form-d-latest', 1800, load, persist=True, stale_ok=True)}
