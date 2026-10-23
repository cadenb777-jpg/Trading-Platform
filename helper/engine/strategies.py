"""Swing-trading strategies for the market scanner: indicators, signals, trade plans, backtests and random tests.

Pure maths (no network), so every rule can be tested. All calculations at bar i use only bars 0..i, and the COT
report is only used from the Friday it is published (data as of the Tuesday before), so the backtests can't peek.

Strategies (each long and short):
  weekly_swing   (primary) Larry Williams-style swing: buy a pullback in a weekly uptrend when commercial hedgers
                 are accumulating (COT index) and price is stretched below its mean (z-score), timed with Williams %R
                 turning up and confirmed by Williams Accumulation/Distribution. Enter on the daily chart, exit on
                 the weekly horizon: target (+1 standard deviation), stop, or after one week (5 sessions).
  mean_reversion Short-term snap-back (Connors style): RSI(2) and z-score extremes in the direction of the 200-day
                 trend; exit on a close back above/below the 5-day average or after 7 sessions.
  breakout       Trend breakout: a close beyond the 20-day range in a weekly uptrend with ADX and volume; trail the
                 stop at the 10-day low/high, up to 20 sessions.
COT and the z-score are shown as a check on every setup, whatever the strategy.
"""
import datetime as dt
import math
import random

COSTS = 0.001  # commission + slippage for a round trip (0.1%)

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


def rolling_max(values, n, skip_current=False):
    """Highest of the last n values (optionally excluding the current one, e.g. a breakout of the prior 20 days)."""
    out = [None] * len(values)
    for i in range(len(values)):
        end = i if skip_current else i + 1
        if end - n >= 0:
            out[i] = max(values[end - n: end])
    return out


def rolling_min(values, n, skip_current=False):
    out = [None] * len(values)
    for i in range(len(values)):
        end = i if skip_current else i + 1
        if end - n >= 0:
            out[i] = min(values[end - n: end])
    return out


# ---------- Weekly trend and COT, aligned with the daily bars ----------


def _day(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).date()  # daily bars are stamped at US midnight, 04-07 UTC


def weekly_trend(bars, n=10):
    """+1 / -1 / None per day: was the last COMPLETED week's close above or below its n-week average?
    (Only finished weeks are used, so a week's result is known from the Monday after.)"""
    out = [None] * len(bars)
    week_closes, current, last_close = [], None, None
    for i, b in enumerate(bars):
        wk = _day(b['time']).isocalendar()[:2]
        if current is not None and wk != current:
            week_closes.append(last_close)
        current, last_close = wk, b['close']
        if len(week_closes) >= n:
            avg = sum(week_closes[-n:]) / n
            out[i] = 1 if week_closes[-1] > avg else -1 if week_closes[-1] < avg else 0
    return out


def cot_index(rows, weeks=26):
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


def prepare(bars, cot=None):
    """Everything the strategies read, computed once (all causal)."""
    closes = [b['close'] for b in bars]
    vols = [b.get('volume', 0) for b in bars]
    wad = williams_ad(bars)
    return {
        'bars': bars, 'closes': closes,
        'sma5': sma(closes, 5), 'sma20': sma(closes, 20), 'sma50': sma(closes, 50), 'sma200': sma(closes, 200),
        'sd20': stdev(closes, 20), 'z20': zscore(closes, 20),
        'rsi2': rsi(closes, 2), 'willr': williams_r(bars, 14),
        'wad': wad, 'wad_ema': ema(wad, 20),
        'atr': atr(bars, 14), 'adx': adx(bars, 14),
        'hi20': rolling_max([b['high'] for b in bars], 20, skip_current=True),
        'lo20': rolling_min([b['low'] for b in bars], 20, skip_current=True),
        'lo10': rolling_min([b['low'] for b in bars], 10, skip_current=True),
        'hi10': rolling_max([b['high'] for b in bars], 10, skip_current=True),
        'vol20': sma(vols, 20), 'vols': vols,
        'weekly': weekly_trend(bars),
        'cot': align_cot(bars, cot) if cot else [None] * len(bars),
    }


def cot_view(value, direction):
    """'agree' / 'against' / 'neutral' / None for a COT commercial index reading and a trade direction."""
    if value is None:
        return None
    lean = value if direction > 0 else 100 - value
    return 'agree' if lean >= 60 else 'against' if lean <= 40 else 'neutral'


# ---------- Signals: each returns None or {'dir', 'reasons'} using bars up to i only ----------

def _ok(*values):
    return all(v is not None for v in values)


def weekly_swing_signal(ind, i):
    """Pullback in a weekly trend, commercials on the same side (COT), stretched from the mean (z-score), timed by
    Williams %R crossing back out of oversold/overbought, with Williams A/D showing accumulation/distribution."""
    if i < 3:
        return None
    z, wr, wad, wad_e, wk, cot = ind['z20'], ind['willr'], ind['wad'], ind['wad_ema'], ind['weekly'], ind['cot'][i]
    if not _ok(z[i], z[i - 1], z[i - 2], wr[i], wr[i - 1], wr[i - 2], wk[i], wad_e[i], ind['atr'][i]):
        return None
    for d in (1, -1):
        if wk[i] != d:
            continue
        if cot is not None and (cot if d > 0 else 100 - cot) < 60:
            continue  # commercials must lean the same way when COT data exists
        stretched = (min(z[i - 2: i + 1]) <= -1.0 and z[i] > z[i - 1]) if d > 0 else (max(z[i - 2: i + 1]) >= 1.0 and z[i] < z[i - 1])
        # %R crossed back out of oversold (overbought) today or yesterday, and is still out.
        turned = (any(wr[k - 1] <= -80 < wr[k] for k in (i - 1, i)) and wr[i] > -80) if d > 0 else (any(wr[k - 1] >= -20 > wr[k] for k in (i - 1, i)) and wr[i] < -20)
        flow = (wad[i] >= wad_e[i]) if d > 0 else (wad[i] <= wad_e[i])
        if stretched and turned and flow:
            return {'dir': d, 'reasons': [
                f"Weekly trend {'up' if d > 0 else 'down'} (last week's close {'above' if d > 0 else 'below'} its 10-week average)",
                f'Commercials COT index {cot:.0f}/100' if cot is not None else 'COT not available for this market',
                f"Z-score {min(z[i - 2: i + 1]) if d > 0 else max(z[i - 2: i + 1]):+.1f} in the last 3 days, now {z[i]:+.1f} and turning",
                f"Williams %R crossed {'up through -80' if d > 0 else 'down through -20'} ({wr[i]:.0f})",
                f"Williams A/D {'above' if d > 0 else 'below'} its 20-day average ({'accumulation' if d > 0 else 'distribution'})",
            ]}
    return None


def mean_reversion_signal(ind, i):
    rsi2, z, c, s200 = ind['rsi2'][i], ind['z20'][i], ind['closes'][i], ind['sma200'][i]
    if not _ok(rsi2, z, s200, ind['atr'][i], ind['sma5'][i]):
        return None
    if c > s200 and rsi2 < 10 and z <= -1.5:
        return {'dir': 1, 'reasons': ['Above the 200-day average (long-term uptrend)', f'RSI(2) {rsi2:.0f}: deeply oversold', f'Z-score {z:+.1f}: stretched below the mean']}
    if c < s200 and rsi2 > 90 and z >= 1.5:
        return {'dir': -1, 'reasons': ['Below the 200-day average (long-term downtrend)', f'RSI(2) {rsi2:.0f}: deeply overbought', f'Z-score {z:+.1f}: stretched above the mean']}
    return None


def breakout_signal(ind, i):
    b, c = ind['bars'][i], ind['closes'][i]
    hi20, lo20, a, wk, s50, v20 = ind['hi20'][i], ind['lo20'][i], ind['adx'][i], ind['weekly'][i], ind['sma50'][i], ind['vol20'][i]
    if not _ok(hi20, lo20, a, wk, s50, v20, ind['atr'][i]) or not v20:
        return None
    vol = b.get('volume', 0) / v20
    if c > hi20 and wk == 1 and c > s50 and a >= 20 and vol >= 1.3:
        return {'dir': 1, 'reasons': ['Close above the prior 20-day high (Donchian breakout)', 'Weekly trend up', f'ADX {a:.0f}: trending', f'Volume {vol:.1f}x normal']}
    if c < lo20 and wk == -1 and c < s50 and a >= 20 and vol >= 1.3:
        return {'dir': -1, 'reasons': ['Close below the prior 20-day low (Donchian breakdown)', 'Weekly trend down', f'ADX {a:.0f}: trending', f'Volume {vol:.1f}x normal']}
    return None


# ---------- Trade plans (all prices fixed on the signal day) ----------

def weekly_swing_plan(ind, i, d):
    b, a = ind['bars'][i], ind['atr'][i]
    trigger = b['high'] if d > 0 else b['low']
    swing = min(x['low'] for x in ind['bars'][i - 2: i + 1]) if d > 0 else max(x['high'] for x in ind['bars'][i - 2: i + 1])
    dist = abs(trigger - (swing - 0.25 * a * d))
    dist = min(max(dist, 0.75 * a), 2.0 * a)  # stop just past the recent swing, kept between 0.75 and 2 ATR
    target = ind['sma20'][i] + d * ind['sd20'][i]  # back to the far side of the mean: +1 (or -1) standard deviation
    if (target - trigger) * d < 0.5 * a:
        return None  # not enough room to the target
    return {'entry': 'stop', 'trigger': trigger, 'validDays': 2, 'stop': trigger - d * dist, 'target': target,
            'maxHold': 5, 'breakEvenAtR': 1.0, 'exit': None,
            'targetNote': '+1 standard deviation above the 20-day average' if d > 0 else '1 standard deviation below the 20-day average',
            'exitRule': 'Take profit at the target, exit at the stop, or sell at the close of the 5th trading day (one week). Move the stop to break-even once the trade is up by its initial risk.'}


def mean_reversion_plan(ind, i, d):
    a, c = ind['atr'][i], ind['closes'][i]
    return {'entry': 'open', 'trigger': c, 'validDays': 1, 'stop': c - d * 2.5 * a, 'target': ind['sma5'][i],
            'maxHold': 7, 'breakEvenAtR': None, 'exit': 'sma5',
            'targetNote': 'the 5-day average (it moves; the exit is a close back across it)',
            'exitRule': f"Enter at the next open. Exit at the first close {'above' if d > 0 else 'below'} the 5-day average, at the 2.5 ATR safety stop, or after 7 trading days."}


def breakout_plan(ind, i, d):
    a, b = ind['atr'][i], ind['bars'][i]
    trigger = b['high'] if d > 0 else b['low']
    return {'entry': 'stop', 'trigger': trigger, 'validDays': 2, 'stop': trigger - d * 2.0 * a, 'target': None,
            'maxHold': 20, 'breakEvenAtR': None, 'exit': 'donchian10',
            'targetNote': 'no fixed target: the stop trails at the 10-day low' if d > 0 else 'no fixed target: the stop trails at the 10-day high',
            'exitRule': f"Enter on a break of the signal day's {'high' if d > 0 else 'low'}. Exit on a close beyond the 10-day {'low' if d > 0 else 'high'}, at the 2 ATR stop, or after 20 trading days."}


STRATEGIES = {
    'weekly_swing': {'name': 'Weekly swing (COT + z-score + Williams)', 'short': 'Weekly swing', 'signal': weekly_swing_signal, 'plan': weekly_swing_plan, 'horizon': 'about 1 week'},
    'mean_reversion': {'name': 'Mean reversion (RSI 2 + z-score)', 'short': 'Mean reversion', 'signal': mean_reversion_signal, 'plan': mean_reversion_plan, 'horizon': '2-7 days'},
    'breakout': {'name': 'Trend breakout (Donchian)', 'short': 'Breakout', 'signal': breakout_signal, 'plan': breakout_plan, 'horizon': '1-4 weeks'},
}


# ---------- Simulation ----------

def simulate(ind, i, plan, d):
    """Trades a plan from the bar after the signal. Stops fill at the stop, or at the open when price gaps through;
    when a stop and a target fall in the same bar the stop is assumed first. Returns None if never filled."""
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
    for j in range(fill_i, last + 1):
        b = bars[j]
        opened = b['open'] if j > fill_i else entry
        if (b['low'] <= stop) if d > 0 else (b['high'] >= stop):
            through = (opened < stop) if d > 0 else (opened > stop)
            exit_price, exit_i, reason = (opened if through else stop), j, ('break-even' if stop == entry else 'stop')
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
        if plan['breakEvenAtR'] and stop != entry and (c - entry) * d >= plan['breakEvenAtR'] * risk:
            stop = entry
    if exit_i is None:
        exit_i, exit_price = last, bars[last]['close']
    ret = (exit_price / entry - 1) * d - COSTS
    return {'signal': i, 'fill': fill_i, 'exit': exit_i, 'entry': entry, 'exitPrice': exit_price, 'dir': d, 'ret': ret,
            'r': (exit_price - entry) * d / risk, 'reason': reason, 'bars': exit_i - fill_i + 1}


def trades_for(ind, key, start=210, end=None):
    """Every trade the strategy would have taken (one at a time) on bars start..end-1."""
    s = STRATEGIES[key]
    end = len(ind['bars']) - 1 if end is None else end
    out, i = [], start
    while i < end:
        sig = s['signal'](ind, i)
        plan = sig and s['plan'](ind, i, sig['dir'])
        t = plan and simulate(ind, i, plan, sig['dir'])
        if t:
            out.append(t)
            i = t['exit'] + 1
        else:
            i += 1
    return out


def summarise(trades):
    """Win rate, profit factor, expectancy and a grade: proven (8+ trades, positive expectancy, profit factor 1.2+),
    mixed (4+, positive), failed (4+, losing) or unproven (too few)."""
    n = len(trades)
    wins = [t['ret'] for t in trades if t['ret'] > 0]
    losses = [t['ret'] for t in trades if t['ret'] <= 0]
    gross_win, gross_loss = sum(wins), -sum(losses)
    pf = gross_win / gross_loss if gross_loss else (float('inf') if wins else None)
    exp = sum(t['ret'] for t in trades) / n if n else None
    equity = peak = dd = 0.0
    streak = worst = 0
    for t in trades:
        equity += t['ret']
        peak = max(peak, equity)
        dd = min(dd, equity - peak)
        streak = streak + 1 if t['ret'] <= 0 else 0
        worst = max(worst, streak)
    grade = 'unproven'
    if n >= 8 and exp > 0 and pf is not None and pf >= 1.2:
        grade = 'proven'
    elif n >= 4 and exp > 0:
        grade = 'mixed'
    elif n >= 4:
        grade = 'failed'
    return {'trades': n, 'winRate': len(wins) / n if n else None,
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


def random_walk_test(bars, cot, key, runs=1000, seed=11):
    """Runs the strategy on `runs` shuffled versions of the stock's history. p = share of random histories where it
    made at least as much as on the real one (low p = unlikely to be luck)."""
    actual = sum(t['ret'] for t in trades_for(prepare(bars, cot), key))
    rnd = random.Random(seed)
    better = 0
    for _ in range(runs):
        fake = shuffled_bars(bars, rnd)
        if sum(t['ret'] for t in trades_for(prepare(fake, cot), key)) >= actual:
            better += 1
    p = (better + 1) / (runs + 1)
    return {'runs': runs, 'p': p, 'actual': actual, 'verdict': 'edge' if p <= 0.05 else 'maybe' if p <= 0.2 else 'luck'}


def random_entry_test(trades_by_symbol, closes_by_symbol, opens_by_symbol, runs=1000, seed=7):
    """Pools a strategy's trades across stocks and compares their average return with the same number of trades
    entered on random days (same stocks, same direction, same holding time). p = share of random sets that did at
    least as well."""
    pool = [(sym, t) for sym, ts in trades_by_symbol.items() for t in ts]
    if len(pool) < 10:
        return None
    actual = sum(t['ret'] for _, t in pool) / len(pool)
    rnd = random.Random(seed)
    better = 0
    for _ in range(runs):
        total = 0.0
        for sym, t in pool:
            closes, opens = closes_by_symbol[sym], opens_by_symbol[sym]
            hold = t['bars']
            start = rnd.randrange(210, max(211, len(closes) - hold))
            total += (closes[start + hold - 1] / opens[start] - 1) * t['dir'] - COSTS
        if total / len(pool) >= actual:
            better += 1
    p = (better + 1) / (runs + 1)
    return {'runs': runs, 'p': p, 'actual': actual, 'trades': len(pool), 'verdict': 'edge' if p <= 0.05 else 'maybe' if p <= 0.2 else 'luck'}


def monte_carlo(trades, runs=1000, horizon=20, seed=5):
    """What the next `horizon` trades could look like: `runs` simulations that each draw that many trades at random
    (with replacement) from the past ones and add up their returns. Gives the chance of ending ahead, the typical
    result, a bad case (5th percentile), a good case (95th) and the deepest drop along the way in 1 run of 20."""
    rets = [t['ret'] for t in trades]
    if len(rets) < 5:
        return None
    rnd = random.Random(seed)
    totals, drops = [], []
    for _ in range(runs):
        equity = peak = dd = 0.0
        for _ in range(horizon):
            equity += rets[rnd.randrange(len(rets))]
            peak = max(peak, equity)
            dd = min(dd, equity - peak)
        totals.append(equity)
        drops.append(dd)
    totals.sort()
    drops.sort()

    def at(xs, q):
        return xs[min(len(xs) - 1, int(q * len(xs)))]
    return {'runs': runs, 'horizon': horizon, 'profitable': sum(1 for x in totals if x > 0) / runs,
            'median': at(totals, 0.5), 'bad': at(totals, 0.05), 'good': at(totals, 0.95), 'worstDrop': at(drops, 0.05)}


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
