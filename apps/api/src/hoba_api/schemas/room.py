"""Pydantic schemas for `/api/v1/rooms` + Socket.IO room:state payloads."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

GameMode = Literal["classic", "elimination", "punishment", "chaos", "rigged"]
PunishmentDeck = Literal["mild", "spicy", "chaos"]
SpinPolicy = Literal["host_only", "anyone", "turn_based"]
SuggestionPolicy = Literal["off", "approval", "free"]
RoomStatus = Literal["lobby", "active", "closed"]
ParticipantRole = Literal["host", "guest"]


class SegmentIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    emoji: str | None = Field(default=None, max_length=16)
    color_seed: int = Field(default=0, ge=0, le=11)
    weight: int = Field(default=1, ge=0, le=100)


class SegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    emoji: str | None
    color_seed: int
    weight: int
    position: int
    is_eliminated: bool = False


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    is_active: bool
    segments: list[SegmentOut]


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    role: ParticipantRole
    display_name: str | None
    joined_at: datetime
    last_seen_at: datetime


class SpinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_id: int
    triggered_by: int
    result_segment_id: int
    final_angle_deg: float
    duration_ms: int
    seed: int
    started_at: datetime
    settled_at: datetime | None


class PunishmentCardOut(BaseModel):
    text: str
    deck: str
    card_index: int


class PunishmentOutcomeOut(BaseModel):
    spinner_id: int
    result_segment_id: int
    kind: Literal["lucky", "punish"]
    card: PunishmentCardOut | None = None
    resolved: bool
    pending_approval: bool = False
    approver_user_id: int | None = None


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    host_id: int
    title: str | None
    status: RoomStatus
    game_mode: GameMode
    spin_policy: SpinPolicy
    suggestion_policy: SuggestionPolicy
    is_locked: bool
    is_anonymous: bool
    current_turn_user_id: int | None
    punishment_deck: PunishmentDeck | None
    punishment_done_count: int
    punishment_done_counts: dict[str, int] | None = None
    punishment_unique_bets: bool = False
    # Punishment v3 (turn-based personal-bet race). Bets are PUBLIC (anti-cheat):
    # everyone sees who bet on what. match_counts, winner, and last_outcome are
    # all shared to every player.
    punishment_bets: dict[str, int] | None = None
    punishment_match_counts: dict[str, int] | None = None
    punishment_winner_user_id: int | None = None
    punishment_last_outcome: PunishmentOutcomeOut | None = None
    spin_count: int
    bon_attempts: int
    bon_tally: dict[str, int] | None
    bon_winner_segment_id: int | None
    # Rigged Mode 🎭 (spec §5.5). Pre-reveal these are only meaningful to the
    # host — a non-host viewer gets game_mode redacted to "classic" + count 0.
    rigged_revealed: bool = False
    rigged_spin_count: int = 0
    created_at: datetime
    closed_at: datetime | None


class RoomState(BaseModel):
    """Full room snapshot sent via room:state and GET /rooms/{code}."""

    room: RoomOut
    participants: list[ParticipantOut]
    active_question: QuestionOut | None
    last_spin: SpinOut | None
    # Internal user_id of the request/connection — lets the client decide
    # host vs guest without having to map Telegram's tg_id (which is what
    # `initDataUnsafe.user.id` returns) to our DB primary key.
    me_user_id: int


class RoomCreateIn(BaseModel):
    question_text: str = Field(min_length=1, max_length=120)
    segments: list[SegmentIn] = Field(min_length=2, max_length=12)
    title: str | None = Field(default=None, max_length=80)
    # When None, services.rooms._derive_spin_policy fills it in from
    # game_mode: Elimination→host_only, Punishment→turn_based,
    # Chaos→anyone, Rigged→host_only, Classic→anyone.
    spin_policy: SpinPolicy | None = Field(default=None)
    suggestion_policy: SuggestionPolicy = "off"
    game_mode: GameMode = "classic"
    punishment_deck: PunishmentDeck | None = Field(default=None)
    spin_count: int = Field(default=1)


class RigUpdateIn(BaseModel):
    """Rigged Mode 🎭 (spec §5.5): host-only segment weights `{segment_id: 0..100}`."""

    weights: dict[int, int]


class RoomUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    spin_policy: SpinPolicy | None = None
    suggestion_policy: SuggestionPolicy | None = None
    is_locked: bool | None = None
    is_anonymous: bool | None = None
    game_mode: GameMode | None = None
    punishment_deck: PunishmentDeck | None = None
    spin_count: int | None = None


class KickIn(BaseModel):
    """Host kicks a participant by internal user id (spec §F11)."""

    user_id: int
