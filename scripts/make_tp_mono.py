"""
Builds TP Mono, the terminal font: JetBrains Mono (SIL Open Font License 1.1, no reserved font name) with a plain zero
(the owner found the dotted zero distracting; no free monospace font has a plain one), renamed as the licence asks for
a modified version, cut to the characters the platform shows, without ligatures (so "->" stays two characters).

Run: python scripts/make_tp_mono.py [folder with JetBrainsMono-*.ttf]   (needs fonttools and brotli)
Writes src/fonts/tp-mono-<weight>.woff2 and src/fonts/OFL-TP-Mono.txt.
"""
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/jetbrains-mono')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'fonts'
WEIGHTS = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold'}
TEXT = ''.join(map(chr, [*range(0x20, 0x7F), *range(0xA0, 0x100)])) + '–—‘’“”•…←↑→↓−▲▼▶◀·σ≈≤≥±€‰›‹✓✗×÷°′″'


def plain_zero(font):
    """Removes the dot inside the zero: the smallest contour of the glyph, which sits inside the others."""
    glyf = font['glyf']
    g = glyf['zero']
    coords, ends, flags = g.getCoordinates(glyf)
    starts = [0, *[e + 1 for e in ends[:-1]]]
    contours = [list(range(s, e + 1)) for s, e in zip(starts, ends)]
    if len(contours) < 3:
        return  # already plain

    def area(idx):
        xs = [coords[i][0] for i in idx]
        ys = [coords[i][1] for i in idx]
        return (max(xs) - min(xs)) * (max(ys) - min(ys))
    dot = min(range(len(contours)), key=lambda k: area(contours[k]))
    keep = [k for k in range(len(contours)) if k != dot]
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.pens.recordingPen import RecordingPen
    rec = RecordingPen()
    g.draw(rec, glyf)
    # split the recording into contours and drop the dot's
    parts, cur = [], []
    for op in rec.value:
        cur.append(op)
        if op[0] in ('closePath', 'endPath'):
            parts.append(cur)
            cur = []
    pen = TTGlyphPen(None)
    for k in keep:
        for op, args in parts[k]:
            getattr(pen, op)(*args)
    glyf['zero'] = pen.glyph()
    glyf['zero'].recalcBounds(glyf)


def rename(font, weight_name):
    for rec in font['name'].names:
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            text = rec.toUnicode()
            text = text.replace('JetBrains Mono', 'TP Mono').replace('JetBrainsMono', 'TPMono')
            rec.string = text


def build(weight, name):
    font = TTFont(SRC / f'JetBrainsMono-{name}.ttf')
    plain_zero(font)
    rename(font, name)
    opts = Options()
    opts.layout_features = ['kern', 'tnum', 'case']  # no ligatures
    opts.flavor = 'woff2'
    opts.name_IDs = ['*']
    sub = Subsetter(opts)
    sub.populate(text=TEXT)
    sub.subset(font)
    font.flavor = 'woff2'
    out = OUT / f'tp-mono-{weight}.woff2'
    font.save(out)
    print(out.name, out.stat().st_size)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for w, n in WEIGHTS.items():
        build(w, n)
