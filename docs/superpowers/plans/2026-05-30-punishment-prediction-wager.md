# Punishment v2 — Prediction Wager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Punishment mode into a prediction-wager game — players secretly guess where the wheel lands, the host spins, and each wrong guesser draws their own dare.

**Architecture:** Reuse the existing `PunishmentEngine` (kept minimal) and decks. New round state lives in three nullable `rooms` columns (Alembic 0010). Predict/resolve/draw logic is a new service module `services/punishment.py`. Secrecy is enforced by per-viewer redaction in `build_room_state`. Frontend adds a chip-row prediction UI, a host spin-gate + "Spin anyway", and a per-loser cards list — all driven by pure helpers in `features/rooms/punishment.ts`.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 async / Alembic / python-socketio / pytest (`uv run --extra dev`); React 18 / TS strict / Zustand / Framer Motion / react-i18next / vitest (`pnpm`).

**Spec:** `docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md` — read it before starting.

**Quality gates (run before EVERY commit; all must exit 0):**
```bash
cd /home/kali/hoba/apps/api && uv run --extra dev pytest -q && uv run --extra dev mypy --strict src && uv run --extra dev ruff check src tests
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit && pnpm run lint && pnpm vitest run
cd /home/kali/hoba && node scripts/i18n-check.mjs
```
Per `[[hoba-change-control]]`: full gate set green BEFORE each commit; show diffs + wait for approval before committing; never push un-green; no parallel edits on the same file; verify each Edit landed. Commits are short (no body needed), no `Co-Authored-By` trailer. Deploy is owner-driven on the VPS only.

---

## Task 0: Ground the plan against live code (reconcile signatures)

**Files (read-only):**
- `apps/api/src/hoba_api/models/room.py` — current `Room` columns (confirm `punishment_deck`, `punishment_done_count`, `punishment_active_card`; column types; JSON import).
- `apps/api/src/hoba_api/schemas/room.py` — `RoomState`/`RoomOut`/`SegmentOut` shape + how `build_room_state` is fed.
- `apps/api/src/hoba_api/services/rooms.py` — `build_room_state(room, me_user_id)`, `create_room`, `update_room`, presence/participant query.
- `apps/api/src/hoba_api/services/spins.py` — `trigger_spin` punishment branch + `mode_state_snapshot` shape + `RoomServiceError`.
- `apps/api/src/hoba_api/realtime/handlers.py` — `on_spin_trigger`, `_emit_settled`, existing `punishment:done`/`round:reset` handlers, `not_in_room`/`not_host` patterns, broadcast helpers, `settings` import.
- `apps/api/src/hoba_api/modes/punishment_decks.py` — `deck_cards`, `CARDS_PER_DECK`, `PunishmentDeck`.
- `apps/webapp/src/lib/api.ts` — `ServerRoom`, `PunishmentDeck`, `SpinSettledEvent`.
- `apps/webapp/src/features/rooms/punishment.ts` — existing helpers.
- `apps/webapp/src/stores/room.ts` — existing `markPunishmentDone`, `resetRound`, socket wiring, `punishment:cleared` handling.
- `apps/webapp/src/pages/RoomPage.tsx` — current punishment branch (overlay/tally).
- `apps/webapp/src/locales/en/room.json` + `uk/room.json` — existing `punishment.*` keys.
- `apps/api/alembic/versions/` — highest existing revision (expect 0009) → 0010 `down_revision`.

- [ ] **Step 1:** Read each file above. Note exact signatures, the latest Alembic revision id, the existing `punishment.*` i18n keys, and the existing `mode_aftereffects` broadcast shape. Where this plan's code differs from a real signature, prefer the real signature and adjust the snippet. Confirm the base-slice single-card pieces to be removed: `punishment_active_card` column reads/writes, the single-card overlay in RoomPage, no-arg `markPunishmentDone`, `services` draw in `trigger_spin`.

No commit (read-only grounding task).

---

## Task 1: Alembic 0010 — round-state columns

**Files:**
- Create: `apps/api/alembic/versions/0010_punishment_prediction_state.py`
- Modify: `apps/api/src/hoba_api/models/room.py`

- [ ] **Step 1: Add columns to the model**

In `models/room.py`, add to `Room` (keep `punishment_deck`, `punishment_done_count`; leave `punishment_active_card` defined but unused, with a comment that it is superseded by `punishment_cards` and intentionally retained — SQLite drop-column safety):

```python
# Prediction-wager round state (Punishment v2). See
# docs/superpowers/specs/2026-05-30-punishment-prediction-wager-design.md.
# Raw map {user_id(str): segment_id}; server-only source of truth, redacted per
# viewer in build_room_state.
punishment_predictions: Mapped[dict[str, object] | None] = mapped_column(
    JSON, nullable=True,
)
# Resolved cards {user_id(str): {text, deck, card_index, done}}; None while
# predicting, {} when everyone escaped.
punishment_cards: Mapped[dict[str, object] | None] = mapped_column(
    JSON, nullable=True,
)
punishment_result_segment_id: Mapped[int | None] = mapped_column(nullable=True)
# DEPRECATED (Punishment v1 single victim card). Superseded by
# punishment_cards; retained un-dropped to avoid a SQLite table-rebuild on the
# live DB. Always NULL going forward.
# (punishment_active_card stays as already defined.)
```

Mirror the existing column style in `models/room.py`: JSON columns are
`Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)` and
plain int columns omit an explicit type (`Mapped[int | None] = mapped_column(
nullable=True)`), as `bon_winner_segment_id` already does. `JSON` is already
imported; no `Integer` import is needed.

- [ ] **Step 2: Write the migration**

```python
"""punishment prediction-wager round state

Revision ID: 0010_punishment_prediction_state
Revises: 0009_<actual_prev_revision_id>
Create Date: 2026-05-30

Adds prediction-wager round state to rooms. Uses op.add_column only (no
batch_alter_table) per the 0004/0005 FK-naming lesson. The deprecated
punishment_active_card column is intentionally NOT dropped: dropping a column on
SQLite forces a batch table-rebuild which already corrupted a live migration
once (docs/deployment.md §9b). It is left always-NULL, superseded by
punishment_cards.
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_punishment_prediction_state"
down_revision = "0009_<actual_prev_revision_id>"  # set from Task 0
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("punishment_predictions", sa.JSON(), nullable=True))
    op.add_column("rooms", sa.Column("punishment_cards", sa.JSON(), nullable=True))
    op.add_column("rooms", sa.Column("punishment_result_segment_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("rooms", "punishment_result_segment_id")
    op.drop_column("rooms", "punishment_cards")
    op.drop_column("rooms", "punishment_predictions")
```

- [ ] **Step 3: Apply + verify locally is NOT done here** — migrations auto-apply via `AUTO_MIGRATE` on the VPS (owner deploys). Instead verify the model imports cleanly:

Run: `cd /home/kali/hoba/apps/api && uv run --extra dev python -c "from hoba_api.models.room import Room; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Gates + commit**

Run the backend gate subset (`pytest -q`, `mypy --strict src`, `ruff check src tests`). Expected: green (existing tests unaffected by additive columns).
```bash
git add apps/api/alembic/versions/0010_punishment_prediction_state.py apps/api/src/hoba_api/models/room.py
git commit -m "feat(api): punishment v2 round-state columns (alembic 0010)"
```

---

## Task 2: `services/punishment.py` — prediction + resolve logic (TDD)

**Files:**
- Create: `apps/api/src/hoba_api/services/punishment.py`
- Create/Modify: `apps/api/tests/services/test_punishment.py`

- [ ] **Step 1: Write failing tests for lock/drop/gate helpers**

In `tests/services/test_punishment.py` (use the project's async session + room/question/segment factories — copy fixture usage from `tests/services/test_spins.py`):

```python
import pytest
from hoba_api.services.punishment import (
    lock_prediction, drop_prediction, all_present_locked, waiting_on, RoomServiceError,
)

@pytest.mark.asyncio
async def test_lock_prediction_stores_and_overwrites(session, punishment_room):
    room, seg_ids = punishment_room  # helper builds a punishment room w/ segments
    await lock_prediction(session, room, user_id=1, segment_id=seg_ids[0])
    assert room.punishment_predictions == {"1": seg_ids[0]}
    await lock_prediction(session, room, user_id=1, segment_id=seg_ids[1])
    assert room.punishment_predictions == {"1": seg_ids[1]}

@pytest.mark.asyncio
async def test_lock_prediction_rejects_when_resolved(session, punishment_room):
    room, seg_ids = punishment_room
    room.punishment_cards = {}
    with pytest.raises(RoomServiceError) as e:
        await lock_prediction(session, room, user_id=1, segment_id=seg_ids[0])
    assert e.value.code == "round_resolved"

@pytest.mark.asyncio
async def test_lock_prediction_rejects_invalid_segment(session, punishment_room):
    room, seg_ids = punishment_room
    with pytest.raises(RoomServiceError) as e:
        await lock_prediction(session, room, user_id=1, segment_id=999999)
    assert e.value.code == "invalid_segment"

@pytest.mark.asyncio
async def test_drop_prediction_removes_and_noops(session, punishment_room):
    room, seg_ids = punishment_room
    room.punishment_predictions = {"1": seg_ids[0], "2": seg_ids[1]}
    await drop_prediction(session, room, user_id=1)
    assert room.punishment_predictions == {"2": seg_ids[1]}
    await drop_prediction(session, room, user_id=1)  # no-op
    assert room.punishment_predictions == {"2": seg_ids[1]}

def test_all_present_locked_and_waiting():
    preds = {"1": 10, "2": 11}
    assert all_present_locked(preds, present={1, 2}) is True
    assert all_present_locked(preds, present={1, 2, 3}) is False
    assert all_present_locked({}, present=set()) is False
    assert waiting_on(preds, present={1, 2, 3}) == [3]
```

Add a `punishment_room` fixture if not present (build a `Room(game_mode="punishment", punishment_deck="mild")` with an active question and ≥4 segments; return `(room, [segment_ids])`). Reuse existing factory helpers from `conftest.py`.

- [ ] **Step 2: Run tests — expect import/attribute failures**

Run: `cd /home/kali/hoba/apps/api && uv run --extra dev pytest tests/services/test_punishment.py -q`
Expected: FAIL (`cannot import name 'lock_prediction'`).

- [ ] **Step 3: Implement lock/drop/gate helpers**

```python
"""Prediction-wager logic for Punishment v2 (see design spec 2026-05-30)."""
from __future__ import annotations

import secrets

from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.modes.punishment_decks import CARDS_PER_DECK, deck_cards
from hoba_api.services.errors import RoomServiceError  # reuse the existing error type


def _visible_segment_ids(room) -> set[int]:  # type: ignore[no-untyped-def]
    """Ids of segments currently on the wheel for the room's active question."""
    question = room.active_question
    return {
        s.id
        for s in question.segments
        if getattr(s, "eliminated_at", None) is None
    }


async def lock_prediction(
    session: AsyncSession, room, user_id: int, segment_id: int  # type: ignore[no-untyped-def]
) -> None:
    if room.punishment_cards is not None:
        raise RoomServiceError("round_resolved")
    if segment_id not in _visible_segment_ids(room):
        raise RoomServiceError("invalid_segment")
    preds = dict(room.punishment_predictions or {})
    preds[str(user_id)] = segment_id
    room.punishment_predictions = preds
    await session.commit()


async def drop_prediction(session: AsyncSession, room, user_id: int) -> None:  # type: ignore[no-untyped-def]
    preds = dict(room.punishment_predictions or {})
    if str(user_id) in preds:
        del preds[str(user_id)]
        room.punishment_predictions = preds or None
        await session.commit()


def all_present_locked(predictions: dict | None, present: set[int]) -> bool:
    if not present:
        return False
    locked = {int(k) for k in (predictions or {})}
    return present <= locked


def waiting_on(predictions: dict | None, present: set[int]) -> list[int]:
    locked = {int(k) for k in (predictions or {})}
    return sorted(present - locked)
```

If `RoomServiceError` lives in `services/spins.py` rather than `services/errors.py` (confirm in Task 0), import it from there. If it uses `.args[0]` instead of `.code`, adapt the asserts in Step 1 to match the project convention.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd /home/kali/hoba/apps/api && uv run --extra dev pytest tests/services/test_punishment.py -q`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `resolve_predictions`**

```python
from hoba_api.services.punishment import resolve_predictions

@pytest.mark.asyncio
async def test_resolve_deals_one_card_per_loser(session, punishment_room):
    room, seg = punishment_room  # seg = list of segment ids
    room.punishment_predictions = {"1": seg[0], "2": seg[1], "3": seg[2]}
    cards = await resolve_predictions(session, room, result_segment_id=seg[0], host_lang="en")
    # user 1 guessed right -> safe; 2 and 3 wrong -> a card each
    assert set(cards.keys()) == {"2", "3"}
    assert cards["2"]["card_index"] != cards["3"]["card_index"]  # distinct
    assert all(c["done"] is False and c["text"] for c in cards.values())
    assert room.punishment_cards == cards
    assert room.punishment_result_segment_id == seg[0]

@pytest.mark.asyncio
async def test_resolve_everyone_escaped(session, punishment_room):
    room, seg = punishment_room
    room.punishment_predictions = {"1": seg[0], "2": seg[0]}
    cards = await resolve_predictions(session, room, result_segment_id=seg[0], host_lang="en")
    assert cards == {}
    assert room.punishment_cards == {}

@pytest.mark.asyncio
async def test_resolve_distinct_even_when_losers_exceed_remaining_pool(session, punishment_room):
    room, seg = punishment_room
    # Force many losers; cards must all be distinct within one resolve.
    room.punishment_predictions = {str(u): seg[1] for u in range(1, 8)}
    cards = await resolve_predictions(session, room, result_segment_id=seg[0], host_lang="en")
    idxs = [c["card_index"] for c in cards.values()]
    assert len(idxs) == len(set(idxs)) == 7
```

- [ ] **Step 6: Run — expect fail; then implement `resolve_predictions`**

```python
async def resolve_predictions(
    session: AsyncSession, room, result_segment_id: int, host_lang: str  # type: ignore[no-untyped-def]
) -> dict[str, dict]:
    predictions: dict = room.punishment_predictions or {}
    losers = [uid for uid, seg in predictions.items() if seg != result_segment_id]
    deck = room.punishment_deck or "mild"
    lang = host_lang or "en"

    pool = list(range(CARDS_PER_DECK))
    secrets.SystemRandom().shuffle(pool)
    cards: dict[str, dict] = {}
    for uid in losers:
        if not pool:  # exhausted within this resolve -> reshuffle, never repeating already-used
            used = {c["card_index"] for c in cards.values()}
            pool = [i for i in range(CARDS_PER_DECK) if i not in used]
            secrets.SystemRandom().shuffle(pool)
        idx = pool.pop()
        cards[uid] = {
            "text": deck_cards(deck, lang)[idx],
            "deck": deck,
            "card_index": idx,
            "done": False,
        }

    room.punishment_cards = cards
    room.punishment_result_segment_id = result_segment_id
    await session.commit()
    return cards
```

(Draw-without-replacement here is per-resolve; cross-spin history is not required for correctness and is simpler/robust — the spec's "prior-spin index history" is satisfied by the per-resolve uniqueness guarantee plus reshuffle. Note this simplification in the commit.)

- [ ] **Step 7: Add `mark_card_done` + `reset_round` helpers + tests**

```python
async def mark_card_done(session: AsyncSession, room, user_id: int) -> bool:  # type: ignore[no-untyped-def]
    cards = dict(room.punishment_cards or {})
    card = cards.get(str(user_id))
    if card is None or card.get("done"):
        return False
    card = {**card, "done": True}
    cards[str(user_id)] = card
    room.punishment_cards = cards
    room.punishment_done_count = (room.punishment_done_count or 0) + 1
    await session.commit()
    return True


async def reset_round(session: AsyncSession, room) -> None:  # type: ignore[no-untyped-def]
    room.punishment_predictions = None
    room.punishment_cards = None
    room.punishment_result_segment_id = None
    await session.commit()  # done_count persists
```

Tests: `mark_card_done` flips one card + increments tally + returns False for unknown/already-done; `reset_round` nulls the three fields and preserves `done_count`.

- [ ] **Step 8: Gates + commit**
```bash
git add apps/api/src/hoba_api/services/punishment.py apps/api/tests/services/test_punishment.py
git commit -m "feat(api): punishment v2 predict/resolve/done service logic"
```

---

## Task 3: Per-viewer redaction in `build_room_state` (TDD)

**Files:**
- Modify: `apps/api/src/hoba_api/services/rooms.py` (`build_room_state`)
- Modify: `apps/api/src/hoba_api/schemas/room.py` (`RoomState`/`RoomOut` DTO)
- Modify: `apps/api/tests/services/test_rooms.py` (or wherever `build_room_state` is tested)

- [ ] **Step 1: Failing test — predicting redaction + resolved reveal**

```python
def test_build_room_state_redacts_predictions_while_predicting(punishment_room_obj):
    room = punishment_room_obj
    room.punishment_predictions = {"1": 10, "2": 11}
    room.punishment_cards = None
    state_for_2 = build_room_state(room, me_user_id=2)
    assert state_for_2.punishment_locked_user_ids == [1, 2]
    assert state_for_2.punishment_my_prediction == 11
    assert state_for_2.punishment_predictions is None  # others hidden

def test_build_room_state_reveals_predictions_when_resolved(punishment_room_obj):
    room = punishment_room_obj
    room.punishment_predictions = {"1": 10, "2": 11}
    room.punishment_cards = {"1": {"text": "x", "deck": "mild", "card_index": 0, "done": False}}
    room.punishment_result_segment_id = 11
    state = build_room_state(room, me_user_id=2)
    assert state.punishment_predictions == {"1": 10, "2": 11}
    assert state.punishment_result_segment_id == 11
    assert state.punishment_cards["1"]["text"] == "x"
```

- [ ] **Step 2: Run — expect AttributeError on new DTO fields.**

- [ ] **Step 3: Extend the DTO** (`schemas/room.py`, on the state model already returned by `build_room_state`):

```python
punishment_locked_user_ids: list[int] = []
punishment_my_prediction: int | None = None
punishment_predictions: dict[str, int] | None = None
punishment_result_segment_id: int | None = None
punishment_cards: dict[str, PunishmentCardOut] | None = None
```
with
```python
class PunishmentCardOut(BaseModel):
    text: str
    deck: str
    card_index: int
    done: bool
```
Remove any `punishment_active_card` field from the DTO. Keep `punishment_deck`, `punishment_done_count`.

- [ ] **Step 4: Implement redaction** in `build_room_state(room, me_user_id)`:

```python
preds_raw: dict[str, int] = room.punishment_predictions or {}
resolved = room.punishment_cards is not None
locked_ids = sorted(int(k) for k in preds_raw)
state.punishment_deck = room.punishment_deck
state.punishment_done_count = room.punishment_done_count or 0
state.punishment_locked_user_ids = locked_ids
state.punishment_my_prediction = preds_raw.get(str(me_user_id)) if not resolved else None
state.punishment_predictions = preds_raw if resolved else None
state.punishment_result_segment_id = room.punishment_result_segment_id if resolved else None
state.punishment_cards = room.punishment_cards if resolved else None
```
Stop reading `punishment_active_card` anywhere in this function.

- [ ] **Step 5: Run — expect PASS.** Then full backend gate.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/hoba_api/services/rooms.py apps/api/src/hoba_api/schemas/room.py apps/api/tests/services/test_rooms.py
git commit -m "feat(api): per-viewer redaction of punishment predictions"
```

---

## Task 4: Spin gate + resolve wiring (TDD)

**Files:**
- Modify: `apps/api/src/hoba_api/services/spins.py` (`trigger_spin` punishment branch — remove v1 single-card draw)
- Modify: `apps/api/src/hoba_api/realtime/handlers.py` (`on_spin_trigger` force + gate; `_emit_settled` resolve)
- Modify: `apps/api/tests/realtime/test_handlers.py`

- [ ] **Step 1: Failing handler tests** (use `FakeSocketIO` as existing tests do):

```python
@pytest.mark.asyncio
async def test_punishment_spin_blocked_until_all_locked(fake_sio, punishment_room_with_two_present):
    # host present, guest present, only host locked -> SPIN rejected
    await on_spin_trigger(sid_host, {})
    assert fake_sio.last_error_to(sid_host)["code"] == "predictions_pending"

@pytest.mark.asyncio
async def test_punishment_spin_requires_host(fake_sio, punishment_room_with_two_present):
    await on_spin_trigger(sid_guest, {})
    assert fake_sio.last_error_to(sid_guest)["code"] == "not_host"

@pytest.mark.asyncio
async def test_punishment_force_spin_bypasses_gate(fake_sio, punishment_room_with_two_present):
    await on_spin_trigger(sid_host, {"force": True})
    # spin proceeds; on settle, cards populated for wrong guessers
    ...

@pytest.mark.asyncio
async def test_punishment_spin_rejected_when_resolved(fake_sio, punishment_room_resolved):
    await on_spin_trigger(sid_host, {})
    assert fake_sio.last_error_to(sid_host)["code"] == "round_resolved"
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Extend `on_spin_trigger`** — after existing permission/throttle scaffolding, before persisting the spin, when `room.game_mode == "punishment"`:

```python
force = bool(data.get("force", False))
if room.host_id != me_user_id:
    await sio.emit("error", {"code": "not_host"}, to=sid, namespace="/rooms")
    return
if room.punishment_cards is not None:
    await sio.emit("error", {"code": "round_resolved"}, to=sid, namespace="/rooms")
    return
present = await present_user_ids(session, room)  # from services.rooms presence query
if not force and not all_present_locked(room.punishment_predictions, present):
    await sio.emit("error", {"code": "predictions_pending"}, to=sid, namespace="/rooms")
    return
```
Match the file's actual emit/error helper (some handlers use a `_emit_error(sid, code)` wrapper — use it if present). Keep existing cooldown/cap checks after this block.

- [ ] **Step 4: Remove v1 draw from `trigger_spin`** — delete the punishment single-card draw that set `punishment_active_card` / recorded `mode_state_snapshot.punishment.card_index`. Punishment now just produces a normal spin; the draw happens at settle via `resolve_predictions`.

- [ ] **Step 5: Wire resolve in `_emit_settled`** — after the normal settle computes `result_segment_id`, when `room.game_mode == "punishment"`:

```python
host = await get_user(session, room.host_id)  # room.host is also relationship-loaded (lazy="joined")
host_lang = (host.language_code or "en") if host else "en"
cards = await resolve_predictions(session, room, result_segment_id, host_lang)
mode_aftereffects = {
    "punishment_result_segment_id": result_segment_id,
    "punishment_predictions": room.punishment_predictions or {},
    "punishment_cards": cards,
    "everyone_escaped": len(cards) == 0 and bool(room.punishment_predictions),
}
# include mode_aftereffects in the spin:settled payload (existing mechanism),
# and broadcast a room:updated patch so reconnects get resolved state:
await sio.emit("room:updated", {"patch": {
    "punishment_cards": cards,
    "punishment_result_segment_id": result_segment_id,
    "punishment_predictions": room.punishment_predictions or {},
}}, room=room_code, namespace="/rooms")
```
Keep Classic/elimination aftereffects branches unchanged.

- [ ] **Step 6: Run handler tests + full backend gate — expect PASS.**

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/hoba_api/services/spins.py apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py
git commit -m "feat(api): host-gated punishment spin + resolve at settle"
```

---

## Task 5: Predict / done / reset / leave events (TDD)

**Files:**
- Modify: `apps/api/src/hoba_api/realtime/handlers.py`
- Modify: `apps/api/tests/realtime/test_handlers.py`

- [ ] **Step 1: Failing tests**

```python
@pytest.mark.asyncio
async def test_punishment_predict_broadcasts_locked_ids_only(fake_sio, punishment_room_with_two_present):
    await on_punishment_predict(sid_host, {"segment_id": SEG0})
    patch = fake_sio.last_patch_to_room()  # room:updated patch
    assert patch["punishment_locked_user_ids"] == [HOST_ID]
    assert "punishment_predictions" not in patch  # never leak picks while predicting

@pytest.mark.asyncio
async def test_punishment_done_targets_user_and_clears(fake_sio, punishment_room_resolved):
    await on_punishment_done(sid_host, {"user_id": LOSER_ID})
    assert fake_sio.emitted("punishment:cleared", {"user_id": LOSER_ID})
    # tally up, that card done in the patch

@pytest.mark.asyncio
async def test_round_reset_clears_punishment_round(fake_sio, punishment_room_resolved):
    await on_round_reset(sid_host, {})
    room = await reload(room_code)
    assert room.punishment_predictions is None and room.punishment_cards is None
    assert room.punishment_done_count == PRESERVED
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement `punishment:predict` handler**

```python
@sio.on("punishment:predict", namespace="/rooms")
async def on_punishment_predict(sid, data):  # type: ignore[no-untyped-def]
    ctx = await _require_room_session(sid)  # existing pattern returning (session, room, user_id) or None+error
    if ctx is None:
        return
    session, room, user_id = ctx
    try:
        await lock_prediction(session, room, user_id, int(data["segment_id"]))
    except RoomServiceError as e:
        await _emit_error(sid, e.code)
        return
    locked = sorted(int(k) for k in (room.punishment_predictions or {}))
    await sio.emit("room:updated", {"patch": {"punishment_locked_user_ids": locked}},
                   room=room.code, namespace="/rooms")
```

- [ ] **Step 4: Update `punishment:done`** to take `{user_id}` and call `mark_card_done`; broadcast patch `{punishment_cards, punishment_done_count}` + `punishment:cleared {user_id}`. No-op (no broadcast) when `mark_card_done` returns False.

- [ ] **Step 5: Update `round:reset`** punishment branch to call `reset_round` and broadcast the existing `round:reset` event (clients clear local round UI).

- [ ] **Step 6: Hook leave/disconnect** — in the existing leave/disconnect handler, after presence update, if `room.game_mode == "punishment"` and the round is predicting, call `drop_prediction(session, room, user_id)` and, if it changed, broadcast the updated `punishment_locked_user_ids` patch.

- [ ] **Step 7: Run + full backend gate — expect PASS.**

- [ ] **Step 8: Commit**
```bash
git add apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py
git commit -m "feat(api): punishment predict/done/reset/leave events"
```

---

## Task 6: Punishment mode-default spin policy = host_only

**Files:**
- Modify: wherever mode-default `spin_policy` is derived (search `turn_based` / `_default_spin_policy` — likely `services/rooms.py` or a `modes` helper).
- Modify: the corresponding test.

- [ ] **Step 1:** Failing test: a room created with `game_mode="punishment"` and no explicit policy gets `spin_policy == "host_only"`.
- [ ] **Step 2:** Change the punishment default from `turn_based` to `host_only` in the derivation map.
- [ ] **Step 3:** Run + gate. Commit:
```bash
git commit -am "feat(api): punishment default spin policy host_only"
```

---

## Task 7: Frontend types + store actions (TDD where practical)

**Files:**
- Modify: `apps/webapp/src/lib/api.ts`
- Modify: `apps/webapp/src/stores/room.ts`
- Modify: `apps/webapp/src/stores/room.test.ts` (or the store test file)

- [ ] **Step 1: Types in `api.ts`** — add to `ServerRoom`:
```ts
punishment_locked_user_ids: number[];
punishment_my_prediction: number | null;
punishment_predictions: Record<string, number> | null;
punishment_result_segment_id: number | null;
punishment_cards: Record<string, PunishmentCard> | null;
```
```ts
export interface PunishmentCard {
  text: string;
  deck: PunishmentDeck;
  card_index: number;
  done: boolean;
}
```
Remove `punishment_active_card`. Add the §4c fields to `SpinSettledEvent.mode_aftereffects`.

- [ ] **Step 2: Store test** — `predictPunishment(segId)` emits `punishment:predict {segment_id}` and optimistically sets `snapshot.room.punishment_my_prediction`; `markPunishmentDone(userId)` emits `punishment:done {user_id}`; handling `punishment:cleared` + the resolve patch updates `punishment_cards`. Use the existing fake socket in store tests.

- [ ] **Step 3: Implement store actions** — replace the no-arg `markPunishmentDone` with `markPunishmentDone(userId: number)`; add `predictPunishment(segmentId: number)`; wire `punishment:cleared` and merge `room:updated` patches (the store already merges patches — confirm new keys flow through).

- [ ] **Step 4: Add bon/punishment fields to all test fixtures** — every `ServerRoom` fixture across `permissions.test`, `turnState.test`, `punishment.test`, `room.test` needs the new fields (`punishment_locked_user_ids: []`, `punishment_my_prediction: null`, `punishment_predictions: null`, `punishment_result_segment_id: null`, `punishment_cards: null`) or `tsc` fails. Add a shared fixture factory if one exists.

- [ ] **Step 5: `pnpm tsc --noEmit` + `pnpm vitest run` — expect green.** Commit:
```bash
git add apps/webapp/src/lib/api.ts apps/webapp/src/stores/room.ts apps/webapp/src/stores/room.test.ts
git commit -m "feat(webapp): punishment v2 types + store actions"
```

---

## Task 8: `features/rooms/punishment.ts` helpers (TDD)

**Files:**
- Modify: `apps/webapp/src/features/rooms/punishment.ts`
- Modify: `apps/webapp/src/features/rooms/punishment.test.ts`

- [ ] **Step 1: Failing tests** for: `punishmentPhase` (predicting vs resolved), `lockedUserIds`, `myPrediction`, `pendingCards` (array with userId), `isEveryoneEscaped`, `allPresentLocked(snapshot, present)`, `waitingOnUserIds(snapshot, present)`, `doneCount`. Cover: predicting (cards null), resolved-with-losers, resolved-escaped.

- [ ] **Step 2: Run — fail.**

Also **remove the v1 helpers** `activeCard` and `hasPendingCard` (they read the
deleted `punishment_active_card`) and their tests; keep `isPunishment` and
`doneCount`. The existing helpers take `snap: RoomState | null` and read
`snap?.room.*` — match that exact signature (NOT a `RoomSnapshot` type).

- [ ] **Step 3: Implement helpers** (pure; `RoomState | null` like the existing file):
```ts
export function punishmentPhase(snap: RoomState | null): "predicting" | "resolved" {
  return (snap?.room.punishment_cards ?? null) === null ? "predicting" : "resolved";
}
export function lockedUserIds(snap: RoomState | null): number[] {
  return snap?.room.punishment_locked_user_ids ?? [];
}
export function myPrediction(snap: RoomState | null): number | null {
  return snap?.room.punishment_my_prediction ?? null;
}
export function pendingCards(
  snap: RoomState | null,
): Array<{ userId: number } & PunishmentCard> {
  const c = snap?.room.punishment_cards ?? {};
  return Object.entries(c).map(([uid, card]) => ({ userId: Number(uid), ...card }));
}
export function isEveryoneEscaped(snap: RoomState | null): boolean {
  const cards = snap?.room.punishment_cards ?? null;
  const preds = snap?.room.punishment_predictions ?? null;
  return cards !== null && Object.keys(cards).length === 0
    && preds !== null && Object.keys(preds).length > 0;
}
export function allPresentLocked(snap: RoomState | null, present: number[]): boolean {
  const locked = new Set(lockedUserIds(snap));
  return present.length > 0 && present.every((u) => locked.has(u));
}
export function waitingOnUserIds(snap: RoomState | null, present: number[]): number[] {
  const locked = new Set(lockedUserIds(snap));
  return present.filter((u) => !locked.has(u));
}
// doneCount already exists in the file — keep it.
```
Import `PunishmentCard` from `@/lib/api`. `isEveryoneEscaped` keys off the
resolved phase: `punishment_predictions` is non-null only once resolved (§3), so
checking it is non-empty distinguishes a real escape from an idle empty round.

- [ ] **Step 4: Run — pass.** Commit:
```bash
git add apps/webapp/src/features/rooms/punishment.ts apps/webapp/src/features/rooms/punishment.test.ts
git commit -m "feat(webapp): punishment v2 prediction helpers"
```

---

## Task 9: i18n strings (EN + UK)

**Files:**
- Modify: `apps/webapp/src/locales/en/room.json`
- Modify: `apps/webapp/src/locales/uk/room.json`

- [ ] **Step 1:** Add under `punishment.*` (EN), UK written natively:

EN:
```json
"predicting_status": "🔮 {{locked}}/{{total}} locked in",
"waiting_on": "Waiting on {{names}}",
"pick_hint": "Tap to predict where it lands",
"spin_when_ready": "Waiting for everyone to guess",
"spin_anyway": "Spin anyway",
"waiting_for_host": "Waiting for the host to spin",
"reveal_safe": "{{name}} — safe ✨",
"reveal_wrong": "{{name}} guessed wrong → {{card}}",
"everyone_escaped": "Everyone escaped! 🍀",
"new_round": "New round",
"done": "Done"
```
UK:
```json
"predicting_status": "🔮 {{locked}}/{{total}} вгадали",
"waiting_on": "Чекаємо на {{names}}",
"pick_hint": "Тапни, щоб вгадати, де зупиниться",
"spin_when_ready": "Чекаємо, поки всі вгадають",
"spin_anyway": "Все одно крутити",
"waiting_for_host": "Чекаємо, поки ведучий крутне",
"reveal_safe": "{{name}} — пронесло ✨",
"reveal_wrong": "{{name}} не вгадав → {{card}}",
"everyone_escaped": "Усіх пронесло! 🍀",
"new_round": "Новий раунд",
"done": "Готово"
```
Keep the existing `punishment.tally` ICU plural. Add `errors.predictions_pending`, `errors.round_resolved`, `errors.invalid_segment` (EN + UK) under the room `errors.*` block.

- [ ] **Step 2:** Run `node scripts/i18n-check.mjs` — expect "i18n:check passed" (EN↔UK parity). Commit:
```bash
git add apps/webapp/src/locales/en/room.json apps/webapp/src/locales/uk/room.json
git commit -m "feat(webapp): punishment v2 i18n (EN + UK)"
```

---

## Task 10: RoomPage punishment branch UI

**Files:**
- Modify: `apps/webapp/src/pages/RoomPage.tsx`
- (Optional new) `apps/webapp/src/components/room/PunishmentChips.tsx`, `PunishmentCardsList.tsx` — extract if the branch grows large.

- [ ] **Step 1:** Remove the v1 single-card overlay + no-arg done call.

- [ ] **Step 2: Predicting phase UI** (when `isPunishment(snapshot) && punishmentPhase === "predicting"`):
  - Chip row under the wheel: one chip per visible segment (emoji + label, `min-h-11`), tap → `predictPunishment(seg.id)`; highlight when `myPrediction === seg.id`. Disable after resolve.
  - Status line: `t("room:punishment.predicting_status", {locked, total})` + `t("room:punishment.waiting_on", {names})` (host sees names; build names from participants minus locked).
  - Host: hub SPIN enabled only when `allPresentLocked(snapshot, presentIds)`; else disabled + `spin_when_ready` hint. Host "Spin anyway" button (→ `spin:trigger {force:true}`) shown when ≥1 locked. Non-host: `waiting_for_host` hint, no SPIN affordance.

- [ ] **Step 3: Resolved phase UI** (`punishmentPhase === "resolved"`):
  - Reveal each participant's guess from `punishment_predictions` as safe/wrong (`reveal_safe` / `reveal_wrong`).
  - `pendingCards` → list: name + card text + deck badge + Done ✓ (→ `markPunishmentDone(userId)`); grey out when `done`.
  - `isEveryoneEscaped` → "Everyone escaped! 🍀" hero instead of the list.
  - Host "New round" button → `resetRound()`. Hub disabled while resolved.
  - Tally near `GameModeBadge`: `t("room:punishment.tally", {count: doneCount})`.

- [ ] **Step 4:** `presentIds` = participant ids currently in the room (reuse existing presence/participants from the snapshot). `names` resolved via participant `display_name`.

- [ ] **Step 5:** `pnpm tsc --noEmit` + `pnpm run lint` + `pnpm vitest run` — green. Add a RoomPage punishment render test if the file already has RoomPage tests; otherwise rely on helper/store coverage.

- [ ] **Step 6:** Commit:
```bash
git commit -am "feat(webapp): punishment v2 prediction-wager room UI"
```

---

## Task 11: Docs + close-out

**Files:**
- Modify: `docs/game-modes.md` (rewrite Punishment section)
- Modify: `CLAUDE.md` (Current-phase line + doc-index note)
- Modify: `docs/TODO.md` (note the undropped `punishment_active_card` column as a Stage G/Postgres cleanup item)

- [ ] **Step 1:** Rewrite `docs/game-modes.md` Punishment section: prediction-wager loop, secret-until-reveal, everyone-must-guess + host force-start + auto-drop, one-card-per-loser, all-correct escape, new columns (0010), events, host-language cards.
- [ ] **Step 2:** Update `CLAUDE.md` Current-phase to record Punishment v2 shipped; add the spec/plan paths.
- [ ] **Step 3:** Add the `punishment_active_card` undrop cleanup to `docs/TODO.md` (Stage G).
- [ ] **Step 4:** Run ALL gates one final time (backend + frontend + i18n). Commit:
```bash
git add docs/game-modes.md CLAUDE.md docs/TODO.md
git commit -m "docs: punishment v2 prediction-wager"
```

- [ ] **Step 5:** Update memory: `hoba-project-state.md` (Punishment v2 shipped), close out `[[hoba-punishment-enhancement-next]]`, refresh `MEMORY.md`. (Owner deploys to the VPS; do not deploy locally — `[[hoba-test-on-vps]]`.)

---

## Self-review notes (author)

- **Spec coverage:** lifecycle (Tasks 1,2,4,5), data model (1), secrecy (3), engine/policy (6, engine unchanged), events (4,5), frontend (7–10), tests (each task), docs (11). All §1–§8 covered.
- **Type consistency:** `PunishmentCard`/`PunishmentCardOut` shape `{text,deck,card_index,done}` identical across api.ts (7), schema (3), service (2). `predictPunishment`/`markPunishmentDone(userId)` names consistent across store (7), helpers (8), RoomPage (10).
- **Known reconciliations (Task 0 resolves):** exact `RoomServiceError` location + `.code` vs `.args`; presence query name (`present_user_ids`); error-emit helper (`_emit_error`) and room-session guard (`_require_room_session`) actual names; current Alembic head id for `down_revision`; whether segment visibility uses `eliminated_at` (punishment never eliminates, so all segments are visible — `_visible_segment_ids` simplifies to all active-question segments).
- **Risk:** removing v1 single-card paths (Tasks 4/7/10) must be complete — grep `punishment_active_card` after Task 10; zero references expected outside the model column + migration docstring.
