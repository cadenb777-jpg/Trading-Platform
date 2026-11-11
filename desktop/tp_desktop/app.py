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

from PySide6.QtCore import QEvent, QObject, QSettings, QStandardPaths, QTimer, QUrl, Qt
from PySide6.QtGui import QColor, QDesktopServices, QIcon, QKeySequence, QPainter, QPixmap, QPolygonF, QShortcut
from PySide6.QtCore import QPointF
from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow, QSystemTrayIcon, QVBoxLayout, QWidget

from . import APP_VERSION, choice, console, policy
from .titlebar import DESKTOP_JS, DRAG, KEEP_CLEAR_JS, MAXIMISE, SUGGEST_JS, SUGGESTIONS, CaptionButtons

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
#: The main window has no classic Windows frame: its minimise / maximise / close sit inside the platform's own top bar
#: (titlebar.py), like a game client. A Mac keeps its own buttons.
OWN_TITLE_BAR = sys.platform != 'darwin'
#: The website's colours for those buttons and the page background (no white anywhere, also between pages), plus the top
#: bar's height; read again every 1.5 s so they follow light and dark mode.
#: (Joined with | because PySide gives JavaScript arrays back as empty text.)
THEME_JS = ("(() => { if (!(document.documentElement instanceof Element)) return ''; "
            "const s = getComputedStyle(document.documentElement); "
            "const top = document.querySelector('.shell-top'); "
            "return ['--text', '--label', '--bg', '--line'].map((k) => s.getPropertyValue(k).trim())"
            ".concat([top ? String(top.getBoundingClientRect().height) : '']).join('|'); })()")
#: What the window's graphics card does (written to ~/.trading-platform/desktop-graphics.txt on each start, for help).
GPU_JS = ("(() => { try { const g = document.createElement('canvas').getContext('webgl'); "
          "const d = g.getExtension('WEBGL_debug_renderer_info'); "
          "return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (e) { return 'no WebGL: ' + e; } })()")


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
                     (QWebEngineSettings.WebAttribute.ScrollAnimatorEnabled, False),  # its animated scrolling stuttered
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
                if message in (DRAG, MAXIMISE, SUGGESTIONS) and policy.is_platform(self.url().toString(), base):
                    if message == SUGGESTIONS:
                        QTimer.singleShot(150, lambda: watch_suggestion_popups(owner))
                    elif getattr(owner, 'caps', None):
                        owner.window_gesture(message)
                    return
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
        self.page.setBackgroundColor(QColor('#050d19'))  # the website's navy, never white, while a page draws
        self.view.setPage(self.page)
        self.caps = None
        bg = QColor('#050d19')
        if OWN_TITLE_BAR and main:
            from PySide6.QtGui import QPalette
            from PySide6.QtWebEngineCore import QWebEngineScript

            self.setWindowFlags(self.windowFlags() | Qt.FramelessWindowHint)
            self.holder = QWidget(self)
            pal = self.holder.palette()
            pal.setColor(QPalette.Window, bg)
            self.holder.setPalette(pal)
            self.holder.setAutoFillBackground(True)  # nothing white, ever, around or behind the page
            box = QVBoxLayout(self.holder)
            box.setContentsMargins(0, 0, 0, 0)
            box.setSpacing(0)
            box.addWidget(self.view)
            self.setCentralWidget(self.holder)
            self.caps = CaptionButtons(self, self.holder)
            add_page_script(self.page, 'tp-desktop-window', DESKTOP_JS)
            add_page_script(self.page, 'tp-keep-clear', KEEP_CLEAR_JS)
            self.theme_timer = QTimer(self, interval=3000, timeout=self.follow_theme)
            self.theme_timer.start()
            self.page.loadFinished.connect(lambda *_: self.follow_theme())
        else:
            self.setCentralWidget(self.view)
        pal = self.palette()
        pal.setColor(pal.ColorRole.Window, bg)
        self.setPalette(pal)
        add_page_script(self.page, 'tp-suggestions', SUGGEST_JS)
        self.setWindowIcon(app_icon())
        self.setWindowTitle(APP_NAME)
        self.view.titleChanged.connect(self.on_title)
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

    # ----- the built-in window buttons -----
    def on_title(self, t):
        self.setWindowTitle(window_title(t))

    def follow_theme(self):
        from PySide6.QtWebEngineCore import QWebEngineScript

        def got(text):
            values = str(text or '').split('|')
            if len(values) < 5 or not all(QColor(v).isValid() for v in values[:4]):
                return
            fg, amber, bg, line, top = values[:5]
            if line != self.caps.line:
                self.caps.set_colors(fg, amber, line)
                self.update_border()
            else:
                self.caps.set_colors(fg, amber, line)
            if self.page.backgroundColor() != QColor(bg):  # only on a theme change: setting it redraws the page
                self.page.setBackgroundColor(QColor(bg))
            pal = self.holder.palette()
            if pal.color(pal.ColorRole.Window) != QColor(bg):
                pal.setColor(pal.ColorRole.Window, QColor(bg))
                self.holder.setPalette(pal)
            try:
                height = float(top) * self.view.zoomFactor()
            except ValueError:
                height = None  # a page without the top bar: keep the last height
            self.caps.place(height)
        self.page.runJavaScript(THEME_JS, QWebEngineScript.ScriptWorldId.ApplicationWorld, got)

    def window_gesture(self, what):
        """The page's top bar was pressed (move the window) or double-clicked (maximise / restore)."""
        if what == MAXIMISE:
            self.caps.toggle_max()
        elif self.windowHandle() is not None and not self.isFullScreen():
            self.windowHandle().startSystemMove()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self.caps:
            self.caps.place()

    def changeEvent(self, event):
        if self.caps and event.type() == QEvent.WindowStateChange:
            self.caps.setVisible(not self.isFullScreen())
            self.caps.place()
            self.update_border()
        super().changeEvent(event)

    def update_border(self):
        fills = self.isMaximized() or self.isFullScreen()
        window_border(self, None if fills else self.caps.line)

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
        EdgeResizer.attach(win)
        round_corners(win)

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


def add_page_script(page, name, source):
    """Runs a small script of the app's in every page load of this window (before the website's own code)."""
    from PySide6.QtWebEngineCore import QWebEngineScript

    script = QWebEngineScript()
    script.setName(name)
    script.setSourceCode(source)
    script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
    script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
    script.setRunsOnSubFrames(False)
    page.scripts().insert(script)


class EnterThrough(QObject):
    """Qt's suggestion list under a text box (the ticker box) takes the Enter key, so the page never saw it and the chart
    didn't change (Chrome lets it through). After the list has handled Enter (filling in a suggestion you arrowed to),
    the same Enter goes on to the page."""

    def __init__(self, popup, owner):
        super().__init__(popup)
        self.owner = owner

    def eventFilter(self, obj, event):
        if event.type() == QEvent.KeyPress and event.key() in (Qt.Key_Return, Qt.Key_Enter):
            QTimer.singleShot(60, self.forward)
        return False

    def forward(self):
        from PySide6.QtGui import QKeyEvent

        view = getattr(self.owner, 'view', None)
        target = view.focusProxy() if view is not None else None
        if target is None:
            return
        for kind in (QEvent.KeyPress, QEvent.KeyRelease):
            QApplication.postEvent(target, QKeyEvent(kind, Qt.Key_Return, Qt.NoModifier, '\r'))


def watch_suggestion_popups(owner):
    for w in QApplication.topLevelWidgets():
        if 'Autofill' in w.metaObject().className() and not getattr(w, '_tp_enter', None):
            w._tp_enter = EnterThrough(w, owner)
            w.installEventFilter(w._tp_enter)


class EdgeResizer(QObject):
    """Resizing a window that draws its own title bar: near an edge the pointer becomes a resize arrow and dragging there
    resizes with the system's own resize (the page under it doesn't get that click). It watches only that window's
    own system window (not every event in the app), so it costs nothing while you use the page."""

    def __init__(self, win):
        super().__init__(win)
        self.win = win
        self.app = QApplication.instance()
        self.shown = None

    @classmethod
    def attach(cls, win):
        if win.caps is not None:
            win.winId()  # makes the system window now
            win.windowHandle().installEventFilter(cls(win))

    def target(self, obj):
        win = self.win
        return None if (win.isMaximized() or win.isFullScreen()) else win

    def cursor_for(self, edges):
        if edges in ((Qt.LeftEdge | Qt.TopEdge), (Qt.RightEdge | Qt.BottomEdge)):
            return Qt.SizeFDiagCursor
        if edges in ((Qt.RightEdge | Qt.TopEdge), (Qt.LeftEdge | Qt.BottomEdge)):
            return Qt.SizeBDiagCursor
        if edges & (Qt.LeftEdge | Qt.RightEdge):
            return Qt.SizeHorCursor
        return Qt.SizeVerCursor

    def show_cursor(self, shape):
        if shape == self.shown:
            return
        if self.shown is not None:
            self.app.restoreOverrideCursor()
        if shape is not None:
            self.app.setOverrideCursor(shape)
        self.shown = shape

    def eventFilter(self, obj, event):
        kind = event.type()
        if kind not in (QEvent.MouseMove, QEvent.MouseButtonPress):
            return False
        from .titlebar import resize_edges

        win = self.target(obj)
        if win is None:
            if kind == QEvent.MouseMove:
                self.show_cursor(None)
            return False
        edges = resize_edges(win.mapFromGlobal(event.globalPosition().toPoint()), win.size())
        if kind == QEvent.MouseMove:
            self.show_cursor(self.cursor_for(edges) if edges else None)
            return False
        if edges and event.button() == Qt.LeftButton and win.windowHandle() is not None:
            self.show_cursor(None)
            win.windowHandle().startSystemResize(edges)
            return True
        return False


def round_corners(win):
    """Windows 11: rounded corners and the system's thin border colour for a window without the classic frame."""
    if sys.platform != 'win32':
        return
    try:
        import ctypes

        pref = ctypes.c_int(2)  # DWMWCP_ROUND
        ctypes.windll.dwmapi.DwmSetWindowAttribute(int(win.winId()), 33, ctypes.byref(pref), ctypes.sizeof(pref))
    except Exception:
        pass  # Windows 10: square corners
    if getattr(win, 'caps', None):
        win.update_border()


def window_border(win, color):
    """Windows 11 draws a thin light border around every window: none when it fills the screen, else the site's line
    colour (`color` '#rrggbb', or None for no border). Windows 10 has no such border."""
    if sys.platform != 'win32':
        return
    try:
        import ctypes

        if color is None:
            value = 0xFFFFFFFE  # DWMWA_COLOR_NONE
        else:
            c = QColor(color)
            value = c.red() | (c.green() << 8) | (c.blue() << 16)  # COLORREF 0x00BBGGRR
        ref = ctypes.c_uint(value)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(int(win.winId()), 34, ctypes.byref(ref), ctypes.sizeof(ref))  # BORDER_COLOR
    except Exception:
        pass


def note_graphics(page):
    """Writes which graphics the window draws with (the card's name, or SwiftShader = no card) for help."""
    def save(renderer):
        try:
            (Path.home() / '.trading-platform' / 'desktop-graphics.txt').write_text(f'{renderer}\n', encoding='utf-8')
        except OSError:
            pass
    from PySide6.QtWebEngineCore import QWebEngineScript

    page.runJavaScript(GPU_JS, QWebEngineScript.ScriptWorldId.ApplicationWorld, save)


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
        if w is None:  # Web: no app window, the browser shows the alert
            return
        w.showNormal() if w.isMinimized() else None
        w.raise_()
        w.activateWindow()

    tray.messageClicked.connect(bring_up)

    def present(note):
        note.show()
        if tray.isVisible():
            tray.showMessage(note.title() or APP_NAME, note.message(), app_icon(), 10000)
        elif window_for() is not None:
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


def ask_how_to_open(app, force_ask):
    """'terminal' or 'web': the remembered choice, or the start screen's answer (None when it was closed)."""
    from PySide6.QtCore import QEventLoop
    from PySide6.QtGui import QGuiApplication

    shift = bool(QGuiApplication.queryKeyboardModifiers() & Qt.ShiftModifier)
    saved = choice.remembered()
    how = choice.decide(saved, force_ask, shift)
    if how:
        return how
    from .chooser import Chooser

    answer = []
    screen = Chooser(preselect=saved or 'terminal')
    loop = QEventLoop()
    screen.chosen.connect(lambda c, keep: answer.append((c, keep)))
    screen.destroyed.connect(loop.quit)
    screen.setAttribute(Qt.WA_DeleteOnClose)
    screen.show()
    screen.raise_()
    screen.activateWindow()
    loop.exec()
    if not answer:
        return None
    how, keep = answer[0]
    try:
        choice.remember(how if keep else None)
    except OSError as err:
        print(f'Could not remember the choice: {err}', file=sys.stderr)
    return how


def open_in_browser(url):
    """Web: the platform in your usual browser; when nothing looks after the helper yet, its start file opens too (the
    page connects to it as soon as it is up)."""
    import os
    import subprocess

    if policy.should_start_helper(os.environ, url, helper_answers()):
        cmd = policy.helper_start_command(Path(__file__).resolve().parents[2] / 'helper', sys.platform)
        if cmd:
            try:
                subprocess.Popen(cmd)
            except OSError as err:
                print(f'Could not open the helper: {err}', file=sys.stderr)
    QDesktopServices.openUrl(QUrl(url))


def main(argv=None):
    parser = argparse.ArgumentParser(prog='tp_desktop', description='Trading Platform desktop app')
    parser.add_argument('--url', default=policy.PLATFORM_URL, help='the website to show (default: the published platform)')
    parser.add_argument('--size', help='window size WxH (checks)')
    parser.add_argument('--screenshot', help='save a picture of the window after --wait seconds, then close (checks)')
    parser.add_argument('--wait', type=float, default=8.0)
    parser.add_argument('--storage', help='browser storage folder (checks)')
    parser.add_argument('--choose', action='store_true', help='ask Terminal or Web even when a choice is remembered')
    args = parser.parse_args(argv)

    import os

    os.environ['QTWEBENGINE_CHROMIUM_FLAGS'] = policy.chromium_flags(os.environ.get('QTWEBENGINE_CHROMIUM_FLAGS', ''))
    QApplication.setAttribute(Qt.AA_ShareOpenGLContexts)  # Qt WebEngine draws fastest with shared graphics contexts
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
    if not args.screenshot and console.managed() and hand_over_to_running_app(args.choose, instance_name(args.url)):
        return 0  # already open in the tray: it brought its window back, and its helper is already warm
    if args.screenshot:
        how = 'terminal'
    else:
        if console.managed():
            console.hide()  # loading is done: only the start screen shows (the helper keeps running, hidden)
        app.setQuitOnLastWindowClosed(False)  # the start screen closing isn't the app closing
        how = ask_how_to_open(app, args.choose)
        app.setQuitOnLastWindowClosed(True)
        if how is None:
            return 0  # the start screen was closed without a choice
    stays = console.managed()  # this app looks after the hidden helper: a tray icon, and Quit stops it
    if how == 'web':
        open_in_browser(args.url)
        if not stays:
            return 0
    if stays:
        # The app lives on in the tray with the helper warm: closing the window doesn't quit (Quit in the tray menu does)
        app.setQuitOnLastWindowClosed(False)
    from PySide6.QtWidgets import QSplashScreen

    profile = build_profile(app, Path(args.storage) if args.storage else DATA)
    size = tuple(int(x) for x in args.size.lower().split('x')) if args.size else None
    log = [] if args.screenshot else None
    held = {}

    def current():
        win = held.get('win')
        return win if win is not None and win in WINDOWS else None

    def open_window(first=False):
        """The Terminal window (made once; brought to the front if it's open)."""
        win = current()
        if win is not None:
            win.showNormal() if win.isMinimized() else None
            win.raise_()
            win.activateWindow()
            return win
        splash = QSplashScreen(splash_pixmap()) if (first and not args.screenshot) else None
        if splash:
            splash.show()
            app.processEvents()
        win = Window(app, profile, args.url, url=args.url, main=True, console_log=log, size=size)
        win.setAttribute(Qt.WA_DeleteOnClose, stays)  # closed to the tray: frees it, the next one is made fresh
        if stays:
            win.destroyed.connect(lambda *_: told_tray(tray))
        held['win'] = win
        EdgeResizer.attach(win)
        win.page.loadFinished.connect(lambda ok: ok and note_graphics(win.page))

        def reveal(*_):
            if splash and splash.isVisible():
                splash.finish(win)
            if not win.isVisible():
                win.show()
                round_corners(win)
        if splash:
            win.page.loadFinished.connect(reveal)
            QTimer.singleShot(12000, reveal)  # never wait longer than this for a slow connection
        else:
            reveal()
        return win

    connect_downloads(profile, current)
    tray = connect_notifications(profile, app, current)
    if stays:
        tray_menu(app, tray, args.url, open_window, how)
        listen_for_second_start(app, instance_name(args.url), lambda: open_window() if how == 'terminal' else QDesktopServices.openUrl(QUrl(args.url)))
    if how == 'terminal':
        win = open_window(first=True)
    if not args.screenshot:
        ensure_helper(args.url)
    if args.screenshot:
        def snap():
            win.view.grab().save(args.screenshot)
            for line in log:
                print('console error:', line)
            print(f'version {APP_VERSION}: saved {args.screenshot} ({win.view.url().toString()})')
            app.quit()
        QTimer.singleShot(int(args.wait * 1000), snap)
    code = app.exec()
    tray.hide()
    return code


def tray_menu(app, tray, url, open_window, how):
    """The tray icon's menu when the helper runs hidden: open the platform either way, see the helper's window, quit
    (which stops the helper). A click on the icon opens the way you chose. Every second it brings the helper's window
    back if the helper is waiting for you (first-time keys, an error)."""
    from PySide6.QtGui import QAction
    from PySide6.QtWidgets import QMenu

    menu = QMenu()
    menu.addAction(QAction('Open Trading Terminal', menu, triggered=lambda: open_window()))
    menu.addAction(QAction('Open in your browser', menu, triggered=lambda: QDesktopServices.openUrl(QUrl(url))))
    menu.addSeparator()
    helper = QAction('Show helper window', menu)
    helper.triggered.connect(lambda: console.hide() if console.visible() else console.show())
    menu.addAction(helper)
    menu.addSeparator()
    menu.addAction(QAction('Quit Trading Terminal (stops the helper)', menu, triggered=lambda: quit_all(app)))
    menu.aboutToShow.connect(lambda: helper.setText('Hide helper window' if console.visible() else 'Show helper window'))
    tray.setContextMenu(menu)
    tray.setToolTip(f'{APP_NAME}: the helper is running')
    tray._menu = menu  # keep it alive

    def clicked(reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            open_window() if how == 'terminal' else QDesktopServices.openUrl(QUrl(url))
    tray.activated.connect(clicked)
    if not tray.isVisible():
        tray.show()

    shown = {'needs': False}

    def watch():
        needs = console.helper_needs_you()
        if needs and not shown['needs']:
            console.show()
            tray.showMessage(APP_NAME, 'The helper needs you: its window is open.', app_icon(), 8000)
        shown['needs'] = needs
    timer = QTimer(app, interval=1000, timeout=watch)
    timer.start()
    tray._watch = timer
    if how == 'web':
        tray.showMessage(APP_NAME, 'Opened in your browser. The helper runs here: right-click this icon to quit.', app_icon(), 6000)


INSTANCE = 'TradingTerminal-' + ''.join(ch for ch in (__import__('getpass').getuser() or 'me') if ch.isalnum())[:40]


def instance_name(url):
    """One running copy per platform address: the private copy (this computer's address) and the online one never
    hand over to each other (a private start used to open the online one, offline while the repository is private)."""
    return INSTANCE if policy.is_platform(url, policy.PLATFORM_URL) else INSTANCE + '-private'


def hand_over_to_running_app(choose=False, name=INSTANCE):
    """True when Trading Terminal is already running (in the tray): it is asked to open its window, so this start ends."""
    from PySide6.QtNetwork import QLocalSocket

    sock = QLocalSocket()
    sock.connectToServer(name)
    if not sock.waitForConnected(400):
        return False
    sock.write(b'choose\n' if choose else b'open\n')
    sock.flush()
    sock.waitForBytesWritten(400)
    sock.disconnectFromServer()
    return True


def listen_for_second_start(app, name, open_it):
    """Double-clicking the icon again while the app is in the tray opens its window (no second copy, no second start)."""
    from PySide6.QtNetwork import QLocalServer

    server = QLocalServer(app)
    QLocalServer.removeServer(name)  # a leftover from a copy that crashed
    if not server.listen(name):
        return None

    def incoming():
        conn = server.nextPendingConnection()
        if conn is not None:
            conn.readyRead.connect(lambda: (conn.readAll(), open_it()))
            conn.disconnected.connect(conn.deleteLater)
    server.newConnection.connect(incoming)
    app._tp_server = server
    return server


def told_tray(tray, shown={'done': False}):
    """Once per run: where the app went when its window closed."""
    if not shown['done'] and tray.isVisible():
        shown['done'] = True
        tray.showMessage(APP_NAME, 'Still running here by the clock, so it opens instantly next time. '
                         'Right-click this icon and choose Quit to close it completely.', app_icon(), 7000)


def quit_all(app):
    for w in list(WINDOWS):
        w.close()
    app.quit()
