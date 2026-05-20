"""Socket.IO server singleton.

Mounted by `main.py` as `socketio.ASGIApp(sio, other_asgi_app=app)` so
HTTP traffic flows through FastAPI and `/socket.io/*` through `sio`.
"""

from __future__ import annotations

import socketio

NAMESPACE = "/rooms"

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)
