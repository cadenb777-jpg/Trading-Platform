"""
The analysis engine: everything the platform asks the helper for beyond live prices and news
(fundamentals, options flow, macro data, portfolios, risk, client reports).

Each module registers request handlers with @handler('name'); the helper's server looks them up
in HANDLERS and sends back whatever they return.
"""
from . import flow, sec, store
from .core import HANDLERS, EngineContext, EngineError, handler

__all__ = ['HANDLERS', 'EngineContext', 'EngineError', 'handler', 'flow', 'sec', 'store']
