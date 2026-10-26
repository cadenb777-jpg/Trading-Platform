"""
Account risk and sectors (Account page): how concentrated the owner's money is, how much it swings (1-year
volatility, beta vs SPY, 1-day 95% value-at-risk, max drawdown) from the daily closes invest.board already keeps,
and each stock's sector from its SEC SIC code. Cash counts as zero risk. Pure maths is kept separate and tested.
"""
import asyncio
import datetime as dt
import re

import numpy as np

from . import invest, quant, sec
from .core import EngineError, handler

SECTOR_DAYS = 30
STALE_SESSIONS = 5
#: SIC code ranges -> 11 GICS-like sectors. The first matching row wins, so the narrow rows come first.
#: SIC codes: https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list
SIC_SECTORS = [
    (2830, 2836, 'Health Care'), (3840, 3851, 'Health Care'), (5122, 5122, 'Health Care'), (8000, 8099, 'Health Care'), (8731, 8731, 'Health Care'),
    (2840, 2844, 'Consumer Staples'), (5400, 5499, 'Consumer Staples'), (5912, 5912, 'Consumer Staples'), (5140, 5149, 'Consumer Staples'),
    (1200, 1399, 'Energy'), (2900, 2999, 'Energy'), (4920, 4925, 'Energy'),
    (3570, 3579, 'Information Technology'), (3660, 3679, 'Information Technology'), (3820, 3829, 'Information Technology'),
    (3860, 3879, 'Information Technology'), (7370, 7379, 'Information Technology'),
    (3630, 3659, 'Consumer Discretionary'), (3710, 3716, 'Consumer Discretionary'), (3750, 3751, 'Consumer Discretionary'),
    (2700, 2799, 'Communication Services'), (4800, 4899, 'Communication Services'), (7310, 7319, 'Communication Services'), (7810, 7899, 'Communication Services'),
    (6798, 6798, 'Real Estate'), (6500, 6599, 'Real Estate'),
    (4950, 4959, 'Industrials'), (4900, 4999, 'Utilities'),
    (100, 999, 'Consumer Staples'), (1000, 1099, 'Materials'), (1400, 1499, 'Materials'), (1500, 1799, 'Industrials'),
    (2000, 2199, 'Consumer Staples'), (2200, 2399, 'Consumer Discretionary'), (2400, 2499, 'Materials'), (2500, 2599, 'Consumer Discretionary'),
    (2600, 2699, 'Materials'), (2800, 2899, 'Materials'), (3000, 3099, 'Materials'), (3100, 3199, 'Consumer Discretionary'),
    (3200, 3399, 'Materials'), (3400, 3699, 'Industrials'), (3700, 3799, 'Industrials'), (3800, 3899, 'Industrials'),
    (3900, 3999, 'Consumer Discretionary'), (4000, 4799, 'Industrials'), (5000, 5199, 'Industrials'), (5200, 5999, 'Consumer Discretionary'),
    (6000, 6799, 'Financials'), (7000, 7299, 'Consumer Discretionary'), (7300, 7399, 'Industrials'), (7500, 7999, 'Consumer Discretionary'),
    (8100, 8199, 'Industrials'), (8200, 8299, 'Consumer Discretionary'), (8300, 8999, 'Industrials'),
]
OTHER = 'Other'
FUND = 'Fund'
#: Words that make a name a fund (an ETF or mutual fund); "Trust" alone isn't enough (Northern Trust is a bank).
FUND_WORDS = re.compile(r'\b(ETF|ETFS|FUND|FUNDS|ISHARES|SPDR|PROSHARES|INDEX)\b|\bQQQ\b', re.I)
FUND_TYPES = [
    ('bond', re.compile(r'\b(BOND|BONDS|TREASURY|TREAS|AGGREGATE|FIXED INCOME|MUNI|MUNICIPAL|CORPORATE|TIPS|T-BILL|BILL)\b', re.I)),
    ('sector', re.compile(r'\b(TECHNOLOGY|TECH|HEALTH ?CARE|FINANCIALS?|ENERGY|REAL ESTATE|REIT|UTILITIES|SEMICONDUCTORS?|CONSUMER|INDUSTRIALS?|MATERIALS|COMMUNICATIONS?|BIOTECH)\b', re.I)),
    ('broad market', re.compile(r'TOTAL (STOCK|MARKET|WORLD)|S&P 500|\b500\b|NASDAQ[- ]100|\bQQQ\b|RUSSELL|EXTENDED MARKET|BROAD MARKET|TOTAL INTERNATIONAL', re.I)),
]


def sector_of(sic):
    """The sector for an SEC SIC code (number or text), or "Other" when it's missing or not in the table."""
    try:
        code = int(str(sic).strip())
    except (TypeError, ValueError):
        return OTHER
    return next((name for lo, hi, name in SIC_SECTORS if lo <= code <= hi), OTHER)


def fund_type(name):
    """'bond', 'sector' or 'broad market' when the fund's name makes it obvious, else None."""
    return next((kind for kind, words in FUND_TYPES if words.search(name or '')), None)


def is_fund(name, asset_type=''):
    return str(asset_type).upper() in ('MUTUAL_FUND', 'ETF') or bool(FUND_WORDS.search(name or ''))


async def sector(ctx, symbol, quote):
    """{sector, fundType?, sic?, source} for one symbol. Funds are labelled from the name (no look-through); stocks
    use the SIC code in their SEC submissions, kept 30 days in cache.db. Raises EngineError only when the SEC can't
    be asked right now. Only "not in the SEC's list" is remembered as "Other"; any other failure (no contact email,
    403, network, the ticker list not loading) is raised and not cached, so the next visit tries again."""
    name, kind = quote.get('name') or '', quote.get('assetType') or ''
    if is_fund(name, kind):
        return {'sector': FUND, 'fundType': fund_type(name), 'source': 'name'}
    if not ctx.sec_contact:
        raise EngineError('Add your email under "SEC email" in Settings to see sectors (the SEC asks for one).')

    async def load():
        try:
            info = await sec.company(ctx, symbol)
        except sec.NotListed:
            return {'sector': OTHER, 'source': 'not in the SEC company list'}
        subs = await sec.submissions(ctx, info['cik'])
        sic = str(subs.get('sic') or '').strip()
        if not sic:
            return {'sector': OTHER, 'source': 'no SIC code at the SEC'}
        return {'sector': sector_of(sic), 'sic': sic, 'industry': subs.get('sicDescription') or '', 'source': 'SEC'}
    return await ctx.cached(('sector', symbol), SECTOR_DAYS * 86400, load, persist=True)


def value_at_risk(returns, level=0.95):
    """1-day historical value-at-risk as a positive fraction: the loss beaten on only 1 day in 20 (at 95%)."""
    return float(-np.percentile(np.asarray(returns, dtype=float), (1 - level) * 100))


def beta(returns, bench):
    r, b = np.asarray(returns, dtype=float), np.asarray(bench, dtype=float)
    var = float(np.var(b, ddof=1))
    return float(np.cov(r, b)[0, 1] / var) if var else None


def risk_stats(asset_returns, bench, weights, dates):
    """Portfolio risk if today's weights were held all year. asset_returns [days, assets] (daily simple returns),
    bench [days], weights per asset as a fraction of the whole account (cash is the part left over: zero return),
    dates has one more entry than the returns. Pure."""
    w = np.asarray(weights, dtype=float)
    port = asset_returns @ w
    dd, _ = quant.max_drawdown(port, dates)
    # each holding's share of the account's swings: weight x (covariance x weights) / variance (cash adds nothing)
    cov = np.atleast_2d(np.cov(asset_returns, rowvar=False)) if len(w) else np.zeros((0, 0))
    var = float(w @ cov @ w) if len(w) else 0.0
    contrib = w * (cov @ w) / var if var else np.zeros(len(w))
    per = [{'volatility': float(asset_returns[:, i].std(ddof=1) * np.sqrt(quant.TRADING_DAYS)), 'beta': beta(asset_returns[:, i], bench),
            'riskShare': float(contrib[i])} for i in range(len(w))]
    return {'volatility': float(port.std(ddof=1) * np.sqrt(quant.TRADING_DAYS)), 'beta': beta(port, bench),
            'var95': value_at_risk(port), 'maxDrawdown': dd['maxDrawdown'], 'peak': dd['peak'], 'trough': dd['trough'], 'assets': per}


def _aligned(series, bench_rows, start):
    """Closes on the benchmark's days since `start` (carrying a missing day's close forward); None when the symbol's
    history starts more than a month after `start` (too short to judge a year) or ends more than STALE_SESSIONS
    sessions before the benchmark's last day (stale or delisted: not forward-filled into a flat line)."""
    days = [(d, c) for d, c in bench_rows if d >= start]
    known = dict(series)
    if not series or min(known) > start + dt.timedelta(days=31):
        return None
    if sum(1 for d, _ in days if d > max(known)) > STALE_SESSIONS:
        return None
    out, last = [], next((c for d, c in reversed(series) if d <= days[0][0]), series[0][1])
    for d, _ in days:
        last = known.get(d, last)
        out.append(last)
    return out


def _clean(raw):
    """Holdings from the browser: {symbol, value, kind}; cash (and money market) is zero risk, alternatives have no
    daily prices so they're left out of the risk figures."""
    rows = []
    for h in (raw if isinstance(raw, list) else [])[:300]:
        if not isinstance(h, dict):
            continue
        try:
            value = float(h.get('value') or 0)
        except (TypeError, ValueError):
            continue
        symbol = str(h.get('symbol') or '').strip().upper()
        if symbol and value > 0:
            rows.append({'symbol': symbol, 'value': value, 'kind': h.get('kind') if h.get('kind') in ('cash', 'alt') else 'security'})
    return rows


@handler('risk.account')
async def account(ctx, msg):
    rows = _clean(msg.get('holdings'))
    if not rows:
        raise EngineError('No holdings with a value to measure.')
    stocks = sorted({r['symbol'] for r in rows if r['kind'] == 'security'})
    values = {}
    for r in rows:
        if r['kind'] != 'alt':
            key = 'CASH' if r['kind'] == 'cash' else r['symbol']
            values[key] = values.get(key, 0) + r['value']
    total = sum(values.values())
    try:
        quotes = await invest.quotes(ctx, stocks) if stocks else {}
    except Exception:  # names only help spot funds; without them the SEC lookup still runs
        quotes = {}
    closes = await asyncio.gather(*(invest.closes(ctx, s) for s in [*stocks, 'SPY']), return_exceptions=True)
    day = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).date()  # noqa: E731
    series = {s: ([] if isinstance(c, Exception) else [(day(t), float(v)) for t, v in c]) for s, c in zip([*stocks, 'SPY'], closes)}
    out = {'total': total, 'alts': sorted({r['symbol'] for r in rows if r['kind'] == 'alt'}),
           'sectors': {}, 'sectorNote': None, 'stats': None, 'assets': {}, 'missing': [], 'note': None}

    # sectors, one SEC lookup per stock (cached 30 days); a missing SEC email is said once, never guessed
    async def one(s):
        try:
            return await sector(ctx, s, quotes.get(s) or {})
        except EngineError as err:
            out['sectorNote'] = str(err)
        except Exception as err:
            out['sectorNote'] = f'The SEC couldn’t be reached for sectors ({type(err).__name__}); they show as Other for now. Refresh later.'
        return {'sector': OTHER, 'source': 'unavailable'}
    out['sectors'] = dict(zip(stocks, await asyncio.gather(*(one(s) for s in stocks))))

    bench = series['SPY']
    if len(bench) < 200:
        out['note'] = 'No year of SPY history from Schwab, so volatility, beta and value-at-risk can’t be worked out. Check the helper is logged in.'
        return out
    start = bench[-1][0] - dt.timedelta(days=365)
    measured, matrix = [], []
    for s in stocks:
        a = _aligned(series[s], bench, start)
        if a is None:
            out['missing'].append(s)
        else:
            measured.append(s)
            matrix.append(a)
    days = [d for d, _ in bench if d >= start]
    b = np.array([c for d, c in bench if d >= start])
    if len(days) < 120:
        out['note'] = 'Not enough recent price history to measure risk.'
        return out
    # the measured part of the account: stocks with a year of prices plus cash (zero risk)
    base = sum(values.get(s, 0) for s in measured) + values.get('CASH', 0)
    if not base:
        out['note'] = 'None of the holdings has a year of daily prices yet.'
        return out
    prices = np.array(matrix, dtype=float).T if measured else np.ones((len(days), 0))
    asset_returns = prices[1:] / prices[:-1] - 1 if measured else np.zeros((len(days) - 1, 0))
    bench_returns = b[1:] / b[:-1] - 1
    weights = [values[s] / base for s in measured]
    stats = risk_stats(asset_returns, bench_returns, weights, days)
    out['assets'] = {s: {**a, 'weight': values[s] / base} for s, a in zip(measured, stats.pop('assets'))}
    out['stats'] = {**stats, 'start': days[0].isoformat(), 'end': days[-1].isoformat(), 'measured': base}
    return out
