"""Server-authoritative wheel math.

Mirrors the JS `apps/webapp/src/features/wheel/spinMath.ts` exactly so
the spin parameters the server hands the clients reproduce the same
animation everywhere.
"""

from hoba_api.wheel.spin_math import (
    SpinResult,
    compute_spin,
    mulberry32,
    pick_segment_index,
    segment_under_pointer,
)

__all__ = [
    "SpinResult",
    "compute_spin",
    "mulberry32",
    "pick_segment_index",
    "segment_under_pointer",
]
