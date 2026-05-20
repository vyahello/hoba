"""Tests for `hoba_bot.middleware.DBMiddleware`."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from hoba_bot.middleware import DBMiddleware


async def test_middleware_injects_session_into_handler_data() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    middleware = DBMiddleware(factory)

    captured: dict[str, Any] = {}

    async def handler(event: Any, data: dict[str, Any]) -> str:
        captured["session"] = data["session"]
        return "ok"

    result = await middleware(handler, AsyncMock(), {})
    assert result == "ok"
    assert isinstance(captured["session"], AsyncSession)
    await engine.dispose()
