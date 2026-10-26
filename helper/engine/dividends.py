"""Dividend tracking for a portfolio of shares: yields, yearly income and a 12-month income calendar.

Dividend history comes from Yahoo (ctx.dividends, cash per share by ex-date) and prices from Schwab quotes.
Yahoo has no pay dates, so every future date here is an estimate: the next ex-date follows the stock's usual gap
and the pay date is assumed to be PAY_LAG_DAYS after it.
"""
import asyncio
import datetime as dt
import statistics

from .core import EngineError, handler

PAY_LAG_DAYS = 21  # typical gap from ex-date to pay date (most US payers: 2-4 weeks)
SPECIAL_RATIO = 1.5  # a payment this many times the usual one is a one-off special
FREQUENCIES = {52: 'Weekly', 12: 'Monthly', 4: 'Quarterly', 2: 'Twice a year', 1: 'Yearly', 0: 'None'}


def _frequency(gap_days):
    if gap_days <= 13:
        return 52
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


def _gaps(points):
    return [(b[0] - a[0]).days for a, b in zip(points, points[1:])]


def _special(items, i, freq, gap):
    """A one-off special: well above the payments before it and not the new normal. Twice-a-year and yearly payers
    compare with the largest recent payment (their final is often bigger than the interim)."""
    before = [a for _, a in items[max(0, i - 4):i]]
    if not before:
        return False
    base = max(before) if freq <= 2 else statistics.median(before)
    a = items[i][1]
    if a <= base * SPECIAL_RATIO:
        return False
    if i + 1 < len(items):
        return items[i + 1][1] <= base * SPECIAL_RATIO  # the next payment dropped back
    # The newest payment: special only when off-schedule or far too big to be a raise.
    return (items[i][0] - items[i - 1][0]).days < gap / 2 or a > base * 3


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

    all_gaps = _gaps(items[-9:])
    gap = statistics.median(all_gaps) if all_gaps else 365
    freq = _frequency(gap)
    regular = [p for i, p in enumerate(items) if not _special(items, i, freq, gap)]
    year_ago = today - dt.timedelta(days=365)
    out['ttm'] = round(sum(a for d, a in items if d > year_ago), 6)
    out['specialRecent'] = any(d > year_ago and _special(items, i, freq, gap) for i, (d, _) in enumerate(items))
    last_day, last_amount = regular[-1]
    out['lastExDate'] = last_day.isoformat()
    out['lastAmount'] = last_amount
    gaps = _gaps(regular[-9:])
    gap = statistics.median(gaps) if gaps else 365
    freq = _frequency(gap)
    out['frequency'] = freq
    irregular = len(gaps) >= 3 and statistics.pstdev(gaps) > 0.35 * gap
    out['frequencyLabel'] = 'Irregular' if irregular else FREQUENCIES[freq]
    if (today - last_day).days > 2 * gap + 30:
        out['note'] = 'Dividends seem to have stopped'
        return out

    # Twice-a-year and yearly payers often split an uneven interim and final: add up the last 12 months instead.
    uneven = freq <= 2 and len(regular) >= freq
    if uneven:
        forward = sum(a for d, a in regular if d > year_ago) or last_amount * freq
    else:
        forward = last_amount * freq
    out['forward'] = round(forward, 6)
    out['annualIncome'] = round(forward * (shares or 0), 2)
    if price:
        out['yield'] = forward / price
    if cost and shares:
        out['yieldOnCost'] = forward * shares / cost
    before = regular[-1 - freq][1] if uneven and len(regular) > freq else regular[-2][1] if len(regular) >= 2 else None
    if before and last_amount < before * 0.9:
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
    step = 12 // freq if freq <= 12 else 0
    end_year, end_month = _add_months(today.year, today.month, 12)
    end = dt.date(end_year, end_month, 1)
    ex, k = last_day, 0
    while ex < end:
        pay = ex + dt.timedelta(days=PAY_LAG_DAYS)
        # Uneven payers repeat last year's matching payment; others repeat the latest one.
        per = regular[-freq + (k - 1) % freq][1] if uneven and k else last_amount
        if today <= pay < end:
            out['upcoming'].append({'exDate': ex.isoformat(), 'payDate': pay.isoformat(), 'perShare': per,
                                    'amount': round(per * (shares or 0), 2), 'exPassed': ex <= today, 'estimated': True})
        k += 1
        if step:
            y, m = _add_months(last_day.year, last_day.month, k * step)
            ex = dt.date(y, m, min(last_day.day, 28))
        else:
            ex = last_day + dt.timedelta(days=7 * k)
    nxt = next((u for u in out['upcoming'] if not u['exPassed']), None)
    if nxt:
        out['nextExDate'], out['nextPayDate'], out['nextAmount'] = nxt['exDate'], nxt['payDate'], nxt['perShare']
    return out


def summarise(holdings, today):
    """Portfolio totals and the 12-month calendar (month -> payments) from analysed holdings.
    Gain and yield on cost use only holdings with both a cost and a value; yield only holdings with a price."""
    income_of = lambda x: x['annualIncome'] or 0  # noqa: E731
    value = sum(x['value'] or 0 for x in holdings)
    with_cost = [x for x in holdings if x['cost'] and x['value'] is not None]
    cost = sum(x['cost'] for x in with_cost)
    cost_value = sum(x['value'] for x in with_cost)
    priced = [x for x in holdings if x['price'] and x['value']]
    priced_value = sum(x['value'] for x in priced)
    income = sum(income_of(x) for x in holdings)
    calendar = []
    for k in range(12):
        y, m = _add_months(today.year, today.month, k)
        key = f'{y}-{m:02d}'
        pays = sorted(({'symbol': x['symbol'], 'exDate': u['exDate'], 'payDate': u['payDate'], 'perShare': u['perShare'],
                        'amount': u['amount'], 'estimated': True}
                       for x in holdings for u in x['upcoming'] if u['payDate'].startswith(key)), key=lambda p: p['payDate'])
        calendar.append({'month': key, 'total': round(sum(p['amount'] for p in pays), 2), 'payments': pays})
    return {
        'value': value, 'cost': cost or None,
        'gain': cost_value - cost if cost else None, 'gainPct': (cost_value - cost) / cost if cost else None,
        'annualIncome': round(income, 2), 'monthly': round(income / 12, 2),
        'yield': sum(income_of(x) for x in priced) / priced_value if priced_value else None,
        'yieldOnCost': sum(income_of(x) for x in with_cost) / cost if cost else None,
        'calendar': calendar,
    }


def total_return_stats(closes, divs):
    """1, 3 and 5-year total return (dividends reinvested on the ex-date; 3y/5y annualised) and price-only return from
    [(date, close), ...] (oldest first) and {ex-date: cash per share}. None when the history is too short. Also
    trSince/priceSince over the whole history given (sinceStart, sinceYears; yearly rates when it spans a year). Pure."""
    closes = [(d, float(c)) for d, c in closes if c]
    if len(closes) < 2:
        return {**{f'{k}{y}y': None for k in ('tr', 'price') for y in (1, 3, 5)}, 'trSince': None, 'priceSince': None, 'sinceStart': None, 'sinceYears': None}
    # Same rule as quant.price_matrix: a dividend counts on the first trading day on or after its ex-date.
    pending = sorted((d, a) for d, a in (divs or {}).items() if d > closes[0][0])
    index, j = [1.0], 0
    for (_, prev), (day, close) in zip(closes, closes[1:]):
        paid = 0.0
        while j < len(pending) and pending[j][0] <= day:
            paid += pending[j][1]
            j += 1
        index.append(index[-1] * (close + paid) / prev)
    end = closes[-1][0]
    out = {}
    for years in (1, 3, 5):
        cutoff = end - dt.timedelta(days=round(365.25 * years))
        start = max((i for i, (d, _) in enumerate(closes) if d <= cutoff + dt.timedelta(days=5)), default=None)
        if start is None:
            out[f'tr{years}y'] = out[f'price{years}y'] = None
            continue
        tr, pr = index[-1] / index[start], closes[-1][1] / closes[start][1]
        out[f'tr{years}y'], out[f'price{years}y'] = tr ** (1 / years) - 1, pr ** (1 / years) - 1
    # Since the first close we have (a fund's inception when its history is shorter than what was fetched):
    # yearly rates from a year up, the plain change below a year (sinceYears says which).
    span = (end - closes[0][0]).days / 365.25
    tr, pr = index[-1] / index[0], closes[-1][1] / closes[0][1]
    k = 1 / span if span >= 1 else 1
    out.update(trSince=tr ** k - 1, priceSince=pr ** k - 1, sinceStart=closes[0][0].isoformat(), sinceYears=round(span, 2))
    return out


async def total_returns(ctx, symbols):
    """{symbol: total_return_stats} from Schwab daily closes (6 years) and Yahoo dividends; cached per symbol per day."""
    async def one(symbol):
        async def load():
            bars, divs = await asyncio.gather(ctx.daily_bars(symbol, 6), ctx.dividends(symbol))
            day = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).date()  # noqa: E731
            return total_return_stats([(day(b['time']), b['close']) for b in bars], divs or {})
        try:
            return await ctx.cached(('total-return', symbol), 86400, load)
        except Exception:
            return total_return_stats([], {})
    return dict(zip(symbols, await asyncio.gather(*(one(s) for s in symbols))))


def weighted_total_return(holdings):
    """Portfolio 1-year total and price return weighted by current value (as if every holding was held all year)."""
    have = [x for x in holdings if x.get('value') and x.get('tr1y') is not None]
    value = sum(x['value'] for x in have)
    if not value:
        return {'tr1y': None, 'price1y': None}
    return {k: sum(x['value'] * x[k] for x in have) / value for k in ('tr1y', 'price1y')}


def _day(value):
    try:
        return dt.date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def received_dividends(divs, today, seen=None, purchase=None, base=None, base_as_of=None, base_source='entered', splits=None):
    """Dividends one holding has paid the owner so far, and how that figure was found (`method`):
    - 'entered' / 'statement': the owner's (or a statement's) total up to base_as_of, plus estimated payments after it;
    - 'purchase': Yahoo dividends since the purchase date the owner typed;
    - 'tracked': Yahoo dividends since the platform first saw the position (`seen`, the share log kept at each save);
    - 'none': nothing to go on.
    A payment counts when its ex-date is after the start (you must own the shares before the ex-date) and its estimated
    pay date (ex-date + PAY_LAG_DAYS) has passed. Shares on an ex-date come from the share log: the last entry before
    it, or the first entry for dates before the log starts. Yahoo's per-share dividends are in today's shares (split-
    adjusted), so logged share counts are converted to today's shares with the splits after their date (`splits`
    {date: ratio}; None = couldn't be read, flagged in `note`). Pure, so it can be tested."""
    log = []
    for e in seen or []:
        d = _day(e.get('date')) if isinstance(e, dict) else None
        if d:
            log.append((d, float(e.get('shares') or 0)))
    log.sort(key=lambda t: t[0])
    first_seen = log[0][0] if log else None
    start = _day(purchase)
    as_of = _day(base_as_of)
    try:
        base = float(base) if base not in (None, '') else None
    except (TypeError, ValueError):
        base = None
    if base is not None:
        method, start = (base_source if base_source in ('entered', 'statement') else 'entered'), as_of or today
    elif start:
        method = 'purchase'
    elif first_seen:
        method, start = 'tracked', first_seen
    else:
        return {'amount': None, 'method': 'none', 'since': None, 'base': None, 'estimated': None, 'firstSeen': None, 'payments': []}

    split_list = sorted((splits or {}).items())

    def in_today_shares(logged_on, n):
        for d, ratio in split_list:
            if d > logged_on:
                n *= ratio
        return n

    def shares_on(day):
        held = [(d, s) for d, s in log if d < day]
        d, n = held[-1] if held else (log[0] if log else (day, 0.0))
        return in_today_shares(d, n)

    payments = []
    for ex, per in sorted((d, float(a)) for d, a in (divs or {}).items() if a and a > 0):
        if ex <= start or ex + dt.timedelta(days=PAY_LAG_DAYS) > today:
            continue
        n = shares_on(ex)
        if n > 0:
            payments.append({'exDate': ex.isoformat(), 'perShare': per, 'shares': n, 'amount': round(per * n, 2)})
    estimated = round(sum(p['amount'] for p in payments), 2)
    out = {'amount': round((base or 0) + estimated, 2), 'method': method, 'since': start.isoformat(),
           'base': base, 'estimated': estimated, 'firstSeen': first_seen.isoformat() if first_seen else None, 'payments': payments}
    if splits is None and payments:
        out['note'] = 'Stock splits couldn’t be checked: the estimate assumes none.'
    elif any(start < d <= today for d, _ in split_list):
        out['note'] = 'Adjusted for a stock split (shares shown in today’s shares).'
    return out


async def received(ctx, entries, today):
    """{key: received_dividends} for the Account page's per-account holdings. The share logs and the owner's entries
    are read from the saved portfolio (the store is the record, not the browser); a portfolio saved before tracking
    began is saved once, which records today as its first-seen date. Entries without a saved portfolio use what the
    browser sent."""
    from . import store
    entries = [e for e in entries[:600] if isinstance(e, dict) and e.get('key') and str(e.get('symbol') or '').strip()]
    saved = {}
    for pid in {str(e['portfolioId']) for e in entries if e.get('portfolioId')}:
        doc = store.get_doc('portfolios', pid)
        if not doc:
            continue
        if any(store._symbol(x) and not x.get('seen') and float(x.get('shares') or 0) > 0 for x in doc.get('holdings') or []):
            doc = store.save_doc('portfolios', doc)
        for x in doc.get('holdings') or []:
            sym = store._symbol(x)
            if sym and (pid, sym) not in saved:
                saved[(pid, sym)] = x  # the symbol's first holding carries its log and the owner's fields
    out = {}
    for e in entries:
        symbol = str(e['symbol']).strip().upper()
        src = saved.get((str(e.get('portfolioId')), symbol), e)
        divs = await ctx.dividends(symbol)  # cached per symbol for a day
        splits = await ctx.splits(symbol) if hasattr(ctx, 'splits') else {}
        row = received_dividends(divs or {}, today, src.get('seen'), src.get('purchaseDate'), src.get('dividends'), src.get('dividendsAsOf'),
                                 src.get('dividendsSource') or 'entered', splits)
        if divs is None and row['method'] in ('purchase', 'tracked'):
            row.update(amount=None, note='Dividend history unavailable')
        out[str(e['key'])] = row
    return out


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
    returns = await total_returns(ctx, list(wanted))
    for symbol, h in wanted.items():
        divs = await ctx.dividends(symbol)  # cached per symbol for a day
        price = (quotes.get(symbol) or {}).get('price')
        row = analyse(divs or {}, today, h['shares'], h['cost'], price)
        if divs is None:
            row.update(note='Dividend history unavailable', missing=True, forward=None, annualIncome=None, **{'yield': None, 'yieldOnCost': None})
        out.append({'symbol': symbol, 'name': (quotes.get(symbol) or {}).get('name') or '', 'shares': h['shares'], **row, **returns[symbol]})
    out.sort(key=lambda x: -(x['annualIncome'] or 0))
    reply = {'holdings': out, 'missing': sum(1 for x in out if x.get('missing')), 'asOf': today.isoformat(), 'payLagDays': PAY_LAG_DAYS,
             **summarise(out, today), 'totalReturn': weighted_total_return(out)}
    if isinstance(msg.get('received'), list):  # v33: dividends received per account holding (Account page)
        reply['received'] = await received(ctx, msg['received'], today)
    return reply


def payout_series(bars, divs, years=5):
    """Daily closes [[YYYY-MM-DD, close], ...] for the last `years` years (plus a week, so the oldest 12-month window
    has its start) and the dividends paid in that span [[ex-date, cash per share], ...], both oldest first. Pure."""
    day = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).date()  # noqa: E731
    closes = sorted((day(b['time']), float(b['close'])) for b in bars or [] if b.get('close'))
    if not closes:
        return {'closes': [], 'dividends': []}
    start = closes[-1][0] - dt.timedelta(days=round(365.25 * years) + 7)
    closes = [(d, c) for d, c in closes if d >= start]
    return {'closes': [[d.isoformat(), round(c, 4)] for d, c in closes],
            'dividends': [[d.isoformat(), float(a)] for d, a in sorted((divs or {}).items()) if closes[0][0] < d <= closes[-1][0] and a and a > 0]}


@handler('dividends.history')
async def history(ctx, msg):
    """One holding's last 5 years of daily closes and dividends, for the Account page's "where the payout came from"
    charts (the split itself is worked out in the browser, src/portfolio/payoutSplit.ts)."""
    symbol = str(msg.get('symbol') or '').strip().upper()
    if not symbol:
        raise EngineError('Which symbol?')
    bars, divs = await asyncio.gather(ctx.daily_bars(symbol, 6), ctx.dividends(symbol))
    if divs is None:
        raise EngineError(f'No dividend history for {symbol} right now. Try again later.')
    return {'symbol': symbol, **payout_series(bars, divs)}
