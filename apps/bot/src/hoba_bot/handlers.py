"""Slash-command handlers (§6 of the spec).

All bot-level text is EN per the policy in spec §6 — localized strings
live inside the Mini App via i18n (Phase 4+).
"""

from __future__ import annotations

import structlog
from aiogram.filters import CommandObject
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.services.users import upsert_from_telegram
from hoba_bot.config import settings

log = structlog.get_logger("hoba_bot.handlers")

# --- Reply texts (spec §6 Description is reused verbatim for /about) -----

START_TEXT = "Hoba! 🎯\n\nSpin the wheel with friends. Tap below to open the app."
START_ROOM_TEMPLATE = "Hoba! 🎯\n\nJoining room <b>{code}</b>…"
NEW_TEXT = "Tap below to create a new wheel."
HELP_TEXT = (
    "Hoba! commands:\n\n"
    "/start — Launch Hoba!\n"
    "/new — Create a new wheel\n"
    "/help — This help\n"
    "/lang — Change language (inside the app)\n"
    "/about — About Hoba!"
)
LANG_TEXT = (
    "Open the app and go to Settings → Language to switch between "
    "English and Українська."
)
ABOUT_TEXT = (
    "🎯 Multiplayer decision wheel for Telegram.\n"
    "Build a wheel, invite friends, spin together in real time.\n"
    "Hoba! — and it's decided.\n\n"
    "5 modes: Classic, Elimination, Punishment, Chaos, and the secret Rigged 🎭."
)

# --- Helpers -------------------------------------------------------------


def _open_app_keyboard(query_suffix: str = "") -> InlineKeyboardMarkup | None:
    """Inline keyboard with a single Web App button that opens the Mini App.

    Returns `None` when `WEBAPP_URL` is not configured — the message is
    then sent without a button. Web App buttons work in private chats
    only; Telegram silently ignores them in groups.
    """
    if not settings.webapp_url:
        return None
    url = f"{settings.webapp_url}{query_suffix}"
    return InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(text="Open Hoba!", web_app=WebAppInfo(url=url)),
        ]],
    )


def _extract_room_code(payload: str | None) -> str | None:
    """Return the room code from a deep-link `room_<CODE>` payload, or None."""
    if not payload:
        return None
    payload = payload.strip()
    prefix = "room_"
    if not payload.startswith(prefix):
        return None
    code = payload[len(prefix) :]
    return code or None


# --- Command handlers ----------------------------------------------------


async def handle_start(
    message: Message, command: CommandObject, session: AsyncSession
) -> None:
    """`/start` — upserts the user and replies with a Mini-App button.

    When invoked via `t.me/hobagame_bot?start=room_<CODE>`, the room
    code is parsed and pinned into the Mini App URL as `?room=<CODE>`.
    """
    if message.from_user is None:
        log.warning("start.no_from_user")
        return

    tg_user = TelegramUser(
        id=message.from_user.id,
        first_name=message.from_user.first_name,
        last_name=message.from_user.last_name,
        username=message.from_user.username,
        language_code=message.from_user.language_code,
    )
    user = await upsert_from_telegram(session, tg_user)
    await session.commit()
    log.info("start.user_upserted", user_id=user.id, tg_id=user.tg_id)

    room_code = _extract_room_code(command.args)
    if room_code is not None:
        await message.answer(
            START_ROOM_TEMPLATE.format(code=room_code),
            parse_mode="HTML",
            reply_markup=_open_app_keyboard(f"?room={room_code}"),
        )
        return

    await message.answer(START_TEXT, reply_markup=_open_app_keyboard())


async def handle_new(message: Message) -> None:
    await message.answer(NEW_TEXT, reply_markup=_open_app_keyboard("?new=1"))


async def handle_help(message: Message) -> None:
    await message.answer(HELP_TEXT)


async def handle_lang(message: Message) -> None:
    await message.answer(LANG_TEXT, reply_markup=_open_app_keyboard("?settings=1"))


async def handle_about(message: Message) -> None:
    await message.answer(ABOUT_TEXT)
