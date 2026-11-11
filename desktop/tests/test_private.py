"""Private mode: the platform from a copy of the code (serving the build, skipping rebuilds, the start flags)."""
import os
import socket
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import private  # noqa: E402
import launch  # noqa: E402


class Serve(unittest.TestCase):
    def test_serves_the_build_on_this_computer_only(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'index.html').write_text('<title>ok</title>')
            with socket.socket() as s:
                s.bind(('127.0.0.1', 0))
                port = s.getsockname()[1]
            server = private.serve(Path(d), port=port)
            try:
                self.assertEqual(server.server_address[0], '127.0.0.1')
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/') as r:
                    self.assertIn(b'ok', r.read())
                    self.assertEqual(r.headers['Cache-Control'], 'no-cache')
                self.assertIsNone(private.serve(Path(d), port=port))  # taken: the running one is used
            finally:
                server.shutdown()
                server.server_close()

    def test_the_helper_accepts_the_private_address(self):
        text = (private.ROOT / 'helper' / 'schwab_helper.py').read_text(encoding='utf-8')
        self.assertIn(f"'http://127.0.0.1:{private.PORT}'", text)


class Build(unittest.TestCase):
    def test_no_node_says_how_to_get_it(self):
        with mock.patch.object(private, 'tool', return_value=None):
            with self.assertRaises(private.StepError) as cm:
                private.build(open(os.devnull, 'w'))
        self.assertIn('nodejs.org', ' '.join(cm.exception.hints))

    def test_no_git_says_how_to_get_it(self):
        with mock.patch.object(private, 'tool', return_value=None):
            with self.assertRaises(private.StepError):
                private.pull(open(os.devnull, 'w'))


class Launch(unittest.TestCase):
    def test_private_start_opens_the_app_on_the_local_build_with_updates_off(self):
        class Proc:
            def wait(self):
                return 0

            def poll(self):
                return 0
        calls = []
        with mock.patch.object(launch.subprocess, 'Popen', side_effect=lambda *a, **k: calls.append((a, k)) or Proc()), \
                mock.patch.object(launch, 'helper_running', return_value=False), \
                mock.patch.object(launch.sys, 'platform', 'linux'), \
                mock.patch.object(launch.splash, 'ok'), mock.patch.object(launch.splash, 'wait_for_enter'):
            launch.run_app(None, url=private.URL)
        app_cmd, app_env = calls[0][0][0], calls[0][1]['env']
        self.assertEqual(app_cmd[-2:], ['--url', private.URL])
        self.assertEqual(app_env.get(private.FLAG), '1')
        self.assertEqual(calls[1][1]['env'].get(private.FLAG), '1')  # the helper too: no online updates
        self.assertEqual(calls[1][1]['env'].get('TP_PLATFORM_URL'), private.URL)  # its screen shows the local address


if __name__ == '__main__':
    unittest.main()
