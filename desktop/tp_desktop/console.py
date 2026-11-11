"""
The launcher's black window (Windows): hidden once loading is done, so only the Terminal-or-Web screen shows. It comes
back by itself whenever the helper needs you (it writes ~/.trading-platform/helper-needs-you while it waits: first-time
Schwab keys, an error) and from the tray menu ("Show helper window"). Only when the launcher asked for it
(TP_HIDE_CONSOLE, Windows); elsewhere everything here does nothing. Standard library only.
"""
import os
import sys
from pathlib import Path

FLAG = 'TP_HIDE_CONSOLE'
NEEDS_YOU = Path.home() / '.trading-platform' / 'helper-needs-you'


def managed(env=None, platform=None):
    """True when this app hides the launcher's window and looks after the helper's life (tray, Quit stops it)."""
    env = os.environ if env is None else env
    return (platform or sys.platform) == 'win32' and bool(env.get(FLAG))


def _hwnd():
    if sys.platform != 'win32':
        return None
    try:
        import ctypes
        return ctypes.windll.kernel32.GetConsoleWindow() or None
    except Exception:
        return None


def visible():
    hwnd = _hwnd()
    if not hwnd:
        return False
    import ctypes
    return bool(ctypes.windll.user32.IsWindowVisible(hwnd))


def show():
    hwnd = _hwnd()
    if hwnd:
        import ctypes
        ctypes.windll.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        ctypes.windll.user32.SetForegroundWindow(hwnd)


def hide():
    """Hides the window unless the helper is waiting for you in it."""
    hwnd = _hwnd()
    if hwnd and not helper_needs_you():
        import ctypes
        ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE


REQUEST = Path.home() / '.trading-platform' / 'helper-window'


def request_helper_window(what, path=REQUEST):
    """Asks the helper (running hidden in its own window) to 'show' or 'hide' it; it does so within a second."""
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(what)
    except OSError:
        pass


def helper_needs_you(path=NEEDS_YOU):
    return Path(path).exists()
