"""
The market buddy in the desktop app: the same pixel dog as the website (src/ui/buddy.ts; the drawing and coats are
kept identical, tests/test_buddy.py checks), drawn with QPainter so he moves smoothly. Mood follows SPY today
(happy > +0.3%, worried < -0.3%), click to pet (hearts, wag, a word about the market), drag him anywhere, double-click
and he walks off; he walks (with a hop) to the nearest empty spot so he never covers what you read or press, steps
away when a page has no room and never shows on the Chart page. Name, coat and on/off are in Settings.
"""
import math
import random

from PySide6.QtCore import QEasingCurve, QPoint, QPropertyAnimation, QRect, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QAbstractButton, QAbstractScrollArea, QLabel, QLineEdit, QTabBar, QWidget

# 18 x 17 pixels; O outline, E ear, F fur, W white, P cheek, K nose, T tie (same as the website).
MAP = [
    '......OOOOOO......',
    '.....OFFWWFFO.....',
    '..OOOFFFWWFFFOOO..',
    '.OEEOFFFWWFFFOEEO.',
    '.OEEFFFFWWFFFFEEO.',
    '.OEEFFFFWWFFFFEEO.',
    '.OEEFFFWWWWFFFEEO.',
    '.OEEPFWWKKWWFPEEO.',
    '..OOFFWWWWWWFFOO..',
    '....OFFWWWWFFO....',
    '....OOTTTTTTOO....',
    '.....OFFTTFFO.....',
    '....OFFWWTWFFO....',
    '....OFFWWWWFFO....',
    '....OFWWWWWWFO....',
    '....OFFOOOOFFO....',
    '....OOO....OOO....',
]
COATS = {
    'Beagle': ('#e39a5c', '#8a4a26', '#3b2416'),
    'Golden': ('#e8b04a', '#b97a22', '#4a3010'),
    'Chocolate': ('#8a5634', '#4f2c16', '#24140a'),
    'Grey': ('#aab4c0', '#6b7684', '#2a2f38'),
    'Midnight': ('#454b58', '#2a2e38', '#101218'),
    'Cream': ('#f1dcb5', '#c9a06a', '#4a3a24'),
}
FIXED = {'W': '#fbf6ee', 'P': '#f4a3b4', 'K': '#1b1b22', 'T': '#123b68'}
FACES = {
    'calm': {'K': [(6, 4), (6, 5), (11, 4), (11, 5), (8, 9), (9, 9)]},
    'happy': {'K': [(5, 5), (6, 4), (7, 5), (10, 5), (11, 4), (12, 5), (7, 8), (10, 8)], '#e8607a': [(8, 8), (9, 8), (8, 9), (9, 9)]},
    'sad': {'K': [(6, 5), (6, 6), (11, 5), (11, 6), (5, 4), (12, 4), (7, 9), (10, 9), (8, 8), (9, 8)], '#7ac3ee': [(12, 7), (12, 8)]},
}
TAIL = {'O': [(14, 11), (15, 11), (16, 12), (16, 13)], 'F': [(14, 12), (15, 12), (15, 13), (14, 13)]}
SCALE = 4
W, H = 18 * SCALE, 17 * SCALE


def mood_for(percent):
    if percent is None or percent != percent:
        return 'calm'
    return 'happy' if percent > 0.3 else 'sad' if percent < -0.3 else 'calm'


def pet_line(percent, n):
    if percent is None:
        return 'Woof! Waiting for prices…' if n % 2 else 'Hi! Start the helper and I’ll watch the market.'
    p = f"{'+' if percent >= 0 else '−'}{abs(percent):.2f}%"
    m = mood_for(percent)
    lines = {
        'happy': [f'Woof! S&P {p} today. Green across the board!', f'Tail’s wagging: S&P {p}.', 'Good day to stick to the plan.'],
        'sad': [f'Rough one… S&P {p}. Stick to your stops.', f'S&P {p}. Pets help. Thanks.', 'Red days happen. Size down, stay calm.'],
        'calm': [f'Quiet market: S&P {p}.', f'Steady today (S&P {p}). Patience pays.', 'Nothing wild. Good time to review your plan.'],
    }[m]
    return lines[n % len(lines)]


def nearest_free(x, y, vw, vh, free, step=24):
    """The free spot nearest (x, y), searched in rings; None when the whole area is busy."""
    def clamp(px, py):
        return int(min(max(4, px), max(4, vw - W - 4))), int(min(max(4, py), max(4, vh - H - 4)))
    if free(*clamp(x, y)):
        return clamp(x, y)
    r = step
    while r < max(vw, vh):
        for a in range(0, 360, 15):
            cx, cy = clamp(x + r * math.cos(math.radians(a)), y + r * math.sin(math.radians(a)))
            if free(cx, cy):
                return cx, cy
        r += step
    return None


CONTENT = (QAbstractButton, QAbstractScrollArea, QLineEdit, QTabBar)


def is_empty(widget, root):
    """Empty space: the page itself, or a card/frame with nothing to read or press at that point."""
    w = widget
    while w is not None and w is not root:
        if isinstance(w, CONTENT) or (isinstance(w, QLabel) and w.text()) or type(w).__name__ in ('PriceChart', 'GraphicsLayoutWidget', 'TickerTape'):
            return False
        w = w.parentWidget()
    return True


class Buddy(QWidget):
    petted = Signal()

    def __init__(self, parent, prefs):
        super().__init__(parent)
        self.prefs = prefs
        self.setFixedSize(W + 8, H + 8)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setCursor(Qt.OpenHandCursor)
        self.mood, self.percent, self.pets = 'calm', None, 0
        self.petting = 0
        self.hearts = []  # [x, y, age]
        self.walking = False
        self.facing_left = False
        self.t = 0.0
        self.drag = None
        self.bubble = QLabel(parent)
        self.bubble.setWordWrap(True)
        self.bubble.setStyleSheet('background: #0a1a2e; border: 1px solid #25476b; border-radius: 10px; padding: 8px 10px; color: #ffffff;')
        self.bubble.hide()
        self.anim = QPropertyAnimation(self, b'pos', self)
        self.anim.setEasingCurve(QEasingCurve.InOutSine)
        self.anim.finished.connect(self._walked)
        tick = QTimer(self)
        tick.timeout.connect(self._tick)
        tick.start(33)  # about 30 frames a second: wag, hop and hearts
        look = QTimer(self)
        look.timeout.connect(self.settle)
        look.start(3000)
        wander = QTimer(self)
        wander.timeout.connect(self._wander)
        wander.start(60_000)
        pos = prefs.get('buddy_pos')
        self.move(*(pos if pos else (-1000, -1000)))  # placed by settle() once the window has its size

    # ----- look -----
    @property
    def name(self):
        return self.prefs.get('buddy_name') or 'Bull'

    def set_percent(self, percent):
        self.percent = percent
        self.mood = mood_for(percent)
        self.update()

    def paintEvent(self, _e):
        p = QPainter(self)
        fur, ear, line = COATS.get(self.prefs.get('buddy_coat'), COATS['Beagle'])
        colours = {'O': line, 'E': ear, 'F': fur, **FIXED}
        hop = -abs(math.sin(self.t * 10)) * 5 if self.walking else 0
        p.translate(4, 6 + hop)
        if self.facing_left:
            p.translate(W, 0)
            p.scale(-1, 1)

        def px(x, y, colour):
            p.fillRect(x * SCALE, y * SCALE, SCALE, SCALE, QColor(colour))
        # tail wags: fast when happy or petted, still and low when worried
        speed = 14 if (self.mood == 'happy' or self.petting) else 0 if self.mood == 'sad' else 4
        lift = -1 if speed and math.sin(self.t * speed) > 0 else (1 if self.mood == 'sad' else 0)
        for key, pts in TAIL.items():
            for x, y in pts:
                px(x, y + lift, colours[key])
        for y, row in enumerate(MAP):
            for x, c in enumerate(row):
                if c in colours:
                    px(x, y, colours[c])
        face = FACES['happy' if self.petting else self.mood]
        for key, pts in face.items():
            for x, y in pts:
                px(x, y, colours.get(key, key))
        p.resetTransform()
        for hx, hy, age in self.hearts:
            p.setOpacity(max(0.0, 1 - age / 40))
            p.setPen(QColor('#ff6b8a'))
            p.drawText(int(hx), int(hy - age), '♥')
        p.setOpacity(1)

    def _tick(self):
        self.t += 0.033
        if self.petting:
            self.petting -= 1
        self.hearts = [[x, y, a + 1] for x, y, a in self.hearts if a < 40]
        if self.walking or self.petting or self.hearts or self.mood != 'sad':
            self.update()

    # ----- interaction -----
    def mousePressEvent(self, e):
        self.drag = (e.globalPosition().toPoint(), self.pos(), False)
        self.setCursor(Qt.ClosedHandCursor)

    def mouseMoveEvent(self, e):
        if not self.drag:
            return
        start, origin, moved = self.drag
        delta = e.globalPosition().toPoint() - start
        if moved or delta.manhattanLength() > 5:
            self.drag = (start, origin, True)
            self.anim.stop()
            self.move(self._clamp(origin + delta))

    def mouseReleaseEvent(self, _e):
        self.setCursor(Qt.OpenHandCursor)
        moved = self.drag and self.drag[2]
        self.drag = None
        if moved:
            self._save()
            self.settle()
        else:
            self.pet()

    def mouseDoubleClickEvent(self, _e):
        self.walk_to(self.pos() + QPoint(random.randint(-250, 250), random.randint(-150, 150)))

    def pet(self):
        self.petting = 48
        self.hearts += [[20 + i * 16, 18, -i * 4] for i in range(3)]
        self.say(f'{self.name}: {pet_line(self.percent, self.pets)}')
        self.pets += 1
        self.petted.emit()

    def say(self, text):
        self.bubble.setText(text)
        self.bubble.setMaximumWidth(240)
        self.bubble.adjustSize()
        self._place_bubble()
        self.bubble.show()
        self.bubble.raise_()
        QTimer.singleShot(4000, self.bubble.hide)

    def _place_bubble(self):
        b = self.bubble
        b.move(max(4, self.x() + self.width() - b.width()), max(4, self.y() - b.height() - 6))

    def moveEvent(self, _e):
        if self.bubble.isVisible():
            self._place_bubble()

    # ----- moving -----
    def _clamp(self, pt):
        par = self.parentWidget()
        return QPoint(min(max(4, pt.x()), par.width() - self.width() - 4), min(max(4, pt.y()), par.height() - self.height() - 4))

    def walk_to(self, pt):
        target = self._clamp(pt)
        dist = math.hypot(target.x() - self.x(), target.y() - self.y())
        if dist < 3:
            return
        self.facing_left = target.x() < self.x()
        self.walking = True
        self.anim.stop()
        self.anim.setDuration(int(min(5000, max(700, dist / 110 * 1000))))
        self.anim.setStartValue(self.pos())
        self.anim.setEndValue(target)
        self.anim.start()

    def _walked(self):
        self.walking = False
        self._save()
        self.update()
        self.settle()

    def _wander(self):
        if self.isVisible() and not self.walking and not self.drag:
            self.walk_to(self.pos() + QPoint(random.randint(-80, 80), random.randint(-30, 30)))

    def _save(self):
        self.prefs['buddy_pos'] = [self.x(), self.y()]

    def settle(self, chart_page=False):
        """Walks to the nearest empty spot; steps away (hidden) when there is none or on the Chart page."""
        if self.prefs.get('buddy_hidden') or chart_page or getattr(self, 'on_chart', False):
            self.hide()
            self.bubble.hide()
            return
        if self.walking or self.drag:
            return
        par = self.parentWidget()
        if self.x() < 0 or self.y() < 0 or self.x() > par.width() or self.y() > par.height():
            self.move(par.width() - self.width() - 40, par.height() - self.height() - 60)  # first time: bottom right

        def free(x, y):
            for fx in (0.15, 0.5, 0.85):
                for fy in (0.15, 0.5, 0.85):
                    pt = QPoint(int(x + self.width() * fx), int(y + self.height() * fy))
                    w = par.childAt(pt)
                    if w is self or w is self.bubble:
                        continue
                    if not is_empty(w, par):
                        return False
            return True
        was = self.isVisible()
        self.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        spot = nearest_free(self.x(), self.y(), par.width(), par.height(), free)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        if spot is None:
            self.hide()
            return
        if not was:
            self.move(*spot)
            self.show()
            self.raise_()
        elif (abs(spot[0] - self.x()) > 2 or abs(spot[1] - self.y()) > 2):
            self.walk_to(QPoint(*spot))
