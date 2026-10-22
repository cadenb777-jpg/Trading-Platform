"""
Company research from free SEC data: financial statements (XBRL company facts), ratios,
valuation inputs and the filings list. Prices and P/E come from Schwab's quote.
"""
import asyncio
import datetime as dt

from . import sec
from .core import EngineError, handler

# Each line item lists the XBRL tags companies use for it, most common first. Companies switch tags
# over the years, so for each period the first tag with a value wins.
INCOME = [
    ('revenue', 'Revenue', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
                            'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet']),
    ('costOfRevenue', 'Cost of revenue', ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold']),
    ('grossProfit', 'Gross profit', ['GrossProfit']),
    ('rnd', 'Research & development', ['ResearchAndDevelopmentExpense']),
    ('sga', 'Selling, general & admin', ['SellingGeneralAndAdministrativeExpense']),
    ('operatingIncome', 'Operating income', ['OperatingIncomeLoss']),
    ('interestExpense', 'Interest expense', ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt']),
    ('pretaxIncome', 'Pre-tax income', ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
                                        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments']),
    ('incomeTax', 'Income tax', ['IncomeTaxExpenseBenefit']),
    ('netIncome', 'Net income', ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']),
    ('epsDiluted', 'EPS (diluted)', ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic']),
    ('dilutedShares', 'Diluted shares', ['WeightedAverageNumberOfDilutedSharesOutstanding']),
]
BALANCE = [
    ('cash', 'Cash & equivalents', ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash']),
    ('shortInvestments', 'Short-term investments', ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent']),
    ('currentAssets', 'Current assets', ['AssetsCurrent']),
    ('totalAssets', 'Total assets', ['Assets']),
    ('currentLiabilities', 'Current liabilities', ['LiabilitiesCurrent']),
    ('longTermDebt', 'Long-term debt', ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations']),
    ('totalLiabilities', 'Total liabilities', ['Liabilities']),
    ('equity', "Shareholders' equity", ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']),
]
CASH_FLOW = [
    ('operatingCashFlow', 'Operating cash flow', ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']),
    ('capex', 'Capital expenditures', ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets']),
    ('dna', 'Depreciation & amortization', ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet']),
    ('stockComp', 'Stock-based compensation', ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense']),
    ('buybacks', 'Share buybacks', ['PaymentsForRepurchaseOfCommonStock']),
    ('dividends', 'Dividends paid', ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock']),
]
UNITS = {'epsDiluted': 'USD/shares', 'dilutedShares': 'shares'}
INSTANT = {key for key, _, _ in BALANCE}
ANNUAL_FORMS = {'10-K', '10-K/A', '20-F', '20-F/A', '40-F', '10-KT'}
YEARS = 10
QUARTERS = 12


def _days(start, end):
    return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days


def _periods(entries, instant):
    """Splits one tag's facts into {end: value} for fiscal years and quarters (latest filing wins)."""
    annual, quarterly = {}, {}
    for e in sorted(entries, key=lambda e: e.get('filed', '')):
        end, val = e.get('end'), e.get('val')
        if not end or val is None:
            continue
        if instant:
            quarterly[end] = val
            if e.get('form') in ANNUAL_FORMS and e.get('fp') == 'FY':
                annual[end] = val
            continue
        start = e.get('start')
        if not start:
            continue
        length = _days(start, end)
        if 330 <= length <= 400:
            annual[end] = (start, val)
        elif 75 <= length <= 105:
            quarterly[end] = (start, val)
    if not instant:
        # Most companies don't report the fourth quarter on its own: it's the year minus the first three.
        for end, (start, val) in annual.items():
            if end in quarterly:
                continue
            inside = [v for q_end, (q_start, v) in quarterly.items() if q_start >= start and q_end < end]
            if len(inside) == 3:
                q4_start = max(q_end for q_end, (q_start, _) in quarterly.items() if q_start >= start and q_end < end)
                quarterly[end] = (q4_start, val - sum(inside))
        annual = {k: v[1] for k, v in annual.items()}
        quarterly = {k: v[1] for k, v in quarterly.items()}
    return annual, quarterly


def _merge(facts, tags, unit, instant):
    annual, quarterly = {}, {}
    for tag in tags:
        entries = facts.get(tag, {}).get('units', {}).get(unit)
        if not entries:
            continue
        a, q = _periods(entries, instant)
        for k, v in a.items():
            annual.setdefault(k, v)
        for k, v in q.items():
            quarterly.setdefault(k, v)
    return annual, quarterly


def _same_period(a, b):
    """Period ends a few days apart (52/53-week years) count as the same period."""
    return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days) <= 7


def _align(series, count):
    """Builds a column per period end (newest last) from {item: {end: value}}, merging near-identical dates."""
    ends = []
    for values in series.values():
        for end in values:
            if not any(_same_period(end, e) for e in ends):
                ends.append(end)
    ends = sorted(ends)[-count:]
    table = {}
    for key, values in series.items():
        row = []
        for end in ends:
            match = next((v for e, v in values.items() if _same_period(e, end)), None)
            row.append(match)
        table[key] = row
    return ends, table


def statements(company_facts):
    gaap = company_facts.get('facts', {}).get('us-gaap', {})
    if not gaap:
        gaap = company_facts.get('facts', {}).get('ifrs-full', {})
    if not gaap:
        raise EngineError('The SEC has no financial statements for this company (it may file in a foreign format).')
    annual_series, quarterly_series = {}, {}
    for key, _, tags in INCOME + BALANCE + CASH_FLOW:
        a, q = _merge(gaap, tags, UNITS.get(key, 'USD'), key in INSTANT)
        annual_series[key], quarterly_series[key] = a, q
    out = {}
    for name, series, count in (('annual', annual_series, YEARS), ('quarterly', quarterly_series, QUARTERS)):
        ends, table = _align(series, count)
        rev, cost = table['revenue'], table['costOfRevenue']
        table['grossProfit'] = [g if g is not None else (r - c if r is not None and c is not None else None) for g, r, c in zip(table['grossProfit'], rev, cost)]
        table['freeCashFlow'] = [o - (c or 0) if o is not None else None for o, c in zip(table['operatingCashFlow'], table['capex'])]
        out[name] = {'periods': ends, 'values': table}
    return out


def _div(a, b):
    return a / b if a is not None and b not in (None, 0) else None


def ratios(annual):
    v = annual['values']
    rows = {}
    rows['grossMargin'] = [_div(g, r) for g, r in zip(v['grossProfit'], v['revenue'])]
    rows['operatingMargin'] = [_div(o, r) for o, r in zip(v['operatingIncome'], v['revenue'])]
    rows['netMargin'] = [_div(n, r) for n, r in zip(v['netIncome'], v['revenue'])]
    rows['fcfMargin'] = [_div(f, r) for f, r in zip(v['freeCashFlow'], v['revenue'])]
    rows['roe'] = [_div(n, e) for n, e in zip(v['netIncome'], v['equity'])]
    rows['roa'] = [_div(n, a) for n, a in zip(v['netIncome'], v['totalAssets'])]
    rows['currentRatio'] = [_div(a, l) for a, l in zip(v['currentAssets'], v['currentLiabilities'])]
    rows['debtToEquity'] = [_div(d, e) for d, e in zip(v['longTermDebt'], v['equity'])]
    rows['revenueGrowth'] = [None] + [_div(b - a, abs(a)) if a and b is not None else None for a, b in zip(v['revenue'], v['revenue'][1:])]
    rows['epsGrowth'] = [None] + [_div(b - a, abs(a)) if a and b is not None else None for a, b in zip(v['epsDiluted'], v['epsDiluted'][1:])]
    return rows


def ttm(quarterly, annual, key):
    """Trailing twelve months: the last four quarters if we have them, otherwise the latest year."""
    if key in INSTANT:
        values = [x for x in quarterly['values'][key] if x is not None]
        return values[-1] if values else None
    q = quarterly['values'][key][-4:]
    if len(q) == 4 and all(x is not None for x in q):
        return sum(q)
    values = [x for x in annual['values'][key] if x is not None]
    return values[-1] if values else None


def _latest_shares(company_facts):
    entries = company_facts.get('facts', {}).get('dei', {}).get('EntityCommonStockSharesOutstanding', {}).get('units', {}).get('shares', [])
    if not entries:
        return None
    latest = max(entries, key=lambda e: (e.get('end', ''), e.get('filed', '')))
    # Companies with several share classes report one entry per class on the same date.
    return sum(e['val'] for e in entries if e.get('end') == latest.get('end') and e.get('filed') == latest.get('filed'))


async def quote(ctx, symbol):
    try:
        response = await ctx.schwab.get_quote(symbol)
        if response.status_code != 200:
            return {}
        data = response.json().get(symbol, {})
    except Exception:
        return {}
    q, f = data.get('quote', {}), data.get('fundamental', {})
    return {
        'price': q.get('lastPrice') or q.get('closePrice'),
        'change': q.get('netPercentChange'),
        'high52': q.get('52WeekHigh'),
        'low52': q.get('52WeekLow'),
        'peRatio': f.get('peRatio'),
        'divYield': f.get('divYield'),
        'eps': f.get('eps'),
        'lastEarnings': (f.get('lastEarningsDate') or '')[:10],
    }


async def beta(ctx, symbol, years=5):
    """Beta against the S&P 500 (SPY) from weekly returns over `years` years; None if unavailable."""
    try:
        stock, market = await asyncio.gather(ctx.daily_bars(symbol, years), ctx.daily_bars('SPY', years))
    except Exception:
        return None
    def weekly(bars):
        out = {}
        for b in bars:
            year, week, _ = dt.datetime.fromtimestamp(b['time'], dt.timezone.utc).isocalendar()
            out[(year, week)] = b['close']
        return out
    s, m = weekly(stock), weekly(market)
    weeks = sorted(set(s) & set(m))
    rs = [s[b] / s[a] - 1 for a, b in zip(weeks, weeks[1:])]
    rm = [m[b] / m[a] - 1 for a, b in zip(weeks, weeks[1:])]
    if len(rs) < 52:
        return None
    mean_s, mean_m = sum(rs) / len(rs), sum(rm) / len(rm)
    cov = sum((x - mean_s) * (y - mean_m) for x, y in zip(rs, rm))
    var = sum((y - mean_m) ** 2 for y in rm)
    return cov / var if var else None


@handler('research.company')
async def company(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')
    info = await sec.company(ctx, symbol)
    facts_task = ctx.cached(('sec-facts', info['cik']), 6 * 3600, lambda: sec._json(ctx, sec.FACTS_URL.format(cik=info['cik'])))
    subs, company_facts, q, b = await asyncio.gather(sec.submissions(ctx, info['cik']), facts_task, quote(ctx, symbol), beta(ctx, symbol))
    st = statements(company_facts)
    annual, quarterly = st['annual'], st['quarterly']
    shares = _latest_shares(company_facts) or ttm(quarterly, annual, 'dilutedShares')
    price = q.get('price')
    t = {k: ttm(quarterly, annual, k) for k in ('revenue', 'netIncome', 'operatingIncome', 'freeCashFlow', 'operatingCashFlow', 'dna', 'epsDiluted', 'interestExpense', 'incomeTax', 'pretaxIncome')}
    debt = ttm(quarterly, annual, 'longTermDebt') or 0
    cash = (ttm(quarterly, annual, 'cash') or 0) + (ttm(quarterly, annual, 'shortInvestments') or 0)
    market_cap = price * shares if price and shares else None
    ev = market_cap + debt - cash if market_cap else None
    ebitda = t['operatingIncome'] + (t['dna'] or 0) if t['operatingIncome'] is not None else None
    filings = [{**f, 'url': sec.filing_url(info['cik'], f['accession'], f['document'])}
               for f in sec.recent_filings(subs, forms={'10-K', '10-Q', '8-K', 'DEF 14A', '20-F', '6-K', 'S-1', '10-K/A', '10-Q/A', 'SC 13D', 'SC 13G'}, limit=40)]
    return {
        'symbol': symbol,
        'profile': {
            'name': subs.get('name') or info['name'],
            'cik': info['cik'],
            'industry': subs.get('sicDescription', ''),
            'exchange': ', '.join(subs.get('exchanges') or []),
            'fiscalYearEnd': subs.get('fiscalYearEnd', ''),
            'website': subs.get('website', ''),
        },
        'quote': q,
        'valuation': {
            'price': price,
            'shares': shares,
            'marketCap': market_cap,
            'enterpriseValue': ev,
            'debt': debt,
            'cash': cash,
            'pe': _div(price, t['epsDiluted']) if price else None,
            'ps': _div(market_cap, t['revenue']),
            'pfcf': _div(market_cap, t['freeCashFlow']),
            'evEbitda': _div(ev, ebitda),
            'fcfYield': _div(t['freeCashFlow'], market_cap),
            'taxRate': _div(t['incomeTax'], t['pretaxIncome']),
            'beta': b,
            'costOfDebt': _div(t['interestExpense'], debt) if debt else None,
        },
        'ttm': t,
        'annual': annual,
        'quarterly': quarterly,
        'ratios': ratios(annual),
        'labels': {key: label for key, label, _ in INCOME + BALANCE + CASH_FLOW} | {'freeCashFlow': 'Free cash flow'},
        'sections': {
            'income': [k for k, _, _ in INCOME],
            'balance': [k for k, _, _ in BALANCE],
            'cashflow': [k for k, _, _ in CASH_FLOW] + ['freeCashFlow'],
        },
        'filings': filings,
    }
