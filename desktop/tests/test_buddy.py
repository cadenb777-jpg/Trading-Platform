import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
from tp_desktop.buddy import COATS, MAP, mood_for, nearest_free, pet_line  # noqa: E402
from tp_desktop.effects import SHAPES, shape_at  # noqa: E402

WEB = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'ui', 'buddy.ts')


class Buddy(unittest.TestCase):
    def test_same_dog_as_the_website(self):
        text = open(WEB, encoding='utf-8').read()
        web_map = re.findall(r"^  '([.A-Z]{18})',$", text, re.M)
        self.assertEqual(web_map, MAP)
        for name, colours in COATS.items():
            self.assertIn(f"{name}: ['{colours[0]}', '{colours[1]}', '{colours[2]}']", text)

    def test_mood_and_lines(self):
        self.assertEqual(mood_for(None), 'calm')
        self.assertEqual(mood_for(0.5), 'happy')
        self.assertEqual(mood_for(-0.5), 'sad')
        self.assertIn('+1.23%', pet_line(1.234, 0))

    def test_finds_empty_spot(self):
        spot = nearest_free(100, 300, 1400, 900, lambda x, y: x >= 500)
        self.assertGreaterEqual(spot[0], 500)
        self.assertIsNone(nearest_free(100, 300, 1400, 900, lambda x, y: False))


class Background(unittest.TestCase):
    def test_shapes_glide_slowly_within_their_paths(self):
        for shape in SHAPES:
            self.assertGreaterEqual(shape[4], 45)
            for t in range(0, 400, 7):
                x, y, a = shape_at(shape, t)
                lo_x, hi_x = sorted((shape[2][0], shape[3][0]))
                self.assertTrue(lo_x - 1e-9 <= x <= hi_x + 1e-9)
                self.assertTrue(shape[1] * 0.55 - 1e-6 <= a <= shape[1] + 1e-6)
            # smooth: a tenth of a second moves it less than 1% of the window
            x0, y0, _ = shape_at(shape, 10)
            x1, y1, _ = shape_at(shape, 10.1)
            self.assertLess(abs(x1 - x0) + abs(y1 - y0), 0.01)


if __name__ == '__main__':
    unittest.main()
