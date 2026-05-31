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

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.api.v1.rooms import ROOM_CREATE_RATE_LIMIT_MAX
from hoba_api.models.room import Room
from hoba_api.realtime import server as ws_server
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


def test_room_creation_cap_respects_configured_limit(
    client: TestClient, init_data: str, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The cap is env-configurable (settings -> module constant). Prove the
    # endpoint reads that knob: drop it to 1 and the 2nd create is blocked.
    import hoba_api.api.v1.rooms as rooms_module

    monkeypatch.setattr(rooms_module, "ROOM_CREATE_RATE_LIMIT_MAX", 1)
    headers = {HEADER: init_data}
    r1 = client.post("/api/v1/rooms", json=_payload(label_a="first"), headers=headers)
    assert r1.status_code == 201
    r2 = client.post("/api/v1/rooms", json=_payload(label_a="second"), headers=headers)
    assert r2.status_code == 429
    assert r2.json()["detail"] == "rate_limited"


EmittedSioCall = tuple[str, Any, dict[str, Any]]


@pytest.fixture
def captured_sio_emits(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[list[EmittedSioCall]]:
    """Capture every `sio.emit` call instead of trying to deliver it.

    The PATCH endpoint now broadcasts `room:updated` via the real
    socketio singleton. Tests don't have a live WS namespace mounted,
    so we monkeypatch the emit to a recorder.
    """
    emitted: list[EmittedSioCall] = []

    async def fake_emit(event: str, data: Any = None, **kwargs: Any) -> None:
        emitted.append((event, data, kwargs))

    monkeypatch.setattr(ws_server.sio, "emit", fake_emit)
    yield emitted


def test_patch_room_broadcasts_room_updated(
    client: TestClient,
    init_data: str,
    captured_sio_emits: list[EmittedSioCall],
) -> None:
    # Stage B verification finding: when the host PATCHes spin_policy,
    # guests' snapshots must learn about it without a reconnect.
    headers = {HEADER: init_data}
    create = client.post("/api/v1/rooms", json=_payload(), headers=headers)
    assert create.status_code == 201
    code = create.json()["room"]["code"]
    captured_sio_emits.clear()

    patch = client.patch(
        f"/api/v1/rooms/{code}",
        json={"spin_policy": "host_only"},
        headers=headers,
    )
    assert patch.status_code == 200

    updates = [e for e in captured_sio_emits if e[0] == "room:updated"]
    assert len(updates) == 1
    assert updates[0][1] == {"patch": {"spin_policy": "host_only"}}
    assert updates[0][2].get("room") == code
    assert updates[0][2].get("namespace") == ws_server.NAMESPACE


def test_patch_room_with_empty_payload_does_not_broadcast(
    client: TestClient,
    init_data: str,
    captured_sio_emits: list[EmittedSioCall],
) -> None:
    # No actual fields changed → nothing to tell guests about.
    headers = {HEADER: init_data}
    create = client.post("/api/v1/rooms", json=_payload(), headers=headers)
    assert create.status_code == 201
    code = create.json()["room"]["code"]
    captured_sio_emits.clear()

    patch = client.patch(f"/api/v1/rooms/{code}", json={}, headers=headers)
    assert patch.status_code == 200
    assert [e for e in captured_sio_emits if e[0] == "room:updated"] == []


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


def test_post_room_with_game_mode_field_round_trips(
    client: TestClient, init_data: str,
) -> None:
    payload = {**_payload(), "game_mode": "elimination"}
    resp = client.post("/api/v1/rooms", json=payload, headers={HEADER: init_data})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["room"]["game_mode"] == "elimination"
    # Mode-default derivation: elimination → host_only.
    assert body["room"]["spin_policy"] == "host_only"
    # New field surfaces on the snapshot.
    assert body["room"]["current_turn_user_id"] is None


def test_post_room_without_game_mode_defaults_to_classic_host_only(
    client: TestClient, init_data: str,
) -> None:
    resp = client.post(
        "/api/v1/rooms", json=_payload(), headers={HEADER: init_data},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["room"]["game_mode"] == "classic"
    assert body["room"]["spin_policy"] == "host_only"


def test_post_room_explicit_spin_policy_wins_over_mode(
    client: TestClient, init_data: str,
) -> None:
    payload = {**_payload(), "game_mode": "punishment", "spin_policy": "anyone"}
    resp = client.post("/api/v1/rooms", json=payload, headers={HEADER: init_data})
    assert resp.status_code == 201
    body = resp.json()
    assert body["room"]["game_mode"] == "punishment"
    assert body["room"]["spin_policy"] == "anyone"


async def test_patch_room_to_turn_based_active_broadcasts_cursor(
    client: TestClient,
    db: AsyncSession,
    init_data: str,
    captured_sio_emits: list[EmittedSioCall],
) -> None:
    """When host flips spin_policy to turn_based on an active room, the
    `room:updated` broadcast must carry BOTH spin_policy AND the new
    current_turn_user_id so guests see both updates without reconnect."""
    from sqlalchemy import select

    headers = {HEADER: init_data}
    create = client.post("/api/v1/rooms", json=_payload(), headers=headers)
    assert create.status_code == 201, create.text
    body = create.json()
    code = body["room"]["code"]
    host_id = body["room"]["host_id"]

    # Trip the room into active status using the test-scoped session so we
    # stay on the same in-memory SQLite database as the rest of the test.
    result = await db.execute(select(Room).where(Room.code == code))
    room = result.scalar_one()
    room.status = "active"
    await db.commit()

    captured_sio_emits.clear()
    patch = client.patch(
        f"/api/v1/rooms/{code}",
        json={"spin_policy": "turn_based"},
        headers=headers,
    )
    assert patch.status_code == 200, patch.text

    updates = [e for e in captured_sio_emits if e[0] == "room:updated"]
    assert len(updates) == 1, "expected exactly one room:updated"
    payload = updates[0][1]["patch"]
    assert payload["spin_policy"] == "turn_based"
    assert payload["current_turn_user_id"] == host_id
