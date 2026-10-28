"""
Cross-checks one value (a fund's NAV, a last price, the previous close, a dividend yield or an expense ratio) against
several free public sources, shows every value found with its source, time and link, and scores how far it can be
trusted. Nothing here is invented or averaged: a source that has no value says so, and the best estimate is always a
value one source actually reported.

Sources (one adapter each; free endpoints only, no logins, no paid APIs):
  schwab         Schwab quotes (the owner's market-data app; one request at a time, 0.7 s apart)
  sec_xbrl       SEC EDGAR structured data: NetAssetValuePerShare from 10-K/10-Q (funds, needs the CIK)
  sec_nav        SEC EDGAR filings: the fund's own monthly NAV announcements (alts.nav_data), with the share class
  nasdaq         Nasdaq.com's public quote API (info + summary)
  yahoo          Yahoo Finance chart data (last price, previous close; trailing dividends for a yield)
  yahoo_summary  Yahoo Finance quoteSummary (yield, net expense ratio; needs Yahoo's free cookie + crumb)
Left out on purpose: the Google Finance page (scraping fragile CSS class names, never a NAV, and no value Schwab,
Nasdaq and Yahoo don't already give) and Stooq (last price only, often end-of-day, and its CSV may need a key).
There is no free official source for an expense ratio that is cheap to read (the SEC's risk/return XBRL sits inside
each fund's full 485BPOS filing, per series and class), so expense ratios are labelled "aggregator only".

Each site is asked politely: one request at a time per site with a pause between requests, short timeouts, and every
answer cached per source + symbol + field in cache.db (FIELDS[f]['ttl']). A failure is remembered for FAIL_TTL seconds
(Yahoo's session code too), so a site that is down isn't asked again on every click. The browser only asks when the
owner opens a fund page that publishes NAVs or clicks "Sources" (never on hover, never in the background).

Like with like: each reading carries a basis where the definition can differ: a dividend yield is 'forward' (latest
dividend x payments a year) or 'trailing' (last 12 months paid); an expense ratio 'net' or 'gross'; a NAV the share class
('Class I'). Only readings on the main basis (the one with the most weight) are compared; the others are listed as
"different definition, not compared". A reading with no basis joins the main one.

Confidence rubric (score 0-97%):
  1. Reliability per source (RELIABILITY): official filings 0.95 (SEC), exchange-sourced broker data 0.90 (Schwab),
     the exchange's own site 0.80 (Nasdaq), aggregators 0.70/0.65 (Yahoo chart/summary).
  2. Freshness: 1.0 while the value is younger than the field's normal update cadence (FIELDS[f]['cadence'], e.g. 15
     minutes for a live price, 35 days for a monthly fund NAV); after that it halves every further cadence (floor 0.1).
     A price from the last session's close counts as fresh while the market is closed. Unknown time: 0.4.
  3. Each source's weight w = reliability x freshness.
  4. Independence: sources from one family (FAMILY: both SEC readings; both Yahoo endpoints) count as one
     confirmation, with the family's strongest member.
  5. Agreement: values within the field's tolerance (FIELDS[f]['tolerance'], relative) of each other form a group; the
     group with the most weight agrees. A fresh official filing (freshness >= 0.5) is never the outlier when only market
     data sites disagree with it: its group is used and the page says the sites differ from the filing.
     Agreeing families combine like independent confirmations, 1 - product(1 - 0.8 w), times the agreeing families'
     share of all the families' weight, so a source that disagrees pulls the score down.
  6. One independent source (family) only: capped at 60% (SINGLE_CAP). Never above 97% (MAX_SCORE).
  Best estimate: the value of the agreeing source with the highest weight, the newer one on a tie (a reported value,
  never an average).
  Labels: 80%+ High, 55%+ Medium, below that Low. Tone: ok when all compared sources agree, amber when some differ but
  the agreeing group holds 60%+ of the weight (or the filing is preferred), red when it doesn't.
"""
import asyncio
import datetime as dt
import math
import re
import time
import urllib.parse
from zoneinfo import ZoneInfo

from .core import NYSE_EARLY_CLOSES, NYSE_HOLIDAYS, EngineError, handler, market_session

NY = ZoneInfo('America/New_York')
SYMBOL = re.compile(r'^[A-Z0-9.\-]{1,12}$')

RELIABILITY = {'sec_xbrl': 0.95, 'sec_nav': 0.95, 'schwab': 0.90, 'nasdaq': 0.80, 'yahoo': 0.70, 'yahoo_summary': 0.65}
SOURCE_NAMES = {'sec_xbrl': 'SEC (10-K/10-Q data)', 'sec_nav': 'SEC (fund NAV filing)', 'schwab': 'Schwab', 'nasdaq': 'Nasdaq.com',
                'yahoo': 'Yahoo Finance', 'yahoo_summary': 'Yahoo Finance (summary)'}
KINDS = {'sec_xbrl': 'official filing', 'sec_nav': 'official filing', 'schwab': 'broker (exchange data)', 'nasdaq': 'exchange website',
         'yahoo': 'aggregator', 'yahoo_summary': 'aggregator'}
#: sources that are not independent of each other count once
FAMILY = {'sec_xbrl': 'sec', 'sec_nav': 'sec', 'yahoo': 'yahoo', 'yahoo_summary': 'yahoo'}
OFFICIAL = {'sec_xbrl', 'sec_nav'}
BASIS_LABELS = {'forward': 'forward (latest dividend x payments a year)', 'trailing': 'trailing 12 months',
                'net': 'net (after fee waivers)', 'gross': 'gross (before waivers)'}

DAY = 86400
#: cadence = how often the value normally changes (freshness), tolerance = relative spread still counted as agreeing,
#: ttl = how long one source's answer is cached, sources = which adapters can give it.
FIELDS = {
    'last': {'label': 'Last price', 'unit': 'usd', 'cadence': 15 * 60, 'tolerance': 0.005, 'ttl': 60,
             'sources': ('schwab', 'nasdaq', 'yahoo')},
    'prevClose': {'label': 'Previous close', 'unit': 'usd', 'cadence': 4 * DAY, 'tolerance': 0.002, 'ttl': 3600,
                  'sources': ('schwab', 'nasdaq', 'yahoo')},
    'nav': {'label': 'NAV per share', 'unit': 'usd', 'cadence': 35 * DAY, 'tolerance': 0.01, 'ttl': 6 * 3600,
            'sources': ('sec_nav', 'sec_xbrl', 'schwab', 'yahoo')},
    'divYield': {'label': 'Dividend yield', 'unit': 'pct', 'cadence': 7 * DAY, 'tolerance': 0.10, 'ttl': 12 * 3600,
                 'sources': ('schwab', 'nasdaq', 'yahoo_summary', 'yahoo')},
    'expenseRatio': {'label': 'Expense ratio', 'unit': 'pct', 'cadence': 400 * DAY, 'tolerance': 0.05, 'ttl': 7 * DAY,
                     'sources': ('yahoo_summary',)},
}
SCALE = 0.8
SINGLE_CAP = 0.60
MAX_SCORE = 0.97
AMBER_SHARE = 0.60
UNKNOWN_FRESHNESS = 0.4
FAIL_TTL = 600
#: seconds between two requests to the same site
PACING = {'schwab': 0.7, 'yahoo': 1.0, 'nasdaq': 1.0}
TIMEOUT = 8

RUBRIC = [
    'Each source has a reliability: official filings and broker data high, the exchange site next, aggregators lower.',
    'Freshness: full marks while a value is younger than how often it normally changes, then it halves for each extra period.',
    'Sources that agree add up like independent confirmations (both SEC readings, or both Yahoo ones, count once); sources that disagree lower the score.',
    'A recent fund filing wins over market-data sites that disagree with it. Only values with the same definition are compared.',
    'With only one independent source the score is capped at 60%. It never goes above 97%.',
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
    if field == 'last' and market_session(now.astimezone(NY)) != 'open':
        return max(0.0, last_regular_close(now) - 60 - as_of)
    return max(0.0, now.timestamp() - as_of)


def freshness(age, cadence):
    if age is None:
        return UNKNOWN_FRESHNESS
    if age <= cadence:
        return 1.0
    return max(0.1, 0.5 ** ((age - cadence) / cadence))


def family(reading):
    return FAMILY.get(reading['source'], reading['source'])


def family_weights(readings):
    """{family: weight of its strongest member}: one family = one confirmation."""
    out = {}
    for r in readings:
        out[family(r)] = max(out.get(family(r), 0.0), r['weight'])
    return out


def main_basis(readings):
    """The definition most of the weight uses (None when no reading states one)."""
    weights = {}
    for r in readings:
        if r.get('basis'):
            weights[r['basis']] = weights.get(r['basis'], 0.0) + r['weight']
    return max(sorted(weights), key=lambda b: weights[b]) if weights else None


def agreeing_group(readings, tolerance):
    """The indices of the readings that agree with each other and carry the most family weight (ties: more sources)."""
    best, best_key = [], (-1.0, 0)
    for r in readings:
        group = [i for i, x in enumerate(readings) if rel_diff(x['value'], r['value']) <= tolerance]
        key = (round(sum(family_weights([readings[i] for i in group]).values()), 9), len(group))
        if key > best_key:
            best, best_key = group, key
    return best


def _names(rs):
    return ', '.join(SOURCE_NAMES.get(r['source'], r['source']) for r in rs)


def score(field, readings, now=None):
    """Scores readings [{source, value, asOf, basis?}] for `field`. Adds reliability, freshness, weight, compared and
    agrees to each reading and returns {best, bestSource, basis, score, level, tone, status, message, agreeing, spread}.
    Pure: no network."""
    spec = FIELDS[field]
    tol = spec['tolerance']
    now = now or dt.datetime.now(dt.timezone.utc)
    values = [r for r in readings if r.get('value') is not None and math.isfinite(r['value'])]
    for r in values:
        r['reliability'] = RELIABILITY.get(r['source'], 0.5)
        r['freshness'] = round(freshness(effective_age(field, r.get('asOf'), now), spec['cadence']), 3)
        r['weight'] = round(r['reliability'] * r['freshness'], 4)
    if not values:
        return {'best': None, 'bestSource': None, 'basis': None, 'score': 0.0, 'level': 'None', 'tone': 'red', 'status': 'none',
                'agreeing': 0, 'spread': None, 'message': f'No source had a {spec["label"].lower()} for this. Nothing is shown rather than a guess.'}
    basis = main_basis(values)
    compared = [r for r in values if not r.get('basis') or basis is None or r['basis'] == basis]
    for r in values:
        r['compared'] = any(r is c for c in compared)
    group = agreeing_group(compared, tol)
    prefer_filing = False
    official = [r for r in compared if r['source'] in OFFICIAL and r['freshness'] >= 0.5]
    if official:
        anchor = max(official, key=lambda r: r['weight'])
        filing_group = [i for i, x in enumerate(compared) if rel_diff(x['value'], anchor['value']) <= tol]
        if all(any(compared[i] is o for i in filing_group) for o in official):  # the filings agree with each other
            prefer_filing = sorted(filing_group) != sorted(group)
            group = filing_group
    for i, r in enumerate(compared):
        r['agrees'] = i in group
    agreeing = [compared[i] for i in group]
    top = max(agreeing, key=lambda r: (r['weight'], r['reliability'], r.get('asOf') or 0, r['source']))  # ties: the newer one
    fam_all, fam_agree = family_weights(compared), family_weights(agreeing)
    combined = 1 - math.prod(1 - SCALE * w for w in fam_agree.values())
    total = sum(fam_all.values())
    share = sum(fam_agree.values()) / total if total else 0
    s = combined * share
    if len(fam_all) == 1:
        s = min(s, SINGLE_CAP)
    s = round(min(s, MAX_SCORE), 3)
    spread = max(rel_diff(r['value'], top['value']) for r in compared)
    outliers = [r for r in compared if not r['agrees']]
    worst = max((rel_diff(r['value'], top['value']) for r in outliers), default=0.0)
    if len(fam_all) == 1:
        status, tone = 'single', 'amber'
        same = '; readings from the same place count once' if len(compared) > 1 else ''
        message = f'Only one independent source had this value ({_names(compared)}{same}), so confidence is capped at {SINGLE_CAP:.0%}.'
    elif not outliers:
        status, tone = 'agree', 'ok'
        n = len(fam_all)
        message = f'{"Both" if n == 2 else f"All {n}"} independent sources agree (within {tol:.1%} of each other).'
    elif prefer_filing:
        status, tone = 'differ', 'amber'
        message = (f'{_names(outliers)} {"differs" if len(outliers) == 1 else "differ"} from the fund\'s filing (by up to {worst:.1%}). '
                   'The filing is the official figure, so its value is used.')
    elif share >= AMBER_SHARE:
        status, tone = 'differ', 'amber'
        message = (f'{_names(outliers)} {"differs" if len(outliers) == 1 else "differ"} from the others (by up to '
                   f'{worst:.1%}), so {"it was" if len(outliers) == 1 else "they were"} left out of the best estimate.')
    else:
        status, tone = 'conflict', 'red'
        message = (f'The sources disagree (by up to {spread:.1%}, more than the {tol:.1%} expected). '
                   'Check the official source (the fund\'s or company\'s own site or filing) before relying on this number.')
    skipped = [r for r in values if not r['compared']]
    if skipped:
        message += f' {_names(skipped)} use{"s" if len(skipped) == 1 else ""} a different definition, so {"it is" if len(skipped) == 1 else "they are"} listed but not compared.'
    if field == 'expenseRatio':
        message += ' No official free source is read for this (aggregator only); the fund\'s prospectus has the exact figure.'
    level = 'High' if s >= 0.8 else 'Medium' if s >= 0.55 else 'Low'
    return {'best': top['value'], 'bestSource': top['source'], 'basis': basis, 'score': s, 'level': level, 'tone': tone,
            'status': status, 'message': message, 'agreeing': len(fam_agree), 'spread': round(spread, 6)}


def cache_key(source, symbol, field):
    """The cache.db key for one source's answer for one symbol and field (fund CIKs as their number)."""
    return ('crosscheck', source, str(symbol).upper(), field)


# ---------- parsers (pure; tested on saved fixtures) ----------

def _num(text):
    """'$1,234.50' / '0.44%' -> float (percent stays a plain number), None for 'N/A', '--' and the like."""
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


def share_class(text):
    """'CLIFFWATER CORPORATE LENDING FUND CLASS I' / 'Class I' -> 'Class I'; None when no class is named."""
    m = re.search(r'\bCLASS\s+([A-Z0-9]{1,3})\b', str(text or ''), re.I)
    return f'Class {m.group(1).upper()}' if m else None


def parse_schwab(symbol, data):
    """Schwab get_quotes JSON -> {field: (value, asOf[, basis])} plus 'assetType', 'exchange' and 'cls' hints."""
    item = (data or {}).get(symbol) or {}
    q, f, ref = item.get('quote') or {}, item.get('fundamental') or {}, item.get('reference') or {}
    asset = item.get('assetMainType') or item.get('assetType') or ''
    t = q.get('quoteTime') or q.get('tradeTime')
    as_of = t / 1000 if isinstance(t, (int, float)) and t > 1e11 else t if isinstance(t, (int, float)) else None
    cls = share_class(ref.get('description'))
    out = {'assetType': asset, 'exchange': ref.get('exchangeName') or '', 'cls': cls}
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
        out['nav'] = (nav, as_of, cls)
    y = _num(f.get('divYield'))
    if y is not None:
        # Schwab's yield is its indicated annual dividend (divAmount) over the price: a forward yield. Sent as percent.
        out['divYield'] = (y / 100, as_of, 'forward')
    return out


def parse_yahoo_chart(data, cls=None):
    """Yahoo /v8/finance/chart JSON -> {field: (value, asOf[, basis])} plus 'instrumentType'.
    `cls`: the share class of this symbol (from Schwab), for the NAV of a mutual fund."""
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
            out['nav'] = (last, as_of, cls)
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
            out['divYield'] = (sum(float(d['amount']) for d in year) / last, as_of, 'trailing')
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
    forward, trailing = raw(sd, 'dividendYield'), raw(sd, 'yield') or raw(sd, 'trailingAnnualDividendYield')
    if forward is not None:
        out['divYield'] = (forward, as_of, 'forward')  # stocks: forward annual dividend / price
    elif trailing is not None:
        out['divYield'] = (trailing, as_of, 'trailing')  # funds: last 12 months of distributions / price
    er = raw(fp.get('feesExpensesInvestment'), 'annualReportExpenseRatio') or raw(ks, 'annualReportExpenseRatio')
    if er is not None:
        out['expenseRatio'] = (er, None, 'net')  # the annual report's net expense ratio; Yahoo gives no date
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
    """Nasdaq.com /api/quote/{SYM}/info and /summary JSON -> {field: (value, asOf[, basis])}."""
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
        out['divYield'] = (y, as_of, 'forward')  # "Current Yield" = annualized dividend / price
    return out


def _iso_ts(day):
    try:
        d = dt.date.fromisoformat(day)
    except (TypeError, ValueError):
        return None
    return dt.datetime(d.year, d.month, d.day, 16, tzinfo=NY).timestamp()


def parse_sec_facts(facts):
    """alts.fund_facts result -> {'nav': (value, period end)} from the latest NetAssetValuePerShare (class not stated)."""
    nav = (facts or {}).get('navPerShare') or []
    if not nav or nav[-1].get('value') is None:
        return {}
    return {'nav': (float(nav[-1]['value']), _iso_ts(nav[-1]['end']))}


def parse_sec_nav(history, cls=None):
    """alts.nav_series result -> {'nav': (value, date, class)} from the fund's latest NAV announcement. With `cls` (the
    class of a listed symbol) that class's latest value is used when the announcement lists it."""
    points = (history or {}).get('points') or []
    if not points:
        return {}
    pick = (history.get('cls'), points[-1]['value'], points[-1]['date'])
    if cls:
        same = [c for c in history.get('latestByClass') or [] if share_class(c.get('cls')) == cls]
        if same:
            pick = (same[0]['cls'], same[0]['value'], same[0]['date'])
    return {'nav': (float(pick[1]), _iso_ts(pick[2]), share_class(pick[0]))}


# ---------- fetching (polite) ----------

_gates = {}
#: cache key -> (time, message) of a recent failure, so a site that is down isn't asked again for FAIL_TTL seconds
_failures = {}


def _failed_recently(key):
    hit = _failures.get(key)
    if hit and time.time() - hit[0] < FAIL_TTL:
        return hit[1]
    _failures.pop(key, None)
    return None


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
NASDAQ = 'https://api.nasdaq.com/api/quote/{symbol}/{part}'
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
    parsed = parse_yahoo_chart(response.json(), (hint or {}).get('cls'))
    if field == 'divYield':
        parsed = {'divYield': parsed['divYield']} if 'divYield' in parsed else {}
    return parsed, f'https://finance.yahoo.com/quote/{_yahoo(symbol)}'


CRUMB_KEY = ('crosscheck', 'yahoo-crumb')


async def _yahoo_crumb(ctx):
    failed = _failed_recently(CRUMB_KEY)
    if failed:
        raise EngineError(failed)

    async def load():
        await _get(ctx, 'yahoo', 'https://fc.yahoo.com')  # sets Yahoo's free session cookie (a 404 page is normal)
        response = await _get(ctx, 'yahoo', 'https://query2.finance.yahoo.com/v1/test/getcrumb')
        crumb = response.text.strip() if response.status_code == 200 else ''
        if not crumb or '<' in crumb or len(crumb) > 40:
            raise EngineError('Yahoo did not give a session code.')
        return crumb
    try:
        return await ctx.cached(CRUMB_KEY, 6 * 3600, load)  # memory only: the cookie lives in ctx.http
    except Exception as err:
        msg = str(err) if isinstance(err, EngineError) else f'Couldn\'t reach Yahoo ({type(err).__name__})'
        _failures[CRUMB_KEY] = (time.time(), msg)
        raise EngineError(msg) from err


async def fetch_yahoo_summary(ctx, symbol, field, hint):
    crumb = await _yahoo_crumb(ctx)
    url = YAHOO_SUMMARY.format(symbol=urllib.parse.quote(_yahoo(symbol)))
    response = await _get(ctx, 'yahoo', url, params={'modules': 'summaryDetail,fundProfile,defaultKeyStatistics,price', 'crumb': crumb})
    if response.status_code == 404:
        return {}, None
    response.raise_for_status()
    return parse_yahoo_summary(response.json()), f'https://finance.yahoo.com/quote/{_yahoo(symbol)}'


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


async def fetch_sec_xbrl(ctx, cik, field, hint):
    from . import alts
    facts = await alts.fund_facts(ctx, cik)
    return parse_sec_facts(facts), f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-Q'


async def fetch_sec_nav(ctx, cik, field, hint):
    from . import alts, sec
    cik = int(str(cik).split(':')[0])  # 'cik:Class I' when a listed class is asked for
    subs = await sec.submissions(ctx, cik)
    data = await alts.nav_data(ctx, cik, sec.recent_filings(subs, limit=400))
    notes = (data or {}).get('notes') or []
    return parse_sec_nav((data or {}).get('history'), (hint or {}).get('cls')), (notes[0]['url'] if notes else f'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}')


ADAPTERS = {'schwab': fetch_schwab, 'yahoo': fetch_yahoo, 'yahoo_summary': fetch_yahoo_summary, 'nasdaq': fetch_nasdaq,
            'sec_xbrl': fetch_sec_xbrl, 'sec_nav': fetch_sec_nav}
SEC_SOURCES = ('sec_xbrl', 'sec_nav')


async def _one(ctx, source, key_id, field, hint):
    """One source's reading for one field: {source, value, asOf, basis, url, ...} or {source, error}. Answers are cached
    in cache.db for the field's ttl; failures are remembered for FAIL_TTL seconds."""
    key = cache_key(source, key_id, field)
    failed = _failed_recently(key)
    if failed:
        return {'source': source, 'value': None, 'asOf': None, 'url': None, 'error': failed}

    async def load():
        parsed, url = await ADAPTERS[source](ctx, key_id, field, hint)
        value = parsed.get(field)
        reading = {'source': source, 'value': value[0] if value else None, 'asOf': value[1] if value else None,
                   'basis': value[2] if value and len(value) > 2 else None, 'url': url, 'fetched': time.time()}
        if source == 'schwab':
            reading['hint'] = {'assetType': parsed.get('assetType', ''), 'exchange': parsed.get('exchange', ''), 'cls': parsed.get('cls')}
        return reading
    try:
        return dict(await ctx.cached(key, FIELDS[field]['ttl'], load, persist=True))
    except Exception as err:  # one site failing never hides the others
        msg = (str(err) if isinstance(err, EngineError) else f'Couldn\'t reach it ({type(err).__name__})') or 'No answer'
        _failures[key] = (time.time(), msg)
        return {'source': source, 'value': None, 'asOf': None, 'url': None, 'error': msg}


def basis_label(basis):
    return BASIS_LABELS.get(basis) or (f'{basis} shares' if basis and basis.startswith('Class') else basis)


async def gather(ctx, field, symbol=None, cik=None, now=None):
    """Asks every source that can give `field` (Schwab first, for the asset type and share class) and scores the answers."""
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
    # The SEC NAV filing lists every class: the listed symbol's class is a separate cache entry.
    readings += await asyncio.gather(*(_one(ctx, s, (f'{cik}:{hint["cls"]}' if s == 'sec_nav' and hint.get('cls') else cik) if s in SEC_SOURCES else symbol,
                                            field, hint) for s in rest))
    readings = [dict(r) for r in readings]
    for r in readings:
        r.pop('hint', None)
    result = score(field, readings, now)
    for r in readings:
        r['name'] = SOURCE_NAMES.get(r['source'], r['source'])
        r['kind'] = KINDS.get(r['source'], '')
        r['basisLabel'] = basis_label(r.get('basis'))
    readings.sort(key=lambda r: (r.get('value') is None, not r.get('compared', True), -(r.get('weight') or 0)))
    return {'field': field, 'label': spec['label'], 'unit': spec['unit'], 'symbol': symbol, 'cik': cik, 'tolerance': spec['tolerance'],
            **result, 'basisLabel': basis_label(result['basis']), 'sources': readings, 'rubric': RUBRIC, 'checkedAt': time.time()}


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
