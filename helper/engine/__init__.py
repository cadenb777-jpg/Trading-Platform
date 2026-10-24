"""
The analysis engine. Each module registers its request types; a module that can't load (for example a
missing optional package) is skipped and reported, so charts and everything else keep working.

The modules (with big libraries like numpy, scipy and the AI SDK) load on a background thread, so the helper
can log in to Schwab and start serving charts while they load. Requests that need them wait until they're ready.
"""
import asyncio
import importlib
import logging
import threading

from .core import HANDLERS, EngineContext, EngineError, background, handler

MODULES = ('store', 'settings', 'alpaca', 'sec', 'flow', 'research', 'macro', 'quant', 'positioning', 'invest', 'alts', 'dividends', 'webull', 'scanner', 'ai')
#: module name -> why it couldn't load
LOAD_ERRORS = {}
#: set once every module has been imported (or failed to)
READY = threading.Event()

_lock = threading.Lock()
_loader = None


def _load_all():
    for name in MODULES:
        try:
            importlib.import_module(f'.{name}', __name__)
        except Exception as err:  # Keep the helper running without that feature.
            LOAD_ERRORS[name] = f'{type(err).__name__}: {err}'
            logging.getLogger('engine').warning('The %s feature could not start (%s)', name, LOAD_ERRORS[name])
    READY.set()


def start_loading():
    """Starts importing the engine modules in the background (once)."""
    global _loader
    with _lock:
        if _loader is None:
            _loader = threading.Thread(target=_load_all, name='engine-loader', daemon=True)
            _loader.start()


async def wait_loaded():
    """Waits (without blocking the server) until the engine modules are loaded."""
    if not READY.is_set():
        start_loading()
        await asyncio.to_thread(READY.wait)


def load_all():
    """Loads every module and waits (for scripts and tests)."""
    start_loading()
    READY.wait()


__all__ = ['HANDLERS', 'EngineContext', 'EngineError', 'background', 'handler', 'LOAD_ERRORS', 'MODULES', 'READY', 'start_loading', 'wait_loaded', 'load_all']
