"""
Economy dashboard from FRED (the St. Louis Fed's free data service; the CSV download needs no key).
"""
import asyncio
import datetime as dt

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

_fred_slots = asyncio.Semaphore(4)


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


async def fred(ctx, series_id):
    async def load():
        async with _fred_slots:
            response = await ctx.http.get(FRED_CSV, params={'id': series_id, 'cosd': START})
        response.raise_for_status()
        rows = parse_fred_csv(response.text)
        if not rows:
            raise EngineError(f'FRED returned no data for {series_id}')
        return rows
    return await ctx.cached(('fred', series_id), 6 * 3600, load)


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


@handler('macro.dashboard')
async def dashboard(ctx, msg):
    ids = [s[0] for s in SERIES] + [c[0] for c in CURVE if c[0] not in {s[0] for s in SERIES}]
    results = await asyncio.gather(*(fred(ctx, i) for i in ids), return_exceptions=True)
    data = dict(zip(ids, results))
    series, failed = [], []
    for sid, name, group, unit, kind, up_good in SERIES:
        rows = data.get(sid)
        if isinstance(rows, Exception) or not rows:
            failed.append(name)
            continue
        rows = transform(rows, kind)
        if not rows:
            failed.append(name)
            continue
        if len(rows) > 1 and (dt.date.fromisoformat(rows[-1][0]) - dt.date.fromisoformat(rows[-2][0])).days < 7:
            rows = weekly(rows)
        series.append({'id': sid, 'name': name, 'group': group, 'unit': unit, 'upGood': up_good, **summarise(rows),
                       'data': [{'time': d, 'value': round(v, 4)} for d, v in rows]})
    curve = []
    for sid, label in CURVE:
        rows = data.get(sid)
        if isinstance(rows, Exception) or not rows:
            continue
        s = summarise(rows)
        curve.append({'label': label, 'now': s['value'], 'monthAgo': s['monthAgo'], 'yearAgo': s['yearAgo'], 'date': s['date']})
    if not series:
        raise EngineError('Could not reach FRED (the St. Louis Fed data site). Check your internet connection.')
    return {'series': series, 'curve': curve, 'failed': failed}


@handler('macro.series')
async def one_series(ctx, msg):
    """Any FRED series by id, e.g. for the risk-free rate."""
    sid = str(msg.get('id', '')).upper()
    if not sid.replace('_', '').isalnum():
        raise EngineError('Bad series id')
    rows = await fred(ctx, sid)
    return {'id': sid, **summarise(rows), 'data': [{'time': d, 'value': v} for d, v in rows[-int(msg.get('limit', 1000)):]]}
