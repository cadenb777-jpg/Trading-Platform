"""
Private companies (Prospects → Companies): US private businesses of every industry (restaurants, construction,
medical practices, manufacturers...) from free government data, with an estimated revenue. A free stand-in for the
"company" side of PitchBook-type databases; every figure says where it came from and when.

Stage 1 source: the SBA's Paycheck Protection Program loan list (data.sba.gov, public domain), the loans of $150,000
or more: about a million businesses with name, address, NAICS industry code, jobs reported, loan size, business type
and age, franchise name and lender. The loans date from 2020-2021, so headcounts and sizes are from then; the file
itself is found through the SBA's open-data catalog (CKAN API) so a new release is picked up by itself.

Size and revenue (an ESTIMATE, always a range with its method):
  payroll a year ≈ loan × 12 / 2.5 (the PPP rule: 2.5 months of payroll; 3.5 months for restaurants and hotels on a
  second-draw loan), which undercounts pay above $100,000 a person (the program's cap);
  revenue ≈ payroll ÷ the typical payroll share of sales in that industry (PAYROLL_SHARE: rounded from the Census
  Economic Census; low / likely / high).

Requests: companies.status, companies.download {wait?}, companies.search {...}, companies.get {id}.
"""
import asyncio
import csv
import datetime as dt
import logging
import re
import sqlite3
from pathlib import Path

from .core import EngineError, background, handler

log = logging.getLogger('engine.companies')

DB_PATH = Path.home() / '.trading-platform' / 'companies.db'
DATA_DIR = Path.home() / '.trading-platform' / 'companies'
CATALOG = 'https://data.sba.gov/api/3/action/package_show?id=ppp-foia'
SOURCE = 'SBA Paycheck Protection Program loans of $150,000+ (data.sba.gov)'
REQUIRED = ('LoanNumber', 'BorrowerName', 'BorrowerCity', 'BorrowerState', 'BorrowerZip', 'NAICSCode', 'JobsReported',
            'CurrentApprovalAmount')
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
  business_type TEXT, age TEXT, franchise TEXT, nonprofit INTEGER, approved TEXT, lender TEXT, forgiven REAL);
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


def norm_name(name):
    n = re.sub(r'[^a-z0-9 ]', ' ', re.sub(r"['’.]", '', (name or '').lower()))
    n = re.sub(r'\b(inc|llc|l l c|corp|corporation|co|company|ltd|pllc|pc|pa|lp|llp)\b', ' ', n)
    return ' '.join(n.split())


def parse_row(r):
    """One PPP CSV row -> a company dict (or None without a name)."""
    name = (r.get('BorrowerName') or '').strip()
    if not name:
        return None
    naics = re.sub(r'\D', '', r.get('NAICSCode') or '')[:6]
    loan = _num(r.get('CurrentApprovalAmount')) or _num(r.get('InitialApprovalAmount'))
    second = (r.get('ProcessingMethod') or '').strip().upper() == 'PPS'
    payroll = payroll_from_loan(loan, naics, second)
    jobs = _num(r.get('JobsReported'))
    zip5 = re.sub(r'\D', '', r.get('BorrowerZip') or '')[:5]
    return {'key': f"{norm_name(name)}|{zip5}", 'name': name, 'address': (r.get('BorrowerAddress') or '').strip(),
            'city': (r.get('BorrowerCity') or '').strip().title(), 'state': (r.get('BorrowerState') or '').strip().upper(), 'zip': zip5,
            'naics': naics, 'jobs': int(jobs) if jobs is not None else None, 'loan': loan, 'payroll': payroll, 'second': second,
            'business_type': (r.get('BusinessType') or '').strip(), 'age': (r.get('BusinessAgeDescription') or '').strip(),
            'franchise': (r.get('FranchiseName') or '').strip(), 'nonprofit': (r.get('NonProfit') or '').strip().upper() == 'Y',
            'approved': _date(r.get('DateApproved')), 'lender': (r.get('ServicingLenderName') or r.get('OriginatingLender') or '').strip(),
            'forgiven': _num(r.get('ForgivenessAmount'))}


def _date(text):
    text = (text or '').strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d'):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return text


def check_header(header):
    missing = [c for c in REQUIRED if c not in (header or [])]
    if missing:
        raise EngineError(f'The SBA file has a different layout (missing {", ".join(missing)}). Nothing was changed.')


def pick_files(catalog):
    """The CSV resources of the $150k+ list from the SBA catalog reply."""
    try:
        resources = catalog['result']['resources']
    except (KeyError, TypeError):
        raise EngineError('The SBA data catalog answered in an unexpected shape. Nothing was changed.')
    urls = [r.get('url', '') for r in resources if isinstance(r, dict)]
    picked = [u for u in urls if re.search(r'150k_?plus', u, re.I) and u.lower().endswith('.csv')]
    if not picked:
        raise EngineError('The SBA catalog lists no $150k+ PPP file right now.')
    return picked


# ---------- database ----------

def connect(path=None):
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def build(con, csv_paths, progress=lambda n: None):
    """Reads the CSV files into a fresh companies table. Loans go into a staging table first and are combined per
    business in SQL (a million rows never sit in memory); one transaction, so a failure leaves the old list."""
    n = 0
    cols = ('key', 'name', 'address', 'city', 'state', 'zip', 'naics', 'jobs', 'loan', 'payroll', 'business_type', 'age',
            'franchise', 'nonprofit', 'approved', 'lender', 'forgiven')
    with con:
        con.execute('DROP TABLE IF EXISTS loans')
        con.execute(f"CREATE TEMP TABLE loans ({', '.join(cols)})")
        batch = []
        for path in csv_paths:
            with open(path, newline='', encoding='utf-8', errors='replace') as fh:
                reader = csv.DictReader(fh)
                check_header(reader.fieldnames)
                for r in reader:
                    c = parse_row(r)
                    n += 1
                    if c:
                        c['nonprofit'] = int(c['nonprofit'])
                        batch.append(tuple(c[k] for k in cols))
                    if len(batch) >= BATCH:
                        con.executemany(f"INSERT INTO loans VALUES ({','.join('?' * len(cols))})", batch)
                        batch = []
                    if n % 100000 == 0:
                        progress(n)
        if batch:
            con.executemany(f"INSERT INTO loans VALUES ({','.join('?' * len(cols))})", batch)
        con.execute('DELETE FROM companies')
        rows = con.execute(
            'SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY key ORDER BY COALESCE(payroll, 0) DESC) AS rn, '
            'COUNT(*) OVER (PARTITION BY key) AS draws, MAX(jobs) OVER (PARTITION BY key) AS most_jobs FROM loans) WHERE rn = 1')
        while True:
            chunk = rows.fetchmany(BATCH)
            if not chunk:
                break
            con.executemany('INSERT OR REPLACE INTO companies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
                (c['key'], c['name'], c['address'], c['city'], c['state'], c['zip'], c['naics'], SECTORS.get((c['naics'] or '')[:2], ''),
                 c['most_jobs'], c['loan'], c['draws'], c['payroll'], *revenue_range(c['payroll'], c['naics']), c['business_type'],
                 c['age'], c['franchise'], c['nonprofit'], c['approved'], c['lender'], c['forgiven']) for c in chunk])
        con.execute('DROP TABLE loans')
        con.execute("INSERT OR REPLACE INTO meta VALUES ('built', ?)", (dt.datetime.now().isoformat(timespec='seconds'),))
        con.execute("INSERT OR REPLACE INTO meta VALUES ('source', ?)", (SOURCE,))
    return con.execute('SELECT COUNT(*) FROM companies').fetchone()[0]


SORTS = {'revenue': 'COALESCE(rev_likely, 0) DESC', 'jobs': 'COALESCE(jobs, 0) DESC', 'name': 'name COLLATE NOCASE',
         'loan': 'COALESCE(loan, 0) DESC', 'approved': 'approved DESC'}


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
            'approved': d['approved'], 'lender': d['lender'], 'forgiven': d['forgiven']}


def status(con):
    meta = dict(con.execute('SELECT key, value FROM meta').fetchall())
    count = con.execute('SELECT COUNT(*) FROM companies').fetchone()[0]
    by_group = {}
    if count:
        for gid, (_, prefixes) in GROUPS.items():
            by_group[gid] = con.execute('SELECT COUNT(*) FROM companies WHERE ' + ' OR '.join('naics LIKE ?' for _ in prefixes),
                                        [p + '%' for p in prefixes]).fetchone()[0]
    return {'count': count, 'built': meta.get('built'), 'source': meta.get('source') or SOURCE, 'byGroup': by_group,
            'groups': [{'id': k, 'label': v[0]} for k, v in GROUPS.items()], 'job': dict(JOB),
            'method': 'Revenue ≈ PPP payroll (loan × 12 ÷ 2.5) ÷ the industry’s typical payroll share of sales (Census Economic '
                      'Census, rounded). Loans are from 2020-2021; pay above $100,000 a person is not counted, so big earners read low.'}


# ---------- download ----------

async def run_download(ctx, emit=None):
    from . import prospect
    JOB.update(running=True, text='Finding the newest SBA file...', error='', done=0)
    try:
        resp = await ctx.http.get(CATALOG, timeout=60)
        if resp.status_code != 200:
            raise EngineError(f'The SBA data catalog answered HTTP {resp.status_code}. Try again later.')
        urls = pick_files(resp.json())
        paths = []
        for url in urls:
            JOB['text'] = f'Downloading {url.rsplit("/", 1)[-1]}...'
            paths.append(await prospect.download(ctx, url, DATA_DIR / prospect._file_name(url), emit=emit, label='the SBA company list'))
        JOB['text'] = 'Reading about a million companies (a few minutes)...'

        def work():
            con = connect()
            try:
                return build(con, paths, progress=lambda n: JOB.update(text=f'Read {n:,} loans...'))
            finally:
                con.close()
        n = await asyncio.to_thread(work)
        JOB.update(text=f'Done: {n:,} companies.', done=n)
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
