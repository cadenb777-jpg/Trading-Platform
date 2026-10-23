"""
The helper's start-up screen and launcher. Every start rolls the dice: a random intro effect (Matrix code rain,
a starfield warp, a glitchy reveal or a stock ticker tape), a random text creature (dragon, turtle, bull,
bear...), a random colour theme and a random trading line, under the owner's name in big block letters.

`python splash.py run` is what the start files call: it shows the screen, then installs anything missing and
starts the helper behind a single 0-100% loading bar, keeping the install and log messages out of sight
(they go to ~/.trading-platform/launcher.log and helper.log). Standard library only, so it runs before
anything is installed.
"""
import collections
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

NAME = os.environ.get('TP_NAME', 'CADEN')

# "ANSI Shadow" block letters. Box-drawing characters render in the standard Windows console fonts.
FONT = {
    'A': [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    'B': ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
    'C': [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
    'D': ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
    'E': ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
    'F': ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '██║     ', '╚═╝     '],
    'G': [' ██████╗ ', '██╔════╝ ', '██║  ███╗', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    'H': ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    'I': ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
    'J': ['     ██╗', '     ██║', '     ██║', '██   ██║', '╚█████╔╝', ' ╚════╝ '],
    'K': ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
    'L': ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
    'M': ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
    'N': ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
    'O': [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    'P': ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
    'Q': [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║▄▄ ██║', '╚██████╔╝', ' ╚══▀▀═╝ '],
    'R': ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
    'S': ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
    'T': ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
    'U': ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    'V': ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
    'W': ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
    'X': ['██╗  ██╗', '╚██╗██╔╝', ' ╚███╔╝ ', ' ██╔██╗ ', '██╔╝ ██╗', '╚═╝  ╚═╝'],
    'Y': ['██╗   ██╗', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚██╔╝  ', '   ██║   ', '   ╚═╝   '],
    'Z': ['███████╗', '╚══███╔╝', '  ███╔╝ ', ' ███╔╝  ', '███████╗', '╚══════╝'],
    ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
}

# Colour themes: each is a gradient from the first colour to the last.
PALETTES = {
    'cyber': [(0, 255, 230), (0, 200, 255), (60, 140, 255), (130, 100, 255), (190, 80, 255), (255, 70, 200)],
    'fire': [(255, 240, 120), (255, 200, 60), (255, 150, 30), (255, 100, 20), (240, 60, 20), (200, 20, 30)],
    'ocean': [(180, 255, 255), (100, 230, 255), (40, 190, 255), (20, 140, 240), (30, 90, 220), (40, 50, 190)],
    'toxic': [(220, 255, 120), (160, 255, 80), (90, 255, 60), (40, 230, 90), (20, 200, 140), (10, 160, 170)],
    'sunset': [(255, 210, 120), (255, 160, 110), (255, 110, 120), (230, 80, 150), (170, 70, 180), (110, 60, 200)],
    'gold': [(255, 250, 200), (255, 230, 140), (250, 205, 80), (235, 175, 40), (210, 145, 20), (170, 110, 10)],
}

ART = {
    'dragon': r"""
                 __====-_  _-====___
           _--^^^#####//      \\#####^^^--_
        _-^##########// (    ) \\##########^-_
       -############//  |\^^/|  \\############-
     _/############//   (@::@)   \\############\_
    /#############((     \\//     ))#############\
   -###############\\    (oo)    //###############-
  -#################\\  / VV \  //#################-
 -###################\\/      \//###################-
_#/|##########/\######(   /\   )######/\##########|\#_
|/ |#/\#/\#/\/  \#/\##\  |  |  /##/\#/  \/\#/\#/\#| \|
`  |/  V  V  `   V  \#\| |  | |/#/  V   '  V  V  \|  '
   `   `  `      `   / | |  | | \   '      '  '   '
                    (  | |  | |  )
                   __\ | |  | | /__
                  (vvv(VVV)(VVV)vvv)""",
    'turtle': r"""
                    __
         .,-;-;-,. /'_\
       _/_/_/_|_\_\) /
     '-<_><_><_><_>=/\
       `/_/====/_/-'\_\
        ""     ""    "" """,
    'bull': r"""
          ,           ,
         /             \
        ((__-^^-,-^^-__))
         `-_---' `---_-'
          <__|o` 'o|__>
             \  `  /
              ): :(
              :o_o:
               "-"        BULL MARKET MODE""",
    'bear': r"""
       (()__(()
       /       \
      ( /    \  \
       \ o o    /
       (_()_)__/ \
      / _,==.____ \
     (   |--|      )
     /\_.|__|'-.__/\_
    / (        /     \
    \  \      (      /
     )  '._____)    /
   (((____.--(((____/     BEAR NECESSITIES""",
    'rocket': r"""
           /\
          /  \
         |    |
         | TP |
         |    |
        /| /\ |\
       / |/  \| \
      /__|    |__\
         \/\/\/
          \/\/
           \/          TO THE MOON""",
    'owl': r"""
       ,_,     ,_,     ,_,
      (O,O)   (o,o)   (O,o)
      (   )   (   )   (   )
     --"-"-----"-"-----"-"--   WISE MONEY IS WATCHING""",
    'cat': r"""
        /\_/\
       ( o.o )   hello, trader
        > ^ <
       /     \
      (|     |)
       \_____/""",
}

TAGLINES = [
    'The trend is your friend until the end.',
    'Plan the trade, trade the plan.',
    'Cut losses short, let winners run.',
    'Risk comes from not knowing what you are doing.',
    'Markets can stay irrational longer than you can stay solvent.',
    'Be fearful when others are greedy.',
    'Buy the rumor, check the data.',
    'Patience is a position.',
    'Price is what you pay. Value is what you get.',
    'Charts loaded. Coffee recommended.',
]

TICKERS = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'BTC', 'ETH', 'IWM', 'GLD', 'TLT', 'AMD', 'NFLX']

GRADIENT = PALETTES['cyber']
RESET = '\033[0m'


def enable_colors():
    """Turns on colour codes in the Windows console (they're on by default elsewhere)."""
    if os.name == 'nt':
        try:
            import ctypes
            kernel = ctypes.windll.kernel32
            handle = kernel.GetStdHandle(-11)
            mode = ctypes.c_uint32()
            if kernel.GetConsoleMode(handle, ctypes.byref(mode)):
                kernel.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        except Exception:
            os.system('')
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def fancy():
    return sys.stdout.isatty() and not os.environ.get('NO_COLOR')


def rgb(color, text, bold=False):
    if not fancy():
        return text
    r, g, b = color
    return f"\033[{'1;' if bold else ''}38;2;{r};{g};{b}m{text}{RESET}"


def matrix_rain(seconds=1.6):
    """Green code falling down the screen, then cleared away."""
    cols, rows = shutil.get_terminal_size((80, 24))
    width = min(cols - 1, 110)
    height = min(max(rows - 4, 8), 14)
    chars = '01アイウエオカキクケコｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF$#@%&*+=<>/' if os.name != 'nt' else '0123456789ABCDEF$#@%&*+=<>/\\|ZXYWVK'
    drops = [random.randint(-height, 0) for _ in range(width)]
    speeds = [random.choice((1, 1, 2)) for _ in range(width)]
    sys.stdout.write('\033[?25l' + '\n' * height)  # hide cursor, make room
    end = time.time() + seconds
    try:
        while time.time() < end:
            sys.stdout.write(f'\033[{height}A')
            lines = []
            for y in range(height):
                row = []
                for x in range(width):
                    d = drops[x]
                    if y == d:
                        row.append(f'\033[1;38;2;220;255;220m{random.choice(chars)}')
                    elif d - 6 < y < d:
                        shade = 255 - (d - y) * 35
                        row.append(f'\033[38;2;0;{shade};70m{random.choice(chars)}')
                    else:
                        row.append(' ')
                lines.append(''.join(row) + RESET)
            sys.stdout.write('\n'.join(lines) + '\n')
            sys.stdout.flush()
            for x in range(width):
                drops[x] += speeds[x]
                if drops[x] - 6 > height and random.random() < 0.3:
                    drops[x] = random.randint(-4, 0)
            time.sleep(0.045)
    finally:
        sys.stdout.write(f'\033[{height}A\033[J\033[?25h')  # clear the rain, show cursor
        sys.stdout.flush()


def starfield(seconds=1.4):
    """A warp-speed jump: stars streak out from the middle of the screen."""
    cols, rows = shutil.get_terminal_size((80, 24))
    width, height = min(cols - 1, 110), min(max(rows - 4, 8), 14)
    cx, cy = width / 2, height / 2
    stars = [[random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(0.05, 0.6)] for _ in range(70)]
    sys.stdout.write('\033[?25l' + '\n' * height)
    end = time.time() + seconds
    try:
        while time.time() < end:
            grid = [[' '] * width for _ in range(height)]
            for star in stars:
                star[2] *= 1.18
                x, y = int(cx + star[0] * star[2] * cx * 2), int(cy + star[1] * star[2] * cy * 2)
                if not (0 <= x < width and 0 <= y < height) or star[2] > 3:
                    star[:] = [random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(0.05, 0.2)]
                    continue
                glyph, shade = ('.', 110) if star[2] < 0.6 else ('*', 190) if star[2] < 1.4 else ('@', 255)
                grid[y][x] = f'\033[38;2;{shade};{shade};255m{glyph}'
            sys.stdout.write(f'\033[{height}A' + '\n'.join(''.join(r) + RESET for r in grid) + '\n')
            sys.stdout.flush()
            time.sleep(0.04)
    finally:
        sys.stdout.write(f'\033[{height}A\033[J\033[?25h')
        sys.stdout.flush()


def ticker_tape(seconds=1.6):
    """A stock ticker scrolling across the screen with random prices."""
    cols, _ = shutil.get_terminal_size((80, 24))
    width = min(cols - 1, 110)
    items = []
    for sym in random.sample(TICKERS, len(TICKERS)):
        change = random.uniform(-4, 4)
        color = '0;230;120' if change >= 0 else '255;80;80'
        arrow = '▲' if change >= 0 else '▼'
        items.append((f'{sym} {random.uniform(20, 900):.2f} ', f'{arrow}{abs(change):.2f}%   ', color))
    plain = ''.join(a + b for a, b, _ in items) * 3
    sys.stdout.write('\033[?25l\n')
    end, offset = time.time() + seconds, 0
    try:
        while time.time() < end:
            # Colour the visible slice item by item.
            out, pos = [], 0
            for _ in range(3):
                for a, b, color in items:
                    for text, col in ((a, '225;230;240'), (b, color)):
                        start, stop = pos, pos + len(text)
                        lo, hi = max(start, offset), min(stop, offset + width)
                        if lo < hi:
                            out.append(f'\033[38;2;{col}m{text[lo - start:hi - start]}')
                        pos = stop
            sys.stdout.write('\r' + ''.join(out) + RESET)
            sys.stdout.flush()
            offset = (offset + 2) % (len(plain) // 3)
            time.sleep(0.03)
    finally:
        sys.stdout.write('\r\033[K\033[1A\033[?25h')
        sys.stdout.flush()


def glitch_in(rows, palette, seconds=1.0):
    """Reveals the big name out of random glitch characters."""
    noise = '#$%&@*+=?/\\|<>~^'
    height = len(rows)
    sys.stdout.write('\033[?25l' + '\n' * height)
    steps = 14
    try:
        for k in range(steps + 1):
            sys.stdout.write(f'\033[{height}A')
            for i, row in enumerate(rows):
                line = ''.join(ch if ch == ' ' or random.random() < k / steps else random.choice(noise) for ch in row)
                sys.stdout.write(rgb(palette[i], '  ' + line, bold=True) + '\033[K\n')
            sys.stdout.flush()
            time.sleep(seconds / steps)
    finally:
        sys.stdout.write('\033[?25h')


def big(text):
    rows = [''] * 6
    for ch in text.upper():
        glyph = FONT.get(ch, FONT[' '])
        for i in range(6):
            rows[i] += glyph[i]
    return rows


def pick(seed):
    """Rolls the dice for one start-up: theme, intro effect, creature, quote and boot number."""
    rng = random.Random(seed)
    return {
        'theme': rng.choice(list(PALETTES)),
        'effect': rng.choice(['matrix', 'starfield', 'glitch', 'ticker']),
        'creature': rng.choice(list(ART)),
        'tagline': rng.choice(TAGLINES),
        'boot': rng.randint(1000, 9999),
    }


def clear_screen():
    if fancy():
        sys.stdout.write('\033[2J\033[3J\033[H')
        sys.stdout.flush()


def banner(look=None, intro=True):
    """The name in big letters, the creature and the quote. `intro` plays the random effect first."""
    enable_colors()
    look = look or pick(None)
    palette = PALETTES[look['theme']]
    effect = look['effect'] if intro and fancy() else ''
    rows = big(NAME)
    width = max(len(r) for r in rows)
    print()
    if effect == 'matrix':
        matrix_rain()
    elif effect == 'starfield':
        starfield()
    elif effect == 'ticker':
        ticker_tape()
    if effect == 'glitch':
        glitch_in(rows, palette)
    else:
        for i, row in enumerate(rows):
            print(rgb(palette[i], '  ' + row, bold=True))
            if intro and fancy():
                time.sleep(0.04)
    print('  ' + rgb(palette[0], 'T R A D I N G   P L A T F O R M'.center(width), bold=True))
    print('  ' + rgb((90, 100, 130), '─' * width))
    art = ART[look['creature']].strip('\n').split('\n')
    for i, line in enumerate(art):
        color = palette[min(len(palette) - 1, i * len(palette) // max(1, len(art)))]
        print('  ' + rgb(color, line))
        if intro and fancy():
            time.sleep(0.02)
    print()
    print('  ' + rgb((235, 235, 245), '“' + look['tagline'] + '”'))
    print('  ' + rgb((120, 130, 160), f"boot sequence #{look['boot']} · theme {look['theme']} · {look['creature']} · Schwab data · analysis engine · AI"))
    print()


def step(n, total, text):
    enable_colors()
    print(rgb((0, 255, 230), f'  [{n}/{total}] ', bold=True) + rgb((225, 230, 240), text))


def ok(text):
    enable_colors()
    print(rgb((0, 230, 120), '  ✔ ', bold=True) + rgb((200, 240, 210), text))


def warn(text):
    enable_colors()
    print(rgb((255, 200, 0), '  ! ', bold=True) + rgb((255, 230, 160), text))


def fail(text):
    enable_colors()
    print(rgb((255, 80, 80), '  ✖ ', bold=True) + rgb((255, 200, 200), text))


# ---------- The loading bar ----------

class Bar:
    """A 0-100% loading bar that always keeps moving.

    Work is split into stages (e.g. 12% -> 55% "Downloading..."). Inside a stage the bar follows real progress
    when there is some (packages downloaded) and otherwise creeps forward on its own, slowing as it nears the
    end of the stage, so it never looks frozen. It is drawn on one line, many times a second, by a thread."""

    def __init__(self, palette, start=0.0):
        self.palette = palette
        self.shown = start
        self.lo = self.hi = start
        self.frac = 0.0
        self.expect = 1.0
        self.started = self.updated = time.time()
        self.label = ''
        self.complete = False
        self.failed = False
        self.frame = 0
        self._lock = threading.Lock()
        self._thread = None
        self._running = False

    # ----- what the bar is doing -----

    def stage(self, label, hi, expect_seconds=2.0):
        with self._lock:
            self.lo = max(self.shown, self.hi)
            self.hi = max(hi, self.lo)
            self.frac = 0.0
            self.expect = max(0.2, expect_seconds)
            self.started = self.updated = time.time()
            self.label = label
            self.complete = False

    def progress(self, frac, label=None):
        with self._lock:
            if frac > self.frac:
                self.frac = min(1.0, frac)
                self.updated = time.time()
            if label:
                self.label = label

    def finish(self, label=None):
        with self._lock:
            self.complete = True
            if label:
                self.label = label

    def goal(self):
        if self.complete:
            return self.hi
        now = time.time()
        # Time-based creep (up to 90% of the stage), plus a slow drift past the last real progress report.
        creep = 0.9 * (1 - math.exp(-(now - self.started) / self.expect))
        drift = self.frac + (1 - self.frac) * 0.5 * (1 - math.exp(-(now - self.updated) / max(4.0, self.expect / 3)))
        return self.lo + (self.hi - self.lo) * min(0.97, max(creep, drift))

    def wait(self, value=None, timeout=4.0):
        """Waits until the bar has visibly reached `value` (default: the end of the current stage)."""
        value = self.hi if value is None else value
        end = time.time() + timeout
        while self.shown < value - 0.05 and time.time() < end and self._running:
            time.sleep(0.02)

    # ----- drawing -----

    def start(self):
        self._running = True
        sys.stdout.write('\033[?25l')
        self._thread = threading.Thread(target=self._animate, daemon=True)
        self._thread.start()
        return self

    def _animate(self):
        while self._running:
            with self._lock:
                goal = self.goal()
                if self.shown < goal:
                    self.shown = min(goal, self.shown + max(0.08, (goal - self.shown) * 0.12))
                self.draw()
            self.frame += 1
            time.sleep(0.04)

    def line(self):
        cols = shutil.get_terminal_size((100, 30)).columns
        width = max(10, min(40, cols - 34))
        cells = self.shown / 100 * width
        full = int(cells)
        parts = []
        for i in range(width):
            color = (255, 80, 80) if self.failed else self.palette[min(len(self.palette) - 1, i * len(self.palette) // width)]
            if i < full:
                parts.append(rgb(color, '█'))
            elif i == full and cells - full >= 0.5:
                parts.append(rgb(color, '▌'))
            else:
                parts.append(rgb((55, 60, 80), '░'))
        spin = SPINNER[self.frame % len(SPINNER)] if self.shown < 100 and not self.failed else ('✖' if self.failed else '✔')
        label = self.label[: max(0, cols - width - 16)]
        pct = rgb((255, 255, 255), f'{int(self.shown):3d}%', bold=True)
        tone = (255, 120, 120) if self.failed else (0, 230, 120) if self.shown >= 100 else self.palette[0]
        return f"  {rgb((90, 100, 130), '▕')}{''.join(parts)}{rgb((90, 100, 130), '▏')} {pct}  {rgb(tone, spin)} {rgb((200, 205, 220), label)}"

    def draw(self):
        sys.stdout.write('\r' + self.line() + '\033[K')
        sys.stdout.flush()

    def stop(self, newline=True, failed=False):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)
        with self._lock:
            self.failed = failed
            if self.complete and not failed:
                self.shown = self.hi
            self.draw()
        sys.stdout.write(('\n' if newline else '\r') + '\033[?25h')
        sys.stdout.flush()


SPINNER = '|/-\\' if os.name == 'nt' else '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'


# ---------- The launcher ----------

HERE = Path(__file__).resolve().parent
DATA_DIR = Path.home() / '.trading-platform'
PIP_ARGS = ['-m', 'pip', 'install', '--disable-pip-version-check', '--prefer-binary', '--timeout', '20', '--retries', '2']
# Typical number of packages each requirements file pulls in, so the bar can estimate how far along it is.
EXPECTED_PACKAGES = {'requirements.txt': 22, 'requirements-extra.txt': 14}
# Exit codes that mean the helper was stopped on purpose (Ctrl+C or window closed).
STOPPED_CODES = {0, 130, -2, 3221225786, -1073741510}
# Exit code telling the start file that "Press Enter to close" was already shown (1 means splash.py itself broke).
ALREADY_WAITED = 2


class LaunchError(Exception):
    def __init__(self, message, details=(), hints=()):
        super().__init__(message)
        self.details = list(details)
        self.hints = list(hints)


def venv_python():
    return HERE / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def same_file(a, b):
    try:
        return a.read_bytes() == b.read_bytes()
    except OSError:
        return False


def open_log():
    try:
        DATA_DIR.mkdir(exist_ok=True)
        return open(DATA_DIR / 'launcher.log', 'w', encoding='utf-8')
    except OSError:
        return open(os.devnull, 'w')


NETWORK_HINTS = [
    'Check your internet connection and start the helper again.',
    'Work or school networks sometimes block pypi.org (where Python parts come from): try a home network or phone hotspot.',
]


def pip_install(bar, log, requirements, label, lo, hi, minutes):
    """Runs pip for one requirements file with its output hidden, moving the bar as packages arrive."""
    bar.stage(label, hi, expect_seconds=minutes * 60)
    expected = EXPECTED_PACKAGES.get(requirements, 15)
    cmd = [str(venv_python()), *PIP_ARGS, '--progress-bar', 'off', '-r', requirements]
    log.write(f'\n$ {" ".join(cmd)}\n')
    proc = subprocess.Popen(cmd, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            encoding='utf-8', errors='replace', bufsize=1)
    tail = collections.deque(maxlen=12)
    seen = 0
    for raw in proc.stdout:
        log.write(raw)
        line = raw.strip()
        if line:
            tail.append(line)
        m = re.match(r'(Collecting|Requirement already satisfied:?)\s+([A-Za-z0-9_.\-]+)', line)
        if m:
            seen += 1
            bar.progress(min(0.8, seen / expected), f'{label.split(" - ")[0]}: {m.group(2)}')
            continue
        m = re.match(r'Downloading\s+(?:https?://\S+/)?([A-Za-z0-9_.]+?)-\d\S*\s*\(([^)]+)\)', line)
        if m:
            bar.progress(min(0.8, seen / expected), f'Downloading {m.group(1)} ({m.group(2)})')
        elif line.startswith('Installing collected packages'):
            bar.progress(0.85, 'Installing (this part can take a minute)...')
        elif line.startswith('Successfully installed'):
            bar.progress(0.98)
    code = proc.wait()
    log.flush()
    return code, list(tail)


def prepare(bar, log):
    """Creates the helper's private Python and installs its parts, skipping whatever is already done."""
    py = venv_python()
    if not py.exists():
        bar.stage('Setting up Python for the helper (first start only)...', 12, expect_seconds=25)
        log.write(f'$ {sys.executable} -m venv .venv\n')
        result = subprocess.run([sys.executable, '-m', 'venv', '.venv'], cwd=HERE, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        log.write(result.stdout or '')
        if result.returncode != 0 or not py.exists():
            raise LaunchError('Could not set up Python for the helper.', (result.stdout or '').strip().splitlines()[-8:],
                              ['Reinstall Python from python.org and tick "Add python.exe to PATH" during setup.'])
    else:
        bar.stage('Checking Python...', 12, expect_seconds=0.3)
    bar.finish()

    core, core_marker = HERE / 'requirements.txt', HERE / '.venv' / 'installed-core.txt'
    if same_file(core, core_marker):
        bar.stage("Checking the helper's parts...", 55, expect_seconds=0.3)
    else:
        code, tail = pip_install(bar, log, 'requirements.txt', "Downloading the helper's main parts", 12, 55, 1.5)
        if code != 0:
            raise LaunchError("Could not download the helper's main parts.", tail, NETWORK_HINTS)
        shutil.copyfile(core, core_marker)
    bar.finish()

    extra, extra_marker = HERE / 'requirements-extra.txt', HERE / '.venv' / 'installed-extra.txt'
    warning = ''
    if same_file(extra, extra_marker) or not extra.exists():
        bar.stage('Checking the AI and portfolio maths parts...', 86, expect_seconds=0.3)
    else:
        code, tail = pip_install(bar, log, 'requirements-extra.txt', 'Downloading the AI and portfolio maths parts - about 100 MB', 55, 86, 4)
        if code == 0:
            shutil.copyfile(extra, extra_marker)
        else:
            warning = ('Some optional parts (AI, portfolio maths) did not install. Charts and prices still work; '
                       'start the helper again later to retry. Details: ' + str(DATA_DIR / 'launcher.log'))
    bar.finish()
    return warning


def wait_for_enter():
    try:
        input(rgb((150, 160, 190), '  Press Enter to close this window.'))
    except (EOFError, KeyboardInterrupt):
        pass


HANDOFF = DATA_DIR / 'screen-handoff'


def run_helper(args, env, bar=None):
    """Runs the helper in this window and waits for it to stop (Ctrl+C reaches it directly).

    With a bar, it keeps moving while the helper loads, until the helper says it's taking over the screen
    (it creates HANDOFF); the bar's position is then written to HANDOFF + '.pct' so the helper carries on from it."""
    for f in (HANDOFF, HANDOFF.with_suffix('.pct')):
        try:
            f.unlink()
        except OSError:
            pass
    proc = subprocess.Popen([str(venv_python()), 'schwab_helper.py', *args], cwd=HERE, env=env)
    if bar:
        try:
            while proc.poll() is None and not HANDOFF.exists():
                time.sleep(0.03)
        except KeyboardInterrupt:
            pass
        bar.stop(newline=proc.poll() is not None)
        try:
            HANDOFF.with_suffix('.pct').write_text(f'{bar.shown:.2f}')
        except OSError:
            pass
    while True:
        try:
            return proc.wait()
        except KeyboardInterrupt:
            continue


def launch(args):
    enable_colors()
    if not fancy():
        return plain_launch(args)
    seed = random.randrange(1 << 30)
    look = pick(seed)
    clear_screen()
    banner(look)
    bar = Bar(PALETTES[look['theme']]).start()
    log = open_log()
    try:
        warning = prepare(bar, log)
        bar.stage('Starting the helper (loading the analysis engine)...', 94, expect_seconds=6)
    except LaunchError as err:
        bar.stop(failed=True)
        print()
        fail(str(err))
        errors = [line for line in err.details if 'error' in line.lower()]
        for line in (errors or err.details)[-6:]:
            print(rgb((140, 145, 165), '     ' + line[:200]))
        print()
        for hint in err.hints:
            warn(hint)
        warn(f"Full details: {DATA_DIR / 'launcher.log'}")
        print()
        wait_for_enter()
        return ALREADY_WAITED
    finally:
        log.close()
    env = {**os.environ, 'TP_SPLASH': str(seed), 'TP_HANDOFF': str(HANDOFF), 'PYTHONIOENCODING': 'utf-8'}
    if warning:
        env['TP_LAUNCH_WARNING'] = warning
    code = run_helper(args, env, bar)
    if code not in STOPPED_CODES:
        print()
        fail(f'The helper stopped unexpectedly (code {code}).')
        warn(f"Details are in {DATA_DIR / 'helper.log'}. Start it again; if it keeps happening, send me that file.")
        wait_for_enter()
        return ALREADY_WAITED
    return 0


def plain_launch(args):
    """The same steps without the fancy screen (used if colours aren't available or the screen breaks)."""
    py = venv_python()
    if not py.exists():
        print('Setting up Python for the helper...')
        if subprocess.call([sys.executable, '-m', 'venv', '.venv'], cwd=HERE) != 0:
            print('Could not set up Python. Reinstall Python from python.org and tick "Add python.exe to PATH".')
            wait_for_enter()
            return ALREADY_WAITED
    for req, marker, needed in (('requirements.txt', 'installed-core.txt', True), ('requirements-extra.txt', 'installed-extra.txt', False)):
        if same_file(HERE / req, HERE / '.venv' / marker) or not (HERE / req).exists():
            continue
        print(f'Installing {req}...')
        if subprocess.call([str(py), *PIP_ARGS, '-r', req], cwd=HERE) == 0:
            shutil.copyfile(HERE / req, HERE / '.venv' / marker)
        elif needed:
            print(' '.join(NETWORK_HINTS))
            wait_for_enter()
            return ALREADY_WAITED
        else:
            print('Some optional parts did not install; charts and prices still work.')
    code = run_helper(args, dict(os.environ))
    if code not in STOPPED_CODES:
        wait_for_enter()
        return ALREADY_WAITED
    return 0


# ---------- The screen while the helper runs ----------

def take_over_screen():
    """Called by the helper when it starts: tells the launcher to stop drawing and returns where its bar was."""
    path = os.environ.get('TP_HANDOFF')
    if not path:
        return 86.0
    handoff = Path(path)
    pct = handoff.with_suffix('.pct')
    try:
        handoff.touch()
        end = time.time() + 1.5
        while not pct.exists() and time.time() < end:
            time.sleep(0.02)
        time.sleep(0.02)
        value = float(pct.read_text())
    except (OSError, ValueError):
        value = 88.0
    for f in (handoff, pct):
        try:
            f.unlink()
        except OSError:
            pass
    return value


class HelperScreen:
    """Used by schwab_helper.py when it was started by the launcher: finishes the loading bar, then keeps the
    banner on screen with one live status line at the bottom instead of scrolling log messages."""

    def __init__(self, seed, start=88.0):
        enable_colors()
        self.look = pick(seed)
        self.palette = PALETTES[self.look['theme']]
        self.bar = Bar(self.palette, start).start()
        self.ready_shown = False
        self.paused = False
        self.state = ('connecting', 'Connecting to Schwab')
        self.browsers = 0
        self.frame = 0
        self._lock = threading.Lock()

    def step(self, label, pct, expect_seconds=2.0):
        if self.paused:
            return
        self.bar.finish()
        self.bar.stage(label, pct, expect_seconds)

    def pause(self):
        """Hands the window over to normal text (e.g. the Schwab login steps or an error)."""
        if self.paused:
            return
        self.paused = True
        if not self.ready_shown:
            self.bar.stop()
        else:
            sys.stdout.write('\n')
        sys.stdout.write('\033[?25h')
        sys.stdout.flush()

    def resume(self):
        """Clears the login text away and puts the start screen back."""
        if not self.paused:
            return
        self.paused = False
        clear_screen()
        banner(self.look, intro=False)
        if self.ready_shown:
            self._ready_text()
        else:
            self.bar = Bar(self.palette, self.bar.shown).start()

    def ready(self, url, log_path, warning=''):
        if not self.paused:
            self.bar.stage('Ready', 100, 0.3)
            self.bar.finish('Ready')
            self.bar.wait(100)
            self.bar.stop()
        self.paused = False
        self.ready_shown = True
        self.url, self.log_path, self.warning = url, log_path, warning
        self._ready_text()

    def _ready_text(self):
        print()
        print('  ' + rgb((235, 235, 245), 'Open ') + rgb(self.palette[1], self.url, bold=True))
        print('  ' + rgb((150, 160, 190), 'Keep this window open while you use the platform. To stop the helper, close it or press Ctrl+C.'))
        print('  ' + rgb((110, 120, 150), f'Behind-the-scenes messages go to {self.log_path}'))
        if self.warning:
            warn(self.warning)
        print()
        self.draw_status()

    def message(self, text, tone='warn'):
        """A line that stays on screen above the status line (for things worth noticing)."""
        if not self.ready_shown or self.paused:
            return
        with self._lock:
            sys.stdout.write('\r\033[K')
            (fail if tone == 'bad' else warn if tone == 'warn' else ok)(text)
        self.draw_status()

    def status(self, status=None, message=None, browsers=None):
        if status:
            self.state = (status, message or '')
        if browsers is not None:
            self.browsers = browsers
        self.draw_status()

    def tick(self):
        self.frame += 1
        self.draw_status()

    def draw_status(self):
        if not self.ready_shown or self.paused:
            return
        status, text = self.state
        color = {'live': (0, 230, 120), 'error': (255, 90, 90)}.get(status, (255, 200, 0))
        pulse = '●' if self.frame % 2 == 0 or status != 'live' else '○'
        label = {'live': 'LIVE', 'error': 'PROBLEM'}.get(status, 'CONNECTING')
        tabs = f'{self.browsers} platform tab{"s" if self.browsers != 1 else ""} connected' if self.browsers else 'waiting for the platform to open'
        clock = time.strftime('%H:%M:%S')
        line = (f"  {rgb(color, pulse + ' ' + label, bold=True)}  {rgb((220, 225, 235), text)}"
                f"{rgb((110, 120, 150), ' · ' + tabs + ' · ' + clock)}")
        with self._lock:
            sys.stdout.write('\r' + line + '\033[K')
            sys.stdout.flush()

    def close(self, text):
        with self._lock:
            if self.ready_shown and not self.paused:
                sys.stdout.write('\r\033[K')
            elif not self.paused:
                self.bar.stop()
            print('  ' + rgb((150, 160, 190), text))
            sys.stdout.write('\033[?25h')
            sys.stdout.flush()


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == 'run':
        try:
            sys.exit(launch(args[1:]))
        except KeyboardInterrupt:
            sys.stdout.write(RESET + '\033[?25h\n')
            sys.exit(0)
        except SystemExit:
            raise
        except Exception:
            # The fancy screen is decoration; if it breaks, start the helper the plain way.
            sys.stdout.write(RESET + '\033[?25h\n')
            try:
                with open(DATA_DIR / 'launcher.log', 'a', encoding='utf-8') as f:
                    f.write(traceback.format_exc())
            except OSError:
                pass
            sys.exit(plain_launch(args[1:]))
    try:
        if not args or args[0] == 'banner':
            banner()
        elif args[0] == 'step' and len(args) >= 4:
            step(args[1], args[2], ' '.join(args[3:]))
        elif args[0] == 'ok':
            ok(' '.join(args[1:]))
        elif args[0] == 'warn':
            warn(' '.join(args[1:]))
    except KeyboardInterrupt:
        sys.stdout.write(RESET + '\033[?25h\n')
    except Exception:
        sys.stdout.write(RESET + '\033[?25h')
