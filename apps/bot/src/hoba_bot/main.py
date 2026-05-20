"""Hoba! Telegram bot entry point.

Phase 3 scope: aiogram polling with the 5 slash commands from spec §6,
deep-link `room_<CODE>` parsing on `/start`, User upsert on every
`/start`, and a startup hook that calls `set_my_commands` + (when
`WEBAPP_URL` is set) `set_chat_menu_button`. Disabled-idle mode is
preserved for empty bot tokens.
"""

from __future__ import annotations

import asyncio
import logging

import structlog
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BotCommand,
    MenuButtonWebApp,
    WebAppInfo,
)

from hoba_api.db import SessionLocal
from hoba_bot import __version__
from hoba_bot.config import settings
from hoba_bot.handlers import (
    handle_about,
    handle_help,
    handle_lang,
    handle_new,
    handle_start,
)
from hoba_bot.middleware import DBMiddleware

BOT_COMMANDS: list[BotCommand] = [
    BotCommand(command="start", description="Launch Hoba!"),
    BotCommand(command="new", description="Create a new wheel"),
    BotCommand(command="help", description="Help"),
    BotCommand(command="lang", description="Change language"),
    BotCommand(command="about", description="About Hoba!"),
]


def _configure_logging() -> None:
    logging.basicConfig(format="%(message)s", level=settings.log_level.upper())
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


log = structlog.get_logger("hoba_bot")


def build_dispatcher() -> Dispatcher:
    """Construct the dispatcher with middleware + handlers wired up."""
    dp = Dispatcher()
    dp.update.middleware(DBMiddleware(SessionLocal))
    dp.message.register(handle_start, CommandStart())
    dp.message.register(handle_new, Command("new"))
    dp.message.register(handle_help, Command("help"))
    dp.message.register(handle_lang, Command("lang"))
    dp.message.register(handle_about, Command("about"))
    dp.startup.register(_on_startup)
    return dp


async def _on_startup(bot: Bot) -> None:
    """Register the command list and (if configured) the Mini App menu button."""
    await bot.set_my_commands(BOT_COMMANDS)
    log.info("bot.commands.set", count=len(BOT_COMMANDS))

    if not settings.webapp_url:
        log.warning(
            "bot.menu_button.skipped",
            reason="WEBAPP_URL not set — Mini App button will not be installed",
        )
        return

    try:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="Open Hoba!",
                web_app=WebAppInfo(url=settings.webapp_url),
            ),
        )
        log.info("bot.menu_button.set", url=settings.webapp_url)
    except TelegramBadRequest as exc:
        log.warning("bot.menu_button.failed", error=str(exc))


async def _idle_forever() -> None:
    log.warning(
        "bot.disabled",
        reason="TELEGRAM_BOT_TOKEN is empty",
        action="set TELEGRAM_BOT_TOKEN in .env and `docker compose restart bot`",
    )
    await asyncio.Event().wait()


async def run() -> None:
    _configure_logging()
    log.info("bot.startup", version=__version__, username=settings.telegram_bot_username)

    if not settings.telegram_bot_token:
        await _idle_forever()
        return

    bot = Bot(
        token=settings.telegram_bot_token,
        default=DefaultBotProperties(parse_mode="HTML"),
    )
    dp = build_dispatcher()
    log.info("bot.polling.start")
    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()
        log.info("bot.shutdown")
