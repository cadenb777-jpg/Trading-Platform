"""
"Trading Terminal" on your desktop: an icon with the app's logo that you double-click like any program.

Windows: a shortcut on the desktop and in the Start menu, pointing at start-desktop-windows.bat with the logo (made on
this computer, so Windows doesn't show the "unknown program" warning a downloaded .exe gets). Mac: a small
"Trading Terminal.app" on the desktop that opens start-desktop-mac.command in Terminal, with the logo.

Made once (remembered in ~/.trading-platform/desktop-shortcut.json), so if you delete the icon it stays deleted;
`python launch.py --shortcut` makes it again. Standard library only (it runs before anything is installed).
"""
import json
import os
import plistlib
import shlex
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAME = 'Trading Terminal'
ICONS = HERE / 'tp_desktop' / 'assets'
MARKER = Path.home() / '.trading-platform' / 'desktop-shortcut.json'


def windows_env(here=HERE):
    """The folder names PowerShell needs, passed as environment values (never written into the script), so no folder
    name (quotes, curly apostrophes, $ signs) can break or change the command."""
    return {'TP_LNK_NAME': NAME + '.lnk', 'TP_LNK_TARGET': str(here / 'start-desktop-windows.bat'), 'TP_LNK_DIR': str(here),
            'TP_LNK_ICON': str(ICONS / 'logo.ico') + ',0', 'TP_LNK_NOTE': 'Trading Terminal: markets, research and trading'}


def windows_script():
    """PowerShell that makes the desktop and Start-menu shortcuts (the desktop folder may be in OneDrive); every name
    comes from windows_env() through $env:."""
    lines = ["$sh = New-Object -ComObject WScript.Shell"]
    for folder in ("[Environment]::GetFolderPath('Desktop')", "[Environment]::GetFolderPath('Programs')"):
        lines += [
            f"$dir = {folder}",
            "if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }",
            "$lnk = $sh.CreateShortcut((Join-Path $dir $env:TP_LNK_NAME))",
            "$lnk.TargetPath = $env:TP_LNK_TARGET",
            "$lnk.WorkingDirectory = $env:TP_LNK_DIR",
            "$lnk.IconLocation = $env:TP_LNK_ICON",
            "$lnk.Description = $env:TP_LNK_NOTE",
            "$lnk.WindowStyle = 1",
            "$lnk.Save()",
        ]
    return '; '.join(lines)


def mac_bundle(desktop, here=HERE):
    """Writes Trading Terminal.app (Info.plist, a tiny start script, the logo) into `desktop`; returns its path."""
    app = Path(desktop) / f'{NAME}.app'
    (app / 'Contents' / 'MacOS').mkdir(parents=True, exist_ok=True)
    (app / 'Contents' / 'Resources').mkdir(parents=True, exist_ok=True)
    with open(app / 'Contents' / 'Info.plist', 'wb') as f:
        plistlib.dump({'CFBundleName': NAME, 'CFBundleDisplayName': NAME, 'CFBundleIdentifier': 'com.tradingplatform.terminal',
                       'CFBundleExecutable': 'start', 'CFBundleIconFile': 'logo.icns', 'CFBundlePackageType': 'APPL',
                       'CFBundleShortVersionString': '2.1', 'LSMinimumSystemVersion': '14.0'}, f)
    start = app / 'Contents' / 'MacOS' / 'start'
    command = here / 'start-desktop-mac.command'
    start.write_text('#!/bin/bash\n# Opens the Trading Terminal start window (its loading bar, then the app).\n'
                     f'open -a Terminal {shlex.quote(str(command))}\n')
    start.chmod(0o755)
    icns = ICONS / 'logo.icns'
    if icns.exists():
        (app / 'Contents' / 'Resources' / 'logo.icns').write_bytes(icns.read_bytes())
    return app


def make(force=False, log=lambda s: None):
    """Makes the desktop icon once (or again with force). Returns a short note of what happened."""
    if MARKER.exists() and not force:
        return 'already made'
    try:
        if sys.platform == 'win32':
            subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windows_script()],
                           check=True, capture_output=True, timeout=30, env={**os.environ, **windows_env()})
            where = 'desktop and Start menu'
        elif sys.platform == 'darwin':
            mac_bundle(Path.home() / 'Desktop')
            where = 'desktop'
        else:
            return 'not made (Windows and Mac only)'
    except Exception as err:  # an icon is a nicety: never stop the app starting over it
        detail = (getattr(err, 'stderr', b'') or b'').decode('utf-8', 'replace').strip()[-400:]
        log(f'Desktop icon not made: {err}' + (f' | {detail}' if detail else ''))
        return 'not made'
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps({'made': True, 'where': where, 'app': str(HERE)}))
    return f'made on your {where}'


if __name__ == '__main__':
    print(make(force=True, log=print))
