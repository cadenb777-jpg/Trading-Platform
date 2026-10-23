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
    values = closes.copy()
    for j, divs in enumerate(divs_list):
        if not divs:
            continue
        # Dividends paid between two trading days count on the first day on or after their ex-date.
        div_on = np.zeros(len(common))
        k = 0
        for day in sorted(divs):
            while k < len(common) and common[k] < day:
                k += 1
            if 0 < k < len(common):
                div_on[k] += divs[day]
        growth = (closes[1:, j] + div_on[1:]) / closes[:-1, j]
        values[:, j] = closes[0, j] * np.concatenate([[1.0], np.cumprod(growth)])
    info = {'last': closes[-1].tolist(), 'dividends': [d is not None for d in divs_list]}
    return common, values, info


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
    i = next(i for i, d in enumerate(dates) if d >= start)
    r = returns[max(0, i - 1):] if i else returns
    if years and years >= 1:
        return annualised(r, (end - dates[max(0, i - 1)]).days)
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
    tiers = [t for t in schedule.get('tiers') or [] if float(t.get('rate') or 0) > 0]
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

def _portfolio_perf(w, mu, cov):
    ret = float(w @ mu)
    vol = float(np.sqrt(max(w @ cov @ w, 0)))
    return ret, vol


def optimise(mu, cov, rf, method, lo=0.0, hi=1.0, target=None):
    n = len(mu)
    x0 = np.full(n, 1 / n)
    bounds = [(lo, hi)] * n
    cons = [{'type': 'eq', 'fun': lambda w: w.sum() - 1}]
    if method == 'min_var':
        fun = lambda w: w @ cov @ w
    elif method == 'risk_parity':
        def fun(w):
            port_var = w @ cov @ w
            rc = w * (cov @ w) / port_var
            return float(((rc - 1 / n) ** 2).sum())
    elif method == 'target':
        cons.append({'type': 'eq', 'fun': lambda w: w @ mu - target})
        fun = lambda w: w @ cov @ w
    else:  # max Sharpe
        def fun(w):
            ret, vol = _portfolio_perf(w, mu, cov)
            return -(ret - rf) / vol if vol else 0
    res = minimize(fun, x0, method='SLSQP', bounds=bounds, constraints=cons, options={'maxiter': 500, 'ftol': 1e-10})
    w = np.clip(res.x, 0 if lo >= 0 else lo, hi)
    return w / w.sum(), bool(res.success)


def black_litterman(cov, prior_weights, views, symbols, delta=2.5, tau=0.05):
    """Blends the market's implied returns with your views ({symbol, return, confidence 0–1})."""
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


@handler('portfolio.optimize')
async def optimize(ctx, msg):
    symbols, current = _clean_holdings(msg)
    if len(symbols) < 2:
        raise EngineError('Optimisation needs at least two holdings.')
    method = msg.get('method', 'max_sharpe')
    years = int(msg.get('years') or 10)
    lo, hi = float(msg.get('minWeight', 0)), float(msg.get('maxWeight', 1))
    if lo * len(symbols) > 1 or hi * len(symbols) < 1:
        raise EngineError('Those weight limits are impossible for this many holdings.')
    (dates, prices, _), rf = await asyncio.gather(price_matrix(ctx, symbols, years), risk_free(ctx))
    returns = prices[1:] / prices[:-1] - 1
    cov = np.cov(returns.T) * TRADING_DAYS
    historical = (np.prod(1 + returns, axis=0) ** (TRADING_DAYS / len(returns))) - 1
    if method == 'black_litterman':
        mu = black_litterman(cov, current, msg.get('views') or [], symbols)
    else:
        mu = historical
    weights, ok = optimise(mu, cov, rf, 'max_sharpe' if method == 'black_litterman' else method, lo, hi)
    frontier = []
    min_w, _ = optimise(mu, cov, rf, 'min_var', lo, hi)
    r_min = float(min_w @ mu)
    r_max = float(max(mu.max(), r_min))
    for t in np.linspace(r_min, r_max, 18):
        w, success = optimise(mu, cov, rf, 'target', lo, hi, t)
        if success:
            ret, vol = _portfolio_perf(w, mu, cov)
            frontier.append({'return': ret, 'volatility': vol})
    ret, vol = _portfolio_perf(weights, mu, cov)
    cur_ret, cur_vol = _portfolio_perf(current, mu, cov)
    return {
        'method': method,
        'start': dates[0].isoformat(),
        'riskFree': rf,
        'symbols': symbols,
        'weights': weights.round(4).tolist(),
        'current': current.round(4).tolist(),
        'expectedReturns': mu.tolist(),
        'historicalReturns': historical.tolist(),
        'volatilities': np.sqrt(np.diag(cov)).tolist(),
        'result': {'return': ret, 'volatility': vol, 'sharpe': (ret - rf) / vol if vol else None},
        'currentResult': {'return': cur_ret, 'volatility': cur_vol, 'sharpe': (cur_ret - rf) / cur_vol if cur_vol else None},
        'frontier': frontier,
        'converged': ok,
    }
