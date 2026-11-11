"""
Index futures fair value (read-only): what the E-mini S&P 500, Nasdaq-100, Dow and Russell 2000 futures should cost
given the cash index, the cost of money (SOFR) and the dividends paid until expiry, and what the futures therefore say
about the cash market:

- fair value premium = futures' fair price minus the index (the carry the futures should hold over the index),
- mispricing = futures minus fair price (index points and dollars per contract; > 0 = futures rich),
- implied open (cash market closed) = the index level the futures point to: futures minus the fair premium,
- implied financing rate (cash market open) = the rate that makes the futures fair; minus SOFR = the spread buyers pay,
- the roll: the next contract against the front one (fair spread vs the actual spread, the rate it implies).

Maths (cost of carry; Hull, Options, Futures, and Other Derivatives, 11th ed., ch. 5, "Futures on stock indices",
F0 = S0 e^((r - q)T)), written in the money-market form desks quote: F = S (1 + r d/360) - D, with r = SOFR (ACT/360,
the convention of the SOFR rate itself, New York Fed) and D = the dividends paid to expiry, estimated as S q d/365 from
the tracking ETF's forward dividend (last regular payment x payments a year; Yahoo Finance) plus the ETF's fee (SPY,
QQQ, DIA, IWM). Carry runs from the session the index price belongs to (the next open while the cash market is shut). The test file checks both forms
against hand-worked values. Only figures from a source are shown, each with its time; anything missing is None.

Nothing here trades. Schwab is market data only.
"""
import asyncio
import datetime as dt
import math
import time
from zoneinfo import ZoneInfo

from . import datahub, dividends, futures_market, macro
from .core import EngineError, handler, market_session

NY = ZoneInfo('America/New_York')

#: futures root -> the cash index it settles on and the ETF whose dividends stand in for the index's. A fund pays its
#: holders the index's dividends less its yearly fee, so the fee (`fee`, gross expense ratio from each issuer's
#: prospectus: SPDR S&P 500 ETF Trust 0.0945%, Invesco QQQ Trust 0.20%, SPDR Dow Jones Industrial Average ETF Trust
#: 0.16%, iShares Russell 2000 ETF 0.19%) is added back to get the index's own yield.
MARKETS = [
    {'root': 'ES', 'index': '$SPX', 'indexName': 'S&P 500', 'etf': 'SPY', 'fee': 0.000945},
    {'root': 'NQ', 'index': '$NDX', 'indexName': 'Nasdaq-100', 'etf': 'QQQ', 'fee': 0.0020},
    {'root': 'YM', 'index': '$DJI', 'indexName': 'Dow Jones', 'etf': 'DIA', 'fee': 0.0016},
    {'root': 'RTY', 'index': '$RUT', 'indexName': 'Russell 2000', 'etf': 'IWM', 'fee': 0.0019},
]
RATE_SERIES = 'SOFR'


# ---------- maths (pure, tested) ----------

def _ok(*xs):
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in xs)


def dividends_to(spot, div_yield, days):
    """Index points of dividends expected over `days` calendar days at a trailing yield (simple, ACT/365)."""
    return spot * div_yield * days / 365


def fair_value(spot, rate, div_yield, days):
    """Futures fair price: the index financed at `rate` (ACT/360) for `days`, less the dividends paid meanwhile."""
    if not _ok(spot, rate, div_yield, days) or spot <= 0 or days < 0:
        return None
    return spot * (1 + rate * days / 360) - dividends_to(spot, div_yield, days)


def implied_rate(future, spot, div_yield, days):
    """The financing rate (ACT/360) at which `future` is fair: solves fair_value(spot, r, q, days) = future."""
    if not _ok(future, spot, div_yield, days) or spot <= 0 or days < 1:
        return None
    return ((future + dividends_to(spot, div_yield, days)) / spot - 1) * 360 / days


def implied_open(future, fair_premium):
    """The index level the futures point to while the cash market is shut: futures minus the fair premium."""
    if not _ok(future, fair_premium):
        return None
    return future - fair_premium


def index_yield(divs, price, today, fee):
    """The index's dividend yield from its tracking fund: the fund's forward dividend (last regular payment x payments a
    year, specials left out: the platform's one rule, dividends.analyse) over its price, plus the fund's fee. A fixed
    12-month window would catch 5 quarterly payments on some ex-dates and 3 on others. None without a regular record."""
    if not divs or not _ok(price) or price <= 0:
        return None
    a = dividends.analyse(divs, today, price=price)
    if not a['forward'] or a['frequency'] < 2 or a['note']:
        return None
    return a['forward'] / price + (fee or 0)


def next_session(now):
    """The New York date the cash index next opens on (today before 9:30 am on a trading day, else the next one).
    An implied open is the index level for that open, so carry is counted from that day, not from a Saturday."""
    d = now.date()
    if futures_market.is_bday(d) and (now.hour, now.minute) < (9, 30):
        return d
    return futures_market.add_bdays(d, 1)


def sofr_quarter(today):
    """The first 3-month SOFR contract whose quarter hasn't started (its IMM date, the 3rd Wednesday, is after today):
    a clean forward rate. The front contract's quarter is partly fixed already."""
    for c in futures_market.contracts('SR3', today, 4):
        month = futures_market.MONTH_CODES.index(c['code'][-3]) + 1
        year = 2000 + int(c['code'][-2:])
        if futures_market.nth_weekday(year, month, 2, 3) > today:
            return c['code'], dt.date(year, month, 1)
    return None, None


def days_to(expiry_iso, today):
    """Calendar days from today to the expiry date (0 on the day itself)."""
    return (dt.date.fromisoformat(expiry_iso) - today).days


def carry_row(m, spot, rate, div_yield, front, nxt, cash_open, mult):
    """All the readings for one market. `front`/`nxt` = {code, expiry, days, price}; prices may be None."""
    row = {'root': m['root'], 'index': m['index'], 'indexName': m['indexName'], 'etf': m['etf'], 'spot': spot, 'mult': mult,
           'contract': front, 'next': nxt, 'cashOpen': cash_open, 'fairValue': None, 'fairPremium': None, 'basis': None,
           'mispricing': None, 'mispricingUsd': None, 'impliedRate': None, 'spreadBp': None, 'impliedOpen': None,
           'impliedOpenChange': None, 'roll': None}
    if not front or not _ok(spot, rate, div_yield):
        return row
    fv = fair_value(spot, rate, div_yield, front['days'])
    if fv is None:
        return row
    row['fairValue'] = fv
    row['fairPremium'] = fv - spot
    f = front.get('price')
    if _ok(f):
        row['basis'] = f - spot
        row['mispricing'] = f - fv
        row['mispricingUsd'] = (f - fv) * mult
        if cash_open:
            # both prices live: the rate the futures imply is meaningful only when the index is trading too
            row['impliedRate'] = implied_rate(f, spot, div_yield, front['days'])
            if row['impliedRate'] is not None:
                row['spreadBp'] = (row['impliedRate'] - rate) * 10000
        else:
            level = implied_open(f, row['fairPremium'])
            row['impliedOpen'] = level
            row['impliedOpenChange'] = level / spot - 1 if level is not None else None
    if nxt and _ok(f, nxt.get('price')) and nxt['days'] > front['days']:
        gap = nxt['days'] - front['days']
        fair_next = fair_value(f, rate, div_yield, gap)  # the next contract carried on from the front one
        actual = nxt['price'] - f
        rich = nxt['price'] - fair_next
        row['roll'] = {'days': gap, 'fairSpread': fair_next - f, 'spread': actual, 'rich': rich, 'richUsd': rich * mult,
                       'impliedRate': implied_rate(nxt['price'], f, div_yield, gap)}
    return row


# ---------- data ----------

async def _index_quotes(ctx, symbols):
    """Last price and the time it describes for indexes and ETFs (one Schwab request, cached 15 s)."""
    async def load():
        response = await ctx.schwab.get_quotes(symbols)
        if response.status_code == 401:
            raise EngineError('Schwab login expired. Close the helper and start it again to log in.')
        if response.status_code != 200:
            raise EngineError(f'Schwab answered HTTP {response.status_code} for index quotes.')
        out = {}
        for s, item in (response.json() or {}).items():
            q = (item or {}).get('quote') or {}
            price = next((v for v in (q.get(k) for k in ('lastPrice', 'mark', 'closePrice')) if _ok(v) and v > 0), None)
            at = next((v for v in (q.get(k) for k in ('tradeTime', 'quoteTime')) if _ok(v) and v > 0), None)
            if price:
                out[s] = {'price': float(price), 'at': at / 1000 if at else None}
        return out
    return await ctx.cached(('schwab', 'carry-quotes', tuple(symbols)), 15, load)


async def _rate(ctx):
    rows = await macro.fred(ctx, RATE_SERIES)
    date, value = rows[-1]
    return {'value': value / 100, 'date': date, 'source': 'fred', 'series': RATE_SERIES}


def _contract(c, quotes, today):
    item = quotes.get(f"/{c['code']}")
    price = futures_market._quote_fields(item).get('price') if item else None
    return {'code': c['code'], 'symbol': f"/{c['code']}", 'expiry': c['expiry'], 'days': days_to(c['expiry'], today), 'price': price}


@handler('futures.carry')
async def carry(ctx, msg):
    """Fair value, implied open / financing rate and the roll for the four equity index futures."""
    now = dt.datetime.now(NY)
    today = now.date()
    cash_open = market_session() == 'open'
    start = today if cash_open else next_session(now)  # carry runs from the session the index price belongs to
    chains = {m['root']: [c for c in futures_market.contracts(m['root'], today, 3) if days_to(c['expiry'], start) >= 0][:2] for m in MARKETS}
    sofr_code, sofr_month = sofr_quarter(today)
    fut_symbols = [f"/{c['code']}" for cs in chains.values() for c in cs] + ([f"/{sofr_code}"] if sofr_code else [])
    cash_symbols = [m['index'] for m in MARKETS] + [m['etf'] for m in MARKETS]
    fut, cash, rate, *divs = await asyncio.gather(
        futures_market._quotes(ctx, fut_symbols), _index_quotes(ctx, cash_symbols), _rate(ctx),
        *(ctx.dividends(m['etf']) for m in MARKETS), return_exceptions=True)
    if isinstance(cash, EngineError) and 'login expired' in str(cash):
        raise cash
    errors = []
    if isinstance(fut, Exception):
        fut = {}
    if not fut:
        errors.append('Schwab didn’t price the index futures contracts.')
    if isinstance(cash, Exception):
        errors.append(str(cash) if isinstance(cash, EngineError) else 'Schwab’s index quotes couldn’t be loaded.')
        cash = {}
    if isinstance(rate, Exception):
        errors.append(str(rate) if isinstance(rate, EngineError) else 'FRED (SOFR) couldn’t be reached.')
        rate = None
    sr3 = futures_market._quote_fields(fut.get(f"/{sofr_code}")).get('price') if fut and sofr_code else None
    rows, yields = [], {}
    for m, d in zip(MARKETS, divs):
        etf = cash.get(m['etf'])
        d = None if isinstance(d, Exception) else d
        q = index_yield(d, etf and etf['price'], today, m['fee'])
        yields[m['etf']] = q
        spot = cash.get(m['index'])
        chain = [_contract(c, fut, start) for c in chains[m['root']]]
        mult = futures_market.SPEC[m['root']]['mult']
        row = carry_row(m, spot and spot['price'], rate and rate['value'], q, chain[0] if chain else None,
                        chain[1] if len(chain) > 1 else None, cash_open, mult)
        row['spotAt'] = spot and spot['at']
        row['divYield'] = q
        if not etf:
            row['why'] = f'Schwab didn’t price {m["etf"]}, whose dividends stand in for the index’s, so no fair value.'
        elif q is None:
            row['why'] = f'No regular dividend record for {m["etf"]} from Yahoo, so no fair value.'
        elif not spot:
            row['why'] = f'Schwab didn’t price the {m["indexName"]} index.'
        rows.append(row)
    return {'rows': rows, 'cashOpen': cash_open, 'session': market_session(), 'asOf': time.time(),
            'rate': rate and datahub.envelope(rate['value'], 'fred', rate['date']),
            'sofrFutures': {'contract': sofr_code, 'from': sofr_month and sofr_month.isoformat(), 'rate': (100 - sr3) / 100 if _ok(sr3) else None},
            'fees': {m['etf']: m['fee'] for m in MARKETS},
            'yields': {k: v and datahub.envelope(v, 'yahoo', today.isoformat()) for k, v in yields.items()},
            'errors': errors}
