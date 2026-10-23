"""
The analysis engine. Each module registers its request types; a module that can't load (for example a
missing optional package) is skipped and reported, so charts and everything else keep working.
"""
import importlib
import logging

from .core import HANDLERS, EngineContext, EngineError, handler

MODULES = ('store', 'settings', 'sec', 'flow', 'research', 'macro', 'quant', 'positioning', 'ai')
#: module name -> why it couldn't load
LOAD_ERRORS = {}

for _name in MODULES:
    try:
        importlib.import_module(f'.{_name}', __name__)
    except Exception as _err:  # Keep the helper running without that feature.
        LOAD_ERRORS[_name] = f'{type(_err).__name__}: {_err}'
        logging.getLogger('engine').warning('The %s feature could not start (%s)', _name, LOAD_ERRORS[_name])

__all__ = ['HANDLERS', 'EngineContext', 'EngineError', 'handler', 'LOAD_ERRORS', 'MODULES']
