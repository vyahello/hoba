"""Pydantic schemas for `/api/v1/wheels` — the saved-wheel library (F10)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from hoba_api.schemas.room import GameMode, PunishmentDeck, SegmentIn, SegmentOut


class WheelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    use_count: int
    is_public: bool
    like_count: int
    category: str | None
    segments: list[SegmentOut]
    created_at: datetime
    # Viewer-relative: whether the current user has liked it (set on trending;
    # always False on the owner's library listing).
    liked: bool = False


class WheelCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    segments: list[SegmentIn] = Field(min_length=2, max_length=12)


class WheelUpdateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    segments: list[SegmentIn] = Field(min_length=2, max_length=12)


class WheelUseIn(BaseModel):
    """Instantiate a saved wheel as a room — same knobs as room creation."""

    game_mode: GameMode = "classic"
    punishment_deck: PunishmentDeck | None = None
    spin_count: int = 1


class WheelPublishIn(BaseModel):
    """Make a wheel public (Phase 10). Category is optional + validated."""

    category: str | None = None


class WheelLikeOut(BaseModel):
    """Result of a like toggle."""

    liked: bool
    like_count: int


class WheelReportIn(BaseModel):
    """Report a public wheel for moderation (spec §14)."""

    wheel_id: int
    reason: str | None = Field(default=None, max_length=200)
