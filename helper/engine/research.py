"""
Company research from free SEC data: financial statements (XBRL company facts), ratios,
valuation inputs and the filings list. Prices and P/E come from Schwab's quote.
"""
import asyncio
import datetime as dt
import logging

from . import dividends, sec
from .core import EngineError, handler

log = logging.getLogger('engine.research')

# Each line item lists the XBRL tags companies use for it, most common first. Companies switch tags
# over the years, so for each period the first tag with a value wins.
INCOME = [
    ('revenue', 'Revenue', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
                            'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet']),
    ('costOfRevenue', 'Cost of revenue', ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold']),
    ('grossProfit', 'Gross profit', ['GrossProfit']),
    ('rnd', 'Research & development', ['ResearchAndDevelopmentExpense']),
    ('sga', 'Selling, general & admin', ['SellingGeneralAndAdministrativeExpense']),
    # helper 75: write-downs, charged before operating income (a year without the tag = not reported, never zero);
    # intangibles: the total first, then the indefinite- and finite-lived parts some filers tag instead
    ('goodwillImpairment', 'Goodwill write-down', ['GoodwillImpairmentLoss']),
    ('intangibleImpairment', 'Intangible write-down', ['ImpairmentOfIntangibleAssetsExcludingGoodwill',
                                                       'ImpairmentOfIntangibleAssetsIndefinitelivedExcludingGoodwill',
                                                       'ImpairmentOfIntangibleAssetsFinitelived']),
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
    ('shortInvestments', 'Short-term investments', ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent',
                                                          'OtherShortTermInvestments']),  # Coca-Cola's since 2021 (helper 83)
    # helper 71: for the Beneish M-score and Altman Z-score on Research (Earnings quality)
    ('receivables', 'Accounts receivable', ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent']),
    # helper 74: for the cash conversion cycle (payables only on their own line: a combined payables-and-accrued
    # line would overstate days to pay)
    ('inventory', 'Inventory', ['InventoryNet', 'RetailRelatedInventoryMerchandise']),
    ('currentAssets', 'Current assets', ['AssetsCurrent']),
    # helper 83: securities held for more than a year (Apple's $80B+), left out of invested capital like cash
    ('longInvestments', 'Long-term marketable securities', ['MarketableSecuritiesNoncurrent', 'AvailableForSaleSecuritiesDebtSecuritiesNoncurrent']),
    ('ppe', 'Property, plant & equipment', ['PropertyPlantAndEquipmentNet',
                                            'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization']),
    ('goodwill', 'Goodwill', ['Goodwill']),  # helper 75
    ('totalAssets', 'Total assets', ['Assets']),
    ('payables', 'Accounts payable', ['AccountsPayableCurrent', 'AccountsPayableTradeCurrent']),
    # helper 75: billed in advance (ASC 606 renamed DeferredRevenueCurrent to ContractWithCustomerLiabilityCurrent in 2018:
    # the same current concept), for Research's balance-sheet quality panel
    ('deferredRevenue', 'Deferred revenue (current)', ['ContractWithCustomerLiabilityCurrent', 'DeferredRevenueCurrent']),
    # helper 83: debt due within a year (the total; filled from its parts in statements() when only they are tagged),
    # so invested capital counts it as financing, not as an operating liability
    ('currentDebt', 'Current debt', ['DebtCurrent']),
    ('currentLiabilities', 'Current liabilities', ['LiabilitiesCurrent']),
    ('longTermDebt', 'Long-term debt', ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations']),
    ('totalLiabilities', 'Total liabilities', ['Liabilities']),
    ('retainedEarnings', 'Retained earnings', ['RetainedEarningsAccumulatedDeficit']),
    ('equity', "Shareholders' equity", ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']),
]
#: the parts of current debt some filers tag instead of the DebtCurrent total (used only when the total is missing, so
#: nothing counts twice): the current part of long-term debt plus short-term borrowings, else commercial paper
#: (ShortTermBorrowings is a total that usually already includes commercial paper)
CURRENT_DEBT_PARTS = [
    ('_ltdCurrent', ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent']),
    ('_commercialPaper', ['CommercialPaper']),
    ('_shortBorrowings', ['ShortTermBorrowings']),
]
CASH_FLOW = [
    ('operatingCashFlow', 'Operating cash flow', ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']),
    ('capex', 'Capital expenditures', ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets']),
    ('dna', 'Depreciation & amortization', ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet']),
    # helper 82: depreciation of property and equipment alone (what wears out what capital spending buys; Microsoft
    # tags only this, no D&A line)
    ('depreciation', 'Depreciation', ['Depreciation']),
    # helper 85: tax actually paid in cash (supplemental cash-flow disclosure), for Research's cash tax rate
    ('taxesPaid', 'Income taxes paid', ['IncomeTaxesPaidNet']),  # net of refunds only: never mixed with the gross tag
    ('stockComp', 'Stock-based compensation', ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense']),
    ('buybacks', 'Share buybacks', ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity']),
    ('dividends', 'Dividends paid', ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock']),
]
UNITS = {'epsDiluted': 'USD/shares', 'dilutedShares': 'shares'}
INSTANT = {key for key, _, _ in BALANCE}
ANNUAL_FORMS = {'10-K', '10-K/A', '20-F', '20-F/A', '40-F', '10-KT'}
YEARS = 10
QUARTERS = 12
#: the debt maturity table every 10-K carries (ASC 470-10-50-1: principal due in each of the next five years and after)
MATURITY_TAGS = [
    ('next12', 'LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths'),  # pragma: allowlist secret (an XBRL tag name)
    ('year2', 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo'),
    ('year3', 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree'),
    ('year4', 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour'),
    ('year5', 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive'),
    ('after5', 'LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive'),
]
#: operating lease payments by year, their undiscounted total and the present value on the balance sheet (ASC 842)
LEASE_TAGS = [
    ('next12', 'LesseeOperatingLeaseLiabilityPaymentsDueNextTwelveMonths'),
    ('year2', 'LesseeOperatingLeaseLiabilityPaymentsDueYearTwo'),
    ('year3', 'LesseeOperatingLeaseLiabilityPaymentsDueYearThree'),
    ('year4', 'LesseeOperatingLeaseLiabilityPaymentsDueYearFour'),
    ('year5', 'LesseeOperatingLeaseLiabilityPaymentsDueYearFive'),
    ('after5', 'LesseeOperatingLeaseLiabilityPaymentsDueAfterYearFive'),
    ('total', 'LesseeOperatingLeaseLiabilityPaymentsDue'),
    ('presentValue', 'OperatingLeaseLiability'),
]
#: purchase commitments not on the balance sheet; the first tag is the one most filers use for the total
PURCHASE_TAGS = ['UnrecordedUnconditionalPurchaseObligationBalanceSheetAmount', 'PurchaseObligation']
#: today's corporate bond yields (ICE BofA effective yield indexes via FRED), for the refinancing wall; the same
#: cached series the Bond market page reads (macro.fred), so no extra download
#: helper 83 adds Moody's Baa corporate yield (monthly, since 1919): what a medium-grade company pays to borrow, the
#: free floor Research sets return on capital against
CORP_YIELDS = [('ig', 'BAMLC0A0CMEY'), ('hy', 'BAMLH0A0HYM2EY'), ('baa', 'BAA')]


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
            # fiscal years only from annual reports: some 10-Qs also report the trailing twelve months (Amazon's cash
            # flows), which read as a year ending at a quarter end
            if e.get('form') in ANNUAL_FORMS:
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


def maturities(company_facts):
    """The debt maturity ladder from the newest annual report that has one: {asOf, filed, accession, form, buckets
    {next12, year2..year5, after5: $ or None}}. Every bucket comes from that one filing and balance-sheet date (a bucket
    the filing leaves out stays None, never borrowed from an older year). None when no annual report tags the table."""
    return _ladder(company_facts, MATURITY_TAGS)


def obligations(company_facts):
    """What the company owes outside the debt line, each from the newest annual report that tags it (helper 69):
    leases = operating lease payments by year (ASC 842-20-50-6) plus their total and present value (the liability on the
    balance sheet), one filing and date like the debt ladder; purchase = unconditional purchase commitments not on the
    balance sheet (ASC 440-10-50); uncertainTax = unrecognized tax benefits (ASC 740-10-50-15A: tax positions the
    company itself reserves for). None when no annual report tags any of them."""
    out = {'leases': _ladder(company_facts, LEASE_TAGS),
           # finance leases are a separate liability (ASC 842-20-45-1); only the total is read
           'financeLease': _latest(company_facts, ['FinanceLeaseLiability']),
           'purchase': _latest(company_facts, PURCHASE_TAGS),
           'uncertainTax': _latest(company_facts, ['UnrecognizedTaxBenefits'])}
    return out if any(out.values()) else None


def _latest(company_facts, tags):
    """The newest annual-report value among `tags` (newest balance-sheet date, then the earlier tag in the list, then
    the latest filed): {value, asOf, filed, accession, form, tag}, or None."""
    gaap = company_facts.get('facts', {}).get('us-gaap', {})
    best = None
    for rank, tag in enumerate(tags):
        for e in gaap.get(tag, {}).get('units', {}).get('USD', []):
            if e.get('form') in ANNUAL_FORMS and e.get('end') and e.get('val') is not None and e.get('accn'):
                k = (e['end'], -rank, e.get('filed', ''))
                if best is None or k > best[0]:
                    best = (k, {'value': e['val'], 'asOf': e['end'], 'filed': e.get('filed', ''), 'accession': e['accn'],
                                'form': e['form'], 'tag': tag})
    return best[1] if best else None


def _ladder(company_facts, tags):
    gaap = company_facts.get('facts', {}).get('us-gaap', {})
    rows = []
    for key, tag in tags:
        for e in gaap.get(tag, {}).get('units', {}).get('USD', []):
            if e.get('form') in ANNUAL_FORMS and e.get('end') and e.get('val') is not None and e.get('accn'):
                rows.append((e.get('filed', ''), e['end'], e['accn'], e['form'], key, e['val']))
    if not rows:
        return None
    # Each filing's own table is the one at its newest balance-sheet date (a 10-K also repeats last year's). Pick the
    # newest date, then the filing with the most buckets for it (a partial 10-K/A never hides the full 10-K), then the
    # latest filed.
    own = {}
    for f, e, a, fm, key, _ in rows:
        cur = own.setdefault(a, {'end': e, 'filed': f, 'form': fm, 'keys': set()})
        if e > cur['end']:
            cur.update(end=e, keys=set())
        if e == cur['end']:
            cur['keys'].add(key)
        cur['filed'] = max(cur['filed'], f)
    accn, best = max(own.items(), key=lambda x: (x[1]['end'], len(x[1]['keys']), x[1]['filed']))
    end, filed, form = best['end'], best['filed'], best['form']
    buckets = {key: None for key, _ in tags}
    for f, e, a, _, key, val in sorted(rows):
        if a == accn and e == end:
            buckets[key] = val
    return {'asOf': end, 'filed': filed, 'accession': accn, 'form': form, 'buckets': buckets}


def _current_debt(ltd, cp, stb):
    short = stb if stb is not None else cp
    if ltd is None and short is None:
        return None
    return (ltd or 0) + (short or 0)


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
    for key, tags in CURRENT_DEBT_PARTS:
        annual_series[key], quarterly_series[key] = _merge(gaap, tags, 'USD', True)
    out = {}
    for name, series, count in (('annual', annual_series, YEARS), ('quarterly', quarterly_series, QUARTERS)):
        ends, table = _align(series, count)
        rev, cost = table['revenue'], table['costOfRevenue']
        table['grossProfit'] = [g if g is not None else (r - c if r is not None and c is not None else None) for g, r, c in zip(table['grossProfit'], rev, cost)]
        table['freeCashFlow'] = [o - (c or 0) if o is not None else None for o, c in zip(table['operatingCashFlow'], table['capex'])]
        parts = [table.pop(key) for key, _ in CURRENT_DEBT_PARTS]
        table['currentDebt'] = [t if t is not None else _current_debt(ltd, cp, stb) for t, ltd, cp, stb in zip(table['currentDebt'], *parts)]
        out[name] = {'periods': ends, 'values': table}
    ltm = last_twelve_months(out['quarterly'], out['annual'])
    if ltm:
        out['annual']['ltm'] = ltm
    return out


#: averaged (not added up) over the four quarters of the last twelve months
AVERAGED = {'dilutedShares'}


def _consecutive_quarters(ends):
    """True when four quarter ends follow each other (about 9 months from the first to the last)."""
    if len(ends) != 4:
        return False
    span = _days(ends[0], ends[-1])
    steps = [_days(a, b) for a, b in zip(ends, ends[1:])]
    return 250 <= span <= 300 and all(75 <= d <= 105 for d in steps)


def last_twelve_months(quarterly, annual):
    """The last twelve months (Bloomberg's LTM column) when the newest quarter is after the latest fiscal year: flows
    added over the last four quarters, share counts averaged, balance-sheet items as of the newest quarter. None when
    the last four quarters aren't complete and consecutive, or the newest quarter is the fiscal year end itself."""
    q_ends, a_ends = quarterly['periods'], annual['periods']
    if len(q_ends) < 4 or not a_ends or q_ends[-1] <= a_ends[-1] or _same_period(q_ends[-1], a_ends[-1]):
        return None
    last4 = q_ends[-4:]
    if not _consecutive_quarters(last4):
        return None
    values = {}
    for key, row in quarterly['values'].items():
        if key in INSTANT:
            values[key] = row[-1]
            continue
        q = row[-4:]
        if any(x is None for x in q):
            values[key] = None
        elif key in AVERAGED:
            values[key] = sum(q) / 4
        else:
            values[key] = sum(q)
    return {'end': q_ends[-1], 'start': last4[0], 'values': values}


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
        return sum(q) / 4 if key in AVERAGED else sum(q)  # share counts are averaged, not added up
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


async def company_core(ctx, cik, with_maturities=False):
    """A company's statements (annual and quarterly) and latest share count from its XBRL company facts."""
    async def load_core():
        # Company facts files are large, so only the finished statements are kept on disk.
        company_facts = await sec._json(ctx, sec.FACTS_URL.format(cik=cik))
        return {'statements': statements(company_facts), 'shares': _latest_shares(company_facts), **_ladders(company_facts)}
    core = await ctx.cached(('sec-core', cik), 6 * 3600, load_core, persist=True, stale_ok=True)
    if with_maturities and not all(k in core['statements']['annual']['values'] for k in STATEMENT_KEYS):
        # a copy saved by an older helper lacks lines the Research panels need: reload that same key now (max age 0,
        # one download, no second copy on disk); if the SEC can't be reached, keep the saved copy (the panels that
        # need the new lines say so) rather than fail the whole page
        try:
            core = await ctx.cached(('sec-core', cik), 0, load_core, persist=True)
        except Exception as err:  # noqa: BLE001 (any download/parse failure: the saved copy still serves the page)
            log.info('research: re-reading %s for newer lines failed (%s); using the saved copy', cik, type(err).__name__)
    if with_maturities and not all(k in core for k in LADDER_KEYS):
        # a copy saved by an older helper has no ladders: read them once on their own (expires with the 6 h core copy)
        async def load_ladders():
            return _ladders(await sec._json(ctx, sec.FACTS_URL.format(cik=cik)))
        core = {**core, **await ctx.cached(('sec-ladders', cik), 6 * 3600, load_ladders, persist=True, stale_ok=True)}
    return core


LADDER_KEYS = ('maturities', 'obligations')
#: statement lines added since helper 71 (71: Beneish M-score, Altman Z-score; 74: cash conversion cycle; 75: deferred
#: revenue, goodwill and write-downs; 82: depreciation; 83: current debt and long-term securities, for return on capital; 84: income taxes paid): a saved copy without one of them is read again once
STATEMENT_KEYS = ('receivables', 'ppe', 'retainedEarnings', 'inventory', 'payables', 'deferredRevenue', 'goodwill',
                  'goodwillImpairment', 'intangibleImpairment', 'depreciation', 'currentDebt', 'longInvestments', 'taxesPaid')


def _ladders(company_facts):
    return {'maturities': maturities(company_facts), 'obligations': obligations(company_facts)}


@handler('research.corpyields')
async def corp_yields_request(ctx, msg):
    """Its own request, so a slow FRED never holds up the Research page (research.company doesn't wait for it)."""
    return await corp_yields(ctx)


async def corp_yields(ctx):
    """Today's investment-grade and high-yield effective yields (%, with their date), or None for a series FRED
    couldn't give."""
    from . import macro
    rows = await asyncio.gather(*(macro.fred(ctx, sid) for _, sid in CORP_YIELDS), return_exceptions=True)
    out = {}
    for (key, sid), r in zip(CORP_YIELDS, rows):
        good = [] if isinstance(r, BaseException) else [x for x in r if x and x[1] is not None]
        out[key] = {'value': good[-1][1], 'date': good[-1][0], 'series': sid} if good else None
    return out


@handler('research.company')
async def company(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')
    info = await sec.company(ctx, symbol)
    core_task = company_core(ctx, info['cik'], with_maturities=True)
    subs, core, q, b, tr = await asyncio.gather(sec.submissions(ctx, info['cik']), core_task, quote(ctx, symbol), beta(ctx, symbol),
                                             dividends.total_returns(ctx, [symbol]))
    st = core['statements']
    annual, quarterly = st['annual'], st['quarterly']
    shares = core['shares'] or ttm(quarterly, annual, 'dilutedShares')
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
            # helper 71: the SEC industry code (manufacturers 2000-3999 get Altman's original Z-score)
            'sic': subs.get('sic', ''),
            'exchange': ', '.join(subs.get('exchanges') or []),
            'fiscalYearEnd': subs.get('fiscalYearEnd', ''),
            'website': subs.get('website', ''),
        },
        'quote': q,
        'totalReturn': tr[symbol],
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
        # helper 68: debt maturity ladder (SEC 10-K), with a link to the filing it came from
        'maturities': _with_link(core.get('maturities'), info['cik']),
        # helper 69: operating leases, purchase commitments and uncertain tax positions (SEC 10-K); today's corporate
        # yields come from research.corpyields
        'obligations': {k: _with_link(v, info['cik']) for k, v in core['obligations'].items()} if core.get('obligations') else None,
    }


def _with_link(m, cik):
    if not m:
        return None
    return {**m, 'url': f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{m['accession'].replace('-', '')}/{m['accession']}-index.htm"}
