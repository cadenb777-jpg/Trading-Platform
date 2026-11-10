"""
The desktop app: your website in its own window, drawn by Qt WebEngine (Chromium, the engine inside Chrome), so every
page, chart, colour, the ticker tape and Bull are exactly the website's (the same code, live from GitHub Pages, updated
the moment the website is). It talks to the same helper as the website (ws://127.0.0.1:8765), so data, alerts and the
Trade page (preview, then confirm; Test first) work exactly as in Chrome.

What the window adds: it remembers its size, place and zoom; Ctrl + / Ctrl - / Ctrl 0 zoom; F5 or Ctrl+R reloads;
F11 full screen; Alt+Left / Alt+Right go back and forward. Links to other sites (news, SEC, fund pages) open in your
normal browser; downloads ask where to save; alerts show as desktop notifications; printing opens the print dialog.
Your settings in this window (watchlist, layouts, Bull) are kept in ~/.trading-platform/desktop-browser.
"""
import argparse
import sys
from pathlib import Path

from PySide6.QtCore import QSettings, QStandardPaths, QTimer, QUrl, Qt
from PySide6.QtGui import QColor, QDesktopServices, QIcon, QKeySequence, QPainter, QPixmap, QPolygonF, QShortcut
from PySide6.QtCore import QPointF
from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow, QSystemTrayIcon

from . import APP_VERSION, policy

DATA = Path.home() / '.trading-platform' / 'desktop-browser'
#: Every app window (the main one and pop-ups, also pop-ups of pop-ups): closing the main window closes them all.
WINDOWS = []
ZOOMS = [0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]

OFFLINE_PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#0a1a2e;color:#e8eef6;font:16px/1.5 system-ui,Segoe UI,Arial}
.box{max-width:520px;padding:32px;border:1px solid #23395a;border-radius:14px;background:#0f2238}
h1{margin:0 0 8px;font-size:22px;color:#f2a93b;font-weight:600}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:8px;
background:#7ac3ee;color:#0a1a2e;text-decoration:none;font-weight:600}p{margin:6px 0;color:#b9c6d6}</style></head><body><div class="box">
<h1>Can't reach the platform</h1><p>The app shows your website, so it needs the internet. Check your connection.</p>
<p>It tries again by itself every 15 seconds.</p><a href="%s">Try again now</a></div></body></html>"""


ASSETS = Path(__file__).resolve().parent / 'assets'
APP_NAME = 'Trading Terminal'


def app_icon():
    """The Trading Terminal logo (assets/logo.ico on Windows has every size; logo.png elsewhere); a drawn diamond if
    the files are missing."""
    for name in (('logo.ico', 'logo.png') if sys.platform == 'win32' else ('logo.png',)):
        if (ASSETS / name).exists():
            return QIcon(str(ASSETS / name))
    pm = QPixmap(64, 64)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor('#7ac3ee'))
    p.setPen(Qt.NoPen)
    p.drawPolygon(QPolygonF([QPointF(32, 4), QPointF(60, 32), QPointF(32, 60), QPointF(4, 32)]))
    p.end()
    return QIcon(pm)


def open_outside(url):
    """A link leaving the app goes to your browser (or e-mail) only if it is a web page or e-mail address; file:, network
    shares and program links (which a hostile news feed could plant) are ignored."""
    text = url.toString()
    if policy.opens_externally(text):
        QDesktopServices.openUrl(url)
    else:
        print(f'Ignored a link the app does not open: {text[:120]}', file=sys.stderr)


def build_profile(app, storage=DATA):
    """One persistent browser profile (local storage, cookies and cache kept between starts)."""
    from PySide6.QtWebEngineCore import QWebEngineProfile, QWebEngineSettings

    storage = Path(storage).expanduser().resolve()  # Chromium needs absolute folders for its storage and cache
    storage.mkdir(parents=True, exist_ok=True)
    profile = QWebEngineProfile('TradingPlatform', app)
    profile.setPersistentStoragePath(str(storage / 'storage'))
    profile.setCachePath(str(storage / 'cache'))
    profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.DiskHttpCache)
    profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)
    s = profile.settings()
    for attr, on in ((QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False),  # alert sounds play
                     (QWebEngineSettings.WebAttribute.JavascriptCanAccessClipboard, True),
                     (QWebEngineSettings.WebAttribute.JavascriptCanPaste, True),
                     (QWebEngineSettings.WebAttribute.JavascriptCanOpenWindows, True),
                     (QWebEngineSettings.WebAttribute.LocalStorageEnabled, True),
                     (QWebEngineSettings.WebAttribute.ScrollAnimatorEnabled, True),
                     (QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True)):
        s.setAttribute(attr, on)
    s.setUnknownUrlSchemePolicy(QWebEngineSettings.UnknownUrlSchemePolicy.DisallowUnknownUrlSchemes)  # no program links
    return profile


class Page:
    """Factory for a QWebEnginePage that keeps the website inside the app and sends other sites to the browser."""

    @staticmethod
    def make(profile, owner, base):
        from PySide6.QtWebEngineCore import QWebEnginePage, QWebEnginePermission

        class _Page(QWebEnginePage):
            def acceptNavigationRequest(self, url, nav_type, is_main_frame):
                if not is_main_frame or policy.stays_in_app(url.toString(), base):
                    return True
                open_outside(url)  # news, SEC, fund sites, the helper guide: your normal browser
                return False

            def javaScriptConsoleMessage(self, level, message, line, source):
                if owner.console_log is not None and level == QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel:
                    owner.console_log.append(f'{message} ({source}:{line})')

        page = _Page(profile, owner)

        def on_permission(perm):
            kinds = (QWebEnginePermission.PermissionType.Notifications, QWebEnginePermission.PermissionType.ClipboardReadWrite)
            if perm.permissionType() in kinds and policy.origin_allowed(perm.origin().toString(), base):
                perm.grant()
            else:
                perm.deny()

        page.permissionRequested.connect(on_permission)
        page.newWindowRequested.connect(owner.on_new_window)
        page.printRequested.connect(lambda: owner.print_page(page))
        page.fullScreenRequested.connect(lambda req: (req.accept(), owner.showFullScreen() if req.toggleOn() else owner.showNormal()))
        # if the page's process ever crashes, it reloads a second later instead of staying blank
        page.renderProcessTerminated.connect(lambda *_: QTimer.singleShot(1000, lambda: page.triggerAction(QWebEnginePage.WebAction.Reload)))
        return page


class Window(QMainWindow):
    """A window showing the website (the main window, or one the website opened for itself, like the AI pop-out)."""

    def __init__(self, app, profile, base, url=None, main=False, console_log=None, size=None):
        from PySide6.QtWebEngineWidgets import QWebEngineView

        super().__init__()
        self.app, self.profile, self.base, self.main = app, profile, base, main
        self.console_log = console_log
        self.children_windows = []
        WINDOWS.append(self)
        self.view = QWebEngineView(self)
        self.page = Page.make(profile, self, base)
        self.view.setPage(self.page)
        self.setCentralWidget(self.view)
        self.setWindowIcon(app_icon())
        self.setWindowTitle(APP_NAME)
        self.view.titleChanged.connect(lambda t: self.setWindowTitle(window_title(t)))
        self.settings = QSettings('TradingPlatform', 'Desktop')
        self.retry = QTimer(self, interval=15000, singleShot=True, timeout=self.go_home)
        self.page.loadingChanged.connect(self.on_loading)
        self.view.printFinished.connect(lambda ok: setattr(self, 'printer', None))
        self.shortcuts()
        if main:
            geo = self.settings.value('geometry')
            if size:
                self.resize(*size)
            elif geo is None or not self.restoreGeometry(geo):
                self.resize(1440, 900)
            if not size and self.settings.value('maximized', False, type=bool):
                self.setWindowState(Qt.WindowMaximized)
            self.view.setZoomFactor(float(self.settings.value('zoom', 1.0)))
        if url is not None:
            self.view.setUrl(QUrl(url))

    # ----- keys (none the website itself uses) -----
    def shortcuts(self):
        def key(seq, fn):
            QShortcut(QKeySequence(seq), self, activated=fn, context=Qt.WindowShortcut)
        from PySide6.QtWebEngineCore import QWebEnginePage

        key('F5', self.view.reload)
        key('Ctrl+R', self.view.reload)
        key('Ctrl+Shift+R', lambda: self.view.triggerPageAction(QWebEnginePage.WebAction.ReloadAndBypassCache))
        key('F11', lambda: self.showNormal() if self.isFullScreen() else self.showFullScreen())
        key('Ctrl+=', lambda: self.zoom(+1))
        key('Ctrl++', lambda: self.zoom(+1))
        key('Ctrl+-', lambda: self.zoom(-1))
        key('Ctrl+0', lambda: self.zoom(0))
        key('Alt+Left', self.view.back)
        key('Alt+Right', self.view.forward)

    def zoom(self, step):
        now = self.view.zoomFactor()
        if step == 0:
            z = 1.0
        else:
            idx = min(range(len(ZOOMS)), key=lambda i: abs(ZOOMS[i] - now))
            z = ZOOMS[max(0, min(len(ZOOMS) - 1, idx + step))]
        self.view.setZoomFactor(z)
        if self.main:
            self.settings.setValue('zoom', z)

    # ----- loading -----
    def go_home(self):
        self.view.setUrl(QUrl(self.base))

    def on_loading(self, info):
        """A real failure to load the website (no internet, server down) shows the "Can't reach" page, which retries.
        A navigation the app itself stopped (a link it opened in your browser) changes nothing."""
        from PySide6.QtWebEngineCore import QWebEngineLoadingInfo

        if not self.main or info.status() != QWebEngineLoadingInfo.LoadStatus.LoadFailedStatus:
            return
        if policy.shows_offline_page(info.url().toString(), info.errorCode(), info.isErrorPage(), self.base):
            self.view.setHtml(OFFLINE_PAGE % self.base, QUrl('about:blank'))
            self.retry.start()

    # ----- windows the website opens -----
    def on_new_window(self, request):
        url = request.requestedUrl().toString()
        if policy.new_window_kind(url, self.base) == 'external':
            open_outside(request.requestedUrl())
            return
        geo = request.requestedGeometry()
        win = Window(self.app, self.profile, self.base, console_log=self.console_log)
        win.resize(geo.width() if geo.width() > 100 else 900, geo.height() if geo.height() > 100 else 700)
        request.openIn(win.page)
        self.children_windows.append(win)
        win.destroyed.connect(lambda *_: self.children_windows.remove(win) if win in self.children_windows else None)
        win.setAttribute(Qt.WA_DeleteOnClose)
        win.show()

    # ----- printing (client reports, the prospects comparison) -----
    def print_page(self, page):
        from PySide6.QtPrintSupport import QPrintDialog, QPrinter

        self.printer = QPrinter(QPrinter.HighResolution)
        if QPrintDialog(self.printer, self).exec():
            self.view.print(self.printer)
        else:
            self.printer = None

    def closeEvent(self, event):
        if self.main:
            self.settings.setValue('maximized', self.isMaximized())
            if not self.isMaximized() and not self.isFullScreen():
                self.settings.setValue('geometry', self.saveGeometry())
            for w in list(WINDOWS):  # every pop-up, also ones opened from a pop-up
                if w is not self:
                    w.close()
        if self in WINDOWS:
            WINDOWS.remove(self)
        super().closeEvent(event)


def window_title(page_title):
    """"Research · Trading Terminal" from the website's "Research · Trading Platform" (or just the app's name)."""
    t = (page_title or '').replace('Trading Platform', '').strip(' ·-—|')
    return f'{t} · {APP_NAME}' if t and t != 'about:blank' and not t.startswith('http') else APP_NAME


def splash_pixmap():
    """The start-up card: the logo, the name and a calm "loading" line on the website's navy."""
    from PySide6.QtGui import QFont, QLinearGradient

    w, h = 560, 300
    pm = QPixmap(w, h)
    pm.fill(QColor('#071222'))
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    g = QLinearGradient(0, 0, w, h)
    g.setColorAt(0, QColor('#14365e'))
    g.setColorAt(1, QColor('#071222'))
    p.setBrush(g)
    p.setPen(QColor('#2c4f7a'))
    p.drawRoundedRect(1, 1, w - 2, h - 2, 18, 18)
    logo = QPixmap(str(ASSETS / 'logo.png')) if (ASSETS / 'logo.png').exists() else app_icon().pixmap(128, 128)
    p.drawPixmap(44, (h - 128) // 2 - 10, logo.scaled(128, 128, Qt.KeepAspectRatio, Qt.SmoothTransformation))
    title = QFont('Segoe UI' if sys.platform == 'win32' else 'Helvetica', 26)
    title.setWeight(QFont.DemiBold)
    p.setFont(title)
    p.setPen(QColor('#f2f6fb'))
    p.drawText(200, 128, 'Trading Terminal')
    small = QFont(title.family(), 11)
    small.setLetterSpacing(QFont.PercentageSpacing, 112)
    p.setFont(small)
    p.setPen(QColor('#f2a93b'))
    p.drawText(202, 156, 'MARKETS · RESEARCH · TRADING')
    p.setPen(QColor('#9fb3c8'))
    p.drawText(202, 214, f'Loading your markets…   v{APP_VERSION}')
    p.end()
    return pm


def connect_downloads(profile, window_for):
    """Downloads (CSV exports, the diagnostics file, reports) ask where to save, starting in your Downloads folder."""
    def on_download(req):
        folder = Path(QStandardPaths.writableLocation(QStandardPaths.DownloadLocation) or Path.home())
        path, _ = QFileDialog.getSaveFileName(window_for(), 'Save file', str(folder / req.downloadFileName()))
        if not path:
            req.cancel()
            return
        req.setDownloadDirectory(str(Path(path).parent))
        req.setDownloadFileName(Path(path).name)
        req.accept()
    profile.downloadRequested.connect(on_download)


def connect_notifications(profile, app, window_for):
    """The website's alerts (price alerts, setups) as desktop notifications; clicking one brings the window up."""
    tray = QSystemTrayIcon(app_icon(), app)
    tray.setToolTip(APP_NAME)
    if QSystemTrayIcon.isSystemTrayAvailable():
        tray.show()

    def bring_up():
        w = window_for()
        w.showNormal() if w.isMinimized() else None
        w.raise_()
        w.activateWindow()

    tray.messageClicked.connect(bring_up)

    def present(note):
        note.show()
        if tray.isVisible():
            tray.showMessage(note.title() or APP_NAME, note.message(), app_icon(), 10000)
        else:
            QApplication.alert(window_for(), 0)  # flashes the taskbar button where there is no tray

    profile.setNotificationPresenter(present)
    return tray


def helper_answers(port=8765):
    import socket
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


def ensure_helper(url):
    """Opened by the old 1.x launcher (it installs this version but doesn't start the helper): open the helper's start
    file once, in its own window, when nothing answers at two checks 4 and 15 seconds after start (so a helper you
    started yourself and that is still installing or logging in gets time to come up; two at once would clash)."""
    import os
    import subprocess

    def missing():
        return policy.should_start_helper(os.environ, url, helper_answers())

    def second_check():
        if not missing():
            return
        cmd = policy.helper_start_command(Path(__file__).resolve().parents[2] / 'helper', sys.platform)
        if cmd:
            try:
                subprocess.Popen(cmd)
            except OSError as err:
                print(f'Could not open the helper: {err}', file=sys.stderr)

    QTimer.singleShot(4000, lambda: missing() and QTimer.singleShot(11000, second_check))


def main(argv=None):
    parser = argparse.ArgumentParser(prog='tp_desktop', description='Trading Platform desktop app')
    parser.add_argument('--url', default=policy.PLATFORM_URL, help='the website to show (default: the published platform)')
    parser.add_argument('--size', help='window size WxH (checks)')
    parser.add_argument('--screenshot', help='save a picture of the window after --wait seconds, then close (checks)')
    parser.add_argument('--wait', type=float, default=8.0)
    parser.add_argument('--storage', help='browser storage folder (checks)')
    args = parser.parse_args(argv)

    QApplication.setApplicationName(APP_NAME)
    QApplication.setOrganizationName('TradingPlatform')
    if sys.platform == 'win32':  # the taskbar shows the Trading Terminal logo, not Python's
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('TradingPlatform.TradingTerminal')
        except Exception:
            pass
    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setWindowIcon(app_icon())
    app.styleHints().setColorScheme(Qt.ColorScheme.Dark)  # a dark window frame, matching the terminal
    from PySide6.QtWidgets import QSplashScreen

    splash = None if args.screenshot else QSplashScreen(splash_pixmap())
    if splash:
        splash.show()
        app.processEvents()
    profile = build_profile(app, Path(args.storage) if args.storage else DATA)
    size = tuple(int(x) for x in args.size.lower().split('x')) if args.size else None
    console = [] if args.screenshot else None
    win = Window(app, profile, args.url, url=args.url, main=True, console_log=console, size=size)
    connect_downloads(profile, lambda: win)
    tray = connect_notifications(profile, app, lambda: win)
    def reveal(*_):
        if splash and splash.isVisible():
            splash.finish(win)
        if not win.isVisible():
            win.show()
    if not args.screenshot:
        ensure_helper(args.url)
    if splash:
        win.page.loadFinished.connect(reveal)
        QTimer.singleShot(12000, reveal)  # never wait longer than this for a slow connection
    else:
        win.show()
    if args.screenshot:
        def snap():
            win.view.grab().save(args.screenshot)
            for line in console:
                print('console error:', line)
            print(f'version {APP_VERSION}: saved {args.screenshot} ({win.view.url().toString()})')
            app.quit()
        QTimer.singleShot(int(args.wait * 1000), snap)
    code = app.exec()
    tray.hide()
    return code
