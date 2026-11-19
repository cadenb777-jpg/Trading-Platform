"""
Private companies (Prospects → Companies): US private businesses of every industry (restaurants, construction,
medical practices, manufacturers...) from free government data, combined across sources, with an estimated revenue.
Every figure says where it came from and when.

Sources (all public domain, found through the SBA open-data catalog, CKAN API, so new releases are picked up):
  - SBA 7(a) and 504 loans (FOIA files, updated each quarter, about a month after it ends): businesses that borrowed
    since 2020, with name, address, NAICS, jobs supported, loan, business type and age. The freshest free list.
  - SBA Paycheck Protection Program loans of $150,000+ (2020-2021): about a million businesses with payroll implied
    by the loan, the best free size measure.
Loans of one business (same cleaned name and ZIP) are combined: the newest record gives the address, industry and
headcount; first and last seen dates and the list of sources are kept.

Revenue (an ESTIMATE, always a range with its basis):
  - with PPP payroll: payroll ≈ loan × 12 / 2.5 (3.5 for NAICS 72 second draws), scaled to the newest headcount when a
    later loan reports one, ÷ the industry's typical payroll share of sales (PAYROLL_SHARE, rounded from the Census
    Economic Census); pay above $100,000 a person was not counted by PPP, so high earners read low;
  - otherwise: newest headcount × the industry's typical revenue per employee (REVENUE_PER_EMPLOYEE, rounded from
    Census Statistics of US Businesses).

Requests: companies.status, companies.download {wait?}, companies.search {...}, companies.get {companyId}.
"""
import asyncio
import csv
import datetime as dt
import json
import logging
import re
import sqlite3
from pathlib import Path

from .core import EngineError, background, handler

log = logging.getLogger('engine.companies')

DB_PATH = Path.home() / '.trading-platform' / 'companies.db'
DATA_DIR = Path.home() / '.trading-platform' / 'companies'
CATALOG = 'https://data.sba.gov/api/3/action/package_show?id={}'
#: when a dataset was renamed (the catalog answers 404), search for it instead
SEARCH = 'https://data.sba.gov/api/3/action/package_search?q={}&rows=20'
QUERIES = {'sba7a504': '7(a) 504 FOIA', 'ppp': 'PPP FOIA'}
#: source id -> (catalog dataset, label)
SOURCES = {'sba7a504': ('7a-504-foia', 'SBA 7(a) and 504 loans since 2020 (quarterly)'),
           'ppp': ('ppp-foia', 'SBA PPP loans of $150,000+ (2020-2021)')}
SOURCE = 'SBA loan lists (data.sba.gov): 7(a) and 504 since 2020, PPP $150k+'
REQUIRED = {'ppp': ('BorrowerName', 'BorrowerCity', 'BorrowerState', 'BorrowerZip', 'NAICSCode', 'JobsReported', 'CurrentApprovalAmount'),
            'sba': ('BorrName', 'BorrCity', 'BorrState', 'BorrZip', 'NaicsCode', 'GrossApproval', 'ApprovalDate')}
SINCE = '2020-01-01'
BATCH = 5000

#: typical annual payroll as a share of sales by 2-digit NAICS sector: (low, likely, high); rounded from the Census
#: Economic Census (approximate, an assumption shown on screen). A lower share means more revenue per payroll dollar.
PAYROLL_SHARE = {
    '11': (0.12, 0.20, 0.30), '21': (0.08, 0.12, 0.20), '22': (0.06, 0.10, 0.15), '23': (0.15, 0.22, 0.30),
    '31': (0.08, 0.13, 0.20), '32': (0.08, 0.13, 0.20), '33': (0.08, 0.13, 0.20), '42': (0.04, 0.06, 0.10),
    '44': (0.08, 0.11, 0.16), '45': (0.08, 0.11, 0.16), '48': (0.18, 0.27, 0.35), '49': (0.18, 0.27, 0.35),
    '51': (0.15, 0.22, 0.30), '52': (0.15, 0.25, 0.35), '53': (0.10, 0.18, 0.28), '54': (0.30, 0.40, 0.50),
    '55': (0.35, 0.45, 0.55), '56': (0.35, 0.45, 0.55), '61': (0.30, 0.40, 0.50), '62': (0.32, 0.42, 0.50),
    '71': (0.22, 0.30, 0.40), '72': (0.25, 0.31, 0.38), '81': (0.25, 0.35, 0.45), '92': (0.30, 0.40, 0.50),
}
GENERIC_SHARE = (0.15, 0.25, 0.40)
#: typical yearly revenue per employee by sector, likely value (rounded from Census Statistics of US Businesses;
#: an assumption shown on screen); the range is 0.6x to 1.6x
REVENUE_PER_EMPLOYEE = {
    '11': 250_000, '21': 900_000, '22': 1_500_000, '23': 300_000, '31': 450_000, '32': 450_000, '33': 450_000, '42': 1_200_000,
    '44': 350_000, '45': 350_000, '48': 200_000, '49': 200_000, '51': 450_000, '52': 500_000, '53': 350_000, '54': 190_000,
    '55': 250_000, '56': 90_000, '61': 80_000, '62': 120_000, '71': 100_000, '72': 70_000, '81': 100_000, '92': 150_000,
}
GENERIC_RPE = 200_000
#: industry groups for the filter (NAICS prefixes)
GROUPS = {
    'restaurants': ('Restaurants and bars', ('7225', '7224')),
    'construction': ('Construction', ('23',)),
    'health': ('Health care', ('62',)),
    'professional': ('Professional services (law, accounting, engineering...)', ('54',)),
    'manufacturing': ('Manufacturing', ('31', '32', '33')),
    'retail': ('Retail', ('44', '45')),
    'wholesale': ('Wholesale', ('42',)),
    'realestate': ('Real estate', ('53',)),
    'transport': ('Transportation and warehousing', ('48', '49')),
    'hotels': ('Hotels', ('721',)),
    'finance': ('Finance and insurance', ('52',)),
    'tech': ('Information and software', ('51',)),
    'services': ('Personal and repair services', ('81',)),
    'admin': ('Staffing, cleaning and support services', ('56',)),
    'education': ('Education', ('61',)),
    'agriculture': ('Agriculture', ('11',)),
}
SECTORS = {'11': 'Agriculture', '21': 'Mining, oil and gas', '22': 'Utilities', '23': 'Construction', '31': 'Manufacturing',
           '32': 'Manufacturing', '33': 'Manufacturing', '42': 'Wholesale', '44': 'Retail', '45': 'Retail', '48': 'Transportation',
           '49': 'Warehousing and delivery', '51': 'Information', '52': 'Finance and insurance', '53': 'Real estate',
           '54': 'Professional services', '55': 'Holding companies', '56': 'Support services', '61': 'Education', '62': 'Health care',
           '71': 'Arts and recreation', '72': 'Hotels and restaurants', '81': 'Other services', '92': 'Public administration'}

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT, address TEXT, city TEXT, state TEXT, zip TEXT,
  naics TEXT, sector TEXT, jobs INTEGER, loan REAL, draws INTEGER, payroll REAL, rev_low REAL, rev_likely REAL, rev_high REAL,
  business_type TEXT, age TEXT, franchise TEXT, nonprofit INTEGER, approved TEXT, lender TEXT, forgiven REAL,
  sources TEXT, first_seen TEXT, last_seen TEXT, basis TEXT);
CREATE INDEX IF NOT EXISTS companies_seen ON companies (last_seen);
CREATE INDEX IF NOT EXISTS companies_state ON companies (state, city);
CREATE INDEX IF NOT EXISTS companies_naics ON companies (naics);
CREATE INDEX IF NOT EXISTS companies_rev ON companies (rev_likely);
CREATE INDEX IF NOT EXISTS companies_zip ON companies (zip);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

JOB = {'running': False, 'text': '', 'error': '', 'done': 0}


# ---------- pure (tested) ----------

def _num(v):
    try:
        return float(str(v).replace(',', '').replace('$', '').strip())
    except (TypeError, ValueError):
        return None


def payroll_from_loan(loan, naics, second_draw):
    """Annual payroll implied by a PPP loan (2.5 months of payroll; 3.5 for NAICS 72 second draws)."""
    if not loan or loan <= 0:
        return None
    months = 3.5 if second_draw and str(naics or '').startswith('72') else 2.5
    return loan * 12 / months


def revenue_range(payroll, naics):
    """(low, likely, high) yearly revenue from payroll and the industry's typical payroll share of sales."""
    if not payroll:
        return (None, None, None)
    lo, mid, hi = PAYROLL_SHARE.get(str(naics or '')[:2], GENERIC_SHARE)
    return (payroll / hi, payroll / mid, payroll / lo)


def revenue_from_jobs(jobs, naics):
    """(low, likely, high) yearly revenue from headcount and the sector's typical revenue per employee."""
    if not jobs or jobs <= 0:
        return (None, None, None)
    rpe = REVENUE_PER_EMPLOYEE.get(str(naics or '')[:2], GENERIC_RPE)
    return (jobs * rpe * 0.6, jobs * rpe, jobs * rpe * 1.6)


def estimate(payroll, ppp_jobs, newest_jobs, naics):
    """((low, likely, high), basis, payroll used) for one company."""
    if payroll:
        if newest_jobs and ppp_jobs and newest_jobs != ppp_jobs:
            payroll = payroll * newest_jobs / ppp_jobs
            return revenue_range(payroll, naics), 'PPP payroll scaled to the newest headcount ÷ industry payroll share', payroll
        return revenue_range(payroll, naics), 'PPP payroll ÷ industry payroll share', payroll
    if newest_jobs:
        return revenue_from_jobs(newest_jobs, naics), 'employees × industry revenue per employee', None
    return (None, None, None), '', None


def norm_name(name):
    n = re.sub(r'[^a-z0-9 ]', ' ', re.sub(r"['’.]", '', (name or '').lower()))
    n = re.sub(r'\b(inc|llc|l l c|corp|corporation|co|company|ltd|pllc|pc|pa|lp|llp)\b', ' ', n)
    return ' '.join(n.split())


def _key(name, zip5):
    return f"{norm_name(name)}|{zip5}"


def parse_row(r):
    """One PPP CSV row -> a company record (or None without a name)."""
    name = (r.get('BorrowerName') or '').strip()
    if not name:
        return None
    naics = re.sub(r'\D', '', r.get('NAICSCode') or '')[:6]
    loan = _num(r.get('CurrentApprovalAmount')) or _num(r.get('InitialApprovalAmount'))
    second = (r.get('ProcessingMethod') or '').strip().upper() == 'PPS'
    jobs = _num(r.get('JobsReported'))
    zip5 = re.sub(r'\D', '', r.get('BorrowerZip') or '')[:5]
    approved = _date(r.get('DateApproved'))
    return {'key': _key(name, zip5), 'name': name, 'address': (r.get('BorrowerAddress') or '').strip(),
            'city': (r.get('BorrowerCity') or '').strip().title(), 'state': (r.get('BorrowerState') or '').strip().upper(), 'zip': zip5,
            'naics': naics, 'jobs': int(jobs) if jobs else None, 'loan': loan, 'payroll': payroll_from_loan(loan, naics, second),
            'business_type': (r.get('BusinessType') or '').strip(), 'age': (r.get('BusinessAgeDescription') or '').strip(),
            'franchise': (r.get('FranchiseName') or '').strip(), 'nonprofit': int((r.get('NonProfit') or '').strip().upper() == 'Y'),
            'approved': approved, 'lender': (r.get('ServicingLenderName') or r.get('OriginatingLender') or '').strip(),
            'forgiven': _num(r.get('ForgivenessAmount')), 'source': 'PPP', 'seen': approved}


def parse_sba_row(r):
    """One SBA 7(a) or 504 FOIA row -> a company record (None without a name or before SINCE)."""
    name = (r.get('BorrName') or '').strip()
    approved = _date(r.get('ApprovalDate'))
    if not name or not approved or approved < SINCE:
        return None
    program = (r.get('Program') or '').strip().upper()
    source = 'SBA 504' if '504' in program or r.get('CDC_Name') is not None else 'SBA 7(a)'
    jobs = _num(r.get('JobsSupported'))
    zip5 = re.sub(r'\D', '', r.get('BorrZip') or '')[:5]
    return {'key': _key(name, zip5), 'name': name, 'address': (r.get('BorrStreet') or '').strip(),
            'city': (r.get('BorrCity') or '').strip().title(), 'state': (r.get('BorrState') or '').strip().upper(), 'zip': zip5,
            'naics': re.sub(r'\D', '', r.get('NaicsCode') or '')[:6], 'jobs': int(jobs) if jobs else None,
            'loan': _num(r.get('GrossApproval')), 'payroll': None, 'business_type': (r.get('BusinessType') or '').strip().title(),
            'age': (r.get('BusinessAge') or '').strip(), 'franchise': (r.get('FranchiseName') or '').strip(), 'nonprofit': 0,
            'approved': approved, 'lender': (r.get('BankName') or r.get('CDC_Name') or r.get('ThirdPartyLender_Name') or '').strip(),
            'forgiven': None, 'source': source, 'seen': approved}


def _date(text):
    text = (text or '').strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d'):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return text


def check_header(header):
    """Which parser reads this file ('ppp' or 'sba'); EngineError on an unknown layout."""
    header = header or []
    for kind in ('ppp', 'sba'):
        if REQUIRED[kind][0] in header:
            missing = [c for c in REQUIRED[kind] if c not in header]
            if missing:
                raise EngineError(f'An SBA file has a different layout (missing {", ".join(missing)}). Nothing was changed.')
            return kind
    raise EngineError('An SBA file has an unknown layout. Nothing was changed.')


def _newness(r):
    """Sort key: the catalog's own dates, then the newest-looking date in the file name (e.g. 240930)."""
    dates = ''.join(str(r.get(k) or '') for k in ('last_modified', 'created'))
    nums = re.findall(r'\d{6,8}', r.get('url', ''))
    return (str(r.get('last_modified') or r.get('created') or ''), max(nums) if nums else '', dates)


def pick_groups(catalog, source='ppp'):
    """The files to read from one SBA catalog reply, grouped by list (PPP $150k+; 7(a) since FY2020; 504 since
    FY2010), newest copy first in each group. The catalog can keep older dated copies whose files were removed from
    the website (a 404), so the next copy is the fallback, and one missing list never stops the others."""
    try:
        resources = catalog['result']['resources']
    except (KeyError, TypeError):
        raise EngineError('The SBA data catalog answered in an unexpected shape. Nothing was changed.')
    groups = {}
    for r in resources:
        if not isinstance(r, dict):
            continue
        url, label = r.get('url', ''), f"{r.get('name', '')} {r.get('url', '')}".lower()
        if not url.lower().endswith('.csv'):
            continue
        key = None
        if source == 'ppp' and re.search(r'150k_?plus', label):
            key = '150k'
        elif source == 'sba7a504' and re.search(r'7\(?a\)?.*fy ?2020', label):
            key = '7a'
        elif source == 'sba7a504' and re.search(r'504.*fy ?2010', label):
            key = '504'
        if key:
            groups.setdefault(key, []).append(r)
    if not groups:
        raise EngineError(f'The SBA catalog lists no {SOURCES[source][1]} file right now.')
    out = []
    for rows in groups.values():
        urls = []
        for r in sorted(rows, key=_newness, reverse=True):
            if r['url'] not in urls:
                urls.append(r['url'])
        out.append(urls)
    return out


def pick_files(catalog, source='ppp'):
    """The newest file of each list (see pick_groups)."""
    return [urls[0] for urls in pick_groups(catalog, source)]


# ---------- database ----------

def connect(path=None):
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


COLS = ('key', 'name', 'address', 'city', 'state', 'zip', 'naics', 'jobs', 'loan', 'payroll', 'business_type', 'age',
        'franchise', 'nonprofit', 'approved', 'lender', 'forgiven', 'source', 'seen')
COMBINE = """
WITH agg AS (SELECT key, GROUP_CONCAT(DISTINCT source) AS srcs, MIN(seen) AS first_seen, MAX(seen) AS last_seen,
                    MAX(payroll) AS ppp_payroll, MAX(CASE WHEN payroll IS NOT NULL THEN jobs END) AS ppp_jobs,
                    COUNT(*) AS n, MAX(nonprofit) AS np, MAX(forgiven) AS forgiven_max FROM loans GROUP BY key),
     newest AS (SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY key ORDER BY seen DESC) AS rn FROM loans) WHERE rn = 1),
     staff AS (SELECT key, jobs AS newest_jobs FROM (SELECT key, jobs, ROW_NUMBER() OVER (PARTITION BY key ORDER BY seen DESC) AS rn
               FROM loans WHERE jobs > 0) WHERE rn = 1)
SELECT newest.*, agg.srcs, agg.first_seen, agg.last_seen, agg.ppp_payroll, agg.ppp_jobs, agg.n, agg.np, agg.forgiven_max, staff.newest_jobs
FROM newest JOIN agg USING (key) LEFT JOIN staff USING (key)
"""


def build(con, csv_paths, progress=lambda n: None):
    """Reads the CSV files (any mix of PPP, 7(a) and 504) into a fresh companies table. Loans go into a staging table
    and are combined per business in SQL (a million rows never sit in memory); one transaction, so a failure leaves
    the old list."""
    n = 0
    insert = f"INSERT INTO loans VALUES ({','.join('?' * len(COLS))})"
    with con:
        con.execute('DROP TABLE IF EXISTS loans')
        con.execute(f"CREATE TEMP TABLE loans ({', '.join(COLS)})")
        batch = []
        for path in csv_paths:
            with open(path, newline='', encoding='utf-8-sig', errors='replace') as fh:
                reader = csv.DictReader(fh)
                parse = parse_row if check_header(reader.fieldnames) == 'ppp' else parse_sba_row
                for r in reader:
                    c = parse(r)
                    n += 1
                    if c:
                        batch.append(tuple(c[k] for k in COLS))
                    if len(batch) >= BATCH:
                        con.executemany(insert, batch)
                        batch = []
                    if n % 100000 == 0:
                        progress(n)
        if batch:
            con.executemany(insert, batch)
        con.execute('CREATE INDEX temp.loans_key ON loans (key, seen)')
        con.execute('DELETE FROM companies')
        rows = con.execute(COMBINE)
        while True:
            chunk = rows.fetchmany(BATCH)
            if not chunk:
                break
            out = []
            for c in chunk:
                (low, likely, high), basis, payroll = estimate(c['ppp_payroll'], c['ppp_jobs'], c['newest_jobs'], c['naics'])
                out.append((c['key'], c['name'], c['address'], c['city'], c['state'], c['zip'], c['naics'], SECTORS.get((c['naics'] or '')[:2], ''),
                            c['newest_jobs'], c['loan'], c['n'], payroll, low, likely, high, c['business_type'], c['age'], c['franchise'],
                            c['np'], c['approved'], c['lender'], c['forgiven_max'], c['srcs'], c['first_seen'], c['last_seen'], basis))
            con.executemany(f"INSERT OR REPLACE INTO companies VALUES ({','.join('?' * 26)})", out)
        con.execute('DROP TABLE loans')
        con.execute("INSERT OR REPLACE INTO meta VALUES ('built', ?)", (dt.datetime.now().isoformat(timespec='seconds'),))
        con.execute("INSERT OR REPLACE INTO meta VALUES ('source', ?)", (SOURCE,))
    return con.execute('SELECT COUNT(*) FROM companies').fetchone()[0]


SORTS = {'revenue': 'COALESCE(rev_likely, 0) DESC', 'jobs': 'COALESCE(jobs, 0) DESC', 'name': 'name COLLATE NOCASE',
         'loan': 'COALESCE(loan, 0) DESC', 'newest': 'last_seen DESC'}


def search(con, q):
    where, args = [], []
    text = str(q.get('text') or '').strip()
    if text:
        where.append('(name LIKE ? OR franchise LIKE ?)')
        args += [f'%{text}%'] * 2
    group = GROUPS.get(str(q.get('group') or ''))
    if group:
        where.append('(' + ' OR '.join('naics LIKE ?' for _ in group[1]) + ')')
        args += [p + '%' for p in group[1]]
    naics = re.sub(r'\D', '', str(q.get('naics') or ''))
    if naics:
        where.append('naics LIKE ?')
        args.append(naics + '%')
    for field in ('state', 'zip'):
        v = str(q.get(field) or '').strip().upper()
        if v:
            where.append(f'{field} = ?' if field == 'state' else 'zip LIKE ?')
            args.append(v if field == 'state' else v + '%')
    city = str(q.get('city') or '').strip()
    if city:
        where.append('city LIKE ?')
        args.append(city + '%')
    for key, col, op in (('jobsMin', 'jobs', '>='), ('jobsMax', 'jobs', '<='), ('revenueMin', 'rev_likely', '>='), ('revenueMax', 'rev_likely', '<=')):
        v = _num(q.get(key))
        if v is not None:
            where.append(f'{col} {op} ?')
            args.append(v)
    if q.get('franchise'):
        where.append("franchise <> ''")
    if q.get('noNonprofits'):
        where.append('nonprofit = 0')
    since = str(q.get('seenSince') or '').strip()
    if re.fullmatch(r'\d{4}', since):
        where.append('last_seen >= ?')
        args.append(f'{since}-01-01')
    sql_where = f"WHERE {' AND '.join(where)}" if where else ''
    limit = max(1, min(int(q.get('limit') or 100), 500))
    offset = max(0, int(q.get('offset') or 0))
    total = con.execute(f'SELECT COUNT(*) FROM companies {sql_where}', args).fetchone()[0]
    rows = con.execute(f"SELECT * FROM companies {sql_where} ORDER BY {SORTS.get(q.get('sort'), SORTS['revenue'])} LIMIT ? OFFSET ?",
                       [*args, limit, offset]).fetchall()
    return {'total': total, 'rows': [public_row(r) for r in rows]}


def public_row(r):
    d = dict(r)
    return {'id': d['id'], 'name': d['name'], 'address': d['address'], 'city': d['city'], 'state': d['state'], 'zip': d['zip'],
            'naics': d['naics'], 'sector': d['sector'], 'jobs': d['jobs'], 'loan': d['loan'], 'draws': d['draws'], 'payroll': d['payroll'],
            'revenue': {'low': d['rev_low'], 'likely': d['rev_likely'], 'high': d['rev_high']} if d['rev_likely'] else None,
            'businessType': d['business_type'], 'age': d['age'], 'franchise': d['franchise'], 'nonprofit': bool(d['nonprofit']),
            'approved': d['approved'], 'lender': d['lender'], 'forgiven': d['forgiven'], 'sources': (d['sources'] or '').split(','),
            'firstSeen': d['first_seen'], 'lastSeen': d['last_seen'], 'basis': d['basis']}


def status(con):
    meta = dict(con.execute('SELECT key, value FROM meta').fetchall())
    count = con.execute('SELECT COUNT(*) FROM companies').fetchone()[0]
    by_group = {}
    if count:
        for gid, (_, prefixes) in GROUPS.items():
            by_group[gid] = con.execute('SELECT COUNT(*) FROM companies WHERE ' + ' OR '.join('naics LIKE ?' for _ in prefixes),
                                        [p + '%' for p in prefixes]).fetchone()[0]
    recent = con.execute("SELECT COUNT(*) FROM companies WHERE last_seen >= ?", (f'{dt.date.today().year - 1}-01-01',)).fetchone()[0] if count else 0
    newest = con.execute('SELECT MAX(last_seen) FROM companies').fetchone()[0] if count else None
    return {'count': count, 'recent': recent, 'newest': newest, 'built': meta.get('built'), 'source': meta.get('source') or SOURCE,
            'problems': json.loads(meta.get('problems') or '[]'), 'byGroup': by_group,
            'groups': [{'id': k, 'label': v[0]} for k, v in GROUPS.items()], 'job': dict(JOB),
            'method': 'Revenue is estimated: PPP payroll (loan × 12 ÷ 2.5, scaled to the newest headcount) ÷ the industry’s payroll '
                      'share of sales, or newest headcount × the industry’s revenue per employee (Census, rounded).'}


# ---------- download ----------

async def catalog(ctx, source, dataset):
    """The dataset's catalog entry; when the SBA renamed it (HTTP 404), the dataset a search finds with that list."""
    import urllib.parse
    resp = await ctx.http.get(CATALOG.format(dataset), timeout=60)
    if resp.status_code == 200:
        return resp.json()
    if resp.status_code != 404:
        raise EngineError(f'the SBA data catalog answered HTTP {resp.status_code}')
    found = await ctx.http.get(SEARCH.format(urllib.parse.quote(QUERIES[source])), timeout=60)
    if found.status_code == 200:
        for pkg in (found.json().get('result') or {}).get('results') or []:
            entry = {'result': pkg}
            try:
                pick_groups(entry, source)
                log.info('SBA dataset %s was renamed: using %s', dataset, pkg.get('name'))
                return entry
            except EngineError:
                continue
    raise EngineError(f'the SBA catalog no longer has the "{dataset}" dataset (HTTP 404) and a search found no replacement')


async def download_first(ctx, urls, label, emit=None):
    """The newest copy that is really on the website: a 404 moves on to the next copy. Returns (path, problem)."""
    from . import prospect
    problem = ''
    for url in urls:
        name = url.rsplit('/', 1)[-1]
        JOB['text'] = f'Downloading {label}: {name}...'
        try:
            return await prospect.download(ctx, url, DATA_DIR / prospect._file_name(url), emit=emit, label=label), ''
        except EngineError as err:
            if 'no longer on the website' not in str(err):
                raise
            log.warning('SBA file %s is listed but missing (404); trying an older copy', name)
            problem = f'the SBA lists {name} but the file is not on its website (404)'
    return None, problem + (' and no other copy was there either' if len(urls) > 1 else '')


async def run_download(ctx, emit=None):
    """Downloads every source (one failing doesn't stop the others) and rebuilds the list from what arrived."""
    from . import prospect
    JOB.update(running=True, text='Finding the newest SBA files...', error='', done=0)
    paths, problems = [], []
    try:
        for source, (dataset, label) in SOURCES.items():
            try:
                for urls in pick_groups(await catalog(ctx, source, dataset), source):
                    path, missing = await download_first(ctx, urls, label, emit)
                    if path:
                        paths.append(path)
                    else:
                        problems.append(f'{label}: {missing}')
            except Exception as err:
                problems.append(f'{label}: {err}')
                log.warning('Company source %s failed: %s', source, err)
        if not paths:
            raise EngineError('No SBA file could be downloaded. ' + ' '.join(problems))
        JOB['text'] = 'Combining the lists (a few minutes)...'

        def work():
            con = connect()
            try:
                n = build(con, paths, progress=lambda k: JOB.update(text=f'Read {k:,} loans...'))
                with con:
                    con.execute("INSERT OR REPLACE INTO meta VALUES ('problems', ?)", (json.dumps(problems),))
                return n
            finally:
                con.close()
        n = await asyncio.to_thread(work)
        JOB.update(text=f'Done: {n:,} companies.' + (f' Problems: {"; ".join(problems)}' if problems else ''), done=n)
        return n
    except Exception as err:
        JOB['error'] = str(err)
        raise
    finally:
        JOB['running'] = False


async def _q(fn, *args):
    def run():
        con = connect()
        try:
            return fn(con, *args)
        finally:
            con.close()
    return await asyncio.to_thread(run)


@handler('companies.status')
async def h_status(ctx, msg):
    return await _q(status)


@handler('companies.download')
async def h_download(ctx, msg):
    if JOB['running']:
        raise EngineError('The company list is already downloading.')
    if msg.get('wait'):
        return {'count': await run_download(ctx, msg.get('_emit'))}

    async def go():
        try:
            await run_download(ctx)
        except Exception as err:
            log.warning('Company list download failed: %s', err)
    background(go())
    return {'started': True}


@handler('companies.search')
async def h_search(ctx, msg):
    """{text, group, naics, state, city, zip, jobsMin, jobsMax, revenueMin, revenueMax, franchise, noNonprofits, sort, limit, offset}"""
    return await _q(search, msg)


@handler('companies.get')
async def h_get(ctx, msg):
    def one(con, cid):
        r = con.execute('SELECT * FROM companies WHERE id = ?', (cid,)).fetchone()
        if not r:
            raise EngineError('That company is not in the list.')
        return public_row(r)
    return await _q(one, str(msg.get('companyId') or ''))
