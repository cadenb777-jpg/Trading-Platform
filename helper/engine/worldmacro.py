"""
World macro data from free official sources, written from each source's public API documentation:

- World Bank indicators API (no key): GDP growth, inflation, unemployment, government debt by country (yearly).
- IMF DataMapper (no key): World Economic Outlook forecasts of GDP growth and inflation.
- OECD SDMX (no key): composite leading indicators (CLI, 100 = the long-run trend).
- BLS public API (v1 with no key; v2 with a free key gives more series and a higher daily limit): CPI components,
  wages, JOLTS and payrolls detail.
- BEA API (free key required): GDP by component (contributions to growth) and the PCE price index.
- US Treasury Fiscal Data (no key): debt to the penny and the Treasury General Account cash balance; auction
  results come from bonds.auctions (engine/invest.py), not a second copy.
- ECB Data Portal (no key): euro-area policy rates, HICP inflation and the EUR/USD reference rate.
- EIA open data (free key, optional): crude and gasoline inventories and prices.
- Census economic indicators (no key needed for light use; a free key lifts the daily limit): retail sales.

Every source is fetched with a polite timeout and a few retries, and fails with its own clear message (never
silence). Downloads are kept in cache.db (persist, stale_ok) so the page opens instantly next time. Keys live only
in ~/.trading-platform/settings.json (Settings window) and never go back to the browser.
"""
import asyncio
import csv
import datetime as dt
import functools
import io
import re
import time

import httpx

from .core import EngineError, handler

TIMEOUT = httpx.Timeout(15, connect=6)
TRIES = 3
RETRY_DELAY = 0.8  # seconds, times the attempt number (tests set 0)
DAY = 86400

#: (ISO3, name, region), grouped like Bloomberg's WEI/ECO screens.
COUNTRIES = [
    ('USA', 'United States', 'Americas'), ('CAN', 'Canada', 'Americas'), ('MEX', 'Mexico', 'Americas'), ('BRA', 'Brazil', 'Americas'),
    ('DEU', 'Germany', 'Europe'), ('FRA', 'France', 'Europe'), ('GBR', 'United Kingdom', 'Europe'), ('ITA', 'Italy', 'Europe'), ('ESP', 'Spain', 'Europe'),
    ('JPN', 'Japan', 'Asia-Pacific'), ('CHN', 'China', 'Asia-Pacific'), ('IND', 'India', 'Asia-Pacific'), ('KOR', 'South Korea', 'Asia-Pacific'), ('AUS', 'Australia', 'Asia-Pacific'),
]
CODES = [c[0] for c in COUNTRIES]
REGIONS = ['Americas', 'Europe', 'Asia-Pacific']

SIGNUP = {
    'bls': 'https://data.bls.gov/registrationEngine/',
    'bea': 'https://apps.bea.gov/API/signup/',
    'eia': 'https://www.eia.gov/opendata/register.php',
    'census': 'https://api.census.gov/data/key_signup.html',
}


# ---------- Secrets never leave ----------

MASKED = '•••'
#: key=value pairs in text that carry a key (api_key=, registrationkey=, UserID=, token=, key=, x-api-key: ...)
_KEY_PAIR = re.compile(r'(?i)\b((?:api[_-]?key|registration[_-]?key|user[_-]?id|token|key|x-api-key)\s*[=:]\s*)([^\s&"\',;}]+)')
_URL_QUERY = re.compile(r'(https?://[^\s?#"\'<>]+)\?[^\s"\'<>]*')


def saved_secrets():
    """Every saved key value (BEA, BLS, EIA, Census, Finnhub, FRED, Anthropic, Alpaca ...), longest first."""
    try:
        s = _settings()
        data = s.load()
        values = {data.get(k) for k in s.SECRET_KEYS}
    except Exception:
        values = set()
    return sorted((v for v in values if isinstance(v, str) and len(v) >= 6), key=len, reverse=True)


def mask_secrets(text, *extra):
    """`text` with every saved key (and `extra` values), URL query strings and key=value pairs masked. The one masker
    for provider errors, the log and anything sent to the browser from these modules."""
    out = str(text)
    for value in sorted({*saved_secrets(), *(e for e in extra if isinstance(e, str) and e)}, key=len, reverse=True):
        out = out.replace(value, MASKED)
    out = _URL_QUERY.sub(r'\1?' + MASKED, out)
    return _KEY_PAIR.sub(lambda m: m.group(1) + MASKED, out)


def masked_reply(value, _depth=0):
    """A copy of a reply with every string run through mask_secrets (numbers and structure kept)."""
    if _depth > 8:
        return value
    if isinstance(value, str):
        return mask_secrets(value) if value else value
    if isinstance(value, dict):
        return {k: masked_reply(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [masked_reply(v, _depth + 1) for v in value]
    return value


def masked(fn):
    """Handler decorator: the reply's text and any error message go through mask_secrets."""
    @functools.wraps(fn)
    async def run(ctx, msg):
        try:
            reply = await fn(ctx, msg)
        except EngineError as err:
            raise EngineError(mask_secrets(err)) from None
        return masked_reply(reply)
    return run


def source_error(text):
    """An EngineError whose text (often a provider's own message) is masked before anyone sees or logs it."""
    return EngineError(mask_secrets(text))


# ---------- Fetching ----------

def _key_hint(status):
    return ' Check the key in Settings.' if status in (401, 403) else ''


async def fetch(ctx, source, url, *, params=None, json_body=None, text=False):
    """GET (or POST `json_body`) with a polite timeout and up to TRIES attempts on network errors, 429 and 5xx.
    Raises EngineError naming `source`. Error texts never include the URL (it can carry a key)."""
    last = 'could not be reached'
    for attempt in range(TRIES):
        try:
            if json_body is None:
                response = await ctx.http.get(url, params=params, timeout=TIMEOUT)
            else:
                response = await ctx.http.post(url, json=json_body, timeout=TIMEOUT)
        except httpx.HTTPError as err:
            last = f'could not be reached ({type(err).__name__})'
        else:
            status = response.status_code
            if status == 429 or status >= 500:
                last = f'is busy right now (HTTP {status})'
            elif status >= 400:
                raise EngineError(f'{source} refused the request (HTTP {status}).{_key_hint(status)}')
            elif text:
                return response.text
            else:
                try:
                    return response.json()
                except ValueError:
                    raise EngineError(f'{source} sent a reply that could not be read.') from None
        if attempt < TRIES - 1:
            await asyncio.sleep(RETRY_DELAY * (attempt + 1))
    raise EngineError(f'{source} {last}. Try again in a few minutes.')


def _num(v):
    if v is None:
        return None
    try:
        x = float(str(v).replace(',', '').strip())
    except ValueError:
        return None
    return x if x == x else None  # NaN -> None


def _settings():
    from . import settings
    return settings


# ---------- Shared series shape ----------

def yoy(rows, lag=12):
    """% change from `lag` readings earlier, for monthly rows [(YYYY-MM-01, value)] (gaps checked by date)."""
    by = dict(rows)
    out = []
    for day, v in rows:
        y, m = int(day[:4]), int(day[5:7])
        then = by.get(f'{y - lag // 12:04d}-{m:02d}-01')
        if then:
            out.append((day, 100 * (v / then - 1)))
    return out


def mom(rows):
    """% change from the previous month (consecutive months only)."""
    out = []
    for (d0, v0), (d1, v1) in zip(rows, rows[1:]):
        y0, m0, y1, m1 = int(d0[:4]), int(d0[5:7]), int(d1[:4]), int(d1[5:7])
        if v0 and (y1 * 12 + m1) - (y0 * 12 + m0) == 1:
            out.append((d1, 100 * (v1 / v0 - 1)))
    return out


def diff(rows):
    return [(rows[i][0], rows[i][1] - rows[i - 1][1]) for i in range(1, len(rows))]


def series_entry(sid, name, unit, rows, *, group='', source='', note=''):
    """One figure with its history: {id, name, unit, group, source, date, value, previous, data}."""
    rows = [(d, v) for d, v in rows if v is not None]
    if not rows:
        return {'id': sid, 'name': name, 'unit': unit, 'group': group, 'source': source, 'date': None, 'value': None,
                'previous': None, 'data': [], 'note': note or 'No data published yet'}
    return {'id': sid, 'name': name, 'unit': unit, 'group': group, 'source': source, 'date': rows[-1][0],
            'value': round(rows[-1][1], 4), 'previous': round(rows[-2][1], 4) if len(rows) > 1 else None,
            'data': [{'time': d, 'value': round(v, 4)} for d, v in rows], **({'note': note} if note else {})}


def thin_weekly(rows):
    """Keeps the last reading of each week (daily series stay small)."""
    out = {}
    for d, v in rows:
        y, w, _ = dt.date.fromisoformat(d).isocalendar()
        out[(y, w)] = (d, v)
    return list(out.values())


# ---------- World Bank ----------

WB_URL = 'https://api.worldbank.org/v2/country/{codes}/indicator/{indicator}'
WB_INDICATORS = [
    ('gdp', 'NY.GDP.MKTP.KD.ZG', 'GDP growth', '%'),
    ('inflation', 'FP.CPI.TOTL.ZG', 'Inflation', '%'),
    ('unemployment', 'SL.UEM.TOTL.ZS', 'Unemployment', '%'),
    # Central government only and sparse; the table prefers the IMF's general government gross debt (GGXWDG_NGDP).
    ('debt', 'GC.DOD.TOTL.GD.ZS', 'Central government debt (% GDP), World Bank (sparse)', '% GDP'),
]


def parse_worldbank(payload):
    """World Bank JSON ([meta, rows]) -> ({ISO3: [(year, value)] oldest first}, last updated)."""
    if isinstance(payload, list) and payload and isinstance(payload[0], dict) and 'message' in payload[0]:
        msg = (payload[0]['message'] or [{}])[0]
        raise source_error(f"World Bank: {msg.get('value') or msg.get('key') or 'request rejected'}")
    if not isinstance(payload, list) or len(payload) < 2:
        raise EngineError('World Bank sent an unexpected reply.')
    meta, rows = payload[0] or {}, payload[1] or []
    out = {}
    for row in rows:
        code, year, value = row.get('countryiso3code'), row.get('date'), _num(row.get('value'))
        if code and year and value is not None:
            out.setdefault(code, []).append((str(year), value))
    return {k: sorted(v) for k, v in out.items()}, str(meta.get('lastupdated') or '')


async def worldbank(ctx, indicator):
    async def load():
        year = dt.date.today().year
        payload = await fetch(ctx, 'World Bank', WB_URL.format(codes=';'.join(CODES), indicator=indicator),
                              params={'format': 'json', 'per_page': 2000, 'date': f'{year - 15}:{year}'})
        values, updated = parse_worldbank(payload)
        return {'values': values, 'updated': updated, 'fetched': time.time()}
    return await ctx.cached(('world', 'wb', indicator), DAY, load, persist=True, stale_ok=True)


# ---------- IMF DataMapper ----------

IMF_URL = 'https://www.imf.org/external/datamapper/api/v1/{indicator}/{codes}'
IMF_INDICATORS = [
    ('gdpForecast', 'NGDP_RPCH', 'IMF GDP forecast', '%'),
    ('inflationForecast', 'PCPIPCH', 'IMF inflation forecast', '%'),
    ('debtImf', 'GGXWDG_NGDP', 'General government gross debt (% GDP)', '% GDP'),
]
IMF_INDICATORS_URL = 'https://www.imf.org/external/datamapper/api/v1/indicators'


def parse_imf(payload, indicator):
    """IMF DataMapper JSON -> {ISO3: [(year, value)] oldest first}."""
    values = (payload or {}).get('values') if isinstance(payload, dict) else None
    if not isinstance(values, dict) or indicator not in values:
        raise EngineError('IMF DataMapper returned no figures for this indicator.')
    out = {}
    for code, years in (values[indicator] or {}).items():
        rows = sorted((str(y), _num(v)) for y, v in (years or {}).items() if _num(v) is not None)
        if rows:
            out[code] = rows
    return out


def imf_vintage(payload, indicator):
    """The WEO edition an indicator comes from ("World Economic Outlook (October 2026)"), or ''."""
    meta = ((payload or {}).get('indicators') or {}).get(indicator) if isinstance(payload, dict) else None
    return str((meta or {}).get('source') or '').strip()


async def imf(ctx, indicator):
    async def load():
        payload, meta = await asyncio.gather(fetch(ctx, 'IMF DataMapper', IMF_URL.format(indicator=indicator, codes='/'.join(CODES))),
                                             fetch(ctx, 'IMF DataMapper', IMF_INDICATORS_URL), return_exceptions=True)
        if isinstance(payload, Exception):
            raise payload
        vintage = '' if isinstance(meta, Exception) else imf_vintage(meta, indicator)
        return {'values': parse_imf(payload, indicator), 'vintage': vintage, 'fetched': time.time()}
    return await ctx.cached(('world', 'imf', indicator), DAY, load, persist=True, stale_ok=True)


# ---------- OECD composite leading indicators ----------

OECD_CLI_URL = 'https://sdmx.oecd.org/public/rest/data/OECD.SDD.STD,DSD_STES@DF_CLI,/{areas}.M.LI...AA...H'


def parse_oecd_csv(text):
    """OECD SDMX CSV -> {ISO3: [(YYYY-MM-01, value)] oldest first}."""
    text = (text or '').lstrip('﻿')
    if 'NoResultsFound' in text[:200] or 'NoRecordsFound' in text[:200]:
        return {}
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or 'OBS_VALUE' not in reader.fieldnames or 'REF_AREA' not in reader.fieldnames:
        raise EngineError('OECD sent a reply without the expected columns.')
    out = {}
    for row in reader:
        period, value = (row.get('TIME_PERIOD') or '').strip(), _num(row.get('OBS_VALUE'))
        if len(period) >= 7 and value is not None:
            out.setdefault(row['REF_AREA'].strip(), []).append((f'{period[:7]}-01', value))
    return {k: sorted(v) for k, v in out.items()}


def cli_phase(rows):
    """OECD's four phases from the CLI level vs 100 and its direction over the last 3 months."""
    if len(rows) < 4:
        return ''
    now, before = rows[-1][1], rows[-4][1]
    rising = now >= before
    if now >= 100:
        return 'Expansion' if rising else 'Downturn'
    return 'Recovery' if rising else 'Slowdown'


async def oecd_cli(ctx):
    async def load():
        start = f'{dt.date.today().year - 6}-01'
        text = await fetch(ctx, 'OECD', OECD_CLI_URL.format(areas='+'.join(CODES)), text=True,
                           params={'startPeriod': start, 'dimensionAtObservation': 'AllDimensions', 'format': 'csvfile'})
        values = parse_oecd_csv(text)
        if not values:
            raise EngineError('OECD returned no leading-indicator readings.')
        return {'values': values, 'fetched': time.time()}
    # The OECD asks for few requests (about 20 an hour per address): keep a day.
    return await ctx.cached(('world', 'oecd', 'cli'), DAY, load, persist=True, stale_ok=True)


# ---------- The multi-country table ----------

INDICATORS = [
    {'key': 'gdp', 'name': 'GDP growth', 'unit': '%', 'source': 'World Bank', 'freq': 'yearly'},
    {'key': 'gdpForecast', 'name': 'GDP forecast', 'unit': '%', 'source': 'IMF WEO', 'freq': 'yearly'},
    {'key': 'inflation', 'name': 'Inflation', 'unit': '%', 'source': 'World Bank', 'freq': 'yearly'},
    {'key': 'inflationForecast', 'name': 'Inflation forecast', 'unit': '%', 'source': 'IMF WEO', 'freq': 'yearly'},
    {'key': 'unemployment', 'name': 'Unemployment', 'unit': '%', 'source': 'World Bank', 'freq': 'yearly'},
    {'key': 'debt', 'name': 'Gov. debt', 'unit': '% GDP', 'source': 'IMF WEO (general gov.)', 'freq': 'yearly'},
    {'key': 'cli', 'name': 'Leading indicator', 'unit': '', 'source': 'OECD CLI', 'freq': 'monthly'},
]


def _cell(rows, source, asof, *, keep=12, until=None):
    """A table figure: latest value (on or before `until`), its period, the prior one, and a short history."""
    if until:
        rows = [r for r in rows if r[0] <= until]
    if not rows:
        return None
    return {'value': round(rows[-1][1], 3), 'period': rows[-1][0], 'previous': round(rows[-2][1], 3) if len(rows) > 1 else None,
            'source': source, 'asOf': asof, 'data': [{'time': d if len(d) > 4 else f'{d}-01-01', 'value': round(v, 3)} for d, v in rows[-keep:]]}


def _fetched_label(src):
    """'downloaded 2026-11-05' from a load's fetch time (when the source names no edition of its own)."""
    t = (src or {}).get('fetched')
    return f"downloaded {dt.datetime.fromtimestamp(t).date().isoformat()}" if t else ''


def build_table(wb, imf_data, cli, codes, this_year):
    """Rows per country from the downloaded sources (any of which may be None after a failure). Each figure's asOf
    says how current it is: the World Bank's update date, the IMF WEO edition, or (OECD) the download date."""
    rows = []
    for code, name, region in COUNTRIES:
        if code not in codes:
            continue
        cells = {}
        for key, _, _, _ in WB_INDICATORS:
            got = (wb.get(key) or {}).get('values', {}).get(code) if wb.get(key) else None
            updated = (wb.get(key) or {}).get('updated', '')
            cells[key] = _cell(got, 'World Bank', f'updated {updated}' if updated else _fetched_label(wb.get(key))) if got else None
        imf_asof = {key: (imf_data.get(key) or {}).get('vintage') or _fetched_label(imf_data.get(key)) for key, _, _, _ in IMF_INDICATORS}
        # Government debt: the IMF's general government gross debt (last completed year), else the World Bank's
        # sparse central-government figure, labelled as such.
        got = (imf_data.get('debtImf') or {}).get('values', {}).get(code) if imf_data.get('debtImf') else None
        debt = _cell(got, 'IMF WEO (general government gross debt)', imf_asof['debtImf'], until=str(this_year - 1)) if got else None
        if debt is None and cells.get('debt'):
            debt = {**cells['debt'], 'source': 'World Bank (central government debt, sparse)'}
        cells['debt'] = debt
        for key, _, _, _ in IMF_INDICATORS:
            if key == 'debtImf':
                continue
            got = (imf_data.get(key) or {}).get('values', {}).get(code) if imf_data.get(key) else None
            cell = _cell(got, 'IMF WEO', imf_asof[key], until=str(this_year)) if got else None
            if cell:
                nxt = next((v for y, v in got if y == str(this_year + 1)), None)
                cell['next'] = round(nxt, 3) if nxt is not None else None
                cell['nextPeriod'] = str(this_year + 1)
                # history plus the forecast years, so the sparkline shows where the IMF sees things going
                cell['data'] = [{'time': f'{y}-01-01', 'value': round(v, 3)} for y, v in got if this_year - 10 <= int(y) <= this_year + 2]
                cell['forecastFrom'] = f'{this_year}-01-01'
            cells[key] = cell
        got = (cli or {}).get('values', {}).get(code) if cli else None
        if got:
            cell = _cell(got, 'OECD CLI', _fetched_label(cli), keep=36)
            cell['phase'] = cli_phase(got)
            cells['cli'] = cell
        else:
            cells['cli'] = None
        rows.append({'code': code, 'name': name, 'region': region, 'cells': cells})
    return rows


@handler('world.table')
@masked
async def world_table(ctx, msg):
    """The multi-country table (Americas / Europe / Asia-Pacific). Each source loads on its own: a failure fills
    `errors` with that source's message and leaves its columns empty."""
    wanted = [c for c in (msg.get('countries') or CODES) if c in CODES] or CODES
    jobs = {('wb', key): worldbank(ctx, ind) for key, ind, _, _ in WB_INDICATORS}
    jobs.update({('imf', key): imf(ctx, ind) for key, ind, _, _ in IMF_INDICATORS})
    jobs[('oecd', 'cli')] = oecd_cli(ctx)
    results = dict(zip(jobs, await asyncio.gather(*jobs.values(), return_exceptions=True)))
    errors = {}
    names = {'wb': 'World Bank', 'imf': 'IMF DataMapper', 'oecd': 'OECD'}
    for (src, _), r in results.items():
        if isinstance(r, Exception):
            errors.setdefault(names[src], str(r) if isinstance(r, EngineError) else f'{names[src]} failed ({type(r).__name__}).')
    ok = lambda k: None if isinstance(results[k], Exception) else results[k]  # noqa: E731
    wb = {key: ok(('wb', key)) for key, _, _, _ in WB_INDICATORS}
    imf_data = {key: ok(('imf', key)) for key, _, _, _ in IMF_INDICATORS}
    rows = build_table(wb, imf_data, ok(('oecd', 'cli')), wanted, dt.date.today().year)
    fetched = [r['fetched'] for r in results.values() if isinstance(r, dict) and r.get('fetched')]
    return {'countries': [{'code': c, 'name': n, 'region': r} for c, n, r in COUNTRIES], 'regions': REGIONS,
            'indicators': INDICATORS, 'rows': rows, 'errors': errors, 'fetched': min(fetched) if fetched else None}


# ---------- BLS ----------

BLS_V1 = 'https://api.bls.gov/publicAPI/v1/timeseries/data/'
BLS_V2 = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
# id, name, group, transform ('yoy' % change from a year ago, 'diff' monthly change, '' level), unit, needs key
BLS_SERIES = [
    # Year-on-year from the unadjusted (CUUR) indexes, as BLS publishes the headline; month-on-month from the
    # seasonally adjusted (CUSR) ones.
    ('CUUR0000SA0', 'CPI: all items (yearly)', 'CPI', 'yoy', '%', False),
    ('CUUR0000SA0L1E', 'CPI: core, ex food & energy (yearly)', 'CPI', 'yoy', '%', False),
    ('CUSR0000SA0', 'CPI: all items (monthly, seas. adj.)', 'CPI', 'mom', '%', False),
    ('CUSR0000SA0L1E', 'CPI: core (monthly, seas. adj.)', 'CPI', 'mom', '%', False),
    ('CUUR0000SAF1', 'CPI: food (yearly)', 'CPI', 'yoy', '%', False),
    ('CUUR0000SA0E', 'CPI: energy (yearly)', 'CPI', 'yoy', '%', False),
    ('CUUR0000SAH1', 'CPI: shelter (yearly)', 'CPI', 'yoy', '%', False),
    ('CUUR0000SASLE', 'CPI: services less energy (yearly)', 'CPI', 'yoy', '%', False),
    ('CUUR0000SETA02', 'CPI: used cars (yearly)', 'CPI', 'yoy', '%', False),
    ('CUUR0000SAM', 'CPI: medical care (yearly)', 'CPI', 'yoy', '%', True),
    ('CUUR0000SAA', 'CPI: apparel (yearly)', 'CPI', 'yoy', '%', True),
    ('CES0500000003', 'Average hourly earnings (private)', 'Wages', 'yoy', '%', False),
    ('CES0500000002', 'Average weekly hours (private)', 'Wages', '', 'h', True),
    ('JTS000000000000000JOL', 'Job openings', 'JOLTS', '', 'K', False),
    ('JTS000000000000000QUR', 'Quits rate', 'JOLTS', '', '%', False),
    ('JTS000000000000000HIL', 'Hires', 'JOLTS', '', 'K', True),
    ('JTS000000000000000LDL', 'Layoffs and discharges', 'JOLTS', '', 'K', True),
    ('CES0000000001', 'Payrolls: total nonfarm', 'Payrolls', 'diff', 'K', False),
    ('CES0500000001', 'Payrolls: private', 'Payrolls', 'diff', 'K', False),
    ('CES3000000001', 'Payrolls: manufacturing', 'Payrolls', 'diff', 'K', False),
    ('CES6562000001', 'Payrolls: health care', 'Payrolls', 'diff', 'K', False),
    ('CES9000000001', 'Payrolls: government', 'Payrolls', 'diff', 'K', False),
    ('CES2000000001', 'Payrolls: construction', 'Payrolls', 'diff', 'K', True),
    ('CES7000000001', 'Payrolls: leisure & hospitality', 'Payrolls', 'diff', 'K', True),
]


def parse_bls(payload):
    """BLS JSON -> {series id: [(YYYY-MM-01, value)] oldest first} (monthly only; M13 = annual average skipped)."""
    if not isinstance(payload, dict):
        raise EngineError('BLS sent an unexpected reply.')
    if payload.get('status') != 'REQUEST_SUCCEEDED':
        messages = '; '.join(str(m) for m in payload.get('message') or []) or str(payload.get('status') or 'request failed')
        hint = ' A free BLS key (Settings) raises the daily limit.' if 'threshold' in messages.lower() else ''
        raise source_error(f'BLS: {messages}.{hint}')
    out = {}
    for s in (payload.get('Results') or {}).get('series') or []:
        rows = []
        for r in s.get('data') or []:
            period, value = str(r.get('period') or ''), _num(r.get('value'))
            if period.startswith('M') and period != 'M13' and value is not None:
                rows.append((f"{r.get('year')}-{period[1:]}-01", value))
        out[s.get('seriesID')] = sorted(rows)
    return out


async def bls_panel(ctx):
    key = _settings().get('bls_key')
    series = [s for s in BLS_SERIES if key or not s[5]]

    async def load():
        year = dt.date.today().year
        body = {'seriesid': [s[0] for s in series], 'startyear': str(year - 4), 'endyear': str(year)}
        if key:
            body['registrationkey'] = key
        payload = await fetch(ctx, 'BLS', BLS_V2 if key else BLS_V1, json_body=body)
        raw = parse_bls(payload)
        out = []
        for sid, name, group, kind, unit, _ in series:
            rows = raw.get(sid) or []
            if kind == 'yoy':
                rows = yoy(rows)
            elif kind == 'mom':
                rows = mom(rows)
            elif kind == 'diff':
                rows = diff(rows)
            out.append(series_entry(sid, name, unit, rows[-36:], group=group, source='BLS'))
        return {'series': out, 'fetched': time.time()}
    data = await ctx.cached(('world', 'bls2', bool(key)), 6 * 3600, load, persist=True, stale_ok=True)
    return {'source': 'BLS', 'title': 'US prices, wages and jobs (BLS)', 'link': 'https://www.bls.gov/data/',
            'keyed': bool(key), **({} if key else {'tip': 'Add a free BLS key in Settings for more series and a higher daily limit.', 'signup': SIGNUP['bls']}),
            **data}


# ---------- BEA ----------

BEA_URL = 'https://apps.bea.gov/api/data/'
#: Contributions to percent change in real GDP (quarterly) and the PCE price index (monthly).
BEA_GDP = [
    ('Gross domestic product', 'Real GDP growth (annualised)', '%'),
    ('Personal consumption expenditures', 'Consumer spending (contribution)', 'pts'),
    ('Gross private domestic investment', 'Business & housing investment (contribution)', 'pts'),
    ('Net exports of goods and services', 'Net exports (contribution)', 'pts'),
    ('Government consumption expenditures and gross investment', 'Government (contribution)', 'pts'),
]
BEA_PCE = [
    ('Personal consumption expenditures (PCE)', 'PCE price index (yearly)'),
    ('PCE excluding food and energy', 'Core PCE price index (yearly)'),
]


def _bea_time(period):
    """'2026Q2' -> '2026-04-01', '2026M09' -> '2026-09-01', '2026' -> '2026-01-01'."""
    p = str(period)
    if 'Q' in p:
        y, q = p.split('Q')
        return f'{y}-{(int(q) - 1) * 3 + 1:02d}-01'
    if 'M' in p:
        y, m = p.split('M')
        return f'{y}-{int(m):02d}-01'
    return f'{p}-01-01'


def parse_bea(payload):
    """BEA JSON -> {line description: [(date, value)]} using the first line with each description."""
    api = (payload or {}).get('BEAAPI') if isinstance(payload, dict) else None
    if not isinstance(api, dict):
        raise EngineError('BEA sent an unexpected reply.')
    err = api.get('Error') or (api.get('Results') or {}).get('Error')
    if err:
        err = err[0] if isinstance(err, list) else err
        text = err.get('APIErrorDescription') or err.get('ErrorDetail', {}).get('Description') or 'request rejected'
        hint = ' Check the BEA key in Settings.' if 'user' in str(text).lower() or 'key' in str(text).lower() else ''
        raise source_error(f'BEA: {text}.{hint}')
    data = (api.get('Results') or {}).get('Data') or []
    first_line = {}
    out = {}
    for row in data:
        desc, line = str(row.get('LineDescription') or '').strip(), str(row.get('LineNumber') or '')
        first_line.setdefault(desc, line)
        if first_line[desc] != line:
            continue
        value = _num(row.get('DataValue'))
        if value is not None:
            out.setdefault(desc, []).append((_bea_time(row.get('TimePeriod')), value))
    return {k: sorted(v) for k, v in out.items()}


async def bea_panel(ctx):
    key = _settings().get('bea_key')
    base = {'source': 'BEA', 'title': 'US GDP by component and PCE prices (BEA)', 'link': 'https://www.bea.gov/data'}
    if not key:
        return {**base, 'needsKey': True, 'signup': SIGNUP['bea'], 'series': [],
                'note': 'Add your free BEA key in Settings to see GDP by component and the PCE price index.'}

    async def load():
        year = dt.date.today().year
        common = {'UserID': key, 'method': 'GetData', 'DataSetName': 'NIPA', 'ResultFormat': 'JSON'}
        gdp, pce = await asyncio.gather(
            fetch(ctx, 'BEA', BEA_URL, params={**common, 'TableName': 'T10102', 'Frequency': 'Q', 'Year': ','.join(str(y) for y in range(year - 4, year + 1))}),
            fetch(ctx, 'BEA', BEA_URL, params={**common, 'TableName': 'T20804', 'Frequency': 'M', 'Year': ','.join(str(y) for y in range(year - 4, year + 1))}))
        g, p = parse_bea(gdp), parse_bea(pce)
        out = [series_entry(f'T10102:{desc}', name, unit, g.get(desc, [])[-16:], group='GDP', source='BEA') for desc, name, unit in BEA_GDP]
        out += [series_entry(f'T20804:{desc}', name, '%', yoy(p.get(desc, []))[-36:], group='PCE prices', source='BEA') for desc, name in BEA_PCE]
        return {'series': out, 'fetched': time.time()}
    return {**base, **await ctx.cached(('world', 'bea'), 6 * 3600, load, persist=True, stale_ok=True)}


# ---------- US Treasury Fiscal Data ----------

FISCAL_BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/'


def parse_debt(rows):
    """Debt to the penny rows -> (total $T, held by the public $T) as [(date, value)] oldest first."""
    total, public = [], []
    for r in rows or []:
        d = r.get('record_date')
        t, p = _num(r.get('tot_pub_debt_out_amt')), _num(r.get('debt_held_public_amt'))
        if d and t is not None:
            total.append((d, t / 1e12))
        if d and p is not None:
            public.append((d, p / 1e12))
    return sorted(total), sorted(public)


def parse_tga(rows):
    """Daily Treasury Statement operating cash rows -> TGA closing balance in $ billions, oldest first."""
    out = {}
    for r in rows or []:
        kind = str(r.get('account_type') or '')
        d = r.get('record_date')
        if not d or 'closing balance' not in kind.lower():
            continue
        v = _num(r.get('open_today_bal'))  # on the closing-balance line this column holds the closing balance ($ millions)
        if v is not None:
            out[d] = v / 1000
    return sorted(out.items())


async def fiscal_panel(ctx):
    from . import invest

    async def load():
        since = (dt.date.today() - dt.timedelta(days=3 * 365)).isoformat()
        debt, tga = await asyncio.gather(
            fetch(ctx, 'Treasury Fiscal Data', FISCAL_BASE + 'v2/accounting/od/debt_to_penny',
                  params={'fields': 'record_date,tot_pub_debt_out_amt,debt_held_public_amt', 'filter': f'record_date:gte:{since}',
                          'sort': '-record_date', 'page[size]': '1000'}),
            fetch(ctx, 'Treasury Fiscal Data', FISCAL_BASE + 'v1/accounting/dts/operating_cash_balance',
                  params={'filter': f'record_date:gte:{since}', 'sort': '-record_date', 'page[size]': '5000'}),
            return_exceptions=True)
        out, errors = [], {}
        if isinstance(debt, Exception):
            errors['debt'] = str(debt)
        else:
            total, public = parse_debt(debt.get('data'))
            out.append(series_entry('debt_total', 'Total public debt', '$T', thin_weekly(total), group='Debt', source='Treasury'))
            out.append(series_entry('debt_public', 'Debt held by the public', '$T', thin_weekly(public), group='Debt', source='Treasury'))
        if isinstance(tga, Exception):
            errors['tga'] = str(tga)
        else:
            out.append(series_entry('tga', 'Treasury cash balance (TGA)', '$B', thin_weekly(parse_tga(tga.get('data'))), group='Cash', source='Treasury'))
        if not out:
            raise EngineError(next(iter(errors.values())))
        return {'series': out, 'errors': errors, 'fetched': time.time()}
    data, auctions = await asyncio.gather(ctx.cached(('world', 'fiscal'), 6 * 3600, load, persist=True, stale_ok=True),
                                          invest.auctions(ctx, {}), return_exceptions=True)
    if isinstance(data, Exception):
        raise data
    out = {'source': 'Treasury', 'title': 'US debt, cash and auctions (Treasury Fiscal Data)', 'link': 'https://fiscaldata.treasury.gov/', **data}
    if isinstance(auctions, Exception):
        out['errors'] = {**data.get('errors', {}), 'auctions': str(auctions)}
    else:
        out['auctions'] = [a for a in auctions.get('results', []) if a.get('type') in ('Note', 'Bond')][:6]
    return out


# ---------- ECB ----------

ECB_URL = 'https://data-api.ecb.europa.eu/service/data/{flow}/{key}'
# flow, key, name, unit, kind ('step' = a rate that changes on decision dates)
ECB_SERIES = [
    ('FM', 'D.U2.EUR.4F.KR.DFR.LEV', 'ECB deposit facility rate', '%', 'step'),
    ('FM', 'D.U2.EUR.4F.KR.MRR_FR.LEV', 'ECB main refinancing rate', '%', 'step'),
    ('ICP', 'M.U2.N.000000.4.ANR', 'Euro-area inflation (HICP, yearly)', '%', ''),
    ('ICP', 'M.U2.N.XEF000.4.ANR', 'Euro-area core inflation (yearly)', '%', ''),
    ('EXR', 'D.USD.EUR.SP00.A', 'EUR/USD reference rate', '', 'daily'),
]


def parse_ecb_csv(text):
    """ECB SDMX csvdata -> [(YYYY-MM-DD, value)] oldest first (monthly periods become the 1st)."""
    reader = csv.DictReader(io.StringIO((text or '').lstrip('﻿')))
    if not reader.fieldnames or 'OBS_VALUE' not in reader.fieldnames:
        raise EngineError('ECB sent a reply without the expected columns.')
    out = []
    for row in reader:
        period, value = (row.get('TIME_PERIOD') or '').strip(), _num(row.get('OBS_VALUE'))
        if value is None or len(period) < 7:
            continue
        out.append((period if len(period) == 10 else f'{period[:7]}-01', value))
    return sorted(out)


def step_monthly(rows, until):
    """A rate known only on change dates -> its level at the start of each month up to `until` (for charts)."""
    if not rows:
        return []
    out, i, level = [], 0, None
    y, m = int(rows[0][0][:4]), int(rows[0][0][5:7])
    while f'{y:04d}-{m:02d}-01' <= until:
        day = f'{y:04d}-{m:02d}-01'
        while i < len(rows) and rows[i][0] <= day:
            level = rows[i][1]
            i += 1
        if level is not None:
            out.append((day, level))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    if not out or rows[-1][0] > out[-1][0]:
        out.append(rows[-1])  # the latest change itself, so the newest level is exact
    return out


async def ecb_panel(ctx):
    async def one(flow, key, name, unit, kind):
        async def load():
            start = (dt.date.today() - dt.timedelta(days=(15 if kind == 'step' else 5) * 365)).isoformat()
            text = await fetch(ctx, 'ECB', ECB_URL.format(flow=flow, key=key), text=True, params={'format': 'csvdata', 'startPeriod': start})
            rows = parse_ecb_csv(text)
            if kind == 'step':
                rows = step_monthly(rows, dt.date.today().isoformat())[-60:]
            elif kind == 'daily':
                rows = thin_weekly(rows)
            return {'entry': series_entry(f'{flow}.{key}', name, unit, rows, group='Euro area', source='ECB'), 'fetched': time.time()}
        return await ctx.cached(('world', 'ecb', flow, key), 6 * 3600, load, persist=True, stale_ok=True)
    results = await asyncio.gather(*(one(*s) for s in ECB_SERIES), return_exceptions=True)
    series = [r['entry'] for r in results if not isinstance(r, Exception)]
    errors = {s[2]: str(r) for s, r in zip(ECB_SERIES, results) if isinstance(r, Exception)}
    if not series:
        raise EngineError(next(iter(errors.values())))
    fetched = [r['fetched'] for r in results if not isinstance(r, Exception)]
    return {'source': 'ECB', 'title': 'Euro area: ECB rates, inflation and the euro (ECB)', 'link': 'https://data.ecb.europa.eu/',
            'series': series, 'errors': errors, 'fetched': min(fetched)}


# ---------- EIA ----------

EIA_URL = 'https://api.eia.gov/v2/seriesid/{sid}'
EIA_SERIES = [
    ('PET.WCESTUS1.W', 'Crude oil inventories (ex SPR)', 'M bbl', 1 / 1000),
    ('PET.WGTSTUS1.W', 'Gasoline inventories', 'M bbl', 1 / 1000),
    ('PET.RWTC.D', 'WTI crude spot price', '$', 1),
    ('PET.EMM_EPMR_PTE_NUS_DPG.W', 'US regular gasoline (retail)', '$', 1),
]


def parse_eia(payload):
    """EIA v2 JSON -> [(YYYY-MM-DD, value)] oldest first."""
    if not isinstance(payload, dict):
        raise EngineError('EIA sent an unexpected reply.')
    if payload.get('error'):
        err = payload['error']
        raise source_error(f"EIA: {err.get('message') if isinstance(err, dict) else err}")
    rows = ((payload.get('response') or {}).get('data')) or []
    out = []
    for r in rows:
        period, value = str(r.get('period') or ''), _num(r.get('value'))
        if value is not None and len(period) >= 7:
            out.append((period if len(period) == 10 else f'{period[:7]}-01', value))
    return sorted(out)


async def eia_panel(ctx):
    key = _settings().get('eia_key')
    base = {'source': 'EIA', 'title': 'US oil and gasoline (EIA)', 'link': 'https://www.eia.gov/petroleum/supply/weekly/'}
    if not key:
        return {**base, 'needsKey': True, 'signup': SIGNUP['eia'], 'series': [],
                'note': 'Optional: add a free EIA key in Settings to see weekly crude and gasoline inventories and prices.'}

    async def one(sid, name, unit, scale):
        async def load():
            payload = await fetch(ctx, 'EIA', EIA_URL.format(sid=sid), params={'api_key': key, 'length': 400,
                                  'sort[0][column]': 'period', 'sort[0][direction]': 'desc'})
            rows = [(d, v * scale) for d, v in parse_eia(payload)]
            rows = thin_weekly(rows)[-156:]
            return {'entry': series_entry(sid, name, unit, rows, group='Energy', source='EIA'), 'fetched': time.time()}
        return await ctx.cached(('world', 'eia', sid), 6 * 3600, load, persist=True, stale_ok=True)
    results = await asyncio.gather(*(one(*s) for s in EIA_SERIES), return_exceptions=True)
    series = [r['entry'] for r in results if not isinstance(r, Exception)]
    errors = {s[1]: str(r) for s, r in zip(EIA_SERIES, results) if isinstance(r, Exception)}
    if not series:
        raise EngineError(next(iter(errors.values())))
    return {**base, 'series': series, 'errors': errors, 'fetched': min(r['fetched'] for r in results if not isinstance(r, Exception))}


# ---------- Census ----------

CENSUS_URL = 'https://api.census.gov/data/timeseries/eits/marts'
CENSUS_SERIES = [
    ('44X72', 'Retail sales (yearly)', 'yoy'),
    ('44X72', 'Retail sales (monthly change)', 'mom'),
    ('44Y72', 'Retail sales ex autos (yearly)', 'yoy'),
]


def parse_census(payload):
    """Census API JSON (a header row, then rows) -> [(YYYY-MM-01, value)] oldest first."""
    if not isinstance(payload, list) or not payload or not isinstance(payload[0], list):
        raise EngineError('Census sent an unexpected reply.')
    head = payload[0]
    if 'cell_value' not in head or 'time' not in head:
        raise EngineError('Census sent a reply without the expected columns.')
    iv, it = head.index('cell_value'), head.index('time')
    out = {}
    for row in payload[1:]:
        value, period = _num(row[iv]), str(row[it])
        if value is not None and len(period) >= 7:
            out[f'{period[:7]}-01'] = value
    return sorted(out.items())


async def census_panel(ctx):
    key = _settings().get('census_key')

    async def one(code):
        async def load():
            params = {'get': 'cell_value,time_slot_id', 'for': 'us:*', 'time': f'from {dt.date.today().year - 4}',
                      'category_code': code, 'data_type_code': 'SM', 'seasonally_adj': 'yes'}
            if key:
                params['key'] = key
            return {'rows': parse_census(await fetch(ctx, 'Census', CENSUS_URL, params=params)), 'fetched': time.time()}
        return await ctx.cached(('world', 'census', code), 6 * 3600, load, persist=True, stale_ok=True)
    codes = sorted({c for c, _, _ in CENSUS_SERIES})
    results = dict(zip(codes, await asyncio.gather(*(one(c) for c in codes), return_exceptions=True)))
    series, errors = [], {}
    for code, name, kind in CENSUS_SERIES:
        r = results[code]
        if isinstance(r, Exception):
            errors[name] = str(r)
            continue
        rows = yoy(r['rows']) if kind == 'yoy' else [(d, 100 * (v / p - 1)) for (_, p), (d, v) in zip(r['rows'], r['rows'][1:]) if p]
        series.append(series_entry(f'census:{code}:{kind}', name, '%', rows[-36:], group='Retail', source='Census'))
    if not series:
        raise EngineError(next(iter(errors.values())))
    return {'source': 'Census', 'title': 'US retail sales (Census)', 'link': 'https://www.census.gov/retail/',
            'keyed': bool(key), 'series': series, 'errors': errors,
            'fetched': min(r['fetched'] for r in results.values() if not isinstance(r, Exception))}


PANELS = {'bls': bls_panel, 'bea': bea_panel, 'census': census_panel, 'fiscal': fiscal_panel, 'ecb': ecb_panel, 'eia': eia_panel}


@handler('world.panel')
@masked
async def world_panel(ctx, msg):
    """One source's panel: {source, title, link, series: [...], errors, fetched} or {needsKey, signup, note}."""
    name = str(msg.get('panel') or '')
    if name not in PANELS:
        raise EngineError('Unknown world data panel')
    return await PANELS[name](ctx)


@handler('world.sources')
async def world_sources(ctx, msg):
    """Which free sources are ready (keys set or not needed), for the page's key hints."""
    s = _settings()
    return {'bls': {'keySet': bool(s.get('bls_key')), 'required': False, 'signup': SIGNUP['bls']},
            'bea': {'keySet': bool(s.get('bea_key')), 'required': True, 'signup': SIGNUP['bea']},
            'eia': {'keySet': bool(s.get('eia_key')), 'required': True, 'signup': SIGNUP['eia']},
            'census': {'keySet': bool(s.get('census_key')), 'required': False, 'signup': SIGNUP['census']}}


async def snapshot(ctx, countries=None):
    """A compact read for the AI: latest figure per country and indicator, plus every US/euro panel."""
    table = await world_table(ctx, {'countries': countries or CODES})
    out = {'countries': [{'country': r['name'], 'region': r['region'],
                          **{k: ({'value': c['value'], 'period': c['period'], 'source': c['source'],
                                  **({'next': c['next']} if c.get('next') is not None else {}),
                                  **({'phase': c['phase']} if c.get('phase') else {})} if c else None)
                             for k, c in r['cells'].items()}} for r in table['rows']],
           'errors': dict(table['errors'])}
    panels = await asyncio.gather(*(fn(ctx) for fn in PANELS.values()), return_exceptions=True)
    for name, p in zip(PANELS, panels):
        if isinstance(p, Exception):
            out['errors'][name] = str(p)
        elif p.get('needsKey'):
            out[name] = p['note']
        else:
            out[name] = [{k: s[k] for k in ('name', 'unit', 'date', 'value', 'previous')} for s in p['series']]
    return out
