"""
Money and supply: three readings funding, mortgage and Treasury desks watch, from free data.

1. Funding stress (repo desks). SOFR is what overnight loans backed by Treasuries cost; IORB is what banks earn on
   reserves at the Fed. With plenty of reserves SOFR trades below IORB; when it trades above, cash is getting scarce
   (September 2019: SOFR jumped 282 bp in a day; Anbil, Anderson and Senyuz 2020, "What Happened in Money Markets in
   September 2019?", FEDS Notes). Two gauges, each against its own history: SOFR - IORB (bp) and the spread between the
   day's 99th and 1st percentile repo rates (SOFR99 - SOFR1, how unevenly cash is priced). Unusual = 90th percentile or
   higher and SOFR above IORB, outside the days around a month-end (the last 3 and first 2 calendar days of a month),
   when bumps are normal: there the reading is 'month-end' and nothing is raised on Home.
   FRED: SOFR, SOFR1, SOFR99 (NY Fed, since April 2018), IORB (Fed Board, since July 2021).

2. Mortgage spread (MBS desks). Freddie Mac's 30-year rate (weekly, Thursday) minus the 10-year Treasury yield on or
   before the same day: what homebuyers pay over the government, i.e. MBS investors' spread plus lenders' costs
   (Fuster, Lo and Willen 2024, "The Time-Varying Price of Financial Intermediation in Mortgage Markets", J. Finance).
   Against its own history since 1971 (percentile) and the long-run median.

3. Treasury supply pace (Treasury desks). Debt held by the public, daily (Fiscal Data "Debt to the Penny"): the net
   new borrowing over 1, 3 and 12 months; and from the Monthly Statement of the Public Debt (month-ends), bills' share of
   all marketable debt and of the net new marketable debt over 3 and 12 months (gross auction sales would mislead: short
   bills roll over every few weeks, so they always dominate gross sales). Treasury's borrowing advisers (TBAC) have
   pointed to a bill share of roughly 15-20% over time. More long-dated supply has been followed by a higher term premium
   (Greenwood and Vayanos 2014, "Bond Supply and Excess Bond Returns", Rev. Financial Studies 27(3)): a reading.

Request (read-only): bonds.money {} -> {funding, mortgage, supply, notes}; each part is null when its source fails.
"""
import asyncio
import calendar
import datetime as dt

from . import datahub
from .core import handler
from .ratesdesk import _full, percentile_rank

FISCAL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/'
UNUSUAL_PCT = 90
SERIES_DAYS = 260
FRESH_SECONDS = 3600


# ---------- pure maths (tested) ----------

def _by_date(rows):
    return {d: v for d, v in rows}


def on_or_before(rows, day):
    """Last value at or before `day` from rows sorted by date ([(YYYY-MM-DD, v)]), or None."""
    best = None
    for d, v in rows:
        if d <= day:
            best = v
        else:
            break
    return best


def near_month_end(day):
    """The last 3 and first 2 calendar days of a month, when repo rates normally bump (balance-sheet dates)."""
    d = dt.date.fromisoformat(day)
    return d.day <= 2 or d.day > calendar.monthrange(d.year, d.month)[1] - 3


def funding(sofr, s1, s99, iorb):
    """SOFR - IORB and SOFR99 - SOFR1 (bp) on the days all four exist; latest, percentiles, 30-day high, reading."""
    a, b, c = _by_date(s1), _by_date(s99), _by_date(iorb)
    rows = [(d, 100 * (v - c[d]), 100 * (b[d] - a[d])) for d, v in sofr if d in a and d in b and d in c]
    if not rows:
        return None
    d, spread, disp = rows[-1]
    spreads = [r[1] for r in rows]
    disps = [r[2] for r in rows]
    sp_pct = percentile_rank(spreads, spread)
    unusual = sp_pct is not None and sp_pct >= UNUSUAL_PCT and spread > 0
    reading = ('month-end' if near_month_end(d) else 'tight') if unusual else 'calm'
    since = (dt.date.fromisoformat(d) - dt.timedelta(days=30)).isoformat()
    return {'date': d, 'sofr': on_or_before(sofr, d), 'iorb': c[d], 'spreadBp': spread, 'spreadPct': sp_pct,
            'dispersionBp': disp, 'dispersionPct': percentile_rank(disps, disp),
            'high30Bp': max(r[1] for r in rows if r[0] > since), 'from': rows[0][0], 'days': len(rows),
            'reading': reading,
            'series': [{'date': r[0], 'spreadBp': round(r[1], 2), 'dispersionBp': round(r[2], 2)} for r in rows[-SERIES_DAYS:]]}


def mortgage_spread(mortgage, ten):
    """Weekly mortgage rate minus the 10-year yield on or before that day (bp)."""
    rows, j, last = [], 0, None
    for d, m in mortgage:
        while j < len(ten) and ten[j][0] <= d:
            last = ten[j][1]
            j += 1
        if last is not None:
            rows.append((d, m, last, 100 * (m - last)))
    if not rows:
        return None
    d, m, t, s = rows[-1]
    spreads = sorted(r[3] for r in rows)
    n = len(spreads)
    median = spreads[n // 2] if n % 2 else (spreads[n // 2 - 1] + spreads[n // 2]) / 2
    year_ago = on_or_before([(r[0], r[3]) for r in rows], (dt.date.fromisoformat(d) - dt.timedelta(days=365)).isoformat())
    return {'date': d, 'mortgage': m, 'tenYear': t, 'spreadBp': s, 'percentile': percentile_rank([r[3] for r in rows], s),
            'medianBp': median, 'yearAgoBp': year_ago, 'from': rows[0][0], 'weeks': n,
            'series': [{'date': r[0], 'spreadBp': round(r[3], 1)} for r in rows[-520:]]}


def supply(debt, mspd):
    """debt: [(YYYY-MM-DD, held by the public $)] oldest first; mspd: [(month-end, bills $m, marketable $m)] oldest first.
    Net new debt over 30/91/365 days ($ billions); bills' share of marketable debt and of its net change over 3 and 12
    months (None when marketable debt didn't grow: a share of a fall means nothing)."""
    if not debt:
        return None
    d, now = debt[-1]

    def change(days):
        then = on_or_before(debt, (dt.date.fromisoformat(d) - dt.timedelta(days=days)).isoformat())
        return None if then is None else (now - then) / 1e9
    q = change(91)
    out = {'date': d, 'heldByPublic': now, 'change30': change(30), 'change91': q, 'change365': change(365),
           'pacePerYear': None if q is None else q * 365 / 91, 'billShare': None, 'billShareNew3m': None,
           'billShareNew12m': None, 'mspdDate': None}
    if mspd:
        md, bills, mkt = mspd[-1]
        out.update(mspdDate=md, billShare=bills / mkt if mkt else None, bills=bills * 1e6, marketable=mkt * 1e6)
        for months, key in ((3, 'billShareNew3m'), (12, 'billShareNew12m')):
            if len(mspd) > months:
                _, b0, m0 = mspd[-1 - months]
                out[key] = (bills - b0) / (mkt - m0) if mkt - m0 > 0 else None
    return out


# ---------- data ----------

async def _fred(ctx, sid, start):
    # the same saved FRED history as the rates desk (one cache wrapper: engine/ratesdesk.py _full)
    return [tuple(r) for r in await _full(ctx, sid, start)]


async def _fiscal(ctx, dataset, params):
    r = await datahub.get(ctx.http, 'treasury', FISCAL + dataset, params=params)
    r.raise_for_status()
    return r.json().get('data') or []


async def _debt(ctx):
    async def load():
        start = (dt.date.today() - dt.timedelta(days=400)).isoformat()
        rows = await _fiscal(ctx, 'v2/accounting/od/debt_to_penny', {
            'sort': '-record_date', 'page[size]': '400', 'filter': f'record_date:gte:{start}',
            'fields': 'record_date,debt_held_public_amt'})
        return sorted((r['record_date'], float(r['debt_held_public_amt'])) for r in rows
                      if r.get('debt_held_public_amt') not in (None, '', 'null'))
    rows = await ctx.cached(('treasury', 'debt-to-penny'), FRESH_SECONDS, load, persist=True, stale_ok=True)
    return [tuple(r) for r in rows]


async def _mspd(ctx):
    """Month-end bills and total marketable debt ($ millions), last 14 month-ends."""
    async def load():
        start = (dt.date.today() - dt.timedelta(days=460)).isoformat()
        rows = await _fiscal(ctx, 'v1/debt/mspd/mspd_table_1', {
            'sort': '-record_date', 'page[size]': '400', 'filter': f'record_date:gte:{start}',
            'fields': 'record_date,security_type_desc,security_class_desc,total_mil_amt'})
        months = {}
        for r in rows:
            kind = (r.get('security_type_desc'), r.get('security_class_desc'))
            try:
                v = float(r['total_mil_amt'])
            except (KeyError, TypeError, ValueError):
                continue
            if kind == ('Marketable', 'Bills'):
                months.setdefault(r['record_date'], {})['bills'] = v
            elif kind == ('Total Marketable', '_'):
                months.setdefault(r['record_date'], {})['mkt'] = v
        return sorted((d, m['bills'], m['mkt']) for d, m in months.items() if 'bills' in m and 'mkt' in m)
    rows = await ctx.cached(('treasury', 'mspd-bills'), 6 * 3600, load, persist=True, stale_ok=True)
    return [tuple(r) for r in rows]


@handler('bonds.money')
async def money(ctx, msg):
    # No cache of its own: each source is saved by its own loader (so a failed source is never kept as "unavailable"
    # for an hour, and each counts toward its own source's health); the maths is a few milliseconds.
    (sofr, s1, s99, iorb, mort, ten, debt, mspd) = await asyncio.gather(
        _fred(ctx, 'SOFR', '2021-07-01'), _fred(ctx, 'SOFR1', '2021-07-01'), _fred(ctx, 'SOFR99', '2021-07-01'),
        _fred(ctx, 'IORB', '2021-07-01'), _fred(ctx, 'MORTGAGE30US', '1971-01-01'), _fred(ctx, 'DGS10', '1971-01-01'),
        _debt(ctx), _mspd(ctx), return_exceptions=True)
    bad = lambda *xs: any(isinstance(x, BaseException) for x in xs)  # noqa: E731 (CancelledError is a BaseException)
    notes, out = [], {}
    out['funding'] = None if bad(sofr, s1, s99, iorb) else funding(sofr, s1, s99, iorb)
    if bad(sofr, s1, s99, iorb):
        notes.append('Funding stress unavailable: FRED could not be reached.')
    elif out['funding'] is None:
        notes.append('Funding stress unavailable: FRED has no day with SOFR, its percentiles and IORB together.')
    out['mortgage'] = None if bad(mort, ten) else mortgage_spread(mort, ten)
    if out['mortgage'] is None:
        notes.append('Mortgage spread unavailable: FRED could not be reached.' if bad(mort, ten) else 'Mortgage spread unavailable: FRED returned no matching weeks.')
    out['supply'] = None if bad(debt) else supply(debt, [] if bad(mspd) else mspd)
    if out['supply'] is None:
        notes.append('Treasury supply unavailable: Fiscal Data could not be reached.')
    elif bad(mspd):
        notes.append('Bill share unavailable: the Monthly Statement of the Public Debt could not be loaded.')
    out['notes'] = notes
    out['sources'] = {
        'funding': {'name': 'NY Fed SOFR and percentiles, Fed IORB, via FRED', 'url': 'https://fred.stlouisfed.org/series/SOFR'},
        'mortgage': {'name': 'Freddie Mac 30-year rate (MORTGAGE30US) and 10-year Treasury (DGS10), via FRED', 'url': 'https://fred.stlouisfed.org/series/MORTGAGE30US'},
        'supply': {'name': 'U.S. Treasury Fiscal Data: Debt to the Penny (daily) and Monthly Statement of the Public Debt', 'url': 'https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/'},
    }
    return out
