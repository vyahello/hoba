"""Async SQLAlchemy engine + session factory + FastAPI dependency."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from hoba_api.config import settings

engine = create_async_engine(settings.database_url, echo=False, future=True)

SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped async DB session.

    Caller is responsible for `await session.commit()`. The `async with`
    block guarantees rollback on uncaught exception and connection
    cleanup on success.
    """
    async with SessionLocal() as session:
        yield session
