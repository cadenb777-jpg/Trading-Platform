"""
Rates and the Fed, the way rates desks read them.

1. Rate-decision odds per FOMC meeting, from 30-day fed funds futures (/ZQ, Schwab quotes). Method of the CME
   FedWatch tool: a contract settles on the month's average effective fed funds rate (EFFR), so 100 - price is that
   average. In a meeting month the average mixes the rate before and after the decision, which gives the rate after:
       after = (average x days in month - before x days up to the decision) / days after the decision.
   When the next month has no meeting its contract gives the rate after directly (steadier, CME's preference). The
   move divided by 0.25 is the number of quarter-point steps priced; its fraction is the chance of the bigger step
   (2.11 steps = 89% two cuts / 11% three). Meetings chain: each starts from the one before, and the outcome
   distributions are combined (the probability tree). Assumes 25 bp steps and that the EFFR keeps its place in the
   target range, as FedWatch does.

2. Net liquidity (macro desks' gauge of Fed money in markets): Fed balance sheet (WALCL) - Treasury General Account
   (WDTGAL) - overnight reverse repo (RRPONTSYD), each Wednesday, from FRED. Shown with the S&P 500 and, honestly,
   the correlation of weekly *changes* with its 95% interval (levels of two rising series always look related).

Requests (read-only): macro.fedodds {}, macro.netliquidity {}
"""
import asyncio
import calendar
import datetime as dt
import math

from . import futures_market, macro
from .core import EngineError, handler

#: decision days (the second day of each meeting). 2027 is the Fed's tentative schedule (announced Sept 5, 2025).
FOMC = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
        '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08']
TENTATIVE_FROM = '2027-01-01'
STEP = 0.25
MONTH_CODES = 'FGHJKMNQUVXZ'


# ---------- pure maths (tested) ----------

def zq_symbol(year, month):
    return f'/ZQ{MONTH_CODES[month - 1]}{year % 100:02d}'


def _add_month(y, m, n=1):
    m += n
    return y + (m - 1) // 12, (m - 1) % 12 + 1


def meeting_moves(today, meetings, implied, spot):
    """For each meeting ahead: the rate before and after it implied by the futures, and the move in steps.
    `implied` {(year, month): 100 - price}; `spot` = today's EFFR. Meetings without the needed contracts are skipped
    (and stop the chain, since later ones would start from a guess)."""
    out = []
    ahead = sorted(d for d in meetings if d >= today)
    by_month = {(d.year, d.month): d for d in ahead}
    y, m = today.year, today.month
    start = spot if (y, m) in by_month else implied.get((y, m), spot)
    last = ahead[-1] if ahead else today
    while (y, m) <= (last.year, last.month):
        meeting = by_month.get((y, m))
        if meeting is None:
            if (y, m) in implied:
                start = implied[(y, m)]  # a month without a meeting re-anchors the chain
            y, m = _add_month(y, m)
            continue
        days = calendar.monthrange(y, m)[1]
        before_days = meeting.day  # the new rate takes effect the day after the decision
        nxt = _add_month(y, m)
        if nxt not in by_month and nxt in implied:
            end = implied[nxt]
        elif (y, m) in implied and days > before_days:
            end = (implied[(y, m)] * days - start * before_days) / (days - before_days)
        else:
            break
        out.append({'date': meeting.isoformat(), 'before': start, 'after': end, 'steps': (end - start) / STEP})
        start = end
        y, m = nxt
    return out


def step_odds(steps):
    """{steps: probability} for one meeting: 2.11 -> {2: 0.89, 3: 0.11}; -0.4 -> {-1: 0.4, 0: 0.6}."""
    low = math.floor(steps + 1e-9)
    frac = steps - low
    if frac < 1e-6:
        return {low: 1.0}
    return {low: 1 - frac, low + 1: frac}


def tree(moves, lower):
    """Each meeting's distribution of the target range (lower bound -> probability), meetings chained."""
    dist = {0: 1.0}
    out = []
    for mv in moves:
        nxt = {}
        for k, p in dist.items():
            for s, q in step_odds(mv['steps']).items():
                nxt[k + s] = nxt.get(k + s, 0.0) + p * q
        dist = {k: v for k, v in nxt.items() if v > 1e-6}
        ranges = sorted(((round(lower + k * STEP, 2), p) for k, p in dist.items()), reverse=True)
        cut = sum(p for k, p in dist.items() if k < 0)
        hike = sum(p for k, p in dist.items() if k > 0)
        out.append({**mv, 'ranges': [{'lower': lo, 'upper': round(lo + STEP, 2), 'p': p} for lo, p in ranges],
                    'pCut': cut, 'pHold': dist.get(0, 0.0), 'pHike': hike,
                    'expectedChange': sum(k * p for k, p in dist.items()) * STEP})
    return out


def wednesday_join(walcl, tga, rrp):
    """Net liquidity on each Wednesday where all three are known, in $ millions. RRP (FRED in $ billions) is taken on
    that day or the last business day before it."""
    tga_by = dict(tga)
    rrp_rows = sorted(rrp)
    out, j, last = [], 0, None
    for day, assets in sorted(walcl):
        while j < len(rrp_rows) and rrp_rows[j][0] <= day:
            last = rrp_rows[j]
            j += 1
        if day in tga_by and last and (dt.date.fromisoformat(day) - dt.date.fromisoformat(last[0])).days <= 5:
            out.append((day, assets - tga_by[day] - last[1] * 1000))
    return out


def on_or_before(rows, day):
    best = None
    for d, v in rows:
        if d > day:
            break
        best = v
    return best


def change_correlation(a, b):
    """Correlation of weekly % changes of two aligned series, with a 95% interval (Fisher z): (r, low, high, n)."""
    xs = [a[i] / a[i - 1] - 1 for i in range(1, len(a)) if a[i - 1] and b[i - 1]]
    ys = [b[i] / b[i - 1] - 1 for i in range(1, len(b)) if a[i - 1] and b[i - 1]]
    n = len(xs)
    if n < 10:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if not sxx or not syy:
        return None
    r = max(-0.999999, min(0.999999, sxy / math.sqrt(sxx * syy)))
    z, se = math.atanh(r), 1 / math.sqrt(n - 3)
    return {'r': r, 'low': math.tanh(z - 1.96 * se), 'high': math.tanh(z + 1.96 * se), 'weeks': n}


# ---------- requests ----------

@handler('macro.fedodds')
async def fedodds(ctx, msg):
    today = dt.date.today()
    meetings = [dt.date.fromisoformat(d) for d in FOMC if dt.date.fromisoformat(d) >= today]
    if not meetings:
        raise EngineError('No FOMC dates ahead are on file yet.')
    months = []
    y, m = today.year, today.month
    while (y, m) <= _add_month(meetings[-1].year, meetings[-1].month):
        months.append((y, m))
        y, m = _add_month(y, m)
    symbols = [zq_symbol(*ym) for ym in months]
    items = await futures_market._quotes(ctx, symbols)
    prices = {}
    for ym, sym in zip(months, symbols):
        item = items.get(sym) or {}
        q = item.get('quote') or {}
        price = q.get('lastPrice') or q.get('mark') or q.get('closePrice')
        if isinstance(price, (int, float)) and 90 < price <= 100:
            prices[ym] = float(price)
    if not prices:
        raise EngineError('Schwab didn’t return fed funds futures (/ZQ) quotes. Log in to Schwab in the helper and try again.')
    effr, upper, lower = await asyncio.gather(macro.fred(ctx, 'EFFR'), macro.fred(ctx, 'DFEDTARU'), macro.fred(ctx, 'DFEDTARL'))
    spot = effr[-1][1]
    implied = {ym: 100 - p for ym, p in prices.items()}
    moves = meeting_moves(today, meetings, implied, spot)
    rows = tree(moves, lower[-1][1])
    for r in rows:
        r['tentative'] = r['date'] >= TENTATIVE_FROM
    return {'effr': spot, 'effrDate': effr[-1][0], 'target': [lower[-1][1], upper[-1][1]],
            'futures': [{'symbol': zq_symbol(*ym), 'month': f'{ym[0]}-{ym[1]:02d}', 'price': prices[ym], 'rate': 100 - prices[ym]}
                        for ym in months if ym in prices],
            'meetings': rows, 'asOf': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            'method': 'CME FedWatch method: 30-day fed funds futures, 25 bp steps, meetings chained.'}


@handler('macro.netliquidity')
async def netliquidity(ctx, msg):
    walcl, tga, rrp, spx = await asyncio.gather(*(macro.fred(ctx, s) for s in ('WALCL', 'WDTGAL', 'RRPONTSYD', 'SP500')))
    rows = wednesday_join(walcl, tga, rrp)
    if len(rows) < 20:
        raise EngineError('FRED returned too little data for net liquidity.')
    if not 1e6 < rows[-1][1] < 2e7:  # $1-20 trillion in millions: anything else means FRED changed units
        raise EngineError('Net liquidity came out in an unexpected size; the FRED units may have changed.')
    joined = [(d, v, on_or_before(spx, d)) for d, v in rows]
    joined = [r for r in joined if r[2]]
    stats = {}
    for label, weeks in (('1y', 52), ('3y', 156)):
        part = joined[-(weeks + 1):]
        stats[label] = change_correlation([r[1] for r in part], [r[2] for r in part])
    last = rows[-1]

    def ago(weeks):
        return rows[-1 - weeks][1] if len(rows) > weeks else None
    return {'series': [{'date': d, 'value': v} for d, v in rows], 'spx': [{'date': d, 'value': s} for d, _, s in joined],
            'latest': {'date': last[0], 'value': last[1], 'week': ago(1), 'month': ago(4), 'year': ago(52),
                       'assets': on_or_before(walcl, last[0]), 'tga': on_or_before(tga, last[0]), 'rrp': (on_or_before(rrp, last[0]) or 0) * 1000},
            'correlation': stats}
