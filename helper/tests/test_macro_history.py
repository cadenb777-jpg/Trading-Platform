"""Helper 104: macro.series raw `since` (full FRED history for the recession records)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine import macro  # noqa: E402
from engine.core import EngineError  # noqa: E402


class HistoryStart(unittest.TestCase):
    def test_absent_or_late_uses_the_default_download(self):
        self.assertIsNone(macro.history_start(None))
        self.assertIsNone(macro.history_start(''))
        # START (2006-01-01) and later: the default download already covers it
        self.assertIsNone(macro.history_start(macro.START))
        self.assertIsNone(macro.history_start('2010-05-01'))

    def test_earlier_dates_start_on_january_1_of_their_year(self):
        # one saved copy per year at most, however many dates a page asks for
        self.assertEqual(macro.history_start('1959-12-01'), '1959-01-01')
        self.assertEqual(macro.history_start('1948-01-01'), '1948-01-01')
        self.assertEqual(macro.history_start('1850-01-01'), '1850-01-01')

    def test_refuses_anything_but_a_clean_date(self):
        for bad in ('1849-12-31', '1959-12', '19591201', '1959-13-01', '1959-12-01T00:00', '1850-W01-1', '2026-W01-1', "1959-12-01'; drop", 1959, 'x'):
            with self.assertRaises(EngineError, msg=repr(bad)):
                macro.history_start(bad)


class OneSeries(unittest.TestCase):
    """The raw request path: `since` picks the full download; an empty saved copy is refused plainly."""

    def run_series(self, msg, rows):
        import asyncio
        calls = []

        async def fake_from(ctx, sid, start):
            calls.append(('from', sid, start))
            return rows

        async def fake_fred(ctx, sid):
            calls.append(('fred', sid))
            return rows

        old = (macro.fred_from, macro.fred)
        macro.fred_from, macro.fred = fake_from, fake_fred
        try:
            return asyncio.run(macro.one_series(None, msg)), calls
        finally:
            macro.fred_from, macro.fred = old

    def test_since_reaches_the_full_download(self):
        out, calls = self.run_series({'series': 'usrec', 'raw': True, 'since': '1948-06-01'}, [('1948-01-01', 0.0), ('2026-10-01', 0.0)])
        self.assertEqual(calls, [('from', 'USREC', '1948-01-01')])
        self.assertEqual(out['data'][0], {'time': '1948-01-01', 'value': 0.0})
        _, calls = self.run_series({'series': 'USREC', 'raw': True}, [('2006-01-01', 0.0)])
        self.assertEqual(calls, [('fred', 'USREC')])

    def test_empty_rows_are_refused(self):
        with self.assertRaises(EngineError):
            self.run_series({'series': 'DFII10', 'raw': True, 'since': '2003-01-01'}, [])


if __name__ == '__main__':
    unittest.main()
