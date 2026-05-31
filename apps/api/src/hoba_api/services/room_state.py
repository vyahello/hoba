"""Shared room-snapshot builder — used by REST endpoints + WS handlers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.schemas.room import (
    ParticipantOut,
    PunishmentOutcomeOut,
    QuestionOut,
    RoomOut,
    RoomState,
    SpinOut,
)
from hoba_api.services.participants import list_for_room
from hoba_api.services.spins import list_room_spins


async def build_room_state(
    session: AsyncSession, room: Room, *, current_user_id: int,
) -> RoomState:
    """Compose the full room snapshot used by REST + Socket.IO room:state.

    `current_user_id` is the internal `users.id` of the caller — passed
    through to the client as `me_user_id` so the UI can compare against
    `participants[*].user_id` without knowing the Telegram tg_id.
    """
    participants = await list_for_room(session, room.id)
    active_question = next((q for q in room.questions if q.is_active), None)
    spins = await list_room_spins(session, room.id, limit=1)
    last_spin = spins[0] if spins else None

    # Punishment v3: bets, match counts, winner and the last outcome are all
    # PUBLIC (anti-cheat — everyone sees who bet what and every result).
    bets = dict(room.punishment_predictions) if room.punishment_predictions else None
    outcome = (
        PunishmentOutcomeOut.model_validate(room.punishment_last_outcome)
        if room.punishment_last_outcome
        else None
    )
    # Rigged Mode 🎭 secrecy (spec §5.5): to a non-host viewer, before the host
    # reveals, a rigged room is INDISTINGUISHABLE from Classic — the mode shows
    # as "classic" and every segment weight as 1. The host (and everyone after
    # a reveal) sees the real mode + weights.
    is_host = room.host_id == current_user_id
    rig_hidden = room.game_mode == "rigged" and not room.rigged_revealed and not is_host

    room_update: dict[str, object] = {
        "punishment_bets": bets,
        "punishment_match_counts": room.punishment_match_counts,
        "punishment_winner_user_id": room.punishment_winner_user_id,
        "punishment_last_outcome": outcome,
    }
    if rig_hidden:
        room_update["game_mode"] = "classic"
    room_out = RoomOut.model_validate(room).model_copy(update=room_update)

    question_out = (
        QuestionOut.model_validate(active_question)
        if active_question is not None
        else None
    )
    if question_out is not None and rig_hidden:
        question_out = question_out.model_copy(
            update={
                "segments": [s.model_copy(update={"weight": 1}) for s in question_out.segments],
            },
        )

    return RoomState(
        room=room_out,
        # `Participant.display_name` is never populated at write time, so
        # derive the name from the eager-loaded `User` (relationship is
        # lazy="joined"). Prefer an explicit participant display_name if
        # one is ever set; otherwise fall back to the user's first_name.
        participants=[
            ParticipantOut.model_validate(p).model_copy(
                update={"display_name": p.display_name or p.user.first_name},
            )
            for p in participants
        ],
        active_question=question_out,
        last_spin=SpinOut.model_validate(last_spin) if last_spin is not None else None,
        me_user_id=current_user_id,
    )
