"""
Options edge for one stock or ETF, from the Schwab chain and daily prices (all free with the owner's Schwab login).

1. Gamma flip (the "zero-gamma" level desks watch). Dealer gamma exposure is summed over every contract
   (gamma x open interest x 100 x S^2 x 1%, calls +, puts -: the usual assumption that dealers are long the calls
   and short the puts customers trade, which is a simplification and said so). Re-pricing each contract's
   Black-Scholes gamma at other prices (its own implied volatility kept) gives total exposure as a function of the price;
   where it crosses zero is the flip. Above it dealer hedging tends to damp moves, below it to add to them.
2. Implied vs realized volatility. 30-day at-the-money implied volatility (total variance interpolated between the two
   expiries around 30 days) against realized volatility (close-to-close, 20 trading days, annualised); its place among
   the last year's realized readings. The market's own record (NY Fed Staff Report 867, variance risk premia): index
   options usually price more volatility than follows, measured here from $VIX against the S&P 500's next 21 days.
3. Earnings: the move options price in (straddle on the first expiry after the report / price) against the stock's own
   last reactions (close after the report vs close before), with report times from the company's 8-K Item 2.02
   filings on SEC EDGAR. Evidence that straddles over- or under-price is mixed: shown as information, not a signal.

Request (read-only): quant.optedge {symbol}
"""
import asyncio
import datetime as dt
import math
from zoneinfo import ZoneInfo

import numpy as np
from scipy.stats import norm

from . import finnhub, flow, quant, sec, settings
from .core import EngineError, handler

NY = ZoneInfo('America/New_York')
GRID = (0.85, 1.15, 121)  # spot grid for the flip: +-15%, 0.25% apart
RV_DAYS = 20
EARNINGS_ITEM = '2.02'
MAX_REACTIONS = 12


# ---------- pure maths (tested) ----------

def gex_curve(contracts, spot, r, grid=GRID):
    """Total dealer gamma exposure ($ per 1% move) at each price on a grid, from every contract's own IV."""
    rows = [c for c in contracts if c.get('iv') and c['oi'] and c['iv'] > 0]
    if not rows:
        return [], []
    K = np.array([c['strike'] for c in rows], float)
    sig = np.array([c['iv'] / 100 for c in rows], float)
    T = np.array([max(c['dte'], 0.25) / 365 for c in rows], float)
    w = np.array([c['oi'] * (1 if c['type'] == 'call' else -1) for c in rows], float)
    prices = np.linspace(spot * grid[0], spot * grid[1], grid[2])
    S = prices[:, None]
    d1 = (np.log(S / K) + (r + sig * sig / 2) * T) / (sig * np.sqrt(T))
    gamma = norm.pdf(d1) / (S * sig * np.sqrt(T))
    total = (gamma * w).sum(axis=1) * 100 * prices ** 2 * 0.01
    return prices.tolist(), total.tolist()


def flip_level(prices, totals, spot):
    """The price where total gamma exposure crosses zero, nearest to the spot (linear interpolation); None if it never
    crosses on the grid."""
    best = None
    for i in range(1, len(prices)):
        a, b = totals[i - 1], totals[i]
        if a == 0 or (a < 0) != (b < 0):
            x = prices[i - 1] if a == 0 else prices[i - 1] + (prices[i] - prices[i - 1]) * a / (a - b)
            if best is None or abs(x - spot) < abs(best - spot):
                best = x
    return best


def realized_vol(closes, days=RV_DAYS):
    """Annualised close-to-close volatility of the last `days` daily log returns (sample SD x sqrt(252))."""
    if len(closes) < days + 1:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - days, len(closes))]
    m = sum(rets) / days
    return math.sqrt(sum((x - m) ** 2 for x in rets) / (days - 1) * 252)


def rolling_rv(closes, days=RV_DAYS):
    return [realized_vol(closes[: i + 1], days) for i in range(days, len(closes))]


def iv_30(term):
    """30-calendar-day ATM implied volatility from [(days, iv)], by interpolating total variance (iv^2 x t) between the
    expiries either side of 30 days; the nearest one when 30 days isn't bracketed."""
    pts = sorted((d, v) for d, v in term if v and d > 0)
    if not pts:
        return None
    below = [p for p in pts if p[0] <= 30]
    above = [p for p in pts if p[0] >= 30]
    if not below or not above:
        return min(pts, key=lambda p: abs(p[0] - 30))[1]
    (d1, v1), (d2, v2) = below[-1], above[0]
    if d1 == d2:
        return v1
    var = v1 * v1 * d1 + (v2 * v2 * d2 - v1 * v1 * d1) * (30 - d1) / (d2 - d1)
    return math.sqrt(var / 30)


def percentile(value, history):
    vals = [h for h in history if h is not None]
    if value is None or not vals:
        return None
    return sum(1 for h in vals if h <= value) / len(vals)


def vix_premium(vix, spx_closes):
    """VIX (in %) on each day vs the S&P 500's realized volatility over the next 21 sessions. vix and spx_closes are
    aligned lists. Returns the gaps (implied - realized, in vol points) and the share of days implied was higher."""
    gaps = []
    for i in range(len(vix) - 21):
        rv = realized_vol(spx_closes[i: i + 22], 21)
        if rv is not None and vix[i]:
            gaps.append(vix[i] - rv * 100)
    if len(gaps) < 50:
        return None
    gaps_sorted = sorted(gaps)
    return {'days': len(gaps), 'shareHigher': sum(1 for g in gaps if g > 0) / len(gaps), 'medianGap': gaps_sorted[len(gaps) // 2],
            'meanGap': sum(gaps) / len(gaps)}


def report_sessions(filings):
    """8-K Item 2.02 filings -> [(report date, 'after' | 'before' | 'during')] from the EDGAR acceptance time (ET)."""
    out = []
    for f in filings:
        accepted = f.get('accepted') or ''
        try:
            t = dt.datetime.fromisoformat(accepted.replace('Z', '+00:00')).astimezone(NY)
        except ValueError:
            continue
        when = 'after' if t.hour >= 16 else 'before' if (t.hour, t.minute) < (9, 30) else 'during'
        out.append((t.date(), when))
    return out


def reactions(sessions, bars):
    """Close-to-close move across each report: after the close -> next session vs report day; before or during the
    session -> report day vs the session before. bars: [(date, close)] sorted."""
    dates = [d for d, _ in bars]
    out = []
    for day, when in sessions:
        i = next((k for k, d in enumerate(dates) if d >= day), None)
        if i is None:
            continue
        if when == 'after':
            if dates[i] != day:
                i -= 1  # report on a non-trading day: compare the next session with the last one
            if i + 1 >= len(bars) or i < 0:
                continue
            before, after = bars[i][1], bars[i + 1][1]
            react = dates[i + 1]
        else:
            if i == 0:
                continue
            before, after = bars[i - 1][1], bars[i][1]
            react = dates[i]
        out.append({'report': day.isoformat(), 'when': when, 'session': react.isoformat(), 'move': after / before - 1})
    return out


def move_stats(moves):
    a = sorted(abs(m) for m in moves)
    if not a:
        return None
    q = lambda p: a[min(len(a) - 1, int(round(p * (len(a) - 1))))]  # noqa: E731
    return {'count': len(a), 'median': q(0.5), 'p75': q(0.75), 'max': a[-1], 'mean': sum(a) / len(a)}


# ---------- fetching ----------

def earnings_filings(subs, limit=40):
    recent = subs.get('filings', {}).get('recent', {})
    out = []
    for i, form in enumerate(recent.get('form', [])):
        if form != '8-K':
            continue
        items = (recent.get('items') or [''] * (i + 1))[i] or ''
        if EARNINGS_ITEM in items.split(','):
            out.append({'filed': recent['filingDate'][i], 'accepted': (recent.get('acceptanceDateTime') or [''] * (i + 1))[i]})
        if len(out) >= limit:
            break
    return out


async def _earnings(ctx, symbol, bars, contracts, spot):
    past, note = [], ''
    try:
        co = await sec.company(ctx, symbol)
        sessions = report_sessions(earnings_filings(await sec.submissions(ctx, co['cik'])))
        past = reactions(sessions, bars)[:MAX_REACTIONS]
    except Exception as err:  # SEC unreachable or not an operating company (ETFs file no 8-K earnings)
        note = f'No earnings history from SEC ({type(err).__name__}).'
    upcoming = None
    if settings.get('finnhub_key'):
        try:
            cal = await finnhub.earnings(ctx, {'symbol': symbol, 'days': 31})
            ev = next((e for e in cal.get('events', []) if e.get('symbol') == symbol and e.get('date')), None)
            if ev:
                day = dt.date.fromisoformat(ev['date'][:10])
                # the first expiry that includes the reaction session
                cutoff = day + dt.timedelta(days=1 if (ev.get('hour') or '') == 'amc' else 0)
                exps = sorted({c['expiration'] for c in contracts if dt.date.fromisoformat(c['expiration'][:10]) >= cutoff})
                if exps:
                    move = flow.expected_move([c for c in contracts if c['expiration'] == exps[0]], spot)
                    upcoming = {'date': ev['date'][:10], 'hour': ev.get('hour') or '', 'expiration': exps[0], 'implied': move['percent'] if move else None,
                                'straddle': move['amount'] if move else None}
        except Exception:
            upcoming = None
    elif not note:
        note = 'Add a free Finnhub key in Settings to see the next report date and the move options price in for it.'
    return {'past': past, 'stats': move_stats([p['move'] for p in past]), 'upcoming': upcoming, 'note': note}


async def _market_premium(ctx):
    async def load():
        vix, spy = await asyncio.gather(ctx.daily_bars('$VIX', 6), ctx.daily_bars('SPY', 6))
        vix_by = {dt.datetime.fromtimestamp(b['time'], NY).date(): b['close'] for b in vix}
        rows = [(dt.datetime.fromtimestamp(b['time'], NY).date(), b['close']) for b in spy]
        rows = [(d, c, vix_by[d]) for d, c in rows if d in vix_by]
        res = vix_premium([r[2] for r in rows], [r[1] for r in rows])
        return {**res, 'from': rows[0][0].isoformat(), 'to': rows[-1][0].isoformat()} if res else None
    try:
        return await ctx.cached('vix-premium', 12 * 3600, load, persist=True, stale_ok=True)
    except Exception:
        return None


@handler('quant.optedge')
async def optedge(ctx, msg):
    symbol = str(msg.get('symbol') or '').upper().strip()
    if not symbol:
        raise EngineError('Enter a symbol')
    chain, fetched = await flow.chain(ctx, symbol)
    spot = flow._num((chain.get('underlying') or {}).get('last')) or flow._num(chain.get('underlyingPrice'))
    contracts = flow.flatten_chain(chain)
    if not contracts or not spot:
        raise EngineError('No options data for this symbol.')
    rate = flow._num(chain.get('interestRate'))
    r = rate / 100 if rate and 0 < rate < 20 else await quant.risk_free(ctx)
    prices, totals = gex_curve(contracts, spot, r)
    flip = flip_level(prices, totals, spot) if prices else None
    at_spot = totals[len(totals) // 2] if totals else None

    raw = await ctx.daily_bars(symbol, 3)
    bars = [(dt.datetime.fromtimestamp(b['time'], NY).date(), b['close']) for b in raw]
    closes = [c for _, c in bars]
    term = []
    for exp in sorted({c['expiration'] for c in contracts}):
        group = [c for c in contracts if c['expiration'] == exp]
        iv = flow.atm_iv(group, spot)
        term.append((group[0]['dte'], iv / 100 if iv else None))
    iv30 = iv_30(term)
    rv = realized_vol(closes)
    history = rolling_rv(closes[-(252 + RV_DAYS + 1):])
    earnings, market = await asyncio.gather(_earnings(ctx, symbol, bars, contracts, spot), _market_premium(ctx))
    step = len(prices) // 60 or 1
    return {
        'symbol': symbol, 'spot': spot, 'asOf': dt.datetime.fromtimestamp(fetched, dt.timezone.utc).isoformat(timespec='seconds'),
        'gamma': {'flip': flip, 'atSpot': at_spot, 'curve': [{'price': p, 'gex': g} for p, g in list(zip(prices, totals))[::step]],
                  'above': flip is not None and spot > flip},
        'vol': {'iv30': iv30, 'rv20': rv, 'gap': (iv30 - rv) if iv30 is not None and rv is not None else None,
                'ivVsRvYear': percentile(iv30, history), 'rvPercentile': percentile(rv, history),
                'rvHistory': [{'date': bars[len(bars) - len(history) + i][0].isoformat(), 'rv': v} for i, v in enumerate(history) if v is not None]},
        'earnings': earnings, 'market': market,
    }
