"""
What a portfolio is really betting on (risk-model style, like the factor tools big managers use), from free data.

1. Factor exposures: daily portfolio returns above cash regressed on the Fama-French five factors plus momentum
   (Kenneth R. French Data Library, free, daily): market, size (SMB), value (HML), profitability (RMW), investment
   (CMA), momentum (Mom). OLS betas with Newey-West standard errors (5 lags; daily returns are not independent),
   R-squared and the yearly alpha left over. Fama & French (2015), JFE 116(1); Carhart (1997), JF 52(1);
   Newey & West (1987), Econometrica 55(3).
2. Hidden bets: principal components of the holdings' daily returns (covariance). For each component, how much of
   the portfolio's own risk it carries and which holdings drive it, plus the effective number of bets (Meucci 2009,
   "Managing Diversification", Risk): exp of the entropy of the risk shares across components; a 10-stock portfolio
   whose risk is all one component has about 1 bet. Components are only well defined when their variances differ;
   for holdings that are nearly independent and equally volatile the count is approximate.

Request (read-only): portfolio.factors {holdings [{symbol, weight}], years? (default 3), rebalance?}
"""
import asyncio
import datetime as dt
import io
import math
import re
import zipfile

import numpy as np

from . import datahub, quant
from .core import EngineError, handler

FRENCH = 'https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/'
FILES = {'ff5': 'F-F_Research_Data_5_Factors_2x3_daily_CSV.zip', 'mom': 'F-F_Momentum_Factor_daily_CSV.zip'}
FACTORS = (('Mkt-RF', 'Market'), ('SMB', 'Size (small minus big)'), ('HML', 'Value (cheap minus expensive)'),
           ('RMW', 'Profitability (robust minus weak)'), ('CMA', 'Investment (conservative minus aggressive)'), ('Mom', 'Momentum (winners minus losers)'))
NW_LAGS = 5
TOP_COMPONENTS = 3


# ---------- pure maths (tested) ----------

def parse_french_csv(text):
    """A Ken French daily CSV -> (columns, {date: [values as decimals]}). Only the first (daily) table is read."""
    columns, rows = None, {}
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(',')]
        if columns is None:
            if len(cells) > 1 and cells[0] == '' and any(c for c in cells[1:]):
                columns = [c for c in cells[1:] if c]
            continue
        if not re.fullmatch(r'\d{8}', cells[0]):
            if rows:
                break  # the next table (or the copyright line) starts
            continue
        try:
            vals = [float(c) / 100 for c in cells[1: len(columns) + 1]]
        except ValueError:
            continue
        d = cells[0]
        rows[dt.date(int(d[:4]), int(d[4:6]), int(d[6:]))] = vals
    if not columns or not rows:
        raise EngineError('The factor file was not in the expected format.')
    return columns, rows


def ols_newey_west(y, X, lags=NW_LAGS):
    """OLS of y on [1, X] -> (coefficients, Newey-West standard errors, R-squared). Bartlett weights."""
    n = len(y)
    Z = np.column_stack([np.ones(n), X])
    ZtZ_inv = np.linalg.inv(Z.T @ Z)
    beta = ZtZ_inv @ Z.T @ y
    u = y - Z @ beta
    zu = Z * u[:, None]
    S = zu.T @ zu
    for lag in range(1, lags + 1):
        w = 1 - lag / (lags + 1)
        g = zu[lag:].T @ zu[:-lag]
        S += w * (g + g.T)
    cov = ZtZ_inv @ S @ ZtZ_inv
    ss_tot = ((y - y.mean()) ** 2).sum()
    r2 = 1 - (u @ u) / ss_tot if ss_tot else 0.0
    return beta, np.sqrt(np.maximum(np.diag(cov), 0)), float(r2)


def hidden_bets(returns, weights, symbols, top=TOP_COMPONENTS):
    """Principal components of the holdings' covariance and the portfolio's risk share in each; effective bets."""
    cov = np.cov(returns, rowvar=False, ddof=1)
    if cov.ndim == 0:
        cov = cov.reshape(1, 1)
    vals, vecs = np.linalg.eigh(cov)
    order = np.argsort(vals)[::-1]
    vals, vecs = np.maximum(vals[order], 0), vecs[:, order]
    w = np.asarray(weights, float)
    exposure = vecs.T @ w  # the portfolio's position in each component
    risk = exposure ** 2 * vals
    total = risk.sum()
    shares = risk / total if total else np.zeros_like(risk)
    p = shares[shares > 1e-12]
    enb = float(math.exp(-(p * np.log(p)).sum())) if len(p) else 0.0
    comps = []
    for k in range(min(top, len(vals))):
        v = vecs[:, k] * (1 if vecs[:, k].sum() >= 0 else -1)  # sign: mostly positive loadings read "up"
        idx = np.argsort(-np.abs(v))[:5]
        comps.append({'share': float(shares[k]), 'varianceShare': float(vals[k] / vals.sum()) if vals.sum() else 0.0,
                      'drivers': [{'symbol': symbols[i], 'loading': float(v[i])} for i in idx]})
    return {'components': comps, 'effectiveBets': enb, 'holdings': len(symbols)}


# ---------- fetching ----------

async def french(ctx, key):
    async def load():
        response = await datahub.get(ctx.http, 'french', FRENCH + FILES[key])
        response.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            name = next(n for n in z.namelist() if n.lower().endswith('.csv'))
            if z.getinfo(name).file_size > 50_000_000:
                raise EngineError('Factor file is unexpectedly large.')
            text = z.read(name).decode('latin-1')
        columns, rows = parse_french_csv(text)
        return {'columns': columns, 'rows': {d.isoformat(): v for d, v in rows.items()}}
    return await ctx.cached(('french', key), 24 * 3600, load, persist=True, stale_ok=True)


@handler('portfolio.factors')
async def factors(ctx, msg):
    symbols, weights = quant._clean_holdings(msg)
    years = max(1, min(int(msg.get('years') or 3), 10))
    rebalance = msg.get('rebalance') if msg.get('rebalance') in quant.REBALANCE else 'quarterly'
    (dates, prices, _), ff5, mom = await asyncio.gather(quant.price_matrix(ctx, symbols, years + 1), french(ctx, 'ff5'), french(ctx, 'mom'))
    port = quant.portfolio_returns(dates, prices, weights, rebalance)
    asset = prices[1:] / prices[:-1] - 1
    ret_dates = dates[1:]
    f5, fm = ff5['rows'], mom['rows']
    cols5, colm = ff5['columns'], mom['columns']
    last_factor = max(f5)
    start = (dt.date.fromisoformat(last_factor) - dt.timedelta(days=int(365.25 * years))).isoformat()
    idx = [i for i, d in enumerate(ret_dates) if start < d.isoformat() <= last_factor and d.isoformat() in f5 and d.isoformat() in fm]
    if len(idx) < 120:
        raise EngineError('Not enough days where both the portfolio and the factor data exist (need about 6 months).')
    mom_col = next((k for k, m in enumerate(colm) if m.startswith('Mom')), 0)

    def factor_row(day):
        return [f5[day][cols5.index(c)] for c, _ in FACTORS[:5]] + [fm[day][mom_col]]
    X = np.array([factor_row(ret_dates[i].isoformat()) for i in idx])
    rf = np.array([f5[ret_dates[i].isoformat()][cols5.index('RF')] for i in idx])
    y = port[idx] - rf
    beta, se, r2 = ols_newey_west(y, X)
    rows = []
    for k, (code, label) in enumerate(FACTORS, start=1):
        rows.append({'code': code, 'label': label, 'beta': float(beta[k]), 'se': float(se[k]), 't': float(beta[k] / se[k]) if se[k] else None,
                     'low': float(beta[k] - 1.96 * se[k]), 'high': float(beta[k] + 1.96 * se[k])})
    window = asset[-min(len(asset), int(252 * years)):]
    return {
        'symbols': symbols, 'start': ret_dates[idx[0]].isoformat(), 'end': ret_dates[idx[-1]].isoformat(), 'days': len(idx),
        'factors': rows, 'rSquared': r2,
        'alpha': {'yearly': float(beta[0] * quant.TRADING_DAYS), 't': float(beta[0] / se[0]) if se[0] else None},
        'bets': hidden_bets(window, weights, symbols),
        'source': 'Kenneth R. French Data Library (daily Fama-French 5 factors + momentum); prices from Schwab with dividends.',
    }
