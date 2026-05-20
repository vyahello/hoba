"""Room service — create, fetch, update, close."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import (
    SPIN_POLICIES,
    SUGGESTION_POLICIES,
    Room,
)
from hoba_api.models.segment import Segment

# Code alphabet excludes confusable characters (0/O, 1/I, etc.).
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
MAX_CODE_GENERATION_RETRIES = 8
MIN_SEGMENTS = 2
MAX_SEGMENTS = 12


@dataclass(frozen=True, slots=True)
class SegmentDraft:
    label: str
    emoji: str | None = None
    color_seed: int = 0
    weight: int = 1


class RoomServiceError(Exception):
    """Domain errors from the room service — `code` is machine-readable."""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


def generate_room_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


async def _find_unused_code(session: AsyncSession) -> str:
    """Generate a code that's not currently held by a non-closed room."""
    for _ in range(MAX_CODE_GENERATION_RETRIES):
        code = generate_room_code()
        existing = (
            await session.execute(
                select(Room.id).where(Room.code == code, Room.status != "closed"),
            )
        ).scalar_one_or_none()
        if existing is None:
            return code
    raise RoomServiceError("code_collision", "failed to find a free room code")


async def create_room(
    session: AsyncSession,
    *,
    host_id: int,
    question_text: str,
    segments: list[SegmentDraft],
    title: str | None = None,
    spin_policy: str = "host_only",
    suggestion_policy: str = "off",
) -> Room:
    """Create a room + its first question + segments, marking host as Participant."""
    if spin_policy not in SPIN_POLICIES:
        raise RoomServiceError("bad_spin_policy")
    if suggestion_policy not in SUGGESTION_POLICIES:
        raise RoomServiceError("bad_suggestion_policy")
    if not MIN_SEGMENTS <= len(segments) <= MAX_SEGMENTS:
        raise RoomServiceError("bad_segment_count")
    if not question_text.strip():
        raise RoomServiceError("empty_question")

    code = await _find_unused_code(session)
    room = Room(
        code=code,
        host_id=host_id,
        title=title,
        status="lobby",
        spin_policy=spin_policy,
        suggestion_policy=suggestion_policy,
    )
    session.add(room)
    await session.flush()

    session.add(
        Participant(room_id=room.id, user_id=host_id, role="host"),
    )

    question = Question(
        room_id=room.id,
        text=question_text.strip(),
        is_active=True,
        created_by=host_id,
        approved=True,
    )
    session.add(question)
    await session.flush()

    for i, draft in enumerate(segments):
        session.add(
            Segment(
                parent_id=question.id,
                parent_type="question",
                label=draft.label.strip(),
                emoji=draft.emoji,
                color_seed=draft.color_seed,
                weight=draft.weight,
                position=i,
            ),
        )
    await session.flush()
    return room


async def get_room_by_code(session: AsyncSession, code: str) -> Room | None:
    return (
        await session.execute(select(Room).where(Room.code == code.upper()))
    ).scalar_one_or_none()


async def update_room(
    session: AsyncSession,
    room: Room,
    user_id: int,
    patch: dict[str, object],
) -> Room:
    if room.host_id != user_id:
        raise RoomServiceError("not_host")
    if room.status == "closed":
        raise RoomServiceError("room_closed")

    allowed = {
        "title",
        "spin_policy",
        "suggestion_policy",
        "is_locked",
        "game_mode",
    }
    for key, value in patch.items():
        if key not in allowed:
            continue
        setattr(room, key, value)
    return room


async def close_room(
    session: AsyncSession, room: Room, user_id: int,
) -> Room:
    if room.host_id != user_id:
        raise RoomServiceError("not_host")
    if room.status == "closed":
        return room
    room.status = "closed"
    room.closed_at = datetime.now(UTC)
    return room
