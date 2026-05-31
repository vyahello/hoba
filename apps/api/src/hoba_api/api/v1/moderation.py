"""`/api/v1/moderation` — user report flow (spec §14, Phase 10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.db import get_db
from hoba_api.redis_client import rate_limit_take
from hoba_api.schemas.wheel import WheelReportIn
from hoba_api.services.wheels import get_wheel, report_wheel

# Light abuse guard on the report endpoint itself.
REPORT_RATE_LIMIT_MAX = 20
REPORT_RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60

router = APIRouter(prefix="/moderation", tags=["moderation"])


@router.post("/report", status_code=status.HTTP_204_NO_CONTENT)
async def report_endpoint(
    payload: WheelReportIn,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    if not await rate_limit_take(
        f"rate:wheel_report:{user.id}",
        max_in_window=REPORT_RATE_LIMIT_MAX,
        window_seconds=REPORT_RATE_LIMIT_WINDOW_SECONDS,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="rate_limited",
        )
    wheel = await get_wheel(db, payload.wheel_id)
    if wheel is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="wheel_not_found",
        )
    await report_wheel(db, wheel, user_id=user.id, reason=payload.reason)
    await db.commit()
