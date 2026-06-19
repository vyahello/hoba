"""Punishment v3 — turn-based personal-bet race.

Each player picks a fixed BET (a segment) before the game starts. The game
cannot begin until every present player has bet. Then players spin in turn:
- the wheel lands on the spinner's bet  -> "lucky": their match count +1, no
  dare, turn advances; first to N (= room.spin_count) wins.
- the wheel lands on anything else      -> "punish": a dare card is dealt to
  the spinner; the turn does NOT advance until they resolve it.

Resolution flow for a punish:
  1. Spinner presses "Done" (refuse=False) → pending_approval=True; a random
     OTHER present player is chosen as approver; turn stays blocked.
  2. Approver presses "Approve" → resolved=True; done_count incremented; turn
     advances.
  Alternatively: spinner presses "Refuse" (refuse=True) → -1 match count;
  resolved immediately (no approval step); turn advances.

State lives on the Room row:
- punishment_predictions {uid(str): segment_id} -> the bets
- spin_count -> N (matches needed to win; 1 = first lucky spin wins)
- punishment_match_counts {uid(str): int}
- punishment_winner_user_id
- punishment_last_outcome {spinner_id, result_segment_id, kind, card,
                            resolved, pending_approval, approver_user_id}
- punishment_done_count -> cumulative dares approved (global)
- punishment_done_counts {uid(str): int} -> per-player approved dares
- punishment_unique_bets -> bool, each player must pick a unique segment
"""

from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.bot import BOT_USER_ID
from hoba_api.models.participant import Participant
from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.punishment_decks import deck_cards
from hoba_api.redis_client import (
    presence_user_ids,
    punishment_mark_card,
    punishment_reset_cards,
    punishment_used_card_indices,
)
from hoba_api.services.rooms import RoomServiceError


async def _draw_card_index(room_id: int, deck: str, total: int) -> int:
    """Pick a dare-card index WITHOUT replacement: skip indices already dealt
    in this room+deck until the whole deck has been shown, then start a fresh
    pass. This is the no-repeat-until-exhausted draw."""
    used = await punishment_used_card_indices(room_id, deck)
    remaining = [i for i in range(total) if i not in used]
    if not remaining:
        await punishment_reset_cards(room_id, deck)
        remaining = list(range(total))
    idx = remaining[secrets.randbelow(len(remaining))]
    await punishment_mark_card(room_id, deck, idx)
    return idx


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

    Raises `game_started` once spinning has begun, `invalid_segment` if the
    segment isn't on the wheel, and `segment_taken` when unique-bets mode is
    on and the segment is held by another player AND a free segment still
    remains. When every other segment is already taken (more players than
    segments) the duplicate is allowed so betting can never deadlock.
    """
    if room.status != "lobby" or room.punishment_winner_user_id is not None:
        raise RoomServiceError("game_started")
    active = await _active_segment_ids(session, room)
    if segment_id not in active:
        raise RoomServiceError("invalid_segment")
    bets = dict(room.punishment_predictions or {})
    if room.punishment_unique_bets:
        taken = {sid for uid, sid in bets.items() if uid != str(user_id)}
        if segment_id in taken and (active - taken):
            raise RoomServiceError("segment_taken")
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
    # The solo-play bot isn't a Participant or a presence entry — it's always
    # "online" and takes its turn after the humans (join order, then bot).
    if str(BOT_USER_ID) in bets:
        eligible.append(BOT_USER_ID)
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


async def maybe_add_bot(session: AsyncSession, room: Room) -> bool:
    """Add a solo-play bot opponent iff the host is starting the race alone.

    "Alone" = exactly one human present and no other human has bet. The bot
    locks a unique free segment (so the host always has a real opponent in
    Punishment/Chaos solo). Returns True if a bot was added.
    """
    if room.game_mode not in ("punishment", "chaos"):
        return False
    bets = dict(room.punishment_predictions or {})
    if str(BOT_USER_ID) in bets:
        return False
    present = await presence_user_ids(room.id)
    human_bettors = [u for u in bets if int(u) != BOT_USER_ID]
    if len(present) > 1 or len(human_bettors) > 1:
        return False
    active = await _active_segment_ids(session, room)
    taken = set(bets.values())
    free = sorted(active - taken) or sorted(active)
    if not free:
        return False
    bets[str(BOT_USER_ID)] = free[secrets.randbelow(len(free))]
    room.punishment_predictions = bets
    return True


async def start_game(session: AsyncSession, room: Room) -> None:
    """Seed the turn cursor to host (if they have a bet), else first eligible."""
    await maybe_add_bot(session, room)
    if room.current_turn_user_id is None:
        bets = room.punishment_predictions or {}
        online = await presence_user_ids(room.id)
        if str(room.host_id) in bets and room.host_id in online:
            room.current_turn_user_id = room.host_id
        else:
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
    Punish (bet missed) -> deal a dare card, DO NOT advance (blocked until
    the punished player resolves it). Returns the broadcast `last_outcome`.
    """
    bets = room.punishment_predictions or {}
    counts = dict(room.punishment_match_counts or {})
    bet = bets.get(str(spinner_id))
    needed = room.spin_count

    if bet is not None and bet == result_segment_id:
        counts[str(spinner_id)] = counts.get(str(spinner_id), 0) + 1
        room.punishment_match_counts = counts
        outcome: dict[str, object] = {
            "spinner_id": spinner_id,
            "result_segment_id": result_segment_id,
            "kind": "lucky",
            "card": None,
            "resolved": True,
            "pending_approval": False,
            "approver_user_id": None,
        }
        if counts[str(spinner_id)] >= needed:
            room.punishment_winner_user_id = spinner_id
        else:
            await _advance_turn(session, room)
    elif room.game_mode == "chaos" or spinner_id == BOT_USER_ID:
        # No dare here: Chaos has none, and the bot can't perform one — a miss
        # is a no-op (confetti on the client) and the turn just advances.
        outcome = {
            "spinner_id": spinner_id,
            "result_segment_id": result_segment_id,
            "kind": "miss",
            "card": None,
            "resolved": True,
            "pending_approval": False,
            "approver_user_id": None,
        }
        await _advance_turn(session, room)
    else:
        deck = room.punishment_deck or "mild"
        lang = host_lang or "en"
        cards = deck_cards(deck, lang)
        idx = await _draw_card_index(room.id, deck, len(cards))
        card = {
            "text": cards[idx],
            "deck": deck,
            "card_index": idx,
        }
        outcome = {
            "spinner_id": spinner_id,
            "result_segment_id": result_segment_id,
            "kind": "punish",
            "card": card,
            "resolved": False,
            "pending_approval": False,
            "approver_user_id": None,
        }

    room.punishment_last_outcome = outcome
    await session.commit()
    return outcome


async def resolve_punishment(
    session: AsyncSession, room: Room, user_id: int, *, refuse: bool,
) -> bool:
    """The punished player performs ("done") or refuses ("refuse") their dare.

    `refuse=True` costs -1 match count and resolves immediately (no approval).
    `refuse=False` (done) sets pending_approval=True and picks a random other
    present player as the approver — turn stays blocked until they approve.

    Returns False (no-op) if there is no pending punishment for this user.
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
        resolved = dict(outcome)
        resolved["resolved"] = True
        resolved["pending_approval"] = False
        resolved["approver_user_id"] = None
        room.punishment_last_outcome = resolved
        await _advance_turn(session, room)
    else:
        online = await presence_user_ids(room.id)
        others = [uid for uid in online if uid != user_id]
        if others:
            approver_id: int | None = others[secrets.randbelow(len(others))]
            pending = dict(outcome)
            pending["pending_approval"] = True
            pending["approver_user_id"] = approver_id
            room.punishment_last_outcome = pending
        else:
            # Solo / everyone else offline: auto-approve immediately.
            await _complete_approval(session, room, user_id, outcome)
    await session.commit()
    return True


async def _complete_approval(
    session: AsyncSession,
    room: Room,
    spinner_id: int,
    outcome: dict[str, object],
) -> None:
    """Shared logic for finalising a dare (used by approve + auto-approve)."""
    room.punishment_done_count += 1
    done_counts = dict(room.punishment_done_counts or {})
    done_counts[str(spinner_id)] = done_counts.get(str(spinner_id), 0) + 1
    room.punishment_done_counts = done_counts

    resolved = dict(outcome)
    resolved["resolved"] = True
    resolved["pending_approval"] = False
    room.punishment_last_outcome = resolved

    await _advance_turn(session, room)


async def approve_punishment(
    session: AsyncSession, room: Room, user_id: int,
) -> bool:
    """The chosen approver confirms the punished player performed their dare.

    Returns False if the caller is not the designated approver or there is
    no pending approval.
    """
    outcome = room.punishment_last_outcome
    if (
        outcome is None
        or outcome.get("kind") != "punish"
        or outcome.get("resolved")
        or not outcome.get("pending_approval")
        or outcome.get("approver_user_id") != user_id
    ):
        return False

    raw_spinner = outcome["spinner_id"]
    spinner_id = int(raw_spinner) if isinstance(raw_spinner, (int, str)) else 0
    await _complete_approval(session, room, spinner_id, outcome)
    await session.commit()
    return True


async def reject_punishment(
    session: AsyncSession, room: Room, user_id: int,
) -> bool:
    """The chosen approver rejects the dare: the player must perform it again.

    Clears the pending-approval flag so the punished player's card reappears
    (Done/Refuse) and the turn stays blocked — the game does not advance until
    the dare is actually approved. Returns False if the caller is not the
    designated approver or there is no pending approval.
    """
    outcome = room.punishment_last_outcome
    if (
        outcome is None
        or outcome.get("kind") != "punish"
        or outcome.get("resolved")
        or not outcome.get("pending_approval")
        or outcome.get("approver_user_id") != user_id
    ):
        return False

    reverted = dict(outcome)
    reverted["pending_approval"] = False
    reverted["approver_user_id"] = None
    room.punishment_last_outcome = reverted
    await session.commit()
    return True


async def reset_game(session: AsyncSession, room: Room) -> None:
    """Start a fresh game: clear bets, counts, winner, outcome, turn cursor.

    `punishment_done_count` and `punishment_done_counts` (cumulative dares
    performed) are preserved as session-long stats. Room returns to lobby so
    players can re-bet.
    """
    room.punishment_predictions = None
    room.punishment_match_counts = None
    room.punishment_winner_user_id = None
    room.punishment_last_outcome = None
    room.current_turn_user_id = None
    room.status = "lobby"
    # Fresh card pass for the new game (no-repeat starts over).
    await punishment_reset_cards(room.id, room.punishment_deck or "mild")
    await session.commit()
