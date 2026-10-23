"""
Actual numbers for US economic releases. Forex Factory's free feed gives the forecast and previous value but
never the actual, so after a release we read the official figure from FRED (St. Louis Fed, free) and format it
like the feed's own numbers.

A figure is only used when FRED already has the reading for the period that release covers (for example CPI
released in October covers September). Until FRED updates, the actual stays blank: nothing is guessed.
Standard library only, so it can be tested without the helper's packages.
"""
import datetime as dt

# Forex Factory title (lower case) -> (FRED series, transform, scale, unit, period)
#   transform: 'mom' % change from the prior month, 'yoy' % change from a year ago, 'diff' change from the prior
#              reading, 'level' the reading itself
#   period: 'm1' / 'm2' the month 1 or 2 before the release month, 'm0' the release month, 'q' the last
#           completed quarter, 'w1' / 'w2' the week ending the Saturday 1 or 2 weeks before
RELEASES = {
    'cpi m/m': ('CPIAUCSL', 'mom', 1, '%', 'm1'),
    'cpi y/y': ('CPIAUCNS', 'yoy', 1, '%', 'm1'),
    'core cpi m/m': ('CPILFESL', 'mom', 1, '%', 'm1'),
    'core cpi y/y': ('CPILFENS', 'yoy', 1, '%', 'm1'),
    'non-farm employment change': ('PAYEMS', 'diff', 1, 'K', 'm1'),
    'unemployment rate': ('UNRATE', 'level', 1, '%', 'm1'),
    'average hourly earnings m/m': ('CES0500000003', 'mom', 1, '%', 'm1'),
    'retail sales m/m': ('RSAFS', 'mom', 1, '%', 'm1'),
    'core retail sales m/m': ('RSFSXMV', 'mom', 1, '%', 'm1'),
    'ppi m/m': ('PPIFIS', 'mom', 1, '%', 'm1'),
    'core ppi m/m': ('PPIFES', 'mom', 1, '%', 'm1'),
    'unemployment claims': ('ICSA', 'level', 0.001, 'K', 'w1'),
    # Only the advance GDP estimate: FRED already holds the quarter when the prelim and final revisions come out,
    # so it would show the old advance figure as their actual.
    'advance gdp q/q': ('A191RL1Q225SBEA', 'level', 1, '%', 'q'),
    'core pce price index m/m': ('PCEPILFE', 'mom', 1, '%', 'm1'),
    'pce price index m/m': ('PCEPI', 'mom', 1, '%', 'm1'),
    'personal spending m/m': ('PCE', 'mom', 1, '%', 'm1'),
    'personal income m/m': ('PI', 'mom', 1, '%', 'm1'),
    'jolts job openings': ('JTSJOL', 'level', 0.001, 'M', 'm2'),
    'building permits': ('PERMIT', 'level', 0.001, 'M', 'm1'),
    'housing starts': ('HOUST', 'level', 0.001, 'M', 'm1'),
    'new home sales': ('HSN1F', 'level', 1, 'K', 'm1'),
    'durable goods orders m/m': ('DGORDER', 'mom', 1, '%', 'm1'),
    'core durable goods orders m/m': ('ADXTNO', 'mom', 1, '%', 'm1'),
    'industrial production m/m': ('INDPRO', 'mom', 1, '%', 'm1'),
    'trade balance': ('BOPGSTB', 'level', 0.001, 'B', 'm2'),
    'philly fed manufacturing index': ('GACDFSA066MSFRBPHI', 'level', 1, '', 'm0'),
    'empire state manufacturing index': ('GACDINA066MNFRBNY', 'level', 1, '', 'm0'),
}


def release_for(event):
    """The FRED mapping for a US calendar event, or None."""
    if event.get('country') != 'USD':
        return None
    return RELEASES.get(event.get('title', '').strip().lower())


def _month_start(day, back):
    y, m = day.year, day.month - back
    while m < 1:
        y, m = y - 1, m + 12
    return dt.date(y, m, 1)


def period_for(day, period):
    """The FRED observation date a release on `day` reports."""
    if period.startswith('m'):
        return _month_start(day, int(period[1:]))
    if period == 'q':
        first = _month_start(day, 0)
        q_start = dt.date(first.year, (first.month - 1) // 3 * 3 + 1, 1)  # the quarter we're in
        return _month_start(q_start, 3)  # the last completed one
    weeks = int(period[1:])
    saturday = day - dt.timedelta(days=(day.weekday() - 5) % 7 or 7)  # the Saturday before the release
    return saturday - dt.timedelta(days=7 * (weeks - 1))


def value_for(rows, obs, transform):
    """The release's figure from FRED rows [(iso date, value)], or None if FRED hasn't got that period yet."""
    values = dict(rows)
    v = values.get(obs.isoformat())
    if v is None:
        return None
    if transform == 'level':
        return v
    # The earlier reading is looked up by its date, not its position: FRED leaves out months it has no value for
    # (e.g. during a government shutdown), and counting back rows would then compare against the wrong month.
    prior = values.get(_month_start(obs, 12 if transform == 'yoy' else 1).isoformat())
    if prior is None:
        return None
    if transform == 'diff':
        return v - prior
    return (v / prior - 1) * 100 if prior else None


def _decimals(text):
    digits = ''.join(c for c in text if c.isdigit() or c == '.')
    return len(digits.split('.')[1]) if '.' in digits else 0


def format_like(value, unit, *examples):
    """Formats a figure the way the feed writes its forecast / previous ("0.3%", "254K", "-78.3B")."""
    sample = next((e for e in examples if e and any(c.isdigit() for c in e)), '')
    places = _decimals(sample) if sample else (1 if unit in ('%', 'M') else 0)
    return f'{value:.{places}f}{unit}'


def series_needed(events, now):
    """FRED series for US releases that have happened but have no actual yet."""
    return sorted({release_for(e)[0] for e in events if release_for(e) and not e.get('actual') and e['time'] <= now})


def fill(events, data, tz):
    """Fills in missing actuals from FRED data {series: rows}. Returns the events (changed in place)."""
    for e in events:
        rel = release_for(e)
        if not rel or e.get('actual') or rel[0] not in data:
            continue
        series, transform, scale, unit, period = rel
        day = dt.datetime.fromtimestamp(e['time'], tz).date()
        v = value_for(data[rel[0]], period_for(day, period), transform)
        if v is not None:
            e['actual'] = format_like(v * scale, unit, e.get('forecast', ''), e.get('previous', ''))
            e['actualSource'] = 'FRED'
    return events
