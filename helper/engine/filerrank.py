"""
Rank against every US filer (Research → Among US companies, helper 88): where a company's readings sit among all
companies that file with the SEC, not only against its own past. FactSet and Bloomberg's relative-value screens show
the same kind of percentile; here it is built from the SEC's free XBRL "frames" API, which returns one value per
company for one concept and one calendar period:

    https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/CY2025.json      (a fiscal year that best fits 2025)
    https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/CY2025Q4I.json   (balances at a date in that quarter)

A company's fiscal year is the row it has in the year's duration frame (net income, else operating cash flow); its
balances are read from the instant frame of the quarter nearest that fiscal year's end (and a year earlier), and only
when that balance is dated within BALANCE_DAYS of the year-end, so income and balances describe the same year.

Readings (each one already shown against the company's own history somewhere on Research):
  grossProfitability = gross profit / total assets                       (Novy-Marx 2013)
  operatingMargin    = operating income / revenue
  returnOnAssets     = net income / average total assets
  salesGrowth        = revenue / last year's revenue - 1 (same revenue tag both years)
  assetGrowth        = total assets / last year-end's - 1                (Cooper, Gulen and Schill 2008)
  accruals           = (net income - operating cash flow) / average assets (Sloan 1996)
  inventoryVsSales   = inventory growth - sales growth                    (Thomas and Zhang 2002)

The field is every filer with total assets of at least MIN_ASSETS at that year-end (shell companies out), all
industries together. Percentile = share of the other companies below, plus half the ties (ratesdesk.percentile_rank,
the platform's one rule). Readings only, never signals.
"""
import asyncio
import datetime as dt
import logging

from . import ratesdesk, sec
from .core import EngineError, handler

log = logging.getLogger('engine.filerrank')

FRAME_URL = 'https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/{period}.json'
#: frames change only as filings arrive; a week keeps them fresh enough for yearly figures
FRAME_TTL = 7 * 24 * 3600
#: companies smaller than this at the year-end (total assets, dollars) are left out of the field
MIN_ASSETS = 100e6
#: a year's net income frame with fewer rows is still filling up (most 10-Ks arrive by April): use the year before
MIN_FRAME_ROWS = 4000
#: a balance more than this many days from the fiscal year-end is a different date, not that year's balance
BALANCE_DAYS = 10
#: last year's figures must end about a year before this year's (days either side)
YEAR_DAYS = 31

DURATION = {'gp': 'GrossProfit', 'op': 'OperatingIncomeLoss', 'ni': 'NetIncomeLoss', 'cfo': 'NetCashProvidedByUsedInOperatingActivities'}
REVENUE_TAGS = ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues')
INSTANT = {'assets': 'Assets', 'inventory': 'InventoryNet'}

METRICS = ('grossProfitability', 'operatingMargin', 'returnOnAssets', 'salesGrowth', 'assetGrowth', 'accruals', 'inventoryVsSales')


def _date(s):
    return s if isinstance(s, dt.date) else dt.date.fromisoformat(s[:10])


def quarter_frame(day):
    """The instant frame whose quarter end is nearest `day` ('CY2025Q4I' for 2026-01-25: 25 days after Dec 31)."""
    d = _date(day)
    ends = []
    for y in (d.year - 1, d.year, d.year + 1):
        ends += [(dt.date(y, 3, 31), y, 1), (dt.date(y, 6, 30), y, 2), (dt.date(y, 9, 30), y, 3), (dt.date(y, 12, 31), y, 4)]
    _, y, q = min(ends, key=lambda e: abs((e[0] - d).days))
    return f'CY{y}Q{q}I'


def year_before(day):
    d = _date(day)
    try:
        return d.replace(year=d.year - 1)
    except ValueError:  # Feb 29
        return d.replace(year=d.year - 1, day=28)


def _near(a, b, days):
    return abs((_date(a) - _date(b)).days) <= days


def compact(frame):
    """The frames API reply -> {cik: [value, end, accession]} (only what the ranking reads)."""
    return {int(r['cik']): [r['val'], r['end'], r.get('accn', '')] for r in frame.get('data', []) if r.get('val') is not None}


def company_rows(dur, rev, rev_prev, instants):
    """Every company's figures for one fiscal year.

    dur: {key: {cik: [val, end, accn]}} for the DURATION keys in the year;
    rev / rev_prev: {tag: {cik: [...]}}; instants: {concept: {frame label: {cik: [...]}}}.
    Returns {cik: {end, accn, gp, op, ni, cfo, rev, revPrev, revTag, assets, assetsPrev, inventory, inventoryPrev}}.
    """
    out = {}
    anchors = set(dur.get('ni', {})) | set(dur.get('cfo', {}))
    for cik in anchors:
        anchor = dur.get('ni', {}).get(cik) or dur['cfo'][cik]
        end = anchor[1]
        row = {'end': end, 'accn': anchor[2]}
        for k in DURATION:
            v = dur.get(k, {}).get(cik)
            row[k] = v[0] if v and _near(v[1], end, BALANCE_DAYS) else None
        # revenue: the first tag with this year's figure; growth only when last year used the same tag
        row['rev'] = row['revPrev'] = row['revTag'] = None
        for tag in REVENUE_TAGS:
            v = rev.get(tag, {}).get(cik)
            if v and _near(v[1], end, BALANCE_DAYS):
                row['rev'], row['revTag'] = v[0], tag
                p = rev_prev.get(tag, {}).get(cik)
                if p and _near(p[1], year_before(end), YEAR_DAYS):
                    row['revPrev'] = p[0]
                break
        prev_end = year_before(end)
        for key, concept in (('assets', 'assets'), ('inventory', 'inventory')):
            frames = instants.get(concept, {})
            now = frames.get(quarter_frame(end), {}).get(cik)
            before = frames.get(quarter_frame(prev_end), {}).get(cik)
            row[key] = now[0] if now and _near(now[1], end, BALANCE_DAYS) else None
            row[key + 'Prev'] = before[0] if before and _near(before[1], prev_end, BALANCE_DAYS) else None
        out[cik] = row
    return out


def _avg(a, b):
    return (a + b) / 2 if a is not None and b is not None else None


def readings(r):
    """The seven readings for one company's row (None where an input is missing or a denominator isn't positive)."""
    assets, prev = r.get('assets'), r.get('assetsPrev')
    avg = _avg(assets, prev)
    rev, rev0 = r.get('rev'), r.get('revPrev')
    sales_growth = rev / rev0 - 1 if rev is not None and rev0 and rev0 > 0 else None
    inv, inv0 = r.get('inventory'), r.get('inventoryPrev')
    inv_growth = inv / inv0 - 1 if inv is not None and inv0 and inv0 > 0 else None
    return {
        'grossProfitability': r['gp'] / assets if r.get('gp') is not None and assets and assets > 0 else None,
        'operatingMargin': r['op'] / rev if r.get('op') is not None and rev and rev > 0 else None,
        'returnOnAssets': r['ni'] / avg if r.get('ni') is not None and avg and avg > 0 else None,
        'salesGrowth': sales_growth,
        'assetGrowth': assets / prev - 1 if assets is not None and prev and prev > 0 else None,
        'accruals': (r['ni'] - r['cfo']) / avg if r.get('ni') is not None and r.get('cfo') is not None and avg and avg > 0 else None,
        'inventoryVsSales': inv_growth - sales_growth if inv_growth is not None and sales_growth is not None else None,
    }


def quantile(values, q):
    """Linear-interpolated quantile of an already sorted list (q 0-1); None for an empty list."""
    if not values:
        return None
    pos = (len(values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)


def field(rows):
    """{metric: sorted values} over the companies with total assets >= MIN_ASSETS, plus {cik: readings}."""
    per = {}
    by_metric = {m: [] for m in METRICS}
    for cik, r in rows.items():
        if r.get('assets') is None or r['assets'] < MIN_ASSETS:
            continue
        x = readings(r)
        per[cik] = x
        for m, v in x.items():
            if v is not None:
                by_metric[m].append(v)
    for v in by_metric.values():
        v.sort()
    return by_metric, per


def rank(by_metric, mine):
    """Where `mine` ({metric: value}) sits among the field: percentile against the others, their count and quartiles.
    `mine` is in the field when the company is large enough; it is taken out once so it isn't ranked against itself."""
    import bisect
    out = {}
    for m in METRICS:
        v = mine.get(m)
        values = by_metric.get(m, [])
        if v is None or not values:
            out[m] = None
            continue
        others = values
        i = bisect.bisect_left(values, v)
        if i < len(values) and values[i] == v:
            others = values[:i] + values[i + 1:]
        if not others:
            out[m] = None
            continue
        out[m] = {'value': v, 'percentile': ratesdesk.percentile_rank(others, v), 'n': len(others),
                  'p25': quantile(others, 0.25), 'median': quantile(others, 0.5), 'p75': quantile(others, 0.75)}
    return out


def pick_year(today, ni_rows):
    """The newest calendar year whose net-income frame has filled up (ni_rows: {year: row count})."""
    y = today.year - 1
    while y > today.year - 4 and ni_rows.get(y, 0) < MIN_FRAME_ROWS:
        y -= 1
    return y


# ---------- downloads ----------

async def _frame(ctx, tag, period):
    """One frame, compacted and saved for a week ({} when the SEC has none for that period)."""
    async def load():
        try:
            r = await sec.sec_get(ctx, FRAME_URL.format(tag=tag, period=period))
        except EngineError as e:
            if 'no data' in str(e):
                return {}
            raise
        return {str(k): v for k, v in compact(r.json()).items()}
    got = await ctx.cached(('sec-frame', tag, period), FRAME_TTL, load, persist=True, stale_ok=True)
    return {int(k): v for k, v in got.items()}


async def _year_rows(ctx, year):
    names = [('dur', k, tag, f'CY{year}') for k, tag in DURATION.items()]
    names += [('rev', t, t, f'CY{year}') for t in REVENUE_TAGS] + [('revPrev', t, t, f'CY{year - 1}') for t in REVENUE_TAGS]
    got = await asyncio.gather(*(_frame(ctx, tag, period) for _, _, tag, period in names))
    dur, rev, rev_prev = {}, {}, {}
    for (kind, key, _, _), frame in zip(names, got):
        {'dur': dur, 'rev': rev, 'revPrev': rev_prev}[kind][key] = frame
    # the quarters holding everyone's year-ends (and a year earlier): usually five or six
    labels = {}
    for cik in set(dur['ni']) | set(dur['cfo']):
        end = (dur['ni'].get(cik) or dur['cfo'][cik])[1]
        for lab in (quarter_frame(end), quarter_frame(year_before(end))):
            labels[lab] = labels.get(lab, 0) + 1
    # a quarter only a handful of odd year-ends need isn't worth two downloads
    wanted = sorted(lab for lab, n in labels.items() if n >= 20)
    instants = {}
    for concept, tag in INSTANT.items():
        frames = await asyncio.gather(*(_frame(ctx, tag, lab) for lab in wanted))
        instants[concept] = dict(zip(wanted, frames))
    return company_rows(dur, rev, rev_prev, instants), wanted


async def _field(ctx, year):
    async def load():
        rows, quarters = await _year_rows(ctx, year)
        by_metric, per = field(rows)
        return {'byMetric': by_metric, 'rows': {str(k): v for k, v in rows.items()}, 'quarters': quarters}
    return await ctx.cached(('sec-filerrank', year), 24 * 3600, load, persist=True, stale_ok=True)


@handler('research.filerrank')
async def filer_rank(ctx, msg):
    """Where one company's readings sit among every US filer with total assets of $100 million or more."""
    try:
        cik = int(msg.get('cik'))
    except (TypeError, ValueError):
        raise EngineError('research.filerrank needs the company’s SEC number (cik)')
    today = dt.date.today()
    counts = {}
    for y in range(today.year - 1, today.year - 4, -1):
        counts[y] = len(await _frame(ctx, DURATION['ni'], f'CY{y}'))
        if counts[y] >= MIN_FRAME_ROWS:
            break
    year = pick_year(today, counts)
    data = await _field(ctx, year)
    row = data['rows'].get(str(cik))
    if row is None:
        # the company's newest year isn't in this frame yet (a late filer): the year before
        older = await _field(ctx, year - 1)
        if older['rows'].get(str(cik)):
            year, data, row = year - 1, older, older['rows'][str(cik)]
    if row is None:
        return {'year': year, 'company': None, 'metrics': {m: None for m in METRICS}, 'minAssets': MIN_ASSETS}
    mine = readings(row)
    return {
        'year': year,
        'company': {'end': row['end'], 'accn': row['accn'], 'assets': row.get('assets'), 'small': row.get('assets') is None or row['assets'] < MIN_ASSETS},
        'metrics': rank(data['byMetric'], mine),
        'minAssets': MIN_ASSETS,
        'frames': [FRAME_URL.format(tag=t, period=f'CY{year}') for t in (DURATION['ni'], DURATION['gp'])],
    }
