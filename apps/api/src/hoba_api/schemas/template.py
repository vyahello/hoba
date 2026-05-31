"""Pydantic schemas for `/api/v1/templates` + `/rooms/from-template` (F2/Phase 9)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from hoba_api.schemas.room import GameMode, PunishmentDeck


class TemplateSegmentOut(BaseModel):
    """A template option resolved to a single locale."""

    key: str
    label: str
    emoji: str | None
    color_seed: int


class TemplateOut(BaseModel):
    """A built-in template resolved to the requested locale."""

    key: str
    category: str
    emoji: str
    gradient: tuple[str, str]
    title: str
    segments: list[TemplateSegmentOut]


class RoomFromTemplateIn(BaseModel):
    """Instantiate a built-in template as a room (caller becomes host)."""

    template_key: str = Field(min_length=1)
    locale: str = "en"
    game_mode: GameMode = "classic"
    punishment_deck: PunishmentDeck | None = None
    spin_count: int = 1
