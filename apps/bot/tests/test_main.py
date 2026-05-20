"""Tests for `hoba_bot.main` — dispatcher wiring + startup hook."""

from __future__ import annotations

from unittest.mock import AsyncMock

from aiogram import Dispatcher
from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SetChatMenuButton

from hoba_bot import config as bot_config
from hoba_bot.main import BOT_COMMANDS, _idle_forever, _on_startup, build_dispatcher


def test_version_pinned() -> None:
    from hoba_bot import __version__

    assert __version__ == "0.1.0"


def test_build_dispatcher_returns_dispatcher() -> None:
    dp = build_dispatcher()
    assert isinstance(dp, Dispatcher)


def test_bot_commands_match_spec() -> None:
    assert [c.command for c in BOT_COMMANDS] == ["start", "new", "help", "lang", "about"]


async def test_on_startup_sets_commands_and_menu_button() -> None:
    bot = AsyncMock()
    bot.set_my_commands = AsyncMock()
    bot.set_chat_menu_button = AsyncMock()

    await _on_startup(bot)
    bot.set_my_commands.assert_awaited_once_with(BOT_COMMANDS)
    bot.set_chat_menu_button.assert_awaited_once()
    button_arg = bot.set_chat_menu_button.call_args.kwargs["menu_button"]
    assert button_arg.web_app.url == bot_config.settings.webapp_url
    assert button_arg.text == "Open Hoba!"


async def test_on_startup_skips_menu_button_without_webapp_url(monkeypatch) -> None:
    monkeypatch.setattr(bot_config.settings, "webapp_url", None)
    bot = AsyncMock()
    bot.set_my_commands = AsyncMock()
    bot.set_chat_menu_button = AsyncMock()

    await _on_startup(bot)
    bot.set_my_commands.assert_awaited_once()
    bot.set_chat_menu_button.assert_not_awaited()


async def test_on_startup_swallows_telegram_bad_request() -> None:
    bot = AsyncMock()
    bot.set_my_commands = AsyncMock()
    bot.set_chat_menu_button = AsyncMock(
        side_effect=TelegramBadRequest(
            method=SetChatMenuButton(),
            message="BUTTON_URL_INVALID",
        )
    )

    await _on_startup(bot)  # must not raise


async def test_idle_forever_blocks_until_cancelled() -> None:
    import asyncio
    import contextlib

    task = asyncio.create_task(_idle_forever())
    await asyncio.sleep(0.05)
    assert not task.done()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
