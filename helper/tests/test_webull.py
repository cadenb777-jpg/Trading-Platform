"""Webull: signing, reading the account, sync to Portfolios and the order safety rails (preview token, limits,
Test/Live, no short selling, the order log) and that the AI can't reach it. No network and no real keys."""
import asyncio
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import core, settings, store, webull  # noqa: E402

KEYS = {'webull_app_key': 'testappkey123', 'webull_app_secret': 'testappsecret456'}


class Resp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class FakeWebull:
    """Answers the Webull OpenAPI paths the module uses, and records every request."""

    def __init__(self, positions=None, token_check=False, token_status='NORMAL', status=200):
        self.calls = []
        self.positions = positions if positions is not None else [{'symbol': 'AAPL', 'quantity': '10', 'cost_price': '150', 'last_price': '200', 'instrument_type': 'EQUITY'}]
        self.token_check, self.token_status, self.status = token_check, token_status, status
        self.open_orders = [{'client_order_id': 'o1', 'orders': [{'symbol': 'AAPL', 'side': 'BUY', 'quantity': '1', 'order_type': 'LIMIT', 'limit_price': '190', 'time_in_force': 'DAY', 'status': 'SUBMITTED'}]}]
        self.place_delay = 0          # seconds the place request takes (to test two windows at once)
        self.place_fails = None       # 'timeout' or a 5xx status: Webull may or may not have the order
        self.lookup_finds = False     # whether GET /trading/orders/get then finds it
        self.placed_ids = []

    async def request(self, method, url, headers=None, content=None):
        u = urlparse(url)
        body = json.loads(content) if content else None
        self.calls.append({'method': method, 'host': u.netloc, 'path': u.path, 'query': {k: v[0] for k, v in parse_qs(u.query).items()}, 'headers': dict(headers or {}), 'body': body})
        if self.status != 200:
            return Resp(self.status, {'message': 'nope'})
        p = u.path
        if p == '/trading/orders/place':
            if self.place_delay:
                await asyncio.sleep(self.place_delay)
            self.placed_ids.append(body['new_orders'][0]['client_order_id'])
            if self.place_fails == 'timeout':
                raise TimeoutError('read timed out')
            if self.place_fails:
                return Resp(self.place_fails, {'message': 'gateway error'})
        if p == '/trading/orders/get':
            cid = parse_qs(u.query)['client_order_id'][0]
            return Resp(200, {'client_order_id': cid, 'status': 'SUBMITTED'}) if self.lookup_finds else Resp(404, {'message': 'order not found'})
        if p == '/openapi/config':
            return Resp(200, {'token_check_enabled': self.token_check})
        if p == '/auth/tokens/create':
            return Resp(200, {'token': 'tok-1', 'expires': 9999999999999, 'status': self.token_status})
        if p == '/auth/tokens/check':
            return Resp(200, {'token': 'tok-1', 'expires': 9999999999999, 'status': self.token_status})
        if p == '/trading/accounts/list':
            return Resp(200, [{'account_id': 'ACC123456', 'account_number': '5MV12345', 'account_type': 'CASH'}])
        if p == '/trading/assets/balances/get':
            return Resp(200, {'total_asset': '12000.5', 'account_currency_assets': [{'currency': 'USD', 'cash_balance': '2000', 'buying_power': '4000'}]})
        if p == '/trading/assets/positions/list':
            return Resp(200, self.positions)
        if p == '/trading/orders/open-orders/list':
            return Resp(200, {'has_next': False, 'orders': self.open_orders})
        if p == '/trading/orders/historical-orders/list':
            return Resp(200, {'orders': [{'client_order_id': 'o0', 'symbol': 'MSFT', 'side': 'SELL', 'quantity': '2', 'order_type': 'MARKET', 'status': 'FILLED'}]})
        if p in ('/trading/orders/preview', '/trading/orders/place', '/trading/orders/cancel'):
            return Resp(200, {'estimated_cost': '1900', 'client_order_id': (body.get('new_orders') or [{}])[0].get('client_order_id') or body.get('client_order_id')})
        return Resp(404, {'message': 'unknown path'})

    def paths(self):
        return [c['path'] for c in self.calls]


class Ctx:
    def __init__(self, http):
        self.http = http


def run(coro):
    return asyncio.run(coro)


ORDER = {'symbol': 'AAPL', 'side': 'BUY', 'qty': 2, 'orderType': 'LIMIT', 'limitPrice': 195, 'tif': 'DAY'}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        d = Path(self.tmp.name)
        for target, attr, value in ((settings, 'SETTINGS_PATH', d / 'settings.json'), (webull, 'DATA_DIR', d), (webull, 'ORDERS_LOG', d / 'orders.log'),
                                    (webull, 'TOKEN_PATH', d / 'webull_token.json'), (store, 'DB_PATH', d / 'platform.db')):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        settings._cache = dict(KEYS)
        self.addCleanup(setattr, settings, '_cache', None)
        store._db = None
        self.addCleanup(self._close_db)
        webull._previews.clear()
        webull._config_cache.clear()
        price = mock.patch.object(webull, 'last_price', mock.AsyncMock(return_value=200.0))
        price.start()
        self.addCleanup(price.stop)
        self.fake = FakeWebull()
        self.ctx = Ctx(self.fake)

    def _close_db(self):
        if store._db is not None:
            store._db.close()
            store._db = None

    def log(self):
        try:
            return [json.loads(x) for x in webull.ORDERS_LOG.read_text().splitlines()]
        except OSError:
            return []

    def preview(self, **changes):
        return run(webull.preview_order(self.ctx, {**ORDER, **changes}))


class Signing(Base):
    # Expected values were produced by the official SDK (webull-openapi-python-sdk 3.0.4,
    # default_signature_composer.calc_signature) with the same timestamp and nonce.
    def test_get_with_query_matches_sdk(self):
        h = webull.sign('us-openapi-alb.uat.webullbroker.com', '/trading/orders/x', {'account_id': 'ACC1', 'page_size': '10'}, None,
                        'KEY123', 'SECRET456', timestamp='2026-01-02T03:04:05Z', nonce='nonce-123')
        self.assertEqual(h['x-signature'], 'gWyWoJAUosJ0SpuKG7X5L5JmIQp+9LFEY+LuXFXaY8w=')
        self.assertEqual(h['x-signature-algorithm'], 'HMAC-SHA256')

    def test_post_with_body_matches_sdk(self):
        body = json.dumps({'account_id': 'ACC1', 'client_order_id': 'abc'}, separators=(',', ':'))
        h = webull.sign('us-openapi-alb.uat.webullbroker.com', '/trading/orders/x', {}, body, 'KEY123', 'SECRET456',
                        timestamp='2026-01-02T03:04:05Z', nonce='nonce-123')
        self.assertEqual(h['x-signature'], 'gzIUkQ2WvGWDmWzIN/Rm5UHpVlnvKB2KA96h9pqhP7U=')

    def test_requests_go_to_test_host_signed_and_body_matches(self):
        run(webull.account(self.ctx, {}))
        call = self.fake.calls[-1]
        self.assertEqual(call['host'], 'us-openapi-alb.uat.webullbroker.com')
        self.assertEqual(call['headers']['x-app-key'], KEYS['webull_app_key'])
        self.assertNotIn(KEYS['webull_app_secret'], json.dumps(call['headers']))
        self.assertIn('x-signature', call['headers'])


class Reading(Base):
    def test_account_positions_orders(self):
        a = run(webull.account(self.ctx, {}))
        self.assertEqual((a['value'], a['cash'], a['buyingPower']), (12000.5, 2000.0, 4000.0))
        p = run(webull.positions_handler(self.ctx, {}))['positions'][0]  # no Schwab in this test: no price, Webull's own fields only
        self.assertEqual((p['symbol'], p['qty'], p['avgCost'], p['cost'], p['type']), ('AAPL', 10.0, 150.0, 1500.0, 'EQUITY'))
        o = run(webull.orders_handler(self.ctx, {}))
        self.assertEqual(o['open'][0]['orderId'], 'o1')
        self.assertEqual(o['open'][0]['symbol'], 'AAPL')
        self.assertEqual(o['recent'][0]['status'], 'FILLED')

    def test_status_without_keys_and_with_bad_keys(self):
        settings._cache = {}
        self.assertFalse(run(webull.status(self.ctx, {}))['ok'])
        self.assertEqual(self.fake.calls, [])
        settings._cache = dict(KEYS)
        self.fake.status = 401
        r = run(webull.status(self.ctx, {}))
        self.assertFalse(r['ok'])
        self.assertIn('rejected', r['message'])

    def test_access_token_needs_app_approval(self):
        self.fake.token_check, self.fake.token_status = True, 'PENDING'
        r = run(webull.status(self.ctx, {}))
        self.assertFalse(r['ok'])
        self.assertIn('approve', r['message'])
        self.fake.token_status = 'NORMAL'
        self.assertTrue(run(webull.status(self.ctx, {}))['ok'])
        self.assertEqual(self.fake.calls[-1]['headers']['x-access-token'], 'tok-1')
        self.assertIn('/auth/tokens/check', self.fake.paths())

    def test_sync_saves_and_updates_one_portfolio(self):
        doc = run(webull.sync(self.ctx, {}))['portfolio']
        self.assertEqual(doc['mode'], 'shares')
        self.assertTrue(doc['name'].startswith('Webull'))
        stock = doc['holdings'][0]
        self.assertEqual((stock['symbol'], stock['shares'], stock['cost']), ('AAPL', 10.0, 1500.0))
        self.assertEqual(doc['holdings'][-1]['kind'], 'cash')
        self.fake.positions = [{'symbol': 'MSFT', 'quantity': '3', 'cost_price': '400', 'instrument_type': 'EQUITY'},
                               {'symbol': 'XYZ', 'quantity': '1', 'cost_price': '5'}]  # unknown type: left out
        again = run(webull.sync(self.ctx, {}))['portfolio']
        self.assertEqual(again['id'], doc['id'])
        self.assertEqual(len(store.list_docs('portfolios')), 1)
        self.assertEqual(again['holdings'][0]['symbol'], 'MSFT')
        self.assertNotIn('XYZ', [h['symbol'] for h in again['holdings']])


class Orders(Base):
    def test_preview_then_place_exactly_once(self):
        p = self.preview()
        self.assertEqual(p['env'], 'test')
        self.assertEqual(p['estimate']['value'], 390.0)
        self.assertEqual(p['summary'], 'Buy 2 AAPL at a limit of $195.00, day only')
        self.assertNotIn('/trading/orders/place', self.fake.paths())
        sent = next(c for c in self.fake.calls if c['path'] == '/trading/orders/preview')['body']['new_orders'][0]
        r = run(webull.place_order(self.ctx, {'id': 1, 'type': 'webull.place_order', 'token': p['token'], '_emit': print}))
        self.assertTrue(r['placed'])
        placed = [c for c in self.fake.calls if c['path'] == '/trading/orders/place']
        self.assertEqual(len(placed), 1)
        self.assertEqual(placed[0]['body']['new_orders'][0], sent)
        self.assertEqual((sent['symbol'], sent['side'], sent['quantity'], sent['order_type'], sent['limit_price'], sent['instrument_type']),
                         ('AAPL', 'BUY', '2', 'LIMIT', '195.0', 'EQUITY'))
        with self.assertRaises(core.EngineError):  # reused
            run(webull.place_order(self.ctx, {'token': p['token']}))
        self.assertEqual(len([c for c in self.fake.calls if c['path'] == '/trading/orders/place']), 1)
        results = [e['result'] for e in self.log()]
        self.assertEqual(results, ['attempt', 'placed', 'refused'])
        self.assertEqual(r['orderId'], sent['client_order_id'])
        self.assertNotIn(KEYS['webull_app_secret'], webull.ORDERS_LOG.read_text())
        self.assertNotIn(p['token'], webull.ORDERS_LOG.read_text())

    def test_place_refuses_without_valid_token(self):
        for msg in ({}, {'token': ''}, {'token': 'made-up'}, {'token': None}):
            with self.assertRaises(core.EngineError):
                run(webull.place_order(self.ctx, msg))
        self.assertNotIn('/trading/orders/place', self.fake.paths())

    def test_expired_token_refused(self):
        p = self.preview()
        webull._previews[p['token']]['expires'] -= 61
        with self.assertRaisesRegex(core.EngineError, 'expired'):
            run(webull.place_order(self.ctx, {'token': p['token']}))
        self.assertNotIn('/trading/orders/place', self.fake.paths())

    def test_edited_order_refused(self):
        p = self.preview()
        with self.assertRaisesRegex(core.EngineError, 'only the preview token'):
            run(webull.place_order(self.ctx, {'token': p['token'], 'qty': 200}))
        with self.assertRaises(core.EngineError):  # and the token is burnt
            run(webull.place_order(self.ctx, {'token': p['token']}))
        self.assertNotIn('/trading/orders/place', self.fake.paths())

    def test_settings_change_after_preview_refused(self):
        p = self.preview()
        settings._cache = {**KEYS, 'webull_app_key': 'otherkey999'}
        with self.assertRaisesRegex(core.EngineError, 'changed'):
            run(webull.place_order(self.ctx, {'token': p['token']}))

    def test_live_without_opt_in_refused(self):
        p = self.preview()
        settings._cache = {**KEYS, 'webull_env': 'live'}  # e.g. settings.json edited by hand: no typed LIVE
        with self.assertRaises(core.EngineError):
            run(webull.place_order(self.ctx, {'token': p['token']}))
        settings._cache = {**KEYS, 'webull_env': 'live'}
        p = self.preview()
        self.assertEqual(p['env'], 'live')
        with self.assertRaisesRegex(core.EngineError, 'Live trading is not switched on'):
            run(webull.place_order(self.ctx, {'token': p['token']}))
        self.assertNotIn('/trading/orders/place', self.fake.paths())

    def test_live_needs_typed_live_in_settings(self):
        with self.assertRaises(core.EngineError):
            run(settings.set_settings(mock.Mock(), {'webullEnv': 'live'}))
        with self.assertRaises(core.EngineError):
            run(settings.set_settings(mock.Mock(), {'webullEnv': 'live', 'webullLiveConfirm': 'live'}))
        self.assertEqual(webull.env(), 'test')
        out = run(settings.set_settings(mock.Mock(), {'webullEnv': 'live', 'webullLiveConfirm': 'LIVE'}))
        self.assertEqual(out['webullEnv'], 'live')
        self.assertTrue(webull.live_enabled())
        self.assertNotIn(KEYS['webull_app_secret'], json.dumps(out))
        self.assertNotIn(KEYS['webull_app_key'], json.dumps(out))
        run(settings.set_settings(mock.Mock(), {'webullAppKey': '', 'webullAppSecret': ''}))  # Remove -> back to Test
        self.assertEqual(webull.env(), 'test')
        self.assertFalse(webull.live_enabled())

    def test_limits(self):
        with self.assertRaisesRegex(core.EngineError, 'maximum order value'):
            self.preview(qty=6, limitPrice=199)  # about $1,194 > $1,000
        settings._cache = {**KEYS, 'webull_max_per_day': 1}
        p = self.preview()
        run(webull.place_order(self.ctx, {'token': p['token']}))
        with self.assertRaisesRegex(core.EngineError, 'daily maximum'):
            self.preview()

    def test_sell_more_than_held_refused(self):
        settings._cache = {**KEYS, 'webull_max_order': 5000}
        with self.assertRaisesRegex(core.EngineError, 'short sale'):
            self.preview(side='SELL', qty=11, limitPrice=200, orderType='LIMIT')
        self.assertTrue(self.preview(side='SELL', qty=4, limitPrice=200)['token'])
        self.fake.positions = []
        with self.assertRaisesRegex(core.EngineError, 'short sale'):
            self.preview(side='SELL', qty=1, limitPrice=200)

    def test_bad_orders_refused_before_webull(self):
        for changes in ({'symbol': 'AAPL240119C00150000'}, {'symbol': '/ES'}, {'qty': 1.5}, {'qty': 0}, {'qty': -3}, {'qty': True},
                        {'orderType': 'TRAILING'}, {'tif': 'IOC'}, {'orderType': 'MARKET', 'tif': 'GTC'}, {'limitPrice': None},
                        {'limitPrice': 260}, {'limitPrice': 1.234 + 194}, {'orderType': 'STOP', 'stopPrice': None}):
            with self.assertRaises(core.EngineError, msg=str(changes)):
                self.preview(**changes)
        self.assertNotIn('/trading/orders/preview', self.fake.paths())

    def test_no_price_no_order(self):
        webull.last_price.return_value = None
        with self.assertRaisesRegex(core.EngineError, 'current price'):
            self.preview()

    def test_two_windows_cannot_beat_the_daily_limit(self):
        settings._cache = {**KEYS, 'webull_max_per_day': 1}
        first, second = self.preview(), self.preview()
        self.fake.place_delay = 0.05

        async def both():
            return await asyncio.gather(webull.place_order(self.ctx, {'token': first['token']}),
                                        webull.place_order(self.ctx, {'token': second['token']}), return_exceptions=True)
        results = run(both())
        self.assertEqual(len(self.fake.placed_ids), 1)
        self.assertEqual(sum(isinstance(r, core.EngineError) for r in results), 1)
        self.assertIn('daily maximum', str(next(r for r in results if isinstance(r, Exception))))

    def test_timeout_is_unknown_never_not_placed(self):
        for failure in ('timeout', 502):
            with self.subTest(failure=failure):
                webull.ORDERS_LOG.unlink(missing_ok=True)
                self.fake.place_fails, self.fake.lookup_finds = failure, False
                p = self.preview()
                with self.assertRaises(core.EngineError) as caught:
                    run(webull.place_order(self.ctx, {'token': p['token']}))
                self.assertEqual(str(caught.exception), webull.UNCONFIRMED)
                lookups = [c for c in self.fake.calls if c['path'] == '/trading/orders/get']
                self.assertEqual(lookups[-1]['query']['client_order_id'], self.fake.placed_ids[-1])
                self.assertEqual([e['result'] for e in self.log()], ['attempt', 'unknown'])
                self.assertEqual(webull.placed_today(), 1)  # counted against the daily limit
                with self.assertRaises(core.EngineError):  # and the same preview can't be sent again
                    run(webull.place_order(self.ctx, {'token': p['token']}))

    def test_timeout_then_found_is_placed(self):
        self.fake.place_fails, self.fake.lookup_finds = 'timeout', True
        p = self.preview()
        r = run(webull.place_order(self.ctx, {'token': p['token']}))
        self.assertTrue(r['placed'])
        self.assertEqual([e['result'] for e in self.log()], ['attempt', 'unknown', 'placed'])

    def test_rejected_order_is_failed_not_unknown(self):
        p = self.preview()
        real = self.fake.request

        async def reject(method, url, headers=None, content=None):
            if urlparse(url).path == '/trading/orders/place':
                return Resp(400, {'message': 'insufficient buying power'})
            return await real(method, url, headers, content)
        self.fake.request = reject
        with self.assertRaisesRegex(core.EngineError, 'insufficient'):
            run(webull.place_order(self.ctx, {'token': p['token']}))
        self.assertEqual([e['result'] for e in self.log()], ['attempt', 'failed'])
        self.assertNotIn('/trading/orders/get', self.fake.paths())

    def test_unreadable_log_refuses(self):
        p = self.preview()
        webull.ORDERS_LOG.write_bytes(b'\xff\xfe not json\n')
        with self.assertRaisesRegex(core.EngineError, 'can.t be read'):
            run(webull.place_order(self.ctx, {'token': p['token']}))
        with self.assertRaisesRegex(core.EngineError, 'can.t be read'):
            self.preview()
        webull.ORDERS_LOG.unlink()
        webull.ORDERS_LOG.mkdir()  # exists but isn't a readable file
        with self.assertRaisesRegex(core.EngineError, 'can.t be read'):
            webull.placed_today()
        webull.ORDERS_LOG.rmdir()
        self.assertNotIn('/trading/orders/place', self.fake.paths())

    def test_options_position_does_not_back_a_stock_sell(self):
        self.fake.positions = [{'symbol': 'AAPL', 'quantity': '10', 'cost_price': '5', 'instrument_type': 'OPTION'}]
        with self.assertRaisesRegex(core.EngineError, 'short sale'):
            self.preview(side='SELL', qty=1, limitPrice=200)
        self.fake.positions = [{'symbol': 'AAPL', 'quantity': '10', 'cost_price': '150'}]  # type missing: fail closed
        with self.assertRaisesRegex(core.EngineError, 'short sale'):
            self.preview(side='SELL', qty=1, limitPrice=200)

    def test_open_sell_orders_reduce_what_can_be_sold(self):
        self.fake.open_orders = [{'client_order_id': 's1', 'symbol': 'AAPL', 'side': 'SELL', 'quantity': '8', 'filled_quantity': '2', 'status': 'PARTIAL_FILLED'}]
        with self.assertRaisesRegex(core.EngineError, 'at most 4 AAPL'):  # 10 held - (8 - 2) still to sell
            self.preview(side='SELL', qty=5, limitPrice=200)
        self.assertTrue(self.preview(side='SELL', qty=4, limitPrice=200)['token'])

    def test_missing_money_fields_fail_closed(self):
        cases = [('/trading/assets/positions/list', [{'symbol': 'AAPL', 'cost_price': '150', 'instrument_type': 'EQUITY'}], webull.positions_handler),
                 ('/trading/assets/balances/get', {'total_asset': '100'}, webull.account),
                 ('/trading/orders/open-orders/list', {'orders': [{'client_order_id': 'x', 'symbol': 'AAPL', 'side': 'SELL', 'status': 'SUBMITTED'}]}, webull.orders_handler),
                 ('/trading/assets/positions/list', {'unexpected': []}, webull.positions_handler)]
        real = self.fake.request
        for path, reply, fn in cases:
            async def fake(method, url, headers=None, content=None, path=path, reply=reply):
                if urlparse(url).path == path:
                    return Resp(200, reply)
                return await real(method, url, headers, content)
            self.fake.request = fake
            with self.subTest(path=path), self.assertRaises(core.EngineError):
                run(fn(self.ctx, {}))
        self.fake.request = real

    def test_cancel_logs(self):
        run(webull.cancel_order(self.ctx, {'orderId': 'o1'}))
        self.assertEqual(self.fake.calls[-1]['body'], {'account_id': 'ACC123456', 'client_order_id': 'o1'})
        self.assertEqual(self.log()[-1]['action'], 'cancel')
        with self.assertRaises(core.EngineError):
            run(webull.cancel_order(self.ctx, {'orderId': '../x'}))


class Isolation(unittest.TestCase):
    ENGINE = Path(__file__).resolve().parent.parent / 'engine'

    def test_ai_cannot_reach_webull(self):
        source = (self.ENGINE / 'ai.py').read_text(encoding='utf-8')
        for word in ('webull', 'place_order', 'preview_order', 'cancel_order', 'HANDLERS'):
            self.assertNotIn(word.lower(), source.lower(), f'ai.py must not reference {word}')

    def test_orders_only_in_webull_module(self):
        for path in [*self.ENGINE.glob('*.py'), *self.ENGINE.parent.glob('*.py')]:  # engine/ and helper/*.py (schwab_helper.py)
            if path.name == 'webull.py':
                continue
            text = path.read_text(encoding='utf-8')
            self.assertIsNone(re.search(r'orders/place|place_order|order/place', text), f'{path.name} must not place orders')


if __name__ == '__main__':
    unittest.main()
