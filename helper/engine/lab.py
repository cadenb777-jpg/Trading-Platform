"""
The strategy lab: searches combinations of theory-based rules for ones that hold up on data they were not
chosen on, then turns the survivors into live strategies for the scanner.

How it avoids fooling itself (see docs/research/setups-statistics.md):
  1. Building blocks come from market theory, not from the data: short-term reversal (z-score / RSI(2)
     stretches, Williams %R turns), time-series momentum (higher-timeframe trend, 20-bar breakouts), the long-term
     trend (200-bar average), money flow (Williams A/D), hedging pressure (COT) and trend strength / participation
     (ADX, volume). Each trigger keeps the exit its theory implies (reversals exit at the mean, breakouts trail).
  2. Walk-forward: three test windows (55-70%, 70-85%, 85-100% of each stock's history). For each, every combination
     (trigger x up to two filters x buys or sells) is scored only on the data BEFORE it, minus an embargo gap as long
     as the longest holding period (so no trade straddles the line), and the best few by t-statistic go forward.
  3. Each forwarded combination is judged on its pooled unseen-window trades: average trade, a 1,000-run
     random-entry test in those windows (Holm-corrected for everything forwarded), the deflated Sharpe ratio
     (Bailey & Lopez de Prado: corrected for how many combinations were tried) and the probability of backtest
     overfitting (how often the search's in-sample winner lands in the bottom half out of sample).
  4. Survivors (chosen in at least 2 of 3 windows, positive, enough trades, corrected p <= 0.10 on the unseen
     windows, and the search not overfitting) become strategies, graded on that unseen record. The deflated Sharpe
     ratio is reported alongside: with a true holdout the unseen-data test is the decisive one, and in testing the
     deflated Sharpe alone could not tell planted edges from luck. Everything rejected
     goes to the graveyard with its reason. Pure maths: no network.
"""
import itertools
import math
from statistics import NormalDist

from . import strategies as st

# Each trigger comes from a published market idea (named in `theory`); its family decides the exit.
TRIGGERS = {
    'stretch': {'text': 'stretched beyond its usual z-score range and turning back', 'family': 'reversal', 'theory': 'short-term reversal (Lehmann 1990, Jegadeesh 1990)'},
    'rsi2': {'text': 'RSI(2) at an extreme for this stock', 'family': 'reversal', 'theory': 'short-term overreaction'},
    'down3': {'text': 'three bars in a row against the trade, then', 'family': 'reversal', 'theory': 'short-term overreaction (three lower closes)'},
    'gapfade': {'text': 'gapping more than 1 ATR the wrong way and recovering within the bar', 'family': 'reversal', 'theory': 'overreaction to overnight news'},
    'climax': {'text': 'a volume climax (2x volume, 1.5 ATR range) that closes off its extreme', 'family': 'reversal', 'theory': 'capitulation / exhaustion'},
    'willr': {'text': 'Williams %R turning out of oversold/overbought', 'family': 'swing', 'theory': 'swing timing (Larry Williams)'},
    'mapull': {'text': 'pulling back to a rising 20-bar average and holding it', 'family': 'swing', 'theory': 'trend pullback'},
    'breakout': {'text': 'closing beyond the 20-bar range', 'family': 'momentum', 'theory': 'time-series momentum (Donchian, Moskowitz et al. 2012)'},
    'high52': {'text': 'closing at a 52-week (250-bar) extreme', 'family': 'momentum', 'theory': '52-week-high momentum (George & Hwang 2004)'},
    'nr7': {'text': 'the narrowest range of the last 7 bars (breakout from a squeeze)', 'family': 'momentum', 'theory': 'volatility contraction then expansion (Crabel)'},
    'gapgo': {'text': 'gapping half an ATR its way on 1.5x volume and closing strong', 'family': 'momentum', 'theory': 'news momentum / post-gap drift'},
}
FILTERS = {
    'trend': 'with the higher-timeframe trend',
    'above200': 'on the right side of the 200-bar average',
    'flow': 'money flow agreeing (Williams A/D)',
    'cot': 'commercial hedgers agreeing (COT 60+)',
    'adx': 'a trending market (ADX 20+)',
    'volume': 'above-average volume',
    'lowvol': 'a calm market for this stock (volatility below its usual level)',
    'tom': 'the turn of the month (last 2 / first 3 days)',
    'reverting': 'a mean-reverting regime (variance ratio below 0.9)',
    'trending': 'a trending regime (variance ratio above 1.1)',
    'market': 'the Nasdaq-100 trending the same way',
}
TRAIN_SHARE = 0.55  # the first test window starts here
FOLDS = ((0.55, 0.70), (0.70, 0.85), (0.85, 1.0))
TAKE_FORWARD = 6
MIN_FOLDS = 2
MIN_TRAIN_TRADES = 40
MIN_TEST_TRADES = 30


def candidates():
    """Every combination the lab tries: (trigger, filters, side)."""
    out = []
    for trig in TRIGGERS:
        for k in range(3):
            for combo in itertools.combinations(FILTERS, k):
                for d in (1, -1):
                    out.append((trig, combo, d))
    return out


def describe(trig, combo, d):
    side = 'Buy' if d > 0 else 'Sell short'
    rest = f" with {', '.join(FILTERS[f] for f in combo)}" if combo else ''
    return f"{side} when {TRIGGERS[trig]['text']}{rest}"


def short_name(trig, combo, d):
    names = {'stretch': 'Z-stretch', 'rsi2': 'RSI(2)', 'willr': '%R turn', 'breakout': 'Breakout', 'down3': '3-bar dip', 'gapfade': 'Gap fade',
             'climax': 'Volume climax', 'mapull': 'MA pullback', 'high52': '52-week extreme', 'nr7': 'NR7 squeeze', 'gapgo': 'Gap and go'}
    extra = {'trend': 'trend', 'above200': '200', 'flow': 'flow', 'cot': 'COT', 'adx': 'ADX', 'volume': 'vol', 'lowvol': 'calm', 'tom': 'month-turn',
             'reverting': 'reverting', 'trending': 'trending', 'market': 'market'}
    return f"Lab: {names[trig]}{''.join(' + ' + extra[f] for f in combo)} ({'buys' if d > 0 else 'sells'})"


def _extras(ind):
    """Arrays the extra triggers and filters need, computed once per stock."""
    if '_hi250' in ind:
        return
    bars, closes = ind['bars'], ind['closes']
    ind['_hi250'] = st.rolling_max(closes, 250, skip_current=True)
    ind['_lo250'] = st.rolling_min(closes, 250, skip_current=True)
    ind['_rng'] = [b['high'] - b['low'] for b in bars]
    atrpct = [(a / c) if a and c else None for a, c in zip(ind['atr'], closes)]
    ind['_atrmed'] = st.rolling_quantile(atrpct, 250, 0.5)
    ind['_atrpct'] = atrpct
    ind['_dom'] = [st._day(b['time']).day for b in bars]
    ind['_vr'] = variance_ratio(closes)
    mkt = ind.get('_market') or {}
    ind['_mkt'] = [mkt.get(st._day(b['time'])) for b in bars]


def variance_ratio(closes, window=100, q=5):
    """Lo & MacKinlay's variance ratio over the last `window` bars (None before): the variance of q-bar returns over
    q times the variance of 1-bar returns. Below 1 the stock has been mean-reverting, above 1 trending."""
    r = [math.log(closes[i] / closes[i - 1]) if closes[i - 1] > 0 and closes[i] > 0 else 0.0 for i in range(1, len(closes))]
    out = [None] * len(closes)
    for i in range(window + q, len(closes)):
        w = r[i - window: i]
        m1 = sum(w) / window
        v1 = sum((x - m1) ** 2 for x in w) / (window - 1)
        rq = [sum(w[k: k + q]) for k in range(window - q + 1)]
        mq = sum(rq) / len(rq)
        vq = sum((x - mq) ** 2 for x in rq) / (len(rq) - 1)
        out[i] = vq / (q * v1) if v1 > 0 else None
    return out


def _trigger(ind, i, trig, d):
    z, wr = ind['z20'], ind['willr']
    bars, c, atr = ind['bars'], ind['closes'], ind['atr'][i]
    if trig == 'stretch':
        lo, hi = ind['zlo'][i], ind['zhi'][i]
        if not st._ok(z[i], z[i - 1], z[i - 2], lo, hi):
            return False
        return (min(z[i - 2: i + 1]) <= lo and z[i] > z[i - 1]) if d > 0 else (max(z[i - 2: i + 1]) >= hi and z[i] < z[i - 1])
    if trig == 'rsi2':
        r, lo, hi = ind['rsi2'][i], ind['rlo'][i], ind['rhi'][i]
        return st._ok(r, lo, hi) and (r <= lo if d > 0 else r >= hi)
    if trig == 'down3':
        return i >= 3 and all((c[k] < c[k - 1]) if d > 0 else (c[k] > c[k - 1]) for k in (i - 2, i - 1, i))
    if trig == 'gapfade':
        if not atr or i < 1:
            return False
        o, pc = bars[i]['open'], c[i - 1]
        return (o < pc - atr and c[i] > o) if d > 0 else (o > pc + atr and c[i] < o)
    if trig == 'climax':
        v, b = ind['vol20'][i], bars[i]
        if not atr or not v or ind['vols'][i] < 2 * v or ind['_rng'][i] < 1.5 * atr:
            return False
        mid = (b['high'] + b['low']) / 2
        return (b['close'] < b['open'] and c[i] > mid) if d > 0 else (b['close'] > b['open'] and c[i] < mid)
    if trig == 'willr':
        if not st._ok(wr[i], wr[i - 1], wr[i - 2]):
            return False
        return (any(wr[k - 1] <= -80 < wr[k] for k in (i - 1, i)) and wr[i] > -80) if d > 0 else (any(wr[k - 1] >= -20 > wr[k] for k in (i - 1, i)) and wr[i] < -20)
    if trig == 'mapull':
        m, m5 = ind['sma20'][i], ind['sma20'][i - 5] if i >= 5 else None
        if not st._ok(m, m5):
            return False
        b = bars[i]
        return (m > m5 and b['low'] <= m < c[i]) if d > 0 else (m < m5 and b['high'] >= m > c[i])
    if trig == 'high52':
        hi, lo = ind['_hi250'][i], ind['_lo250'][i]
        return st._ok(hi, lo) and (c[i] > hi if d > 0 else c[i] < lo)
    if trig == 'nr7':
        return i >= 7 and ind['_rng'][i] < min(ind['_rng'][i - 6: i]) and ind['_rng'][i] > 0
    if trig == 'gapgo':
        v, b = ind['vol20'][i], bars[i]
        if not atr or not v or i < 1 or ind['vols'][i] < 1.5 * v or ind['_rng'][i] <= 0:
            return False
        pos = (c[i] - b['low']) / ind['_rng'][i]
        return (b['open'] >= c[i - 1] + 0.5 * atr and pos >= 0.7) if d > 0 else (b['open'] <= c[i - 1] - 0.5 * atr and pos <= 0.3)
    hi20, lo20 = ind['hi20'][i], ind['lo20'][i]
    return st._ok(hi20, lo20) and (c[i] > hi20 if d > 0 else c[i] < lo20)


def _filter(ind, i, f, d):
    if f == 'trend':
        return ind['weekly'][i] == d
    if f == 'above200':
        s = ind['sma200'][i]
        return s is not None and (ind['closes'][i] > s if d > 0 else ind['closes'][i] < s)
    if f == 'flow':
        e = ind['wad_ema'][i]
        return e is not None and (ind['wad'][i] >= e if d > 0 else ind['wad'][i] <= e)
    if f == 'cot':
        c = ind['cot'][i]
        return c is not None and (c if d > 0 else 100 - c) >= 60
    if f == 'adx':
        a = ind['adx'][i]
        return a is not None and a >= 20
    if f == 'lowvol':
        a, m = ind['_atrpct'][i], ind['_atrmed'][i]
        return a is not None and m is not None and a < m
    if f == 'tom':
        return ind['_dom'][i] >= 28 or ind['_dom'][i] <= 3
    if f == 'reverting':
        v = ind['_vr'][i]
        return v is not None and v < 0.9
    if f == 'trending':
        v = ind['_vr'][i]
        return v is not None and v > 1.1
    if f == 'market':
        return ind['_mkt'][i] == d
    v = ind['vol20'][i]
    return bool(v) and ind['vols'][i] >= 1.3 * v


def _masks(ind):
    """Which bars each trigger and filter is true on, per side (computed once per stock, so trying hundreds of
    combinations is fast)."""
    if '_masks' in ind:
        return ind['_masks']
    _extras(ind)
    n = len(ind['bars'])
    m = {}
    for d in (1, -1):
        for t in TRIGGERS:
            m[('t', t, d)] = [i for i in range(3, n) if _trigger(ind, i, t, d)]
        for f in FILTERS:
            m[('f', f, d)] = [False] * 3 + [_filter(ind, i, f, d) for i in range(3, n)]
    ind['_masks'] = m
    return m


def make_plan(ind, i, d, trig):
    """The exit each trigger's theory implies, with lengths from the time frame."""
    H = st._h(ind)
    u, a, b, c = H['unit'], ind['atr'][i], ind['bars'][i], ind['closes'][i]
    if not a:
        return None
    if TRIGGERS[trig]['family'] == 'reversal':
        hold = H['maxHold']['mean_reversion']
        return {'entry': 'open', 'trigger': c, 'validDays': 1, 'stop': c - d * 2.5 * a, 'target': ind['sma5'][i], 'maxHold': hold,
                'breakEvenAtR': None, 'exit': 'sma5', 'targetNote': f'the 5-{u} average (a close back across it)',
                'exitRule': f"Enter at the next {u}'s open. Exit at the first close {'above' if d > 0 else 'below'} the 5-{u} average, at the 2.5 ATR stop, or after {hold} {u}s."}
    if TRIGGERS[trig]['family'] == 'swing':
        hold = H['maxHold']['weekly_swing']
        trigger = b['high'] if d > 0 else b['low']
        target = (ind['sma20'][i] or c) + d * (ind['sd20'][i] or a)
        if (target - trigger) * d < 0.5 * a:
            return None
        return {'entry': 'stop', 'trigger': trigger, 'validDays': H['valid']['weekly_swing'], 'stop': trigger - d * 1.5 * a, 'target': target,
                'maxHold': hold, 'breakEvenAtR': 1.0, 'exit': None, 'targetNote': f'1 standard deviation past the 20-{u} average',
                'exitRule': f"Take profit at the target, exit at the stop, or after {hold} {u}s; move the stop to break-even once up by the risk."}
    hold = H['maxHold']['breakout']
    trigger = b['high'] if d > 0 else b['low']
    return {'entry': 'stop', 'trigger': trigger, 'validDays': H['valid']['breakout'], 'stop': trigger - d * 2.0 * a, 'target': None,
            'maxHold': hold, 'breakEvenAtR': None, 'exit': 'donchian10', 'targetNote': f'no fixed target: the stop trails at the 10-{u} {"low" if d > 0 else "high"}',
            'exitRule': f"Enter on a break of the signal {u}'s {'high' if d > 0 else 'low'}; exit on a close beyond the 10-{u} {'low' if d > 0 else 'high'}, at the 2 ATR stop, or after {hold} {u}s."}


def signal_fn(trig, combo, d):
    def signal(ind, i):
        _extras(ind)
        if i < 3 or not _trigger(ind, i, trig, d) or not all(_filter(ind, i, f, d) for f in combo):
            return None
        return {'dir': d, 'reasons': [f"{TRIGGERS[trig]['text'].capitalize()}"] + [FILTERS[f].capitalize() for f in combo]}
    return signal


def _trades(ind, cand, start, end):
    """Non-overlapping trades for one candidate with signals on bars start..end-1."""
    trig, combo, d = cand
    m = _masks(ind)
    filters = [m[('f', f, d)] for f in combo]
    out, free_from = [], start
    for i in m[('t', trig, d)]:
        if i < free_from or i >= end:
            if i >= end:
                break
            continue
        if all(f[i] for f in filters):
            # The trade from a trigger on a bar is the same whatever the filters: simulate it once per stock.
            sims = ind.setdefault('_sims', {})
            key = (trig, d, i)
            if key not in sims:
                plan = make_plan(ind, i, d, trig)
                sims[key] = plan and st.simulate(ind, i, plan, d)
            t = sims[key]
            if t:
                out.append(t)
                free_from = t['exit'] + 1
    return out


def holm(pvalues):
    """Holm step-down adjusted p-values."""
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    out, running, m = [1.0] * len(pvalues), 0.0, len(pvalues)
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * pvalues[i]))
        out[i] = running
    return out


def deflated_sharpe(rets, trials, sr_variance):
    """Bailey & Lopez de Prado's deflated Sharpe ratio: the probability that the true per-trade Sharpe ratio is
    above zero after allowing for having tried `trials` combinations (whose Sharpe ratios vary by `sr_variance`),
    for skewed and fat-tailed returns. Close to 1 = convincing; below ~0.8 = could be the luck of the search."""
    n = len(rets)
    if n < 10 or trials < 2:
        return None
    m = sum(rets) / n
    sd = (sum((x - m) ** 2 for x in rets) / (n - 1)) ** 0.5
    if not sd:
        return None
    sr = m / sd
    skew = sum(((x - m) / sd) ** 3 for x in rets) / n
    kurt = sum(((x - m) / sd) ** 4 for x in rets) / n
    nd, euler = NormalDist(), 0.5772156649
    sr0 = (max(sr_variance, 0.0) ** 0.5) * ((1 - euler) * nd.inv_cdf(1 - 1 / trials) + euler * nd.inv_cdf(1 - 1 / (trials * math.e)))
    denom = 1 - skew * sr + (kurt - 1) / 4 * sr * sr
    if denom <= 0:
        return None
    return nd.cdf((sr - sr0) * math.sqrt(n - 1) / math.sqrt(denom))


def run(inds, market=None):
    """The full walk-forward search on prepared indicator sets {symbol: ind} of one time frame. `market` maps a date
    to the Nasdaq-100's trend (+1/-1) for the market filter."""
    for ind in inds.values():
        ind['_market'] = market or {}
        ind.pop('_hi250', None)  # recompute extras with the market data
        ind.pop('_masks', None)
    cands = candidates()
    any_ind = next(iter(inds.values()), None)
    embargo = (max(st._h(any_ind)['maxHold'].values()) + 1) if any_ind else 20
    lens = {sym: len(ind['bars']) for sym, ind in inds.items()}
    forwarded = {}  # cand -> {'folds': n, 'trades': {sym: [...]}}
    pbo_hits, folds_run, trials, sr_by_cand = 0, 0, set(), {}
    for lo, hi in FOLDS:
        is_scores, oos_avg = [], {}
        for cand in cands:
            train = [t for sym, ind in inds.items() for t in _trades(ind, cand, 210, int(lo * lens[sym]) - embargo)]
            s = st.summarise(train)
            if s['trades'] >= MIN_TRAIN_TRADES:  # counts as a trial for the deflated Sharpe ratio
                trials.add(cand)
                rets = [t['ret'] for t in train]
                m = sum(rets) / len(rets)
                sd = (sum((x - m) ** 2 for x in rets) / (len(rets) - 1)) ** 0.5
                if sd:
                    sr_by_cand[cand] = m / sd
            if s['trades'] >= MIN_TRAIN_TRADES and (s['expectancy'] or 0) > 0 and s['tStat']:
                is_scores.append((s['tStat'], cand))
            test = [t for sym, ind in inds.items() for t in _trades(ind, cand, int(lo * lens[sym]), min(int(hi * lens[sym]), lens[sym] - 1))]
            if len(test) >= 10:
                oos_avg[cand] = sum(t['ret'] for t in test) / len(test)
        is_scores.sort(key=lambda x: -x[0])
        if not is_scores:
            continue
        folds_run += 1
        # Probability of backtest overfitting: does the in-sample winner land in the bottom half out of sample?
        best = is_scores[0][1]
        if best in oos_avg and len(oos_avg) >= 4:
            ranked = sorted(oos_avg.values())
            pbo_hits += 1 if ranked.index(oos_avg[best]) < len(ranked) / 2 else 0
        for _, cand in is_scores[:TAKE_FORWARD]:
            rec = forwarded.setdefault(cand, {'folds': 0, 'trades': {}})
            rec['folds'] += 1
            for sym, ind in inds.items():
                ts = _trades(ind, cand, int(lo * lens[sym]), min(int(hi * lens[sym]), lens[sym] - 1))
                rec['trades'].setdefault(sym, []).extend(ts)
    pbo = pbo_hits / folds_run if folds_run else None
    # Effective number of tries for the deflated Sharpe ratio: combinations that share a trigger and side are near
    # copies of each other, so each (trigger, side) family counts once (clustering, as Lopez de Prado recommends),
    # and the spread of Sharpe ratios is measured between families.
    families = {}
    for cand, sr in sr_by_cand.items():
        families.setdefault((cand[0], cand[2]), []).append(sr)
    fam_sr = [sum(v) / len(v) for v in families.values()]
    eff_trials = max(2, len(fam_sr))
    sr_var = (sum((x - sum(fam_sr) / len(fam_sr)) ** 2 for x in fam_sr) / (len(fam_sr) - 1)) if len(fam_sr) > 1 else 0.0
    results = []
    for cand, rec in forwarded.items():
        by_sym, closes, opens = {}, {}, {}
        for sym, ind in inds.items():
            base = int(FOLDS[0][0] * lens[sym]) - 210  # random entries fall in the unseen windows
            by_sym[sym] = [{**t, 'signal': t['signal'] - base} for t in rec['trades'].get(sym, [])]
            closes[sym] = ind['closes'][base:]
            opens[sym] = [b['open'] for b in ind['bars'][base:]]
        pooled = [t for ts in by_sym.values() for t in ts]
        s_test = st.summarise(pooled)
        re = st.random_entry_test(by_sym, closes, opens) if s_test['trades'] >= 10 else None
        full_train = [t for sym, ind in inds.items() for t in _trades(ind, cand, 210, int(FOLDS[-1][0] * lens[sym]) - embargo)]
        dsr = deflated_sharpe([t['ret'] for t in full_train], eff_trials, sr_var)  # on the record it was chosen on
        results.append({'cand': cand, 'folds': rec['folds'], 'train': st.summarise(full_train), 'test': s_test, 'p': re['p'] if re else 1.0, 'dsr': dsr})
    results.sort(key=lambda r: (-r['folds'], -(r['test']['tStat'] or -9)))
    adj = holm([r['p'] for r in results]) if results else []
    overfit = pbo is not None and pbo > 0.5
    out = []
    for r, pa in zip(results, adj):
        trig, combo, d = r['cand']
        reasons = []
        if r['folds'] < MIN_FOLDS:
            reasons.append(f"chosen in only {r['folds']} of {len(FOLDS)} windows")
        if (r['test']['expectancy'] or 0) <= 0:
            reasons.append('lost money on unseen data')
        if r['test']['trades'] < MIN_TEST_TRADES:
            reasons.append(f"too few unseen trades ({r['test']['trades']})")
        if pa > 0.10:
            reasons.append(f'not better than random entries (corrected p {pa:.2f})')
        if overfit:
            reasons.append('the search as a whole looks overfit (PBO above 50%)')
        out.append({'id': f"{trig}|{'+'.join(combo)}|{d}", 'trigger': trig, 'filters': list(combo), 'direction': d, 'theory': TRIGGERS[trig]['theory'],
                    'name': short_name(trig, combo, d), 'description': describe(trig, combo, d), 'folds': r['folds'],
                    'train': {k: r['train'][k] for k in ('trades', 'winRate', 'expectancy', 'profitFactor', 'tStat')},
                    'test': {k: r['test'][k] for k in ('trades', 'winRate', 'expectancy', 'profitFactor', 'tStat')},
                    'p': r['p'], 'pAdjusted': pa, 'dsr': r['dsr'], 'validated': not reasons, 'rejected': reasons})
    return {'tried': len(cands), 'trials': len(trials), 'effectiveTrials': eff_trials, 'folds': len(FOLDS), 'foldsRun': folds_run, 'embargo': embargo, 'trainShare': TRAIN_SHARE,
            'forward': len(forwarded), 'pbo': pbo, 'results': out[:12], 'validated': sum(1 for x in out if x['validated'])}


def register(horizon, lab_result):
    """Turns validated lab strategies into scanner strategies for one time frame (replacing yesterday's)."""
    for key in [k for k, v in st.STRATEGIES.items() if v.get('lab') and v.get('horizon_only') == horizon]:
        del st.STRATEGIES[key]
    keys = []
    for n, r in enumerate(x for x in lab_result['results'] if x['validated']):
        trig, combo, d = r['trigger'], tuple(r['filters']), r['direction']
        key = f"lab_{horizon}_{n}"
        st.STRATEGIES[key] = {'name': r['name'], 'short': r['name'], 'horizon': st.HORIZONS[horizon]['hold'], 'lab': True,
                              'horizon_only': horizon, 'oos_from': TRAIN_SHARE, 'description': r['description'],
                              'signal': signal_fn(trig, combo, d), 'plan': (lambda trig: lambda ind, i, dd: make_plan(ind, i, dd, trig))(trig)}
        keys.append(key)
    return keys
