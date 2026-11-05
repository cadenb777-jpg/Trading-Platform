import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import desktop_update as du  # noqa: E402


def make_zip(version='1.2', extra=None, top='Trading-Platform-main'):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        files = {'launch.py': 'x', 'desktop_update.py': 'x', 'requirements.txt': 'x', 'tp_desktop/app.py': 'new app',
                 'tp_desktop/__init__.py': f"APP_VERSION = '{version}'\n"}
        files.update(extra or {})
        for rel, body in files.items():
            z.writestr(f'{top}/desktop/{rel}', body)
        z.writestr(f'{top}/helper/schwab_helper.py', 'helper')
        z.writestr(f'{top}/padding.bin', os.urandom(30_000))
    return buf.getvalue()


class Update(unittest.TestCase):
    def test_versions(self):
        self.assertEqual(du.parse_version("APP_VERSION = '1.10'  # bump on every change\n"), (1, 10))
        self.assertEqual(du.local_version(), du.parse_version("APP_VERSION = '" + __import__('tp_desktop').APP_VERSION + "'"))
        self.assertTrue(du.is_newer((1, 10), (1, 9)))
        self.assertFalse(du.is_newer(None, (1, 0)))

    def test_only_github(self):
        self.assertTrue(du.allowed_url(du.ZIP_URL))
        self.assertFalse(du.allowed_url('http://codeload.github.com/x'))
        self.assertFalse(du.allowed_url('https://evil.example/x'))

    def test_verify(self):
        zf, members = du.verify_zip(make_zip('1.2'), (1, 2), (1, 1))
        self.assertIn('tp_desktop/app.py', members)
        self.assertNotIn('../helper/schwab_helper.py', members)
        with self.assertRaises(du.UpdateError):
            du.verify_zip(make_zip('1.2'), (1, 3), (1, 1))  # not the version we were told
        with self.assertRaises(du.UpdateError):
            du.verify_zip(make_zip('1.0'), (1, 0), (1, 1))  # older
        with self.assertRaises(du.UpdateError):
            du.verify_zip(make_zip('1.2', {'../evil.py': 'x'}), (1, 2), (1, 1))
        with self.assertRaises(du.UpdateError):
            du.verify_zip(b'not a zip' * 5000, (1, 2), (1, 1))

    def test_install_and_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            here = Path(tmp) / 'desktop'
            (here / 'tp_desktop').mkdir(parents=True)
            (here / 'tp_desktop' / '__init__.py').write_text("APP_VERSION = '1.1'\n")
            (here / 'tp_desktop' / 'app.py').write_text('old app')
            (here / '.venv').mkdir()
            (here / '.venv' / 'keep').write_text('installed parts')
            backup = du.install(make_zip('1.2', {'.venv/evil': 'x'}), (1, 2), (1, 1), here)
            self.assertEqual((here / 'tp_desktop' / 'app.py').read_text(), 'new app')
            self.assertEqual((here / '.venv' / 'keep').read_text(), 'installed parts')  # never touched
            self.assertFalse((here / '.venv' / 'evil').exists())
            du.restore(backup, here)
            self.assertEqual((here / 'tp_desktop' / 'app.py').read_text(), 'old app')


if __name__ == '__main__':
    unittest.main()
