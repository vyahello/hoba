"""Phase 1 smoke tests for the bot package.

Real handler tests land in Phase 3 once aiogram handlers have meaningful
behaviour. For now we just verify the dispatcher constructs and the
package metadata is correct.
"""

from __future__ import annotations

from aiogram import Dispatcher

from hoba_bot import __version__
from hoba_bot.main import build_dispatcher


def test_version_pinned() -> None:
    assert __version__ == "0.1.0"


def test_dispatcher_builds() -> None:
    dp = build_dispatcher()
    assert isinstance(dp, Dispatcher)
