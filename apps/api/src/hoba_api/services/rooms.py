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
from hoba_api.sanitize import sanitize_text

# Code alphabet excludes confusable characters (0/O, 1/I, etc.).
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
MAX_CODE_GENERATION_RETRIES = 8
MIN_SEGMENTS = 2
MAX_SEGMENTS = 12
# Defensive truncation caps for sanitized user text (schema bounds are
# tighter; these are the last-resort guards on the stored value).
QUESTION_MAX_LENGTH = 200
SEGMENT_LABEL_MAX_LENGTH = 100
ROOM_TITLE_MAX_LENGTH = 80

MODE_DEFAULT_SPIN_POLICY: dict[str, str] = {
    # Classic defaults to host-controlled ("Лише я") — the spin-policy gear
    # offers only host_only / turn_based (no "anyone"), so the default must be
    # one of those.
    "classic": "host_only",
    "elimination": "host_only",
    # Punishment is a turn-based personal-bet race: the host goes first, then
    # each player spins on their turn. It MUST be turn_based — host_only would
    # let `trigger_spin`'s `user_can_spin` reject every non-host on their turn.
    "punishment": "turn_based",
    # Chaos is host-driven / take-turns only — "anyone can spin" is removed
    # from its settings, and turn_based is the party default.
    "chaos": "turn_based",
    "rigged": "host_only",
}


def _derive_spin_policy(explicit: str | None, game_mode: str) -> str:
    """Pick the effective spin_policy given an optional explicit value.

    Explicit value (anything non-None) wins. Otherwise derive from mode:
    Classic → host_only, Elimination → host_only, Punishment → turn_based,
    Chaos → turn_based, Rigged → host_only. Anything unknown falls back to
    `anyone`.
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
    is_anonymous: bool = False,
    requires_approval: bool = True,
) -> Room:
    """Create a room + its first question + segments, marking host as Participant.

    New rooms **require host approval for joiners by default** (the host can
    turn it off in room settings); the host themselves auto-approves.
    """
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
    question_text = sanitize_text(question_text, max_length=QUESTION_MAX_LENGTH)
    if not question_text:
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
        # Punishment + Chaos are personal-bet races: unique picks (with a
        # fallback to duplicates only when players outnumber segments). No
        # per-room toggle.
        punishment_unique_bets=(game_mode in ("punishment", "chaos")),
        spin_count=spin_count,
        is_anonymous=is_anonymous,
        requires_approval=requires_approval,
    )
    session.add(room)
    await session.flush()

    session.add(
        Participant(room_id=room.id, user_id=host_id, role="host"),
    )

    question = Question(
        room_id=room.id,
        text=question_text,
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
                label=sanitize_text(draft.label, max_length=SEGMENT_LABEL_MAX_LENGTH),
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


def _reset_round_state(room: Room) -> None:
    """Clear per-round / per-game progress (used on a mid-room mode change).

    The turn cursor is deliberately left alone — the turn order among the
    same present players is still valid, and the betting/start flow re-seeds
    it for the race modes (mirrors `test_update_room_game_mode_does_not_touch_cursor`).
    """
    room.bon_attempts = 0
    room.bon_tally = None
    room.bon_winner_segment_id = None
    room.bon_round_start_spin_id = None
    room.punishment_predictions = None
    room.punishment_match_counts = None
    room.punishment_winner_user_id = None
    room.punishment_last_outcome = None
    room.punishment_done_counts = None
    room.punishment_cards = None


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
        "is_anonymous",
        "requires_approval",
        "game_mode",
        "punishment_deck",
        "spin_count",
    }
    new_spin_policy = patch.get("spin_policy") if "spin_policy" in patch else None
    old_game_mode = room.game_mode
    for key, value in patch.items():
        if key not in allowed:
            continue
        if key == "title" and isinstance(value, str):
            value = sanitize_text(value, max_length=ROOM_TITLE_MAX_LENGTH) or None
        setattr(room, key, value)

    # Mid-room mode change (spec §F11): start the new mode from a clean slate
    # so stale bet/round state from the previous mode can't corrupt it.
    if "game_mode" in patch and room.game_mode != old_game_mode:
        room.punishment_unique_bets = room.game_mode in ("punishment", "chaos")
        room.punishment_deck = (
            (room.punishment_deck or "mild") if room.game_mode == "punishment" else None
        )
        _reset_round_state(room)

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
