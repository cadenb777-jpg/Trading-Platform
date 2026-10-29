"""
Prospecting data (an in-house RIA / family-office database) built only from free public data.

Sources (all public, no keys):
- SEC monthly adviser rosters ("Information about Registered Investment Advisers and Exempt Reporting Advisers"):
  every SEC-registered adviser (RIA) and exempt reporting adviser (ERA): CRD, SEC number, main office, phone,
  website, Item 5 employees, regulatory AUM, client counts and assets by client type, how they are paid.
- SEC Form ADV data (the fuller FOIA files): Schedule A/B owners and executive officers with titles and
  Schedule D 7.B.(1) private funds with gross asset value.
- SEC Form 13F data sets (quarterly): every manager with $100M+ in 13(f) securities and their positions.
- SEC Form D data sets (quarterly): private offerings, issuers and related persons (officers, directors, promoters).
- US Census Bureau: the batch geocoder (address -> latitude/longitude) and the ZIP (ZCTA) centroid file.

Everything lands in its own SQLite file (~/.trading-platform/prospect.db) so the main database stays small. Big files
are downloaded with resume and parsed in a separate worker process, so live quotes never stall. The SEC asks for a
contact email in the User-Agent (Settings) and at most 10 requests a second; downloads here go one at a time.

Nothing is invented: a figure that isn't in a filing is left empty. Family-office labels are educated guesses from
public signals; every label carries the reasons behind it and a confidence word, never certainty.
"""
import asyncio
import concurrent.futures
import csv
import datetime as dt
import difflib
import io
import itertools
import json
import logging
import math
import multiprocessing
import re
import sqlite3
import time
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .core import EngineError, background, handler

log = logging.getLogger('engine.prospect')

DB_PATH = Path.home() / '.trading-platform' / 'prospect.db'
DOWNLOADS = Path.home() / '.trading-platform' / 'prospect-downloads'

INDEX_PAGES = {
    'adv': 'https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers',
    'adv_full': 'https://www.sec.gov/foia-services/frequently-requested-documents/form-adv-data',
    '13f': 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets',
    'formd': 'https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets',
}
CENSUS_BATCH = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
CENSUS_ONE = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
ZCTA_URLS = ['https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip',
             'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip']
EDGAR_COMPANY = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}'
IAPD_FIRM = 'https://adviserinfo.sec.gov/firm/summary/{crd}'

SOURCES = ('adv', 'adv_full', '13f', 'formd', 'geo')
#: how old (days) a source may get before the background schedule looks for a newer file (only for sources you
#: have downloaded at least once: the schedule never starts a download you didn't ask for)
REFRESH_DAYS = {'adv': 30, 'adv_full': 30, '13f': 30, 'formd': 30}
#: 13F quarters kept (latest + the one before, for quarter-on-quarter changes); ~3 million rows a quarter
KEEP_13F_PERIODS = 2
#: older monthly rosters loaded on the first ADV download, about a quarter apart, for the AUM history
ADV_HISTORY_FILES = 4
GEOCODE_BATCH = 1000
SEC_GAP = 0.2  # seconds between this module's SEC requests (5 a second, half the SEC's limit)

TYPE_RIA = 'Registered RIA'
TYPE_ERA = 'Exempt reporting adviser'
TYPE_FO = 'Likely family office'
TYPE_MFO = 'Multi-family office'
TYPE_13F = 'Other 13F filer'
TYPE_FORMD = 'Form D issuer'
TYPES = (TYPE_RIA, TYPE_ERA, TYPE_FO, TYPE_MFO, TYPE_13F, TYPE_FORMD)

#: Form ADV Item 5.D client types: letter -> (key, label)
CLIENT_TYPES = {
    'a': ('individuals', 'Individuals (not high net worth)'),
    'b': ('hnw', 'High-net-worth individuals'),
    'c': ('banks', 'Banks or thrifts'),
    'd': ('investment_companies', 'Investment companies'),
    'e': ('bdcs', 'Business development companies'),
    'f': ('pooled', 'Pooled investment vehicles'),
    'g': ('pensions', 'Pension and profit-sharing plans'),
    'h': ('charities', 'Charitable organizations'),
    'i': ('government', 'State or municipal entities'),
    'j': ('other_advisers', 'Other investment advisers'),
    'k': ('insurance', 'Insurance companies'),
    'l': ('sovereign', 'Sovereign wealth funds'),
    'm': ('corporations', 'Corporations or other businesses'),
    'n': ('other', 'Other'),
}
CLIENT_KEYS = {key for key, _ in CLIENT_TYPES.values()}
#: Item 5.E: how the adviser is paid
FEE_TYPES = {'1': 'Percentage of assets', '2': 'Hourly', '3': 'Subscription', '4': 'Fixed fees', '5': 'Commissions',
             '6': 'Performance-based', '7': 'Other'}

KEY_TITLE = re.compile(r'\bC\.?\s?I\.?\s?O\b|chief investment officer|portfolio manager|head of investments|investment officer|director of investments', re.I)

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS adv_firms (crd INTEGER PRIMARY KEY, sec_number TEXT, kind TEXT, legal_name TEXT, business_name TEXT,
  street TEXT, city TEXT, state TEXT, zip TEXT, country TEXT, phone TEXT, website TEXT, aum_disc REAL, aum_nondisc REAL,
  aum_total REAL, accounts INTEGER, employees INTEGER, adv_employees INTEGER, clients_total INTEGER, clients_approx INTEGER,
  client_mix TEXT, fees TEXT, filing_date TEXT, roster_date TEXT);
CREATE TABLE IF NOT EXISTS adv_history (crd INTEGER, roster_date TEXT, filing_date TEXT, aum_total REAL, aum_disc REAL,
  clients_total INTEGER, employees INTEGER, PRIMARY KEY (crd, roster_date));
CREATE TABLE IF NOT EXISTS people (firm_key TEXT, firm_id TEXT, name TEXT, title TEXT, source TEXT, source_ref TEXT,
  key_title INTEGER, filed TEXT, ownership TEXT);
CREATE INDEX IF NOT EXISTS people_key ON people (firm_key);
CREATE INDEX IF NOT EXISTS people_firm ON people (firm_id);
CREATE TABLE IF NOT EXISTS private_funds (crd INTEGER, fund_id TEXT, name TEXT, fund_type TEXT, gav REAL, owners INTEGER,
  filing_date TEXT);
CREATE INDEX IF NOT EXISTS funds_crd ON private_funds (crd);
CREATE TABLE IF NOT EXISTS filers_13f (cik INTEGER PRIMARY KEY, name TEXT, street TEXT, city TEXT, state TEXT, zip TEXT,
  crd INTEGER, sec_file TEXT, file_13f TEXT, latest_period TEXT, latest_accession TEXT, latest_filed TEXT,
  total_value REAL, entries INTEGER, report_type TEXT, phone TEXT);
CREATE TABLE IF NOT EXISTS holdings_13f (cik INTEGER, period TEXT, cusip TEXT, issuer TEXT, class TEXT, value REAL,
  shares REAL, share_type TEXT, put_call TEXT, discretion TEXT, accession TEXT);
CREATE INDEX IF NOT EXISTS holdings_filer ON holdings_13f (cik, period);
DROP INDEX IF EXISTS holdings_cusip;
CREATE INDEX IF NOT EXISTS holdings_cusip_filer ON holdings_13f (cusip, cik, period);
CREATE TABLE IF NOT EXISTS other_managers_13f (cik INTEGER, period TEXT, name TEXT, crd INTEGER, sec_file TEXT, file_13f TEXT);
CREATE TABLE IF NOT EXISTS formd_offerings (accession TEXT PRIMARY KEY, cik INTEGER, name TEXT, entity_type TEXT, industry TEXT,
  fund_type TEXT, street TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT, filed TEXT, offering REAL, sold REAL,
  investors INTEGER, minimum REAL, amendment INTEGER);
CREATE INDEX IF NOT EXISTS formd_cik ON formd_offerings (cik);
CREATE TABLE IF NOT EXISTS cusip_map (cusip TEXT PRIMARY KEY, ticker TEXT, cik INTEGER, name TEXT, method TEXT, sector TEXT, sic TEXT);
CREATE TABLE IF NOT EXISTS firms (id TEXT PRIMARY KEY, name TEXT, other_names TEXT, type TEXT, confidence TEXT, reasons TEXT,
  crd INTEGER, sec_number TEXT, cik INTEGER, street TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT, website TEXT,
  aum_total REAL, aum_disc REAL, clients_total INTEGER, client_mix TEXT, client_types TEXT, employees INTEGER, fees TEXT,
  filing_date TEXT, has13f INTEGER, value_13f REAL, period_13f TEXT, funds INTEGER, funds_gav REAL, offerings INTEGER,
  lat REAL, lon REAL, geo TEXT);
CREATE INDEX IF NOT EXISTS firms_state ON firms (state, city);
CREATE INDEX IF NOT EXISTS firms_cik ON firms (cik);
CREATE TABLE IF NOT EXISTS links (firm_id TEXT, source TEXT, source_key TEXT, method TEXT, score REAL, status TEXT, name TEXT);
CREATE INDEX IF NOT EXISTS links_firm ON links (firm_id);
CREATE TABLE IF NOT EXISTS geocache (address TEXT PRIMARY KEY, lat REAL, lon REAL, matched TEXT, status TEXT, at REAL);
CREATE TABLE IF NOT EXISTS zcta (zip TEXT PRIMARY KEY, lat REAL, lon REAL);
"""


def connect(path=None):
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=60)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')
    con.executescript(SCHEMA)
    return con


def get_meta(con, key, default=None):
    row = con.execute('SELECT value FROM meta WHERE key = ?', (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_meta(con, key, value):
    con.execute('INSERT OR REPLACE INTO meta VALUES (?, ?)', (key, json.dumps(value)))


def _progress(con, stage, done=0, total=0):
    set_meta(con, 'progress', {'stage': stage, 'done': done, 'total': total, 'at': time.time()})
    con.commit()


# ---------- Small parsing helpers ----------

def norm_header(header):
    """'5F(2)(c)' -> '5f2c', 'Organization CRD#' -> 'organizationcrd#', 'Main Office\\nCity' -> 'mainofficecity'."""
    return re.sub(r'[^a-z0-9#]', '', str(header or '').lower())


def pick(row, *aliases):
    """The first non-empty value among the (normalized) column names, else ''."""
    for alias in aliases:
        value = row.get(alias)
        if value not in (None, ''):
            return str(value).strip()
    return ''


def money(value):
    """'1,234,567.00' / '$12' / '' -> float or None."""
    text = str(value or '').strip().replace(',', '').replace('$', '')
    if text in ('', '.', '-'):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def integer(value):
    number = money(value)
    return int(number) if number is not None else None


def yes(value):
    return str(value or '').strip().upper() in ('Y', 'YES', 'TRUE', '1', 'X')


MONTHS = {m: i + 1 for i, m in enumerate(('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'))}


def parse_date(value):
    """'31-MAR-2025', '2025-03-31', '3/31/2025 9:42', '03-31-2025' -> '2025-03-31' (or '' when it isn't a date)."""
    text = str(value or '').strip()
    m = re.match(r'(\d{1,2})-([A-Za-z]{3})-(\d{4})', text)
    try:
        if m:
            return dt.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))).isoformat()
        m = re.match(r'(\d{4})-(\d{1,2})-(\d{1,2})', text)
        if m:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        m = re.match(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', text)
        if m:
            year = int(m.group(3))
            year += 2000 if year < 100 else 0
            return dt.date(year, int(m.group(1)), int(m.group(2))).isoformat()
    except (ValueError, KeyError):
        return ''
    return ''


def zip5(value):
    m = re.match(r'\s*(\d{5})', str(value or ''))
    return m.group(1) if m else ''


def clean_cik(value):
    try:
        return int(str(value).strip()) or None
    except (TypeError, ValueError):
        return None


def _decode(data):
    """SEC CSVs are Windows-1252, not UTF-8 (UTF-8 is tried first for newer files)."""
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('cp1252', errors='replace')


def text_rows(text, delimiter=','):
    """Rows as dicts with normalized column names. The CSV reader copes with headers that contain newlines and the
    quotes the SEC leaves unescaped; TSV (13F, Form D) is read without quote handling."""
    quoting = csv.QUOTE_NONE if delimiter == '\t' else csv.QUOTE_MINIMAL
    reader = csv.reader(io.StringIO(text, newline=''), delimiter=delimiter, quoting=quoting)
    header = next(reader, None)
    if not header:
        return
    keys = [norm_header(h) for h in header]
    for values in reader:
        if not any(v.strip() for v in values):
            continue
        yield {k: v.strip() for k, v in zip(keys, values)}


def stream_rows(binary, delimiter='\t', encoding='utf-8'):
    """Like text_rows, but reads a (large) file object a line at a time instead of all at once."""
    wrapper = io.TextIOWrapper(binary, encoding=encoding, errors='replace', newline='')
    quoting = csv.QUOTE_NONE if delimiter == '\t' else csv.QUOTE_MINIMAL
    reader = csv.reader(wrapper, delimiter=delimiter, quoting=quoting)
    header = next(reader, None)
    if not header:
        return
    keys = [norm_header(h.lstrip('﻿')) for h in header]
    for values in reader:
        if values:
            yield {k: v.strip() for k, v in zip(keys, values)}


def xlsx_rows(data):
    """The first sheet of an .xlsx workbook as dict rows, read as a stream (standard library only: an xlsx is a zip
    of XML files). Each row is parsed and then cleared, so a 20,000-row roster never sits in memory as a tree."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared = []
        if 'xl/sharedStrings.xml' in zf.namelist():
            with zf.open('xl/sharedStrings.xml') as fh:
                for _, el in ET.iterparse(fh):
                    if el.tag == f'{ns}si':
                        shared.append(''.join(t.text or '' for t in el.iter(f'{ns}t')))
                        el.clear()
        sheet = sorted(n for n in zf.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))[0]
        keys = None
        with zf.open(sheet) as fh:
            for _, row in ET.iterparse(fh):
                if row.tag != f'{ns}row':
                    continue
                cells = {}
                for c in row.iter(f'{ns}c'):
                    ref = re.match(r'([A-Z]+)', c.get('r', 'A'))
                    col = 0
                    for ch in ref.group(1):
                        col = col * 26 + ord(ch) - 64
                    v = c.find(f'{ns}v')
                    if c.get('t') == 's' and v is not None:
                        value = shared[int(v.text)]
                    elif c.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in c.iter(f'{ns}t'))
                    else:
                        value = v.text if v is not None and v.text else ''
                    cells[col - 1] = value
                row.clear()
                if not cells:
                    continue
                values = [str(cells.get(i, '')).strip() for i in range(max(cells) + 1)]
                if keys is None:
                    keys = [norm_header(h) for h in values]
                elif any(values):
                    yield dict(zip(keys, values))


def table_rows(name, data):
    """Rows from one file of a download: CSV, TSV/TXT or XLSX."""
    lower = name.lower()
    if lower.endswith('.xlsx'):
        return xlsx_rows(data)
    return text_rows(_decode(data), '\t' if lower.endswith(('.tsv', '.txt')) else ',')


def peek(rows):
    """(column names of the first row, all rows) without losing that first row of a generator."""
    rows = iter(rows)
    first = next(rows, None)
    if first is None:
        return [], iter(())
    return list(first), itertools.chain([first], rows)


# ---------- Header self-check ----------
# Every download is checked against the columns this parser reads before anything is saved. A missing required column
# fails that source with a clear message (instead of loading half-empty rows); every difference is kept in
# prospect.status and the diagnostics file, so the first real download says exactly what to fix.

A_CRD = ('organizationcrd#', 'organizationcrd', 'crd#', 'crd', 'firmcrd', 'firmcrdnb', '1e1')
A_SEC = ('sec#', 'secnumber', 'secfilenumber', '1d')
A_LEGAL = ('legalname', '1a')
A_BUSINESS = ('primarybusinessname', 'businessname', '1b1', '1b')
A_STREET = ('mainofficestreetaddress1', 'mainofficestreet1', 'mainofficeaddress1', '1f1street1')
A_CITY = ('mainofficecity', '1f1city')
A_STATE = ('mainofficestate', '1f1state')
A_ZIP = ('mainofficepostalcode', 'mainofficezipcode', '1f1postal', '1f1zip')
A_COUNTRY = ('mainofficecountry', '1f1country')
A_PHONE = ('mainofficetelephonenumber', 'mainofficetelephone', 'telephonenumber', '1f3')
A_WEBSITE = ('websiteaddress', 'website', '1i')
A_FILED = ('latestadvfilingdate', 'latestfilingdate', 'datesubmitted', 'filingdate')
A_PERSON = ('fulllegalname', 'fullname', 'name', 'ownername', 'legalname')
A_TITLE = ('titleorstatus', 'title', 'status')
A_PERSON_KIND = ('defei', 'defeoi', 'entitytype', 'type')
A_SCHEDULE = ('schedule', 'scheduletype', 'scheduleab')
A_OWNERSHIP = ('ownershipcode', 'ownership')
A_FUND = ('fundname', 'nameoffund', 'privatefundname', 'nameoftheprivatefund')
A_FUND_ID = ('fundid', 'privatefundid', 'privatefundidentificationnumber', 'fundidentificationnumber')
A_FUND_TYPE = ('fundtype', 'typeoffund', 'privatefundtype')
A_GAV = ('grossassetvalue', 'currentgrossassetvalue', 'gav')
A_OWNERS = ('numberofbeneficialowners', 'beneficialowners', 'approximatenumberofbeneficialowners')
A_BASE_CRD = ('1e1', 'organizationcrd#', 'crd', 'crdnumber', 'firmcrd')
A_BASE_DATE = ('datesubmitted', 'filingdate', 'datefiled')

#: table -> [(what, column aliases, required)]
EXPECTED = {
    'adv_roster': [('CRD number', A_CRD, True), ('business name', A_BUSINESS + A_LEGAL, True), ('main office state', A_STATE, True),
                   ('SEC number', A_SEC, False), ('legal name', A_LEGAL, False), ('main office street', A_STREET, False),
                   ('main office city', A_CITY, False), ('main office ZIP', A_ZIP, False), ('country', A_COUNTRY, False),
                   ('phone', A_PHONE, False), ('website', A_WEBSITE, False), ('latest filing date', A_FILED, False)],
    'adv_roster_ria': [('regulatory AUM 5F(2)(c)', ('5f2c',), True), ('discretionary AUM 5F(2)(a)', ('5f2a',), False),
                       ('employees 5A', ('5a', 'totalemployees'), False), ('client counts 5.D', ('5da1', '5d1a', '5db1', '5d1b'), False)],
    'adv_base': [('FilingID', ('filingid',), True), ('CRD number', A_BASE_CRD, True), ('date submitted', A_BASE_DATE, False)],
    'adv_people': [('FilingID', ('filingid',), True), ('full legal name', A_PERSON, True), ('title or status', A_TITLE, True),
                   ('DE/FE/I', A_PERSON_KIND, False), ('schedule', A_SCHEDULE, False), ('ownership code', A_OWNERSHIP, False)],
    'adv_funds': [('FilingID', ('filingid',), True), ('fund name', A_FUND, True), ('gross asset value', A_GAV, True),
                  ('fund ID', A_FUND_ID, False), ('fund type', A_FUND_TYPE, False), ('beneficial owners', A_OWNERS, False)],
    '13f_SUBMISSION': [(c, (c,), True) for c in ('accessionnumber', 'filingdate', 'submissiontype', 'cik', 'periodofreport')],
    '13f_COVERPAGE': [('accessionnumber', ('accessionnumber',), True), ('filingmanagername', ('filingmanagername',), True)]
    + [(c, (c,), False) for c in ('isamendment', 'amendmenttype', 'filingmanagerstreet1', 'filingmanagercity', 'filingmanagerstateorcountry',
                                  'filingmanagerzipcode', 'crdnumber', 'secfilenumber', 'form13ffilenumber', 'reporttype')],
    '13f_SUMMARYPAGE': [('accessionnumber', ('accessionnumber',), True), ('tablevaluetotal', ('tablevaluetotal',), False),
                        ('tableentrytotal', ('tableentrytotal',), False)],
    '13f_INFOTABLE': [(c, (c,), True) for c in ('accessionnumber', 'nameofissuer', 'cusip', 'value', 'sshprnamt')]
    + [(c, (c,), False) for c in ('titleofclass', 'sshprnamttype', 'putcall', 'investmentdiscretion')],
    '13f_SIGNATURE': [('accessionnumber', ('accessionnumber',), True), ('name', ('name',), True), ('title', ('title',), False), ('phone', ('phone',), False)],
    '13f_OTHERMANAGER': [('accessionnumber', ('accessionnumber',), True), ('name', ('name',), True), ('crdnumber', ('crdnumber',), False),
                         ('secfilenumber', ('secfilenumber',), False)],
    'formd_FORMDSUBMISSION': [('accessionnumber', ('accessionnumber',), True), ('filingdate', ('filingdate',), True),
                              ('submissiontype', ('submissiontype',), False)],
    'formd_ISSUERS': [(c, (c,), True) for c in ('accessionnumber', 'cik', 'entityname')]
    + [(c, (c,), False) for c in ('isprimaryissuerflag', 'street1', 'city', 'stateorcountry', 'zipcode', 'issuerphonenumber', 'entitytype')],
    'formd_OFFERING': [('accessionnumber', ('accessionnumber',), True), ('industrygrouptype', ('industrygrouptype',), True)]
    + [(c, (c,), False) for c in ('investmentfundtype', 'totalofferingamount', 'totalamountsold', 'totalnumberalreadyinvested', 'minimuminvestmentaccepted')],
    'formd_RELATEDPERSONS': [('accessionnumber', ('accessionnumber',), True), ('lastname', ('lastname',), True)]
    + [(c, (c,), False) for c in ('firstname', 'relationship1', 'relationshipclarification')],
}


class HeaderError(EngineError):
    """A downloaded file no longer has a column the parser needs (nothing from it was saved)."""


def check_headers(keys, *tables):
    """{missingRequired, missingOptional, unexpected, unexpectedCount} for one file's (normalized) column names.
    Form ADV item-code columns (they start with a digit) are not listed as unexpected: the rosters have hundreds."""
    keys = set(keys)
    groups = [g for t in tables for g in EXPECTED[t]]
    known = {a for _, aliases, _ in groups for a in aliases}
    adv = any(t.startswith('adv') for t in tables)
    extra = sorted(k for k in keys if k and k not in known and not (adv and k[:1].isdigit()))
    return {'missingRequired': [what for what, aliases, req in groups if req and not keys & set(aliases)],
            'missingOptional': [what for what, aliases, req in groups if not req and not keys & set(aliases)],
            'unexpected': extra[:60], 'unexpectedCount': len(extra)}


def note_headers(con, source, file, keys, *tables):
    """Records the check in meta 'headers:<source>' and raises HeaderError when a required column is missing."""
    report = {'file': file, 'tables': list(tables), **check_headers(keys, *tables)}
    notes = get_meta(con, f'headers:{source}', []) or []
    notes.append(report)
    set_meta(con, f'headers:{source}', notes)
    con.commit()
    if report['missingRequired']:
        raise HeaderError(f'The SEC changed the layout of {file}: it has no {", ".join(report["missingRequired"])} column. '
                          'Nothing from this file was saved. Send diagnostics (Settings) so the reader can be updated.')
    return report


# ---------- File lists on the SEC's pages ----------

def page_links(html_text, base):
    return [urllib.parse.urljoin(base, h) for h in re.findall(r'href="([^"]+\.zip)"', html_text, re.I)]


def _date_key(name):
    """The newest date in a file name (YYYYMMDD, MMDDYYYY, MMDDYY, DDmonYYYY or YYYYqN), as 'YYYY-MM-DD'."""
    base = urllib.parse.unquote(name.rsplit('/', 1)[-1]).lower()
    found = []
    for d, mon, y in re.findall(r'(\d{2})([a-z]{3})(\d{4})', base):
        if mon in MONTHS:
            found.append(f'{y}-{MONTHS[mon]:02d}-{d}')
    for y, q in re.findall(r'(\d{4})q([1-4])', base):
        found.append(f'{y}-{int(q) * 3:02d}-{(31 if q in "14" else 30):02d}')
    m = re.match(r'ia(\d{8}|\d{6})', base)
    if m:
        s = m.group(1)
        found.append(f'{s[4:]}-{s[:2]}-{s[2:4]}' if len(s) == 8 else f'20{s[4:]}-{s[:2]}-{s[2:4]}')
    elif not found:
        for s in re.findall(r'(?<!\d)(\d{8})(?!\d)', base):
            if s[:2] in ('19', '20'):
                found.append(f'{s[:4]}-{s[4:6]}-{s[6:]}')
    return max(found) if found else ''


def pick_13f_files(links, count=KEEP_13F_PERIODS):
    files = sorted({u for u in links if re.search(r'form13f', u, re.I) and _date_key(u)}, key=_date_key, reverse=True)
    return files[:count]


def pick_formd_files(links, count=1):
    files = sorted({u for u in links if _date_key(u) and re.search(r'(?<![a-z])d\.zip$|form[-_]?d', u.rsplit('/', 1)[-1], re.I)},
                   key=_date_key, reverse=True)
    return files[:count]


def pick_adv_files(links, history=ADV_HISTORY_FILES):
    """The newest registered-adviser roster, the newest exempt-adviser roster and up to `history` older registered
    rosters about a quarter apart (for the AUM history). Returns [(url, kind, date)]."""
    rosters = [u for u in links if re.match(r'ia\d{6,8}', u.rsplit('/', 1)[-1], re.I)]
    exempt = sorted((u for u in rosters if 'exempt' in u.rsplit('/', 1)[-1].lower()), key=_date_key, reverse=True)
    registered = sorted((u for u in rosters if 'exempt' not in u.rsplit('/', 1)[-1].lower()), key=_date_key, reverse=True)
    out = []
    if registered:
        out.append((registered[0], 'RIA', _date_key(registered[0])))
        newest = dt.date.fromisoformat(_date_key(registered[0]))
        for k in range(1, history + 1):
            limit = (newest - dt.timedelta(days=91 * k)).isoformat()
            older = next((u for u in registered if _date_key(u) <= limit), None)
            if older and all(older != o[0] for o in out):
                out.append((older, 'RIA', _date_key(older)))
    if exempt:
        out.insert(1, (exempt[0], 'ERA', _date_key(exempt[0])))
    return out


def pick_adv_full_files(links, days=366):
    """Every Form ADV data release (all parts) from the 12 months up to the newest one: each quarterly release holds
    only that quarter's filings, so a firm that last filed 9 months ago is only in an older release."""
    files = [u for u in links if _date_key(u) and not re.match(r'ia\d{6,8}', u.rsplit('/', 1)[-1], re.I)]
    if not files:
        return []
    newest = dt.date.fromisoformat(max(_date_key(u) for u in files))
    cutoff = (newest - dt.timedelta(days=days)).isoformat()
    return sorted((u for u in files if _date_key(u) > cutoff), key=lambda u: (_date_key(u), u), reverse=True)


# ---------- Form ADV: monthly rosters ----------

def parse_adv_row(row, kind, roster_date=''):
    """One adviser from a monthly roster row (column names normalized by norm_header)."""
    crd = integer(pick(row, *A_CRD))
    if not crd:
        return None
    mix, total, approx = {}, 0, False
    for letter, (key, _) in CLIENT_TYPES.items():
        count = integer(pick(row, f'5d{letter}1', f'5d1{letter}'))
        few = yes(pick(row, f'5d{letter}2', f'5d2{letter}'))
        aum = money(pick(row, f'5d{letter}3'))
        if count or few or aum:
            mix[key] = {'count': count, 'fewerThan5': few or None, 'aum': aum}
            total += count or 0
            approx = approx or (few and not count)
    fees = [label for n, label in FEE_TYPES.items() if yes(pick(row, f'5e{n}'))]
    return {
        'crd': crd,
        'sec_number': pick(row, *A_SEC),
        'kind': kind,
        'legal_name': pick(row, *A_LEGAL),
        'business_name': pick(row, *A_BUSINESS),
        'street': pick(row, *A_STREET),
        'city': pick(row, *A_CITY),
        'state': pick(row, *A_STATE),
        'zip': pick(row, *A_ZIP),
        'country': pick(row, *A_COUNTRY),
        'phone': pick(row, *A_PHONE),
        'website': pick(row, *A_WEBSITE),
        'aum_disc': money(pick(row, '5f2a')),
        'aum_nondisc': money(pick(row, '5f2b')),
        'aum_total': money(pick(row, '5f2c')),
        'accounts': integer(pick(row, '5f2f')),
        'employees': integer(pick(row, '5a', 'totalemployees')),
        'adv_employees': integer(pick(row, '5b1')),
        'clients_total': total if mix else None,
        'clients_approx': 1 if approx else 0,
        'client_mix': json.dumps(mix) if mix else '',
        'fees': json.dumps(fees) if fees else '',
        'filing_date': parse_date(pick(row, *A_FILED)),
        'roster_date': roster_date,
    }


ADV_COLUMNS = ('crd', 'sec_number', 'kind', 'legal_name', 'business_name', 'street', 'city', 'state', 'zip', 'country', 'phone',
               'website', 'aum_disc', 'aum_nondisc', 'aum_total', 'accounts', 'employees', 'adv_employees', 'clients_total',
               'clients_approx', 'client_mix', 'fees', 'filing_date', 'roster_date')


def roster_files(zip_path):
    """[(member name, bytes)] of the data files in a roster download (CSV or a workbook; the zip may hold either)."""
    path = Path(zip_path)
    if path.suffix.lower() == '.xlsx':
        return [(path.name, path.read_bytes())]
    with zipfile.ZipFile(path) as zf:
        return [(n, zf.read(n)) for n in zf.namelist() if n.lower().endswith(('.csv', '.xlsx', '.txt'))]


def load_adv_roster(db_path, zip_path, kind, roster_date, history_only=False):
    """Loads one monthly roster: the newest becomes adv_firms; every roster adds an AUM history point."""
    con = connect(db_path)
    _progress(con, f'Reading the {kind} list ({roster_date})')
    firms = []
    tables = ('adv_roster', 'adv_roster_ria') if kind == 'RIA' else ('adv_roster',)
    for name, data in roster_files(zip_path):
        keys, rows = peek(table_rows(name, data))
        note_headers(con, 'adv', f'{Path(zip_path).name}/{name}', keys, *tables)
        for row in rows:
            firm = parse_adv_row(row, kind, roster_date)
            if firm:
                firms.append(firm)
    with con:
        if not history_only:
            con.execute('DELETE FROM adv_firms WHERE kind = ?', (kind,))
            con.executemany(f'INSERT OR REPLACE INTO adv_firms ({",".join(ADV_COLUMNS)}) VALUES ({",".join("?" * len(ADV_COLUMNS))})',
                            [tuple(f[c] for c in ADV_COLUMNS) for f in firms])
        if kind == 'RIA':
            con.executemany('INSERT OR REPLACE INTO adv_history VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [(f['crd'], roster_date, f['filing_date'], f['aum_total'], f['aum_disc'], f['clients_total'], f['employees'])
                             for f in firms])
    con.close()
    return {'rows': len(firms)}


# ---------- Form ADV: the fuller data (Schedule A/B people, Schedule D 7.B.(1) private funds) ----------

def _member_kind(name):
    n = name.lower()
    if 'schedule_a_b' in n or 'schedule_a' in n or 'schedule a' in n:
        return 'people'
    if '7b1' in n or '7_b_1' in n or '7b_1' in n:
        return 'funds'
    # Only Base A maps FilingID -> CRD; Base B (and any later Base C, D...) holds more items without a CRD.
    if re.search(r'base[ _-]?a(?![a-z])', n):
        return 'base'
    return None


def parse_schedule_ab(row, schedule_hint=''):
    """An owner or executive officer from Schedule A (direct owners/officers) or B (indirect owners)."""
    name = pick(row, *A_PERSON)
    if not name:
        return None
    kind = pick(row, *A_PERSON_KIND).upper()
    schedule = pick(row, *A_SCHEDULE) or schedule_hint
    title = pick(row, *A_TITLE)
    return {'name': name, 'title': title, 'individual': kind in ('', 'I'),
            'schedule': 'B' if schedule.upper().strip().endswith('B') else 'A',
            'ownership': pick(row, *A_OWNERSHIP), 'acquired': pick(row, 'dateacquired', 'datetitleorstatusacquired', 'statusacquired')}


def parse_private_fund(row):
    """One private fund from Schedule D Section 7.B.(1)."""
    name = pick(row, *A_FUND)
    if not name:
        return None
    return {'name': name, 'fund_id': pick(row, *A_FUND_ID), 'fund_type': pick(row, *A_FUND_TYPE),
            'gav': money(pick(row, *A_GAV)), 'owners': integer(pick(row, *A_OWNERS))}


def load_adv_full(db_path, zip_paths):
    """Loads people and private funds from the latest filing of each adviser across the Form ADV data releases."""
    con = connect(db_path)
    members = []  # (zip path, member name, kind)
    for zp in zip_paths:
        with zipfile.ZipFile(zp) as zf:
            members += [(zp, n, _member_kind(n)) for n in zf.namelist() if n.lower().endswith(('.csv', '.txt')) and _member_kind(n)]
    _progress(con, 'Reading Form ADV filings', 0, len(members))
    latest = {}  # crd -> (date, filing id)
    filing_crd = {}
    for zp, name, kind in members:
        if kind != 'base':
            continue
        with zipfile.ZipFile(zp) as zf, zf.open(name) as fh:
            keys, rows = peek(stream_rows(fh, ',', 'cp1252'))
            note_headers(con, 'adv_full', f'{Path(zp).name}/{name}', keys, 'adv_base')
            for row in rows:
                fid, crd = pick(row, 'filingid'), integer(pick(row, *A_BASE_CRD))
                if not fid or not crd:
                    continue
                date = parse_date(pick(row, *A_BASE_DATE))
                filing_crd[fid] = crd
                if crd not in latest or (date, fid) > latest[crd]:
                    latest[crd] = (date, fid)
    if not any(k == 'base' for _, _, k in members):
        raise HeaderError('The Form ADV data download has no IA_ADV_Base_A table (FilingID -> CRD). Nothing was saved.')
    keep = {fid: (crd, latest[crd][0]) for fid, crd in filing_crd.items() if latest[crd][1] == fid}
    people, funds = [], []
    for i, (zp, name, kind) in enumerate(members):
        if kind == 'base':
            continue
        _progress(con, 'Reading Form ADV schedules', i, len(members))
        hint = 'B' if re.search(r'schedule_b', name.lower()) else ''
        with zipfile.ZipFile(zp) as zf, zf.open(name) as fh:
            keys, rows = peek(stream_rows(fh, ',', 'cp1252'))
            note_headers(con, 'adv_full', f'{Path(zp).name}/{name}', keys, 'adv_people' if kind == 'people' else 'adv_funds')
            for row in rows:
                fid = pick(row, 'filingid')
                if fid not in keep:
                    continue
                crd, date = keep[fid]
                if kind == 'people':
                    p = parse_schedule_ab(row, hint)
                    if p and p['individual']:
                        people.append((f'crd-{crd}', None, p['name'], p['title'], f'ADV Schedule {p["schedule"]}', fid,
                                       1 if KEY_TITLE.search(p['title'] or '') else 0, date, p['ownership']))
                else:
                    f = parse_private_fund(row)
                    if f:
                        funds.append((crd, f['fund_id'], f['name'], f['fund_type'], f['gav'], f['owners'], date))
    with con:
        con.execute("DELETE FROM people WHERE source LIKE 'ADV Schedule%'")
        con.executemany('INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', people)
        con.execute('DELETE FROM private_funds')
        con.executemany('INSERT INTO private_funds VALUES (?, ?, ?, ?, ?, ?, ?)', funds)
    con.close()
    return {'people': len(people), 'funds': len(funds), 'advisers': len(latest)}


# ---------- Form 13F data sets ----------

#: Filings submitted from 3 January 2023 report value to the nearest dollar; earlier ones in thousands of dollars.
DOLLARS_FROM = '2023-01-03'


def value_multiplier(filing_date):
    return 1 if (filing_date or '9999') >= DOLLARS_FROM else 1000


def choose_13f_filings(submissions, covers):
    """For each (filer CIK, period) the accessions whose holdings count, in filing order: an original report or a
    restatement replaces what came before; a "new holdings" amendment adds to it. Notices (13F-NT) hold nothing."""
    chosen = {}
    ordered = sorted(submissions.values(), key=lambda s: (s['filed'], s['accession']))
    for s in ordered:
        if not s['type'].upper().startswith('13F-HR'):
            continue
        key = (s['cik'], s['period'])
        if adds_only(s, covers.get(s['accession'], {})) and key in chosen:
            chosen[key].append(s['accession'])
        else:
            chosen[key] = [s['accession']]
    return chosen


def adds_only(submission, cover):
    """A "new holdings" amendment: it adds positions to the earlier report instead of replacing it."""
    amendment = yes(cover.get('isamendment')) or submission['type'].upper().endswith('/A')
    return amendment and 'NEW HOLDINGS' in (cover.get('amendmenttype') or '').upper()


def parse_13f_holding(row, multiplier):
    value = money(row.get('value'))
    return {'issuer': row.get('nameofissuer', ''), 'class': row.get('titleofclass', ''), 'cusip': (row.get('cusip') or '').upper(),
            'value': value * multiplier if value is not None else None, 'shares': money(row.get('sshprnamt')),
            'share_type': row.get('sshprnamttype', ''), 'put_call': (row.get('putcall') or '').title(),
            'discretion': row.get('investmentdiscretion', '')}


def _zip_table(zf, stem):
    name = next((n for n in zf.namelist() if n.rsplit('/', 1)[-1].upper().split('.')[0] == stem), None)
    return name


def load_13f(db_path, zip_path):
    """Loads one 13F data set: filers (from the cover pages) and the holdings of their chosen filings."""
    con = connect(db_path)
    _progress(con, 'Reading 13F cover pages')
    label = Path(zip_path).name
    with zipfile.ZipFile(zip_path) as zf:
        def rows(stem, required=True, check=None):
            name = _zip_table(zf, stem)
            if not name:
                if required:
                    raise HeaderError(f'The SEC 13F download {label} has no {stem} table. Nothing from it was saved.')
                return []
            with zf.open(name) as fh:
                out = list(stream_rows(fh))
            note_headers(con, '13f', f'{label}/{name}', list(out[0]) if out else [], f'13f_{check or stem}')
            return out
        info = _zip_table(zf, 'INFOTABLE')
        if not info:
            raise HeaderError(f'The SEC 13F download {label} has no INFOTABLE table. Nothing from it was saved.')
        with zf.open(info) as fh:
            note_headers(con, '13f', f'{label}/{info}', list(next(stream_rows(fh), {})), '13f_INFOTABLE')
        submissions = {}
        for r in rows('SUBMISSION'):
            cik = clean_cik(r.get('cik'))
            if cik:
                submissions[r['accessionnumber']] = {'accession': r['accessionnumber'], 'cik': cik, 'type': r.get('submissiontype', ''),
                                                     'filed': parse_date(r.get('filingdate')), 'period': parse_date(r.get('periodofreport'))}
        covers = {r['accessionnumber']: r for r in rows('COVERPAGE')}
        rows('SUMMARYPAGE', False)  # only checked: totals come from the rows saved
        signatures = rows('SIGNATURE', False)
        others = rows('OTHERMANAGER2', False, 'OTHERMANAGER') or rows('OTHERMANAGER', False)
        chosen = choose_13f_filings(submissions, covers)
        keep = {acc: key for key, accs in chosen.items() for acc in accs}
        _progress(con, 'Reading 13F holdings')
        holdings, count = [], 0
        with con:
            for (cik, period), accs in chosen.items():
                if adds_only(submissions[accs[0]], covers.get(accs[0], {})):
                    # Only "new holdings" amendments for this quarter in this data set: the original report came in an
                    # earlier data set, so add to it (replacing just these amendments' own rows if loaded before).
                    con.executemany('DELETE FROM holdings_13f WHERE accession = ?', [(a,) for a in accs])
                else:
                    con.execute('DELETE FROM holdings_13f WHERE cik = ? AND period = ?', (cik, period))
            name = info
            if name:
                with zf.open(name) as fh:
                    for r in stream_rows(fh):
                        acc = r.get('accessionnumber')
                        if acc not in keep:
                            continue
                        s = submissions[acc]
                        h = parse_13f_holding(r, value_multiplier(s['filed']))
                        holdings.append((s['cik'], s['period'], h['cusip'], h['issuer'], h['class'], h['value'], h['shares'],
                                         h['share_type'], h['put_call'], h['discretion'], acc))
                        if len(holdings) >= 50000:
                            con.executemany('INSERT INTO holdings_13f VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', holdings)
                            count += len(holdings)
                            holdings = []
                            _progress(con, 'Reading 13F holdings', count, 0)
            con.executemany('INSERT INTO holdings_13f VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', holdings)
            count += len(holdings)
    _progress(con, 'Saving 13F filers')
    with con:
        # Filers: the newest filing per CIK sets the name and address.
        newest = {}
        for s in submissions.values():
            if s['accession'] in covers and (s['cik'] not in newest or (s['period'], s['filed']) > (newest[s['cik']]['period'], newest[s['cik']]['filed'])):
                newest[s['cik']] = s
        for cik, s in newest.items():
            c = covers[s['accession']]
            old = con.execute('SELECT latest_period, latest_filed FROM filers_13f WHERE cik = ?', (cik,)).fetchone()
            if old and (old['latest_period'] or '', old['latest_filed'] or '') > (s['period'], s['filed']):
                continue
            accs = chosen.get((cik, s['period']), [])
            # Totals from the rows saved (the summary page of an amendment covers only that amendment).
            total, entries = con.execute('SELECT SUM(value), COUNT(*) FROM holdings_13f WHERE cik = ? AND period = ?', (cik, s['period'])).fetchone()
            con.execute('INSERT OR REPLACE INTO filers_13f VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (
                cik, c.get('filingmanagername', ''), ' '.join(x for x in (c.get('filingmanagerstreet1', ''), c.get('filingmanagerstreet2', '')) if x),
                c.get('filingmanagercity', ''), c.get('filingmanagerstateorcountry', ''), c.get('filingmanagerzipcode', ''),
                integer(c.get('crdnumber')), c.get('secfilenumber', ''), c.get('form13ffilenumber', ''), s['period'],
                accs[-1] if accs else s['accession'], s['filed'], total or None,
                entries or None, c.get('reporttype', ''), ''))
        sig_rows = []
        for r in signatures:
            s = submissions.get(r.get('accessionnumber'))
            if s and r.get('name'):
                sig_rows.append((f'cik-{s["cik"]}', None, r['name'], r.get('title', ''), '13F signature', s['accession'],
                                 1 if KEY_TITLE.search(r.get('title', '')) else 0, s['filed'], ''))
                if r.get('phone'):
                    con.execute("UPDATE filers_13f SET phone = ? WHERE cik = ? AND (phone IS NULL OR phone = '')", (r['phone'], s['cik']))
        accs = {r[5] for r in sig_rows}
        con.executemany("DELETE FROM people WHERE source = '13F signature' AND source_ref = ?", [(a,) for a in accs])
        con.executemany('INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', sig_rows)
        other_rows = []
        for r in others:
            s = submissions.get(r.get('accessionnumber'))
            if s and r.get('name'):
                other_rows.append((s['cik'], s['period'], r['name'], integer(r.get('crdnumber')), r.get('secfilenumber', ''), r.get('form13ffilenumber', '')))
        for cik, period in {(r[0], r[1]) for r in other_rows}:
            con.execute('DELETE FROM other_managers_13f WHERE cik = ? AND period = ?', (cik, period))
        con.executemany('INSERT INTO other_managers_13f VALUES (?, ?, ?, ?, ?, ?)', other_rows)
        prune_13f(con)
    con.close()
    return {'filers': len(newest), 'holdings': count}


def prune_13f(con, keep=KEEP_13F_PERIODS):
    """Keeps each filer's newest `keep` reported quarters (older quarters would only fill the disk)."""
    periods = {}
    for cik, period in con.execute('SELECT DISTINCT cik, period FROM holdings_13f'):
        periods.setdefault(cik, []).append(period)
    cutoffs = [(cik, sorted(ps, reverse=True)[keep - 1]) for cik, ps in periods.items() if len(ps) > keep]
    con.executemany('DELETE FROM holdings_13f WHERE cik = ? AND period < ?', cutoffs)


# ---------- Form D data sets ----------

def load_formd(db_path, zip_path):
    """Loads one Form D data set: offerings of pooled investment funds (and any issuer whose name clearly says family
    office) and their related persons."""
    con = connect(db_path)
    _progress(con, 'Reading Form D filings')
    label = Path(zip_path).name
    with zipfile.ZipFile(zip_path) as zf:
        def rows(stem):
            name = _zip_table(zf, stem)
            if not name:
                raise HeaderError(f'The SEC Form D download {label} has no {stem} table. Nothing from it was saved.')
            with zf.open(name) as fh:
                out = list(stream_rows(fh))
            note_headers(con, 'formd', f'{label}/{name}', list(out[0]) if out else [], f'formd_{stem}')
            return out
        subs = {r['accessionnumber']: r for r in rows('FORMDSUBMISSION')}
        offerings = {r['accessionnumber']: r for r in rows('OFFERING')}
        issuers = {}
        for r in rows('ISSUERS'):
            if (r.get('isprimaryissuerflag') or 'YES').upper() in ('YES', 'Y', 'TRUE', '1', ''):
                issuers.setdefault(r['accessionnumber'], r)
        people = rows('RELATEDPERSONS')
    keep, out = set(), []
    for acc, issuer in issuers.items():
        off = offerings.get(acc, {})
        industry = off.get('industrygrouptype', '')
        name = issuer.get('entityname', '')
        if industry != 'Pooled Investment Fund' and family_office_name(name)[0] < 2:
            continue
        keep.add(acc)
        sub = subs.get(acc, {})
        out.append((acc, clean_cik(issuer.get('cik')), name, issuer.get('entitytype', ''), industry, off.get('investmentfundtype', ''),
                    ' '.join(x for x in (issuer.get('street1', ''), issuer.get('street2', '')) if x), issuer.get('city', ''),
                    issuer.get('stateorcountry', ''), issuer.get('zipcode', ''), issuer.get('issuerphonenumber', ''),
                    parse_date(sub.get('filingdate') or sub.get('filing_date')), money(off.get('totalofferingamount')),
                    money(off.get('totalamountsold')), integer(off.get('totalnumberalreadyinvested')),
                    money(off.get('minimuminvestmentaccepted')), 1 if (sub.get('submissiontype') or '').upper().endswith('/A') else 0))
    person_rows = []
    for r in people:
        acc = r.get('accessionnumber')
        if acc not in keep:
            continue
        name = ' '.join(x for x in (r.get('firstname', ''), r.get('middlename', ''), r.get('lastname', '')) if x)
        roles = [r.get(f'relationship{i}') for i in (1, 2, 3)]
        title = ', '.join(x for x in [*roles, r.get('relationshipclarification', '')] if x)
        cik = clean_cik(issuers[acc].get('cik'))
        if name and cik:
            person_rows.append((f'cik-{cik}', None, name, title, 'Form D related person', acc, 1 if KEY_TITLE.search(title) else 0,
                                parse_date(subs.get(acc, {}).get('filingdate')), ''))
    with con:
        con.executemany('INSERT OR REPLACE INTO formd_offerings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', out)
        con.executemany("DELETE FROM people WHERE source = 'Form D related person' AND source_ref = ?", [(a,) for a in keep])
        con.executemany('INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', person_rows)
    con.close()
    return {'offerings': len(out), 'people': len(person_rows)}


# ---------- Names, matching and the classifier ----------

SUFFIXES = {'llc', 'lp', 'llp', 'lllp', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'plc',
            'pllc', 'pc', 'na', 'the', 'sa', 'ag', 'gmbh', 'ltda', 'lc'}


def normalize_name(name):
    """'The Smith Family Office, L.L.C. /DE/' -> 'smith family office'."""
    s = str(name or '').lower()
    s = re.sub(r'/[a-z]{2,3}/?', ' ', s).replace('.', '').replace('&', ' and ')
    words = [w for w in re.sub(r'[^a-z0-9 ]', ' ', s).split() if w not in SUFFIXES]
    return ' '.join(words)


def name_similarity(a, b):
    """0..1: half character similarity, half shared words (Dice), on normalized names."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = set(na.split()), set(nb.split())
    dice = 2 * len(ta & tb) / (len(ta) + len(tb))
    return 0.5 * difflib.SequenceMatcher(None, na, nb).ratio() + 0.5 * dice


def match_score(a, b):
    """How likely two records (name, city, state, zip) are the same organization: (score 0..1, reasons)."""
    score = name_similarity(a.get('name'), b.get('name'))
    reasons = [f'names {round(score * 100)}% alike']
    sa, sb = (a.get('state') or '').upper(), (b.get('state') or '').upper()
    if sa and sb and sa != sb:
        score -= 0.15
        reasons.append('different states')
    za, zb = zip5(a.get('zip')), zip5(b.get('zip'))
    if za and za == zb:
        score += 0.05
        reasons.append('same ZIP')
    elif (a.get('city') or '').lower() and (a.get('city') or '').lower() == (b.get('city') or '').lower() and sa == sb:
        score += 0.03
        reasons.append('same city')
    return max(0.0, min(1.0, round(score, 3))), reasons


def same_place(a, b):
    """Same ZIP, or same city and state: a name-only match needs this as well before two records are merged."""
    za, zb = zip5(a.get('zip')), zip5(b.get('zip'))
    if za and za == zb:
        return True
    ca, cb = (a.get('city') or '').strip().lower(), (b.get('city') or '').strip().lower()
    return bool(ca) and ca == cb and (a.get('state') or '').upper() == (b.get('state') or '').upper()


LINK_SCORE = 0.92      # merged into one firm (with same_place)
POSSIBLE_SCORE = 0.80  # shown as a possible match, not merged


class NameIndex:
    """Finds candidate records by their first normalized word (so 10,000 names aren't compared with 20,000)."""

    def __init__(self, records):
        self.exact, self.first = {}, {}
        for r in records:
            n = normalize_name(r['name'])
            if not n:
                continue
            self.exact.setdefault(n, []).append(r)
            self.first.setdefault(n.split()[0], []).append(r)

    def best(self, record):
        n = normalize_name(record.get('name'))
        if not n:
            return None, 0.0, []
        candidates = self.exact.get(n) or self.first.get(n.split()[0], [])
        best, best_score, best_reasons = None, 0.0, []
        words = set(n.split())
        for c in candidates:
            other = set(normalize_name(c['name']).split())
            # score <= 0.5 + dice/2 + 0.05, so a pair under POSSIBLE_SCORE can be skipped before the slow comparison.
            if 0.5 + len(words & other) / (len(words) + len(other)) + 0.05 < POSSIBLE_SCORE:
                continue
            score, reasons = match_score(record, c)
            if score > best_score:
                best, best_score, best_reasons = c, score, reasons
        return best, best_score, best_reasons


FO_STRONG = re.compile(r'\bfamily office|\bfamily offices\b|\bmulti[- ]?family\b|\bprivate family\b|\bfamily (capital|investment|investments|'
                       r'holdings|partners|ventures|enterprises?|wealth|trust|lp|fund|management|interests|group)\b', re.I)
FO_WEAK = re.compile(r'\bfamily\b|\b(holdings|investments|ventures|interests|private capital|& sons|and sons|legacy)\b', re.I)
MFO = re.compile(r'\bmulti[- ]?family\b|\bfamily office', re.I)
INSTITUTION = re.compile(r'\b(bank|bancorp|bancshares|banc|trust company|national association|insurance|assurance|life|mutual|pension|'
                         r'retirement|teachers|employees|university|college|endowment|foundation|state of|county|city of|board|'
                         r'church|hospital|health system|credit union|securities|brokerage|exchange|government)\b', re.I)


def family_office_name(name):
    """(strength, reason): 2 = says family office (or similar), 1 = a weaker hint, 0 = nothing in the name."""
    text = str(name or '')
    m = FO_STRONG.search(text)
    if m:
        return 2, f'name contains "{m.group(0)}"'
    m = FO_WEAK.search(text)
    if m:
        return 1, f'name contains "{m.group(0)}" (a weak hint)'
    return 0, ''


def client_signals(mix, clients_total, aum_total):
    """Family-office-like client mix from Form ADV Item 5.D: mostly wealthy families, few clients, large accounts."""
    out = []
    mix = mix or {}
    if clients_total:
        hnw = (mix.get('hnw') or {}).get('count') or 0
        if hnw / clients_total >= 0.5:
            out.append(f'{round(hnw / clients_total * 100)}% of clients are high-net-worth individuals')
        if aum_total and clients_total <= 150 and aum_total / clients_total >= 20e6:
            out.append(f'few clients ({clients_total}) with about ${aum_total / clients_total / 1e6:,.0f}M each')
    return out


def classify(f):
    """The firm's type with a confidence word and the reasons. `f`: kind (RIA/ERA/None), name, other_names, has13f,
    client_mix, clients_total, aum_total, funds, offerings. Facts from a filing say "from filing"; family-office
    labels are never more than "strong signals"."""
    names = [f.get('name') or ''] + list(f.get('other_names') or [])
    strength, name_reason = max((family_office_name(n) for n in names), key=lambda x: x[0])
    mfo_name = any(MFO.search(n) for n in names)
    kind = f.get('kind')
    if kind in ('RIA', 'ERA'):
        reasons = [f'files Form ADV as an {"SEC-registered adviser" if kind == "RIA" else "exempt reporting adviser"}']
        signals = client_signals(f.get('client_mix'), f.get('clients_total'), f.get('aum_total')) if kind == 'RIA' else []
        if kind == 'RIA' and (mfo_name or (strength == 2 and signals) or len(signals) >= 2):
            if name_reason:
                reasons.append(name_reason)
            reasons += signals
            confidence = ('strong signals' if mfo_name and signals else 'moderate signals' if mfo_name or strength == 2
                          else 'weak signals')
            reasons.append('registered advisers serving several families are often called multi-family offices; check the brochure (Form ADV Part 2)')
            return {'type': TYPE_MFO, 'confidence': confidence, 'reasons': reasons}
        if strength == 2:
            reasons.append(name_reason + ' — it may be a family office that registers (check the brochure)')
        return {'type': TYPE_RIA if kind == 'RIA' else TYPE_ERA, 'confidence': 'from filing', 'reasons': reasons}
    if f.get('has13f'):
        reasons = ['files Form 13F (holds $100M+ in US-listed securities)', 'no matching Form ADV found (not an SEC-registered or exempt adviser under this name)']
        inst = next((m.group(0) for n in names for m in [INSTITUTION.search(n)] if m), None)
        if inst and strength < 2:
            reasons.append(f'name contains "{inst}", which points to a bank, insurer, pension or other institution')
            return {'type': TYPE_13F, 'confidence': 'moderate signals', 'reasons': reasons}
        if strength == 2:
            reasons.append(name_reason)
            reasons.append('single-family offices are excluded from adviser registration (Rule 202(a)(11)(G)-1) but must still file 13F')
            return {'type': TYPE_FO, 'confidence': 'strong signals' if not inst else 'moderate signals', 'reasons': reasons}
        if strength == 1:
            reasons.append(name_reason)
            reasons.append('could also be a corporation, a foreign manager or an adviser registered under another name')
            return {'type': TYPE_FO, 'confidence': 'weak signals', 'reasons': reasons}
        reasons.append('could be a bank, insurer, pension, corporation, foreign manager, state-registered adviser or a family office')
        return {'type': TYPE_13F, 'confidence': 'unknown', 'reasons': reasons}
    reasons = ['known only from Form D (raises money privately); no Form ADV or 13F found']
    if strength == 2:
        reasons.append(name_reason)
        return {'type': TYPE_FO, 'confidence': 'moderate signals' if f.get('offerings') else 'weak signals', 'reasons': reasons}
    return {'type': TYPE_FORMD, 'confidence': 'from filing', 'reasons': reasons}


# ---------- Building the firm list ----------

def _address_key(street, city, state, zip_code):
    parts = [str(x or '').strip().upper() for x in (street, city, state, zip5(zip_code))]
    return '|'.join(parts) if parts[0] and (parts[3] or (parts[1] and parts[2])) else ''


def map_cusips(con, tickers):
    """CUSIP -> ticker/CIK by exact normalized-name match of the 13F issuer name to the SEC's ticker list. Only
    names that point to one company are mapped; the rest keep just their CUSIP."""
    by_name = {}
    for ticker, info in (tickers or {}).items():
        n = normalize_name(info.get('name'))
        if n:
            by_name.setdefault(n, {})
            by_name[n].setdefault(int(info['cik']), []).append(ticker)
    rows = []
    known = {r['cusip'] for r in con.execute('SELECT cusip FROM cusip_map')}
    for r in con.execute('SELECT cusip, MAX(issuer) AS issuer FROM holdings_13f GROUP BY cusip'):
        if r['cusip'] in known:
            continue
        hit = by_name.get(normalize_name(r['issuer']))
        if hit and len(hit) == 1:
            cik, symbols = next(iter(hit.items()))
            rows.append((r['cusip'], sorted(symbols, key=len)[0], cik, r['issuer'], 'issuer name matched the SEC ticker list', None, None))
    con.executemany('INSERT OR REPLACE INTO cusip_map VALUES (?, ?, ?, ?, ?, ?, ?)', rows)
    return len(rows)


def build_firms(db_path, tickers=None):
    """Rebuilds `firms` and `links` from the loaded sources: exact identifiers first (CRD, SEC file number, CIK),
    then normalized name + address. Deterministic, so it can run after any ingest."""
    con = connect(db_path)
    _progress(con, 'Matching firms across ADV, 13F and Form D')
    adv = [dict(r) for r in con.execute('SELECT * FROM adv_firms')]
    filers = [dict(r) for r in con.execute('SELECT * FROM filers_13f')]
    offerings = [dict(r) for r in con.execute('SELECT * FROM formd_offerings ORDER BY filed')]
    funds = {}
    for r in con.execute('SELECT crd, COUNT(*) AS n, SUM(gav) AS gav FROM private_funds GROUP BY crd'):
        funds[r['crd']] = (r['n'], r['gav'])
    fund_names = {}
    for r in con.execute('SELECT crd, name FROM private_funds'):
        fund_names.setdefault(normalize_name(r['name']), set()).add(r['crd'])

    firms, links = {}, []
    by_crd, by_sec = {}, {}
    for a in adv:
        fid = f'crd-{a["crd"]}'
        firms[fid] = {'id': fid, 'kind': a['kind'], 'name': a['business_name'] or a['legal_name'], 'other_names': [],
                      'crd': a['crd'], 'sec_number': a['sec_number'], 'cik': None, 'street': a['street'], 'city': a['city'],
                      'state': a['state'], 'zip': a['zip'], 'phone': a['phone'], 'website': a['website'], 'aum_total': a['aum_total'],
                      'aum_disc': a['aum_disc'], 'clients_total': a['clients_total'],
                      'client_mix': json.loads(a['client_mix']) if a['client_mix'] else {}, 'employees': a['employees'],
                      'fees': a['fees'], 'filing_date': a['filing_date'], 'has13f': 0, 'value_13f': None, 'period_13f': None,
                      'funds': funds.get(a['crd'], (0, None))[0], 'funds_gav': funds.get(a['crd'], (0, None))[1], 'offerings': 0}
        if a['legal_name'] and a['legal_name'] != firms[fid]['name']:
            firms[fid]['other_names'].append(a['legal_name'])
        links.append((fid, 'Form ADV', str(a['crd']), 'CRD', 1.0, 'linked', firms[fid]['name']))
        by_crd[a['crd']] = fid
        if a['sec_number']:
            by_sec[a['sec_number'].strip().upper()] = fid
    index = NameIndex([{'name': f['name'], 'city': f['city'], 'state': f['state'], 'zip': f['zip'], 'id': f['id']} for f in firms.values()]
                      + [{'name': n, 'city': f['city'], 'state': f['state'], 'zip': f['zip'], 'id': f['id']} for f in firms.values() for n in f['other_names']])
    by_cik = {}

    def attach(fid, cik, name):
        f = firms[fid]
        if f['cik'] is None:
            f['cik'] = cik
        if name and normalize_name(name) != normalize_name(f['name']) and name not in f['other_names']:
            f['other_names'].append(name)
        by_cik[cik] = fid

    for fl in filers:
        rec = {'name': fl['name'], 'city': fl['city'], 'state': fl['state'], 'zip': fl['zip']}
        target, method, score = None, '', 0.0
        if fl['crd'] and fl['crd'] in by_crd:
            target, method, score = by_crd[fl['crd']], 'CRD on the 13F cover page', 1.0
        elif fl['sec_file'] and fl['sec_file'].strip().upper() in by_sec:
            target, method, score = by_sec[fl['sec_file'].strip().upper()], 'SEC file number on the 13F cover page', 1.0
        else:
            best, score, reasons = index.best(rec)
            if best and score >= LINK_SCORE and same_place(rec, best):
                target, method = best['id'], 'name and address: ' + ', '.join(reasons)
            elif best and score >= POSSIBLE_SCORE:
                links.append((best['id'], 'Form 13F', str(fl['cik']), 'name and address: ' + ', '.join(reasons), score, 'possible', fl['name']))
        if target is None:
            target = f'cik-{fl["cik"]}'
            firms[target] = {'id': target, 'kind': None, 'name': fl['name'], 'other_names': [], 'crd': None, 'sec_number': None,
                             'cik': fl['cik'], 'street': fl['street'], 'city': fl['city'], 'state': fl['state'], 'zip': fl['zip'],
                             'phone': fl['phone'], 'website': '', 'aum_total': None, 'aum_disc': None, 'clients_total': None,
                             'client_mix': {}, 'employees': None, 'fees': '', 'filing_date': fl['latest_filed'], 'has13f': 0,
                             'value_13f': None, 'period_13f': None, 'funds': 0, 'funds_gav': None, 'offerings': 0}
            method, score = 'CIK', 1.0
        attach(target, fl['cik'], fl['name'])
        f = firms[target]
        f['has13f'], f['value_13f'], f['period_13f'] = 1, fl['total_value'], fl['latest_period']
        links.append((target, 'Form 13F', str(fl['cik']), method, score, 'linked', fl['name']))

    offering_counts = {}
    for o in offerings:
        cik = o['cik']
        target, method, score = by_cik.get(cik), 'CIK', 1.0
        if target is None:
            n = normalize_name(o['name'])
            advisers = fund_names.get(n, set())
            if len(advisers) == 1 and next(iter(advisers)) in by_crd:
                # The issuer is one of this adviser's private funds (same fund name in Schedule D 7.B.(1)).
                links.append((by_crd[next(iter(advisers))], 'Form D (fund)', str(cik), 'fund name in Schedule D 7.B.(1)', 0.9, 'linked', o['name']))
                offering_counts[by_crd[next(iter(advisers))]] = offering_counts.get(by_crd[next(iter(advisers))], 0) + 1
                continue
            best, s, reasons = index.best(o)
            if best and s >= LINK_SCORE and same_place(o, best):
                target, method, score = best['id'], 'name and address: ' + ', '.join(reasons), s
            elif best and s >= POSSIBLE_SCORE:
                links.append((best['id'], 'Form D', str(cik), 'name and address: ' + ', '.join(reasons), s, 'possible', o['name']))
                continue
            elif family_office_name(o['name'])[0] == 2:
                target = f'cik-{cik}'
                if target not in firms:
                    firms[target] = {'id': target, 'kind': None, 'name': o['name'], 'other_names': [], 'crd': None, 'sec_number': None,
                                     'cik': cik, 'street': o['street'], 'city': o['city'], 'state': o['state'], 'zip': o['zip'],
                                     'phone': o['phone'], 'website': '', 'aum_total': None, 'aum_disc': None, 'clients_total': None,
                                     'client_mix': {}, 'employees': None, 'fees': '', 'filing_date': o['filed'], 'has13f': 0,
                                     'value_13f': None, 'period_13f': None, 'funds': 0, 'funds_gav': None, 'offerings': 0}
            else:
                continue
        if target in firms:
            if cik not in by_cik:
                attach(target, cik, o['name'])
            offering_counts[target] = offering_counts.get(target, 0) + 1
            links.append((target, 'Form D', str(cik), method, score, 'linked', o['name']))
    for fid, n in offering_counts.items():
        firms[fid]['offerings'] = n

    geo = {r['address']: (r['lat'], r['lon']) for r in con.execute("SELECT address, lat, lon FROM geocache WHERE status = 'match'")}
    zcta = {r['zip']: (r['lat'], r['lon']) for r in con.execute('SELECT zip, lat, lon FROM zcta')}
    rows = []
    for f in firms.values():
        c = classify(f)
        key = _address_key(f['street'], f['city'], f['state'], f['zip'])
        lat, lon, how = None, None, ''
        if key in geo:
            (lat, lon), how = geo[key], 'address'
        elif zip5(f['zip']) in zcta:
            (lat, lon), how = zcta[zip5(f['zip'])], 'zip'
        mix = f['client_mix'] or {}
        types = ',' + ','.join(k for k, v in mix.items() if (v.get('count') or v.get('fewerThan5') or v.get('aum'))) + ','
        rows.append((f['id'], f['name'], json.dumps(f['other_names']), c['type'], c['confidence'], json.dumps(c['reasons']),
                     f['crd'], f['sec_number'], f['cik'], f['street'], f['city'], (f['state'] or '').upper(), f['zip'], f['phone'],
                     f['website'], f['aum_total'], f['aum_disc'], f['clients_total'], json.dumps(mix) if mix else '', types,
                     f['employees'], f['fees'], f['filing_date'], f['has13f'], f['value_13f'], f['period_13f'], f['funds'],
                     f['funds_gav'], f['offerings'], lat, lon, how))
    mapped = 0
    with con:
        con.execute('DELETE FROM firms')
        con.executemany(f'INSERT INTO firms VALUES ({",".join("?" * 32)})', rows)
        con.execute('DELETE FROM links')
        con.executemany('INSERT INTO links VALUES (?, ?, ?, ?, ?, ?, ?)', links)
        # People belong to the firm that carries their CRD or CIK.
        con.execute('UPDATE people SET firm_id = NULL')
        con.execute("UPDATE people SET firm_id = firm_key WHERE firm_key IN (SELECT id FROM firms)")
        for cik, fid in by_cik.items():
            con.execute('UPDATE people SET firm_id = ? WHERE firm_key = ?', (fid, f'cik-{cik}'))
        if tickers:
            mapped = map_cusips(con, tickers)
        set_meta(con, 'built', {'at': time.time(), 'firms': len(rows), 'links': len(links)})
    con.close()
    return {'firms': len(rows), 'links': len(links), 'cusipsMapped': mapped}


# ---------- Geography ----------

def haversine_miles(lat1, lon1, lat2, lon2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def bounding_box(lat, lon, miles):
    dlat = miles / 69.0
    dlon = miles / max(1e-6, 69.0 * math.cos(math.radians(lat)))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon


def census_batch_csv(rows):
    """The Census batch geocoder's input: id, street, city, state, ZIP (no header)."""
    out = io.StringIO()
    w = csv.writer(out)
    for i, (street, city, state, zip_code) in enumerate(rows):
        w.writerow([i, street, city, state, zip5(zip_code)])
    return out.getvalue()


def parse_census_batch(text):
    """{id: (lat, lon, matched address) or None}. Census answers 'id, input, Match/No_Match/Tie, Exact/Non_Exact,
    matched address, "lon,lat", ...' — note longitude comes first."""
    out = {}
    for row in csv.reader(io.StringIO(text)):
        if not row or not row[0].strip().isdigit():
            continue
        i = int(row[0])
        if len(row) >= 6 and row[2].strip().lower() == 'match':
            try:
                lon, lat = (float(x) for x in row[5].split(','))
                out[i] = (lat, lon, row[4])
                continue
            except ValueError:
                pass
        out[i] = None
    return out


def parse_census_one(data):
    """The Census one-line geocoder's JSON -> (lat, lon, matched address) or None (no match)."""
    matches = ((data or {}).get('result') or {}).get('addressMatches') or []
    if not matches:
        return None
    m = matches[0]
    c = m.get('coordinates') or {}
    if c.get('x') is None or c.get('y') is None:
        return None
    return float(c['y']), float(c['x']), m.get('matchedAddress') or ''


def parse_zcta(text):
    rows = []
    for r in text_rows(text, '\t'):
        zip_code, lat, lon = r.get('geoid'), money(r.get('intptlat')), money(r.get('intptlong'))
        if zip_code and lat is not None and lon is not None:
            rows.append((zip_code, lat, lon))
    return rows


# ---------- Portfolio maths (13F) ----------

def aggregate_positions(rows):
    """Rows of one filer-quarter -> {key: position}. The key is the CUSIP plus Put/Call, so options stay apart."""
    out = {}
    for r in rows:
        key = (r['cusip'], r.get('put_call') or '')
        p = out.setdefault(key, {'cusip': r['cusip'], 'issuer': r.get('issuer'), 'class': r.get('class'), 'putCall': r.get('put_call') or '',
                                 'value': 0.0, 'shares': 0.0})
        p['value'] += r.get('value') or 0
        p['shares'] += r.get('shares') or 0
    total = sum(p['value'] for p in out.values())
    for p in out.values():
        p['weight'] = p['value'] / total if total else 0.0
    return out


def qoq_changes(current, previous, tolerance=0.01):
    """Each position's change since the previous quarter, by share count: new, added, trimmed, exited, unchanged."""
    out = []
    for key, p in current.items():
        old = previous.get(key)
        if old is None:
            change = 'new'
        elif p['shares'] > old['shares'] * (1 + tolerance):
            change = 'added'
        elif p['shares'] < old['shares'] * (1 - tolerance):
            change = 'trimmed'
        else:
            change = 'unchanged'
        out.append({**p, 'change': change, 'previousShares': old['shares'] if old else None,
                    'previousValue': old['value'] if old else None, 'shareChange': p['shares'] - old['shares'] if old else p['shares']})
    for key, old in previous.items():
        if key not in current:
            out.append({**old, 'value': 0.0, 'shares': 0.0, 'weight': 0.0, 'change': 'exited', 'previousShares': old['shares'],
                        'previousValue': old['value'], 'shareChange': -old['shares']})
    out.sort(key=lambda p: (-p['value'], -(p['previousValue'] or 0)))
    return out


def weights_by_cusip(positions):
    """Long stock weights by CUSIP (options left out), for overlap and turnover."""
    w = {}
    for p in positions.values():
        if not p.get('putCall'):
            w[p['cusip']] = w.get(p['cusip'], 0.0) + p['value']
    total = sum(w.values())
    return {k: v / total for k, v in w.items()} if total else {}


def overlap(wa, wb, top=10):
    """Portfolio overlap = the sum over shared holdings of the smaller weight (0..1); shared holdings and the largest
    weight differences."""
    shared = set(wa) & set(wb)
    diffs = sorted(set(wa) | set(wb), key=lambda k: -abs(wa.get(k, 0) - wb.get(k, 0)))[:top]
    return {'overlap': sum(min(wa[k], wb[k]) for k in shared), 'shared': len(shared), 'sharedList': sorted(shared, key=lambda k: -(wa[k] + wb[k])),
            'differences': [{'cusip': k, 'a': wa.get(k, 0.0), 'b': wb.get(k, 0.0), 'diff': wa.get(k, 0.0) - wb.get(k, 0.0)} for k in diffs]}


def turnover(current, previous):
    """Half the sum of absolute weight changes between two quarters (0 = same portfolio, 1 = completely new)."""
    if not current or not previous:
        return None
    return 0.5 * sum(abs(current.get(k, 0.0) - previous.get(k, 0.0)) for k in set(current) | set(previous))


# ---------- Worker processes ----------

USE_PROCESSES = True  # tests switch this off (runs in a thread)
_pool = None


def _worker_init():
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)


async def _offload(fn_name, *args):
    """Runs a loader in the 'prospect' spawn worker so parsing millions of rows never stalls live quotes."""
    global _pool
    if USE_PROCESSES:
        try:
            if _pool is None:
                _pool = concurrent.futures.ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context('spawn'), initializer=_worker_init)
            return await asyncio.get_running_loop().run_in_executor(_pool, _job, fn_name, args)
        except concurrent.futures.process.BrokenProcessPool as err:
            log.info('Prospect worker stopped (%s): running in the helper instead', err)
            _pool = None
    return await asyncio.to_thread(_job, fn_name, args)


def _job(fn_name, args):
    return globals()[fn_name](*args)


def shutdown():
    global _pool
    if _pool is not None:
        _pool.shutdown(wait=False, cancel_futures=True)
        _pool = None


# ---------- Downloads (polite to the SEC) ----------

_pace_lock = None
_last_sec = [0.0]


async def _sec_pace():
    global _pace_lock
    if _pace_lock is None:
        _pace_lock = asyncio.Lock()
    async with _pace_lock:
        wait = _last_sec[0] + SEC_GAP - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_sec[0] = time.monotonic()


def _need_contact(ctx):
    if not ctx.sec_contact:
        raise EngineError('SEC data needs a contact email: open Settings (the gear at the bottom of the left menu) and add your email under "SEC email".')


async def sec_page(ctx, url):
    from . import sec
    _need_contact(ctx)
    await _sec_pace()
    return (await sec.sec_get(ctx, url)).text


async def download(ctx, url, dest, emit=None, label='', client=None, attempts=5):
    """Downloads `url` to `dest`, resuming a partial file (HTTP Range), retrying with backoff on 429/5xx/network
    errors and never running two SEC downloads at once. Returns the path."""
    from . import sec
    sec_host = 'sec.gov' in urllib.parse.urlparse(url).netloc
    if sec_host:
        _need_contact(ctx)
    http = client or (ctx.sec_http if sec_host else ctx.http)
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + '.part')
    for attempt in range(attempts):
        have = part.stat().st_size if part.exists() else 0
        # identity: a compressed reply would make byte ranges and progress refer to the compressed stream
        headers = {'Accept-Encoding': 'identity', **({'Range': f'bytes={have}-'} if have else {})}
        try:
            if sec_host:
                await _sec_pace()
            slots = sec._sec_slots if sec_host else asyncio.Semaphore(1)
            async with slots:
                async with http.stream('GET', url, headers=headers, timeout=120) as response:
                    if response.status_code == 416 and have:
                        part.rename(dest)  # already complete
                        return dest
                    if response.status_code in (403,):
                        raise EngineError('The SEC refused the download. Check the SEC email in Settings (gear icon, bottom left), '
                                          'or the SEC rate limit was hit: wait 10 minutes and try again.')
                    if response.status_code == 404:
                        raise EngineError(f'The file is no longer on the website ({url.rsplit("/", 1)[-1]}).')
                    if response.status_code == 429 or response.status_code >= 500:
                        retry = response.headers.get('Retry-After', '')
                        raise _Retry(float(retry) if retry.isdigit() else None)
                    response.raise_for_status()
                    if response.status_code == 200 and have:
                        have = 0  # the server ignored the range: start again
                    total = have + int(response.headers.get('Content-Length') or 0)
                    last = 0.0
                    with open(part, 'ab' if have else 'wb') as fh:
                        async for chunk in response.aiter_raw(1 << 20):
                            fh.write(chunk)
                            have += len(chunk)
                            if emit and time.monotonic() - last > 1:
                                last = time.monotonic()
                                pct = f' {have / total * 100:.0f}%' if total else ''
                                await emit({'type': 'status', 'text': f'Downloading {label or dest.name}{pct} ({have / 1e6:,.0f} MB)'})
            part.replace(dest)
            return dest
        except EngineError:
            raise
        except Exception as err:  # network error or _Retry
            if attempt == attempts - 1:
                raise EngineError(f'Download of {dest.name} failed after {attempts} tries: {err}') from err
            delay = getattr(err, 'after', None) or min(60, 2 ** (attempt + 1))
            log.info('Download of %s interrupted (%s); retrying in %s s', dest.name, err, delay)
            await asyncio.sleep(delay)
    return dest


class _Retry(Exception):
    def __init__(self, after=None):
        super().__init__('server busy')
        self.after = after


def _file_name(url):
    return re.sub(r'[^A-Za-z0-9._-]', '_', urllib.parse.unquote(url.rsplit('/', 1)[-1]))


# ---------- Ingest jobs ----------

JOB = {'running': False}
_ingest_lock = None


async def _watch_progress(db_path, emit, future):
    """Turns the worker's progress notes (meta 'progress') into engine events until it finishes."""
    seen = None
    while not future.done():
        await asyncio.sleep(1.5)
        try:
            con = sqlite3.connect(db_path, timeout=5)
            row = con.execute("SELECT value FROM meta WHERE key = 'progress'").fetchone()
            con.close()
        except sqlite3.Error:
            continue
        if row and row[0] != seen:
            seen = row[0]
            p = json.loads(row[0])
            JOB['stage'] = p['stage']
            text = p['stage'] + (f' ({p["done"]:,}/{p["total"]:,})' if p.get('total') else f' ({p["done"]:,} rows)' if p.get('done') else '')
            if emit:
                await emit({'type': 'status', 'text': text})


async def _run_worker(emit, fn_name, *args):
    task = asyncio.ensure_future(_offload(fn_name, *args))
    watcher = asyncio.ensure_future(_watch_progress(args[0], emit, task))
    try:
        return await task
    finally:
        watcher.cancel()


def _loaded(db_path, source):
    con = connect(db_path)
    try:
        return get_meta(con, f'ingest:{source}', {}) or {}
    finally:
        con.close()


def _record(db_path, source, info):
    con = connect(db_path)
    with con:
        set_meta(con, f'ingest:{source}', {**info, 'at': time.time()})
    con.close()


async def ingest_adv(ctx, emit, db_path):
    links = page_links(await sec_page(ctx, INDEX_PAGES['adv']), INDEX_PAGES['adv'])
    files = pick_adv_files(links)
    if not files:
        raise EngineError('No adviser lists were found on the SEC page (its layout may have changed).')
    done = set(_loaded(db_path, 'adv').get('history', []))
    results = []
    for i, (url, kind, date) in enumerate(files):
        newest_of_kind = all(f[1] != kind or f[2] <= date for f in files)
        if not newest_of_kind and url in done:
            continue
        dest = await download(ctx, url, DOWNLOADS / _file_name(url), emit, f'{kind} list {date}')
        r = await _run_worker(emit, 'load_adv_roster', str(db_path), str(dest), kind, date, not newest_of_kind)
        results.append({'file': url.rsplit('/', 1)[-1], 'kind': kind, 'date': date, **r})
        done.add(url)
        dest.unlink(missing_ok=True)
    _record(db_path, 'adv', {'files': results, 'history': sorted(done), 'sourceDate': files[0][2]})
    return results


async def ingest_adv_full(ctx, emit, db_path):
    links = page_links(await sec_page(ctx, INDEX_PAGES['adv_full']), INDEX_PAGES['adv_full'])
    files = pick_adv_full_files(links)
    if not files:
        raise EngineError('No Form ADV data files were found on the SEC page (its layout may have changed).')
    paths = [await download(ctx, url, DOWNLOADS / _file_name(url), emit, f'Form ADV data ({i + 1}/{len(files)})') for i, url in enumerate(files)]
    try:
        r = await _run_worker(emit, 'load_adv_full', str(db_path), [str(p) for p in paths])
    finally:
        for p in paths:
            p.unlink(missing_ok=True)
    newest = _date_key(files[0])
    _record(db_path, 'adv_full', {'files': [u.rsplit('/', 1)[-1] for u in files], 'sourceDate': newest, **r,
                                  'note': adv_full_note(newest)})
    return r


def adv_full_note(newest):
    """What the owner should know about the age of the people and private-fund data."""
    note = f'People and private funds as of {newest} (latest SEC Form ADV data release)'
    if newest and newest < (dt.date.today() - dt.timedelta(days=200)).isoformat():
        note += '; the SEC bulk data has not been updated since (it ended in Dec 2024 when this was built), so check IAPD for changes'
    return note + '.' 


async def ingest_13f(ctx, emit, db_path):
    links = page_links(await sec_page(ctx, INDEX_PAGES['13f']), INDEX_PAGES['13f'])
    files = pick_13f_files(links)
    if not files:
        raise EngineError('No 13F data sets were found on the SEC page (its layout may have changed).')
    results = []
    for url in reversed(files):  # older first, so the newest quarter's filers win
        dest = await download(ctx, url, DOWNLOADS / _file_name(url), emit, f'13F data {_date_key(url)}')
        r = await _run_worker(emit, 'load_13f', str(db_path), str(dest))
        results.append({'file': url.rsplit('/', 1)[-1], **r})
        dest.unlink(missing_ok=True)
    _record(db_path, '13f', {'files': results, 'sourceDate': _date_key(files[0])})
    return results


async def ingest_formd(ctx, emit, db_path):
    links = page_links(await sec_page(ctx, INDEX_PAGES['formd']), INDEX_PAGES['formd'])
    files = pick_formd_files(links)
    if not files:
        raise EngineError('No Form D data sets were found on the SEC page (its layout may have changed).')
    dest = await download(ctx, files[0], DOWNLOADS / _file_name(files[0]), emit, f'Form D data {_date_key(files[0])}')
    r = await _run_worker(emit, 'load_formd', str(db_path), str(dest))
    dest.unlink(missing_ok=True)
    _record(db_path, 'formd', {'files': [files[0].rsplit('/', 1)[-1]], 'sourceDate': _date_key(files[0]), **r})
    return r


async def ingest_geo(ctx, emit, db_path):
    """Geocodes firm addresses not seen before with the Census batch geocoder (free, no key) and loads ZIP centroids."""
    con = connect(db_path)
    has_zcta = con.execute('SELECT COUNT(*) FROM zcta').fetchone()[0]
    rows = con.execute('SELECT DISTINCT street, city, state, zip FROM firms WHERE street != \'\'').fetchall()
    known = {r[0] for r in con.execute('SELECT address FROM geocache')}
    con.close()
    if not has_zcta:
        for url in ZCTA_URLS:
            try:
                dest = await download(ctx, url, DOWNLOADS / _file_name(url), emit, 'ZIP code centroids')
                with zipfile.ZipFile(dest) as zf:
                    text = _decode(zf.read(next(n for n in zf.namelist() if n.lower().endswith('.txt'))))
                zrows = parse_zcta(text)
                con = connect(db_path)
                with con:
                    con.executemany('INSERT OR REPLACE INTO zcta VALUES (?, ?, ?)', zrows)
                con.close()
                dest.unlink(missing_ok=True)
                break
            except Exception as err:
                log.info('ZIP centroids from %s failed: %s', url, err)
    todo, seen = [], set()
    for r in rows:
        key = _address_key(*r)
        if key and key not in known and key not in seen and len((r[2] or '')) == 2:
            seen.add(key)
            todo.append((key, tuple(r)))
    matched = 0
    for start in range(0, len(todo), GEOCODE_BATCH):
        chunk = todo[start:start + GEOCODE_BATCH]
        if emit:
            await emit({'type': 'status', 'text': f'Finding map locations {start:,}/{len(todo):,} (US Census geocoder)'})
        body = census_batch_csv([c[1] for c in chunk])
        result = None
        for attempt in range(3):
            try:
                resp = await ctx.http.post(CENSUS_BATCH, data={'benchmark': 'Public_AR_Current'},
                                           files={'addressFile': ('addresses.csv', body, 'text/csv')}, timeout=600)
                resp.raise_for_status()
                result = parse_census_batch(resp.text)
                break
            except Exception as err:
                log.info('Census geocoder batch failed (%s), try %d', err, attempt + 1)
                await asyncio.sleep(5 * (attempt + 1))
        if result is None:
            continue  # leave these for next time
        now = time.time()
        con = connect(db_path)
        with con:
            for i, (key, _) in enumerate(chunk):
                hit = result.get(i)
                con.execute('INSERT OR REPLACE INTO geocache VALUES (?, ?, ?, ?, ?, ?)',
                            (key, hit[0] if hit else None, hit[1] if hit else None, hit[2] if hit else '', 'match' if hit else 'no match', now))
                matched += 1 if hit else 0
        con.close()
    con = connect(db_path)
    with con:
        apply_geocodes(con)
        set_meta(con, 'ingest:geo', {'at': time.time(), 'geocoded': len(todo), 'matched': matched})
    con.close()
    return {'geocoded': len(todo), 'matched': matched}


def apply_geocodes(con):
    """Copies cached coordinates onto firms (address first, else the ZIP's centre)."""
    geo = {r['address']: (r['lat'], r['lon']) for r in con.execute("SELECT address, lat, lon FROM geocache WHERE status = 'match'")}
    zcta = {r['zip']: (r['lat'], r['lon']) for r in con.execute('SELECT zip, lat, lon FROM zcta')}
    updates = []
    for f in con.execute('SELECT id, street, city, state, zip FROM firms'):
        key = _address_key(f['street'], f['city'], f['state'], f['zip'])
        if key in geo:
            updates.append((*geo[key], 'address', f['id']))
        elif zip5(f['zip']) in zcta:
            updates.append((*zcta[zip5(f['zip'])], 'zip', f['id']))
    con.executemany('UPDATE firms SET lat = ?, lon = ?, geo = ? WHERE id = ?', updates)


INGESTERS = {'adv': ingest_adv, 'adv_full': ingest_adv_full, '13f': ingest_13f, 'formd': ingest_formd, 'geo': ingest_geo}


async def run_ingest(ctx, source, emit=None, db_path=None):
    """Runs one source (or 'all') then rebuilds the firm list. One ingest at a time."""
    global _ingest_lock
    db_path = Path(db_path or DB_PATH)
    if _ingest_lock is None:
        _ingest_lock = asyncio.Lock()
    if _ingest_lock.locked():
        raise EngineError(f'A download is already running ({JOB.get("source")}). Check prospect.status for progress.')
    sources = ['adv', 'adv_full', '13f', 'formd', 'geo'] if source == 'all' else [source]
    async with _ingest_lock:
        JOB.update({'running': True, 'source': source, 'started': time.time(), 'stage': 'Starting', 'error': None})
        out = {}
        try:
            failed = []
            for s in sources:
                JOB['stage'] = f'{s}: starting'
                if s == 'geo':
                    out[s] = await ingest_geo(ctx, emit, db_path)
                    continue
                con = connect(db_path)
                with con:
                    set_meta(con, f'headers:{s}', [])
                con.close()
                try:
                    out[s] = await INGESTERS[s](ctx, emit, db_path)
                except HeaderError as err:
                    if source != 'all':
                        raise
                    out[s] = {'error': str(err)}
                    failed.append(str(err))
                    continue
                tickers = None
                try:
                    from . import sec
                    tickers = await sec.tickers(ctx)
                except Exception as err:
                    log.info('Ticker list unavailable for CUSIP mapping: %s', err)
                out['build'] = await _run_worker(emit, 'build_firms', str(db_path), tickers)
            JOB.update({'running': False, 'finished': time.time(), 'stage': 'Done' if not failed else 'Done with problems',
                        'result': out, 'error': ' '.join(failed) or None})
            return out
        except Exception as err:
            JOB.update({'running': False, 'finished': time.time(), 'stage': 'Failed', 'error': str(err)})
            raise


async def schedule_loop(ctx, db_path=None):
    """Keeps already-downloaded sources fresh: the monthly adviser lists and the quarterly 13F / Form D data sets
    (looked for monthly; a file is only downloaded when the SEC has a newer one). Never starts a source you haven't
    downloaded yourself."""
    db_path = Path(db_path or DB_PATH)
    await asyncio.sleep(600)
    while True:
        if db_path.exists():
            for source, days in REFRESH_DAYS.items():
                info = _loaded(db_path, source)
                if not info or time.time() - info.get('at', 0) < days * 86400:
                    continue
                try:
                    links = page_links(await sec_page(ctx, INDEX_PAGES[source]), INDEX_PAGES[source])
                    newest = {'adv': lambda: (pick_adv_files(links, 0) or [('', '', '')])[0][2], '13f': lambda: _date_key((pick_13f_files(links, 1) or [''])[0]),
                              'formd': lambda: _date_key((pick_formd_files(links) or [''])[0]),
                              'adv_full': lambda: _date_key((pick_adv_full_files(links) or [''])[0])}[source]()
                    if newest and newest > (info.get('sourceDate') or ''):
                        await run_ingest(ctx, source)
                        if source == 'adv':
                            await run_ingest(ctx, 'geo')
                    else:
                        _record(db_path, source, {**info})  # checked: nothing newer yet
                except Exception as err:
                    log.info('Scheduled %s refresh skipped: %s', source, err)
        await asyncio.sleep(6 * 3600)


# ---------- Queries ----------

def _firm_row(r, extra=None):
    d = dict(r)
    for k in ('other_names', 'reasons'):
        d[k] = json.loads(d[k]) if d.get(k) else []
    d['client_mix'] = json.loads(d['client_mix']) if d.get('client_mix') else {}
    d['fees'] = json.loads(d['fees']) if d.get('fees') else []
    d.pop('client_types', None)
    return {**_camel(d), **(extra or {})}


def _camel(d):
    return {re.sub(r'_([a-z0-9])', lambda m: m.group(1).upper(), k): v for k, v in d.items()}


def zip_point(con, zip_code):
    z = zip5(zip_code)
    row = con.execute('SELECT lat, lon FROM zcta WHERE zip = ?', (z,)).fetchone()
    if row:
        return row['lat'], row['lon']
    row = con.execute('SELECT AVG(lat), AVG(lon) FROM firms WHERE zip LIKE ? AND lat IS NOT NULL', (z + '%',)).fetchone()
    return (row[0], row[1]) if row and row[0] is not None else None


def resolve_holding(con, holds):
    """{symbol} or {cusip} -> list of CUSIPs."""
    holds = holds or {}
    cusip = str(holds.get('cusip') or '').strip().upper()
    if cusip:
        return [cusip]
    symbol = str(holds.get('symbol') or '').strip().upper()
    if not symbol:
        return []
    row = con.execute('SELECT cik FROM cusip_map WHERE ticker = ?', (symbol,)).fetchone()
    if not row:
        return []
    return [r[0] for r in con.execute('SELECT cusip FROM cusip_map WHERE cik = ?', (row[0],))]


SORTS = {'aum': 'COALESCE(aum_total, value_13f, 0) DESC', 'name': 'name COLLATE NOCASE', 'clients': 'COALESCE(clients_total, 0) DESC',
         'filed': 'filing_date DESC', 'value13f': 'COALESCE(value_13f, 0) DESC', 'funds': 'COALESCE(funds_gav, 0) DESC'}


def search(con, q):
    """Filters the firm list. Returns {total, rows}. See the prospect.search handler for the fields."""
    where, args = [], []
    text = str(q.get('text') or '').strip()
    if text:
        like = f'%{text}%'
        where.append('(name LIKE ? OR other_names LIKE ? OR id IN (SELECT firm_id FROM people WHERE name LIKE ?) OR CAST(crd AS TEXT) = ? OR CAST(cik AS TEXT) = ?)')
        args += [like, like, like, text, text.lstrip('0')]
    raw = q.get('types') if q.get('types') is not None else q.get('type')  # 'type' is reserved in helper messages (the kind); kept for direct calls
    types = [t for t in (raw if isinstance(raw, (list, tuple)) else []) if t in TYPES]
    if types:
        where.append(f'type IN ({",".join("?" * len(types))})')
        args += types
    for field in ('state', 'city'):
        if q.get(field):
            where.append(f'UPPER({field}) = ?')
            args.append(str(q[field]).strip().upper())
    if q.get('zip'):
        where.append('zip LIKE ?')
        args.append(str(q['zip']).strip() + '%')
    for field, col, op in (('aumMin', 'aum_total', '>='), ('aumMax', 'aum_total', '<=')):
        if q.get(field) is not None and money(q.get(field)) is not None:
            where.append(f'{col} {op} ?')
            args.append(money(q[field]))
    for key in q.get('clientTypes') or []:
        if key in CLIENT_KEYS:
            where.append('client_types LIKE ?')
            args.append(f'%,{key},%')
    if q.get('has13f'):
        where.append('has13f = 1')
    if q.get('hasPrivateFunds'):
        where.append('funds > 0')
    position_sql = None
    if q.get('holds'):
        cusips = resolve_holding(con, q['holds'])
        if not cusips:
            return {'total': 0, 'rows': [], 'note': 'That holding was not found in the loaded 13F data (search by CUSIP if the ticker is not mapped).'}
        marks = ','.join('?' * len(cusips))
        position_sql = (f'(SELECT SUM(h.value) FROM holdings_13f h WHERE h.cik = firms.cik AND h.period = firms.period_13f '
                        f"AND h.cusip IN ({marks}) AND COALESCE(h.put_call, '') = '')")
        # Filter with the (cusip, cik, period) index first; the position column is then worked out for matches only.
        where.append(f"(cik, period_13f) IN (SELECT h.cik, h.period FROM holdings_13f h WHERE h.cusip IN ({marks}) "
                     f"AND COALESCE(h.put_call, '') = '' GROUP BY h.cik, h.period HAVING SUM(h.value) >= ?)")
        args += cusips + [money(q.get('minPosition')) or 1]
    near = q.get('near') or None
    centre = None
    if near:
        miles = money(near.get('miles')) or 25
        if near.get('zip'):
            centre = zip_point(con, near['zip'])
            if not centre:
                return {'total': 0, 'rows': [], 'note': f'ZIP {near["zip"]} has no known location yet (run the map step).'}
        elif near.get('lat') is not None and near.get('lon') is not None:
            centre = (float(near['lat']), float(near['lon']))
        if centre:
            lo_lat, hi_lat, lo_lon, hi_lon = bounding_box(centre[0], centre[1], miles)
            where.append('lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?')
            args += [lo_lat, hi_lat, lo_lon, hi_lon]
    select = 'SELECT *' + (f', {position_sql} AS position' if position_sql else '') + ' FROM firms'
    sql = select + (' WHERE ' + ' AND '.join(where) if where else '')
    params = (cusips if position_sql else []) + args
    sort = q.get('sort') or ('distance' if centre else 'position' if position_sql else 'aum')
    limit = max(1, min(int(q.get('limit') or 50), 5000))
    offset = max(0, int(q.get('offset') or 0))
    if centre:
        miles = money(near.get('miles')) or 25
        rows = []
        for r in con.execute(sql, params):
            d = haversine_miles(centre[0], centre[1], r['lat'], r['lon'])
            if d <= miles:
                rows.append((d, r))
        key = {'distance': lambda x: x[0], 'name': lambda x: (x[1]['name'] or '').lower(), 'position': lambda x: -(x[1]['position'] or 0)}.get(
            sort, lambda x: -((x[1]['aum_total'] or x[1]['value_13f'] or 0)))
        rows.sort(key=key)
        page = rows[offset:offset + limit]
        return {'total': len(rows), 'centre': {'lat': centre[0], 'lon': centre[1]},
                'rows': top_people(con, [_firm_row(r, {'distanceMiles': round(d, 2)}) for d, r in page])}
    total = con.execute(f'SELECT COUNT(*) FROM ({sql})', params).fetchone()[0]
    order = 'position DESC' if sort == 'position' and position_sql else SORTS.get(sort, SORTS['aum'])
    rows = con.execute(f'{sql} ORDER BY {order}, id LIMIT ? OFFSET ?', params + [limit, offset]).fetchall()
    return {'total': total, 'rows': top_people(con, [_firm_row(r) for r in rows])}


def top_people(con, rows, per_firm=3, page_max=500):
    """Adds `topPeople` (up to 3 per firm: CIO / portfolio manager titles first, then the newest filing) to a page
    of search rows. Pages bigger than `page_max` (exports, the map) skip it."""
    if not rows or len(rows) > page_max:
        return rows
    ids = [r['id'] for r in rows]
    found = {}
    for r in con.execute(f'SELECT firm_id, name, title, source, key_title FROM people WHERE firm_id IN ({",".join("?" * len(ids))}) '
                         'ORDER BY key_title DESC, filed DESC', ids):
        bucket = found.setdefault(r['firm_id'], [])
        if len(bucket) < per_firm and all(p['name'].lower() != r['name'].lower() for p in bucket):
            bucket.append({'name': r['name'], 'title': r['title'] or '', 'source': r['source'], 'keyTitle': bool(r['key_title'])})
    for r in rows:
        r['topPeople'] = found.get(r['id'], [])
    return rows


def latest_positions(con, cik, period=None):
    """(period, positions) and (previous period, positions) for a 13F filer."""
    periods = [r[0] for r in con.execute('SELECT DISTINCT period FROM holdings_13f WHERE cik = ? ORDER BY period DESC', (cik,))]
    if period:
        periods = [p for p in periods if p <= period]
    out = []
    for p in periods[:2]:
        rows = [dict(r) for r in con.execute('SELECT cusip, issuer, class, value, shares, put_call FROM holdings_13f WHERE cik = ? AND period = ?', (cik, p))]
        out.append((p, aggregate_positions(rows)))
    while len(out) < 2:
        out.append((None, {}))
    return out


def _tickers_for(con, cusips):
    if not cusips:
        return {}
    marks = ','.join('?' * len(cusips))
    return {r['cusip']: dict(r) for r in con.execute(f'SELECT * FROM cusip_map WHERE cusip IN ({marks})', list(cusips))}


def sector_mix(positions, mapping):
    """Weight by sector for long stock positions; unmapped value shows as "Not mapped"."""
    out = {}
    for p in positions.values():
        if p.get('putCall'):
            continue
        sector = (mapping.get(p['cusip']) or {}).get('sector') or 'Not mapped'
        out[sector] = out.get(sector, 0.0) + p['weight']
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def firm_profile(con, firm_id, holdings_limit=200):
    row = con.execute('SELECT * FROM firms WHERE id = ?', (firm_id,)).fetchone()
    if not row:
        raise EngineError('That firm is not in the prospect database (it may have been renamed in a newer download).')
    firm = _firm_row(row)
    firm['links'] = [dict(r) for r in con.execute('SELECT source, source_key AS sourceKey, method, score, status, name FROM links WHERE firm_id = ?', (firm_id,))]
    firm['aumHistory'] = [dict(r) for r in con.execute(
        'SELECT roster_date AS date, filing_date AS filed, aum_total AS aum, aum_disc AS discretionary, clients_total AS clients, employees '
        'FROM adv_history WHERE crd = ? ORDER BY roster_date', (row['crd'],))] if row['crd'] else []
    seen, people = set(), []
    for r in con.execute('SELECT name, title, source, source_ref, key_title, filed, ownership FROM people WHERE firm_id = ? ORDER BY key_title DESC, filed DESC', (firm_id,)):
        k = (r['name'].lower(), (r['title'] or '').lower(), r['source'])
        if k not in seen:
            seen.add(k)
            people.append({'name': r['name'], 'title': r['title'], 'source': r['source'], 'sourceRef': r['source_ref'],
                           'keyTitle': bool(r['key_title']), 'filed': r['filed'], 'ownership': r['ownership']})
    firm['people'] = people
    firm['privateFunds'] = [dict(r) for r in con.execute(
        'SELECT name, fund_id AS fundId, fund_type AS fundType, gav, owners, filing_date AS filed FROM private_funds WHERE crd = ? ORDER BY gav DESC', (row['crd'],))] if row['crd'] else []
    ciks = [int(r['source_key']) for r in con.execute("SELECT source_key FROM links WHERE firm_id = ? AND source LIKE 'Form D%' AND status = 'linked'", (firm_id,))]
    if row['cik']:
        ciks.append(row['cik'])
    firm['formDOfferings'] = [dict(r) for r in con.execute(
        f'SELECT accession, cik, name, fund_type AS fundType, filed, offering, sold, investors, minimum FROM formd_offerings WHERE cik IN ({",".join("?" * len(ciks))}) ORDER BY filed DESC',
        ciks)] if ciks else []
    holdings = {'period': None}
    if row['cik'] and row['has13f']:
        (period, cur), (prev_period, prev) = latest_positions(con, row['cik'])
        changes = qoq_changes(cur, prev) if prev_period else [{**p, 'change': None} for p in sorted(cur.values(), key=lambda p: -p['value'])]
        mapping = _tickers_for(con, {p['cusip'] for p in changes})
        for p in changes:
            p['ticker'] = (mapping.get(p['cusip']) or {}).get('ticker')
        counts = {}
        for p in changes:
            counts[p['change']] = counts.get(p['change'], 0) + 1
        holdings = {'period': period, 'previousPeriod': prev_period, 'total': sum(p['value'] for p in cur.values()), 'count': len(cur),
                    'changes': counts, 'positions': changes[:holdings_limit], 'sectors': sector_mix(cur, mapping),
                    'turnover': turnover(weights_by_cusip(cur), weights_by_cusip(prev)),
                    'otherManagers': [dict(r) for r in con.execute('SELECT name, crd, sec_file AS secFile FROM other_managers_13f WHERE cik = ? AND period = ?', (row['cik'], period))]}
    firm['holdings13f'] = holdings
    sources = []
    if row['crd']:
        sources.append({'label': 'Adviser record (IAPD)', 'url': IAPD_FIRM.format(crd=row['crd'])})
    for cik in sorted(set(ciks) | ({row['cik']} if row['cik'] else set())):
        sources.append({'label': f'EDGAR filings (CIK {cik})', 'url': EDGAR_COMPANY.format(cik=cik)})
    firm['sources'] = sources
    return firm


def compare(con, ids):
    firms = []
    weights = []
    for fid in ids:
        f = firm_profile(con, fid, holdings_limit=0)
        cur, prev = {}, {}
        if f['cik'] and f['has13f']:
            (_, cur), (_, prev) = latest_positions(con, f['cik'])
        w = weights_by_cusip(cur)
        weights.append(w)
        mix = f['clientMix'] or {}
        total = f['clientsTotal'] or 0
        firms.append({'id': fid, 'name': f['name'], 'type': f['type'], 'confidence': f['confidence'], 'aum': f['aumTotal'],
                      'discretionary': f['aumDisc'], 'clients': total, 'aumPerClient': f['aumTotal'] / total if f['aumTotal'] and total else None,
                      'employees': f['employees'], 'fees': f['fees'], 'privateFunds': f['funds'], 'privateFundsGav': f['fundsGav'],
                      'clientMix': {k: {'share': (v.get('count') or 0) / total if total else None, **v} for k, v in mix.items()},
                      'value13f': f.get('value13f'), 'period13f': f.get('period13f'),
                      'positions': len(w), 'turnover': turnover(w, weights_by_cusip(prev)), 'sectors': f['holdings13f'].get('sectors', {})})
    pairs = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            o = overlap(weights[i], weights[j])
            pairs.append({'a': ids[i], 'b': ids[j], 'overlap': o['overlap'], 'shared': o['shared'], 'differences': o['differences']})
    held = {}
    for w in weights:
        for k in w:
            held[k] = held.get(k, 0) + 1
    shared = sorted((k for k, n in held.items() if n >= 2), key=lambda k: (-held[k], -sum(w.get(k, 0) for w in weights)))[:25]
    mapping = _tickers_for(con, set(shared) | {d['cusip'] for p in pairs for d in p['differences']})
    names = {}
    for k in mapping:
        names[k] = mapping[k].get('ticker')
    issuer = {}
    for k in set(shared) | {d['cusip'] for p in pairs for d in p['differences']}:
        r = con.execute('SELECT issuer FROM holdings_13f WHERE cusip = ? LIMIT 1', (k,)).fetchone()
        issuer[k] = r[0] if r else ''
    for p in pairs:
        for d in p['differences']:
            d['ticker'], d['issuer'] = names.get(d['cusip']), issuer.get(d['cusip'])
    return {'firms': firms, 'pairs': pairs,
            'sharedHoldings': [{'cusip': k, 'ticker': names.get(k), 'issuer': issuer.get(k), 'heldBy': held[k], 'weights': [w.get(k, 0.0) for w in weights]} for k in shared]}


EXPORT_COLUMNS = [('name', 'Name'), ('type', 'Type'), ('confidence', 'Confidence'), ('crd', 'CRD'), ('secNumber', 'SEC number'),
                  ('cik', 'CIK'), ('aumTotal', 'Regulatory AUM ($)'), ('aumDisc', 'Discretionary AUM ($)'), ('clientsTotal', 'Clients'),
                  ('employees', 'Employees'), ('value13f', '13F value ($)'), ('period13f', '13F quarter'), ('funds', 'Private funds'),
                  ('fundsGav', 'Private fund gross assets ($)'), ('street', 'Street'), ('city', 'City'), ('state', 'State'), ('zip', 'ZIP'),
                  ('phone', 'Phone'), ('website', 'Website'), ('filingDate', 'Latest filing'), ('distanceMiles', 'Distance (miles)'),
                  ('position', 'Position ($)'), ('reasons', 'Why this type')]


def csv_cell(value):
    """A spreadsheet runs a cell that starts with = + - @ as a formula: those get a leading apostrophe."""
    if value is None:
        return ''
    if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def export_csv(con, query):
    result = search(con, {**(query or {}), 'limit': min(int((query or {}).get('limit') or 5000), 5000), 'offset': 0})
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow([label for _, label in EXPORT_COLUMNS])
    for r in result['rows']:
        w.writerow([csv_cell('; '.join(r.get(k) or []) if k == 'reasons' else r.get(k)) for k, _ in EXPORT_COLUMNS])
    return {'csv': out.getvalue(), 'count': len(result['rows']), 'total': result['total'], 'columns': [label for _, label in EXPORT_COLUMNS]}


def status(con, db_path=None):
    counts = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in
              ('firms', 'adv_firms', 'adv_history', 'people', 'private_funds', 'filers_13f', 'holdings_13f', 'formd_offerings', 'cusip_map', 'links', 'geocache', 'zcta')}
    types = {r[0]: r[1] for r in con.execute('SELECT type, COUNT(*) FROM firms GROUP BY type')}
    sources = {s: get_meta(con, f'ingest:{s}') for s in SOURCES}
    path = Path(db_path or DB_PATH)
    full = sources.get('adv_full') or {}
    return {'counts': counts, 'types': types, 'sources': sources, 'built': get_meta(con, 'built'),
            'headers': {s: get_meta(con, f'headers:{s}') for s in SOURCES if s != 'geo'},
            'peopleAsOf': full.get('sourceDate'), 'peopleNote': full.get('note'),
            'job': {k: v for k, v in JOB.items() if k != 'result'}, 'progress': get_meta(con, 'progress'),
            'sizeMb': round(path.stat().st_size / 1e6, 1) if path.exists() else 0, 'refreshDays': REFRESH_DAYS}


# ---------- Sectors for holdings (SEC SIC codes, cached in cusip_map) ----------

async def fill_sectors(ctx, db_path, cusips, limit=40):
    """Looks up the SIC sector for up to `limit` mapped issuers that don't have one yet (SEC submissions, cached)."""
    from . import sec
    try:
        from .risk import sector_of
    except Exception:
        return 0
    if not ctx.sec_contact:
        return 0
    con = connect(db_path)
    marks = ','.join('?' * len(cusips))
    todo = [dict(r) for r in con.execute(f'SELECT cusip, cik FROM cusip_map WHERE sector IS NULL AND cik IS NOT NULL AND cusip IN ({marks})', list(cusips))][:limit] if cusips else []
    con.close()
    done = {}
    for r in todo:
        try:
            await _sec_pace()
            subs = await sec.submissions(ctx, r['cik'])
            sic = str(subs.get('sic') or '').strip()
            done[r['cusip']] = (sector_of(sic) if sic else 'Other', sic)
        except Exception as err:
            log.info('Sector for CIK %s unavailable: %s', r['cik'], err)
    if done:
        con = connect(db_path)
        with con:
            con.executemany('UPDATE cusip_map SET sector = ?, sic = ? WHERE cusip = ?', [(s, sic, c) for c, (s, sic) in done.items()])
        con.close()
    return len(done)


# ---------- Diagnostics ----------

def diagnostics_section():
    """For Send diagnostics: what each download looked like (column checks), source dates and the last job."""
    if not DB_PATH.exists():
        return {'database': 'not created yet'}
    con = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True, timeout=5)
    try:
        return {'headers': {s: get_meta(con, f'headers:{s}') for s in SOURCES if s != 'geo'},
                'sources': {s: get_meta(con, f'ingest:{s}') for s in SOURCES},
                'job': {k: v for k, v in JOB.items() if k != 'result'}}
    finally:
        con.close()


try:
    from . import diagnostics as _diagnostics
    _diagnostics.SECTIONS['prospect'] = diagnostics_section
except Exception:  # diagnostics is optional
    pass


# ---------- Handlers ----------

async def _query(fn, *args, db_path=None):
    def run():
        con = connect(db_path)
        try:
            return fn(con, *args)
        finally:
            con.close()
    return await asyncio.to_thread(run)


def _ids(value, low=1, high=5):
    ids = [str(x) for x in (value or []) if str(x).strip()]
    if not low <= len(ids) <= high:
        raise EngineError(f'Pick between {low} and {high} firms.')
    return ids


@handler('prospect.status')
async def h_status(ctx, msg):
    """Data freshness, row counts, the last download of each source and any running job."""
    return await _query(status, DB_PATH)


@handler('prospect.ingest')
async def h_ingest(ctx, msg):
    """{source: adv|adv_full|13f|formd|geo|all, wait?}. Without wait the download runs in the background and
    prospect.status shows its progress; with wait the reply comes at the end and progress streams as events."""
    source = str(msg.get('source') or '')
    if source not in (*SOURCES, 'all'):
        raise EngineError(f'Unknown source "{source}". Use one of: {", ".join(SOURCES)}, all.')
    if source != 'geo':
        _need_contact(ctx)
    if msg.get('wait'):
        return {'result': await run_ingest(ctx, source, msg.get('_emit'))}
    if JOB.get('running'):
        raise EngineError(f'A download is already running ({JOB.get("source")}).')

    async def go():
        try:
            await run_ingest(ctx, source)
        except Exception as err:
            log.warning('Prospect download %s failed: %s', source, err)
    background(go())
    return {'started': True, 'source': source}


@handler('prospect.search')
async def h_search(ctx, msg):
    """{text, types[], state, city, zip, near:{lat,lon,miles}|{zip,miles}, aumMin, aumMax, clientTypes[], holds:{symbol|cusip},
    minPosition, has13f, hasPrivateFunds, sort (aum|name|clients|filed|value13f|funds|distance|position), limit, offset}.
    `id` and `type` are the message's own (request id, kind), so firm types come as `types`."""
    return await _query(search, {k: v for k, v in msg.items() if not k.startswith('_') and k not in ('id', 'type')})


@handler('prospect.firm')
async def h_firm(ctx, msg):
    """{firmId} -> the full profile ('id' is reserved in helper messages)."""
    firm_id = str(msg.get('firmId') or '')
    profile = await _query(firm_profile, firm_id)
    positions = profile['holdings13f'].get('positions') or []
    if positions:
        filled = await fill_sectors(ctx, DB_PATH, [p['cusip'] for p in positions[:40]])
        if filled:
            profile = await _query(firm_profile, firm_id)
    return profile


@handler('prospect.compare')
async def h_compare(ctx, msg):
    ids = _ids(msg.get('ids'), 2, 5)
    result = await _query(compare, ids)
    cusips = [s['cusip'] for s in result['sharedHoldings']]
    if cusips and await fill_sectors(ctx, DB_PATH, cusips):
        result = await _query(compare, ids)
    return result


@handler('prospect.geocode')
async def h_geocode(ctx, msg):
    """{address} -> {lat, lon, label, method}: a 5-digit ZIP uses the loaded ZIP centres; anything else goes to the
    free Census one-line geocoder (US street addresses only, no key)."""
    address = str(msg.get('address') or '').strip()
    if not address:
        raise EngineError('Type a ZIP code or a street address.')
    if re.fullmatch(r'\d{5}(-\d{4})?', address):
        point = await _query(zip_point, address)
        if not point:
            raise EngineError(f'ZIP {address[:5]} has no known location yet (run "Map locations" in the Data panel).')
        return {'lat': point[0], 'lon': point[1], 'label': f'ZIP {address[:5]} (centre)', 'method': 'zip'}
    try:
        resp = await ctx.http.get(CENSUS_ONE, params={'address': address, 'benchmark': 'Public_AR_Current', 'format': 'json'}, timeout=30)
        resp.raise_for_status()
        hit = parse_census_one(resp.json())
    except Exception as err:
        raise EngineError(f'The Census geocoder could not be reached ({err}). Try a ZIP code instead.') from err
    if not hit:
        raise EngineError('The Census geocoder found no match for that address. Check the spelling, or use a ZIP code.')
    return {'lat': hit[0], 'lon': hit[1], 'label': hit[2], 'method': 'address'}


@handler('prospect.export')
async def h_export(ctx, msg):
    """{query: same fields as prospect.search} -> {csv, count, total, columns} (up to 5,000 rows)."""
    return await _query(export_csv, msg.get('query') or {})
