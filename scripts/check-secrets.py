"""Fails when a file in the repository holds a secret-looking value that isn't in .secrets.baseline (the known fake
keys in tests). Compares by the value's fingerprint (detect-secrets' hashed_secret) and file, not line numbers, so
editing a file never trips it; only a new key does. Run: python scripts/check-secrets.py (needs detect-secrets)."""
import json
import subprocess
import sys

baseline = json.load(open('.secrets.baseline'))
exclude = baseline['filters_used']
regexes = next((f['pattern'] for f in exclude if f.get('path') == 'detect_secrets.filters.regex.should_exclude_file'), [])
cmd = ['detect-secrets', 'scan']
for r in regexes:
    cmd += ['--exclude-files', r]
now = json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout)
known = {(f, s['hashed_secret']) for f, items in baseline['results'].items() for s in items}
new = [(f, s['line_number'], s['type']) for f, items in now['results'].items() for s in items if (f, s['hashed_secret']) not in known]
for f, line, kind in new:
    print(f'New possible secret: {f}:{line} ({kind}). Remove it (keys live only in ~/.trading-platform), or if it is a fake '
          'test value, refresh the baseline (see CLAUDE.md, Security).')
print(f'{sum(len(v) for v in now["results"].values())} known fake values, {len(new)} new.')
sys.exit(1 if new else 0)
