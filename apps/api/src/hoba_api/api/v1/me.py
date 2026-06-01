"""`/api/v1/me` — the authenticated user's own profile and stats."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser, is_admin
from hoba_api.db import get_db
from hoba_api.models.user import User
from hoba_api.schemas.user import UserMe, UserMeUpdate, UserStats
from hoba_api.services.users import get_stats

router = APIRouter(prefix="/me", tags=["me"])


def _me(user: User) -> UserMe:
    return UserMe.model_validate(user).model_copy(update={"is_admin": is_admin(user)})


@router.get("", response_model=UserMe)
async def read_me(user: CurrentUser) -> UserMe:
    return _me(user)


@router.patch("", response_model=UserMe)
async def update_me(
    payload: UserMeUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserMe:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    return _me(user)


@router.get("/stats", response_model=UserStats)
async def read_my_stats(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, int]:
    return await get_stats(db, user.id)
