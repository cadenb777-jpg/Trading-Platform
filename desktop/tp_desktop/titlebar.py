"""
Built-in window controls (Windows and Linux; a Mac keeps its own traffic lights), like a game client's: no separate
title bar at all. Slim minimise / maximise / close buttons sit inside the platform's own top bar, at its right end
(the page makes room for them), in the website's colours. The empty part of that top bar and the TERMINAL logo drag the
window (with the system's own move, so dragging to the top of the screen maximises and to a side snaps); double-clicking
there maximises; the window's edges resize it.

DESKTOP_JS runs in every page load of the main window: it marks the page as the desktop app, makes the room and tells
the app (through a console message only the app reads) when you press or double-click a drag area.
"""
from PySide6.QtCore import QPointF, QRectF, QSize, Qt
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QAbstractButton, QHBoxLayout, QWidget

EDGE = 5  # px at each window edge that resize instead of clicking the page
BUTTON_W = 46
DRAG, MAXIMISE, SUGGESTIONS = '__tp_window_drag__', '__tp_window_max__', '__tp_suggestions__'

DESKTOP_JS = r"""
(() => {
  if (window.__tpDesktop) return;
  window.__tpDesktop = true;
  const room = %d;
  const css = `
    html.tp-desktop .shell-top { padding-right: ${room + 8}px !important; }
    html.tp-desktop .shell-top, html.tp-desktop .brand { -webkit-user-select: none; user-select: none; }`;
  const put = () => {
    if (!document.documentElement) return;  // too early: DOMContentLoaded puts it in
    document.documentElement.classList.add('tp-desktop');
    if (!document.getElementById('tp-desktop-style')) {
      const s = document.createElement('style');
      s.id = 'tp-desktop-style';
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  };
  put();
  document.addEventListener('DOMContentLoaded', put);
  const ACTIVE = 'button, a, input, select, textarea, label, kbd, [role="tab"], [role="button"], [tabindex], .sub-tab, .cmd-field';
  const dragArea = (el) => {
    if (!(el instanceof Element)) return false;
    const area = el.closest('.shell-top, .brand');
    const active = el.closest(ACTIVE);
    return !!area && !(active && area.contains(active));  // a button inside the top bar still clicks
  };
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && e.detail === 1 && dragArea(e.target)) { e.preventDefault(); console.info('%s'); }
  }, true);
  document.addEventListener('dblclick', (e) => { if (dragArea(e.target)) console.info('%s'); }, true);
})();
""" % (3 * BUTTON_W, DRAG, MAXIMISE)

#: Every app window: typing in a box with suggestions (the ticker box) tells the app, which makes sure Enter still
#: reaches the page (app.EnterThrough).
SUGGEST_JS = """
(() => {
  if (window.__tpSuggest) return;
  window.__tpSuggest = true;
  document.addEventListener('input', (e) => { if (e.target && e.target.list) console.info('%s'); }, true);
})();
""" % SUGGESTIONS


def resize_edges(pos, size, edge=EDGE):
    """Which window edges (Qt.Edges) a point in window coordinates is on, for a resize; empty in the middle."""
    from .policy import resize_edges as sides

    names = {'left': Qt.LeftEdge, 'right': Qt.RightEdge, 'top': Qt.TopEdge, 'bottom': Qt.BottomEdge}
    edges = Qt.Edges()
    for side in sides(pos.x(), pos.y(), size.width(), size.height(), edge):
        edges |= names[side]
    return edges


class CaptionButton(QAbstractButton):
    """Minimise, maximise/restore or close in the platform's amber (the colour of its labels): at rest a calm amber line
    icon; on hover an amber glow with a bright underline, like a terminal tab; close turns red (it closes)."""

    def __init__(self, kind, group):
        super().__init__(group)
        self.kind, self.group = kind, group
        self.setFocusPolicy(Qt.NoFocus)
        self.setCursor(Qt.ArrowCursor)
        names = {'min': 'Minimise', 'max': 'Maximise', 'close': 'Close'}
        self.setToolTip(names[kind])
        self.setAccessibleName(names[kind])
        self.setAttribute(Qt.WA_Hover)

    def sizeHint(self):
        return QSize(BUTTON_W, self.group.height())

    def enterEvent(self, e):
        self.update()

    def leaveEvent(self, e):
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        lit, down = self.underMouse(), self.isDown()
        amber = QColor(self.group.amber)
        r = self.rect()
        if self.kind == 'close' and (lit or down):
            p.fillRect(r, QColor('#a8231b' if down else '#c42b1c'))
            icon = QColor('#ffffff')
        elif lit or down:
            glow = QColor(amber)
            glow.setAlpha(56 if down else 34)
            p.fillRect(r, glow)
            p.fillRect(QRectF(8, r.height() - 2, r.width() - 16, 2), amber)  # the terminal-tab underline
            icon = amber.lighter(115)
        else:
            icon = QColor(amber)
            icon.setAlpha(205)
        p.setPen(QPen(icon, 1.5, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin))
        c = QPointF(r.width() / 2, r.height() / 2 - 0.5)
        s = 5.0
        if self.kind == 'min':
            p.drawLine(QPointF(c.x() - s, c.y() + 3), QPointF(c.x() + s, c.y() + 3))
        elif self.kind == 'max':
            if self.window().isMaximized():  # restore: two overlapping squares
                p.drawRoundedRect(QRectF(c.x() - s, c.y() - s + 2.5, 2 * s - 2.5, 2 * s - 2.5), 1.5, 1.5)
                p.drawPolyline([QPointF(c.x() - s + 2.5, c.y() - s), QPointF(c.x() + s, c.y() - s), QPointF(c.x() + s, c.y() + s - 2.5)])
            else:
                p.drawRoundedRect(QRectF(c.x() - s, c.y() - s, 2 * s, 2 * s), 2, 2)
        else:
            p.drawLine(QPointF(c.x() - s, c.y() - s), QPointF(c.x() + s, c.y() + s))
            p.drawLine(QPointF(c.x() - s, c.y() + s), QPointF(c.x() + s, c.y() - s))
        p.end()


class CaptionButtons(QWidget):
    """The three buttons, laid over the top-right corner of the page (no background of their own: the page's top bar
    shows through). place() keeps them in the corner at the top bar's height; set_colors() follows the theme."""

    def __init__(self, window, parent):
        super().__init__(parent)
        self.win = window
        self.fg, self.amber, self.line = '#e8f1fa', '#f2b23a', '#17304b'
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)
        self.buttons = {k: CaptionButton(k, self) for k in ('min', 'max', 'close')}
        self.buttons['min'].clicked.connect(self.win.showMinimized)
        self.buttons['max'].clicked.connect(self.toggle_max)
        self.buttons['close'].clicked.connect(self.win.close)
        for b in self.buttons.values():
            row.addWidget(b)
        self.bar_height = 44

    def toggle_max(self):
        self.win.showNormal() if self.win.isMaximized() else self.win.showMaximized()

    def set_colors(self, fg, amber, line):
        if (fg, amber, line) != (self.fg, self.amber, self.line):
            self.fg, self.amber, self.line = fg, amber, line
            self.update()
            for b in self.buttons.values():
                b.update()

    def paintEvent(self, e):
        """A thin divider in the site's line colour sets the buttons apart from the page's own controls."""
        p = QPainter(self)
        p.setPen(QColor(self.line))
        p.drawLine(0, 10, 0, self.height() - 10)
        p.end()

    def place(self, height=None):
        if height:
            self.bar_height = max(28, min(80, int(round(height))))
        h = self.bar_height - 1  # the top bar's bottom line stays visible
        for b in self.buttons.values():
            b.setFixedSize(BUTTON_W, h)
        self.setFixedSize(3 * BUTTON_W, h)
        parent = self.parentWidget()
        self.move(parent.width() - self.width(), 0)
        self.raise_()
        for b in self.buttons.values():
            b.update()
