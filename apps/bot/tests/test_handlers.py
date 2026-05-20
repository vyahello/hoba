"""Tests for `hoba_bot.handlers`."""

from __future__ import annotations

import pytest
from aiogram.filters import CommandObject
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.user import User
from hoba_bot.handlers import (
    ABOUT_TEXT,
    HELP_TEXT,
    LANG_TEXT,
    NEW_TEXT,
    START_TEXT,
    _extract_room_code,
    _open_app_keyboard,
    handle_about,
    handle_help,
    handle_lang,
    handle_new,
    handle_start,
)
from tests.conftest import make_message_mock, make_tg_user

CMD_START = CommandObject(prefix="/", command="start", args=None)


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ("room_K7M9X2", "K7M9X2"),
        ("room_ABC123", "ABC123"),
        ("ROOM_X", None),
        ("foo_K7M9X2", None),
        ("room_", None),
        ("", None),
        (None, None),
        ("  room_K7M9X2  ", "K7M9X2"),
    ],
)
def test_extract_room_code(payload: str | None, expected: str | None) -> None:
    assert _extract_room_code(payload) == expected


def test_open_app_keyboard_with_webapp_url_returns_button() -> None:
    kb = _open_app_keyboard("?room=K7M9X2")
    assert kb is not None
    button = kb.inline_keyboard[0][0]
    assert button.text == "Open Hoba!"
    assert button.web_app is not None
    assert button.web_app.url.endswith("?room=K7M9X2")


def test_open_app_keyboard_without_webapp_url_returns_none(monkeypatch) -> None:
    from hoba_bot import config as bot_config

    monkeypatch.setattr(bot_config.settings, "webapp_url", None)
    assert _open_app_keyboard() is None


async def test_start_creates_user_in_db(db: AsyncSession) -> None:
    msg = make_message_mock()
    await handle_start(msg, CMD_START, db)

    user = (
        await db.execute(select(User).where(User.tg_id == 42))
    ).scalar_one()
    assert user.first_name == "Volodymyr"
    assert user.tg_username == "vyahello"
    assert user.language_code == "uk"


async def test_start_is_idempotent(db: AsyncSession) -> None:
    msg = make_message_mock()
    await handle_start(msg, CMD_START, db)
    await handle_start(msg, CMD_START, db)
    rows = (await db.execute(select(User).where(User.tg_id == 42))).scalars().all()
    assert len(rows) == 1


async def test_start_without_payload_sends_default_text(db: AsyncSession) -> None:
    msg = make_message_mock()
    await handle_start(msg, CMD_START, db)
    msg.answer.assert_called_once()
    args, kwargs = msg.answer.call_args
    assert args[0] == START_TEXT


async def test_start_with_room_payload_pins_code(db: AsyncSession) -> None:
    msg = make_message_mock()
    cmd = CommandObject(prefix="/", command="start", args="room_K7M9X2")
    await handle_start(msg, cmd, db)

    msg.answer.assert_called_once()
    args, kwargs = msg.answer.call_args
    assert "K7M9X2" in args[0]
    keyboard = kwargs["reply_markup"]
    button_url = keyboard.inline_keyboard[0][0].web_app.url
    assert button_url.endswith("?room=K7M9X2")


async def test_start_without_from_user_is_ignored(db: AsyncSession) -> None:
    msg = make_message_mock()
    msg.from_user = None
    await handle_start(msg, CMD_START, db)
    msg.answer.assert_not_called()
    rows = (await db.execute(select(User))).scalars().all()
    assert rows == []


async def test_new_sends_open_button() -> None:
    msg = make_message_mock()
    await handle_new(msg)
    args, kwargs = msg.answer.call_args
    assert args[0] == NEW_TEXT
    button_url = kwargs["reply_markup"].inline_keyboard[0][0].web_app.url
    assert "?new=1" in button_url


async def test_help_lists_all_five_commands() -> None:
    msg = make_message_mock()
    await handle_help(msg)
    text = msg.answer.call_args.args[0]
    assert text == HELP_TEXT
    for cmd in ("/start", "/new", "/help", "/lang", "/about"):
        assert cmd in text


async def test_lang_directs_to_app_settings() -> None:
    msg = make_message_mock()
    await handle_lang(msg)
    args, kwargs = msg.answer.call_args
    assert args[0] == LANG_TEXT
    button_url = kwargs["reply_markup"].inline_keyboard[0][0].web_app.url
    assert "?settings=1" in button_url


async def test_about_matches_spec_description() -> None:
    msg = make_message_mock()
    await handle_about(msg)
    args, _ = msg.answer.call_args
    assert args[0] == ABOUT_TEXT
    assert "Multiplayer decision wheel" in args[0]
    assert "Rigged 🎭" in args[0]


async def test_start_with_non_uk_language_normalizes(db: AsyncSession) -> None:
    msg = make_message_mock(tg_user=make_tg_user(user_id=99, language_code="fr"))
    await handle_start(msg, CMD_START, db)
    user = (
        await db.execute(select(User).where(User.tg_id == 99))
    ).scalar_one()
    assert user.language_code == "en"
