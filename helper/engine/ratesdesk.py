"""
Two readings rates and credit desks keep on screen, from free FRED data.

1. Credit spreads by rating (credit desks' spread monitor). ICE BofA option-adjusted spreads over Treasuries for
   AAA, AA, A, BBB (investment grade) and BB, B, CCC & below (high yield), daily. FRED keeps only the last 3 years of
   ICE data, so each spread is placed against those 3 years: percentile = share of days with a lower spread. The
   "step" between neighbouring ratings is what an investor is paid for taking one notch more risk; a step at the
   bottom of its own range (<= 10th percentile) means that notch pays unusually little (spreads compressed), at the
   top (>= 90th) unusually much. The BBB -> BB step is the investment-grade / high-yield "crossover".
   Spread levels relate to expected default losses and a risk premium (Elton, Gruber, Agrawal and Mann 2001, "Explaining
   the Rate Spread on Corporate Bonds", J. Finance 56(1)); a reading, not a forecast of returns.

2. Term premium (rates desks split a long yield into expected short rates + pay for lending long). The Federal
   Reserve Board's Kim-Wright three-factor model (Kim and Wright 2005, FEDS 2005-33), published daily on FRED:
   THREEFY10 = the model's fitted 10-year zero-coupon yield, THREEFYTP10 = its term premium. Expected average short
   rate over 10 years = THREEFY10 - THREEFYTP10 (an estimate from the model, not an observed price).

Requests (read-only): bonds.credit {}, bonds.termpremium {} (its own request, so a slow FRED never holds up the fitted curve).
"""
import asyncio
import bisect

from . import macro
from .core import EngineError, handler

RATINGS = [('AAA', 'BAMLC0A1CAAA', 'ig'), ('AA', 'BAMLC0A2CAA', 'ig'), ('A', 'BAMLC0A3CA', 'ig'), ('BBB', 'BAMLC0A4CBBB', 'ig'),
           ('BB', 'BAMLH0A1HYBB', 'hy'), ('B', 'BAMLH0A2HYB', 'hy'), ('CCC & below', 'BAMLH0A3HYC', 'hy')]
TIGHT, WIDE = 10, 90
TP_START = '1990-01-01'
#: weeks of term-premium history sent to the page (5 years; the percentile still uses every day since 1990)
TP_WEEKS = 260


# ---------- pure maths (tested) ----------

def percentile_rank(history, value):
    """Share of `history` strictly below `value`, plus half the ties, in % (0-100). None for an empty history."""
    if not history:
        return None
    s = sorted(history)
    lo = bisect.bisect_left(s, value)
    hi = bisect.bisect_right(s, value)
    return 100 * (lo + 0.5 * (hi - lo)) / len(s)


def value_ago(rows, days):
    """The last reading at least `days` calendar days before the latest one ([(YYYY-MM-DD, v)] oldest first)."""
    import datetime as dt
    if not rows:
        return None
    target = dt.date.fromisoformat(rows[-1][0]) - dt.timedelta(days=days)
    best = None
    for d, v in rows:
        if dt.date.fromisoformat(d) <= target:
            best = v
        else:
            break
    return best


def word(pct):
    if pct is None:
        return ''
    if pct <= TIGHT:
        return 'unusually tight'
    if pct >= WIDE:
        return 'unusually wide'
    return 'in its usual range'


def credit_ladder(series):
    """series: {rating: [(date, spread %)]} -> rows per rating with percentile over the history given, and the step to
    the next lower rating (bp) with its own percentile. Steps use only dates both ratings have."""
    rows = []
    for i, (rating, sid, grade) in enumerate(RATINGS):
        data = series.get(rating) or []
        if not data:
            rows.append({'rating': rating, 'series': sid, 'grade': grade, 'spread': None})
            continue
        vals = [v for _, v in data]
        now = data[-1][1]
        row = {'rating': rating, 'series': sid, 'grade': grade, 'date': data[-1][0], 'spread': now,
               'monthAgo': value_ago(data, 28), 'yearAgo': value_ago(data, 365), 'low': min(vals), 'high': max(vals),
               'percentile': percentile_rank(vals, now), 'from': data[0][0], 'days': len(vals)}
        row['reading'] = word(row['percentile'])
        if i + 1 < len(RATINGS):
            nxt = dict(series.get(RATINGS[i + 1][0]) or [])
            steps = [(d, 100 * (nxt[d] - v)) for d, v in data if d in nxt]
            if steps:
                sv = [x for _, x in steps]
                row['step'] = {'to': RATINGS[i + 1][0], 'bp': steps[-1][1], 'date': steps[-1][0],
                               'percentile': percentile_rank(sv, steps[-1][1]), 'low': min(sv), 'high': max(sv),
                               'monthAgo': value_ago(steps, 28)}
                row['step']['reading'] = word(row['step']['percentile'])
        rows.append(row)
    return rows


def term_premium(fitted, premium):
    """Kim-Wright: fitted 10-year yield and term premium rows -> today's split, changes, percentile since the start,
    and a weekly history (last reading of each week) for the chart."""
    import datetime as dt
    tp = dict(premium)
    rows = [(d, y, tp[d]) for d, y in fitted if d in tp]
    if not rows:
        return None
    d, y, p = rows[-1]
    prem = [(r[0], r[2]) for r in rows]
    weekly = {}
    for r in rows:
        yr, wk, _ = dt.date.fromisoformat(r[0]).isocalendar()
        weekly[(yr, wk)] = r
    return {'date': d, 'yield': y, 'premium': p, 'expected': y - p,
            'monthAgo': value_ago(prem, 28), 'yearAgo': value_ago(prem, 365),
            'percentile': percentile_rank([x for _, x in prem], p), 'from': rows[0][0],
            'history': [{'date': r[0], 'premium': round(r[2], 4), 'expected': round(r[1] - r[2], 4)} for r in list(weekly.values())[-TP_WEEKS:]]}


# ---------- data ----------

async def _full(ctx, sid, start):
    async def load():
        return await macro._fred_download(ctx, sid, start=start)
    return await ctx.cached(('fred', sid, 'from', start), macro.FRESH_SECONDS, load, persist=True, stale_ok=True)


@handler('bonds.termpremium')
async def termpremium(ctx, msg):
    fitted, prem = await asyncio.gather(_full(ctx, 'THREEFY10', TP_START), _full(ctx, 'THREEFYTP10', TP_START))
    out = term_premium([tuple(r) for r in fitted], [tuple(r) for r in prem])
    if out is None:
        raise EngineError('FRED returned no term premium readings.')
    out['source'] = {'name': 'Kim-Wright 10-year term premium (Federal Reserve Board) via FRED', 'url': 'https://fred.stlouisfed.org/series/THREEFYTP10'}
    return out


@handler('bonds.credit')
async def credit(ctx, msg):
    async def load():
        results = await asyncio.gather(*(_full(ctx, sid, '2000-01-01') for _, sid, _ in RATINGS), return_exceptions=True)
        series = {r[0]: [tuple(x) for x in res] for r, res in zip(RATINGS, results) if not isinstance(res, Exception)}
        if not series:
            raise EngineError('Could not load credit spreads from FRED.')
        rows = credit_ladder(series)
        return {'rows': rows, 'failed': [r[0] for r, res in zip(RATINGS, results) if isinstance(res, Exception)],
                'source': {'name': 'ICE BofA option-adjusted spreads via FRED (FRED keeps the last 3 years)',
                           'url': 'https://fred.stlouisfed.org/series/BAMLC0A4CBBB',
                           'asOf': max((r['date'] for r in rows if r.get('spread') is not None), default=None)}}
    return await ctx.cached(('fred', 'credit-ladder'), macro.FRESH_SECONDS, load, persist=True, stale_ok=True)
