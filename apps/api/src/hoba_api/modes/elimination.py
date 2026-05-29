"""Elimination mode (spec §5.2) — winner shatters off; last survivor wins."""
from __future__ import annotations

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision

DRAMATIC_MULTIPLIER = 1.5
FINAL_DUEL_COUNT = 2


class EliminationEngine:
    mode_id = "elimination"

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return [s for s in ctx.segments if s.eliminated_at is None]

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        living = self.get_visible_segments(ctx)
        if len(living) == FINAL_DUEL_COUNT:
            return SpinDecision(
                segments=living,
                duration_multiplier=DRAMATIC_MULTIPLIER,
                effects={"dramatic": True},
            )
        return SpinDecision(segments=living)

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        living_after = len(self.get_visible_segments(ctx)) - 1
        return ModeEffects(
            eliminate_segment_ids=[winner.id],
            round_over=living_after <= 1,
        )

    def is_round_over(self, ctx: SpinContext) -> bool:
        return len(self.get_visible_segments(ctx)) <= 1
