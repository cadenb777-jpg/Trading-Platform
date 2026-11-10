"""
How to open the platform: in this app's own window ("terminal") or in your normal browser ("web"). The helper runs
either way. The start screen asks each time unless you ticked "Remember my choice"; holding Shift while opening (or the
Start-menu entry "Trading Terminal - choose how to open", which passes --choose) asks again.
Standard library only (tested without Qt).
"""
import json
from pathlib import Path

FILE = Path.home() / '.trading-platform' / 'desktop-choice.json'
CHOICES = ('terminal', 'web')


def remembered(path=FILE):
    """The remembered choice, or None (nothing saved, an unreadable file or an unknown value all mean: ask)."""
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8')).get('open')
    except (OSError, ValueError, AttributeError):
        return None
    return value if value in CHOICES else None


def remember(choice, path=FILE):
    """Saves the choice (or forgets it with None) so the next start opens straight away."""
    path = Path(path)
    if choice is None:
        path.unlink(missing_ok=True)
        return
    if choice not in CHOICES:
        raise ValueError(choice)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'open': choice}), encoding='utf-8')


def decide(saved, force_ask, shift_held):
    """The choice to use without asking, or None to show the start screen."""
    if force_ask or shift_held:
        return None
    return saved
