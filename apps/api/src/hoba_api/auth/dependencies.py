"""FastAPI dependency that authenticates a request via Telegram initData.

Used by every `/api/v1/*` route. Validates the `X-Telegram-Init-Data`
header, upserts a `User` row, and binds `user_id` into structlog's
contextvars so subsequent logs carry it automatically.
"""

from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import (
    InvalidInitData,
    parse_telegram_user,
    validate_init_data,
)
from hoba_api.config import settings
from hoba_api.db import get_db
from hoba_api.models.user import User
from hoba_api.services.users import cache_user_after_commit, resolve_telegram_user

log = structlog.get_logger("hoba_api.auth")


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    init_data: Annotated[str | None, Header(alias="X-Telegram-Init-Data")] = None,
) -> User:
    if not init_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_init_data",
        )

    if not settings.telegram_bot_token:
        log.error("auth.bot_token_missing")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="server_misconfigured",
        )

    try:
        fields = validate_init_data(
            init_data,
            settings.telegram_bot_token,
            max_age_seconds=settings.init_data_max_age_seconds,
        )
        tg_user = parse_telegram_user(fields)
    except InvalidInitData as exc:
        log.info("auth.rejected", code=exc.code)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.code,
        ) from exc

    user = await resolve_telegram_user(db, tg_user)
    await db.commit()
    await cache_user_after_commit(user)
    structlog.contextvars.bind_contextvars(user_id=user.id)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
