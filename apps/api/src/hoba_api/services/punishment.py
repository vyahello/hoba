"""Punishment v3 — turn-based personal-bet race.

Design: docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md
(v3 supersedes the v2 prediction-wager described there; see
docs/game-modes.md for the current mechanic).

Each player picks a fixed BET (a segment) before the game starts. The game
cannot begin until every present player has bet. Then players spin in turn:
- the wheel lands on the spinner's bet  -> "lucky": their match count +1, no
  dare, turn advances; first to N (= room.spin_count) wins.
- the wheel lands on anything else      -> "punish": a dare card is dealt to
  the spinner; the turn does NOT advance until they resolve it by either
  performing it ("done") or refusing ("refuse", which costs -1 of their match
  count; refusal is only allowed when the count is > 0).

Every outcome (lucky or punish) is broadcast to ALL players (anti-cheat).

State lives on the Room row (reused + new columns):
- punishment_predictions {uid(str): segment_id} -> the bets
- spin_count -> N (matches needed to win)
- punishment_match_counts {uid(str): int}
- punishment_winner_user_id
- punishment_last_outcome {spinner_id, result_segment_id, kind, card, resolved}
- punishment_done_count -> cumulative dares actually performed (a fun stat)

JSON columns track identity, not in-place mutation, so every mutation
reassigns a fresh dict.
"""

from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.punishment_decks import CARDS_PER_DECK, deck_cards
from hoba_api.redis_client import presence_user_ids
from hoba_api.services.rooms import RoomServiceError


async def _active_segment_ids(session: AsyncSession, room: Room) -> set[int]:
    """Segment ids of the room's active question (valid bet targets)."""
    question = (
        await session.execute(
            select(Question).where(
                Question.room_id == room.id, Question.is_active.is_(True),
            ),
        )
    ).scalar_one_or_none()
    if question is None:
        return set()
    rows = (
        await session.execute(
            select(Segment.id).where(
                Segment.parent_id == question.id,
                Segment.parent_type == "question",
            ),
        )
    ).scalars().all()
    return set(rows)


async def place_bet(
    session: AsyncSession, room: Room, user_id: int, segment_id: int,
) -> None:
    """Record (or change) `user_id`'s bet. Allowed only before the game starts.

    Raises `game_started` once spinning has begun (room left lobby), and
    `invalid_segment` if `segment_id` is not on the active question's wheel.
    """
    if room.status != "lobby" or room.punishment_winner_user_id is not None:
        raise RoomServiceError("game_started")
    if segment_id not in await _active_segment_ids(session, room):
        raise RoomServiceError("invalid_segment")
    bets = dict(room.punishment_predictions or {})
    bets[str(user_id)] = segment_id
    room.punishment_predictions = bets
    await session.commit()


async def drop_bet(session: AsyncSession, room: Room, user_id: int) -> None:
    """Remove `user_id`'s bet if present (used on leave during betting)."""
    bets = dict(room.punishment_predictions or {})
    if str(user_id) not in bets:
        return
    del bets[str(user_id)]
    room.punishment_predictions = bets or None
    await session.commit()


def all_present_bet(
    bets: dict[str, int] | None, present: set[int],
) -> bool:
    """True iff `present` is non-empty and every present id has placed a bet."""
    if not present:
        return False
    locked = bets or {}
    return all(str(uid) in locked for uid in present)


def waiting_on(
    bets: dict[str, int] | None, present: set[int],
) -> list[int]:
    """Sorted present ids that have not yet placed a bet."""
    locked = bets or {}
    return sorted(uid for uid in present if str(uid) not in locked)


async def _advance_turn(session: AsyncSession, room: Room) -> int | None:
    """Move the turn cursor to the next online player who has a bet.

    Walks participants by join order, skipping anyone offline or without a
    bet. Wraps around. Mutates `room.current_turn_user_id`; caller commits.
    """
    rows: list[int] = list(
        (
            await session.execute(
                select(Participant.user_id)
                .where(Participant.room_id == room.id)
                .order_by(Participant.joined_at, Participant.user_id),
            )
        ).scalars().all(),
    )
    bets = room.punishment_predictions or {}
    online = await presence_user_ids(room.id)
    eligible = [u for u in rows if str(u) in bets and u in online]
    if not eligible:
        room.current_turn_user_id = None
        return None
    cur = room.current_turn_user_id
    nxt = (
        eligible[(eligible.index(cur) + 1) % len(eligible)]
        if cur in eligible
        else eligible[0]
    )
    room.current_turn_user_id = nxt
    return nxt


async def start_game(session: AsyncSession, room: Room) -> None:
    """Seed the turn cursor to the first eligible bettor at game start."""
    if room.current_turn_user_id is None:
        await _advance_turn(session, room)


async def resolve_turn(
    session: AsyncSession,
    room: Room,
    spinner_id: int,
    result_segment_id: int,
    host_lang: str,
) -> dict[str, object]:
    """Resolve one spin for the player whose turn it was.

    Lucky (bet hit) -> +1 match, advance turn, maybe set winner.
    Punish (bet missed) -> deal a dare card, DO NOT advance (blocked until the
    punished player resolves it). Returns the broadcast `last_outcome`.
    """
    bets = room.punishment_predictions or {}
    counts = dict(room.punishment_match_counts or {})
    bet = bets.get(str(spinner_id))
    needed = room.spin_count if room.spin_count > 1 else 3

    if bet is not None and bet == result_segment_id:
        counts[str(spinner_id)] = counts.get(str(spinner_id), 0) + 1
        room.punishment_match_counts = counts
        outcome: dict[str, object] = {
            "spinner_id": spinner_id,
            "result_segment_id": result_segment_id,
            "kind": "lucky",
            "card": None,
            "resolved": True,
        }
        if counts[str(spinner_id)] >= needed:
            room.punishment_winner_user_id = spinner_id
        else:
            await _advance_turn(session, room)
    else:
        deck = room.punishment_deck or "mild"
        lang = host_lang or "en"
        idx = secrets.randbelow(CARDS_PER_DECK)
        card = {
            "text": deck_cards(deck, lang)[idx],
            "deck": deck,
            "card_index": idx,
        }
        outcome = {
            "spinner_id": spinner_id,
            "result_segment_id": result_segment_id,
            "kind": "punish",
            "card": card,
            "resolved": False,
        }

    room.punishment_last_outcome = outcome
    await session.commit()
    return outcome


async def resolve_punishment(
    session: AsyncSession, room: Room, user_id: int, *, refuse: bool,
) -> bool:
    """The punished player performs ("done") or refuses ("refuse") their dare.

    `refuse=True` costs -1 of their match count and is only allowed when the
    count is > 0. Either way the turn then advances. Returns False (no-op) if
    there is no pending punishment for this user.
    """
    outcome = room.punishment_last_outcome
    if (
        outcome is None
        or outcome.get("kind") != "punish"
        or outcome.get("resolved")
        or outcome.get("spinner_id") != user_id
    ):
        return False

    counts = dict(room.punishment_match_counts or {})
    if refuse:
        if counts.get(str(user_id), 0) <= 0:
            raise RoomServiceError("cannot_refuse")
        counts[str(user_id)] = counts[str(user_id)] - 1
        room.punishment_match_counts = counts
    else:
        room.punishment_done_count += 1

    resolved = dict(outcome)
    resolved["resolved"] = True
    room.punishment_last_outcome = resolved
    await _advance_turn(session, room)
    await session.commit()
    return True


async def reset_game(session: AsyncSession, room: Room) -> None:
    """Start a fresh game: clear bets, counts, winner, outcome, turn cursor.

    `punishment_done_count` (cumulative dares performed) is preserved as a
    session-long stat. Room returns to lobby so players can re-bet.
    """
    room.punishment_predictions = None
    room.punishment_match_counts = None
    room.punishment_winner_user_id = None
    room.punishment_last_outcome = None
    room.current_turn_user_id = None
    room.status = "lobby"
    await session.commit()
