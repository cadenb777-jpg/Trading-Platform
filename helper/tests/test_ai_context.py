"""The AI sees what's on the user's screen, but an unchanged screen isn't repeated in long chats."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from engine import ai
except Exception:  # optional AI packages missing
    ai = None


@unittest.skipIf(ai is None, 'AI module not available')
class ScreenContext(unittest.TestCase):
    def test_screen_is_included_when_new(self):
        text = ai._context_text({'page': 'Setups', 'screen': 'Avg win +1.2% Avg loss -2.0%'})
        self.assertIn('<screen>', text)
        self.assertIn('Avg loss -2.0%', text)

    def test_unchanged_screen_is_not_repeated(self):
        text = ai._context_text({'page': 'Setups', 'screen': 'same'}, last_screen='same')
        self.assertNotIn('<screen>', text)
        self.assertIn('Same screen', text)

    def test_screen_is_capped(self):
        text = ai._context_text({'page': 'Macro', 'screen': 'x' * 50000})
        self.assertLess(len(text), ai.SCREEN_CHARS + 1000)

    def test_no_screen_still_works(self):
        self.assertNotIn('<screen>', ai._context_text(None))


if __name__ == '__main__':
    unittest.main()
