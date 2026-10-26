"""
Futures market overview (read-only): the main US futures by sector with Schwab quotes, 1-week to year-to-date
returns from daily closes, contract specs, the next expiry and roll date, the biggest movers (in % and in
standard deviations of daily moves), the term structure of one market and CFTC positioning (COT).

Nothing here trades. Schwab is market data only; anything Schwab doesn't supply is "unavailable", never invented.
"""
import asyncio
import datetime as dt
import logging
import math
import re
import time

from . import flow, invest, positioning
from .core import NYSE_HOLIDAYS, EngineError, handler

# ---------- Contract specs ----------
# Static, from the exchanges' contract-spec pages (checked October 2026):
#   CME Group  https://www.cmegroup.com/markets/<asset>/<product>.contractSpecs.html (equity index, rates, energy,
#              metals, grains, livestock, FX, crypto), e.g. .../equities/sp/e-mini-sandp500.contractSpecs.html
#   ICE US     https://www.ice.com/products/15 (Coffee C), /23 (Sugar No. 11), /7 (Cocoa), /194 (US Dollar Index)
#   Cboe CFE   https://www.cboe.com/tradable_products/vix/vix_futures/specifications/
# mult = dollars per 1.00 move in the exchange's quoted price (grains, meats and softs are quoted in cents);
# tick / tickValue = the smallest price step and what it is worth per contract.
# months = the contract months traders roll through (CME month codes F G H J K M N Q U V X Z = Jan..Dec);
# expiry = the rule for the last trading day; fnd = physically delivered contracts whose first notice day comes first
# (traders roll before it). cot = CFTC contract market code (micros use their parent market's report).
SECTORS = ['Equity index', 'Rates', 'Energy', 'Metals', 'Ags', 'FX', 'Crypto', 'Volatility']

CME_GLOBEX = 'Sun-Fri 6:00 pm - 5:00 pm ET (daily break 5-6 pm)'
GRAINS = 'Sun-Fri 8:00 pm - 8:45 am and Mon-Fri 9:30 am - 2:20 pm ET'


def _s(root, name, sector, exchange, size, mult, tick, tick_value, months, expiry, cot, hours=CME_GLOBEX, fnd=False, roll_days=3):
    return {'root': root, 'name': name, 'sector': sector, 'exchange': exchange, 'size': size, 'mult': mult, 'tick': tick,
            'tickValue': tick_value, 'months': months, 'expiry': expiry, 'cot': cot, 'hours': hours, 'fnd': fnd, 'rollDays': roll_days}


SPECS = [
    _s('ES', 'E-mini S&P 500', 'Equity index', 'CME', '$50 x S&P 500 index', 50, 0.25, 12.50, 'HMUZ', 'third_friday', '13874A', roll_days=6),
    _s('NQ', 'E-mini Nasdaq-100', 'Equity index', 'CME', '$20 x Nasdaq-100 index', 20, 0.25, 5.00, 'HMUZ', 'third_friday', '209742', roll_days=6),
    _s('YM', 'E-mini Dow ($5)', 'Equity index', 'CBOT', '$5 x Dow Jones Industrial Average', 5, 1, 5.00, 'HMUZ', 'third_friday', '124603', roll_days=6),
    _s('RTY', 'E-mini Russell 2000', 'Equity index', 'CME', '$50 x Russell 2000 index', 50, 0.10, 5.00, 'HMUZ', 'third_friday', '239742', roll_days=6),
    _s('MES', 'Micro E-mini S&P 500', 'Equity index', 'CME', '$5 x S&P 500 index', 5, 0.25, 1.25, 'HMUZ', 'third_friday', '13874A', roll_days=6),
    _s('MNQ', 'Micro E-mini Nasdaq-100', 'Equity index', 'CME', '$2 x Nasdaq-100 index', 2, 0.25, 0.50, 'HMUZ', 'third_friday', '209742', roll_days=6),
    _s('ZT', '2-Year T-Note', 'Rates', 'CBOT', '$200,000 face value', 2000, 1 / 256, 7.8125, 'HMUZ', 'last_bday', '042601', fnd=True),
    _s('ZF', '5-Year T-Note', 'Rates', 'CBOT', '$100,000 face value', 1000, 1 / 128, 7.8125, 'HMUZ', 'last_bday', '044601', fnd=True),
    _s('ZN', '10-Year T-Note', 'Rates', 'CBOT', '$100,000 face value', 1000, 1 / 64, 15.625, 'HMUZ', 'treasury_long', '043602', fnd=True),
    _s('ZB', 'U.S. Treasury Bond', 'Rates', 'CBOT', '$100,000 face value', 1000, 1 / 32, 31.25, 'HMUZ', 'treasury_long', '020601', fnd=True),
    _s('SR3', '3-Month SOFR', 'Rates', 'CME', '$2,500 x index (100 minus the rate)', 2500, 0.005, 12.50, 'HMUZ', 'sofr', '134741'),
    _s('CL', 'Crude Oil (WTI)', 'Energy', 'NYMEX', '1,000 barrels', 1000, 0.01, 10.00, 'FGHJKMNQUVXZ', 'crude', '067651'),
    _s('NG', 'Natural Gas (Henry Hub)', 'Energy', 'NYMEX', '10,000 MMBtu', 10000, 0.001, 10.00, 'FGHJKMNQUVXZ', 'natgas', '023651'),
    _s('RB', 'RBOB Gasoline', 'Energy', 'NYMEX', '42,000 gallons', 42000, 0.0001, 4.20, 'FGHJKMNQUVXZ', 'prior_last_bday', '111659'),
    _s('HO', 'Heating Oil (ULSD)', 'Energy', 'NYMEX', '42,000 gallons', 42000, 0.0001, 4.20, 'FGHJKMNQUVXZ', 'prior_last_bday', '022651'),
    _s('GC', 'Gold', 'Metals', 'COMEX', '100 troy ounces', 100, 0.10, 10.00, 'GJMQVZ', 'third_last_bday', '088691', fnd=True),
    _s('SI', 'Silver', 'Metals', 'COMEX', '5,000 troy ounces', 5000, 0.005, 25.00, 'HKNUZ', 'third_last_bday', '084691', fnd=True),
    _s('HG', 'Copper', 'Metals', 'COMEX', '25,000 pounds', 25000, 0.0005, 12.50, 'HKNUZ', 'third_last_bday', '085692', fnd=True),
    _s('PL', 'Platinum', 'Metals', 'NYMEX', '50 troy ounces', 50, 0.10, 5.00, 'FJNV', 'third_last_bday', '076651', fnd=True),
    _s('ZC', 'Corn', 'Ags', 'CBOT', '5,000 bushels (price in cents)', 50, 0.25, 12.50, 'HKNUZ', 'grain', '002602', GRAINS, fnd=True),
    _s('ZS', 'Soybeans', 'Ags', 'CBOT', '5,000 bushels (price in cents)', 50, 0.25, 12.50, 'FHKNQUX', 'grain', '005602', GRAINS, fnd=True),
    _s('ZW', 'Wheat (Chicago SRW)', 'Ags', 'CBOT', '5,000 bushels (price in cents)', 50, 0.25, 12.50, 'HKNUZ', 'grain', '001602', GRAINS, fnd=True),
    _s('ZL', 'Soybean Oil', 'Ags', 'CBOT', '60,000 pounds (price in cents)', 600, 0.01, 6.00, 'FHKNQUVZ', 'grain', '007601', GRAINS, fnd=True),
    _s('ZM', 'Soybean Meal', 'Ags', 'CBOT', '100 short tons', 100, 0.10, 10.00, 'FHKNQUVZ', 'grain', '026603', GRAINS, fnd=True),
    _s('LE', 'Live Cattle', 'Ags', 'CME', '40,000 pounds (price in cents)', 400, 0.025, 10.00, 'GJMQVZ', 'last_bday', '057642', 'Mon-Fri 9:30 am - 2:05 pm ET', fnd=True),
    _s('HE', 'Lean Hogs', 'Ags', 'CME', '40,000 pounds (price in cents)', 400, 0.025, 10.00, 'GJKMNQVZ', 'tenth_bday', '054642', 'Mon-Fri 9:30 am - 2:05 pm ET'),
    _s('KC', 'Coffee C', 'Ags', 'ICE US', '37,500 pounds (price in cents)', 375, 0.05, 18.75, 'HKNUZ', 'coffee', '083731', 'Mon-Fri 4:15 am - 1:30 pm ET', fnd=True),
    _s('SB', 'Sugar No. 11', 'Ags', 'ICE US', '112,000 pounds (price in cents)', 1120, 0.01, 11.20, 'HKNV', 'prior_last_bday', '080732', 'Mon-Fri 3:30 am - 1:00 pm ET'),
    _s('CC', 'Cocoa', 'Ags', 'ICE US', '10 metric tons', 10, 1, 10.00, 'HKNUZ', 'cocoa', '073732', 'Mon-Fri 4:45 am - 1:30 pm ET', fnd=True),
    _s('6E', 'Euro FX', 'FX', 'CME', '125,000 euros', 125000, 0.00005, 6.25, 'HMUZ', 'fx', '099741', roll_days=6),
    _s('6J', 'Japanese Yen', 'FX', 'CME', '12,500,000 yen', 12500000, 0.0000005, 6.25, 'HMUZ', 'fx', '097741', roll_days=6),
    _s('6B', 'British Pound', 'FX', 'CME', '62,500 pounds', 62500, 0.0001, 6.25, 'HMUZ', 'fx', '096742', roll_days=6),
    _s('6A', 'Australian Dollar', 'FX', 'CME', '100,000 Australian dollars', 100000, 0.00005, 5.00, 'HMUZ', 'fx', '232741', roll_days=6),
    _s('6C', 'Canadian Dollar', 'FX', 'CME', '100,000 Canadian dollars', 100000, 0.00005, 5.00, 'HMUZ', 'fx_cad', '090741', roll_days=6),
    _s('DX', 'U.S. Dollar Index', 'FX', 'ICE US', '$1,000 x index', 1000, 0.005, 5.00, 'HMUZ', 'fx', '098662', 'Sun-Fri 8:00 pm - 5:00 pm ET', roll_days=6),
    _s('BTC', 'Bitcoin', 'Crypto', 'CME', '5 bitcoin', 5, 5, 25.00, 'FGHJKMNQUVXZ', 'last_friday', '133741', roll_days=5),
    _s('MBT', 'Micro Bitcoin', 'Crypto', 'CME', '0.1 bitcoin', 0.1, 5, 0.50, 'FGHJKMNQUVXZ', 'last_friday', '133741', roll_days=5),
    _s('ETH', 'Ether', 'Crypto', 'CME', '50 ether', 50, 0.50, 25.00, 'FGHJKMNQUVXZ', 'last_friday', '146021', roll_days=5),
    _s('VX', 'VIX futures', 'Volatility', 'Cboe CFE', '$1,000 x VIX index', 1000, 0.05, 50.00, 'FGHJKMNQUVXZ', 'vix', '1170E1',
       'Nearly 24 hours, Sun-Fri (Cboe Futures Exchange)', roll_days=5),
]
SPEC = {s['root']: s for s in SPECS}
MONTH_CODES = 'FGHJKMNQUVXZ'

# ---------- Expiry and roll calendar ----------
# Business days skip weekends and NYSE holidays (CME's holiday list is nearly the same); dates are estimates.


def is_bday(d):
    return d.weekday() < 5 and d not in NYSE_HOLIDAYS


def add_bdays(d, n):
    """The business day n business days after (n > 0) or before (n < 0) d, not counting d itself."""
    step = 1 if n > 0 else -1
    while n:
        d += dt.timedelta(days=step)
        if is_bday(d):
            n -= step
    return d


def last_bday(year, month):
    d = dt.date(year + month // 12, month % 12 + 1, 1) - dt.timedelta(days=1)
    while not is_bday(d):
        d -= dt.timedelta(days=1)
    return d


def first_bday(year, month):
    d = dt.date(year, month, 1)
    while not is_bday(d):
        d += dt.timedelta(days=1)
    return d


def nth_weekday(year, month, weekday, n):
    """The n-th given weekday (Mon=0) of a month."""
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(weekday - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def _prev_month(year, month):
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _back_to_bday(d):
    while not is_bday(d):
        d -= dt.timedelta(days=1)
    return d


def expiry(root, year, month):
    """Last trading day of a contract (estimate from the exchange's rule)."""
    rule = SPEC[root]['expiry']
    py, pm = _prev_month(year, month)
    if rule == 'third_friday':
        return _back_to_bday(nth_weekday(year, month, 4, 3))
    if rule == 'last_bday':
        return last_bday(year, month)
    if rule == 'treasury_long':  # 7th business day before the last business day of the month
        return add_bdays(last_bday(year, month), -7)
    if rule == 'sofr':  # business day before the third Wednesday of the month after the 3-month reference quarter
        y, m = (year + 1, month - 9) if month > 9 else (year, month + 3)
        return add_bdays(nth_weekday(y, m, 2, 3), -1)
    if rule == 'crude':  # 3 business days before the 25th of the month before (the business day before it if the 25th isn't one)
        d25 = dt.date(py, pm, 25)
        return add_bdays(d25 if is_bday(d25) else _back_to_bday(d25), -3)
    if rule == 'natgas':  # 3 business days before the first day of the contract month
        return add_bdays(dt.date(year, month, 1), -3)
    if rule == 'prior_last_bday':
        return last_bday(py, pm)
    if rule == 'third_last_bday':
        return add_bdays(last_bday(year, month), -2)
    if rule == 'grain':  # business day before the 15th
        return add_bdays(dt.date(year, month, 15), -1)
    if rule == 'tenth_bday':
        return add_bdays(first_bday(year, month), 9)
    if rule == 'coffee':  # one business day before last notice day (7 business days before the last business day)
        return add_bdays(last_bday(year, month), -8)
    if rule == 'cocoa':  # one business day before last notice day (10 business days before the last business day)
        return add_bdays(last_bday(year, month), -11)
    if rule == 'fx':  # 2 business days before the third Wednesday
        return add_bdays(nth_weekday(year, month, 2, 3), -2)
    if rule == 'fx_cad':
        return add_bdays(nth_weekday(year, month, 2, 3), -1)
    if rule == 'last_friday':
        d = nth_weekday(year, month, 4, 4)
        if (d + dt.timedelta(weeks=1)).month == month:
            d += dt.timedelta(weeks=1)
        return _back_to_bday(d)
    if rule == 'vix':  # the Wednesday 30 days before the third Friday of the next month
        ny, nm = (year + 1, 1) if month == 12 else (year, month + 1)
        d = nth_weekday(ny, nm, 4, 3) - dt.timedelta(days=30)
        return d if is_bday(d) else _back_to_bday(d)
    raise ValueError(rule)


def first_notice(root, year, month):
    """First notice day for physically delivered contracts (None for the rest)."""
    if not SPEC[root]['fnd']:
        return None
    rule = SPEC[root]['expiry']
    if rule == 'coffee':
        return add_bdays(first_bday(year, month), -7)
    if rule == 'cocoa':
        return add_bdays(first_bday(year, month), -10)
    if root == 'LE':  # live cattle: the Monday after the first Friday of the contract month (next business day if a holiday)
        d = nth_weekday(year, month, 4, 1) + dt.timedelta(days=3)
        return d if is_bday(d) else add_bdays(d, 1)
    return last_bday(*_prev_month(year, month))


def roll_date(root, year, month):
    """When most traders move to the next contract: 2 business days before first notice, else a few days before expiry."""
    fnd = first_notice(root, year, month)
    if fnd:
        return add_bdays(fnd, -2)
    return add_bdays(expiry(root, year, month), -SPEC[root]['rollDays'])


def contract_code(root, year, month):
    return f'{root}{MONTH_CODES[month - 1]}{year % 100:02d}'


def contracts(root, today=None, count=6):
    """The next `count` contracts in the roll cycle, starting with the one traders hold now (not yet past its roll date)."""
    today = today or dt.date.today()
    months = [MONTH_CODES.index(c) + 1 for c in SPEC[root]['months']]
    out, year = [], today.year - 1  # a year back: a SOFR contract trades until 3 months after its month
    while len(out) < count:
        for m in months:
            if len(out) < count and roll_date(root, year, m) >= today:
                fnd = first_notice(root, year, m)
                out.append({'code': contract_code(root, year, m), 'expiry': expiry(root, year, m).isoformat(),
                            'roll': roll_date(root, year, m).isoformat(), 'firstNotice': fnd.isoformat() if fnd else None})
        year += 1
    return out


# ---------- Movers and sectors ----------

def daily_sd(closes, window=60):
    """Standard deviation of the last `window` daily % moves (sample), or None with fewer than 20 moves."""
    vals = [c for _, c in closes][-(window + 1):]
    moves = [b / a - 1 for a, b in zip(vals, vals[1:]) if a]
    if len(moves) < 20:
        return None
    mean = sum(moves) / len(moves)
    return math.sqrt(sum((m - mean) ** 2 for m in moves) / (len(moves) - 1))


def returns(closes, price=None, today=None):
    """1-week, 1-month and year-to-date returns from daily closes [[unix s, close], ...]."""
    if not closes:
        return {'w1': None, 'm1': None, 'ytd': None}
    price = price or closes[-1][1]
    end = closes[-1][0]
    year = (today or dt.datetime.fromtimestamp(end, dt.timezone.utc).date()).year

    def since(cutoff):
        before = [c for t, c in closes if t <= cutoff]
        return price / before[-1] - 1 if before and before[-1] else None

    jan1 = dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc).timestamp()
    return {'w1': since(end - 7 * 86400), 'm1': since(end - 30 * 86400),
            'ytd': since(jan1 - 1) if closes[0][0] < jan1 else None}


def movers(rows, n=6):
    """The biggest movers today by % change and by size of the move in standard deviations (rows need change / sigma)."""
    by_pct = sorted((r for r in rows if r.get('change') is not None), key=lambda r: -abs(r['change']))
    by_sd = sorted((r for r in rows if r.get('sigma') is not None), key=lambda r: -abs(r['sigma']))
    pick = lambda r: {'root': r['root'], 'name': r['name'], 'change': r.get('change'), 'sigma': r.get('sigma')}  # noqa: E731
    return {'pct': [pick(r) for r in by_pct[:n]], 'sigma': [pick(r) for r in by_sd[:n]]}


def sector_summary(rows):
    """Average day change per sector, with its best and worst market."""
    out = []
    for name in SECTORS:
        group = [r for r in rows if r['sector'] == name]
        priced = [r for r in group if r.get('change') is not None]
        best = max(priced, key=lambda r: r['change'], default=None)
        worst = min(priced, key=lambda r: r['change'], default=None)
        out.append({'sector': name, 'markets': len(group), 'priced': len(priced),
                    'change': sum(r['change'] for r in priced) / len(priced) if priced else None,
                    'best': best and {'root': best['root'], 'change': best['change']},
                    'worst': worst and {'root': worst['root'], 'change': worst['change']}})
    return out


def williams_note(comm_index):
    """Larry Williams reads commercials at the edges of their range as the tell (156-week COT index here)."""
    if comm_index is None:
        return ''
    if comm_index >= 80:
        return 'Commercials near their most long in 3 years: Williams reads this as bullish (they buy weakness).'
    if comm_index <= 20:
        return 'Commercials near their most short in 3 years: Williams reads this as bearish (they sell strength).'
    return 'Commercials in the middle of their range: no extreme.'


# ---------- Data ----------

#: Symbols with no daily history: symbol -> time to ask Schwab again. An empty reply (Schwab has none) is
#: remembered for 6 hours, an error (maybe a hiccup) for 5 minutes.
_NO_HISTORY = {}
_LAST_QUOTE_ERROR = {'text': ''}
log = logging.getLogger(__name__)
EMPTY_RETRY, ERROR_RETRY = 6 * 3600, 300


async def _closes(ctx, symbol):
    if time.time() < _NO_HISTORY.get(symbol, 0):
        return []
    try:
        rows = await invest.closes(ctx, symbol)
    except EngineError as err:
        if 'login expired' in str(err):
            raise
        _NO_HISTORY[symbol] = time.time() + ERROR_RETRY
        return []
    except Exception:
        _NO_HISTORY[symbol] = time.time() + ERROR_RETRY
        return []
    if not rows:
        _NO_HISTORY[symbol] = time.time() + EMPTY_RETRY
    return rows


def cot_index(values):
    """The latest 3-year (156-week) COT index, the same rule as the detail panel's history (None under 26 weeks)."""
    return positioning.rolling_index(values)[-1] if values else None


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > -999 else None


async def _quotes(ctx, symbols):
    """Raw Schwab quote items for futures symbols ({} when Schwab can't price them)."""
    async def load():
        response = await ctx.schwab.get_quotes(symbols)
        if response.status_code == 401:
            raise EngineError('Schwab login expired. Close the helper and start it again to log in.')
        if response.status_code != 200:
            log.warning('Futures quotes: Schwab answered HTTP %s', response.status_code)
            _LAST_QUOTE_ERROR['text'] = f'Schwab answered HTTP {response.status_code} for futures quotes.'
            return {}
        _LAST_QUOTE_ERROR['text'] = ''
        return match_quotes(symbols, response.json())
    try:
        return await ctx.cached(('fut-quotes', tuple(symbols)), 15, load)
    except EngineError:
        raise
    except Exception:
        return {}


def match_quotes(symbols, data):
    """Schwab's reply items for each root ("/ES"). Schwab may key a futures quote by the root or by the active contract
    ("/ESZ26"), or carry the root only in `symbol`, so all three are matched. Unmatched replies are logged (keys only)."""
    items = {k: v for k, v in (data or {}).items() if isinstance(v, dict) and (v.get('quote') or v.get('reference'))}
    out = {}
    for s in symbols:
        if s in items:
            out[s] = items[s]
            continue
        for k, v in items.items():
            names = {k, str(v.get('symbol') or ''), str((v.get('reference') or {}).get('futureActiveSymbol') or '')}
            if any(n == s or (n.startswith(s) and re.fullmatch(r'[FGHJKMNQUVXZ]\d{1,2}', n[len(s):])) for n in names):
                out[s] = v
                break
    if items and not out:
        log.warning('Futures quotes: none matched. Schwab sent keys %s', sorted(items)[:20])
    return out


def _quote_fields(item):
    """Price, change and the futures-only fields Schwab adds (active contract, its expiry, multiplier, tick)."""
    if not item:
        return {'price': None, 'change': None}
    row = invest.quote_row('', item)
    q, ref = item.get('quote') or {}, item.get('reference') or {}
    if row['change'] is None:  # futures quotes carry futurePercentChange (percent) or netChange instead
        pct, net = _num(q.get('futurePercentChange')), _num(q.get('netChange'))
        if pct is not None:
            row['change'] = pct / 100
        elif net is not None and row['price'] and row['price'] - net:
            row['change'] = net / (row['price'] - net)
    exp = _num(ref.get('futureExpirationDate'))
    return {'price': row['price'], 'change': row['change'], 'netChange': row['netChange'], 'volume': row['volume'],
            'openInterest': _num(q.get('openInterest')), 'activeSymbol': ref.get('futureActiveSymbol') or None,
            'schwabExpiry': dt.datetime.fromtimestamp(exp / 1000, dt.timezone.utc).date().isoformat() if exp else None,
            'schwabMult': _num(ref.get('futureMultiplier')), 'tradingHours': ref.get('futureTradingHours') or None}


async def cot_latest(ctx):
    """Latest COT readings for every market on the board in one CFTC request (3 years, for the 156-week index)."""
    codes = sorted({s['cot'] for s in SPECS})

    async def load():
        since = (dt.date.today() - dt.timedelta(days=3 * 365 + 7)).isoformat()
        where = f"cftc_contract_market_code in({','.join(repr(c) for c in codes)}) AND report_date_as_yyyy_mm_dd >= '{since}'"
        response = await ctx.http.get(flow.COT_URL, params={'$where': where, '$limit': '20000', '$order': 'report_date_as_yyyy_mm_dd'})
        response.raise_for_status()
        groups = {}
        for r in response.json():
            groups.setdefault(str(r.get('cftc_contract_market_code', '')).strip(), []).append(r)
        out = {}
        for code, items in groups.items():
            rows = flow.parse_cot(items)
            if rows:
                last = rows[-1]
                out[code] = {'date': last['date'], 'commNet': last['commNet'], 'specNet': last['specNet'], 'smallNet': last['smallNet'],
                             'openInterest': last['openInterest'], 'commIndex': cot_index([x['commNet'] for x in rows]),
                             'specIndex': cot_index([x['specNet'] for x in rows]), 'smallIndex': cot_index([x['smallNet'] for x in rows])}
        return out
    return await ctx.cached(('fut-cot',), 6 * 3600, load, persist=True, stale_ok=True)


def _row(spec, item, closes, today):
    q = _quote_fields(item)
    price = q['price']
    if price is None and closes:
        price = closes[-1][1]
    sd = daily_sd(closes)
    mult = q.get('schwabMult') or spec['mult']
    front = contracts(spec['root'], today, 1)[0]
    return {'root': spec['root'], 'symbol': f"/{spec['root']}", 'name': spec['name'], 'sector': spec['sector'], 'exchange': spec['exchange'],
            'price': price, 'change': q['change'], 'sigma': q['change'] / sd if q['change'] is not None and sd else None, 'sd': sd,
            **returns(closes, price, today), 'hasHistory': bool(closes), 'quoted': bool(item), 'size': spec['size'], 'mult': spec['mult'],
            'tick': spec['tick'], 'tickValue': spec['tickValue'], 'notional': price * mult if price else None, 'contract': front['code'],
            'expiry': front['expiry'], 'roll': front['roll'], 'firstNotice': front['firstNotice'], 'activeSymbol': q.get('activeSymbol'),
            'schwabExpiry': q.get('schwabExpiry'), 'openInterest': q.get('openInterest'), 'cot': spec['cot']}


@handler('futures.board')
async def board(ctx, msg):
    """Every market on the board with quotes, returns, specs, roll dates, sector summary, movers and COT."""
    symbols = [f"/{s['root']}" for s in SPECS]
    today = dt.date.today()
    quotes, histories, cot = await asyncio.gather(_quotes(ctx, symbols), asyncio.gather(*(_closes(ctx, s) for s in symbols)),
                                                  cot_latest(ctx), return_exceptions=True)
    for part in (quotes, histories):
        if isinstance(part, EngineError):
            raise part
    if isinstance(quotes, Exception):
        quotes = {}
    if isinstance(histories, Exception):
        histories = [[] for _ in symbols]
    errors = {}
    if isinstance(cot, Exception):
        errors['cot'] = f'Could not load CFTC positioning ({cot}).'
        cot = {}
    rows = [_row(spec, quotes.get(sym), hist, today) for spec, sym, hist in zip(SPECS, symbols, histories)]
    for r in rows:
        c = cot.get(r['cot'])
        r['positioning'] = {**c, 'note': williams_note(c.get('commIndex'))} if c else None
    if not any(r['quoted'] for r in rows):
        errors['quotes'] = (f"Schwab returned no futures quotes. {_LAST_QUOTE_ERROR['text']} Prices show as unavailable. "
                            'If this lasts during market hours, check that your Schwab account can see futures quotes.').replace('  ', ' ')
    elif not any(r['change'] is not None for r in rows):
        errors['quotes'] = "Schwab sent futures prices but no day change, so the sector tiles can't show a move."
    return {'rows': rows, 'sectors': sector_summary(rows), 'movers': movers(rows), 'asOf': time.time(), 'errors': errors}


def curve_shape(points):
    """'contango' (later contracts dearer), 'backwardation' (cheaper) or 'flat', from the first and last price."""
    priced = [p for p in points if p.get('price')]
    if len(priced) < 2:
        return None
    slope = priced[-1]['price'] / priced[0]['price'] - 1
    return 'contango' if slope > 0.001 else 'backwardation' if slope < -0.001 else 'flat'


@handler('futures.curve')
async def curve(ctx, msg):
    """Term structure: quotes for the next contracts of one market. available=False when Schwab doesn't price them."""
    root = str(msg.get('root', '')).upper()
    if root not in SPEC:
        raise EngineError('Unknown futures market')
    items = contracts(root, dt.date.today(), 6)
    quotes = await _quotes(ctx, [f"/{c['code']}" for c in items])
    points = [{**c, 'price': _quote_fields(quotes.get(f"/{c['code']}")).get('price')} for c in items]
    priced = [p for p in points if p['price']]
    return {'root': root, 'name': SPEC[root]['name'], 'points': points, 'available': len(priced) >= 2, 'shape': curve_shape(points)}


@handler('futures.detail')
async def detail(ctx, msg):
    """One market: specs, the next contracts, a year of daily closes and 3 years of weekly COT with indexes."""
    root = str(msg.get('root', '')).upper()
    spec = SPEC.get(root)
    if not spec:
        raise EngineError('Unknown futures market')
    symbol = f'/{root}'
    quotes, closes, cot = await asyncio.gather(_quotes(ctx, [symbol]), _closes(ctx, symbol), positioning.cot_rows(ctx, spec['cot']), return_exceptions=True)
    errors = {}
    if isinstance(quotes, EngineError):
        raise quotes
    if isinstance(cot, Exception) or not cot:
        errors['cot'] = 'The CFTC positioning report could not be loaded.'
        cot = []
    closes = [] if isinstance(closes, Exception) else closes
    row = _row(spec, (quotes or {}).get(symbol) if not isinstance(quotes, Exception) else None, closes, dt.date.today())
    comm = positioning.rolling_index([r['commNet'] for r in cot])
    spec_i = positioning.rolling_index([r['specNet'] for r in cot])
    small = positioning.rolling_index([r['smallNet'] for r in cot])
    cot_rows = [{'date': r['date'], 'commNet': r['commNet'], 'specNet': r['specNet'], 'smallNet': r['smallNet'], 'openInterest': r['openInterest'],
                 'commIndex': c, 'specIndex': s, 'smallIndex': m} for r, c, s, m in zip(cot, comm, spec_i, small)][-156:]
    latest = cot_rows[-1] if cot_rows else None
    return {'root': root, 'row': row, 'spec': {k: spec[k] for k in ('size', 'mult', 'tick', 'tickValue', 'exchange', 'hours', 'months')},
            'contracts': contracts(root, dt.date.today(), 6), 'closes': closes, 'cot': cot_rows,
            'note': williams_note(latest and latest['commIndex']), 'errors': errors}
