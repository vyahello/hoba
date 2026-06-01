"""Saved-wheel library service (spec §8 / F10).

A wheel's options are Segment rows (parent_type="wheel"). "Use as room"
copies them into a fresh room via `create_room` and bumps `use_count`.
Reuses `RoomServiceError` so the REST layer maps codes uniformly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.models.user import User
from hoba_api.models.wheel import Wheel
from hoba_api.models.wheel_social import WheelLike, WheelReport
from hoba_api.moderation import contains_profanity, normalize_category
from hoba_api.sanitize import sanitize_text
from hoba_api.services.rooms import (
    MAX_SEGMENTS,
    MIN_SEGMENTS,
    SEGMENT_LABEL_MAX_LENGTH,
    RoomServiceError,
    SegmentDraft,
    create_room,
)

WHEEL_TITLE_MAX_LENGTH = 120
REPORT_REASON_MAX_LENGTH = 200

# Distinct reporters that auto-hide a public wheel pending review (spec §14).
REPORT_HIDE_THRESHOLD = 3
# Trending score weights: a like is worth more intent than a use.
_LIKE_WEIGHT = 3


def _validate(title: str, segments: list[SegmentDraft]) -> str:
    """Sanitize + validate the title; returns the cleaned title."""
    clean_title = sanitize_text(title, max_length=WHEEL_TITLE_MAX_LENGTH)
    if not clean_title:
        raise RoomServiceError("empty_title")
    if not MIN_SEGMENTS <= len(segments) <= MAX_SEGMENTS:
        raise RoomServiceError("bad_segment_count")
    return clean_title


async def _add_segments(
    session: AsyncSession, wheel_id: int, segments: list[SegmentDraft],
) -> None:
    for i, draft in enumerate(segments):
        session.add(
            Segment(
                parent_id=wheel_id,
                parent_type="wheel",
                label=sanitize_text(draft.label, max_length=SEGMENT_LABEL_MAX_LENGTH),
                emoji=draft.emoji,
                color_seed=draft.color_seed,
                weight=draft.weight,
                position=i,
            ),
        )


async def create_wheel(
    session: AsyncSession, *, owner_id: int, title: str, segments: list[SegmentDraft],
) -> Wheel:
    clean_title = _validate(title, segments)
    wheel = Wheel(owner_id=owner_id, title=clean_title)
    session.add(wheel)
    await session.flush()
    await _add_segments(session, wheel.id, segments)
    await session.flush()
    return wheel


async def list_wheels(session: AsyncSession, owner_id: int) -> list[Wheel]:
    rows = await session.execute(
        select(Wheel).where(Wheel.owner_id == owner_id).order_by(Wheel.created_at.desc()),
    )
    return list(rows.scalars().all())


async def get_wheel(session: AsyncSession, wheel_id: int) -> Wheel | None:
    return (
        await session.execute(select(Wheel).where(Wheel.id == wheel_id))
    ).scalar_one_or_none()


async def update_wheel(
    session: AsyncSession,
    wheel: Wheel,
    *,
    owner_id: int,
    title: str,
    segments: list[SegmentDraft],
) -> Wheel:
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    clean_title = _validate(title, segments)
    # Replace the segment set wholesale.
    await session.execute(
        delete(Segment).where(
            Segment.parent_type == "wheel", Segment.parent_id == wheel.id,
        ),
    )
    wheel.title = clean_title
    await _add_segments(session, wheel.id, segments)
    await session.flush()
    return wheel


async def delete_wheel(session: AsyncSession, wheel: Wheel, *, owner_id: int) -> None:
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    await session.delete(wheel)
    await session.flush()


def _can_use(wheel: Wheel, user_id: int) -> bool:
    """Owners may use their own wheels; anyone may use a visible public one."""
    return wheel.owner_id == user_id or (wheel.is_public and not wheel.is_hidden)


async def use_wheel(
    session: AsyncSession,
    wheel: Wheel,
    *,
    user_id: int,
    game_mode: str = "classic",
    punishment_deck: str | None = None,
    spin_count: int = 1,
) -> Room:
    """Instantiate the wheel as a fresh room (caller becomes host) + bump uses."""
    if not _can_use(wheel, user_id):
        raise RoomServiceError("not_owner")
    drafts = [
        SegmentDraft(
            label=s.label, emoji=s.emoji, color_seed=s.color_seed, weight=s.weight,
        )
        for s in wheel.segments
    ]
    room = await create_room(
        session,
        host_id=user_id,
        question_text=wheel.title,
        segments=drafts,
        game_mode=game_mode,
        punishment_deck=punishment_deck,
        spin_count=spin_count,
    )
    wheel.use_count += 1
    await session.flush()
    return room


# --- Phase 10: public wheels, trending, moderation -----------------------


async def publish_wheel(
    session: AsyncSession, wheel: Wheel, *, owner_id: int, category: str | None,
) -> Wheel:
    """Make a wheel public (auto-approve on profanity pass; spec §14)."""
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    labels = [s.label for s in wheel.segments]
    if contains_profanity(wheel.title, *labels):
        raise RoomServiceError("profanity")
    wheel.is_public = True
    wheel.is_hidden = False
    wheel.category = normalize_category(category)
    wheel.published_at = datetime.now(UTC)
    await session.flush()
    return wheel


async def unpublish_wheel(
    session: AsyncSession, wheel: Wheel, *, owner_id: int,
) -> Wheel:
    """Take a wheel private again (owner only)."""
    if wheel.owner_id != owner_id:
        raise RoomServiceError("not_owner")
    wheel.is_public = False
    wheel.published_at = None
    await session.flush()
    return wheel


async def _recount_likes(session: AsyncSession, wheel: Wheel) -> None:
    wheel.like_count = (
        await session.execute(
            select(func.count())
            .select_from(WheelLike)
            .where(WheelLike.wheel_id == wheel.id),
        )
    ).scalar_one()


async def toggle_like(
    session: AsyncSession, wheel: Wheel, *, user_id: int,
) -> tuple[bool, int]:
    """Like/unlike a visible public wheel. Returns (liked_now, like_count)."""
    if not (wheel.is_public and not wheel.is_hidden):
        raise RoomServiceError("not_public")
    existing = (
        await session.execute(
            select(WheelLike).where(
                WheelLike.wheel_id == wheel.id, WheelLike.user_id == user_id,
            ),
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(WheelLike(wheel_id=wheel.id, user_id=user_id))
        liked = True
    else:
        await session.delete(existing)
        liked = False
    await session.flush()
    await _recount_likes(session, wheel)
    await session.flush()
    return liked, wheel.like_count


async def report_wheel(
    session: AsyncSession, wheel: Wheel, *, user_id: int, reason: str | None,
) -> int:
    """Record a report (idempotent per user); auto-hide at the threshold.

    Returns the distinct-reporter count after recording.
    """
    existing = (
        await session.execute(
            select(WheelReport).where(
                WheelReport.wheel_id == wheel.id, WheelReport.user_id == user_id,
            ),
        )
    ).scalar_one_or_none()
    if existing is None:
        clean_reason = (
            sanitize_text(reason, max_length=REPORT_REASON_MAX_LENGTH) or None
            if reason is not None
            else None
        )
        session.add(
            WheelReport(wheel_id=wheel.id, user_id=user_id, reason=clean_reason),
        )
        await session.flush()
    wheel.report_count = (
        await session.execute(
            select(func.count())
            .select_from(WheelReport)
            .where(WheelReport.wheel_id == wheel.id),
        )
    ).scalar_one()
    if wheel.report_count >= REPORT_HIDE_THRESHOLD:
        wheel.is_hidden = True
    await session.flush()
    return wheel.report_count


# --- Stage G+: admin moderation review queue (spec §14 manual queue) ------


@dataclass(frozen=True, slots=True)
class ReportRow:
    """One report against a wheel, with the reporter's display name."""

    reporter_id: int
    reporter_name: str
    reason: str | None
    reported_at: datetime


async def list_reported_wheels(
    session: AsyncSession,
) -> list[tuple[Wheel, list[ReportRow]]]:
    """All wheels that have at least one report or are hidden, newest-risk first.

    Hidden wheels surface above merely-reported ones; within each, the
    most-reported come first. Each wheel carries its individual reports
    (reporter name + reason + time) for the admin to judge.
    """
    wheels = list(
        (
            await session.execute(
                select(Wheel)
                .where((Wheel.report_count > 0) | Wheel.is_hidden.is_(True))
                .order_by(
                    Wheel.is_hidden.desc(),
                    Wheel.report_count.desc(),
                    Wheel.id.desc(),
                ),
            )
        )
        .scalars()
        .all(),
    )
    if not wheels:
        return []
    wheel_ids = [w.id for w in wheels]
    rows = (
        await session.execute(
            select(WheelReport, User)
            .join(User, User.id == WheelReport.user_id)
            .where(WheelReport.wheel_id.in_(wheel_ids))
            .order_by(WheelReport.created_at.desc()),
        )
    ).all()
    by_wheel: dict[int, list[ReportRow]] = {wid: [] for wid in wheel_ids}
    for report, reporter in rows:
        by_wheel[report.wheel_id].append(
            ReportRow(
                reporter_id=reporter.id,
                reporter_name=reporter.first_name,
                reason=report.reason,
                reported_at=report.created_at,
            ),
        )
    return [(w, by_wheel[w.id]) for w in wheels]


async def unhide_wheel(session: AsyncSession, wheel: Wheel) -> Wheel:
    """Admin: dismiss the reports on a wheel and make it visible again.

    Clears `is_hidden`, deletes the report rows, and resets `report_count`
    to 0 — a clean slate, so the next report starts the count fresh rather
    than instantly re-tripping the auto-hide threshold.
    """
    await session.execute(
        delete(WheelReport).where(WheelReport.wheel_id == wheel.id),
    )
    wheel.is_hidden = False
    wheel.report_count = 0
    await session.flush()
    return wheel


async def hide_wheel(session: AsyncSession, wheel: Wheel) -> Wheel:
    """Admin: take a wheel down regardless of the report count (manual override)."""
    wheel.is_hidden = True
    await session.flush()
    return wheel


async def get_public_wheel(session: AsyncSession, wheel_id: int) -> Wheel | None:
    """Fetch a wheel only if it's currently visible to the public."""
    wheel = await get_wheel(session, wheel_id)
    if wheel is None or not wheel.is_public or wheel.is_hidden:
        return None
    return wheel


def _trending_score() -> ColumnElement[int]:
    # Documented signal (docs/architecture.md): likes weigh 3×, uses 1×.
    return Wheel.like_count * _LIKE_WEIGHT + Wheel.use_count


async def _liked_ids(
    session: AsyncSession, wheel_ids: list[int], viewer_id: int,
) -> set[int]:
    if not wheel_ids:
        return set()
    rows = await session.execute(
        select(WheelLike.wheel_id).where(
            WheelLike.user_id == viewer_id, WheelLike.wheel_id.in_(wheel_ids),
        ),
    )
    return set(rows.scalars().all())


async def list_trending(
    session: AsyncSession,
    *,
    viewer_id: int,
    category: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[Wheel], set[int]]:
    """Visible public wheels by trending score; plus the viewer's liked ids."""
    stmt = select(Wheel).where(Wheel.is_public.is_(True), Wheel.is_hidden.is_(False))
    normalized = normalize_category(category)
    if normalized is not None:
        stmt = stmt.where(Wheel.category == normalized)
    stmt = (
        stmt.order_by(_trending_score().desc(), Wheel.published_at.desc(), Wheel.id.desc())
        .limit(limit)
        .offset(offset)
    )
    wheels = list((await session.execute(stmt)).scalars().all())
    liked = await _liked_ids(session, [w.id for w in wheels], viewer_id)
    return wheels, liked


async def search_trending(
    session: AsyncSession, *, viewer_id: int, query: str, limit: int = 20,
) -> tuple[list[Wheel], set[int]]:
    """Title search over visible public wheels (case-insensitive substring)."""
    term = query.strip()
    if not term:
        return [], set()
    pattern = f"%{term.lower()}%"
    stmt = (
        select(Wheel)
        .where(
            Wheel.is_public.is_(True),
            Wheel.is_hidden.is_(False),
            func.lower(Wheel.title).like(pattern),
        )
        .order_by(_trending_score().desc(), Wheel.id.desc())
        .limit(limit)
    )
    wheels = list((await session.execute(stmt)).scalars().all())
    liked = await _liked_ids(session, [w.id for w in wheels], viewer_id)
    return wheels, liked
