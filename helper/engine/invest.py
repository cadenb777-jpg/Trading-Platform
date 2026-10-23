"""
Investments overview: market boards (live quotes plus 1-month to 1-year performance) for stocks, ETFs, bonds,
alternatives and commodities, today's biggest movers, a Schwab symbol search, and the data behind the bond
tools (yields and credit spreads from FRED, Treasury auctions from the Treasury's Fiscal Data API, and bond
lookups by CUSIP from Schwab). All free.
"""
import asyncio
import datetime as dt
import math
import re
import time

from . import macro
from .core import EngineError, handler

FISCAL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/'
SYMBOL = re.compile(r'^[A-Z0-9.\-/$^]{1,15}$')
_history_slots = asyncio.Semaphore(6)


def _num(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _login_check(response):
    if response.status_code == 401:
        raise EngineError('Schwab login expired. Close the helper and start it again to log in.')


# ---------- Quotes and performance ----------

def quote_row(symbol, data):
    q, ref, f = data.get('quote') or {}, data.get('reference') or {}, data.get('fundamental') or {}
    price = next((v for v in (_num(q.get(k)) for k in ('lastPrice', 'mark', 'nAV', 'closePrice')) if v), None)
    change = _num(q.get('netPercentChange'))
    close = _num(q.get('closePrice'))
    if change is not None:
        change /= 100  # Schwab sends percent (1.5 = 1.5%)
    elif price and close:
        change = price / close - 1
    return {
        'symbol': symbol,
        'name': ref.get('description') or '',
        'assetType': data.get('assetMainType') or data.get('assetType') or '',
        'price': price,
        'change': change,
        'high52': _num(q.get('52WeekHigh')),
        'low52': _num(q.get('52WeekLow')),
        'volume': _num(q.get('totalVolume')),
        'divYield': _num(f.get('divYield')),
        'peRatio': _num(f.get('peRatio')),
    }


async def quotes(ctx, symbols):
    out = {}
    # Futures go in their own request, so one Schwab can't price never blanks the stocks and funds.
    stocks = [s for s in symbols if not s.startswith('/')]
    futures = [s for s in symbols if s.startswith('/')]
    chunks = [stocks[i:i + 40] for i in range(0, len(stocks), 40)] + ([futures] if futures else [])
    for chunk in chunks:
        try:
            response = await ctx.schwab.get_quotes(chunk)
        except Exception:
            if chunk is futures:
                continue
            raise
        _login_check(response)
        if response.status_code != 200:
            continue
        data = response.json()
        for symbol in chunk:
            item = data.get(symbol)
            if isinstance(item, dict) and (item.get('quote') or item.get('reference')):
                out[symbol] = quote_row(symbol, item)
    return out


async def closes(ctx, symbol):
    """About 13 months of daily closes: [[unix seconds, close], ...]. Kept on disk for 3 hours."""
    async def load():
        now = dt.datetime.now(dt.timezone.utc)
        async with _history_slots:
            response = await ctx.schwab.get_price_history_every_day(symbol, start_datetime=now - dt.timedelta(days=400), end_datetime=now)
        _login_check(response)
        if response.status_code != 200:
            raise EngineError(f'Schwab returned {response.status_code} for {symbol}')
        return [[c['datetime'] // 1000, c['close']] for c in response.json().get('candles', []) if _num(c.get('close'))]
    return await ctx.cached(('board-closes', symbol), 3 * 3600, load, persist=True, stale_ok=True)


def performance(rows, price=None):
    """1-month, 3-month, year-to-date and 1-year returns and a small price line from daily closes."""
    if not rows:
        return {}
    price = price or rows[-1][1]
    end = rows[-1][0]

    def since(cutoff):
        before = [c for t, c in rows if t <= cutoff]
        return price / before[-1] - 1 if before and before[-1] else None

    year_start = dt.datetime(dt.datetime.fromtimestamp(end, dt.timezone.utc).year, 1, 1, tzinfo=dt.timezone.utc).timestamp()
    recent = [c for _, c in rows[-66:]]
    step = max(1, math.ceil(len(recent) / 40))
    return {
        'm1': since(end - 30 * 86400),
        'm3': since(end - 91 * 86400),
        'ytd': since(year_start - 1),
        'y1': since(end - 365 * 86400) if rows[0][0] <= end - 360 * 86400 else None,
        'spark': recent[::step] + ([recent[-1]] if (len(recent) - 1) % step else []),
    }


@handler('invest.board')
async def board(ctx, msg):
    """Quotes and performance for a list of symbols (one market section of the Investments page)."""
    symbols = []
    for s in msg.get('symbols') or []:
        s = str(s).upper().strip()
        if SYMBOL.match(s) and s not in symbols:
            symbols.append(s)
    if not symbols:
        raise EngineError('No symbols')
    symbols = symbols[:80]
    with_history = [s for s in symbols if not s.startswith('/')]  # Schwab has no daily history for futures
    q, histories = await asyncio.gather(quotes(ctx, symbols), asyncio.gather(*(closes(ctx, s) for s in with_history), return_exceptions=True))
    hist = {s: h for s, h in zip(with_history, histories) if not isinstance(h, Exception)}
    rows = []
    for s in symbols:
        row = q.get(s) or {'symbol': s, 'name': '', 'price': None, 'change': None}
        if s in hist:
            row.update(performance(hist[s], row.get('price')))
            if row.get('price') is None and hist[s]:
                row['price'] = hist[s][-1][1]
        rows.append(row)
    return {'rows': rows, 'asOf': time.time()}


@handler('invest.history')
async def history(ctx, msg):
    """About a year of daily closes for one symbol (for the detail chart)."""
    symbol = str(msg.get('symbol', '')).upper().strip()
    if not SYMBOL.match(symbol):
        raise EngineError(f'Invalid symbol "{symbol}"')
    return {'symbol': symbol, 'closes': await closes(ctx, symbol)}


@handler('invest.movers')
async def movers(ctx, msg):
    """Today's biggest gainers and losers in the S&P 500 (Schwab movers)."""
    index = str(msg.get('index') or '$SPX')
    client = ctx.schwab
    out = {}
    for key, order in (('up', 'PERCENT_CHANGE_UP'), ('down', 'PERCENT_CHANGE_DOWN')):
        try:
            response = await client.get_movers(client.Movers.Index(index), sort_order=getattr(client.Movers.SortOrder, order))
            _login_check(response)
            rows = []
            for m in (response.json() or {}).get('screeners', [])[:10]:
                last, chg = _num(m.get('lastPrice')), _num(m.get('netChange'))
                prev = last - chg if last is not None and chg is not None else None
                rows.append({'symbol': m.get('symbol'), 'name': m.get('description', ''), 'price': last,
                             'change': chg / prev if prev else None, 'volume': _num(m.get('volume'))})
            out[key] = rows
        except EngineError:
            raise
        except Exception as err:
            out[key] = []
            out.setdefault('errors', []).append(str(err))
    return out


@handler('invest.search')
async def search(ctx, msg):
    """Finds stocks, ETFs and funds at Schwab by ticker or by name."""
    query = str(msg.get('query') or '').strip()
    if len(query) < 2:
        raise EngineError('Type at least 2 letters')
    client = ctx.schwab
    projection = client.Instrument.Projection
    found = {}
    for text, proj in ((query.upper(), projection.SYMBOL_SEARCH), (query, projection.DESCRIPTION_SEARCH)):
        try:
            response = await client.get_instruments([text], proj)
            _login_check(response)
            if response.status_code != 200:
                continue
            for item in (response.json() or {}).get('instruments', []):
                sym = item.get('symbol')
                if sym and sym not in found:
                    found[sym] = {'symbol': sym, 'name': item.get('description', ''), 'assetType': item.get('assetType', ''),
                                  'exchange': item.get('exchange', '')}
        except EngineError:
            raise
        except Exception:
            continue
    return {'results': list(found.values())[:30]}


# ---------- Bonds ----------

# FRED series for the bond market page: (id, name, group).
BOND_SERIES = [
    ('DGS3MO', '3-month Treasury bill', 'Treasury yields'),
    ('DGS2', '2-year Treasury', 'Treasury yields'),
    ('DGS5', '5-year Treasury', 'Treasury yields'),
    ('DGS10', '10-year Treasury', 'Treasury yields'),
    ('DGS30', '30-year Treasury', 'Treasury yields'),
    ('BAMLC0A0CMEY', 'Investment-grade corporate yield', 'Corporate bonds'),
    ('BAMLH0A0HYM2EY', 'High-yield corporate yield', 'Corporate bonds'),
    ('BAMLC0A0CM', 'Investment-grade spread over Treasuries', 'Corporate bonds'),
    ('BAMLC0A4CBBB', 'BBB spread over Treasuries', 'Corporate bonds'),
    ('BAMLH0A0HYM2', 'High-yield (junk) spread', 'Corporate bonds'),
    ('DFII10', '10-year TIPS (real yield)', 'Inflation & rates'),
    ('T10YIE', '10-year breakeven inflation', 'Inflation & rates'),
    ('DFF', 'Fed funds rate', 'Inflation & rates'),
    ('MORTGAGE30US', '30-year mortgage rate', 'Inflation & rates'),
]


async def _bond_series(ctx, sid, name, group):
    rows = await macro.fred(ctx, sid)
    s = macro.summarise(rows)
    cutoff = (dt.date.today() - dt.timedelta(days=366)).isoformat()
    year = macro.weekly([r for r in rows if r[0] >= cutoff])
    return {'id': sid, 'name': name, 'group': group, **s, 'spark': [round(v, 3) for _, v in year]}


@handler('bonds.market')
async def bond_market(ctx, msg):
    results = await asyncio.gather(*(_bond_series(ctx, *s) for s in BOND_SERIES), return_exceptions=True)
    return {'series': [r for r in results if not isinstance(r, Exception)],
            'failed': [s[1] for s, r in zip(BOND_SERIES, results) if isinstance(r, Exception)]}


async def fiscal(ctx, dataset, params):
    response = await ctx.http.get(FISCAL + dataset, params=params)
    response.raise_for_status()
    return response.json().get('data') or []


def auction_row(r):
    def text(k):
        v = r.get(k)
        return '' if v in (None, 'null') else str(v)
    return {
        'cusip': text('cusip'),
        'type': text('security_type'),
        'term': text('security_term'),
        'auctionDate': text('auction_date'),
        'issueDate': text('issue_date'),
        'maturityDate': text('maturity_date'),
        'rate': _num(r.get('int_rate')),
        'yield': _num(r.get('high_yield')) or _num(r.get('high_investment_rate')),
        'discountRate': _num(r.get('high_discnt_rate')),
        'price': _num(r.get('price_per100')),
        'bidToCover': _num(r.get('bid_to_cover_ratio')),
        'offering': _num(r.get('offering_amt')),
        'reopening': text('reopening') == 'Yes',
    }


@handler('bonds.auctions')
async def auctions(ctx, msg):
    """Recent Treasury auction results and the auctions coming up."""
    async def load():
        recent, upcoming = await asyncio.gather(
            fiscal(ctx, 'auctions_query', {'sort': '-auction_date', 'page[size]': '150'}),
            fiscal(ctx, 'upcoming_auctions', {'sort': 'auction_date', 'page[size]': '60'}),
            return_exceptions=True)
        if isinstance(recent, Exception) and isinstance(upcoming, Exception):
            raise EngineError(f'Could not reach the Treasury ({type(recent).__name__}).')
        today = dt.date.today().isoformat()
        rows = [auction_row(r) for r in (recent if not isinstance(recent, Exception) else [])]
        results = [r for r in rows if r['auctionDate'] and r['auctionDate'] <= today and (r['yield'] or r['discountRate'])]
        coming = {(r['cusip'], r['auctionDate']): r for r in rows if r['auctionDate'] > today}
        for r in (upcoming if not isinstance(upcoming, Exception) else []):
            row = auction_row(r)
            if row['auctionDate'] >= today:
                coming.setdefault((row['cusip'], row['auctionDate']), row)
        return {'results': results[:120], 'upcoming': sorted(coming.values(), key=lambda r: r['auctionDate'])}
    return await ctx.cached('treasury-auctions', 3600, load, persist=True, stale_ok=True)


MONTHS = {m: i for i, m in enumerate(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], 1)}


def parse_bond_description(text):
    """Coupon (%) and maturity (YYYY-MM-DD) from a description like 'US TREASURY NOTE 4.25% 11/15/2034'."""
    coupon = maturity = None
    m = re.search(r'(\d{1,2}(?:\.\d+)?)\s*%', text)
    if m:
        coupon = float(m.group(1))
    m = re.search(r'\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b', text)
    if m:
        mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        maturity = f'{yy + 2000 if yy < 100 else yy:04d}-{mm:02d}-{dd:02d}'
    else:
        m = re.search(r'\b(\d{1,2})[- ]?([A-Za-z]{3})[- ]?(\d{2,4})\b', text)
        if m and m.group(2).upper() in MONTHS:
            yy = int(m.group(3))
            maturity = f'{yy + 2000 if yy < 100 else yy:04d}-{MONTHS[m.group(2).upper()]:02d}-{int(m.group(1)):02d}'
    return coupon, maturity


@handler('bonds.cusip')
async def cusip_lookup(ctx, msg):
    """Looks up a bond by its 9-character CUSIP: Schwab's description and price, plus Treasury auction details."""
    cusip = re.sub(r'[^A-Z0-9]', '', str(msg.get('cusip') or '').upper())
    if len(cusip) != 9:
        raise EngineError('A CUSIP is 9 letters and numbers (for example 91282CLW9).')

    async def schwab():
        response = await ctx.schwab.get_instrument_by_cusip(cusip)
        _login_check(response)
        if response.status_code != 200:
            return None
        data = response.json() or {}
        items = data.get('instruments') if isinstance(data, dict) else data
        item = (items or [None])[0] if isinstance(items, list) else data
        return item if isinstance(item, dict) and item else None

    async def treasury():
        rows = await fiscal(ctx, 'auctions_query', {'filter': f'cusip:eq:{cusip}', 'sort': '-auction_date'})
        return [auction_row(r) for r in rows]

    found, auctions_found = await asyncio.gather(schwab(), treasury(), return_exceptions=True)
    if isinstance(found, EngineError):
        raise found
    found = None if isinstance(found, Exception) else found
    auctions_found = [] if isinstance(auctions_found, Exception) else auctions_found
    if not found and not auctions_found:
        raise EngineError(f'No bond found for CUSIP {cusip}. Check the number (it is printed on statements and trade confirmations).')
    description = (found or {}).get('description', '')
    coupon, maturity = parse_bond_description(description)
    if auctions_found:
        a = auctions_found[0]
        coupon = coupon if coupon is not None else a['rate']
        maturity = maturity or a['maturityDate'][:10] or None
        description = description or f"US Treasury {a['type']} {a['term']}".strip()
    return {
        'cusip': cusip,
        'description': description,
        'assetType': (found or {}).get('assetType', 'BOND' if auctions_found else ''),
        'price': _num((found or {}).get('bondPrice')),
        'factor': _num((found or {}).get('bondFactor')),
        'exchange': (found or {}).get('exchange', ''),
        'coupon': coupon,
        'maturity': maturity,
        'auctions': auctions_found[:6],
    }
