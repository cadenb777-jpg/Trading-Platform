"""
ETF and mutual fund profiles (owner, 2026-11-20: "there's no mutual fund or ETF information"). One request,
fund.profile {symbol}, answers with what matters about a fund:
  - the basics: family, category, legal type (ETF / mutual fund), inception, net assets, NAV, yield;
  - costs: net expense ratio, turnover, sales loads and 12b-1 fee, minimum investment;
  - ratings: Morningstar overall rating and risk (as Yahoo republishes them);
  - what it holds: top holdings with weights, asset mix (stocks / bonds / cash), sectors, equity valuation (P/E, P/B,
    median market cap), bond duration, maturity and credit quality;
  - how it has done: trailing returns against its category, calendar-year returns, best/worst years, 3/5/10-year
    risk statistics (alpha, beta, R-squared, standard deviation, Sharpe) against the category;
  - the objective in the fund's own words.
Source: Yahoo Finance's quoteSummary fund modules (free; Yahoo's session cookie + crumb, shared with crosscheck.py).
Kept 12 hours, saved on disk, and served from the saved copy while it refreshes. Nothing is estimated: a field Yahoo
doesn't give comes back as null and the page says so.
"""
import datetime as dt
import re
import urllib.parse

from . import crosscheck
from .core import EngineError, handler

MODULES = 'quoteType,price,summaryDetail,defaultKeyStatistics,fundProfile,topHoldings,fundPerformance,assetProfile'
SYMBOL = re.compile(r'^[A-Z][A-Z0-9.\-]{0,9}$')
SECTORS = {
    'realestate': 'Real estate', 'consumer_cyclical': 'Consumer cyclical', 'basic_materials': 'Basic materials',
    'consumer_defensive': 'Consumer defensive', 'technology': 'Technology', 'communication_services': 'Communication',
    'financial_services': 'Financials', 'utilities': 'Utilities', 'industrials': 'Industrials', 'energy': 'Energy',
    'healthcare': 'Health care',
}
RATINGS = {'us_government': 'US government', 'aaa': 'AAA', 'aa': 'AA', 'a': 'A', 'bbb': 'BBB', 'bb': 'BB', 'b': 'B',
           'below_b': 'Below B', 'other': 'Not rated / other'}
RETURN_KEYS = [('ytd', 'Year to date'), ('oneMonth', '1 month'), ('threeMonth', '3 months'), ('oneYear', '1 year'),
               ('threeYear', '3 years (a year)'), ('fiveYear', '5 years (a year)'), ('tenYear', '10 years (a year)')]


def _raw(v):
    """Yahoo wraps numbers as {"raw": 0.0009, "fmt": "0.09%"}; plain numbers pass through; anything else is None."""
    if isinstance(v, dict):
        v = v.get('raw')
    if isinstance(v, bool):
        return None
    return float(v) if isinstance(v, (int, float)) else None


def _date(v):
    n = _raw(v)
    if n is None:
        return None
    return dt.datetime.fromtimestamp(n, dt.timezone.utc).date().isoformat()


def _text(v):
    if isinstance(v, dict):
        v = v.get('fmt') or v.get('longFmt')
    return str(v).strip() if isinstance(v, str) and v.strip() else None


def parse_fund(data):
    """Yahoo quoteSummary JSON -> the fund profile (pure, tested). Raises when Yahoo has nothing for the symbol."""
    result = ((data or {}).get('quoteSummary') or {}).get('result') or []
    if not result:
        err = ((data or {}).get('quoteSummary') or {}).get('error') or {}
        raise EngineError(err.get('description') or 'Yahoo has no fund data for this symbol.')
    r = result[0]
    qt, pr, sd = r.get('quoteType') or {}, r.get('price') or {}, r.get('summaryDetail') or {}
    ks, fp, th = r.get('defaultKeyStatistics') or {}, r.get('fundProfile') or {}, r.get('topHoldings') or {}
    perf, ap = r.get('fundPerformance') or {}, r.get('assetProfile') or {}
    fees = fp.get('feesExpensesInvestment') or {}
    kind = (qt.get('quoteType') or pr.get('quoteType') or '').upper()

    holdings = [{'symbol': (x.get('symbol') or '').strip(), 'name': (x.get('holdingName') or '').strip(), 'weight': _raw(x.get('holdingPercent'))}
                for x in th.get('holdings') or [] if isinstance(x, dict)]
    sectors = []
    for item in th.get('sectorWeightings') or []:
        for k, v in (item or {}).items():
            w = _raw(v)
            if w is not None and w > 0:
                sectors.append({'sector': SECTORS.get(k, k.replace('_', ' ').capitalize()), 'weight': w})
    ratings = []
    for item in th.get('bondRatings') or []:
        for k, v in (item or {}).items():
            w = _raw(v)
            if w is not None and w > 0:
                ratings.append({'rating': RATINGS.get(k, k.upper()), 'weight': w})
    eq, bd = th.get('equityHoldings') or {}, th.get('bondHoldings') or {}
    mix = [{'label': label, 'weight': _raw(th.get(key))} for key, label in (('stockPosition', 'Stocks'), ('bondPosition', 'Bonds'), ('cashPosition', 'Cash'),
                                                                             ('preferredPosition', 'Preferred'), ('convertiblePosition', 'Convertibles'), ('otherPosition', 'Other'))]
    mix = [m for m in mix if m['weight'] is not None and abs(m['weight']) > 0.0005]

    tr, trc = perf.get('trailingReturns') or {}, perf.get('trailingReturnsCat') or {}
    trailing = [{'period': label, 'fund': _raw(tr.get(k)), 'category': _raw(trc.get(k))} for k, label in RETURN_KEYS]
    trailing = [t for t in trailing if t['fund'] is not None or t['category'] is not None]
    annual_src = perf.get('annualTotalReturns') or {}
    cat_by_year = {str(x.get('year')): _raw(x.get('annualValue')) for x in annual_src.get('returnsCat') or [] if isinstance(x, dict)}
    annual = [{'year': str(x.get('year')), 'fund': _raw(x.get('annualValue')), 'category': cat_by_year.get(str(x.get('year')))}
              for x in annual_src.get('returns') or [] if isinstance(x, dict) and _raw(x.get('annualValue')) is not None]
    annual.sort(key=lambda x: x['year'], reverse=True)
    ro = perf.get('riskOverviewStatistics') or {}
    cat_risk = {x.get('year'): x for x in ro.get('riskStatisticsCat') or [] if isinstance(x, dict)}
    risk = []
    for x in ro.get('riskStatistics') or []:
        if not isinstance(x, dict):
            continue
        c = cat_risk.get(x.get('year')) or {}
        risk.append({'years': x.get('year'), **{k: _raw(x.get(k)) for k in ('alpha', 'beta', 'rSquared', 'stdDev', 'sharpeRatio', 'treynorRatio', 'meanAnnualReturn')},
                     'category': {k: _raw(c.get(k)) for k in ('alpha', 'beta', 'rSquared', 'stdDev', 'sharpeRatio')} if c else None})
    po = perf.get('performanceOverview') or {}

    out = {
        'symbol': (qt.get('symbol') or pr.get('symbol') or '').upper(),
        'kind': 'etf' if kind == 'ETF' else 'mutualfund' if kind == 'MUTUALFUND' else kind.lower() or None,
        'name': qt.get('longName') or pr.get('longName') or qt.get('shortName') or pr.get('shortName'),
        'family': fp.get('family') or ks.get('fundFamily'),
        'category': fp.get('categoryName') or ks.get('category'),
        'legalType': fp.get('legalType') or ks.get('legalType'),
        'inception': _date(ks.get('fundInceptionDate')),
        'currency': pr.get('currency'),
        'netAssets': _raw(sd.get('totalAssets')) or _raw(ks.get('totalAssets')),
        'nav': _raw(sd.get('navPrice')),
        'yield': _raw(sd.get('yield')) if _raw(sd.get('yield')) is not None else _raw(ks.get('yield')),
        'expenseRatio': _raw(fees.get('annualReportExpenseRatio')) if _raw(fees.get('annualReportExpenseRatio')) is not None else _raw(ks.get('annualReportExpenseRatio')),
        'grossExpenseRatio': _raw(fees.get('annualReportGrossExpenseRatio')) if fees.get('annualReportGrossExpenseRatio') else None,
        'turnover': _raw(fees.get('annualHoldingsTurnover')) if _raw(fees.get('annualHoldingsTurnover')) is not None else _raw(ks.get('annualHoldingsTurnover')),
        'frontLoad': _raw(fees.get('frontEndSalesLoad')),
        'deferredLoad': _raw(fees.get('deferredSalesLoad')),
        'twelveB1': _raw(fees.get('twelveBOne')),
        'minInvestment': _raw(fp.get('initInvestment')),
        'morningstarRating': _raw(ks.get('morningStarOverallRating')),
        'morningstarRisk': _raw(ks.get('morningStarRiskRating')),
        'beta3y': _raw(ks.get('beta3Year')),
        'objective': (ap.get('longBusinessSummary') or '').strip() or None,
        'holdings': [x for x in holdings if x['weight'] is not None][:25],
        'holdingsShare': sum(x['weight'] or 0 for x in holdings) or None,
        'mix': mix,
        'sectors': sorted(sectors, key=lambda x: -x['weight']),
        'equity': {k: _raw(eq.get(k)) for k in ('priceToEarnings', 'priceToBook', 'priceToSales', 'priceToCashflow', 'medianMarketCap', 'threeYearEarningsGrowth')},
        'bonds': {'duration': _raw(bd.get('duration')), 'maturity': _raw(bd.get('maturity')), 'creditQuality': _raw(bd.get('creditQuality'))},
        'ratings': ratings,
        'trailing': trailing,
        'trailingAsOf': _date(tr.get('asOfDate')),
        'annual': annual[:10],
        'best': {'oneYear': _raw(po.get('bestOneYrTotalReturn')), 'threeYear': _raw(po.get('bestThreeYrTotalReturn'))},
        'worst': {'oneYear': _raw(po.get('worstOneYrTotalReturn')), 'threeYear': _raw(po.get('worstThreeYrTotalReturn'))},
        'yearsUp': _raw(po.get('numYearsUp')),
        'yearsDown': _raw(po.get('numYearsDown')),
        'risk': risk,
    }
    if not out['kind'] or out['kind'] not in ('etf', 'mutualfund'):
        raise EngineError(f"{out['symbol'] or 'This symbol'} isn't a fund on Yahoo (it says {kind.lower() or 'nothing'}).")
    return out


async def _summary(ctx, symbol, retried=False):
    crumb = await crosscheck._yahoo_crumb(ctx)
    url = crosscheck.YAHOO_SUMMARY.format(symbol=urllib.parse.quote(crosscheck._yahoo(symbol)))
    try:
        response = await crosscheck._get(ctx, 'yahoo', url, params={'modules': MODULES, 'crumb': crumb})
    except EngineError:
        if retried:
            raise
        # an old session code: forget it and ask for a fresh one once
        ctx._cache.pop(crosscheck.CRUMB_KEY, None)
        crosscheck._failures.pop(crosscheck.CRUMB_KEY, None)
        return await _summary(ctx, symbol, retried=True)
    if response.status_code == 404:
        raise EngineError(f'Yahoo has no fund data for {symbol}.')
    response.raise_for_status()
    return response.json()


@handler('fund.profile')
async def profile(ctx, msg):
    symbol = str(msg.get('symbol') or '').strip().upper()
    if not SYMBOL.match(symbol):
        raise EngineError(f'Invalid symbol "{symbol}"')

    async def load():
        data = parse_fund(await _summary(ctx, symbol))
        return {**data, 'source': 'Yahoo Finance (fund profile, holdings, performance; Morningstar ratings as Yahoo shows them)',
                'url': f'https://finance.yahoo.com/quote/{crosscheck._yahoo(symbol)}', 'fetched': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    return await ctx.cached(('fund-profile', symbol), 12 * 3600, load, persist=True, stale_ok=True)
