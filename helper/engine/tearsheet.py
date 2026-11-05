"""
Portfolio tear sheet (Account, Portfolios and the client report): value-at-risk and expected shortfall, the
holdings' correlation matrix, rolling 6-month beta and Sharpe against SPY, the five deepest drawdowns, monthly
returns, a block-bootstrap Monte Carlo of the portfolio's value and each holding's share of the risk.

The portfolio is today's weights held through the whole history (rebalanced daily, so no drift), from Schwab daily
closes with Yahoo dividends reinvested (quant.price_matrix). Cash earns nothing. The maths below is pure and tested
against hand-worked values (helper/tests/test_quant_pack.py).

Sources: value-at-risk and expected shortfall, Jorion "Value at Risk" (3rd ed.) ch. 5; the parametric figures assume
normal returns, the historical ones use the actual worst days (overlapping 10-day returns for the 10-day horizon).
Block bootstrap: Künsch (1989); 1-month blocks keep volatility clusters and short trends that a day-by-day shuffle
would break.
"""
import asyncio
import datetime as dt

import numpy as np
from scipy.stats import norm

from . import quant
from .core import EngineError, handler

TRADING_DAYS = quant.TRADING_DAYS
LEVELS = (0.95, 0.99)
HORIZONS = (1, 10)
ROLL = 126  # six months of trading days
TOP_DRAWDOWNS = 5
MC_PATHS = 2000
MC_BLOCK = 21
PERCENTILES = (5, 25, 50, 75, 95)
CASH = 'CASH'


def horizon_returns(returns, days):
    """Overlapping `days`-day compounded returns (each day starts one)."""
    r = np.asarray(returns, dtype=float)
    if days == 1:
        return r
    growth = np.concatenate([[0.0], np.cumsum(np.log1p(r))])
    return np.expm1(growth[days:] - growth[:-days])


def historical_var(returns, level):
    """(VaR, CVaR) as positive fractions: the loss beaten on only (1 - level) of the days, and the average loss on
    those days (expected shortfall)."""
    r = np.asarray(returns, dtype=float)
    cut = np.percentile(r, (1 - level) * 100)
    tail = r[r <= cut]
    return float(-cut), float(-tail.mean()) if len(tail) else float(-cut)


def parametric_var(mean, sd, level, days=1):
    """(VaR, CVaR) for normal returns with this daily mean and standard deviation over `days` days (mean x days,
    sd x square root of days)."""
    m, s = mean * days, sd * np.sqrt(days)
    z = norm.ppf(level)
    return float(-(m - z * s)), float(-(m - s * norm.pdf(z) / (1 - level)))


def var_table(returns, levels=LEVELS, horizons=HORIZONS):
    r = np.asarray(returns, dtype=float)
    mean, sd = float(r.mean()), float(r.std(ddof=1))
    rows = []
    for days in horizons:
        hr = horizon_returns(r, days)
        for level in levels:
            hv, hc = historical_var(hr, level)
            pv, pc = parametric_var(mean, sd, level, days)
            rows.append({'level': level, 'days': days, 'historical': hv, 'historicalCvar': hc, 'parametric': pv, 'parametricCvar': pc, 'samples': len(hr)})
    return rows


def rolling(port, bench, rf, window=ROLL):
    """Rolling beta to the benchmark and Sharpe ratio (yearly excess return over yearly volatility) over the last
    `window` days, one value per day from day `window` on."""
    p, b = np.asarray(port, dtype=float), np.asarray(bench, dtype=float)
    daily_rf = (1 + rf) ** (1 / TRADING_DAYS) - 1
    betas, sharpes = [], []
    for end in range(window, len(p) + 1):
        x, y = p[end - window:end], b[end - window:end]
        var = y.var(ddof=1)
        betas.append(float(np.cov(x, y)[0, 1] / var) if var else None)
        sd = x.std(ddof=1)
        sharpes.append(float((x.mean() - daily_rf) * TRADING_DAYS / (sd * np.sqrt(TRADING_DAYS))) if sd else None)
    return betas, sharpes


def drawdowns(returns, dates, top=TOP_DRAWDOWNS):
    """The `top` deepest drawdowns, deepest first: start (the high before), trough, recovery (back to that high, or
    None) and length in calendar days (start to recovery, or to the last day when not recovered). `dates` has one
    more entry than `returns` (the starting day)."""
    wealth = np.concatenate([[1.0], np.cumprod(1 + np.asarray(returns, dtype=float))])
    peak_value, peak_i, episodes, cur = wealth[0], 0, [], None
    for i in range(1, len(wealth)):
        if wealth[i] >= peak_value:
            if cur:
                cur['end'] = i
                episodes.append(cur)
                cur = None
            peak_value, peak_i = wealth[i], i
        else:
            depth = wealth[i] / peak_value - 1
            if cur is None:
                cur = {'start': peak_i, 'trough': i, 'depth': depth, 'end': None}
            elif depth < cur['depth']:
                cur['trough'], cur['depth'] = i, depth
    if cur:
        episodes.append(cur)
    episodes.sort(key=lambda e: e['depth'])
    out = []
    for e in episodes[:top]:
        last = e['end'] if e['end'] is not None else len(wealth) - 1
        out.append({'start': dates[e['start']].isoformat(), 'trough': dates[e['trough']].isoformat(),
                    'recovered': dates[e['end']].isoformat() if e['end'] is not None else None, 'depth': float(e['depth']),
                    'days': (dates[last] - dates[e['start']]).days, 'toTrough': (dates[e['trough']] - dates[e['start']]).days})
    return out


def monthly_table(returns, dates):
    """{year: {'months': [12 values or None], 'year': compounded return of the months shown}} from daily returns."""
    by = {}
    for r, d in zip(returns, dates[1:]):
        by[(d.year, d.month)] = by.get((d.year, d.month), 1.0) * (1 + r)
    out = {}
    for (y, m), g in sorted(by.items()):
        row = out.setdefault(y, {'months': [None] * 12, 'year': 1.0})
        row['months'][m - 1] = g - 1
        row['year'] *= g
    return [{'year': y, 'months': v['months'], 'total': v['year'] - 1} for y, v in out.items()]


def monte_carlo(returns, value, years=10, paths=MC_PATHS, block=MC_BLOCK, seed=1):
    """Block bootstrap of daily returns into `paths` futures of `years` years: percentiles of the value at each
    year end (index 0 = today). Seeded, so the same history gives the same fan."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 2 * block:
        return None
    rng = np.random.default_rng(seed)
    days = years * TRADING_DAYS
    idx = np.stack([quant._block_sample(len(r), rng, block, days) for _ in range(paths)])
    wealth = value * np.cumprod(1 + r[idx], axis=1)
    yearly = np.column_stack([np.full(paths, float(value)), wealth[:, TRADING_DAYS - 1::TRADING_DAYS]])
    pct = {str(p): np.percentile(yearly, p, axis=0).round(2).tolist() for p in PERCENTILES}
    return {'years': years, 'paths': paths, 'block': block, 'start': float(value), 'percentiles': pct,
            'lossChance': [float((yearly[:, k] < value).mean()) for k in range(years + 1)]}


def risk_split(asset_returns, weights):
    """Each holding's share of the portfolio's variance (sums to 1) and its contribution to yearly volatility."""
    a = np.atleast_2d(np.asarray(asset_returns, dtype=float))
    w = np.asarray(weights, dtype=float)
    cov = np.atleast_2d(np.cov(a, rowvar=False)) * TRADING_DAYS
    var = float(w @ cov @ w)
    if var <= 0:
        return np.zeros(len(w)), np.zeros(len(w)), 0.0
    marginal = cov @ w
    share = w * marginal / var
    return share, share * np.sqrt(var), float(np.sqrt(var))


def _clean(msg):
    rows = {}
    for x in (msg.get('holdings') if isinstance(msg.get('holdings'), list) else [])[:100]:
        if not isinstance(x, dict):
            continue
        try:
            weight = float(x.get('weight') or 0)
        except (TypeError, ValueError):
            continue
        symbol = str(x.get('symbol') or '').strip().upper()
        if symbol and weight > 0:
            rows[symbol] = rows.get(symbol, 0.0) + weight
    if not rows:
        raise EngineError('No holdings with a weight to measure.')
    total = sum(rows.values())
    return list(rows), np.array([v / total for v in rows.values()])


def _sample(values, step):
    idx = list(range(0, len(values), step))
    if idx and idx[-1] != len(values) - 1:
        idx.append(len(values) - 1)
    return idx


@handler('quant.tearsheet')
async def tearsheet(ctx, msg):
    symbols, weights = _clean(msg)
    years = int(min(max(float(msg.get('years') or 5), 1), 20))
    try:
        value = float(msg.get('value') or 0) or 100000.0
    except (TypeError, ValueError):
        value = 100000.0
    priced = [s for s in symbols if s != CASH]
    fetch = priced + (['SPY'] if 'SPY' not in priced else [])
    (dates, prices, info), rf = await asyncio.gather(quant.price_matrix(ctx, fetch, years), quant.risk_free(ctx))
    if len(dates) < ROLL + 20:
        raise EngineError('Not enough shared daily history for these holdings (needs about 7 months). The youngest holding sets the start.')
    rets = prices[1:] / prices[:-1] - 1
    col = {s: rets[:, fetch.index(s)] for s in priced}
    asset = np.column_stack([col[s] if s != CASH else np.zeros(len(rets)) for s in symbols])
    bench = rets[:, fetch.index('SPY')]
    port = asset @ weights
    betas, sharpes = rolling(port, bench, rf)
    step = max(1, len(betas) // 400)
    roll_dates = dates[ROLL:]
    keep = _sample(betas, step)
    share, vol_part, vol = risk_split(asset, weights)
    corr_syms = [s for s in symbols if s != CASH]
    corr = np.corrcoef(np.column_stack([col[s] for s in corr_syms]), rowvar=False) if len(corr_syms) > 1 else np.ones((1, 1))
    horizon = int(min(max(float(msg.get('horizon') or 10), 1), 10))
    wealth = np.concatenate([[1.0], np.cumprod(1 + port)])
    return {
        'symbols': symbols, 'weights': weights.round(6).tolist(), 'value': value,
        'start': dates[0].isoformat(), 'end': dates[-1].isoformat(), 'days': len(port), 'riskFree': rf,
        'priceOnly': [s for s, d in zip(fetch, info['dividends']) if not d],
        'volatility': vol, 'var': var_table(port),
        'correlation': {'symbols': corr_syms, 'matrix': np.atleast_2d(corr).round(3).tolist()},
        'rolling': {'window': ROLL, 'dates': [roll_dates[i].isoformat() for i in keep], 'beta': [betas[i] for i in keep], 'sharpe': [sharpes[i] for i in keep]},
        'drawdowns': drawdowns(port, dates),
        'drawdownNow': float(wealth[-1] / wealth.max() - 1),
        'monthly': monthly_table(port, dates),
        'monteCarlo': monte_carlo(port, value, horizon),
        'risk': [{'symbol': s, 'weight': float(w), 'share': float(c), 'volatility': float(v)} for s, w, c, v in zip(symbols, weights, share, vol_part)],
        'sources': 'Schwab daily closes with Yahoo dividends reinvested; benchmark SPY; risk-free 3-month Treasury (FRED DGS3MO)',
        'asOf': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    }
