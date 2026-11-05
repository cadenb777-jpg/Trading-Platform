"""The trading journal: fills grouped into round trips (scale-ins, partial exits, shorts, futures), P&L and R, dedupe
across sources, the Webull backfill (read-only, paged, positions from before the history), orders.log tagging, the
owner's notes surviving a rebuild, and that the journal never sends orders. No network."""
import asyncio
import datetime as dt
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

from engine import journal, store, webull  # noqa: E402
import test_webull as tw  # noqa: E402

T0 = dt.datetime(2026, 3, 2, 15, 0, tzinfo=dt.timezone.utc).timestamp()  # a Monday, 10:00 New York


def fill(side, qty, price, minutes=0, symbol='AAPL', fees=0.0, account='A', order_id='', **kw):
    return journal.clean_fill({'symbol': symbol, 'side': side, 'qty': qty, 'price': price, 'time': T0 + minutes * 60, 'fees': fees,
                               'account': account, 'orderId': order_id, **kw}, kw.pop('source', 'manual') if 'source' in kw else 'manual')


def ids(fills):
    return [{**f, 'fillId': f'f{i}'} for i, f in enumerate(fills)]


class Grouping(unittest.TestCase):
    def test_scale_in_and_partial_exits_fifo(self):
        trades = journal.group_fills(ids([fill('BUY', 10, 100), fill('BUY', 10, 110, 5), fill('SELL', 5, 120, 10, fees=1), fill('SELL', 15, 90, 20, fees=1)]))
        self.assertEqual(len(trades), 1)
        t = trades[0]
        self.assertEqual((t['side'], t['status'], len(t['entries']), len(t['exits'])), ('long', 'closed', 2, 2))
        # FIFO: 5 @ (120-100) + 5 @ (90-100) + 10 @ (90-110) = 100 - 50 - 200 = -150, minus $2 fees
        self.assertAlmostEqual(journal.realized(t), -152.0)

    def test_partial_exit_still_open(self):
        t = journal.group_fills(ids([fill('BUY', 10, 100), fill('SELL', 4, 110, 5)]))[0]
        self.assertEqual((t['status'], t['openQty']), ('open', 6))
        self.assertAlmostEqual(journal.realized(t), 40.0)

    def test_short_and_flip_for_futures(self):
        f = [fill('SELL', 2, 6800, symbol='MESZ6'), fill('BUY', 3, 6790, 10, symbol='MESZ6'), fill('SELL', 1, 6800, 20, symbol='MESZ6')]
        trades = journal.group_fills(ids(f))
        self.assertEqual([(t['side'], t['status']) for t in trades], [('short', 'closed'), ('long', 'closed')])
        self.assertEqual(trades[0]['multiplier'], 5)
        self.assertEqual(trades[0]['assetClass'], 'futures')
        self.assertAlmostEqual(journal.realized(trades[0]), 2 * 10 * 5)  # 10 points x 2 contracts x $5
        self.assertAlmostEqual(journal.realized(trades[1]), 1 * 10 * 5)

    def test_stock_short_needs_an_explicit_short(self):
        t = journal.group_fills(ids([fill('SELL', 10, 50, open='short'), fill('BUY', 10, 45, 30)]))
        self.assertEqual((t[0]['side'], t[0]['status']), ('short', 'closed'))
        self.assertAlmostEqual(journal.realized(t[0]), 50.0)
        # a plain stock sell with nothing held = shares bought before the journal: unknown cost, left out of stats
        orphan = journal.group_fills(ids([fill('SELL', 10, 50)]))[0]
        self.assertTrue(orphan['costUnknown'] and orphan['openedBefore'])
        self.assertIsNone(journal.realized(orphan))

    def test_accounts_and_symbols_are_separate(self):
        trades = journal.group_fills(ids([fill('BUY', 1, 10), fill('BUY', 1, 10, account='B'), fill('SELL', 1, 11, 5)]))
        self.assertEqual(sorted((t['account'], t['status']) for t in trades), [('A', 'closed'), ('B', 'open')])

    def test_r_multiple_from_the_planned_stop(self):
        t = journal.group_fills(ids([fill('BUY', 10, 100), fill('SELL', 10, 106, 5)]))[0]
        t['plan'] = {'stop': 97}
        self.assertAlmostEqual(journal.r_multiple(t), 2.0)  # +$60 on $30 risk
        t['plan'] = {}
        self.assertIsNone(journal.r_multiple(t))

    def test_summary_leaves_out_unknown_cost_and_before_journal(self):
        trades = journal.group_fills(ids([fill('BUY', 1, 10), fill('SELL', 1, 12, 1), fill('SELL', 5, 9, 2, symbol='MSFT')]))
        for t in trades:
            t['pnl'] = journal.realized(t)
        s = journal.summary(trades)
        self.assertEqual((s['closedTrades'], s['wins'], s['enoughTrades']), (1, 1, False))


class Journal(tw.Base):
    """Uses the Webull tests' setup: temporary platform.db, settings and orders.log, and the fake Webull."""

    def setUp(self):
        super().setUp()
        p = mock.patch.object(journal, 'DIR', Path(self.tmp.name) / 'journal')
        p.start()
        self.addCleanup(p.stop)

    def test_dedupe_across_sources_and_reimports(self):
        csv = [{'symbol': 'AAPL', 'side': 'BUY', 'qty': 10, 'price': 100, 'time': T0}, {'symbol': 'AAPL', 'side': 'SELL', 'qty': 10, 'price': 105, 'time': T0 + 3600}]
        r = journal.import_batch(csv, 'csv:webull')
        self.assertEqual((r['added'], r['skipped']), (2, 0))
        self.assertEqual(journal.import_batch(csv, 'csv:webull')['added'], 0)  # the same file again
        # the same fills from another export (a few seconds apart, other time of day) are recognised
        other = [{**f, 'time': f['time'] + 7} for f in csv]
        self.assertEqual(journal.import_batch(other, 'csv:schwab')['skipped'], 2)
        # the same order fill seen again (same order id, quantity, price and time) is skipped
        journal.import_batch([{'symbol': 'MSFT', 'side': 'BUY', 'qty': 1, 'price': 400, 'time': T0, 'orderId': 'X1'}], 'csv:ibkr')
        self.assertEqual(journal.import_batch([{'symbol': 'MSFT', 'side': 'BUY', 'qty': 1, 'price': 400, 'time': T0, 'orderId': 'X1'}], 'csv:ibkr')['added'], 0)
        self.assertEqual(len(journal.all_trades()), 2)

    def test_two_identical_fills_on_one_day_both_count(self):
        same = {'symbol': 'AAPL', 'side': 'BUY', 'qty': 1, 'price': 100, 'time': T0}
        self.assertEqual(journal.import_batch([same, {**same, 'time': T0 + 60}], 'csv:robinhood')['added'], 2)
        self.assertEqual(journal.import_batch([same, {**same, 'time': T0 + 60}], 'csv:fidelity')['added'], 0)
        # a third identical fill later in the same source (another file) is a new fill, not a duplicate
        self.assertEqual(journal.import_batch([{**same, 'time': T0 + 120}], 'csv:robinhood')['added'], 1)

    def test_identical_fills_in_two_accounts_both_count(self):
        same = {'symbol': 'AAPL', 'side': 'BUY', 'qty': 1, 'price': 100, 'time': T0}
        self.assertEqual(journal.import_batch([{**same, 'account': 'Roth'}], 'csv:schwab')['added'], 1)
        self.assertEqual(journal.import_batch([{**same, 'account': 'Margin'}], 'csv:fidelity')['added'], 1)
        self.assertEqual(journal.import_batch([{**same, 'account': 'Margin'}], 'csv:etrade')['added'], 0)  # same account, other source
        self.assertEqual(sorted(t['account'] for t in journal.all_trades()), ['Margin', 'Roth'])

    def test_same_source_fills_with_other_execution_ids_or_times_both_count(self):
        same = {'symbol': 'AAPL', 'side': 'BUY', 'qty': 1, 'price': 100, 'time': T0, 'account': 'A'}
        self.assertEqual(journal.import_batch([{**same, 'execId': 'e1'}, {**same, 'execId': 'e2'}], 'csv:ibkr')['added'], 2)
        self.assertEqual(journal.import_batch([{**same, 'execId': 'e3'}], 'csv:ibkr')['added'], 1)  # same day and price, new execution
        self.assertEqual(journal.import_batch([{**same, 'execId': 'e1'}], 'csv:ibkr')['added'], 0)  # seen before
        self.assertEqual(journal.import_batch([{**same, 'time': T0 + 30}], 'csv:robinhood')['skipped'], 1)  # other source: same fill
        self.assertEqual(journal.import_batch([{**same, 'time': T0 + 600}, {**same, 'time': T0 + 900}], 'manual')['added'], 2)  # manual: never matched

    def test_partial_fills_of_one_order_stay_apart(self):
        part = {'symbol': 'MSFT', 'side': 'BUY', 'orderId': 'O7', 'account': 'A'}
        r = journal.import_batch([{**part, 'qty': 3, 'price': 400, 'time': T0}, {**part, 'qty': 2, 'price': 400.05, 'time': T0 + 2},
                                  {**part, 'qty': 3, 'price': 400, 'time': T0 + 5}], 'csv:webull')
        self.assertEqual(r['added'], 3)
        t = journal.all_trades()[0]
        self.assertEqual(sum(e['qty'] for e in t['entries']), 8)
        # two partial fills with the same size, price and second (no execution id) both count; the same file again adds 0
        twins = [{**part, 'orderId': 'O8', 'qty': 1, 'price': 401, 'time': T0 + 60}] * 2
        self.assertEqual(journal.import_batch(twins, 'csv:webull')['added'], 2)
        self.assertEqual(journal.import_batch(twins, 'csv:webull')['added'], 0)

    def test_same_second_fills_keep_their_arrival_order(self):
        # the sell's id sorts before the buy's, but the buy came first: one closed long, not an orphan sell
        rows = [{'symbol': 'AAPL', 'side': 'BUY', 'qty': 5, 'price': 100, 'time': T0, 'execId': 'zz'},
                {'symbol': 'AAPL', 'side': 'SELL', 'qty': 5, 'price': 101, 'time': T0, 'execId': 'aa'}]
        journal.import_batch(rows, 'csv:ibkr')
        t = journal.all_trades()
        self.assertEqual([(x['side'], x['status'], x['costUnknown']) for x in t], [('long', 'closed', False)])
        self.assertAlmostEqual(t[0]['pnl'], 5.0)

    def test_owner_notes_survive_a_rebuild(self):
        journal.import_batch([{'symbol': 'AAPL', 'side': 'BUY', 'qty': 10, 'price': 100, 'time': T0}], 'manual')
        t = journal.all_trades()[0]
        run(journal.save_trade(None, {'tradeId': t['id'], 'changes': {'notes': 'chased', 'tags': ['fomo'], 'rating': 2, 'plan': {'stop': 95}}}))
        journal.import_batch([{'symbol': 'AAPL', 'side': 'SELL', 'qty': 10, 'price': 110, 'time': T0 + 600}], 'manual')
        t = journal.all_trades()[0]
        self.assertEqual((t['notes'], t['tags'], t['rating'], t['status']), ('chased', ['fomo'], 2, 'closed'))
        self.assertAlmostEqual(t['r'], 2.0)
        with self.assertRaises(journal.EngineError):
            run(journal.save_trade(None, {'tradeId': t['id'], 'changes': {'entries': []}}))

    def test_deleted_trade_does_not_come_back(self):
        rows = [{'symbol': 'AAPL', 'side': 'BUY', 'qty': 1, 'price': 1, 'time': T0}]
        journal.import_batch(rows, 'csv:etrade')
        run(journal.delete_trade(None, {'tradeId': journal.all_trades()[0]['id']}))
        journal.import_batch(rows, 'csv:etrade')
        self.assertEqual(journal.all_trades(), [])

    def test_webull_backfill_pages_back_and_adds_positions_from_before(self):
        day = lambda d: (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=d)).isoformat()
        page1 = [{'client_order_id': f'b{i}', 'symbol': 'MSFT', 'side': 'BUY' if i % 2 == 0 else 'SELL', 'quantity': '1', 'filled_quantity': '1',
                  'filled_price': str(400 + i), 'filled_time': day(300 - i), 'status': 'FILLED'} for i in range(webull.HISTORY_PAGE)]
        page2 = [{'client_order_id': 'last', 'symbol': 'AAPL', 'side': 'SELL', 'quantity': '4', 'filled_quantity': '4', 'filled_price': '210', 'filled_time': day(2), 'status': 'FILLED'},
                 {'client_order_id': 'np', 'symbol': 'AAPL', 'side': 'BUY', 'quantity': '1', 'filled_quantity': '1', 'status': 'FILLED'},
                 {'client_order_id': 'cx', 'symbol': 'AAPL', 'side': 'BUY', 'quantity': '1', 'filled_quantity': '0', 'status': 'CANCELLED'}]
        pages = []
        orig = self.fake.request

        async def request(method, url, headers=None, content=None):
            if 'historical-orders' in url:
                self.fake.calls.append({'path': '/trading/orders/historical-orders/list', 'url': url})
                pages.append(url)
                return tw.Resp(200, {'orders': page2 if 'last_client_order_id' in url else page1})
            return await orig(method, url, headers, content)
        self.fake.request = request
        # AAPL: 10 held now; the history only shows a sale of 4, so 14 were held before (at the broker's average cost)
        self.fake.positions = [{'symbol': 'AAPL', 'quantity': '10', 'cost_price': '150', 'instrument_type': 'EQUITY'}]
        r = run(journal.import_webull(self.ctx, {}))
        self.assertEqual(len(pages), 2)
        self.assertIn('start_date=', pages[0])
        self.assertIn('last_client_order_id=b99', pages[1])
        self.assertRegex(r['message'], r'^Imported \d+ trades from \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d\.')
        self.assertIn('730 days', r['windowNote'])
        self.assertIn('CSV', r['windowNote'])
        self.assertTrue(any('without a fill price' in n for n in r['notes']))
        aapl = [t for t in journal.all_trades() if t['symbol'] == 'AAPL']
        self.assertEqual(len(aapl), 1)
        self.assertTrue(aapl[0]['openedBefore'])
        self.assertEqual((aapl[0]['entries'][0]['qty'], aapl[0]['entries'][0]['price'], aapl[0]['openQty']), (14, 150, 10))
        self.assertEqual(len([t for t in journal.all_trades() if t['symbol'] == 'MSFT']), 50)
        self.assertNotIn('/trading/orders/place', self.fake.paths())
        # run again: nothing doubles
        again = run(journal.import_webull(self.ctx, {}))
        self.assertEqual(again['added'], 0)
        self.assertEqual(len(journal.all_trades()), 51)

    def test_orders_log_and_trade_page_plan_tag_trades(self):
        webull.ORDERS_LOG.write_text('\n'.join(json.dumps(x) for x in (
            {'time': '2026-03-02T15:00:00+00:00', 'env': 'test', 'action': 'place', 'order': 'Buy 10 AAPL at a limit of $100.00, day only', 'result': 'attempt'},
            {'time': '2026-03-02T15:00:01+00:00', 'env': 'test', 'action': 'place', 'order': 'Buy 10 AAPL at a limit of $100.00, day only', 'result': 'placed', 'orderId': 'ord1'},
            {'time': '2026-03-02T15:00:01+00:00', 'env': 'test', 'action': 'place', 'result': 'refused', 'reason': 'x'})) + '\nnot json\n')
        run(journal.save_plan(None, {'orderId': 'ord1', 'symbol': 'AAPL', 'stop': 95, 'target': 110, 'setup': 'Pullback · A-grade', 'strategy': 'weekly_swing'}))
        journal.import_batch([{'symbol': 'AAPL', 'side': 'BUY', 'qty': 10, 'price': 100, 'time': T0, 'orderId': 'ord1'},
                              {'symbol': 'AAPL', 'side': 'SELL', 'qty': 10, 'price': 110, 'time': T0 + 99}], 'csv:webull')
        r = run(journal.import_orders_log(None, {}))
        self.assertEqual((r['orders'], r['tagged']), (1, 1))
        t = journal.all_trades()[0]
        self.assertTrue(t['viaPlatform'])
        self.assertEqual((t['plan']['stop'], t['plan']['target'], t['strategy']), (95, 110, 'weekly_swing'))
        self.assertAlmostEqual(t['r'], 2.0)

    def test_coach_shows_the_cost_before_running(self):
        journal.import_batch([{'symbol': 'AAPL', 'side': 'BUY', 'qty': 1, 'price': 100, 'time': T0}], 'manual')
        r = run(journal.coach(None, {'mode': 'trade', 'tradeId': journal.all_trades()[0]['id']}))
        self.assertEqual(set(r), {'estimate'})
        self.assertGreater(r['estimate']['costUsd'], 0)

    def test_screenshots_stay_in_the_journal_folder(self):
        journal.import_batch([{'symbol': 'AAPL', 'side': 'BUY', 'qty': 1, 'price': 100, 'time': T0}], 'manual')
        tid = journal.all_trades()[0]['id']
        r = run(journal.screenshot_add(None, {'tradeId': tid, 'mediaType': 'image/png', 'data': 'iVBORw0KGgo='}))
        self.assertTrue((journal.DIR / r['name']).exists())
        self.assertEqual(run(journal.screenshot(None, {'name': r['name']}))['data'], 'iVBORw0KGgo=')
        with self.assertRaises(journal.EngineError):
            run(journal.screenshot(None, {'name': '../platform.db'}))


class NeverTrades(unittest.TestCase):
    def test_journal_never_sends_orders(self):
        code = re.sub(r'"""[\s\S]*?"""', '', Path(journal.__file__).read_text())
        for word in ('orders/place', 'place_order', 'preview_order', 'cancel_order', "'POST'", '_call('):
            self.assertNotIn(word, code)


def run(coro):
    return asyncio.run(coro)


if __name__ == '__main__':
    unittest.main()
