"""`/api/v1/trending` — public wheel discovery (Phase 10).

Sort signal is documented in docs/architecture.md: `like_count*3 +
use_count`, descending, recency tiebreak. Hidden + private wheels are
excluded at the query level.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.db import get_db
from hoba_api.models.wheel import Wheel
from hoba_api.schemas.wheel import WheelOut
from hoba_api.services.wheels import list_trending, search_trending

router = APIRouter(prefix="/trending", tags=["trending"])


def _to_out(wheels: list[Wheel], liked_ids: set[int]) -> list[WheelOut]:
    return [
        WheelOut.model_validate(w).model_copy(update={"liked": w.id in liked_ids})
        for w in wheels
    ]


@router.get("", response_model=list[WheelOut])
async def list_trending_endpoint(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    category: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[WheelOut]:
    wheels, liked = await list_trending(
        db, viewer_id=user.id, category=category, limit=limit, offset=offset,
    )
    return _to_out(wheels, liked)


@router.get("/search", response_model=list[WheelOut])
async def search_trending_endpoint(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[WheelOut]:
    wheels, liked = await search_trending(db, viewer_id=user.id, query=q, limit=limit)
    return _to_out(wheels, liked)
