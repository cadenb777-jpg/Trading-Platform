"""
Updates the desktop app from the public GitHub repository, at each start (launch.py) or from Help > Check for updates.

Steps: read the newest APP_VERSION (desktop/tp_desktop/__init__.py on main), download the main-branch ZIP, check it
(a real zip of one top folder, a sane size, no odd paths or links, desktop/tp_desktop/__init__.py with exactly that
newer version), back the desktop folder up to desktop_backup (next to it; only the newest is kept), copy the changed
files in (the backup is put back if that fails). The installed Python parts (.venv) and your settings
(~/.trading-platform) are never touched. Only the desktop/ folder is updated: the helper/ folder is updated by the
website helper's own updater (its Update now button). Standard library only.
"""
import io
import re
import shutil
import ssl
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPO = 'cadenb777-jpg/Trading-Platform'
VERSION_URL = f'https://raw.githubusercontent.com/{REPO}/main/desktop/tp_desktop/__init__.py'
ZIP_URL = f'https://codeload.github.com/{REPO}/zip/refs/heads/main'
ALLOWED_HOSTS = {'raw.githubusercontent.com', 'codeload.github.com'}
HERE = Path(__file__).resolve().parent
MIN_ZIP_BYTES, MAX_ZIP_BYTES = 20_000, 150_000_000
MAX_DESKTOP_BYTES = 20_000_000
REQUIRED = ('launch.py', 'desktop_update.py', 'requirements.txt', 'tp_desktop/__init__.py', 'tp_desktop/app.py')


class UpdateError(Exception):
    pass


def parse_version(text):
    """The '1.2' in `APP_VERSION = '1.2'`, as a tuple (1, 2), or None."""
    m = re.search(r"^APP_VERSION\s*=\s*'(\d+(?:\.\d+)*)'\s*(#.*)?$", text, re.M)
    return tuple(int(x) for x in m.group(1).split('.')) if m else None


def local_version(here=HERE):
    try:
        return parse_version((here / 'tp_desktop' / '__init__.py').read_text(encoding='utf-8'))
    except OSError:
        return None


def is_newer(latest, current):
    return isinstance(latest, tuple) and isinstance(current, tuple) and latest > current


def allowed_url(url):
    try:
        parts = urllib.parse.urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    return parts.scheme == 'https' and parts.hostname in ALLOWED_HOSTS and port in (None, 443) and not parts.username


def fetch(url, limit, timeout=30):
    if not allowed_url(url):
        raise UpdateError('Refusing to download from an unexpected address.')
    req = urllib.request.Request(url, headers={'User-Agent': 'trading-platform-desktop-updater'})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        if not allowed_url(r.geturl()):
            raise UpdateError('The download was redirected to an unexpected address.')
        data = r.read(limit + 1)
    if len(data) > limit:
        raise UpdateError('The download is unexpectedly large.')
    return data


def latest_version():
    return parse_version(fetch(VERSION_URL, 100_000, timeout=10).decode('utf-8', 'replace'))


def _safe(rel):
    if not rel or rel.startswith('/') or '\\' in rel or ':' in rel:
        return False
    return all(part not in ('', '.', '..') for part in rel.split('/'))


def protected(rel):
    """Never written by an update: hidden files/folders (.venv) and Python caches."""
    return any(p.startswith('.') or p == '__pycache__' for p in Path(rel).parts)


def verify_zip(data, expected, current):
    """(zipfile, {relative path: entry}) for the desktop/ folder of a checked download; UpdateError otherwise."""
    if not MIN_ZIP_BYTES <= len(data) <= MAX_ZIP_BYTES:
        raise UpdateError(f'The download has an unexpected size ({len(data):,} bytes).')
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        entries = zf.infolist()
    except (zipfile.BadZipFile, ValueError):
        raise UpdateError("The download isn't a valid ZIP file.")
    tops = {e.filename.split('/', 1)[0] for e in entries}
    if len(tops) != 1:
        raise UpdateError("The download doesn't look like the platform's ZIP.")
    prefix = tops.pop() + '/desktop/'
    members, total = {}, 0
    for e in entries:
        if not e.filename.startswith(prefix) or e.is_dir():
            continue
        rel = e.filename[len(prefix):]
        if not _safe(rel) or (e.external_attr >> 16) & 0o170000 == 0o120000:
            raise UpdateError(f'The download contains an unsafe file name ({rel}).')
        if protected(rel):
            continue
        members[rel] = e
        total += e.file_size
    missing = [n for n in REQUIRED if n not in members]
    if missing:
        raise UpdateError(f"The download is missing {', '.join(missing)}.")
    if total > MAX_DESKTOP_BYTES:
        raise UpdateError('The download is unexpectedly large.')
    version = parse_version(zf.read(members['tp_desktop/__init__.py']).decode('utf-8', 'replace'))
    if version != expected or not is_newer(version, current):
        raise UpdateError(f'The download has desktop version {version}, expected {expected}.')
    return zf, members


def install(data, expected, current, here=HERE):
    """Checks the download, backs up, copies the new files in. Returns the backup folder."""
    zf, members = verify_zip(data, expected, current)
    here = here.resolve()
    backup = here.parent / 'desktop_backup'
    if backup.exists():
        shutil.rmtree(backup)
    shutil.copytree(here, backup, ignore=lambda d, names: [n for n in names if n.startswith('.') or n == '__pycache__'])
    try:
        for rel, entry in members.items():
            target = (here / rel).resolve()
            if here not in target.parents:
                raise UpdateError(f'The download contains an unsafe file name ({rel}).')
            body = zf.read(entry)
            if target.exists() and target.read_bytes() == body:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            part = target.with_name(target.name + '.tp-new')
            part.write_bytes(body)
            part.replace(target)  # swapped in whole, so a running start file is never rewritten in place
            if rel.endswith('.command'):
                target.chmod(0o755)
    except Exception:
        restore(backup, here)
        raise
    return backup


def restore(backup, here=HERE):
    """Puts the backed-up files back (used when an update can't be copied in or the new version won't start)."""
    for path in sorted(Path(backup).rglob('*')):
        rel = path.relative_to(backup)
        if path.is_file() and not protected(rel):
            target = here / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def update_if_newer(log=lambda s: None):
    """Installs the newest version when GitHub has one. Returns (old, new, backup) after an update, else None.
    Network problems are not errors here: the app simply starts as it is."""
    current = local_version()
    try:
        latest = latest_version()
    except Exception as err:  # noqa: BLE001 - offline: start as is
        log(f'Update check skipped: {err}')
        return None
    if not is_newer(latest, current):
        return None
    data = fetch(ZIP_URL, MAX_ZIP_BYTES, timeout=120)
    backup = install(data, latest, current)
    return current, latest, backup
