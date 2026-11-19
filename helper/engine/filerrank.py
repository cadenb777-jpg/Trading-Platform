"""
Rank against every US filer (Research → Among US companies, helper 88; issuance and R&D rows helper 91): where a company's readings sit among all
companies that file with the SEC, not only against its own past. FactSet and Bloomberg's relative-value screens show
the same kind of percentile; here it is built from the SEC's free XBRL "frames" API, which returns one value per
company for one concept and one calendar period:

    https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/CY2025.json      (a fiscal year that best fits 2025)
    https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/CY2025Q4I.json   (balances at a date in that quarter)

A company's fiscal year is the row it has in the year's duration frame (net income, else operating cash flow); its
balances are read from the instant frame of the quarter nearest that fiscal year's end (and a year earlier), and only
when that balance is dated within BALANCE_DAYS of the year-end, so income and balances describe the same year.

Readings (each one already shown against the company's own history somewhere on Research):
  grossProfitability = gross profit / total assets                       (Novy-Marx 2013)
  operatingMargin    = operating income / revenue
  returnOnAssets     = net income / average total assets
  salesGrowth        = revenue / last year's revenue - 1 (same revenue tag both years)
  assetGrowth        = total assets / last year-end's - 1                (Cooper, Gulen and Schill 2008)
  accruals           = (net income - operating cash flow) / average assets (Sloan 1996)
  inventoryVsSales   = inventory growth - sales growth                    (Thomas and Zhang 2002)
  shareIssuance      = ln(diluted shares / last year's)                  (Pontiff and Woodgate 2008)
  rdIntensity        = research and development / revenue                (Chan, Lakonishok and Sougiannis 2001)

The field is every filer with total assets of at least MIN_ASSETS at that year-end (shell companies out), all
industries together. Percentile = share of the other companies below, plus half the ties (ratesdesk.percentile_rank,
the platform's one rule). Readings only, never signals.
"""
import asyncio
import datetime as dt
import logging
import math

from . import ratesdesk, sec
from .core import EngineError, handler

log = logging.getLogger('engine.filerrank')

FRAME_URL = 'https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/{unit}/{period}.json'
#: frames change only as filings arrive; a week keeps them fresh enough for yearly figures
FRAME_TTL = 7 * 24 * 3600
#: companies smaller than this at the year-end (total assets, dollars) are left out of the field
MIN_ASSETS = 100e6
#: a year's net income frame with fewer rows is still filling up (most 10-Ks arrive by April): use the year before
MIN_FRAME_ROWS = 4000
#: a balance more than this many days from the fiscal year-end is a different date, not that year's balance
BALANCE_DAYS = 10
#: last year's figures must end about a year before this year's (days either side)
YEAR_DAYS = 31

DURATION = {'gp': 'GrossProfit', 'op': 'OperatingIncomeLoss', 'ni': 'NetIncomeLoss', 'cfo': 'NetCashProvidedByUsedInOperatingActivities'}
#: R&D: the line that leaves out acquired in-process R&D first (drug makers, 117 filers in CY2025; a one-off purchase is
#: not research spending), else the plain line most filers use
RND_TAGS = ('ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost', 'ResearchAndDevelopmentExpense')
#: weighted-average shares for the year (unit 'shares'): diluted first, else basic (195 more filers in CY2025, mostly
#: loss-makers, whose diluted count equals the basic one); this year and last always from the same tag
SHARES_TAGS = ('WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic')
#: when the two years come from different filings, a count that moved by about a whole multiple (within this) is a
#: split the older filing wasn't restated for (as debtDilution.looksLikeSplit); within one filing both years are
#: already on the same basis (the SEC frames take last year's figure from the newest filing that reports it)
SPLIT_TOLERANCE = 0.03
#: the split ratios companies actually use (forward and reverse); a 8.3x jump in shares is issuance, not a split
SPLIT_FACTORS = (2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100, 200)
REVENUE_TAGS = ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues')
#: the second revenue tag replaces the first only when more than this many times it (the first is then a part only;
#: a gross-of-excise 'Revenues' rarely reaches twice net sales)
PARTIAL_REVENUE = 2.0
INSTANT = {'assets': 'Assets', 'inventory': 'InventoryNet'}

METRICS = ('grossProfitability', 'operatingMargin', 'returnOnAssets', 'salesGrowth', 'assetGrowth', 'accruals', 'inventoryVsSales',
           'shareIssuance', 'rdIntensity')


def _date(s):
    return s if isinstance(s, dt.date) else dt.date.fromisoformat(s[:10])


def quarter_frame(day):
    """The instant frame whose quarter end is nearest `day` ('CY2025Q4I' for 2026-01-25: 25 days after Dec 31)."""
    d = _date(day)
    ends = []
    for y in (d.year - 1, d.year, d.year + 1):
        ends += [(dt.date(y, 3, 31), y, 1), (dt.date(y, 6, 30), y, 2), (dt.date(y, 9, 30), y, 3), (dt.date(y, 12, 31), y, 4)]
    _, y, q = min(ends, key=lambda e: abs((e[0] - d).days))
    return f'CY{y}Q{q}I'


def year_before(day):
    d = _date(day)
    try:
        return d.replace(year=d.year - 1)
    except ValueError:  # Feb 29
        return d.replace(year=d.year - 1, day=28)


def _near(a, b, days):
    return abs((_date(a) - _date(b)).days) <= days


def split_like(ratio):
    """True when shares moved by about a usual split ratio (2-for-1, 1-for-10...): a split, not shares issued or bought
    back. Only asked when the two years come from different filings."""
    if ratio <= 0:
        return True
    return any(abs(ratio / n - 1) <= SPLIT_TOLERANCE or abs(ratio * n - 1) <= SPLIT_TOLERANCE for n in SPLIT_FACTORS)


def compact(frame):
    """The frames API reply -> {cik: [value, end, accession]} (only what the ranking reads)."""
    return {int(r['cik']): [r['val'], r['end'], r.get('accn', '')] for r in frame.get('data', []) if r.get('val') is not None}


def company_rows(dur, rev, rev_prev, instants, shares=None, shares_prev=None, rnd=None):
    """Every company's figures for one fiscal year.

    dur: {key: {cik: [val, end, accn]}} for the DURATION keys in the year;
    rev / rev_prev: {tag: {cik: [...]}}; instants: {concept: {frame label: {cik: [...]}}};
    shares / shares_prev: {tag: {cik: [...]}} weighted-average shares this year and last (SHARES_TAGS);
    rnd: {tag: {cik: [...]}} research and development (RND_TAGS).
    Returns {cik: {end, accn, gp, op, ni, cfo, rnd, rev, revTag, revPrev, assets, assetsPrev, inventory, inventoryPrev,
    shares, sharesPrev, sharesOneFiling, sharesTag, rndTag}}.
    """
    out = {}
    anchors = set(dur.get('ni', {})) | set(dur.get('cfo', {}))
    for cik in anchors:
        anchor = dur.get('ni', {}).get(cik) or dur['cfo'][cik]
        end = anchor[1]
        row = {'end': end, 'accn': anchor[2]}
        for k in DURATION:
            v = dur.get(k, {}).get(cik)
            row[k] = v[0] if v and _near(v[1], end, BALANCE_DAYS) else None
        # revenue: the first tag (contract revenue net of sales taxes, the line Research shows), unless the other is
        # more than PARTIAL_REVENUE times it: then the first holds only part of revenue (a bank's fees, say); growth
        # only from that same tag, so it never mixes two definitions
        row['rev'] = row['revTag'] = row['revPrev'] = None
        options = {}
        for tag in REVENUE_TAGS:
            v = rev.get(tag, {}).get(cik)
            if v and _near(v[1], end, BALANCE_DAYS):
                p = rev_prev.get(tag, {}).get(cik)
                options[tag] = (v[0], p[0] if p and _near(p[1], year_before(end), YEAR_DAYS) else None)
        if options:
            first, *rest = [t for t in REVENUE_TAGS if t in options]
            tag = first
            for other in rest:
                if options[first][0] > 0 and options[other][0] > PARTIAL_REVENUE * options[first][0]:
                    tag = other
            row['revTag'] = tag
            row['rev'], row['revPrev'] = options[tag]
        prev_end = year_before(end)
        for key, concept in (('assets', 'assets'), ('inventory', 'inventory')):
            frames = instants.get(concept, {})
            now = frames.get(quarter_frame(end), {}).get(cik)
            before = frames.get(quarter_frame(prev_end), {}).get(cik)
            row[key] = now[0] if now and _near(now[1], end, BALANCE_DAYS) else None
            row[key + 'Prev'] = before[0] if before and _near(before[1], prev_end, BALANCE_DAYS) else None
        # shares: the first tag with both years (diluted before basic), else the first with this year only
        row['shares'] = row['sharesPrev'] = row['sharesOneFiling'] = row['sharesTag'] = None
        found = []
        for tag in SHARES_TAGS:
            now = (shares or {}).get(tag, {}).get(cik)
            if now and _near(now[1], end, BALANCE_DAYS):
                before = (shares_prev or {}).get(tag, {}).get(cik)
                found.append((tag, now, before if before and _near(before[1], prev_end, YEAR_DAYS) else None))
        if found:
            tag, now, before = next((f for f in found if f[2]), found[0])
            row['sharesTag'], row['shares'] = tag, now[0]
            if before:
                row['sharesPrev'] = before[0]
                row['sharesOneFiling'] = bool(now[2]) and now[2] == before[2]
        row['rnd'] = row['rndTag'] = None
        for tag in RND_TAGS:
            v = (rnd or {}).get(tag, {}).get(cik)
            if v and _near(v[1], end, BALANCE_DAYS):
                row['rnd'], row['rndTag'] = v[0], tag
                break
        out[cik] = row
    return out


def _avg(a, b):
    return (a + b) / 2 if a is not None and b is not None else None


def readings(r):
    """The readings for one company's row (None where an input is missing or a denominator isn't positive)."""
    assets, prev = r.get('assets'), r.get('assetsPrev')
    avg = _avg(assets, prev)
    rev, rev0 = r.get('rev'), r.get('revPrev')
    sales_growth = rev / rev0 - 1 if rev is not None and rev0 and rev0 > 0 else None
    inv, inv0 = r.get('inventory'), r.get('inventoryPrev')
    inv_growth = inv / inv0 - 1 if inv is not None and inv0 and inv0 > 0 else None
    sh, sh0 = r.get('shares'), r.get('sharesPrev')
    issuance = math.log(sh / sh0) if sh and sh0 and sh > 0 and sh0 > 0 and (r.get('sharesOneFiling') or not split_like(sh / sh0)) else None
    rnd = r.get('rnd')
    return {
        'grossProfitability': r['gp'] / assets if r.get('gp') is not None and assets and assets > 0 else None,
        'operatingMargin': r['op'] / rev if r.get('op') is not None and rev and rev > 0 else None,
        'returnOnAssets': r['ni'] / avg if r.get('ni') is not None and avg and avg > 0 else None,
        'salesGrowth': sales_growth,
        'assetGrowth': assets / prev - 1 if assets is not None and prev and prev > 0 else None,
        'accruals': (r['ni'] - r['cfo']) / avg if r.get('ni') is not None and r.get('cfo') is not None and avg and avg > 0 else None,
        'inventoryVsSales': inv_growth - sales_growth if inv_growth is not None and sales_growth is not None else None,
        'shareIssuance': issuance,
        'rdIntensity': rnd / rev if rnd is not None and rnd >= 0 and rev and rev > 0 else None,
    }


def quantile(values, q):
    """Linear-interpolated quantile of an already sorted list (q 0-1); None for an empty list."""
    if not values:
        return None
    pos = (len(values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)


def in_field(r):
    """Total assets of at least MIN_ASSETS at the year-end (a company without a dated balance is out)."""
    return r.get('assets') is not None and r['assets'] >= MIN_ASSETS


def field(rows):
    """{metric: sorted values} over the companies in the field, plus every company's readings ({cik: readings})."""
    per = {}
    by_metric = {m: [] for m in METRICS}
    for cik, r in rows.items():
        x = readings(r)
        per[cik] = x
        if not in_field(r):
            continue
        for m, v in x.items():
            if v is not None:
                by_metric[m].append(v)
    for v in by_metric.values():
        v.sort()
    return by_metric, per


def rank(by_metric, mine, member):
    """Where `mine` ({metric: value}) sits among the field: percentile against the others, their count and quartiles.
    member: the company is itself in the field, so its own value is taken out once (never another company's)."""
    import bisect
    out = {}
    for m in METRICS:
        v = mine.get(m)
        values = by_metric.get(m, [])
        if v is None or not values:
            out[m] = None
            continue
        others = values
        i = bisect.bisect_left(values, v)
        if member and i < len(values) and values[i] == v:
            others = values[:i] + values[i + 1:]
        if not others:
            out[m] = None
            continue
        out[m] = {'value': v, 'percentile': ratesdesk.percentile_rank(others, v), 'n': len(others),
                  'p25': quantile(others, 0.25), 'median': quantile(others, 0.5), 'p75': quantile(others, 0.75)}
    return out


#: calendar years tried, newest first: last year, then up to two before it
YEARS_TRIED = 3


def pick_year(today, ni_rows):
    """The newest calendar year whose net-income frame has filled up (ni_rows: {year: row count}), only among the
    years counted; None when none has."""
    for y in range(today.year - 1, today.year - 1 - YEARS_TRIED, -1):
        if ni_rows.get(y, 0) >= MIN_FRAME_ROWS:
            return y
    return None


def sources(year, end, tags):
    """The SEC frames one company's figures came from: [{label, url}] (its own revenue, shares and R&D tags, and the
    quarter files holding its year-end balances)."""
    out = []

    def add(tag, period, unit='USD'):
        out.append({'label': f'{tag} {period}', 'url': FRAME_URL.format(tag=tag, unit=unit, period=period)})
    for tag in DURATION.values():
        add(tag, f'CY{year}')
    if tags.get('rev'):
        add(tags['rev'], f'CY{year}')
        add(tags['rev'], f'CY{year - 1}')
    for concept in INSTANT.values():
        add(concept, quarter_frame(end))
        add(concept, quarter_frame(year_before(end)))
    if tags.get('shares'):
        add(tags['shares'], f'CY{year}', 'shares')
        add(tags['shares'], f'CY{year - 1}', 'shares')
    if tags.get('rnd'):
        add(tags['rnd'], f'CY{year}')
    return out


# ---------- downloads ----------

async def _frame(ctx, tag, period, unit='USD'):
    """One frame, compacted and saved for a week ({} when the SEC has none for that period)."""
    async def load():
        try:
            r = await sec.sec_get(ctx, FRAME_URL.format(tag=tag, unit=unit, period=period))
        except EngineError as e:
            if 'no data' in str(e):
                return {}
            raise
        return {str(k): v for k, v in compact(r.json()).items()}
    key = ('sec-frame', tag, period) if unit == 'USD' else ('sec-frame', tag, period, unit)
    got = await ctx.cached(key, FRAME_TTL, load, persist=True, stale_ok=True)
    return {int(k): v for k, v in got.items()}


async def _year_rows(ctx, year):
    # (kind, key, tag, period, unit): one table, so every frame lands under its own kind and key
    names = [('dur', k, tag, f'CY{year}', 'USD') for k, tag in DURATION.items()]
    names += [('rev', t, t, f'CY{year}', 'USD') for t in REVENUE_TAGS] + [('revPrev', t, t, f'CY{year - 1}', 'USD') for t in REVENUE_TAGS]
    names += [('rnd', t, t, f'CY{year}', 'USD') for t in RND_TAGS]
    names += [('shares', t, t, f'CY{year}', 'shares') for t in SHARES_TAGS] + [('sharesPrev', t, t, f'CY{year - 1}', 'shares') for t in SHARES_TAGS]
    got = await asyncio.gather(*(_frame(ctx, tag, period, unit) for _, _, tag, period, unit in names))
    kinds = {k: {} for k in ('dur', 'rev', 'revPrev', 'rnd', 'shares', 'sharesPrev')}
    for (kind, key, _, _, _), frame in zip(names, got):
        kinds[kind][key] = frame
    dur, rev, rev_prev = kinds['dur'], kinds['rev'], kinds['revPrev']
    # the quarters holding everyone's year-ends (and a year earlier): usually five or six
    labels = {}
    for cik in set(dur['ni']) | set(dur['cfo']):
        end = (dur['ni'].get(cik) or dur['cfo'][cik])[1]
        for lab in (quarter_frame(end), quarter_frame(year_before(end))):
            labels[lab] = labels.get(lab, 0) + 1
    # a quarter only a handful of odd year-ends need isn't worth two downloads
    wanted = sorted(lab for lab, n in labels.items() if n >= 20)
    instants = {}
    for concept, tag in INSTANT.items():
        frames = await asyncio.gather(*(_frame(ctx, tag, lab) for lab in wanted))
        instants[concept] = dict(zip(wanted, frames))
    return company_rows(dur, rev, rev_prev, instants, kinds['shares'], kinds['sharesPrev'], kinds['rnd']), wanted


async def _field(ctx, year):
    """The year's field, saved for a day: sorted values per reading, and per company only what the reply needs."""
    async def load():
        rows, quarters = await _year_rows(ctx, year)
        by_metric, per = field(rows)
        companies = {str(k): {'end': r['end'], 'accn': r['accn'], 'assets': r.get('assets'), 'readings': per[k],
                              'tags': {'rev': r.get('revTag'), 'shares': r.get('sharesTag'), 'rnd': r.get('rndTag')}} for k, r in rows.items()}
        return {'byMetric': by_metric, 'companies': companies, 'quarters': quarters}
    return await ctx.cached(('sec-filerrank-v2', year), 24 * 3600, load, persist=True, stale_ok=True)


@handler('research.filerrank')
async def filer_rank(ctx, msg):
    """Where one company's readings sit among every US filer with total assets of $100 million or more."""
    try:
        cik = int(msg.get('cik'))
    except (TypeError, ValueError):
        raise EngineError('research.filerrank needs the company’s SEC number (cik)')
    today = dt.date.today()
    counts, ni = {}, {}
    for y in range(today.year - 1, today.year - 1 - YEARS_TRIED, -1):
        ni[y] = await _frame(ctx, DURATION['ni'], f'CY{y}')
        counts[y] = len(ni[y])
        if counts[y] >= MIN_FRAME_ROWS:
            break
    year = pick_year(today, counts)
    if year is None:
        log.info('filerrank: no filled-up year, net income rows %s', counts)
        if not any(counts.values()):
            raise EngineError('The SEC’s yearly files for every company couldn’t be loaded right now.')
        raise EngineError('The SEC’s yearly files for every company are still filling up (fewer companies than usual have reported), so the ranking isn’t ready yet.')
    data = await _field(ctx, year)
    me = data['companies'].get(str(cik))
    if me is None:
        # a late filer's newest year isn't in this frame yet: the year before, but only when the company is in last
        # year's net-income frame at all (a company filing under IFRS, as many foreign ones do, is in neither)
        before = ni.get(year - 1)
        if before is None:
            before = await _frame(ctx, DURATION['ni'], f'CY{year - 1}')
        if cik not in before:
            before = await _frame(ctx, DURATION['cfo'], f'CY{year - 1}')
        if cik in before:
            older = await _field(ctx, year - 1)
            if str(cik) in older['companies']:
                year, data, me = year - 1, older, older['companies'][str(cik)]
    if me is None:
        return {'year': year, 'company': None, 'metrics': {m: None for m in METRICS}, 'minAssets': MIN_ASSETS}
    member = in_field(me)
    return {
        'year': year,
        'company': {'end': me['end'], 'accn': me['accn'], 'assets': me['assets'], 'small': me['assets'] is not None and me['assets'] < MIN_ASSETS,
                    'noAssets': me['assets'] is None},
        'metrics': rank(data['byMetric'], me['readings'], member),
        'minAssets': MIN_ASSETS,
        'frames': sources(year, me['end'], me.get('tags') or {}),
    }
