"""
Settings the platform's Settings window can change: the AI key and model, an optional FRED key, optional Alpaca
keys (free price history), the SEC contact email, Webull (keys, Test/Live, order limits) and where alerts are sent
(ntfy topic and server, Telegram bot token and chat id). They are saved on this computer (~/.trading-platform/settings.json). Keys are never
sent back to the browser; it only learns whether each one is set.
"""
import ipaddress
import json
import re
from pathlib import Path

from .core import EngineError, handler

SETTINGS_PATH = Path.home() / '.trading-platform' / 'settings.json'
SECRET_KEYS = {'anthropic_key', 'fred_key', 'alpaca_key_id', 'alpaca_secret', 'webull_app_key', 'webull_app_secret',
               'ntfy_topic', 'ntfy_server', 'telegram_token', 'telegram_chat'}
AI_MODELS = {
    'claude-opus-5-5': 'Best: Claude Opus 5.5',
    'claude-sonnet-5-5': 'Balanced: Claude Sonnet 5.5',
    'claude-haiku-5-5': 'Fast and low-cost: Claude Haiku 5.5',
}
DEFAULT_MODEL = 'claude-opus-5-5'

_cache = None


def _local_host(host):
    """True for this computer or the home network (localhost, 10.x, 192.168.x, 172.16-31.x, *.local)."""
    host = host.lower()
    if host == 'localhost' or host.endswith('.local'):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private and ip.version == 4 and any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


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
        'alpacaSet': bool(data.get('alpaca_key_id') and data.get('alpaca_secret')),
        'webullSet': bool(data.get('webull_app_key') and data.get('webull_app_secret')),
        'webullEnv': 'live' if data.get('webull_env') == 'live' else 'test',
        'webullMaxOrder': data.get('webull_max_order') or 1000,
        'webullMaxPerDay': data.get('webull_max_per_day') or 10,
        'webullFutures': data.get('webull_futures_ok') is True,
        'webullFuturesMaxContracts': data.get('webull_futures_max_contracts') or 1,
        'webullFuturesMaxPerDay': data.get('webull_futures_max_per_day') or 3,
        'ntfySet': bool(data.get('ntfy_topic')),
        'ntfyCustomServer': bool(data.get('ntfy_server')),
        'telegramSet': bool(data.get('telegram_token') and data.get('telegram_chat')),
        'secContact': data.get('sec_contact', ''),
        'model': data.get('model') or DEFAULT_MODEL,
        'openBrowser': data.get('open_browser') is not False,
        'autoUpdate': data.get('auto_update') is True,
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
    for field, name, label in (('alpacaKeyId', 'alpaca_key_id', 'key ID'), ('alpacaSecret', 'alpaca_secret', 'secret key')):
        if field in msg:
            key = str(msg[field] or '').strip()
            if key and (not 10 <= len(key) <= 100 or any(ch.isspace() for ch in key)):
                raise EngineError(f'That doesn’t look like an Alpaca {label}. Copy it again from alpaca.markets.')
            changes[name] = key
    for field, name, label in (('webullAppKey', 'webull_app_key', 'App Key'), ('webullAppSecret', 'webull_app_secret', 'App Secret')):
        if field in msg:
            key = str(msg[field] or '').strip()
            if key and (not 8 <= len(key) <= 200 or any(ch.isspace() for ch in key)):
                raise EngineError(f'That doesn’t look like a Webull {label}. Copy it again from Webull’s developer site.')
            changes[name] = key
    if 'webullAppKey' in msg and 'webullAppSecret' in msg and not changes['webull_app_key'] and not changes['webull_app_secret']:
        changes['webull_env'], changes['webull_live_ok'] = 'test', False  # Remove: back to Test
        changes['webull_futures_ok'] = False  # and futures trading off again
    if 'webullEnv' in msg:
        if msg['webullEnv'] == 'live':
            if msg.get('webullLiveConfirm') != 'LIVE':
                raise EngineError('Type LIVE to switch Webull to real-money trading.')
            changes['webull_env'], changes['webull_live_ok'] = 'live', True
        elif msg['webullEnv'] == 'test':
            changes['webull_env'], changes['webull_live_ok'] = 'test', False
        else:
            raise EngineError('Unknown Webull environment')
    if 'webullMaxOrder' in msg:
        try:
            value = float(msg['webullMaxOrder'])
        except (TypeError, ValueError):
            value = 0
        if not 1 <= value <= 1_000_000:
            raise EngineError('Max order value must be between $1 and $1,000,000.')
        changes['webull_max_order'] = value
    if 'webullMaxPerDay' in msg:
        try:
            value = int(msg['webullMaxPerDay'])
        except (TypeError, ValueError):
            value = 0
        if not 1 <= value <= 100:
            raise EngineError('Max orders per day must be between 1 and 100.')
        changes['webull_max_per_day'] = value
    if 'webullFutures' in msg:
        # Futures trading is a separate opt-in (on top of LIVE for real money): the owner types FUTURES to switch it on.
        if msg['webullFutures'] is True:
            if msg.get('webullFuturesConfirm') != 'FUTURES':
                raise EngineError('Type FUTURES to switch on futures trading.')
            changes['webull_futures_ok'] = True
        elif msg['webullFutures'] is False:
            changes['webull_futures_ok'] = False
        else:
            raise EngineError('Unknown futures setting')
    for field, name, top, label in (('webullFuturesMaxContracts', 'webull_futures_max_contracts', 20, 'Max contracts per order'),
                                    ('webullFuturesMaxPerDay', 'webull_futures_max_per_day', 50, 'Max contracts per day')):
        if field in msg:
            try:
                value = int(msg[field])
            except (TypeError, ValueError):
                value = 0
            if not 1 <= value <= top or isinstance(msg[field], bool):
                raise EngineError(f'{label} must be between 1 and {top}.')
            changes[name] = value
    old_env = 'live' if load().get('webull_env') == 'live' else 'test'
    if changes.get('webull_env', old_env) != old_env:
        # A FUTURES typed in Test never carries over to Live (or back): switching environment turns futures off.
        changes['webull_futures_ok'] = False
    if 'secContact' in msg:
        email = str(msg['secContact'] or '').strip()
        if email and ('@' not in email or ' ' in email):
            raise EngineError('Enter a valid email address.')
        changes['sec_contact'] = email
    if 'ntfyTopic' in msg:
        topic = str(msg['ntfyTopic'] or '').strip()
        if topic and not re.fullmatch(r'[A-Za-z0-9_-]{12,64}', topic):
            raise EngineError('An ntfy topic is 12 to 64 letters, numbers, - or _. Make it long and random: anyone who knows it can read your alerts.')
        changes['ntfy_topic'] = topic
    if 'ntfyServer' in msg:
        server = str(msg['ntfyServer'] or '').strip().rstrip('/')
        if server == 'https://ntfy.sh':
            server = ''
        m = re.fullmatch(r'(https?)://([^\s/?#@:]+)(:\d{1,5})?(/[^\s?#]*)?', server) if server else None
        if server and not m:
            raise EngineError('Enter your ntfy server address, like https://ntfy.example.com (leave empty for ntfy.sh).')
        if m and m.group(1) == 'http' and not _local_host(m.group(2)):
            raise EngineError('Use https:// for an ntfy server on the internet (plain http:// only for one on your own network).')
        changes['ntfy_server'] = server
    if 'telegramToken' in msg:
        token = str(msg['telegramToken'] or '').strip()
        if token and not re.fullmatch(r'\d{5,15}:[A-Za-z0-9_-]{30,60}', token):
            raise EngineError('That doesn’t look like a Telegram bot token (numbers, a colon, then a long code from BotFather).')
        changes['telegram_token'] = token
    if 'telegramChat' in msg:
        chat = str(msg['telegramChat'] or '').strip()
        if chat and not re.fullmatch(r'-?\d{3,20}|@[A-Za-z0-9_]{5,40}', chat):
            raise EngineError('A Telegram chat id is a number (like 123456789).')
        changes['telegram_chat'] = chat
    if 'openBrowser' in msg:
        changes['open_browser'] = bool(msg['openBrowser'])
    if 'autoUpdate' in msg:
        changes['auto_update'] = bool(msg['autoUpdate'])
    if 'model' in msg:
        if msg['model'] not in AI_MODELS:
            raise EngineError('Unknown model')
        changes['model'] = msg['model']
    save(changes)
    ctx.apply_settings()
    return public()
