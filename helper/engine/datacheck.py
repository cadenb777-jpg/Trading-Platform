"""
Aggregation checks: free cross-source checks the single-source pages can't do on their own, plus the data hub's
health table. Requests (all read-only, gated in the browser by DATAHUB_HELPER_VERSION):

  data.health        every source's state (last success, age, failures, rate-limit pause, cache hit rate) + notes
  data.identifiers   one symbol across sources: canonical/Schwab/SEC/Yahoo/Alpaca spellings, SEC CIK and company
                     name, the company's other share classes (same CIK), and the CUSIP from Schwab's instrument data
  data.dividends     Yahoo's dividends (what total return uses) against the company's own 10-K figure (SEC XBRL
                     CommonStockDividendsPerShareCashPaid, else ...Declared), per fiscal year, both split-adjusted
  data.splits        Yahoo's split list against Schwab's daily closes: Schwab's history must already be adjusted
                     (no jump of the split ratio across the split date)

Each figure comes with its source and as-of (datahub.envelope). Nothing is averaged or invented: a check without
data from both sides says "not comparable" and why.
"""
import asyncio
import datetime as dt

from . import datahub, sec, symbols
from .core import EngineError, handler

#: relative difference still counted as agreeing (dividends: rounding in filings, a special dividend split across years)
DIVIDEND_TOLERANCE = 0.03
#: a close-to-close move across a split date this close to the split ratio means the history is NOT adjusted
SPLIT_JUMP_TOLERANCE = 0.15
DIVIDEND_TAGS = ('CommonStockDividendsPerShareCashPaid', 'CommonStockDividendsPerShareDeclared')


# ---------- pure ----------

def annual_dividends(company_facts):
    """{fiscal-year end 'YYYY-MM-DD': {'start', 'end', 'value', 'tag', 'filed'}} from a company-facts JSON (latest filing
    of each year wins; only ~1-year durations in USD per share)."""
    gaap = (company_facts or {}).get('facts', {}).get('us-gaap', {})
    for tag in DIVIDEND_TAGS:
        entries = (gaap.get(tag) or {}).get('units', {}).get('USD/shares') or []
        out = {}
        for e in sorted(entries, key=lambda e: e.get('filed', '')):
            start, end, val = e.get('start'), e.get('end'), e.get('val')
            if not start or not end or val is None:
                continue
            try:
                days = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days
            except ValueError:
                continue
            if 330 <= days <= 400:
                out[end] = {'start': start, 'end': end, 'value': float(val), 'tag': tag, 'filed': e.get('filed', '')}
        if out:
            return out
    return {}


def split_factor_after(day, splits):
    """Product of split ratios after `day` (to put a then-reported per-share figure on today's basis)."""
    f = 1.0
    for d, ratio in (splits or {}).items():
        if d > day and ratio:
            f *= ratio
    return f


def compare_dividends(sec_years, yahoo_divs, splits, years=5):
    """Rows per fiscal year (newest first): SEC value (split-adjusted to today), Yahoo's sum of ex-dates in that year,
    difference and status 'agree' / 'differ' / 'not comparable'."""
    rows = []
    for end in sorted(sec_years, reverse=True)[:years]:
        y = sec_years[end]
        start_d, end_d = dt.date.fromisoformat(y['start']), dt.date.fromisoformat(y['end'])
        # A filing reports per-share figures on the basis of its filing date (a 10-K filed after a split restates the
        # year), so only splits after the filing date are applied, never twice.
        basis = dt.date.fromisoformat(y['filed']) if y.get('filed') else end_d
        sec_adj = y['value'] / split_factor_after(basis, splits)
        if yahoo_divs is None:
            rows.append({'fiscalYearEnd': end, 'sec': round(sec_adj, 4), 'yahoo': None, 'status': 'not comparable',
                         'why': 'Yahoo had no dividend data', 'tag': y['tag'], 'filed': y['filed']})
            continue
        paid = [v for d, v in yahoo_divs.items() if start_d <= d <= end_d]
        total = sum(paid)
        if yahoo_divs and min(yahoo_divs) > end_d:
            rows.append({'fiscalYearEnd': end, 'sec': round(sec_adj, 4), 'yahoo': None, 'status': 'not comparable',
                         'why': 'Yahoo\'s history starts later', 'tag': y['tag'], 'filed': y['filed']})
            continue
        big = max(abs(sec_adj), abs(total))
        diff = 0.0 if big == 0 else abs(sec_adj - total) / big
        rows.append({'fiscalYearEnd': end, 'sec': round(sec_adj, 4), 'yahoo': round(total, 4), 'payments': len(paid),
                     'difference': round(diff, 4), 'status': 'agree' if diff <= DIVIDEND_TOLERANCE else 'differ',
                     'why': '' if diff <= DIVIDEND_TOLERANCE else (
                         'declared vs paid timing can move one payment across the year end' if y['tag'].endswith('Declared')
                         else 'amounts differ'),
                     'tag': y['tag'], 'filed': y['filed']})
    return rows


def check_splits(bars, splits):
    """For each split inside the bars: the close-to-close move across it and whether the history is adjusted.

    Adjusted history moves like any other day; unadjusted history jumps by about 1/ratio (a 4-for-1 split: -75%)."""
    rows = []
    if not bars:
        return rows
    by_day = [(datahub.ny_date(b['time']), b['close']) for b in bars if b.get('close')]
    for day, ratio in sorted((splits or {}).items()):
        before = [c for d, c in by_day if d < day]
        after = [c for d, c in by_day if d >= day]
        if not before or not after or not ratio or ratio == 1:
            continue
        move = after[0] / before[-1]
        unadjusted = abs(move * ratio - 1) <= SPLIT_JUMP_TOLERANCE and abs(move - 1) > SPLIT_JUMP_TOLERANCE
        rows.append({'date': day.isoformat(), 'ratio': ratio, 'move': round(move - 1, 4),
                     'status': 'not adjusted' if unadjusted else 'adjusted'})
    return rows


# ---------- handlers ----------

@handler('data.health')
async def health(ctx, msg):
    return datahub.snapshot()


async def _cusip(ctx, symbol):
    """The CUSIP Schwab lists for the symbol (cached 30 days), or None."""
    client = getattr(ctx, 'schwab', None)
    if client is None:
        return None

    async def load():
        projection = datahub.raw(client).Instrument.Projection.SYMBOL_SEARCH
        response = await client.get_instruments([symbol], projection)
        if response.status_code != 200:
            raise EngineError(f'Schwab returned {response.status_code}')
        for item in (response.json() or {}).get('instruments', []):
            if symbols.normalize(item.get('symbol')) == symbol:
                return {'cusip': item.get('cusip') or None, 'name': item.get('description') or '',
                        'exchange': item.get('exchange') or '', 'assetType': item.get('assetType') or ''}
        return {'cusip': None}
    try:
        return await ctx.cached(('schwab-instrument', symbol), 30 * 86400, load, persist=True, stale_ok=True)
    except Exception:
        return None


@handler('data.identifiers')
async def identifiers(ctx, msg):
    symbol = symbols.normalize(msg.get('symbol'))
    if not symbol:
        raise EngineError('No symbol given')
    out = {'symbol': symbol, 'kind': symbols.kind(symbol),
           'spellings': {s: symbols.to_source(symbol, s) for s in ('schwab', 'sec', 'yahoo', 'alpaca', 'coinbase')}}
    sec_part, cusip = await asyncio.gather(_sec_identity(ctx, symbol), _cusip(ctx, symbol), return_exceptions=True)
    out['sec'] = sec_part if isinstance(sec_part, dict) else {'error': str(sec_part)}
    out['schwab'] = cusip if isinstance(cusip, dict) else None
    out['cusip'] = (cusip or {}).get('cusip') if isinstance(cusip, dict) else None
    return out


async def _sec_identity(ctx, symbol):
    if symbols.kind(symbol) != 'stock':
        return {'error': 'Only stocks and funds have SEC filings.'}
    try:
        info = await sec.company(ctx, symbol)
    except sec.NotListed as err:
        return {'error': str(err)}
    every = await sec.tickers(ctx)
    classes = sorted(symbols.normalize(t) for t, v in every.items() if v['cik'] == info['cik'])
    return {'cik': info['cik'], 'name': info['name'], 'tickers': classes}


@handler('data.dividends')
async def dividends(ctx, msg):
    symbol = symbols.normalize(msg.get('symbol'))
    if symbols.kind(symbol) != 'stock':
        raise EngineError('Dividend checks are for stocks.')
    info = await sec.company(ctx, symbol)

    async def load():
        facts = await sec._json(ctx, sec.FACTS_URL.format(cik=info['cik']))
        return annual_dividends(facts)  # only the small part is kept (company facts files are large)
    sec_years, divs, splits = await asyncio.gather(
        ctx.cached(('sec-divfacts', info['cik']), 86400, load, persist=True, stale_ok=True),
        ctx.dividends(symbol), ctx.splits(symbol))
    rows = compare_dividends(sec_years, divs, splits or {})
    agree = sum(r['status'] == 'agree' for r in rows)
    compared = sum(r['status'] != 'not comparable' for r in rows)
    return {'symbol': symbol, 'company': info['name'], 'rows': rows,
            'summary': {'compared': compared, 'agree': agree,
                        'status': 'no SEC figure' if not rows else 'agree' if compared and agree == compared else
                        'not comparable' if not compared else 'differ'},
            'sources': [datahub.envelope('10-K XBRL', 'sec'), datahub.envelope('chart dividends', 'yahoo')]}


@handler('data.splits')
async def splits_check(ctx, msg):
    symbol = symbols.normalize(msg.get('symbol'))
    if symbols.kind(symbol) != 'stock':
        raise EngineError('Split checks are for stocks.')
    bars, splits = await asyncio.gather(ctx.daily_bars(symbol, 20), ctx.splits(symbol))
    if splits is None:
        return {'symbol': symbol, 'rows': [], 'status': 'not comparable', 'why': 'Yahoo had no split data'}
    rows = check_splits(bars, splits)
    bad = [r for r in rows if r['status'] == 'not adjusted']
    if bad:
        datahub.note('schwab', f'{symbol}: daily history not adjusted for the {bad[-1]["date"]} split')
    return {'symbol': symbol, 'rows': rows, 'status': 'not adjusted' if bad else 'adjusted' if rows else 'no splits'}


def _register_diagnostics():
    from . import diagnostics
    diagnostics.SECTIONS['dataSources'] = datahub.snapshot  # the Sources table goes into the diagnostics file too


_register_diagnostics()
