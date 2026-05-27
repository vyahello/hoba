"""End-to-end tests for `/api/v1/rooms` rate-limit gate — Stage B B1.

Per spec §14: 5 room creations / user / hour. The cap is enforced in
the REST endpoint before the service runs, so a spammed creator is
turned away with HTTP 429 rather than running through the full
graph-insert path.

The service layer keeps its own deeper tests in
`tests/services/test_rooms.py`; this file covers the API-layer
limit only.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from hoba_api.api.v1.rooms import ROOM_CREATE_RATE_LIMIT_MAX
from tests.conftest import make_init_data

HEADER = "X-Telegram-Init-Data"


def _payload(label_a: str = "Pizza", label_b: str = "Sushi") -> dict[str, object]:
    return {
        "question_text": "Lunch?",
        "segments": [
            {"label": label_a, "emoji": "🍕", "color_seed": 0, "weight": 1},
            {"label": label_b, "emoji": "🍣", "color_seed": 1, "weight": 1},
        ],
    }


def test_room_creation_hourly_cap_blocks_after_max(
    client: TestClient, init_data: str,
) -> None:
    headers = {HEADER: init_data}
    for i in range(ROOM_CREATE_RATE_LIMIT_MAX):
        r = client.post(
            "/api/v1/rooms", json=_payload(label_a=f"A{i}"), headers=headers,
        )
        assert r.status_code == 201, f"room {i} expected to succeed"
    r = client.post("/api/v1/rooms", json=_payload(label_a="overflow"), headers=headers)
    assert r.status_code == 429
    assert r.json()["detail"] == "rate_limited"


def test_room_creation_cap_is_per_user(
    client: TestClient, init_data: str,
) -> None:
    headers_user_a = {HEADER: init_data}
    headers_user_b = {HEADER: make_init_data(user_id=12345, first_name="Other")}
    # User A burns through the whole cap…
    for i in range(ROOM_CREATE_RATE_LIMIT_MAX):
        r = client.post(
            "/api/v1/rooms", json=_payload(label_a=f"A{i}"), headers=headers_user_a,
        )
        assert r.status_code == 201
    # …and User B can still create.
    r = client.post(
        "/api/v1/rooms", json=_payload(label_a="B0"), headers=headers_user_b,
    )
    assert r.status_code == 201
