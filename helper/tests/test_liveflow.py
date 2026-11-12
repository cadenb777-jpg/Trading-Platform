"""Live flow: off-exchange block prints, big options trades, config and session hours (engine/liveflow.py)."""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from engine import liveflow as lf  # noqa: E402
from engine.core import EngineError  # noqa: E402

NY = lf.NY


def contract(sym, vol, last, bid, ask, oi=1000, kind='call'):
    return {'symbol': sym, 'type': kind, 'strike': 500.0, 'expiration': '2026-12-18', 'volume': vol, 'last': last, 'mark': last,
            'bid': bid, 'ask': ask, 'oi': oi}


class Config(unittest.TestCase):
    def test_clean(self):
        c = lf.clean_config({'symbols': 'nvda, tsla,NVDA,,bad sym', 'blockMin': '5', 'alert': 0, 'junk': 1})
        self.assertEqual(c['symbols'], ['NVDA', 'TSLA'])
        self.assertEqual(c['blockMin'], 100_000)  # floor
        self.assertFalse(c['alert'])
        self.assertNotIn('junk', c)
        with self.assertRaises(EngineError):
            lf.clean_config({'symbols': [f'S{i}' for i in range(20)]})


class DarkPrints(unittest.TestCase):
    TRADES = [
        {'t': '2026-11-12T15:01:02Z', 'x': 'D', 'p': 500.0, 's': 4000, 'c': ['@'], 'i': 1},   # $2.0M off-exchange
        {'t': '2026-11-12T15:01:03Z', 'x': 'Q', 'p': 500.0, 's': 9000, 'c': ['@'], 'i': 2},   # on Nasdaq: not a dark print
        {'t': '2026-11-12T15:01:04Z', 'x': 'D', 'p': 500.0, 's': 100, 'c': ['@'], 'i': 3},    # too small
        {'t': '2026-11-12T15:01:05Z', 'x': 'D', 'p': 500.0, 's': 3000, 'c': ['W'], 'i': 4},   # average-price report
    ]

    def test_blocks_only_off_exchange_and_big(self):
        out = lf.dark_prints('NVDA', self.TRADES, 1_000_000)
        self.assertEqual([e['size'] for e in out], [4000, 3000])
        self.assertEqual(out[0]['notional'], 2_000_000)
        self.assertEqual(out[0]['late'], '')
        self.assertEqual(out[1]['late'], 'average price')

    def test_describe(self):
        title, message = lf.describe(lf.dark_prints('NVDA', self.TRADES[:1], 1_000_000)[0])
        self.assertEqual(title, 'Dark pool: NVDA $2.0M')
        self.assertIn('4,000 shares at $500.00 off-exchange at 10:01 AM', message)


class Options(unittest.TestCase):
    def test_first_poll_only_remembers(self):
        self.assertEqual(lf.option_events('NVDA', {}, [contract('C1', 5000, 5.0, 4.9, 5.0)], 250_000), [])

    def test_big_trade_at_ask_opening(self):
        out = lf.option_events('NVDA', {'C1': 1000}, [contract('C1', 3000, 5.0, 4.8, 5.0, oi=1500)], 250_000)
        self.assertEqual(len(out), 1)
        e = out[0]
        self.assertEqual(e['added'], 2000)
        self.assertEqual(e['premium'], 2000 * 5.0 * 100)
        self.assertEqual(e['side'], 'near the ask (bought)')
        self.assertTrue(e['opening'])

    def test_small_or_bid_side(self):
        self.assertEqual(lf.option_events('NVDA', {'C1': 1000}, [contract('C1', 1200, 5.0, 4.8, 5.2)], 250_000), [])  # $100K
        out = lf.option_events('NVDA', {'P1': 0}, [contract('P1', 1000, 4.8, 4.8, 5.2, kind='put')], 250_000)
        self.assertEqual(out[0]['side'], 'near the bid (sold)')


class Session(unittest.TestCase):
    def test_hours(self):
        d = dt.datetime(2026, 11, 12, tzinfo=NY)
        self.assertEqual(lf.session(d.replace(hour=10)), 'regular')
        self.assertEqual(lf.session(d.replace(hour=7)), 'extended')
        self.assertEqual(lf.session(d.replace(hour=21)), None)
        self.assertEqual(lf.session(dt.datetime(2026, 11, 14, 10, tzinfo=NY)), None)  # Saturday

    def test_feed_dedupes(self):
        live = lf.Live()
        e = lf.dark_prints('NVDA', DarkPrints.TRADES[:1], 1_000_000)
        self.assertEqual(len(live.add(e)), 1)
        self.assertEqual(len(live.add([dict(x) for x in e])), 0)
        self.assertIn('title', live.feed[0])


if __name__ == '__main__':
    unittest.main()
