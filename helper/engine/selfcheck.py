"""
The platform's self-check: every 30 minutes the helper checks itself and keeps the results, so problems are found
before they mislead you (and the improvement sessions have something real to work from).

Four areas, each check answering ok / problem / skipped with one plain sentence:
  security  the helper only listens on this computer and only lets your platform pages in; key files are private
  data      every data source answers and isn't failing; quotes are fresh while the market is open; this computer's
            clock is right (every chart time and "updated" stamp depends on it)
  accuracy  the maths gives known answers (moving averages, RSI, returns, drawdown); SPY's price agrees across sources;
            SPY's daily history is clean (in order, no impossible prices, no data-error jumps, up to date)
  speed     replies to the platform come back quickly
The clock and bad-data checks follow what professional market-data systems monitor (feed time vs exchange time,
out-of-sequence and outlier ticks, stale series), in this platform's own words.

Results: ~/.trading-platform/selfcheck.json (the last 48 runs, so a day). Requests (read-only):
  selfcheck.latest   the newest run (runs one now if there is none yet)
  selfcheck.run      runs the checks now
Nothing here changes anything: it only reads and reports. It never trades.
"""
import asyncio
import datetime as dt
import json
import os
import statistics
import time
from pathlib import Path
from zoneinfo import ZoneInfo

from .core import DAILY_FIXES, handler

EVERY = 30 * 60
KEEP = 48
FILE = Path.home() / '.trading-platform' / 'selfcheck.json'
NEW_YORK = ZoneInfo('America/New_York')
#: what the helper's start registers (host, allowed origins, its data folder and key files)
HELPER = {}
#: the platform's own addresses (the published site and this computer's private copy / development)
OK_ORIGINS = ('https://cadenb777-jpg.github.io', 'http://localhost:', 'http://127.0.0.1:')


def result(check_id, area, ok, detail):
    return {'id': check_id, 'area': area, 'ok': ok, 'detail': detail}


# ---------- pure checks (tested) ----------

def check_listening(host):
    ok = host in ('127.0.0.1', 'localhost', '::1')
    return result('local-only', 'security', ok, 'The helper only answers this computer.' if ok else
                  f'The helper listens on {host}: other computers could reach it. It must be 127.0.0.1.')


def check_origins(origins):
    bad = [o for o in origins or [] if not o.startswith(OK_ORIGINS)]
    return result('origins', 'security', not bad, 'Only your platform pages may connect.' if not bad else
                  f'Unexpected pages may connect: {", ".join(bad)}.')


def check_private_files(paths, posix=None):
    """Key, login and settings files readable by you only (POSIX permission bits; Windows keeps them in your user
    folder, which other users can't open)."""
    posix = (os.name != 'nt') if posix is None else posix
    if not posix:
        return result('private-files', 'security', None, 'Windows: your keys are in your user folder, which only you can open.')
    open_to_others = []
    for p in paths:
        try:
            if Path(p).stat().st_mode & 0o077:
                open_to_others.append(Path(p).name)
        except OSError:
            continue
    return result('private-files', 'security', not open_to_others, 'Key and settings files are readable by you only.' if not open_to_others
                  else f'Readable by other users: {", ".join(open_to_others)}. Restart the helper (it locks them).')


def check_sources(snapshot, min_calls=5, max_fail=0.3):
    """Each data source that was used enough isn't failing most of the time."""
    failing = []
    for s in snapshot or []:
        calls = s.get('calls') or 0
        if calls >= min_calls and (s.get('failed') or 0) / calls > max_fail:
            failing.append(f"{s.get('label', s.get('source'))} ({s.get('failed')} of {calls} failed)")
    return result('sources', 'data', not failing, 'Every data source in use is answering.' if not failing else
                  'Failing often: ' + '; '.join(failing) + '.')


def market_open(now=None):
    t = (now or dt.datetime.now(NEW_YORK)).astimezone(NEW_YORK)
    return t.weekday() < 5 and dt.time(9, 35) <= t.time() <= dt.time(15, 55)


def check_quotes_fresh(schwab, now_ts=None, now=None, max_age=180):
    if not market_open(now):
        return result('quotes-fresh', 'data', None, 'Market closed: quote freshness is checked during the session.')
    last = (schwab or {}).get('lastOk')
    age = None if not last else (now_ts or time.time()) - last
    ok = age is not None and age <= max_age
    return result('quotes-fresh', 'data', ok, f'Schwab data is {round(age)} s old.' if ok else
                  ('No Schwab data yet this session.' if age is None else f'Schwab data is {round(age / 60)} minutes old (Schwab login or connection).'))


def check_maths():
    """Known answers for the maths the platform shows (strategies.py and quant.py)."""
    from . import strategies
    problems = []
    if strategies.sma([1, 2, 3, 4, 5], 3)[-1] != 4:
        problems.append('moving average')
    if abs(strategies.ema([10.0] * 30, 9)[-1] - 10) > 1e-9:
        problems.append('exponential average')
    rising = [100 + i for i in range(30)]
    falling = [100 - i for i in range(30)]
    if strategies.rsi(rising)[-1] != 100 or strategies.rsi(falling)[-1] != 0:
        problems.append('RSI')
    try:
        import numpy as np
        from . import quant
        # 10% in exactly one year (365.25 days) annualises to 10%
        r = np.full(366, 0.0)
        r[0] = 0.10
        if abs(quant.annualised(r, 365.25) - 0.10) > 1e-9:
            problems.append('annualised return')
        dates = [dt.date(2024, 1, 1) + dt.timedelta(days=i) for i in range(4)]
        dd, _ = quant.max_drawdown(np.array([0.10, -0.50, 0.20]), dates)
        if abs(dd['maxDrawdown'] + 0.50) > 1e-9:
            problems.append('drawdown')
    except ImportError:
        pass  # the maths parts aren't installed: the rest is still checked
    return result('maths', 'accuracy', not problems, 'Averages, RSI, returns and drawdown give the known answers.' if not problems
                  else 'Wrong answers from: ' + ', '.join(problems) + '. Do not trust these figures until fixed.')


def check_crosscheck(reply):
    """SPY's last price from Schwab, Nasdaq and Yahoo (crosscheck.gather): at least two agree."""
    if not reply:
        return result('price-agrees', 'accuracy', None, 'Price cross-check not run.')
    agreeing = reply.get('agreeing') or 0
    ok = agreeing >= 2
    spread = reply.get('spread')
    tail = f' (spread {spread * 100:.2f}%)' if isinstance(spread, (int, float)) else ''
    return result('price-agrees', 'accuracy', ok, f'SPY: {agreeing} sources agree{tail}.' if ok else
                  f'SPY: sources disagree or only one answered{tail}: {reply.get("message", "")}'.strip())


def check_clock(server_time, local_time=None, limit=10):
    """This computer's clock against a web server's (the HTTP Date header, accurate to a second)."""
    if server_time is None:
        return result('clock', 'data', None, 'Clock not checked (no internet answer).')
    drift = (local_time if local_time is not None else time.time()) - server_time
    ok = abs(drift) <= limit
    word = 'fast' if drift > 0 else 'slow'
    return result('clock', 'data', ok, f'This computer’s clock is right (within {max(1, round(abs(drift)))} s).' if ok else
                  f'This computer’s clock is {round(abs(drift))} s {word}: chart times and "updated" stamps will be off. '
                  'Windows: Settings → Time & language → Sync now.')


def check_bars(rows, symbol='SPY', now_ts=None, max_jump=0.25, max_age_days=5, fixed=0):
    """Daily closes [[unix seconds, close], ...]: in order, positive, no one-day jump bigger than a broad index can
    make (a data error, e.g. an unadjusted split), and up to date."""
    if not rows:
        return result('history-clean', 'accuracy', None, f'{symbol} daily history not available to check.')
    problems = []
    times = [r[0] for r in rows]
    bad = next((b for a, b in zip(times, times[1:]) if b <= a), None)
    if bad is not None:
        problems.append(f'days out of order or repeated (first at {dt.datetime.fromtimestamp(bad, dt.timezone.utc).date()})')
    if any(not (isinstance(r[1], (int, float)) and r[1] > 0) for r in rows):
        problems.append('a zero or negative price')
    jumps = [(rows[i][0], rows[i][1] / rows[i - 1][1] - 1) for i in range(1, len(rows))
             if rows[i - 1][1] and abs(rows[i][1] / rows[i - 1][1] - 1) > max_jump]
    if jumps:
        day = dt.datetime.fromtimestamp(jumps[0][0], dt.timezone.utc).date()
        problems.append(f'a {jumps[0][1] * 100:+.0f}% one-day move on {day} (a data error)')
    age = ((now_ts or time.time()) - times[-1]) / 86400
    if age > max_age_days:
        problems.append(f'the newest day is {int(age)} days old')
    # Days the helper had to put in order or drop (Schwab's own list) are fixed, but worth knowing about
    tidied = f' Schwab’s list had {fixed} repeated or out-of-order day{"s" if fixed != 1 else ""}; the helper fixed it.' if fixed else ''
    return result('history-clean', 'accuracy', not problems, f'{symbol} daily history is clean ({len(rows)} days, in order, no bad prices).{tidied}'
                  if not problems else f'{symbol} daily history: ' + '; '.join(problems) + '.')


def check_speed(requests, now_ts=None, window=EVERY, limit_ms=3000):
    now_ts = now_ts or time.time()
    recent = [r['ms'] for r in requests or [] if r.get('ok') and now_ts - r.get('at', 0) <= window and r.get('type') != 'ai.chat']
    if len(recent) < 5:
        return result('speed', 'speed', None, 'Too few replies in the last half hour to judge speed.')
    p95 = sorted(recent)[int(len(recent) * 0.95) - 1]
    median = statistics.median(recent)
    ok = p95 <= limit_ms
    return result('speed', 'speed', ok, f'Replies: typical {round(median)} ms, slowest 5% within {round(p95)} ms.' if ok else
                  f'Slow replies: the slowest 5% take {round(p95 / 1000, 1)} s (typical {round(median)} ms).')


def summary(checks):
    problems = [c for c in checks if c['ok'] is False]
    return {'ok': not problems, 'problems': len(problems), 'checked': sum(c['ok'] is not None for c in checks)}


# ---------- running ----------

async def run(ctx):
    from . import datahub, diagnostics
    checks = [
        check_listening(HELPER.get('host', '127.0.0.1')),
        check_origins(HELPER.get('origins', [])),
        check_private_files(HELPER.get('files', [])),
    ]
    snap = datahub.snapshot()
    sources = snap.get('sources') if isinstance(snap, dict) else snap
    checks.append(check_sources(sources))
    schwab = next((s for s in sources or [] if s.get('source') == 'schwab'), None)
    checks.append(check_quotes_fresh(schwab))
    checks.append(await asyncio.to_thread(check_maths))
    try:
        from . import crosscheck
        reply = await asyncio.wait_for(crosscheck.gather(ctx, 'last', 'SPY'), 60)
    except Exception as err:  # a source down is reported by the sources check; this one just says it didn't run
        reply = None
        checks.append(result('price-agrees', 'accuracy', None, f'Price cross-check couldn’t run: {err}'))
    if reply is not None:
        checks.append(check_crosscheck(reply))
    checks.append(await _clock(ctx))
    try:
        from . import invest
        rows = await asyncio.wait_for(invest.closes(ctx, 'SPY'), 60)
        checks.append(check_bars(rows, fixed=DAILY_FIXES.get('SPY', 0)))
    except Exception as err:
        checks.append(result('history-clean', 'accuracy', None, f'SPY daily history couldn’t be read: {err}'))
    checks.append(check_speed(list(diagnostics.REQUESTS)))
    run_ = {'at': time.time(), **summary(checks), 'checks': checks}
    save(run_)
    return run_


async def _clock(ctx):
    from email.utils import parsedate_to_datetime
    try:
        sent = time.time()
        response = await asyncio.wait_for(ctx.http.head('https://www.google.com/generate_204'), 15)
        local = (sent + time.time()) / 2  # the middle of the round trip
        server = parsedate_to_datetime(response.headers['date']).timestamp()
    except Exception:
        return check_clock(None)
    return check_clock(server, local)


def history(path=FILE):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save(run_, path=FILE):
    runs = (history(path) + [run_])[-KEEP:]
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(runs), encoding='utf-8')
    os.replace(tmp, path)


async def loop(ctx):
    """Runs the checks a minute after start, then every 30 minutes."""
    await asyncio.sleep(60)
    while True:
        try:
            await run(ctx)
        except Exception:  # the self-check must never take the helper down
            import logging
            logging.getLogger('engine.selfcheck').exception('Self-check failed to run')
        await asyncio.sleep(EVERY)


def _diagnostics_section():
    runs = history()
    return runs[-1] if runs else None


try:  # the newest self-check goes into the diagnostics file (Send diagnostics)
    from . import diagnostics as _diagnostics
    _diagnostics.SECTIONS['selfcheck'] = _diagnostics_section
except ImportError:
    pass


@handler('selfcheck.latest')
async def latest(ctx, msg):
    runs = history()
    return runs[-1] if runs else await run(ctx)


@handler('selfcheck.run')
async def run_now(ctx, msg):
    return await run(ctx)
