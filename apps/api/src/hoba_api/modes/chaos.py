"""Chaos mode (spec §5.4) — a random event fires on EVERY spin.

Chaos is "full chaos": every spin draws one of the events below (never a
plain spin). The event is decided **server-side** (rule 2) and rides out in
`SpinDecision.effects` as `chaos_event`, which the spin service folds into
`spin:started.mode_effects`. The client shows a ~1.5 s announcement card
(skewed "Hoba!" + the event), then releases the wheel.

Engines are pure / DB-free; the only impurity here is the RNG, injected so
the engine is deterministic under test. The `reverse` angle flip itself is
applied by the spin service — engines never compute angles.
"""
from __future__ import annotations

import secrets
from collections.abc import Callable

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision

SPEED_RUN_MULTIPLIER = 0.5
SLOW_BURN_MULTIPLIER = 1.5

# Every spin picks one of these uniformly.
CHAOS_EVENTS: tuple[str, ...] = ("speed_run", "slow_burn", "reverse", "swap")


def _default_rng() -> float:
    """secrets-backed uniform float in [0, 1); fresh each call, no shared state."""
    return secrets.randbits(30) / (1 << 30)


class ChaosEngine:
    mode_id = "chaos"

    def __init__(self, rng: Callable[[], float] | None = None) -> None:
        self._rng = rng if rng is not None else _default_rng

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        idx = min(int(self._rng() * len(CHAOS_EVENTS)), len(CHAOS_EVENTS) - 1)
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
        return self._swap(ctx)

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
