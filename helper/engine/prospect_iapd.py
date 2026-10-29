"""
Prospecting gaps filled one adviser at a time from IAPD (adviserinfo.sec.gov), the SEC's public adviser site.

1. Form ADV Part 1 PDFs (people and private funds after the bulk data ended). The SEC's bulk "Form ADV data" (Schedule
   A owners/officers, Schedule D 7.B.(1) private funds) ended in Dec 2024. For every SEC-registered adviser whose
   roster shows a newer filing than its bulk filing (or that is missing from the bulk data), this reads the public
   PDF https://reports.adviserinfo.sec.gov/reports/ADV/{crd}/PDF/{crd}.pdf and parses Schedule A and Section
   7.B.(1). It runs in the background, one request every 2 seconds, saved firms first, then firms the owner opens,
   then by AUM. Needs the optional `pypdf` package (requirements-extra.txt); without it the reader says so.
   UNVERIFIED LIVE: the parser was written from the documented Form ADV layout and IAPD's PDF text (the sandbox it was
   built in cannot reach the site). Every firm it can't read is reported ("couldn't read Schedule A"), never silent.

2. State-registered advisers (BETA). Small RIAs register with their state, not the SEC, so the SEC rosters miss
   them. They are listed from the IAPD firm search that adviserinfo.sec.gov itself uses
   (api.adviserinfo.sec.gov/search/firm), page by page per state, politely. The search has no public documentation:
   the request parameters and reply fields are best guesses from how the site behaves, so the reply's shape is
   checked first and a different shape fails this source with a clear message (the rest of the download carries on).
"""
import asyncio
import datetime as dt
import io
import json
import logging
import re
import time
from pathlib import Path

from . import prospect as pr
from .core import EngineError, handler

log = logging.getLogger('engine.prospect')

IAPD_PDF = pr.IAPD_PDF
IAPD_SEARCH = 'https://api.adviserinfo.sec.gov/search/firm'
IAPD_GAP = 2.0  # seconds between IAPD requests
PDF_SOURCE = 'Form ADV Part 1 (IAPD PDF)'
PDF_TRIES = 3  # a PDF that can't be fetched is tried again on later passes, then left
PAGE_ROWS = 100
MAX_PAGES = 100  # per state (10,000 firms; no state has that many state-registered advisers)
STATES = ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR '
          'PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU').split()


class ShapeError(pr.HeaderError):
    """IAPD answered in a shape this reader doesn't know (nothing from it was saved)."""


_pace_lock = None
_last = [0.0]


async def _pace():
    global _pace_lock
    if _pace_lock is None:
        _pace_lock = asyncio.Lock()
    async with _pace_lock:
        wait = _last[0] + IAPD_GAP - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last[0] = time.monotonic()


def _http(ctx):
    """The SEC client: its User-Agent names the platform and the owner's SEC contact email (honest, as the SEC asks)."""
    pr._need_contact(ctx)
    return ctx.sec_http or ctx.http


# ---------- Form ADV Part 1 PDF: text -> Schedule A people and Section 7.B.(1) funds ----------

def pdf_reader_available():
    try:
        import pypdf  # noqa: F401
        return True
    except Exception:
        return False


PDF_MISSING = ('Reading Form ADV PDFs needs the optional pypdf package: run the helper\'s start file again (it installs '
               'requirements-extra.txt), or run "pip install pypdf".')


def pdf_text(data):
    """All pages' text of a PDF (bytes), using pypdf."""
    try:
        import pypdf
    except Exception as err:
        raise EngineError(PDF_MISSING) from err
    reader = pypdf.PdfReader(io.BytesIO(data))
    return '\n'.join((page.extract_text() or '') for page in reader.pages)


SCHEDULE_A = re.compile(r'^\s*Schedule A\b', re.I | re.M)
SCHEDULE_END = re.compile(r'^\s*(Schedule [BCDR]\b|DRP Pages)', re.I | re.M)
#: one Schedule A row: name, DE/FE/I, title or status, date acquired MM/YYYY, ownership code, control person, PR, CRD
A_ROW = re.compile(r"^(?P<name>[A-Za-z0-9][\w ,.'&()/\-]*?)\s+(?P<kind>DE|FE|I)\s+(?P<title>.+?)\s+(?P<date>\d{2}/\d{4})\s+"
                   r"(?P<own>NA|[A-E])\s+(?P<control>[YN])\s+(?P<pr>[YN])(?:\s+(?P<crd>\d[\d\-]*))?\s*$")
OWNERSHIP = {'NA': 'less than 5%', 'A': '5% - 10%', 'B': '10% - 25%', 'C': '25% - 50%', 'D': '50% - 75%', 'E': '75% or more'}
HEADER_WORDS = ('FULL LEGAL NAME', 'DE/FE/I', 'Ownership Code', 'Title or Status', 'Employer ID')
FILED_AT = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M')


def filing_date(text):
    """The filing's date from the PDF's page header ('3/28/2025 4:15:02 PM'), else ''."""
    m = FILED_AT.search(text or '')
    if not m:
        return ''
    try:
        return dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
    except ValueError:
        return ''


def parse_schedule_a(text):
    """(rows, problem): Schedule A direct owners and executive officers. A row the PDF wraps over several lines is
    joined back. problem is '' when rows were read, else what went wrong (the firm is reported, never skipped)."""
    m = SCHEDULE_A.search(text or '')
    if not m:
        return [], "couldn't find Schedule A"
    end = SCHEDULE_END.search(text, m.end())
    section = text[m.end():end.start() if end else len(text)]
    rows, buf = [], []
    for raw in section.splitlines():
        line = ' '.join(raw.split())
        if not line or any(w.lower() in line.lower() for w in HEADER_WORDS):
            continue
        buf.append(line)
        for k in range(1, min(4, len(buf)) + 1):
            hit = A_ROW.match(' '.join(buf[-k:]))
            if hit:
                d = hit.groupdict()
                rows.append({'name': d['name'].strip(' ,'), 'individual': d['kind'] == 'I', 'entity': d['kind'],
                             'title': d['title'].strip(), 'acquired': d['date'], 'ownership': d['own'],
                             'control': d['control'] == 'Y', 'crd': int(d['crd']) if d['kind'] == 'I' and d['crd'] and d['crd'].isdigit() else None})
                buf = []
                break
        if len(buf) > 4:
            buf.pop(0)
    return rows, '' if rows else "couldn't read Schedule A"


SECTION_7B1 = re.compile(r'SECTION\s+7\.B\.\(1\)', re.I)
NEXT_SECTION = re.compile(r'SECTION\s+(?!7\.B\.\(1\))\d|^\s*Schedule R\b|^\s*DRP Pages', re.I | re.M)
FUND_NAME = re.compile(r'Name of the private fund:?', re.I)
CHECKED = r'(?:nmlkji|gfedcb|☒|■|●|\[x\])'
FUND_TYPES = ('hedge fund', 'liquidity fund', 'private equity fund', 'real estate fund', 'securitized asset fund', 'venture capital fund', 'other private fund')


def _after(label, text, pattern=r'([^\n]+)'):
    m = re.search(label + r'\s*:?\s*\n?\s*' + pattern, text, re.I)
    return m.group(1).strip() if m else ''


def parse_private_funds(text):
    """(funds, problem): every private fund of Schedule D Section 7.B.(1): name, fund ID (805-), type, gross asset value
    and beneficial owners. No Section 7.B.(1) = no private funds (not a problem)."""
    parts, pos = [], 0
    while True:
        m = SECTION_7B1.search(text or '', pos)
        if not m:
            break
        end = NEXT_SECTION.search(text, m.end())
        parts.append(text[m.end():end.start() if end else len(text)])
        pos = end.start() if end else len(text)
    if not parts:
        return [], ''
    section = '\n'.join(parts)
    starts = [m.end() for m in FUND_NAME.finditer(section)]
    funds, unread = [], 0
    for i, start in enumerate(starts):
        block = section[start:starts[i + 1] if i + 1 < len(starts) else len(section)]
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        name = lines[0] if lines else ''
        if re.match(r'\(b\)|Private fund identification', name, re.I):
            name = ''
        fund_id = _after(r'Private fund identification number', block, r'(?:\(include[^)]*\)\s*)?(805-\d+)')
        gav = pr.money(_after(r'Current gross asset value of the private fund', block, r'\$?\s*([\d,]+(?:\.\d+)?)'))
        owners = pr.integer(_after(r"Approximate number of the private fund'?s beneficial owners", block, r'([\d,]+)'))
        kind = ''
        type_part = re.search(r'What type of fund is the private fund\??(.*?)(?:Current gross asset value|$)', block, re.I | re.S)
        if type_part:
            hit = re.search(CHECKED + r'\s*(' + '|'.join(FUND_TYPES) + r')(?::\s*([^\n]+))?', type_part.group(1), re.I)
            if hit:
                kind = hit.group(1).title() + (f': {hit.group(2).strip()}' if hit.group(2) and hit.group(1).lower().startswith('other') else '')
        if not name or gav is None:
            unread += 1
            continue
        funds.append({'name': name, 'fund_id': fund_id, 'fund_type': kind, 'gav': gav, 'owners': owners})
    problem = ''
    if not starts:
        problem = "couldn't read the private funds (Section 7.B.(1))"
    elif unread:
        problem = f"couldn't read {unread} of {len(starts)} private funds (Section 7.B.(1))"
    return funds, problem


def parse_adv_pdf(text):
    """Everything this reader takes from one Form ADV Part 1 PDF's text."""
    people, a_problem = parse_schedule_a(text)
    funds, f_problem = parse_private_funds(text)
    return {'people': people, 'funds': funds, 'filed': filing_date(text), 'problems': [p for p in (a_problem, f_problem) if p]}


def save_pdf_facts(con, crd, parsed, filed, url):
    """Replaces this adviser's people and private funds with the PDF's (only when Schedule A was read)."""
    people = [(f'crd-{crd}', f'crd-{crd}', p['name'], f'{p["title"]} (since {p["acquired"]})' if p['acquired'] else p['title'],
               PDF_SOURCE, url, 1 if pr.KEY_TITLE.search(p['title'] or '') else 0, filed,
               f'{p["ownership"]} ({pr_own(p["ownership"])})' if p['ownership'] else '') for p in parsed['people'] if p['individual']]
    funds = [(crd, f['fund_id'], f['name'], f['fund_type'], f['gav'], f['owners'], filed, 'iapd') for f in parsed['funds']]
    with con:
        con.execute("DELETE FROM people WHERE firm_key = ? AND (source LIKE 'ADV Schedule%' OR source = ?)", (f'crd-{crd}', PDF_SOURCE))
        con.executemany('INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', people)
        con.execute('DELETE FROM private_funds WHERE crd = ?', (crd,))
        con.executemany(f'INSERT INTO private_funds ({pr.FUND_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', funds)
        n, gav = con.execute('SELECT COUNT(*), SUM(gav) FROM private_funds WHERE crd = ?', (crd,)).fetchone()
        con.execute('UPDATE firms SET funds = ?, funds_gav = ? WHERE crd = ?', (n, gav, crd))
    return len(people), len(funds)


def pr_own(code):
    return OWNERSHIP.get(code, code)


def _note(con, crd, **fields):
    cols = ', '.join(fields)
    con.execute(f'INSERT INTO adv_filings (crd, {cols}) VALUES (?, {", ".join("?" * len(fields))}) '
                f'ON CONFLICT(crd) DO UPDATE SET {", ".join(f"{k} = excluded.{k}" for k in fields)}', (crd, *fields.values()))


CANDIDATES = """SELECT a.crd, a.filing_date, a.aum_total, f.bulk_date, f.pdf_date, f.pdf_status, COALESCE(f.tries, 0) AS tries
FROM adv_firms a LEFT JOIN adv_filings f ON f.crd = a.crd
WHERE a.kind = 'RIA' AND (f.bulk_date IS NULL OR COALESCE(a.filing_date, '') > f.bulk_date)
  AND (f.pdf_date IS NULL OR f.pdf_date < COALESCE(a.filing_date, ''))"""

WANTED = []  # CRDs the owner opened (read next)


def want(crd):
    """Moves an adviser the owner opened to the front of the queue."""
    if crd and crd not in WANTED:
        WANTED.insert(0, crd)
        del WANTED[50:]


def saved_crds():
    """CRDs of firms with a note or outreach status (the owner's saved firms)."""
    try:
        from . import store
        return [int(d['id'][4:]) for d in store.list_docs('prospect_notes') if str(d.get('id', '')).startswith('crd-') and d['id'][4:].isdigit()]
    except Exception:
        return []


def next_candidates(con, limit=20, saved=()):
    """The queue: saved firms, then firms the owner opened, then by AUM (largest first)."""
    rows = {r['crd']: dict(r) for r in con.execute(CANDIDATES + ' AND COALESCE(f.tries, 0) < ?', (PDF_TRIES,))}
    first = [c for c in list(saved) + WANTED if c in rows]
    rest = sorted((c for c in rows if c not in first), key=lambda c: -(rows[c]['aum_total'] or 0))
    return [rows[c] for c in list(dict.fromkeys(first + rest))[:limit]]


async def read_firm(ctx, db_path, crd, roster_date=None):
    """Fetches, parses and saves one adviser's Form ADV Part 1 PDF. Returns {status, note, people, funds}."""
    url = IAPD_PDF.format(crd=crd)
    if not pdf_reader_available():
        return {'status': 'unavailable', 'note': PDF_MISSING}
    con = pr.connect(db_path)
    try:
        if roster_date is None:
            row = con.execute('SELECT filing_date FROM adv_firms WHERE crd = ?', (crd,)).fetchone()
            roster_date = row['filing_date'] if row else ''
        try:
            await _pace()
            resp = await _http(ctx).get(url, timeout=60)
            if resp.status_code == 404:
                raise EngineError('IAPD has no Form ADV PDF for this firm')
            resp.raise_for_status()
            text = await asyncio.to_thread(pdf_text, resp.content)
        except Exception as err:
            with con:
                tries = (con.execute('SELECT tries FROM adv_filings WHERE crd = ?', (crd,)).fetchone() or [0])[0] or 0
                _note(con, crd, pdf_status='failed', pdf_note=f'could not fetch the PDF: {err}', tries=tries + 1, at=time.time())
            return {'status': 'failed', 'note': f'could not fetch the PDF: {err}'}
        parsed = parse_adv_pdf(text)
        filed = parsed['filed'] or roster_date or ''
        if parsed['people']:
            people, funds = save_pdf_facts(con, crd, parsed, filed, url)
            note = '; '.join(parsed['problems'])
            with con:
                _note(con, crd, pdf_date=roster_date or filed, pdf_status='ok', pdf_note=note, tries=0, at=time.time())
            return {'status': 'ok', 'note': note, 'people': people, 'funds': funds, 'filed': filed}
        note = '; '.join(parsed['problems']) or "couldn't read Schedule A"
        log.info('Form ADV PDF for CRD %s: %s', crd, note)
        with con:  # remembered, so the same filing isn't fetched again; a newer filing is tried afresh
            _note(con, crd, pdf_date=roster_date or filed, pdf_status='unreadable', pdf_note=note, tries=0, at=time.time())
        return {'status': 'unreadable', 'note': note}
    finally:
        con.close()


STATE = {'running': False, 'current': None, 'lastError': None}


async def pdf_loop(ctx, db_path):
    """Reads the queue in the background, forever (resumable: progress is in adv_filings). Starts only once the
    Form ADV data has been downloaded (the owner asked for it), and waits while a big download runs."""
    db_path = Path(db_path)
    await asyncio.sleep(120)
    while True:
        try:
            ready = db_path.exists() and pr._loaded(db_path, 'adv_full') and pr._loaded(db_path, 'adv') and ctx.sec_contact and pdf_reader_available()
            if not ready or pr.JOB.get('running'):
                await asyncio.sleep(600)
                continue
            con = pr.connect(db_path)
            batch = next_candidates(con, 20, await asyncio.to_thread(saved_crds))
            con.close()
            if not batch:
                STATE.update({'running': False, 'current': None})
                await asyncio.sleep(6 * 3600)
                continue
            STATE['running'] = True
            for row in batch:
                if pr.JOB.get('running'):
                    break
                STATE['current'] = row['crd']
                await read_firm(ctx, db_path, row['crd'], row['filing_date'])
                if row['crd'] in WANTED:
                    WANTED.remove(row['crd'])
        except asyncio.CancelledError:
            raise
        except Exception as err:
            STATE['lastError'] = str(err)
            log.info('Form ADV PDF reader paused: %s', err)
            await asyncio.sleep(600)


def pdf_status(con):
    """For the Data tab: how far the per-firm PDF reader has got."""
    todo = con.execute(f'SELECT COUNT(*) FROM ({CANDIDATES} AND COALESCE(f.tries, 0) < ?)', (PDF_TRIES,)).fetchone()[0]
    counts = {r[0]: r[1] for r in con.execute('SELECT pdf_status, COUNT(*) FROM adv_filings WHERE pdf_status IS NOT NULL GROUP BY pdf_status')}
    problems = [dict(r) for r in con.execute(
        "SELECT a.crd, f.pdf_note AS note, COALESCE(a.business_name, a.legal_name) AS name FROM adv_filings f "
        "LEFT JOIN adv_firms a ON a.crd = f.crd WHERE f.pdf_status IN ('unreadable', 'failed') ORDER BY f.at DESC LIMIT 20")]
    return {'available': pdf_reader_available(), 'note': '' if pdf_reader_available() else PDF_MISSING, 'waiting': todo,
            'read': counts.get('ok', 0), 'unreadable': counts.get('unreadable', 0), 'failed': counts.get('failed', 0),
            'running': STATE['running'], 'current': STATE['current'], 'problems': problems, 'verified': False}


@handler('prospect.adv_pdf')
async def h_adv_pdf(ctx, msg):
    """{firmId} -> reads that adviser's Form ADV Part 1 PDF from IAPD now: {status, note, people, funds}."""
    firm_id = str(msg.get('firmId') or '')
    m = re.match(r'crd-(\d+)$', firm_id)
    if not m:
        raise EngineError('Only advisers with a CRD number have a Form ADV on IAPD.')
    return await read_firm(ctx, pr.DB_PATH, int(m.group(1)))


# ---------- State-registered advisers (IAPD firm search, beta) ----------

def search_params(state, start):
    """The firm-search request for one page of active investment advisers in a state (unverified live)."""
    return {'query': '*', 'state': state, 'filter': 'active=true,ia=true', 'includePrevious': 'false', 'hl': 'false',
            'nrows': PAGE_ROWS, 'start': start, 'r': 25, 'sort': 'score desc', 'wt': 'json'}


def _field(src, *names):
    for n in names:
        v = src.get(n)
        if v not in (None, ''):
            return v
    return ''


def parse_firm_search(data):
    """(total, firms) from one page of the IAPD firm search. Raises ShapeError on an unknown shape. Each firm:
    crd, name, sec_number, scope, street, city, state, zip, country."""
    hits = (data or {}).get('hits') if isinstance(data, dict) else None
    if not isinstance(hits, dict) or not isinstance(hits.get('hits'), list):
        raise ShapeError('The IAPD firm search answered in an unexpected shape (no hits list). Nothing from it was saved; '
                         'this source is beta, so send diagnostics (Settings) and the reader can be updated.')
    total = hits.get('total')
    total = total.get('value') if isinstance(total, dict) else total
    firms = []
    for hit in hits['hits']:
        src = hit.get('_source', hit) if isinstance(hit, dict) else {}
        crd = pr.integer(_field(src, 'firm_source_id', 'firmId', 'firm_crd', 'crd'))
        name = str(_field(src, 'firm_name', 'firmName', 'name')).strip()
        if not crd and not name:
            continue
        addr = _field(src, 'firm_address_details', 'firmAddressDetails', 'address')
        if isinstance(addr, str):
            try:
                addr = json.loads(addr)
            except ValueError:
                addr = {}
        office = (addr or {}).get('officeAddress') or addr or {}
        firms.append({'crd': crd, 'name': name, 'sec_number': str(_field(src, 'firm_ia_full_sec_number', 'firm_ia_sec_number', 'secNumber')).strip(),
                      'scope': str(_field(src, 'firm_ia_scope', 'iaScope', 'firm_scope')).upper(),
                      'street': ' '.join(x for x in (office.get('street1') or '', office.get('street2') or '') if x).strip(),
                      'city': office.get('city') or '', 'state': office.get('state') or '', 'zip': office.get('postalCode') or office.get('zip') or '',
                      'country': office.get('country') or ''})
    if hits['hits'] and not firms:
        raise ShapeError('The IAPD firm search reply has no firm CRD or name fields this reader knows. Nothing was saved (beta source).')
    return pr.integer(total) or 0, firms


def is_state_registered(firm):
    """An active adviser with no SEC (801-) or exempt (802-) file number is registered with its state."""
    sec = firm.get('sec_number') or ''
    return bool(firm.get('crd')) and firm.get('scope', 'ACTIVE') in ('ACTIVE', '') and not re.match(r'80[12]-', sec)


def load_state_firms(db_path, firms, run_date):
    """Saves state-registered advisers as adv_firms kind 'STATE' (an adviser in the SEC rosters stays SEC)."""
    con = pr.connect(db_path)
    check = pr.Check('state-registered advisers')
    sec = {r[0] for r in con.execute("SELECT crd FROM adv_firms WHERE kind IN ('RIA', 'ERA')")}
    rows, seen = [], set()
    for f in firms:
        check.row()
        if not f.get('crd'):
            check.skip('no CRD')
        elif f['crd'] in seen:
            check.skip('duplicate')
        elif f['crd'] in sec or re.match(r'80[12]-', f.get('sec_number') or ''):
            check.skip('SEC-registered or exempt (already in the SEC lists)')
        elif not is_state_registered(f):
            check.skip('not active')
        else:
            seen.add(f['crd'])
            rows.append({c: None for c in pr.ADV_COLUMNS} | {'crd': f['crd'], 'kind': 'STATE', 'legal_name': f['name'], 'business_name': f['name'],
                                                             'street': f['street'], 'city': f['city'], 'state': f['state'], 'zip': f['zip'],
                                                             'country': f['country'], 'sec_number': '', 'roster_date': run_date,
                                                             'client_mix': '', 'fees': '', 'clients_approx': 0})
    check.loaded = len(rows)
    with con:
        con.executemany(f'INSERT OR REPLACE INTO adv_firms ({",".join(pr.ADV_COLUMNS)}) VALUES ({",".join("?" * len(pr.ADV_COLUMNS))})',
                        [tuple(r[c] for c in pr.ADV_COLUMNS) for r in rows])
    con.close()
    return check.out()


async def search_page(ctx, state, start):
    """One page of the firm search (cached a week on disk, so a resumed run doesn't ask again)."""
    async def load():
        await _pace()
        resp = await _http(ctx).get(IAPD_SEARCH, params=search_params(state, start), timeout=60)
        if resp.status_code >= 400:
            raise EngineError(f'The IAPD firm search answered HTTP {resp.status_code} for {state} (its address or parameters may have changed).')
        try:
            return resp.json()
        except ValueError as err:
            raise ShapeError('The IAPD firm search did not answer with JSON. Nothing from it was saved (beta source).') from err
    return await ctx.cached(('iapd_state', state, start), 7 * 86400, load, persist=True)


async def ingest_state(ctx, emit, db_path):
    """Every state-registered adviser, state by state. Resumable: finished states of the current run are kept in
    meta 'files:state' and skipped on a retry; a run started more than 30 days after the last one starts afresh."""
    run = pr.loaded_files(db_path, 'state')
    if run.get('complete') or not run.get('run') or time.time() - run['run'].get('at', 0) > 30 * 86400:
        run = {}  # a fresh pass
        con = pr.connect(db_path)
        with con:
            pr.set_meta(con, 'files:state', {})
        con.close()
    run_date = (run.get('run') or {}).get('date') or dt.date.today().isoformat()
    if not run:
        pr.mark_loaded(db_path, 'state', 'run', {'date': run_date})
    checks, checked_shape = [], False
    for i, st in enumerate(STATES):
        pr._part(i, len(STATES))
        if st in run:
            checks.append(run[st].get('check'))
            continue
        firms, start, total = [], 0, None
        for _ in range(MAX_PAGES):
            if emit:
                await emit({'type': 'status', 'text': f'State-registered advisers: {st} ({i + 1}/{len(STATES)}), {len(firms):,} so far (IAPD, beta)'})
            total, page = parse_firm_search(await search_page(ctx, st, start))
            if not checked_shape:
                checked_shape = True
                con = pr.connect(db_path)
                with con:
                    pr.set_meta(con, 'headers:state', [{'file': 'IAPD firm search', 'tables': ['iapd_firm_search'],
                                                        'missingRequired': [], 'missingOptional': [k for k in ('street', 'city', 'zip') if page and not any(f[k] for f in page)],
                                                        'unexpected': [], 'unexpectedCount': 0}])
                con.close()
            if start == 0 and len(page) >= 10 and sum((f['state'] or '').upper() == st for f in page) < len(page) / 2:
                raise ShapeError(f'The IAPD firm search did not filter by state (the {st} page lists firms from other states). '
                                 'Nothing more was asked; this source is beta, so send diagnostics (Settings) and the reader can be updated.')
            firms += page
            start += PAGE_ROWS
            if not page or start >= total:
                break
        check = await asyncio.to_thread(load_state_firms, db_path, [f for f in firms if (f['state'] or st).upper() == st], run_date)
        checks.append(check)
        pr.mark_loaded(db_path, 'state', st, {'check': check})
    con = pr.connect(db_path)
    with con:  # a full pass: advisers no longer listed (moved to the SEC, or closed) leave
        con.execute("DELETE FROM adv_firms WHERE kind = 'STATE' AND COALESCE(roster_date, '') < ?", (run_date,))
        count = con.execute("SELECT COUNT(*) FROM adv_firms WHERE kind = 'STATE'").fetchone()[0]
    con.close()
    pr.mark_loaded(db_path, 'state', 'complete', {'date': run_date})
    pr._record(db_path, 'state', {'sourceDate': run_date, 'advisers': count, 'beta': True, 'checks': pr.merge_checks(checks)})
    return {'advisers': count}


pr.INGESTERS['state'] = ingest_state
