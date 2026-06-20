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

# slow_burn feels slow (2× a normal spin) without dragging on too long, and
# does only a few turns (not 5–8) so it can't whip through the middle — the
# spin service trims the rotation count to this.
SLOW_BURN_MULTIPLIER = 2.0
SLOW_BURN_TURNS = 3
# multi_spin fires this many short fast spins in a row (the last one counts).
MULTI_SPIN_MIN = 2
MULTI_SPIN_MAX = 5
# mega_spin: an epic, much-longer spin with a pile of extra full turns.
MEGA_SPIN_MULTIPLIER = 2.6
MEGA_SPIN_TURNS = 12
# tiny_spin: a quick snap — barely a turn, over and done in a blink.
TINY_SPIN_MULTIPLIER = 0.5
TINY_SPIN_TURNS = 1

# Every spin picks one of these uniformly.
CHAOS_EVENTS: tuple[str, ...] = (
    "multi_spin",
    "slow_burn",
    "reverse",
    "swap",
    "nudge_fwd",
    "nudge_back",
    "blind_pointer",
    "roaming_pointer",
    "mega_spin",
    "tiny_spin",
    "shuffle",
    "earthquake",
)


def _default_rng() -> float:
    """secrets-backed uniform float in [0, 1); fresh each call, no shared state."""
    return secrets.randbits(30) / (1 << 30)


def _event_group(event: str | None) -> str | None:
    """The displayed announcement group — both nudges share one generic card,
    so they count as the same thing for back-to-back repeat avoidance."""
    if event is None:
        return None
    return "nudge" if event.startswith("nudge") else event


class ChaosEngine:
    mode_id = "chaos"

    def __init__(self, rng: Callable[[], float] | None = None) -> None:
        self._rng = rng if rng is not None else _default_rng

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        # Never announce the same event two spins running — pick from the
        # events whose displayed group differs from last time (≥5 remain).
        last_group = _event_group(ctx.last_chaos_event)
        candidates = [e for e in CHAOS_EVENTS if _event_group(e) != last_group]
        idx = min(int(self._rng() * len(candidates)), len(candidates) - 1)
        event = candidates[idx]
        if event == "multi_spin":
            reps = MULTI_SPIN_MIN + int(
                self._rng() * (MULTI_SPIN_MAX - MULTI_SPIN_MIN + 1),
            )
            reps = min(reps, MULTI_SPIN_MAX)
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": "multi_spin", "spin_reps": reps},
            )
        if event == "slow_burn":
            return SpinDecision(
                segments=ctx.segments,
                duration_multiplier=SLOW_BURN_MULTIPLIER,
                effects={"chaos_event": "slow_burn", "dramatic": True},
            )
        if event == "mega_spin":
            # Epic: a pile of extra turns over a long duration (service trims
            # the whole-turn count to MEGA_SPIN_TURNS).
            return SpinDecision(
                segments=ctx.segments,
                duration_multiplier=MEGA_SPIN_MULTIPLIER,
                effects={"chaos_event": "mega_spin", "dramatic": True},
            )
        if event == "tiny_spin":
            # Snap: ~one turn, over in a blink (service trims to TINY_SPIN_TURNS).
            return SpinDecision(
                segments=ctx.segments,
                duration_multiplier=TINY_SPIN_MULTIPLIER,
                effects={"chaos_event": "tiny_spin"},
            )
        if event == "reverse":
            # The service flips the final angle to spin counter-clockwise.
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": "reverse"},
            )
        if event in ("nudge_fwd", "nudge_back"):
            # The service settles on one segment, then nudges ±1 (changing the
            # result). It computes the angles; the engine only names the event.
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": event},
            )
        if event == "blind_pointer":
            # Normal spin, but the pointer is hidden and reappears at a random
            # screen angle on stop — whatever it lands on is the result. The
            # service picks the angle + result (geometry); engine just names it.
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": "blind_pointer"},
            )
        if event == "roaming_pointer":
            # The wheel stays still; the client roams the pointer across the
            # options (forward/back) and settles on the result. The service
            # just keeps the wheel angle put; the result is the normal pick.
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": "roaming_pointer"},
            )
        if event == "earthquake":
            # A normal forward spin, but the client makes the wheel convulse
            # before it breaks loose. Pure presentation — the service spins
            # normally; the engine just names the event.
            return SpinDecision(
                segments=ctx.segments,
                effects={"chaos_event": "earthquake"},
            )
        if event == "shuffle":
            return self._shuffle(ctx)
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
        swapped_ids = [segs[i].id, segs[j].id]
        segs[i], segs[j] = segs[j], segs[i]
        return SpinDecision(
            segments=segs,
            effects={
                "chaos_event": "swap",
                "segment_order": [s.id for s in segs],
                "swap_pair": swapped_ids,
            },
        )

    def _shuffle(self, ctx: SpinContext) -> SpinDecision:
        """Scramble EVERY segment into a new order for this spin only.

        Like `swap`, but a full random permutation — the result is computed
        over the shuffled order, so the whole order rides out in
        `segment_order` and the client re-renders it (the same reorder path
        swap uses). Guaranteed to actually move (never the identity order) so
        the chaos is visible.
        """
        segs = list(ctx.segments)
        n = len(segs)
        # Fisher–Yates over the copy.
        for k in range(n - 1, 0, -1):
            j = min(int(self._rng() * (k + 1)), k)
            segs[k], segs[j] = segs[j], segs[k]
        # A no-op permutation would read as "nothing happened" — force a move.
        if n > 1 and [s.id for s in segs] == [s.id for s in ctx.segments]:
            segs[0], segs[1] = segs[1], segs[0]
        return SpinDecision(
            segments=segs,
            effects={
                "chaos_event": "shuffle",
                "segment_order": [s.id for s in segs],
            },
        )

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        return ModeEffects()

    def is_round_over(self, ctx: SpinContext) -> bool:
        return False
