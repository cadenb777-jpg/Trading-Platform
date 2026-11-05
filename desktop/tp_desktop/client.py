"""
The connection to the desktop's helper (ws://127.0.0.1:8766, helper/schwab_helper.py --desktop). A background
thread runs an asyncio WebSocket client; replies and pushes come back to the Qt thread as signals. The app only
reads data: it sends no order requests (tests/test_no_trading.py scans the app for them).
"""
import asyncio
import itertools
import json
import threading

from PySide6.QtCore import QObject, Signal

ORIGIN = 'tp-desktop://app'


class HelperClient(QObject):
    connected = Signal(bool)
    status = Signal(dict)
    quote = Signal(dict)
    reply = Signal(int, dict)

    def __init__(self, port=8766):
        super().__init__()
        self.url = f'ws://127.0.0.1:{port}'
        self._ids = itertools.count(1)
        self._loop = asyncio.new_event_loop()
        self._ws = None
        self._callbacks = {}
        self._subs = set()
        self.reply.connect(self._dispatch)

    def start(self):
        """Starts the network thread (after the window has connected its slots, so the first status isn't missed)."""
        threading.Thread(target=self._run, daemon=True, name='helper-client').start()

    # ----- called from the Qt thread -----

    def request(self, kind, params=None, on_reply=None):
        """Sends {type: kind, ...params}; on_reply(dict) runs on the Qt thread with the reply (type error on failure)."""
        rid = next(self._ids)
        if on_reply:
            self._callbacks[rid] = on_reply
        msg = {**(params or {}), 'type': kind, 'id': rid}
        asyncio.run_coroutine_threadsafe(self._send(msg, rid), self._loop)
        return rid

    def engine(self, name, params=None, on_reply=None):
        """An engine request (e.g. webull.snapshot): the reply's data, or an error dict."""
        return self.request(name, params, on_reply)

    def subscribe(self, symbol):
        self._subs.add(symbol)
        self.request('subscribe', {'symbol': symbol})

    def _dispatch(self, rid, msg):
        cb = self._callbacks.pop(rid, None)
        if cb:
            cb(msg)

    # ----- the network thread -----

    def _run(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._forever())

    async def _send(self, msg, rid):
        if self._ws is None:
            self.reply.emit(rid, {'type': 'error', 'message': "The desktop helper isn't running yet."})
            return
        try:
            await self._ws.send(json.dumps(msg))
        except Exception as err:  # noqa: BLE001 - reported to the page
            self.reply.emit(rid, {'type': 'error', 'message': str(err)})

    async def _forever(self):
        import websockets
        while True:
            try:
                async with websockets.connect(self.url, origin=ORIGIN, max_size=40 * 2**20) as ws:
                    self._ws = ws
                    self.connected.emit(True)
                    for s in list(self._subs):
                        await ws.send(json.dumps({'type': 'subscribe', 'symbol': s, 'id': next(self._ids)}))
                    async for text in ws:
                        msg = json.loads(text)
                        kind = msg.get('type')
                        if kind == 'status':
                            self.status.emit(msg)
                        elif kind == 'quote':
                            self.quote.emit(msg)
                        if 'id' in msg and msg['id'] is not None:
                            self.reply.emit(int(msg['id']), msg)
            except Exception:  # noqa: BLE001 - not running yet, or restarted: try again
                pass
            self._ws = None
            self.connected.emit(False)
            await asyncio.sleep(2)
