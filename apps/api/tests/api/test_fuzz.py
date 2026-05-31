"""Fuzz pass (spec §12) — malformed payloads must never 500.

Authenticated requests with junk bodies / params across every write route.
The bar is "no unhandled server error": every response is < 500 (a 4xx
rejection is fine; a 5xx is a bug). Validation lives in pydantic + the
service layer, so this guards that nothing slips past into a crash.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_init_data

HEADER = "X-Telegram-Init-Data"

# A grab-bag of nasty string/scalar values reused across fields.
NASTY = [
    "",
    " ",
    "​​​",  # zero-width only
    "a" * 5000,  # oversized
    "'; DROP TABLE rooms;--",
    "<script>alert(1)</script>",
    "🍕" * 200,
    "\x00\x01\x02",
    "../../etc/passwd",
]

# (method, path, list-of-bodies). Bodies are intentionally malformed.
CASES: list[tuple[str, str, list[object]]] = [
    (
        "POST", "/api/v1/rooms",
        [
            {},
            {"question_text": "", "segments": []},
            *(
                {"question_text": s, "segments": [{"label": s}, {"label": s}]}
                for s in NASTY
            ),
            {"question_text": "Q", "segments": "not-a-list"},
            {"question_text": 123, "segments": [{"label": 1}]},
            {"question_text": "Q", "segments": [{"label": "a"}] * 99},
            {"question_text": "Q", "segments": [{"label": "a", "color_seed": -5}] * 2},
            {"question_text": "Q", "segments": [{"label": "a"}], "game_mode": "💥"},
            {"question_text": "Q", "segments": [{"label": "a"}] * 2, "spin_count": 999},
        ],
    ),
    (
        "POST", "/api/v1/rooms/from-template",
        [
            {},
            {"template_key": "nope"},
            {"template_key": ""},
            {"template_key": "eat", "locale": "💥"},
            {"template_key": 42},
            {"template_key": "eat", "game_mode": "💥"},
        ],
    ),
    (
        "POST", "/api/v1/wheels",
        [
            {},
            {"title": "", "segments": []},
            {"title": "a" * 9000, "segments": [{"label": "x"}, {"label": "y"}]},
            {"title": "T", "segments": [{"label": v} for v in ("x", "y")]},
            {"title": "T", "segments": "nope"},
        ],
    ),
    (
        "POST", "/api/v1/moderation/report",
        [
            {},
            {"wheel_id": "abc"},
            {"wheel_id": -1},
            {"wheel_id": 999999, "reason": "x" * 9000},
        ],
    ),
]

GET_CASES: list[str] = [
    "/api/v1/templates?locale=💥",
    "/api/v1/templates?locale=" + "x" * 500,
    "/api/v1/trending?limit=-1",
    "/api/v1/trending?limit=99999&offset=-5",
    "/api/v1/trending?category=💥",
    "/api/v1/trending/search?q=" + "x" * 5000,
    "/api/v1/trending/search?q='; DROP TABLE wheels;--",
    "/api/v1/rooms/%00",
    "/api/v1/rooms/" + "Z" * 200,
]


def _headers() -> dict[str, str]:
    return {HEADER: make_init_data()}


@pytest.mark.parametrize("case", CASES, ids=[c[1] for c in CASES])
def test_post_routes_never_500(client: TestClient, case: tuple[str, str, list[object]]) -> None:
    _method, path, bodies = case
    for body in bodies:
        r = client.post(path, json=body, headers=_headers())
        assert r.status_code < 500, f"{path} 5xx on {body!r}: {r.text}"


@pytest.mark.parametrize("path", GET_CASES)
def test_get_routes_never_500(client: TestClient, path: str) -> None:
    r = client.get(path, headers=_headers())
    assert r.status_code < 500, f"{path} → {r.status_code}: {r.text}"


def test_patch_room_junk_never_500(client: TestClient) -> None:
    for body in [{}, {"spin_policy": "💥"}, {"game_mode": 1}, {"title": "a" * 9000},
                 {"is_locked": "yes"}, {"spin_count": -3}]:
        r = client.patch("/api/v1/rooms/ABCDEF", json=body, headers=_headers())
        assert r.status_code < 500, f"PATCH room 5xx on {body!r}: {r.text}"
