"""Hoba! API entry point.

Phase 1 scope: minimal FastAPI app exposing `/health` and `/docs`, and
touching the SQLite file referenced by `DATABASE_URL` on startup so the
volume mount is exercised end-to-end. Models, routes and Socket.IO arrive
in Phase 2 / Phase 6.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI

from hoba_api import __version__
from hoba_api.config import settings

_SQLITE_PREFIX = "sqlite+aiosqlite:///"


def _configure_logging() -> None:
    logging.basicConfig(format="%(message)s", level=settings.log_level.upper())
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


log = structlog.get_logger("hoba_api")


def _ensure_sqlite_file() -> None:
    url = settings.database_url
    if not url.startswith(_SQLITE_PREFIX):
        return
    path = Path(url[len(_SQLITE_PREFIX) :])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    log.info("sqlite.touched", path=str(path))


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _configure_logging()
    _ensure_sqlite_file()
    log.info(
        "api.startup",
        version=__version__,
        database_url=settings.database_url,
        redis_url=settings.redis_url,
    )
    yield
    log.info("api.shutdown")


app = FastAPI(
    title="Hoba! API",
    version=__version__,
    description="Multiplayer Telegram Mini App backend. See docs/spec.md.",
    lifespan=lifespan,
)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "hoba_api", "version": __version__}
