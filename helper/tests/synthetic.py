"""Realistic synthetic markets for the statistical tests (standard library only).

A shared market factor with volatility clustering (GARCH) and fat tails, stocks with their own beta, volatility and
drift, and optional planted edges:
  reversal  - the stock's own (idiosyncratic) moves partly reverse over the next 3 bars;
  momentum  - each stock has a slowly wandering drift, so past trends tend to continue.
With neither, nothing is predictable: any strategy "edge" found there is luck. Nothing here is real market data.
"""
import datetime as dt
import math
import random

EASTERN_OFFSET = 5  # daily bars stamped at 05:00 UTC (US midnight), like Schwab's


def _days(n, start=dt.date(2011, 1, 3)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


GAP_SHARE = 0.3  # share of a bar's variance that arrives overnight (in the gap at the open)


def _shock(rnd, sd):
    """(gap, move from open to close, variance of that move) for one bar: normal shocks with one fat-tail scale
    (Student t with 5 degrees of freedom, as a normal scale mixture) shared by the gap and the day."""
    nu = 5.0
    s = sd * math.sqrt((nu - 2) / nu / rnd.gammavariate(nu / 2, 2 / nu))
    return rnd.gauss(0, s * math.sqrt(GAP_SHARE)), rnd.gauss(0, s * math.sqrt(1 - GAP_SHARE)), s * s * (1 - GAP_SHARE)


def market(stocks=100, n=3780, seed=1, reversal=0.0, momentum=0.0, drift=0.0004, hourly=False):
    """{symbol: bars} plus 'QQQ' (the market factor). n bars per stock; daily bars, or 7 regular-session hourly bars a
    day when `hourly` (volatility scaled down by sqrt 7). reversal: share of the last 3 bars' own moves that reverses
    (e.g. 0.06); momentum: daily standard deviation of the wandering drift (e.g. 0.0003)."""
    rnd = random.Random(seed)
    per_day = 7 if hourly else 1
    scale = 1 / math.sqrt(per_day)
    days = _days(n // per_day + 2)
    times = []
    for d in days:
        if hourly:
            for h in range(7):
                start = dt.datetime(d.year, d.month, d.day, 13, 30, tzinfo=dt.timezone.utc) + dt.timedelta(hours=h)  # 9:30 NY (EDT)
                times.append(int(start.timestamp()))
        else:
            times.append(int(dt.datetime(d.year, d.month, d.day, EASTERN_OFFSET, tzinfo=dt.timezone.utc).timestamp()))
    times = times[:n]
    mdrift = drift * scale * scale
    # Market factor: GARCH(1,1) volatility around 1.1% a day, fat tails.
    var, mkt = (0.011 * scale) ** 2, []
    omega, alpha, beta = (0.011 * scale) ** 2 * 0.02, 0.08, 0.90
    for _ in range(n):
        g, x, vx = _shock(rnd, math.sqrt(var))
        mkt.append((g, x, vx))
        var = omega + alpha * (g + x) ** 2 + beta * var
    out = {'QQQ': _bars(times, [(g + mdrift * GAP_SHARE, x + mdrift * (1 - GAP_SHARE), vx) for g, x, vx in mkt], rnd)}
    for k in range(stocks):
        b, iv = rnd.uniform(0.7, 1.4), rnd.uniform(0.010, 0.025) * scale
        mu = rnd.gauss(0.0001, 0.0002) * scale * scale
        v, a, hist, parts = iv * iv, 0.0, [0.0, 0.0, 0.0], []
        for i in range(n):
            ge, xe, ve = _shock(rnd, math.sqrt(v))
            e = ge + xe
            v = iv * iv * 0.05 + 0.07 * e * e + 0.88 * v
            if momentum:
                a = 0.995 * a + rnd.gauss(0, momentum * scale * scale * math.sqrt(1 - 0.995 ** 2))
            det = mu + a + b * mdrift - reversal * sum(hist)
            hist = [e] + hist[:2]
            gm, xm, vm = mkt[i]
            parts.append((b * gm + ge + det * GAP_SHARE, b * xm + xe + det * (1 - GAP_SHARE), b * b * vm + ve))
        out[f'S{k:03d}'] = _bars(times, parts, rnd)
    return out


def _bars(times, parts, rnd):
    """OHLC bars from (gap, open-to-close move, its variance). The high and low are drawn from the exact distribution
    of a continuous Brownian path's maximum / minimum between the open and the close, so a stop order fills with the
    right probability for the close it ends at. (Highs and lows made as small noise around max(open, close), or as
    the max of a few steps, give buy-stop entries a fake edge: they would fill mostly on bars that close above the
    trigger, or below the path's true price.)"""
    p, out = 100.0, []
    for t, (g, x, vx) in zip(times, parts):
        o = p * math.exp(g)
        c = o * math.exp(x)
        up = (x + math.sqrt(x * x - 2 * vx * math.log(1 - rnd.random()))) / 2
        down = (x - math.sqrt(x * x - 2 * vx * math.log(1 - rnd.random()))) / 2
        r = g + x
        vol = 1_000_000 * math.exp(rnd.gauss(0, 0.3)) * (1 + abs(r) / math.sqrt(vx / (1 - GAP_SHARE) + 1e-12))
        out.append({'time': t, 'open': o, 'high': o * math.exp(max(up, 0.0, x)), 'low': o * math.exp(min(down, 0.0, x)), 'close': c, 'volume': vol})
        p = c
    return out


def weekly(bars):
    """Daily bars joined into weekly bars stamped on the week's first day (like Schwab's weekly history)."""
    out, key = [], None
    for b in bars:
        d = dt.datetime.fromtimestamp(b['time'], dt.timezone.utc).date()
        k = d.isocalendar()[:2]
        if k != key:
            key = k
            out.append(dict(b))
        else:
            w = out[-1]
            w['high'], w['low'], w['close'], w['volume'] = max(w['high'], b['high']), min(w['low'], b['low']), b['close'], w['volume'] + b['volume']
    return out


def cot_rows(n_weeks=800, seed=3, start=dt.date(2010, 1, 5), signal=None):
    """Weekly COT report rows (Tuesday dates, oldest first). commNet is a random walk unrelated to prices unless
    `signal` (a function date -> number) is given, which is added so the index tracks it (a planted COT edge)."""
    rnd, net, out = random.Random(seed), 0.0, []
    for k in range(n_weeks):
        d = start + dt.timedelta(weeks=k)
        net = 0.97 * net + rnd.gauss(0, 1)
        out.append({'date': d.isoformat(), 'commNet': net + (signal(d) if signal else 0.0)})
    return out


def cot_world(seed, edge, weeks=200, per_week=8):
    """Weekly COT readings (persistent, like the real index) and edge-study events that share each week's market move.
    With edge > 0, events whose direction COT agrees with (60+) earn `edge` more, those it is against (40-) less."""
    rnd = random.Random(seed)
    start, raw, cot, events = dt.date(2015, 1, 6), 0.0, [], []
    for k in range(weeks):
        raw = 0.95 * raw + rnd.gauss(0, 1)
        cot.append(((start + dt.timedelta(weeks=k)).isoformat(), 100 / (1 + math.exp(-raw))))
    for k in range(weeks - 1):
        val, day, mkt = cot[k][1], start + dt.timedelta(weeks=k, days=6), rnd.gauss(0, 0.02)  # the Monday after the release
        t = int(dt.datetime(day.year, day.month, day.day, 5, tzinfo=dt.timezone.utc).timestamp())
        for _ in range(per_week):
            d = rnd.choice((1, -1))
            lean = val if d > 0 else 100 - val
            events.append({'time': t, 'dir': d, 'ret': mkt * d + rnd.gauss(0, 0.02) + (edge if lean >= 60 else -edge if lean <= 40 else 0.0)})
    return cot, events
