"""Built-in templates (F2/Phase 9) — catalog, localization, room instantiation."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.question import Question
from hoba_api.models.segment import Segment
from hoba_api.services.rooms import RoomServiceError
from hoba_api.services.templates import (
    create_room_from_template,
    localize_template,
    localized_templates,
)
from hoba_api.templates.catalog import (
    get_template,
    list_templates,
    resolve_locale,
)


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(db, TelegramUser(id=tg_id, first_name=f"U{tg_id}"))
    await db.flush()
    return user.id


def test_catalog_has_at_least_eight_unique_templates() -> None:
    templates = list_templates()
    assert len(templates) >= 8
    keys = [t.key for t in templates]
    assert len(keys) == len(set(keys))  # unique keys


def test_every_template_is_fully_bilingual() -> None:
    for t in list_templates():
        assert set(t.title.keys()) == {"en", "uk"}
        assert all(v.strip() for v in t.title.values())
        assert 2 <= len(t.segments) <= 12
        for s in t.segments:
            assert set(s.label.keys()) == {"en", "uk"}
            assert all(v.strip() for v in s.label.values())


def test_resolve_locale_falls_back_to_en() -> None:
    assert resolve_locale("uk") == "uk"
    assert resolve_locale("UK") == "uk"
    assert resolve_locale("uk-UA") == "uk"
    assert resolve_locale("fr") == "en"
    assert resolve_locale(None) == "en"


def test_localize_picks_the_right_strings() -> None:
    eat = get_template("eat")
    assert eat is not None
    en = localize_template(eat, "en")
    uk = localize_template(eat, "uk")
    assert en.title == "Where to eat?"
    assert uk.title == "Що поїсти?"
    assert en.segments[0].label == "Pizza"
    assert uk.segments[0].label == "Піца"
    # Structural fields are locale-independent.
    assert en.segments[0].color_seed == uk.segments[0].color_seed
    assert en.segments[0].emoji == uk.segments[0].emoji


def test_localized_templates_unknown_locale_is_english() -> None:
    fr = localized_templates("fr")
    en = localized_templates("en")
    assert [t.title for t in fr] == [t.title for t in en]


async def test_create_room_from_template_uses_locale_strings(db: AsyncSession) -> None:
    host = await _make_user(db, tg_id=920)
    room = await create_room_from_template(
        db, host_id=host, template_key="eat", locale="uk",
    )
    await db.commit()
    assert room.host_id == host
    question = (
        await db.execute(select(Question).where(Question.room_id == room.id))
    ).scalar_one()
    assert question.text == "Що поїсти?"
    segments = (
        (
            await db.execute(
                select(Segment).where(
                    Segment.parent_id == question.id,
                    Segment.parent_type == "question",
                ),
            )
        )
        .scalars()
        .all()
    )
    assert "Піца" in {s.label for s in segments}


async def test_create_room_from_template_rejects_unknown_key(db: AsyncSession) -> None:
    host = await _make_user(db, tg_id=921)
    with pytest.raises(RoomServiceError) as exc:
        await create_room_from_template(db, host_id=host, template_key="nope")
    assert exc.value.code == "template_not_found"


async def test_create_room_from_template_passes_mode(db: AsyncSession) -> None:
    host = await _make_user(db, tg_id=922)
    room = await create_room_from_template(
        db, host_id=host, template_key="friday", game_mode="elimination",
    )
    await db.commit()
    assert room.game_mode == "elimination"
