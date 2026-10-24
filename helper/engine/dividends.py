"""Dividend tracking for a portfolio of shares: yields, yearly income and a 12-month income calendar.

Dividend history comes from Yahoo (ctx.dividends, cash per share by ex-date) and prices from Schwab quotes.
Yahoo has no pay dates, so every future date here is an estimate: the next ex-date follows the stock's usual gap
and the pay date is assumed to be PAY_LAG_DAYS after it.
"""
import datetime as dt
import statistics

from .core import EngineError, handler

PAY_LAG_DAYS = 21  # typical gap from ex-date to pay date (most US payers: 2-4 weeks)
SPECIAL_RATIO = 1.5  # a payment this many times the usual one is a one-off special
FREQUENCIES = {12: 'Monthly', 4: 'Quarterly', 2: 'Twice a year', 1: 'Yearly', 0: 'None'}


def _frequency(gap_days):
    if gap_days <= 45:
        return 12
    if gap_days <= 120:
        return 4
    if gap_days <= 240:
        return 2
    return 1


def _month(d):
    return f'{d.year}-{d.month:02d}'


def _add_months(year, month, k):
    m = month - 1 + k
    return year + m // 12, m % 12 + 1


def analyse(divs, today, shares=0.0, cost=None, price=None):
    """One holding's dividend picture from {ex-date: cash per share}. Pure (no network) so it can be tested."""
    items = sorted((d, float(a)) for d, a in (divs or {}).items() if a and a > 0 and d <= today)
    value = price * shares if price is not None and shares else None
    out = {
        'price': price, 'value': value, 'cost': cost,
        'gain': value - cost if value is not None and cost else None,
        'gainPct': (value - cost) / cost if value is not None and cost else None,
        'frequency': 0, 'frequencyLabel': FREQUENCIES[0], 'ttm': 0.0, 'forward': 0.0, 'lastAmount': None,
        'lastExDate': None, 'yield': 0.0 if price else None, 'yieldOnCost': 0.0 if cost else None, 'annualIncome': 0.0,
        'growth5y': None, 'nextExDate': None, 'nextPayDate': None, 'nextAmount': None, 'specialRecent': False,
        'note': 'No dividends' if not items else '', 'history12': [], 'upcoming': [],
    }
    # Last 12 months of cash per share by ex-date month (oldest first), for every holding (zeros when none).
    months = [_add_months(today.year, today.month, -k) for k in range(11, -1, -1)]
    by_month = {f'{y}-{m:02d}': 0.0 for y, m in months}
    for d, a in items:
        if _month(d) in by_month:
            by_month[_month(d)] += a
    out['history12'] = [{'month': k, 'amount': round(v, 6)} for k, v in by_month.items()]
    if not items:
        return out

    recent = items[-12:]
    usual = statistics.median(a for _, a in recent)
    regular = [(d, a) for d, a in items if a <= usual * SPECIAL_RATIO]
    year_ago = today - dt.timedelta(days=365)
    out['ttm'] = round(sum(a for d, a in items if d > year_ago), 6)
    out['specialRecent'] = any(a > usual * SPECIAL_RATIO and d > year_ago for d, a in items)
    last_day, last_amount = regular[-1]
    out['lastExDate'] = last_day.isoformat()
    out['lastAmount'] = last_amount

    gaps = [(b[0] - a[0]).days for a, b in zip(regular[-9:], regular[-8:])]
    gap = statistics.median(gaps) if gaps else 365
    freq = _frequency(gap)
    out['frequency'] = freq
    out['frequencyLabel'] = FREQUENCIES[freq]
    if (today - last_day).days > 2 * gap + 30:
        out['note'] = 'Dividends seem to have stopped'
        return out

    forward = last_amount * freq
    out['forward'] = round(forward, 6)
    out['annualIncome'] = round(forward * (shares or 0), 2)
    if price:
        out['yield'] = forward / price
    if cost and shares:
        out['yieldOnCost'] = forward * shares / cost
    if len(regular) >= 2 and regular[-2][1] > 0 and last_amount < regular[-2][1] * 0.9:
        out['note'] = 'Latest dividend was cut'

    # 5-year growth: regular dividends in the last 12 months vs the same 12 months five years earlier.
    five_ago = today - dt.timedelta(days=5 * 365)
    if items[0][0] <= five_ago - dt.timedelta(days=365):
        then = sum(a for d, a in regular if five_ago - dt.timedelta(days=365) < d <= five_ago)
        now = sum(a for d, a in regular if d > year_ago)
        if then > 0 and now > 0:
            out['growth5y'] = (now / then) ** (1 / 5) - 1

    # Expected payments: step from the last ex-date by the usual gap; keep those paid in the next 12 months
    # (an ex-date that has just passed still pays later, at the amount already announced).
    step = 12 // freq
    end_year, end_month = _add_months(today.year, today.month, 12)
    end = dt.date(end_year, end_month, 1)
    ex, k = last_day, 0
    while ex < end:
        pay = ex + dt.timedelta(days=PAY_LAG_DAYS)
        if today <= pay < end:
            out['upcoming'].append({'exDate': ex.isoformat(), 'payDate': pay.isoformat(), 'perShare': last_amount,
                                    'amount': round(last_amount * (shares or 0), 2), 'exPassed': ex <= today, 'estimated': True})
        k += 1
        y, m = _add_months(last_day.year, last_day.month, k * step)
        ex = dt.date(y, m, min(last_day.day, 28))
    nxt = next((u for u in out['upcoming'] if not u['exPassed']), None)
    if nxt:
        out['nextExDate'], out['nextPayDate'], out['nextAmount'] = nxt['exDate'], nxt['payDate'], nxt['perShare']
    return out


def summarise(holdings, today):
    """Portfolio totals and the 12-month calendar (month -> payments) from analysed holdings."""
    value = sum(x['value'] or 0 for x in holdings)
    cost = sum(x['cost'] or 0 for x in holdings if x['cost'] and x['value'] is not None)
    income = sum(x['annualIncome'] for x in holdings)
    cost_all = sum(x['cost'] or 0 for x in holdings)
    calendar = []
    for k in range(12):
        y, m = _add_months(today.year, today.month, k)
        key = f'{y}-{m:02d}'
        pays = sorted(({'symbol': x['symbol'], 'exDate': u['exDate'], 'payDate': u['payDate'], 'perShare': u['perShare'],
                        'amount': u['amount'], 'estimated': True}
                       for x in holdings for u in x['upcoming'] if u['payDate'].startswith(key)), key=lambda p: p['payDate'])
        calendar.append({'month': key, 'total': round(sum(p['amount'] for p in pays), 2), 'payments': pays})
    return {
        'value': value, 'cost': cost_all or None,
        'gain': value - cost if cost else None, 'gainPct': (value - cost) / cost if cost else None,
        'annualIncome': round(income, 2), 'monthly': round(income / 12, 2),
        'yield': income / value if value else None, 'yieldOnCost': income / cost_all if cost_all else None,
        'calendar': calendar,
    }


@handler('dividends.portfolio')
async def portfolio(ctx, msg):
    from . import invest
    raw = msg.get('holdings') if isinstance(msg.get('holdings'), list) else []
    wanted = {}
    for h in raw[:300]:
        if not isinstance(h, dict):
            continue
        symbol = str(h.get('symbol') or '').strip().upper()
        try:
            shares = float(h.get('shares') or 0)
            cost = float(h['costBasis']) if h.get('costBasis') not in (None, '') else None
        except (TypeError, ValueError):
            continue
        if not symbol or shares <= 0:
            continue
        prev = wanted.get(symbol, {'shares': 0.0, 'cost': None})
        prev['shares'] += shares
        if cost is not None:
            prev['cost'] = (prev['cost'] or 0) + cost
        wanted[symbol] = prev
    if not wanted:
        raise EngineError('Add holdings with a number of shares first.')
    quotes = await invest.quotes(ctx, list(wanted))
    today = dt.date.today()
    out = []
    for symbol, h in wanted.items():
        divs = await ctx.dividends(symbol)  # cached per symbol for a day
        price = (quotes.get(symbol) or {}).get('price')
        row = analyse(divs or {}, today, h['shares'], h['cost'], price)
        if divs is None:
            row['note'] = 'Dividend history unavailable'
        out.append({'symbol': symbol, 'name': (quotes.get(symbol) or {}).get('name') or '', 'shares': h['shares'], **row})
    out.sort(key=lambda x: -x['annualIncome'])
    return {'holdings': out, 'asOf': today.isoformat(), 'payLagDays': PAY_LAG_DAYS, **summarise(out, today)}
