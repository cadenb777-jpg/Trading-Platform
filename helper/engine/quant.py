"""
Portfolio analytics, risk and optimisation from daily prices (Schwab history), using numpy/scipy.
"""
import asyncio
import contextvars
import datetime as dt
import zlib

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
# Robust methods only (no raw historical means): shrunk covariance, risk-based weights and return-seeking goals on
# returns pulled toward the market equilibrium. Every goal is judged by a walk-forward test on data it hadn't seen,
# and its edge over the current portfolio by the same test on shuffled histories (random walk).

#: The goals the owner picks from (one dropdown), with their sources:
#:   growth      best return for the risk: resampled maximum Sharpe ratio, Michaud (1998) "Efficient Asset
#:               Management", on returns pulled toward the equilibrium of Black & Litterman (1992), FAJ 48(5).
#:   risk_parity even risk (equal risk contribution): Maillard, Roncalli & Teiletche (2010), JPM 36(4); solved with
#:               Spinu's (2013) convex form.
#:   min_var     lowest volatility (minimum variance): Markowitz (1952); Clarke, de Silva & Thorley (2006), JPM 33(1).
#:   max_div     most diversified (maximum diversification ratio): Choueifaty & Coignard (2008), JPM 35(1).
#:   hrp         hierarchical risk parity: López de Prado (2016), "Building Diversified Portfolios that Outperform
#:               Out of Sample", JPM 42(4). Needs no matrix inversion, so it copes with short history.
#:   min_cvar    smallest bad months (minimum expected shortfall / CVaR at 95% on historical 1-month scenarios):
#:               Rockafellar & Uryasev (2000), "Optimization of Conditional Value-at-Risk", Journal of Risk 2(3).
#:   target_vol  highest expected return at a chosen volatility: a point on Markowitz's (1952) efficient frontier.
#:   income      highest forward dividend yield (as on the Dividends view) under a volatility cap.
#:   track       stay close to a benchmark: the highest expected return within a tracking-error budget (closest
#:               portfolio when the budget is 0): Roll (1992), "A Mean/Variance Analysis of Tracking Error", JPM 18(4).
GOALS = ('risk_parity', 'growth', 'min_var', 'max_div', 'hrp', 'min_cvar', 'target_vol', 'income', 'track')  # Even risk first: the baseline
METHODS = GOALS + ('black_litterman',)  # old name (helper v33 and before): Growth with my views
ESTIMATES = ('shrunk', 'views')  # history shrunk 70% toward equilibrium / Black-Litterman with views ('equilibrium' stays internal)
TEST_STEPS = {'monthly': 21, 'quarterly': 63, 'yearly': 252}  # how often the walk-forward test refits and rebalances
WINDOW, STEP, BLOCK = 3 * TRADING_DAYS, 63, 21  # fit on 3 years, hold a quarter, 1-month blocks when resampling
HIST_SHARE = 0.3  # expected returns = 70% equilibrium (Black-Litterman prior) + 30% history
RESAMPLES, WF_RESAMPLES, RW_RESAMPLES, RW_RUNS = 200, 10, 3, 100
CVAR_LEVEL, CVAR_DAYS, CVAR_STRIDE = 0.95, 21, 5  # 95% expected shortfall of 1-month returns, one scenario every 5 days
TARGET_VOL, VOL_CAP, TE_BUDGET = 0.10, 0.12, 0.02  # defaults: target volatility, income's volatility cap, tracking-error budget
SAME_WEIGHTS = 0.005  # goals whose weights all differ by less than 0.5 points are the same portfolio
HOLM_LEVEL = 0.10  # Holm-adjusted random-walk p at or below this: the goal's edge needed the real order of events
SE_RUNS = 500  # paired block-bootstrap runs for the standard error of a Sharpe difference vs Even risk

# Notes about fallbacks and loosened limits, collected only while a goal's suggested weights are fit (goal_job).
_NOTES = contextvars.ContextVar('optimiser_notes', default=None)


def _note(text):
    notes = _NOTES.get()
    if notes is not None and text not in notes:
        notes.append(text)


def default_max_weight(n):
    """Max per holding by default: 2 / holdings, kept between 25% and 50% (room to move without one bet)."""
    return min(max(2 / max(n, 1), 0.25), 0.5)


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


def _block_sample(t, rng, block=BLOCK, size=None):
    """Indices into t days for a block bootstrap: random 1-month stretches (with replacement) glued to length size (default t)."""
    size = size or t
    block = min(block, t)
    starts = rng.integers(0, t - block + 1, -(-size // block))
    return (starts[:, None] + np.arange(block)).ravel()[:size]


def _block_shuffle(t, rng, block=BLOCK):
    """Day indices with 1-month blocks put in random order (every day used once): a history with no real order."""
    starts = np.arange(0, t, block)
    rng.shuffle(starts)
    return np.concatenate([np.arange(s, min(s + block, t)) for s in starts])


def _ineq(lin):
    """Linear limits A @ w <= b (sector caps) as SLSQP constraints."""
    if lin is None:
        return []
    a, b = lin
    return [{'type': 'ineq', 'fun': lambda w: b - a @ w, 'jac': lambda w: -a}]


def _within(w, lin, tol=1e-6):
    return lin is None or bool((lin[0] @ w <= lin[1] + tol).all())


def _solve(fun, bounds, x0, jac=True, cons=()):
    lo, hi = np.array(bounds).T
    eq = [{'type': 'eq', 'fun': lambda w: w.sum() - 1, 'jac': lambda w: np.ones_like(w)}]
    res = minimize(fun, np.clip(x0, lo, hi), jac=jac, method='SLSQP', bounds=bounds, constraints=eq + list(cons), options={'maxiter': 300, 'ftol': 1e-12})
    if not res.success:
        _note('The optimiser didn’t fully settle on an answer, so these weights are its best attempt.')
    w = np.clip(res.x, lo, hi)
    return w / w.sum()


def project(w0, bounds, lin=None, cur=None, max_turnover=None):
    """The weights closest to w0 (least squares) that keep every limit: bounds, adding to 1, sector caps (lin) and,
    with cur, a total one-way change sum|w - cur| / 2 of at most max_turnover."""
    n = len(w0)
    lo, hi = np.array(bounds, dtype=float).T
    zeros, eye = np.zeros(n), np.eye(n)
    cons = [{'type': 'eq', 'fun': lambda x: x[:n].sum() - 1, 'jac': lambda x: np.r_[np.ones(n), zeros]}]
    if lin is not None:
        a, b = lin
        cons.append({'type': 'ineq', 'fun': lambda x: b - a @ x[:n], 'jac': lambda x: np.hstack([-a, np.zeros_like(a)])})
    turn = cur is not None and max_turnover is not None
    if turn:  # x[n:] = |w - cur| (each at least both signs of the change)
        cons += [{'type': 'ineq', 'fun': lambda x: x[n:] - (x[:n] - cur), 'jac': lambda x: np.hstack([-eye, eye])},
                 {'type': 'ineq', 'fun': lambda x: x[n:] + (x[:n] - cur), 'jac': lambda x: np.hstack([eye, eye])},
                 {'type': 'ineq', 'fun': lambda x: 2 * max_turnover - x[n:].sum(), 'jac': lambda x: np.r_[zeros, -np.ones(n)]}]
    start = np.clip(w0, lo, hi)
    x0 = np.r_[start, np.abs(start - cur) if turn else zeros]
    res = minimize(lambda x: (((x[:n] - w0) ** 2).sum(), np.r_[2 * (x[:n] - w0), zeros]), x0, jac=True, method='SLSQP',
                   bounds=list(zip(lo, hi)) + [(0, None)] * n, constraints=cons, options={'maxiter': 500, 'ftol': 1e-14})
    if not res.success:
        _note('Your limits couldn’t all be met exactly; the weights are as close as the optimiser could get.')
    w = np.clip(res.x[:n], lo, hi)
    return w / w.sum()


def turnover(w, cur):
    """One-way change between two mixes: half the sum of the absolute weight changes (0 = same, 1 = all new)."""
    return float(np.abs(np.asarray(w) - np.asarray(cur)).sum() / 2)


def min_variance(cov, bounds, lin=None):
    return _solve(lambda w: (w @ cov @ w, 2 * cov @ w), bounds, np.full(len(cov), 1 / len(cov)), cons=_ineq(lin))


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


def _fit_limits(w, bounds, lin):
    """A risk-budgeting answer fitted into the limits (keeping its shape), then into sector caps if needed."""
    w = _into_bounds(w, bounds)
    return w if _within(w, lin) else project(w, bounds, lin)


def risk_parity(cov, bounds, lin=None):
    """Equal risk contribution (Spinu's convex form), then fitted into the limits."""
    n = len(cov)
    res = minimize(lambda y: (0.5 * y @ cov @ y - np.log(y).sum() / n, cov @ y - 1 / (n * y)), 1 / np.sqrt(np.diag(cov)),
                   jac=True, method='L-BFGS-B', bounds=[(1e-12, None)] * n)
    return _fit_limits(res.x / res.x.sum(), bounds, lin)


def hrp_order(cov):
    """Holdings ordered so similar ones sit together: single-linkage clustering on the correlation distance
    sqrt((1 - correlation) / 2) (López de Prado 2016)."""
    from scipy.cluster.hierarchy import leaves_list, linkage
    from scipy.spatial.distance import squareform
    sd = np.sqrt(np.diag(cov))
    corr = np.clip(cov / np.outer(sd, sd), -1, 1)
    dist = np.sqrt(np.clip((1 - corr) / 2, 0, None))
    np.fill_diagonal(dist, 0)
    return leaves_list(linkage(squareform(dist, checks=False), 'single')).tolist()


def _cluster_variance(cov, idx):
    c = cov[np.ix_(idx, idx)]
    iv = 1 / np.diag(c)
    iv /= iv.sum()
    return float(iv @ c @ iv)


def hrp(cov, bounds=None, lin=None):
    """Hierarchical risk parity: order the holdings by similarity, then split the money down the tree, each half
    getting more when its (inverse-variance) cluster swings less. No matrix inversion, so short history is fine."""
    order = hrp_order(cov)
    w = np.ones(len(cov))
    clusters = [order]
    while clusters:
        nxt = []
        for c in clusters:
            if len(c) < 2:
                continue
            a, b = c[:len(c) // 2], c[len(c) // 2:]
            va, vb = _cluster_variance(cov, a), _cluster_variance(cov, b)
            alpha = 1 - va / (va + vb)
            w[a] *= alpha
            w[b] *= 1 - alpha
            nxt += [a, b]
        clusters = nxt
    w /= w.sum()
    return w if bounds is None else _fit_limits(w, bounds, lin)


def max_diversification(cov, bounds, lin=None):
    """Most diversified: the highest ratio of the weighted average volatility to the portfolio's volatility."""
    sd = np.sqrt(np.diag(cov))

    def fun(w):
        a, s = w @ sd, np.sqrt(w @ cov @ w)
        return -a / s, -(sd / s - a * (cov @ w) / s ** 3)

    return _solve(fun, bounds, (1 / sd) / (1 / sd).sum(), cons=_ineq(lin))


def scenarios(r, days=CVAR_DAYS, stride=CVAR_STRIDE):
    """Historical scenarios for expected shortfall: each holding's buy-and-hold return over `days` days, starting
    every `stride` days (overlapping). With under 2 x days of history, the daily returns themselves."""
    t = len(r)
    if t < 2 * days:
        return r
    growth = np.vstack([np.ones(r.shape[1]), np.cumprod(1 + r, axis=0)])
    starts = np.arange(0, t - days + 1, stride)
    return growth[starts + days] / growth[starts] - 1


def cvar(losses, level=CVAR_LEVEL):
    """Expected shortfall: the average loss in the worst (1 - level) of scenarios, in Rockafellar & Uryasev's form
    (alpha + mean excess over alpha / (1 - level), alpha = the level quantile of the losses)."""
    loss = np.sort(np.asarray(losses, dtype=float))
    alpha = loss[max(int(np.ceil(level * len(loss))) - 1, 0)]
    return float(alpha + np.maximum(loss - alpha, 0).sum() / ((1 - level) * len(loss)))


def min_cvar(scen, bounds, lin=None, level=CVAR_LEVEL):
    """Smallest expected shortfall over the scenarios: Rockafellar & Uryasev's linear programme
    min alpha + sum(u) / ((1 - level) S) with u >= loss - alpha, u >= 0, loss = -scenario @ w."""
    from scipy.optimize import linprog
    s, n = scen.shape
    lo, hi = np.array(bounds).T
    c = np.r_[np.zeros(n), 1.0, np.full(s, 1 / ((1 - level) * s))]
    a_ub = np.hstack([-scen, -np.ones((s, 1)), -np.eye(s)])
    b_ub = np.zeros(s)
    if lin is not None:
        a_ub = np.vstack([a_ub, np.hstack([lin[0], np.zeros((len(lin[1]), 1 + s))])])
        b_ub = np.r_[b_ub, lin[1]]
    res = linprog(c, A_ub=a_ub, b_ub=b_ub, A_eq=np.r_[np.ones(n), 0.0, np.zeros(s)][None], b_eq=[1.0],
                  bounds=list(zip(lo, hi)) + [(None, None)] + [(0, None)] * s, method='highs')
    if not res.success:
        _note('The smallest-bad-months calculation failed, so equal weights (within your limits) are shown instead.')
        return _into_bounds(np.full(n, 1 / n), bounds)
    w = np.clip(res.x[:n], lo, hi)
    return w / w.sum()


def max_sharpe(excess, cov, bounds, lin=None):
    if excess.max() <= 0:
        return min_variance(cov, bounds, lin)

    def fun(w):
        a, sd = w @ excess, np.sqrt(w @ cov @ w)
        return -a / sd, -(excess / sd - a * (cov @ w) / sd ** 3)

    return _solve(fun, bounds, np.full(len(cov), 1 / len(cov)), cons=_ineq(lin))


def max_at_volatility(score, cov, cap, bounds, lin=None):
    """The highest score @ w (expected return, or yield) with volatility at most `cap`; the lowest-volatility mix
    when even that swings more than the cap."""
    base = min_variance(cov, bounds, lin)
    if np.sqrt(base @ cov @ base) >= cap:
        _note(f'Even the calmest mix swings {np.sqrt(base @ cov @ base):.1%} a year, more than the {cap:.1%} volatility you set, so the lowest-volatility mix is used.')
        return base
    cons = [{'type': 'ineq', 'fun': lambda w: cap ** 2 - w @ cov @ w, 'jac': lambda w: -2 * cov @ w}] + _ineq(lin)
    w = _solve(lambda w: (-(score @ w), -score), bounds, base, cons=cons)
    if np.sqrt(w @ cov @ w) > cap * 1.005:
        _note('No mix could be found at your volatility setting, so the lowest-volatility mix is used.')
        return base
    if np.sqrt(w @ cov @ w) < cap * 0.98:
        _note(f'The best mix only swings {np.sqrt(w @ cov @ w):.1%} a year, below the {cap:.1%} you allowed: more risk wouldn’t add to the aim.')
    return w


def tracking_fit(sub, rest, bench, share, excess, bounds, budget, lin=None):
    """Weights for the invested part (a `share` of the money; `rest` = daily returns of the fixed part) that stay
    close to the benchmark: the highest expected return with tracking error at most `budget`, or the closest
    portfolio (smallest tracking error) when the budget is 0 or can't be met."""
    k = sub.shape[1]
    m = np.cov(np.column_stack([sub, rest - bench]).T) * TRADING_DAYS
    sig, g, vc = m[:k, :k], m[:k, k], m[k, k]

    def te2(w):
        return share * share * w @ sig @ w + 2 * share * w @ g + vc

    def grad(w):
        return 2 * share * share * sig @ w + 2 * share * g

    closest = _solve(lambda w: (te2(w), grad(w)), bounds, np.full(k, 1 / k), cons=_ineq(lin))
    if budget <= 0:
        return closest
    if te2(closest) >= budget ** 2:
        _note(f'Your holdings can’t get within the {budget:.1%} tracking-error budget (the closest is {np.sqrt(max(te2(closest), 0)):.1%}), so the closest mix is used.')
        return closest
    cons = [{'type': 'ineq', 'fun': lambda w: budget ** 2 - te2(w), 'jac': lambda w: -grad(w)}] + _ineq(lin)
    w = _solve(lambda w: (-(excess @ w), -excess), bounds, closest, cons=cons)
    if te2(w) > budget ** 2 * 1.01:
        _note('No mix within the tracking-error budget could be found, so the closest mix to the benchmark is used.')
        return closest
    return w


def black_litterman(cov, prior_weights, views, symbols, delta=2.5, tau=0.05):
    """Blends the market's implied (equilibrium) excess returns with your views ({symbol, return, confidence 0–1}).
    With no views it returns the equilibrium itself."""
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


def expected_excess(r, cov, rf, views=(), symbols=(), estimate='shrunk'):
    """Yearly excess returns. 'shrunk' (default): the equal-weight equilibrium (plus any views) nudged 30% toward
    history; 'equilibrium': the equilibrium alone; 'views': Black-Litterman, the equilibrium blended with the views."""
    pi = black_litterman(cov, np.full(len(cov), 1 / len(cov)), list(views), list(symbols))
    if estimate in ('equilibrium', 'views'):
        return pi
    return (1 - HIST_SHARE) * pi + HIST_SHARE * (r.mean(axis=0) * TRADING_DAYS - rf)


def _feasible(lo, hi):
    """Loosens impossible limits just enough: lows scaled down to add to at most 1, highs up to add to at least 1."""
    if lo.sum() > 1 + 1e-9:
        _note(f'Your minimum weights add up to {lo.sum():.0%}, more than everything, so each was scaled down.')
        lo = lo / lo.sum()
    if hi.sum() < 1 - 1e-9:
        _note(f'Your maximum weights add up to only {hi.sum():.0%} (max per holding or max number of holdings too low), so each maximum was raised to fit.')
        hi = hi / hi.sum() if hi.sum() > 0 else np.full(len(hi), 1 / len(hi))
    return lo, np.maximum(hi, lo)


def _bounds(n, lo, hi, cur=None, max_change=None):
    """Each holding's (low, high) weight; lo and hi are numbers or per-holding arrays."""
    lo_b = np.clip(np.broadcast_to(np.asarray(lo, dtype=float), (n,)).astype(float), 0, 1)
    hi_b = np.clip(np.broadcast_to(np.asarray(hi, dtype=float), (n,)).astype(float), 0, 1)
    lo_b, hi_b = _feasible(lo_b, np.maximum(hi_b, lo_b))
    if cur is not None and max_change is not None:
        lo_c, hi_c = np.maximum(lo_b, cur - max_change), np.minimum(hi_b, cur + max_change)
        hi_c = np.maximum(hi_c, lo_c)
        if lo_c.sum() <= 1 and hi_c.sum() >= 1:  # otherwise the move limit is dropped
            lo_b, hi_b = lo_c, hi_c
        else:
            _note('Max change per holding couldn’t be kept together with your other limits, so it was dropped.')
    return list(zip(lo_b, hi_b))


def _invested_bounds(inv, share, o):
    """Bounds for the invested holdings `inv` as shares of the invested part: per-holding loEach/hiEach (or the
    lo/hi numbers), dropped holdings (max holdings) at 0, and the max change from cur."""
    m = len(inv)
    lo = np.asarray(o['loEach'], dtype=float)[inv] if o.get('loEach') is not None else np.full(m, float(o.get('lo', 0.0)))
    hi = np.asarray(o['hiEach'], dtype=float)[inv] if o.get('hiEach') is not None else np.full(m, float(o.get('hi', 1.0)))
    drop = set(o.get('drop') or ())
    for k, j in enumerate(inv):
        if j in drop:
            lo[k] = hi[k] = 0.0
    cur, mc = o.get('cur'), o.get('maxChange')
    return _bounds(m, lo / share, hi / share, None if cur is None else np.asarray(cur)[inv] / share, None if mc is None else mc / share)


def sector_cap(o):
    """The sector cap actually used: the owner's, loosened just enough to place all the money when every holding
    that can move has a sector (e.g. 30% with only 2 sectors becomes 50%). None when there is no cap."""
    cap, sectors = o.get('sectorCap'), o.get('sectors')
    if not cap or not sectors:
        return None
    fixed = o.get('fixed') or {}
    named = {x for x in sectors if x}
    if not named:
        return None
    if all(sectors[j] or j in fixed for j in range(len(sectors))):
        loose = 1 - sum(v for j, v in fixed.items() if not sectors[j])
        cap = max(cap, loose / len(named))
    return float(cap)


def sector_rows(o, idx, share=1.0, include_fixed=True):
    """Sector caps as A @ x <= b over the holdings `idx` (x = shares of the invested part `share`): each sector's
    total weight at most the cap (sector_cap), counting fixed holdings already in it. Holdings with no sector (cash)
    aren't capped."""
    cap = sector_cap(o)
    if cap is None:
        return None
    sectors, fixed, idx = o['sectors'], o.get('fixed') or {}, list(idx)
    rows, b = [], []
    for name in sorted({sectors[j] for j in idx if sectors[j]}):
        rows.append(np.array([1.0 if sectors[j] == name else 0.0 for j in idx]))
        held = 0.0 if include_fixed else sum(v for j, v in fixed.items() if sectors[j] == name)
        b.append(max(cap - held, 0.0) / share)
    return (np.array(rows), np.array(b)) if rows else None


def fit(r, method, o, rng):
    """Weights from a window of daily returns r (days x assets, plus the benchmark's returns as a last column when
    o['bench']) and nothing later.

    o: rf; lo, hi (numbers) or loEach, hiEach (per holding); fixed {index: weight} (cash held as is); cur + maxChange
    (limit each move) and maxTurnover (limit the total move); sectors + sectorCap; maxHoldings; estimate, views,
    symbols; targetVol; volCap + yields (income); teBudget (track); runs (Growth's resamples)."""
    assets, bench = (r[:, :-1], r[:, -1]) if o.get('bench') else (r, None)
    w = _fit(assets, bench, method, o, rng)
    k = o.get('maxHoldings')
    fixed = o.get('fixed') or {}
    free = [j for j in range(len(w)) if j not in fixed]
    if k and sum(w[j] > 1e-4 for j in free) > k:  # keep the k biggest, refit on them
        keep = sorted(free, key=lambda j: -w[j])[:k]
        w = _fit(assets, bench, method, {**o, 'drop': [j for j in free if j not in keep]}, rng)
        o = {**o, 'drop': [j for j in free if j not in keep]}
    cur, limit = o.get('cur'), o.get('maxTurnover')
    if cur is not None and limit is not None and turnover(w, cur) > limit + 1e-6:
        lo, hi = weight_limits(len(w), o)
        w = project(w, list(zip(lo, hi)), sector_rows(o, range(len(w))), np.asarray(cur, dtype=float), limit)
    return w


def _fit(assets, bench, method, o, rng):
    n = assets.shape[1]
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
    bounds = _invested_bounds(inv, s, o)
    lin = sector_rows(o, inv, s, include_fixed=False)
    sub = assets[:, inv]
    cov = ledoit_wolf(sub)[0] * TRADING_DAYS
    syms = [o['symbols'][j] for j in inv] if o.get('symbols') else []
    views, estimate = o.get('views') or [], o.get('estimate') or 'shrunk'
    if method == 'min_var':
        x = min_variance(cov, bounds, lin)
    elif method == 'risk_parity':
        x = risk_parity(cov, bounds, lin)
    elif method == 'hrp':
        x = hrp(cov, bounds, lin)
    elif method == 'max_div':
        x = max_diversification(cov, bounds, lin)
    elif method == 'min_cvar':
        x = min_cvar(scenarios(sub), bounds, lin)
    elif method == 'income':
        yields = np.nan_to_num(np.asarray(o.get('yields') if o.get('yields') is not None else np.zeros(n), dtype=float))[inv]
        x = max_at_volatility(yields, cov, float(o.get('volCap') or VOL_CAP) / s, bounds, lin)
    elif method == 'target_vol':
        x = max_at_volatility(expected_excess(sub, cov, o['rf'], views, syms, estimate), cov, float(o.get('targetVol') or TARGET_VOL) / s, bounds, lin)
    elif method == 'track':
        if bench is None:
            x = min_variance(cov, bounds, lin)
        else:
            rest = assets[:, list(fixed)] @ np.array(list(fixed.values())) if fixed else np.zeros(len(assets))
            x = tracking_fit(sub, rest, bench, s, expected_excess(sub, cov, o['rf'], views, syms, estimate), bounds, float(o.get('teBudget') or 0), lin)
    else:  # growth (and the old 'black_litterman'): resampled max-Sharpe (Michaud) on equilibrium-shrunk returns
        runs = []
        for _ in range(o.get('runs', RESAMPLES)):
            b = sub[_block_sample(len(sub), rng)]
            cb = ledoit_wolf(b)[0] * TRADING_DAYS
            runs.append(max_sharpe(expected_excess(b, cb, o['rf'], views, syms, estimate), cb, bounds, lin))
        x = np.mean(runs, axis=0)
    w[inv] = s * x
    return w


def walk_forward(returns, weigh, window=WINDOW, step=STEP, cost=0.0):
    """Refit on the last `window` days, hold the next `step` days (weights drift), move on. Each rebalance pays
    `cost` x the value traded (both sides).

    weigh(past) only ever sees days before its holding period. Returns (out-of-sample daily returns, weights, yearly
    turnover). Extra columns in `returns` beyond the weights (the benchmark) are only for weigh()."""
    t = len(returns)
    out, ws, turned, held = [], [], 0.0, None
    for s in range(window, t, step):
        w = weigh(returns[s - window:s])
        traded = float(np.abs(w - held).sum()) if held is not None else 0.0
        turned += traded / 2
        seg = np.cumprod(1 + returns[s:s + step, :len(w)], axis=0)
        value = seg @ w
        r = value / np.concatenate([[1.0], value[:-1]]) - 1
        r[0] = (1 + r[0]) * (1 - cost * traded) - 1
        out.append(r)
        held = seg[-1] * w / value[-1]
        ws.append(w)
    port = np.concatenate(out)
    return port, ws, turned / (len(port) / TRADING_DAYS)


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
CORE_STAND_INS = ('SPY', 'QQQ', 'AGG', 'TLT', 'GLD', 'EFA', 'VNQ')  # tried first; the full list only if none fits
MIN_OVERLAP, MIN_CORRELATION, YOUNG_DAYS = TRADING_DAYS, 0.7, 90  # 1 year of overlap; "young" = starts 90+ days after the oldest
SHORT_TEST_DAYS = int(2.5 * TRADING_DAYS)  # below this even the short walk-forward isn't run
STABILITY_RUNS = 200
STABILITY_INNER = {'growth': 20, 'black_litterman': 20}  # Growth's own resamples per refit (more = less extra noise, slower)
PIN_TOL = 0.005  # a weight within 0.5% of a limit at both ends of its range is "held by your limit"


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


def backfill(own, proxy, beta, floor, seed=0):
    """`own` extended back to `floor`. Before its first real day each day's return is beta x the stand-in's return
    plus a residual drawn (seeded 1-month block bootstrap) from the real overlap's residuals own - beta x stand-in,
    centred so there is no alpha. The residuals keep the estimate's volatility and its correlation with the stand-in
    realistic (beta x stand-in alone would move in lockstep with it). Real days are never changed."""
    first = min(own)
    days = sorted(d for d in proxy if floor <= d <= first)
    out = dict(own)
    if len(days) < 2:
        return out
    common = sorted(own.keys() & proxy.keys())
    resid = _daily_returns(own, common) - beta * _daily_returns(proxy, common) if len(common) > 2 else np.zeros(1)
    resid = resid - resid.mean()
    noise = resid[_block_sample(len(resid), np.random.default_rng(seed), size=len(days) - 1)]
    v = own[first]
    if days[-1] != first:
        out[days[-1]] = v  # the stand-in has no bar on the real start: treat that one gap as flat
    for i in range(len(days) - 2, -1, -1):
        r = beta * (proxy[days[i + 1]] / proxy[days[i]] - 1) + noise[i]
        v = v / max(1 + r, 1e-6)
        out[days[i]] = v
    return out


def young_holdings(series, symbols):
    """Holdings whose prices start 90+ days after the oldest holding's."""
    ref = min(min(series[s]) for s in symbols)
    return [s for s in symbols if (min(series[s]) - ref).days > YOUNG_DAYS]


def extend_history(series, symbols, candidates, core=()):
    """Proxy-extended history (as in Morningstar's extended performance) for holdings younger than the rest.

    series/candidates: {symbol: {date: total-return value}}. The owner's own holdings never stand in. Funds in `core`
    are tried first; the rest only when none of them fits. Returns (extended {symbol: {date: value}}, stand-ins used,
    young holdings with no good stand-in)."""
    ref = min(min(series[s]) for s in symbols)
    pool = {c: v for c, v in candidates.items() if c not in symbols}
    out, used, left_out = {s: series[s] for s in symbols}, [], []
    for s in young_holdings(series, symbols):
        pick = pick_stand_in(series[s], {c: v for c, v in pool.items() if c in core}) if core else None
        pick = pick or pick_stand_in(series[s], pool)
        real_start = min(series[s]).isoformat()
        if pick is None:
            left_out.append({'symbol': s, 'realStart': real_start})
            continue
        proxy, corr, beta = pick
        out[s] = backfill(series[s], pool[proxy], beta, ref, zlib.crc32(s.encode()))
        used.append({'symbol': s, 'standIn': proxy, 'correlation': round(corr, 3), 'beta': round(beta, 3), 'realStart': real_start})
    return out, used, left_out



def test_window(t, window=WINDOW, step=STEP):
    """(fit window, holding step, short) for t days of history. With 4+ years: fit on `window` days (the lookback;
    3 years when the lookback leaves under a year to test) and hold `step` days; with 2.5-4 years a short 1-year
    fit / monthly hold (low confidence); otherwise None (no walk-forward)."""
    if t < SHORT_TEST_DAYS:
        return None
    if t < WINDOW + 4 * STEP:
        return TRADING_DAYS, BLOCK, True
    return (window if t >= window + 4 * STEP else WINDOW), step, False


def weight_limits(n, o):
    """Each holding's lowest and highest allowed weight under the options fit() uses (cash fixed, per-holding
    limits, dropped holdings, max change)."""
    fixed = o.get('fixed') or {}
    lo, hi = np.zeros(n), np.zeros(n)
    for j, v in fixed.items():
        lo[j] = hi[j] = v
    inv = [j for j in range(n) if j not in fixed]
    s = 1 - sum(fixed.values())
    if not inv or s <= 1e-9:
        return lo, hi
    if len(inv) == 1:
        lo[inv] = hi[inv] = s
        return lo, hi
    b = np.array(_invested_bounds(inv, s, o))
    lo[inv], hi[inv] = s * b[:, 0], s * b[:, 1]
    return lo, hi


def _assets(returns, o):
    return returns[:, :-1] if o.get('bench') else returns


def weight_stability(returns, method, o, seed=11, runs=None):
    """Refit `method` on `runs` block-bootstrap resamples (1-month blocks) of the real history: each weight's
    10th-90th percentile, and whether both ends sit on one of the owner's limits (pinned by the limit, not the data).
    A robustness check (can the data pin the weights down?), not evidence of better returns."""
    rng, runs = np.random.default_rng(seed), runs or STABILITY_RUNS
    inner = {**o, 'runs': STABILITY_INNER.get(method, 10)}
    ws = np.array([fit(returns[_block_sample(len(returns), rng)], method, inner, rng) for _ in range(runs)])
    low, high = np.percentile(ws, 10, axis=0), np.percentile(ws, 90, axis=0)
    lim_lo, lim_hi = weight_limits(_assets(returns, o).shape[1], o)
    at = lambda x, b: np.abs(x - b) <= PIN_TOL  # noqa: E731
    # A floor of 0 isn't a limit the owner set (the method simply doesn't want the holding), so it doesn't count.
    pinned = (at(low, lim_lo) & at(high, lim_lo) & (lim_lo > PIN_TOL)) | (at(low, lim_hi) & at(high, lim_hi))
    return {'runs': runs, 'low': low.round(4).tolist(), 'high': high.round(4).tolist(), 'pinned': pinned.tolist()}


def _test_options(o):
    """Options for fits inside the tests: fewer resamples, no views (views can't be tested on the past)."""
    return {**o, 'runs': WF_RESAMPLES, 'views': [], 'estimate': 'shrunk' if o.get('estimate') == 'views' else o.get('estimate')}


def wf_row(returns, key, current, o, rf, rng, plan):
    """One row of the walk-forward table: how `key` ('current', 'equal' or a goal) did on data it hadn't seen."""
    window, step, _ = plan
    t_o = _test_options(o)
    weigh = (lambda past: current) if key == 'current' else (lambda past: fit(past, key, t_o, rng))
    port, _, turned = walk_forward(returns, weigh, window, step, float(o.get('cost') or 0))
    return {'key': key, **oos_stats(port, rf), 'turnover': turned}, port


def _table(rows, plan, days):
    window, step, short = plan
    return {'windowYears': window / TRADING_DAYS, 'stepDays': step, 'short': short, 'days': days, 'rows': rows}


def _plan(returns, o):
    if _assets(returns, o).shape[1] < 2:
        return None
    return test_window(len(returns), int(o.get('window') or WINDOW), int(o.get('step') or STEP))


def random_walk(returns, current, key, o, rf, plan, edge, rng, runs=None):
    """How often the same walk-forward on histories shuffled in 1-month blocks gave `key` at least its real Sharpe
    edge over the current mix (p-value, add-one)."""
    runs = RW_RUNS if runs is None else runs
    if edge <= 0:  # no edge to explain: skip the shuffles
        return {'method': key, 'runs': 0, 'edge': float(edge), 'p': 1.0}
    window, step, _ = plan
    rw = {**_test_options(o), 'runs': RW_RESAMPLES}
    cost = float(o.get('cost') or 0)
    beats = 0
    for _ in range(runs):
        shuffled = returns[_block_shuffle(len(returns), rng)]
        a = oos_stats(walk_forward(shuffled, lambda past: fit(past, key, rw, rng), window, step, cost)[0], rf)['sharpe'] or 0
        b = oos_stats(walk_forward(shuffled, lambda past: current, window, step, cost)[0], rf)['sharpe'] or 0
        beats += (a - b) >= edge
    return {'method': key, 'runs': runs, 'edge': float(edge), 'p': float((beats + 1) / (runs + 1))}


def _goal_seed(seed, goal):
    return seed + 101 * (GOALS.index(goal) if goal in GOALS else len(GOALS))


def goal_job(returns, current, goal, o, seed=7, test=None, stability_runs=None):
    """Everything for one goal (pure, so it can run in a worker process): its weights from the real history, the
    weight ranges, its walk-forward row (and the real-prices-only row when a stand-in history is used) and the
    random-walk check of its edge over the current mix. Seeded per goal, so results repeat in any order."""
    rng = np.random.default_rng(_goal_seed(seed, goal))
    fit_r = returns[-int(o['lookback']):] if o.get('lookback') else returns
    mine = {**o, 'cur': current}
    notes = []
    token = _NOTES.set(notes)  # notes only from fitting the suggestion, not from the many test refits
    try:
        weights = fit(fit_r, goal, mine, rng)
    finally:
        _NOTES.reset(token)
    out = {'key': goal, 'weights': weights, 'notes': notes, 'stability': weight_stability(fit_r, goal, mine, _goal_seed(seed, goal) + 4, stability_runs),
           'row': None, 'realRow': None, 'randomWalk': None, 'days': 0, 'realDays': 0, 'oos': None}
    t_returns, t_current, t_o = test or (returns, current, o)
    plan = _plan(t_returns, t_o)
    if not plan:
        return out
    out['row'], out['oos'] = wf_row(t_returns, goal, t_current, t_o, o['rf'], rng, plan)
    out['days'] = len(out['oos'])
    real_plan = _plan(returns, o) if test is not None else None
    if real_plan:  # same test on real prices only: no estimated history at all
        out['realRow'], real = wf_row(returns, goal, current, o, o['rf'], np.random.default_rng(_goal_seed(seed, goal) + 8), real_plan)
        out['realDays'] = len(real)
    mix, _ = wf_row(t_returns, 'current', t_current, t_o, o['rf'], rng, plan)
    edge = (out['row']['sharpe'] or 0) - (mix['sharpe'] or 0)
    out['randomWalk'] = random_walk(t_returns, t_current, goal, t_o, o['rf'], plan, edge, rng)
    return out


def goal_jobs(returns, current, o, seed=7, test=None, stability_runs=None, goals=GOALS):
    """The argument tuples for goal_job, one per goal."""
    return [(returns, current, g, o, seed, test, stability_runs) for g in goals]


def portfolio_figures(w, assets, cov, mu, rf, yields=None, bench=None):
    """Before/after figures for one mix: expected return (the return estimate), volatility (shrunk covariance),
    forward yield, and from the real history (rebalanced daily): worst drop, 95% expected shortfall of 1-month
    returns and tracking error against the benchmark."""
    daily = assets @ w
    growth = np.concatenate([[1.0], np.cumprod(1 + daily)])
    has_yield = yields is not None and not np.isnan(yields[w > 1e-6]).all()
    return {
        'expectedReturn': float(mu @ w + rf),
        'volatility': float(np.sqrt(w @ cov @ w)),
        'yield': float(np.nansum(yields * w)) if has_yield else None,
        'maxDrawdown': float((growth / np.maximum.accumulate(growth) - 1).min()),
        'cvar': cvar(-(scenarios(assets) @ w)),
        'trackingError': float((daily - bench).std(ddof=1) * np.sqrt(TRADING_DAYS)) if bench is not None else None,
    }


def sharpe_difference(a, b, rf, rng, runs=SE_RUNS, block=BLOCK):
    """Sharpe(a) - Sharpe(b) on the same out-of-sample days, and its standard error from a paired block bootstrap
    (the same 1-month blocks drawn for both, so their shared market moves cancel)."""
    sharpe = lambda x: oos_stats(x, rf)['sharpe'] or 0.0  # noqa: E731
    diff = sharpe(a) - sharpe(b)
    draws = []
    for _ in range(runs):
        idx = _block_sample(len(a), rng, block)
        draws.append(sharpe(a[idx]) - sharpe(b[idx]))
    return float(diff), float(np.std(draws, ddof=1))


def holm(ps):
    """Holm-adjusted p-values (step-down, monotone), in the input order."""
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, running = [1.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        out[i] = running
    return out


def same_as(results):
    """{goal: earlier goal with the same weights} (GOALS order), so identical portfolios are shown and counted once."""
    out, seen = {}, []
    for g in GOALS:
        r = next((x for x in results if x['key'] == g), None)
        if r is None:
            continue
        twin = next((k for k, w in seen if np.abs(w - r['weights']).max() < SAME_WEIGHTS), None)
        if twin:
            out[g] = twin
        else:
            seen.append((g, r['weights']))
    return out


def efficient_frontier(mu, cov, bounds, lin=None, points=14):
    """(volatility, expected excess return) along the efficient frontier, from the lowest-volatility mix to the
    highest-return one, under the same limits as the goals."""
    lo_w = min_variance(cov, bounds, lin)
    hi_w = _solve(lambda w: (-(mu @ w), -mu), bounds, lo_w, cons=_ineq(lin))
    v0, v1 = np.sqrt(lo_w @ cov @ lo_w), np.sqrt(hi_w @ cov @ hi_w)
    out = []
    for v in np.linspace(v0, max(v1, v0), points):
        w = lo_w if v <= v0 else max_at_volatility(mu, cov, v, bounds, lin)
        out.append((float(np.sqrt(w @ cov @ w)), float(mu @ w)))
    return sorted(set(out))


def assemble(returns, current, method, o, results, test=None, seed=7):
    """The optimiser's reply from every goal's goal_job result: the chosen goal's weights and evidence, the full
    walk-forward table (current mix, equal weight, every goal), the frontier, risk contributions and figures."""
    by = {r['key']: r for r in results}
    chosen = by[method]
    fit_r = returns[-int(o['lookback']):] if o.get('lookback') else returns
    assets = _assets(fit_r, o)
    bench = fit_r[:, -1] if o.get('bench') else None
    cov = ledoit_wolf(assets)[0] * TRADING_DAYS
    estimate = o.get('estimate') or 'shrunk'
    mu = expected_excess(assets, cov, o['rf'], o.get('views') or [], o.get('symbols') or [], estimate)
    yields = np.asarray(o['yields'], dtype=float) if o.get('yields') is not None else None
    figures = lambda w: portfolio_figures(w, assets, cov, mu, o['rf'], yields, bench)  # noqa: E731
    contrib = lambda w: (w * (cov @ w) / (w @ cov @ w)).round(4).tolist() if w @ cov @ w > 0 else w.tolist()  # noqa: E731
    lo, hi = weight_limits(assets.shape[1], {**o, 'cur': current})
    try:
        frontier = [{'volatility': v, 'return': r + o['rf']} for v, r in efficient_frontier(mu, cov, list(zip(lo, hi)), sector_rows(o, range(assets.shape[1])))]
    except Exception:  # a frontier that can't be traced is left out, never a failed reply
        frontier = []
    w = chosen['weights']
    twins = same_as(results)
    # Holm across the distinct goals (a goal with no edge to explain counts with p = 1).
    distinct = [g for g in GOALS if g in by and g not in twins and by[g]['randomWalk']]
    adjusted = dict(zip(distinct, holm([by[g]['randomWalk']['p'] for g in distinct])))
    for g in GOALS:
        if g in by and by[g]['randomWalk']:
            by[g]['randomWalk'] = {**by[g]['randomWalk'], 'pAdjusted': adjusted.get(twins.get(g, g), 1.0), 'family': len(distinct)}
    base = by.get('risk_parity')
    se_rng = np.random.default_rng(seed + 16)
    versus = {}
    for g in GOALS:
        if g in by and base is not None and by[g]['oos'] is not None and base['oos'] is not None and g != 'risk_parity':
            d, se = sharpe_difference(by[g]['oos'], base['oos'], o['rf'], se_rng)
            versus[g] = {'diff': d, 'se': se}
    out = {
        'weights': w,
        'volatility': {'current': float(np.sqrt(current @ cov @ current)), 'suggested': float(np.sqrt(w @ cov @ w))},
        'stability': chosen['stability'], 'walkForward': None, 'randomWalk': by[method]['randomWalk'], 'realOnly': None,
        'goals': [{'key': g, 'weights': by[g]['weights'].round(4).tolist(), **figures(by[g]['weights']), 'riskContributions': contrib(by[g]['weights']),
                   'stability': by[g]['stability'], 'randomWalk': by[g]['randomWalk'], 'notes': by[g].get('notes') or [],
                   'sameAs': twins.get(g), 'vsEvenRisk': versus.get(g)} for g in GOALS if g in by],
        'currentFigures': {**figures(current), 'riskContributions': contrib(current)},
        'frontier': frontier,
    }
    t_returns, t_current, t_o = test or (returns, current, o)
    plan = _plan(t_returns, t_o)
    if plan and chosen['row']:
        rng = np.random.default_rng(seed)
        lead = [wf_row(t_returns, k, t_current, t_o, o['rf'], rng, plan)[0] for k in ('current', 'equal')]
        out['walkForward'] = _table(lead + [by[g]['row'] for g in GOALS if g in by and by[g]['row']], plan, chosen['days'])
    real_plan = _plan(returns, o) if test is not None else None
    if real_plan and chosen['realRow']:
        rng = np.random.default_rng(seed + 8)
        lead = [wf_row(returns, k, current, o, o['rf'], rng, real_plan)[0] for k in ('current', 'equal')]
        out['realOnly'] = _table(lead + [by[g]['realRow'] for g in GOALS if g in by and by[g]['realRow']], real_plan, chosen['realDays'])
    return out


def run_optimizer(returns, current, method, o, seed=7, test=None, stability_runs=None, goals=None):
    """Suggested weights (fit on the real shared history, its last o['lookback'] days when set), the weight ranges,
    the walk-forward table and the random-walk check, for `method` and the other goals (all by default). test =
    (returns, current, options) of the history to test on (stand-in extended); default the real one. Pure."""
    method = 'growth' if method == 'black_litterman' else method
    goals = [method] + [g for g in (goals or GOALS) if g != method]
    results = [goal_job(*args) for args in goal_jobs(returns, current, o, seed, test, stability_runs, goals)]
    return assemble(returns, current, method, o, results, test, seed)


def _aligned(series, symbols):
    """(dates, values[days, assets]) over the days every symbol has."""
    common = sorted(set.intersection(*(set(series[s]) for s in symbols)))
    return common, np.array([[series[s][d] for s in symbols] for d in common], dtype=float).reshape(len(common), len(symbols))


async def stand_in_series(ctx, symbol):
    """A stand-in ETF's 10-year total-return index, kept on disk (stale_ok) so later runs don't wait on Schwab."""
    async def load():
        s = (await total_return_series(ctx, [symbol], 10))[0]
        if not s:
            raise EngineError(f'No history for {symbol}')
        return [[d.isoformat(), v] for d, v in sorted(s.items())]
    rows = await ctx.cached(('stand-in', symbol), 86400, load, persist=True, stale_ok=True)
    return {dt.date.fromisoformat(d): v for d, v in rows}


async def _load_stand_ins(ctx, names, emit, done, total):
    """{symbol: series or None}, reporting "Finding stand-ins 12/36" as each arrives."""
    async def one(name):
        try:
            v = await stand_in_series(ctx, name)
        except Exception:
            v = None
        done[0] += 1
        if emit:
            await emit({'type': 'status', 'text': f'Finding stand-ins {done[0]}/{total}'})
        return name, v
    return dict(await asyncio.gather(*(one(n) for n in names)))


# ---------- Worker processes: the goals are tested side by side, never stalling live quotes ----------

USE_PROCESSES = True  # tests switch this off (threads instead)
_executor = []


def _worker_init():
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)  # the helper stops the workers itself (shutdown) when it exits


def _workers():
    import os
    return max(1, min(4, (os.cpu_count() or 2) - 1))


def _pool():
    if not _executor:
        import concurrent.futures
        import multiprocessing
        workers = _workers()
        # 'spawn' on every system: a fresh interpreter, never a copy of the helper's threads and open sockets.
        _executor.append(concurrent.futures.ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context('spawn'), initializer=_worker_init))
    return _executor[0]


def shutdown():
    """Stops the optimiser's worker processes (called when the helper exits)."""
    for p in _executor:
        p.shutdown(wait=False, cancel_futures=True)
    _executor.clear()


async def _run_jobs(jobs, emit):
    """goal_job for every job, in worker processes when possible, reporting "Tested 3 of 9 goals" as each finishes."""
    import concurrent.futures.process
    loop = asyncio.get_running_loop()
    if emit:
        workers = _workers() if USE_PROCESSES else 1
        minutes = max(1, round(-(-len(jobs) // workers) * 15 / 60 + 0.4))
        await emit({'type': 'status', 'text': f'Testing {len(jobs)} goals on {workers} processor core{"s" if workers > 1 else ""} (about {minutes} minute{"s" if minutes > 1 else ""})'})
    for attempt in range(2):
        use = USE_PROCESSES and attempt == 0
        try:
            futures = [loop.run_in_executor(_pool(), goal_job, *j) if use else asyncio.ensure_future(asyncio.to_thread(goal_job, *j)) for j in jobs]
            done = 0
            for f in asyncio.as_completed(futures):
                await f
                done += 1
                if emit:
                    await emit({'type': 'status', 'text': f'Tested {done} of {len(jobs)} goals on data they hadn’t seen'})
            return [f.result() for f in futures]
        except (concurrent.futures.process.BrokenProcessPool, OSError):
            shutdown()
            if not use:
                raise
    return []


# ---------- Inputs the goals need: yields, sectors, the benchmark ----------

async def forward_yields(ctx, symbols):
    """Each symbol's forward dividend yield (last regular payment x frequency / last close, as dividends.portfolio
    works it out), or None when there is no dividend history."""
    from . import dividends
    today = dt.date.today()

    async def one(symbol):
        try:
            bars, divs = await asyncio.gather(ctx.daily_bars(symbol, 1), ctx.dividends(symbol))
        except Exception:
            return None
        if divs is None or not bars:
            return None
        return dividends.analyse(divs, today, price=float(bars[-1]['close'])).get('yield')
    return list(await asyncio.gather(*(one(s) for s in symbols)))


async def holding_sectors(ctx, symbols, cash):
    """Each holding's sector (SEC SIC code; funds as "Fund"; cash none) and the symbols whose sector couldn't be
    found (each then counts as its own sector)."""
    from . import invest, risk
    try:
        quotes = await invest.quotes(ctx, [s for s in symbols if s not in cash])
    except Exception:
        quotes = {}
    out, missing = [], []
    for s in symbols:
        if s in cash:
            out.append(None)
            continue
        try:
            out.append((await risk.sector(ctx, s, quotes.get(s) or {}))['sector'])
        except Exception:
            out.append(f'{s} (sector unknown)')
            missing.append(s)
    return out, missing


BENCHMARKS = {'SPY': [('SPY', 1.0)], '6040': [('SPY', 0.6), ('AGG', 0.4)]}


def _benchmark_mix(msg):
    """[(symbol, weight)] and a name for the tracking goal's benchmark: SPY, 60/40 (SPY + AGG) or a portfolio."""
    b = msg.get('trackBenchmark') if isinstance(msg.get('trackBenchmark'), dict) else {}
    if b.get('kind') == 'portfolio' and b.get('holdings'):
        mix = [(str(h['symbol']).upper().strip(), float(h.get('weight') or 0)) for h in b['holdings'] if str(h.get('symbol', '')).strip() and float(h.get('weight') or 0) > 0]
        total = sum(w for _, w in mix)
        if mix and total > 0:
            return [(s, w / total) for s, w in mix], str(b.get('name') or 'Your portfolio')
    if b.get('kind') == '6040':
        return BENCHMARKS['6040'], '60/40 (SPY + AGG)'
    return BENCHMARKS['SPY'], 'SPY'


def _mix_index(series, mix):
    """A daily-rebalanced index {date: value} of a benchmark mix over the days all its parts have."""
    dates, values = _aligned(series, [s for s, _ in mix])
    if len(dates) < 2:
        return {}
    weights = np.array([w for _, w in mix])
    growth = np.concatenate([[1.0], np.cumprod(1 + (values[1:] / values[:-1] - 1) @ weights)])
    return dict(zip(dates, growth.tolist()))


def _number(msg, key, lo, hi, default=None):
    try:
        v = float(msg.get(key))
    except (TypeError, ValueError):
        return default
    return min(max(v, lo), hi) if np.isfinite(v) else default


@handler('portfolio.optimize')
async def optimize(ctx, msg):
    symbols, current = _clean_holdings(msg)
    if len(symbols) < 2:
        raise EngineError('Optimisation needs at least two holdings.')
    emit = msg.get('_emit')
    method = msg.get('method') if msg.get('method') in METHODS else 'risk_parity'
    estimate = msg.get('estimate') if msg.get('estimate') in ESTIMATES else 'shrunk'
    if method == 'black_litterman':  # the old "My views" method: Growth with the views estimate
        method, estimate = 'growth', 'views'
    lookback = int(msg.get('lookback') or 3) if int(msg.get('lookback') or 3) in (1, 3, 5, 10) else 3
    years = 10  # loaded for the test and the stand-ins; the goals fit on the last `lookback` years
    n = len(symbols)
    cash = {str(h['symbol']).upper().strip() for h in msg.get('holdings') or [] if h.get('cash')}
    cash_idx = [j for j, s in enumerate(symbols) if s in cash]
    keep_cash = msg.get('keepCash', True)
    notes = []
    fixed = {j: float(current[j]) for j in cash_idx} if keep_cash else {}
    lo_all = 0.01 if msg.get('keepAll') else 0.0
    hi_all = _number(msg, 'maxWeight', 0.01, 1.0, default_max_weight(n))
    lo_each, hi_each = np.full(n, lo_all), np.full(n, hi_all)
    for j, s in enumerate(symbols):
        lim = (msg.get('limits') or {}).get(s) if isinstance(msg.get('limits'), dict) else None
        if isinstance(lim, dict):
            lo_each[j] = _number(lim, 'min', 0.0, 1.0, lo_each[j])
            hi_each[j] = max(_number(lim, 'max', 0.0, 1.0, hi_each[j]), lo_each[j])
    min_cash = _number(msg, 'minCash', 0.0, 0.95, 0.0)
    if min_cash:
        if not cash_idx:
            notes.append('Minimum cash needs a cash holding: add Cash to the portfolio to use it.')
        elif keep_cash:
            held = sum(fixed.values())
            if held < min_cash:
                fixed = {j: v * min_cash / held for j, v in fixed.items()}
                notes.append(f'Cash raised from {held:.0%} to the {min_cash:.0%} minimum.')
        else:
            for j in cash_idx:
                lo_each[j] = max(lo_each[j], min_cash / len(cash_idx))
                hi_each[j] = max(hi_each[j], lo_each[j])
    mix, bench_name = _benchmark_mix(msg)
    bench_syms = sorted({s for s, _ in mix})
    loaded, rf, yields = await asyncio.gather(total_return_series(ctx, symbols + bench_syms, years), risk_free(ctx), forward_yields(ctx, symbols))
    for s, v in zip(symbols, loaded):
        if v is None:
            raise EngineError(f'{s}: no price history. Check the ticker.')
    series = dict(zip(symbols, loaded[:n]))
    bench_series = dict(zip(bench_syms, loaded[n:]))
    bench_index = _mix_index(bench_series, mix) if all(bench_series.values()) else {}
    if not bench_index:
        notes.append(f'No price history for the benchmark {bench_name}: "Stay close to a benchmark" tracks nothing and falls back to the lowest volatility.')
    sectors, unknown = (await holding_sectors(ctx, symbols, cash)) if msg.get('sectorCap') else (None, [])
    if unknown:
        notes.append(f'Sector not found for {", ".join(unknown)}: each counts as its own sector.')
    with_bench = bool(bench_index)
    columns = dict(series, **({'__bench__': bench_index} if with_bench else {}))
    keys = symbols + (['__bench__'] if with_bench else [])
    dates, prices = _aligned(columns, keys)
    if len(dates) < 60:
        raise EngineError('Not enough shared price history for these symbols (need at least 3 months).')
    returns = prices[1:] / prices[:-1] - 1
    views = [{**v, 'return': float(v['return']) - rf} for v in msg.get('views') or [] if isinstance(v, dict) and 'return' in v]
    y = np.array([np.nan if v is None else v for v in yields], dtype=float)
    o = {'rf': rf, 'lo': lo_all, 'hi': hi_all, 'loEach': lo_each, 'hiEach': hi_each, 'fixed': fixed,
         'maxChange': _number(msg, 'maxChange', 0.001, 1.0), 'maxTurnover': _number(msg, 'maxTurnover', 0.0, 1.0),
         'maxHoldings': int(msg['maxHoldings']) if str(msg.get('maxHoldings') or '').isdigit() and int(msg['maxHoldings']) >= 1 else None,
         'sectors': sectors, 'sectorCap': _number(msg, 'sectorCap', 0.05, 1.0), 'symbols': symbols,
         'estimate': estimate, 'views': views if estimate == 'views' else [],
         'targetVol': _number(msg, 'targetVol', 0.01, 0.6, TARGET_VOL), 'volCap': _number(msg, 'volCap', 0.01, 0.6, VOL_CAP),
         'teBudget': _number(msg, 'teBudget', 0.0, 0.3, TE_BUDGET), 'yields': y, 'bench': with_bench,
         'cost': _number(msg, 'cost', 0.0, 0.05, 0.001), 'lookback': lookback * TRADING_DAYS,
         'window': lookback * TRADING_DAYS, 'step': TEST_STEPS.get(msg.get('testRebalance'), STEP)}
    if np.isnan(y).all():
        notes.append('No dividend data for these holdings, so "Income" has nothing to aim for.')
    cap_used = sector_cap(o)
    if cap_used and o['sectorCap'] and cap_used > o['sectorCap'] + 1e-9:
        notes.append(f'The {o["sectorCap"]:.0%} sector cap was loosened to {cap_used:.0%}: with only {len({x for x in sectors if x})} sectors it can’t hold all the money.')
    lim_lo, lim_hi = weight_limits(n, {**o, 'cur': current})
    if np.all(lim_hi - lim_lo < 1e-6) or abs(lim_hi.sum() - 1) < 1e-6:
        notes.append('Your limits leave only one possible mix (for example 4 holdings at most 25% each), so every goal gives the same weights: raise "Max per holding" or "Max change" under Advanced settings.')
    if len(returns) < lookback * TRADING_DAYS * 0.9:
        notes.append(f'Your holdings share {len(returns) / TRADING_DAYS:.1f} years of real history, less than the {lookback}-year lookback: the goals use all of it.')

    used, left_out, test, test_dates = [], [], None, dates
    young = young_holdings(series, symbols) if msg.get('standIns', True) is not False else []
    if young:
        core = [c for c in CORE_STAND_INS if c not in symbols]
        rest = [c for c in STAND_INS if c not in symbols and c not in core]
        done = [0]
        candidates = await _load_stand_ins(ctx, core, emit, done, len(core))
        if any(pick_stand_in(series[s], candidates) is None for s in young):  # wider search only when needed
            candidates.update(await _load_stand_ins(ctx, rest, emit, done, len(core) + len(rest)))
        candidates = {c: v for c, v in candidates.items() if v}
        extended, used, left_out = extend_history(series, symbols, candidates, core)
        dropped = {x['symbol'] for x in left_out}
        keep = [j for j, s in enumerate(symbols) if s not in dropped]
        t_keys = [symbols[j] for j in keep] + (['__bench__'] if with_bench else [])
        test_dates, values = _aligned(dict(extended, **({'__bench__': bench_index} if with_bench else {})), t_keys)
        t_cur = current[keep] / current[keep].sum()
        index = {j: k for k, j in enumerate(keep)}
        pick = lambda a: None if a is None else np.asarray(a)[keep]  # noqa: E731
        test = (values[1:] / values[:-1] - 1, t_cur, {**o, 'fixed': {index[j]: float(v) for j, v in fixed.items() if j in index}, 'symbols': [symbols[j] for j in keep],
                                                       'loEach': pick(lo_each), 'hiEach': pick(hi_each), 'yields': pick(y), 'sectors': None if sectors is None else [sectors[j] for j in keep]})
    if emit:
        await emit({'type': 'status', 'text': 'Testing every goal on data it hadn’t seen'})
    jobs = goal_jobs(returns, current, o, 7, test, None, [method] + [g for g in GOALS if g != method])
    results = await _run_jobs(jobs, emit)
    r = await asyncio.to_thread(assemble, returns, current, method, o, results, test, 7)
    estimated = None
    if test is not None and r['walkForward']:
        # Share of the test's out-of-sample days on which at least one holding's history is estimated.
        oos = test_dates[-r['walkForward']['days']:]
        estimated = round(sum(d <= dates[0] for d in oos) / len(oos), 3)
    for table, table_dates in ((r['walkForward'], test_dates), (r['realOnly'], dates)):
        if table:  # the test period actually used (out-of-sample days only)
            table['oosStart'], table['oosEnd'] = table_dates[-table['days']].isoformat(), table_dates[-1].isoformat()
    wf = r['walkForward']
    if wf and not wf['short'] and abs(wf['windowYears'] - lookback) > 0.01:
        notes.append(f'Your {lookback}-year lookback would leave less than a year to test on, so the test refits on {wf["windowYears"]:.0f} years instead.')
    if o['maxTurnover'] is not None and turnover(r['weights'], current) > o['maxTurnover'] + 0.005:
        notes.append(f'The {o["maxTurnover"]:.0%} limit on total change couldn’t be met together with your other limits.')
    return {
        'method': method,
        'goal': method,
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
        'estimatedShare': estimated,
        'walkForward': r['walkForward'],
        'realOnly': r['realOnly'],
        'randomWalk': r['randomWalk'],
        'goals': r['goals'],
        'currentFigures': r['currentFigures'],
        'frontier': r['frontier'],
        'yields': [None if v is None else round(v, 5) for v in yields],
        'sectors': sectors,
        'notes': notes,
        'settings': {'estimate': estimate, 'lookbackYears': lookback, 'testRebalance': msg.get('testRebalance') if msg.get('testRebalance') in TEST_STEPS else 'quarterly',
                     'cost': o['cost'], 'targetVol': o['targetVol'], 'volCap': o['volCap'], 'teBudget': o['teBudget'], 'benchmark': bench_name,
                     'sectorCap': cap_used, 'maxHoldings': o['maxHoldings'], 'maxTurnover': o['maxTurnover'], 'maxChange': o['maxChange'],
                     'maxWeight': hi_all},
    }
