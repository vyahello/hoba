"""Shared room-snapshot builder — used by REST endpoints + WS handlers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.schemas.room import (
    ParticipantOut,
    PunishmentCardOut,
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

    # Punishment prediction secrecy: predictions are SECRET while the round
    # is in the predicting phase (`punishment_cards IS None`) and REVEALED
    # once resolved. Override the naive model_validate values per-viewer.
    preds_raw = room.punishment_predictions or {}
    resolved = room.punishment_cards is not None
    locked_ids = sorted(int(k) for k in preds_raw)
    cards_out: dict[str, PunishmentCardOut] | None = None
    if resolved and room.punishment_cards is not None:
        cards_out = {
            k: PunishmentCardOut.model_validate(v)
            for k, v in room.punishment_cards.items()
        }
    room_out = RoomOut.model_validate(room).model_copy(
        update={
            "punishment_locked_user_ids": locked_ids,
            "punishment_my_prediction": (
                preds_raw.get(str(current_user_id)) if not resolved else None
            ),
            "punishment_predictions": dict(preds_raw) if resolved else None,
            "punishment_result_segment_id": (
                room.punishment_result_segment_id if resolved else None
            ),
            "punishment_cards": cards_out,
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
        active_question=(
            QuestionOut.model_validate(active_question)
            if active_question is not None
            else None
        ),
        last_spin=SpinOut.model_validate(last_spin) if last_spin is not None else None,
        me_user_id=current_user_id,
    )
