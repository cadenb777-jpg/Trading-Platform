"""Which addresses stay inside the app and which open in your normal browser (plain functions, tested without Qt).

The app shows the website itself, so the website's own pages (and the windows it opens for itself: the AI pop-out, a
journal screenshot) stay in the app; everything else (news articles, SEC filings, fund websites, the helper guide)
opens in your default browser, like a link from any desktop program.
"""
import posixpath
from urllib.parse import unquote, urlsplit

#: The website the app shows (the same address the helper opens in Chrome: helper/schwab_helper.py PLATFORM_URL).
PLATFORM_URL = 'https://cadenb777-jpg.github.io/Trading-Platform/'

#: Addresses the page itself makes (blank pop-ups, downloads, pictures written into a new window).
INTERNAL_SCHEMES = {'about', 'blob', 'data'}


def _norm(url):
    """scheme://host/path with the path's case kept, without query or #route; '' for anything unreadable."""
    try:
        p = urlsplit(url)
    except ValueError:
        return ''
    if not p.scheme:
        return ''
    path = unquote(p.path)
    if path:  # "/Trading-Platform/../Other" or "%2e%2e" can't pass for the website
        clean = posixpath.normpath(path)
        path = clean + ('/' if path.endswith('/') and clean != '/' else '')
    return f'{p.scheme.lower()}://{p.netloc.lower()}{path}'


def is_platform(url, base=PLATFORM_URL):
    """True for the website's own pages (any #route), e.g. .../Trading-Platform/#research/AAPL."""
    here, home = _norm(url), _norm(base)
    if not here or not home:
        return False
    home_dir = home if home.endswith('/') else home + '/'
    return here == home.rstrip('/') or here.startswith(home_dir) or here == home


def scheme(url):
    try:
        return urlsplit(url).scheme.lower()
    except ValueError:
        return ''


def stays_in_app(url, base=PLATFORM_URL):
    """The main window may go here (the website, or a blank/data page or a blob the website made); anything else
    opens outside."""
    if url in ('', 'about:blank') or is_platform(url, base):
        return True
    kind = scheme(url)
    if kind == 'blob':  # blob:https://host/uuid: only the website's own
        return origin_allowed(url[len('blob:'):], base)
    return kind in ('about', 'data')


#: The only kinds of address handed to your computer: web pages and e-mail. Never file:, network shares or programs.
EXTERNAL_SCHEMES = {'http', 'https', 'mailto'}


def opens_externally(url):
    """True when a link that leaves the app may go to your normal browser (or e-mail program). Anything else (file:,
    smb:, ms-*: and other program links, which a hostile news feed could plant) is ignored."""
    p = urlsplit(url or '')
    return p.scheme.lower() in EXTERNAL_SCHEMES and (p.scheme.lower() == 'mailto' or bool(p.netloc))


def new_window_kind(url, base=PLATFORM_URL):
    """'app' for a window the website opens for itself (AI pop-out, a blank window it writes into), else 'external'."""
    return 'app' if stays_in_app(url, base) else 'external'


def origin_allowed(origin, base=PLATFORM_URL):
    """Notifications and the clipboard are allowed for the website only (never for a page from elsewhere)."""
    o, b = urlsplit(origin or ''), urlsplit(base)
    return bool(o.scheme) and (o.scheme, o.netloc.lower()) == (b.scheme, b.netloc.lower())


#: Chromium's "aborted": a navigation that was stopped on purpose (a link the app sent to your browser, or a page that
#: moved on before it finished). That is not "offline".
ABORTED = -3


def shows_offline_page(failed_url, error_code, is_error_page, base=PLATFORM_URL):
    """True when a failed load should show "Can't reach the platform": the website itself didn't load because of a
    network or server problem. Never for a navigation the app stopped (a link opened in your browser)."""
    if error_code == ABORTED:
        return False
    return is_platform(failed_url, base) or (is_error_page and failed_url in ('', 'about:blank'))


#: Set by the 2.0 launcher (launch.py) when it runs the app: it looks after the helper itself.
LAUNCHER_FLAG = 'TP_HELPER_BY_LAUNCHER'


def should_start_helper(env, url, helper_answers, base=PLATFORM_URL):
    """True when the app itself should open the helper's start file: nothing answers on the helper's port, the app
    shows the real website, and no 2.0 launcher looks after the helper (the old 1.x launcher that installed this
    version doesn't start it)."""
    return not helper_answers and not env.get(LAUNCHER_FLAG) and is_platform(url, base)


def helper_start_command(helper_dir, platform):
    """How to open the website helper's own start file in its own window (its start screen and the Schwab login).
    Chrome doesn't open: the helper skips that when a window (this app) is already connected."""
    from pathlib import Path

    helper_dir = Path(helper_dir)
    if platform == 'win32':
        return ['cmd', '/c', 'start', 'Trading Platform helper', str(helper_dir / 'start-windows.bat'), '--no-browser']
    if platform == 'darwin':
        return ['open', '-a', 'Terminal', str(helper_dir / 'start-mac.command')]
    return None


#: Speed and smoothness: draw with the graphics card and never slow the page's timers down. (Forcing the card past
#: Chromium's cautious list and "zero-copy" drawing were tried and dropped: on Intel graphics they made scrolling
#: flicker, and the owner's card is used without them.) Added to anything already in QTWEBENGINE_CHROMIUM_FLAGS.
FAST_FLAGS = ('--enable-gpu-rasterization', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
              # the owner's window went black after the screen slept / long runs: Windows resets the graphics driver,
              # Chromium's GPU process dies, and after a few crashes Chromium stops restarting it (the page then never
              # draws again). Without the limit it always comes back.
              '--disable-gpu-process-crash-limit')


#: The window is "blank" when every sampled pixel is this dark or darker on all three channels. The website is never
#: pure black (its darkest colour is the navy #050d19, blue 25), so only a page that has stopped drawing matches.
BLANK_MAX = 4


def looks_blank(colors, minimum=9):
    """True when enough pixels were sampled and every one is (near) pure black: the page has stopped drawing (its
    graphics process died) while the window's own buttons still show. colors = [(r, g, b), ...]."""
    colors = list(colors)
    return len(colors) >= minimum and all(max(c) <= BLANK_MAX for c in colors)


def chromium_flags(existing):
    """The Chromium switches the app starts with: what was set already plus FAST_FLAGS (none twice); a set
    --disable-gpu (the checks on machines without a screen) keeps the graphics-card ones out."""
    have = existing.split()
    add = [f for f in FAST_FLAGS if f not in have]
    if '--disable-gpu' in have:
        add = [f for f in add if 'gpu' not in f and 'zero-copy' not in f]
    return ' '.join(have + add)


def page_name(page_title):
    """"Research" from the website's "Research · Trading Platform" ('' for the home page or a bare address)."""
    t = (page_title or '').replace('Trading Platform', '').strip(' ·-—|')
    return t if t and t != 'about:blank' and not t.startswith('http') else ''


def resize_edges(x, y, width, height, edge=6):
    """The window edges ('left', 'right', 'top', 'bottom') a point is on, for resizing a window with its own title bar."""
    out = set()
    if x < edge:
        out.add('left')
    elif x >= width - edge:
        out.add('right')
    if y < edge:
        out.add('top')
    elif y >= height - edge:
        out.add('bottom')
    return out
