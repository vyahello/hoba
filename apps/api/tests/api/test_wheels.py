"""End-to-end HTTP tests for `/api/v1/wheels` (saved-wheel library).

Guards the full request → service → 201 → serialization path that the
service-layer tests skip. Added after a prod 500 where saving a wheel hit
`NOT NULL constraint failed: wheels.created_at` — the service tests passed
because they build the schema from the model, and there was no HTTP create
test exercising the real insert + `WheelOut` serialization.

Note: this still runs against the model-built (`create_all`) test DB, so it
catches endpoint wiring / validation / serialization regressions — not
migration-vs-model drift (that needs a migrated DB; see deploy notes).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import make_init_data

HEADER = "X-Telegram-Init-Data"


def _headers() -> dict[str, str]:
    return {HEADER: make_init_data()}


def _payload() -> dict[str, object]:
    return {
        "title": "What to eat?",
        "segments": [
            {"label": "Pizza", "emoji": "🍕", "color_seed": 0},
            {"label": "Sushi", "emoji": "🍣", "color_seed": 1},
        ],
    }


def test_create_wheel_returns_201_with_full_shape(client: TestClient) -> None:
    r = client.post("/api/v1/wheels", json=_payload(), headers=_headers())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "What to eat?"
    assert body["use_count"] == 0
    assert body["is_public"] is False
    assert body["like_count"] == 0
    assert body["liked"] is False
    assert body["category"] is None
    assert [s["label"] for s in body["segments"]] == ["Pizza", "Sushi"]
    assert "created_at" in body and body["created_at"]  # the field that 500'd in prod


def test_create_then_list_roundtrip(client: TestClient) -> None:
    client.post("/api/v1/wheels", json=_payload(), headers=_headers())
    r = client.get("/api/v1/wheels", headers=_headers())
    assert r.status_code == 200
    titles = [w["title"] for w in r.json()]
    assert "What to eat?" in titles


def test_create_rejects_too_few_segments(client: TestClient) -> None:
    bad = {"title": "Solo", "segments": [{"label": "Only one"}]}
    r = client.post("/api/v1/wheels", json=bad, headers=_headers())
    assert r.status_code == 422  # pydantic min_length=2


def test_use_wheel_creates_room(client: TestClient) -> None:
    created = client.post("/api/v1/wheels", json=_payload(), headers=_headers())
    wheel_id = created.json()["id"]
    r = client.post(
        f"/api/v1/wheels/{wheel_id}/use", json={"game_mode": "classic"}, headers=_headers(),
    )
    assert r.status_code == 200, r.text
    state = r.json()
    assert state["room"]["game_mode"] == "classic"
    assert [s["label"] for s in state["active_question"]["segments"]] == ["Pizza", "Sushi"]


def test_unauthenticated_create_is_401(client: TestClient) -> None:
    r = client.post("/api/v1/wheels", json=_payload())
    assert r.status_code == 401
