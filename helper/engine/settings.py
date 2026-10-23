"""
Settings the platform's Settings window can change: the AI key and model, an optional FRED key and the
SEC contact email. They are saved on this computer (~/.trading-platform/settings.json). Keys are never
sent back to the browser; it only learns whether each one is set.
"""
import json
from pathlib import Path

from .core import EngineError, handler

SETTINGS_PATH = Path.home() / '.trading-platform' / 'settings.json'
SECRET_KEYS = {'anthropic_key', 'fred_key'}
AI_MODELS = {
    'claude-opus-5-5': 'Best: Claude Opus 5.5',
    'claude-sonnet-5-5': 'Balanced: Claude Sonnet 5.5',
    'claude-haiku-5-5': 'Fast and low-cost: Claude Haiku 5.5',
}
DEFAULT_MODEL = 'claude-opus-5-5'

_cache = None


def load():
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(SETTINGS_PATH.read_text())
        except (OSError, ValueError):
            _cache = {}
    return _cache


def get(key, default=''):
    return load().get(key) or default


def save(changes):
    data = {**load(), **changes}
    SETTINGS_PATH.parent.mkdir(exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(data, indent=2))
    try:
        SETTINGS_PATH.chmod(0o600)
    except OSError:
        pass
    global _cache
    _cache = data


def public():
    data = load()
    return {
        'aiKeySet': bool(data.get('anthropic_key')),
        'fredKeySet': bool(data.get('fred_key')),
        'secContact': data.get('sec_contact', ''),
        'model': data.get('model') or DEFAULT_MODEL,
        'models': [{'id': k, 'name': v} for k, v in AI_MODELS.items()],
    }


@handler('settings.get')
async def get_settings(ctx, msg):
    return public()


@handler('settings.set')
async def set_settings(ctx, msg):
    changes = {}
    if 'aiKey' in msg:
        key = str(msg['aiKey'] or '').strip()
        if key and not key.startswith('sk-ant-'):
            raise EngineError('That doesn’t look like an Anthropic API key (they start with "sk-ant-").')
        changes['anthropic_key'] = key
    if 'fredKey' in msg:
        key = str(msg['fredKey'] or '').strip()
        if key and not (len(key) == 32 and key.isalnum()):
            raise EngineError('A FRED API key is 32 letters and numbers.')
        changes['fred_key'] = key
    if 'secContact' in msg:
        email = str(msg['secContact'] or '').strip()
        if email and ('@' not in email or ' ' in email):
            raise EngineError('Enter a valid email address.')
        changes['sec_contact'] = email
    if 'model' in msg:
        if msg['model'] not in AI_MODELS:
            raise EngineError('Unknown model')
        changes['model'] = msg['model']
    save(changes)
    ctx.apply_settings()
    return public()
