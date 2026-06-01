"""`/api/v1/moderation` — user report flow (spec §14, Phase 10)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.dependencies import AdminUser, CurrentUser
from hoba_api.db import get_db
from hoba_api.redis_client import rate_limit_take
from hoba_api.schemas.wheel import ReportedWheelOut, ReportRowOut, WheelReportIn
from hoba_api.services.wheels import (
    get_wheel,
    hide_wheel,
    list_reported_wheels,
    report_wheel,
    unhide_wheel,
)

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


# --- Admin review queue (spec §14 "manual queue UI later") ----------------


@router.get("/reports", response_model=list[ReportedWheelOut])
async def list_reports_endpoint(
    _admin: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[ReportedWheelOut]:
    """Every reported or hidden wheel, with its reporters + reasons."""
    return [
        ReportedWheelOut.model_validate(wheel).model_copy(
            update={
                "reports": [ReportRowOut.model_validate(r, from_attributes=True) for r in rows],
            },
        )
        for wheel, rows in await list_reported_wheels(db)
    ]


@router.post("/wheels/{wheel_id}/unhide", response_model=ReportedWheelOut)
async def unhide_wheel_endpoint(
    wheel_id: int,
    _admin: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportedWheelOut:
    """Admin: dismiss reports + restore visibility (clears the report count)."""
    wheel = await get_wheel(db, wheel_id)
    if wheel is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="wheel_not_found",
        )
    await unhide_wheel(db, wheel)
    await db.commit()
    return ReportedWheelOut.model_validate(await get_wheel(db, wheel_id))


@router.post("/wheels/{wheel_id}/hide", response_model=ReportedWheelOut)
async def hide_wheel_endpoint(
    wheel_id: int,
    _admin: AdminUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ReportedWheelOut:
    """Admin: take a wheel down manually (override, no threshold needed)."""
    wheel = await get_wheel(db, wheel_id)
    if wheel is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="wheel_not_found",
        )
    await hide_wheel(db, wheel)
    await db.commit()
    return ReportedWheelOut.model_validate(await get_wheel(db, wheel_id))
