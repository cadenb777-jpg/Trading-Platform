"""
Box-spread rates (read-only): the interest rate the S&P 500 options market charges and pays, expiry by expiry, set
against Treasury bills, SOFR and the E-mini futures' implied financing rate.

A box on SPX (European, cash-settled, $100 a point) is four options on two strikes K1 < K2: long the K1 call, short
the K2 call, long the K2 put, short the K1 put. Whatever the index does, it pays (K2 - K1) x $100 at expiry (put-call
parity; Hull, Options, Futures, and Other Derivatives, ch. 11 "Box spreads"). Its price today is therefore a loan:
buying it lends money, selling it borrows. Research: van Binsbergen, Diamond and Grotteria, "Risk-free interest
rates", Journal of Financial Economics 143 (2022) 1-29, measure these rates and find them above Treasury yields of the
same length (Treasuries carry a "convenience yield"), which is what a lender in boxes picks up.

Rates here are simple and annualised on calendar days / 365 (the bond-equivalent basis of the Treasury curve on
FRED), so they compare directly: lend = what buying the box pays if you pay the asks and hit the bids (worst case),
mid = at the middle of every quote, borrow = what selling it costs at the other side. Costs per contract (broker +
exchange) are an estimate the page states; nothing here places orders.
"""
import asyncio
import datetime as dt
import math
import time
from zoneinfo import ZoneInfo

from . import datahub, flow, futures_market, macro
from .core import EngineError, handler

NY = ZoneInfo('America/New_York')
SYMBOL = '$SPX'
MULT = 100
#: broker commission + exchange fee per SPX contract, an estimate (the page says so); 4 contracts per box
FEE_PER_CONTRACT = 1.20
MIN_DAYS, MAX_DAYS = 7, 800
#: Treasury curve points (FRED constant maturity, bond-equivalent yields) and their length in days
BILLS = [('DGS1MO', 30), ('DGS3MO', 91), ('DGS6MO', 182), ('DGS1', 365), ('DGS2', 730)]


def _ok(*xs):
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in xs)


def annual_rate(payoff, price, days):
    """Simple annual rate (days/365) that turns `price` today into `payoff` at expiry; None for nonsense."""
    if not _ok(payoff, price, days) or price <= 0 or days < 1 or payoff <= 0:
        return None
    return (payoff / price - 1) * 365 / days


def box_prices(c1, c2, p1, p2):
    """What the box costs to buy (asks of the two longs, bids of the two shorts), its mid, and what selling it brings
    (bids of the longs, asks of the shorts). Each leg is {bid, ask}; None when a needed quote is missing."""
    legs = (c1, c2, p1, p2)
    if any(not leg or not _ok(leg.get('bid'), leg.get('ask')) or leg['ask'] < leg['bid'] for leg in legs):
        return None
    buy = c1['ask'] - c2['bid'] + p2['ask'] - p1['bid']
    sell = c1['bid'] - c2['ask'] + p2['bid'] - p1['ask']
    mid = (c1['bid'] + c1['ask'] - c2['bid'] - c2['ask'] + p2['bid'] + p2['ask'] - p1['bid'] - p1['ask']) / 2
    return {'buy': buy, 'mid': mid, 'sell': sell}


def box_rates(width, prices, days, fee=FEE_PER_CONTRACT):
    """Lend / mid / borrow rates for one box of `width` points, after 4 contracts of fees (paid on the way in)."""
    cost = 4 * fee / MULT  # in index points
    lend = annual_rate(width, prices['buy'] + cost, days)
    mid = annual_rate(width, prices['mid'] + cost, days)
    # selling: you receive the price less fees today and pay `width` at expiry
    borrow = annual_rate(width, prices['sell'] - cost, days)
    return {'lend': lend, 'midRate': mid, 'borrow': borrow}


def pick_box(contracts):
    """The widest pair of strikes where both strikes have a call and a put quoted on both sides (bid > 0): a wider box
    spreads the four bid-ask spreads over more dollars. contracts = flow.flatten_chain rows of ONE expiry."""
    by = {}
    for c in contracts:
        # SPX (AM-settled, the monthly) only: SPXW (PM-settled) shares dates and strikes, and a box mixing the two
        # settles on two different prices, so it isn't risk-free
        if (c.get('symbol') or '').split(' ')[0] != 'SPX':
            continue
        if c['bid'] > 0 and c['ask'] >= c['bid']:
            by.setdefault(c['strike'], {})[c['type']] = c
    full = sorted(k for k, v in by.items() if 'call' in v and 'put' in v)
    if len(full) < 2:
        return None
    k1, k2 = full[0], full[-1]
    return {'k1': k1, 'k2': k2, 'c1': by[k1]['call'], 'c2': by[k2]['call'], 'p1': by[k1]['put'], 'p2': by[k2]['put']}


def bill_rate(curve, days):
    """The Treasury yield for `days` by straight-line interpolation between FRED's constant-maturity points
    (curve = [(days, rate)]); the nearest end beyond them. None without data."""
    pts = sorted((d, r) for d, r in curve if _ok(r))
    if not pts:
        return None
    if days <= pts[0][0]:
        return pts[0][1]
    for (d0, r0), (d1, r1) in zip(pts, pts[1:]):
        if days <= d1:
            return r0 + (r1 - r0) * (days - d0) / (d1 - d0)
    return pts[-1][1]


def is_monthly(expiration):
    """The standard monthly SPX expiry (third Friday, or the Thursday before when that Friday is a market holiday): the
    deepest quotes. Weeklies and dailies are left out."""
    d = dt.date.fromisoformat(expiration)
    third_friday = futures_market.nth_weekday(d.year, d.month, 4, 3)
    return d == third_friday or (not datahub.is_trading_day(third_friday) and d == third_friday - dt.timedelta(days=1))


def simple_basis(cmt, days):
    """A constant-maturity Treasury yield as a simple rate over `days` (days/365). Points past 6 months are coupon
    yields compounded twice a year: (1 + y/2)^(2t) - 1 over t. A box's simple rate compares with this, not the quote."""
    t = days / 365
    return cmt if days <= 182 else ((1 + cmt / 2) ** (2 * t) - 1) / t


def expiry_rows(contracts, today, curve, fee=FEE_PER_CONTRACT):
    rows = []
    for exp in sorted({c['expiration'] for c in contracts}):
        days = (dt.date.fromisoformat(exp) - today).days
        if not (MIN_DAYS <= days <= MAX_DAYS) or not is_monthly(exp):
            continue
        box = pick_box([c for c in contracts if c['expiration'] == exp])
        if not box:
            continue
        width = box['k2'] - box['k1']
        prices = box_prices(box['c1'], box['c2'], box['p1'], box['p2'])
        if not prices:
            continue
        rates = box_rates(width, prices, days, fee)
        bill = bill_rate(curve, days)
        row = {'expiration': exp, 'days': days, 'k1': box['k1'], 'k2': box['k2'], 'width': width, 'notional': width * MULT,
               'buyPrice': prices['buy'], 'midPrice': prices['mid'], 'sellPrice': prices['sell'], **rates, 'bill': bill, 'feeUsd': 4 * fee}
        row['lendVsBillBp'] = (rates['lend'] - bill) * 10000 if rates['lend'] is not None and bill is not None else None
        row['midVsBillBp'] = (rates['midRate'] - bill) * 10000 if rates['midRate'] is not None and bill is not None else None
        # dollars more (or less) than a T-bill of the same length, per $100,000 lent at the mid
        row['extraPer100k'] = (rates['midRate'] - bill) * 100000 * days / 365 if rates['midRate'] is not None and bill is not None else None
        rows.append(row)
    return rows


async def _curve(ctx):
    """FRED's Treasury curve points on the boxes' simple basis, fetched at once (FRED allows 8 at a time)."""
    got = await asyncio.gather(*(macro.fred(ctx, series) for series, _ in BILLS), return_exceptions=True)
    out, dates = [], []
    for (series, days), rows in zip(BILLS, got):
        if isinstance(rows, Exception) or not rows:
            continue
        out.append((days, simple_basis(rows[-1][1] / 100, days)))
        dates.append(rows[-1][0])
    return out, max(dates) if dates else None


@handler('rates.box')
async def box(ctx, msg):
    """SPX box-spread lend / mid / borrow rates per monthly expiry, the Treasury yield of the same length and SOFR.
    Worked out at most every 10 minutes (box rates move slowly; the full SPX chain is large)."""
    async def load():
        today = dt.datetime.now(NY).date()
        try:
            chain, fetched = await flow.chain(ctx, SYMBOL)
        except EngineError:
            raise
        except Exception as err:
            raise EngineError(f'Schwab’s SPX option chain couldn’t be loaded ({type(err).__name__}).') from err
        (curve, curve_date), sofr_rows = await asyncio.gather(_curve(ctx), _safe_fred(ctx, 'SOFR'))
        sofr = datahub.envelope(sofr_rows[-1][1] / 100 * 365 / 360, 'fred', sofr_rows[-1][0]) if sofr_rows else None
        contracts = flow.flatten_chain(chain)
        spot = flow._num((chain.get('underlying') or {}).get('last')) or flow._num(chain.get('underlyingPrice'))
        out = expiry_rows(contracts, today, curve)
        return {'rows': out, 'spot': spot, 'chainAt': fetched, 'asOf': time.time(),
                'curve': [{'days': d, 'rate': r} for d, r in curve], 'curveDate': curve_date, 'sofr': sofr,
                'feePerContract': FEE_PER_CONTRACT,
                'note': None if out else 'Schwab’s chain had no monthly SPX expiry with all four quotes at two strikes.'}
    return await ctx.cached(('schwab', 'rates-box'), 600, load)


async def _safe_fred(ctx, series):
    try:
        return await macro.fred(ctx, series)
    except Exception:
        return None
