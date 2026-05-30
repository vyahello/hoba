"""Socket.IO `/rooms` namespace handler tests.

Closing the Phase 6 test-coverage gap: `realtime/handlers.py` was
excluded from coverage at MVP ship. We exercise it here by registering
the handlers against a `FakeSocketIO` test double that records every
emit/save_session/enter_room/leave_room call. The handlers then run
verbatim against the real DB + fakeredis stack from `conftest.py`.

This is intentionally **not** a full python-socketio.AsyncClient
roundtrip — that needs a live ASGI server and adds substantial flake.
Stage A coverage is "does the handler do the right thing when called";
end-to-end protocol soundness lives in the two-device manual verify.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from hoba_api.auth.initdata import sign_init_data
from hoba_api.realtime.handlers import (
    REACTIONS_PER_WINDOW,
    SPIN_RATE_LIMIT_MAX,
    _emit_settled,
    _extract_init_data,
    _spin_cooldown_key,
    register_handlers,
)
from hoba_api.realtime.server import NAMESPACE
from hoba_api.services.rooms import SegmentDraft, create_room
from hoba_api.services.users import upsert_from_telegram
from tests.conftest import BOT_TOKEN

EmittedCall = tuple[str, dict[str, Any], dict[str, Any]]


class FakeSocketIO:
    """Duck-typed replacement for `socketio.AsyncServer` in tests.

    Records every outbound emit and the room transitions, exposes
    session storage as an in-memory dict, and lets tests look up the
    registered handler functions by name to invoke them directly.
    """

    def __init__(self) -> None:
        self.handlers: dict[str, dict[str, Callable[..., Awaitable[Any]]]] = {}
        self.emitted: list[EmittedCall] = []
        self.sessions: dict[tuple[str, str], dict[str, Any]] = {}
        self.rooms_joined: list[tuple[str, str, str]] = []
        self.rooms_left: list[tuple[str, str, str]] = []

    def on(
        self, event: str, *, namespace: str,
    ) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
        def decorator(
            fn: Callable[..., Awaitable[Any]],
        ) -> Callable[..., Awaitable[Any]]:
            self.handlers.setdefault(namespace, {})[event] = fn
            return fn

        return decorator

    async def emit(
        self,
        event: str,
        data: dict[str, Any] | None = None,
        *,
        room: str | None = None,
        to: str | None = None,
        namespace: str | None = None,
        skip_sid: str | None = None,
    ) -> None:
        self.emitted.append(
            (
                event,
                data or {},
                {
                    "room": room,
                    "to": to,
                    "namespace": namespace,
                    "skip_sid": skip_sid,
                },
            ),
        )

    async def save_session(
        self, sid: str, session: dict[str, Any], namespace: str,
    ) -> None:
        self.sessions[(namespace, sid)] = session

    async def get_session(
        self, sid: str, namespace: str,
    ) -> dict[str, Any]:
        if (namespace, sid) not in self.sessions:
            raise KeyError(sid)
        return self.sessions[(namespace, sid)]

    async def enter_room(self, sid: str, room: str, namespace: str) -> None:
        self.rooms_joined.append((sid, room, namespace))

    async def leave_room(self, sid: str, room: str, namespace: str) -> None:
        self.rooms_left.append((sid, room, namespace))

    async def call(self, event: str, *args: Any) -> Any:
        """Dispatch a registered handler by name with positional args."""
        return await self.handlers[NAMESPACE][event](*args)

    def events_named(self, event: str) -> list[EmittedCall]:
        return [e for e in self.emitted if e[0] == event]


@pytest.fixture
def sio() -> FakeSocketIO:
    s = FakeSocketIO()
    register_handlers(s)  # type: ignore[arg-type]
    return s


def make_init_data(user_id: int = 99) -> str:
    user = {"id": user_id, "first_name": "Tester", "username": "tg_test"}
    return sign_init_data(
        {
            "auth_date": str(int(time.time())),
            "query_id": "AAH_q",
            "user": json.dumps(user, separators=(",", ":")),
        },
        BOT_TOKEN,
    )


# ---------- _extract_init_data ------------------------------------------


def test_extract_init_data_prefers_auth_over_query() -> None:
    environ = {"QUERY_STRING": "initData=fromquery"}
    auth = {"initData": "fromauth"}
    assert _extract_init_data(environ, auth) == "fromauth"


def test_extract_init_data_falls_back_to_query() -> None:
    environ = {"QUERY_STRING": "initData=fromquery&other=x"}
    assert _extract_init_data(environ, None) == "fromquery"


def test_extract_init_data_returns_none_when_missing() -> None:
    assert _extract_init_data({}, None) is None
    assert _extract_init_data({"QUERY_STRING": ""}, None) is None
    assert _extract_init_data({"QUERY_STRING": "foo=bar"}, None) is None
    assert _extract_init_data({}, {"initData": ""}) is None


# ---------- connect / disconnect ----------------------------------------


@pytest.mark.asyncio
async def test_connect_rejected_without_init_data(sio: FakeSocketIO) -> None:
    accepted = await sio.call("connect", "sid-A", {"QUERY_STRING": ""}, None)
    assert accepted is False
    assert (NAMESPACE, "sid-A") not in sio.sessions


@pytest.mark.asyncio
async def test_connect_rejected_on_invalid_init_data(sio: FakeSocketIO) -> None:
    accepted = await sio.call(
        "connect", "sid-A", {"QUERY_STRING": ""}, {"initData": "garbage"},
    )
    assert accepted is False


@pytest.mark.asyncio
async def test_connect_accepted_with_valid_init_data(sio: FakeSocketIO) -> None:
    init_data = make_init_data(user_id=42)
    accepted = await sio.call(
        "connect", "sid-A", {"QUERY_STRING": ""}, {"initData": init_data},
    )
    assert accepted is True
    session = sio.sessions[(NAMESPACE, "sid-A")]
    assert "user_id" in session and isinstance(session["user_id"], int)


@pytest.mark.asyncio
async def test_disconnect_unknown_sid_is_quiet(sio: FakeSocketIO) -> None:
    # No session means we never connected — handler should no-op without
    # raising, and emit nothing.
    await sio.call("disconnect", "ghost-sid")
    assert sio.emitted == []


# ---------- room:join ----------------------------------------------------


async def _connect(sio: FakeSocketIO, sid: str, user_id: int) -> int:
    init_data = make_init_data(user_id=user_id)
    await sio.call("connect", sid, {"QUERY_STRING": ""}, {"initData": init_data})
    return sio.sessions[(NAMESPACE, sid)]["user_id"]


async def _create_room(db: Any, host_id: int) -> str:
    room = await create_room(
        db,
        host_id=host_id,
        question_text="Pick lunch",
        segments=[
            SegmentDraft(label="Pizza", emoji="🍕", color_seed=0, weight=1),
            SegmentDraft(label="Sushi", emoji="🍣", color_seed=1, weight=1),
        ],
        title=None,
        spin_policy="host_only",
        suggestion_policy="off",
    )
    await db.commit()
    return room.code


@pytest.mark.asyncio
async def test_room_join_unauthenticated_rejected(sio: FakeSocketIO) -> None:
    # Manually seat a session WITHOUT user_id (simulating a partial
    # connect that somehow skipped auth — defensive coverage).
    sio.sessions[(NAMESPACE, "sid-x")] = {}
    await sio.call("room:join", "sid-x", {"code": "ABCDEF"})
    errors = sio.events_named("error")
    assert any(e[1].get("code") == "unauthenticated" for e in errors)


@pytest.mark.asyncio
async def test_room_join_bad_payload_rejected(sio: FakeSocketIO, db: Any) -> None:
    user = await upsert_from_telegram(
        db, _tg_user_for_handlers(user_id=1),
    )
    await db.commit()
    sio.sessions[(NAMESPACE, "sid-1")] = {"user_id": user.id}
    await sio.call("room:join", "sid-1", {})
    assert any(
        e[1].get("code") == "bad_payload"
        for e in sio.events_named("error")
    )


@pytest.mark.asyncio
async def test_room_join_missing_room_emits_error(
    sio: FakeSocketIO, db: Any,
) -> None:
    user = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=2))
    await db.commit()
    sio.sessions[(NAMESPACE, "sid-2")] = {"user_id": user.id}
    await sio.call("room:join", "sid-2", {"code": "ZZZZZZ"})
    assert any(
        e[1].get("code") == "room_not_found"
        for e in sio.events_named("error")
    )


@pytest.mark.asyncio
async def test_room_join_happy_path(sio: FakeSocketIO, db: Any) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=10))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    # Guest connects + joins.
    guest_uid = await _connect(sio, "sid-guest", user_id=20)
    sio.emitted.clear()
    await sio.call("room:join", "sid-guest", {"code": code})

    # room:state goes only to the joining sid; room:participant_joined
    # broadcasts to everyone else.
    state_events = sio.events_named("room:state")
    join_events = sio.events_named("room:participant_joined")
    assert len(state_events) == 1
    assert state_events[0][2]["to"] == "sid-guest"
    assert len(join_events) == 1
    assert join_events[0][1] == {"user_id": guest_uid}
    assert join_events[0][2]["room"] == code
    assert join_events[0][2]["skip_sid"] == "sid-guest"

    # Session now carries the room_id + room_code, and the sid is in
    # the room.
    sess = sio.sessions[(NAMESPACE, "sid-guest")]
    assert sess["room_code"] == code
    assert ("sid-guest", code, NAMESPACE) in sio.rooms_joined


# ---------- spin:trigger ------------------------------------------------


@pytest.mark.asyncio
async def test_spin_trigger_host_only_blocks_guest(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=30))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    guest_uid = await _connect(sio, "sid-g", user_id=31)
    await sio.call("room:join", "sid-g", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-g", {})
    errors = sio.events_named("error")
    assert any(e[1].get("code") == "not_allowed_to_spin" for e in errors)
    assert sio.events_named("spin:started") == []
    assert guest_uid != host.id  # sanity


@pytest.mark.asyncio
async def test_spin_trigger_host_emits_announced_started(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=40))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-h", user_id=40)
    # Connect re-upserts; the host user_id from the session matches the
    # row we created above via tg_id collision.
    await sio.call("room:join", "sid-h", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-h", {})
    assert len(sio.events_named("spin:announced")) == 1
    assert len(sio.events_named("spin:started")) == 1
    payload = sio.events_named("spin:started")[0][1]
    assert "spin_id" in payload
    assert "duration_ms" in payload
    assert "result_segment_id" in payload


@pytest.mark.asyncio
async def test_spin_trigger_turn_based_lobby_allows_host_first_spin(
    sio: FakeSocketIO, db: Any,
) -> None:
    # Regression: a room created turn_based (e.g. Punishment) starts in
    # lobby with a null cursor. The host's FIRST spin must be allowed —
    # on_spin_trigger's permission check runs BEFORE trigger_spin seeds
    # the cursor, so user_can_spin has to treat the host as the lobby
    # turn-holder. Previously this rejected the host with
    # not_allowed_to_spin ("Only the host can spin right now"), so a
    # Punishment room could never start.
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=70))
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[
            SegmentDraft(label="a", color_seed=0, weight=1),
            SegmentDraft(label="b", color_seed=1, weight=1),
        ],
        spin_policy="turn_based",
    )
    await db.commit()
    assert room.status == "lobby"
    assert room.current_turn_user_id is None
    code = room.code

    await _connect(sio, "sid-h70", user_id=70)
    await sio.call("room:join", "sid-h70", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-h70", {})
    assert not any(
        e[1].get("code") == "not_allowed_to_spin"
        for e in sio.events_named("error")
    )
    assert len(sio.events_named("spin:announced")) == 1
    assert len(sio.events_named("spin:started")) == 1


@pytest.mark.asyncio
async def test_spin_trigger_first_spin_broadcasts_active_status(
    sio: FakeSocketIO, db: Any,
) -> None:
    # The lobby->active transition happens inside trigger_spin but was
    # never broadcast, so other clients kept a stale snapshot.room.status
    # of "lobby" until a reconnect. The first spin must emit room:updated
    # with the new status so every client stays in sync.
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=80))
    await db.commit()
    code = await _create_room(db, host_id=host.id)  # host_only, lobby

    await _connect(sio, "sid-h80", user_id=80)
    await sio.call("room:join", "sid-h80", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-h80", {})
    patches = [
        e[1]["patch"]
        for e in sio.events_named("room:updated")
        if isinstance(e[1], dict) and "patch" in e[1]
    ]
    assert any(p.get("status") == "active" for p in patches)


# ---------- turn_based: _emit_settled cursor advance + room:updated ------


async def _create_turn_based_room_with_guest(db: Any, host_id: int, guest_id: int) -> str:
    """Create a turn_based room in active status with cursor=host. Returns code."""
    from hoba_api.models.participant import Participant
    from hoba_api.redis_client import presence_set

    room = await create_room(
        db,
        host_id=host_id,
        question_text="Q?",
        segments=[
            SegmentDraft(label="a", color_seed=0, weight=1),
            SegmentDraft(label="b", color_seed=1, weight=1),
        ],
        spin_policy="turn_based",
    )
    db.add(Participant(room_id=room.id, user_id=guest_id, role="guest"))
    await db.flush()
    room.status = "active"
    room.current_turn_user_id = host_id
    await db.commit()
    await presence_set(room.id, host_id)
    await presence_set(room.id, guest_id)
    return room.code


@pytest.mark.asyncio
async def test_emit_settled_turn_based_advances_cursor_and_broadcasts(
    sio: FakeSocketIO, db: Any,
) -> None:
    """After spin:settled, advance_turn fires and room:updated emits the new cursor."""
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=400))
    guest = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=401))
    code = await _create_turn_based_room_with_guest(db, host.id, guest.id)
    # Look up the room.id for direct _emit_settled call.
    from hoba_api.services.rooms import get_room_by_code

    room = await get_room_by_code(db, code)
    assert room is not None
    sio.emitted.clear()

    # duration_ms=0 keeps the test fast — asyncio.sleep(0) yields immediately.
    await _emit_settled(sio, code, room.id, spin_id=1, result_segment_id=1, duration_ms=0)  # type: ignore[arg-type]

    settled = sio.events_named("spin:settled")
    assert len(settled) == 1
    updates = sio.events_named("room:updated")
    assert len(updates) == 1
    assert updates[0][1] == {"patch": {"current_turn_user_id": guest.id}}
    assert updates[0][2].get("room") == code
    assert updates[0][2].get("namespace") == NAMESPACE


@pytest.mark.asyncio
async def test_spin_trigger_turn_based_rejects_off_turn_user(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=410))
    guest = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=411))
    code = await _create_turn_based_room_with_guest(db, host.id, guest.id)

    await _connect(sio, "sid-grb", user_id=411)
    await sio.call("room:join", "sid-grb", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-grb", {})
    errors = sio.events_named("error")
    assert any(e[1].get("code") == "not_allowed_to_spin" for e in errors)
    assert sio.events_named("spin:started") == []


@pytest.mark.asyncio
async def test_emit_settled_skips_advance_when_policy_changed_mid_spin(
    sio: FakeSocketIO, db: Any,
) -> None:
    """If host PATCHed away from turn_based during the spin, advance is skipped."""
    from hoba_api.services.rooms import get_room_by_code

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=420))
    guest = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=421))
    code = await _create_turn_based_room_with_guest(db, host.id, guest.id)
    room = await get_room_by_code(db, code)
    assert room is not None
    # Simulate policy flip while the settle timer is pending — happens before
    # _emit_settled re-fetches the room.
    room.spin_policy = "anyone"
    room.current_turn_user_id = None
    await db.commit()
    sio.emitted.clear()

    await _emit_settled(sio, code, room.id, spin_id=2, result_segment_id=1, duration_ms=0)  # type: ignore[arg-type]

    assert len(sio.events_named("spin:settled")) == 1
    # No room:updated for cursor — policy is no longer turn_based.
    assert sio.events_named("room:updated") == []


@pytest.mark.asyncio
async def test_spin_trigger_outside_room_errors(sio: FakeSocketIO) -> None:
    sio.sessions[(NAMESPACE, "sid-floating")] = {"user_id": 1}
    await sio.call("spin:trigger", "sid-floating", {})
    assert any(
        e[1].get("code") == "not_in_room"
        for e in sio.events_named("error")
    )


@pytest.mark.asyncio
async def test_spin_trigger_cooldown_blocks_rapid_repeat(
    sio: FakeSocketIO, db: Any,
) -> None:
    # B1 — anti-thumb-mashing: second spin within the cooldown window
    # (~1.5 s) must be rejected with rate_limited, never reaching the
    # spin service. First spin still goes through.
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=110))
    await db.commit()
    code = await _create_room(db, host_id=host.id)
    await _connect(sio, "sid-cd", user_id=110)
    await sio.call("room:join", "sid-cd", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-cd", {})
    await sio.call("spin:trigger", "sid-cd", {})

    started = sio.events_named("spin:started")
    errors = sio.events_named("error")
    assert len(started) == 1, "exactly one spin should fire"
    assert any(e[1].get("code") == "rate_limited" for e in errors)


@pytest.mark.asyncio
async def test_guest_rejection_does_not_burn_cooldown(
    sio: FakeSocketIO, db: Any,
) -> None:
    # Stage B verification finding: a guest's `not_allowed_to_spin`
    # tap in a `host_only` room must not consume the per-room 1.5 s
    # cooldown. Before the reorder, the second guest tap returned
    # `rate_limited` (cooldown hit) instead of the more accurate
    # `not_allowed_to_spin`, AND the host couldn't spin immediately
    # after the guest's burst because the cooldown was held.
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=200))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-guest", user_id=201)
    await sio.call("room:join", "sid-guest", {"code": code})
    sio.emitted.clear()

    # Guest tries twice in rapid succession — both must surface the
    # permission error, never the cooldown error.
    await sio.call("spin:trigger", "sid-guest", {})
    await sio.call("spin:trigger", "sid-guest", {})
    errors = sio.events_named("error")
    codes = [e[1].get("code") for e in errors]
    assert codes.count("not_allowed_to_spin") == 2
    assert "rate_limited" not in codes

    # Host can still spin immediately — cooldown wasn't consumed.
    await _connect(sio, "sid-host", user_id=200)
    await sio.call("room:join", "sid-host", {"code": code})
    sio.emitted.clear()
    await sio.call("spin:trigger", "sid-host", {})
    assert len(sio.events_named("spin:started")) == 1


@pytest.mark.asyncio
async def test_spin_trigger_hourly_cap_blocks_after_max(
    sio: FakeSocketIO,
    db: Any,
    fake_redis: Any,
) -> None:
    # B1 — spec §14: 30 spins/room/hour. Drop the cooldown between
    # attempts so we can test the hourly gate in isolation; otherwise
    # the 1.5 s cooldown is always the active throttle.
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=120))
    await db.commit()
    room_code = await _create_room(db, host_id=host.id)
    await _connect(sio, "sid-hc", user_id=120)
    await sio.call("room:join", "sid-hc", {"code": room_code})
    sio.emitted.clear()

    sess = sio.sessions[(NAMESPACE, "sid-hc")]
    cooldown_key = _spin_cooldown_key(sess["room_id"])

    for _ in range(SPIN_RATE_LIMIT_MAX):
        await fake_redis.delete(cooldown_key)
        await sio.call("spin:trigger", "sid-hc", {})

    assert len(sio.events_named("spin:started")) == SPIN_RATE_LIMIT_MAX
    assert sio.events_named("error") == []

    await fake_redis.delete(cooldown_key)
    await sio.call("spin:trigger", "sid-hc", {})
    errors = sio.events_named("error")
    assert any(e[1].get("code") == "rate_limited" for e in errors)
    # Still only MAX spins fired — the 31st was blocked.
    assert len(sio.events_named("spin:started")) == SPIN_RATE_LIMIT_MAX


# ---------- reaction:send ----------------------------------------------


@pytest.mark.asyncio
async def test_reaction_send_broadcasts_to_room(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=50))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-r", user_id=50)
    await sio.call("room:join", "sid-r", {"code": code})
    sio.emitted.clear()

    await sio.call("reaction:send", "sid-r", {"emoji": "🔥"})
    events = sio.events_named("reaction:received")
    assert len(events) == 1
    assert events[0][1]["emoji"] == "🔥"
    assert events[0][2]["room"] == code


@pytest.mark.asyncio
async def test_reaction_send_rate_limited_at_eleventh_in_window(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=60))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-rl", user_id=60)
    await sio.call("room:join", "sid-rl", {"code": code})
    sio.emitted.clear()

    # First `REACTIONS_PER_WINDOW` go through, the next one trips the limit.
    for _ in range(REACTIONS_PER_WINDOW):
        await sio.call("reaction:send", "sid-rl", {"emoji": "🎉"})
    assert len(sio.events_named("reaction:received")) == REACTIONS_PER_WINDOW
    assert sio.events_named("error") == []

    await sio.call("reaction:send", "sid-rl", {"emoji": "🎉"})
    errors = sio.events_named("error")
    assert any(e[1].get("code") == "rate_limited" for e in errors)


@pytest.mark.asyncio
async def test_reaction_send_rejects_bad_emoji(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=70))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-bad", user_id=70)
    await sio.call("room:join", "sid-bad", {"code": code})
    sio.emitted.clear()

    await sio.call("reaction:send", "sid-bad", {"emoji": ""})  # empty
    await sio.call("reaction:send", "sid-bad", {"emoji": "x" * 100})  # too long
    await sio.call("reaction:send", "sid-bad", {})  # missing
    assert sio.events_named("reaction:received") == []


# ---------- room:leave + disconnect cleanup -----------------------------


@pytest.mark.asyncio
async def test_room_leave_clears_session_and_broadcasts(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=80))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-l", user_id=80)
    await sio.call("room:join", "sid-l", {"code": code})
    sio.emitted.clear()

    await sio.call("room:leave", "sid-l")
    sess = sio.sessions[(NAMESPACE, "sid-l")]
    assert "room_code" not in sess
    assert ("sid-l", code, NAMESPACE) in sio.rooms_left
    assert any(
        e[0] == "room:participant_left"
        for e in sio.emitted
    )


@pytest.mark.asyncio
async def test_disconnect_with_room_emits_participant_left(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=90))
    await db.commit()
    code = await _create_room(db, host_id=host.id)

    await _connect(sio, "sid-d", user_id=90)
    await sio.call("room:join", "sid-d", {"code": code})
    sio.emitted.clear()

    await sio.call("disconnect", "sid-d")
    left = sio.events_named("room:participant_left")
    assert len(left) == 1
    assert left[0][2]["room"] == code


# ---------- presence:ping ----------------------------------------------


@pytest.mark.asyncio
async def test_presence_ping_outside_room_is_noop(sio: FakeSocketIO) -> None:
    sio.sessions[(NAMESPACE, "sid-pp")] = {"user_id": 1}
    await sio.call("presence:ping", "sid-pp")
    assert sio.emitted == []


@pytest.mark.asyncio
async def test_presence_ping_inside_room_touches_presence(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=100))
    await db.commit()
    code = await _create_room(db, host_id=host.id)
    await _connect(sio, "sid-pi", user_id=100)
    await sio.call("room:join", "sid-pi", {"code": code})
    sio.emitted.clear()

    await sio.call("presence:ping", "sid-pi")
    # No outbound emit; this just bumps Redis + DB last_seen_at.
    assert sio.emitted == []


# ---------- elimination: _emit_settled marks winner + aftereffects ------


@pytest.mark.asyncio
async def test_emit_settled_elimination_marks_winner_and_aftereffects(
    sio: FakeSocketIO, db: Any,
) -> None:
    from sqlalchemy import select

    from hoba_api.models.question import Question
    from hoba_api.models.segment import Segment
    from hoba_api.services.rooms import get_room_by_code

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=90))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1),
                  SegmentDraft(label="c", color_seed=2, weight=1)],
        spin_policy="anyone", game_mode="elimination",
    )
    await db.commit()
    q = (await db.execute(
        select(Question).where(Question.room_id == room.id, Question.is_active.is_(True))
    )).scalar_one()
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    winner = segs[0]
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    sio.emitted.clear()

    await _emit_settled(  # type: ignore[arg-type]
        sio, room.code, fetched.id, spin_id=1, result_segment_id=winner.id, duration_ms=0,
    )

    settled = sio.events_named("spin:settled")
    assert settled, "expected a spin:settled emit"
    after = settled[-1][1]["mode_aftereffects"]
    assert after["eliminated_segment_id"] == winner.id
    assert after["remaining"] == 2
    assert after["round_over"] is False
    await db.refresh(winner)
    assert winner.eliminated_at is not None


# ---------- round:reset handler -----------------------------------------


@pytest.mark.asyncio
async def test_round_reset_host_revives_segments_and_broadcasts(
    sio: FakeSocketIO, db: Any,
) -> None:
    from datetime import UTC, datetime

    from sqlalchemy import select

    from hoba_api.models.question import Question
    from hoba_api.models.segment import Segment

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=95))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="elimination",
    )
    q = (await db.execute(
        select(Question).where(Question.room_id == room.id, Question.is_active.is_(True))
    )).scalar_one()
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    segs[0].eliminated_at = datetime.now(UTC)
    await db.commit()
    code = room.code

    await _connect(sio, "sid-h95", user_id=95)
    await sio.call("room:join", "sid-h95", {"code": code})
    sio.emitted.clear()

    await sio.call("round:reset", "sid-h95")
    assert sio.events_named("round:reset"), "expected a round:reset broadcast"
    await db.refresh(segs[0])
    assert segs[0].eliminated_at is None


@pytest.mark.asyncio
async def test_round_reset_guest_rejected(sio: FakeSocketIO, db: Any) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=96))
    await db.commit()
    code = await _create_room(db, host_id=host.id)  # host_only classic, but host_id=96
    await _connect(sio, "sid-g96", user_id=97)
    await sio.call("room:join", "sid-g96", {"code": code})
    sio.emitted.clear()
    await sio.call("round:reset", "sid-g96")
    assert any(e[1].get("code") == "not_host" for e in sio.events_named("error"))


# ---------- helper ------------------------------------------------------


def _tg_user_for_handlers(user_id: int) -> Any:
    from hoba_api.auth.initdata import TelegramUser

    return TelegramUser.model_validate(
        {
            "id": user_id,
            "first_name": "Tester",
            "last_name": None,
            "username": "t",
            "language_code": "en",
            "photo_url": None,
        },
    )


async def _create_punishment_room(db: Any, host_id: int) -> Any:
    return await create_room(
        db, host_id=host_id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="punishment", punishment_deck="mild",
    )


async def _latest_spin(db: Any, room_id: int) -> Any:
    from sqlalchemy import select

    from hoba_api.models.question import Question
    from hoba_api.models.spin import Spin

    return (
        await db.execute(
            select(Spin)
            .join(Question, Spin.question_id == Question.id)
            .where(Question.room_id == room_id)
            .order_by(Spin.id.desc())
            .limit(1),
        )
    ).scalar_one()


async def _punishment_segment_ids(db: Any, room_id: int) -> list[int]:
    from sqlalchemy import select

    from hoba_api.models.question import Question
    from hoba_api.models.segment import Segment

    question_id = (
        await db.execute(
            select(Question.id).where(
                Question.room_id == room_id, Question.is_active.is_(True),
            ),
        )
    ).scalar_one()
    return list(
        (
            await db.execute(
                select(Segment.id)
                .where(
                    Segment.parent_id == question_id,
                    Segment.parent_type == "question",
                )
                .order_by(Segment.position),
            )
        ).scalars().all(),
    )


@pytest.mark.asyncio
async def test_punishment_non_host_spin_rejected(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=1890))
    room = await _create_punishment_room(db, host_id=host.id)
    await db.commit()
    code = room.code
    await _connect(sio, "sid-ph", user_id=1890)
    await sio.call("room:join", "sid-ph", {"code": code})
    guest_uid = await _connect(sio, "sid-pg", user_id=1891)
    await sio.call("room:join", "sid-pg", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-pg", {})
    assert any(e[1].get("code") == "not_host" for e in sio.events_named("error"))
    assert sio.events_named("spin:started") == []
    assert guest_uid != host.id


@pytest.mark.asyncio
async def test_punishment_host_spin_blocked_until_all_locked(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=1990))
    room = await _create_punishment_room(db, host_id=host.id)
    await db.commit()
    code = room.code
    await _connect(sio, "sid-ph2", user_id=1990)
    await sio.call("room:join", "sid-ph2", {"code": code})
    # A second present player who has NOT locked a prediction.
    await _connect(sio, "sid-pg2", user_id=1991)
    await sio.call("room:join", "sid-pg2", {"code": code})
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-ph2", {})
    assert any(
        e[1].get("code") == "predictions_pending"
        for e in sio.events_named("error")
    )
    assert sio.events_named("spin:started") == []


@pytest.mark.asyncio
async def test_punishment_host_force_spin_resolves_losers(
    sio: FakeSocketIO, db: Any,
) -> None:
    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=2090))
    guest = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=2091))
    room = await _create_punishment_room(db, host_id=host.id)
    await db.commit()
    code = room.code
    room_id = room.id
    seg_ids = await _punishment_segment_ids(db, room_id)

    await _connect(sio, "sid-ph3", user_id=2090)
    await sio.call("room:join", "sid-ph3", {"code": code})
    await _connect(sio, "sid-pg3", user_id=2091)
    await sio.call("room:join", "sid-pg3", {"code": code})

    # Host predicts seg[0], guest predicts seg[1]: whichever the wheel
    # lands on, exactly one of them is wrong → exactly one card dealt.
    from hoba_api.services.rooms import get_room_by_code

    refreshed = await get_room_by_code(db, code)
    assert refreshed is not None
    refreshed.punishment_predictions = {
        str(host.id): seg_ids[0],
        str(guest.id): seg_ids[1],
    }
    await db.commit()
    sio.emitted.clear()

    # Force bypasses the all-locked gate: the spin proceeds (no
    # predictions_pending error, spin:started fires). The settle that
    # draws cards is scheduled as a background task with the real spin
    # duration, so rather than racing it we drive the resolution
    # deterministically via _emit_settled (matches the turn_based settle
    # tests' convention).
    await sio.call("spin:trigger", "sid-ph3", {"force": True})
    assert not any(
        e[1].get("code") == "predictions_pending"
        for e in sio.events_named("error")
    )
    assert sio.events_named("spin:started")

    spin = await _latest_spin(db, room_id)
    result_seg = spin.result_segment_id
    sio.emitted.clear()
    await _emit_settled(  # type: ignore[arg-type]
        sio, code, room_id,
        spin_id=spin.id, result_segment_id=result_seg, duration_ms=0,
    )

    after = sio.events_named("spin:settled")[-1][1]["mode_aftereffects"]
    assert after["punishment_result_segment_id"] == result_seg
    cards = after["punishment_cards"]
    # result lands on one of the 2 segments → exactly one prediction wrong.
    assert len(cards) == 1
    assert after["everyone_escaped"] is False
    loser = host.id if seg_ids[0] != result_seg else guest.id
    assert str(loser) in cards

    patches = [
        e[1]["patch"]
        for e in sio.events_named("room:updated")
        if isinstance(e[1], dict) and "patch" in e[1]
    ]
    assert any("punishment_cards" in p for p in patches)

    persisted = await get_room_by_code(db, code)
    assert persisted is not None
    await db.refresh(persisted)
    assert persisted.punishment_cards is not None
    assert str(loser) in persisted.punishment_cards


@pytest.mark.asyncio
async def test_punishment_spin_rejected_when_round_resolved(
    sio: FakeSocketIO, db: Any,
) -> None:
    from hoba_api.services.rooms import get_room_by_code

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=2190))
    room = await _create_punishment_room(db, host_id=host.id)
    await db.commit()
    code = room.code
    await _connect(sio, "sid-ph4", user_id=2190)
    await sio.call("room:join", "sid-ph4", {"code": code})
    refreshed = await get_room_by_code(db, code)
    assert refreshed is not None
    refreshed.punishment_cards = {}
    await db.commit()
    sio.emitted.clear()

    await sio.call("spin:trigger", "sid-ph4", {"force": True})
    assert any(
        e[1].get("code") == "round_resolved" for e in sio.events_named("error")
    )
    assert sio.events_named("spin:started") == []


@pytest.mark.asyncio
async def test_punishment_settle_all_correct_everyone_escaped(
    sio: FakeSocketIO, db: Any,
) -> None:
    from hoba_api.services.rooms import get_room_by_code
    from hoba_api.services.spins import trigger_spin

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=2290))
    guest = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=2291))
    room = await _create_punishment_room(db, host_id=host.id)
    await db.commit()
    room_id = room.id

    # Spin first to learn where it lands, THEN point every prediction at
    # the actual winner so the settle resolves to "everyone escaped".
    spin = await trigger_spin(db, room=room, user_id=host.id)
    await db.commit()
    winner = spin.result_segment_id
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    fetched.punishment_predictions = {
        str(host.id): winner,
        str(guest.id): winner,
    }
    await db.commit()
    sio.emitted.clear()

    await _emit_settled(  # type: ignore[arg-type]
        sio, room.code, room_id,
        spin_id=spin.id, result_segment_id=winner, duration_ms=0,
    )

    after = sio.events_named("spin:settled")[-1][1]["mode_aftereffects"]
    assert after["punishment_cards"] == {}
    assert after["everyone_escaped"] is True
    persisted = await get_room_by_code(db, room.code)
    assert persisted is not None
    await db.refresh(persisted)
    assert persisted.punishment_cards == {}


@pytest.mark.asyncio
async def test_best_of_n_tallies_each_attempt(sio: FakeSocketIO, db: Any) -> None:
    from hoba_api.services.rooms import get_room_by_code
    from hoba_api.services.spins import trigger_spin

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=520))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="classic", spin_count=3,
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    spin = await trigger_spin(db, room=fetched, user_id=host.id)
    await db.commit()
    sio.emitted.clear()
    await _emit_settled(  # type: ignore[arg-type]
        sio, room.code, fetched.id,
        spin_id=spin.id, result_segment_id=spin.result_segment_id, duration_ms=0,
    )
    patches = [e[1]["patch"] for e in sio.events_named("room:updated")
               if isinstance(e[1], dict) and "patch" in e[1]]
    bon = [p for p in patches if "bon_attempts" in p]
    assert bon and bon[-1]["bon_attempts"] == 1
    assert bon[-1]["bon_winner_segment_id"] is None


@pytest.mark.asyncio
async def test_bon_reset_clears_round(sio: FakeSocketIO, db: Any) -> None:
    from hoba_api.services.rooms import get_room_by_code

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=521))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="classic", spin_count=3,
    )
    room.bon_attempts = 3
    room.bon_winner_segment_id = 1
    await db.commit()
    code = room.code
    await _connect(sio, "sid-h521", user_id=521)
    await sio.call("room:join", "sid-h521", {"code": code})
    sio.emitted.clear()
    await sio.call("bon:reset", "sid-h521")
    assert sio.events_named("bon:reset")
    refreshed = await get_room_by_code(db, code)
    assert refreshed is not None
    await db.refresh(refreshed)
    assert refreshed.bon_attempts == 0
    assert refreshed.bon_winner_segment_id is None


@pytest.mark.asyncio
async def test_best_of_n_finalizes_winner_after_n_spins(
    sio: FakeSocketIO, db: Any,
) -> None:
    # Regression: with 2 segments + spin_count=3 the round always has a
    # single leader after 3 spins, so the winner MUST finalize and the
    # final settle must broadcast it (the user saw "5/5" with no winner).
    from hoba_api.services.rooms import get_room_by_code
    from hoba_api.services.spins import trigger_spin

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=530))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="classic", spin_count=3,
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    last = None
    for _ in range(3):
        last = await trigger_spin(db, room=fetched, user_id=host.id)
        await db.commit()
    assert last is not None
    sio.emitted.clear()
    await _emit_settled(  # type: ignore[arg-type]
        sio, room.code, fetched.id,
        spin_id=last.id, result_segment_id=last.result_segment_id, duration_ms=0,
    )
    refreshed = await get_room_by_code(db, room.code)
    assert refreshed is not None
    await db.refresh(refreshed)
    assert refreshed.bon_attempts == 3
    assert refreshed.bon_winner_segment_id is not None
    patches = [e[1]["patch"] for e in sio.events_named("room:updated")
               if isinstance(e[1], dict) and "patch" in e[1]]
    bon = [p for p in patches if "bon_winner_segment_id" in p]
    assert bon and bon[-1]["bon_winner_segment_id"] is not None
