"""Shared room-snapshot builder — used by REST endpoints + WS handlers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.schemas.room import (
    ParticipantOut,
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

    return RoomState(
        room=RoomOut.model_validate(room),
        participants=[ParticipantOut.model_validate(p) for p in participants],
        active_question=(
            QuestionOut.model_validate(active_question)
            if active_question is not None
            else None
        ),
        last_spin=SpinOut.model_validate(last_spin) if last_spin is not None else None,
        me_user_id=current_user_id,
    )
