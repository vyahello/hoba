"""End-to-end tests for `/api/v1/me`."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from tests.conftest import make_init_data

HEADER = "X-Telegram-Init-Data"


def test_get_me_without_header_returns_401(client: TestClient) -> None:
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.json()["detail"] == "missing_init_data"


def test_get_me_with_bad_hash_returns_401(client: TestClient) -> None:
    init = make_init_data()
    tampered = init.replace(init[-4:], "dead")
    r = client.get("/api/v1/me", headers={HEADER: tampered})
    assert r.status_code == 401
    assert r.json()["detail"] == "hash_mismatch"


def test_get_me_with_expired_init_data_returns_401(client: TestClient) -> None:
    old = int(time.time()) - (2 * 24 * 60 * 60)
    init = make_init_data(auth_date=old)
    r = client.get("/api/v1/me", headers={HEADER: init})
    assert r.status_code == 401
    assert r.json()["detail"] == "auth_date_expired"


def test_get_me_valid_returns_user(client: TestClient, init_data: str) -> None:
    r = client.get("/api/v1/me", headers={HEADER: init_data})
    assert r.status_code == 200
    body = r.json()
    assert body["tg_id"] == 42
    assert body["first_name"] == "Volodymyr"
    assert body["language_code"] == "uk"
    assert body["sound_enabled"] is True


def test_get_me_creates_user_then_subsequent_calls_return_same_id(
    client: TestClient, init_data: str,
) -> None:
    first = client.get("/api/v1/me", headers={HEADER: init_data})
    second = client.get("/api/v1/me", headers={HEADER: init_data})
    assert first.json()["id"] == second.json()["id"]


def test_patch_me_updates_fields(client: TestClient, init_data: str) -> None:
    r = client.patch(
        "/api/v1/me",
        headers={HEADER: init_data},
        json={"language_code": "en", "sound_enabled": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["language_code"] == "en"
    assert body["sound_enabled"] is False
    assert body["haptics_enabled"] is True


def test_patch_me_ignores_unknown_fields(client: TestClient, init_data: str) -> None:
    r = client.patch(
        "/api/v1/me",
        headers={HEADER: init_data},
        json={"bogus_field": True},  # unknown → silently ignored, no clobber
    )
    assert r.status_code == 200
    body = client.get("/api/v1/me", headers={HEADER: init_data}).json()
    assert body["language_code"] == "uk"
    assert body["sound_enabled"] is True
    assert "is_anonymous_default" not in body  # setting removed
    assert "music_enabled" not in body  # toggle removed — Sound now gates music


def test_patch_me_rejects_unsupported_language(client: TestClient, init_data: str) -> None:
    r = client.patch(
        "/api/v1/me",
        headers={HEADER: init_data},
        json={"language_code": "fr"},
    )
    assert r.status_code == 422


def test_get_my_stats_returns_zeros(client: TestClient, init_data: str) -> None:
    r = client.get("/api/v1/me/stats", headers={HEADER: init_data})
    assert r.status_code == 200
    assert r.json() == {
        "rooms_created": 0,
        "rooms_joined": 0,
        "spins_triggered": 0,
        "wheels_saved": 0,
    }


def test_get_my_stats_without_header_returns_401(client: TestClient) -> None:
    r = client.get("/api/v1/me/stats")
    assert r.status_code == 401
