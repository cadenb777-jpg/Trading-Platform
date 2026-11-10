"""Makes the app's icon files from tp_desktop/assets/logo.svg (run after changing the logo; the results are committed):
logo.png (256 px, the window and splash), logo.ico (Windows: 16-256 px) and logo.icns (Mac). Needs PySide6 and Pillow."""
from pathlib import Path

from PIL import Image
from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ASSETS = Path(__file__).resolve().parent / 'tp_desktop' / 'assets'


def render(size):
    img = QImage(size, size, QImage.Format_ARGB32)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    QSvgRenderer(str(ASSETS / 'logo.svg')).render(p)
    p.end()
    path = ASSETS / f'.tmp-{size}.png'
    img.save(str(path))
    out = Image.open(path).convert('RGBA')
    path.unlink()
    return out


def main():
    app = QGuiApplication([])  # noqa: F841  (Qt needs an application to draw)
    big = render(1024)
    render(256).save(ASSETS / 'logo.png')
    big.save(ASSETS / 'logo.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    big.save(ASSETS / 'logo.icns')
    print('made', ', '.join(p.name for p in sorted(ASSETS.iterdir())))


if __name__ == '__main__':
    main()
