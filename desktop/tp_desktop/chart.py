"""
The desktop price chart (pyqtgraph): candles and volume on bar-index x, our square dotted grid that carries on past
the last candle, session shading (pre-market sky, after-hours copper, overnight grey), a dashed last-price line in
the candle's colour, 12/24-hour time labels and a crosshair read-out. Maths in chartmath.py (tested).
"""
import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QPainter, QPen, QPicture

from .chartmath import grid_columns, is_daily, nice_step, session_phase, time_label
from .theme import C

pg.setConfigOptions(antialias=True, background=C['chart_bg'], foreground=C['muted'])

SHADE = {'pre': QColor(122, 195, 238, 20), 'post': QColor(224, 128, 63, 22), 'closed': QColor(232, 241, 250, 12)}


class CandleItem(pg.GraphicsObject):
    def __init__(self):
        super().__init__()
        self.bars = []
        self.picture = QPicture()

    def set_bars(self, bars):
        self.prepareGeometryChange()
        self.bars = bars
        p = QPainter(self.picture)
        w = 0.36
        for i, b in enumerate(bars):
            up = b['close'] >= b['open']
            col = QColor(C['up_fill'] if up else C['down_fill'])
            p.setPen(QPen(col, 0))
            p.drawLine(QPointF(i, b['low']), QPointF(i, b['high']))
            p.setBrush(col)
            top, bot = max(b['open'], b['close']), min(b['open'], b['close'])
            p.drawRect(QRectF(i - w, bot, 2 * w, max(top - bot, 1e-9)))
        p.end()
        self.update()

    def paint(self, p, *args):
        p.drawPicture(0, 0, self.picture)

    def boundingRect(self):
        if not self.bars:
            return QRectF()
        lo = min(b['low'] for b in self.bars)
        hi = max(b['high'] for b in self.bars)
        return QRectF(-1, lo, len(self.bars) + 1, hi - lo)


class Backdrop(pg.GraphicsObject):
    """Session shading and the square dotted grid, drawn under the candles for whatever is on screen."""

    def __init__(self, chart):
        super().__init__()
        self.chart = chart
        self.setZValue(-10)

    def boundingRect(self):
        vb = self.getViewBox()
        return vb.viewRect() if vb else QRectF()

    def paint(self, p, *args):
        vb = self.getViewBox()
        if not vb:
            return
        r = vb.viewRect()
        px_w, px_h = vb.viewPixelSize()  # data units per pixel
        bars = self.chart.bars
        # sessions (intraday stock bars)
        if self.chart.shade and bars and not self.chart.daily:
            lo, hi = max(0, int(r.left())), min(len(bars) - 1, int(r.right()) + 1)
            run, start = None, lo
            for i in range(lo, hi + 2):
                ph = session_phase(bars[i]['time']) if i <= hi else None
                if ph != run:
                    if run in SHADE:
                        p.fillRect(QRectF(start - 0.5, r.top(), i - start, r.height()), SHADE[run])
                    run, start = ph, i
        # the grid: horizontal at nice price steps, vertical at the same on-screen spacing (square cells)
        step = nice_step(r.height(), 8)
        cell_px = step / px_h if px_h else 60
        pen = QPen(QColor(C['grid']))
        pen.setWidthF(0)
        pen.setStyle(Qt.DotLine)
        p.setPen(pen)
        y = np.floor(r.top() / step) * step
        while y <= r.bottom():
            p.drawLine(QPointF(r.left(), y), QPointF(r.right(), y))
            y += step
        for x in grid_columns(r.left(), r.right(), cell_px, 1 / px_w if px_w else 1):
            p.drawLine(QPointF(x - 0.5, r.top()), QPointF(x - 0.5, r.bottom()))


class TimeAxis(pg.AxisItem):
    def __init__(self, chart):
        super().__init__('bottom')
        self.chart = chart

    def tickStrings(self, values, scale, spacing):
        out = []
        for v in values:
            i = int(round(v))
            b = self.chart.bars
            out.append(time_label(b[i]['time'], self.chart.daily, self.chart.clock) if 0 <= i < len(b) else '')
        return out


class PriceChart(pg.GraphicsLayoutWidget):
    def __init__(self):
        super().__init__()
        self.bars = []
        self.daily = True
        self.clock = '12h'
        self.shade = True
        self.price = self.addPlot(row=0, col=0, axisItems={'bottom': TimeAxis(self)})
        self.volume = self.addPlot(row=1, col=0, axisItems={'bottom': TimeAxis(self)})
        self.ci.layout.setRowStretchFactor(0, 4)
        self.ci.layout.setRowStretchFactor(1, 1)
        self.volume.setXLink(self.price)
        for plot in (self.price, self.volume):
            plot.showAxis('right')
            plot.hideAxis('left')
            plot.getAxis('right').setTextPen(C['muted'])
            plot.getAxis('bottom').setTextPen(C['muted'])
            plot.setMenuEnabled(False)
        self.price.hideAxis('bottom')
        self.volume.getAxis('right').setStyle(showValues=False)  # volume reads from the bars; the axis numbers only cluttered
        self.backdrop = Backdrop(self)
        self.price.addItem(self.backdrop)
        self.candles = CandleItem()
        self.price.addItem(self.candles)
        self.vol_bars = pg.BarGraphItem(x=[], height=[], width=0.7)
        self.volume.addItem(self.vol_bars)
        self.last_line = pg.InfiniteLine(angle=0, movable=False)
        self.price.addItem(self.last_line)
        self.cross_v = pg.InfiniteLine(angle=90, movable=False, pen=pg.mkPen(C['faint'], style=Qt.DashLine))
        self.cross_h = pg.InfiniteLine(angle=0, movable=False, pen=pg.mkPen(C['faint'], style=Qt.DashLine))
        self.price.addItem(self.cross_v, ignoreBounds=True)
        self.price.addItem(self.cross_h, ignoreBounds=True)
        self.readout = pg.TextItem(anchor=(0, 0), color=C['text'])
        self.price.addItem(self.readout, ignoreBounds=True)
        self.scene().sigMouseMoved.connect(self._moved)

    def set_bars(self, bars, intraday_stock=False):
        self.bars = bars
        self.daily = is_daily([b['time'] for b in bars])
        self.shade = intraday_stock
        self.candles.set_bars(bars)
        x = np.arange(len(bars))
        vols = [b.get('volume') or 0 for b in bars]
        brushes = [C['up_fill'] if b['close'] >= b['open'] else C['down_fill'] for b in bars]
        self.vol_bars.setOpts(x=x, height=vols, width=0.7, brushes=brushes, pens=[pg.mkPen(None)] * len(bars))
        if bars:
            last = bars[-1]
            col = C['up_fill'] if last['close'] >= last['open'] else C['down_fill']
            self.last_line.setPen(pg.mkPen(col, style=Qt.DashLine))
            self.last_line.setPos(last['close'])
            show = min(len(bars), 150)
            self.price.setXRange(len(bars) - show, len(bars) + 8, padding=0)  # room right of the last candle
            seen = bars[-show:]
            self.price.setYRange(min(b['low'] for b in seen), max(b['high'] for b in seen), padding=0.06)
        self.backdrop.update()

    def set_clock(self, clock):
        self.clock = clock
        for plot in (self.price, self.volume):
            plot.getAxis('bottom').picture = None
            plot.getAxis('bottom').update()

    def _moved(self, pos):
        if not self.bars or not self.price.sceneBoundingRect().contains(pos):
            return
        pt = self.price.vb.mapSceneToView(pos)
        i = int(round(pt.x()))
        self.cross_v.setPos(pt.x())
        self.cross_h.setPos(pt.y())
        if 0 <= i < len(self.bars):
            b = self.bars[i]
            chg = b['close'] - b['open']
            colour = C['up'] if chg >= 0 else C['down']
            when = time_label(b['time'], self.daily, self.clock)
            self.readout.setHtml(
                f"<span style='color:{C['label']}'>{when}</span>&nbsp; "
                f"<span style='color:{C['label']}'>O</span> {b['open']:.2f} <span style='color:{C['label']}'>H</span> {b['high']:.2f} "
                f"<span style='color:{C['label']}'>L</span> {b['low']:.2f} <span style='color:{C['label']}'>C</span> "
                f"<span style='color:{colour}'>{b['close']:.2f}</span>")
            r = self.price.vb.viewRect()
            self.readout.setPos(r.left(), r.bottom())
