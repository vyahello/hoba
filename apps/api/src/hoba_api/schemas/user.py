"""Pydantic schemas for `/api/v1/me`."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Locale = Literal["uk", "en"]


class UserMe(BaseModel):
    """GET /api/v1/me response — full profile of the authenticated user."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    tg_id: int
    tg_username: str | None
    first_name: str
    last_name: str | None
    photo_url: str | None
    language_code: Locale
    sound_enabled: bool
    haptics_enabled: bool
    music_enabled: bool
    created_at: datetime
    last_active_at: datetime
    # True if this user's tg_id is in ADMIN_TG_IDS (gates the moderation UI).
    is_admin: bool = False


class UserMeUpdate(BaseModel):
    """PATCH /api/v1/me body — every field optional, only `exclude_unset` keys apply."""

    language_code: Locale | None = None
    sound_enabled: bool | None = None
    haptics_enabled: bool | None = None
    music_enabled: bool | None = None


class UserStats(BaseModel):
    """GET /api/v1/me/stats response. Phase 2: all zeros."""

    rooms_created: int = Field(ge=0)
    rooms_joined: int = Field(ge=0)
    spins_triggered: int = Field(ge=0)
    wheels_saved: int = Field(ge=0)
