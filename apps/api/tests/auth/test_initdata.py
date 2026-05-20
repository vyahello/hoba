"""Tests for `hoba_api.auth.initdata` — the HMAC validation core."""

from __future__ import annotations

import json
import time

import pytest

from hoba_api.auth.initdata import (
    InvalidInitData,
    parse_init_data,
    parse_telegram_user,
    sign_init_data,
    validate_init_data,
)
from tests.conftest import BOT_TOKEN, make_init_data

DAY = 24 * 60 * 60


def test_valid_init_data_returns_fields() -> None:
    init = make_init_data(user_id=1, first_name="Alice")
    fields = validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    assert "user" in fields
    assert "auth_date" in fields
    assert "hash" not in fields


def test_missing_init_data_raises() -> None:
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data("", BOT_TOKEN, max_age_seconds=DAY)
    assert exc.value.code == "missing_init_data"


def test_missing_bot_token_raises() -> None:
    init = make_init_data()
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(init, "", max_age_seconds=DAY)
    assert exc.value.code == "missing_bot_token"


def test_missing_hash_raises() -> None:
    fields = parse_init_data(make_init_data())
    fields.pop("hash", None)
    init_without_hash = "&".join(f"{k}={v}" for k, v in fields.items())
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(init_without_hash, BOT_TOKEN, max_age_seconds=DAY)
    assert exc.value.code == "missing_hash"


def test_bad_hash_raises() -> None:
    init = make_init_data()
    tampered = init.replace(init[-4:], "dead")
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(tampered, BOT_TOKEN, max_age_seconds=DAY)
    assert exc.value.code == "hash_mismatch"


def test_wrong_bot_token_raises_hash_mismatch() -> None:
    init = make_init_data()
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(init, "different-bot-token", max_age_seconds=DAY)
    assert exc.value.code == "hash_mismatch"


def test_expired_auth_date_raises() -> None:
    old = int(time.time()) - (2 * DAY)
    init = make_init_data(auth_date=old)
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    assert exc.value.code == "auth_date_expired"


def test_future_auth_date_raises() -> None:
    future = int(time.time()) + 3600
    init = make_init_data(auth_date=future)
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    assert exc.value.code == "auth_date_future"


def test_clock_skew_grace_allows_60s_future() -> None:
    near_future = int(time.time()) + 30
    init = make_init_data(auth_date=near_future)
    fields = validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    assert int(fields["auth_date"]) == near_future


def test_bad_auth_date_raises() -> None:
    fields = {
        "auth_date": "not-a-number",
        "user": json.dumps({"id": 1, "first_name": "x"}),
    }
    init = sign_init_data(fields, BOT_TOKEN)
    with pytest.raises(InvalidInitData) as exc:
        validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    assert exc.value.code == "bad_auth_date"


def test_parse_telegram_user_success() -> None:
    init = make_init_data(user_id=42, first_name="Bob", username="bob42")
    fields = validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    user = parse_telegram_user(fields)
    assert user.id == 42
    assert user.first_name == "Bob"
    assert user.username == "bob42"


def test_parse_telegram_user_missing_field_raises() -> None:
    with pytest.raises(InvalidInitData) as exc:
        parse_telegram_user({"auth_date": "0"})
    assert exc.value.code == "missing_user"


def test_parse_telegram_user_bad_json_raises() -> None:
    with pytest.raises(InvalidInitData) as exc:
        parse_telegram_user({"user": "{not valid json"})
    assert exc.value.code == "bad_user_json"


def test_sign_then_validate_round_trip() -> None:
    fields = {
        "auth_date": str(int(time.time())),
        "user": json.dumps({"id": 7, "first_name": "Round"}),
    }
    init = sign_init_data(fields, BOT_TOKEN)
    parsed = validate_init_data(init, BOT_TOKEN, max_age_seconds=DAY)
    assert parsed["auth_date"] == fields["auth_date"]


def test_now_parameter_overrides_wall_clock() -> None:
    auth = 1_700_000_000
    init = make_init_data(auth_date=auth)
    fields = validate_init_data(
        init, BOT_TOKEN, max_age_seconds=DAY, now=auth + 100,
    )
    assert int(fields["auth_date"]) == auth
