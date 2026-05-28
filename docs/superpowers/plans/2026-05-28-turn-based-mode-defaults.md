# turn_based spin policy + mode-default spin_policy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `turn_based` spin policy end-to-end (backend persistence + advance + full turn UI on the frontend) and mode-default `spin_policy` derivation on room creation, per spec at `docs/superpowers/specs/2026-05-28-turn-based-mode-defaults-design.md`.

**Architecture:** Backend adds `current_turn_user_id` column to `rooms`, an `advance_turn` service helper (presence-aware skip via `presence_user_ids`), and policy-dispatched `user_can_spin`. WS `_emit_settled` re-fetches the room, advances if policy is turn_based, and broadcasts `room:updated`. REST `create_room` derives spin_policy from `game_mode` when not explicit. Frontend `computeCanSpin` gains a turn_based branch; new `computeTurnState` helper drives a room-header status line in EN + UK.

**Tech Stack:** Python 3.12 + FastAPI + python-socketio + SQLAlchemy 2.0 async + Alembic + pytest + fakeredis; React 18 + TypeScript + Zustand + react-i18next + vitest. No new deps.

---

## Pre-flight reminders

- **Brand:** `Hoba!` (Latin) in EN/code/docs/files; `Хоба!` (Cyrillic) only inside UK locale in-app UI. Never mix.
- **Commits:** Conventional commits (`feat:`, `chore:`, `docs:`, `test:`). No Claude co-author trailer (per `~/.claude/projects/-home-kali-hoba/memory/no-claude-coauthor.md`).
- **Rule 8:** Every inline TODO needs a `docs/TODO.md` entry. The two Stage D items in TODO.md cover this plan's scope; strike them in the final task.
- **Rollback rule:** if a quality gate regresses after a commit, `git reset --hard HEAD~1` the offending commit, log the regression in a `### Task N regression note` line below, fix, re-commit. No patch-on-top.
- **TDD discipline:** every backend task starts by writing the failing test, runs it to confirm it fails, then implements, then runs to confirm it passes. Same for frontend pure helpers. UI + i18n tasks have no automated test — the i18n:check gate covers locale parity; UI is visually verified in the dev server (called out in the relevant task).
- **eslint typeof-export trap (per `~/.claude/projects/-home-kali-hoba/memory/hoba-eslint-typeof-export.md`):** don't unexport a const whose only consumer is `typeof X[number]` — eslint flags it. Applies if any new constant is added with this shape.
- **Direct commits on `main`** per Stage A/B/C/cleanup-pass pattern. Per-task quality-gate re-runs.

---

## Phase 1 — Backend data layer

### Task 1: Capture quality-gate baseline

**Files:** None (verification only).

- [ ] **Step 1: Run backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 113 passed, ruff clean, mypy clean.

- [ ] **Step 2: Run frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test && pnpm lint && pnpm tsc --noEmit
```

Expected: 53 passed, lint clean, tsc clean.

- [ ] **Step 3: Run i18n parity**

```bash
cd /home/kali/hoba && pnpm i18n:check
```

Expected: passed.

- [ ] **Step 4: If any gate fails, STOP and report**

Open a session message: "Baseline broken: <gate> failed before Task 1. Stage D foundation work cannot proceed until baseline is green." Wait for owner direction. No code changes until baseline is green.

---

### Task 2: Add `current_turn_user_id` column + Alembic migration

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/models/room.py`
- Create: `/home/kali/hoba/apps/api/alembic/versions/0004_add_current_turn_user_id.py`

- [ ] **Step 1: Add the column to the SQLAlchemy model**

Edit `apps/api/src/hoba_api/models/room.py`. After the `is_anonymous` mapped column (line ~70), add:

```python
    current_turn_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
```

`ondelete="SET NULL"` so deleting a user (rare; FK cascades exist for users → host_id) drops the cursor instead of cascade-deleting the whole room.

- [ ] **Step 2: Create the Alembic migration**

Create `apps/api/alembic/versions/0004_add_current_turn_user_id.py`:

```python
"""add current_turn_user_id to rooms

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-28

Adds a nullable cursor used only by the `turn_based` spin policy.
Existing rows stay NULL; rooms with policy != turn_based ignore it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.add_column(
            sa.Column(
                "current_turn_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("rooms") as batch_op:
        batch_op.drop_column("current_turn_user_id")
```

- [ ] **Step 3: Run the test suite — migration applies cleanly via the autouse engine fixture**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5
```

Expected: 113 passed (column added, no behaviour yet so no test regression). If `no such column` appears, the migration didn't apply — check the revision chain.

- [ ] **Step 4: Run mypy + ruff**

```bash
cd /home/kali/hoba/apps/api && uv run ruff check . && uv run mypy --strict src
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/models/room.py apps/api/alembic/versions/0004_add_current_turn_user_id.py && git commit -m "feat(api): add current_turn_user_id column on rooms (Alembic 0004)"
```

---

### Task 3: `_derive_spin_policy` helper + tests

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/services/rooms.py`
- Modify: `/home/kali/hoba/apps/api/tests/services/test_rooms.py`

- [ ] **Step 1: Write the failing tests**

Open `apps/api/tests/services/test_rooms.py`. Find the existing imports (something like `from hoba_api.services.rooms import create_room, ...`). Append after the last test in the file:

```python
from hoba_api.services.rooms import _derive_spin_policy


def test_derive_spin_policy_explicit_wins_for_classic():
    assert _derive_spin_policy("host_only", "classic") == "host_only"


def test_derive_spin_policy_explicit_wins_for_punishment():
    # Explicit value beats mode default even when mode is non-classic.
    assert _derive_spin_policy("anyone", "punishment") == "anyone"


def test_derive_spin_policy_default_for_classic():
    # No explicit spin_policy + classic mode → "anyone" (party-game default).
    assert _derive_spin_policy(None, "classic") == "anyone"


def test_derive_spin_policy_default_for_elimination():
    assert _derive_spin_policy(None, "elimination") == "host_only"


def test_derive_spin_policy_default_for_punishment():
    assert _derive_spin_policy(None, "punishment") == "turn_based"


def test_derive_spin_policy_default_for_chaos():
    assert _derive_spin_policy(None, "chaos") == "anyone"


def test_derive_spin_policy_default_for_rigged():
    assert _derive_spin_policy(None, "rigged") == "host_only"
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_rooms.py -v -k derive_spin_policy 2>&1 | tail -20
```

Expected: ImportError on `_derive_spin_policy` (not yet defined).

- [ ] **Step 3: Implement the helper**

Edit `apps/api/src/hoba_api/services/rooms.py`. After the `CODE_ALPHABET = ...` line at the top of the file (around line 22), add:

```python
MODE_DEFAULT_SPIN_POLICY: dict[str, str] = {
    "elimination": "host_only",
    "punishment": "turn_based",
    "chaos": "anyone",
    "rigged": "host_only",
}


def _derive_spin_policy(explicit: str | None, game_mode: str) -> str:
    """Pick the effective spin_policy given an optional explicit value.

    Explicit value (anything non-None) wins. Otherwise derive from mode:
    Elimination → host_only, Punishment → turn_based, Chaos → anyone,
    Rigged → host_only. Anything else (including classic) falls back to
    `anyone` — the party-game social default since 2026-05-26.
    """
    if explicit is not None:
        return explicit
    return MODE_DEFAULT_SPIN_POLICY.get(game_mode, "anyone")
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_rooms.py -v -k derive_spin_policy 2>&1 | tail -15
```

Expected: 7 passed.

- [ ] **Step 5: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 120 passed (113 + 7), clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/services/rooms.py apps/api/tests/services/test_rooms.py && git commit -m "feat(api): _derive_spin_policy helper with mode→policy fallbacks"
```

---

### Task 4: Plumb `game_mode` through `create_room`

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/services/rooms.py`
- Modify: `/home/kali/hoba/apps/api/tests/services/test_rooms.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/services/test_rooms.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_create_room_with_game_mode_persists_field(db, user_factory):
    user = await user_factory()
    room = await create_room(
        db,
        host_id=user.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="elimination",
    )
    assert room.game_mode == "elimination"


@pytest.mark.asyncio
async def test_create_room_punishment_defaults_to_turn_based(db, user_factory):
    user = await user_factory()
    room = await create_room(
        db,
        host_id=user.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
    )
    assert room.spin_policy == "turn_based"


@pytest.mark.asyncio
async def test_create_room_explicit_spin_policy_wins_over_mode(db, user_factory):
    user = await user_factory()
    room = await create_room(
        db,
        host_id=user.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        game_mode="punishment",
        spin_policy="anyone",
    )
    assert room.spin_policy == "anyone"
    assert room.game_mode == "punishment"


@pytest.mark.asyncio
async def test_create_room_classic_default_unchanged(db, user_factory):
    user = await user_factory()
    room = await create_room(
        db,
        host_id=user.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
    )
    assert room.game_mode == "classic"
    assert room.spin_policy == "anyone"


@pytest.mark.asyncio
async def test_create_room_rejects_unknown_game_mode(db, user_factory):
    user = await user_factory()
    with pytest.raises(RoomServiceError) as excinfo:
        await create_room(
            db,
            host_id=user.id,
            question_text="Q?",
            segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
            game_mode="not_a_mode",
        )
    assert excinfo.value.code == "bad_game_mode"
```

The `db` + `user_factory` fixtures are existing conftest fixtures the file already uses. `SegmentDraft` and `RoomServiceError` are already imported at the top of the file.

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_rooms.py::test_create_room_with_game_mode_persists_field tests/services/test_rooms.py::test_create_room_punishment_defaults_to_turn_based tests/services/test_rooms.py::test_create_room_explicit_spin_policy_wins_over_mode tests/services/test_rooms.py::test_create_room_classic_default_unchanged tests/services/test_rooms.py::test_create_room_rejects_unknown_game_mode -v 2>&1 | tail -20
```

Expected: `TypeError: create_room() got an unexpected keyword argument 'game_mode'` on the first 4; the last fails differently (no validation yet).

- [ ] **Step 3: Update `create_room` signature + behaviour**

Edit `apps/api/src/hoba_api/services/rooms.py`. The current `create_room` signature is:

```python
async def create_room(
    session: AsyncSession,
    *,
    host_id: int,
    question_text: str,
    segments: list[SegmentDraft],
    title: str | None = None,
    spin_policy: str = "anyone",
    suggestion_policy: str = "off",
) -> Room:
```

Add `game_mode` import for the model constant. At the top of file, in the existing models import block, add `GAME_MODES`:

```python
from hoba_api.models.room import (
    GAME_MODES,
    SPIN_POLICIES,
    SUGGESTION_POLICIES,
    Room,
)
```

Replace the signature + opening validation block. The new signature accepts `spin_policy: str | None = None` and `game_mode: str = "classic"`. Validation gains the game-mode check and derivation:

```python
async def create_room(
    session: AsyncSession,
    *,
    host_id: int,
    question_text: str,
    segments: list[SegmentDraft],
    title: str | None = None,
    spin_policy: str | None = None,
    suggestion_policy: str = "off",
    game_mode: str = "classic",
) -> Room:
    """Create a room + its first question + segments, marking host as Participant."""
    if game_mode not in GAME_MODES:
        raise RoomServiceError("bad_game_mode")
    effective_spin_policy = _derive_spin_policy(spin_policy, game_mode)
    if effective_spin_policy not in SPIN_POLICIES:
        raise RoomServiceError("bad_spin_policy")
    if suggestion_policy not in SUGGESTION_POLICIES:
        raise RoomServiceError("bad_suggestion_policy")
    if not MIN_SEGMENTS <= len(segments) <= MAX_SEGMENTS:
        raise RoomServiceError("bad_segment_count")
    if not question_text.strip():
        raise RoomServiceError("empty_question")

    code = await _find_unused_code(session)
    room = Room(
        code=code,
        host_id=host_id,
        title=title,
        status="lobby",
        game_mode=game_mode,
        spin_policy=effective_spin_policy,
        suggestion_policy=suggestion_policy,
    )
```

Leave the rest of the function unchanged (Participant + Question + Segment creation).

- [ ] **Step 4: Run the 5 new tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_rooms.py -v -k "game_mode or punishment or classic_default or rejects_unknown" 2>&1 | tail -15
```

Expected: 5 passed.

- [ ] **Step 5: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 125 passed (120 + 5), clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/services/rooms.py apps/api/tests/services/test_rooms.py && git commit -m "feat(api): create_room accepts game_mode; derives spin_policy when not explicit"
```

---

### Task 5: `advance_turn` helper

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/services/spins.py`
- Create: `/home/kali/hoba/apps/api/tests/services/test_turn_advance.py`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/services/test_turn_advance.py`:

```python
"""Coverage for advance_turn — presence-aware cursor rotation."""

from __future__ import annotations

import pytest

from hoba_api.models.participant import Participant
from hoba_api.redis_client import presence_remove, presence_set
from hoba_api.services.rooms import SegmentDraft, create_room
from hoba_api.services.spins import advance_turn


async def _make_room_with_n_participants(db, user_factory, n: int):
    host = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
    )
    extras = []
    for _ in range(n - 1):
        u = await user_factory()
        db.add(Participant(room_id=room.id, user_id=u.id, role="guest"))
        extras.append(u)
    await db.flush()
    return room, [host, *extras]


@pytest.mark.asyncio
async def test_advance_from_null_cursor_picks_first_online_participant(
    db, user_factory,
):
    room, users = await _make_room_with_n_participants(db, user_factory, 3)
    for u in users:
        await presence_set(room.id, u.id)
    new_cursor = await advance_turn(db, room)
    assert new_cursor == users[0].id
    assert room.current_turn_user_id == users[0].id


@pytest.mark.asyncio
async def test_advance_skips_disconnected_participant(db, user_factory):
    room, users = await _make_room_with_n_participants(db, user_factory, 3)
    # All online, cursor on users[0].
    for u in users:
        await presence_set(room.id, u.id)
    room.current_turn_user_id = users[0].id
    # Drop users[1] from presence — advance should jump to users[2].
    await presence_remove(room.id, users[1].id)
    new_cursor = await advance_turn(db, room)
    assert new_cursor == users[2].id


@pytest.mark.asyncio
async def test_advance_wraps_to_first_when_at_end(db, user_factory):
    room, users = await _make_room_with_n_participants(db, user_factory, 3)
    for u in users:
        await presence_set(room.id, u.id)
    room.current_turn_user_id = users[2].id
    new_cursor = await advance_turn(db, room)
    assert new_cursor == users[0].id


@pytest.mark.asyncio
async def test_advance_returns_none_when_all_offline(db, user_factory):
    room, users = await _make_room_with_n_participants(db, user_factory, 3)
    # No presence_set calls — Redis has no presence keys for these users.
    room.current_turn_user_id = users[0].id
    new_cursor = await advance_turn(db, room)
    assert new_cursor is None
    assert room.current_turn_user_id is None


@pytest.mark.asyncio
async def test_advance_handles_solo_room(db, user_factory):
    room, users = await _make_room_with_n_participants(db, user_factory, 1)
    await presence_set(room.id, users[0].id)
    room.current_turn_user_id = users[0].id
    new_cursor = await advance_turn(db, room)
    # Only one online participant — cursor lands on them again.
    assert new_cursor == users[0].id
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_turn_advance.py -v 2>&1 | tail -15
```

Expected: ImportError on `advance_turn` (not defined).

- [ ] **Step 3: Implement `advance_turn`**

Edit `apps/api/src/hoba_api/services/spins.py`. After the existing imports, add the participant + presence imports:

```python
from hoba_api.models.participant import Participant
from hoba_api.redis_client import presence_user_ids
```

After the `user_can_spin` function (around line 109), add:

```python
async def advance_turn(
    session: AsyncSession, room: Room,
) -> int | None:
    """Advance `room.current_turn_user_id` to the next online participant.

    Walks Participant rows ordered by id (= join order). Starts at the
    slot after `room.current_turn_user_id`, or at slot 0 if the cursor
    is None. Skips any participant whose presence key is missing from
    Redis. Wraps around past the end. Returns the new cursor (or None
    if no one is online). Mutates `room.current_turn_user_id` in
    place; caller commits.
    """
    rows = (
        await session.execute(
            select(Participant.user_id)
            .where(Participant.room_id == room.id)
            .order_by(Participant.id),
        )
    ).scalars().all()
    if not rows:
        room.current_turn_user_id = None
        return None
    online = await presence_user_ids(room.id)
    if not online:
        room.current_turn_user_id = None
        return None

    # Start walking from the slot AFTER the current cursor; if the cursor
    # is None or not in the list, start at slot 0.
    try:
        start = rows.index(room.current_turn_user_id) + 1
    except ValueError:
        start = 0
    n = len(rows)
    for offset in range(n):
        candidate = rows[(start + offset) % n]
        if candidate in online:
            room.current_turn_user_id = candidate
            return candidate
    room.current_turn_user_id = None
    return None
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_turn_advance.py -v 2>&1 | tail -15
```

Expected: 5 passed.

- [ ] **Step 5: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 130 passed (125 + 5), clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/services/spins.py apps/api/tests/services/test_turn_advance.py && git commit -m "feat(api): advance_turn helper — presence-aware cursor rotation"
```

---

### Task 6: `user_can_spin` dispatches on policy (turn_based branch)

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/services/spins.py`
- Modify: `/home/kali/hoba/apps/api/tests/services/test_spins.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/services/test_spins.py`:

```python
from hoba_api.services.spins import user_can_spin


def _make_room(spin_policy: str, host_id: int = 1, current_turn: int | None = None):
    """Lightweight Room instance for pure user_can_spin tests."""
    from hoba_api.models.room import Room

    room = Room(
        code="ABC123",
        host_id=host_id,
        status="active",
        game_mode="classic",
        spin_policy=spin_policy,
        suggestion_policy="off",
    )
    room.current_turn_user_id = current_turn
    return room


def test_user_can_spin_turn_based_cursor_match():
    room = _make_room("turn_based", host_id=1, current_turn=42)
    assert user_can_spin(room, user_id=42) is True


def test_user_can_spin_turn_based_cursor_mismatch():
    room = _make_room("turn_based", host_id=1, current_turn=42)
    assert user_can_spin(room, user_id=99) is False


def test_user_can_spin_turn_based_cursor_null_denies_everyone():
    room = _make_room("turn_based", host_id=1, current_turn=None)
    # Cursor unset → no one is "the current turn", including host.
    assert user_can_spin(room, user_id=1) is False
    assert user_can_spin(room, user_id=99) is False


def test_user_can_spin_unknown_policy_denies():
    room = _make_room("not_a_policy", host_id=1)
    assert user_can_spin(room, user_id=1) is False
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_spins.py -v -k turn_based_cursor 2>&1 | tail -15
```

Expected: the first 2 tests pass by accident (current fallback returns `host_id == user_id`, which matches False for 42 vs host 1 and 99 vs host 1 — wait, actually `42 vs host 1 → False` matches the mismatch test). Let me revise: the cursor_match test fails (returns False because current fallback is host-only). The cursor_mismatch test passes by accident. The null and unknown_policy tests check explicit behaviour the current code lacks.

To confirm precisely:
```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_spins.py -v -k "turn_based or unknown_policy" 2>&1 | tail -10
```

Expected: at least 2 failures.

- [ ] **Step 3: Update `user_can_spin`**

Edit `apps/api/src/hoba_api/services/spins.py`. Replace the existing `user_can_spin`:

```python
def user_can_spin(room: Room, user_id: int) -> bool:
    if room.spin_policy == "anyone":
        return True
    if room.spin_policy == "host_only":
        return room.host_id == user_id
    if room.spin_policy == "turn_based":
        return room.current_turn_user_id == user_id
    return False
```

Remove the old comment about "defer to Phase 11".

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_spins.py -v 2>&1 | tail -15
```

Expected: all spin-service tests pass, including the 4 new ones.

- [ ] **Step 5: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 134 passed (130 + 4), clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/services/spins.py apps/api/tests/services/test_spins.py && git commit -m "feat(api): user_can_spin dispatches turn_based via current_turn_user_id"
```

---

### Task 7: Initial cursor on lobby→active transition

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/services/spins.py`
- Modify: `/home/kali/hoba/apps/api/tests/services/test_spins.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/services/test_spins.py`:

```python
from hoba_api.services.spins import trigger_spin


@pytest.mark.asyncio
async def test_trigger_spin_sets_initial_cursor_on_lobby_to_active_turn_based(
    db, user_factory,
):
    """Host's first spin in a turn_based room sets cursor = host_id."""
    host = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="turn_based",
    )
    assert room.status == "lobby"
    assert room.current_turn_user_id is None
    # Before trigger_spin runs the policy check it must set the cursor
    # to host_id so the host can spin first.
    await trigger_spin(db, room=room, user_id=host.id)
    assert room.status == "active"
    assert room.current_turn_user_id == host.id
```

(Imports `create_room`, `SegmentDraft`, `pytest`, and `Participant` should already be present from earlier tasks; add what's missing.)

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_spins.py::test_trigger_spin_sets_initial_cursor_on_lobby_to_active_turn_based -v 2>&1 | tail -15
```

Expected: failure — `not_allowed_to_spin` raised, because the cursor is None at policy-check time and host is denied.

- [ ] **Step 3: Update `trigger_spin` to set the initial cursor**

Edit `apps/api/src/hoba_api/services/spins.py`. Find the body of `trigger_spin`. Replace the early section (before `user_can_spin` is called) so it reads:

```python
async def trigger_spin(
    session: AsyncSession, *, room: Room, user_id: int,
) -> Spin:
    """Compute + persist a spin. Enforces `spin_policy` and segment count."""
    if room.status == "closed":
        raise RoomServiceError("room_closed")

    # In turn_based rooms, the very first spin (still in lobby) sets the
    # cursor to host_id so the host can kick things off. After that the
    # cursor advances on each spin:settled.
    if (
        room.spin_policy == "turn_based"
        and room.status == "lobby"
        and room.current_turn_user_id is None
    ):
        room.current_turn_user_id = room.host_id

    if not user_can_spin(room, user_id):
        raise RoomServiceError("not_allowed_to_spin")
```

Leave the rest of `trigger_spin` unchanged.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_spins.py::test_trigger_spin_sets_initial_cursor_on_lobby_to_active_turn_based -v 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 135 passed (134 + 1), clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/services/spins.py apps/api/tests/services/test_spins.py && git commit -m "feat(api): turn_based first spin sets cursor=host_id on lobby→active"
```

---

## Phase 2 — Backend integration

### Task 8: REST schema — `RoomCreateIn.game_mode` + optional `spin_policy` + `RoomOut.current_turn_user_id`

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/schemas/room.py`
- Modify: `/home/kali/hoba/apps/api/tests/api/test_rooms.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/api/test_rooms.py`:

```python
def test_post_room_with_game_mode_field_round_trips(authed_client):
    payload = {
        "question_text": "Q?",
        "segments": [{"label": "a"}, {"label": "b"}],
        "game_mode": "elimination",
    }
    resp = authed_client.post("/api/v1/rooms", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["room"]["game_mode"] == "elimination"
    # Mode-default derivation: elimination → host_only.
    assert body["room"]["spin_policy"] == "host_only"
    # New field surfaces on the snapshot.
    assert body["room"]["current_turn_user_id"] is None


def test_post_room_without_game_mode_defaults_to_classic_anyone(authed_client):
    payload = {
        "question_text": "Q?",
        "segments": [{"label": "a"}, {"label": "b"}],
    }
    resp = authed_client.post("/api/v1/rooms", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["room"]["game_mode"] == "classic"
    assert body["room"]["spin_policy"] == "anyone"


def test_post_room_explicit_spin_policy_wins_over_mode(authed_client):
    payload = {
        "question_text": "Q?",
        "segments": [{"label": "a"}, {"label": "b"}],
        "game_mode": "punishment",
        "spin_policy": "anyone",
    }
    resp = authed_client.post("/api/v1/rooms", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["room"]["game_mode"] == "punishment"
    assert body["room"]["spin_policy"] == "anyone"
```

(`authed_client` is an existing conftest fixture used by this test file.)

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/api/test_rooms.py -v -k "game_mode or explicit_spin_policy_wins" 2>&1 | tail -15
```

Expected: at least the first 2 fail (422 Unprocessable Entity on the unknown `game_mode` field, OR 201 with missing `current_turn_user_id`).

- [ ] **Step 3: Update `RoomCreateIn` + `RoomOut`**

Edit `apps/api/src/hoba_api/schemas/room.py`.

For `RoomOut`, add the new field after `is_anonymous`:

```python
class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    host_id: int
    title: str | None
    status: RoomStatus
    game_mode: GameMode
    spin_policy: SpinPolicy
    suggestion_policy: SuggestionPolicy
    is_locked: bool
    is_anonymous: bool
    current_turn_user_id: int | None
    created_at: datetime
    closed_at: datetime | None
```

For `RoomCreateIn`, switch `spin_policy` to optional and add `game_mode`:

```python
class RoomCreateIn(BaseModel):
    question_text: str = Field(min_length=1, max_length=120)
    segments: list[SegmentIn] = Field(min_length=2, max_length=12)
    title: str | None = Field(default=None, max_length=80)
    # When None, services.rooms._derive_spin_policy fills it in from
    # game_mode: Elimination→host_only, Punishment→turn_based,
    # Chaos→anyone, Rigged→host_only, Classic→anyone.
    spin_policy: SpinPolicy | None = Field(default=None)
    suggestion_policy: SuggestionPolicy = "off"
    game_mode: GameMode = "classic"
```

- [ ] **Step 4: Update the create-room API handler to pass game_mode through**

Locate the rooms API handler. The current code path is in `apps/api/src/hoba_api/api/v1/rooms.py`. Find the `create_room_endpoint` (or similarly named) function that calls `services.rooms.create_room`. Pass the new field:

```python
    room = await create_room(
        session,
        host_id=current_user.id,
        question_text=payload.question_text,
        segments=[
            SegmentDraft(
                label=s.label, emoji=s.emoji, color_seed=s.color_seed, weight=s.weight,
            )
            for s in payload.segments
        ],
        title=payload.title,
        spin_policy=payload.spin_policy,  # now Optional, service derives
        suggestion_policy=payload.suggestion_policy,
        game_mode=payload.game_mode,
    )
```

If the call site already used keyword arguments and `spin_policy=payload.spin_policy` was already there, just add the `game_mode` line.

- [ ] **Step 5: Run the API tests**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/api/test_rooms.py -v 2>&1 | tail -20
```

Expected: all tests pass (3 new + existing).

- [ ] **Step 6: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 138 passed (135 + 3), clean.

- [ ] **Step 7: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/schemas/room.py apps/api/src/hoba_api/api/v1/rooms.py apps/api/tests/api/test_rooms.py && git commit -m "feat(api): expose game_mode on RoomCreateIn + current_turn_user_id on RoomOut"
```

---

### Task 9: WS `_emit_settled` advances the cursor + emits `room:updated`

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/realtime/handlers.py`
- Modify: `/home/kali/hoba/apps/api/tests/realtime/test_handlers.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/realtime/test_handlers.py`. The existing tests use `FakeSocketIO` + helpers like `_make_authed_session`, `_join_room`, etc. — pattern-match against them.

```python
@pytest.mark.asyncio
async def test_spin_trigger_turn_based_advances_cursor_and_emits_room_updated(
    sio, db, user_factory,
):
    """After spin:settled, advance_turn fires and room:updated broadcasts the new cursor."""
    host = await user_factory()
    guest = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="turn_based",
    )
    db.add(Participant(room_id=room.id, user_id=guest.id, role="guest"))
    await db.flush()
    await db.commit()

    # Both users present in Redis.
    await presence_set(room.id, host.id)
    await presence_set(room.id, guest.id)

    register_handlers(sio)

    host_sid = await _join_room(sio, db, host, room.code)

    await sio.call("spin:trigger", {}, sid=host_sid)
    # _emit_settled is scheduled — wait for it to fire.
    await _wait_for_event(sio, "spin:settled", room=room.code)
    await _wait_for_event(sio, "room:updated", room=room.code)

    emitted_room_updated = [
        e for e in sio.emitted if e.event == "room:updated" and e.room == room.code
    ]
    assert emitted_room_updated, "expected room:updated emission for cursor advance"
    payload = emitted_room_updated[-1].data
    assert "patch" in payload
    assert payload["patch"]["current_turn_user_id"] == guest.id


@pytest.mark.asyncio
async def test_spin_trigger_turn_based_rejects_off_turn_user(
    sio, db, user_factory,
):
    host = await user_factory()
    guest = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="turn_based",
    )
    db.add(Participant(room_id=room.id, user_id=guest.id, role="guest"))
    await db.flush()
    # Set cursor to host (lobby→active first-spin would do this, but
    # we bypass by setting the cursor explicitly and status active).
    room.status = "active"
    room.current_turn_user_id = host.id
    await db.commit()
    await presence_set(room.id, host.id)
    await presence_set(room.id, guest.id)

    register_handlers(sio)
    guest_sid = await _join_room(sio, db, guest, room.code)
    await sio.call("spin:trigger", {}, sid=guest_sid)
    errors = [e for e in sio.emitted if e.event == "error" and e.to == guest_sid]
    assert any(e.data.get("code") == "not_allowed_to_spin" for e in errors)


@pytest.mark.asyncio
async def test_emit_settled_skips_advance_when_policy_changed_mid_spin(
    sio, db, user_factory,
):
    """If host PATCHed away from turn_based during the spin, advance is skipped."""
    host = await user_factory()
    guest = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="turn_based",
    )
    db.add(Participant(room_id=room.id, user_id=guest.id, role="guest"))
    await db.flush()
    room.status = "active"
    room.current_turn_user_id = host.id
    await db.commit()
    await presence_set(room.id, host.id)
    await presence_set(room.id, guest.id)

    register_handlers(sio)
    host_sid = await _join_room(sio, db, host, room.code)
    await sio.call("spin:trigger", {}, sid=host_sid)

    # Simulate policy flip while the settle timer is pending.
    async with SessionLocal() as session:
        live_room = await get_room_by_code(session, room.code)
        assert live_room is not None
        live_room.spin_policy = "anyone"
        live_room.current_turn_user_id = None
        await session.commit()

    await _wait_for_event(sio, "spin:settled", room=room.code)
    # No room:updated for cursor — policy is no longer turn_based.
    cursor_updates = [
        e for e in sio.emitted
        if e.event == "room:updated"
        and isinstance(e.data, dict)
        and "current_turn_user_id" in (e.data.get("patch") or {})
    ]
    assert not cursor_updates, "advance must skip when policy changed mid-spin"
```

Imports likely already present: `pytest`, `register_handlers`, `Participant`, `SegmentDraft`, `create_room`, `presence_set`, `_join_room`, `_wait_for_event` (or equivalent — match existing patterns in the file). `get_room_by_code` from `hoba_api.services.rooms`, `SessionLocal` from `hoba_api.db` — add these to imports if missing.

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/realtime/test_handlers.py -v -k "turn_based_advances or off_turn_user or policy_changed_mid_spin" 2>&1 | tail -25
```

Expected: 3 failures.

- [ ] **Step 3: Update `_emit_settled` signature + body**

Edit `apps/api/src/hoba_api/realtime/handlers.py`. The current signature is:

```python
async def _emit_settled(
    sio: socketio.AsyncServer,
    room_code: str,
    spin_id: int,
    result_segment_id: int,
    duration_ms: int,
) -> None:
```

Add `room_id: int` to the signature, and after the existing `sio.emit("spin:settled", ...)` block, add the advance+broadcast:

```python
async def _emit_settled(
    sio: socketio.AsyncServer,
    room_code: str,
    room_id: int,
    spin_id: int,
    result_segment_id: int,
    duration_ms: int,
) -> None:
    await asyncio.sleep(duration_ms / 1000)
    await sio.emit(
        "spin:settled",
        {
            "spin_id": spin_id,
            "result_segment_id": result_segment_id,
            "mode_aftereffects": {},
        },
        room=room_code,
        namespace=NAMESPACE,
    )
    # Turn-based: advance the cursor and broadcast the new value so all
    # clients see whose turn it is now. Re-fetch the room because policy
    # may have changed during the spin animation; skip advance if so.
    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        if room is None or room.spin_policy != "turn_based":
            return
        new_cursor = await advance_turn(session, room)
        await session.commit()
    await sio.emit(
        "room:updated",
        {"patch": {"current_turn_user_id": new_cursor}},
        room=room_code,
        namespace=NAMESPACE,
    )
```

Add imports at the top of `handlers.py`:

```python
from hoba_api.models.room import Room
from hoba_api.services.spins import advance_turn
```

(Or extend the existing `hoba_api.services.spins` import line.)

- [ ] **Step 4: Update the call site to pass `room_id`**

Around line 318, the existing call is:

```python
        _schedule(
            _emit_settled(sio, room_code, spin_id, result_segment_id, duration_ms),
        )
```

Replace with:

```python
        _schedule(
            _emit_settled(sio, room_code, room_id, spin_id, result_segment_id, duration_ms),
        )
```

`room_id` is already in scope from `sess.get("room_id")` at the top of `on_spin_trigger`.

- [ ] **Step 5: Run the 3 new handler tests**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/realtime/test_handlers.py -v -k "turn_based_advances or off_turn_user or policy_changed_mid_spin" 2>&1 | tail -20
```

Expected: 3 passed.

- [ ] **Step 6: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 141 passed (138 + 3), clean.

- [ ] **Step 7: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py && git commit -m "feat(api): _emit_settled advances turn_based cursor + broadcasts room:updated"
```

---

### Task 10: `update_room` mid-room flip + reset rules

**Files:**
- Modify: `/home/kali/hoba/apps/api/src/hoba_api/services/rooms.py`
- Modify: `/home/kali/hoba/apps/api/tests/services/test_rooms.py`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/services/test_rooms.py`:

```python
@pytest.mark.asyncio
async def test_update_room_to_turn_based_while_active_sets_cursor_to_host(
    db, user_factory,
):
    host = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="anyone",
    )
    room.status = "active"
    await db.flush()
    assert room.current_turn_user_id is None
    await update_room(db, room, user_id=host.id, patch={"spin_policy": "turn_based"})
    assert room.spin_policy == "turn_based"
    assert room.current_turn_user_id == host.id


@pytest.mark.asyncio
async def test_update_room_to_turn_based_while_in_lobby_leaves_cursor_null(
    db, user_factory,
):
    host = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="anyone",
    )
    # status stays "lobby" — the lobby→active transition's first-spin
    # path will set the cursor when the host actually spins.
    await update_room(db, room, user_id=host.id, patch={"spin_policy": "turn_based"})
    assert room.spin_policy == "turn_based"
    assert room.current_turn_user_id is None


@pytest.mark.asyncio
async def test_update_room_away_from_turn_based_clears_cursor(db, user_factory):
    host = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="turn_based",
    )
    room.status = "active"
    room.current_turn_user_id = host.id
    await db.flush()
    await update_room(db, room, user_id=host.id, patch={"spin_policy": "anyone"})
    assert room.spin_policy == "anyone"
    assert room.current_turn_user_id is None


@pytest.mark.asyncio
async def test_update_room_game_mode_does_not_touch_cursor(db, user_factory):
    host = await user_factory()
    room = await create_room(
        db,
        host_id=host.id,
        question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
        spin_policy="turn_based",
    )
    room.status = "active"
    room.current_turn_user_id = host.id
    await db.flush()
    await update_room(db, room, user_id=host.id, patch={"game_mode": "elimination"})
    assert room.game_mode == "elimination"
    assert room.current_turn_user_id == host.id
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_rooms.py -v -k "update_room and (turn_based or game_mode_does_not)" 2>&1 | tail -20
```

Expected: 4 failures.

- [ ] **Step 3: Update `update_room`**

Edit `apps/api/src/hoba_api/services/rooms.py`. The current `update_room` body is:

```python
async def update_room(
    session: AsyncSession,
    room: Room,
    user_id: int,
    patch: dict[str, object],
) -> Room:
    if room.host_id != user_id:
        raise RoomServiceError("not_host")
    if room.status == "closed":
        raise RoomServiceError("room_closed")

    allowed = {
        "title",
        "spin_policy",
        "suggestion_policy",
        "is_locked",
        "game_mode",
    }
    for key, value in patch.items():
        if key not in allowed:
            continue
        setattr(room, key, value)
    return room
```

Add the policy-transition handling after the setattr loop:

```python
async def update_room(
    session: AsyncSession,
    room: Room,
    user_id: int,
    patch: dict[str, object],
) -> Room:
    if room.host_id != user_id:
        raise RoomServiceError("not_host")
    if room.status == "closed":
        raise RoomServiceError("room_closed")

    allowed = {
        "title",
        "spin_policy",
        "suggestion_policy",
        "is_locked",
        "game_mode",
    }
    new_spin_policy = patch.get("spin_policy") if "spin_policy" in patch else None
    for key, value in patch.items():
        if key not in allowed:
            continue
        setattr(room, key, value)

    # Cursor lifecycle: only meaningful for turn_based.
    # - PATCH away from turn_based → clear cursor.
    # - PATCH to turn_based while status=active → treat as fresh
    #   lobby→active and seed cursor with host_id.
    # - PATCH to turn_based while status=lobby → leave cursor null;
    #   trigger_spin's first-spin path seeds it on lobby→active.
    if new_spin_policy is not None:
        if new_spin_policy != "turn_based":
            room.current_turn_user_id = None
        elif room.status == "active" and room.current_turn_user_id is None:
            room.current_turn_user_id = room.host_id

    return room
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/api && uv run pytest tests/services/test_rooms.py -v -k "update_room and (turn_based or game_mode_does_not)" 2>&1 | tail -15
```

Expected: 4 passed.

- [ ] **Step 5: Run full backend gates**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
```

Expected: 145 passed (141 + 4), clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/api/src/hoba_api/services/rooms.py apps/api/tests/services/test_rooms.py && git commit -m "feat(api): update_room cursor lifecycle on spin_policy transitions"
```

---

## Phase 3 — Frontend types + helpers

### Task 11: Extend `ServerRoom` type

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/lib/api.ts`

- [ ] **Step 1: Add the field**

Edit `apps/webapp/src/lib/api.ts`. Find the `ServerRoom` interface (around line 97). Add `current_turn_user_id` after `is_anonymous`:

```typescript
export interface ServerRoom {
  id: number;
  code: string;
  host_id: number;
  title: string | null;
  status: RoomStatus;
  game_mode: GameMode;
  spin_policy: SpinPolicy;
  suggestion_policy: SuggestionPolicy;
  is_locked: boolean;
  is_anonymous: boolean;
  current_turn_user_id: number | null;
  created_at: string;
  closed_at: string | null;
}
```

(Exact existing field order may differ — append the new field in the same spot as the Python `RoomOut`.)

- [ ] **Step 2: Run tsc**

```bash
cd /home/kali/hoba/apps/webapp && pnpm tsc --noEmit
```

Expected: clean. (No call sites are using the new field yet — addition is non-breaking.)

- [ ] **Step 3: Run existing frontend tests**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test
```

Expected: 53 passed (unchanged — test fixtures may need updating if they construct `ServerRoom` literals; if so, see next step).

- [ ] **Step 4: If any test failed due to ServerRoom shape, patch the fixtures**

If tests fail with TypeScript errors about missing `current_turn_user_id` in test object literals, find the offending test files (likely `apps/webapp/src/features/rooms/__tests__/permissions.test.ts`) and add `current_turn_user_id: null` to each ServerRoom mock. Do NOT add new test cases yet — that's Task 12. Just make the field present (null) to satisfy the type.

Re-run:

```bash
cd /home/kali/hoba/apps/webapp && pnpm test && pnpm tsc --noEmit
```

Expected: 53 passed, tsc clean.

- [ ] **Step 5: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src && git commit -m "feat(webapp): ServerRoom carries current_turn_user_id"
```

---

### Task 12: `computeCanSpin` turn_based branch

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/features/rooms/permissions.ts`
- Modify: `/home/kali/hoba/apps/webapp/src/features/rooms/__tests__/permissions.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/webapp/src/features/rooms/__tests__/permissions.test.ts`. The existing tests build snapshots via helpers (likely `makeSnapshot()` / `makeRoom()` / similar — pattern-match against existing cases). Add two new tests:

```typescript
describe("computeCanSpin — turn_based", () => {
  it("returns true when current_turn_user_id matches me_user_id", () => {
    const snapshot = makeSnapshot({
      spin_policy: "turn_based",
      current_turn_user_id: 7,
      me_user_id: 7,
      participants: [
        { user_id: 7, role: "host" },
        { user_id: 9, role: "guest" },
      ],
    });
    expect(computeCanSpin(snapshot)).toBe(true);
  });

  it("returns false when current_turn_user_id is someone else", () => {
    const snapshot = makeSnapshot({
      spin_policy: "turn_based",
      current_turn_user_id: 9,
      me_user_id: 7,
      participants: [
        { user_id: 7, role: "host" },
        { user_id: 9, role: "guest" },
      ],
    });
    expect(computeCanSpin(snapshot)).toBe(false);
  });

  it("returns false when current_turn_user_id is null", () => {
    const snapshot = makeSnapshot({
      spin_policy: "turn_based",
      current_turn_user_id: null,
      me_user_id: 7,
      participants: [{ user_id: 7, role: "host" }],
    });
    expect(computeCanSpin(snapshot)).toBe(false);
  });
});
```

If `makeSnapshot` doesn't accept `current_turn_user_id` yet, extend it in the test file's helpers section first.

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test src/features/rooms/__tests__/permissions.test.ts 2>&1 | tail -20
```

Expected: 3 failures (current code falls back to host check; first test fails because user 7 is host so it accidentally returns true → but wait, it WOULD return true for test 1. Let me re-check: current computeCanSpin for not-anyone goes to `myParticipant?.role === "host"`. For test 1 (me=7=host), returns true; test 2 (me=7=host, but turn is on 9), still returns true because host. So test 2 fails. Test 3 (me=7=host, cursor=null), still returns true. So tests 2 and 3 fail.)

Actually the failure picture depends on the exact starting code — re-run the command to see.

- [ ] **Step 3: Update `computeCanSpin`**

Edit `apps/webapp/src/features/rooms/permissions.ts`. Replace the function body:

```typescript
export function computeCanSpin(snapshot: RoomState | null): boolean {
  if (snapshot === null) return false;
  if (snapshot.room.spin_policy === "anyone") return true;
  const myUserId = snapshot.me_user_id;
  if (snapshot.room.spin_policy === "turn_based") {
    return snapshot.room.current_turn_user_id === myUserId;
  }
  // host_only fallback
  const myParticipant = snapshot.participants.find(
    (p) => p.user_id === myUserId,
  );
  return myParticipant?.role === "host";
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test src/features/rooms/__tests__/permissions.test.ts 2>&1 | tail -15
```

Expected: all permissions tests pass.

- [ ] **Step 5: Run all frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test && pnpm lint && pnpm tsc --noEmit
```

Expected: 56 passed (53 + 3), lint clean, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/features/rooms && git commit -m "feat(webapp): computeCanSpin dispatches turn_based via current_turn_user_id"
```

---

### Task 13: `computeTurnState` helper + tests

**Files:**
- Create: `/home/kali/hoba/apps/webapp/src/features/rooms/turnState.ts`
- Create: `/home/kali/hoba/apps/webapp/src/features/rooms/__tests__/turnState.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/webapp/src/features/rooms/__tests__/turnState.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeTurnState } from "../turnState";
import type { RoomState, ServerRoom, ServerParticipant } from "@/lib/api";

function makeRoom(overrides: Partial<ServerRoom> = {}): ServerRoom {
  return {
    id: 1,
    code: "ABC123",
    host_id: 1,
    title: null,
    status: "active",
    game_mode: "classic",
    spin_policy: "turn_based",
    suggestion_policy: "off",
    is_locked: false,
    is_anonymous: false,
    current_turn_user_id: null,
    created_at: "2026-05-28T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

function makeParticipant(
  user_id: number,
  display_name: string | null,
  role: "host" | "guest" = "guest",
): ServerParticipant {
  return {
    user_id,
    role,
    display_name,
    joined_at: "2026-05-28T00:00:00Z",
    last_seen_at: "2026-05-28T00:00:00Z",
  };
}

function makeSnapshot(overrides: Partial<RoomState> = {}): RoomState {
  return {
    room: makeRoom(),
    participants: [],
    active_question: null,
    last_spin: null,
    me_user_id: 1,
    ...overrides,
  };
}

describe("computeTurnState", () => {
  it("returns not_turn_based for null snapshot", () => {
    expect(computeTurnState(null)).toEqual({ kind: "not_turn_based" });
  });

  it("returns not_turn_based when policy != turn_based", () => {
    const snapshot = makeSnapshot({
      room: makeRoom({ spin_policy: "anyone" }),
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "not_turn_based" });
  });

  it("returns my_turn when cursor matches me_user_id", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 7 }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "my_turn" });
  });

  it("returns waiting with name when cursor points to a known participant", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 9 }),
      participants: [
        makeParticipant(7, "Volo", "host"),
        makeParticipant(9, "Anna"),
      ],
    });
    expect(computeTurnState(snapshot)).toEqual({
      kind: "waiting",
      whoUserId: 9,
      whoName: "Anna",
    });
  });

  it("returns waiting with null name when participant has no display_name", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 9 }),
      participants: [
        makeParticipant(7, "Volo", "host"),
        makeParticipant(9, null),
      ],
    });
    expect(computeTurnState(snapshot)).toEqual({
      kind: "waiting",
      whoUserId: 9,
      whoName: null,
    });
  });

  it("returns no_one when cursor is null", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: null }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "no_one" });
  });

  it("returns no_one when cursor points to an unknown participant (defensive)", () => {
    const snapshot = makeSnapshot({
      me_user_id: 7,
      room: makeRoom({ current_turn_user_id: 42 }),
      participants: [makeParticipant(7, "Volo", "host")],
    });
    expect(computeTurnState(snapshot)).toEqual({ kind: "no_one" });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test src/features/rooms/__tests__/turnState.test.ts 2>&1 | tail -15
```

Expected: import failure — `turnState` doesn't exist yet.

- [ ] **Step 3: Create `turnState.ts`**

Create `apps/webapp/src/features/rooms/turnState.ts`:

```typescript
import { type RoomState } from "@/lib/api";

/**
 * Status of the turn cursor as the room screen needs to render it.
 * Only meaningful when room.spin_policy === "turn_based"; otherwise
 * the discriminated union resolves to `not_turn_based` and the UI
 * suppresses the status line entirely.
 */
export type TurnState =
  | { kind: "not_turn_based" }
  | { kind: "my_turn" }
  | { kind: "waiting"; whoUserId: number; whoName: string | null }
  | { kind: "no_one" };

export function computeTurnState(snapshot: RoomState | null): TurnState {
  if (snapshot === null) return { kind: "not_turn_based" };
  if (snapshot.room.spin_policy !== "turn_based") {
    return { kind: "not_turn_based" };
  }
  const cursor = snapshot.room.current_turn_user_id;
  if (cursor === null) return { kind: "no_one" };
  if (cursor === snapshot.me_user_id) return { kind: "my_turn" };
  const who = snapshot.participants.find((p) => p.user_id === cursor);
  if (who === undefined) return { kind: "no_one" };
  return { kind: "waiting", whoUserId: cursor, whoName: who.display_name };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test src/features/rooms/__tests__/turnState.test.ts 2>&1 | tail -15
```

Expected: 7 passed.

- [ ] **Step 5: Run all frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test && pnpm lint && pnpm tsc --noEmit
```

Expected: 63 passed (56 + 7), lint clean, tsc clean.

- [ ] **Step 6: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/features/rooms && git commit -m "feat(webapp): computeTurnState helper for turn-based room header"
```

---

## Phase 4 — Frontend UI + i18n

### Task 14: i18n keys EN + UK

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/locales/en/room.json`
- Modify: `/home/kali/hoba/apps/webapp/src/locales/uk/room.json`

- [ ] **Step 1: Add EN keys**

Open `apps/webapp/src/locales/en/room.json`. The existing structure is a nested JSON object (top-level keys like `errors`, `share`, `actions`, etc.). Add a new top-level key `turn` somewhere alphabetically reasonable:

```json
{
  "turn": {
    "my_turn": "Your turn",
    "waiting_named": "Waiting for {{name}}",
    "waiting_unnamed": "Waiting for next player",
    "no_one": "Waiting for someone to join"
  }
}
```

Preserve every existing key — only add the `turn` block.

- [ ] **Step 2: Add UK keys**

Open `apps/webapp/src/locales/uk/room.json`. Add the mirror block with natural Ukrainian (not transliterated EN — per Stage A item 9):

```json
{
  "turn": {
    "my_turn": "Ваш хід",
    "waiting_named": "Чекаємо на {{name}}",
    "waiting_unnamed": "Чекаємо наступного гравця",
    "no_one": "Чекаємо, поки хтось приєднається"
  }
}
```

- [ ] **Step 3: Run i18n:check from repo root**

```bash
cd /home/kali/hoba && pnpm i18n:check
```

Expected: passes with the same advisory warnings as before (no NEW "unused (maybe)" warnings — the keys land in production code in the next task). If parity fails, fix the divergence and re-run.

- [ ] **Step 4: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/locales && git commit -m "feat(webapp): room.turn EN + UK localization for turn-based status"
```

---

### Task 15: Room-header turn status line + final i18n:check

**Files:**
- Modify: `/home/kali/hoba/apps/webapp/src/pages/RoomPage.tsx`

- [ ] **Step 1: Inspect the existing RoomPage layout**

```bash
cd /home/kali/hoba && grep -n "RoomCodePill\|spin_policy\|Host spins\|t(" apps/webapp/src/pages/RoomPage.tsx | head -30
```

Identify where the existing "Host spins. React with the bar above." hint is rendered. That's the slot where the turn-based hint replaces it.

- [ ] **Step 2: Import the helper**

At the top of `apps/webapp/src/pages/RoomPage.tsx`, add:

```typescript
import { computeTurnState } from "@/features/rooms/turnState";
```

- [ ] **Step 3: Compute turn state in the component body**

Inside the component (after the snapshot is read from the store), add:

```typescript
const turnState = computeTurnState(snapshot);
```

(`snapshot` is the existing variable read from `useRoomStore`; match the existing access pattern.)

- [ ] **Step 4: Render the status line**

Find the existing host-only hint render (something like `<p>{t("room:hints.host_spins")}</p>` or similar). Wrap the render so that **for turn_based rooms** the new line is shown instead. Reference implementation — adjust to match existing JSX style:

```tsx
{turnState.kind === "my_turn" && (
  <p className="text-base text-brand-amber-3">
    {t("room:turn.my_turn")}
  </p>
)}
{turnState.kind === "waiting" && (
  <p className="text-base text-ink-light-2 dark:text-ink-dark-2">
    {turnState.whoName !== null
      ? t("room:turn.waiting_named", { name: turnState.whoName })
      : t("room:turn.waiting_unnamed")}
  </p>
)}
{turnState.kind === "no_one" && (
  <p className="text-base text-ink-light-2 dark:text-ink-dark-2">
    {t("room:turn.no_one")}
  </p>
)}
{turnState.kind === "not_turn_based" && snapshot?.room.spin_policy === "host_only" && (
  <p className="text-base text-ink-light-2 dark:text-ink-dark-2">
    {t("room:hints.host_spins")}
  </p>
)}
```

Use whatever exact translation key + class tokens exist in the current file for the host-only hint — the goal is: existing host-only hint stays for host_only rooms; new turn hints take over for turn_based rooms; everything else (anyone policy) renders neither.

- [ ] **Step 5: Run i18n:check from repo root**

```bash
cd /home/kali/hoba && pnpm i18n:check
```

Expected: passes. The 4 new keys should NOT appear as "unused (maybe)" any more — they're now referenced in source.

- [ ] **Step 6: Run frontend gates**

```bash
cd /home/kali/hoba/apps/webapp && pnpm test && pnpm lint && pnpm tsc --noEmit
```

Expected: 63 passed, lint clean, tsc clean.

- [ ] **Step 7: Visual verification in dev server (optional but recommended)**

```bash
cd /home/kali/hoba && docker compose up -d webapp api redis
```

Open `http://localhost:5173/`, create a room with `spin_policy: "turn_based"` (use the API directly if no UI exposes it: `curl -X POST http://localhost:8000/api/v1/rooms -H "X-Telegram-Init-Data: ..." -d '{"question_text":"Q?","segments":[{"label":"a"},{"label":"b"}],"spin_policy":"turn_based"}'`). Verify the header shows "Your turn" (host) and that after triggering a spin the cursor advances and the line updates.

For inline execution: skipping the visual check is acceptable as long as `i18n:check`, `tsc`, and `lint` pass — the existing `computeTurnState` test coverage proves the data flow.

- [ ] **Step 8: Commit**

```bash
cd /home/kali/hoba && git add apps/webapp/src/pages/RoomPage.tsx && git commit -m "feat(webapp): room-header turn status line driven by computeTurnState"
```

---

## Phase 5 — Exit

### Task 16: Final quality-gate run

**Files:** None (verification only).

- [ ] **Step 1: Run all gates back-to-back**

```bash
cd /home/kali/hoba/apps/api && uv run pytest -q 2>&1 | tail -5 && uv run ruff check . && uv run mypy --strict src
cd /home/kali/hoba/apps/webapp && pnpm test && pnpm lint && pnpm tsc --noEmit
cd /home/kali/hoba && pnpm i18n:check
```

Expected: 145 backend / 63 frontend (totals: 113+18 = 131 was the prediction, actual may differ by ±2 depending on how tests were grouped during execution; spec said ~131 / ~61). ruff / mypy --strict / eslint / tsc / i18n:check all clean.

If any gate fails, fix the regression. Do NOT mask with `@pytest.mark.skip` or `eslint-disable` — diagnose root cause.

- [ ] **Step 2: Confirm working tree is clean**

```bash
cd /home/kali/hoba && git status
```

Expected: `nothing to commit, working tree clean`.

If the tree is dirty: figure out what's there (likely a debug file or stray edit). Commit or discard per case.

- [ ] **Step 3: Strike the two open Stage D TODO items**

The plan covers both. Edit `docs/TODO.md` — strike lines 6 and 7 (`stage:D — modes — finish turn_based spin policy` and `stage:D — mode defaults`). Add them to a new `## Resolved in Stage D — turn-based + mode-defaults (2026-05-28)` section. Each struck line gets the commit hashes that closed it.

- [ ] **Step 4: Commit the TODO update**

```bash
cd /home/kali/hoba && git add docs/TODO.md && git commit -m "docs(todo): strike Stage D turn_based + mode-default items (closed by this plan)"
```

---

### Task 17: Status block + handoff

**Files:** None (final chat message to owner).

- [ ] **Step 1: Compose the status block**

Write a chat message to the owner with:

- **Commits landed** — list of all commits from this plan (Tasks 2–10 + 11–15 + 16's TODO commit).
- **Backend changes** — column added, helpers added (`advance_turn`, `_derive_spin_policy`), services updated (`create_room`, `user_can_spin`, `trigger_spin`, `update_room`, `_emit_settled`), schemas updated, ~18 new tests.
- **Frontend changes** — type extension, `computeCanSpin` update, new `computeTurnState`, room-header status line, 4 new i18n keys × 2 locales, ~10 new tests.
- **Quality gates at exit** — final test totals and clean lint/type output.
- **What's now unblocked** — Stage D mode work (Punishment + Elimination + Chaos UI can build on top of turn_based; Rigged can build on host_only).
- **What did NOT change** — `CLAUDE.md` "Current phase" (stays at "Stage C closed / Stage D in progress"), no memory rewrites, no `STAGE D COMPLETE` ritual (only the foundation pieces shipped; full Stage D charter is still open).

- [ ] **Step 2: End the session**

End the session message with: "Foundation pieces complete. The two Stage D TODO items are closed; the next slice (a mode picker UI + per-mode game logic) is its own brainstorming arc."

---

## Self-review

**1. Spec coverage** — every spec section maps to a task:

- §Goal item 1 (turn_based end-to-end) → Tasks 2, 5, 6, 7, 9 (backend) + 11, 12, 13, 14, 15 (frontend).
- §Goal item 2 (mode-default derivation) → Tasks 3, 4, 8.
- §Backend data model — `current_turn_user_id` column → Task 2 (Alembic + model).
- §Backend service helpers (`advance_turn`, `user_can_spin` dispatch) → Tasks 5, 6.
- §Initial cursor on lobby→active → Task 7.
- §Mid-room flip + cursor reset rules → Task 10.
- §`_derive_spin_policy` → Task 3.
- §Backend integration (`_emit_settled` advance + `room:updated` broadcast + REST schema + RoomState DTO) → Tasks 8, 9.
- §Frontend type extension + `computeCanSpin` + `computeTurnState` → Tasks 11, 12, 13.
- §Frontend UI (room-header status line) + i18n → Tasks 14, 15.
- §Testing strategy — backend test additions covered across Tasks 3, 4, 5, 6, 7, 8, 9, 10. Frontend across 12, 13.
- §Risks — migration safety (Task 2), Redis-wipe stall (advance_turn returns None branch covered in Task 5), concurrent settled race (out of scope per spec), policy-changed-mid-spin (Task 9 explicit test), Pydantic null vs absent (Task 8 explicit tests).

No gaps.

**2. Placeholder scan** — searched for "TBD", inline "TODO" (in instruction text vs code-content references), "implement later", "fill in details", "handle edge cases", "similar to Task N", "add appropriate error handling": no matches in instruction text. All step bodies contain either runnable commands, complete code, or full edit-locator instructions.

**3. Type consistency** —
- `advance_turn(session, room) -> int | None` — used identically in Task 5 (declaration), Task 9 (call site in `_emit_settled`).
- `_derive_spin_policy(explicit, game_mode) -> str` — Task 3 declaration matches Task 4 call site.
- `computeTurnState(snapshot) -> TurnState` — Task 13 declaration matches Task 15 call site.
- `current_turn_user_id` — same field name across Python model (Task 2), Pydantic schema (Task 8), TypeScript interface (Task 11), test fixtures (Tasks 5, 6, 7, 9, 10, 12, 13).
- `MODE_DEFAULT_SPIN_POLICY` dict — only referenced in Task 3, no downstream consistency concerns.

No naming drift.

**4. Command consistency** — all `cd /home/kali/hoba/...` paths absolute. `pnpm test` (no `--run` flag — script wraps `vitest run`). `pnpm i18n:check` always run from repo root. `uv run` prefix for every backend command. Matches the cleanup-pass plan's verified-working command shapes.
