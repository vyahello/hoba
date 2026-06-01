"""HTTP tests for `/api/v1/moderation` — the report flow + admin review queue.

The admin endpoints are gated on `ADMIN_TG_IDS` (config). Tests flip
`settings.admin_tg_ids` to make the default test user (tg_id 42) an admin,
and restore it after. The report auto-hide threshold is exercised so the
queue has hidden + merely-reported wheels to review.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from hoba_api.config import settings
from hoba_api.services.wheels import REPORT_HIDE_THRESHOLD
from tests.conftest import make_init_data

HEADER = "X-Telegram-Init-Data"
OWNER_TG = 42
ADMIN_TG = 999


def _headers(tg_id: int = OWNER_TG) -> dict[str, str]:
    return {HEADER: make_init_data(user_id=tg_id)}


@pytest.fixture
def admin() -> Iterator[None]:
    """Make tg_id 999 an admin for the duration of the test."""
    original = settings.admin_tg_ids
    settings.admin_tg_ids = str(ADMIN_TG)
    yield
    settings.admin_tg_ids = original


def _publish_wheel(client: TestClient, *, owner_tg: int = OWNER_TG) -> int:
    """Create + publish a wheel owned by `owner_tg`; return its id."""
    created = client.post(
        "/api/v1/wheels",
        json={
            "title": "Spicy takes",
            "segments": [
                {"label": "Pizza", "emoji": "🍕", "color_seed": 0},
                {"label": "Sushi", "emoji": "🍣", "color_seed": 1},
            ],
        },
        headers=_headers(owner_tg),
    )
    wheel_id = created.json()["id"]
    pub = client.post(
        f"/api/v1/wheels/{wheel_id}/publish", json={}, headers=_headers(owner_tg),
    )
    assert pub.status_code == 200, pub.text
    return wheel_id


def _report(client: TestClient, wheel_id: int, *, reporter_tg: int, reason: str | None) -> None:
    r = client.post(
        "/api/v1/moderation/report",
        json={"wheel_id": wheel_id, "reason": reason},
        headers=_headers(reporter_tg),
    )
    assert r.status_code == 204, r.text


# --- admin gate -----------------------------------------------------------


def test_reports_requires_admin(client: TestClient) -> None:
    # No ADMIN_TG_IDS configured → nobody is an admin.
    r = client.get("/api/v1/moderation/reports", headers=_headers())
    assert r.status_code == 403
    assert r.json()["detail"] == "not_admin"


def test_reports_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/moderation/reports")
    assert r.status_code == 401


def test_me_exposes_is_admin_flag(client: TestClient, admin: None) -> None:
    non_admin = client.get("/api/v1/me", headers=_headers(OWNER_TG))
    assert non_admin.json()["is_admin"] is False
    admin_me = client.get("/api/v1/me", headers=_headers(ADMIN_TG))
    assert admin_me.json()["is_admin"] is True


# --- review queue ---------------------------------------------------------


def test_queue_lists_reported_wheel_with_reporters(client: TestClient, admin: None) -> None:
    wheel_id = _publish_wheel(client)
    _report(client, wheel_id, reporter_tg=101, reason="offensive")

    r = client.get("/api/v1/moderation/reports", headers=_headers(ADMIN_TG))
    assert r.status_code == 200, r.text
    queue = r.json()
    assert len(queue) == 1
    item = queue[0]
    assert item["id"] == wheel_id
    assert item["report_count"] == 1
    assert item["is_hidden"] is False
    assert len(item["reports"]) == 1
    assert item["reports"][0]["reason"] == "offensive"
    assert item["reports"][0]["reporter_name"]  # populated from the User row


def test_queue_empty_when_no_reports(client: TestClient, admin: None) -> None:
    _publish_wheel(client)  # published but never reported
    r = client.get("/api/v1/moderation/reports", headers=_headers(ADMIN_TG))
    assert r.json() == []


def test_threshold_hides_and_unhide_restores_and_clears(client: TestClient, admin: None) -> None:
    wheel_id = _publish_wheel(client)
    for i in range(REPORT_HIDE_THRESHOLD):
        _report(client, wheel_id, reporter_tg=200 + i, reason=f"r{i}")

    # Auto-hidden, and no longer visible on trending.
    queue = client.get("/api/v1/moderation/reports", headers=_headers(ADMIN_TG)).json()
    assert queue[0]["is_hidden"] is True
    trending = client.get("/api/v1/trending", headers=_headers()).json()
    assert all(w["id"] != wheel_id for w in trending)

    # Admin un-hides → visible again, reports cleared, queue empties.
    r = client.post(
        f"/api/v1/moderation/wheels/{wheel_id}/unhide", headers=_headers(ADMIN_TG),
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_hidden"] is False
    assert r.json()["report_count"] == 0
    assert client.get("/api/v1/moderation/reports", headers=_headers(ADMIN_TG)).json() == []
    trending = client.get("/api/v1/trending", headers=_headers()).json()
    assert any(w["id"] == wheel_id for w in trending)


def test_admin_hide_takes_down_below_threshold(client: TestClient, admin: None) -> None:
    wheel_id = _publish_wheel(client)
    _report(client, wheel_id, reporter_tg=300, reason="just one report")

    r = client.post(
        f"/api/v1/moderation/wheels/{wheel_id}/hide", headers=_headers(ADMIN_TG),
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_hidden"] is True
    trending = client.get("/api/v1/trending", headers=_headers()).json()
    assert all(w["id"] != wheel_id for w in trending)


def test_unhide_requires_admin(client: TestClient) -> None:
    r = client.post("/api/v1/moderation/wheels/1/unhide", headers=_headers())
    assert r.status_code == 403


def test_unhide_unknown_wheel_404(client: TestClient, admin: None) -> None:
    r = client.post(
        "/api/v1/moderation/wheels/999999/unhide", headers=_headers(ADMIN_TG),
    )
    assert r.status_code == 404
