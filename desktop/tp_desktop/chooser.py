"""
The start screen that asks how to open the platform: two big cards, "Terminal" (this app's own window) and "Web"
(your normal browser), on the website's navy with amber labels. Click a card, or press T / W, the arrow keys and
Enter; Esc closes. "Remember my choice" skips the question next time (hold Shift while opening to see it again).
"""
import sys
from pathlib import Path

from PySide6.QtCore import QEasingCurve, QPointF, QPropertyAnimation, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import QAbstractButton, QCheckBox, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from . import APP_VERSION

NAVY, NAVY_2, LINE = '#071222', '#14365e', '#2c4f7a'
AMBER, BLUE, WHITE, MUTED = '#f2a93b', '#7ac3ee', '#f2f6fb', '#9fb3c8'
FAMILY = 'Segoe UI' if sys.platform == 'win32' else ('Helvetica Neue' if sys.platform == 'darwin' else 'Sans Serif')
ASSETS = Path(__file__).resolve().parent / 'assets'


def font(size, weight=QFont.Normal, spacing=None):
    f = QFont(FAMILY, size)
    f.setWeight(weight)
    if spacing:
        f.setLetterSpacing(QFont.PercentageSpacing, spacing)
    return f


def draw_terminal(p, r):
    """A small app window with a candlestick chart (the Terminal card's picture)."""
    p.setPen(QPen(QColor(BLUE), 2))
    p.setBrush(QColor('#0b1b31'))
    p.drawRoundedRect(r, 8, 8)
    p.setPen(Qt.NoPen)
    for i, c in enumerate((AMBER, MUTED, MUTED)):
        p.setBrush(QColor(c))
        p.drawEllipse(QPointF(r.left() + 12 + i * 11, r.top() + 11), 3, 3)
    p.setPen(QPen(QColor(LINE), 1))
    p.drawLine(QPointF(r.left(), r.top() + 22), QPointF(r.right(), r.top() + 22))
    bars = [(0.62, 0.40), (0.55, 0.30), (0.48, 0.34), (0.40, 0.22), (0.44, 0.26), (0.32, 0.18), (0.26, 0.20)]
    w = (r.width() - 24) / len(bars)
    base = r.bottom() - 10
    for i, (top, body) in enumerate(bars):
        x = r.left() + 12 + i * w + w / 2
        y = r.top() + 22 + (r.height() - 32) * top
        h = (r.height() - 32) * body
        p.setPen(QPen(QColor(WHITE if i % 3 else BLUE), 1.4))
        p.drawLine(QPointF(x, y - 6), QPointF(x, min(base, y + h + 6)))
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(WHITE if i % 3 else BLUE))
        p.drawRect(QRectF(x - w * 0.28, y, w * 0.56, h))


def draw_web(p, r):
    """A globe inside a browser tab (the Web card's picture)."""
    p.setPen(QPen(QColor(BLUE), 2))
    p.setBrush(QColor('#0b1b31'))
    p.drawRoundedRect(r, 8, 8)
    tab = QRectF(r.left() + 10, r.top() - 0, r.width() * 0.42, 16)
    p.setBrush(QColor(NAVY_2))
    p.drawRoundedRect(tab, 5, 5)
    p.setPen(QPen(QColor(LINE), 1))
    p.drawLine(QPointF(r.left(), r.top() + 22), QPointF(r.right(), r.top() + 22))
    c = QPointF(r.center().x(), r.top() + 22 + (r.height() - 22) / 2)
    rad = (r.height() - 22) * 0.36
    p.setBrush(Qt.NoBrush)
    p.setPen(QPen(QColor(WHITE), 1.6))
    p.drawEllipse(c, rad, rad)
    p.drawEllipse(c, rad * 0.45, rad)
    p.drawLine(QPointF(c.x() - rad, c.y()), QPointF(c.x() + rad, c.y()))
    p.drawLine(QPointF(c.x(), c.y() - rad), QPointF(c.x(), c.y() + rad))
    p.setPen(QPen(QColor(AMBER), 1.6))
    p.drawArc(QRectF(c.x() - rad, c.y() - rad * 0.55, rad * 2, rad * 1.1), 0, 180 * 16)


class Card(QAbstractButton):
    """One big choice: picture, amber kicker, title, one line of explanation and the key to press."""

    def __init__(self, kicker, title, line, key, picture, parent=None):
        super().__init__(parent)
        self.kicker, self.title, self.line, self.key, self.picture = kicker, title, line, key, picture
        self.setCursor(Qt.PointingHandCursor)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setFixedSize(300, 300)
        self.setAccessibleName(f'{title}: {line}')
        self.hover = False

    def enterEvent(self, e):
        self.hover = True
        self.update()

    def leaveEvent(self, e):
        self.hover = False
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        lit = self.hover or self.hasFocus()
        r = QRectF(self.rect()).adjusted(2, 2, -2, -2)
        g = QLinearGradient(r.topLeft(), r.bottomRight())
        g.setColorAt(0, QColor('#183f6b' if lit else '#11294a'))
        g.setColorAt(1, QColor('#0b1b31'))
        p.setBrush(g)
        p.setPen(QPen(QColor(AMBER if lit else LINE), 2 if lit else 1))
        p.drawRoundedRect(r, 16, 16)
        self.picture(p, QRectF(r.left() + 28, r.top() + 28, r.width() - 56, 112))
        p.setPen(QColor(AMBER))
        p.setFont(font(9, QFont.DemiBold, 118))
        p.drawText(QRectF(r.left() + 28, r.top() + 158, r.width() - 56, 18), Qt.AlignLeft, self.kicker)
        p.setPen(QColor(WHITE))
        p.setFont(font(20, QFont.DemiBold))
        p.drawText(QRectF(r.left() + 28, r.top() + 178, r.width() - 56, 34), Qt.AlignLeft, self.title)
        p.setPen(QColor(MUTED))
        p.setFont(font(10))
        p.drawText(QRectF(r.left() + 28, r.top() + 214, r.width() - 56, 44), Qt.AlignLeft | Qt.TextWordWrap, self.line)
        key = QRectF(r.right() - 28 - 24, r.bottom() - 22 - 24, 24, 24)
        p.setPen(QPen(QColor(AMBER if lit else LINE), 1))
        p.setBrush(Qt.NoBrush)
        p.drawRoundedRect(key, 5, 5)
        p.setPen(QColor(WHITE if lit else MUTED))
        p.setFont(font(10, QFont.DemiBold))
        p.drawText(key, Qt.AlignCenter, self.key)
        if lit:
            p.setPen(QColor(AMBER))
            p.setFont(font(10, QFont.DemiBold))
            p.drawText(QRectF(r.left() + 28, r.bottom() - 46, 160, 24), Qt.AlignLeft | Qt.AlignVCenter, 'Open  →')
        p.end()


class Chooser(QWidget):
    """The start screen. Emits chosen('terminal' | 'web', remember) once; closing it without a choice emits nothing."""

    chosen = Signal(str, bool)

    def __init__(self, preselect='terminal'):
        super().__init__(None, Qt.FramelessWindowHint | Qt.Window)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowTitle('Trading Terminal')
        self.setFixedSize(760, 560)
        self.drag = None
        self.done = False

        outer = QVBoxLayout(self)
        outer.setContentsMargins(44, 34, 44, 26)
        outer.setSpacing(0)

        top = QHBoxLayout()
        logo = QLabel()
        if (ASSETS / 'logo.png').exists():
            logo.setPixmap(QPixmap(str(ASSETS / 'logo.png')).scaled(40, 40, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        top.addWidget(logo)
        top.addSpacing(12)
        names = QVBoxLayout()
        names.setSpacing(0)
        name = QLabel('Trading Terminal')
        name.setFont(font(15, QFont.DemiBold))
        name.setStyleSheet(f'color:{WHITE}')
        tag = QLabel('MARKETS · RESEARCH · TRADING')
        tag.setFont(font(8, QFont.DemiBold, 118))
        tag.setStyleSheet(f'color:{AMBER}')
        names.addWidget(name)
        names.addWidget(tag)
        top.addLayout(names)
        top.addStretch(1)
        close = QLabel('<a href="x" style="color:#9fb3c8;text-decoration:none;font-size:20px">×</a>')
        close.setToolTip('Close (Esc)')
        close.linkActivated.connect(lambda *_: self.close())
        top.addWidget(close, 0, Qt.AlignTop)
        outer.addLayout(top)

        outer.addSpacing(26)
        ask = QLabel('How would you like to open it?')
        ask.setFont(font(22, QFont.DemiBold))
        ask.setStyleSheet(f'color:{WHITE}')
        outer.addWidget(ask)
        sub = QLabel('Same platform, same data, either way. The helper runs for both.')
        sub.setFont(font(11))
        sub.setStyleSheet(f'color:{MUTED}')
        outer.addWidget(sub)
        outer.addSpacing(22)

        cards = QHBoxLayout()
        cards.setSpacing(24)
        self.terminal = Card('DESKTOP APP', 'Terminal', 'Its own window with the logo on your taskbar. Feels like a program.', 'T', draw_terminal)
        self.web = Card('IN YOUR BROWSER', 'Web', 'Opens in Chrome or your usual browser, next to your other tabs.', 'W', draw_web)
        self.terminal.clicked.connect(lambda: self.pick('terminal'))
        self.web.clicked.connect(lambda: self.pick('web'))
        cards.addWidget(self.terminal)
        cards.addWidget(self.web)
        cards.addStretch(1)
        outer.addLayout(cards)
        outer.addStretch(1)

        bottom = QHBoxLayout()
        self.keep = QCheckBox('Remember my choice')
        self.keep.setFont(font(10))
        self.keep.setStyleSheet(
            f'QCheckBox{{color:{WHITE};spacing:8px}}'
            f'QCheckBox::indicator{{width:16px;height:16px;border:1px solid {LINE};border-radius:4px;background:#0b1b31}}'
            f'QCheckBox::indicator:checked{{background:{AMBER};border-color:{AMBER}}}'
            f'QCheckBox:focus{{color:{AMBER}}}')
        bottom.addWidget(self.keep)
        hint = QLabel('To see this again later, hold Shift while opening.')
        hint.setFont(font(9))
        hint.setStyleSheet(f'color:{MUTED}')
        bottom.addSpacing(14)
        bottom.addWidget(hint)
        bottom.addStretch(1)
        ver = QLabel(f'v{APP_VERSION}')
        ver.setFont(font(9))
        ver.setStyleSheet(f'color:{MUTED}')
        bottom.addWidget(ver)
        outer.addLayout(bottom)

        self.setTabOrder(self.terminal, self.web)
        self.setTabOrder(self.web, self.keep)
        (self.web if preselect == 'web' else self.terminal).setFocus()

    # ----- choosing -----
    def pick(self, choice):
        if self.done:
            return
        self.done = True
        self.chosen.emit(choice, self.keep.isChecked())
        self.close()

    def keyPressEvent(self, e):
        k = e.key()
        if k == Qt.Key_T:
            self.pick('terminal')
        elif k == Qt.Key_W:
            self.pick('web')
        elif k in (Qt.Key_Left, Qt.Key_Right):
            (self.web if self.terminal.hasFocus() else self.terminal).setFocus()
        elif k in (Qt.Key_Return, Qt.Key_Enter, Qt.Key_Space):
            self.pick('web' if self.web.hasFocus() else 'terminal')
        elif k == Qt.Key_Escape:
            self.close()
        else:
            super().keyPressEvent(e)

    # ----- the look: navy card with soft edge, draggable, fades in -----
    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(1, 1, -1, -1)
        g = QLinearGradient(r.topLeft(), r.bottomRight())
        g.setColorAt(0, QColor(NAVY_2))
        g.setColorAt(0.55, QColor('#0b2240'))
        g.setColorAt(1, QColor(NAVY))
        path = QPainterPath()
        path.addRoundedRect(r, 20, 20)
        p.fillPath(path, g)
        p.setPen(QPen(QColor(LINE), 1))
        p.drawPath(path)
        # a faint rising line across the back, like a chart
        p.setClipPath(path)
        p.setPen(QPen(QColor(122, 195, 238, 40), 2))
        pts = [(0, 0.86), (0.12, 0.80), (0.22, 0.83), (0.35, 0.70), (0.48, 0.74), (0.6, 0.58), (0.72, 0.62), (0.85, 0.44), (1, 0.38)]
        line = QPainterPath(QPointF(r.left() + pts[0][0] * r.width(), r.top() + pts[0][1] * r.height()))
        for x, y in pts[1:]:
            line.lineTo(QPointF(r.left() + x * r.width(), r.top() + y * r.height()))
        p.drawPath(line)
        p.end()

    def showEvent(self, e):
        super().showEvent(e)
        self.setWindowOpacity(0.0)
        self.fade = QPropertyAnimation(self, b'windowOpacity', self)
        self.fade.setDuration(220)
        self.fade.setStartValue(0.0)
        self.fade.setEndValue(1.0)
        self.fade.setEasingCurve(QEasingCurve.OutCubic)
        self.fade.start()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.drag = e.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if self.drag is not None and e.buttons() & Qt.LeftButton:
            self.move(e.globalPosition().toPoint() - self.drag)

    def mouseReleaseEvent(self, e):
        self.drag = None
