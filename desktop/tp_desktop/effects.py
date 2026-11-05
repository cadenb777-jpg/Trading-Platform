"""
Smooth effects for the desktop app, painted by Qt so they glide:
- FlowBackground: the website's flowing background (dark blue, blue, sky, orange, amber shapes drifting and breathing
  on slow loops of 50-95 s), repainted about 30 times a second, with the major grid lines on top;
- TickerTape: quotes scrolling right to left at about 60 frames a second; hover pauses it, click a symbol to chart it.
"""
import math
import time

from PySide6.QtCore import QPointF, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QFontMetrics, QPainter, QRadialGradient
from PySide6.QtWidgets import QWidget

from .theme import C

# colour, alpha (0-255), path from (x0, y0) to (x1, y1) as fractions of the window, seconds to move, seconds to breathe
SHAPES = [
    ('#0b3a8a', 112, (0.55, 0.55), (0.35, 0.40), 70, 23),
    ('#1f6fc4', 80, (0.15, 0.20), (0.45, 0.75), 85, 19),
    ('#5fb2ea', 48, (0.90, 0.10), (0.65, 0.35), 60, 29),
    ('#e8793a', 66, (0.08, 0.95), (0.40, 0.60), 95, 17),
    ('#f0a05a', 44, (0.95, 0.80), (0.70, 0.50), 52, 26),
]


def shape_at(shape, t):
    """Where a shape is and how bright at time t (seconds): eased back and forth like CSS `alternate`."""
    _, alpha, (x0, y0), (x1, y1), move, pulse = shape
    k = (1 - math.cos(math.pi * ((t / move) % 2))) / 2  # 0 -> 1 -> 0, eased
    b = (1 - math.cos(math.pi * ((t / pulse) % 2))) / 2
    return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, alpha * (0.55 + 0.45 * b)


class FlowBackground(QWidget):
    """The window's root: paints the flowing colours behind every page (the Chart page covers it with its chart)."""

    def __init__(self):
        super().__init__()
        self.setObjectName('root')
        self.setAttribute(Qt.WA_StyledBackground, False)
        self.start = time.monotonic()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update)
        self.timer.start(33)

    def paintEvent(self, _e):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(C['bg']))
        t = time.monotonic() - self.start
        w, h = self.width(), self.height()
        size = max(w, h)
        for shape in SHAPES:
            fx, fy, alpha = shape_at(shape, t)
            g = QRadialGradient(QPointF(fx * w, fy * h), size * 0.45)
            c = QColor(shape[0])
            c.setAlpha(int(alpha))
            g.setColorAt(0, c)
            c2 = QColor(shape[0])
            c2.setAlpha(0)
            g.setColorAt(0.72, c2)
            p.fillRect(self.rect(), g)
        p.setPen(QColor(122, 195, 238, 18))
        for x in range(0, w, 120):
            p.drawLine(x, 0, x, h)
        for y in range(0, h, 120):
            p.drawLine(0, y, w, y)


class TickerTape(QWidget):
    clicked = Signal(str)

    def __init__(self):
        super().__init__()
        self.setFixedHeight(34)
        self.setMouseTracking(True)
        self.items = []  # (symbol, price text, change text, colour)
        self.offset = 0.0
        self.paused = False
        self.font = QFont()
        self.font.setPointSizeF(10.5)
        self.bold = QFont(self.font)
        self.bold.setBold(True)
        self.last = time.monotonic()
        t = QTimer(self)
        t.timeout.connect(self._step)
        t.start(16)

    def set_items(self, items):
        self.items = items
        self.update()

    def _widths(self):
        fm, fb = QFontMetrics(self.font), QFontMetrics(self.bold)
        return [fb.horizontalAdvance(s) + fm.horizontalAdvance(f'  {p}  {c}') + 36 for s, p, c, _ in self.items]

    def _step(self):
        now = time.monotonic()
        dt, self.last = now - self.last, now
        if not self.paused and self.items:
            self.offset = (self.offset + 60 * dt) % max(1, sum(self._widths()))
            self.update()

    def enterEvent(self, _e):
        self.paused = True

    def leaveEvent(self, _e):
        self.paused = False

    def _layout(self):
        """(x, width, item) for everything drawn, the list repeated until the tape is full."""
        widths = self._widths()
        total = sum(widths)
        out, x = [], -self.offset
        while self.items and x < self.width():
            for wdt, it in zip(widths, self.items):
                out.append((x, wdt, it))
                x += wdt
            if total <= 0:
                break
        return out

    def mousePressEvent(self, e):
        for x, wdt, it in self._layout():
            if x <= e.position().x() < x + wdt:
                self.clicked.emit(it[0])

    def paintEvent(self, _e):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(4, 11, 22, 210))
        p.setPen(QColor(C['line']))
        p.drawLine(0, 0, self.width(), 0)
        p.drawLine(0, self.height() - 1, self.width(), self.height() - 1)
        if not self.items:
            p.setFont(self.font)
            p.setPen(QColor(C['faint']))
            p.drawText(QRectF(12, 0, self.width(), self.height()), Qt.AlignVCenter, 'Quotes scroll here once the desktop helper is connected.')
            return
        fm, fb = QFontMetrics(self.font), QFontMetrics(self.bold)
        y = (self.height() + fm.ascent() - fm.descent()) / 2
        for x, wdt, (sym, price, chg, colour) in self._layout():
            p.setFont(self.bold)
            p.setPen(QColor(C['label']))
            p.drawText(QPointF(x + 18, y), sym)
            cx = x + 18 + fb.horizontalAdvance(sym) + 8
            p.setFont(self.font)
            p.setPen(QColor(C['strong']))
            p.drawText(QPointF(cx, y), price)
            p.setPen(QColor(colour))
            p.drawText(QPointF(cx + fm.horizontalAdvance(price) + 8, y), chg)
            p.setPen(QColor(C['line']))
            p.drawLine(int(x + wdt), 8, int(x + wdt), self.height() - 8)
