"""
Cross-checks one value (a fund's NAV, a last price, the previous close, a dividend yield or an expense ratio) against
several free public sources, shows every value found with its source, time and link, and scores how far it can be
trusted. Nothing here is invented: a source that has no value says so, and the best estimate is only ever a value a
source reported (the median of the sources that agree).

Sources (one adapter each; public pages and free endpoints only, no logins, no paid APIs):
  schwab         Schwab quotes (the owner's market-data app; one request at a time, 0.7 s apart)
  sec_xbrl       SEC EDGAR structured data: NetAssetValuePerShare from 10-K/10-Q (funds, needs the CIK)
  sec_nav        SEC EDGAR filings: the fund's own monthly NAV announcements (alts.nav_data)
  nasdaq         Nasdaq.com's public quote API (info + summary)
  yahoo          Yahoo Finance chart data (last price, previous close; trailing dividends for a yield)
  yahoo_summary  Yahoo Finance quoteSummary (yield, expense ratio; needs Yahoo's free cookie + crumb)
  stooq          Stooq's free CSV quote (last price)
  google         The Google Finance quote page (scraped: price, previous close, yield, expense ratio)

Each site is asked politely: one request at a time per site with a pause between requests, short timeouts, and every
answer cached per source + symbol + field in cache.db (FIELDS[f]['ttl']), so the same value is not fetched again soon.
The browser only asks when the owner opens a fund page or clicks "Sources" (no background scraping).

Confidence rubric (score 0-97%):
  1. Reliability per source (RELIABILITY): official filings and exchange-sourced broker data highest (SEC 0.95, Schwab
     0.90), the exchange's own site next (Nasdaq 0.80), aggregators lower (Yahoo 0.70/0.65, Stooq 0.60) and a scraped
     page lowest (Google Finance 0.55).
  2. Freshness: 1.0 while the value is younger than the field's normal update cadence (FIELDS[f]['cadence'], e.g. 15
     minutes for a live price, 35 days for a monthly fund NAV); after that it halves every further cadence (floor 0.1).
     A price from the last session's close counts as fresh while the market is closed. Unknown time: 0.6.
  3. Each source's weight w = reliability x freshness.
  4. Agreement: values within the field's tolerance (FIELDS[f]['tolerance'], relative) of each other form a group; the
     group with the most weight is the agreeing group. Agreeing sources combine like independent confirmations:
     1 - product(1 - 0.8 w). That is multiplied by the agreeing group's share of all the weight, so a source that
     disagrees pulls the score down.
  5. One source only: capped at 60% (SINGLE_CAP). Never above 97% (MAX_SCORE).
  Labels: 80%+ High, 55%+ Medium, below that Low. Tone: ok when every source agrees, amber when some differ but the
  agreeing group holds 60%+ of the weight, red when it doesn't (sources really disagree).
"""
import asyncio
import csv
import datetime as dt
import io
import math
import re
import statistics
import time
import urllib.parse
from zoneinfo import ZoneInfo

from .core import NYSE_EARLY_CLOSES, NYSE_HOLIDAYS, EngineError, handler, market_session

NY = ZoneInfo('America/New_York')
SYMBOL = re.compile(r'^[A-Z0-9.\-]{1,12}$')

RELIABILITY = {'sec_xbrl': 0.95, 'sec_nav': 0.95, 'schwab': 0.90, 'nasdaq': 0.80, 'yahoo': 0.70, 'yahoo_summary': 0.65, 'stooq': 0.60, 'google': 0.55}
SOURCE_NAMES = {'sec_xbrl': 'SEC (10-K/10-Q data)', 'sec_nav': 'SEC (fund NAV filing)', 'schwab': 'Schwab', 'nasdaq': 'Nasdaq.com',
                'yahoo': 'Yahoo Finance', 'yahoo_summary': 'Yahoo Finance (summary)', 'stooq': 'Stooq', 'google': 'Google Finance'}
KINDS = {'sec_xbrl': 'official filing', 'sec_nav': 'official filing', 'schwab': 'broker (exchange data)', 'nasdaq': 'exchange website',
         'yahoo': 'aggregator', 'yahoo_summary': 'aggregator', 'stooq': 'aggregator', 'google': 'scraped page'}

DAY = 86400
#: cadence = how often the value normally changes (freshness), tolerance = relative spread still counted as agreeing,
#: ttl = how long one source's answer is cached, sources = which adapters can give it.
FIELDS = {
    'last': {'label': 'Last price', 'unit': 'usd', 'cadence': 15 * 60, 'tolerance': 0.005, 'ttl': 60,
             'sources': ('schwab', 'nasdaq', 'yahoo', 'stooq', 'google')},
    'prevClose': {'label': 'Previous close', 'unit': 'usd', 'cadence': 4 * DAY, 'tolerance': 0.002, 'ttl': 3600,
                  'sources': ('schwab', 'nasdaq', 'yahoo', 'google')},
    'nav': {'label': 'NAV per share', 'unit': 'usd', 'cadence': 35 * DAY, 'tolerance': 0.01, 'ttl': 6 * 3600,
            'sources': ('sec_nav', 'sec_xbrl', 'schwab', 'yahoo', 'google')},
    'divYield': {'label': 'Dividend yield', 'unit': 'pct', 'cadence': 7 * DAY, 'tolerance': 0.10, 'ttl': 12 * 3600,
                 'sources': ('schwab', 'nasdaq', 'yahoo_summary', 'yahoo', 'google')},
    'expenseRatio': {'label': 'Expense ratio', 'unit': 'pct', 'cadence': 400 * DAY, 'tolerance': 0.05, 'ttl': 7 * DAY,
                     'sources': ('yahoo_summary', 'google')},
}
SCALE = 0.8
SINGLE_CAP = 0.60
MAX_SCORE = 0.97
AMBER_SHARE = 0.60
#: seconds between two requests to the same site
PACING = {'schwab': 0.7, 'google': 2.0, 'yahoo': 1.0, 'nasdaq': 1.0, 'stooq': 1.0}
TIMEOUT = 8

RUBRIC = [
    'Each source has a reliability: official filings and broker data high, the exchange site next, aggregators lower, scraped pages lowest.',
    'Freshness: full marks while a value is younger than how often it normally changes, then it halves for each extra period.',
    'Sources that agree (within the field\'s tolerance) add up like independent confirmations; sources that disagree lower the score.',
    'With only one source the score is capped at 60%. It never goes above 97%.',
]


# ---------- the rubric (pure) ----------

def rel_diff(a, b):
    big = max(abs(a), abs(b))
    return 0.0 if big == 0 else abs(a - b) / big


def last_regular_close(now):
    """Unix time of the most recent regular-session close at or before `now` (16:00 New York, 13:00 on early closes)."""
    local = now.astimezone(NY)
    day = local.date()
    for _ in range(10):
        if day.weekday() < 5 and day not in NYSE_HOLIDAYS:
            close = dt.datetime(day.year, day.month, day.day, 13 if day in NYSE_EARLY_CLOSES else 16, tzinfo=NY)
            if close <= local:
                return close.timestamp()
        day -= dt.timedelta(days=1)
    return local.timestamp()


def effective_age(field, as_of, now):
    """Seconds by which a value is behind what it could be. A price from the last close is current while the market is closed."""
    if as_of is None:
        return None
    t = now.timestamp()
    if field == 'last' and market_session(now.astimezone(NY)) != 'open':
        return max(0.0, last_regular_close(now) - 60 - as_of)
    return max(0.0, t - as_of)


def freshness(age, cadence):
    if age is None:
        return 0.6
    if age <= cadence:
        return 1.0
    return max(0.1, 0.5 ** ((age - cadence) / cadence))


def agreeing_group(readings, tolerance):
    """The indices of the readings that agree with each other and carry the most weight (ties: more sources)."""
    best, best_key = [], (-1.0, 0)
    for r in readings:
        group = [i for i, x in enumerate(readings) if rel_diff(x['value'], r['value']) <= tolerance]
        center = statistics.median(readings[i]['value'] for i in group)
        group = [i for i, x in enumerate(readings) if rel_diff(x['value'], center) <= tolerance] or group
        key = (round(sum(readings[i]['weight'] for i in group), 9), len(group))
        if key > best_key:
            best, best_key = group, key
    return best


def score(field, readings, now=None):
    """Scores readings [{source, value, asOf}] for `field`. Adds reliability, freshness, weight and agrees to each
    reading and returns {best, score, level, tone, status, message, agreeing, spread}. Pure: no network."""
    spec = FIELDS[field]
    now = now or dt.datetime.now(dt.timezone.utc)
    values = [r for r in readings if r.get('value') is not None and math.isfinite(r['value'])]
    for r in values:
        r['reliability'] = RELIABILITY.get(r['source'], 0.5)
        r['freshness'] = round(freshness(effective_age(field, r.get('asOf'), now), spec['cadence']), 3)
        r['weight'] = round(r['reliability'] * r['freshness'], 4)
    if not values:
        return {'best': None, 'score': 0.0, 'level': 'None', 'tone': 'red', 'status': 'none', 'agreeing': 0, 'spread': None,
                'message': f'No source had a {spec["label"].lower()} for this. Nothing is shown rather than a guess.'}
    group = agreeing_group(values, spec['tolerance'])
    for i, r in enumerate(values):
        r['agrees'] = i in group
    agreeing = [values[i] for i in group]
    best = statistics.median(r['value'] for r in agreeing)
    combined = 1 - math.prod(1 - SCALE * r['weight'] for r in agreeing)
    total = sum(r['weight'] for r in values)
    share = sum(r['weight'] for r in agreeing) / total if total else 0
    s = combined * share
    if len(values) == 1:
        s = min(s, SINGLE_CAP)
    s = round(min(s, MAX_SCORE), 3)
    spread = max(rel_diff(r['value'], best) for r in values)
    tol = spec['tolerance']
    outliers = [r for r in values if not r['agrees']]
    names = lambda rs: ', '.join(SOURCE_NAMES.get(r['source'], r['source']) for r in rs)
    if len(values) == 1:
        status, tone = 'single', 'amber'
        message = f'Only one source ({names(values)}) had this value, so confidence is capped at {SINGLE_CAP:.0%}.'
    elif not outliers:
        status, tone = 'agree', 'ok'
        message = f'{"Both" if len(values) == 2 else f"All {len(values)}"} sources agree (within {tol:.1%} of each other).'
    elif share >= AMBER_SHARE:
        status, tone = 'differ', 'amber'
        worst = max(outliers, key=lambda r: rel_diff(r['value'], best))
        message = (f'{names(outliers)} {"differs" if len(outliers) == 1 else "differ"} from the others (by up to '
                   f'{rel_diff(worst["value"], best):.1%}), so {"it was" if len(outliers) == 1 else "they were"} left out of the best estimate.')
    else:
        status, tone = 'conflict', 'red'
        message = (f'The sources disagree (by up to {spread:.1%}, more than the {tol:.1%} expected). '
                   'Check the official source (the fund\'s or company\'s own site or filing) before relying on this number.')
    level = 'High' if s >= 0.8 else 'Medium' if s >= 0.55 else 'Low'
    return {'best': best, 'score': s, 'level': level, 'tone': tone, 'status': status, 'message': message,
            'agreeing': len(agreeing), 'spread': round(spread, 6)}


def cache_key(source, symbol, field):
    """The cache.db key for one source's answer for one symbol and field (fund CIKs as 'cik:123')."""
    return ('crosscheck', source, str(symbol).upper(), field)


# ---------- parsers (pure; tested on saved fixtures) ----------

def _num(text):
    """'$1,234.50' / '0.44%' / '1.2K' -> float (percent stays a plain number), None for 'N/A', '--' and the like."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text) if math.isfinite(text) else None
    t = str(text).strip().replace(',', '').replace('$', '').replace('%', '').replace('−', '-')
    try:
        v = float(t)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def _pct(text):
    v = _num(text)
    return None if v is None else v / 100


def parse_schwab(symbol, data):
    """Schwab get_quotes JSON -> {field: (value, asOf)} plus 'assetType' and 'exchange' hints."""
    item = (data or {}).get(symbol) or {}
    q, f, ref = item.get('quote') or {}, item.get('fundamental') or {}, item.get('reference') or {}
    asset = item.get('assetMainType') or item.get('assetType') or ''
    t = q.get('quoteTime') or q.get('tradeTime')
    as_of = t / 1000 if isinstance(t, (int, float)) and t > 1e11 else t if isinstance(t, (int, float)) else None
    out = {'assetType': asset, 'exchange': ref.get('exchangeName') or ''}
    last = _num(q.get('lastPrice'))
    if last:
        out['last'] = (last, as_of)
        change = _num(q.get('netChange'))
        if change is not None:
            out['prevClose'] = (round(last - change, 6), as_of)  # CLAUDE.md: prevClose = lastPrice - netChange
    nav = _num(q.get('nAV'))
    if asset == 'MUTUAL_FUND':
        nav = nav or last or _num(q.get('closePrice'))  # a mutual fund's price is its NAV (a closed-end fund's isn't)
    if nav:
        out['nav'] = (nav, as_of)
    y = _num(f.get('divYield'))
    if y is not None:
        out['divYield'] = (y / 100, as_of)  # Schwab sends percent
    return out


def parse_yahoo_chart(data):
    """Yahoo /v8/finance/chart JSON (range=5d, interval=1d) -> {field: (value, asOf)} plus 'instrumentType'."""
    result = ((data or {}).get('chart') or {}).get('result') or []
    if not result:
        return {}
    r = result[0]
    meta = r.get('meta') or {}
    as_of = meta.get('regularMarketTime')
    out = {'instrumentType': meta.get('instrumentType') or ''}
    last = _num(meta.get('regularMarketPrice'))
    if last:
        out['last'] = (last, as_of)
        if out['instrumentType'] == 'MUTUALFUND':
            out['nav'] = (last, as_of)
    closes = [c for c in ((((r.get('indicators') or {}).get('quote') or [{}])[0]).get('close') or []) if c is not None]
    stamps = r.get('timestamp') or []
    if len(closes) >= 2 and as_of and stamps and len(stamps) >= len(closes):
        # The last bar is the latest session; the one before it is the previous close.
        out['prevClose'] = (float(closes[-2]), as_of)
    elif _num(meta.get('previousClose')):
        out['prevClose'] = (_num(meta['previousClose']), as_of)
    divs = ((r.get('events') or {}).get('dividends') or {}).values()
    if last and divs and as_of:
        year = [d for d in divs if d.get('date', 0) > as_of - 365 * DAY]
        if year:
            out['divYield'] = (sum(float(d['amount']) for d in year) / last, as_of)
    return out


def parse_yahoo_summary(data):
    """Yahoo /v10/finance/quoteSummary JSON (summaryDetail, fundProfile, defaultKeyStatistics, price)."""
    result = ((data or {}).get('quoteSummary') or {}).get('result') or []
    if not result:
        return {}
    r = result[0]
    raw = lambda d, k: _num(((d or {}).get(k) or {}).get('raw')) if isinstance((d or {}).get(k), dict) else None
    sd, fp, ks, pr = r.get('summaryDetail'), r.get('fundProfile') or {}, r.get('defaultKeyStatistics'), r.get('price') or {}
    as_of = pr.get('regularMarketTime') if isinstance(pr.get('regularMarketTime'), (int, float)) else None
    out = {}
    y = raw(sd, 'yield') or raw(sd, 'dividendYield') or raw(sd, 'trailingAnnualDividendYield')
    if y is not None:
        out['divYield'] = (y, as_of)
    er = raw(fp.get('feesExpensesInvestment'), 'annualReportExpenseRatio') or raw(ks, 'annualReportExpenseRatio') or raw(sd, 'expenseRatio')
    if er is not None:
        out['expenseRatio'] = (er, None)  # from the prospectus; Yahoo gives no date for it
    nav = raw(sd, 'navPrice')
    if nav:
        out['nav'] = (nav, as_of)
    return out


GOOGLE_ROWS = {'prevClose': 'Previous close', 'divYield': 'Dividend yield', 'expenseRatio': 'Expense ratio'}


def parse_google(page):
    """A Google Finance quote page -> {field: (value, asOf)}. Price and time come from the data-last-price and
    data-last-normal-market-timestamp attributes; the rest from the "Previous close" etc. rows (value in class P6K39c)."""
    out = {}
    m = re.search(r'data-last-price="([0-9.,]+)"', page)
    if not m:
        return out
    t = re.search(r'data-last-normal-market-timestamp="(\d+)"', page)
    as_of = int(t.group(1)) if t else None
    out['last'] = (_num(m.group(1)), as_of)
    for field, label in GOOGLE_ROWS.items():
        row = re.search(r'>\s*' + re.escape(label) + r'\s*<.{0,1500}?class="P6K39c"[^>]*>([^<]+)<', page, re.S | re.I)
        if not row:
            continue
        text = row.group(1).strip()
        v = _pct(text) if field != 'prevClose' else _num(text)
        if v is not None:
            out[field] = (v, as_of if field == 'prevClose' else None)
    return out


def _nasdaq_time(text):
    """'Oct 23, 2026 4:00 PM ET' or 'Oct 23, 2026' -> unix seconds (New York time)."""
    s = re.sub(r'\s+(ET|EDT|EST)\b.*$', '', str(text or '').replace('DATA AS OF', '').strip(), flags=re.I).strip()
    for fmt in ('%b %d, %Y %I:%M %p', '%b %d, %Y'):
        try:
            return dt.datetime.strptime(s, fmt).replace(tzinfo=NY).timestamp()
        except ValueError:
            continue
    return None


def parse_nasdaq(info, summary=None):
    """Nasdaq.com /api/quote/{SYM}/info and /summary JSON -> {field: (value, asOf)}."""
    out = {}
    data = (info or {}).get('data') or {}
    primary = data.get('primaryData') or {}
    as_of = _nasdaq_time(primary.get('lastTradeTimestamp'))
    last = _num(primary.get('lastSalePrice'))
    if last:
        out['last'] = (last, as_of)
    rows = (((summary or {}).get('data') or {}).get('summaryData')) or {}
    prev = _num((rows.get('PreviousClose') or {}).get('value'))
    if prev:
        out['prevClose'] = (prev, as_of)
    y = _pct((rows.get('Yield') or rows.get('CurrentYield') or {}).get('value'))
    if y is not None:
        out['divYield'] = (y, as_of)
    return out


def parse_stooq(text):
    """Stooq quote CSV (f=sd2t2ohlc, h) -> {'last': (close, asOf)}. Stooq times are Polish time; 'N/D' = no data."""
    rows = list(csv.DictReader(io.StringIO(text or '')))
    if not rows:
        return {}
    row = rows[0]
    close = _num(row.get('Close'))
    if not close:
        return {}
    as_of = None
    try:
        as_of = dt.datetime.strptime(f'{row.get("Date")} {row.get("Time")}', '%Y-%m-%d %H:%M:%S').replace(tzinfo=ZoneInfo('Europe/Warsaw')).timestamp()
    except (TypeError, ValueError):
        pass
    return {'last': (close, as_of)}


def _iso_ts(day):
    try:
        d = dt.date.fromisoformat(day)
    except (TypeError, ValueError):
        return None
    return dt.datetime(d.year, d.month, d.day, 16, tzinfo=NY).timestamp()


def parse_sec_facts(facts):
    """alts.fund_facts result -> {'nav': (value, period end)} from the latest NetAssetValuePerShare."""
    nav = (facts or {}).get('navPerShare') or []
    if not nav or nav[-1].get('value') is None:
        return {}
    return {'nav': (float(nav[-1]['value']), _iso_ts(nav[-1]['end']))}


def parse_sec_nav(history):
    """alts.nav_series result -> {'nav': (value, date)} from the fund's latest NAV announcement, with its share class."""
    points = (history or {}).get('points') or []
    if not points:
        return {}
    return {'nav': (float(points[-1]['value']), _iso_ts(points[-1]['date'])), 'cls': history.get('cls')}


def google_exchanges(symbol, field, schwab_hint):
    """The Google Finance exchange codes to try, best guess first (at most two pages are fetched)."""
    asset, exch = (schwab_hint or {}).get('assetType', ''), ((schwab_hint or {}).get('exchange') or '').upper()
    if field == 'nav' or asset == 'MUTUAL_FUND':
        return ['MUTF']
    if 'ARCA' in exch or asset == 'ETF':
        return ['NYSEARCA', 'NASDAQ']
    if 'NASDAQ' in exch or exch in ('NAS', 'NMS'):
        return ['NASDAQ']
    if 'AMEX' in exch or 'AMERICAN' in exch:
        return ['NYSEAMERICAN']
    if 'BATS' in exch or 'CBOE' in exch:
        return ['BATS']
    if 'NYSE' in exch:
        return ['NYSE']
    return ['NASDAQ', 'NYSE']


# ---------- fetching (polite) ----------

_gates = {}


async def _paced(site, coro_fn):
    """Runs one request to `site` at a time, at least PACING[site] seconds after the previous one."""
    gate = _gates.setdefault(site, {'lock': asyncio.Lock(), 'last': 0.0})
    async with gate['lock']:
        wait = gate['last'] + PACING.get(site, 1.0) - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            return await asyncio.wait_for(coro_fn(), TIMEOUT * 2)
        finally:
            gate['last'] = time.monotonic()


async def _get(ctx, site, url, **kw):
    async def go():
        response = await ctx.http.get(url, timeout=TIMEOUT, **kw)
        if response.status_code in (401, 403, 429):
            raise EngineError(f'{SOURCE_NAMES.get(site, site)} refused the request ({response.status_code}).')
        return response
    return await _paced(site, go)


YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}'
YAHOO_SUMMARY = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}'
GOOGLE = 'https://www.google.com/finance/quote/{symbol}:{exchange}'
NASDAQ = 'https://api.nasdaq.com/api/quote/{symbol}/{part}'
STOOQ = 'https://stooq.com/q/l/'
NASDAQ_HEADERS = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}


def _yahoo(symbol):
    return symbol.replace('.', '-')


async def fetch_schwab(ctx, symbol, field, hint):
    async def go():
        return await ctx.schwab.get_quotes([symbol])
    response = await _paced('schwab', go)
    if response.status_code == 401:
        raise EngineError('Schwab login expired.')
    if response.status_code != 200:
        raise EngineError(f'Schwab returned {response.status_code}.')
    return parse_schwab(symbol, response.json()), 'https://www.schwab.com/research'


async def fetch_yahoo(ctx, symbol, field, hint):
    url = YAHOO_CHART.format(symbol=urllib.parse.quote(_yahoo(symbol)))
    params = {'range': '5d', 'interval': '1d'}
    if field == 'divYield':
        params = {'range': '2y', 'interval': '1mo', 'events': 'div'}
    response = await _get(ctx, 'yahoo', url, params=params)
    if response.status_code == 404:
        return {}, None
    response.raise_for_status()
    parsed = parse_yahoo_chart(response.json())
    if field == 'divYield':
        parsed = {'divYield': parsed['divYield']} if 'divYield' in parsed else {}
    return parsed, f'https://finance.yahoo.com/quote/{_yahoo(symbol)}'


async def _yahoo_crumb(ctx):
    async def load():
        await _get(ctx, 'yahoo', 'https://fc.yahoo.com')  # sets Yahoo's free session cookie (a 404 page is normal)
        response = await _get(ctx, 'yahoo', 'https://query2.finance.yahoo.com/v1/test/getcrumb')
        crumb = response.text.strip() if response.status_code == 200 else ''
        if not crumb or '<' in crumb or len(crumb) > 40:
            raise EngineError('Yahoo did not give a session code.')
        return crumb
    return await ctx.cached(('crosscheck', 'yahoo-crumb'), 6 * 3600, load)  # memory only: the cookie lives in ctx.http


async def fetch_yahoo_summary(ctx, symbol, field, hint):
    crumb = await _yahoo_crumb(ctx)
    url = YAHOO_SUMMARY.format(symbol=urllib.parse.quote(_yahoo(symbol)))
    response = await _get(ctx, 'yahoo', url, params={'modules': 'summaryDetail,fundProfile,defaultKeyStatistics,price', 'crumb': crumb})
    if response.status_code == 404:
        return {}, None
    response.raise_for_status()
    return parse_yahoo_summary(response.json()), f'https://finance.yahoo.com/quote/{_yahoo(symbol)}'


async def fetch_google(ctx, symbol, field, hint):
    for exchange in google_exchanges(symbol, field, hint)[:2]:
        url = GOOGLE.format(symbol=urllib.parse.quote(symbol.replace('.', '-')), exchange=exchange)
        response = await _get(ctx, 'google', url, params={'hl': 'en'})
        if response.status_code != 200:
            continue
        parsed = parse_google(response.text)
        if parsed:
            return parsed, url
    return {}, None


async def fetch_nasdaq(ctx, symbol, field, hint):
    classes = ['etf', 'stocks'] if (hint or {}).get('assetType') == 'ETF' else ['stocks', 'etf']
    for assetclass in classes:
        info = await _get(ctx, 'nasdaq', NASDAQ.format(symbol=symbol, part='info'), params={'assetclass': assetclass}, headers=NASDAQ_HEADERS)
        if info.status_code != 200:
            continue
        info_json = info.json()
        if not ((info_json.get('data') or {}).get('primaryData')):
            continue
        summary = None
        if field in ('prevClose', 'divYield'):
            s = await _get(ctx, 'nasdaq', NASDAQ.format(symbol=symbol, part='summary'), params={'assetclass': assetclass}, headers=NASDAQ_HEADERS)
            summary = s.json() if s.status_code == 200 else None
        return parse_nasdaq(info_json, summary), f'https://www.nasdaq.com/market-activity/{"etf" if assetclass == "etf" else "stocks"}/{symbol.lower()}'
    return {}, None


async def fetch_stooq(ctx, symbol, field, hint):
    response = await _get(ctx, 'stooq', STOOQ, params={'s': f'{symbol.lower().replace(".", "-")}.us', 'f': 'sd2t2ohlc', 'h': '', 'e': 'csv'})
    response.raise_for_status()
    return parse_stooq(response.text), f'https://stooq.com/q/?s={symbol.lower()}.us'


async def fetch_sec_xbrl(ctx, cik, field, hint):
    from . import alts
    facts = await alts.fund_facts(ctx, cik)
    return parse_sec_facts(facts), f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-Q'


async def fetch_sec_nav(ctx, cik, field, hint):
    from . import alts, sec
    subs = await sec.submissions(ctx, cik)
    data = await alts.nav_data(ctx, cik, sec.recent_filings(subs, limit=400))
    notes = (data or {}).get('notes') or []
    return parse_sec_nav((data or {}).get('history')), (notes[0]['url'] if notes else f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}')


ADAPTERS = {'schwab': fetch_schwab, 'yahoo': fetch_yahoo, 'yahoo_summary': fetch_yahoo_summary, 'google': fetch_google,
            'nasdaq': fetch_nasdaq, 'stooq': fetch_stooq, 'sec_xbrl': fetch_sec_xbrl, 'sec_nav': fetch_sec_nav}
SEC_SOURCES = ('sec_xbrl', 'sec_nav')


async def _one(ctx, source, key_id, field, hint):
    """One source's reading for one field: {source, value, asOf, url, ...} or {source, error}. Cached in cache.db."""
    async def load():
        parsed, url = await ADAPTERS[source](ctx, key_id, field, hint)
        value = parsed.get(field)
        reading = {'source': source, 'value': value[0] if value else None, 'asOf': value[1] if value else None, 'url': url,
                   'fetched': time.time()}
        if source == 'sec_nav' and parsed.get('cls'):
            reading['note'] = f'{parsed["cls"]} shares'
        if source == 'schwab':
            reading['hint'] = {'assetType': parsed.get('assetType', ''), 'exchange': parsed.get('exchange', '')}
        return reading
    try:
        return dict(await ctx.cached(cache_key(source, key_id, field), FIELDS[field]['ttl'], load, persist=True))
    except Exception as err:  # one site failing never hides the others
        msg = str(err) if isinstance(err, EngineError) else f'Couldn\'t reach it ({type(err).__name__})'
        return {'source': source, 'value': None, 'asOf': None, 'url': None, 'error': msg or 'No answer'}


async def gather(ctx, field, symbol=None, cik=None, now=None):
    """Asks every source that can give `field` (Schwab first, for the asset type and exchange) and scores the answers."""
    spec = FIELDS[field]
    sources = [s for s in spec['sources'] if (s in SEC_SOURCES and cik) or (s not in SEC_SOURCES and symbol)]
    if not sources:
        raise EngineError('Give a ticker (or, for a fund\'s NAV, its SEC CIK) to check.')
    readings, hint = [], {}
    if 'schwab' in sources:
        first = await _one(ctx, 'schwab', symbol, field, {})
        hint = first.pop('hint', None) or {}
        readings.append(first)
    rest = [s for s in sources if s != 'schwab']
    readings += await asyncio.gather(*(_one(ctx, s, cik if s in SEC_SOURCES else symbol, field, hint) for s in rest))
    for r in readings:
        r.pop('hint', None)
    result = score(field, readings, now)
    for r in readings:
        r['name'] = SOURCE_NAMES.get(r['source'], r['source'])
        r['kind'] = KINDS.get(r['source'], '')
    readings.sort(key=lambda r: (r.get('value') is None, -(r.get('weight') or 0)))
    return {'field': field, 'label': spec['label'], 'unit': spec['unit'], 'symbol': symbol, 'cik': cik,
            'tolerance': spec['tolerance'], **result, 'sources': readings, 'rubric': RUBRIC, 'checkedAt': time.time()}


@handler('crosscheck.value')
async def value(ctx, msg):
    """{field, symbol?, cik?} -> every source's value with its time and link, the best estimate and a confidence score."""
    field = str(msg.get('field') or '')
    if field not in FIELDS:
        raise EngineError(f'Unknown field "{field}". Choose one of: {", ".join(FIELDS)}.')
    symbol = str(msg.get('symbol') or '').strip().upper() or None
    if symbol and not SYMBOL.match(symbol):
        raise EngineError(f'"{symbol}" doesn\'t look like a ticker.')
    cik = msg.get('cik')
    try:
        cik = int(cik) if cik else None
    except (TypeError, ValueError):
        cik = None
    return await gather(ctx, field, symbol, cik)
