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
    GAME_MODES,
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

MODE_DEFAULT_SPIN_POLICY: dict[str, str] = {
    "elimination": "host_only",
    # Punishment is a turn-based personal-bet race: the host goes first, then
    # each player spins on their turn. It MUST be turn_based — host_only would
    # let `trigger_spin`'s `user_can_spin` reject every non-host on their turn.
    "punishment": "turn_based",
    "chaos": "anyone",
    "rigged": "host_only",
}


def _derive_spin_policy(explicit: str | None, game_mode: str) -> str:
    """Pick the effective spin_policy given an optional explicit value.

    Explicit value (anything non-None) wins. Otherwise derive from mode:
    Elimination → host_only, Punishment → turn_based, Chaos → anyone,
    Rigged → host_only. Anything else (including classic) falls back to
    `anyone` — the party-game social default since 2026-05-26.
    """
    if explicit is not None:
        return explicit
    return MODE_DEFAULT_SPIN_POLICY.get(game_mode, "anyone")


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
    spin_policy: str | None = None,
    suggestion_policy: str = "off",
    game_mode: str = "classic",
    punishment_deck: str | None = None,
    spin_count: int = 1,
) -> Room:
    """Create a room + its first question + segments, marking host as Participant."""
    if game_mode not in GAME_MODES:
        raise RoomServiceError("bad_game_mode")
    if punishment_deck is not None and punishment_deck not in ("mild", "spicy", "chaos"):
        raise RoomServiceError("bad_punishment_deck")
    if spin_count not in (1, 3, 5, 7):
        raise RoomServiceError("bad_spin_count")
    effective_spin_policy = _derive_spin_policy(spin_policy, game_mode)
    if effective_spin_policy not in SPIN_POLICIES:
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
        game_mode=game_mode,
        spin_policy=effective_spin_policy,
        suggestion_policy=suggestion_policy,
        punishment_deck=(
            (punishment_deck or "mild") if game_mode == "punishment" else None
        ),
        # Punishment always requires unique picks (no per-room toggle); the
        # bet service falls back to allowing duplicates only when there are
        # more players than segments.
        punishment_unique_bets=(game_mode == "punishment"),
        spin_count=spin_count,
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
        "punishment_deck",
        "spin_count",
    }
    new_spin_policy = patch.get("spin_policy") if "spin_policy" in patch else None
    for key, value in patch.items():
        if key not in allowed:
            continue
        setattr(room, key, value)

    # Changing the attempts target resets any in-progress best-of-N round.
    if "spin_count" in patch:
        room.bon_attempts = 0
        room.bon_tally = None
        room.bon_winner_segment_id = None

    # Cursor lifecycle: only meaningful for turn_based.
    # - PATCH away from turn_based → clear cursor.
    # - PATCH to turn_based while status=active → treat as fresh
    #   lobby→active and seed cursor with host_id.
    # - PATCH to turn_based while status=lobby → leave cursor null;
    #   trigger_spin's first-spin path seeds it on lobby→active.
    # - game_mode PATCH alone does NOT touch the cursor (stale cursor
    #   on the same participant set is still valid).
    if new_spin_policy is not None:
        if new_spin_policy != "turn_based":
            room.current_turn_user_id = None
        elif room.status == "active" and room.current_turn_user_id is None:
            room.current_turn_user_id = room.host_id

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
