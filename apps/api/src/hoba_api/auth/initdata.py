"""Telegram WebApp initData HMAC validation — spec §6.

Algorithm (from <https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app>):

1. Parse the URL-encoded `initData` string into key/value pairs.
2. Extract the `hash` field.
3. Build `data_check_string = "\\n".join(f"{k}={v}" for k, v in sorted(fields))`.
4. `secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)`.
5. `expected = HMAC_SHA256(key=secret_key, msg=data_check_string).hexdigest()`.
6. Constant-time compare `expected` with `hash`.
7. Reject if `auth_date` is older than `max_age_seconds`.

The same module exposes `sign_init_data` — the inverse function — for
generating valid initData strings in tests, debug CLIs, and integration
scaffolding. It is **not** wired into any production code path.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Final
from urllib.parse import parse_qsl, urlencode

from pydantic import BaseModel, Field

_HASH_FIELD: Final = "hash"
_SECRET_KEY_LABEL: Final = b"WebAppData"
_CLOCK_SKEW_GRACE_SECONDS: Final = 60


class InvalidInitData(Exception):
    """Raised when Telegram initData fails any validation step.

    `code` is a stable machine-readable reason (e.g. `hash_mismatch`,
    `auth_date_expired`) safe to return to the client. `message` is
    optional human context for logs.
    """

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


class TelegramUser(BaseModel):
    """The `user` JSON blob inside initData (see Telegram WebApp docs)."""

    id: int
    first_name: str = Field(min_length=1, max_length=128)
    last_name: str | None = Field(default=None, max_length=128)
    username: str | None = Field(default=None, max_length=64)
    language_code: str | None = Field(default=None, max_length=8)
    photo_url: str | None = Field(default=None, max_length=512)


def parse_init_data(init_data: str) -> dict[str, str]:
    """Parse the URL-encoded form Telegram WebApp.initData uses."""
    return dict(parse_qsl(init_data, strict_parsing=True, keep_blank_values=True))


def validate_init_data(
    init_data: str,
    bot_token: str,
    *,
    max_age_seconds: int,
    now: int | None = None,
) -> dict[str, str]:
    """Validate initData and return parsed fields (minus `hash`) on success.

    Raises `InvalidInitData` on any failure.
    """
    if not init_data:
        raise InvalidInitData("missing_init_data")
    if not bot_token:
        raise InvalidInitData("missing_bot_token", "server has no TELEGRAM_BOT_TOKEN")

    try:
        fields = parse_init_data(init_data)
    except ValueError as exc:
        raise InvalidInitData("malformed", str(exc)) from exc

    received_hash = fields.pop(_HASH_FIELD, None)
    if not received_hash:
        raise InvalidInitData("missing_hash")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(_SECRET_KEY_LABEL, bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise InvalidInitData("hash_mismatch")

    auth_date_raw = fields.get("auth_date")
    if not auth_date_raw:
        raise InvalidInitData("missing_auth_date")
    try:
        auth_date = int(auth_date_raw)
    except ValueError as exc:
        raise InvalidInitData("bad_auth_date") from exc

    current = now if now is not None else int(time.time())
    if current - auth_date > max_age_seconds:
        raise InvalidInitData("auth_date_expired")
    if auth_date > current + _CLOCK_SKEW_GRACE_SECONDS:
        raise InvalidInitData("auth_date_future")

    return fields


def parse_telegram_user(fields: dict[str, str]) -> TelegramUser:
    """Pull the `user` JSON blob out of validated initData fields."""
    user_raw = fields.get("user")
    if not user_raw:
        raise InvalidInitData("missing_user")
    try:
        return TelegramUser.model_validate_json(user_raw)
    except ValueError as exc:
        raise InvalidInitData("bad_user_json", str(exc)) from exc


def sign_init_data(fields: dict[str, str], bot_token: str) -> str:
    """Inverse of `validate_init_data` — produce a URL-encoded initData
    string carrying a valid `hash`.

    Used by tests, fixtures, and debug CLIs. Not wired into request flow.
    """
    fields_no_hash = {k: v for k, v in fields.items() if k != _HASH_FIELD}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields_no_hash.items()))
    secret_key = hmac.new(_SECRET_KEY_LABEL, bot_token.encode(), hashlib.sha256).digest()
    signed = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields_no_hash, _HASH_FIELD: signed})
