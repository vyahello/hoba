"""User service — upsert from Telegram, fetch stats."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.user import User

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
