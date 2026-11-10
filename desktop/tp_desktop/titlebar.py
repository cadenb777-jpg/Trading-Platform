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
    html.tp-desktop .shell-top, html.tp-desktop .brand { -webkit-user-select: none; user-select: none; }
    /* the AI panel opens beside the top bar: it starts below a strip that carries the bar on, so the window buttons
       sit on that strip instead of over the panel's own header */
    html.tp-desktop .ai-drawer:not([hidden]) {
      padding-top: 44px;
      background: linear-gradient(var(--line), var(--line)) 0 43px / 100%% 1px no-repeat,
        linear-gradient(color-mix(in srgb, var(--bg-deep) 70%%, var(--bg)), color-mix(in srgb, var(--bg-deep) 70%%, var(--bg))) 0 0 / 100%% 43px no-repeat,
        var(--bg);
    }
    html.tp-desktop body:has(.ai-drawer:not([hidden])) .shell-top { padding-right: 16px !important; }`;
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
    if (el.classList.contains('ai-drawer')) return true;  // the strip above the AI panel
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
        """Keeps the buttons in the top-right corner at the top bar's height. Does nothing when nothing changed (moving
        or raising a widget over the page makes the whole window redraw, which showed as a flicker)."""
        if height:
            self.bar_height = max(28, min(80, int(round(height))))
        h = self.bar_height - 1  # the top bar's bottom line stays visible
        parent = self.parentWidget()
        spot = (parent.width() - 3 * BUTTON_W, h)
        if getattr(self, '_spot', None) == spot:
            return
        self._spot = spot
        for b in self.buttons.values():
            b.setFixedSize(BUTTON_W, h)
        self.setFixedSize(3 * BUTTON_W, h)
        self.move(spot[0], 0)
        if not getattr(self, '_raised', False):
            self.raise_()
            self._raised = True

#: Main window: keeps the window buttons' corner clear. Whenever something the page opens (a ticker card, menu, pop-up,
#: panel, notice) would sit under the buttons, it is moved down just below the top bar; when it moves away or closes,
#: it gets its own place back. Checked after every change to the page (at most every 100 ms) and on resizing.
KEEP_CLEAR_JS = r"""
(() => {
  if (window.__tpKeepClear) return;
  window.__tpKeepClear = true;
  const W = %d, H = 44;
  const pushed = new Set();
  const shellTop = () => document.querySelector('.shell-top');
  // the page's own top bar, the strip above the AI panel and the layout around them may sit there
  const allowed = (el) => {
    if (!el || el === document.documentElement || el === document.body) return true;
    const top = shellTop();
    if (top && (el === top || top.contains(el) || el.contains(top))) return true;
    return el.classList.contains('ai-drawer') || !!el.closest('.brand');
  };
  // the outermost positioned box of what is in the way (not the app's own frame)
  const overlayRoot = (el) => {
    let root = null;
    const top = shellTop();
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (top && n.contains(top)) break;
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'absolute') root = n;
    }
    return root;
  };
  const applied = (el) => parseFloat(el.dataset.tpPush || '0') || 0;
  const setPush = (el, px) => {
    const was = applied(el);
    if (Math.abs(was - px) < 0.5) return;
    if (!('tpBase' in el.dataset)) el.dataset.tpBase = el.style.marginTop || '';
    el.dataset.tpPush = String(px);
    if (px > 0) {
      el.style.setProperty('margin-top', `calc(${el.dataset.tpBase || '0px'} + ${px}px)`, 'important');
      pushed.add(el);
    } else {
      el.style.removeProperty('margin-top');
      if (el.dataset.tpBase) el.style.marginTop = el.dataset.tpBase;
      delete el.dataset.tpPush;
      delete el.dataset.tpBase;
      pushed.delete(el);
    }
  };
  // how far down the box has to go (0 = it doesn't reach the buttons' corner)
  const needed = (el) => {
    if (!el.isConnected) return 0;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= innerWidth - W || r.left >= innerWidth) return 0;
    const top = r.top - applied(el);
    return top < H ? H - top : 0;
  };
  const clear = () => {
    if (!document.documentElement.classList.contains('tp-desktop')) return;
    for (const el of [...pushed]) setPush(el, el.isConnected ? needed(el) : 0);
    const vw = innerWidth;
    for (const x of [vw - W + 3, vw - W / 2, vw - 3]) {
      for (const y of [3, H / 2, H - 4]) {
        const el = document.elementFromPoint(x, y);
        if (allowed(el)) continue;
        const root = overlayRoot(el);
        if (root && !pushed.has(root)) setPush(root, needed(root));
      }
    }
  };
  let timer = 0;
  const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; clear(); }, 100); };
  const watch = () => {
    new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
    addEventListener('resize', soon);
    soon();
  };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
})();
""" % (3 * BUTTON_W)
