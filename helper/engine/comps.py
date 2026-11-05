"""
Comparable companies (Research > Valuation > Comparables): the trading multiples of companies in the same SEC
industry (SIC code), from free SEC XBRL statements and Schwab prices. The browser works out the median/mean, the
implied value range and the football field (src/research/comps.ts), so the owner can drop a peer and see it change.

Peers: the companies the SEC lists under the same 4-digit SIC code (EDGAR company browse), closest in revenue first
(XBRL frames: one file with every filer's yearly revenue). When the SEC list can't be read, the Nasdaq-100 members in
the same sector are used, and the owner can always type their own peers.
"""
import asyncio
import datetime as dt
import math
import re

from . import invest, research, sec
from .core import EngineError, handler

BROWSE_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC={sic}&type=10-K&owner=include&count=100&output=atom'
FRAMES_URL = 'https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/CY{year}.json'
REVENUE_TAGS = ('Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax')
MAX_PEERS = 8
MAX_TYPED = 12


def _div(a, b):
    """a / b, or None when either is missing or b isn't positive (a multiple over a loss means nothing)."""
    return a / b if a is not None and b is not None and b > 0 else None


def _last(values):
    xs = [x for x in values if x is not None]
    return xs[-1] if xs else None


def metrics(core, price):
    """Trading multiples, growth and margins for one company from research.company_core(...) and its share price. Pure.
    EV = market cap + long-term debt - cash and short-term investments (the same definition as Research)."""
    st = core['statements']
    annual, quarterly = st['annual'], st['quarterly']
    t = {k: research.ttm(quarterly, annual, k) for k in ('revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'dna', 'epsDiluted', 'equity')}
    shares = core.get('shares') or research.ttm(quarterly, annual, 'dilutedShares')
    debt = research.ttm(quarterly, annual, 'longTermDebt') or 0
    cash = (research.ttm(quarterly, annual, 'cash') or 0) + (research.ttm(quarterly, annual, 'shortInvestments') or 0)
    cap = price * shares if price and shares else None
    ev = cap + debt - cash if cap is not None else None
    ebitda = t['operatingIncome'] + (t['dna'] or 0) if t['operatingIncome'] is not None else None
    rev = annual['values']['revenue']
    growth = None
    pairs = [(a, b) for a, b in zip(rev, rev[1:]) if a and b is not None]
    if pairs and pairs[-1][0] > 0:
        growth = pairs[-1][1] / pairs[-1][0] - 1
    return {
        'price': price, 'shares': shares, 'marketCap': cap, 'enterpriseValue': ev, 'debt': debt, 'cash': cash,
        'revenue': t['revenue'], 'ebitda': ebitda, 'netIncome': t['netIncome'], 'equity': t['equity'], 'eps': t['epsDiluted'],
        'evEbitda': _div(ev, ebitda), 'pe': _div(price, t['epsDiluted']) if price else None, 'ps': _div(cap, t['revenue']),
        'pb': _div(cap, t['equity']), 'evSales': _div(ev, t['revenue']),
        'revenueGrowth': growth, 'grossMargin': _div(t['grossProfit'], t['revenue']), 'operatingMargin': _div(t['operatingIncome'], t['revenue']) if t['operatingIncome'] is not None else None,
        'netMargin': _div(t['netIncome'], t['revenue']) if t['netIncome'] is not None else None,
        'fiscalYear': (annual['periods'] or [''])[-1],
    }


def parse_browse(text):
    """CIK numbers in an EDGAR company-list Atom feed, in feed order, without repeats."""
    seen, out = set(), []
    for m in re.finditer(r'<cik>\s*(\d+)\s*</cik>|cik=(\d+)', text, re.I):
        cik = int(m.group(1) or m.group(2))
        if cik not in seen:
            seen.add(cik)
            out.append(cik)
    return out


def closest_by_revenue(target_rev, candidates, revenues, limit=MAX_PEERS):
    """Candidates sorted by how close their revenue is to the target's (on a log scale: 2x bigger and 2x smaller are
    equally far); those without a revenue figure go last, in their original order."""
    def key(item):
        i, cik = item
        r = revenues.get(cik)
        if not r or r <= 0 or not target_rev or target_rev <= 0:
            return (1, i)
        return (0, abs(math.log(r / target_rev)))
    return [c for _, c in sorted(enumerate(candidates), key=key)][:limit]


async def _revenues(ctx):
    """{cik: last full calendar year's revenue} for every filer, from the XBRL frames (largest of the two common tags)."""
    year = dt.date.today().year - 1

    async def load():
        out = {}
        for tag in REVENUE_TAGS:
            try:
                data = await sec._json(ctx, FRAMES_URL.format(tag=tag, year=year))
            except Exception:
                try:
                    data = await sec._json(ctx, FRAMES_URL.format(tag=tag, year=year - 1))
                except Exception:
                    continue
            for row in data.get('data') or []:
                cik, val = int(row.get('cik') or 0), row.get('val')
                if cik and isinstance(val, (int, float)):
                    out[cik] = max(out.get(cik, 0), val)
        return out
    return await ctx.cached(('sec-revenue-frames', year), 7 * 86400, load, persist=True, stale_ok=True)


async def find_peers(ctx, symbol, cik, sic, target_rev):
    """(peer tickers, how they were found)."""
    tickers = await sec.tickers(ctx)
    by_cik = {}
    for t, row in tickers.items():
        # one ticker per company: the shortest (class A over the preferred lines)
        if row['cik'] not in by_cik or len(t) < len(by_cik[row['cik']]):
            by_cik[row['cik']] = t
    if sic:
        try:
            async def load():
                return parse_browse((await sec.sec_get(ctx, BROWSE_URL.format(sic=sic))).text)
            ciks = await ctx.cached(('sec-sic-list', sic), 7 * 86400, load, persist=True, stale_ok=True)
            ciks = [c for c in ciks if c != cik and c in by_cik]
            if ciks:
                try:
                    revenues = await _revenues(ctx)
                except Exception:
                    revenues = {}
                chosen = closest_by_revenue(target_rev, ciks, revenues)
                return [by_cik[c] for c in chosen], f'SEC companies with SIC {sic}, closest in revenue'
        except Exception:
            pass
    from . import scanner  # only for this fallback
    sector = scanner.SECTORS.get(symbol)
    if sector:
        same = [s for s in scanner.NASDAQ_100 if scanner.SECTORS.get(s) == sector and s != symbol][:MAX_PEERS]
        return same, f'Nasdaq-100 {sector.lower()} companies (the SEC industry list could not be read)'
    return [], 'none found: type your own peers'


@handler('quant.comps')
async def comps(ctx, msg):
    symbol = str(msg.get('symbol', '')).upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')
    info = await sec.company(ctx, symbol)
    subs, core = await asyncio.gather(sec.submissions(ctx, info['cik']), research.company_core(ctx, info['cik']))
    sic = str(subs.get('sic') or '').strip()
    typed = [str(s).upper().strip() for s in (msg.get('peers') or []) if str(s).strip()][:MAX_TYPED] if isinstance(msg.get('peers'), list) else []
    if typed:
        peers, how = [p for p in dict.fromkeys(typed) if p != symbol], 'your list'
    else:
        target_rev = research.ttm(core['statements']['quarterly'], core['statements']['annual'], 'revenue')
        peers, how = await find_peers(ctx, symbol, info['cik'], sic, target_rev)
    quotes = await invest.quotes(ctx, [symbol, *peers])

    async def one(t):
        try:
            found = await sec.company(ctx, t)
            c = await research.company_core(ctx, found['cik'])
            return {'symbol': t, 'name': found['name'], **metrics(c, (quotes.get(t) or {}).get('price'))}
        except Exception as err:
            return {'symbol': t, 'error': str(err) or type(err).__name__}
    rows = await asyncio.gather(*(one(p) for p in peers))
    target = {'symbol': symbol, 'name': subs.get('name') or info['name'], **metrics(core, (quotes.get(symbol) or {}).get('price'))}
    return {'symbol': symbol, 'sic': sic, 'industry': subs.get('sicDescription') or '', 'peerSource': how,
            'target': target, 'peers': [r for r in rows if 'error' not in r], 'failed': [r for r in rows if 'error' in r],
            'asOf': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            'sources': 'SEC EDGAR XBRL statements (trailing 12 months), Schwab prices'}
