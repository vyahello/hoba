"""Maps a room.game_mode to its engine. Unknown/unbuilt modes fall back
to Classic so they keep spinning until their own slice lands."""
from __future__ import annotations

from hoba_api.modes.base import GameModeEngine
from hoba_api.modes.classic import ClassicEngine
from hoba_api.modes.elimination import EliminationEngine

_ENGINES: dict[str, GameModeEngine] = {
    "classic": ClassicEngine(),
    "elimination": EliminationEngine(),
}
_FALLBACK: GameModeEngine = _ENGINES["classic"]


def engine_for(game_mode: str) -> GameModeEngine:
    return _ENGINES.get(game_mode, _FALLBACK)
