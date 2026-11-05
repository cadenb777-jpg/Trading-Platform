"""
Options analytics from the Schwab option chain the helper already loads for Flow (flow.options): our own
Black-Scholes-Merton prices and greeks, implied volatility from each contract's mid price (Newton's method with a
bisection fallback), the volatility smile per expiry, the at-the-money term structure, the expected-move band and
the put/call skew.

Formulas: Black & Scholes (1973), Merton (1973) for a continuous dividend yield; greeks as in Hull, "Options,
Futures, and Other Derivatives", ch. 19. Schwab's options are American: the European formula ignores early exercise,
so deep in-the-money puts (and calls just before an ex-dividend date) can read slightly off. The pure maths here is
tested against Hull's worked examples (helper/tests/test_quant_pack.py).
"""
import datetime as dt
import math
from zoneinfo import ZoneInfo

from scipy.stats import norm

from .core import EngineError, handler

NEW_YORK = ZoneInfo('America/New_York')
MIN_T = 1 / (365 * 24)  # one hour: a contract expiring today still has a little time value
IV_LO, IV_HI = 1e-4, 5.0  # implied volatility search range (0.01% to 500% a year)
SMILE_RANGE = 0.30  # strikes within 30% of the price
GREEK_STRIKES = 15  # strikes shown in the greeks table, centred on the price
MIN_PRICE = 0.05  # option quotes below 5 cents (or with no bid) can't carry a volatility reading


def _d1d2(S, K, T, r, sigma, q):
    v = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + sigma * sigma / 2) * T) / v
    return d1, d1 - v


def price(S, K, T, r, sigma, q=0.0, kind='call'):
    """Black-Scholes-Merton price of a European option (q = continuous dividend yield)."""
    if T <= 0 or sigma <= 0:
        fwd = S * math.exp(-q * max(T, 0)) - K * math.exp(-r * max(T, 0))
        return max(fwd, 0.0) if kind == 'call' else max(-fwd, 0.0)
    d1, d2 = _d1d2(S, K, T, r, sigma, q)
    if kind == 'call':
        return S * math.exp(-q * T) * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    return K * math.exp(-r * T) * norm.cdf(-d2) - S * math.exp(-q * T) * norm.cdf(-d1)


def greeks(S, K, T, r, sigma, q=0.0, kind='call'):
    """Delta, gamma, vega, theta and rho in trader units: vega per 1 volatility point, theta per calendar day,
    rho per 1 percentage point of interest rate. Also the raw yearly figures (`vegaYear`, `thetaYear`, `rhoYear`)."""
    d1, d2 = _d1d2(S, K, T, r, sigma, q)
    sq = math.sqrt(T)
    eq, er, pdf = math.exp(-q * T), math.exp(-r * T), norm.pdf(d1)
    gamma = eq * pdf / (S * sigma * sq)
    vega = S * eq * pdf * sq
    if kind == 'call':
        delta = eq * norm.cdf(d1)
        theta = -S * eq * pdf * sigma / (2 * sq) - r * K * er * norm.cdf(d2) + q * S * eq * norm.cdf(d1)
        rho = K * T * er * norm.cdf(d2)
    else:
        delta = -eq * norm.cdf(-d1)
        theta = -S * eq * pdf * sigma / (2 * sq) + r * K * er * norm.cdf(-d2) - q * S * eq * norm.cdf(-d1)
        rho = -K * T * er * norm.cdf(-d2)
    return {'delta': delta, 'gamma': gamma, 'vega': vega / 100, 'theta': theta / 365, 'rho': rho / 100,
            'vegaYear': vega, 'thetaYear': theta, 'rhoYear': rho}


def implied_vol(target, S, K, T, r, q=0.0, kind='call', tol=1e-8):
    """The volatility that makes the BSM price equal `target`: Newton's method from the Brenner-Subrahmanyam
    starting guess, falling back to bisection when a Newton step leaves the range or vega is tiny (far from the
    money). None when the price is outside what any volatility can give (below intrinsic value or above the
    no-arbitrage bound)."""
    if not (target and S > 0 and K > 0 and T > 0):
        return None
    lo_price, hi_price = price(S, K, T, r, IV_LO, q, kind), price(S, K, T, r, IV_HI, q, kind)
    if target < lo_price - 1e-9 or target > hi_price + 1e-9:
        return None
    sigma = min(max(math.sqrt(2 * math.pi / T) * target / S, 0.05), 2.0)
    for _ in range(50):
        diff = price(S, K, T, r, sigma, q, kind) - target
        if abs(diff) < tol:
            return sigma
        vega = greeks(S, K, T, r, sigma, q, kind)['vegaYear']
        if vega < 1e-8:
            break
        step = sigma - diff / vega
        if not IV_LO < step < IV_HI:
            break
        sigma = step
    lo, hi = IV_LO, IV_HI
    for _ in range(200):
        mid = (lo + hi) / 2
        if price(S, K, T, r, mid, q, kind) > target:
            hi = mid
        else:
            lo = mid
        if hi - lo < 1e-10:
            break
    return (lo + hi) / 2


def year_fraction(expiration, now):
    """Years from `now` (aware datetime) to 4:00 pm New York on the expiration date (YYYY-MM-DD), at least an hour."""
    end = dt.datetime.combine(dt.date.fromisoformat(expiration), dt.time(16, 0), NEW_YORK)
    return max((end - now).total_seconds() / (365 * 86400), MIN_T)


def mid_price(c):
    """Mid of bid and ask when both are quoted; otherwise Schwab's mark, then the last trade."""
    if c.get('bid') and c.get('ask') and c['ask'] >= c['bid']:
        return (c['bid'] + c['ask']) / 2
    return c.get('mark') or c.get('last') or None


def usable_price(c):
    """The mid price when it can carry a volatility reading: a bid above zero (when an ask is quoted) and at least
    MIN_PRICE (quotes of a few cents are mostly rounding). Otherwise None."""
    if c.get('ask') and not c.get('bid'):
        return None
    m = mid_price(c)
    return m if m and m >= MIN_PRICE else None


def _interp(xs, ys, x):
    """Straight-line interpolation over increasing xs; None outside the range."""
    for (x0, y0), (x1, y1) in zip(zip(xs, ys), zip(xs[1:], ys[1:])):
        if x0 <= x <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return None


def smile(contracts, spot, T, r, q):
    """IV by strike for one expiry: our IV for the call and the put at each strike, the out-of-the-money one as the
    smile (puts below the forward price, calls above: the liquid side), and Schwab's own IV for the call and the put
    (schwabCallIv, schwabPutIv; schwabIv is Schwab's out-of-the-money one) for comparison."""
    fwd = spot * math.exp((r - q) * T)
    rows = {}
    for c in contracts:
        if abs(c['strike'] / spot - 1) > SMILE_RANGE:
            continue
        row = rows.setdefault(c['strike'], {'strike': c['strike'], 'callIv': None, 'putIv': None, 'schwabIv': None, 'schwabCallIv': None, 'schwabPutIv': None,
                                            'callDelta': None, 'putDelta': None})
        if c.get('iv'):
            row['schwabCallIv' if c['type'] == 'call' else 'schwabPutIv'] = c['iv'] / 100
        m = usable_price(c)
        iv = implied_vol(m, spot, c['strike'], T, r, q, c['type']) if m else None
        row[f"{c['type']}Iv"] = iv
        if iv:
            row[f"{c['type']}Delta"] = greeks(spot, c['strike'], T, r, iv, q, c['type'])['delta']
        if c.get('iv') and (c['type'] == 'put') == (c['strike'] < fwd):
            row['schwabIv'] = c['iv'] / 100
    out = []
    for k in sorted(rows):
        row = rows[k]
        row['iv'] = (row['putIv'] if k < fwd else row['callIv']) or row['callIv'] or row['putIv']
        if row['iv']:
            out.append(row)
    return out, fwd


def atm_iv(rows, fwd):
    """IV at the forward price, interpolated between the two nearest strikes of the smile."""
    pts = [(r['strike'], r['iv']) for r in rows if r['iv']]
    if not pts:
        return None
    hit = _interp([p[0] for p in pts], [p[1] for p in pts], fwd)
    return hit if hit is not None else min(pts, key=lambda p: abs(p[0] - fwd))[1]


def delta_skew(rows, target=0.25):
    """25-delta risk reversal: IV of the put with delta -0.25 minus IV of the call with delta +0.25 (interpolated
    by delta). Positive = downside protection costs more than upside calls (the usual equity skew)."""
    puts = sorted((r['putDelta'], r['putIv']) for r in rows if r['putIv'] and r['putDelta'] is not None)
    calls = sorted((r['callDelta'], r['callIv']) for r in rows if r['callIv'] and r['callDelta'] is not None)
    p = _interp([d for d, _ in puts], [v for _, v in puts], -target) if len(puts) > 1 else None
    c = _interp([d for d, _ in calls], [v for _, v in calls], target) if len(calls) > 1 else None
    return {'put25': p, 'call25': c, 'riskReversal': p - c if p is not None and c is not None else None}


def moneyness_skew(rows, spot):
    """IV at 90% of the price minus IV at 110% (in volatility points as a fraction)."""
    xs, ys = [r['strike'] for r in rows], [r['iv'] for r in rows]
    lo, hi = _interp(xs, ys, 0.9 * spot), _interp(xs, ys, 1.1 * spot)
    return lo - hi if lo is not None and hi is not None else None


def expected_move(spot, iv, T):
    """One standard deviation of the price at expiry implied by the at-the-money IV (about a 68% band under the
    log-normal assumption), as a band around today's price."""
    if not iv:
        return None
    move = spot * iv * math.sqrt(T)
    return {'amount': move, 'percent': move / spot, 'low': spot * math.exp(-iv * math.sqrt(T)), 'high': spot * math.exp(iv * math.sqrt(T))}


def greek_table(contracts, spot, T, r, q, strikes=GREEK_STRIKES):
    """Price and greeks for the call and the put at the strikes nearest the price. Both use the volatility of the
    out-of-the-money one at that strike: its price is mostly time value, so its IV is the reliable reading, while the
    in-the-money side's small time value makes its own IV noisy. `model` is the BSM price at that volatility."""
    fwd = spot * math.exp((r - q) * T)
    near = sorted({c['strike'] for c in contracts}, key=lambda k: abs(k - spot))[:strikes]
    out = []
    for k in sorted(near):
        here = {c['type']: c for c in contracts if c['strike'] == k}
        ivs = {}
        for kind, c in here.items():
            m = usable_price(c)
            ivs[kind] = implied_vol(m, spot, k, T, r, q, kind) if m else None
        otm = 'put' if k < fwd else 'call'
        iv = ivs.get(otm) or ivs.get('call' if otm == 'put' else 'put')
        row = {'strike': k, 'iv': iv}
        for kind, c in here.items():
            row[kind] = {'mid': mid_price(c), 'iv': iv, 'schwabIv': c['iv'] / 100 if c.get('iv') else None, 'model': price(spot, k, T, r, iv, q, kind) if iv else None,
                         **({key: float(v) for key, v in greeks(spot, k, T, r, iv, q, kind).items()} if iv else {})}
        out.append(row)
    return out


def analytics(contracts, spot, now, r, q, expiration=None, straddles=None):
    """Everything the Options analytics panel shows, from flattened chain contracts (flow.flatten_chain)."""
    expirations = sorted({c['expiration'] for c in contracts})
    if not expirations or not spot:
        raise EngineError('No options data for this symbol.')
    # by default the first expiry at least a week out: the last few days' quotes are mostly pennies and intrinsic value
    week_out = next((e for e in expirations if any(c['dte'] >= 7 for c in contracts if c['expiration'] == e)), expirations[0])
    chosen = expiration if expiration in expirations else week_out
    term, smiles = [], {}
    for exp in expirations[:24]:
        group = [c for c in contracts if c['expiration'] == exp]
        T = year_fraction(exp, now)
        rows, fwd = smile(group, spot, T, r, q)
        smiles[exp] = rows
        iv = atm_iv(rows, fwd)
        term.append({'expiration': exp, 'dte': group[0]['dte'], 'years': T, 'forward': fwd, 'atmIv': iv, 'expectedMove': expected_move(spot, iv, T),
                     'straddle': (straddles or {}).get(exp), 'skew': delta_skew(rows), 'skew90110': moneyness_skew(rows, spot), 'points': len(rows)})
    T = year_fraction(chosen, now)
    return {'spot': spot, 'rate': r, 'divYield': q, 'expiration': chosen, 'expirations': expirations, 'years': T,
            'term': term, 'smile': smiles.get(chosen) or [], 'greeks': greek_table([c for c in contracts if c['expiration'] == chosen], spot, T, r, q)}


@handler('quant.options')
async def options(ctx, msg):
    from . import flow, quant, research
    symbol = str(msg.get('symbol', '')).upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')
    chain, fetched = await flow.chain(ctx, symbol)
    spot = flow._num((chain.get('underlying') or {}).get('last')) or flow._num(chain.get('underlyingPrice'))
    contracts = flow.flatten_chain(chain)
    rate = flow._num(chain.get('interestRate'))
    if rate and 0 < rate < 20:
        r, rate_source = rate / 100, 'Schwab option chain interest rate'
    else:
        r, rate_source = await quant.risk_free(ctx), '3-month Treasury (FRED DGS3MO)'
    quote = await research.quote(ctx, symbol)
    q = (quote.get('divYield') or 0) / 100
    straddles = {}
    for exp in sorted({c['expiration'] for c in contracts}):
        move = flow.expected_move([c for c in contracts if c['expiration'] == exp], spot or 0)
        straddles[exp] = move['amount'] if move else None
    now = dt.datetime.now(dt.timezone.utc)
    out = analytics(contracts, spot, now, r, q, msg.get('expiration'), straddles)
    return {'symbol': symbol, **out, 'asOf': dt.datetime.fromtimestamp(fetched, dt.timezone.utc).isoformat(timespec='seconds'),
            'sources': {'chain': 'Schwab option chain (bid/ask mids)', 'rate': rate_source, 'dividend': 'Schwab quote dividend yield' if q else 'no dividend yield (0%)'}}
