"""
The desktop app's main window. Layout (ideas from Bloomberg and Fincept, our own code and style):
- top: brand, the sections as tabs, the current section's pages as tabs, and the command line (AAPL GP, WEI, ACCT);
- left: the watchlist (click a symbol to chart it); a ticker tape of its quotes under the top bar;
- centre: the page; bottom: function keys (F2 Chart, F3 Overview, F4 Account, F5 Refresh) and the status bar.
Read-only: it shows data and never places orders (orders stay on the website's Trade page, preview + confirm).
"""
import json
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import threading

from PySide6.QtCore import QObject, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QColor, QKeySequence, QShortcut
from PySide6.QtWidgets import (QApplication, QDockWidget, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QMainWindow,
                               QPlainTextEdit, QProgressBar, QPushButton, QStackedWidget, QTabBar, QTableWidget, QTableWidgetItem,
                               QVBoxLayout, QWidget, QHeaderView)

from . import APP_VERSION
from .chart import PriceChart
from .chartmath import clock_text
from .client import HelperClient
from .helper_proc import DesktopHelper
from .nav import PAGES, SECTIONS, pages_in, parse_command
from .theme import C, QSS

PREFS = Path.home() / '.trading-platform' / 'desktop.json'
DEFAULT_WATCH = ['SPY', 'QQQ', 'DIA', 'IWM', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA']
OVERVIEW = [('S&P 500', 'SPY'), ('Nasdaq 100', 'QQQ'), ('Dow', 'DIA'), ('Russell 2000', 'IWM'), ('Long Treasuries', 'TLT'),
            ('Gold', 'GLD'), ('Oil', 'USO'), ('Dollar', 'UUP'), ('Volatility', 'VIXY')]
TIMEFRAMES = [('5m', '5m', 5), ('15m', '15m', 15), ('30m', '30m', 30), ('1D', '1D', 365 * 2), ('1W', '1W', 365 * 10)]
NY = ZoneInfo('America/New_York')


def load_prefs():
    try:
        return json.loads(PREFS.read_text())
    except (OSError, ValueError):
        return {}


def save_prefs(p):
    try:
        PREFS.parent.mkdir(exist_ok=True)
        PREFS.write_text(json.dumps(p))
    except OSError:
        pass


def change(q):
    last, prev = q.get('last'), q.get('prevClose')
    if not last or not prev:
        return None
    return (last - prev) / prev * 100


def item(text, colour=None, align=Qt.AlignRight | Qt.AlignVCenter):
    it = QTableWidgetItem(text)
    it.setTextAlignment(align)
    if colour:
        it.setForeground(QColor(colour))
    return it


def table(headers):
    t = QTableWidget(0, len(headers))
    t.setHorizontalHeaderLabels([h.upper() for h in headers])
    t.verticalHeader().hide()
    t.setEditTriggers(QTableWidget.NoEditTriggers)
    t.setSelectionBehavior(QTableWidget.SelectRows)
    t.setShowGrid(False)
    t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
    return t


class ChartPage(QWidget):
    def __init__(self, app):
        super().__init__()
        self.app, self.symbol, self.tf = app, 'SPY', '1D'
        self.title = QLabel()
        self.title.setObjectName('figure')
        self.sub = QLabel()
        self.tf_buttons = {}
        bar = QHBoxLayout()
        bar.addWidget(self.title)
        bar.addWidget(self.sub)
        bar.addStretch(1)
        for label, res, _ in TIMEFRAMES:
            b = QPushButton(label)
            b.setCheckable(True)
            b.clicked.connect(lambda _=False, r=label: self.load(self.symbol, r))
            self.tf_buttons[label] = b
            bar.addWidget(b)
        self.clock_btn = QPushButton(app.prefs.get('clock', '12h'))
        self.clock_btn.setToolTip('Switch chart times between 12-hour and 24-hour')
        self.clock_btn.clicked.connect(self.toggle_clock)
        bar.addWidget(self.clock_btn)
        self.chart = PriceChart()
        self.chart.clock = app.prefs.get('clock', '12h')
        lay = QVBoxLayout(self)
        lay.addLayout(bar)
        lay.addWidget(self.chart, 1)

    def toggle_clock(self):
        c = '24h' if self.chart.clock == '12h' else '12h'
        self.app.prefs['clock'] = c
        save_prefs(self.app.prefs)
        self.clock_btn.setText(c)
        self.chart.set_clock(c)

    def load(self, symbol, tf=None):
        self.symbol, self.tf = symbol, tf or self.tf
        for k, b in self.tf_buttons.items():
            b.setChecked(k == self.tf)
        res, days = next((r, d) for label, r, d in TIMEFRAMES if label == self.tf)
        self.title.setText(symbol)
        self.sub.setText(f'  {self.tf} · loading…')
        self.app.client.request('history', {'symbol': symbol, 'resolution': res, 'days': days}, self._got)

    def _got(self, msg):
        if msg.get('type') == 'error':
            self.sub.setText(f"  {msg.get('message')}")
            return
        bars = msg.get('bars') or []
        self.chart.set_bars(bars, intraday_stock=self.tf not in ('1D', '1W'))
        self.sub.setText(f'  {self.tf} · {len(bars)} bars · Schwab')
        self.app.quote_line(self.symbol)


class QuotePage(QWidget):
    """DES: one security's figures (label in amber, figure in white, change in green/red)."""

    def __init__(self, app):
        super().__init__()
        self.app, self.symbol = app, 'SPY'
        self.grid = QGridLayout(self)
        self.grid.setAlignment(Qt.AlignTop)

    def show_symbol(self, symbol):
        self.symbol = symbol
        self.app.client.subscribe(symbol)
        self.render()

    def render(self):
        while self.grid.count():
            self.grid.takeAt(0).widget().deleteLater()
        q = self.app.quotes.get(self.symbol, {})
        pct = change(q)
        title = QLabel(self.symbol)
        title.setObjectName('figure')
        self.grid.addWidget(title, 0, 0, 1, 4)
        cells = [('LAST', f"{q['last']:.2f}" if q.get('last') else '—', None),
                 ('CHANGE', f'{pct:+.2f}%' if pct is not None else '—', None if pct is None else (C['up'] if pct >= 0 else C['down'])),
                 ('PREV CLOSE', f"{q['prevClose']:.2f}" if q.get('prevClose') else '—', None)]
        for i, (k, v, col) in enumerate(cells):
            card = QFrame()
            card.setObjectName('card')
            lay = QVBoxLayout(card)
            lab = QLabel(k)
            lab.setObjectName('label')
            val = QLabel(v)
            val.setObjectName('figure')
            if col:
                val.setStyleSheet(f'color: {col}')
            lay.addWidget(lab)
            lay.addWidget(val)
            self.grid.addWidget(card, 1, i)
        note = QLabel('Source: Schwab quotes via the desktop helper (refreshed every 30 s).')
        note.setStyleSheet(f"color: {C['faint']}")
        self.grid.addWidget(note, 2, 0, 1, 4)


class OverviewPage(QWidget):
    """WEI-style board: the main markets through their ETFs."""

    def __init__(self, app):
        super().__init__()
        self.app = app
        self.t = table(['Market', 'Symbol', 'Last', 'Change'])
        self.t.cellDoubleClicked.connect(lambda r, _c: app.go('chart', OVERVIEW[r][1]))
        lay = QVBoxLayout(self)
        head = QLabel('WORLD MARKETS')
        head.setObjectName('section')
        lay.addWidget(head)
        lay.addWidget(self.t)
        for _, s in OVERVIEW:
            app.client.subscribe(s)
        self.render()

    def render(self):
        self.t.setRowCount(len(OVERVIEW))
        for r, (name, s) in enumerate(OVERVIEW):
            q = self.app.quotes.get(s, {})
            pct = change(q)
            self.t.setItem(r, 0, item(name, C['text'], Qt.AlignLeft | Qt.AlignVCenter))
            self.t.setItem(r, 1, item(s, C['accent'], Qt.AlignLeft | Qt.AlignVCenter))
            self.t.setItem(r, 2, item(f"{q['last']:.2f}" if q.get('last') else '—', C['strong']))
            self.t.setItem(r, 3, item(f'{pct:+.2f}%' if pct is not None else '—', None if pct is None else (C['up'] if pct >= 0 else C['down'])))


class AccountPage(QWidget):
    """Webull account, read-only (webull.snapshot): balances as cards, positions as a table."""

    def __init__(self, app):
        super().__init__()
        self.app = app
        self.lay = QVBoxLayout(self)
        self.lay.setAlignment(Qt.AlignTop)
        self.msg = QLabel('Open this page to load your Webull account.')
        self.lay.addWidget(self.msg)
        self.cards = QHBoxLayout()
        self.lay.addLayout(self.cards)
        self.t = table(['Symbol', 'Quantity', 'Last', 'Value', 'Day gain'])
        self.lay.addWidget(self.t)

    def refresh(self):
        self.msg.setText('Loading your Webull account…')
        self.app.client.engine('webull.snapshot', {}, self._got)

    def _got(self, msg):
        if msg.get('type') == 'error':
            self.msg.setText(msg.get('message', 'Webull is not set up in Settings (website).'))
            return
        data = msg.get('data') or {}
        self.msg.setText(f"{data.get('account') or 'Webull'} · read-only · {'Test' if data.get('env') == 'test' else 'Live'} account")
        while self.cards.count():
            self.cards.takeAt(0).widget().deleteLater()
        bal = data.get('balances') or {}
        for k in ('totalValue', 'netLiquidation', 'cash', 'buyingPower', 'dayGain'):
            if isinstance(bal.get(k), (int, float)):
                card = QFrame()
                card.setObjectName('card')
                cl = QVBoxLayout(card)
                lab = QLabel(''.join(' ' + ch if ch.isupper() else ch for ch in k).upper())
                lab.setObjectName('label')
                val = QLabel(f'${bal[k]:,.2f}')
                val.setObjectName('figure')
                cl.addWidget(lab)
                cl.addWidget(val)
                self.cards.addWidget(card)
        pos = data.get('positions') or []
        self.t.setRowCount(len(pos))
        for r, p in enumerate(pos):
            gain = p.get('dayGain')
            vals = [p.get('symbol', '—'), p.get('quantity', p.get('qty', '—')), p.get('last', p.get('price')), p.get('marketValue', p.get('value')), gain]
            for c, v in enumerate(vals):
                text = f'{v:,.2f}' if isinstance(v, float) else str(v if v is not None else '—')
                colour = (C['up'] if (gain or 0) >= 0 else C['down']) if c == 4 and gain is not None else (C['accent'] if c == 0 else C['strong'])
                self.t.setItem(r, c, item(text, colour, Qt.AlignLeft | Qt.AlignVCenter if c == 0 else Qt.AlignRight | Qt.AlignVCenter))


class LoadingScreen(QWidget):
    """Shown while the desktop helper starts and logs in to Schwab; closes when it connects (or after 40 s, when the
    window opens anyway and its status bar says what's wrong). The bar follows the helper's own messages."""

    STEPS = (('Logging in to Schwab', 35, 'Logging in to Schwab...'), ('Schwab helper (version', 80, 'Helper ready, connecting...'),
             ('Port', 90, 'Another helper is using the port...'))

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setObjectName('root')
        self.setFixedSize(520, 240)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(32, 28, 32, 28)
        brand = QLabel('◆ TERMINAL')
        brand.setStyleSheet(f"color: {C['accent']}; font-size: 20px; font-weight: 700; letter-spacing: 6px")
        sub = QLabel(f'TRADING PLATFORM · DESKTOP {APP_VERSION}')
        sub.setObjectName('label')
        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setTextVisible(True)
        self.bar.setStyleSheet(f"QProgressBar {{ background: {C['raised']}; border: 1px solid {C['line']}; border-radius: 6px; height: 18px; text-align: center; }}"
                               f"QProgressBar::chunk {{ background: {C['accent']}; border-radius: 5px; }}")
        self.status = QLabel('Starting the desktop helper...')
        self.status.setStyleSheet(f"color: {C['muted']}")
        lay.addWidget(brand)
        lay.addWidget(sub)
        lay.addStretch(1)
        lay.addWidget(self.bar)
        lay.addWidget(self.status)
        self.target = 25
        self.value = 0.0
        t = QTimer(self)
        t.timeout.connect(self._creep)
        t.start(80)

    def _creep(self):
        # always moving, slowing as it nears the current step's target
        self.value += max(0.05, (self.target - self.value) * 0.04)
        self.bar.setValue(int(min(self.value, self.target, 99)))

    def helper_said(self, text):
        for key, pct, label in self.STEPS:
            if key in text:
                self.target = max(self.target, pct)
                self.status.setText(label)

    def done(self):
        self.bar.setValue(100)
        self.status.setText('Connected.')
        QTimer.singleShot(250, self.close)


class UpdateCheck(QObject):
    """Asks GitHub for the newest desktop version in the background (desktop_update.py)."""
    found = Signal(str)

    def check(self):
        def work():
            try:
                import desktop_update
                latest = desktop_update.latest_version()
                if desktop_update.is_newer(latest, desktop_update.local_version()):
                    self.found.emit('.'.join(map(str, latest)))
            except Exception:  # noqa: BLE001 - offline or not started by the launcher: no update offer
                pass
        threading.Thread(target=work, daemon=True).start()


RESTART_CODE = 75  # launch.py installs the update and opens the app again


class MainWindow(QMainWindow):
    def __init__(self, port=8766, start_helper=True):
        super().__init__()
        self.prefs = load_prefs()
        self.watch = self.prefs.get('watchlist') or list(DEFAULT_WATCH)
        self.quotes = {}
        self.client = HelperClient(port)
        self.helper = DesktopHelper()
        self.setWindowTitle(f'Trading Platform — Desktop {APP_VERSION}')
        self.resize(1440, 900)
        root = QWidget()
        root.setObjectName('root')
        self.setCentralWidget(root)
        outer = QVBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # top: brand, sections, pages, command line
        top = QHBoxLayout()
        top.setContentsMargins(12, 6, 12, 0)
        brand = QLabel('◆ TERMINAL')
        brand.setStyleSheet(f"color: {C['accent']}; font-weight: 700; letter-spacing: 3px; padding-right: 16px")
        top.addWidget(brand)
        self.sections = QTabBar()
        for s in SECTIONS:
            self.sections.addTab(s)
        self.sections.currentChanged.connect(lambda i: self.go(pages_in(SECTIONS[i])[0].key))
        top.addWidget(self.sections)
        self.section_label = QLabel()
        self.section_label.setObjectName('section')
        top.addWidget(self.section_label)
        self.page_tabs = QTabBar()
        self.page_tabs.tabBarClicked.connect(lambda i: self.go(self.page_tabs.tabData(i)))
        top.addWidget(self.page_tabs, 1)
        self.command = QLineEdit()
        self.command.setPlaceholderText('Ticker or code: AAPL GP, MSFT DES, WEI, ACCT  ( / )')
        self.command.setMinimumWidth(320)
        self.command.returnPressed.connect(self.run_command)
        top.addWidget(self.command)
        outer.addLayout(top)

        self.tape = QLabel()
        self.tape.setStyleSheet(f"padding: 4px 12px; border-top: 1px solid {C['line']}; border-bottom: 1px solid {C['line']}; background: {C['surface']}")
        outer.addWidget(self.tape)

        self.stack = QStackedWidget()
        self.pages = {'home': OverviewPage(self), 'chart': ChartPage(self), 'quote': QuotePage(self), 'account': AccountPage(self)}
        for p in self.pages.values():
            self.stack.addWidget(p)
        outer.addWidget(self.stack, 1)

        # function keys
        fk = QFrame()
        fk.setObjectName('fkeys')
        fl = QHBoxLayout(fk)
        fl.setContentsMargins(8, 2, 8, 2)
        for key, label, fn in (('F1', 'Help', self.show_help), ('F2', 'Chart', lambda: self.go('chart')), ('F3', 'Overview', lambda: self.go('home')),
                               ('F4', 'Account', lambda: self.go('account')), ('F5', 'Refresh', self.refresh)):
            b = QPushButton(f'{key}  {label}')
            b.setObjectName('fkey')
            b.setStyleSheet(f"QPushButton#fkey {{ color: {C['text']}; }}")
            b.clicked.connect(fn)
            fl.addWidget(b)
            QShortcut(QKeySequence(key), self, activated=fn)
        fl.addStretch(1)
        outer.addWidget(fk)
        QShortcut(QKeySequence('/'), self, activated=self.command.setFocus)
        QShortcut(QKeySequence('Ctrl+K'), self, activated=self.command.setFocus)

        # watchlist dock
        dock = QDockWidget('WATCHLIST', self)
        dock.setFeatures(QDockWidget.DockWidgetMovable)
        self.wl = table(['Symbol', 'Last', 'Chg%'])
        self.wl.cellClicked.connect(lambda r, _c: self.go('chart', self.watch[r]))
        w = QWidget()
        wl = QVBoxLayout(w)
        add = QLineEdit()
        add.setPlaceholderText('Add symbol')
        add.returnPressed.connect(lambda: self.add_symbol(add))
        wl.addWidget(add)
        wl.addWidget(self.wl)
        dock.setWidget(w)
        dock.setMinimumWidth(260)
        self.addDockWidget(Qt.LeftDockWidgetArea, dock)

        # log dock (the desktop helper's output), hidden until asked for
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log_dock = QDockWidget('HELPER LOG', self)
        self.log_dock.setWidget(self.log)
        self.addDockWidget(Qt.BottomDockWidgetArea, self.log_dock)
        self.log_dock.hide()
        self.helper.output.connect(lambda t: self.log.appendPlainText(t.rstrip()))

        # menus
        m = self.menuBar()
        f = m.addMenu('&File')
        f.addAction('Start desktop helper', self.helper.start)
        f.addAction('Show helper log', self.log_dock.show)
        f.addSeparator()
        f.addAction('Quit', self.close)
        go = m.addMenu('&Go')
        for p in PAGES:
            go.addAction(f'{p.label}    {p.code}', lambda k=p.key: self.go(k))
        view = m.addMenu('&View')
        view.addAction('Switch 12/24-hour clock', self.pages['chart'].toggle_clock)
        hm = m.addMenu('&Help')
        hm.addAction('Keys and codes', self.show_help)
        hm.addAction('Check for updates', lambda: (self.statusBar().showMessage('Checking GitHub for a newer desktop app...', 4000), self.updates.check()))
        self.updates = UpdateCheck()
        self.update_btn = QPushButton()
        self.update_btn.hide()
        self.update_btn.clicked.connect(lambda: QApplication.exit(RESTART_CODE))
        self.updates.found.connect(self.offer_update)
        QTimer.singleShot(15_000, self.updates.check)
        hourly = QTimer(self)
        hourly.timeout.connect(self.updates.check)
        hourly.start(60 * 60 * 1000)

        # status bar
        self.st_helper = QLabel('Helper: connecting…')
        self.st_session = QLabel()
        self.statusBar().addWidget(self.st_helper)
        self.statusBar().addPermanentWidget(self.update_btn)
        self.statusBar().addPermanentWidget(self.st_session)
        self.client.connected.connect(self.on_connected)
        self.client.quote.connect(self.on_quote)
        for s in self.watch:
            self.client.subscribe(s)
        self.client.start()
        t = QTimer(self)
        t.timeout.connect(self.tick)
        t.start(1000)
        self.render_watch()
        self.go(self.prefs.get('page', 'home'), self.prefs.get('symbol'))
        if start_helper:
            self.helper.start()

    def offer_update(self, version):
        self.update_btn.setText(f'Update to {version} (restarts the app)')
        self.update_btn.setStyleSheet(f"color: {C['label']}; border-color: {C['label']}")
        self.update_btn.show()

    # ----- navigation -----

    def go(self, key, symbol=None):
        page = next((p for p in PAGES if p.key == key), PAGES[0])
        si = SECTIONS.index(page.section)
        if self.sections.currentIndex() != si:
            self.sections.blockSignals(True)
            self.sections.setCurrentIndex(si)
            self.sections.blockSignals(False)
        while self.page_tabs.count():
            self.page_tabs.removeTab(0)
        for p in pages_in(page.section):
            i = self.page_tabs.addTab(f'{p.label}  {p.code}')
            self.page_tabs.setTabData(i, p.key)
            if p.key == page.key:
                self.page_tabs.setCurrentIndex(i)
        self.stack.setCurrentWidget(self.pages[page.key])
        if page.key == 'chart':
            self.pages['chart'].load(symbol or self.pages['chart'].symbol)
        elif page.key == 'quote':
            self.pages['quote'].show_symbol(symbol or self.pages['quote'].symbol)
        elif page.key == 'account':
            self.pages['account'].refresh()
        self.prefs.update(page=page.key, symbol=symbol or self.prefs.get('symbol'))
        save_prefs(self.prefs)

    def run_command(self):
        cmd = parse_command(self.command.text())
        if cmd:
            self.go(cmd[1], cmd[2])
            self.command.clear()
        else:
            self.statusBar().showMessage('Not a ticker or code. Try AAPL GP, MSFT DES, WEI or ACCT.', 4000)

    def add_symbol(self, box):
        s = box.text().strip().upper()
        box.clear()
        if s and s not in self.watch and parse_command(s):
            self.watch.append(s)
            self.prefs['watchlist'] = self.watch
            save_prefs(self.prefs)
            self.client.subscribe(s)
            self.render_watch()

    def refresh(self):
        self.go(self.stack.currentWidget() is self.pages['account'] and 'account' or next(k for k, v in self.pages.items() if v is self.stack.currentWidget()))

    def show_help(self):
        self.statusBar().showMessage('Codes: AAPL (chart) · AAPL GP · AAPL DES · WEI · ACCT.  Keys: / or Ctrl+K command line, F2-F5.', 8000)

    # ----- data -----

    def on_connected(self, ok):
        self.st_helper.setText('● Desktop helper connected' if ok else '● Desktop helper offline (File > Start desktop helper)')
        self.st_helper.setStyleSheet(f"color: {C['up'] if ok else C['down']}")
        if ok and self.stack.currentWidget() is self.pages['chart']:
            self.pages['chart'].load(self.pages['chart'].symbol)

    def on_quote(self, msg):
        self.quotes[msg['symbol']] = msg
        self.render_watch()
        self.pages['home'].render()
        if self.stack.currentWidget() is self.pages['quote'] and msg['symbol'] == self.pages['quote'].symbol:
            self.pages['quote'].render()

    def quote_line(self, symbol):
        pass

    def render_watch(self):
        self.wl.setRowCount(len(self.watch))
        tape = []
        for r, s in enumerate(self.watch):
            q = self.quotes.get(s, {})
            pct = change(q)
            col = None if pct is None else (C['up'] if pct >= 0 else C['down'])
            self.wl.setItem(r, 0, item(s, C['accent'], Qt.AlignLeft | Qt.AlignVCenter))
            self.wl.setItem(r, 1, item(f"{q['last']:.2f}" if q.get('last') else '—', C['strong']))
            self.wl.setItem(r, 2, item(f'{pct:+.2f}%' if pct is not None else '—', col))
            if q.get('last'):
                tape.append(f"<span style='color:{C['label']}'>{s}</span> <span style='color:{C['strong']}'>{q['last']:.2f}</span> "
                            f"<span style='color:{col or C['muted']}'>{pct:+.2f}%</span>" if pct is not None else f'{s} {q["last"]:.2f}')
        self.tape.setText('&nbsp;&nbsp;&nbsp;'.join(tape) or f"<span style='color:{C['faint']}'>Quotes appear here once the desktop helper is connected.</span>")

    def tick(self):
        now = datetime.now(NY)
        m = now.hour * 60 + now.minute
        weekday = now.weekday() < 5
        phase = 'Pre-market' if weekday and 240 <= m < 570 else 'Regular session' if weekday and 570 <= m < 960 else 'After hours' if weekday and 960 <= m < 1200 else 'Closed'
        self.st_session.setText(f"{phase} · New York {clock_text(now.hour, now.minute, self.prefs.get('clock', '12h'))}")

    def closeEvent(self, e):
        self.helper.stop()
        super().closeEvent(e)


def main(argv=None):
    import argparse
    import sys
    ap = argparse.ArgumentParser(description='Trading Platform desktop app')
    ap.add_argument('--port', type=int, default=8766, help='helper port (default: the desktop helper, 8766)')
    ap.add_argument('--no-helper', action='store_true', help="don't start the desktop helper (one is already running)")
    ap.add_argument('--screenshot', help='save a screenshot to this file after a few seconds and quit (for checks)')
    args = ap.parse_args(argv)
    app = QApplication(sys.argv[:1])
    app.setStyleSheet(QSS)
    win = MainWindow(args.port, not args.no_helper)
    if args.screenshot or args.no_helper:
        win.show()
    else:
        loading = LoadingScreen()
        loading.show()
        win.helper.output.connect(loading.helper_said)
        opened = []

        def open_main(_ok=True):
            if opened or not _ok:
                return
            opened.append(1)
            loading.done()
            win.show()
        win.client.connected.connect(open_main)
        QTimer.singleShot(40_000, lambda: (loading.close(), opened or (opened.append(1), win.show())))
    if args.screenshot:
        def shot():
            win.grab().save(args.screenshot)
            app.quit()
        QTimer.singleShot(int(float(__import__('os').environ.get('TP_SHOT_DELAY', '6')) * 1000), shot)
    return app.exec()
