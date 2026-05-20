"""`/api/v1/me` — the authenticated user's own profile and stats."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.db import get_db
from hoba_api.models.user import User
from hoba_api.schemas.user import UserMe, UserMeUpdate, UserStats
from hoba_api.services.users import get_stats

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserMe)
async def read_me(user: CurrentUser) -> User:
    return user


@router.patch("", response_model=UserMe)
async def update_me(
    payload: UserMeUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    return user


@router.get("/stats", response_model=UserStats)
async def read_my_stats(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, int]:
    return await get_stats(db, user.id)
