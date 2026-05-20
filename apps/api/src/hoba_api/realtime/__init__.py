"""Socket.IO realtime layer — `/rooms` namespace."""

from hoba_api.realtime.handlers import register_handlers
from hoba_api.realtime.server import sio

__all__ = ["register_handlers", "sio"]
