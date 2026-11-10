"""Terminal or Web: what is remembered and when the start screen asks (no Qt needed)."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tp_desktop import choice, console  # noqa: E402


class Choice(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / 'sub' / 'desktop-choice.json'

    def tearDown(self):
        self.dir.cleanup()

    def test_nothing_saved_asks(self):
        self.assertIsNone(choice.remembered(self.file))
        self.assertIsNone(choice.decide(None, False, False))

    def test_remember_and_forget(self):
        choice.remember('web', self.file)
        self.assertEqual(choice.remembered(self.file), 'web')
        choice.remember(None, self.file)
        self.assertIsNone(choice.remembered(self.file))
        choice.remember(None, self.file)  # forgetting twice is fine

    def test_unknown_or_broken_file_asks(self):
        self.file.parent.mkdir(parents=True)
        for text in ('{"open": "phone"}', 'not json', '[1, 2]', ''):
            self.file.write_text(text)
            self.assertIsNone(choice.remembered(self.file), text)
        with self.assertRaises(ValueError):
            choice.remember('phone', self.file)

    def test_shift_or_choose_asks_again(self):
        self.assertEqual(choice.decide('terminal', False, False), 'terminal')
        self.assertIsNone(choice.decide('terminal', True, False))
        self.assertIsNone(choice.decide('web', False, True))


class HiddenHelperWindow(unittest.TestCase):
    def test_only_on_windows_when_the_launcher_asks(self):
        self.assertTrue(console.managed({console.FLAG: '1'}, 'win32'))
        self.assertFalse(console.managed({}, 'win32'))
        self.assertFalse(console.managed({console.FLAG: '1'}, 'darwin'))

    def test_needs_you_marker(self):
        with tempfile.TemporaryDirectory() as d:
            marker = Path(d) / 'helper-needs-you'
            self.assertFalse(console.helper_needs_you(marker))
            marker.write_text('1')
            self.assertTrue(console.helper_needs_you(marker))

    def test_does_nothing_off_windows(self):
        if sys.platform != 'win32':
            self.assertFalse(console.visible())
            console.show()
            console.hide()


if __name__ == '__main__':
    unittest.main()
