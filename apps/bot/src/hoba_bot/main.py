"""Hoba! Telegram bot entry point.

Phase 1 scope: minimal aiogram polling bot that responds to `/start`.
If `TELEGRAM_BOT_TOKEN` is empty, the bot starts in **disabled (idle) mode**
with a loud warning log — the container stays alive so `docker compose up`
stays green while the operator wires up BotFather. Full command surface
(§6 of the spec) lands in Phase 3.
"""

from __future__ import annotations

import asyncio
import logging

import structlog
from aiogram import Bot, Dispatcher
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import Message

from hoba_bot import __version__
from hoba_bot.config import settings


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
    """Construct the dispatcher with Phase 1 handlers wired up."""
    dp = Dispatcher()

    @dp.message(CommandStart())
    async def handle_start(message: Message, command: CommandObject) -> None:
        payload = (command.args or "").strip()
        if payload.startswith("room_"):
            await message.answer(
                f"Hoba! 🎯\n\nDeep-link payload received: <code>{payload}</code>\n"
                "Full join flow lands in Phase 3.",
                parse_mode="HTML",
            )
            return
        await message.answer(
            "Hoba! 🎯\n\nBot is online (Phase 1 scaffolding). "
            "Mini App and game modes ship in later phases — see docs/spec.md."
        )

    return dp


async def _idle_forever() -> None:
    """Keep the container alive when the bot is in disabled mode."""
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

    bot = Bot(token=settings.telegram_bot_token)
    dp = build_dispatcher()
    log.info("bot.polling.start")
    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()
        log.info("bot.shutdown")
