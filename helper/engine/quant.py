"""
Portfolio analytics, risk and optimisation from daily prices (Schwab history), using numpy/scipy.
"""
import asyncio
import datetime as dt

import numpy as np
from scipy.optimize import minimize

from . import macro
from .core import EngineError, handler

TRADING_DAYS = 252
STRESS_WINDOWS = [
    ('2008 financial crisis', '2007-10-09', '2009-03-09'),
    ('2011 debt-ceiling scare', '2011-04-29', '2011-10-03'),
    ('2015–16 China/oil selloff', '2015-07-20', '2016-02-11'),
    ('2018 Q4 selloff', '2018-09-20', '2018-12-24'),
    ('2020 COVID crash', '2020-02-19', '2020-03-23'),
    ('2022 rate-hike bear market', '2022-01-03', '2022-10-12'),
    ('2025 tariff shock', '2025-02-19', '2025-04-08'),
]
REBALANCE = {'none', 'monthly', 'quarterly', 'yearly'}


def _date(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()


async def price_matrix(ctx, symbols, years=20, with_dividends=True):
    """Aligned daily values over the dates every symbol traded: (dates, matrix[days, assets], info).

    With dividends (from Yahoo) the matrix is a total-return index (dividends reinvested on the ex-date),
    otherwise plain closing prices. info has the last prices and which symbols include dividends."""
    bars_list = await asyncio.gather(*(ctx.daily_bars(s, years) for s in symbols), return_exceptions=True)
    divs_list = await asyncio.gather(*(ctx.dividends(s) for s in symbols)) if with_dividends else [None] * len(symbols)
    series = []
    for symbol, bars in zip(symbols, bars_list):
        if isinstance(bars, Exception):
            raise EngineError(f'{symbol}: {bars}')
        series.append({_date(b['time']): b['close'] for b in bars})
    common = sorted(set.intersection(*(set(s) for s in series)))
    if len(common) < 60:
        raise EngineError('Not enough shared price history for these symbols (need at least 3 months).')
    closes = np.array([[s[d] for s in series] for d in common], dtype=float)
    values = np.column_stack([_with_dividends(common, closes[:, j], divs) for j, divs in enumerate(divs_list)])
    info = {'last': closes[-1].tolist(), 'dividends': [d is not None for d in divs_list]}
    return common, values, info


def _with_dividends(dates, closes, divs):
    """Total-return index from closes: dividends paid between two trading days count on the first day on or after
    their ex-date (reinvested). Plain closes when there are no dividends."""
    if not divs:
        return closes.copy()
    div_on = np.zeros(len(dates))
    k = 0
    for day in sorted(divs):
        while k < len(dates) and dates[k] < day:
            k += 1
        if 0 < k < len(dates):
            div_on[k] += divs[day]
    growth = (closes[1:] + div_on[1:]) / closes[:-1]
    return closes[0] * np.concatenate([[1.0], np.cumprod(growth)])


async def total_return_series(ctx, symbols, years, with_dividends=True):
    """Each symbol's own daily total-return index {date: value} over all the days it traded (not aligned).
    A symbol whose history can't be loaded comes back as None."""
    bars_list = await asyncio.gather(*(ctx.daily_bars(s, years) for s in symbols), return_exceptions=True)
    divs_list = await asyncio.gather(*(ctx.dividends(s) for s in symbols), return_exceptions=True) if with_dividends else [None] * len(symbols)
    out = []
    for bars, divs in zip(bars_list, divs_list):
        if isinstance(bars, Exception) or not bars:
            out.append(None)
            continue
        closes = {_date(b['time']): b['close'] for b in bars}
        dates = sorted(closes)
        values = _with_dividends(dates, np.array([closes[d] for d in dates], dtype=float), None if isinstance(divs, Exception) else divs)
        out.append(dict(zip(dates, values.tolist())))
    return out


async def risk_free(ctx):
    try:
        rows = await macro.fred(ctx, 'DGS3MO')
        return rows[-1][1] / 100
    except Exception:
        return 0.04


def _period_key(d, rebalance):
    if rebalance == 'monthly':
        return (d.year, d.month)
    if rebalance == 'quarterly':
        return (d.year, (d.month - 1) // 3)
    if rebalance == 'yearly':
        return d.year
    return None


def portfolio_returns(dates, prices, weights, rebalance='quarterly'):
    """Daily returns of a portfolio that starts at `weights` and is rebalanced back to them each period."""
    asset_returns = prices[1:] / prices[:-1] - 1
    target = np.asarray(weights, dtype=float)
    target = target / target.sum()
    holdings = target.copy()
    out = np.empty(len(asset_returns))
    for i, r in enumerate(asset_returns):
        grown = holdings * (1 + r)
        total = grown.sum()
        out[i] = total / holdings.sum() - 1
        holdings = grown / total
        if rebalance != 'none' and i + 1 < len(asset_returns) and _period_key(dates[i + 2], rebalance) != _period_key(dates[i + 1], rebalance):
            holdings = target.copy()
    return out


def max_drawdown(returns, dates):
    """Largest fall from a high, with its dates. `dates` has one more entry than `returns` (the start)."""
    wealth = np.concatenate([[1.0], np.cumprod(1 + returns)])
    peaks = np.maximum.accumulate(wealth)
    dd = wealth / peaks - 1
    trough = int(np.argmin(dd))
    peak = int(np.argmax(wealth[: trough + 1]))
    recovered = next((i for i in range(trough, len(wealth)) if wealth[i] >= wealth[peak]), None) if dd[trough] < 0 else trough
    return {
        'maxDrawdown': float(dd.min()),
        'peak': dates[peak].isoformat(),
        'trough': dates[trough].isoformat(),
        'recovered': dates[recovered].isoformat() if recovered is not None else None,
    }, dd[1:]


def annualised(returns, days):
    total = float(np.prod(1 + returns))
    years = days / 365.25
    return total ** (1 / years) - 1 if years >= 1 else total - 1


def trailing(returns, dates, years):
    """Annualised return over the last `years` years (cumulative if under a year); None if history is too short."""
    end = dates[-1]
    start = end - dt.timedelta(days=round(365.25 * years)) if years else dt.date(end.year - 1, 12, 31)
    if dates[0] > start + dt.timedelta(days=7):
        return None
    # Measure from the last close on or before the start date: returns[k] is the return on dates[k + 1], so a
    # return (or a fee) dated on the start day itself (e.g. Dec 31 for year-to-date) belongs to the period before.
    j = max([k for k, d in enumerate(dates) if d <= start] or [0])
    r = returns[j:]
    if years and years >= 1:
        return annualised(r, (end - dates[j]).days)
    return float(np.prod(1 + r) - 1)


def calendar_years(returns, dates):
    out = {}
    for r, d in zip(returns, dates[1:]):
        out[d.year] = out.get(d.year, 1.0) * (1 + r)
    first_full = dates[0].year + (0 if dates[0] <= dt.date(dates[0].year, 1, 7) else 1)
    return {y: v - 1 for y, v in out.items() if y >= first_full or y == dates[-1].year}


def monthly(returns, dates):
    out = {}
    for r, d in zip(returns, dates[1:]):
        out[(d.year, d.month)] = out.get((d.year, d.month), 1.0) * (1 + r)
    return np.array([v - 1 for v in out.values()])


def stats(returns, bench, dates, rf):
    vol = float(returns.std(ddof=1) * np.sqrt(TRADING_DAYS))
    cagr = annualised(returns, (dates[-1] - dates[0]).days)
    downside = returns[returns < 0]
    down_vol = float(np.sqrt((downside ** 2).mean()) * np.sqrt(TRADING_DAYS)) if len(downside) else 0.0
    cov = np.cov(returns, bench)
    beta = float(cov[0, 1] / cov[1, 1]) if cov[1, 1] else None
    bench_cagr = annualised(bench, (dates[-1] - dates[0]).days)
    dd, _ = max_drawdown(returns, dates)
    var95 = float(-np.percentile(returns, 5))
    cvar95 = float(-returns[returns <= -var95].mean()) if (returns <= -var95).any() else var95
    months = monthly(returns, dates)
    tracking = float((returns - bench).std(ddof=1) * np.sqrt(TRADING_DAYS))
    return {
        'cagr': cagr,
        'totalReturn': float(np.prod(1 + returns) - 1),
        'volatility': vol,
        'sharpe': (cagr - rf) / vol if vol else None,
        'sortino': (cagr - rf) / down_vol if down_vol else None,
        **dd,
        'calmar': cagr / -dd['maxDrawdown'] if dd['maxDrawdown'] < 0 else None,
        'beta': beta,
        'alpha': cagr - (rf + (beta or 0) * (bench_cagr - rf)),
        'correlation': float(np.corrcoef(returns, bench)[0, 1]),
        'trackingError': tracking,
        'informationRatio': (cagr - bench_cagr) / tracking if tracking else None,
        'var95': var95,
        'cvar95': cvar95,
        'bestDay': float(returns.max()),
        'worstDay': float(returns.min()),
        'bestMonth': float(months.max()) if len(months) else None,
        'worstMonth': float(months.min()) if len(months) else None,
        'positiveMonths': float((months > 0).mean()) if len(months) else None,
    }


def stress(returns, bench, dates):
    out = []
    for name, start, end in STRESS_WINDOWS:
        s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
        if dates[0] > s or dates[-1] < e:
            out.append({'name': name, 'start': start, 'end': end, 'portfolio': None, 'benchmark': None})
            continue
        mask = np.array([s < d <= e for d in dates[1:]])
        out.append({'name': name, 'start': start, 'end': end,
                    'portfolio': float(np.prod(1 + returns[mask]) - 1), 'benchmark': float(np.prod(1 + bench[mask]) - 1)})
    return out


def risk_contributions(asset_returns, weights):
    cov = np.cov(asset_returns.T) * TRADING_DAYS
    w = np.asarray(weights) / np.sum(weights)
    port_var = float(w @ cov @ w)
    contrib = w * (cov @ w) / port_var if port_var else w
    return contrib, cov


def monte_carlo(returns, dates, years=10, paths=2000, seed=1):
    """Bootstraps past monthly returns into many possible futures; returns percentile paths of $10,000."""
    months = monthly(returns, dates)
    if len(months) < 24:
        return None
    rng = np.random.default_rng(seed)
    draws = rng.choice(months, size=(paths, years * 12), replace=True)
    wealth = 10000 * np.cumprod(1 + draws, axis=1)
    yearly = wealth[:, 11::12]
    pct = {str(p): [10000.0] + np.percentile(yearly, p, axis=0).round(2).tolist() for p in (5, 25, 50, 75, 95)}
    return {'years': years, 'percentiles': pct, 'lossChance': float((yearly[:, -1] < 10000).mean())}


def _sample(dates, values, step):
    idx = list(range(0, len(values), step))
    if idx[-1] != len(values) - 1:
        idx.append(len(values) - 1)
    return [{'time': dates[i].isoformat(), 'value': round(float(values[i]), 4)} for i in idx]


def _clean_holdings(msg):
    holdings = [h for h in msg.get('holdings') or [] if str(h.get('symbol', '')).strip() and float(h.get('weight') or 0) > 0]
    if not holdings:
        raise EngineError('Add at least one holding with a weight above 0.')
    symbols = [str(h['symbol']).upper().strip() for h in holdings]
    if len(set(symbols)) != len(symbols):
        raise EngineError('Each symbol can only appear once.')
    weights = np.array([float(h['weight']) for h in holdings])
    return symbols, weights / weights.sum()


# ---------- Advisory fees (RIA billing) ----------

BILLING_PERIODS = {'monthly': 12, 'quarterly': 4, 'annual': 1}


def blended_rate(value, tiers):
    """Yearly fee in dollars on an account value under a tiered schedule [{upTo: dollars or None, rate: fraction}],
    each rate applying only to the part of the value inside its tier (like income-tax brackets)."""
    fee, prev = 0.0, 0.0
    for t in sorted(tiers, key=lambda t: float('inf') if t.get('upTo') is None else t['upTo']):
        cap = float('inf') if t.get('upTo') is None else float(t['upTo'])
        part = min(max(value - prev, 0.0), cap - prev)
        fee += part * float(t['rate'])
        prev = cap
        if value <= cap:
            break
    return fee


def _period(d, billing):
    return (d.year, (d.month - 1) // 3) if billing == 'quarterly' else (d.year, d.month - 1) if billing == 'monthly' else (d.year, 0)


def _period_bounds(p, billing):
    """First and last calendar day of a billing period."""
    year, idx = p
    if billing == 'annual':
        return dt.date(year, 1, 1), dt.date(year, 12, 31)
    months = 3 if billing == 'quarterly' else 1
    first = dt.date(year, idx * months + 1, 1)
    nxt = dt.date(year + (first.month + months - 1) // 12, (first.month + months - 1) % 12 + 1, 1)
    return first, nxt - dt.timedelta(days=1)


def apply_fees(dates, gross, schedule, initial):
    """Deducts an advisory fee from the account the way custodians debit it: once per billing period (monthly,
    quarterly or yearly), in arrears on the period-end value or in advance on the period-start value, at the
    tiered rate. A first, partial period is prorated by calendar days. The current unfinished period isn't billed
    in arrears yet. Returns (net daily returns, [(date, dollars)])."""
    billing = schedule.get('billing') if schedule.get('billing') in BILLING_PERIODS else 'quarterly'
    advance = schedule.get('timing') == 'advance'
    # Keep 0% tiers: "0% on the first $1M" is a real band. Rates are capped at 5% a year, like the form.
    tiers = [{'upTo': t.get('upTo'), 'rate': min(max(float(t.get('rate') or 0), 0.0), 0.05)} for t in schedule.get('tiers') or []]
    per_year = BILLING_PERIODS[billing]
    days = dates[1:]  # gross[k] is the return on days[k]; the account opens at the close of dates[0]
    periods = [_period(d, billing) for d in days]
    first_p = periods[0] if periods else None

    def fraction(p):
        if p != first_p:
            return 1.0
        lo, hi = _period_bounds(p, billing)
        start = max(lo, dates[0] + dt.timedelta(days=1))
        return max(0.0, min(1.0, ((hi - start).days + 1) / ((hi - lo).days + 1)))

    value, net, events = float(initial), np.empty(len(gross)), []
    for k, r in enumerate(gross):
        start_value = value
        p = periods[k]
        if advance and (k == 0 or periods[k - 1] != p):
            fee = blended_rate(value, tiers) / per_year * fraction(p)
            value -= fee
            events.append((days[k], fee))
        value *= 1 + r
        if not advance and k < len(gross) - 1 and periods[k + 1] != p:
            fee = blended_rate(value, tiers) / per_year * fraction(p)
            value -= fee
            events.append((days[k], fee))
        net[k] = value / start_value - 1
    return net, events


def fee_summary(dates, gross, net, events, initial):
    """Fees paid per calendar year (dollars and % of the average account value) and the total."""
    days = dates[1:]
    values = float(initial) * np.cumprod(1 + net)
    by_year = {}
    for d, fee in events:
        by_year.setdefault(d.year, 0.0)
        by_year[d.year] += fee
    rows = []
    for y in sorted({d.year for d in days}):
        vals = [v for d, v in zip(days, values) if d.year == y]
        avg = float(np.mean(vals)) if vals else 0.0
        paid = by_year.get(y, 0.0)
        rows.append({'year': y, 'fees': round(paid, 2), 'averageValue': round(avg, 2), 'rate': paid / avg if avg else None})
    years = max((dates[-1] - dates[0]).days / 365.25, 1e-9)
    total = sum(f for _, f in events)
    avg_all = float(np.mean(values)) if len(values) else 0.0
    return {'byYear': rows, 'total': round(total, 2), 'initial': float(initial), 'effectiveRate': (total / years) / avg_all if avg_all else None,
            'endValueGross': round(float(initial) * float(np.prod(1 + gross)), 2), 'endValueNet': round(float(values[-1]), 2) if len(values) else None}


@handler('portfolio.analyze')
async def analyze(ctx, msg):
    symbols, weights = _clean_holdings(msg)
    benchmark = str(msg.get('benchmark') or 'SPY').upper()
    rebalance = msg.get('rebalance') if msg.get('rebalance') in REBALANCE else 'quarterly'
    years = int(msg.get('years') or 20)
    all_symbols = symbols + ([benchmark] if benchmark not in symbols else [])
    (dates, prices, info), rf = await asyncio.gather(price_matrix(ctx, all_symbols, years), risk_free(ctx))
    if msg.get('since'):
        since = dt.date.fromisoformat(msg['since'])
        keep = [i for i, d in enumerate(dates) if d >= since]
        if len(keep) < 60:
            raise EngineError('Not enough history after the start date.')
        dates, prices = [dates[i] for i in keep], prices[keep]
    port = portfolio_returns(dates, prices[:, : len(symbols)], weights, rebalance)
    gross = port.copy()
    fee = max(0.0, float(msg.get('fee') or 0))
    schedule = msg.get('feeSchedule') if isinstance(msg.get('feeSchedule'), dict) else None
    initial = float(msg.get('initial') or 0) or 100000.0
    fees = None
    if schedule and any(float(t.get('rate') or 0) > 0 for t in schedule.get('tiers') or []):
        # RIA billing: tiered fee debited from the account each billing period; returns are net of it.
        port, events = apply_fees(dates, gross, schedule, initial)
        fees = fee_summary(dates, gross, port, events, initial)
    elif fee:
        # Simple flat fee taken evenly through the year, so returns are shown net of fees.
        port = (1 + port) * (1 - fee) ** (1 / TRADING_DAYS) - 1
    b = all_symbols.index(benchmark)
    bench = prices[1:, b] / prices[:-1, b] - 1
    asset_returns = prices[1:, : len(symbols)] / prices[:-1, : len(symbols)] - 1
    contrib, cov = risk_contributions(asset_returns, weights)
    _, dd = max_drawdown(port, dates)
    _, bench_dd = max_drawdown(bench, dates)
    step = max(1, len(dates) // 600)
    growth = 10000 * np.concatenate([[1], np.cumprod(1 + port)])
    bench_growth = 10000 * np.concatenate([[1], np.cumprod(1 + bench)])
    periods = [('ytd', 0), ('1y', 1), ('3y', 3), ('5y', 5), ('10y', 10)]
    cal_p, cal_b, cal_g = calendar_years(port, dates), calendar_years(bench, dates), calendar_years(gross, dates)
    asset_stats = []
    for i, s in enumerate(symbols):
        r = asset_returns[:, i]
        asset_stats.append({'symbol': s, 'weight': float(weights[i]), 'riskContribution': float(contrib[i]),
                            'cagr': annualised(r, (dates[-1] - dates[0]).days), 'volatility': float(r.std(ddof=1) * np.sqrt(TRADING_DAYS)),
                            'last': info['last'][i], 'dividends': info['dividends'][i]})
    return {
        'symbols': symbols,
        'benchmark': benchmark,
        'rebalance': rebalance,
        'fee': fee,
        'totalReturn': all(info['dividends']),
        'priceOnly': [s for s, d in zip(all_symbols, info['dividends']) if not d],
        'start': dates[0].isoformat(),
        'end': dates[-1].isoformat(),
        'riskFree': rf,
        'stats': stats(port, bench, dates, rf),
        'benchmarkStats': stats(bench, bench, dates, rf),
        'trailing': {k: {'portfolio': trailing(port, dates, y), 'benchmark': trailing(bench, dates, y)} for k, y in periods}
        | {'inception': {'portfolio': annualised(port, (dates[-1] - dates[0]).days), 'benchmark': annualised(bench, (dates[-1] - dates[0]).days)}},
        'calendar': [{'year': y, 'portfolio': cal_p[y], 'benchmark': cal_b.get(y), 'gross': cal_g.get(y)} for y in sorted(cal_p)],
        'gross': {'trailing': {k: trailing(gross, dates, y) for k, y in periods} | {'inception': annualised(gross, (dates[-1] - dates[0]).days)},
                  'stats': stats(gross, bench, dates, rf)} if (fees or fee) else None,
        'fees': fees,
        'feeSchedule': schedule,
        'growth': _sample(dates, growth, step),
        'benchmarkGrowth': _sample(dates, bench_growth, step),
        'drawdown': _sample(dates[1:], dd, step),
        'benchmarkDrawdown': _sample(dates[1:], bench_dd, step),
        'stress': stress(port, bench, dates),
        'assets': asset_stats,
        'correlation': np.corrcoef(asset_returns.T).round(3).tolist() if len(symbols) > 1 else [[1.0]],
        'monteCarlo': monte_carlo(port, dates),
    }


# ---------- Optimisation ----------
# Robust methods only (no raw historical means): shrunk covariance, risk-based weights and a resampled max-Sharpe on
# returns pulled toward the market equilibrium. Each method is judged by a walk-forward test on data it hadn't seen,
# and the chosen method's edge over the current portfolio by the same test on shuffled histories (random walk).

METHODS = ('risk_parity', 'min_var', 'growth', 'black_litterman')
WINDOW, STEP, BLOCK = 3 * TRADING_DAYS, 63, 21  # fit on 3 years, hold a quarter, 1-month blocks when resampling
HIST_SHARE = 0.3  # expected returns = 70% equilibrium (Black-Litterman prior) + 30% history
RESAMPLES, WF_RESAMPLES, RW_RESAMPLES, RW_RUNS = 200, 10, 3, 100


def ledoit_wolf(returns):
    """Ledoit & Wolf (2004): the sample covariance shrunk toward a scaled identity. Returns (cov, shrinkage 0-1)."""
    x = returns - returns.mean(axis=0)
    t, n = x.shape
    s = x.T @ x / t
    target = np.trace(s) / n * np.eye(n)
    d2 = ((s - target) ** 2).sum()
    # sum over days of ||x x' - S||^2 = sum (x.x)^2 - t ||S||^2
    b2 = (((x ** 2).sum(axis=1) ** 2).sum() / t - (s ** 2).sum()) / t
    delta = min(max(b2, 0.0), d2) / d2 if d2 > 0 else 1.0
    return delta * target + (1 - delta) * s, float(delta)


def _block_sample(t, rng, block=BLOCK):
    """Day indices for a block bootstrap: random 1-month stretches (with replacement) glued to length t."""
    block = min(block, t)
    starts = rng.integers(0, t - block + 1, -(-t // block))
    return (starts[:, None] + np.arange(block)).ravel()[:t]


def _block_shuffle(t, rng, block=BLOCK):
    """Day indices with 1-month blocks put in random order (every day used once): a history with no real order."""
    starts = np.arange(0, t, block)
    rng.shuffle(starts)
    return np.concatenate([np.arange(s, min(s + block, t)) for s in starts])


def _solve(fun, bounds, x0, jac=True):
    lo, hi = np.array(bounds).T
    cons = [{'type': 'eq', 'fun': lambda w: w.sum() - 1, 'jac': lambda w: np.ones_like(w)}]
    res = minimize(fun, np.clip(x0, lo, hi), jac=jac, method='SLSQP', bounds=bounds, constraints=cons, options={'maxiter': 300, 'ftol': 1e-12})
    w = np.clip(res.x, lo, hi)
    return w / w.sum()


def min_variance(cov, bounds):
    return _solve(lambda w: (w @ cov @ w, 2 * cov @ w), bounds, np.full(len(cov), 1 / len(cov)))


def _into_bounds(w, bounds):
    """Clip to the limits and spread what's left over the holdings not at a limit (keeps the shape, sums to 1)."""
    lo, hi = np.array(bounds).T
    for _ in range(len(w) + 1):
        w = np.clip(w, lo, hi)
        free = (w > lo) & (w < hi)
        gap = 1 - w.sum()
        if abs(gap) < 1e-12 or not free.any():
            break
        w[free] += gap * w[free] / w[free].sum()
    return w


def risk_parity(cov, bounds):
    """Equal risk contribution (Spinu's convex form), then fitted into the limits."""
    n = len(cov)
    res = minimize(lambda y: (0.5 * y @ cov @ y - np.log(y).sum() / n, cov @ y - 1 / (n * y)), 1 / np.sqrt(np.diag(cov)),
                   jac=True, method='L-BFGS-B', bounds=[(1e-12, None)] * n)
    return _into_bounds(res.x / res.x.sum(), bounds)


def max_sharpe(excess, cov, bounds):
    if excess.max() <= 0:
        return min_variance(cov, bounds)

    def fun(w):
        a, sd = w @ excess, np.sqrt(w @ cov @ w)
        return -a / sd, -(excess / sd - a * (cov @ w) / sd ** 3)

    return _solve(fun, bounds, np.full(len(cov), 1 / len(cov)))


def black_litterman(cov, prior_weights, views, symbols, delta=2.5, tau=0.05):
    """Blends the market's implied (equilibrium) excess returns with your views ({symbol, return, confidence 0–1})."""
    pi = delta * cov @ prior_weights
    views = [v for v in views if str(v.get('symbol', '')).upper() in symbols]
    if not views:
        return pi
    P = np.zeros((len(views), len(symbols)))
    Q = np.zeros(len(views))
    omega = np.zeros((len(views), len(views)))
    for k, v in enumerate(views):
        P[k, symbols.index(str(v['symbol']).upper())] = 1
        Q[k] = float(v['return'])
        conf = min(0.99, max(0.01, float(v.get('confidence', 0.5))))
        omega[k, k] = (P[k] @ (tau * cov) @ P[k]) * (1 - conf) / conf
    inv = np.linalg.inv
    middle = inv(inv(tau * cov) + P.T @ inv(omega) @ P)
    return middle @ (inv(tau * cov) @ pi + P.T @ inv(omega) @ Q)


def expected_excess(r, cov, rf, views=(), symbols=()):
    """Yearly excess returns: the equal-weight equilibrium (plus any views), nudged 30% toward history."""
    pi = black_litterman(cov, np.full(len(cov), 1 / len(cov)), list(views), list(symbols))
    return (1 - HIST_SHARE) * pi + HIST_SHARE * (r.mean(axis=0) * TRADING_DAYS - rf)


def _bounds(n, lo, hi, cur=None, max_change=None):
    lo, hi = min(lo, 1 / n), max(hi, 1 / n)  # impossible limits are loosened just enough
    lo_b, hi_b = np.full(n, lo), np.full(n, min(hi, 1.0))
    if cur is not None and max_change is not None:
        lo_b, hi_b = np.maximum(lo_b, cur - max_change), np.minimum(hi_b, cur + max_change)
        hi_b = np.maximum(hi_b, lo_b)
        if lo_b.sum() > 1 or hi_b.sum() < 1:
            return _bounds(n, lo, hi)
    return list(zip(lo_b, hi_b))


def fit(r, method, o, rng):
    """Weights from a window of daily returns r (days x assets) and nothing later.

    o: rf, lo, hi, fixed {index: weight} (cash held as is), cur + maxChange (limit each move), views, symbols, runs."""
    n = r.shape[1]
    fixed = o.get('fixed') or {}
    w = np.zeros(n)
    for j, v in fixed.items():
        w[j] = v
    inv = [j for j in range(n) if j not in fixed]
    s = 1 - sum(fixed.values())
    if not inv or s <= 1e-9:
        return w
    if len(inv) == 1:
        w[inv] = s
        return w
    if method == 'equal':
        w[inv] = s / len(inv)
        return w
    cur, mc = o.get('cur'), o.get('maxChange')
    bounds = _bounds(len(inv), o['lo'] / s, o['hi'] / s, None if cur is None else cur[inv] / s, None if mc is None else mc / s)
    sub = r[:, inv]
    cov = ledoit_wolf(sub)[0] * TRADING_DAYS
    if method == 'min_var':
        w[inv] = s * min_variance(cov, bounds)
    elif method == 'risk_parity':
        w[inv] = s * risk_parity(cov, bounds)
    else:  # growth / views: resampled max-Sharpe (Michaud) on equilibrium-shrunk returns
        syms = [o['symbols'][j] for j in inv] if o.get('symbols') else []
        views = o.get('views') or []
        runs = []
        for _ in range(o.get('runs', RESAMPLES)):
            b = sub[_block_sample(len(sub), rng)]
            cb = ledoit_wolf(b)[0] * TRADING_DAYS
            runs.append(max_sharpe(expected_excess(b, cb, o['rf'], views, syms), cb, bounds))
        w[inv] = s * np.mean(runs, axis=0)
    return w


def walk_forward(returns, weigh, window=WINDOW, step=STEP):
    """Refit on the last `window` days, hold the next `step` days (weights drift), move on.

    weigh(past) only ever sees days before its holding period. Returns (out-of-sample daily returns, weights, yearly turnover)."""
    t = len(returns)
    out, ws, turnover, held = [], [], 0.0, None
    for s in range(window, t, step):
        w = weigh(returns[s - window:s])
        if held is not None:
            turnover += np.abs(w - held).sum() / 2
        seg = np.cumprod(1 + returns[s:s + step], axis=0)
        value = seg @ w
        out.append(value / np.concatenate([[1.0], value[:-1]]) - 1)
        held = seg[-1] * w / value[-1]
        ws.append(w)
    port = np.concatenate(out)
    return port, ws, turnover / (len(port) / TRADING_DAYS)


def oos_stats(port, rf):
    growth = np.concatenate([[1.0], np.cumprod(1 + port)])
    cagr = growth[-1] ** (TRADING_DAYS / len(port)) - 1
    vol = float(port.std() * np.sqrt(TRADING_DAYS))
    return {'return': float(cagr), 'volatility': vol, 'maxDrawdown': float((growth / np.maximum.accumulate(growth) - 1).min()), 'sharpe': (cagr - rf) / vol if vol else None}


# Short histories. Methods that need little data (equal weight; risk parity, which uses only volatility; minimum
# variance on a shrunk covariance) hold up far better than return-seeking ones when history is short: DeMiguel,
# Garlappi & Uppal (2009), "Optimal versus naive diversification", Review of Financial Studies 22(5).

STAND_INS = ('SPY', 'QQQ', 'IWM', 'MDY', 'EFA', 'EEM', 'VTI', 'AGG', 'BND', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'GLD', 'SLV',
             'DBC', 'VNQ', 'XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'SCHD', 'VIG', 'DVY', 'MTUM',
             'QUAL', 'USMV')
MIN_OVERLAP, MIN_CORRELATION, YOUNG_DAYS = TRADING_DAYS, 0.7, 90  # 1 year of overlap; "young" = starts 90+ days after the oldest
SHORT_TEST_DAYS = int(2.5 * TRADING_DAYS)  # below this even the short walk-forward isn't run
STABILITY_RUNS, STABILITY_INNER = 200, 10


def _daily_returns(series, dates):
    v = np.array([series[d] for d in dates], dtype=float)
    return v[1:] / v[:-1] - 1


def pick_stand_in(own, candidates):
    """The long-history ETF whose daily returns move most like `own` over their real overlap, as
    (symbol, correlation, beta), or None without 1+ year of overlap and a correlation of at least 0.7."""
    best = None
    for symbol, other in candidates.items():
        if not other:
            continue
        common = sorted(own.keys() & other.keys())
        if len(common) - 1 < MIN_OVERLAP:
            continue
        a, b = _daily_returns(own, common), _daily_returns(other, common)
        if a.std() == 0 or b.std() == 0:
            continue
        corr = float(np.corrcoef(a, b)[0, 1])
        if corr >= MIN_CORRELATION and (best is None or corr > best[1]):
            best = (symbol, corr, float(np.cov(a, b)[0, 1] / b.var(ddof=1)))
    return best


def backfill(own, proxy, beta, floor):
    """`own` extended back to `floor`: before its first real day each day's return is beta x the stand-in's return
    (no alpha). Real days are never changed."""
    first = min(own)
    days = sorted(d for d in proxy if floor <= d <= first)
    out = dict(own)
    if not days:
        return out
    v = own[first]
    if days[-1] != first:
        out[days[-1]] = v  # the stand-in has no bar on the real start: treat that one gap as flat
    for i in range(len(days) - 2, -1, -1):
        r = proxy[days[i + 1]] / proxy[days[i]] - 1
        v = v / max(1 + beta * r, 1e-6)
        out[days[i]] = v
    return out


def extend_history(series, symbols, candidates):
    """Proxy-extended history (as in Morningstar's extended performance) for holdings younger than the rest.

    series/candidates: {symbol: {date: total-return value}}. Returns (extended {symbol: {date: value}}, stand-ins used,
    young holdings with no good stand-in)."""
    starts = {s: min(series[s]) for s in symbols}
    ref = min(starts.values())
    young = [s for s in symbols if (starts[s] - ref).days > YOUNG_DAYS]
    out, used, left_out = {s: series[s] for s in symbols}, [], []
    for s in young:
        pick = pick_stand_in(series[s], {c: v for c, v in candidates.items() if c != s and c not in young})
        if pick is None:
            left_out.append({'symbol': s, 'realStart': starts[s].isoformat()})
            continue
        proxy, corr, beta = pick
        out[s] = backfill(series[s], candidates[proxy], beta, ref)
        used.append({'symbol': s, 'standIn': proxy, 'correlation': round(corr, 3), 'beta': round(beta, 3), 'realStart': starts[s].isoformat()})
    return out, used, left_out


def test_window(t):
    """(fit window, holding step, short) for t days of history: 3-year fit / quarterly hold with 4+ years; a short
    1-year fit / monthly hold (low confidence) with 2.5+ years; otherwise None (no walk-forward)."""
    if t >= WINDOW + 4 * STEP:
        return WINDOW, STEP, False
    if t >= SHORT_TEST_DAYS:
        return TRADING_DAYS, BLOCK, True
    return None


def weight_stability(returns, method, o, seed=11, runs=None):
    """Refit `method` on `runs` block-bootstrap resamples (1-month blocks) of the real history: each weight's
    10th-90th percentile. A robustness check (can the data pin the weights down?), not evidence of better returns."""
    rng, runs = np.random.default_rng(seed), runs or STABILITY_RUNS
    inner = {**o, 'runs': STABILITY_INNER}
    ws = np.array([fit(returns[_block_sample(len(returns), rng)], method, inner, rng) for _ in range(runs)])
    return {'runs': runs, 'low': np.percentile(ws, 10, axis=0).round(4).tolist(), 'high': np.percentile(ws, 90, axis=0).round(4).tolist()}


def run_optimizer(returns, current, method, o, seed=7, test=None, stability_runs=None):
    """Suggested weights (fit on the real shared history), the weight-stability ranges, the walk-forward table and the
    random-walk check. test = (returns, current, options) of the history to test on (stand-in extended); default the
    real one. Pure: arrays in, plain dict out."""
    rng = np.random.default_rng(seed)
    test_method = 'growth' if method == 'black_litterman' else method
    weights = fit(returns, method, {**o, 'cur': current}, rng)
    cov = ledoit_wolf(returns)[0] * TRADING_DAYS
    out = {'weights': weights, 'volatility': {'current': float(np.sqrt(current @ cov @ current)), 'suggested': float(np.sqrt(weights @ cov @ weights))},
           'stability': weight_stability(returns, method, {**o, 'cur': current}, seed + 4, stability_runs), 'walkForward': None, 'randomWalk': None}
    t_returns, t_current, t_o = test or (returns, current, o)
    plan = test_window(len(t_returns)) if t_returns.shape[1] >= 2 else None
    if not plan:
        return out
    window, step, short = plan
    wf = {**t_o, 'runs': WF_RESAMPLES, 'views': []}
    keys = ['current', 'equal', 'min_var', 'risk_parity', 'growth']
    weighers = {k: (lambda past: t_current) if k == 'current' else (lambda past, k=k: fit(past, k, wf, rng)) for k in keys}
    rows, ports = [], {}
    for k in keys:
        port, _, turnover = walk_forward(t_returns, weighers[k], window, step)
        ports[k] = port
        rows.append({'key': k, **oos_stats(port, o['rf']), 'turnover': turnover})
    out['walkForward'] = {'windowYears': window / TRADING_DAYS, 'stepDays': step, 'short': short, 'days': len(ports['current']), 'rows': rows}
    by = {r['key']: r for r in rows}
    edge = (by[test_method]['sharpe'] or 0) - (by['current']['sharpe'] or 0)
    if edge <= 0:  # no edge to explain: skip the shuffles
        out['randomWalk'] = {'method': test_method, 'runs': 0, 'edge': float(edge), 'p': 1.0}
        return out
    rw = {**wf, 'runs': RW_RESAMPLES}
    beats = 0
    for _ in range(RW_RUNS):
        shuffled = t_returns[_block_shuffle(len(t_returns), rng)]
        a = oos_stats(walk_forward(shuffled, lambda past: fit(past, test_method, rw, rng), window, step)[0], o['rf'])['sharpe'] or 0
        b = oos_stats(walk_forward(shuffled, lambda past: t_current, window, step)[0], o['rf'])['sharpe'] or 0
        beats += (a - b) >= edge
    out['randomWalk'] = {'method': test_method, 'runs': RW_RUNS, 'edge': float(edge), 'p': float((beats + 1) / (RW_RUNS + 1))}
    return out


def _aligned(series, symbols):
    """(dates, values[days, assets]) over the days every symbol has."""
    common = sorted(set.intersection(*(set(series[s]) for s in symbols)))
    return common, np.array([[series[s][d] for s in symbols] for d in common], dtype=float).reshape(len(common), len(symbols))


@handler('portfolio.optimize')
async def optimize(ctx, msg):
    symbols, current = _clean_holdings(msg)
    if len(symbols) < 2:
        raise EngineError('Optimisation needs at least two holdings.')
    method = msg.get('method') if msg.get('method') in METHODS else 'risk_parity'
    years = min(int(msg.get('years') or 10), 10)  # stand-in history goes back at most 10 years
    cash = {str(h['symbol']).upper().strip() for h in msg.get('holdings') or [] if h.get('cash')}
    keep_cash = msg.get('keepCash', True)
    fixed = {j: float(current[j]) for j, s in enumerate(symbols) if s in cash} if keep_cash else {}
    loaded, rf = await asyncio.gather(total_return_series(ctx, symbols, years), risk_free(ctx))
    for s, v in zip(symbols, loaded):
        if v is None:
            raise EngineError(f'{s}: no price history. Check the ticker.')
    series = dict(zip(symbols, loaded))
    dates, prices = _aligned(series, symbols)
    if len(dates) < 60:
        raise EngineError('Not enough shared price history for these symbols (need at least 3 months).')
    returns = prices[1:] / prices[:-1] - 1
    views = [{**v, 'return': float(v['return']) - rf} for v in msg.get('views') or [] if 'return' in v]
    o = {'rf': rf, 'lo': 0.01 if msg.get('keepAll') else 0.0, 'hi': float(msg.get('maxWeight') or 0.25), 'fixed': fixed,
         'maxChange': float(msg['maxChange']) if msg.get('maxChange') else None, 'views': views if method == 'black_litterman' else [], 'symbols': symbols}

    used, left_out, test, test_dates = [], [], None, dates
    starts = [min(v) for v in loaded]
    if msg.get('standIns', True) is not False and any((d - min(starts)).days > YOUNG_DAYS for d in starts):
        names = [c for c in STAND_INS if c not in symbols]
        candidates = dict(zip(names, await total_return_series(ctx, names, years)))
        candidates.update(series)  # a long-history holding can stand in too (already loaded)
        extended, used, left_out = extend_history(series, symbols, candidates)
        dropped = {x['symbol'] for x in left_out}
        keep = [j for j, s in enumerate(symbols) if s not in dropped]
        test_dates, values = _aligned(extended, [symbols[j] for j in keep])
        t_cur = current[keep] / current[keep].sum()
        index = {j: k for k, j in enumerate(keep)}
        t_fixed = {index[j]: float(t_cur[index[j]]) for j in fixed if j in index}
        test = (values[1:] / values[:-1] - 1, t_cur, {**o, 'fixed': t_fixed, 'symbols': [symbols[j] for j in keep]})
    r = await asyncio.to_thread(run_optimizer, returns, current, method, o, 7, test)
    return {
        'method': method,
        'start': dates[0].isoformat(),
        'end': dates[-1].isoformat(),
        'testStart': test_dates[0].isoformat(),
        'riskFree': rf,
        'symbols': symbols,  # only what was sent: never a symbol the owner didn't add
        'cash': [s for s in symbols if s in cash],
        'keepCash': bool(fixed),
        'weights': r['weights'].round(4).tolist(),
        'current': current.round(4).tolist(),
        'volatility': r['volatility'],
        'stability': r['stability'],
        'standIns': used,
        'leftOut': left_out,
        'walkForward': r['walkForward'],
        'randomWalk': r['randomWalk'],
    }
