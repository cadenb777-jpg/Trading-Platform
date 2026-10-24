"""Swing-trading strategies for the market scanner: indicators, signals, trade plans, backtests and random tests.

Pure maths (no network), so every rule can be tested. All calculations at bar i use only bars 0..i, and the COT
report is only used from the Friday it is published (data as of the Tuesday before), so the backtests can't peek.

Strategies (helper v21: each one was cut down to what the tests in docs/research/setups-v21-results.md support):
  weekly_swing   (primary) Pullback in the trend: the stock is on the right side of its 200-day average, stretched
                 beyond its own usual z-score range within the last 3 bars, and the z-score is turning back. Buy on a
                 stop above the signal bar's high; stop past the 3-bar swing; target +1 standard deviation; break-even
                 at +1R; out after the time frame's holding period.
  mean_reversion Short-term snap-back: z-score beyond the stock's own 5th/95th percentile, on the side of the 200-day
                 trend; exit on a close back across the 5-day average, at a wide safety stop or after 7 sessions.
  breakout       Strength near highs: a close above the highest close of the last 250 sessions (52 weeks) while
                 above the 200-day average, buys only. Initial stop 2 ATR, then a chandelier trail (highest high
                 since entry minus 3 ATR(22), on the close); no target; safety cap 120 sessions.
COT (Larry Williams' index for commercial hedgers) is a displayed reading: it only enters the grade when the
COT + z-score edge study on your own data shows it helps (see `cot_study`).
"""
import bisect
import datetime as dt
import math
import random
from collections import deque

COSTS = 0.001  # commission + slippage for a round trip (0.1%)
STOP_SLIP = 0.0005  # extra slippage on stop exits for the robustness check (0.05%)
Z_NEEDED = 1.282 + 0.842  # one-sided p <= 0.10 with 80% power: the basis of `tradesNeeded`

# ---------- Indicators (lists aligned with the bars, None during warm-up) ----------


def sma(values, n):
    out, total = [None] * len(values), 0.0
    for i, v in enumerate(values):
        total += v
        if i >= n:
            total -= values[i - n]
        if i >= n - 1:
            out[i] = total / n
    return out


def ema(values, n):
    out, k, prev = [], 2 / (n + 1), None
    for v in values:
        prev = v if prev is None else prev + k * (v - prev)
        out.append(prev)
    return out


def stdev(values, n):
    """Sample standard deviation over the last n values."""
    out = [None] * len(values)
    for i in range(n - 1, len(values)):
        w = values[i - n + 1: i + 1]
        m = sum(w) / n
        out[i] = math.sqrt(sum((x - m) ** 2 for x in w) / (n - 1))
    return out


def zscore(closes, n=20):
    """How many standard deviations the close is from its n-day average."""
    m, s = sma(closes, n), stdev(closes, n)
    return [None if m[i] is None or not s[i] else (closes[i] - m[i]) / s[i] for i in range(len(closes))]


def rsi(closes, n=14):
    """Wilder's RSI."""
    out = [None] * len(closes)
    gain = loss = 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        g, l = max(d, 0), max(-d, 0)
        if i <= n:
            gain += g / n
            loss += l / n
        else:
            gain = (gain * (n - 1) + g) / n
            loss = (loss * (n - 1) + l) / n
        if i >= n:
            out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def williams_r(bars, n=14):
    """Williams %R: 0 = close at the n-day high, -100 = at the n-day low (below -80 oversold, above -20 overbought)."""
    out = [None] * len(bars)
    for i in range(n - 1, len(bars)):
        w = bars[i - n + 1: i + 1]
        hh, ll = max(b['high'] for b in w), min(b['low'] for b in w)
        out[i] = -100 * (hh - bars[i]['close']) / (hh - ll) if hh > ll else -50.0
    return out


def williams_ad(bars):
    """Larry Williams' Accumulation/Distribution: adds the distance from the true low on up closes and subtracts the
    distance from the true high on down closes. Rising = accumulation (buyers), falling = distribution."""
    out, total = [0.0], 0.0
    for i in range(1, len(bars)):
        pc, c = bars[i - 1]['close'], bars[i]['close']
        if c > pc:
            total += c - min(bars[i]['low'], pc)
        elif c < pc:
            total += c - max(bars[i]['high'], pc)
        out.append(total)
    return out[:len(bars)]


def atr(bars, n=14):
    out, prev = [None] * len(bars), None
    for i, b in enumerate(bars):
        tr = b['high'] - b['low'] if i == 0 else max(b['high'] - b['low'], abs(b['high'] - bars[i - 1]['close']), abs(b['low'] - bars[i - 1]['close']))
        prev = tr if prev is None else (prev * (n - 1) + tr) / n
        out[i] = prev if i >= n - 1 else None
    return out


def adx(bars, n=14):
    """Average directional index: trend strength (above ~20-25 = trending)."""
    out = [None] * len(bars)
    if len(bars) < 2 * n + 1:
        return out
    tr_s = pdm_s = mdm_s = 0.0
    dxs = []
    adx_v = None
    for i in range(1, len(bars)):
        h, l, pc = bars[i]['high'], bars[i]['low'], bars[i - 1]['close']
        up, down = h - bars[i - 1]['high'], bars[i - 1]['low'] - l
        pdm = up if up > down and up > 0 else 0.0
        mdm = down if down > up and down > 0 else 0.0
        tr = max(h - l, abs(h - pc), abs(l - pc))
        if i <= n:
            tr_s, pdm_s, mdm_s = tr_s + tr, pdm_s + pdm, mdm_s + mdm
            if i < n:
                continue
        else:
            tr_s, pdm_s, mdm_s = tr_s - tr_s / n + tr, pdm_s - pdm_s / n + pdm, mdm_s - mdm_s / n + mdm
        pdi = 100 * pdm_s / tr_s if tr_s else 0
        mdi = 100 * mdm_s / tr_s if tr_s else 0
        dx = 100 * abs(pdi - mdi) / (pdi + mdi) if pdi + mdi else 0
        if adx_v is None:
            dxs.append(dx)
            if len(dxs) == n:
                adx_v = sum(dxs) / n
                out[i] = adx_v
        else:
            adx_v = (adx_v * (n - 1) + dx) / n
            out[i] = adx_v
    return out


def _rolling_extreme(values, n, skip_current, better):
    """Rolling max (better = >=) or min over the last n values, in one pass (monotonic queue)."""
    out, q = [None] * len(values), deque()
    for i, v in enumerate(values):
        if skip_current:  # window = values[i-n .. i-1]
            while q and q[0] < i - n:
                q.popleft()
            if i >= n:
                out[i] = values[q[0]]
        while q and better(v, values[q[-1]]):
            q.pop()
        q.append(i)
        if not skip_current:  # window = values[i-n+1 .. i]
            while q[0] <= i - n:
                q.popleft()
            if i >= n - 1:
                out[i] = values[q[0]]
    return out


def rolling_max(values, n, skip_current=False):
    """Highest of the last n values (optionally excluding the current one, e.g. a breakout of the prior 20 days)."""
    return _rolling_extreme(values, n, skip_current, lambda a, b: a >= b)


def rolling_min(values, n, skip_current=False):
    return _rolling_extreme(values, n, skip_current, lambda a, b: a <= b)


def rolling_quantile(values, n, q):
    """The q-quantile of the n values BEFORE each bar (None until n are known): each stock's own normal range,
    so "stretched" means stretched for that stock. Causal: bar i is compared with bars i-n..i-1."""
    out, window = [None] * len(values), []
    for i, v in enumerate(values):
        if len(window) >= n:
            out[i] = window[min(n - 1, int(q * n))]
        if v is not None:
            bisect.insort(window, v)
            if i >= n and values[i - n] is not None:
                del window[bisect.bisect_left(window, values[i - n])]
        elif i >= n and values[i - n] is not None:
            del window[bisect.bisect_left(window, values[i - n])]
    return out


# ---------- Time frames, trend and COT, aligned with the bars ----------


def _day(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).date()  # daily bars are stamped at US midnight, 04-07 UTC


# Trade time frames. Each one runs the same three strategies on a different bar size. Holding periods are counted
# in bars; `cluster` is how trades are grouped when counting independent bets (trades on the same day, or in the
# same week, share one market move).
HORIZONS = {
    'short': {'label': 'Short swing', 'hold': '1-3 days', 'bar': '1-hour', 'unit': 'hour', 'higher': 'daily', 'trend': 'day',
              'sessionsPerBar': 1 / 7, 'cluster': 'day', 'valid': {'weekly_swing': 4, 'mean_reversion': 1, 'breakout': 4},
              'maxHold': {'weekly_swing': 21, 'mean_reversion': 14, 'breakout': 105},
              'names': {'weekly_swing': 'Hourly pullback (z-score)', 'mean_reversion': 'Hourly mean reversion', 'breakout': 'Hourly 52-week-high breakout'}},
    'swing': {'label': 'Swing', 'hold': 'about 1 week', 'bar': 'daily', 'unit': 'day', 'higher': 'weekly', 'trend': 'week',
              'sessionsPerBar': 1, 'cluster': 'week', 'valid': {'weekly_swing': 2, 'mean_reversion': 1, 'breakout': 2},
              'maxHold': {'weekly_swing': 5, 'mean_reversion': 7, 'breakout': 120},
              'names': {'weekly_swing': 'Pullback in trend (z-score)', 'mean_reversion': 'Mean reversion (z-score)', 'breakout': '52-week-high breakout'}},
    'position': {'label': 'Position', 'hold': '2-8 weeks', 'bar': 'weekly', 'unit': 'week', 'higher': 'monthly', 'trend': 'month',
                 'sessionsPerBar': 5, 'cluster': 'week', 'valid': {'weekly_swing': 2, 'mean_reversion': 1, 'breakout': 2},
                 'maxHold': {'weekly_swing': 6, 'mean_reversion': 8, 'breakout': 52},
                 'names': {'weekly_swing': 'Position pullback (z-score)', 'mean_reversion': 'Weekly mean reversion', 'breakout': 'Weekly 52-week-high breakout'}},
}
WARMUP = 210  # bars before the first backtest trade


def _h(ind):
    return HORIZONS[ind.get('horizon', 'swing')]


def session_bars(ind, sessions):
    """A length in trading sessions as a number of bars of this time frame (200 sessions = 40 weekly bars)."""
    return max(2, round(sessions / _h(ind)['sessionsPerBar']))


def _period_key(t, trend):
    d = _day(t)
    return d if trend == 'day' else d.isocalendar()[:2] if trend == 'week' else (d.year, d.month)


def htf_trend(bars, n=10, trend='week', band=0.0):
    """+1 / -1 / 0 / None per bar: was the last COMPLETED higher-timeframe period's close (week by default; day for
    hourly bars, month for weekly bars) above or below its n-period average? With `band`, it must clear the average
    by band x the n-period average true range of those periods (inside the band = 0, no trend). Only finished
    periods are used."""
    out = [None] * len(bars)
    closes, trs, cur, ph, pl, pc, last = [], [], None, None, None, None, None
    for i, b in enumerate(bars):
        k = _period_key(b['time'], trend)
        if cur is not None and k != cur:
            if closes:
                trs.append(max(ph - pl, abs(ph - closes[-1]), abs(pl - closes[-1])))
            closes.append(pc)
            last = None
        if k != cur:
            cur, ph, pl = k, b['high'], b['low']
        else:
            ph, pl = max(ph, b['high']), min(pl, b['low'])
        pc = b['close']
        if len(closes) >= n and (not band or len(trs) >= n):
            if last is None:
                avg = sum(closes[-n:]) / n
                margin = band * sum(trs[-n:]) / n if band else 0.0
                c = closes[-1]
                last = 1 if c > avg + margin else -1 if c < avg - margin else 0
            out[i] = last
    return out


def weekly_trend(bars, n=10, trend='week'):
    """The plain higher-timeframe trend (no band): kept for the rule tests and older callers."""
    return htf_trend(bars, n, trend)


def _sma_side(closes, n):
    s = sma(closes, n)
    return [None if s[i] is None else (1 if closes[i] > s[i] else -1 if closes[i] < s[i] else 0) for i in range(len(closes))]


def _daily_side_for_hours(bars, daily, n):
    """For hourly bars: the side of the 200-day (n-day) average as known at the PREVIOUS day's close. `daily` are
    real daily bars; without them the hourly bars are joined into days (needs n days of hourly history)."""
    if not daily:
        days, last_day = [], None
        for b in bars:
            d = _day(b['time'])
            if d != last_day:
                days.append({'time': b['time'], 'close': b['close']})
                last_day = d
            else:
                days[-1]['close'] = b['close']
        daily = days[:-1] if days else []  # today's day bar isn't finished
    closes = [b['close'] for b in daily]
    side = _sma_side(closes, n)
    dates = [_day(b['time']) for b in daily]
    out = [None] * len(bars)
    for i, b in enumerate(bars):
        k = bisect.bisect_left(dates, _day(b['time'])) - 1  # the last day before this bar's day
        out[i] = side[k] if k >= 0 else None
    return out


TREND_RULES = {
    'none': 'no trend filter',
    'htf10': 'the last finished higher-timeframe bar vs its 10-bar average',
    'htf10band': 'the 10-bar higher-timeframe average +/- 0.5 ATR (between = no trade)',
    'ma200': 'price vs its 200-day average',
    'ma150': 'price vs its 150-day average (plateau check)',
    'ma250': 'price vs its 250-day average (plateau check)',
}
TREND = 'ma200'  # the one trend filter used by every strategy (rule tests: docs/research/setups-v21-results.md)


def trend_array(ind, rule=TREND):
    """+1 / -1 / 0 / None per bar for a trend rule (cached on the indicator set)."""
    cache = ind.setdefault('_trend', {})
    if rule in cache:
        return cache[rule]
    bars, H = ind['bars'], _h(ind)
    if rule == 'none':
        out = [0] * len(bars)
    elif rule in ('htf10', 'htf10band'):
        out = htf_trend(bars, 10, H['trend'], 0.5 if rule == 'htf10band' else 0.0)
    else:
        sessions = int(rule[2:])
        if ind.get('horizon') == 'short':
            out = _daily_side_for_hours(bars, ind.get('daily'), sessions)
        else:
            out = _sma_side(ind['closes'], session_bars(ind, sessions))
    cache[rule] = out
    return out


def trend_text(ind, rule, d):
    H = _h(ind)
    up = d > 0
    if rule in ('htf10', 'htf10band'):
        return f"{H['higher'].capitalize()} trend {'up' if up else 'down'} (the last finished {H['trend']} closed {'above' if up else 'below'} its 10-{H['trend']} average{' by more than half an ATR' if rule == 'htf10band' else ''})"
    if rule.startswith('ma'):
        n = int(rule[2:])
        where = 'at the previous close' if ind.get('horizon') == 'short' else 'now'
        return f"{'Above' if up else 'Below'} the {n}-day average {where} ({'long-term uptrend' if up else 'long-term downtrend'})"
    return 'No trend filter'


def cot_index(rows, weeks=156):
    """Larry Williams' COT index for commercials: where their net position sits in its range over the last `weeks`
    reports (0 = most bearish, 100 = most bullish). Returns [(report date, index)]."""
    out = []
    nets = [r['commNet'] for r in rows]
    for k, r in enumerate(rows):
        if k + 1 < weeks:
            continue
        w = nets[k + 1 - weeks: k + 1]
        lo, hi = min(w), max(w)
        out.append((r['date'], 100 * (nets[k] - lo) / (hi - lo) if hi > lo else 50.0))
    return out


def align_cot(bars, cot):
    """The COT index known on each day: the latest report whose data date (a Tuesday) is at least 3 days old, as
    the CFTC publishes it on the Friday afternoon. None before the first report."""
    out, k = [None] * len(bars), -1
    dated = [(dt.date.fromisoformat(d), v) for d, v in cot]
    for i, b in enumerate(bars):
        day = _day(b['time'])
        while k + 1 < len(dated) and dated[k + 1][0] + dt.timedelta(days=3) <= day:
            k += 1
        out[i] = dated[k][1] if k >= 0 else None
    return out


def prepare(bars, cot=None, horizon='swing', daily=None):
    """Everything the strategies read, computed once (all causal). `horizon` picks the bar size; `daily` (hourly
    time frame only) gives the 200-day trend from real daily bars."""
    closes = [b['close'] for b in bars]
    vols = [b.get('volume', 0) for b in bars]
    z20, rsi2 = zscore(closes, 20), rsi(closes, 2)
    ind = {
        'bars': bars, 'closes': closes, 'horizon': horizon, 'daily': daily,
        'sma5': sma(closes, 5), 'sma20': sma(closes, 20), 'sma50': sma(closes, 50), 'sma200': sma(closes, 200),
        'sd20': stdev(closes, 20), 'z20': z20, 'rsi2': rsi2, 'willr': williams_r(bars, 14),
        # This stock's own extremes over its last 250 bars, kept within sane limits.
        'zlo': [None if q is None else min(-0.75, max(-2.5, q)) for q in rolling_quantile(z20, 250, 0.10)],
        'zhi': [None if q is None else max(0.75, min(2.5, q)) for q in rolling_quantile(z20, 250, 0.90)],
        'zlo2': [None if q is None else min(-1.0, max(-3.0, q)) for q in rolling_quantile(z20, 250, 0.05)],
        'zhi2': [None if q is None else max(1.0, min(3.0, q)) for q in rolling_quantile(z20, 250, 0.95)],
        'rlo': [None if q is None else min(15.0, max(2.0, q)) for q in rolling_quantile(rsi2, 250, 0.05)],
        'rhi': [None if q is None else max(85.0, min(98.0, q)) for q in rolling_quantile(rsi2, 250, 0.95)],
        'atr': atr(bars, 14), 'atr20': atr(bars, 20), 'atr22': atr(bars, 22),
        'hi20': rolling_max([b['high'] for b in bars], 20, skip_current=True),
        'lo20': rolling_min([b['low'] for b in bars], 20, skip_current=True),
        'lo10': rolling_min([b['low'] for b in bars], 10, skip_current=True),
        'hi10': rolling_max([b['high'] for b in bars], 10, skip_current=True),
        'vol20': sma(vols, 20), 'vols': vols,
        'cot': align_cot(bars, cot) if cot else [None] * len(bars),
    }
    ind['weekly'] = trend_array(ind, TREND)  # the production trend (+1/-1), shown on every setup
    return ind


def _lazy(ind, key, fn):
    if key not in ind:
        ind[key] = fn()
    return ind[key]


COT_DEFAULT = {'weeks': 156, 'hi': 75, 'lo': 25}  # Williams' book (3-year index) and the 75/25 extremes


def cot_view(value, direction, hi=COT_DEFAULT['hi'], lo=COT_DEFAULT['lo']):
    """'agree' / 'against' / 'neutral' / None for a COT commercial index reading and a trade direction."""
    if value is None:
        return None
    lean = value if direction > 0 else 100 - value
    return 'agree' if lean >= hi else 'against' if lean <= lo else 'neutral'


# ---------- Signals: each returns None or {'dir', 'reasons'} using bars up to i only ----------

def _ok(*values):
    return all(v is not None for v in values)


def pullback_signal(ind, i, turn='buystop', trend=TREND):
    """Pullback in the trend: stretched beyond this stock's own 10th (90th) percentile z-score within the last 3 bars,
    on the trend's side. `turn` = how the turn back is confirmed: 'buystop' (only by the stop order above the signal
    bar), 'zturn' (z-score turning), 'willr' (Williams %R crossing back) or 'current' (the v20 stack: z turn + %R +
    Williams A/D vs its average + COT 60+ when known). The rule tests compare them."""
    if i < 3:
        return None
    H = _h(ind)
    u = H['unit']
    z, zlo, zhi = ind['z20'], ind['zlo'][i], ind['zhi'][i]
    if not _ok(z[i], z[i - 1], z[i - 2], zlo, zhi, ind['atr'][i]):
        return None
    tr = trend_array(ind, trend)
    for d in (1, -1):
        if trend != 'none' and tr[i] != d:
            continue
        ext = min(z[i - 2: i + 1]) if d > 0 else max(z[i - 2: i + 1])
        if not (ext <= zlo if d > 0 else ext >= zhi):
            continue
        reasons = ([trend_text(ind, trend, d)] if trend != 'none' else []) + [
            f"Z-score {ext:+.1f} in the last 3 {u}s (beyond this stock's usual {zlo if d > 0 else zhi:+.1f}), now {z[i]:+.1f}"]
        if turn in ('zturn', 'current') and not (z[i] > z[i - 1] if d > 0 else z[i] < z[i - 1]):
            continue
        if turn in ('willr', 'current'):
            wr = ind['willr']
            if not _ok(wr[i], wr[i - 1], wr[i - 2]):
                continue
            ok = (any(wr[k - 1] <= -80 < wr[k] for k in (i - 1, i)) and wr[i] > -80) if d > 0 else (any(wr[k - 1] >= -20 > wr[k] for k in (i - 1, i)) and wr[i] < -20)
            if not ok:
                continue
            reasons.append(f"Williams %R crossed {'up through -80' if d > 0 else 'down through -20'} ({wr[i]:.0f})")
        if turn == 'current':
            wad = _lazy(ind, '_wad', lambda: williams_ad(ind['bars']))
            wad_e = _lazy(ind, '_wad_ema', lambda: ema(wad, 20))
            if not (wad[i] >= wad_e[i] if d > 0 else wad[i] <= wad_e[i]):
                continue
            cot = ind['cot'][i]
            if cot is not None and (cot if d > 0 else 100 - cot) < 60:
                continue
        if turn == 'buystop':
            reasons.append(f"Enter only if price {'rises above' if d > 0 else 'falls below'} this {u}'s {'high' if d > 0 else 'low'} (that proves the turn)")
        return {'dir': d, 'reasons': reasons}
    return None


def mean_reversion_signal(ind, i, stretch='z', trend=TREND):
    """Snap-back after an extreme short-term move, on the trend's side. `stretch`: 'z' (z-score beyond the stock's
    own 5th/95th percentile), 'both' (z-score and RSI(2), the v20 rule) or 'rsi' (RSI(2) only)."""
    u = _h(ind)['unit']
    rsi2, z = ind['rsi2'][i], ind['z20'][i]
    rlo, rhi, zlo, zhi = ind['rlo'][i], ind['rhi'][i], ind['zlo2'][i], ind['zhi2'][i]
    if not _ok(rsi2, z, ind['atr'][i], ind['sma5'][i], rlo, rhi, zlo, zhi):
        return None
    tr = trend_array(ind, trend)[i]
    for d in (1, -1):
        if trend != 'none' and tr != d:
            continue
        zok = z <= zlo if d > 0 else z >= zhi
        rok = rsi2 <= rlo if d > 0 else rsi2 >= rhi
        if (stretch in ('z', 'both') and not zok) or (stretch in ('rsi', 'both') and not rok):
            continue
        reasons = [trend_text(ind, trend, d)] if trend != 'none' else []
        if stretch in ('z', 'both'):
            reasons.append(f"Z-score {z:+.1f}: stretched {'below' if d > 0 else 'above'} the mean (this stock's {'5th' if d > 0 else '95th'} percentile is {zlo if d > 0 else zhi:+.1f})")
        if stretch in ('rsi', 'both'):
            reasons.append(f"RSI(2) {rsi2:.0f}: {'oversold' if d > 0 else 'overbought'} for this stock")
        return {'dir': d, 'reasons': reasons}
    return None


def breakout_signal(ind, i, kind='high250', trend=TREND):
    """`kind` 'high250' (default): a close above the highest close of the prior 250 sessions (52 weeks) while above
    the 200-day average, buys only. 'high50': the same with 50 sessions. 'old': the v20 stack (20-bar Donchian,
    weekly trend, 50-bar average, ADX 20+, volume 1.3x, both sides)."""
    H = _h(ind)
    u = H['unit']
    c = ind['closes'][i]
    if kind == 'old':
        b = ind['bars'][i]
        adx_ = _lazy(ind, '_adx', lambda: adx(ind['bars'], 14))
        wk = trend_array(ind, 'htf10')
        hi20, lo20, a, w, s50, v20 = ind['hi20'][i], ind['lo20'][i], adx_[i], wk[i], ind['sma50'][i], ind['vol20'][i]
        if not _ok(hi20, lo20, a, w, s50, v20, ind['atr'][i]) or not v20:
            return None
        vol = b.get('volume', 0) / v20
        if c > hi20 and w == 1 and c > s50 and a >= 20 and vol >= 1.3:
            return {'dir': 1, 'reasons': [f'Close above the prior 20-{u} high (Donchian breakout)', f'ADX {a:.0f}', f'Volume {vol:.1f}x normal']}
        if c < lo20 and w == -1 and c < s50 and a >= 20 and vol >= 1.3:
            return {'dir': -1, 'reasons': [f'Close below the prior 20-{u} low (Donchian breakdown)', f'ADX {a:.0f}', f'Volume {vol:.1f}x normal']}
        return None
    sessions = 250 if kind == 'high250' else 50
    n = session_bars(ind, sessions)
    hi = _lazy(ind, f'_hiclose{n}', lambda: rolling_max(ind['closes'], n, skip_current=True))[i]
    if not _ok(hi, ind['atr20'][i], ind['atr22'][i]) or (trend != 'none' and trend_array(ind, trend)[i] != 1):
        return None
    if c > hi:
        label = '52-week' if sessions == 250 else '50-day'
        return {'dir': 1, 'reasons': [f'Close {c:.2f} above the highest close of the last {sessions} sessions ({label} high {hi:.2f})'] + ([trend_text(ind, trend, 1)] if trend != 'none' else [])}
    return None


# ---------- Trade plans (all prices fixed on the signal bar; lengths in bars of the time frame) ----------

def _bars_text(n, u):
    return f"{n} {u}{'s' if n != 1 else ''}"


def pullback_plan(ind, i, d, exit='target'):
    """Buy-stop above the signal bar, stop past the 3-bar swing (0.75-2 ATR). exit 'target': +1 SD target, break-even
    at +1R, out after the holding period. exit 'trail': no target; after +1R a chandelier trail takes over, with the
    breakout's long safety cap (the rule tests compare the two)."""
    H = _h(ind)
    u, hold, valid = H['unit'], H['maxHold']['weekly_swing'], H['valid']['weekly_swing']
    b, a = ind['bars'][i], ind['atr'][i]
    trigger = b['high'] if d > 0 else b['low']
    swing = min(x['low'] for x in ind['bars'][i - 2: i + 1]) if d > 0 else max(x['high'] for x in ind['bars'][i - 2: i + 1])
    dist = abs(trigger - (swing - 0.25 * a * d))
    dist = min(max(dist, 0.75 * a), 2.0 * a)  # stop just past the recent swing, kept between 0.75 and 2 ATR
    target = ind['sma20'][i] + d * ind['sd20'][i]  # back to the far side of the mean: +1 (or -1) standard deviation
    if (target - trigger) * d < 0.5 * a:
        return None  # not enough room to the target
    if exit == 'trail':
        cap = H['maxHold']['breakout']
        return {'entry': 'stop', 'trigger': trigger, 'validDays': valid, 'stop': trigger - d * dist, 'target': None, 'maxHold': cap,
                'breakEvenAtR': None, 'exit': None, 'trailAfterR': 1.0, 'trailAtr': 3.0,
                'targetNote': 'no fixed target: after +1R the stop trails 3 ATR behind the best price',
                'exitRule': f"Exit at the stop; once up by the risk, trail the stop 3 ATR(22) behind the highest high (exit on a close below it), or after {_bars_text(cap, u)}."}
    return {'entry': 'stop', 'trigger': trigger, 'validDays': valid, 'stop': trigger - d * dist, 'target': target,
            'maxHold': hold, 'breakEvenAtR': 1.0, 'exit': None,
            'targetNote': f"+1 standard deviation above the 20-{u} average" if d > 0 else f"1 standard deviation below the 20-{u} average",
            'exitRule': f"Take profit at the target, exit at the stop, or close the trade after {_bars_text(hold, u)} ({H['hold']}). Move the stop to break-even once the trade is up by its initial risk."}


def mean_reversion_plan(ind, i, d):
    H = _h(ind)
    u, hold = H['unit'], H['maxHold']['mean_reversion']
    a, c = ind['atr'][i], ind['closes'][i]
    return {'entry': 'open', 'trigger': c, 'validDays': H['valid']['mean_reversion'], 'stop': c - d * 2.5 * a, 'target': ind['sma5'][i],
            'maxHold': hold, 'breakEvenAtR': None, 'exit': 'sma5',
            'targetNote': f'the 5-{u} average (it moves; the exit is a close back across it)',
            'exitRule': f"Enter at the next {u}'s open. Exit at the first close {'above' if d > 0 else 'below'} the 5-{u} average, at the 2.5 ATR safety stop, or after {_bars_text(hold, u)}."}


OLD_BREAKOUT_HOLD = {'short': 35, 'swing': 20, 'position': 16}


def breakout_plan(ind, i, d, kind='high250'):
    H = _h(ind)
    u = H['unit']
    b = ind['bars'][i]
    trigger = b['high'] if d > 0 else b['low']
    if kind == 'old':
        hold, a = OLD_BREAKOUT_HOLD[ind.get('horizon', 'swing')], ind['atr'][i]
        return {'entry': 'stop', 'trigger': trigger, 'validDays': H['valid']['breakout'], 'stop': trigger - d * 2.0 * a, 'target': None,
                'maxHold': hold, 'breakEvenAtR': None, 'exit': 'donchian10',
                'targetNote': f'no fixed target: the stop trails at the 10-{u} low', 'exitRule': f'Exit on a close beyond the 10-{u} low/high, at the 2 ATR stop, or after {_bars_text(hold, u)}.'}
    hold, a = H['maxHold']['breakout'], ind['atr20'][i]
    return {'entry': 'stop', 'trigger': trigger, 'validDays': H['valid']['breakout'], 'stop': trigger - d * 2.0 * a, 'target': None,
            'maxHold': hold, 'breakEvenAtR': None, 'exit': 'chandelier', 'trailAtr': 3.0,
            'targetNote': 'no fixed target: the stop trails 3 ATR below the highest high since entry',
            'exitRule': f"Enter on a break of the signal {u}'s high. Initial stop 2 ATR below the entry; then exit on a close below the highest high since entry minus 3 ATR(22) (the stop only moves up), or after {_bars_text(hold, u)}."}


# The production rules (each a choice settled by the rule tests; ruletests.py runs the alternatives).
SPEC = {
    'weekly_swing': {'turn': 'zturn', 'trend': TREND, 'exit': 'target'},
    'mean_reversion': {'stretch': 'z', 'trend': TREND},
    'breakout': {'kind': 'high250', 'trend': TREND},
}


def make_strategy(key, spec, name=None):
    """A strategy entry {name, signal, plan, sides} for a base strategy key and a rule spec."""
    spec = dict(spec)
    if key == 'weekly_swing':
        sig = lambda ind, i: pullback_signal(ind, i, spec.get('turn', 'buystop'), spec.get('trend', TREND))  # noqa: E731
        plan = lambda ind, i, d: pullback_plan(ind, i, d, spec.get('exit', 'target'))  # noqa: E731
        sides = (1, -1)
    elif key == 'mean_reversion':
        sig = lambda ind, i: mean_reversion_signal(ind, i, spec.get('stretch', 'z'), spec.get('trend', TREND))  # noqa: E731
        plan = mean_reversion_plan
        sides = (1, -1)
    else:
        sig = lambda ind, i: breakout_signal(ind, i, spec.get('kind', 'high250'), spec.get('trend', TREND))  # noqa: E731
        plan = lambda ind, i, d: breakout_plan(ind, i, d, spec.get('kind', 'high250'))  # noqa: E731
        sides = (1, -1) if spec.get('kind') == 'old' else (1,)
    return {'name': name or HORIZONS['swing']['names'][key], 'short': (name or HORIZONS['swing']['names'][key]).split(' (')[0],
            'signal': sig, 'plan': plan, 'sides': sides, 'spec': spec, 'base': key}


STRATEGIES = {k: {**make_strategy(k, v), 'horizon': h} for (k, v), h in zip(SPEC.items(), ('about 1 week', '2-7 days', 'weeks to months'))}


# ---------- Simulation ----------

def simulate(ind, i, plan, d, costs=COSTS, slip=0.0):
    """Trades a plan from the bar after the signal. Stops fill at the stop, or at the open when price gaps through
    (minus `slip` on stop exits for the robustness check); when a stop and a target fall in the same bar the stop is
    assumed first. `r` is the result in multiples of the initial risk, after costs. Returns None if never filled."""
    bars = ind['bars']
    fill_i = entry = None
    for j in range(i + 1, min(len(bars), i + 1 + plan['validDays'])):
        b = bars[j]
        if plan['entry'] == 'open':
            fill_i, entry = j, b['open']
            break
        if (b['high'] >= plan['trigger']) if d > 0 else (b['low'] <= plan['trigger']):
            fill_i, entry = j, (max(b['open'], plan['trigger']) if d > 0 else min(b['open'], plan['trigger']))
            break
    if fill_i is None:
        return None
    stop, target = plan['stop'], plan['target'] if plan['exit'] is None else None
    risk = (entry - stop) * d
    if risk <= 0:
        return None
    last = min(len(bars) - 1, fill_i + plan['maxHold'] - 1)
    exit_price = exit_i = None
    reason = 'time'
    trail_on = plan['exit'] == 'chandelier'
    trail = None
    best = None
    atr22 = ind.get('atr22') if (trail_on or plan.get('trailAfterR')) else None
    for j in range(fill_i, last + 1):
        b = bars[j]
        opened = b['open'] if j > fill_i else entry
        best = (b['high'] if best is None else max(best, b['high'])) if d > 0 else (b['low'] if best is None else min(best, b['low']))
        if (b['low'] <= stop) if d > 0 else (b['high'] >= stop):
            through = (opened < stop) if d > 0 else (opened > stop)
            exit_price, exit_i, reason = (opened if through else stop), j, ('break-even' if stop == entry else 'stop')
            exit_price *= 1 - d * slip
            break
        if target is not None and ((b['high'] >= target) if d > 0 else (b['low'] <= target)):
            exit_price, exit_i, reason = (max(target, opened) if d > 0 else min(target, opened)), j, 'target'
            break
        # Rules checked on the close
        c = b['close']
        if plan['exit'] == 'sma5' and ind['sma5'][j] is not None and ((c > ind['sma5'][j]) if d > 0 else (c < ind['sma5'][j])):
            exit_price, exit_i, reason = c, j, 'exit rule'
            break
        if plan['exit'] == 'donchian10':
            level = ind['lo10'][j] if d > 0 else ind['hi10'][j]
            if level is not None and ((c < level) if d > 0 else (c > level)):
                exit_price, exit_i, reason = c, j, 'exit rule'
                break
        if plan.get('trailAfterR') and not trail_on and (c - entry) * d >= plan['trailAfterR'] * risk:
            trail_on = True
        if trail_on and atr22 is not None and atr22[j] is not None:
            level = best - d * plan.get('trailAtr', 3.0) * atr22[j]
            trail = level if trail is None else (max(trail, level) if d > 0 else min(trail, level))  # only tightens
            if (c < trail) if d > 0 else (c > trail):
                exit_price, exit_i, reason = c, j, 'trail'
                break
        if plan['breakEvenAtR'] and stop != entry and (c - entry) * d >= plan['breakEvenAtR'] * risk:
            stop = entry
    if exit_i is None:
        exit_i, exit_price = last, bars[last]['close']
    ret = (exit_price / entry - 1) * d - costs
    return {'signal': i, 'time': bars[i]['time'], 'fill': fill_i, 'exit': exit_i, 'entry': entry, 'exitPrice': exit_price, 'dir': d, 'ret': ret,
            'r': ((exit_price - entry) * d - costs * entry) / risk, 'reason': reason, 'bars': exit_i - fill_i + 1}


def trades_for(ind, key, start=WARMUP, end=None, costs=COSTS, slip=0.0):
    """Every trade the strategy would have taken (one at a time) on bars start..end-1. `key` is a strategy key or a
    strategy dict (the rule tests pass variants)."""
    s = STRATEGIES[key] if isinstance(key, str) else key
    end = len(ind['bars']) - 1 if end is None else end
    out, i = [], start
    while i < end:
        sig = s['signal'](ind, i)
        plan = sig and s['plan'](ind, i, sig['dir'])
        t = plan and simulate(ind, i, plan, sig['dir'], costs, slip)
        if t:
            out.append(t)
            i = t['exit'] + 1
        else:
            i += 1
    return out


def cluster_key(t, cluster='week'):
    """Trades whose signals fall on the same day (hourly bars) or in the same week (daily and weekly bars) share one
    market move: they count as one independent bet."""
    if 'time' not in t:
        return id(t)
    d = _day(t['time'])
    return d if cluster == 'day' else d.isocalendar()[:2]


def clustered_t(trades, cluster='week'):
    """(t-statistic of the average trade with cluster-robust errors, number of clusters). The usual t-test treats 30
    trades taken in one sell-off as 30 independent bets; this one counts them as one cluster."""
    n = len(trades)
    if n < 2:
        return None, n
    m = sum(t['ret'] for t in trades) / n
    sums = {}
    for t in trades:
        k = cluster_key(t, cluster)
        sums[k] = sums.get(k, 0.0) + t['ret'] - m
    g = len(sums)
    if g < 2:
        return None, g
    var = sum(v * v for v in sums.values()) / (n * n) * g / (g - 1)
    return (m / math.sqrt(var) if var > 0 else None), g


def summarise(trades, cluster='week'):
    """Win rate, profit factor, expectancy and a grade: proven (20+ trades, positive, t >= 1.5), mixed (4+, positive),
    failed (4+, losing) or unproven (too few). `tStat` counts trades in the same day/week as one bet; `tradesNeeded`
    is how many such independent bets an edge this size needs to pass a one-sided p <= 0.10 test with 80% power."""
    n = len(trades)
    wins = [t['ret'] for t in trades if t['ret'] > 0]
    losses = [t['ret'] for t in trades if t['ret'] <= 0]
    gross_win, gross_loss = sum(wins), -sum(losses)
    pf = gross_win / gross_loss if gross_loss else (float('inf') if wins else None)
    exp = sum(t['ret'] for t in trades) / n if n else None
    equity = peak = dd = 0.0
    streak = worst = 0
    for t in sorted(trades, key=lambda t: t.get('time', 0)):
        equity += t['ret']
        peak = max(peak, equity)
        dd = min(dd, equity - peak)
        streak = streak + 1 if t['ret'] <= 0 else 0
        worst = max(worst, streak)
    t_stat, clusters = clustered_t(trades, cluster)
    grade = 'unproven'
    if n >= 20 and exp > 0 and t_stat is not None and t_stat >= 1.5:
        grade = 'proven'
    elif n >= 4 and exp > 0:
        grade = 'mixed'
    elif n >= 4:
        grade = 'failed'
    needed = math.ceil(clusters * (Z_NEEDED / t_stat) ** 2) if t_stat and t_stat > 0 else None
    return {'trades': n, 'effectiveTrades': clusters, 'winRate': len(wins) / n if n else None, 'tStat': t_stat, 'tradesNeeded': needed,
            'profitFactor': None if pf is None else (round(pf, 2) if pf != float('inf') else 99),
            'expectancy': exp, 'avgR': sum(t['r'] for t in trades) / n if n else None,
            'avgBars': sum(t['bars'] for t in trades) / n if n else None, 'total': sum(t['ret'] for t in trades),
            'maxDrawdown': dd, 'maxLosingStreak': worst, 'grade': grade,
            'targets': sum(1 for t in trades if t['reason'] == 'target'), 'stops': sum(1 for t in trades if t['reason'] == 'stop')}


# ---------- Is it better than chance? ----------

def shuffled_bars(bars, rnd):
    """A random walk with the stock's own daily moves in a shuffled order: each day keeps its gap, its intraday
    range and its close relative to the open, so volatility and drift match but any real pattern is gone."""
    moves = []
    for k in range(1, len(bars)):
        pc, b = bars[k - 1]['close'], bars[k]
        if pc <= 0 or b['open'] <= 0:
            continue
        moves.append((b['open'] / pc, b['high'] / b['open'], b['low'] / b['open'], b['close'] / b['open'], b.get('volume', 0)))
    rnd.shuffle(moves)
    out, c = [dict(bars[0])], bars[0]['close']
    for k, (gap, hi, lo, cl, vol) in enumerate(moves, start=1):
        o = c * gap
        c = o * cl
        out.append({'time': bars[k]['time'], 'open': o, 'high': o * hi, 'low': o * lo, 'close': c, 'volume': vol})
    return out


def random_walk_test(bars, cot, key, runs=1000, seed=11, horizon='swing', daily=None):
    """Runs the strategy on `runs` shuffled versions of the stock's history. p = share of random histories where it
    made at least as much as on the real one (low p = unlikely to be luck)."""
    actual = sum(t['ret'] for t in trades_for(prepare(bars, cot, horizon, daily), key))
    rnd = random.Random(seed)
    better = 0
    for _ in range(runs):
        fake = shuffled_bars(bars, rnd)
        if sum(t['ret'] for t in trades_for(prepare(fake, cot, horizon, daily), key)) >= actual:
            better += 1
    p = (better + 1) / (runs + 1)
    return {'runs': runs, 'p': p, 'actual': actual, 'verdict': 'edge' if p <= 0.05 else 'maybe' if p <= 0.2 else 'luck'}


def series_of(bars):
    """(times, opens, closes) of a bar list, the shape `random_entry_test` reads."""
    return [b['time'] for b in bars], [b['open'] for b in bars], [b['close'] for b in bars]


def random_entry_test(trades_by_symbol, series_by_symbol, runs=1000, seed=7, costs=COSTS):
    """Pools a strategy's trades across stocks and compares their average return with random entries: same stocks,
    direction and holding time, on random dates from the same period. Trades that signalled on the same date are
    moved TOGETHER to one random date (one random date per real signal date), so the random trades cluster in time
    like the real ones; otherwise 30 trades from one sell-off would be compared with 30 independent random dates and
    the p-value would be far too small (docs/research/setups-v21-results.md: 38% false alarms at the 10% level
    before, 9.5% after; 7% for strategies with stops, targets and trailing exits). p = share of random sets that did
    at least as well; `excess` = real average minus the average random set (drift and holding time taken out)."""
    pool = [(sym, t) for sym, ts in trades_by_symbol.items() for t in ts if sym in series_by_symbol]
    if len(pool) < 10:
        return None
    actual = sum(t['ret'] for _, t in pool) / len(pool)
    lo, hi = min(t['time'] for _, t in pool), max(t['time'] for _, t in pool)
    cands = sorted({x for times, _, _ in series_by_symbol.values() for x in times if lo <= x <= hi})
    clusters = {}
    for sym, t in pool:
        clusters.setdefault(t['time'], []).append((series_by_symbol[sym], t['bars'], t['dir']))
    groups = list(clusters.values())
    rnd = random.Random(seed)
    rand, left = rnd.random, bisect.bisect_left
    nc, n = len(cands), len(pool)
    better, means = 0, 0.0
    for _ in range(runs):
        total = 0.0
        for g in groups:
            when = cands[int(rand() * nc)]
            for (times, opens, closes), hold, d in g:
                k = min(left(times, when), len(closes) - hold - 1)
                total += (closes[k + hold] / opens[k + 1] - 1) * d
        mean = total / n - costs
        means += mean
        if mean >= actual:
            better += 1
    p = (better + 1) / (runs + 1)
    return {'runs': runs, 'p': p, 'actual': actual, 'randomMean': means / runs, 'excess': actual - means / runs, 'trades': n, 'clusters': len(groups),
            'verdict': 'edge' if p <= 0.05 else 'maybe' if p <= 0.2 else 'luck'}


def holm(pvalues):
    """Holm step-down adjusted p-values (valid whatever the dependence between the tests)."""
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    out, running, m = [1.0] * len(pvalues), 0.0, len(pvalues)
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * pvalues[i]))
        out[i] = running
    return out


def monte_carlo(trades, runs=1000, horizon=20, seed=5, block=4, key='ret'):
    """What the next `horizon` trades could look like: `runs` simulations drawn from the past trades with the
    stationary bootstrap (Politis & Romano 1994): runs of consecutive trades (in date order) with random, geometric
    lengths (average `block`), so winning and losing streaks stay together. `key` 'ret' sums returns, 'r' sums R
    multiples (for drawdowns at a fixed risk per trade). Gives the chance of ending ahead, the typical result, a bad
    case (5th percentile), a good case (95th) and the deepest drop along the way."""
    rets = [t[key] for t in sorted(trades, key=lambda t: t.get('time', 0))]
    if len(rets) < 5:
        return None
    rnd = random.Random(seed)
    totals, drops = [], []
    n = len(rets)
    for _ in range(runs):
        equity = peak = dd = 0.0
        k = rnd.randrange(n)
        for step in range(horizon):
            if step and rnd.random() < 1 / block:
                k = rnd.randrange(n)  # start a new block
            else:
                k = (k + 1) % n if step else k
            equity += rets[k]
            peak = max(peak, equity)
            dd = min(dd, equity - peak)
        totals.append(equity)
        drops.append(dd)
    totals.sort()
    drops.sort()

    def at(xs, q):
        return xs[min(len(xs) - 1, int(q * len(xs)))]
    return {'runs': runs, 'horizon': horizon, 'key': key, 'profitable': sum(1 for x in totals if x > 0) / runs,
            'median': at(totals, 0.5), 'bad': at(totals, 0.05), 'good': at(totals, 0.95), 'worstDrop': at(drops, 0.05)}


def bh_qvalues(pvalues, family=None):
    """Benjamini-Hochberg false-discovery-rate q-values for p-values tested together (None stays None). `family` is
    the number of tests in the family when only some of them were run (the rest count as p = 1)."""
    idx = sorted((i for i, p in enumerate(pvalues) if p is not None), key=lambda i: pvalues[i])
    m = max(len(idx), family or 0)
    out, running = [None] * len(pvalues), 1.0
    for rank in range(len(idx), 0, -1):
        i = idx[rank - 1]
        running = min(running, pvalues[i] * m / rank)
        out[i] = running
    return out


# ---------- Robustness (R5) and regimes (report only) ----------

def robustness(ind_by_symbol, key, cluster='week', side=None):
    """Two ticks for a strategy (optionally one side): `costs` = still profitable at double costs plus 0.05% slippage
    on every stop exit; `halves` = profitable in both halves of each stock's history, and neither half's t below -1."""
    hard, first, second = [], [], []
    for ind in ind_by_symbol.values():
        ts = [t for t in trades_for(ind, key, costs=2 * COSTS, slip=STOP_SLIP) if side is None or t['dir'] == side]
        hard += ts
        normal = [t for t in trades_for(ind, key) if side is None or t['dir'] == side]
        mid = len(ind['bars']) / 2
        first += [t for t in normal if t['signal'] < mid]
        second += [t for t in normal if t['signal'] >= mid]
    h, a, b = summarise(hard, cluster), summarise(first, cluster), summarise(second, cluster)
    return {'costs': bool(h['trades']) and (h['expectancy'] or 0) > 0, 'costsExpectancy': h['expectancy'],
            'halves': bool(a['trades'] and b['trades']) and (a['expectancy'] or 0) > 0 and (b['expectancy'] or 0) > 0
            and (a['tStat'] is None or a['tStat'] >= -1) and (b['tStat'] is None or b['tStat'] >= -1),
            'firstHalf': {k: a[k] for k in ('trades', 'expectancy', 'tStat')}, 'secondHalf': {k: b[k] for k in ('trades', 'expectancy', 'tStat')}}


def _week_start(day):
    return day - dt.timedelta(days=day.weekday())


def market_regimes(qqq_bars):
    """For each date, two regimes known from the PREVIOUS day: 'trend' (+1 if QQQ closed above its 200-day average)
    and 'vol' (+1 if its 20-day realised volatility was above its own 250-day median, i.e. turbulent)."""
    closes = [b['close'] for b in qqq_bars]
    side = _sma_side(closes, 200)
    rets = [0.0] + [math.log(closes[i] / closes[i - 1]) if closes[i - 1] > 0 and closes[i] > 0 else 0.0 for i in range(1, len(closes))]
    vol = [None] * len(closes)
    for i in range(20, len(closes)):
        w = rets[i - 19: i + 1]
        m = sum(w) / 20
        vol[i] = math.sqrt(sum((x - m) ** 2 for x in w) / 19)
    med = rolling_quantile(vol, 250, 0.5)
    out = {}
    for i in range(1, len(qqq_bars)):
        out[_day(qqq_bars[i]['time'])] = {'trend': side[i - 1], 'vol': None if vol[i - 1] is None or med[i - 1] is None else (1 if vol[i - 1] > med[i - 1] else -1)}
    return out


def regime_split(trades, regimes, which, runs=1000, seed=17):
    """Report only: average net return of trades in each regime (+1 / -1) and a permutation p-value for the gap,
    shuffling whole weeks of regime labels (trades in one week share one market)."""
    weeks = {}
    for t in trades:
        day = _day(t['time'])
        lab = (regimes.get(day) or {}).get(which)
        if lab is None:
            continue
        w = weeks.setdefault(_week_start(day), [lab, 0.0, 0])
        w[1] += t['ret']
        w[2] += 1
    if not weeks:
        return None
    rows = list(weeks.values())

    def gap(labels):
        s = {1: [0.0, 0], -1: [0.0, 0]}
        for lab, (_, tot, n) in zip(labels, rows):
            if lab in s:
                s[lab][0] += tot
                s[lab][1] += n
        if not s[1][1] or not s[-1][1]:
            return None, s
        return s[1][0] / s[1][1] - s[-1][0] / s[-1][1], s
    labels = [r[0] for r in rows]
    g, s = gap(labels)
    out = {'which': which, 'up': {'n': s[1][1], 'avg': s[1][0] / s[1][1] if s[1][1] else None},
           'down': {'n': s[-1][1], 'avg': s[-1][0] / s[-1][1] if s[-1][1] else None}, 'gap': g, 'p': None}
    if g is None or s[1][1] < 10 or s[-1][1] < 10:
        return out
    rnd, k = random.Random(seed), 0
    for _ in range(runs):
        rnd.shuffle(labels)
        gg, _ = gap(labels)
        if gg is not None and abs(gg) >= abs(g):
            k += 1
    out['p'] = (k + 1) / (runs + 1)
    return out


# ---------- The COT + z-score edge study ----------

def cot_z_events(ind, hold, trend=TREND):
    """The COT + z-score edge study for one stock: every bar where price was stretched beyond this stock's own
    z-score band in the direction of the trend and turned back, with the return from the next bar's open over `hold`
    bars (after costs). One event per stretch. COT readings are attached later by date (`edge_summary`)."""
    z, wk, bars = ind['z20'], trend_array(ind, trend), ind['bars']
    out, i, n = [], WARMUP, len(bars)
    while i < n - hold - 1:
        zlo, zhi = ind['zlo'][i], ind['zhi'][i]
        if not _ok(z[i], z[i - 1], z[i - 2], wk[i], zlo, zhi):
            i += 1
            continue
        up = min(z[i - 2: i + 1]) <= zlo and z[i] > z[i - 1]
        down = max(z[i - 2: i + 1]) >= zhi and z[i] < z[i - 1]
        d = (1 if up else -1 if down else 0) if trend == 'none' else wk[i]
        if not ((d == 1 and up) or (d == -1 and down)):
            i += 1
            continue
        entry, exit_price = bars[i + 1]['open'], bars[i + hold]['close']
        out.append({'time': bars[i]['time'], 'dir': d, 'ret': (exit_price / entry - 1) * d - COSTS if entry > 0 else 0.0})
        i += hold  # don't count the same stretch twice
    return out


def friday_key(day):
    """The COT week a date belongs to: the latest Friday on or before it (each Friday's release is used until the
    next one, so every day of that week sees the same reading)."""
    return day - dt.timedelta(days=(day.weekday() - 4) % 7)


def edge_summary(events, cot, hi=75, lo=25, runs=1000, seed=13):
    """Pools the edge-study events: count, average return and win rate for "commercials agree", "neutral", "against"
    and "no COT data", and a permutation test of agree minus against. COT is one market-wide reading per week, so the
    test shuffles whole weeks of readings (not single events) and is two-sided: a gap in either direction counts.
    `cot` is [(Tuesday data date, index)]."""
    dated = [(dt.date.fromisoformat(d), v) for d, v in cot]
    dates = [d for d, _ in dated]

    def reading(fri):
        k = bisect.bisect_right(dates, fri - dt.timedelta(days=3)) - 1
        return dated[k][1] if k >= 0 else None
    weeks = {}  # friday -> [value, long_sum, long_n, short_sum, short_n]
    groups = {'agree': [], 'neutral': [], 'against': [], 'none': []}
    for e in events:
        fri = friday_key(_day(e['time']))
        w = weeks.get(fri)
        if w is None:
            w = weeks[fri] = [reading(fri), 0.0, 0, 0.0, 0]
        if e['dir'] > 0:
            w[1] += e['ret']
            w[2] += 1
        else:
            w[3] += e['ret']
            w[4] += 1
        groups[cot_view(w[0], e['dir'], hi, lo) or 'none'].append(e['ret'])
    stats = {g: {'n': len(r), 'avg': sum(r) / len(r), 'win': sum(1 for x in r if x > 0) / len(r)} for g, r in groups.items() if r}
    known = [w for w in weeks.values() if w[0] is not None]

    def gap(values):
        ag = [0.0, 0]
        ar = [0.0, 0]
        for v, (_, ls, ln, ss, sn) in zip(values, known):
            if v >= hi:
                ag[0] += ls
                ag[1] += ln
                ar[0] += ss
                ar[1] += sn
            elif v <= lo:
                ag[0] += ss
                ag[1] += sn
                ar[0] += ls
                ar[1] += ln
        return (ag[0] / ag[1] - ar[0] / ar[1]) if ag[1] and ar[1] else None, ag[1], ar[1]
    values = [w[0] for w in known]
    g, n_ag, n_ar = gap(values)
    test = None
    if g is not None and n_ag >= 10 and n_ar >= 10:
        rnd, k = random.Random(seed), 0
        for _ in range(runs):
            rnd.shuffle(values)
            gg = gap(values)[0]
            if gg is not None and abs(gg) >= abs(g):
                k += 1
        p = (k + 1) / (runs + 1)
        test = {'gap': g, 'p': p, 'runs': runs, 'weeks': len(known),
                'verdict': ('COT adds an edge' if g > 0 else 'COT works the opposite way') if p <= 0.10 else 'COT may help' if p <= 0.2 and g > 0 else 'no clear COT edge'}
    return {'groups': stats, 'test': test, 'events': len(events), 'hi': hi, 'lo': lo}


COT_VARIANTS = [(w, hi, 100 - hi) for w in (26, 156) for hi in (60, 75, 80)]


def cot_study(events, rows, runs=1000):
    """Settles the COT question on the data at hand: the edge study for a 26- and a 156-week index, each at 60/40,
    75/25 and 80/20, read both ways, Holm-corrected for the 6 variants tried. COT enters the grade only if one passes
    (Holm p <= 0.10); otherwise it stays a displayed reading. `rows` = the COT report rows (oldest first)."""
    out = []
    for weeks, hi, lo in COT_VARIANTS:
        res = edge_summary(events, cot_index(rows, weeks), hi, lo, runs)
        out.append({'weeks': weeks, 'hi': hi, 'lo': lo, 'groups': res['groups'], 'test': res['test']})
    ps = [(v['test'] or {}).get('p', 1.0) for v in out]
    for v, pa in zip(out, holm(ps)):
        v['pAdjusted'] = pa
    best = min(out, key=lambda v: v['pAdjusted'])
    passed = best['pAdjusted'] <= 0.10 and best['test'] is not None
    chosen = {'weeks': best['weeks'], 'hi': best['hi'], 'lo': best['lo'], 'sign': 1 if best['test']['gap'] > 0 else -1} if passed else None
    return {'variants': out, 'passed': passed, 'chosen': chosen, 'events': len(events)}


def swing_levels(bars, atr_now, lookback=120, width=3):
    """Support/resistance: swing highs and lows (higher/lower than the 3 bars each side), clustered within 0.6 ATR."""
    recent = bars[-lookback:]
    points = []
    for i in range(width, len(recent) - width):
        hi, lo = recent[i]['high'], recent[i]['low']
        if all(hi >= recent[j]['high'] for j in range(i - width, i + width + 1)):
            points.append(hi)
        if all(lo <= recent[j]['low'] for j in range(i - width, i + width + 1)):
            points.append(lo)
    clusters = []
    for p in sorted(points):
        if clusters and p - clusters[-1][-1] <= 0.6 * atr_now:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    return [{'price': sum(c) / len(c), 'touches': len(c)} for c in clusters]
