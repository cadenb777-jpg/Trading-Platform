"""Helper alerts: crossing, fire once, cool-down, repeat, setup entry zones (matching src/home/entryZone.test.ts),
delivery by ntfy/Telegram with fake HTTP (no network), settings secrecy, and that alerts can't touch orders."""
import asyncio
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import alerts, core, settings, store  # noqa: E402

SECRETS = {'ntfy_topic': 'my-long-random-topic-8f3k2', 'telegram_token': '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ', 'telegram_chat': '987654321'}
NOW = 1_800_000_000.0


class Resp:
    def __init__(self, status=200, data=None):
        self.status_code, self._data = status, data or {}

    def json(self):
        return self._data


class FakeHttp:
    """Records every request; answers with `status` (or raises `error`)."""

    def __init__(self, status=200, error=None, data=None):
        self.calls, self.status, self.error, self.data = [], status, error, data

    async def post(self, url, content=None, json=None, headers=None):
        self.calls.append({'url': url, 'content': content, 'json': json, 'headers': headers or {}})
        if self.error:
            raise self.error
        return Resp(self.status, {'description': 'Bad Request: chat not found'} if self.status >= 300 else {})

    async def get(self, url):
        self.calls.append({'url': url})
        return Resp(self.status, self.data)


def price(symbol='AAPL', condition='above', level=100, repeat=False):
    return alerts.clean_alert({'kind': 'price', 'symbol': symbol, 'condition': condition, 'price': level, 'repeat': repeat})


def q(last, prev=None):
    return {'AAPL': {'last': last, 'prevClose': prev}}


def setup(direction=1, status='ready', tier='B', **plan):
    p = {'entryType': 'stop', 'trigger': 100, 'validUntil': '2026-10-26', 'stop': 96, 'target': 110, 'atr': 2, **plan}
    return {'symbol': 'TEST', 'strategy': 'weekly_swing', 'horizon': 'swing', 'signalDate': '2026-10-22', 'direction': direction, 'status': status, 'tier': tier, 'plan': p}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for target, attr, value in ((settings, 'SETTINGS_PATH', Path(self.tmp.name) / 'settings.json'), (store, 'DB_PATH', Path(self.tmp.name) / 'platform.db')):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        settings._cache = {}
        store._db = None
        alerts.MONITOR.alerts = None
        self.addCleanup(setattr, settings, '_cache', None)
        self.addCleanup(setattr, store, '_db', None)


class Evaluation(unittest.TestCase):
    def test_fires_on_crossing_once(self):
        a = price()
        self.assertEqual(alerts.evaluate(a, q(99), NOW), ([], False))
        events, changed = alerts.evaluate(a, q(100.5), NOW + 1)
        self.assertEqual(len(events), 1)
        self.assertIn('AAPL above $100.00', events[0]['message'])
        self.assertTrue(changed)
        self.assertFalse(a['active'])
        # Fire once: never again, even after going back and crossing again much later.
        for t, p in ((2, 98), (99999, 102)):
            self.assertEqual(alerts.evaluate(a, q(p), NOW + t)[0], [])

    def test_below_and_missing_prices(self):
        a = price(condition='below', level=50)
        self.assertEqual(alerts.evaluate(a, {}, NOW)[0], [])
        self.assertEqual(alerts.evaluate(a, q(None), NOW)[0], [])
        self.assertEqual(len(alerts.evaluate(a, q(49.9), NOW)[0]), 1)

    def test_repeat_rearms_after_moving_back_and_respects_cooldown(self):
        a = price(repeat=True)
        self.assertEqual(len(alerts.evaluate(a, q(101), NOW)[0]), 1)
        self.assertTrue(a['active'])
        self.assertEqual(alerts.evaluate(a, q(102), NOW + 10)[0], [])  # still above: not armed
        self.assertEqual(alerts.evaluate(a, q(99), NOW + 20), ([], True))  # back below: re-armed
        self.assertEqual(alerts.evaluate(a, q(101), NOW + 30)[0], [])  # crossed again, but cooling down
        later = NOW + alerts.COOLDOWN_SECONDS + 1
        self.assertEqual(len(alerts.evaluate(a, q(101), later)[0]), 1)

    def test_day_move(self):
        a = alerts.clean_alert({'kind': 'move', 'symbol': 'aapl', 'condition': 'down', 'pct': 3})
        self.assertEqual(alerts.evaluate(a, q(98, None), NOW)[0], [])  # no previous close yet
        self.assertEqual(alerts.evaluate(a, q(98, 100), NOW)[0], [])
        self.assertEqual(len(alerts.evaluate(a, q(96.9, 100), NOW)[0]), 1)
        either = alerts.clean_alert({'kind': 'move', 'symbol': 'AAPL', 'condition': 'either', 'pct': 2})
        self.assertEqual(len(alerts.evaluate(either, q(102.5, 100), NOW)[0]), 1)

    def test_bad_alerts_are_refused(self):
        for doc in ({'kind': 'price', 'symbol': 'AAPL', 'condition': 'above', 'price': -1}, {'kind': 'price', 'symbol': 'bad symbol!', 'condition': 'above', 'price': 1},
                    {'kind': 'move', 'symbol': 'AAPL', 'condition': 'sideways', 'pct': 2}, {'kind': 'nope'}, {'kind': 'setup', 'setup': {'plan': {}}}):
            with self.assertRaises(core.EngineError):
                alerts.clean_alert(doc)

    def test_editing_the_level_rearms(self):
        a = price()
        alerts.evaluate(a, q(101), NOW)
        edited = alerts.clean_alert({**a, 'price': 120, 'active': True}, a)
        self.assertTrue(edited['armed'])
        self.assertNotIn('ended', edited)


class EntryZone(unittest.TestCase):
    """The same cases as src/home/entryZone.test.ts."""
    today = '2026-10-23'

    def z(self, s, p):
        return alerts.entry_zone(s, p, self.today)

    def test_long(self):
        s = setup()
        self.assertEqual([self.z(s, p) for p in (97, 99.5, 100.5, 101.5, 110, 95)], ['waiting', 'approaching', 'entry', 'extended', 'target', 'invalid'])

    def test_short_window_and_forming(self):
        short = setup(direction=-1, trigger=100, stop=104, target=90)
        self.assertEqual([self.z(short, p) for p in (99.5, 100.4, 105)], ['entry', 'approaching', 'invalid'])
        self.assertEqual(self.z(setup(validUntil='2026-10-22'), 100.2), 'expired')
        self.assertEqual(self.z(setup(status='forming'), 100.2), 'forming')

    def test_open_trade_uses_its_fill(self):
        s = {**setup(status='in trade'), 'trade': {'entry': 100.3}}
        self.assertEqual(self.z(s, 100.8), 'entry')
        self.assertEqual(self.z(s, 103), 'extended')

    def test_setup_alert_fires_in_entry_zone_and_ends_when_it_fails(self):
        a = alerts.clean_alert({'kind': 'setup', 'setup': setup()})
        self.assertEqual(a['setupId'], 'swing:weekly_swing:TEST:2026-10-22')
        quotes = lambda p: {'TEST': {'last': p, 'prevClose': p}}  # noqa: E731
        self.assertEqual(alerts.evaluate(a, quotes(99), NOW, today=self.today)[0], [])
        events = alerts.evaluate(a, quotes(100.5), NOW, today=self.today)[0]
        self.assertEqual(len(events), 1)
        self.assertIn('stop $96.00', events[0]['message'])
        b = alerts.clean_alert({'kind': 'setup', 'setup': setup()})
        self.assertEqual(alerts.evaluate(b, quotes(95), NOW, today=self.today), ([], True))
        self.assertFalse(b['active'])
        self.assertIn('Stop', b['ended'])

    def test_setup_alert_follows_the_newest_scan(self):
        a = alerts.clean_alert({'kind': 'setup', 'setup': setup()})
        newer = {**setup(), 'status': 'in trade', 'trade': {'entry': 101}}
        events = alerts.evaluate(a, {'TEST': {'last': 101.5}}, NOW, setups=[newer], today=self.today)[0]
        self.assertEqual(len(events), 1)  # 101.5 is extended for the old trigger, inside the chase limit of the real fill
        self.assertEqual(a['setup']['trade']['entry'], 101)

    def test_every_a_and_b_setup_once_each(self):
        a = alerts.clean_alert({'kind': 'setups_ab'})
        scan = [setup(), {**setup(tier='C'), 'symbol': 'CCC'}, {**setup(), 'symbol': 'OTHER'}]
        quotes = {'TEST': {'last': 100.5}, 'CCC': {'last': 100.5}, 'OTHER': {'last': 97}}
        self.assertEqual(alerts.symbols_for([a], scan), {'TEST', 'OTHER'})
        events = alerts.evaluate(a, quotes, NOW, setups=scan, today=self.today)[0]
        self.assertEqual([e['title'] for e in events], ['TEST: entry zone now'])
        self.assertEqual(alerts.evaluate(a, quotes, NOW + 99999, setups=scan, today=self.today)[0], [])


class Delivery(Base):
    def test_ntfy_and_telegram_messages(self):
        settings._cache = dict(SECRETS)
        http = FakeHttp()
        tabs = []
        results = asyncio.run(alerts.deliver(http, 'AAPL alert — now', 'AAPL above $100.00 (now $100.50)', push=lambda e: tabs.append(e) or 2))
        self.assertEqual(results, {'ntfy': 'ok', 'telegram': 'ok', 'browser': '2 tabs'})
        ntfy, tg = http.calls
        self.assertEqual(ntfy['url'], f"https://ntfy.sh/{SECRETS['ntfy_topic']}")
        self.assertEqual(ntfy['content'].decode(), 'AAPL above $100.00 (now $100.50)')
        self.assertEqual(ntfy['headers']['Title'], 'AAPL alert  now')  # header kept to plain ASCII
        self.assertEqual(tg['url'], f"https://api.telegram.org/bot{SECRETS['telegram_token']}/sendMessage")
        self.assertEqual(tg['json'], {'chat_id': SECRETS['telegram_chat'], 'text': 'AAPL alert — now\nAAPL above $100.00 (now $100.50)'})
        self.assertEqual(tabs[0]['title'], 'AAPL alert — now')

    def test_self_hosted_ntfy_and_no_channels(self):
        settings._cache = {'ntfy_topic': SECRETS['ntfy_topic'], 'ntfy_server': 'https://ntfy.example.com'}
        http = FakeHttp()
        asyncio.run(alerts.deliver(http, 't', 'm'))
        self.assertEqual(http.calls[0]['url'], f"https://ntfy.example.com/{SECRETS['ntfy_topic']}")
        settings._cache = {}
        http = FakeHttp()
        self.assertEqual(asyncio.run(alerts.deliver(http, 't', 'm', push=lambda e: 0)), {'browser': 'no tab open'})
        self.assertEqual(http.calls, [])

    def test_failures_are_reported_without_secrets_and_never_raise(self):
        settings._cache = dict(SECRETS)
        boom = RuntimeError(f"connect failed for https://api.telegram.org/bot{SECRETS['telegram_token']}/sendMessage topic {SECRETS['ntfy_topic']}")
        with self.assertLogs('engine.alerts', 'WARNING'):
            results = asyncio.run(alerts.deliver(FakeHttp(error=boom), 't', 'm'))
        for v in results.values():
            for secret in SECRETS.values():
                self.assertNotIn(secret, v)
        with self.assertLogs('engine.alerts', 'WARNING'):
            results = asyncio.run(alerts.deliver(FakeHttp(status=400), 't', 'm'))
        self.assertIn('chat not found', results['telegram'])
        self.assertEqual(results['ntfy'], 'answered 400')

    def test_monitor_fires_saves_and_records_delivery(self):
        settings._cache = dict(SECRETS)
        http = FakeHttp(status=500)

        async def go():
            await alerts.save_alert(None, {'alert': {'kind': 'price', 'symbol': 'AAPL', 'condition': 'above', 'price': 100}})
            alerts.MONITOR.http, alerts.MONITOR.push = http, (lambda e: 1)
            self.assertEqual(alerts.MONITOR.symbols(), {'AAPL'})
            with self.assertLogs('engine.alerts', 'WARNING'):
                self.assertEqual(len(alerts.MONITOR.check(q(101), NOW)), 1)
                await asyncio.sleep(0.05)
            self.assertEqual(alerts.MONITOR.check(q(102), NOW + 1), [])
            return await alerts.list_alerts(None, {})

        reply = asyncio.run(go())
        saved = reply['alerts'][0]
        self.assertFalse(saved['active'])
        self.assertEqual(saved['lastDelivery']['results']['browser'], '1 tab')
        self.assertEqual(saved['lastDelivery']['results']['ntfy'], 'answered 500')
        self.assertEqual(reply['channels'], {'ntfy': True, 'telegram': True})
        self.assertEqual(alerts.MONITOR.symbols(), set())  # done: no longer watched
        text = json.dumps(reply)
        for secret in SECRETS.values():
            self.assertNotIn(secret, text)

    def test_only_one_all_setups_alert_and_store_refuses_direct_saves(self):
        async def go():
            await alerts.save_alert(None, {'alert': {'kind': 'setups_ab'}})
            await alerts.save_alert(None, {'alert': {'kind': 'setups_ab'}})
            self.assertEqual(len(alerts.MONITOR.load()), 1)
            await alerts.delete_alert(None, {'kind': 'setups_ab'})
            self.assertEqual(alerts.MONITOR.load(), [])
            with self.assertRaises(core.EngineError):
                await store._save(None, {'collection': 'alerts', 'doc': {'kind': 'price'}})
        asyncio.run(go())


class SettingsSecrecy(Base):
    class Ctx:
        http = None

        def apply_settings(self):
            pass

    def test_channel_keys_saved_but_never_sent_back(self):
        changes = {'ntfyTopic': SECRETS['ntfy_topic'], 'ntfyServer': 'https://ntfy.example.com/', 'telegramToken': SECRETS['telegram_token'], 'telegramChat': SECRETS['telegram_chat']}
        reply = asyncio.run(settings.set_settings(self.Ctx(), changes))
        self.assertTrue(reply['ntfySet'] and reply['telegramSet'] and reply['ntfyCustomServer'])
        self.assertEqual(settings.get('ntfy_server'), 'https://ntfy.example.com')
        settings.save({'ntfy_server': ''})
        for out in (reply, asyncio.run(settings.get_settings(self.Ctx(), {})), asyncio.run(alerts.list_alerts(None, {}))):
            text = json.dumps(out)
            for secret in SECRETS.values():
                self.assertNotIn(secret, text)
        saved = json.loads((Path(self.tmp.name) / 'settings.json').read_text())
        self.assertEqual(saved['telegram_token'], SECRETS['telegram_token'])
        for key in SECRETS:
            self.assertIn(key, settings.SECRET_KEYS)

    def test_bad_values_and_test_send(self):
        for bad in ({'ntfyTopic': 'short'}, {'ntfyTopic': 'has spaces in the topic'}, {'telegramToken': 'nope'}, {'telegramChat': 'abc'}, {'ntfyServer': 'ftp://x'}):
            with self.assertRaises(core.EngineError):
                asyncio.run(settings.set_settings(self.Ctx(), bad))
        settings._cache = dict(SECRETS)
        ctx = self.Ctx()
        ctx.http = FakeHttp()
        reply = asyncio.run(alerts.test_alert(ctx, {}))
        self.assertEqual(reply['results']['ntfy'], 'ok')
        self.assertNotIn(SECRETS['telegram_token'], json.dumps(reply))

    def test_telegram_link_finds_the_chat(self):
        settings._cache = {'telegram_token': SECRETS['telegram_token']}
        ctx = self.Ctx()
        ctx.http = FakeHttp(data={'ok': True, 'result': [{'message': {'chat': {'id': 555123, 'first_name': 'Caden'}}}]})
        reply = asyncio.run(alerts.telegram_link(ctx, {}))
        self.assertEqual(settings.get('telegram_chat'), '555123')
        self.assertTrue(reply['telegramSet'])
        self.assertNotIn(SECRETS['telegram_token'], json.dumps(reply))
        ctx.http = FakeHttp(data={'ok': True, 'result': []})
        with self.assertRaises(core.EngineError):
            asyncio.run(alerts.telegram_link(ctx, {}))


class NeverTrades(unittest.TestCase):
    def test_alerts_never_reference_orders(self):
        source = (Path(alerts.__file__)).read_text()
        code = '\n'.join(line for line in source.splitlines() if not line.strip().startswith('#'))
        code = re.sub(r'"""[\s\S]*?"""', '', code)  # docstrings may say what it never does
        for word in ('webull', 'place_order', 'preview_order', 'cancel_order', 'orders/place', 'orders/', 'order'):
            self.assertNotIn(word, code.lower(), word)


if __name__ == '__main__':
    unittest.main()
