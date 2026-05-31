"""Phase 10 — public wheels: publish, like, report/auto-hide, trending, search."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.moderation import contains_profanity, normalize_category
from hoba_api.services.rooms import RoomServiceError, SegmentDraft
from hoba_api.services.wheels import (
    REPORT_HIDE_THRESHOLD,
    create_wheel,
    get_public_wheel,
    get_wheel,
    list_trending,
    publish_wheel,
    report_wheel,
    search_trending,
    toggle_like,
    unpublish_wheel,
    use_wheel,
)


async def _make_user(db: AsyncSession, tg_id: int) -> int:
    from hoba_api.auth.initdata import TelegramUser
    from hoba_api.services.users import upsert_from_telegram

    user = await upsert_from_telegram(db, TelegramUser(id=tg_id, first_name=f"U{tg_id}"))
    await db.flush()
    return user.id


def _drafts(n: int, prefix: str = "Opt") -> list[SegmentDraft]:
    return [SegmentDraft(label=f"{prefix} {i}", color_seed=i % 12) for i in range(n)]


async def _published(db: AsyncSession, owner: int, title: str = "Nice wheel") -> int:
    w = await create_wheel(db, owner_id=owner, title=title, segments=_drafts(3))
    await db.flush()
    fresh = await get_wheel(db, w.id)
    assert fresh is not None
    await publish_wheel(db, fresh, owner_id=owner, category="fun")
    await db.commit()
    return w.id


# --- profanity ------------------------------------------------------------


def test_profanity_catches_spacing_and_leet() -> None:
    assert contains_profanity("clean title") is False
    assert contains_profanity("f u c k this") is True
    assert contains_profanity("sh1t") is True
    assert contains_profanity("Сука") is True


def test_normalize_category_allows_known_only() -> None:
    assert normalize_category("FUN") == "fun"
    assert normalize_category("nonsense") is None
    assert normalize_category(None) is None


# --- publish / unpublish --------------------------------------------------


async def test_publish_rejects_profane_label(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=940)
    w = await create_wheel(
        db, owner_id=owner, title="Dinner",
        segments=[SegmentDraft(label="fuck"), SegmentDraft(label="Pizza")],
    )
    await db.flush()
    fresh = await get_wheel(db, w.id)
    assert fresh is not None
    with pytest.raises(RoomServiceError) as exc:
        await publish_wheel(db, fresh, owner_id=owner, category="food")
    assert exc.value.code == "profanity"
    assert fresh.is_public is False


async def test_publish_then_unpublish(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=941)
    wid = await _published(db, owner)
    pub = await get_wheel(db, wid)
    assert pub is not None
    assert pub.is_public is True
    assert pub.category == "fun"
    assert pub.published_at is not None
    await unpublish_wheel(db, pub, owner_id=owner)
    await db.commit()
    assert pub.is_public is False
    assert await get_public_wheel(db, wid) is None


async def test_publish_requires_owner(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=942)
    other = await _make_user(db, tg_id=943)
    w = await create_wheel(db, owner_id=owner, title="Mine", segments=_drafts(2))
    await db.flush()
    fresh = await get_wheel(db, w.id)
    assert fresh is not None
    with pytest.raises(RoomServiceError) as exc:
        await publish_wheel(db, fresh, owner_id=other, category=None)
    assert exc.value.code == "not_owner"


# --- likes ----------------------------------------------------------------


async def test_like_toggles_and_counts(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=944)
    liker = await _make_user(db, tg_id=945)
    wid = await _published(db, owner)
    wheel = await get_public_wheel(db, wid)
    assert wheel is not None

    liked, count = await toggle_like(db, wheel, user_id=liker)
    await db.commit()
    assert liked is True
    assert count == 1
    # Idempotent per user: toggling again unlikes.
    liked2, count2 = await toggle_like(db, wheel, user_id=liker)
    await db.commit()
    assert liked2 is False
    assert count2 == 0


async def test_like_rejects_private_wheel(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=946)
    other = await _make_user(db, tg_id=947)
    w = await create_wheel(db, owner_id=owner, title="Secret", segments=_drafts(2))
    await db.commit()
    fresh = await get_wheel(db, w.id)
    assert fresh is not None
    with pytest.raises(RoomServiceError) as exc:
        await toggle_like(db, fresh, user_id=other)
    assert exc.value.code == "not_public"


# --- reports / auto-hide --------------------------------------------------


async def test_report_auto_hides_at_threshold(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=948)
    wid = await _published(db, owner)
    wheel = await get_public_wheel(db, wid)
    assert wheel is not None
    for i in range(REPORT_HIDE_THRESHOLD):
        reporter = await _make_user(db, tg_id=950 + i)
        count = await report_wheel(db, wheel, user_id=reporter, reason="bad")
        await db.commit()
    assert count == REPORT_HIDE_THRESHOLD
    assert wheel.is_hidden is True
    # Hidden wheels drop out of the public surface.
    assert await get_public_wheel(db, wid) is None


async def test_report_is_idempotent_per_user(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=960)
    reporter = await _make_user(db, tg_id=961)
    wid = await _published(db, owner)
    wheel = await get_public_wheel(db, wid)
    assert wheel is not None
    await report_wheel(db, wheel, user_id=reporter, reason=None)
    count = await report_wheel(db, wheel, user_id=reporter, reason=None)
    await db.commit()
    assert count == 1
    assert wheel.is_hidden is False


# --- trending + search ----------------------------------------------------


async def test_trending_sorts_by_signal_and_excludes_hidden(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=970)
    viewer = await _make_user(db, tg_id=971)
    low = await _published(db, owner, title="Low")
    high = await _published(db, owner, title="High")
    # Give `high` a like (worth 3) so it outranks `low`.
    high_wheel = await get_public_wheel(db, high)
    assert high_wheel is not None
    await toggle_like(db, high_wheel, user_id=viewer)
    await db.commit()

    wheels, liked = await list_trending(db, viewer_id=viewer, limit=10)
    titles = [w.title for w in wheels]
    assert titles.index("High") < titles.index("Low")
    assert high in liked and low not in liked

    # Hide `low` via reports → it disappears.
    low_wheel = await get_public_wheel(db, low)
    assert low_wheel is not None
    for i in range(REPORT_HIDE_THRESHOLD):
        r = await _make_user(db, tg_id=980 + i)
        await report_wheel(db, low_wheel, user_id=r, reason=None)
    await db.commit()
    wheels2, _ = await list_trending(db, viewer_id=viewer, limit=10)
    assert "Low" not in [w.title for w in wheels2]


async def test_trending_category_filter(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=990)
    viewer = await _make_user(db, tg_id=991)
    await _published(db, owner, title="FunOne")  # category fun
    wheels, _ = await list_trending(db, viewer_id=viewer, category="food", limit=10)
    assert wheels == []
    wheels2, _ = await list_trending(db, viewer_id=viewer, category="fun", limit=10)
    assert [w.title for w in wheels2] == ["FunOne"]


async def test_search_matches_title_substring(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=995)
    viewer = await _make_user(db, tg_id=996)
    await _published(db, owner, title="Pizza Night")
    hits, _ = await search_trending(db, viewer_id=viewer, query="pizza")
    assert [w.title for w in hits] == ["Pizza Night"]
    assert await search_trending(db, viewer_id=viewer, query="") == ([], set())


async def test_public_wheel_usable_by_non_owner(db: AsyncSession) -> None:
    owner = await _make_user(db, tg_id=997)
    guest = await _make_user(db, tg_id=998)
    wid = await _published(db, owner)
    wheel = await get_public_wheel(db, wid)
    assert wheel is not None
    room = await use_wheel(db, wheel, user_id=guest, game_mode="classic")
    await db.commit()
    assert room.host_id == guest
    fresh = await get_wheel(db, wid)
    assert fresh is not None
    assert fresh.use_count == 1
