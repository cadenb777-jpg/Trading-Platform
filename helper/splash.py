"""
The helper's start-up screen. Every start rolls the dice: a random intro effect (Matrix code rain, a starfield
warp, a glitchy reveal or a stock ticker tape), a random text creature (dragon, turtle, bull, bear...), a random
colour theme and a random trading line, under the owner's name in big block letters. Standard library only,
so it runs before anything is installed.

    python splash.py banner          # rain + name + title
    python splash.py step 2 3 "text" # a coloured "Step 2 of 3" line
    python splash.py ok "text"       # a green tick line
    python splash.py warn "text"     # a yellow warning line
"""
import os
import random
import shutil
import sys
import time

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


def banner():
    enable_colors()
    rng = random.Random()  # a different start-up every time
    theme = rng.choice(list(PALETTES))
    palette = PALETTES[theme]
    effect = rng.choice(['matrix', 'starfield', 'glitch', 'ticker'])
    creature = rng.choice(list(ART))
    rows = big(NAME)
    width = max(len(r) for r in rows)
    print()
    if fancy() and effect == 'matrix':
        matrix_rain()
    elif fancy() and effect == 'starfield':
        starfield()
    elif fancy() and effect == 'ticker':
        ticker_tape()
    if fancy() and effect == 'glitch':
        glitch_in(rows, palette)
    else:
        for i, row in enumerate(rows):
            print(rgb(palette[i], '  ' + row, bold=True) if fancy() else '  ' + row)
            if fancy():
                time.sleep(0.04)
    print('  ' + rgb(palette[0], 'T R A D I N G   P L A T F O R M'.center(width), bold=True))
    print('  ' + rgb((90, 100, 130), '─' * width))
    art = ART[creature].strip('\n').split('\n')
    for i, line in enumerate(art):
        color = palette[min(len(palette) - 1, i * len(palette) // max(1, len(art)))]
        print('  ' + rgb(color, line))
        if fancy():
            time.sleep(0.02)
    print()
    print('  ' + rgb((235, 235, 245), '“' + rng.choice(TAGLINES) + '”'))
    print('  ' + rgb((120, 130, 160), f'boot sequence #{rng.randint(1000, 9999)} · theme {theme} · {creature} · Schwab data · analysis engine · AI'))
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


if __name__ == '__main__':
    args = sys.argv[1:]
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
        # The start-up screen is decoration; never let it stop the helper from starting.
        sys.stdout.write(RESET + '\033[?25h')
