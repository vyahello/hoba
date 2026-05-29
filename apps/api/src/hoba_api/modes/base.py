"""GameModeEngine protocol + the pure data objects engines exchange.

Engines never touch the DB. They read a SpinContext and return declarative
decisions; the spin service / handlers apply persistence. This keeps every
engine unit-testable without a session (spec §5).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment


@dataclass(frozen=True)
class SpinContext:
    room: Room
    question: Question | None
    segments: list[Segment]  # ALL segments of the question, position order


@dataclass(frozen=True)
class SpinDecision:
    segments: list[Segment]            # segments to spin over (living), position order
    duration_multiplier: float = 1.0   # scales the computed spin duration
    effects: dict[str, object] = field(default_factory=dict)  # -> spin:started.mode_effects


@dataclass(frozen=True)
class ModeEffects:
    eliminate_segment_ids: list[int] = field(default_factory=list)
    round_over: bool = False
    extra: dict[str, object] = field(default_factory=dict)


class GameModeEngine(Protocol):
    mode_id: str

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision: ...
    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects: ...
    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]: ...
    def is_round_over(self, ctx: SpinContext) -> bool: ...
