"""Punishment mode (spec §5.3) — wheel picks the victim; the service deals
a card. The engine itself is a plain pass-through (no eliminations, no
duration change); the draw is a service concern (engines are pure/DB-free)."""

from __future__ import annotations

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision


class PunishmentEngine:
    mode_id = "punishment"

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        return SpinDecision(segments=ctx.segments)

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        return ModeEffects()

    def is_round_over(self, ctx: SpinContext) -> bool:
        return False
