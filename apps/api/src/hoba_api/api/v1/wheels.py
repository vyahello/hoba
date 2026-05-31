"""`/api/v1/wheels` — saved-wheel library CRUD + use-as-room (spec §8 / F10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.db import get_db
from hoba_api.models.wheel import Wheel
from hoba_api.redis_client import rate_limit_take
from hoba_api.schemas.room import RoomState, SegmentIn
from hoba_api.schemas.wheel import (
    WheelCreateIn,
    WheelLikeOut,
    WheelOut,
    WheelPublishIn,
    WheelUpdateIn,
    WheelUseIn,
)
from hoba_api.services.room_state import build_room_state
from hoba_api.services.rooms import RoomServiceError, SegmentDraft
from hoba_api.services.wheels import (
    create_wheel,
    delete_wheel,
    get_wheel,
    list_wheels,
    publish_wheel,
    toggle_like,
    unpublish_wheel,
    update_wheel,
    use_wheel,
)

# Spec §14: 3 make-public actions / user / day.
MAKE_PUBLIC_RATE_LIMIT_MAX = 3
MAKE_PUBLIC_RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60

router = APIRouter(prefix="/wheels", tags=["wheels"])


def _error_to_http(error: RoomServiceError) -> HTTPException:
    code = {
        "not_owner": status.HTTP_403_FORBIDDEN,
        "not_public": status.HTTP_403_FORBIDDEN,
        "profanity": status.HTTP_422_UNPROCESSABLE_ENTITY,
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


@router.post("/{wheel_id}/publish", response_model=WheelOut)
async def publish_wheel_endpoint(
    wheel_id: int,
    payload: WheelPublishIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WheelOut:
    if not await rate_limit_take(
        f"rate:wheel_publish:{user.id}",
        max_in_window=MAKE_PUBLIC_RATE_LIMIT_MAX,
        window_seconds=MAKE_PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="rate_limited",
        )
    wheel = await _owned_or_404(db, wheel_id, user.id)
    try:
        await publish_wheel(db, wheel, owner_id=user.id, category=payload.category)
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return WheelOut.model_validate(await get_wheel(db, wheel_id))


@router.post("/{wheel_id}/unpublish", response_model=WheelOut)
async def unpublish_wheel_endpoint(
    wheel_id: int,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WheelOut:
    wheel = await _owned_or_404(db, wheel_id, user.id)
    try:
        await unpublish_wheel(db, wheel, owner_id=user.id)
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return WheelOut.model_validate(await get_wheel(db, wheel_id))


@router.post("/{wheel_id}/like", response_model=WheelLikeOut)
async def like_wheel_endpoint(
    wheel_id: int,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WheelLikeOut:
    wheel = await get_wheel(db, wheel_id)
    if wheel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="wheel_not_found")
    try:
        liked, count = await toggle_like(db, wheel, user_id=user.id)
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return WheelLikeOut(liked=liked, like_count=count)


@router.post("/{wheel_id}/use", response_model=RoomState)
async def use_wheel_endpoint(
    wheel_id: int,
    payload: WheelUseIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> RoomState:
    # Accessible if owned OR a visible public wheel; otherwise 404 (no leak).
    wheel = await get_wheel(db, wheel_id)
    if wheel is None or (
        wheel.owner_id != user.id and not (wheel.is_public and not wheel.is_hidden)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="wheel_not_found")
    try:
        room = await use_wheel(
            db, wheel, user_id=user.id, game_mode=payload.game_mode,
            punishment_deck=payload.punishment_deck, spin_count=payload.spin_count,
        )
    except RoomServiceError as exc:
        raise _error_to_http(exc) from exc
    await db.commit()
    return await build_room_state(db, room, current_user_id=user.id)
