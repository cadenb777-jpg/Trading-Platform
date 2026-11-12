"""
The Treasury curve the way rates desks read it: a smooth fitted curve, which maturities sit off it (rich or cheap),
forward rates, inflation breakevens and the yield-curve recession model.

1. Fitted curve. The Nelson-Siegel-Svensson form for zero-coupon rates (continuous compounding, t in years):
       z(t) = b0 + b1 L1 + b2 (L1 - e^(-t/T1)) + b3 (L2 - e^(-t/T2)),   L = (1 - e^(-t/T)) / (t/T)
   the form the Federal Reserve uses for its own published curve (Gurkaynak, Sack and Wright, "The U.S. Treasury
   Yield Curve: 1961 to the Present", FEDS 2006-28; Svensson 1994, NBER WP 4871). It is fitted to Treasury's daily
   par yields by turning the zero curve into the par yields it implies and minimising the gap (least squares over
   several starting shapes):
       bills (6 months or less):  y = (1/D(t) - 1) / t               (simple, bond-equivalent)
       1 year:                    y = 2 (D(t)^(-1/(2t)) - 1)          (semiannual)
       notes and bonds:           y = 2 (1 - D(t)) / sum D(i/2), i = 1..2t   (semiannual coupons priced at par)
   with D(t) = e^(-z(t) t).
2. Rich / cheap. gap = actual par yield - fitted par yield, in basis points. A yield above the curve is "cheap" (its
   price is low next to its neighbours). Some maturities always sit off the curve (the 20-year has been cheap since
   it returned in 2020), so each gap is also compared with its own last year: z = (gap - mean) / SD over one fitted
   day a week for 52 weeks (26 at least). Only |z| >= 2.5 is called unusual (14 maturities: at 2 SD one would
   turn up by chance on about half of all days). Past fits are saved (cache.db), so each
   day is fitted once.
3. Forwards from the fitted zero curve: f(t1, t2) = (z2 t2 - z1 t1) / (t2 - t1), shown semiannual like Treasury
   yields: 2 (e^(f/2) - 1).
4. Breakeven inflation = nominal par yield - TIPS real par yield at the same maturity (Treasury's real yield curve).
   It also holds liquidity and risk premiums, so it is the market's inflation compensation, not a forecast.
5. Recession odds, 12 months ahead: a probit on the 10-year minus 3-month Treasury spread (Estrella and Mishkin 1998,
   "Predicting U.S. Recessions", REStat 80(1); the New York Fed's model: Estrella and Trubin 2006, Current Issues
   12(5)). P = N(a + b x spread), spread = monthly 10-year yield (FRED GS10) minus the 3-month bill (FRED TB3MS,
   discount basis converted to bond-equivalent: 365 d / (360 - 91 d)), recession = NBER month (FRED USREC). The
   coefficients are fitted here by maximum likelihood on every month whose outcome NBER has had a year to date, so
   the figures are ours and reproducible; the record (recessions it flagged, false alarms) is shown with them.

Request (read-only): bonds.curvefit {}
"""
import asyncio
import csv
import datetime as dt
import io
import math
import time

import httpx

from . import datahub, macro
from .core import EngineError, handler

PAR_CSV = ('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/'
           '{year}/all?type={kind}&field_tdr_date_value={year}&page&_format=csv')
#: Treasury's column names -> years (the 1.5-month bill started in 2025, the 4-month in 2022)
TENORS = {'1 Mo': 1 / 12, '1.5 Month': 1.5 / 12, '2 Mo': 2 / 12, '3 Mo': 0.25, '4 Mo': 4 / 12, '6 Mo': 0.5, '1 Yr': 1.0,
          '2 Yr': 2.0, '3 Yr': 3.0, '5 Yr': 5.0, '7 Yr': 7.0, '10 Yr': 10.0, '20 Yr': 20.0, '30 Yr': 30.0}
REAL_TENORS = {'5 YR': 5.0, '7 YR': 7.0, '10 YR': 10.0, '20 YR': 20.0, '30 YR': 30.0}
FORWARDS = [(1, 2, '1-year rate, 1 year from now'), (2, 3, '1-year rate, 2 years from now'),
            (5, 10, '5-year rate, 5 years from now'), (10, 20, '10-year rate, 10 years from now')]
#: the usual gap is measured on one fitted day a week (every 5th trading day) for a year; 4 weeks back = "a month ago"
SAMPLE_EVERY = 5
SAMPLES = 52
MONTH_BACK = 20
MIN_HISTORY = 26
#: 2.5 SD: with 14 maturities a 2 SD reading would turn up by chance on about half of all days
UNUSUAL_Z = 2.5
RECESSION_START = '1959-01-01'
ALARM = 0.30
#: 1 hour: Treasury posts the day's curve once, after the close
FRESH_SECONDS = 3600
FITS_KEY = ('treasury', 'nss-fits')


# ---------- pure maths (tested) ----------

def _loading(t, tau):
    x = t / tau
    return 1.0 if x < 1e-8 else (1 - math.exp(-x)) / x


def nss_zero(p, t):
    """Zero-coupon rate (decimal, continuous) at t years for params (b0, b1, b2, b3, tau1, tau2)."""
    b0, b1, b2, b3, t1, t2 = p
    l1, l2 = _loading(t, t1), _loading(t, t2)
    return b0 + b1 * l1 + b2 * (l1 - math.exp(-t / t1)) + b3 * (l2 - math.exp(-t / t2))


def nss_forward(p, t):
    """Instantaneous forward rate at t years."""
    b0, b1, b2, b3, t1, t2 = p
    return b0 + b1 * math.exp(-t / t1) + b2 * (t / t1) * math.exp(-t / t1) + b3 * (t / t2) * math.exp(-t / t2)


def discount(p, t):
    return math.exp(-nss_zero(p, t) * t)


def par_yield(p, t):
    """The par yield (decimal) Treasury would quote at maturity t for the zero curve p (conventions in the docstring)."""
    if t <= 0.5 + 1e-9:
        return (1 / discount(p, t) - 1) / t
    if t <= 1 + 1e-9:
        return 2 * (discount(p, t) ** (-1 / (2 * t)) - 1)
    n = int(round(2 * t))
    annuity = sum(discount(p, i / 2) for i in range(1, n + 1))
    return 2 * (1 - discount(p, t)) / annuity


def forward(p, t1, t2):
    """Forward rate between t1 and t2 years, semiannual bond-equivalent (decimal)."""
    f = (nss_zero(p, t2) * t2 - nss_zero(p, t1) * t1) / (t2 - t1)
    return 2 * (math.exp(f / 2) - 1)


_BOUNDS = ([-0.02, -0.2, -0.4, -0.4, 0.05, 0.5], [0.2, 0.2, 0.4, 0.4, 10.0, 40.0])
#: starting (tau1, tau2) shapes: on a year of 2025-26 curves each of these won on some days, so all are tried
STARTS = ((0.5, 5.0), (1.5, 10.0), (3.0, 15.0), (1.0, 25.0), (0.3, 2.0), (5.0, 30.0))


def _par_vector(tenors):
    """A fast par-yield function for fixed maturities (numpy; same conventions as par_yield)."""
    import numpy as np
    t = np.asarray(tenors, float)
    halves = np.arange(1, int(round(2 * max(tenors))) + 1) / 2
    coupon = [(i, int(round(2 * x))) for i, x in enumerate(tenors) if x > 1 + 1e-9]

    def zero(p, x):
        b0, b1, b2, b3, t1, t2 = p
        e1, e2 = np.exp(-x / t1), np.exp(-x / t2)
        l1, l2 = (1 - e1) / (x / t1), (1 - e2) / (x / t2)
        return b0 + b1 * l1 + b2 * (l1 - e1) + b3 * (l2 - e2)

    def par(p):
        d = np.exp(-zero(p, t) * t)
        out = np.where(t <= 0.5 + 1e-9, (1 / d - 1) / t, 2 * (d ** (-1 / (2 * t)) - 1))
        if coupon:
            cum = np.cumsum(np.exp(-zero(p, halves) * halves))
            for i, n in coupon:
                out[i] = 2 * (1 - d[i]) / cum[n - 1]
        return out
    return par


def fit_nss(tenors, yields):
    """Least-squares NSS fit to par yields (decimal). Returns (params, rmse in bp). Every starting shape in STARTS is
    tried because the problem has local minima (warm-starting from yesterday's fit was 18x faster but its error was 30%
    larger on 2025-26 curves, so past fits are saved instead)."""
    import numpy as np
    from scipy.optimize import least_squares
    if len(tenors) < 6:
        raise ValueError('need at least 6 maturities')
    par = _par_vector(tenors)
    target = np.asarray(yields, float)

    def resid(p):
        return 1e4 * (par(p) - target)

    long, short = yields[-1], yields[0]
    starts = [[long, short - long, 0.0, 0.0, t1, t2] for t1, t2 in STARTS]
    best = None
    for s in starts:
        s = [min(max(v, lo + 1e-9), hi - 1e-9) for v, lo, hi in zip(s, *_BOUNDS)]
        try:
            r = least_squares(resid, s, bounds=_BOUNDS, x_scale=[0.01, 0.01, 0.01, 0.01, 1, 1], max_nfev=300)
        except (ValueError, OverflowError, FloatingPointError):
            continue
        if not np.isfinite(r.cost):
            continue
        if best is None or r.cost < best.cost:
            best = r
    if best is None:
        raise ValueError('the curve could not be fitted')
    return tuple(float(v) for v in best.x), math.sqrt(2 * best.cost / len(tenors))


def gap_stats(history, today):
    """Today's gap (bp) against the same maturity's gaps on earlier fitted days: mean, SD, z (None if too short)."""
    if len(history) < MIN_HISTORY:
        return {'mean': None, 'sd': None, 'z': None, 'days': len(history)}
    n = len(history)
    mean = sum(history) / n
    sd = math.sqrt(sum((g - mean) ** 2 for g in history) / (n - 1))
    return {'mean': mean, 'sd': sd, 'z': (today - mean) / sd if sd > 1e-9 else None, 'days': n}


def reading(gap, z):
    """Plain words for one maturity (gap > 0: yield above the curve = cheap)."""
    if z is None:
        return 'not enough history yet'
    if z >= UNUSUAL_Z:
        return 'unusually cheap (yield high next to its neighbours)'
    if z <= -UNUSUAL_Z:
        return 'unusually rich (yield low next to its neighbours)'
    return 'in its usual place'


def bill_bey(discount_pct, days=91):
    """3-month bill discount rate (%) -> bond-equivalent yield (%)."""
    d = discount_pct / 100
    return 100 * 365 * d / (360 - days * d)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def probit_fit(x, y):
    """Maximum-likelihood probit P(y=1) = N(a + b x). Returns (a, b)."""
    import numpy as np
    from scipy.optimize import minimize
    from scipy.stats import norm
    X = np.asarray(x, float)
    Y = np.asarray(y, float)

    def nll(p):
        s = p[0] + p[1] * X
        return -float(np.sum(Y * norm.logcdf(s) + (1 - Y) * norm.logcdf(-s)))
    r = minimize(nll, [0.0, 0.0], method='BFGS')
    return float(r.x[0]), float(r.x[1])


def auc(scores, labels):
    """Area under the ROC curve: the chance a month before a recession scores above a month that isn't."""
    pos = [s for s, l in zip(scores, labels) if l]
    neg = [s for s, l in zip(scores, labels) if not l]
    if not pos or not neg:
        return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def recession_record(months, probs, rec, alarm=ALARM, lead=18, known_until=None):
    """How the model did: each recession start and whether the odds reached `alarm` in the `lead` months before it;
    alarm episodes (runs of months at or above `alarm`) with no recession under way or starting within `lead` months.
    Only outcomes up to `known_until` (YYYY-MM; NBER dates recessions months late, so recent zeros are provisional)
    count: a later episode stays open, never a false alarm."""
    known = len(months) - 1 if known_until is None else max((i for i, m in enumerate(months) if m <= known_until), default=-1)
    starts = [i for i in range(1, min(len(rec), known + 1)) if rec[i] and not rec[i - 1]]
    flagged = []
    for s in starts:
        window = probs[max(0, s - lead):s]
        flagged.append({'start': months[s], 'flagged': any(p is not None and p >= alarm for p in window)})
    episodes, i = [], 0
    while i < len(probs):
        if probs[i] is not None and probs[i] >= alarm:
            j = i
            while j + 1 < len(probs) and probs[j + 1] is not None and probs[j + 1] >= alarm:
                j += 1
            # a recession already under way, or one starting within `lead` months, means the alarm was right
            followed = any(rec[k] for k in range(i, min(len(rec), i + lead + 1)))
            # an episode too recent to judge (its 18 months aren't known yet) is left out of the false alarms
            judged = i + lead <= known
            episodes.append({'from': months[i], 'to': months[j], 'recession': followed, 'judged': judged or followed})
            i = j + 1
        else:
            i += 1
    return {'recessions': flagged, 'falseAlarms': [e for e in episodes if e['judged'] and not e['recession']],
            'open': [e for e in episodes if not e['judged']]}


def months_back(ym, n):
    y, m = int(ym[:4]), int(ym[5:7]) - n
    while m < 1:
        y, m = y - 1, m + 12
    return f'{y}-{m:02d}'


def _training(months, spread, usrec, known_until):
    """(spreads, recession 12 months later) for every month whose outcome is known by `known_until`."""
    xs, ys = [], []
    for i, m in enumerate(months):
        if i + 12 < len(months) and months[i + 12] <= known_until and months[i + 12] in usrec:
            xs.append(spread[m])
            ys.append(usrec[months[i + 12]])
    return xs, ys


MIN_TRAINING = 240


def recession_model(gs10, tb3, usrec, last_known):
    """The probit fitted on every month whose outcome 12 months on is known (<= last_known): today's odds and the
    monthly series. Its record and AUC are out of sample: each January the model is refitted on only what was known
    then (outcomes at least a year old, as NBER dates late) and that fit alone scores the year's months, so a
    recession never helps to "predict" itself. Inputs: {YYYY-MM: value}."""
    months = sorted(set(gs10) & set(tb3))
    spread = {m: gs10[m] - bill_bey(tb3[m]) for m in months}
    xs, ys = _training(months, spread, usrec, last_known)
    if len(xs) < MIN_TRAINING or sum(ys) < 3:
        raise ValueError('not enough history for the recession model')
    a, b = probit_fit(xs, ys)
    probs = [norm_cdf(a + b * spread[m]) for m in months]
    # out of sample: refit each January on what was known then
    oos, fit, year = [None] * len(months), None, None
    for i, m in enumerate(months):
        if m[:4] != year:
            year = m[:4]
            tx, ty = _training(months, spread, usrec, months_back(m, 12))
            fit = probit_fit(tx, ty) if len(tx) >= MIN_TRAINING and sum(ty) >= 3 else None
        if fit:
            oos[i] = norm_cdf(fit[0] + fit[1] * spread[m])
    rec = [usrec.get(m, 0) for m in months]
    scored = [i for i, p in enumerate(oos) if p is not None and i + 12 < len(months) and months[i + 12] <= last_known]
    first = next((i for i, p in enumerate(oos) if p is not None), None)
    if first is None:
        raise ValueError('not enough history to test the recession model')
    record = recession_record(months[first:], oos[first:], rec[first:], known_until=last_known)
    return {'a': a, 'b': b, 'n': len(xs), 'months': months, 'spread': spread, 'probs': probs,
            'auc': auc([oos[i] for i in scored], [rec[i + 12] for i in scored]), 'testFrom': months[first],
            'record': record, 'from': months[0], 'to': last_known}


def parse_curve_csv(text, columns):
    """Treasury's CSV -> [(YYYY-MM-DD, {years: yield %})], oldest first."""
    rows = []
    reader = csv.reader(io.StringIO(text.strip()))
    header = [h.strip() for h in next(reader, [])]
    for cells in reader:
        if not cells or '/' not in cells[0]:
            continue
        m, d, y = cells[0].split('/')
        point = {}
        for name, years in columns.items():
            if name in header:
                v = cells[header.index(name)].strip() if header.index(name) < len(cells) else ''
                if v not in ('', 'N/A'):
                    try:
                        point[years] = float(v)
                    except ValueError:
                        pass
        if point:
            rows.append((f'{y}-{int(m):02d}-{int(d):02d}', point))
    return sorted(rows)


def fit_days(days, known=None):
    """Fits each (date, {years: yield %}) from every starting shape. `known` ({date: {p, rmse, y}}) holds earlier fits
    and is updated in place: a past day is fitted once and again only if Treasury revised its yields."""
    known = {} if known is None else known
    out = []
    for date, point in days:
        tenors = sorted(point)
        ys = [[t, point[t]] for t in tenors]
        hit = known.get(date)
        if hit and hit.get('y') == ys:
            out.append((date, tuple(hit['p']), hit['rmse'], point))
            continue
        try:
            p, rmse = fit_nss(tenors, [point[t] / 100 for t in tenors])
        except ValueError:
            continue
        known[date] = {'p': list(p), 'rmse': rmse, 'y': ys}
        out.append((date, p, rmse, point))
    return out


def _label(years):
    if years < 1:
        m = round(years * 12, 1)
        return f'{m:g}M'
    return f'{years:g}Y'


def analyse(par_days, real_days, model, known=None):
    """Everything bonds.curvefit replies with, from parsed curves and the recession model (pure apart from updating
    `known`, the saved fits)."""
    if not par_days:
        raise ValueError('no curve')
    last = len(par_days) - 1
    picks = [i for i in range(last, -1, -SAMPLE_EVERY)][:SAMPLES + 1][::-1]
    fits = fit_days([par_days[i] for i in picks], known)
    if not fits or fits[-1][0] != par_days[-1][0]:
        raise ValueError('the latest day of the curve could not be fitted')
    date, p, rmse, point = fits[-1]
    gaps = {t: [1e4 * (pt[t] / 100 - par_yield(pp, t)) for _, pp, _, pt in fits[:-1] if t in pt] for t in point}
    back = [f for f in fits if f[0] == par_days[last - MONTH_BACK][0]] if last >= MONTH_BACK else []
    month_ago = back[0] if back else None
    rows = []
    for t in sorted(point):
        g = 100 * (point[t] - 100 * par_yield(p, t))
        st = gap_stats(gaps[t], g)
        rows.append({'label': _label(t), 'years': t, 'yield': point[t], 'fitted': 100 * par_yield(p, t), 'gapBp': g,
                     'usualBp': st['mean'], 'sdBp': st['sd'], 'z': st['z'], 'days': st['days'], 'reading': reading(g, st['z'])})
    # monthly to a year, then every half year (coupon par yields are defined on whole coupon dates)
    grid = [x / 12 for x in range(1, 12)] + [x / 2 for x in range(2, 61)]
    curve = [{'years': t, 'par': 100 * par_yield(p, t), 'zero': 100 * (2 * (math.exp(nss_zero(p, t) / 2) - 1)),
              'forward': 100 * (2 * (math.exp(nss_forward(p, t) / 2) - 1))} for t in grid]
    fwd = [{'from': a, 'to': b, 'label': label, 'rate': 100 * forward(p, a, b),
            'monthAgo': 100 * forward(month_ago[1], a, b) if month_ago else None} for a, b, label in FORWARDS]
    real = dict(real_days[-1][1]) if real_days else {}
    real_date = real_days[-1][0] if real_days else None
    real_ago = None
    if real_days and month_ago:
        older = [r for r in real_days if r[0] <= month_ago[0]]
        real_ago = older[-1][1] if older else None
    nominal_ago = month_ago[3] if month_ago else {}
    breakevens = []
    if real_date == date:
        for t in sorted(real):
            if t in point:
                be = point[t] - real[t]
                ago = (nominal_ago.get(t) - real_ago[t]) if real_ago and t in real_ago and t in nominal_ago else None
                breakevens.append({'label': _label(t), 'nominal': point[t], 'real': real[t], 'breakeven': be, 'monthAgo': ago})
    rec = None
    if model:
        # this month so far, from the daily curve (both on Treasury's bond-equivalent basis)
        month = date[:7]
        this_month = [pt[10.0] - pt[0.25] for d, pt in par_days if d.startswith(month) and 10.0 in pt and 0.25 in pt]
        spread_now = sum(this_month) / len(this_month) if this_month else None
        prob_now = norm_cdf(model['a'] + model['b'] * spread_now) if spread_now is not None else None
        hist = [{'month': m, 'spread': model['spread'][m], 'p': pr} for m, pr in zip(model['months'], model['probs'])][-36:]
        rec = {'probability': prob_now, 'spread': spread_now, 'monthDays': len(this_month), 'month': month,
               'a': model['a'], 'b': model['b'], 'n': model['n'], 'auc': model['auc'], 'testFrom': model['testFrom'], 'fitFrom': model['from'],
               'fitTo': model['to'], 'history': hist, 'record': model['record'], 'alarm': ALARM}
    rich = min((r for r in rows if r['z'] is not None), key=lambda r: r['z'], default=None)
    cheap = max((r for r in rows if r['z'] is not None), key=lambda r: r['z'], default=None)
    return {'date': date, 'params': list(p), 'rmseBp': rmse, 'fittedDays': len(fits), 'rows': rows, 'curve': curve,
            'forwards': fwd, 'monthAgoDate': month_ago[0] if month_ago else None, 'breakevens': breakevens,
            'realDate': real_date, 'recession': rec,
            'richest': rich and {'label': rich['label'], 'z': rich['z'], 'gapBp': rich['gapBp']},
            'cheapest': cheap and {'label': cheap['label'], 'z': cheap['z'], 'gapBp': cheap['gapBp']}}


# ---------- data ----------

def _job(par, real, gs10, tb3, usrec, known):
    """The heavy part (probit refits, about 50 curve fits from six starting shapes), run in a worker process.
    Returns (reply, saved fits, notes)."""
    notes, model = [], None
    if gs10 is None or not usrec:
        notes.append('Recession odds unavailable: FRED could not be reached.')
    else:
        # NBER dates recessions late: only outcomes at least a year old count as known
        try:
            model = recession_model(gs10, tb3, usrec, months_back(max(usrec), 12))
        except ValueError as err:
            notes.append(f'Recession odds unavailable: {err}.')
    out = analyse(par, real, model, known)
    return out, known, notes


async def _run_job(*args):
    """In the scanner's spawn worker pool ('curve'), so the fits never hold up live quotes; a thread if it can't start."""
    from . import scanner
    if scanner.USE_PROCESSES:
        import concurrent.futures
        try:
            return await asyncio.get_running_loop().run_in_executor(scanner._pool('curve'), _job, *args)
        except concurrent.futures.process.BrokenProcessPool:
            scanner._pools.pop('curve', None)
    return await asyncio.to_thread(_job, *args)


async def treasury_curve(ctx, kind='daily_treasury_yield_curve'):
    """Treasury's daily curve for this year and last: [(YYYY-MM-DD, {years: yield %})], oldest first. Shared with
    macro.treasury_yields (the FRED backup)."""
    columns = TENORS if kind == 'daily_treasury_yield_curve' else REAL_TENORS

    async def load():
        year = dt.date.today().year
        rows = []
        for y in (year - 1, year):
            # treasury.gov's CSV export can take 15-20 s to start answering (seen 2026-11-12), beyond the usual 12 s
            r = await datahub.get(ctx.http, 'treasury', PAR_CSV.format(year=y, kind=kind), timeout=httpx.Timeout(45, connect=10))
            r.raise_for_status()
            rows += parse_curve_csv(r.text, columns)
        # saved as JSON, so maturities travel as [years, yield] pairs (JSON object keys would turn into text)
        return [[d, sorted(pt.items())] for d, pt in sorted(dict(rows).items())]
    saved = await ctx.cached(('treasury', kind), FRESH_SECONDS, load, persist=True, stale_ok=True)
    return [(d, {float(t): float(v) for t, v in pairs}) for d, pairs in saved]


async def _monthly(ctx, sid):
    async def load():
        return await macro._fred_download(ctx, sid, start=RECESSION_START)
    rows = await ctx.cached(('fred', sid, 'long'), 12 * 3600, load, persist=True, stale_ok=True)
    return {d[:7]: v for d, v in rows}


@handler('bonds.curvefit')
async def curvefit(ctx, msg):
    async def load():
        par, real, gs10, tb3, usrec = await asyncio.gather(
            treasury_curve(ctx), treasury_curve(ctx, 'daily_treasury_real_yield_curve'),
            _monthly(ctx, 'GS10'), _monthly(ctx, 'TB3MS'), _monthly(ctx, 'USREC'), return_exceptions=True)
        if isinstance(par, Exception) or not par:
            raise EngineError(f'Could not load the Treasury yield curve ({type(par).__name__ if isinstance(par, Exception) else "empty"}).')
        fred_ok = not any(isinstance(x, Exception) for x in (gs10, tb3, usrec))
        notes = []
        if isinstance(real, Exception):
            notes.append('Breakevens unavailable: Treasury real yields could not be loaded.')
            real = []
        saved = await asyncio.to_thread(ctx.disk.get, repr(FITS_KEY))
        known = saved[1] if saved and isinstance(saved[1], dict) else {}
        try:
            out, known, more = await _run_job(par, real, gs10 if fred_ok else None, tb3 if fred_ok else None,
                                              usrec if fred_ok else None, known)
        except ValueError as err:
            raise EngineError(f'The curve could not be fitted: {err}.') from err
        # only the weekly sample days are saved: a year of them, plus a few spare
        keep = {d: known[d] for d in sorted(known)[-(SAMPLES + 10):]}
        await asyncio.to_thread(ctx.disk.put, repr(FITS_KEY), time.time(), keep)
        out['notes'] = notes + more
        out['sources'] = [
            {'name': 'U.S. Treasury daily par yield curve', 'asOf': out['date'], 'url': 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates'},
            {'name': 'U.S. Treasury daily real (TIPS) yield curve', 'asOf': out['realDate'], 'url': 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates'},
            {'name': 'FRED GS10, TB3MS, USREC (monthly; NBER recession months)', 'asOf': max(usrec) if fred_ok and usrec else None, 'url': 'https://fred.stlouisfed.org/series/USREC'},
        ]
        return out
    return await ctx.cached(('treasury', 'curvefit'), FRESH_SECONDS, load, persist=True, stale_ok=True)
