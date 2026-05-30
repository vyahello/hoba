"""Prediction-wager logic for Punishment v2.

Design: docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md

Each round every present player secretly predicts which segment the wheel
will land on; the host spins; each player whose guess was WRONG draws their
own dare card; correct guessers are safe; if everyone guessed right nobody
draws ("everyone escaped"). This module owns the prediction/resolve/done
state transitions on the Room row — it does NOT touch the spin pipeline,
WS handlers, or serialization (those live elsewhere).

JSON columns track identity, not in-place mutation, so every mutation
reassigns a fresh dict.
"""

from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.punishment_decks import CARDS_PER_DECK, deck_cards
from hoba_api.services.rooms import RoomServiceError


async def _active_segment_ids(session: AsyncSession, room: Room) -> set[int]:
    """Segment ids of the room's active question (Punishment never eliminates,
    so every segment is a valid prediction target)."""
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


async def lock_prediction(
    session: AsyncSession, room: Room, user_id: int, segment_id: int,
) -> None:
    """Record (or overwrite) `user_id`'s prediction for the current round.

    Raises `round_resolved` if the round is already resolved (cards dealt),
    `invalid_segment` if `segment_id` is not on the active question's wheel.
    """
    if room.punishment_cards is not None:
        raise RoomServiceError("round_resolved")
    if segment_id not in await _active_segment_ids(session, room):
        raise RoomServiceError("invalid_segment")
    preds = dict(room.punishment_predictions or {})
    preds[str(user_id)] = segment_id
    room.punishment_predictions = preds
    await session.commit()


async def drop_prediction(
    session: AsyncSession, room: Room, user_id: int,
) -> None:
    """Remove `user_id`'s prediction if present. No-op when absent."""
    preds = dict(room.punishment_predictions or {})
    if str(user_id) not in preds:
        return
    del preds[str(user_id)]
    room.punishment_predictions = preds or None
    await session.commit()


def all_present_locked(
    predictions: dict[str, object] | None, present: set[int],
) -> bool:
    """True iff `present` is non-empty and every present id has locked."""
    if not present:
        return False
    locked = predictions or {}
    return all(str(uid) in locked for uid in present)


def waiting_on(
    predictions: dict[str, object] | None, present: set[int],
) -> list[int]:
    """Sorted present ids that have not yet locked a prediction."""
    locked = predictions or {}
    return sorted(uid for uid in present if str(uid) not in locked)


async def resolve_predictions(
    session: AsyncSession,
    room: Room,
    result_segment_id: int,
    host_lang: str,
) -> dict[str, dict[str, object]]:
    """Resolve the round against the landed segment.

    Losers (predicted != result) each draw a DISTINCT card index without
    replacement within this resolve; if losers exceed `CARDS_PER_DECK` the
    pool reshuffles over indices not already used in THIS resolve. Returns
    (and persists) the cards map `{user_id(str): {text, deck, card_index,
    done}}` — `{}` when nobody lost.
    """
    predictions = room.punishment_predictions or {}
    losers = [uid for uid, seg in predictions.items() if seg != result_segment_id]
    deck = room.punishment_deck or "mild"
    lang = host_lang or "en"
    texts = deck_cards(deck, lang)

    pool = list(range(CARDS_PER_DECK))
    secrets.SystemRandom().shuffle(pool)
    used: set[int] = set()
    cards: dict[str, dict[str, object]] = {}
    for uid in losers:
        if not pool:
            pool = [i for i in range(CARDS_PER_DECK) if i not in used]
            secrets.SystemRandom().shuffle(pool)
        idx = pool.pop()
        used.add(idx)
        cards[uid] = {
            "text": texts[idx],
            "deck": deck,
            "card_index": idx,
            "done": False,
        }

    room.punishment_cards = dict(cards)
    room.punishment_result_segment_id = result_segment_id
    await session.commit()
    return cards


async def mark_card_done(
    session: AsyncSession, room: Room, user_id: int,
) -> bool:
    """Mark `user_id`'s card done + bump the persistent tally.

    Returns False (no commit) when there is no card for the user or it is
    already done.
    """
    cards = room.punishment_cards
    if cards is None:
        return False
    entry = cards.get(str(user_id))
    if not isinstance(entry, dict) or entry.get("done"):
        return False
    new_cards = {k: dict(v) if isinstance(v, dict) else v for k, v in cards.items()}
    done_entry = new_cards[str(user_id)]
    if isinstance(done_entry, dict):
        done_entry["done"] = True
    room.punishment_cards = new_cards
    room.punishment_done_count += 1
    await session.commit()
    return True


async def reset_round(session: AsyncSession, room: Room) -> None:
    """Clear the round's prediction/card state for a fresh round.

    `punishment_done_count` is intentionally preserved — the tally is
    cumulative across rounds.
    """
    room.punishment_predictions = None
    room.punishment_cards = None
    room.punishment_result_segment_id = None
    await session.commit()
