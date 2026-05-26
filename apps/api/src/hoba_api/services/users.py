"""User service — upsert from Telegram, fetch stats."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.user import User
from hoba_api.redis_client import (
    user_id_cache_get,
    user_id_cache_invalidate,
    user_id_cache_set,
)

log = structlog.get_logger("hoba_api.services.users")

_SUPPORTED_LOCALES = {"uk", "en"}


def _normalize_language(language_code: str | None) -> str:
    """Map a Telegram `language_code` to one of our supported locales.

    Telegram sends BCP-47 codes (e.g. `uk`, `uk-UA`, `en`, `en-GB`). We
    support only `uk` and `en` — anything else falls back to `en`.
    """
    if not language_code:
        return "en"
    primary = language_code.lower().split("-", 1)[0]
    if primary in _SUPPORTED_LOCALES:
        return primary
    return "en"


async def upsert_from_telegram(session: AsyncSession, tg_user: TelegramUser) -> User:
    """Insert or update a `users` row keyed by `tg_id`.

    On update the Telegram-side mutable fields (`tg_username`,
    `first_name`, `last_name`, `photo_url`) and `last_active_at` are
    refreshed. User preferences (`language_code`, `sound_enabled`,
    `haptics_enabled`, `is_anonymous_default`) are **not** overwritten
    on subsequent calls — those are owned by the user via PATCH /me.
    """
    now = datetime.now(UTC)
    existing = (
        await session.execute(select(User).where(User.tg_id == tg_user.id))
    ).scalar_one_or_none()

    if existing is None:
        user = User(
            tg_id=tg_user.id,
            tg_username=tg_user.username,
            first_name=tg_user.first_name,
            last_name=tg_user.last_name,
            photo_url=tg_user.photo_url,
            language_code=_normalize_language(tg_user.language_code),
            last_active_at=now,
        )
        session.add(user)
        await session.flush()
        return user

    existing.tg_username = tg_user.username
    existing.first_name = tg_user.first_name
    existing.last_name = tg_user.last_name
    existing.photo_url = tg_user.photo_url
    existing.last_active_at = now
    return existing


async def resolve_telegram_user(
    session: AsyncSession, tg_user: TelegramUser,
) -> User:
    """Get or upsert a `User`, hitting the Redis `tg_id → user_id` cache
    where possible.

    On cache hit: fetches the User by primary key (single fast lookup,
    no upsert, no `last_active_at` bump). Telegram-side mutable fields
    (name, photo) propagate within the TTL window.

    On cache miss: falls through to `upsert_from_telegram` and caches
    `tg_id → user.id` post-flush. **Caller is responsible for committing
    the session.** The cache write is deferred until commit so a failed
    transaction does not poison the cache (this is handled by
    `cache_user_after_commit`).
    """
    cached_id = await user_id_cache_get(tg_user.id)
    if cached_id is not None:
        user = await session.get(User, cached_id)
        if user is not None:
            return user
        # Cache pointed at a deleted row — drop and fall through.
        log.warning("user_cache.stale_pointer", tg_id=tg_user.id, cached_id=cached_id)
        await user_id_cache_invalidate(tg_user.id)
    return await upsert_from_telegram(session, tg_user)


async def cache_user_after_commit(user: User) -> None:
    """Cache `user.tg_id → user.id` after the caller's commit succeeds.

    Splitting cache-set from `resolve_telegram_user` lets the caller
    keep ownership of the commit boundary while still benefiting from
    the cache. A no-op write here is harmless; a write before a failed
    commit would have poisoned the cache.
    """
    await user_id_cache_set(user.tg_id, user.id)


async def get_stats(session: AsyncSession, user_id: int) -> dict[str, int]:
    """Aggregate stats for a user.

    Phase 2: returns zeros — Room / Spin / Wheel tables don't exist yet.
    Wired up phase-by-phase starting Phase 6 (rooms + spins) and Phase 9
    (saved wheels). `session` and `user_id` are accepted now to lock the
    callsite shape.
    """
    del session, user_id
    return {
        "rooms_created": 0,
        "rooms_joined": 0,
        "spins_triggered": 0,
        "wheels_saved": 0,
    }
