"""
Economy dashboard from FRED (the St. Louis Fed's free data service; the CSV download needs no key).
"""
import asyncio
import datetime as dt

import httpx

from . import datahub
from .core import EngineError, handler

FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
START = '2006-01-01'

# id, name, group, unit, transform ('' = as is, 'yoy' = % change from a year ago, 'diff' = change from the prior reading,
# 'qoq_ann' = quarterly growth at an annual rate), and whether a rise is good news (for colouring).
SERIES = [
    ('DFF', 'Fed funds rate', 'Rates', '%', '', None),
    ('DGS2', '2-year Treasury yield', 'Rates', '%', '', None),
    ('DGS10', '10-year Treasury yield', 'Rates', '%', '', None),
    ('T10Y2Y', '10y − 2y spread', 'Rates', '%', '', True),
    ('MORTGAGE30US', '30-year mortgage rate', 'Rates', '%', '', False),
    ('CPIAUCSL', 'Inflation (CPI, yearly)', 'Inflation', '%', 'yoy', False),
    ('PCEPILFE', 'Core PCE inflation (yearly)', 'Inflation', '%', 'yoy', False),
    ('T10YIE', '10-year inflation expectations', 'Inflation', '%', '', False),
    ('UNRATE', 'Unemployment rate', 'Jobs', '%', '', False),
    ('PAYEMS', 'Jobs added (monthly, thousands)', 'Jobs', 'K', 'diff', True),
    ('ICSA', 'Weekly jobless claims', 'Jobs', '', '', False),
    ('GDPC1', 'Real GDP growth (annualised)', 'Growth', '%', 'qoq_ann', True),
    ('RSAFS', 'Retail sales (yearly)', 'Growth', '%', 'yoy', True),
    ('UMCSENT', 'Consumer sentiment', 'Growth', '', '', True),
    ('VIXCLS', 'VIX (fear gauge)', 'Markets', '', '', False),
    ('BAMLH0A0HYM2', 'Junk bond spread', 'Markets', '%', '', False),
    ('DCOILWTICO', 'Oil (WTI, $/barrel)', 'Markets', '$', '', None),
    ('DTWEXBGS', 'U.S. dollar index', 'Markets', '', '', None),
]
CURVE = [('DGS1MO', '1M'), ('DGS3MO', '3M'), ('DGS6MO', '6M'), ('DGS1', '1Y'), ('DGS2', '2Y'), ('DGS5', '5Y'), ('DGS10', '10Y'), ('DGS30', '30Y')]

FRED_API = 'https://api.stlouisfed.org/fred/series/observations'
TREASURY_COLUMNS = {'DGS1MO': '1 Mo', 'DGS3MO': '3 Mo', 'DGS6MO': '6 Mo', 'DGS1': '1 Yr', 'DGS2': '2 Yr',
                    'DGS5': '5 Yr', 'DGS10': '10 Yr', 'DGS30': '30 Yr'}
FRESH_SECONDS = 3600

_fred_slots = asyncio.Semaphore(8)


def parse_fred_csv(text):
    rows = []
    for line in text.strip().splitlines()[1:]:
        parts = line.split(',')
        if len(parts) < 2 or parts[1] in ('', '.'):
            continue
        try:
            rows.append((parts[0], float(parts[1])))
        except ValueError:
            continue
    return rows


async def _fred_download(ctx, series_id, start=START):
    from . import settings
    key = settings.get('fred_key')
    async with _fred_slots:
        if key:
            # The free FRED API (with a key) is faster and more reliable than the CSV download.
            response = await datahub.get(ctx.http, 'fred', FRED_API, params={'series_id': series_id, 'api_key': key, 'file_type': 'json', 'observation_start': start})
            response.raise_for_status()
            return [(o['date'], float(o['value'])) for o in response.json().get('observations', []) if o.get('value') not in ('.', '', None)]
        last = None
        for attempt in range(2):
            try:
                response = await datahub.get(ctx.http, 'fred', FRED_CSV, retries=0, params={'id': series_id, 'cosd': start}, headers={'Accept': 'text/csv,*/*'})
                response.raise_for_status()
                return parse_fred_csv(response.text)
            except (httpx.HTTPError, datahub.DataError) as err:
                last = err
                await asyncio.sleep(0.5 * (attempt + 1))
        raise last


async def treasury_yields(ctx):
    """Daily Treasury yield curve from treasury.gov (backup when FRED can't be reached): {series id: rows}. Uses the
    same download as the fitted curve (curvefit.treasury_curve)."""
    from . import curvefit
    days = await curvefit.treasury_curve(ctx)
    out = {}
    for sid, col in TREASURY_COLUMNS.items():
        years = curvefit.TENORS[col]
        out[sid] = [(d, pt[years]) for d, pt in days if years in pt]
    return out


async def fred(ctx, series_id):
    async def load():
        try:
            rows = await _fred_download(ctx, series_id)
        except Exception as err:
            if series_id in TREASURY_COLUMNS:
                rows = (await treasury_yields(ctx)).get(series_id, [])
            else:
                raise EngineError(f'Could not reach FRED for {series_id} ({type(err).__name__}).') from err
        if not rows:
            raise EngineError(f'FRED returned no data for {series_id}')
        return rows
    return await ctx.cached(('fred', series_id), FRESH_SECONDS, load, persist=True, stale_ok=True)


EARLIEST = '1850-01-01'


def history_start(value):
    """A raw request's `since` (YYYY-MM-DD) as the download start: None when absent or on/after START (the default
    download covers it), else January 1 of its year (so a page can't make a saved copy per day: at most one per year
    since EARLIEST). Anything that isn't a clean YYYY-MM-DD date on or after EARLIEST is refused, so the cache key and
    FRED's cosd only ever hold a clean date."""
    if value in (None, ''):
        return None
    text = str(value)
    try:
        day = dt.date.fromisoformat(text)
    except ValueError:
        raise EngineError('Bad history start (use YYYY-MM-DD)') from None
    if len(text) != 10 or day.isoformat() != text or text < EARLIEST:
        raise EngineError('Bad history start (use YYYY-MM-DD)')
    return None if text >= START else f'{day.year:04d}-01-01'


async def fred_from(ctx, series_id, start):
    """Full history from `start` (helper 105: recession records need 1959 onwards, not START). Cached under its own
    key, shared with ratesdesk._full."""
    async def load():
        try:
            rows = await _fred_download(ctx, series_id, start=start)
        except Exception as err:
            raise EngineError(f'Could not reach FRED for {series_id} ({type(err).__name__}).') from err
        if not rows:
            raise EngineError(f'FRED returned no data for {series_id}')
        return rows
    return await ctx.cached(('fred', series_id, 'from', start), FRESH_SECONDS, load, persist=True, stale_ok=True)


def _shift_back(rows, i, days):
    """Index of the last observation at least `days` before rows[i]."""
    target = dt.date.fromisoformat(rows[i][0]) - dt.timedelta(days=days)
    j = i
    while j > 0 and dt.date.fromisoformat(rows[j][0]) > target:
        j -= 1
    return j


def transform(rows, kind):
    if kind == 'yoy':
        out = []
        for i in range(len(rows)):
            j = _shift_back(rows, i, 360)
            if dt.date.fromisoformat(rows[i][0]) - dt.date.fromisoformat(rows[j][0]) >= dt.timedelta(days=360) and rows[j][1]:
                out.append((rows[i][0], 100 * (rows[i][1] / rows[j][1] - 1)))
        return out
    if kind == 'diff':
        return [(rows[i][0], rows[i][1] - rows[i - 1][1]) for i in range(1, len(rows))]
    if kind == 'qoq_ann':
        return [(rows[i][0], 100 * ((rows[i][1] / rows[i - 1][1]) ** 4 - 1)) for i in range(1, len(rows)) if rows[i - 1][1]]
    return rows


def weekly(rows):
    """Keeps the last reading of each week so daily series stay small."""
    out = {}
    for date, value in rows:
        year, week, _ = dt.date.fromisoformat(date).isocalendar()
        out[(year, week)] = (date, value)
    return list(out.values())


def summarise(rows):
    latest = rows[-1]
    def ago(days):
        j = _shift_back(rows, len(rows) - 1, days)
        return rows[j][1] if j < len(rows) - 1 else None
    prev = rows[-2][1] if len(rows) > 1 else None
    return {'date': latest[0], 'value': latest[1], 'previous': prev, 'monthAgo': ago(28), 'yearAgo': ago(365)}


def _definition(sid):
    return next((x for x in SERIES if x[0] == sid), None)


async def series_payload(ctx, sid, with_data=True):
    d = _definition(sid)
    if not d:
        raise EngineError('Unknown series')
    _, name, group, unit, kind, up_good = d
    rows = transform(await fred(ctx, sid), kind)
    if not rows:
        raise EngineError(f'No data for {name}')
    if len(rows) > 1 and (dt.date.fromisoformat(rows[-1][0]) - dt.date.fromisoformat(rows[-2][0])).days < 7:
        rows = weekly(rows)
    out = {'id': sid, 'name': name, 'group': group, 'unit': unit, 'upGood': up_good, **summarise(rows)}
    if with_data:
        out['data'] = [{'time': day, 'value': round(v, 4)} for day, v in rows]
    return out


@handler('macro.catalog')
async def catalog(ctx, msg):
    return {'series': [{'id': s[0], 'name': s[1], 'group': s[2], 'unit': s[3]} for s in SERIES]}


@handler('macro.series')
async def one_series(ctx, msg):
    """One dashboard series (transformed, e.g. inflation as a yearly %), or any FRED series by id when raw is set."""
    # The series id travels as 'series' because 'id' is the request id.
    sid = str(msg.get('series', '')).upper()
    if not sid.replace('_', '').isalnum():
        raise EngineError('Bad series id')
    if _definition(sid) and not msg.get('raw'):
        return await series_payload(ctx, sid)
    start = history_start(msg.get('since'))
    rows = await (fred_from(ctx, sid, start) if start else fred(ctx, sid))
    if not rows:
        # a saved empty copy (ratesdesk._full shares fred_from's key and keeps []) is refused plainly
        raise EngineError(f'FRED returned no data for {sid}')
    return {'id': sid, **summarise(rows), 'data': [{'time': day, 'value': v} for day, v in rows[-int(msg.get('limit', 1000)):]]}


@handler('macro.curve')
async def curve(ctx, msg):
    results = await asyncio.gather(*(fred(ctx, sid) for sid, _ in CURVE), return_exceptions=True)
    points = []
    for (sid, label), rows in zip(CURVE, results):
        if isinstance(rows, Exception) or not rows:
            continue
        s = summarise(rows)
        points.append({'label': label, 'now': s['value'], 'monthAgo': s['monthAgo'], 'yearAgo': s['yearAgo'], 'date': s['date']})
    if not points:
        raise EngineError('Could not load Treasury yields from FRED or treasury.gov.')
    return {'curve': points}


@handler('macro.dashboard')
async def dashboard(ctx, msg):
    """Latest reading of every series (no history), e.g. for the AI assistant."""
    results = await asyncio.gather(*(series_payload(ctx, s[0], with_data=False) for s in SERIES), return_exceptions=True)
    return {'series': [r for r in results if not isinstance(r, Exception)],
            'failed': [s[1] for s, r in zip(SERIES, results) if isinstance(r, Exception)]}
