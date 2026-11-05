"""
Chart maths for the desktop chart, pure and tested (tests/test_chartmath.py): nice price steps, square grid columns,
12/24-hour clock text and the US stock session of a bar (New York time).
"""
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')


def nice_step(span, target_lines=8):
    """A 1/2/2.5/5 x 10^n step that cuts `span` into about `target_lines` parts."""
    if not span or span <= 0 or not math.isfinite(span):
        return 1.0
    raw = span / max(1, target_lines)
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if m * mag >= raw:
            return m * mag
    return 10 * mag


def grid_columns(x_from, x_to, cell_px, px_per_unit):
    """Vertical grid positions (in bar-index units) so cells are `cell_px` wide on screen: a fixed pitch that carries
    on past the data, anchored at 0 so the lines don't swim while scrolling."""
    if px_per_unit <= 0 or cell_px <= 0:
        return []
    pitch = max(1, round(cell_px / px_per_unit))
    start = math.floor(x_from / pitch) * pitch
    return [x for x in range(int(start), int(math.ceil(x_to)) + 1, pitch) if x >= x_from]


def clock_text(hour, minute, clock='12h'):
    """'9:30 AM' (12-hour) or '09:30' (24-hour)."""
    if clock == '24h':
        return f'{hour:02d}:{minute:02d}'
    h12 = 12 if hour % 12 == 0 else hour % 12
    return f"{h12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"


def session_phase(ts):
    """'pre' 4:00-9:30, 'regular' 9:30-16:00, 'post' 16:00-20:00, else 'closed' (New York time; weekends closed)."""
    d = datetime.fromtimestamp(ts, timezone.utc).astimezone(NY)
    if d.weekday() >= 5:
        return 'closed'
    m = d.hour * 60 + d.minute
    if 240 <= m < 570:
        return 'pre'
    if 570 <= m < 960:
        return 'regular'
    if 960 <= m < 1200:
        return 'post'
    return 'closed'


def is_daily(times):
    """Daily or longer bars (median gap of 20 hours or more)."""
    if len(times) < 2:
        return True
    tail = times[-61:]
    gaps = sorted(b - a for a, b in zip(tail, tail[1:]))
    return gaps[len(gaps) // 2] >= 20 * 3600


def time_label(ts, daily, clock='12h'):
    """Axis label: 'Nov 5' on daily bars (read in UTC), a clock time intraday (the viewer's local time)."""
    if daily:
        d = datetime.fromtimestamp(ts, timezone.utc)
        return f"{d.strftime('%b')} {d.day}"
    d = datetime.fromtimestamp(ts).astimezone()
    return clock_text(d.hour, d.minute, clock)
