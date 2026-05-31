"""Chaos mode (spec §5.4) — a random event fires before some spins.

About a quarter of spins draw one of five events; the rest behave exactly
like Classic. The event is decided **server-side** (rule 2) and rides out in
`SpinDecision.effects` as `chaos_event`, which the spin service folds into
`spin:started.mode_effects`. The client shows a ~1.5 s announcement card,
then releases the wheel.

Engines are pure / DB-free; the only impurity here is the RNG, injected so
the engine is deterministic under test. The `reverse` angle flip itself is
applied by the spin service — engines never compute angles.
"""
from __future__ import annotations

import secrets
from collections.abc import Callable

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision

CHAOS_PROBABILITY = 0.25
SPEED_RUN_MULTIPLIER = 0.5
SLOW_BURN_MULTIPLIER = 1.5

# Ordered. An event is chosen by partitioning the [0, CHAOS_PROBABILITY) band
# into equal slices, so the per-event chance is CHAOS_PROBABILITY / 5 = 5%.
CHAOS_EVENTS: tuple[str, ...] = ("speed_run", "slow_burn", "reverse", "swap", "jackpot")


def _default_rng() -> float:
    """secrets-backed uniform float in [0, 1); fresh each call, no shared state."""
    return secrets.randbits(30) / (1 << 30)


class ChaosEngine:
    mode_id = "chaos"

    def __init__(
        self,
        rng: Callable[[], float] | None = None,
        probability: float | None = None,
    ) -> None:
        self._rng = rng if rng is not None else _default_rng
        self._probability = (
            probability if probability is not None else CHAOS_PROBABILITY
        )

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        roll = self._rng()
        if roll >= self._probability:
            return SpinDecision(segments=ctx.segments)
        idx = min(
            int(roll / self._probability * len(CHAOS_EVENTS)),
            len(CHAOS_EVENTS) - 1,
        )
        event = CHAOS_EVENTS[idx]
        if event == "speed_run":
            return SpinDecision(
                segments=ctx.segments,
                duration_multiplier=SPEED_RUN_MULTIPLIER,
                effects={"chaos_event": "speed_run"},
            )
        if event == "slow_burn":
            return SpinDecision(
                segments=ctx.segments,
                duration_multiplier=SLOW_BURN_MULTIPLIER,
                effects={"chaos_event": "slow_burn", "dramatic": True},
            )
        if event == "reverse":
            # The service flips the final angle to spin counter-clockwise.
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": "reverse"},
            )
        if event == "swap":
            return self._swap(ctx)
        return SpinDecision(
            segments=ctx.segments,
            effects={"chaos_event": "jackpot"},
        )

    def _swap(self, ctx: SpinContext) -> SpinDecision:
        """Trade two random segments' positions for this spin only.

        The result is computed over the swapped order; the client must render
        the same order or the wheel would land on the wrong sector, so the
        full spin order rides out in `segment_order`.
        """
        segs = list(ctx.segments)
        n = len(segs)
        i = min(int(self._rng() * n), n - 1)
        j = min(int(self._rng() * (n - 1)), n - 2)
        if j >= i:
            j += 1
        segs[i], segs[j] = segs[j], segs[i]
        return SpinDecision(
            segments=segs,
            effects={"chaos_event": "swap", "segment_order": [s.id for s in segs]},
        )

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        return ModeEffects()

    def is_round_over(self, ctx: SpinContext) -> bool:
        return False
