"""
The app's own title bar (Windows and Linux; a Mac keeps its native traffic-light buttons): the logo, the page's name and
slim minimise / maximise / close buttons, in the website's colours (it follows light and dark mode). Dragging it moves
the window with the system's own move (so dragging to the top of the screen maximises and to a side snaps it);
double-clicking maximises; the edges of the window still resize it (resize_edges, used by the app's event filter).
"""
from PySide6.QtCore import QPointF, QRectF, QSize, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QAbstractButton, QHBoxLayout, QLabel, QWidget

HEIGHT = 34
EDGE = 6  # px at each window edge that resize instead of clicking the page


def resize_edges(pos, size, edge=EDGE):
    """Which window edges (Qt.Edges) a point in window coordinates is on, for a resize; empty in the middle."""
    from .policy import resize_edges as sides

    names = {'left': Qt.LeftEdge, 'right': Qt.RightEdge, 'top': Qt.TopEdge, 'bottom': Qt.BottomEdge}
    edges = Qt.Edges()
    for side in sides(pos.x(), pos.y(), size.width(), size.height(), edge):
        edges |= names[side]
    return edges


class CaptionButton(QAbstractButton):
    """Minimise, maximise/restore or close, drawn as thin lines (no stock Windows look)."""

    def __init__(self, kind, bar):
        super().__init__(bar)
        self.kind, self.bar = kind, bar
        self.setFixedSize(QSize(46, HEIGHT))
        self.setFocusPolicy(Qt.NoFocus)
        self.setCursor(Qt.ArrowCursor)
        names = {'min': 'Minimise', 'max': 'Maximise', 'close': 'Close'}
        self.setToolTip(names[kind])
        self.setAccessibleName(names[kind])
        self.setAttribute(Qt.WA_Hover)

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        hover, down = self.underMouse(), self.isDown()
        if hover or down:
            if self.kind == 'close':
                p.fillRect(self.rect(), QColor('#b3261e' if down else '#c42b1c'))
            else:
                c = QColor(self.bar.fg)
                c.setAlpha(46 if down else 28)
                p.fillRect(self.rect(), c)
        fg = QColor('#ffffff') if (self.kind == 'close' and (hover or down)) else QColor(self.bar.fg)
        p.setPen(QPen(fg, 1.1))
        c = QPointF(self.width() / 2, self.height() / 2)
        s = 5.0
        if self.kind == 'min':
            p.drawLine(QPointF(c.x() - s, c.y()), QPointF(c.x() + s, c.y()))
        elif self.kind == 'max':
            if self.window().isMaximized():  # restore: two overlapping squares
                p.drawRoundedRect(QRectF(c.x() - s, c.y() - s + 2, 2 * s - 2, 2 * s - 2), 1.5, 1.5)
                p.drawPolyline([QPointF(c.x() - s + 2, c.y() - s), QPointF(c.x() + s, c.y() - s), QPointF(c.x() + s, c.y() + s - 2)])
            else:
                p.drawRoundedRect(QRectF(c.x() - s, c.y() - s, 2 * s, 2 * s), 1.5, 1.5)
        else:
            p.drawLine(QPointF(c.x() - s, c.y() - s), QPointF(c.x() + s, c.y() + s))
            p.drawLine(QPointF(c.x() - s, c.y() + s), QPointF(c.x() + s, c.y() - s))
        p.end()


class TitleBar(QWidget):
    """The bar itself. set_title() shows the page's name; set_colors() follows the website's theme."""

    closing = Signal()

    def __init__(self, window, logo_path=None):
        super().__init__(window)
        self.win = window
        self.bg, self.fg, self.muted, self.line, self.accent = '#050d19', '#e8f1fa', '#8ea3b8', '#16283d', '#f2a93b'
        self.setFixedHeight(HEIGHT)
        self.setAttribute(Qt.WA_StyledBackground, False)
        row = QHBoxLayout(self)
        row.setContentsMargins(12, 0, 0, 0)
        row.setSpacing(8)
        self.logo = QLabel(self)
        if logo_path:
            self.logo.setPixmap(QPixmap(str(logo_path)).scaled(18, 18, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        self.logo.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.name = QLabel('Trading Terminal', self)
        self.name.setAttribute(Qt.WA_TransparentForMouseEvents)
        f = QFont(self.font())
        f.setPointSizeF(9.5)
        f.setWeight(QFont.DemiBold)
        self.name.setFont(f)
        self.title = QLabel('', self)
        self.title.setAttribute(Qt.WA_TransparentForMouseEvents)
        g = QFont(self.font())
        g.setPointSizeF(9.5)
        self.title.setFont(g)
        row.addWidget(self.logo)
        row.addWidget(self.name)
        row.addWidget(self.title)
        row.addStretch(1)
        self.buttons = {k: CaptionButton(k, self) for k in ('min', 'max', 'close')}
        self.buttons['min'].clicked.connect(self.win.showMinimized)
        self.buttons['max'].clicked.connect(self.toggle_max)
        self.buttons['close'].clicked.connect(self.win.close)
        for b in self.buttons.values():
            row.addWidget(b)
        self.apply()

    def set_title(self, text):
        self.title.setText(f'·  {text}' if text else '')

    def set_colors(self, bg, fg, muted=None, line=None):
        new = (bg, fg, muted or self.muted, line or self.line)
        if new != (self.bg, self.fg, self.muted, self.line):
            self.bg, self.fg, self.muted, self.line = new
            self.apply()

    def apply(self):
        self.name.setStyleSheet(f'color:{self.fg}; background:transparent')
        self.title.setStyleSheet(f'color:{self.muted}; background:transparent')
        self.update()
        for b in self.buttons.values():
            b.update()

    def toggle_max(self):
        self.win.showNormal() if self.win.isMaximized() else self.win.showMaximized()

    def paintEvent(self, e):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(self.bg))
        p.setPen(QColor(self.line))
        p.drawLine(0, self.height() - 1, self.width(), self.height() - 1)
        p.end()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton and self.win.windowHandle() is not None:
            self.win.windowHandle().startSystemMove()  # the system's own move: snap and drag-to-maximise work
            e.accept()

    def mouseDoubleClickEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.toggle_max()
