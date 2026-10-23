"""
Market scanner: a background job that keeps analysing a list of stocks (plus your watchlist) on several timeframes
and ranks the strongest setups. It blends well-known, testable methods:

- Trend following: price vs its 50- and 200-day averages (Dow theory, trend following)
- Breakouts: new 20-day highs / lows (Donchian channels, the Turtle traders)
- Relative strength vs the S&P 500 (William O'Neil)
- Momentum: MACD and RSI; buying pullbacks inside an uptrend (Alexander Elder's triple screen)
- Volume confirmation (Richard Wyckoff) and trend strength (ADX, Welles Wilder)
- Timeframe agreement: daily and 30-minute trends pointing the same way
- For the top names: options flow (put/call by premium) and headline tone

Each idea comes with ATR-based levels and, so nothing is taken on faith, how the same signal actually did on that
stock over the past year (daily) or past days (next-30-minute bias). These are signals, not certainties.
"""
import asyncio
import datetime as dt
import logging
import time
from zoneinfo import ZoneInfo

from . import flow, positioning, sec
from .core import EngineError, handler

log = logging.getLogger('engine.scanner')
EASTERN = ZoneInfo('America/New_York')

UNIVERSE = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX', 'JPM',
            'LLY', 'XOM', 'COST', 'PLTR', 'UBER', 'CRM', 'ORCL', 'MU', 'COIN', 'BA', 'DIS', 'V', 'UNH', 'WMT', 'GS', 'SMH']
MAX_SYMBOLS = 45
_slots = asyncio.Semaphore(3)
_state = {'result': None, 'running': None, 'extra': set()}

POSITIVE_WORDS = ('beat', 'beats', 'upgrade', 'upgraded', 'raises', 'raised', 'record', 'surge', 'surges', 'soar', 'jumps', 'rally', 'buyback', 'approval', 'wins', 'strong')
NEGATIVE_WORDS = ('miss', 'misses', 'downgrade', 'downgraded', 'cuts', 'cut', 'plunge', 'plunges', 'falls', 'slides', 'probe', 'lawsuit', 'recall', 'weak', 'warning', 'tumbles', 'sinks')


# ---------- Indicator maths (plain Python, so the scanner works even without numpy) ----------

def ema(values, n):
    out, k, prev = [], 2 / (n + 1), None
    for v in values:
        prev = v if prev is None else prev + k * (v - prev)
        out.append(prev)
    return out


def rsi(closes, n=14):
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


def atr(bars, n=14):
    out, prev = [None] * len(bars), None
    for i, b in enumerate(bars):
        tr = b['high'] - b['low'] if i == 0 else max(b['high'] - b['low'], abs(b['high'] - bars[i - 1]['close']), abs(b['low'] - bars[i - 1]['close']))
        prev = tr if prev is None else (prev * (n - 1) + tr) / n
        out[i] = prev if i >= n - 1 else None
    return out


def adx(bars, n=14):
    """Average directional index: trend strength (above ~25 = trending)."""
    out = [None] * len(bars)
    tr_s = pdm_s = ndm_s = None
    dx_vals = []
    for i in range(1, len(bars)):
        up = bars[i]['high'] - bars[i - 1]['high']
        down = bars[i - 1]['low'] - bars[i]['low']
        pdm = up if up > down and up > 0 else 0
        ndm = down if down > up and down > 0 else 0
        tr = max(bars[i]['high'] - bars[i]['low'], abs(bars[i]['high'] - bars[i - 1]['close']), abs(bars[i]['low'] - bars[i - 1]['close']))
        if tr_s is None:
            tr_s, pdm_s, ndm_s = tr, pdm, ndm
        else:
            tr_s, pdm_s, ndm_s = tr_s - tr_s / n + tr, pdm_s - pdm_s / n + pdm, ndm_s - ndm_s / n + ndm
        if tr_s:
            pdi, ndi = 100 * pdm_s / tr_s, 100 * ndm_s / tr_s
            dx_vals.append(100 * abs(pdi - ndi) / (pdi + ndi) if pdi + ndi else 0)
            if len(dx_vals) >= n:
                out[i] = sum(dx_vals[-n:]) / n
    return out


# ---------- Signals ----------

def prepare(bars, spy_closes=None):
    """Every indicator the daily score needs, computed once over the whole history (all are causal, so the value at
    bar i only uses bars up to i: scoring old bars this way is the same as scoring them on that day)."""
    closes = [b['close'] for b in bars]
    macd = [x - y for x, y in zip(ema(closes, 12), ema(closes, 26))]
    sig = ema(macd, 9)
    spy = None
    if spy_closes:
        # Line SPY up with this stock by trading day (a day missing from either side just has no comparison).
        day = lambda t: time.strftime('%Y-%m-%d', time.gmtime(t + 12 * 3600))
        by_day = {day(t): c for t, c in spy_closes}
        spy = [by_day.get(day(b['time'])) for b in bars]
    # Williams Accumulation/Distribution: buying vs selling pressure from closes against the true range.
    wad, total = [0.0], 0.0
    for i in range(1, len(bars)):
        pc = closes[i - 1]
        if closes[i] > pc:
            total += closes[i] - min(bars[i]['low'], pc)
        elif closes[i] < pc:
            total += closes[i] - max(bars[i]['high'], pc)
        wad.append(total)
    # Chaikin money flow (20 days): volume-weighted position of each close in its range.
    mfv = [((b['close'] - b['low']) - (b['high'] - b['close'])) / (b['high'] - b['low']) * b['volume'] if b['high'] > b['low'] else 0 for b in bars]
    cmf = [None] * len(bars)
    for i in range(19, len(bars)):
        vol = sum(b['volume'] for b in bars[i - 19: i + 1])
        cmf[i] = sum(mfv[i - 19: i + 1]) / vol if vol else None
    return {'bars': bars, 'closes': closes, 'e20': ema(closes, 20), 'e50': ema(closes, 50), 'e200': ema(closes, 200), 'rsi': rsi(closes),
            'hist': [x - y for x, y in zip(macd, sig)], 'adx': adx(bars), 'spy': spy, 'wad': wad, 'cmf': cmf}


def daily_score(ind, i):
    """Score (about -10..10) and reasons for the daily (swing) setup as of bar i."""
    bars, closes = ind['bars'], ind['closes']
    if i < 210:
        return 0, []
    c = closes[i]
    e20, e50, e200, r = ind['e20'][i], ind['e50'][i], ind['e200'][i], ind['rsi'][i]
    hist_now, hist_prev = ind['hist'][i], ind['hist'][i - 1]
    window = bars[i - 20: i]
    highs, lows = max(b['high'] for b in window), min(b['low'] for b in window)
    avg_vol = sum(b['volume'] for b in window) / len(window)
    vol_ratio = bars[i]['volume'] / avg_vol if avg_vol else 1
    score, reasons = 0, []

    def add(points, text):
        nonlocal score
        score += points
        reasons.append({'text': text, 'points': points})

    if c > e50 > e200:
        add(2, 'Uptrend: above the 50- and 200-day averages')
    elif c < e50 < e200:
        add(-2, 'Downtrend: below the 50- and 200-day averages')
    if c >= highs:
        add(2, 'Breakout to a 20-day high (Donchian)')
    elif c <= lows:
        add(-2, 'Breakdown to a 20-day low (Donchian)')
    spy = ind['spy']
    if spy and spy[i] and spy[i - 21]:
        rel = (c / closes[i - 21]) - (spy[i] / spy[i - 21])
        if rel > 0.03:
            add(1, f'Beating the S&P 500 by {rel * 100:.1f}% over a month')
        elif rel < -0.03:
            add(-1, f'Lagging the S&P 500 by {abs(rel) * 100:.1f}% over a month')
    if r is not None:
        if c > e50 and 38 <= r <= 52:
            add(1, f'Pullback in an uptrend (RSI {r:.0f})')
        elif r > 75:
            add(-1, f'Overbought (RSI {r:.0f}): extended, risk of a pause')
        elif r < 25 and c > e200:
            add(1, f'Oversold above the 200-day (RSI {r:.0f}): bounce setup')
        elif r < 30:
            add(-1, f'Weak momentum (RSI {r:.0f})')
    if hist_now > 0 >= hist_prev:
        add(1, 'MACD turned up')
    elif hist_now < 0 <= hist_prev:
        add(-1, 'MACD turned down')
    if vol_ratio > 1.5:
        up = c > closes[i - 1]
        add(1 if up else -1, f'Volume {vol_ratio:.1f}x normal on an {"up" if up else "down"} day (Wyckoff)')
    # Money flow: are the big buyers accumulating or distributing? (Williams A/D trend and divergence, Chaikin money flow)
    wad = ind['wad']
    wad_up = wad[i] > wad[i - 20]
    price_up = c > closes[i - 20]
    if wad_up and not price_up:
        add(1, 'Accumulation: Williams A/D rising while price lags (bullish divergence)')
    elif not wad_up and price_up:
        add(-1, 'Distribution: Williams A/D falling while price rises (bearish divergence)')
    cmf = ind['cmf'][i]
    if cmf is not None and cmf > 0.1:
        add(1, f'Money flowing in (Chaikin money flow {cmf:+.2f})')
    elif cmf is not None and cmf < -0.1:
        add(-1, f'Money flowing out (Chaikin money flow {cmf:+.2f})')
    a = ind['adx'][i]
    if a and a > 25 and abs(score) >= 2:
        add(1 if score > 0 else -1, f'Strong trend (ADX {a:.0f})')
    if e20 and abs(c - e20) / e20 > 0.08:
        reasons.append({'text': f'{(c / e20 - 1) * 100:+.1f}% from the 20-day average: better entries on a pullback', 'points': 0})
    return score, reasons


def signal_history(ind, direction, days=5, lookback=250):
    """How the same daily signal did on this stock over the past year: count, % moving the right way after `days`."""
    bars = ind['bars']
    hits, n, total = 0, 0, 0.0
    i = max(210, len(bars) - lookback - days)
    while i < len(bars) - days:
        s, _ = daily_score(ind, i)
        if (direction > 0 and s >= 3) or (direction < 0 and s <= -3):
            ret = bars[i + days]['close'] / bars[i]['close'] - 1
            n += 1
            total += ret * direction
            hits += 1 if ret * direction > 0 else 0
            i += days  # don't count the same move several times
        else:
            i += 1
    return {'count': n, 'winRate': hits / n if n else None, 'avgReturn': total / n if n else None, 'days': days}


STOP_ATR, TARGET_ATR, MAX_HOLD = 1.5, 2.5, 15


def backtest_signal(ind, direction, atrs, lookback=None):
    """Replays the entry rule on this stock's history as real trades: enter at the next open when the score first
    crosses the threshold, exit at the stop (1.5 ATR), the target (2.5 ATR) or after 15 days. Costs 0.05% a side."""
    bars = ind['bars']
    trades = []
    i = 211 if lookback is None else max(211, len(bars) - lookback)
    prev = daily_score(ind, i - 1)[0]
    while i < len(bars) - 1:
        s, _ = daily_score(ind, i)
        crossed = (direction > 0 and s >= 3 > prev) or (direction < 0 and s <= -3 < prev)
        prev = s
        if not crossed or not atrs[i]:
            i += 1
            continue
        entry = bars[i + 1]['open']
        risk = STOP_ATR * atrs[i]
        stop, target = entry - risk * direction, entry + TARGET_ATR * atrs[i] * direction
        exit_price, exit_i, reason = None, None, 'time'
        for j in range(i + 1, min(len(bars), i + 1 + MAX_HOLD)):
            b = bars[j]
            hit_stop = b['low'] <= stop if direction > 0 else b['high'] >= stop
            hit_target = b['high'] >= target if direction > 0 else b['low'] <= target
            if hit_stop:  # assume the worse outcome when both happen in one bar
                gapped = j > i + 1 and (b['open'] < stop if direction > 0 else b['open'] > stop)
                exit_price, exit_i, reason = (b['open'] if gapped else stop), j, 'stop'  # a gap through the stop fills at the open
                break
            if hit_target:
                exit_price, exit_i, reason = target, j, 'target'
                break
        if exit_price is None:
            exit_i = min(len(bars) - 1, i + MAX_HOLD)
            exit_price = bars[exit_i]['close']
        ret = (exit_price / entry - 1) * direction - 0.001
        trades.append({'ret': ret, 'r': (exit_price - entry) * direction / risk, 'reason': reason, 'bars': exit_i - i})
        i = exit_i + 1
        prev = daily_score(ind, i - 1)[0] if i - 1 < len(bars) else prev
    wins = [t for t in trades if t['ret'] > 0]
    losses = [t for t in trades if t['ret'] <= 0]
    gross_win, gross_loss = sum(t['ret'] for t in wins), -sum(t['ret'] for t in losses)
    streak = worst = 0
    for t in trades:
        streak = streak + 1 if t['ret'] <= 0 else 0
        worst = max(worst, streak)
    n = len(trades)
    pf = gross_win / gross_loss if gross_loss else (float('inf') if wins else None)
    exp = sum(t['ret'] for t in trades) / n if n else None
    grade = 'unproven'
    if n >= 6 and exp is not None and exp > 0 and pf is not None and pf >= 1.25:
        grade = 'proven'
    elif n >= 4 and exp is not None and exp > 0:
        grade = 'mixed'
    elif n >= 4:
        grade = 'failed'
    return {'trades': n, 'winRate': len(wins) / n if n else None, 'profitFactor': None if pf is None else (round(pf, 2) if pf != float('inf') else 99),
            'expectancy': exp, 'avgR': sum(t['r'] for t in trades) / n if n else None, 'avgBars': sum(t['bars'] for t in trades) / n if n else None,
            'targets': sum(1 for t in trades if t['reason'] == 'target'), 'stops': sum(1 for t in trades if t['reason'] == 'stop'),
            'maxLosingStreak': worst, 'total': sum(t['ret'] for t in trades), 'grade': grade,
            'rules': f'Enter next open on the signal, stop {STOP_ATR} ATR, target {TARGET_ATR} ATR, exit after {MAX_HOLD} days, 0.1% costs'}


def swing_levels(bars, atr_now, lookback=180, width=3):
    """Support/resistance from swing highs and lows (a bar higher/lower than the 3 on each side), clustered within
    0.6 ATR. More touches = stronger level; each level keeps its last-touch date."""
    recent = bars[-lookback:]
    points = []
    for i in range(width, len(recent) - width):
        hi, lo = recent[i]['high'], recent[i]['low']
        if all(hi >= recent[j]['high'] for j in range(i - width, i + width + 1)):
            points.append((hi, recent[i]['time']))
        if all(lo <= recent[j]['low'] for j in range(i - width, i + width + 1)):
            points.append((lo, recent[i]['time']))
    clusters = []
    for price, t in sorted(points):
        if clusters and price - clusters[-1]['prices'][-1] <= 0.6 * atr_now:
            clusters[-1]['prices'].append(price)
            clusters[-1]['last'] = max(clusters[-1]['last'], t)
        else:
            clusters.append({'prices': [price], 'last': t})
    return [{'price': sum(c['prices']) / len(c['prices']), 'touches': len(c['prices']), 'last': c['last'], 'kind': 'swing'} for c in clusters]


def key_levels(ind, atr_now):
    """Every level that matters, tagged by source: swing clusters, floor pivots, 52-week range, 50/200-day averages."""
    bars = ind['bars']
    prev = bars[-2] if len(bars) > 1 else bars[-1]
    p = (prev['high'] + prev['low'] + prev['close']) / 3
    year = bars[-252:]
    levels = swing_levels(bars, atr_now) + [
        {'price': p, 'kind': 'pivot', 'label': 'Pivot'},
        {'price': 2 * p - prev['low'], 'kind': 'pivot', 'label': 'R1'},
        {'price': 2 * p - prev['high'], 'kind': 'pivot', 'label': 'S1'},
        {'price': p + (prev['high'] - prev['low']), 'kind': 'pivot', 'label': 'R2'},
        {'price': p - (prev['high'] - prev['low']), 'kind': 'pivot', 'label': 'S2'},
        {'price': max(b['high'] for b in year), 'kind': '52w', 'label': '52-week high'},
        {'price': min(b['low'] for b in year), 'kind': '52w', 'label': '52-week low'},
        {'price': ind['e50'][-1], 'kind': 'ma', 'label': '50-day average'},
        {'price': ind['e200'][-1], 'kind': 'ma', 'label': '200-day average'},
    ]
    for lv in levels:
        lv.setdefault('label', f"Swing level ({lv.get('touches', 1)} touches)")
    return levels


def trade_plan(levels, price, atr_now, direction, today):
    """Entry, stop and targets from real levels: stop just past the nearest level behind the trade, targets at the
    next levels ahead (falling back to ATR distances), and the resulting reward-to-risk."""
    # Levels closer than 0.75 ATR are noise for a swing stop; farther than 2.5 ATR risks too much.
    behind = sorted((lv for lv in levels if (lv['price'] < price if direction > 0 else lv['price'] > price) and 0.75 * atr_now <= abs(price - lv['price']) <= 2.5 * atr_now),
                    key=lambda lv: abs(price - lv['price']))
    ahead = sorted((lv for lv in levels if (lv['price'] > price if direction > 0 else lv['price'] < price) and abs(lv['price'] - price) >= 1.0 * atr_now),
                   key=lambda lv: abs(lv['price'] - price))
    if behind:
        stop = behind[0]['price'] - 0.25 * atr_now * direction
        stop_note = f"just past {behind[0]['label']} at {behind[0]['price']:.2f}"
    else:
        stop = price - STOP_ATR * atr_now * direction
        stop_note = f'{STOP_ATR} ATR'
    risk = abs(price - stop) or atr_now
    t1 = ahead[0]['price'] if ahead else price + 2 * atr_now * direction
    t2 = ahead[1]['price'] if len(ahead) > 1 else price + 3.5 * atr_now * direction
    trigger = today['high'] if direction > 0 else today['low']
    return {
        'entry': price, 'trigger': trigger,
        'entryNote': f"Enter on a move {'above' if direction > 0 else 'below'} today's {'high' if direction > 0 else 'low'} ({trigger:.2f}), or on a pullback toward support that holds",
        'stop': stop, 'stopNote': stop_note,
        'target1': t1, 'target1Note': ahead[0]['label'] if ahead else '2 ATR',
        'target2': t2, 'target2Note': ahead[1]['label'] if len(ahead) > 1 else '3.5 ATR',
        'riskReward': abs(t1 - price) / risk, 'atr': atr_now,
        'exitNote': 'Exit early on a daily close back through the 20-day average, or trail the stop 2 ATR behind the highest close (chandelier exit)',
        'supports': [{'price': lv['price'], 'label': lv['label']} for lv in sorted((x for x in levels if x['price'] < price), key=lambda x: price - x['price'])[:4]],
        'resistances': [{'price': lv['price'], 'label': lv['label']} for lv in sorted((x for x in levels if x['price'] > price), key=lambda x: x['price'] - price)[:4]],
    }


def intraday_bias(bars5):
    """Next-30-minute lean from 5-minute bars (trend, VWAP, momentum, RSI) and how often it was right recently."""
    if len(bars5) < 60:
        return None
    closes = [b['close'] for b in bars5]
    e9, e21, r = ema(closes, 9), ema(closes, 21), rsi(closes)
    day = lambda t: dt.datetime.fromtimestamp(t, EASTERN).date()  # noqa: E731
    vwap, pv, vv, cur = [], 0.0, 0.0, None
    for b in bars5:
        if day(b['time']) != cur:
            cur, pv, vv = day(b['time']), 0.0, 0.0
        typical = (b['high'] + b['low'] + b['close']) / 3
        pv += typical * b['volume']
        vv += b['volume']
        vwap.append(pv / vv if vv else typical)

    def bias(i):
        s = (1 if e9[i] > e21[i] else -1) + (1 if closes[i] > vwap[i] else -1) + (1 if closes[i] > closes[i - 6] else -1)
        if r[i] is not None:
            s += 1 if r[i] > 55 else -1 if r[i] < 45 else 0
        return s

    right = n = 0
    for i in range(30, len(bars5) - 6):
        b = bias(i)
        if abs(b) >= 3:
            n += 1
            right += 1 if (closes[i + 6] - closes[i]) * b > 0 else 0
    now = bias(len(bars5) - 1)
    return {'score': now, 'direction': 'up' if now >= 3 else 'down' if now <= -3 else 'flat', 'winRate': right / n if n else None,
            'samples': n, 'vwap': vwap[-1], 'asOf': bars5[-1]['time']}


def headline_tone(items):
    score = 0
    for it in items:
        t = it.get('title', '').lower()
        score += sum(1 for w in POSITIVE_WORDS if f' {w} ' in f' {t} ') - sum(1 for w in NEGATIVE_WORDS if f' {w} ' in f' {t} ')
    return score


# ---------- Data ----------

async def _history(ctx, symbol, method, days, key, max_age):
    async def load():
        now = dt.datetime.now(dt.timezone.utc)
        async with _slots:
            response = await getattr(ctx.schwab, method)(symbol, start_datetime=now - dt.timedelta(days=days), end_datetime=now)
            await asyncio.sleep(0.35)  # stay well under Schwab's 120 requests a minute
        if response.status_code != 200:
            raise EngineError(f'Schwab returned {response.status_code} for {symbol}')
        return [{'time': c['datetime'] // 1000, 'open': c['open'], 'high': c['high'], 'low': c['low'], 'close': c['close'], 'volume': c.get('volume', 0)}
                for c in response.json().get('candles', []) if c.get('close')]
    return await ctx.cached((key, symbol), max_age, load, persist=True, stale_ok=True)


def market_session(now=None):
    now = now or dt.datetime.now(EASTERN)
    if now.weekday() >= 5:
        return 'closed'
    minutes = now.hour * 60 + now.minute
    if 570 <= minutes < 960:
        return 'open'
    if 240 <= minutes < 1200:
        return 'extended'
    return 'closed'


def daily_age(session):
    # While the market is open the last daily bar is still forming: re-read it every 30 minutes.
    return 1800 if session == 'open' else 4 * 3600


async def analyse(ctx, symbol, spy_closes, session):
    daily = await _history(ctx, symbol, 'get_price_history_every_day', 1100, 'scan-daily3y', daily_age(session))
    if len(daily) < 260:
        return None
    ind = prepare(daily, spy_closes)
    score, reasons = daily_score(ind, len(daily) - 1)
    atrs = atr(daily)
    a = atrs[-1] or 0
    c = daily[-1]['close']
    direction = 1 if score >= 3 else -1 if score <= -3 else 0
    m30 = await _history(ctx, symbol, 'get_price_history_every_thirty_minutes', 15, 'scan-30m', 600 if session != 'closed' else 6 * 3600)
    if len(m30) > 60:
        closes = [b['close'] for b in m30]
        trend30 = 1 if ema(closes, 20)[-1] > ema(closes, 50)[-1] else -1
        if direction and trend30 == direction:
            score += direction
            reasons.append({'text': 'Daily and 30-minute trends agree (triple screen)', 'points': direction})
        elif direction and trend30 != direction:
            reasons.append({'text': '30-minute trend disagrees: wait for it to turn', 'points': 0})
    bias = None
    if session != 'closed':
        m5 = await _history(ctx, symbol, 'get_price_history_every_five_minutes', 5, 'scan-5m', 240)
        bias = intraday_bias(m5)
    levels = key_levels(ind, a) if a else []
    plan = trade_plan(levels, c, a, direction, daily[-1]) if direction and a else None
    # Long and short both get tested, so the scanner knows whether this stock rewards the signal at all.
    tested = await asyncio.to_thread(backtest_signal, ind, direction, atrs) if direction else None
    history = signal_history(ind, direction) if direction else None
    if not direction and a:
        plan = {'supports': trade_plan(levels, c, a, 1, daily[-1])['supports'], 'resistances': trade_plan(levels, c, a, 1, daily[-1])['resistances'], 'atr': a}
    week = c / daily[-6]['close'] - 1 if len(daily) > 6 else None
    return {'symbol': symbol, 'price': c, 'asOf': daily[-1]['time'], 'score': score, 'direction': direction,
            'reasons': sorted(reasons, key=lambda r: -abs(r['points'])), 'levels': plan, 'backtest': tested, 'history': history, 'bias': bias,
            'week': week, 'day': c / daily[-2]['close'] - 1 if len(daily) > 2 else None}


async def scan(ctx, news=None):
    session = market_session()
    symbols = list(dict.fromkeys(UNIVERSE + sorted(_state['extra'])))[:MAX_SYMBOLS]
    spy = await _history(ctx, 'SPY', 'get_price_history_every_day', 1100, 'scan-daily3y', daily_age(session))
    spy_closes = [(b['time'], b['close']) for b in spy]
    results = []
    for sym in symbols:
        try:
            r = await analyse(ctx, sym, spy_closes, session)
            if r:
                results.append(r)
        except EngineError:
            raise
        except Exception as err:
            log.info('Scanner skipped %s: %s', sym, err)
    if not results:
        raise EngineError('The scanner could not load price history from Schwab.')
    ranked = sorted([r for r in results if r['direction']], key=lambda r: -abs(r['score']))
    # Options flow and headlines for the strongest few (these cost more requests).
    for r in ranked[:6]:
        try:
            o = await flow.options(ctx, {'symbol': r['symbol']})
            pc = o['summary'].get('putCallPremium') or o['summary'].get('putCallVolume')
            if pc is not None:
                r['options'] = {'putCallPremium': pc, 'expectedMove': o['summary'].get('expectedMove'), 'expiration': o['expiration']}
                if (pc < 0.7 and r['direction'] > 0) or (pc > 1.2 and r['direction'] < 0):
                    r['score'] += r['direction']
                    r['reasons'].append({'text': f'Options money agrees (put/call by premium {pc:.2f})', 'points': r['direction']})
                elif (pc > 1.2 and r['direction'] > 0) or (pc < 0.7 and r['direction'] < 0):
                    r['reasons'].append({'text': f'Options money disagrees (put/call by premium {pc:.2f})', 'points': 0})
        except Exception as err:
            log.info('Scanner options for %s failed: %s', r['symbol'], err)
    for r in ranked[:6]:
        await smart_money(ctx, r)
    if news is not None and ranked:
        try:
            items, _ = await news.get([r['symbol'] for r in ranked[:6]])
            for r in ranked[:6]:
                mine = [it for it in items if r['symbol'] in it.get('title', '').upper().split() or f"{r['symbol']} stock" in it.get('title', '')]
                if mine:
                    tone = headline_tone(mine)
                    r['news'] = {'headline': mine[0]['title'], 'link': mine[0].get('link'), 'source': mine[0].get('source'), 'count': len(mine), 'tone': tone}
        except Exception as err:
            log.info('Scanner news failed: %s', err)
    await live_prices(ctx, results)
    above50 = sum(1 for r in results if r['reasons'] and any('Uptrend' in x['text'] for x in r['reasons']))
    spy_row = next((r for r in results if r['symbol'] == 'SPY'), None)
    vix = None
    try:
        resp = await ctx.schwab.get_quotes(['$VIX'])
        q = (resp.json().get('$VIX') or {}).get('quote', {}) if resp.status_code == 200 else {}
        vix = q.get('lastPrice') or q.get('closePrice')
    except Exception:
        pass
    for r in results:
        grade_setup(r)
    weight = {'proven': 1.0, 'mixed': 0.6, 'unproven': 0.3, 'failed': 0.0}
    def rank(r):
        bt = r.get('backtest') or {}
        rr = (r.get('levels') or {}).get('riskReward') or 0
        return abs(r['score']) * weight.get(bt.get('grade'), 0.3) * (1 if rr >= 1.5 else 0.6) * (0.1 if r.get('stale') else 1)
    candidates = [r for r in results if r['direction']]
    ranked = sorted([r for r in candidates if (r.get('backtest') or {}).get('grade') != 'failed'], key=lambda r: -rank(r))
    return {
        'filteredOut': [{'symbol': r['symbol'], 'direction': r['direction'], 'backtest': r['backtest']} for r in candidates if (r.get('backtest') or {}).get('grade') == 'failed'],
        'method': {'stopAtr': STOP_ATR, 'targetAtr': TARGET_ATR, 'maxHold': MAX_HOLD, 'threshold': 3},
        'updated': time.time(),
        'session': session,
        'scanned': len(results),
        'regime': {'spyScore': spy_row['score'] if spy_row else None, 'spyWeek': spy_row['week'] if spy_row else None, 'vix': vix,
                   'uptrendShare': above50 / len(results)},
        'setups': ranked[:12],
        'all': sorted(results, key=lambda r: -r['score']),
    }


async def live_prices(ctx, results):
    """Shows Schwab's live quote (price and today's change, same as the rest of the platform) instead of the last
    daily bar, which can lag during the session. Signals and levels stay based on the daily bars."""
    try:
        resp = await ctx.schwab.get_quotes([r['symbol'] for r in results])
        data = resp.json() if resp.status_code == 200 else {}
    except Exception as err:
        log.info('Scanner quotes failed: %s', err)
        return
    for r in results:
        q = (data.get(r['symbol']) or {}).get('quote') or {}
        last, net = q.get('lastPrice'), q.get('netChange')
        if isinstance(last, (int, float)) and last > 0:
            r['price'] = float(last)
            if isinstance(net, (int, float)) and last - net > 0:
                r['day'] = net / (last - net)


async def smart_money(ctx, r):
    """Institutional positioning for a top setup: commercial hedgers in the related futures (Williams COT index, 26
    weeks), insiders' open-market buying, and big options trades paid at the ask."""
    d = r['direction']

    def add(points, text):
        r['score'] += points
        r['reasons'].append({'text': text, 'points': points})
        r.setdefault('smartMoney', []).append(text)

    try:
        cot = await positioning.cot_for_symbol(ctx, {'symbol': r['symbol']})
        nets = [x['commNet'] for x in cot['rows'][-26:]]
        if len(nets) >= 10 and max(nets) > min(nets):
            idx = 100 * (nets[-1] - min(nets)) / (max(nets) - min(nets))
            r['cot'] = {'market': cot['market'], 'commercialIndex': idx}
            if idx >= 75:
                add(1 if d > 0 else 0, f"Commercial hedgers near a 6-month long extreme in {cot['market']} (Williams COT {idx:.0f})")
            elif idx <= 25:
                add(-1 if d < 0 else 0, f"Commercial hedgers near a 6-month short extreme in {cot['market']} (Williams COT {idx:.0f})")
    except Exception as err:
        log.info('Scanner COT for %s failed: %s', r['symbol'], err)
    try:
        ins = await sec.insiders(ctx, {'symbol': r['symbol']})
        buys = ins['summary']['buyValue']
        if buys > 100000:
            r['insiders'] = {'buyValue': buys, 'sellValue': ins['summary']['sellValue']}
            add(1 if d > 0 else 0, f"Insiders bought ${buys / 1e6:.1f}M on the open market recently")
    except Exception as err:
        log.info('Scanner insiders for %s failed: %s', r['symbol'], err)
    try:
        o = await flow.options(ctx, {'symbol': r['symbol']})
        calls = sum(u['premium'] for u in o['unusual'] if u['type'] == 'call' and u['side'] == 'at ask')
        puts = sum(u['premium'] for u in o['unusual'] if u['type'] == 'put' and u['side'] == 'at ask')
        if calls + puts > 250000:
            r['bigTrades'] = {'callsAtAsk': calls, 'putsAtAsk': puts}
            if calls > 2 * puts:
                add(1 if d > 0 else 0, f'Big call buying at the ask (${calls / 1e6:.1f}M vs ${puts / 1e6:.1f}M puts)')
            elif puts > 2 * calls:
                add(-1 if d < 0 else 0, f'Big put buying at the ask (${puts / 1e6:.1f}M vs ${calls / 1e6:.1f}M calls)')
    except Exception as err:
        log.info('Scanner big trades for %s failed: %s', r['symbol'], err)


def grade_setup(r):
    """A simple conviction tier and a one-line reason, so the dashboard can show only what matters.

    A: the signal made money on this stock in testing (proven), reward is at least 1.5x the risk, and several
       independent signals agree (score 5+). B: tested positive or a decent plan. C: everything else."""
    bt = r.get('backtest') or {}
    rr = (r.get('levels') or {}).get('riskReward') or 0
    strong = abs(r['score']) >= 5
    if not r['direction']:
        r['tier'] = None
    elif bt.get('grade') == 'proven' and rr >= 1.5 and strong:
        r['tier'] = 'A'
    elif bt.get('grade') in ('proven', 'mixed') and (rr >= 1.3 or strong):
        r['tier'] = 'B'
    else:
        r['tier'] = 'C'
    agree = [x['text'].split(':')[0].split(' (')[0] for x in r['reasons'] if x['points'] * (r['direction'] or 1) > 0][:3]
    r['summary'] = ', '.join(agree) if agree else 'No clear signal'
    # The plan is from the last daily bar; if the live price has already hit the stop or the first target, it's stale.
    lv, d = r.get('levels') or {}, r['direction']
    if d and lv.get('stop') is not None and (r['price'] - lv['stop']) * d <= 0:
        r['tier'], r['stale'] = 'C', True
        r['summary'] = 'Live price is already through the stop: setup failed, wait for a new one'
    elif d and lv.get('target1') is not None and (r['price'] - lv['target1']) * d >= 0:
        r['tier'], r['stale'] = 'C', True
        r['summary'] = 'Live price already reached the first target: too late to chase'


SCAN_EVERY = 600  # the owner wants a fresh scan every 10 minutes (cached daily bars keep quiet hours cheap)


def next_interval(session):
    return SCAN_EVERY


async def background(ctx, news=None, first_delay=15):
    """Runs forever inside the helper: scans, waits (10 minutes in market hours), scans again."""
    await asyncio.sleep(first_delay)
    while True:
        try:
            await run_once(ctx, news)
        except Exception as err:
            log.info('Background scan failed: %s', err)
        wait = next_interval(market_session())
        _state['next'] = time.time() + wait
        await asyncio.sleep(wait)


async def run_once(ctx, news=None):
    if _state['running']:
        return await _state['running']
    task = asyncio.ensure_future(scan(ctx, news))
    _state['running'] = task
    try:
        _state['result'] = await task
        return _state['result']
    finally:
        _state['running'] = None


@handler('scanner.results')
async def results(ctx, msg):
    """The latest scan (runs one first if there isn't one yet). `symbols` adds your watchlist to the scan."""
    extra = {str(s).upper() for s in msg.get('symbols') or [] if isinstance(s, str) and s and '-' not in s and not s.startswith('$')}
    new = extra - _state['extra'] - set(UNIVERSE)
    _state['extra'] |= extra
    if _state['result'] is None or msg.get('refresh'):
        await run_once(ctx, ctx.news)
    elif new and not _state['running']:
        # Answer now with the last scan; the watchlist additions show up on the next refresh.
        _state['refresh'] = asyncio.ensure_future(run_once(ctx, ctx.news))  # keep a reference so it isn't garbage-collected
    return {**_state['result'], 'nextScan': _state.get('next'), 'scanning': bool(_state['running'])}

