"""Pytest fixtures shared across the suite.

Environment variables are set **before** any `hoba_api` import so the
module-level `settings = Settings()` instance reads test values.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import AsyncIterator

# --- Env setup (must run before importing hoba_api) ----------------------

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-123:ABCdefGHIJK")
os.environ.setdefault("AUTO_MIGRATE", "false")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("LOG_LEVEL", "WARNING")

# --- Imports --------------------------------------------------------------

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from hoba_api.auth.initdata import sign_init_data  # noqa: E402
from hoba_api.db import get_db  # noqa: E402
from hoba_api.main import app  # noqa: E402
from hoba_api.models import Base  # noqa: E402

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


# --- Fixtures -------------------------------------------------------------


@pytest_asyncio.fixture
async def db() -> AsyncIterator[AsyncSession]:
    """Fresh in-memory SQLite database per test with schema applied."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncIterator[TestClient]:
    """TestClient with `get_db` overridden to return the test session."""

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Test factories -------------------------------------------------------


def make_init_data(
    user_id: int = 42,
    first_name: str = "Volodymyr",
    last_name: str | None = "Yahello",
    username: str | None = "vyahello",
    language_code: str | None = "uk",
    auth_date: int | None = None,
    bot_token: str = BOT_TOKEN,
) -> str:
    """Generate a valid initData string for use as the X-Telegram-Init-Data header."""
    user: dict[str, object] = {"id": user_id, "first_name": first_name}
    if last_name is not None:
        user["last_name"] = last_name
    if username is not None:
        user["username"] = username
    if language_code is not None:
        user["language_code"] = language_code
    fields = {
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "query_id": "AAH_test_query_id",
        "user": json.dumps(user, separators=(",", ":")),
    }
    return sign_init_data(fields, bot_token)


@pytest.fixture
def init_data() -> str:
    """Default valid initData header value."""
    return make_init_data()
