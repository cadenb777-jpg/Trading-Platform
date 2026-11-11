"""The Trading Terminal desktop icon: the Windows shortcut script and the Mac app bundle."""
import os
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import shortcut  # noqa: E402


class Icon(unittest.TestCase):
    def test_logo_files_exist(self):
        for name in ('logo.svg', 'logo.png', 'logo.ico', 'logo.icns'):
            self.assertTrue((shortcut.ICONS / name).exists(), name)

    def test_windows_shortcut_points_at_the_start_file_with_the_logo(self):
        ps = shortcut.windows_script()
        self.assertIn("GetFolderPath('Desktop')", ps)
        self.assertIn("GetFolderPath('Programs')", ps)  # Start menu too
        env = shortcut.windows_env(Path("C:/Users/Caden’s $(evil) 'files'/Trading-Platform/desktop"))
        self.assertEqual(env['TP_LNK_NAME'], 'Trading Terminal.lnk')
        self.assertTrue(env['TP_LNK_TARGET'].endswith('start-desktop-windows.bat'))
        self.assertTrue(env['TP_LNK_ICON'].endswith('logo.ico,0'))
        # the folder names never appear in the script itself, so quotes or $ in them can't change the command
        for value in env.values():
            if value:  # (an empty value, like no arguments, is in every text)
                self.assertNotIn(value, ps)
        self.assertNotIn('Caden', ps)

    @unittest.skipIf(os.name == 'nt', 'Mac app bundles are made on a Mac (Windows writes these paths with backslashes)')
    def test_mac_app_bundle(self):
        with tempfile.TemporaryDirectory() as d:
            app = shortcut.mac_bundle(d, Path('/Users/me/Trading Platform/desktop'))
            odd = shortcut.mac_bundle(d + '/odd', Path('/Users/me/my "files" $(x)/desktop'))
            self.assertIn("open -a Terminal '/Users/me/my \"files\" $(x)/desktop/start-desktop-mac.command'", (odd / 'Contents' / 'MacOS' / 'start').read_text())
            info = plistlib.loads((app / 'Contents' / 'Info.plist').read_bytes())
            self.assertEqual((info['CFBundleName'], info['CFBundleIconFile'], info['CFBundleExecutable']), ('Trading Terminal', 'logo.icns', 'start'))
            start = app / 'Contents' / 'MacOS' / 'start'
            self.assertTrue(os.access(start, os.X_OK))
            self.assertIn("open -a Terminal '/Users/me/Trading Platform/desktop/start-desktop-mac.command'", start.read_text())
            self.assertTrue((app / 'Contents' / 'Resources' / 'logo.icns').exists())

    def test_made_once_unless_asked_again(self):
        with tempfile.TemporaryDirectory() as d:
            old = shortcut.MARKER
            shortcut.MARKER = Path(d) / 'desktop-shortcut.json'
            try:
                shortcut.MARKER.write_text('{}')
                self.assertEqual(shortcut.make(), 'already made')
            finally:
                shortcut.MARKER = old


if __name__ == '__main__':
    unittest.main()
