import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from tp_desktop.nav import PAGES, parse_command


class Nav(unittest.TestCase):
    def test_codes_unique(self):
        codes = [p.code for p in PAGES]
        self.assertEqual(len(codes), len(set(codes)))

    def test_commands(self):
        self.assertEqual(parse_command('aapl'), ('page', 'chart', 'AAPL'))
        self.assertEqual(parse_command('AAPL GP'), ('page', 'chart', 'AAPL'))
        self.assertEqual(parse_command('msft des'), ('page', 'quote', 'MSFT'))
        self.assertEqual(parse_command('WEI'), ('page', 'home', None))
        self.assertEqual(parse_command('account'), ('page', 'account', None))
        self.assertIsNone(parse_command(''))
        self.assertIsNone(parse_command('AAPL XYZ'))
        self.assertIsNone(parse_command('buy 100 aapl'))  # the app never trades


if __name__ == '__main__':
    unittest.main()
