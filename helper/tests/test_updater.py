"""Tests for the helper's self-update (updater.py): no network, everything in temporary folders.

Run from the repository root:  python -m unittest discover helper/tests
"""
import asyncio
import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import splash  # noqa: E402
import updater  # noqa: E402

PAD = b'#' * 30_000  # keeps test zips above the minimum size
_DATA = tempfile.TemporaryDirectory()
_PATCHES = [mock.patch.object(splash, 'DATA_DIR', Path(_DATA.name)),
            mock.patch.object(splash, 'PENDING', Path(_DATA.name) / 'update-pending.json')]


def setUpModule():
    for p in _PATCHES:  # the update note goes to a temporary folder, never the real ~/.trading-platform
        p.start()


def tearDownModule():
    for p in _PATCHES:
        p.stop()
    _DATA.cleanup()


def make_zip(version=30, top='Trading-Platform-main', extra=None, skip=()):
    files = {
        'helper/schwab_helper.py': f'"""Helper."""\nHELPER_VERSION = {version}\n'.encode() + PAD,
        'helper/splash.py': b'print("splash")\n',
        'helper/requirements.txt': b'httpx\n',
        'helper/start-mac.command': b'#!/bin/bash\n',
        'helper/engine/__init__.py': b'',
        'src/main.ts': b'console.log(1)\n',
        'README.md': b'readme\n',
    }
    files.update(extra or {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as zf:
        for name, data in files.items():
            if name not in skip:
                zf.writestr(f'{top}/{name}' if top else name, data)
    return buf.getvalue()


class Versions(unittest.TestCase):
    def test_parse_version(self):
        self.assertEqual(updater.parse_version('x = 1\nHELPER_VERSION = 29\n'), 29)
        self.assertEqual(updater.parse_version('HELPER_VERSION = 31  # bump me\n'), 31)
        self.assertIsNone(updater.parse_version('NOT_HELPER_VERSION = 3\n'))
        self.assertIsNone(updater.parse_version('nothing here'))

    def test_is_newer(self):
        self.assertTrue(updater.is_newer(30, 29))
        self.assertFalse(updater.is_newer(29, 29))
        self.assertFalse(updater.is_newer(28, 29))
        self.assertFalse(updater.is_newer(None, 29))
        self.assertFalse(updater.is_newer('30', 29))

    def test_restart_code_matches_launcher(self):
        self.assertEqual(updater.RESTART_CODE, splash.RESTART_CODE)


class HostAllowList(unittest.TestCase):
    def test_only_github_hosts_over_https(self):
        self.assertTrue(updater.allowed_url(updater.VERSION_URL))
        self.assertTrue(updater.allowed_url(updater.ZIP_URL))
        for bad in ('http://codeload.github.com/x', 'https://evil.com/x', 'https://codeload.github.com.evil.com/x',
                    'https://user@codeload.github.com/x', 'https://codeload.github.com:8443/x', 'ftp://raw.githubusercontent.com/x',
                    'https://github.com/x', 'not a url'):
            self.assertFalse(updater.allowed_url(bad), bad)

    def test_redirect_to_other_host_refused(self):
        class Resp:
            def __init__(self, status, location=''):
                self.status_code, self.headers = status, {'location': location}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def aiter_bytes(self):
                yield b'data'

        class Http:
            def __init__(self, replies):
                self.replies, self.urls = list(replies), []

            def stream(self, method, url, follow_redirects=True, timeout=None):
                assert follow_redirects is False
                self.urls.append(url)
                return self.replies.pop(0)

        http = Http([Resp(302, 'https://evil.example/zip')])
        with self.assertRaisesRegex(updater.UpdateError, 'Refused'):
            asyncio.run(updater.fetch(http, updater.ZIP_URL, 1000))
        self.assertEqual(http.urls, [updater.ZIP_URL])  # never contacted the other host
        http = Http([Resp(302, '/cadenb777-jpg/other'), Resp(200)])
        self.assertEqual(asyncio.run(updater.fetch(http, updater.ZIP_URL, 1000)), b'data')
        with self.assertRaisesRegex(updater.UpdateError, 'Refused'):
            asyncio.run(updater.fetch(Http([]), 'https://evil.example/', 1000))


class VerifyZip(unittest.TestCase):
    def test_good_zip(self):
        zf, members = updater.verify_zip(make_zip(30), 30, 29)
        self.assertIn('schwab_helper.py', members)
        self.assertIn('engine/__init__.py', members)
        self.assertNotIn('src/main.ts', members)

    def test_not_a_zip(self):
        with self.assertRaisesRegex(updater.UpdateError, 'valid ZIP'):
            updater.verify_zip(b'x' * 50_000, 30, 29)

    def test_size_sanity(self):
        with self.assertRaisesRegex(updater.UpdateError, 'size'):
            updater.verify_zip(b'PK', 30, 29)

    def test_missing_helper_file(self):
        with self.assertRaisesRegex(updater.UpdateError, 'missing schwab_helper.py'):
            updater.verify_zip(make_zip(skip=('helper/schwab_helper.py',), extra={'helper/pad.txt': PAD}), 30, 29)

    def test_older_or_unexpected_version(self):
        with self.assertRaisesRegex(updater.UpdateError, 'version 28'):
            updater.verify_zip(make_zip(28), 28, 29)
        with self.assertRaisesRegex(updater.UpdateError, 'version 29'):
            updater.verify_zip(make_zip(29), 29, 29)
        with self.assertRaisesRegex(updater.UpdateError, 'expected 31'):
            updater.verify_zip(make_zip(30), 31, 29)

    def test_unsafe_paths_refused(self):
        with self.assertRaisesRegex(updater.UpdateError, 'unsafe'):
            updater.verify_zip(make_zip(extra={'helper/../../evil.py': b'x'}), 30, 29)

    def test_more_than_one_top_folder_refused(self):
        data = make_zip(top='')
        with self.assertRaisesRegex(updater.UpdateError, "doesn't look like"):
            updater.verify_zip(data, 30, 29)


class Files(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.here = self.root / 'helper'
        (self.here / '.venv').mkdir(parents=True)
        (self.here / '.venv' / 'keep.txt').write_text('installed parts')
        (self.here / 'schwab_helper.py').write_text('HELPER_VERSION = 29\n')
        (self.here / 'splash.py').write_text('old splash\n')
        (self.here / 'requirements.txt').write_text('httpx\n')

    def tearDown(self):
        self.tmp.cleanup()

    def test_extracts_only_the_helper_folder(self):
        zf, members = updater.verify_zip(make_zip(30), 30, 29)
        dest = self.root / 'new'
        updater.extract_helper(zf, members, dest)
        files = sorted(str(p.relative_to(dest)).replace(os.sep, '/') for p in dest.rglob('*') if p.is_file())
        self.assertEqual(files, ['engine/__init__.py', 'requirements.txt', 'schwab_helper.py', 'splash.py', 'start-mac.command'])
        if os.name != 'nt':
            self.assertTrue(os.access(dest / 'start-mac.command', os.X_OK))

    def test_install_swaps_files_and_keeps_venv(self):
        saved = updater.install(make_zip(30), 30, 29, here=self.here)
        self.assertEqual(updater.parse_version((self.here / 'schwab_helper.py').read_text()), 30)
        self.assertEqual((self.here / '.venv' / 'keep.txt').read_text(), 'installed parts')
        self.assertEqual(saved, self.root / 'helper_backup_v29')
        self.assertEqual((saved / 'splash.py').read_text(), 'old splash\n')
        self.assertFalse((saved / '.venv').exists())  # the backup leaves the big .venv folder out

    def test_bad_download_changes_nothing(self):
        with self.assertRaises(updater.UpdateError):
            updater.install(make_zip(28), 28, 29, here=self.here)
        self.assertEqual((self.here / 'splash.py').read_text(), 'old splash\n')
        self.assertFalse((self.root / 'helper_backup_v29').exists())

    def test_failed_copy_restores_backup(self):
        real_copy = updater.copy_files
        calls = []

        def flaky(src, dst):
            calls.append(src)
            if len(calls) == 2:  # 1 = making the backup, 2 = copying the new files in
                (Path(dst) / 'splash.py').write_text('half-written\n')
                raise OSError('disk full')
            return real_copy(src, dst)

        with mock.patch.object(updater, 'copy_files', flaky), self.assertLogs('helper.update', 'ERROR'):
            with self.assertRaisesRegex(updater.UpdateError, 'previous version was put back'):
                updater.install(make_zip(30), 30, 29, here=self.here)
        self.assertEqual((self.here / 'splash.py').read_text(), 'old splash\n')
        self.assertEqual(updater.parse_version((self.here / 'schwab_helper.py').read_text()), 29)

    def test_keeps_only_the_newest_backup(self):
        for version in (26, 27):
            (self.root / f'helper_backup_v{version}').mkdir()
        (self.root / 'helper_backup_notes').mkdir()  # not a backup: left alone
        updater.backup(self.here, 29)
        left = sorted(p.name for p in self.root.iterdir() if p.name.startswith('helper_backup'))
        self.assertEqual(left, ['helper_backup_notes', 'helper_backup_v29'])

    def test_copy_skips_unchanged_files_and_swaps_changed_ones(self):
        new = self.root / 'new'
        new.mkdir()
        (new / 'splash.py').write_text('old splash\n')  # same bytes
        (new / 'requirements.txt').write_text('httpx\nnumpy\n')
        (new / '.venv').mkdir()
        (new / '.venv' / 'keep.txt').write_text('from the download')
        before = (self.here / 'splash.py').stat().st_mtime_ns
        os.utime(self.here / 'splash.py', ns=(before - 10**9, before - 10**9))
        with mock.patch.object(splash.os, 'replace', wraps=os.replace) as replace:
            splash.copy_files(new, self.here)
        self.assertEqual(replace.call_count, 1)  # only the changed file, written beside it then swapped in
        self.assertEqual((self.here / 'splash.py').stat().st_mtime_ns, before - 10**9)  # untouched
        self.assertEqual((self.here / 'requirements.txt').read_text(), 'httpx\nnumpy\n')
        self.assertEqual((self.here / '.venv' / 'keep.txt').read_text(), 'installed parts')
        self.assertEqual(list(self.here.rglob('*.tp-new')), [])


class RollBack(unittest.TestCase):
    """splash.py puts the backup back when the new version can't install its parts or stops in its first minute."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.here = self.root / 'helper'
        self.here.mkdir()
        (self.here / 'schwab_helper.py').write_text('HELPER_VERSION = 29\n')
        (self.here / 'splash.py').write_text('old splash\n')
        (self.here / 'requirements.txt').write_text('httpx\n')
        self.patch = mock.patch.object(splash, 'HERE', self.here)
        self.patch.start()
        splash.clear_pending()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_install_notes_the_update_and_roll_back_restores_it(self):
        saved = updater.install(make_zip(30), 30, 29, here=self.here)
        self.assertEqual(splash.pending_update(), {'backup': str(saved), 'old': 29, 'new': 30})
        note = splash.roll_back('stopped with an error when it started')
        self.assertIn('previous version (29) was put back', note)
        self.assertIn(str(saved), note)
        self.assertEqual(updater.parse_version((self.here / 'schwab_helper.py').read_text()), 29)
        self.assertIsNone(splash.pending_update())
        self.assertEqual(splash.roll_back('again'), '')  # nothing left to roll back

    def test_running_a_minute_confirms_the_update(self):
        updater.install(make_zip(30), 30, 29, here=self.here)
        asyncio.run(updater.confirm_started(0))
        self.assertIsNone(splash.pending_update())
        self.assertEqual(splash.roll_back('x'), '')
        self.assertEqual(updater.parse_version((self.here / 'schwab_helper.py').read_text()), 30)

    def test_failed_install_leaves_nothing_to_roll_back(self):
        with self.assertRaises(updater.UpdateError):
            updater.install(make_zip(28), 28, 29, here=self.here)
        self.assertIsNone(splash.pending_update())


class UpdaterFlow(unittest.TestCase):
    def run_update(self, latest, install_error=None):
        seen = []
        up = updater.Updater(29, on_change=lambda: seen.append(up.state))

        async def version(http):
            return latest

        async def fetch(http, url, max_bytes, hops=3):
            return b'zip'

        def install(data, expected, current, here):
            if install_error:
                raise install_error
            return Path('backup')

        with mock.patch.object(updater, 'latest_version', version), mock.patch.object(updater, 'fetch', fetch), \
                mock.patch.object(updater, 'install', install):
            try:
                result = asyncio.run(up.update(None))
            except updater.UpdateError as err:
                result = err
        return up, seen, result

    def test_success_ends_restarting(self):
        up, seen, result = self.run_update(30)
        self.assertIs(result, True)
        self.assertEqual(up.state, 'restarting')
        self.assertIn('updating', seen)

    def test_already_newest(self):
        up, _, result = self.run_update(29)
        self.assertIsInstance(result, updater.UpdateError)
        self.assertEqual(up.state, 'idle')

    def test_next_check_clears_a_failure(self):
        up = updater.Updater(29)
        up.state, up.message = 'failed', 'GitHub answered 503.'

        async def version(http):
            return 30

        with mock.patch.object(updater, 'latest_version', version):
            asyncio.run(up.check(None))
        self.assertEqual((up.state, up.message, up.available), ('idle', '', True))

    def test_failure_is_shown(self):
        up, _, result = self.run_update(30, updater.UpdateError('The download is damaged.'))
        self.assertIsInstance(result, updater.UpdateError)
        self.assertEqual((up.state, up.message), ('failed', 'The download is damaged.'))


if __name__ == '__main__':
    unittest.main()
