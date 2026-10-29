"""
Family offices that never file Form ADV, found from free public records and linked to the prospect database.

A single-family office is exempt from adviser registration, so it is missing from the Form ADV lists. It still leaves
traces in other public records. Each collector below reads one free source, keeps the raw replies in cache.db
(`ctx.cached(..., persist=True, stale_ok=True)`) and saves what it found in prospect.db with the source URL and date
of every fact:

1. `sec_owners`: SEC Schedule 13D/13G filers (5%+ owners) and Forms 3/4/5 reporting owners (insiders) from the EDGAR
   daily indexes (master.YYYYMMDD.idx) and each filing's header (names, CIKs, addresses).
2. `liquidity`: Form 144 notices (planned sale of restricted shares), 8-K Item 2.01 (completed acquisition or
   disposition) at companies where an owner above holds 5%+ or is an insider, and S-1 selling shareholders.
3. `gleif`: the GLEIF LEI API: legal entities matched by legal name, with their direct and ultimate parents (family
   holding structures).
4. `propublica`: IRS Form 990-PF private foundations from ProPublica's Nonprofit Explorer API: address, care-of name,
   total assets. A foundation at the same address as an entity is a family-office signal.
5. `wikidata`: Wikidata SPARQL: US billionaires (net worth in US dollars) with the companies they founded.

`apply()` then groups the records (same address = strong, shared person names + same city = medium, the same legal
entity in GLEIF or an exact entity name = linked), matches each group to existing firms (same CIK or address = strong,
shared people + same city = medium, name only = weak, shown as "possible") and stores the evidence as `signals`.
A group with enough independent evidence and no Form ADV becomes a "Possible single-family office" (strong / moderate
/ weak signals, never certain) with the reasons listed.

Politeness: SEC requests go through prospect's shared SEC pacer (contact email in the User-Agent, well under 10 a
second); every other site gets at most one request a second. Each run is bounded (see the MAX_ constants).
UNVERIFIED LIVE: built in a sandbox that cannot reach sec.gov, propublica.org, gleif.org or wikidata.org; the
parsers follow the documented formats and are tested on hand-made fixtures (helper/tests/fixtures/prospect_sources/).
"""
import asyncio
import datetime as dt
import html
import json
import logging
import re
import time
import urllib.parse
from pathlib import Path

from . import prospect as pr
from .core import EngineError, background, handler

log = logging.getLogger('engine.prospect_sources')

TYPE_SFO = pr.TYPE_SFO

#: source key -> label and what it gives (the Data tab shows these)
SOURCES = {
    'sec_owners': {'label': 'SEC 5%+ owners and insiders (13D/13G, Forms 3/4/5)',
                   'what': 'People and holding companies that own 5%+ of a listed company or report as insiders, with their addresses.'},
    'liquidity': {'label': 'Liquidity events (Form 144, 8-K Item 2.01, S-1 sellers)',
                  'what': 'Planned sales of restricted shares, completed acquisitions at companies those owners hold, and S-1 selling shareholders.'},
    'gleif': {'label': 'GLEIF legal entities (LEI parents)',
              'what': 'Legal entities with their direct and ultimate parent companies, to map family holding structures.'},
    'propublica': {'label': 'Private foundations (IRS 990-PF via ProPublica)',
                   'what': 'Family foundations with address, care-of name and total assets. Same address as an entity = family-office signal.'},
    'wikidata': {'label': 'Notable founders (Wikidata)',
                 'what': 'US billionaires and the companies they founded, matched to owners of those companies.'},
}
ORDER = ('sec_owners', 'liquidity', 'gleif', 'propublica', 'wikidata')

DAYS = 30                 # EDGAR daily indexes read per run (calendar days back from yesterday)
MAX_OWNER_FILINGS = 1200  # 13D/13G and Forms 3/4/5 headers read per run
MAX_144 = 300
MAX_8K = 300
MAX_S1 = 10
MAX_GLEIF = 100           # entities looked up in GLEIF per run (up to 3 requests each)
MAX_PROPUBLICA = 150      # foundation searches per run
MAX_FOUNDATIONS = 300     # foundation records read per run
CROWDED = 4               # an address shared by more firms than this is an office building: no address match
WEB_GAP = 1.0             # seconds between requests to the same non-SEC site

DAILY_INDEX = 'https://www.sec.gov/Archives/edgar/daily-index/{y}/QTR{q}/master.{d}.idx'
ARCHIVES = 'https://www.sec.gov/Archives/'
FILING_PAGE = 'https://www.sec.gov/Archives/edgar/data/{cik}/{nodash}/{acc}-index.htm'
PROPUBLICA_SEARCH = 'https://projects.propublica.org/nonprofits/api/v2/search.json'
PROPUBLICA_ORG = 'https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json'
PROPUBLICA_PAGE = 'https://projects.propublica.org/nonprofits/organizations/{ein}'
GLEIF_RECORDS = 'https://api.gleif.org/api/v1/lei-records'
GLEIF_PAGE = 'https://search.gleif.org/#/record/{lei}'
WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
WIKIDATA_PAGE = 'https://www.wikidata.org/wiki/{q}'
UA = 'TradingPlatform/1.0 (personal research; https://github.com/cadenb777-jpg/trading-platform)'

OWNER_FORMS = {'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A'}
INSIDER_FORMS = {'3', '4', '5', '3/A', '4/A', '5/A'}

SCHEMA = """
CREATE TABLE IF NOT EXISTS src_entities (key TEXT PRIMARY KEY, source TEXT, name TEXT, kind TEXT, street TEXT, city TEXT,
  state TEXT, zip TEXT, info TEXT, url TEXT, date TEXT);
CREATE TABLE IF NOT EXISTS src_people (entity_key TEXT, name TEXT, title TEXT, source TEXT, url TEXT, date TEXT,
  UNIQUE (entity_key, name, source));
CREATE TABLE IF NOT EXISTS src_facts (entity_key TEXT, code TEXT, label TEXT, source TEXT, url TEXT, date TEXT,
  other_key TEXT, other_name TEXT, UNIQUE (entity_key, code, url, other_key));
CREATE INDEX IF NOT EXISTS src_facts_entity ON src_facts (entity_key);
"""

ENTITY_WORDS = re.compile(r'\b(llc|l\s?l\s?c|lp|l\s?p|llp|lllp|inc|incorporated|corp|corporation|co|company|ltd|limited|plc|trust|trustee|'
                          r'trusts|fund|funds|holdings?|partners|partnership|capital|management|group|associates|investments?|'
                          r'ventures|advisors|advisers|bank|foundation|family|office|estate|enterprises|equity|asset|assets|'
                          r'securities|financial|sa|ag|nv|bv|gmbh|se|n\.?a|l\.?p|fbo|endowment|university|irrevocable)\b', re.I)
ENTITY_HINT = re.compile(r'\b(family|holdings?|trust|partners|capital|investments?|ventures|foundation|llc|lp)\b', re.I)
PERSON_NOISE = {'JR', 'SR', 'II', 'III', 'IV', 'MR', 'MRS', 'MS', 'DR', 'TTEE', 'TRUSTEE', 'ET', 'AL', 'THE', 'AND', 'C', 'O'}


def connect(path=None):
    con = pr.connect(path)
    ensure_schema(con)
    return con


def ensure_schema(con):
    """Creates this module's tables one statement at a time (executescript would commit an open transaction)."""
    for stmt in SCHEMA.split(';'):
        if stmt.strip():
            con.execute(stmt)


# ---------- Names and addresses ----------

def is_person(name):
    """True when a filer name looks like a person ('SMITH JOHN A', 'John A. Smith'), not a company, trust or fund."""
    text = str(name or '').strip()
    if not text or ENTITY_WORDS.search(text) or re.search(r'\d', text):
        return False
    return 2 <= len(re.findall(r'[A-Za-z][A-Za-z\'.-]*', text)) <= 5


def person_tokens(name):
    return frozenset(t for t in re.findall(r'[A-Z]+', str(name or '').upper()) if len(t) > 1 and t not in PERSON_NOISE)


def same_person(a, b):
    """Two filings name the same person: 2+ name words in common and one name's words inside the other's
    ('SMITH JOHN A' = 'John Smith'). Middle initials are ignored."""
    ta, tb = person_tokens(a), person_tokens(b)
    return len(ta & tb) >= 2 and (ta <= tb or tb <= ta)


def surname(name):
    """'SMITH JOHN A' (EDGAR order) -> 'SMITH'; 'John A. Smith' -> 'SMITH'; 'SMITH FAMILY HOLDINGS LLC' -> 'SMITH'."""
    text = str(name or '').strip()
    words = re.findall(r'[A-Za-z][A-Za-z\'-]+', text)
    if not words:
        return ''
    m = re.search(r'([A-Za-z][A-Za-z\'-]+)\s+family\b', text, re.I)
    if m:
        return m.group(1).upper()
    if not is_person(text):
        return ''
    return (words[0] if text.isupper() else words[-1]).upper()


STREET_WORDS = {'STREET': 'ST', 'AVENUE': 'AVE', 'AV': 'AVE', 'ROAD': 'RD', 'BOULEVARD': 'BLVD', 'DRIVE': 'DR', 'LANE': 'LN',
                'PLACE': 'PL', 'PARKWAY': 'PKWY', 'HIGHWAY': 'HWY', 'CENTER': 'CTR', 'CENTRE': 'CTR', 'SQUARE': 'SQ',
                'COURT': 'CT', 'NORTH': 'N', 'SOUTH': 'S', 'EAST': 'E', 'WEST': 'W', 'SUITE': 'STE', 'FLOOR': 'FL',
                'FIRST': '1ST', 'SECOND': '2ND', 'THIRD': '3RD', 'FOURTH': '4TH', 'FIFTH': '5TH', 'SIXTH': '6TH',
                'SEVENTH': '7TH', 'EIGHTH': '8TH', 'NINTH': '9TH', 'TENTH': '10TH', 'PLAZA': 'PLZ', 'TERRACE': 'TER'}
SUITE = re.compile(r'\b(STE|FL|UNIT|RM|ROOM|APT|#)\s*([A-Z0-9-]+)\b')


def street_line(*lines):
    """The street line of an address, skipping 'C/O ...' and 'Attn' lines."""
    for line in lines:
        text = str(line or '').strip()
        if text and not re.match(r'^(c/o|c\\o|%|attn|attention)\b', text, re.I) and re.search(r'\d', text):
            return text
    return next((str(x).strip() for x in lines if x and not re.match(r'^(c/o|%|attn)', str(x).strip(), re.I)), '')


def address_parts(street, zip_code):
    """(base key, suite) for matching: '100 Main Street, Suite 5' + '06830-1234' -> ('100 MAIN ST|06830', '5')."""
    z = pr.zip5(zip_code)
    s = re.sub(r'[^A-Z0-9# ]', ' ', str(street or '').upper())
    s = ' '.join(STREET_WORDS.get(w, w) for w in s.split())
    suite = ''
    m = SUITE.search(s)
    if m:
        suite = m.group(2)
        s = (s[:m.start()] + s[m.end():]).strip()
    s = ' '.join(s.split())
    if not z or not re.match(r'\d', s):
        return '', ''
    return f'{s}|{z}', suite


def suites_agree(a, b):
    return not a or not b or a == b


# ---------- Parsers (pure) ----------

def parse_master_index(text):
    """EDGAR daily master index (pipe-separated: CIK|Company Name|Form Type|Date Filed|Filename) -> rows."""
    rows = []
    for line in str(text or '').splitlines():
        parts = line.split('|')
        if len(parts) != 5 or not parts[0].strip().isdigit():
            continue
        cik, name, form, date, path = (p.strip() for p in parts)
        m = re.search(r'(\d{10}-\d{2}-\d{6})', path)
        if not m:
            continue
        rows.append({'cik': int(cik), 'name': name, 'form': form.upper(), 'date': pr.parse_date(date) or _yyyymmdd(date),
                     'path': path, 'accession': m.group(1)})
    return rows


def _yyyymmdd(text):
    m = re.match(r'(\d{4})(\d{2})(\d{2})$', str(text or '').strip())
    return f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else ''


def group_filings(rows):
    """Index rows -> one entry per accession: {accession, form, date, path, names[(cik, name)]} (an index lists a
    filing once for each company or person on it)."""
    out = {}
    for r in rows:
        g = out.setdefault(r['accession'], {'accession': r['accession'], 'form': r['form'], 'date': r['date'], 'path': r['path'],
                                            'cik': r['cik'], 'names': []})
        g['names'].append((r['cik'], r['name']))
    return list(out.values())


def parse_header(text):
    """The SEC header of a full submission (.txt) -> {accession, form, filed, items[], parties[{role, name, cik,
    street, city, state, zip, careOf}]}. Roles are the header's own words: SUBJECT COMPANY, FILED BY, REPORTING-OWNER,
    ISSUER, FILER."""
    text = html.unescape(re.sub(r'<(?!/?SEC-HEADER)[^>]+>', '', str(text or '')))
    end = text.find('</SEC-HEADER>')
    if end >= 0:
        text = text[:end]
    out = {'accession': '', 'form': '', 'filed': '', 'items': [], 'parties': []}
    party, section = None, ''
    for raw in text.splitlines():
        if not raw.strip():
            continue
        m = re.match(r'^(\s*)([A-Z0-9][A-Z0-9 ,/()&.-]*?):\s*(.*?)\s*$', raw)
        if not m:
            continue
        indent, key, value = len(m.group(1).expandtabs(8)), m.group(2).strip(), m.group(3)
        if indent == 0:
            if not value and key not in ('ITEM INFORMATION',):
                party = {'role': key, 'name': '', 'cik': None, 'addr': {}, 'mail': {}}
                out['parties'].append(party)
                section = ''
            elif key == 'ACCESSION NUMBER':
                out['accession'] = value
            elif key == 'CONFORMED SUBMISSION TYPE':
                out['form'] = value.upper()
            elif key == 'FILED AS OF DATE':
                out['filed'] = _yyyymmdd(value) or pr.parse_date(value)
            elif key == 'ITEM INFORMATION' and value:
                out['items'].append(value)
            continue
        if party is None:
            continue
        if not value:
            section = key
            continue
        if key == 'COMPANY CONFORMED NAME' and section in ('COMPANY DATA', 'OWNER DATA', ''):
            party['name'] = value
        elif key == 'CENTRAL INDEX KEY' and section in ('COMPANY DATA', 'OWNER DATA', ''):
            party['cik'] = pr.clean_cik(value)
        elif section in ('BUSINESS ADDRESS', 'MAIL ADDRESS'):
            party['addr' if section == 'BUSINESS ADDRESS' else 'mail'][key] = value
    parties = []
    for p in out['parties']:
        if not p['name']:
            continue
        a = p['addr'] if p['addr'].get('STREET 1') or p['addr'].get('CITY') else p['mail']
        s1, s2 = a.get('STREET 1', ''), a.get('STREET 2', '')
        care = next((x for x in (s1, s2) if re.match(r'^(c/o|%)', x.strip(), re.I)), '')
        parties.append({'role': p['role'], 'name': p['name'], 'cik': p['cik'], 'street': street_line(s1, s2),
                        'city': a.get('CITY', ''), 'state': a.get('STATE', ''), 'zip': a.get('ZIP', ''),
                        'careOf': re.sub(r'^(c/o|%)\s*', '', care, flags=re.I)})
    out['parties'] = parties
    return out


def item_201(items):
    return any(re.search(r'2\.01|completion of acquisition or disposition', i, re.I) for i in items or [])


HOLDER_SKIP = re.compile(r'^(name|names|selling|total|all|beneficial|shares|number|percent|percentage|common|owned|offered|'
                         r'prior|after|before|stockholder|shareholder|holder|class|of|footnote|\*|-|—)\b', re.I)


def parse_selling_holders(text, limit=60):
    """Names in the first table after a 'Selling Stockholders/Shareholders' heading of an S-1 (heuristic: the first
    cell of each table row that looks like a name)."""
    text = str(text or '')
    found = None
    for m in re.finditer(r'SELLING\s+(?:STOCK|SHARE)HOLDERS?', text, re.I):
        rest = text[m.end():m.end() + 200000]
        t = re.search(r'<table', rest, re.I)
        if t and t.start() < 60000:
            found = rest[t.start():]
            break
    if found is None:
        return []
    end = re.search(r'</table>', found, re.I)
    table = found[:end.end()] if end else found[:100000]
    names = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.I | re.S):
        cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip()
                 for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.I | re.S)]
        cells = [c for c in cells if c]
        if not cells:
            continue
        name = re.sub(r'(\s*\(\d+\)|\*+|\s*\d+\s*$)', '', cells[0]).strip(' ,.')
        if 3 <= len(name) <= 90 and re.search(r'[A-Za-z]{2}', name) and not HOLDER_SKIP.match(name) and not re.match(r'^[\d$%(]', name):
            if name not in names:
                names.append(name)
        if len(names) >= limit:
            break
    return names


def parse_propublica_search(data, last_name):
    """ProPublica search reply -> EINs of organizations whose name has the family name and says foundation (or a
    charitable trust / fund)."""
    out = []
    for o in (data or {}).get('organizations') or []:
        name = str(o.get('name') or '')
        if re.search(rf'\b{re.escape(last_name)}\b', name, re.I) and re.search(r'foundation|charitable trust|family fund', name, re.I):
            if o.get('ein'):
                out.append(int(o['ein']))
    return out


def parse_propublica_org(data):
    """ProPublica organization reply -> a foundation record, or None when it is not a private foundation (IRS
    foundation code 2/3/4, or a 990-PF filing: formtype 2)."""
    org = (data or {}).get('organization') or {}
    if not org.get('ein'):
        return None
    filings = (data or {}).get('filings_with_data') or []
    pf = [f for f in filings if str(f.get('formtype')) == '2']
    code = str(org.get('foundation_code') or '')
    if not pf and code not in ('2', '3', '4'):
        return None
    latest = max(pf or filings, key=lambda f: str(f.get('tax_prd') or ''), default={})
    assets = latest.get('totassetsend') if latest else None
    if assets is None:
        assets = org.get('asset_amount')
    period = str(latest.get('tax_prd') or '') if latest else ''
    return {'ein': int(org['ein']), 'name': org.get('name') or '', 'careOf': re.sub(r'^(c/o|%)\s*', '', str(org.get('careofname') or ''), flags=re.I).strip(),
            'street': org.get('address') or '', 'city': org.get('city') or '', 'state': org.get('state') or '',
            'zip': str(org.get('zipcode') or ''), 'assets': pr.money(assets), 'taxPeriod': f'{period[:4]}-{period[4:6]}' if len(period) >= 6 else '',
            'pdf': (latest or {}).get('pdf_url') or ''}


def parse_gleif_record(rec):
    """One GLEIF LEI record (JSON:API) -> {lei, name, street, city, state, zip, country}."""
    if not rec:
        return None
    attrs = rec.get('attributes') or {}
    ent = attrs.get('entity') or {}
    addr = ent.get('headquartersAddress') or ent.get('legalAddress') or {}
    region = str(addr.get('region') or '')
    return {'lei': rec.get('id') or attrs.get('lei'), 'name': ((ent.get('legalName') or {}).get('name') or ''),
            'street': ' '.join(addr.get('addressLines') or []), 'city': addr.get('city') or '',
            'state': region.split('-', 1)[1] if region.startswith('US-') else region, 'zip': addr.get('postalCode') or '',
            'country': addr.get('country') or ''}


WIKIDATA_QUERY = """
SELECT ?person ?personLabel ?worth ?company ?companyLabel ?familyLabel WHERE {
  ?person wdt:P31 wd:Q5; wdt:P27 wd:Q30; p:P2218 ?st .
  ?st psv:P2218 [ wikibase:quantityAmount ?worth; wikibase:quantityUnit wd:Q4917 ] .
  FILTER(?worth >= 1000000000)
  OPTIONAL { ?company wdt:P112 ?person . }
  OPTIONAL { ?person wdt:P53 ?family . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 6000
"""


def parse_wikidata(data):
    """SPARQL JSON -> {Q-id: {name, worth, companies[], family}}."""
    out = {}
    for b in ((data or {}).get('results') or {}).get('bindings') or []:
        uri = (b.get('person') or {}).get('value', '')
        q = uri.rsplit('/', 1)[-1]
        if not q.startswith('Q'):
            continue
        p = out.setdefault(q, {'name': (b.get('personLabel') or {}).get('value', ''), 'worth': None, 'companies': [], 'family': ''})
        worth = pr.money((b.get('worth') or {}).get('value'))
        if worth and (p['worth'] or 0) < worth:
            p['worth'] = worth
        c = (b.get('companyLabel') or {}).get('value')
        if c and not re.match(r'^Q\d+$', c) and c not in p['companies']:
            p['companies'].append(c)
        fam = (b.get('familyLabel') or {}).get('value')
        if fam and not re.match(r'^Q\d+$', fam):
            p['family'] = fam
    return out


# ---------- Fetching (polite, cached) ----------

_web_last = {}
_web_lock = None


async def _web_pace(host):
    global _web_lock
    if _web_lock is None:
        _web_lock = asyncio.Lock()
    async with _web_lock:
        wait = _web_last.get(host, 0.0) + WEB_GAP - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _web_last[host] = time.monotonic()


async def sec_text(ctx, url, limit=None):
    """Text of an SEC URL (None on 404). With `limit`, reads only until the end of the SEC header or `limit` bytes."""
    pr._need_contact(ctx)
    for attempt in range(3):
        await pr._sec_pace()
        try:
            if limit:
                chunks, size = [], 0
                async with ctx.sec_http.stream('GET', url, headers={'Range': f'bytes=0-{limit - 1}'}, timeout=60) as resp:
                    if resp.status_code == 404:
                        return None
                    if resp.status_code == 403:
                        raise EngineError('The SEC refused the request. Check the SEC email in Settings, or wait 10 minutes (rate limit).')
                    if resp.status_code == 429 or resp.status_code >= 500:
                        raise _Busy()
                    resp.raise_for_status()
                    async for chunk in resp.aiter_bytes():
                        chunks.append(chunk)
                        size += len(chunk)
                        if size >= limit or b'</SEC-HEADER>' in chunk:
                            break
                return b''.join(chunks)[:limit].decode('utf-8', errors='replace')
            resp = await ctx.sec_http.get(url, timeout=60)
            if resp.status_code == 404:
                return None
            if resp.status_code == 403:
                raise EngineError('The SEC refused the request. Check the SEC email in Settings, or wait 10 minutes (rate limit).')
            if resp.status_code == 429 or resp.status_code >= 500:
                raise _Busy()
            resp.raise_for_status()
            return resp.text
        except _Busy:
            await asyncio.sleep(2 ** (attempt + 1))
    raise EngineError(f'The SEC stayed busy for {url.rsplit("/", 1)[-1]}; try again later.')


class _Busy(Exception):
    pass


async def web_json(ctx, url, params=None, headers=None):
    """JSON from a free public API (None on 404), at most one request a second per site, retrying 429/5xx."""
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(3):
        await _web_pace(host)
        resp = await ctx.http.get(url, params=params, headers={'User-Agent': UA, **(headers or {})}, timeout=60)
        if resp.status_code == 404:
            return None
        if resp.status_code == 429 or resp.status_code >= 500:
            await asyncio.sleep(2 ** (attempt + 1) * 2)
            continue
        resp.raise_for_status()
        return resp.json()
    raise EngineError(f'{host} stayed busy; try again later.')


async def daily_index(ctx, day):
    """One day's EDGAR master index rows (cached; a past day never changes). Weekends and holidays have none."""
    url = DAILY_INDEX.format(y=day.year, q=(day.month - 1) // 3 + 1, d=day.strftime('%Y%m%d'))

    async def load():
        text = await sec_text(ctx, url)
        return parse_master_index(text) if text else []
    return await ctx.cached(('psrc-idx', day.isoformat()), 60 * 86400, load, persist=True, stale_ok=True)


async def recent_index(ctx, days=DAYS, emit=None, today=None):
    today = today or dt.date.today()
    rows = []
    for k in range(1, days + 1):
        day = today - dt.timedelta(days=k)
        if day.weekday() >= 5:
            continue
        if emit and k % 5 == 1:
            await emit({'type': 'status', 'text': f'Reading EDGAR daily indexes ({k}/{days} days)'})
        rows += await daily_index(ctx, day)
    return rows


async def filing_header(ctx, path):
    """The parsed SEC header of one filing (the first 64 KB of its .txt; cached for a year: filings never change)."""
    async def load():
        text = await sec_text(ctx, ARCHIVES + path, limit=65536)
        if not text:
            return None
        end = text.find('</SEC-HEADER>')
        return text[:end + 13] if end >= 0 else text[:20000]
    raw = await ctx.cached(('psrc-head', path), 365 * 86400, load, persist=True, stale_ok=True)
    return parse_header(raw) if raw else None


def filing_url(cik, accession):
    return FILING_PAGE.format(cik=cik, nodash=accession.replace('-', ''), acc=accession)


# ---------- Saving ----------

def save_entity(con, key, source, name, kind, street='', city='', state='', zip_code='', info=None, url='', date=''):
    old = con.execute('SELECT date, street FROM src_entities WHERE key = ?', (key,)).fetchone()
    if old and (old['date'] or '') > (date or '') and old['street']:
        return  # keep the newer address
    con.execute('INSERT OR REPLACE INTO src_entities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (key, source, name, kind, street or '', city or '', (state or '').upper(), zip_code or '', json.dumps(info or {}), url, date))


def save_fact(con, entity_key, code, label, source, url, date, other_key='', other_name=''):
    con.execute('INSERT OR IGNORE INTO src_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                (entity_key, code, label, source, url, date, other_key, other_name))


def save_person(con, entity_key, name, title, source, url, date):
    con.execute('INSERT OR IGNORE INTO src_people VALUES (?, ?, ?, ?, ?, ?)', (entity_key, name, title, source, url, date))


def _record(con, key, info):
    pr.set_meta(con, f'sources:{key}', {**info, 'at': time.time()})
    con.commit()


def store_ownership(con, filing, head, source='sec_owners'):
    """Saves the owners (13D/13G filers, Form 3/4/5 reporting owners) and the company they hold from one header.
    Returns how many owners were saved."""
    form = (head.get('form') or filing['form']).upper()
    date = head.get('filed') or filing['date']
    url = filing_url(filing['cik'], filing['accession'])
    subject = next((p for p in head['parties'] if p['role'] in ('SUBJECT COMPANY', 'ISSUER')), None)
    owners = [p for p in head['parties'] if p['role'] in ('FILED BY', 'REPORTING-OWNER', 'FILER') and p is not subject]
    if not subject or not owners:
        return 0
    skey = f'sec-{subject["cik"]}' if subject['cik'] else ''
    if skey:
        save_entity(con, skey, source, subject['name'], 'issuer', subject['street'], subject['city'], subject['state'], subject['zip'], url=url, date=date)
    n = 0
    for o in owners:
        if not o['cik'] or o['cik'] == subject['cik']:
            continue
        okey = f'sec-{o["cik"]}'
        kind = 'person' if is_person(o['name']) else 'entity'
        save_entity(con, okey, source, o['name'], kind, o['street'], o['city'], o['state'], o['zip'], {'careOf': o['careOf']}, url, date)
        if form.replace('SCHEDULE', 'SC').startswith('SC 13'):
            active = '13D' in form
            label = f'Filed Schedule {"13D" if active else "13G"} on {subject["name"]}: owns 5% or more{" (active investor)" if active else ""}'
            save_fact(con, okey, 'owner_13d', label, f'SEC {form}', url, date, skey, subject['name'])
        else:
            save_fact(con, okey, 'insider', f'Reported as an insider (Form {form}) of {subject["name"]}', f'SEC Form {form}', url, date, skey, subject['name'])
        if o['careOf'] and is_person(o['name']):
            save_person(con, okey, o['name'], f'care of {o["careOf"]}', f'SEC Form {form}', url, date)
        n += 1
    return n


# ---------- Collectors ----------

async def collect_sec_owners(ctx, con, emit=None, today=None):
    rows = await recent_index(ctx, DAYS, emit, today)
    filings = group_filings(r for r in rows if r['form'] in OWNER_FORMS or r['form'] in INSIDER_FORMS)
    owner = [f for f in filings if f['form'] in OWNER_FORMS]
    insider = [f for f in filings if f['form'] in INSIDER_FORMS and any(ENTITY_HINT.search(n) for _, n in f['names'])]
    todo = sorted(owner, key=lambda f: f['date'], reverse=True)[:MAX_OWNER_FILINGS]
    todo += sorted(insider, key=lambda f: f['date'], reverse=True)[:max(0, MAX_OWNER_FILINGS - len(todo))]
    saved = failed = 0
    for i, f in enumerate(todo):
        if emit and i % 25 == 0:
            await emit({'type': 'status', 'text': f'Reading SEC ownership filings {i:,}/{len(todo):,}'})
        try:
            head = await filing_header(ctx, f['path'])
        except EngineError:
            raise
        except Exception as err:
            failed += 1
            log.info('Header %s unavailable: %s', f['path'], err)
            continue
        if head:
            saved += store_ownership(con, f, head)
        if i % 100 == 99:
            con.commit()
    con.commit()
    dates = [r['date'] for r in rows if r['date']]
    return {'filings': len(todo), 'owners': saved, 'failed': failed, 'sourceDate': max(dates) if dates else ''}


async def collect_liquidity(ctx, con, emit=None, today=None):
    rows = await recent_index(ctx, DAYS, emit, today)
    filings = group_filings(rows)
    issuers = {int(r['key'][4:]) for r in con.execute("SELECT key FROM src_entities WHERE kind = 'issuer' AND key LIKE 'sec-%'")}
    f144 = sorted((f for f in filings if f['form'] in ('144', '144/A')), key=lambda f: f['date'], reverse=True)[:MAX_144]
    f8k = sorted((f for f in filings if f['form'] in ('8-K', '8-K/A') and any(c in issuers for c, _ in f['names'])),
                 key=lambda f: f['date'], reverse=True)[:MAX_8K]
    s1 = sorted((f for f in filings if f['form'] == 'S-1'), key=lambda f: f['date'], reverse=True)[:MAX_S1]
    events = 0
    total = len(f144) + len(f8k) + len(s1)
    for i, f in enumerate(f144 + f8k):
        if emit and i % 25 == 0:
            await emit({'type': 'status', 'text': f'Reading liquidity filings {i:,}/{total:,}'})
        try:
            head = await filing_header(ctx, f['path'])
        except EngineError:
            raise
        except Exception as err:
            log.info('Header %s unavailable: %s', f['path'], err)
            continue
        if not head:
            continue
        url, date = filing_url(f['cik'], f['accession']), head.get('filed') or f['date']
        if f['form'].startswith('144'):
            subject = next((p for p in head['parties'] if p['role'] in ('SUBJECT COMPANY', 'ISSUER')), None)
            for p in head['parties']:
                if p is subject or not p['cik'] or p['role'] not in ('FILED BY', 'REPORTING-OWNER', 'FILER'):
                    continue
                key = f'sec-{p["cik"]}'
                save_entity(con, key, 'liquidity', p['name'], 'person' if is_person(p['name']) else 'entity', p['street'], p['city'], p['state'], p['zip'], url=url, date=date)
                what = subject['name'] if subject else 'a listed company'
                save_fact(con, key, 'liquidity', f'Form 144: notice of a planned sale of restricted {what} shares', 'SEC Form 144', url, date,
                          f'sec-{subject["cik"]}' if subject and subject['cik'] else '', what)
                events += 1
        elif item_201(head['items']):
            company = next((p for p in head['parties'] if p['cik'] in issuers), None) or (head['parties'][0] if head['parties'] else None)
            if not company:
                continue
            ckey = f'sec-{company["cik"]}'
            for r in con.execute("SELECT DISTINCT entity_key FROM src_facts WHERE other_key = ? AND code IN ('owner_13d', 'insider')", (ckey,)).fetchall():
                save_fact(con, r['entity_key'], 'liquidity',
                          f'{company["name"]} reported a completed acquisition or disposition (8-K Item 2.01) while this owner held a stake',
                          'SEC Form 8-K Item 2.01', url, date, ckey, company['name'])
                events += 1
    for i, f in enumerate(s1):
        if emit:
            await emit({'type': 'status', 'text': f'Reading S-1 selling shareholders {len(f144) + len(f8k) + i:,}/{total:,}'})

        async def load(path=f['path']):
            text = await sec_text(ctx, ARCHIVES + path, limit=6_000_000)
            return parse_selling_holders(text or '')
        try:
            holders = await ctx.cached(('psrc-s1', f['path']), 365 * 86400, load, persist=True, stale_ok=True)
        except EngineError:
            raise
        except Exception as err:
            log.info('S-1 %s unavailable: %s', f['path'], err)
            continue
        issuer = f['names'][0][1] if f['names'] else 'a company'
        url = filing_url(f['cik'], f['accession'])
        for name in holders or []:
            key = 's1-' + (pr.normalize_name(name) or name.lower()).replace(' ', '-')[:80]
            save_entity(con, key, 'liquidity', name, 'person' if is_person(name) else 'entity', url=url, date=f['date'])
            save_fact(con, key, 'liquidity', f'Named as a selling shareholder in the S-1 of {issuer}', 'SEC Form S-1', url, f['date'], f'sec-{f["cik"]}', issuer)
            events += 1
    con.commit()
    return {'form144': len(f144), 'form8k': len(f8k), 's1': len(s1), 'events': events}


async def collect_gleif(ctx, con, emit=None):
    todo = [dict(r) for r in con.execute(
        "SELECT e.key, e.name, e.city, e.state, COUNT(f.code) AS n FROM src_entities e LEFT JOIN src_facts f ON f.entity_key = e.key "
        "WHERE e.kind = 'entity' AND e.key LIKE 'sec-%' GROUP BY e.key ORDER BY n DESC, e.key LIMIT ?", (MAX_GLEIF,))]
    found = parents = errors = 0
    last_error = None
    for i, e in enumerate(todo):
        if emit and i % 10 == 0:
            await emit({'type': 'status', 'text': f'Looking up legal entities in GLEIF {i:,}/{len(todo):,}'})
        params = {'filter[entity.legalName]': e['name'], 'page[size]': 5}
        try:
            data = await ctx.cached(('psrc-gleif', e['name']), 30 * 86400, lambda p=params: web_json(ctx, GLEIF_RECORDS, p), persist=True, stale_ok=True)
        except Exception as err:
            log.info('GLEIF lookup %s failed: %s', e['name'], err)
            errors, last_error = errors + 1, err
            continue
        best = None
        for rec in (data or {}).get('data') or []:
            r = parse_gleif_record(rec)
            if not r or not r['lei']:
                continue
            score, _ = pr.match_score({'name': e['name'], 'city': e['city'], 'state': e['state']}, r)
            if score >= 0.92 and (not e['state'] or not r['state'] or e['state'].upper() == r['state'].upper()):
                best = r
                break
        if not best:
            continue
        found += 1
        lkey, today = f'lei-{best["lei"]}', dt.date.today().isoformat()
        save_entity(con, lkey, 'gleif', best['name'], 'lei', best['street'], best['city'], best['state'], best['zip'], {'country': best['country']},
                    GLEIF_PAGE.format(lei=best['lei']), today)
        save_fact(con, lkey, 'same_as', f'GLEIF legal entity (LEI {best["lei"]}) with the same name as the SEC filer', 'GLEIF LEI record',
                  GLEIF_PAGE.format(lei=best['lei']), today, e['key'], e['name'])
        for rel, word in (('direct-parent', 'direct'), ('ultimate-parent', 'ultimate')):
            url = f'{GLEIF_RECORDS}/{best["lei"]}/{rel}'
            try:
                pdata = await ctx.cached(('psrc-gleif-rel', best['lei'], rel), 30 * 86400, lambda u=url: web_json(ctx, u), persist=True, stale_ok=True)
            except Exception as err:
                log.info('GLEIF %s of %s failed: %s', rel, best['lei'], err)
                continue
            p = parse_gleif_record((pdata or {}).get('data'))
            if not p or not p['lei'] or p['lei'] == best['lei']:
                continue
            pkey = f'lei-{p["lei"]}'
            save_entity(con, pkey, 'gleif', p['name'], 'lei', p['street'], p['city'], p['state'], p['zip'], {'country': p['country']},
                        GLEIF_PAGE.format(lei=p['lei']), today)
            save_fact(con, lkey, 'lei_parent', f'GLEIF: {word} parent is {p["name"]} (LEI {p["lei"]})', 'GLEIF relationship record',
                      GLEIF_PAGE.format(lei=best['lei']), today, pkey, p['name'])
            parents += 1
        con.commit()
    con.commit()
    _all_failed(len(todo), errors, last_error, 'GLEIF')
    return {'looked': len(todo), 'matched': found, 'parents': parents, 'failed': errors}


def _all_failed(tried, errors, last_error, site):
    """A source whose every lookup failed is reported as failed (the site is down or changed), not as "nothing found"."""
    if tried and errors == tried:
        raise EngineError(f'{site} could not be reached ({pr.short_reason(last_error)}); nothing was updated from it.')


async def collect_propublica(ctx, con, emit=None):
    """Family foundations for the family names among the owners found (people and '<Name> Family ...' entities),
    searched in the owner's state."""
    terms = []
    for r in con.execute("SELECT e.name, e.state, COUNT(f.code) AS n FROM src_entities e LEFT JOIN src_facts f ON f.entity_key = e.key "
                         "WHERE e.kind IN ('person', 'entity') AND e.state != '' GROUP BY e.key ORDER BY n DESC"):
        last = surname(r['name'])
        if len(last) >= 3 and (last, r['state']) not in terms:
            terms.append((last, r['state']))
        if len(terms) >= MAX_PROPUBLICA:
            break
    eins, errors, last_error = [], 0, None
    for i, (last, state) in enumerate(terms):
        if emit and i % 10 == 0:
            await emit({'type': 'status', 'text': f'Searching private foundations (ProPublica) {i:,}/{len(terms):,}'})
        params = {'q': f'{last} foundation', 'state[id]': state}
        try:
            data = await ctx.cached(('psrc-pp-search', last, state), 30 * 86400, lambda p=params: web_json(ctx, PROPUBLICA_SEARCH, p), persist=True, stale_ok=True)
        except Exception as err:
            log.info('ProPublica search %s %s failed: %s', last, state, err)
            errors, last_error = errors + 1, err
            continue
        eins += [e for e in parse_propublica_search(data, last) if e not in eins]
    _all_failed(len(terms), errors, last_error, 'ProPublica')
    saved = 0
    for i, ein in enumerate(eins[:MAX_FOUNDATIONS]):
        if emit and i % 10 == 0:
            await emit({'type': 'status', 'text': f'Reading foundation records {i:,}/{min(len(eins), MAX_FOUNDATIONS):,}'})
        try:
            data = await ctx.cached(('psrc-pp-org', ein), 30 * 86400, lambda e=ein: web_json(ctx, PROPUBLICA_ORG.format(ein=e)), persist=True, stale_ok=True)
        except Exception as err:
            log.info('ProPublica org %s failed: %s', ein, err)
            continue
        f = parse_propublica_org(data)
        if not f:
            continue
        key, url = f'ein-{f["ein"]}', PROPUBLICA_PAGE.format(ein=f['ein'])
        date = f['taxPeriod'] or dt.date.today().isoformat()
        save_entity(con, key, 'propublica', f['name'], 'foundation', f['street'], f['city'], f['state'], f['zip'],
                    {'assets': f['assets'], 'careOf': f['careOf'], 'pdf': f['pdf']}, url, date)
        assets = f' with total assets of {pr_money(f["assets"])}' if f['assets'] else ''
        save_fact(con, key, 'foundation', f'Private foundation (Form 990-PF){assets}{" for tax year " + f["taxPeriod"][:4] if f["taxPeriod"] else ""}',
                  'IRS Form 990-PF (ProPublica Nonprofit Explorer)', url, date)
        if f['careOf']:
            save_person(con, key, f['careOf'], 'care of (990-PF)', 'IRS Form 990-PF (ProPublica)', url, date)
        saved += 1
    con.commit()
    return {'searches': len(terms), 'foundations': saved}


def pr_money(v):
    if v is None:
        return 'not reported'
    return f'${v / 1e9:,.2f}B' if v >= 1e9 else f'${v / 1e6:,.1f}M' if v >= 1e6 else f'${v:,.0f}'


async def collect_wikidata(ctx, con, emit=None):
    if emit:
        await emit({'type': 'status', 'text': 'Asking Wikidata for notable founders'})
    data = await ctx.cached(('psrc-wikidata',), 30 * 86400,
                            lambda: web_json(ctx, WIKIDATA_SPARQL, {'query': WIKIDATA_QUERY, 'format': 'json'}, {'Accept': 'application/sparql-results+json'}),
                            persist=True, stale_ok=True)
    people = parse_wikidata(data)
    today = dt.date.today().isoformat()
    con.execute("DELETE FROM src_entities WHERE kind = 'notable'")
    for q, p in people.items():
        save_entity(con, f'wd-{q}', 'wikidata', p['name'], 'notable', info={'worth': p['worth'], 'companies': p['companies'], 'family': p['family']},
                    url=WIKIDATA_PAGE.format(q=q), date=today)
    con.commit()
    return {'people': len(people)}


COLLECTORS = {'sec_owners': collect_sec_owners, 'liquidity': collect_liquidity, 'gleif': collect_gleif,
              'propublica': collect_propublica, 'wikidata': collect_wikidata}


# ---------- Grouping, matching and the "Possible single-family office" label (pure SQL + Python) ----------

class _Groups:
    def __init__(self, keys):
        self.parent = {k: k for k in keys}

    def find(self, k):
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def union(self, a, b):
        if a in self.parent and b in self.parent:
            ra, rb = self.find(a), self.find(b)
            if ra != rb:
                self.parent[max(ra, rb)] = min(ra, rb)


#: evidence code -> points toward "Possible single-family office" (each code counts once per group)
POINTS = {'foundation_address': 2, 'foundation_people': 1, 'owner_13d': 1, 'insider': 1, 'name_strong': 2, 'name_weak': 1,
          'lei_structure': 1, 'wikidata': 1, 'liquidity': 1}
SOURCE_LABEL = {'sec_owners': 'SEC ownership filing', 'liquidity': 'SEC liquidity filing', 'gleif': 'GLEIF', 'propublica': 'IRS 990-PF',
                'wikidata': 'Wikidata'}
STRONG, MEDIUM = 0.95, 0.75


def confidence_for(points):
    return 'strong signals' if points >= 5 else 'moderate signals' if points >= 4 else 'weak signals'


def apply(con):
    """Rebuilds what this module adds to the firm list from the saved records: groups, links, signals and the
    "Possible single-family office" firms. Safe to run again at any time (it first removes its own rows)."""
    ensure_schema(con)
    con.execute('CREATE TABLE IF NOT EXISTS signals (firm_id TEXT, entity_key TEXT, code TEXT, label TEXT, source TEXT, url TEXT, date TEXT, method TEXT, score REAL)')
    # undo the last run: our firms, links, signals, people and any type we upgraded
    upgraded = pr.get_meta(con, 'sfo_upgrades', {}) or {}
    for fid, old in upgraded.items():
        con.execute('UPDATE firms SET type = ?, confidence = ?, reasons = ? WHERE id = ? AND type = ?',
                    (old['type'], old['confidence'], old['reasons'], fid, TYPE_SFO))
    con.execute("DELETE FROM firms WHERE id LIKE 'sfo-%'")
    con.execute("DELETE FROM links WHERE source LIKE 'Public records:%'")
    con.execute('DELETE FROM signals')
    con.execute("DELETE FROM people WHERE source LIKE 'Public records:%'")

    ents = {r['key']: dict(r) for r in con.execute('SELECT * FROM src_entities')}
    for e in ents.values():
        e['info'] = json.loads(e['info'] or '{}')
        e['base'], e['suite'] = address_parts(e['street'], e['zip'])
    facts = {}
    for r in con.execute('SELECT * FROM src_facts ORDER BY date DESC'):
        facts.setdefault(r['entity_key'], []).append(dict(r))
    people = {}
    for r in con.execute('SELECT * FROM src_people'):
        people.setdefault(r['entity_key'], []).append(dict(r))
    pool = [k for k, e in ents.items() if e['kind'] in ('person', 'entity', 'foundation', 'lei')]
    groups = _Groups(pool)

    firms = [dict(r) for r in con.execute('SELECT id, name, other_names, type, confidence, reasons, crd, cik, street, city, state, zip FROM firms')]
    firm_addr = {}
    for f in firms:
        base, suite = address_parts(f['street'], f['zip'])
        if base:
            firm_addr.setdefault(base, []).append((f, suite))
    crowded = {b for b, fs in firm_addr.items() if len({f['id'] for f, _ in fs}) > CROWDED}
    for fs in firm_addr.values():  # at a shared address, a firm without Form ADV is the likelier family office
        fs.sort(key=lambda x: (x[0]['crd'] is not None, x[0]['id']))

    # 1. same address (strong): records at one street address and ZIP, unless it is a crowded office building
    by_addr = {}
    for k in pool:
        if ents[k]['base'] and ents[k]['base'] not in crowded:
            by_addr.setdefault(ents[k]['base'], []).append(k)
    for keys in by_addr.values():
        if len(keys) > 15:
            continue
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                if suites_agree(ents[a]['suite'], ents[b]['suite']):
                    groups.union(a, b)
    # 2. the same legal entity in GLEIF, and GLEIF parents (a holding structure)
    for k in pool:
        for f in facts.get(k, []):
            if f['code'] in ('same_as', 'lei_parent'):
                groups.union(k, f['other_key'])
    # 3. exact entity name (an S-1 seller and the SEC filer of the same name)
    by_name = {}
    for k in pool:
        if ents[k]['kind'] in ('entity', 'lei'):
            n = pr.normalize_name(ents[k]['name'])
            if n and len(n) > 6:
                by_name.setdefault(n, []).append(k)
    for keys in by_name.values():
        for b in keys[1:]:
            groups.union(keys[0], b)
    # 4. shared person names + same city (medium): a foundation's care-of person who also files as an owner there
    named = [(k, ents[k]['name']) for k in pool if ents[k]['kind'] == 'person']
    named += [(k, p['name']) for k in pool for p in people.get(k, [])]
    shared_people = set()
    by_city = {}
    for k, name in named:
        city = (ents[k]['city'] or '').upper()
        if city and is_person(name):
            by_city.setdefault((city, ents[k]['state']), []).append((k, name))
    for items in by_city.values():
        for i, (a, na) in enumerate(items):
            for b, nb in items[i + 1:]:
                if a != b and same_person(na, nb):
                    if groups.find(a) != groups.find(b):
                        shared_people.add(groups.find(a))
                        shared_people.add(groups.find(b))
                    groups.union(a, b)
    clusters = {}
    for k in pool:
        clusters.setdefault(groups.find(k), []).append(k)
    shared_roots = {groups.find(k) for k in shared_people}

    people_by_firm_city = {}
    for r in con.execute('SELECT p.name, f.id, f.city, f.state FROM people p JOIN firms f ON f.id = p.firm_id WHERE f.city != \'\''):
        people_by_firm_city.setdefault(((r['city'] or '').upper(), (r['state'] or '').upper()), []).append((r['name'], r['id']))
    by_cik = {f['cik']: f for f in firms if f['cik']}
    by_id = {f['id']: f for f in firms}
    index = pr.NameIndex([{'name': f['name'], 'city': f['city'], 'state': f['state'], 'zip': f['zip'], 'id': f['id']} for f in firms])
    notables = [e for e in ents.values() if e['kind'] == 'notable']

    links, signals, new_firms, new_people, upgrades = [], [], [], [], {}
    for root, keys in clusters.items():
        members = [ents[k] for k in keys]
        evidence = []  # (code, label, source, url, date, entity key)
        kinds = {e['kind'] for e in members}
        families = {'SEC' if e['source'] in ('sec_owners', 'liquidity') else e['source'] for e in members}
        for e in members:
            for f in facts.get(e['key'], []):
                if f['code'] in ('owner_13d', 'insider', 'liquidity', 'foundation', 'lei_parent'):
                    evidence.append((f['code'], f['label'], f['source'], f['url'], f['date'], e['key']))
        foundations = [e for e in members if e['kind'] == 'foundation']
        others = [e for e in members if e['kind'] != 'foundation']
        for fnd in foundations:
            same = next((o for o in others if o['base'] and o['base'] == fnd['base']), None)
            if same:
                evidence.append(('foundation_address', f'990-PF foundation "{fnd["name"]}" at the same address as {same["name"]}',
                                 'IRS Form 990-PF (ProPublica)', fnd['url'], fnd['date'], fnd['key']))
            elif others and root in shared_roots:
                evidence.append(('foundation_people', f'990-PF foundation "{fnd["name"]}" shares a person\'s name with these filers in the same city',
                                 'IRS Form 990-PF (ProPublica)', fnd['url'], fnd['date'], fnd['key']))
        leis = [e for e in members if e['kind'] == 'lei']
        if len(leis) >= 2:
            evidence.append(('lei_structure', f'GLEIF shows a holding structure of {len(leis)} related legal entities', 'GLEIF',
                             leis[0]['url'], leis[0]['date'], leis[0]['key']))
        strength, name_reason, name_key = 0, '', None
        for e in members:
            if e['kind'] in ('entity', 'lei'):
                s, reason = pr.family_office_name(e['name'])
                if s > strength:
                    strength, name_reason, name_key = s, f'{e["name"]}: {reason}', e['key']
        if strength:
            src = ents[name_key]
            evidence.append(('name_strong' if strength == 2 else 'name_weak', name_reason, SOURCE_LABEL.get(src['source'], src['source']),
                             src['url'], src['date'], name_key))
        held = {f['other_name'] for e in members for f in facts.get(e['key'], []) if f['code'] in ('owner_13d', 'insider') and f['other_name']}
        lasts = {surname(e['name']) for e in members if e['kind'] in ('person', 'entity')} - {''}
        for n in notables:
            last = (re.findall(r'[A-Za-z\'-]+', n['name']) or [''])[-1].upper()
            if last not in lasts:
                continue
            founded = [c for c in n['info'].get('companies', []) if any(pr.name_similarity(c, h) >= 0.9 for h in held)]
            family_word = n['info'].get('family') and any(re.search(rf'\b{re.escape(last)}\s+family\b', e['name'], re.I) for e in members)
            if founded or family_word:
                worth = n['info'].get('worth')
                what = f'founder of {founded[0]}' if founded else n['info']['family']
                evidence.append(('wikidata', f'Wikidata: {n["name"]} ({what}{", net worth about " + pr_money(worth) if worth else ""}) shares the family name',
                                 'Wikidata', n['url'], n['date'], n['key']))
                break
        if not evidence:
            continue
        seen = set()
        evidence = [ev for ev in evidence if not (ev[1] in seen or seen.add(ev[1]))]  # one line per distinct fact
        codes = {ev[0] for ev in evidence}
        points = sum(POINTS.get(c, 0) for c in codes)

        # match the group to an existing firm
        best, best_score, best_method = None, 0.0, ''
        for e in members:
            if e['key'].startswith('sec-'):
                f = by_cik.get(int(e['key'][4:]))
                if f and best_score < 1.0:
                    best, best_score, best_method = f, 1.0, f'same SEC CIK ({e["name"]})'
            if e['base'] and e['base'] not in crowded and best_score < STRONG:
                for f, suite in firm_addr.get(e['base'], []):
                    if suites_agree(suite, e['suite']):
                        best, best_score, best_method = f, STRONG, f'same address ({e["street"]}, {pr.zip5(e["zip"])}) as {e["name"]}'
                        break
        if best_score < MEDIUM:
            for e in members:
                names = [e['name']] if e['kind'] == 'person' else []
                names += [p['name'] for p in people.get(e['key'], [])]
                for name in names:
                    for pname, fid in people_by_firm_city.get(((e['city'] or '').upper(), (e['state'] or '').upper()), []):
                        if same_person(name, pname):
                            best, best_score, best_method = by_id[fid], MEDIUM, f'shared person ({pname}) and same city ({e["city"]})'
                            break
                    if best_score >= MEDIUM:
                        break
        weak = None
        if best_score < MEDIUM:
            for e in members:
                if e['kind'] in ('entity', 'lei', 'foundation'):
                    cand, s, reasons = index.best({'name': e['name'], 'city': e['city'], 'state': e['state'], 'zip': e['zip']})
                    if cand and s >= pr.POSSIBLE_SCORE and (not weak or s > weak[1]):
                        weak = (by_id[cand['id']], s, 'name only (weak): ' + ', '.join(reasons), e)

        main = sorted(members, key=lambda e: ({'entity': 0, 'lei': 1, 'foundation': 2, 'person': 3}[e['kind']],
                                              -len(facts.get(e['key'], [])), e['key']))[0]
        qualifies = (points >= 3 and (len(families) >= 2 or 'name_strong' in codes or len(kinds - {'person'}) >= 2)
                     and not (pr.INSTITUTION.search(main['name'] or '') and strength < 2))
        target = None
        if best_score >= MEDIUM:
            target = best['id']
            if qualifies and best['type'] in (pr.TYPE_13F, pr.TYPE_FORMD):
                upgrades[target] = {'type': best['type'], 'confidence': best['confidence'], 'reasons': best['reasons']}
                reasons = json.loads(best['reasons'] or '[]') + [ev[1] for ev in evidence] + [
                    'files no Form ADV: single-family offices are exempt from adviser registration (Rule 202(a)(11)(G)-1)']
                con.execute('UPDATE firms SET type = ?, confidence = ?, reasons = ? WHERE id = ?',
                            (TYPE_SFO, confidence_for(points), json.dumps(reasons), target))
            for e in members:
                links.append((target, f'Public records: {SOURCE_LABEL.get(e["source"], e["source"])}', e['key'], best_method, best_score, 'linked', e['name']))
        elif qualifies:
            target = 'sfo-' + main['key']
            reasons = [ev[1] for ev in evidence] + ['no Form ADV found: single-family offices are exempt from adviser registration (Rule 202(a)(11)(G)-1)',
                                                    'an educated guess from public records; check before relying on it']
            other = sorted({e['name'] for e in members if e['kind'] in ('entity', 'lei') and pr.normalize_name(e['name']) != pr.normalize_name(main['name'])})[:8]
            located = next((e for e in [main] + members if e['street'] or e['zip']), main)
            new_firms.append((target, main['name'], json.dumps(other), TYPE_SFO, confidence_for(points), json.dumps(reasons), None, None,
                              int(main['key'][4:]) if main['key'].startswith('sec-') else None, located['street'], located['city'],
                              (located['state'] or '').upper(), located['zip'], '', '', None, None, None, '', ',', None, '',
                              max((ev[4] or '' for ev in evidence), default=''), 0, None, None, 0, None, 0, None, None, ''))
            for e in members:
                links.append((target, f'Public records: {SOURCE_LABEL.get(e["source"], e["source"])}', e['key'], 'grouped: ' + (
                    'same address' if e['base'] and e['base'] == main['base'] else 'related record'), 1.0 if e is main else 0.9, 'linked', e['name']))
                if e['kind'] == 'person':
                    new_people.append((target, target, e['name'], 'files as an owner at this address', f'Public records: {SOURCE_LABEL.get(e["source"], e["source"])}',
                                       e['url'], 0, e['date'], ''))
                for p in people.get(e['key'], []):
                    new_people.append((target, target, p['name'], p['title'], f'Public records: {p["source"]}', p['url'], 0, p['date'], ''))
        if weak and (target is None or weak[0]['id'] != target):
            f, s, method, e = weak
            links.append((f['id'], f'Public records: {SOURCE_LABEL.get(e["source"], e["source"])}', e['key'], method, round(min(0.6, s * 0.6), 3), 'possible', e['name']))
        if target:
            method = best_method if best_score >= MEDIUM else 'grouped public records'
            score = best_score if best_score >= MEDIUM else 1.0
            for code, label, source, url, date, key in evidence:
                signals.append((target, key, code, label, source, url, date, method, score))

    zcta = {r['zip']: (r['lat'], r['lon']) for r in con.execute('SELECT zip, lat, lon FROM zcta')}
    rows = []
    for r in new_firms:
        point = zcta.get(pr.zip5(r[12]))
        rows.append(r[:29] + ((point[0], point[1], 'zip') if point else (None, None, '')))
    con.executemany(f'INSERT OR REPLACE INTO firms VALUES ({",".join("?" * 32)})', rows)
    con.executemany('INSERT INTO links VALUES (?, ?, ?, ?, ?, ?, ?)', links)
    con.executemany('INSERT INTO signals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', signals)
    con.executemany('INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', new_people)
    pr.set_meta(con, 'sfo_upgrades', upgrades)
    summary = {'at': time.time(), 'groups': len(clusters), 'newFirms': len(rows), 'upgraded': len(upgrades), 'signals': len(signals),
               'linkedFirms': len({s[0] for s in signals})}
    pr.set_meta(con, 'sources:applied', summary)
    return summary


def apply_db(db_path=None):
    con = connect(db_path)
    try:
        with con:
            return apply(con)
    finally:
        con.close()


# ---------- Jobs and status ----------

JOB = {'running': False}
_lock = None


async def run_refresh(ctx, keys=None, emit=None, db_path=None):
    """Runs the chosen collectors (all by default) one after another, then rebuilds the links and signals. A source
    that fails is recorded with its reason; the others still run."""
    global _lock
    db_path = Path(db_path or pr.DB_PATH)
    keys = [k for k in ORDER if k in (keys or ORDER)]
    if _lock is None:
        _lock = asyncio.Lock()
    if _lock.locked():
        raise EngineError('Public records are already being refreshed; watch the Data tab for progress.')
    async with _lock:
        JOB.clear()
        JOB.update({'running': True, 'sources': keys, 'started': time.time(), 'stage': 'Starting', 'error': None})

        async def note(e):
            JOB['stage'] = e.get('text', JOB['stage'])
            if emit:
                await emit(e)
        out, problems = {}, []
        try:
            for key in keys:
                JOB['current'] = key
                await note({'type': 'status', 'text': f'{SOURCES[key]["label"]}: starting'})
                con = connect(db_path)
                try:
                    result = await COLLECTORS[key](ctx, con, note)
                    _record(con, key, {'ok': True, **result, 'error': None})
                    out[key] = result
                except Exception as err:
                    log.warning('Public records source %s failed: %s', key, err)
                    old = pr.get_meta(con, f'sources:{key}', {}) or {}
                    _record(con, key, {**{k: v for k, v in old.items() if k != 'at'}, 'ok': False, 'error': pr.short_reason(err),
                                       'lastGood': old.get('at') if old.get('ok') else old.get('lastGood')})
                    out[key] = {'error': pr.short_reason(err)}
                    problems.append(f'{SOURCES[key]["label"]}: {pr.short_reason(err)}')
                finally:
                    con.close()
            await note({'type': 'status', 'text': 'Linking public records to firms'})
            out['applied'] = await asyncio.to_thread(apply_db, db_path)
            JOB.update({'running': False, 'finished': time.time(), 'current': None, 'stage': 'Done with problems' if problems else 'Done',
                        'error': ' '.join(problems) or None})
            return out
        except Exception as err:
            JOB.update({'running': False, 'finished': time.time(), 'current': None, 'stage': 'Failed', 'error': pr.short_reason(err)})
            raise


def status(con):
    ensure_schema(con)
    counts = {
        'entities': con.execute("SELECT COUNT(*) FROM src_entities WHERE kind != 'issuer' AND kind != 'notable'").fetchone()[0],
        'facts': con.execute('SELECT COUNT(*) FROM src_facts').fetchone()[0],
        'signals': con.execute('SELECT COUNT(*) FROM signals').fetchone()[0],
        'possibleSfo': con.execute('SELECT COUNT(*) FROM firms WHERE type = ?', (TYPE_SFO,)).fetchone()[0],
        'liquidity': con.execute("SELECT COUNT(DISTINCT firm_id) FROM signals WHERE code = 'liquidity' AND date >= ?",
                                 ((dt.date.today() - dt.timedelta(days=pr.RECENT_LIQUIDITY_DAYS)).isoformat(),)).fetchone()[0],
    }
    return {'sources': [{'key': k, **SOURCES[k], 'last': pr.get_meta(con, f'sources:{k}')} for k in ORDER],
            'applied': pr.get_meta(con, 'sources:applied'), 'counts': counts, 'job': dict(JOB)}


@handler('prospect.sources.status')
async def h_sources_status(ctx, msg):
    """Each public-records source with its last refresh (time, counts, error), the last linking run and any job."""
    def run():
        con = connect(pr.DB_PATH)
        try:
            return status(con)
        finally:
            con.close()
    return await asyncio.to_thread(run)


@handler('prospect.sources.refresh')
async def h_sources_refresh(ctx, msg):
    """{sources?: [sec_owners|liquidity|gleif|propublica|wikidata], wait?}. Without wait it runs in the background
    (watch prospect.sources.status); with wait progress streams as engine events and the reply comes at the end."""
    keys = msg.get('sources') or list(ORDER)
    if not isinstance(keys, list) or any(k not in SOURCES for k in keys):
        raise EngineError(f'Unknown source. Use some of: {", ".join(ORDER)}.')
    if any(k in ('sec_owners', 'liquidity') for k in keys):
        pr._need_contact(ctx)
    if msg.get('wait'):
        return {'result': await run_refresh(ctx, keys, msg.get('_emit'))}
    if JOB.get('running'):
        raise EngineError('Public records are already being refreshed.')

    async def go():
        try:
            await run_refresh(ctx, keys)
        except Exception as err:
            log.warning('Public records refresh failed: %s', err)
    background(go())
    return {'started': True, 'sources': keys}
