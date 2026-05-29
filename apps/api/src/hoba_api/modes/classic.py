"""Classic mode — no special behaviour. The fallback engine."""
from __future__ import annotations

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision


class ClassicEngine:
    mode_id = "classic"

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        return SpinDecision(segments=ctx.segments)

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        return ModeEffects()

    def is_round_over(self, ctx: SpinContext) -> bool:
        return False
