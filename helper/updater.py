"""
Updates the helper from the public GitHub repository, only when you click Update now (or turn on "Install updates
automatically" in Settings).

Steps: read the newest HELPER_VERSION from GitHub, download the main-branch ZIP, check it (a real zip whose
helper/schwab_helper.py has exactly that newer version, a sane size, no odd paths), unpack only its helper/ folder
into a temporary folder, back up this folder to helper_backup_v<old> next to it (only the newest backup is kept),
copy the changed files in (the backup is put back if that fails), note the update in ~/.trading-platform and exit
with RESTART_CODE. splash.py then installs any changed Python parts and starts the new version; if that fails, or
the new version crashes before its main() begins (on import), splash.py puts the backup back (splash.roll_back).

Your keys, logins, portfolios and caches live in ~/.trading-platform, never in this folder. The update itself never
writes hidden files (the .venv folder with the installed parts, .DS_Store); only start-up's pip install changes .venv.

Standard library only (the downloads themselves use the helper's httpx client, passed in).
"""
import asyncio
import io
import logging
import re
import shutil
import tempfile
import time
import urllib.parse
import zipfile
from pathlib import Path

# splash.py is standard library only too; it owns the file copying so it can roll an update back by itself.
from splash import RESTART_CODE, clear_pending, copy_files, protected, write_pending  # noqa: F401

REPO = 'cadenb777-jpg/Trading-Platform'
VERSION_URL = f'https://raw.githubusercontent.com/{REPO}/main/helper/schwab_helper.py'
ZIP_URL = f'https://codeload.github.com/{REPO}/zip/refs/heads/main'
ALLOWED_HOSTS = {'raw.githubusercontent.com', 'codeload.github.com'}

HERE = Path(__file__).resolve().parent
MIN_ZIP_BYTES = 20_000
MAX_ZIP_BYTES = 150_000_000
MAX_HELPER_BYTES = 60_000_000  # unpacked size of the helper folder (guards against zip bombs)
REQUIRED_FILES = ('schwab_helper.py', 'splash.py', 'requirements.txt')
KEEP_BACKUPS = 1
CHECK_EVERY_SECONDS = 10 * 60
BACKUP_PATTERN = re.compile(r'^helper_backup_v(\d+)$')

log = logging.getLogger('helper.update')


class UpdateError(Exception):
    """A problem worth showing to the owner as-is."""


# ---------- Checks ----------

def allowed_url(url):
    """True only for https links to the two GitHub hosts updates come from (no other port, no login part)."""
    try:
        parts = urllib.parse.urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    return (parts.scheme == 'https' and parts.hostname in ALLOWED_HOSTS and port in (None, 443)
            and not parts.username and not parts.password)


def parse_version(text):
    """The number in the `HELPER_VERSION = 29` line of schwab_helper.py, or None."""
    m = re.search(r'^HELPER_VERSION\s*=\s*(\d+)\s*(#.*)?$', text, re.M)
    return int(m.group(1)) if m else None


def is_newer(latest, current):
    return isinstance(latest, int) and isinstance(current, int) and latest > current


def _safe_name(rel):
    if not rel or rel.startswith('/') or '\\' in rel or ':' in rel:
        return False
    return all(part not in ('', '.', '..') for part in rel.split('/'))


def verify_zip(data, expected, current):
    """Checks a downloaded ZIP and returns (zipfile, {relative path: entry}) for its helper/ folder.

    Raises UpdateError unless it's a zip of one top folder holding helper/schwab_helper.py with exactly the
    expected version, newer than `current`."""
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
    prefix = tops.pop() + '/helper/'
    members, total = {}, 0
    for e in entries:
        if not e.filename.startswith(prefix) or e.is_dir():
            continue
        rel = e.filename[len(prefix):]
        if not _safe_name(rel) or (e.external_attr >> 16) & 0o170000 == 0o120000:  # odd paths or links
            raise UpdateError(f'The download contains an unsafe file name ({rel}).')
        if protected(rel):
            continue
        members[rel] = e
        total += e.file_size
    missing = [name for name in REQUIRED_FILES if name not in members]
    if missing:
        raise UpdateError(f"The download is missing {', '.join(missing)}.")
    if total > MAX_HELPER_BYTES:
        raise UpdateError('The download is unexpectedly large.')
    try:
        version = parse_version(zf.read(members['schwab_helper.py']).decode('utf-8', 'replace'))
    except (zipfile.BadZipFile, OSError):
        raise UpdateError('The download is damaged.')
    if version != expected or not is_newer(version, current):
        raise UpdateError(f'The download has helper version {version}, expected {expected}.')
    return zf, members


# ---------- Files ----------

def extract_helper(zf, members, dest):
    """Writes only the helper/ files into `dest` (reading checks each file's checksum)."""
    dest = Path(dest).resolve()
    for rel, entry in members.items():
        target = (dest / rel).resolve()
        if dest not in target.parents:
            raise UpdateError(f'The download contains an unsafe file name ({rel}).')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_bytes(zf.read(entry))
        except zipfile.BadZipFile:
            raise UpdateError('The download is damaged.')
        if rel.endswith('.command') or (entry.external_attr >> 16) & 0o111:
            target.chmod(0o755)  # the Mac start file must stay double-clickable


def backup(here, version, keep=KEEP_BACKUPS):
    """Copies the current helper (without .venv and caches) to helper_backup_v<version> next to it."""
    here = Path(here)
    dest = here.parent / f'helper_backup_v{version}'
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir()
    copy_files(here, dest)
    prune_backups(here.parent, keep)
    return dest


def prune_backups(parent, keep=KEEP_BACKUPS):
    found = []
    for path in Path(parent).iterdir():
        m = BACKUP_PATTERN.match(path.name)
        if m and path.is_dir():
            found.append((int(m.group(1)), path))
    for _, path in sorted(found, reverse=True)[keep:]:
        shutil.rmtree(path, ignore_errors=True)


def install(data, expected, current, here=HERE):
    """Verifies the download, then swaps the new helper files in. Returns the backup folder.

    Nothing from the download runs before it is verified; if copying fails, the backup is put back. Python parts
    are installed by splash.py after this helper has stopped."""
    here = Path(here)
    zf, members = verify_zip(data, expected, current)
    with tempfile.TemporaryDirectory(prefix='tp-update-') as tmp:
        new = Path(tmp) / 'helper'
        extract_helper(zf, members, new)
        saved = backup(here, current)
        try:
            copy_files(new, here)
        except Exception as err:
            log.exception('Update copy failed; restoring the backup')
            try:
                copy_files(saved, here)
            except Exception:
                log.exception('Restoring the backup failed')
                raise UpdateError(f'The update failed ({err}) and the old files could not all be put back. '
                                  f'Your previous version is saved in {saved}: copy its files into {here}.')
            raise UpdateError(f'The update failed ({err}). Your previous version was put back.')
    write_pending(saved, current, expected)
    return saved


# ---------- Downloads (with the helper's httpx client) ----------

async def fetch(http, url, max_bytes, hops=3):
    """Downloads `url` without following redirects to anywhere but the allowed GitHub hosts."""
    for _ in range(hops + 1):
        if not allowed_url(url):
            raise UpdateError(f'Refused to download from {urllib.parse.urlsplit(url).hostname or url}.')
        async with http.stream('GET', url, follow_redirects=False, timeout=60) as r:
            if r.status_code in (301, 302, 303, 307, 308):
                url = urllib.parse.urljoin(url, r.headers.get('location', ''))
                continue
            if r.status_code != 200:
                raise UpdateError(f'GitHub answered {r.status_code}. Try again later.')
            chunks, size = [], 0
            async for chunk in r.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise UpdateError('The download is unexpectedly large.')
                chunks.append(chunk)
            return b''.join(chunks)
    raise UpdateError('GitHub redirected too many times.')


async def latest_version(http):
    version = parse_version((await fetch(http, VERSION_URL, 2_000_000)).decode('utf-8', 'replace'))
    if version is None:
        raise UpdateError("Couldn't read the newest version number from GitHub.")
    return version


class Updater:
    """Knows the newest version and runs one update at a time. `on_change` is called whenever its state changes."""

    def __init__(self, current, on_change=lambda: None, here=HERE):
        self.current = current
        self.latest = None
        self.state = 'idle'  # idle, updating, restarting, failed
        self.message = ''
        self.checked = 0.0
        self.on_change = on_change
        self.here = here

    def public(self):
        return {'latest': self.latest, 'state': self.state, 'message': self.message}

    @property
    def available(self):
        return is_newer(self.latest, self.current)

    def _set(self, state, message=''):
        self.state, self.message = state, message
        self.on_change()

    async def check(self, http):
        if self.state == 'failed':
            self.state, self.message = 'idle', ''  # each check gives a failed update a fresh start
        try:
            self.latest = await latest_version(http)
            self.checked = time.time()
            log.info('Newest helper on GitHub: version %s (this is %s)', self.latest, self.current)
        except Exception as err:
            log.info('Update check failed: %s', err)
        self.on_change()

    async def update(self, http):
        """Downloads and installs the newest version. True when it's ready to restart; raises UpdateError otherwise."""
        if self.state in ('updating', 'restarting'):
            raise UpdateError('An update is already running.')
        self._set('updating', 'Checking GitHub for the newest version...')
        try:
            latest = await latest_version(http)
            self.latest = latest
            if not is_newer(latest, self.current):
                self._set('idle', '')
                raise UpdateError(f'This helper (version {self.current}) is already the newest.')
            self._set('updating', f'Downloading version {latest}...')
            data = await fetch(http, ZIP_URL, MAX_ZIP_BYTES)
            self._set('updating', f'Installing version {latest}...')
            saved = await asyncio.to_thread(install, data, latest, self.current, self.here)
            log.info('Updated to version %s; backup in %s', latest, saved)
            self._set('restarting', f'Updated to version {latest}. Restarting...')
            return True
        except UpdateError as err:
            if self.state == 'updating':
                self._set('failed', str(err))
            raise
        except Exception as err:
            log.exception('Update failed')
            self._set('failed', f'The update failed: {err}. Nothing was changed.')
            raise UpdateError(self.message)


def confirm_started():
    """Called when the new helper's imports worked and main() begins: from then on splash.py no longer rolls it back
    (a failed Schwab login or a busy port isn't the update's fault)."""
    clear_pending()
