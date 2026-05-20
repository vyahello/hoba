"""Tests for `hoba_api.services.users`."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.user import User
from hoba_api.services.users import (
    _normalize_language,
    get_stats,
    upsert_from_telegram,
)


def _tg(**overrides: object) -> TelegramUser:
    defaults: dict[str, object] = {
        "id": 100,
        "first_name": "Volo",
        "last_name": "Y",
        "username": "vy",
        "language_code": "uk",
        "photo_url": None,
    }
    defaults.update(overrides)
    return TelegramUser.model_validate(defaults)


async def test_upsert_creates_new_user(db: AsyncSession) -> None:
    user = await upsert_from_telegram(db, _tg(id=1, first_name="Alice"))
    await db.commit()
    assert user.id is not None
    assert user.tg_id == 1
    assert user.first_name == "Alice"
    assert user.language_code == "uk"
    assert user.sound_enabled is True
    assert user.haptics_enabled is True
    assert user.is_anonymous_default is False


async def test_upsert_idempotent_on_tg_id(db: AsyncSession) -> None:
    await upsert_from_telegram(db, _tg(id=2, first_name="Bob"))
    await db.commit()
    await upsert_from_telegram(db, _tg(id=2, first_name="Bob"))
    await db.commit()
    rows = (await db.execute(select(User).where(User.tg_id == 2))).scalars().all()
    assert len(rows) == 1


async def test_upsert_updates_telegram_fields_on_second_call(
    db: AsyncSession,
) -> None:
    first = await upsert_from_telegram(db, _tg(id=3, first_name="Old", username="old_u"))
    await db.commit()
    first_active = first.last_active_at

    second = await upsert_from_telegram(
        db, _tg(id=3, first_name="New", username="new_u"),
    )
    await db.commit()
    assert second.id == first.id
    assert second.first_name == "New"
    assert second.tg_username == "new_u"
    assert second.last_active_at >= first_active


async def test_upsert_does_not_overwrite_user_preferences(db: AsyncSession) -> None:
    user = await upsert_from_telegram(db, _tg(id=4, language_code="uk"))
    user.language_code = "en"
    user.sound_enabled = False
    user.haptics_enabled = False
    user.is_anonymous_default = True
    await db.commit()

    refreshed = await upsert_from_telegram(db, _tg(id=4, language_code="uk"))
    await db.commit()
    assert refreshed.language_code == "en"
    assert refreshed.sound_enabled is False
    assert refreshed.haptics_enabled is False
    assert refreshed.is_anonymous_default is True


@pytest.mark.parametrize(
    ("input_lang", "expected"),
    [
        ("uk", "uk"),
        ("uk-UA", "uk"),
        ("en", "en"),
        ("en-GB", "en"),
        ("EN", "en"),
        ("UK", "uk"),
        ("fr", "en"),
        ("ru", "en"),
        ("", "en"),
        (None, "en"),
    ],
)
def test_normalize_language(input_lang: str | None, expected: str) -> None:
    assert _normalize_language(input_lang) == expected


async def test_get_stats_returns_zeros_for_phase_2(db: AsyncSession) -> None:
    stats = await get_stats(db, user_id=1)
    assert stats == {
        "rooms_created": 0,
        "rooms_joined": 0,
        "spins_triggered": 0,
        "wheels_saved": 0,
    }
