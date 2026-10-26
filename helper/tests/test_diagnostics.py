"""Diagnostics file: seeded fake secrets (keys, tokens, account ids, an email, home paths) must never appear in it,
while the useful parts (request types, errors, statuses, log lines) still do."""
import asyncio
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine import diagnostics, settings, webull  # noqa: E402

ANTHROPIC = 'sk-ant-api03-FAKEanthropicKEYvalue0123456789'
FRED = 'abcdef0123456789abcdef0123456789'
WEBULL_KEY = 'wbFakeAppKey7788'
WEBULL_SECRET = 'wbFakeAppSecret99ZZ'
TELEGRAM = '123456789:AAFakeTelegramBotTokenValue_abcdefghij'
NTFY = 'my-private-ntfy-topic-q7'
ALPACA_ID, ALPACA_SECRET = 'PKFAKEALPACAID01', 'alpacaFakeSecretValue/xyz'
EMAIL = 'ownerfake@example.org'
SCHWAB_KEY, SCHWAB_SECRET = 'SchwabFakeAppKey000111', 'SchwabFakeSecret222'
ACCESS, REFRESH = 'I0.FakeAccessToken.abc@', 'FakeRefreshToken-zz9'
ACCOUNT_ID, ACCOUNT_NUMBER = 'WB4XK29QZ7Q81', '5LT90417'
SCHWAB_ACCOUNT = '87654321'


class Redaction(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        (root / 'schwab_config.json').write_text(json.dumps({'app_key': SCHWAB_KEY, 'app_secret': SCHWAB_SECRET, 'callback_url': 'https://127.0.0.1:8182'}))
        (root / 'schwab_token.json').write_text(json.dumps({'creation_timestamp': 1, 'token': {'access_token': ACCESS, 'refresh_token': REFRESH, 'token_type': 'Bearer'}}))
        self.log = root / 'helper.log'
        home = str(Path.home())
        self.log.write_text('\n'.join([
            '2026-10-26 09:30:00 INFO Helper version 34 starting',
            f'2026-10-26 09:30:01 INFO Using Webull key {WEBULL_KEY} and secret {WEBULL_SECRET}',
            f'2026-10-26 09:30:02 WARNING GET https://api.example.com/v1/x?apikey={FRED}&q=1 failed',
            f'2026-10-26 09:30:03 INFO Authorization: Bearer {ACCESS}',
            f'2026-10-26 09:30:04 INFO refresh_token={REFRESH}',
            f'2026-10-26 09:30:05 INFO SEC contact {EMAIL}',
            f'2026-10-26 09:30:06 INFO Reading {home}/.trading-platform/platform.db and /Users/ownerfakename/Desktop/x.csv and C:\\Users\\OwnerFakeWin\\x.csv',
            f'2026-10-26 09:30:07 INFO account {ACCOUNT_ID} balance read; Schwab account number {SCHWAB_ACCOUNT}',
            f'2026-10-26 09:30:08 INFO token 0123456789abcdef0123456789abcdef01 and blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo5ODc2',
            f'2026-10-26 09:30:09 INFO telegram {TELEGRAM} ntfy {NTFY}',
            '2026-10-26 09:30:10 INFO Sent 120 1D bars for AAPL',
        ]))
        self.patches = [
            mock.patch.object(diagnostics, 'DATA_DIR', root),
            mock.patch.object(diagnostics, 'LOG_PATH', self.log),
            mock.patch.object(settings, 'SETTINGS_PATH', root / 'settings.json'),
            mock.patch.object(settings, '_cache', {
                'anthropic_key': ANTHROPIC, 'fred_key': FRED, 'webull_app_key': WEBULL_KEY, 'webull_app_secret': WEBULL_SECRET,
                'alpaca_key_id': ALPACA_ID, 'alpaca_secret': ALPACA_SECRET, 'telegram_token': TELEGRAM, 'telegram_chat': '99887766',
                'ntfy_topic': NTFY, 'sec_contact': EMAIL, 'webull_env': 'test'}),
            mock.patch.object(diagnostics, 'REQUESTS', diagnostics.REQUESTS.__class__(maxlen=300)),
            mock.patch.object(diagnostics, 'CALLS', diagnostics.CALLS.__class__(maxlen=300)),
            mock.patch.object(diagnostics, 'NOTES', {}),
            mock.patch.object(diagnostics, 'ACCOUNTS', set()),
            mock.patch.object(diagnostics, 'SECTIONS', {'helper': lambda: {'version': 34, 'status': 'live', 'message': f'logged in as {EMAIL}'}}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.dir.cleanup()

    def seed_activity(self):
        # Webull's account list teaches the diagnostics which ids to mask.
        webull.account_info({'account_id': ACCOUNT_ID, 'account_number': ACCOUNT_NUMBER, 'account_class': 'ROTH_IRA'})
        now = time.time()
        diagnostics.record_request('webull.snapshot', now - 1, False, f'Webull refused account {ACCOUNT_ID} ({ACCOUNT_NUMBER}) with key {WEBULL_KEY}')
        diagnostics.record_request('settings.set', now - 1, False, f'bad key {ANTHROPIC}')
        diagnostics.record_request('invest.board', now - 2, True, '', 5120)
        diagnostics.record_call('api.webull.com', f'/trading/assets/balances/{ACCOUNT_ID}', 200, 120)
        diagnostics.record_call('api.schwabapi.com', '/marketdata/v1/quotes', 401, 80)
        diagnostics.note('webull', endpoint='/trading/assets/positions/list', status=403, message=f'bad signature for {WEBULL_SECRET}')
        diagnostics.note('futures quotes', asked=3, matched=2, keysReturned=['/ESZ26', '/NQZ26'], unmatched=['/CL'])

    def collect(self):
        self.seed_activity()
        return diagnostics.collect()

    def test_no_seeded_secret_appears(self):
        text = json.dumps(self.collect(), ensure_ascii=False)
        for secret in (ANTHROPIC, FRED, WEBULL_KEY, WEBULL_SECRET, TELEGRAM, NTFY, ALPACA_ID, ALPACA_SECRET, EMAIL, SCHWAB_KEY,
                       SCHWAB_SECRET, ACCESS, REFRESH, ACCOUNT_ID, ACCOUNT_NUMBER, SCHWAB_ACCOUNT, '99887766',
                       'ownerfakename', 'OwnerFakeWin', '0123456789abcdef0123456789abcdef01', 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo5ODc2'):
            self.assertNotIn(secret, text)
        home = str(Path.home())
        if len(home) > 3:
            self.assertNotIn(home + '/', text)

    def test_useful_parts_stay(self):
        out = self.collect()
        self.assertEqual(out['helperVersion'], 34)
        types = [r['type'] for r in out['requests']]
        self.assertEqual(types, ['webull.snapshot', 'settings.set', 'invest.board'])
        self.assertEqual(out['requestSummary'], {'count': 3, 'failed': 2})
        self.assertIn('Webull refused account ••81', out['requests'][0]['error'])  # account ids keep their last 2
        self.assertEqual(out['requests'][2]['bytes'], 5120)
        self.assertEqual(out['feedHealth']['api.schwabapi.com']['failed'], 1)
        self.assertEqual(out['notes']['futures quotes'][0]['keysReturned'], ['/ESZ26', '/NQZ26'])
        self.assertEqual(out['notes']['webull'][0]['status'], 403)
        self.assertTrue(out['settings']['aiKeySet'])
        self.assertTrue(out['settings']['secContactSet'])
        self.assertNotIn('secContact', out['settings'])
        log = '\n'.join(out['logTail'])
        self.assertIn('Sent 120 1D bars for AAPL', log)
        self.assertIn('~/.trading-platform/platform.db', log)
        self.assertIn('?[query removed]', log)

    def test_handler_is_registered(self):
        from engine import HANDLERS
        self.assertIn('diagnostics.collect', HANDLERS)
        out = asyncio.run(HANDLERS['diagnostics.collect'](None, {}))
        self.assertIn('requests', out)

    def test_redact_masks_secret_named_fields_and_accounts(self):
        out = diagnostics.redact({'appKey': 'abc12345', 'accountId': 'ZZ1234', 'nested': [{'refresh_token': 'x' * 10}], 'aiKeySet': True, 'count': 3},
                                 secrets=[], accounts=set())
        self.assertEqual(out, {'appKey': '[redacted]', 'accountId': '••34', 'nested': [{'refresh_token': '[redacted]'}], 'aiKeySet': True, 'count': 3})


if __name__ == '__main__':
    unittest.main()
