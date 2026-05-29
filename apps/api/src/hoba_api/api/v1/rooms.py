"""`/api/v1/rooms` — create, fetch, patch, close, spin history."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.config import settings
from hoba_api.db import get_db
from hoba_api.models.question import Question
from hoba_api.realtime.server import NAMESPACE, sio
from hoba_api.redis_client import rate_limit_take
from hoba_api.schemas.room import (
    RoomCreateIn,
    RoomState,
    RoomUpdateIn,
    SpinOut,
)
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import (
    RoomServiceError,
    SegmentDraft,
    close_room,
    create_room,
    get_room_by_code,
    update_room,
)
from hoba_api.services.spins import list_room_spins

# Per spec §14: room creations / user / window. Enforced at the REST
# boundary so a spamming caller is turned away before the full
# graph-insert path runs. Sourced from settings (env-configurable) —
# default 5/hour for prod; raise on the VPS for heavy manual testing.
ROOM_CREATE_RATE_LIMIT_MAX = settings.room_create_rate_limit_max
ROOM_CREATE_RATE_LIMIT_WINDOW_SECONDS = settings.room_create_rate_limit_window_seconds


def _room_create_rate_limit_key(user_id: int) -> str:
    return f"rate:room_create:{user_id}"


router = APIRouter(prefix="/rooms", tags=["rooms"])


def _service_error_to_http(error: RoomServiceError) -> HTTPException:
    status_code = {
        "not_host": status.HTTP_403_FORBIDDEN,
        "room_closed": status.HTTP_409_CONFLICT,
        "room_locked": status.HTTP_403_FORBIDDEN,
        "kicked": status.HTTP_403_FORBIDDEN,
        "room_full": status.HTTP_409_CONFLICT,
    }.get(error.code, status.HTTP_400_BAD_REQUEST)
    return HTTPException(status_code=status_code, detail=error.code)




@router.post("", response_model=RoomState, status_code=status.HTTP_201_CREATED)
async def create_room_endpoint(
    payload: RoomCreateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    if not await rate_limit_take(
        _room_create_rate_limit_key(user.id),
        max_in_window=ROOM_CREATE_RATE_LIMIT_MAX,
        window_seconds=ROOM_CREATE_RATE_LIMIT_WINDOW_SECONDS,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="rate_limited",
        )
    drafts = [
        SegmentDraft(
            label=s.label,
            emoji=s.emoji,
            color_seed=s.color_seed,
            weight=s.weight,
        )
        for s in payload.segments
    ]
    try:
        room = await create_room(
            db,
            host_id=user.id,
            question_text=payload.question_text,
            segments=drafts,
            title=payload.title,
            spin_policy=payload.spin_policy,
            suggestion_policy=payload.suggestion_policy,
            game_mode=payload.game_mode,
            punishment_deck=payload.punishment_deck,
        )
    except RoomServiceError as exc:
        raise _service_error_to_http(exc) from exc
    await db.commit()
    await db.refresh(room)
    return await build_room_state(db, room, current_user_id=user.id)


@router.get("/{code}", response_model=RoomState)
async def get_room_endpoint(
    code: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    room = await get_room_by_code(db, code)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found",
        )
    return await build_room_state(db, room, current_user_id=user.id)


@router.patch("/{code}", response_model=RoomState)
async def patch_room_endpoint(
    code: str,
    payload: RoomUpdateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    room = await get_room_by_code(db, code)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found",
        )
    patch_dict = payload.model_dump(exclude_unset=True)
    cursor_before = room.current_turn_user_id
    try:
        await update_room(db, room, user_id=user.id, patch=patch_dict)
    except RoomServiceError as exc:
        raise _service_error_to_http(exc) from exc
    await db.commit()
    # Broadcast the patch so connected guests' snapshots catch up
    # without a manual refresh. Also include current_turn_user_id when
    # the service-layer side-effect changed it (spin_policy flip to/from
    # turn_based seeds or clears the cursor — guests need both fields).
    broadcast_patch: dict[str, object] = dict(patch_dict)
    if room.current_turn_user_id != cursor_before:
        broadcast_patch["current_turn_user_id"] = room.current_turn_user_id
    if broadcast_patch:
        await sio.emit(
            "room:updated",
            {"patch": broadcast_patch},
            room=room.code,
            namespace=NAMESPACE,
        )
    return await build_room_state(db, room, current_user_id=user.id)


@router.post("/{code}/close", response_model=RoomState)
async def close_room_endpoint(
    code: str,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    room = await get_room_by_code(db, code)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found",
        )
    try:
        await close_room(db, room, user_id=user.id)
    except RoomServiceError as exc:
        raise _service_error_to_http(exc) from exc
    await db.commit()
    return await build_room_state(db, room, current_user_id=user.id)


@router.get("/{code}/spins", response_model=list[SpinOut])
async def list_room_spins_endpoint(
    code: str,
    _user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = 50,
) -> list[SpinOut]:
    room = await get_room_by_code(db, code)
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="room_not_found",
        )
    spins = await list_room_spins(db, room.id, limit=min(limit, 200))
    return [SpinOut.model_validate(s) for s in spins]


_ = Question  # noqa: F841 — imported for SQLAlchemy relationship resolution
