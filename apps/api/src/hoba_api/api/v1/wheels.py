"""`/api/v1/wheels` — saved-wheel library CRUD + use-as-room (spec §8 / F10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.db import get_db
from hoba_api.models.wheel import Wheel
from hoba_api.schemas.room import RoomState, SegmentIn
from hoba_api.schemas.wheel import WheelCreateIn, WheelOut, WheelUpdateIn, WheelUseIn
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import RoomServiceError, SegmentDraft
from hoba_api.services.wheels import (
    create_wheel,
    delete_wheel,
    get_wheel,
    list_wheels,
    update_wheel,
    use_wheel,
)

router = APIRouter(prefix="/wheels", tags=["wheels"])


def _error_to_http(error: RoomServiceError) -> HTTPException:
    code = {
        "not_owner": status.HTTP_403_FORBIDDEN,
    }.get(error.code, status.HTTP_400_BAD_REQUEST)
    return HTTPException(status_code=code, detail=error.code)


def _drafts(segments: list[SegmentIn]) -> list[SegmentDraft]:
    return [
        SegmentDraft(
            label=s.label, emoji=s.emoji, color_seed=s.color_seed, weight=s.weight,
        )
        for s in segments
    ]


async def _owned_or_404(db: AsyncSession, wheel_id: int, user_id: int) -> Wheel:
    wheel = await get_wheel(db, wheel_id)
    if wheel is None or wheel.owner_id != user_id:
        # Don't leak existence of other users' wheels.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="wheel_not_found")
    return wheel


@router.get("", response_model=list[WheelOut])
async def list_wheels_endpoint(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[WheelOut]:
    wheels = await list_wheels(db, user.id)
    return [WheelOut.model_validate(w) for w in wheels]


@router.post("", response_model=WheelOut, status_code=status.HTTP_201_CREATED)
async def create_wheel_endpoint(
    payload: WheelCreateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WheelOut:
    try:
        wheel = await create_wheel(
            db, owner_id=user.id, title=payload.title, segments=_drafts(payload.segments),
        )
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return WheelOut.model_validate(await get_wheel(db, wheel.id))


@router.patch("/{wheel_id}", response_model=WheelOut)
async def update_wheel_endpoint(
    wheel_id: int,
    payload: WheelUpdateIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WheelOut:
    wheel = await _owned_or_404(db, wheel_id, user.id)
    try:
        await update_wheel(
            db, wheel, owner_id=user.id, title=payload.title,
            segments=_drafts(payload.segments),
        )
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return WheelOut.model_validate(await get_wheel(db, wheel_id))


@router.delete("/{wheel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wheel_endpoint(
    wheel_id: int,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    wheel = await _owned_or_404(db, wheel_id, user.id)
    await delete_wheel(db, wheel, owner_id=user.id)
    await db.commit()


@router.post("/{wheel_id}/use", response_model=RoomState)
async def use_wheel_endpoint(
    wheel_id: int,
    payload: WheelUseIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    wheel = await _owned_or_404(db, wheel_id, user.id)
    try:
        room = await use_wheel(
            db, wheel, owner_id=user.id, game_mode=payload.game_mode,
            punishment_deck=payload.punishment_deck, spin_count=payload.spin_count,
        )
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return await build_room_state(db, room, current_user_id=user.id)
