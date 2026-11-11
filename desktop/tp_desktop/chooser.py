"""
The start-up window: first the loading screen (StartPanel, progress from the launcher), then in the same window the
question how to open the platform (ChoicePanel): two big cards, "Terminal" (this app's own window) and "Web"
(your normal browser), on the website's navy with amber labels. Click a card, or press T / W, the arrow keys and
Enter; Esc closes. "Remember my choice" skips the question next time (hold Shift while opening to see it again).
"""
import sys
from pathlib import Path

from PySide6.QtCore import QEasingCurve, QPointF, QPropertyAnimation, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtWidgets import (QAbstractButton, QCheckBox, QGraphicsOpacityEffect, QHBoxLayout, QLabel, QPushButton,
                               QVBoxLayout, QWidget)

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


class Frame(QWidget):
    """The start-up window itself: navy rounded card, the logo and name on top, a body below that can change (loading
    screen -> choice) with a soft cross-fade, so start-up reads as one motion. Draggable; fades in."""

    closed = Signal()

    def closeEvent(self, e):
        super().closeEvent(e)
        self.closed.emit()

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.Window)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowTitle('Trading Terminal')
        self.setFixedSize(760, 560)
        self.drag = None
        self.closing_ok = True  # False while the choice must not be dismissed by Esc (it can't be: Esc closes)

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
        self.holder = QVBoxLayout()
        self.holder.setContentsMargins(0, 0, 0, 0)
        outer.addLayout(self.holder, 1)
        self.body = None

    def set_body(self, widget, fade=True):
        """Shows `widget` below the header; the old body fades out and the new one fades in (about 0.3 s)."""
        old = self.body
        self.body = widget
        if old is not None:
            self.holder.removeWidget(old)
            old.deleteLater()
        self.holder.addWidget(widget)
        if fade and self.isVisible():
            effect = QGraphicsOpacityEffect(widget)
            widget.setGraphicsEffect(effect)
            anim = QPropertyAnimation(effect, b'opacity', widget)
            anim.setDuration(300)
            anim.setStartValue(0.0)
            anim.setEndValue(1.0)
            anim.setEasingCurve(QEasingCurve.OutCubic)
            anim.finished.connect(lambda: widget.setGraphicsEffect(None))  # crisp text once it's in
            anim.start()
            widget._fade = anim
        if hasattr(widget, 'focus_first'):
            widget.focus_first()

    def keyPressEvent(self, e):
        if self.body is not None and hasattr(self.body, 'handle_key') and self.body.handle_key(e):
            return
        if e.key() == Qt.Key_Escape:
            self.close()
        else:
            super().keyPressEvent(e)

    # ----- the look: navy card with a soft edge, draggable, fades in -----
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
        p.setClipPath(path)
        p.setPen(QPen(QColor(122, 195, 238, 40), 2))  # a faint rising line across the back, like a chart
        pts = [(0, 0.86), (0.12, 0.80), (0.22, 0.83), (0.35, 0.70), (0.48, 0.74), (0.6, 0.58), (0.72, 0.62), (0.85, 0.44), (1, 0.38)]
        line = QPainterPath(QPointF(r.left() + pts[0][0] * r.width(), r.top() + pts[0][1] * r.height()))
        for x, y in pts[1:]:
            line.lineTo(QPointF(r.left() + x * r.width(), r.top() + y * r.height()))
        p.drawPath(line)
        p.end()

    def showEvent(self, e):
        super().showEvent(e)
        if getattr(self, '_faded_in', False):
            return
        self._faded_in = True
        self.setWindowOpacity(0.0)
        self.fade = QPropertyAnimation(self, b'windowOpacity', self)
        self.fade.setDuration(220)
        self.fade.setStartValue(0.0)
        self.fade.setEndValue(1.0)
        self.fade.setEasingCurve(QEasingCurve.OutCubic)
        self.fade.start()

    def fade_out_and_close(self, ms=240):
        """The window gently disappears (the platform's own window or the browser is taking over)."""
        self.fade = QPropertyAnimation(self, b'windowOpacity', self)
        self.fade.setDuration(ms)
        self.fade.setStartValue(self.windowOpacity())
        self.fade.setEndValue(0.0)
        self.fade.finished.connect(self.close)
        self.fade.start()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.drag = e.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if self.drag is not None and e.buttons() & Qt.LeftButton:
            self.move(e.globalPosition().toPoint() - self.drag)

    def mouseReleaseEvent(self, e):
        self.drag = None


class ProgressBar(QWidget):
    """A slim amber bar with a soft glow at its tip; set_value() moves it smoothly."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(14)
        self.value = 0.0

    def set_value(self, pct):
        self.value = max(0.0, min(100.0, pct))
        self.update()

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect()).adjusted(0, 4, 0, -4)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor('#0b1b31'))
        p.drawRoundedRect(r, 3, 3)
        w = r.width() * self.value / 100
        if w > 0:
            fill = QRectF(r.left(), r.top(), w, r.height())
            g = QLinearGradient(fill.topLeft(), fill.topRight())
            g.setColorAt(0, QColor('#b97a1f'))
            g.setColorAt(1, QColor(AMBER))
            p.setBrush(g)
            p.drawRoundedRect(fill, 3, 3)
            glow = QColor(AMBER)
            glow.setAlpha(70)
            p.setBrush(glow)
            p.drawEllipse(QPointF(fill.right(), fill.center().y()), 7, 7)
        p.end()


class StartPanel(QWidget):
    """The loading screen: what is happening, an amber bar and the version; or, if the start-up failed, what went
    wrong in plain words with a button for the log."""

    def __init__(self, parent=None):
        super().__init__(parent)
        box = QVBoxLayout(self)
        box.setContentsMargins(0, 0, 0, 0)
        box.setSpacing(0)
        self.title = QLabel('Starting up')
        self.title.setFont(font(22, QFont.DemiBold))
        self.title.setStyleSheet(f'color:{WHITE}')
        box.addWidget(self.title)
        self.sub = QLabel('Getting your markets ready. The helper runs quietly in the background.')
        self.sub.setFont(font(11))
        self.sub.setStyleSheet(f'color:{MUTED}')
        self.sub.setWordWrap(True)
        box.addWidget(self.sub)
        box.addStretch(2)
        self.step = QLabel('Starting...')
        self.step.setFont(font(10, QFont.DemiBold, 104))
        self.step.setStyleSheet(f'color:{AMBER}')
        box.addWidget(self.step)
        box.addSpacing(10)
        self.problem = QLabel('')  # filled in only if the start-up fails (in place of the bar)
        self.problem.setWordWrap(True)
        self.problem.setFont(font(10))
        self.problem.setStyleSheet(f'color:{WHITE}')
        self.problem.hide()
        box.addWidget(self.problem)
        self.buttons = QHBoxLayout()
        box.addLayout(self.buttons)
        self.bar = ProgressBar(self)
        box.addWidget(self.bar)
        box.addSpacing(8)
        row = QHBoxLayout()
        self.pct = QLabel('0%')
        self.pct.setFont(font(9))
        self.pct.setStyleSheet(f'color:{MUTED}')
        row.addWidget(self.pct)
        row.addStretch(1)
        ver = QLabel(f'v{APP_VERSION}')
        ver.setFont(font(9))
        ver.setStyleSheet(f'color:{MUTED}')
        row.addWidget(ver)
        box.addLayout(row)
        box.addStretch(3)
        self.shown = 0.0

    def show_progress(self, pct, label):
        # the bar glides toward the launcher's figure instead of jumping
        self.shown += (pct - self.shown) * 0.25 if pct > self.shown else 0
        self.bar.set_value(self.shown)
        self.pct.setText(f'{int(self.shown)}%')
        if label:
            self.step.setText(label.rstrip('.') + '...' if label.endswith('...') else label)

    def show_failure(self, message, details, hints, log_path, on_close):
        self.title.setText('Couldn’t start')
        self.sub.setText(message)
        self.step.setText('WHAT TO TRY')
        self.step.setStyleSheet('color:#ff958c')
        lines = list(hints or []) + [f'Details: {log_path}']
        tail = [d for d in (details or []) if str(d).strip()][-3:]
        self.problem.setText('\n'.join(['• ' + h for h in lines] + ([''] + [str(t)[:160] for t in tail] if tail else [])))
        self.problem.show()
        self.buttons.addSpacing(0)
        self.bar.hide()
        self.pct.hide()
        self.buttons.setContentsMargins(0, 14, 0, 0)
        for text, act in (('Open the log', lambda: _open_file(log_path)), ('Close', on_close)):
            b = QPushButton(text)
            b.setCursor(Qt.PointingHandCursor)
            b.setStyleSheet(f'QPushButton{{color:{WHITE};background:#11294a;border:1px solid {LINE};border-radius:8px;padding:8px 16px}}'
                            f'QPushButton:hover{{border-color:{AMBER}}}')
            b.clicked.connect(act)
            self.buttons.addWidget(b)
        self.buttons.addStretch(1)


def _open_file(path):
    from PySide6.QtCore import QUrl
    from PySide6.QtGui import QDesktopServices
    QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))


class ChoicePanel(QWidget):
    """The question: two big cards, Terminal and Web, and Remember my choice. Emits chosen('terminal'|'web', keep)."""

    chosen = Signal(str, bool)

    def __init__(self, preselect='terminal', parent=None):
        super().__init__(parent)
        self.done = False
        self.preselect = preselect
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
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

    def focus_first(self):
        (self.web if self.preselect == 'web' else self.terminal).setFocus()

    def pick(self, choice):
        if self.done:
            return
        self.done = True
        self.chosen.emit(choice, self.keep.isChecked())

    def handle_key(self, e):
        k = e.key()
        if k == Qt.Key_T:
            self.pick('terminal')
        elif k == Qt.Key_W:
            self.pick('web')
        elif k in (Qt.Key_Left, Qt.Key_Right):
            (self.web if self.terminal.hasFocus() else self.terminal).setFocus()
        elif k in (Qt.Key_Return, Qt.Key_Enter, Qt.Key_Space):
            self.pick('web' if self.web.hasFocus() else 'terminal')
        else:
            return False
        return True


class Chooser(Frame):
    """The question on its own (no loading screen before it). Emits chosen('terminal' | 'web', remember) once, then
    closes; closing it without a choice emits nothing."""

    chosen = Signal(str, bool)

    def __init__(self, preselect='terminal'):
        super().__init__()
        self.panel = ChoicePanel(preselect, self)
        self.terminal, self.web, self.keep = self.panel.terminal, self.panel.web, self.panel.keep
        self.panel.chosen.connect(self._picked)
        self.set_body(self.panel, fade=False)
        self.panel.focus_first()

    @property
    def done(self):
        return self.panel.done

    def pick(self, choice):
        self.panel.pick(choice)

    def _picked(self, choice, keep):
        self.chosen.emit(choice, keep)
        self.close()
