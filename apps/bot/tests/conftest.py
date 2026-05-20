"""Pytest fixtures shared across the bot test suite.

Environment variables are set **before** any `hoba_api` / `hoba_bot`
import so the module-level `Settings()` instance picks up test values.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-123:ABCdefGHIJK")
os.environ.setdefault("TELEGRAM_BOT_USERNAME", "hobagame_bot")
os.environ.setdefault("WEBAPP_URL", "https://test.trycloudflare.com")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("AUTO_MIGRATE", "false")
os.environ.setdefault("LOG_LEVEL", "WARNING")

import pytest_asyncio  # noqa: E402
from aiogram.types import User as TgUser  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from hoba_api.models import Base  # noqa: E402


@pytest_asyncio.fixture
async def db() -> AsyncIterator[AsyncSession]:
    """Fresh in-memory SQLite per test with `users` table created."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        yield session
    await engine.dispose()


def make_tg_user(
    user_id: int = 42,
    first_name: str = "Volodymyr",
    last_name: str | None = "Yahello",
    username: str | None = "vyahello",
    language_code: str | None = "uk",
) -> TgUser:
    return TgUser(
        id=user_id,
        is_bot=False,
        first_name=first_name,
        last_name=last_name,
        username=username,
        language_code=language_code,
    )


def make_message_mock(tg_user: TgUser | None = None, text: str = "/start") -> AsyncMock:
    """AsyncMock standing in for an aiogram `Message` in handler tests."""
    msg = AsyncMock()
    msg.from_user = tg_user if tg_user is not None else make_tg_user()
    msg.text = text
    msg.answer = AsyncMock()
    return msg
