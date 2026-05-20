"""Hoba! API entry point.

Phase 2 scope: lifespan runs Alembic migrations, structlog middleware
binds a per-request ID, `/api/v1/me*` is mounted via the v1 router.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Request
from starlette.responses import Response

from hoba_api import __version__
from hoba_api.api.v1.router import router as v1_router
from hoba_api.config import settings

_SQLITE_PREFIX = "sqlite+aiosqlite:///"
_ALEMBIC_INI = Path(__file__).resolve().parent.parent.parent / "alembic.ini"


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
    raw_path = url[len(_SQLITE_PREFIX) :]
    if raw_path in ("", ":memory:"):
        return
    path = Path(raw_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    log.info("sqlite.touched", path=str(path))


def _run_migrations_sync() -> None:
    """Run `alembic upgrade head` against `settings.database_url`.

    Sync — call via `asyncio.to_thread` from the async lifespan because
    Alembic's `env.py` runs its own `asyncio.run()`, which would conflict
    with our running event loop.
    """
    cfg = AlembicConfig(str(_ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _configure_logging()
    _ensure_sqlite_file()
    if settings.auto_migrate:
        log.info("alembic.upgrade.start")
        await asyncio.to_thread(_run_migrations_sync)
        log.info("alembic.upgrade.done")
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


@app.middleware("http")
async def structlog_context(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    structlog.contextvars.clear_contextvars()
    request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        path=request.url.path,
        method=request.method,
    )
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "hoba_api", "version": __version__}


app.include_router(v1_router)
