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
    segments: list[SegmentOut]
    created_at: datetime


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
