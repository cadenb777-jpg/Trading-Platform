"""
Rule tests: settles each "which version of this rule?" question by test, on whatever data it is given.

The helper runs it once a week per time frame on your own Schwab/Alpaca history (scanner._run_rule_tests) and saves
the report to ~/.trading-platform/rule_tests.json; the Setups page shows it as "on your real data". The same code
ran on synthetic data for docs/research/setups-v21-results.md ("on synthetic data"). The production rules in
strategies.SPEC are fixed: this report says whether your data agrees, it never switches rules by itself (choosing
rules on the data that then grades them would be fooling ourselves).

Each question lists its versions simplest first. A version "survives" when its pooled trades make money after
costs AND beat random entries (clustered random-entry test, p <= 0.10). The simplest survivor wins; when nothing
survives, the simplest version is kept, because an extra rule only earns its place by passing a test the simpler
one fails. Pure maths: no network.
"""
from . import strategies as st

RUNS = 200  # random-entry runs per version (p resolution 0.005: plenty to tell 0.05 from 0.10 and 0.20)
SIDES = (('long', 1), ('short', -1))


def _record(inds, strat, side, runs, cluster, series):
    by_sym = {sym: [t for t in st.trades_for(ind, strat) if t['dir'] == side] for sym, ind in inds.items()}
    pooled = [t for ts in by_sym.values() for t in ts]
    s = st.summarise(pooled, cluster)
    re = st.random_entry_test(by_sym, series, runs=runs) if len(pooled) >= 10 else None
    p = re['p'] if re else None
    return {'trades': s['trades'], 'effectiveTrades': s['effectiveTrades'], 'expectancy': s['expectancy'], 'profitFactor': s['profitFactor'],
            'tStat': s['tStat'], 'avgR': s['avgR'], 'p': p, 'excess': re['excess'] if re else None, 'survives': bool(p is not None and p <= 0.10 and (s['expectancy'] or 0) > 0)}


def _question(title, versions, inds, side_list, runs, cluster, series, note=''):
    """versions: [(id, label, strategy dict)] simplest first. Returns rows per side and the winner per side."""
    out = {'title': title, 'note': note, 'sides': {}}
    for side_name, d in side_list:
        rows = []
        for vid, label, strat in versions:
            if d not in strat['sides']:
                continue
            rows.append({'id': vid, 'label': label, **_record(inds, strat, d, runs, cluster, series)})
        if not rows:
            continue
        win = next((r for r in rows if r['survives']), None)
        out['sides'][side_name] = {'rows': rows, 'winner': (win or _as_good(rows))['id'], 'anySurvives': win is not None}
    return out


def _se(r):
    return abs(r['expectancy'] / r['tStat']) if r['tStat'] and r['expectancy'] is not None else None


def _as_good(rows):
    """When nothing survives: the simplest version whose excess over random entries (its average trade minus the
    average random entry with the same stocks, sides and holding times, so drift and longer holds don't count) is
    within one standard error of the best one. A rule that loses money even on random data doesn't win just by being
    short, and one that only rides the market's drift doesn't win by holding longer."""
    traded = [r for r in rows if r['trades'] >= 10 and r.get('excess') is not None]
    if not traded:
        return rows[0]
    best = max(traded, key=lambda r: r['excess'])
    for r in rows:
        if r not in traded:
            continue
        sb, sr = _se(best), _se(r)
        if r is best or (sb is not None and sr is not None and best['excess'] - r['excess'] <= (sb * sb + sr * sr) ** 0.5):
            return r
    return best


def _pick(question, fallback):
    """The chain uses the buy side's winner (most Nasdaq-100 trades are buys; sells mostly fight the upward drift)."""
    side = question['sides'].get('long') or next(iter(question['sides'].values()), None)
    return side['winner'] if side else fallback


def run(inds, horizon='swing', regimes=None, cot_rows=None, runs=RUNS, spec=None):
    """The full set of rule questions for one time frame. `inds` = {symbol: strategies.prepare(...)}; `regimes` =
    strategies.market_regimes(QQQ bars) for the report-only regime split; `cot_rows` = COT report rows for the
    Nasdaq-100 futures (oldest first). Returns a JSON-ready report."""
    spec = {k: dict(v) for k, v in (spec or st.SPEC).items()}
    production = {k: dict(v) for k, v in st.SPEC.items()}
    H = st.HORIZONS[horizon]
    cluster = H['cluster']
    series = {sym: st.series_of(ind['bars']) for sym, ind in inds.items()}
    mk = st.make_strategy
    report = {'horizon': horizon, 'stocks': len(inds), 'bars': max((len(i['bars']) for i in inds.values()), default=0), 'runs': runs, 'questions': {}}
    q = report['questions']
    ask = lambda title, versions, sides=SIDES, note='': _question(title, versions, inds, sides, runs, cluster, series, note)  # noqa: E731
    trend_versions = [('none', 'no trend filter'), ('ma200', '200-day average'), ('htf10', '10-bar higher time frame'), ('htf10band', '10-bar higher time frame +/- 0.5 ATR')]

    def trend_questions(key, title, sides):
        q[f'trend_{key}'] = ask(f'{title}: which trend filter?', [(rule, label, mk(key, {**spec[key], 'trend': rule})) for rule, label in trend_versions],
                                sides, 'Simplest first: no filter, then one long average, then the shorter higher-time-frame rules.')
        q[f'plateau_{key}'] = ask(f'{title}: is the 200-day result a plateau?', [(rule, label, mk(key, {**spec[key], 'trend': rule})) for rule, label in (('ma150', '150-day'), ('ma200', '200-day'), ('ma250', '250-day'))],
                                  sides, 'Shown only to see whether neighbours behave alike; never used to pick the length.')
        spec[key]['trend'] = _pick(q[f'trend_{key}'], spec[key]['trend'])

    # Each answer feeds the next question (the buy side's winner), in this order.
    ws = spec['weekly_swing']
    q['turn'] = ask('Pullback: how is the turn confirmed?', [
        ('buystop', 'z-stretch + buy-stop only', mk('weekly_swing', {**ws, 'turn': 'buystop', 'trend': 'htf10'})),
        ('zturn', 'z-stretch + z-score turning', mk('weekly_swing', {**ws, 'turn': 'zturn', 'trend': 'htf10'})),
        ('willr', 'z-stretch + Williams %R cross', mk('weekly_swing', {**ws, 'turn': 'willr', 'trend': 'htf10'})),
        ('current', 'v20 stack: z turn + %R + A/D vs average + COT 60+', mk('weekly_swing', {**ws, 'turn': 'current', 'trend': 'htf10'})),
    ], note='All with the v20 trend filter (10-bar higher time frame), so only the turn rule differs.')
    ws['turn'] = _pick(q['turn'], ws['turn'])
    trend_questions('weekly_swing', 'Pullback', SIDES)
    q['pullback_exit'] = ask('Pullback: take profit at +1 SD, or trail after +1R?', [
        ('target', '+1 SD target, break-even at +1R, time exit', mk('weekly_swing', {**ws, 'exit': 'target'})),
        ('trail', 'after +1R, chandelier trail (no target)', mk('weekly_swing', {**ws, 'exit': 'trail'})),
    ], note='Same entries; only the exit differs. The target version counts as simplest (it is what v20 does).')
    ws['exit'] = _pick(q['pullback_exit'], ws['exit'])

    q['mean_reversion'] = ask('Mean reversion: one stretch measure or two?', [
        ('z', 'z-score only', mk('mean_reversion', {**spec['mean_reversion'], 'stretch': 'z'})),
        ('both', 'z-score and RSI(2) (v20)', mk('mean_reversion', {**spec['mean_reversion'], 'stretch': 'both'})),
    ])
    spec['mean_reversion']['stretch'] = _pick(q['mean_reversion'], spec['mean_reversion']['stretch'])
    trend_questions('mean_reversion', 'Mean reversion', SIDES)

    q['breakout'] = ask('Breakout: which rule?', [
        ('high250', '52-week high, chandelier trail', mk('breakout', {**spec['breakout'], 'kind': 'high250'})),
        ('high50', '50-day high, chandelier trail', mk('breakout', {**spec['breakout'], 'kind': 'high50'})),
        ('old', 'v20: 20-bar Donchian + weekly trend + 50-bar average + ADX + volume, 10-bar trail', mk('breakout', {'kind': 'old'})),
    ], note='Shorts exist only in the v20 rule; the new rule buys only.')
    kind = _pick(q['breakout'], spec['breakout']['kind'])
    spec['breakout']['kind'] = kind if kind != 'old' else spec['breakout']['kind']
    trend_questions('breakout', 'Breakout', SIDES[:1])
    report['chosen'] = spec
    report['production'] = production
    report['agrees'] = all(spec[k].get(f) == production[k].get(f) for k in production for f in production[k])

    # Robustness and regimes of the production rules, per side.
    rob, reg = {}, {}
    for key in ('weekly_swing', 'mean_reversion', 'breakout'):
        strat = mk(key, production[key])
        for side_name, d in SIDES:
            if d not in strat['sides']:
                continue
            rob[f'{key}:{side_name}'] = st.robustness(inds, strat, cluster, d)
            if regimes:
                trades = [t for ind in inds.values() for t in st.trades_for(ind, strat) if t['dir'] == d]
                reg[f'{key}:{side_name}'] = {w: st.regime_split(trades, regimes, w, runs=1000) for w in ('trend', 'vol')}
    report['robustness'] = rob
    report['regimes'] = reg

    if cot_rows:
        events = [e for ind in inds.values() for e in st.cot_z_events(ind, H['maxHold']['weekly_swing'])]
        report['cot'] = st.cot_study(events, cot_rows, runs=1000)
    return report


def summary_lines(report):
    """One line per question: the winner on each side (for logs and the results doc)."""
    lines = []
    for qid, qq in report['questions'].items():
        for side, s in qq['sides'].items():
            lines.append(f"{report['horizon']:8} {qid:26} {side:5} winner={s['winner']:10} " + ' | '.join(
                f"{r['id']}: n={r['trades']} eff={r['effectiveTrades']} avg={(r['expectancy'] or 0) * 100:+.3f}% p={r['p'] if r['p'] is not None else '-'}" for r in s['rows']))
    return lines
