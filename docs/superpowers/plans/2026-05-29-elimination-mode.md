# Elimination Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Elimination mode (spec §5.2) — the winning segment shatters off the wheel each spin until one survivor remains, then the host can reset for a new round — on top of a new `GameModeEngine` abstraction.

**Architecture:** Pure, DB-free mode engines (`ClassicEngine`, `EliminationEngine`) return declarative decisions; the spin service + Socket.IO handlers apply persistence. Eliminated segments are tracked by a new nullable `Segment.eliminated_at` column. Server spins over living segments only; the client renders the same living set via `SegmentOut.is_eliminated`, so the animation always lands true.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 async / Alembic / python-socketio / pytest (backend); React 18 / TS / Zustand / Framer Motion / Vitest (frontend).

**Reference spec:** `docs/superpowers/specs/2026-05-29-elimination-mode-design.md`.

**Deviation from spec (resolved here):** round reset uses a dedicated `round:reset` broadcast event (clients revive segments locally), NOT a broadcast `room:state` — because `room:state.me_user_id` is per-connection and must never be broadcast to multiple clients.

**Quality gates (run before declaring done):** `uv run --extra dev pytest` + `uv run --extra dev mypy --strict src` + `uv run --extra dev ruff check src tests` (in `apps/api`); `pnpm vitest run` + `pnpm tsc --noEmit` + `pnpm run lint` + `node scripts/i18n-check.mjs` (in `apps/webapp`).

---

## File Structure

**Backend (create):**
- `apps/api/src/hoba_api/modes/__init__.py` — exports `engine_for`.
- `apps/api/src/hoba_api/modes/base.py` — Protocol + dataclasses.
- `apps/api/src/hoba_api/modes/classic.py` — `ClassicEngine`.
- `apps/api/src/hoba_api/modes/elimination.py` — `EliminationEngine`.
- `apps/api/src/hoba_api/modes/registry.py` — `engine_for`.
- `apps/api/alembic/versions/0005_add_segment_eliminated_at.py`.
- `apps/api/tests/modes/test_engines.py`, `apps/api/tests/modes/test_registry.py`.

**Backend (modify):**
- `apps/api/src/hoba_api/models/segment.py` — `eliminated_at` column + `is_eliminated` property.
- `apps/api/src/hoba_api/schemas/room.py` — `SegmentOut.is_eliminated`.
- `apps/api/src/hoba_api/services/spins.py` — engine-driven `trigger_spin`.
- `apps/api/src/hoba_api/realtime/handlers.py` — `_emit_settled` mode handling + `round:reset` handler.

**Frontend (create):**
- `apps/webapp/src/features/rooms/elimination.ts` + `__tests__/elimination.test.ts`.

**Frontend (modify):**
- `apps/webapp/src/lib/api.ts` — `ServerSegment.is_eliminated`, `SpinSettledEvent.mode_aftereffects`.
- `apps/webapp/src/stores/room.ts` — settle aftereffect, `round:reset`, `resetRound`.
- `apps/webapp/src/pages/RoomPage.tsx` — living wheel, Remaining/banner/New-round/strip.
- `apps/webapp/src/locales/en/room.json`, `.../uk/room.json` — `elimination.*`.

**Docs:** `docs/game-modes.md` (create), `CLAUDE.md` (index entry).

---

## Task 1: Mode engine base + ClassicEngine

**Files:**
- Create: `apps/api/src/hoba_api/modes/__init__.py`, `base.py`, `classic.py`
- Test: `apps/api/tests/modes/test_engines.py`

- [ ] **Step 1: Write the failing test** — `apps/api/tests/modes/test_engines.py`

```python
"""Mode engine behaviour — pure, no DB."""
from __future__ import annotations

from hoba_api.models.room import Room
from hoba_api.models.segment import Segment
from hoba_api.modes.base import SpinContext
from hoba_api.modes.classic import ClassicEngine


def _seg(seg_id: int, position: int, eliminated: bool = False) -> Segment:
    s = Segment(
        id=seg_id, parent_id=1, parent_type="question",
        label=f"s{seg_id}", color_seed=0, weight=1, position=position,
    )
    if eliminated:
        from datetime import UTC, datetime
        s.eliminated_at = datetime.now(UTC)
    return s


def _ctx(segments: list[Segment]) -> SpinContext:
    room = Room(code="ABC123", host_id=1, status="active",
                game_mode="classic", spin_policy="anyone", suggestion_policy="off")
    return SpinContext(room=room, question=None, segments=segments)


def test_classic_visible_is_all_and_never_round_over() -> None:
    segs = [_seg(1, 0), _seg(2, 1)]
    e = ClassicEngine()
    ctx = _ctx(segs)
    assert e.get_visible_segments(ctx) == segs
    d = e.on_spin_request(ctx)
    assert d.segments == segs
    assert d.duration_multiplier == 1.0
    assert d.effects == {}
    eff = e.on_spin_settled(ctx, segs[0])
    assert eff.eliminate_segment_ids == []
    assert eff.round_over is False
    assert e.is_round_over(ctx) is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_engines.py --no-cov -q`
Expected: FAIL — `ModuleNotFoundError: hoba_api.modes`.

- [ ] **Step 3: Create `apps/api/src/hoba_api/modes/base.py`**

```python
"""GameModeEngine protocol + the pure data objects engines exchange.

Engines never touch the DB. They read a SpinContext and return declarative
decisions; the spin service / handlers apply persistence. This keeps every
engine unit-testable without a session (spec §5).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from hoba_api.models.question import Question
from hoba_api.models.room import Room
from hoba_api.models.segment import Segment


@dataclass(frozen=True)
class SpinContext:
    room: Room
    question: Question | None
    segments: list[Segment]  # ALL segments of the question, position order


@dataclass(frozen=True)
class SpinDecision:
    segments: list[Segment]            # segments to spin over (living), position order
    duration_multiplier: float = 1.0   # scales the computed spin duration
    effects: dict[str, object] = field(default_factory=dict)  # -> spin:started.mode_effects


@dataclass(frozen=True)
class ModeEffects:
    eliminate_segment_ids: list[int] = field(default_factory=list)
    round_over: bool = False
    extra: dict[str, object] = field(default_factory=dict)


class GameModeEngine(Protocol):
    mode_id: str

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision: ...
    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects: ...
    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]: ...
    def is_round_over(self, ctx: SpinContext) -> bool: ...
```

- [ ] **Step 4: Create `apps/api/src/hoba_api/modes/classic.py`**

```python
"""Classic mode — no special behaviour. The fallback engine."""
from __future__ import annotations

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision


class ClassicEngine:
    mode_id = "classic"

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return ctx.segments

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        return SpinDecision(segments=ctx.segments)

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        return ModeEffects()

    def is_round_over(self, ctx: SpinContext) -> bool:
        return False
```

- [ ] **Step 5: Create `apps/api/src/hoba_api/modes/__init__.py`** (docstring only for now — the `engine_for` export is added in Task 3, after `registry.py` exists; importing it here would break Task 1's tests because importing any submodule runs the package `__init__`)

```python
"""Game mode engines (spec §5)."""
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_engines.py --no-cov -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/hoba_api/modes/base.py apps/api/src/hoba_api/modes/classic.py apps/api/src/hoba_api/modes/__init__.py apps/api/tests/modes/test_engines.py
git commit -m "feat(api): mode engine base + ClassicEngine"
```

---

## Task 2: Segment.eliminated_at (model + property + migration)

**Files:**
- Modify: `apps/api/src/hoba_api/models/segment.py`
- Create: `apps/api/alembic/versions/0005_add_segment_eliminated_at.py`
- Test: `apps/api/tests/modes/test_engines.py` (extend)

- [ ] **Step 1: Add a failing test for the property** — append to `tests/modes/test_engines.py`

```python
def test_segment_is_eliminated_property() -> None:
    from datetime import UTC, datetime
    s = Segment(id=9, parent_id=1, parent_type="question", label="x",
                color_seed=0, weight=1, position=0)
    assert s.is_eliminated is False
    s.eliminated_at = datetime.now(UTC)
    assert s.is_eliminated is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_engines.py::test_segment_is_eliminated_property --no-cov -q`
Expected: FAIL — `AttributeError: eliminated_at` / `is_eliminated`.

- [ ] **Step 3: Modify `apps/api/src/hoba_api/models/segment.py`**

Add imports (`DateTime` to the sqlalchemy import block, `datetime` + `UTC` not needed here) and the column + property. Final imports block:

```python
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column
```

Add after the `position` column:

```python
    # Set when this segment is eliminated (Elimination mode, spec §5.2).
    # NULL = living. Other modes never write it.
    eliminated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    @property
    def is_eliminated(self) -> bool:
        return self.eliminated_at is not None
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/test_engines.py::test_segment_is_eliminated_property --no-cov -q`
Expected: PASS.

- [ ] **Step 5: Create `apps/api/alembic/versions/0005_add_segment_eliminated_at.py`**

```python
"""add eliminated_at to segments

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-29

Nullable timestamp for Elimination mode (spec §5.2). NULL = living.
Uses op.add_column directly (not batch_alter_table) per the 0004 lesson
in docs/deployment.md §9b.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "segments",
        sa.Column("eliminated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("segments", "eliminated_at")
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/models/segment.py apps/api/alembic/versions/0005_add_segment_eliminated_at.py apps/api/tests/modes/test_engines.py
git commit -m "feat(api): segments.eliminated_at column + is_eliminated"
```

---

## Task 3: EliminationEngine + registry

**Files:**
- Create: `apps/api/src/hoba_api/modes/elimination.py`, `registry.py`
- Test: `apps/api/tests/modes/test_engines.py` (extend), `apps/api/tests/modes/test_registry.py`

- [ ] **Step 1: Write failing tests** — append to `tests/modes/test_engines.py`

```python
from hoba_api.modes.elimination import EliminationEngine


def test_elimination_visible_excludes_eliminated() -> None:
    segs = [_seg(1, 0, eliminated=True), _seg(2, 1), _seg(3, 2)]
    e = EliminationEngine()
    visible = e.get_visible_segments(_ctx(segs))
    assert [s.id for s in visible] == [2, 3]


def test_elimination_request_dramatic_when_two_living() -> None:
    e = EliminationEngine()
    two = _ctx([_seg(1, 0), _seg(2, 1)])
    d = e.on_spin_request(two)
    assert d.duration_multiplier == 1.5
    assert d.effects == {"dramatic": True}
    three = _ctx([_seg(1, 0), _seg(2, 1), _seg(3, 2)])
    assert e.on_spin_request(three).duration_multiplier == 1.0
    assert e.on_spin_request(three).effects == {}


def test_elimination_settled_marks_winner_and_round_over() -> None:
    e = EliminationEngine()
    segs = [_seg(1, 0), _seg(2, 1)]  # 2 living -> after removing winner, 1 -> round over
    eff = e.on_spin_settled(_ctx(segs), segs[0])
    assert eff.eliminate_segment_ids == [1]
    assert eff.round_over is True
    segs3 = [_seg(1, 0), _seg(2, 1), _seg(3, 2)]
    eff3 = e.on_spin_settled(_ctx(segs3), segs3[0])
    assert eff3.eliminate_segment_ids == [1]
    assert eff3.round_over is False
```

And create `tests/modes/test_registry.py`:

```python
from hoba_api.modes.registry import engine_for


def test_registry_known_modes() -> None:
    assert engine_for("classic").mode_id == "classic"
    assert engine_for("elimination").mode_id == "elimination"


def test_registry_unknown_falls_back_to_classic() -> None:
    for mode in ("punishment", "chaos", "rigged", "nonsense"):
        assert engine_for(mode).mode_id == "classic"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/ --no-cov -q`
Expected: FAIL — `ModuleNotFoundError: hoba_api.modes.elimination` / `.registry`.

- [ ] **Step 3: Create `apps/api/src/hoba_api/modes/elimination.py`**

```python
"""Elimination mode (spec §5.2) — winner shatters off; last survivor wins."""
from __future__ import annotations

from hoba_api.models.segment import Segment
from hoba_api.modes.base import ModeEffects, SpinContext, SpinDecision

DRAMATIC_MULTIPLIER = 1.5
FINAL_DUEL_COUNT = 2


class EliminationEngine:
    mode_id = "elimination"

    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]:
        return [s for s in ctx.segments if s.eliminated_at is None]

    def on_spin_request(self, ctx: SpinContext) -> SpinDecision:
        living = self.get_visible_segments(ctx)
        if len(living) == FINAL_DUEL_COUNT:
            return SpinDecision(
                segments=living,
                duration_multiplier=DRAMATIC_MULTIPLIER,
                effects={"dramatic": True},
            )
        return SpinDecision(segments=living)

    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects:
        living_after = len(self.get_visible_segments(ctx)) - 1
        return ModeEffects(
            eliminate_segment_ids=[winner.id],
            round_over=living_after <= 1,
        )

    def is_round_over(self, ctx: SpinContext) -> bool:
        return len(self.get_visible_segments(ctx)) <= 1
```

- [ ] **Step 4: Create `apps/api/src/hoba_api/modes/registry.py`**

```python
"""Maps a room.game_mode to its engine. Unknown/unbuilt modes fall back
to Classic so they keep spinning until their own slice lands."""
from __future__ import annotations

from hoba_api.modes.base import GameModeEngine
from hoba_api.modes.classic import ClassicEngine
from hoba_api.modes.elimination import EliminationEngine

_ENGINES: dict[str, GameModeEngine] = {
    "classic": ClassicEngine(),
    "elimination": EliminationEngine(),
}
_FALLBACK: GameModeEngine = _ENGINES["classic"]


def engine_for(game_mode: str) -> GameModeEngine:
    return _ENGINES.get(game_mode, _FALLBACK)
```

Ensure `apps/api/src/hoba_api/modes/__init__.py` contains `from hoba_api.modes.registry import engine_for` and `__all__ = ["engine_for"]`.

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/api && uv run --extra dev pytest tests/modes/ --no-cov -q`
Expected: PASS (all engine + registry tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/modes/elimination.py apps/api/src/hoba_api/modes/registry.py apps/api/src/hoba_api/modes/__init__.py apps/api/tests/modes/
git commit -m "feat(api): EliminationEngine + mode registry"
```

---

## Task 4: SegmentOut.is_eliminated on the wire

**Files:**
- Modify: `apps/api/src/hoba_api/schemas/room.py:24-31` (the `SegmentOut` class)
- Test: `apps/api/tests/services/test_room_state.py` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/services/test_room_state.py`

```python
async def test_segment_out_carries_is_eliminated(db: AsyncSession) -> None:
    from datetime import UTC, datetime

    from hoba_api.models.segment import Segment

    host = await upsert_from_telegram(db, TelegramUser(id=9101, first_name="H"))
    await db.flush()
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a"), SegmentDraft(label="b")],
    )
    await db.commit()
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    # Eliminate the first segment directly.
    q = next(qq for qq in fetched.questions if qq.is_active)
    seg = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().first()
    seg.eliminated_at = datetime.now(UTC)
    await db.commit()

    state = await build_room_state(db, fetched, current_user_id=host.id)
    flags = {s.id: s.is_eliminated for s in state.active_question.segments}
    assert flags[seg.id] is True
    assert sum(1 for v in flags.values() if not v) == 1
```

Add `from sqlalchemy import select` to that test file's imports if missing.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_room_state.py::test_segment_out_carries_is_eliminated --no-cov -q`
Expected: FAIL — `AttributeError`/`ValidationError`: `SegmentOut` has no `is_eliminated`.

- [ ] **Step 3: Modify `SegmentOut` in `apps/api/src/hoba_api/schemas/room.py`**

Add the field (after `position`):

```python
class SegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    emoji: str | None
    color_seed: int
    weight: int
    position: int
    is_eliminated: bool = False
```

(`from_attributes` reads the `is_eliminated` property added on the `Segment` model in Task 2.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_room_state.py --no-cov -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/hoba_api/schemas/room.py apps/api/tests/services/test_room_state.py
git commit -m "feat(api): expose segment is_eliminated in room snapshot"
```

---

## Task 5: Engine-driven trigger_spin

**Files:**
- Modify: `apps/api/src/hoba_api/services/spins.py:23-112` (`trigger_spin`)
- Test: `apps/api/tests/services/test_spins.py` (extend)

- [ ] **Step 1: Write failing tests** — append to `tests/services/test_spins.py`

```python
async def test_trigger_spin_elimination_spins_over_living_only(
    db: AsyncSession,
) -> None:
    from datetime import UTC, datetime

    from hoba_api.models.segment import Segment

    host_id = await _make_user(db, tg_id=300)
    room = await create_room(
        db, host_id=host_id, question_text="Q?",
        segments=_drafts(3), spin_policy="anyone", game_mode="elimination",
    )
    q = next(qq for qq in room.questions if qq.is_active)
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    segs[0].eliminated_at = datetime.now(UTC)  # only 2 living
    await db.flush()

    spin = await trigger_spin(db, room=room, user_id=host_id)
    # Winner must be one of the living segments, never the eliminated one.
    assert spin.result_segment_id in {segs[1].id, segs[2].id}
    # 2 living -> dramatic multiplier baked into stored duration.
    assert spin.mode_state_snapshot["mode_effects"] == {"dramatic": True}


async def test_trigger_spin_elimination_rejects_when_one_living(
    db: AsyncSession,
) -> None:
    import pytest

    from datetime import UTC, datetime

    from hoba_api.models.segment import Segment
    from hoba_api.services.rooms import RoomServiceError

    host_id = await _make_user(db, tg_id=301)
    room = await create_room(
        db, host_id=host_id, question_text="Q?",
        segments=_drafts(2), spin_policy="anyone", game_mode="elimination",
    )
    q = next(qq for qq in room.questions if qq.is_active)
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    segs[0].eliminated_at = datetime.now(UTC)  # 1 living
    await db.flush()
    with pytest.raises(RoomServiceError) as exc:
        await trigger_spin(db, room=room, user_id=host_id)
    assert exc.value.code == "too_few_segments"
```

Confirm `tests/services/test_spins.py` already imports `select` (it uses it elsewhere) and has `_drafts`/`_make_user` helpers (it does — used by existing tests). `create_room` accepts `game_mode`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_spins.py -k elimination --no-cov -q`
Expected: FAIL — winner may be the eliminated segment / `mode_state_snapshot` has no `mode_effects`.

- [ ] **Step 3: Modify `trigger_spin` in `apps/api/src/hoba_api/services/spins.py`**

Add imports at top:

```python
from hoba_api.modes import engine_for
from hoba_api.modes.base import SpinContext
```

Replace the segment-loading + compute block (current lines 53-105, from the `segments = list(...)` assignment through the `session.add(spin)`) with:

```python
    all_segments = list(
        (
            await session.execute(
                select(Segment)
                .where(
                    Segment.parent_id == question.id,
                    Segment.parent_type == "question",
                )
                .order_by(Segment.position),
            )
        )
        .scalars()
        .all(),
    )

    engine = engine_for(room.game_mode)
    ctx = SpinContext(room=room, question=question, segments=all_segments)
    decision = engine.on_spin_request(ctx)
    spin_segments = decision.segments
    if len(spin_segments) < MIN_SEGMENTS_TO_SPIN:
        raise RoomServiceError("too_few_segments")

    last_spin = (
        await session.execute(
            select(Spin)
            .where(Spin.question_id == question.id)
            .order_by(Spin.id.desc())
            .limit(1),
        )
    ).scalar_one_or_none()
    starting_angle_deg = last_spin.final_angle_deg if last_spin is not None else 0.0

    seed = secrets.randbits(31)
    raw_weights = [float(s.weight) for s in spin_segments]
    weights: list[float] | None = (
        None if all(w == 1.0 for w in raw_weights) else raw_weights
    )
    result = compute_spin(
        segment_count=len(spin_segments),
        seed=seed,
        starting_angle_deg=starting_angle_deg,
        weights=weights,
    )
    duration_ms = round(result.duration_ms * decision.duration_multiplier)

    winning_segment = spin_segments[result.result_segment_index]
    started_at = datetime.now(UTC)
    spin = Spin(
        question_id=question.id,
        triggered_by=user_id,
        result_segment_id=winning_segment.id,
        final_angle_deg=result.final_angle_deg,
        duration_ms=duration_ms,
        seed=seed,
        mode_state_snapshot={
            "living_segment_ids": [s.id for s in spin_segments],
            "mode_effects": decision.effects,
        },
        started_at=started_at,
        settled_at=started_at + timedelta(milliseconds=duration_ms),
    )
    session.add(spin)
```

(Leave the `if room.status == "lobby": room.status = "active"` and `await session.flush(); return spin` lines untouched below.)

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && uv run --extra dev pytest tests/services/test_spins.py --no-cov -q`
Expected: PASS (new + existing spin tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/hoba_api/services/spins.py apps/api/tests/services/test_spins.py
git commit -m "feat(api): trigger_spin runs through the mode engine"
```

---

## Task 6: Eliminate-at-settle + mode_effects on spin:started

**Files:**
- Modify: `apps/api/src/hoba_api/realtime/handlers.py` — `_emit_settled` (lines 108-141) and the `spin_payload` `mode_effects` (line ~317)
- Test: `apps/api/tests/realtime/test_handlers.py` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/realtime/test_handlers.py`

`_emit_settled` is already imported at the top of `test_handlers.py`, and the existing turn-based settle test calls it as `await _emit_settled(sio, code, room.id, spin_id=..., result_segment_id=..., duration_ms=0)  # type: ignore[arg-type]` (passing the `FakeSocketIO` fixture directly). Mirror that exactly:

```python
@pytest.mark.asyncio
async def test_emit_settled_elimination_marks_winner_and_aftereffects(
    sio: FakeSocketIO, db: Any,
) -> None:
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
    q = next(qq for qq in room.questions if qq.is_active)
    segs = (await db.execute(
        select(Segment).where(Segment.parent_id == q.id,
                              Segment.parent_type == "question")
        .order_by(Segment.position)
    )).scalars().all()
    winner = segs[0]
    fetched = await get_room_by_code(db, room.code)
    assert fetched is not None
    sio.emitted.clear()

    await _emit_settled(sio, room.code, fetched.id, spin_id=1, result_segment_id=winner.id, duration_ms=0)  # type: ignore[arg-type]

    settled = sio.events_named("spin:settled")
    assert settled, "expected a spin:settled emit"
    after = settled[-1][1]["mode_aftereffects"]
    assert after["eliminated_segment_id"] == winner.id
    assert after["remaining"] == 2
    assert after["round_over"] is False
    await db.refresh(winner)
    assert winner.eliminated_at is not None
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py -k elimination --no-cov -q`
Expected: FAIL — `mode_aftereffects` is `{}`.

- [ ] **Step 3: Rewrite `_emit_settled` in `apps/api/src/hoba_api/realtime/handlers.py`**

Add imports near the other service imports:

```python
from hoba_api.models.question import Question
from hoba_api.models.segment import Segment
from hoba_api.modes import engine_for
from hoba_api.modes.base import SpinContext
from sqlalchemy import select
```

(Check which of these are already imported at the top of `handlers.py` and only add the missing ones.)

Replace the whole `_emit_settled` body with:

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

    mode_aftereffects: dict[str, Any] = {}
    new_cursor: int | None = None
    advanced = False

    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        if room is not None:
            engine = engine_for(room.game_mode)
            question = (
                await session.execute(
                    select(Question).where(
                        Question.room_id == room.id,
                        Question.is_active.is_(True),
                    ),
                )
            ).scalar_one_or_none()
            if question is not None:
                segments = list(
                    (
                        await session.execute(
                            select(Segment)
                            .where(
                                Segment.parent_id == question.id,
                                Segment.parent_type == "question",
                            )
                            .order_by(Segment.position),
                        )
                    ).scalars().all(),
                )
                winner = next(
                    (s for s in segments if s.id == result_segment_id), None,
                )
                if winner is not None:
                    ctx = SpinContext(room=room, question=question, segments=segments)
                    effects = engine.on_spin_settled(ctx, winner)
                    if effects.eliminate_segment_ids:
                        now = datetime.now(UTC)
                        to_kill = set(effects.eliminate_segment_ids)
                        for seg in segments:
                            if seg.id in to_kill:
                                seg.eliminated_at = now
                        living = [s for s in segments if s.eliminated_at is None]
                        survivor_id = (
                            living[0].id
                            if effects.round_over and len(living) == 1
                            else None
                        )
                        mode_aftereffects = {
                            "eliminated_segment_id": effects.eliminate_segment_ids[0],
                            "remaining": len(living),
                            "round_over": effects.round_over,
                            "survivor_segment_id": survivor_id,
                        }
            if room.spin_policy == "turn_based":
                new_cursor = await advance_turn(session, room)
                advanced = True
            await session.commit()

    await sio.emit(
        "spin:settled",
        {
            "spin_id": spin_id,
            "result_segment_id": result_segment_id,
            "mode_aftereffects": mode_aftereffects,
        },
        room=room_code,
        namespace=NAMESPACE,
    )
    if advanced:
        await sio.emit(
            "room:updated",
            {"patch": {"current_turn_user_id": new_cursor}},
            room=room_code,
            namespace=NAMESPACE,
        )
```

This requires `from datetime import UTC, datetime` at the top of `handlers.py` — check and add if missing.

- [ ] **Step 4: Set `mode_effects` on `spin:started`** — in `on_spin_trigger`, change the `spin_payload` line:

```python
                "mode_effects": spin.mode_state_snapshot.get("mode_effects", {}),
```

(replacing `"mode_effects": {}`).

- [ ] **Step 5: Run to verify the new + existing settle tests pass**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py --no-cov -q`
Expected: PASS — including `test_emit_settled_turn_based_advances_cursor_and_broadcasts` (turn advance still works) and the new elimination test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py
git commit -m "feat(api): eliminate winner at settle + emit mode aftereffects"
```

---

## Task 7: round:reset handler

**Files:**
- Modify: `apps/api/src/hoba_api/realtime/handlers.py` (add a handler inside `register_handlers`)
- Test: `apps/api/tests/realtime/test_handlers.py` (extend)

- [ ] **Step 1: Write failing tests** — append to `tests/realtime/test_handlers.py`

```python
@pytest.mark.asyncio
async def test_round_reset_host_revives_segments_and_broadcasts(
    sio: FakeSocketIO, db: Any,
) -> None:
    from datetime import UTC, datetime

    from hoba_api.models.segment import Segment

    host = await upsert_from_telegram(db, _tg_user_for_handlers(user_id=95))
    room = await create_room(
        db, host_id=host.id, question_text="Q?",
        segments=[SegmentDraft(label="a", color_seed=0, weight=1),
                  SegmentDraft(label="b", color_seed=1, weight=1)],
        spin_policy="anyone", game_mode="elimination",
    )
    q = next(qq for qq in room.questions if qq.is_active)
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py -k round_reset --no-cov -q`
Expected: FAIL — no `round:reset` handler registered.

- [ ] **Step 3: Add the handler inside `register_handlers`** in `apps/api/src/hoba_api/realtime/handlers.py` (e.g. after `on_spin_trigger`)

```python
    @sio.on("round:reset", namespace=NAMESPACE)
    async def on_round_reset(sid: str) -> None:
        sess = await sio.get_session(sid, namespace=NAMESPACE)
        user_id = sess.get("user_id")
        room_code = sess.get("room_code")
        room_id = sess.get("room_id")
        if user_id is None or room_code is None or room_id is None:
            await sio.emit("error", {"code": "not_in_room"}, to=sid, namespace=NAMESPACE)
            return
        async with SessionLocal() as session:
            room = await session.get(Room, room_id)
            if room is None:
                await sio.emit(
                    "error", {"code": "room_not_found"}, to=sid, namespace=NAMESPACE,
                )
                return
            if room.host_id != user_id:
                await sio.emit("error", {"code": "not_host"}, to=sid, namespace=NAMESPACE)
                return
            question = (
                await session.execute(
                    select(Question).where(
                        Question.room_id == room.id,
                        Question.is_active.is_(True),
                    ),
                )
            ).scalar_one_or_none()
            if question is not None:
                segments = (
                    await session.execute(
                        select(Segment).where(
                            Segment.parent_id == question.id,
                            Segment.parent_type == "question",
                        ),
                    )
                ).scalars().all()
                for seg in segments:
                    seg.eliminated_at = None
            await session.commit()
        await sio.emit("round:reset", {}, room=room_code, namespace=NAMESPACE)
        log.info("ws.round.reset", user_id=user_id, code=room_code)
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/api && uv run --extra dev pytest tests/realtime/test_handlers.py -k round_reset --no-cov -q`
Expected: PASS.

- [ ] **Step 5: Full backend gate**

Run: `cd apps/api && uv run --extra dev pytest -q && uv run --extra dev mypy --strict src && uv run --extra dev ruff check src tests`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/hoba_api/realtime/handlers.py apps/api/tests/realtime/test_handlers.py
git commit -m "feat(api): round:reset revives segments for a new round"
```

---

## Task 8: Frontend types

**Files:**
- Modify: `apps/webapp/src/lib/api.ts` (`ServerSegment`), `apps/webapp/src/stores/room.ts` (`SpinSettledEvent`)

- [ ] **Step 1: Add `is_eliminated` to `ServerSegment`** in `apps/webapp/src/lib/api.ts`:

```typescript
export interface ServerSegment {
  id: number;
  label: string;
  emoji: string | null;
  color_seed: number;
  weight: number;
  position: number;
  is_eliminated: boolean;
}
```

- [ ] **Step 2: Extend `SpinSettledEvent`** in `apps/webapp/src/stores/room.ts`:

```typescript
export interface SpinSettledEvent {
  spin_id: number;
  result_segment_id: number;
  mode_aftereffects?: {
    eliminated_segment_id?: number;
    remaining?: number;
    round_over?: boolean;
    survivor_segment_id?: number | null;
  };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/webapp && pnpm tsc --noEmit`
Expected: PASS (no usages broken yet — `is_eliminated` is additive; any test fixtures building `ServerSegment` may need the field — fix those in their tasks).

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/lib/api.ts apps/webapp/src/stores/room.ts
git commit -m "feat(webapp): segment is_eliminated + spin settled aftereffects types"
```

---

## Task 9: elimination.ts helper

**Files:**
- Create: `apps/webapp/src/features/rooms/elimination.ts`, `apps/webapp/src/features/rooms/__tests__/elimination.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/webapp/src/features/rooms/__tests__/elimination.test.ts`

```typescript
import { describe, expect, it } from "vitest";

import { type ServerQuestion, type ServerSegment } from "@/lib/api";

import {
  eliminatedSegments,
  isRoundOver,
  livingSegments,
  remainingCount,
} from "../elimination";

function seg(id: number, eliminated = false): ServerSegment {
  return {
    id, label: `s${id}`, emoji: null, color_seed: 0, weight: 1,
    position: id, is_eliminated: eliminated,
  };
}

function q(segments: ServerSegment[]): ServerQuestion {
  return { id: 1, text: "Q", is_active: true, segments };
}

describe("elimination helpers", () => {
  it("splits living vs eliminated", () => {
    const question = q([seg(1, true), seg(2), seg(3)]);
    expect(livingSegments(question).map((s) => s.id)).toEqual([2, 3]);
    expect(eliminatedSegments(question).map((s) => s.id)).toEqual([1]);
    expect(remainingCount(question)).toBe(2);
    expect(isRoundOver(question)).toBe(false);
  });

  it("round is over with exactly one living segment", () => {
    expect(isRoundOver(q([seg(1, true), seg(2)]))).toBe(true);
  });

  it("null question is safe", () => {
    expect(livingSegments(null)).toEqual([]);
    expect(remainingCount(null)).toBe(0);
    expect(isRoundOver(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/webapp && pnpm vitest run src/features/rooms/__tests__/elimination.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/webapp/src/features/rooms/elimination.ts`**

```typescript
import { type ServerQuestion, type ServerSegment } from "@/lib/api";

export function livingSegments(q: ServerQuestion | null): ServerSegment[] {
  if (q === null) return [];
  return q.segments.filter((s) => !s.is_eliminated);
}

export function eliminatedSegments(q: ServerQuestion | null): ServerSegment[] {
  if (q === null) return [];
  return q.segments.filter((s) => s.is_eliminated);
}

export function remainingCount(q: ServerQuestion | null): number {
  return livingSegments(q).length;
}

export function isRoundOver(q: ServerQuestion | null): boolean {
  return remainingCount(q) === 1;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/webapp && pnpm vitest run src/features/rooms/__tests__/elimination.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/features/rooms/elimination.ts apps/webapp/src/features/rooms/__tests__/elimination.test.ts
git commit -m "feat(webapp): elimination living/eliminated helpers"
```

---

## Task 10: Store — apply settle aftereffect + round:reset + resetRound

**Files:**
- Modify: `apps/webapp/src/stores/room.ts`
- Test: `apps/webapp/src/stores/__tests__/room.test.ts` (create if absent — check first)

- [ ] **Step 1: Check for an existing store test**

Run: `ls apps/webapp/src/stores/__tests__/ 2>/dev/null`
If `room.test.ts` exists, extend it; otherwise create it. The store wires socket listeners via `wireListeners(s)` against a private `socket`. Since the socket is module-private, test the *pure reducer logic* by extracting it. **Refactor:** pull the settle/reset snapshot mutations into exported pure functions and have the listeners call them.

- [ ] **Step 2: Write failing tests** — `apps/webapp/src/stores/__tests__/room.test.ts`

```typescript
import { describe, expect, it } from "vitest";

import { type RoomState } from "@/lib/api";

import { applyEliminated, reviveAllSegments } from "../room";

function snap(): RoomState {
  return {
    room: {
      id: 1, code: "ABC123", host_id: 1, title: null, status: "active",
      game_mode: "elimination", spin_policy: "anyone", suggestion_policy: "off",
      is_locked: false, is_anonymous: false, current_turn_user_id: null,
      created_at: "2026-05-29T00:00:00Z", closed_at: null,
    },
    participants: [],
    active_question: {
      id: 1, text: "Q", is_active: true,
      segments: [
        { id: 1, label: "a", emoji: null, color_seed: 0, weight: 1, position: 0, is_eliminated: false },
        { id: 2, label: "b", emoji: null, color_seed: 1, weight: 1, position: 1, is_eliminated: false },
      ],
    },
    last_spin: null,
    me_user_id: 1,
  };
}

describe("room store reducers", () => {
  it("applyEliminated marks one segment eliminated", () => {
    const next = applyEliminated(snap(), 1);
    expect(next.active_question!.segments.find((s) => s.id === 1)!.is_eliminated).toBe(true);
    expect(next.active_question!.segments.find((s) => s.id === 2)!.is_eliminated).toBe(false);
  });

  it("reviveAllSegments clears every eliminated flag", () => {
    const eliminated = applyEliminated(snap(), 1);
    const revived = reviveAllSegments(eliminated);
    expect(revived.active_question!.segments.every((s) => !s.is_eliminated)).toBe(true);
  });

  it("reducers are no-ops when there is no active question", () => {
    const s = { ...snap(), active_question: null };
    expect(applyEliminated(s, 1)).toBe(s);
    expect(reviveAllSegments(s)).toBe(s);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/webapp && pnpm vitest run src/stores/__tests__/room.test.ts`
Expected: FAIL — `applyEliminated`/`reviveAllSegments` not exported.

- [ ] **Step 4: Add the pure reducers + wire them** in `apps/webapp/src/stores/room.ts`

Add near the top (after imports):

```typescript
export function applyEliminated(
  snap: ServerRoomState,
  eliminatedSegmentId: number,
): ServerRoomState {
  if (snap.active_question === null) return snap;
  return {
    ...snap,
    active_question: {
      ...snap.active_question,
      segments: snap.active_question.segments.map((s) =>
        s.id === eliminatedSegmentId ? { ...s, is_eliminated: true } : s,
      ),
    },
  };
}

export function reviveAllSegments(snap: ServerRoomState): ServerRoomState {
  if (snap.active_question === null) return snap;
  if (snap.active_question.segments.every((s) => !s.is_eliminated)) return snap;
  return {
    ...snap,
    active_question: {
      ...snap.active_question,
      segments: snap.active_question.segments.map((s) =>
        s.is_eliminated ? { ...s, is_eliminated: false } : s,
      ),
    },
  };
}
```

In `wireListeners`, update the `spin:settled` handler and add a `round:reset` handler:

```typescript
  s.on("spin:settled", (payload: SpinSettledEvent) => {
    const eliminatedId = payload.mode_aftereffects?.eliminated_segment_id;
    const snap = getState().snapshot;
    if (eliminatedId !== undefined && snap !== null) {
      setState({ spinSettled: payload, snapshot: applyEliminated(snap, eliminatedId) });
    } else {
      setState({ spinSettled: payload });
    }
  });

  s.on("round:reset", () => {
    const snap = getState().snapshot;
    if (snap !== null) setState({ snapshot: reviveAllSegments(snap) });
  });
```

Add a `resetRound` action to the store interface and implementation:

```typescript
  resetRound(): void;
```
```typescript
  resetRound(): void {
    socket?.emit("round:reset");
  },
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/webapp && pnpm vitest run src/stores/__tests__/room.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/stores/room.ts apps/webapp/src/stores/__tests__/room.test.ts
git commit -m "feat(webapp): store applies elimination + round reset"
```

---

## Task 11: i18n strings

**Files:**
- Modify: `apps/webapp/src/locales/en/room.json`, `apps/webapp/src/locales/uk/room.json`

The project uses i18next-icu. Confirmed convention (from `header.participants_count`): EN is `{count, plural, one {# in room} other {# in room}}`, UK uses `one/few/many/other`. Match exactly.

- [ ] **Step 1: Add an `elimination` block to `en/room.json`** (top-level key, valid JSON):

```json
  "elimination": {
    "remaining": "{count, plural, one {# left} other {# left}}",
    "survivor": "🏆 {label} survives!",
    "new_round": "New round",
    "eliminated_label": "Out"
  }
```

- [ ] **Step 2: Add the matching `elimination` block to `uk/room.json`**

```json
  "elimination": {
    "remaining": "{count, plural, one {залишився #} few {залишилось #} many {залишилось #} other {залишилось #}}",
    "survivor": "🏆 {label} виживає!",
    "new_round": "Новий раунд",
    "eliminated_label": "Вибув"
  }
```

(Match the ICU shape used by the UK `header.participants_count` plural.)

- [ ] **Step 3: Verify i18n parity**

Run: `cd /home/kali/hoba && node scripts/i18n-check.mjs`
Expected: PASS — EN ↔ UK key parity holds.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/locales/en/room.json apps/webapp/src/locales/uk/room.json
git commit -m "feat(webapp): elimination i18n strings (EN+UK)"
```

---

## Task 12: RoomPage — living wheel, Remaining, survivor banner, New round, strip

**Files:**
- Modify: `apps/webapp/src/pages/RoomPage.tsx`

- [ ] **Step 1: Filter the wheel to living segments**

In the `segments` `useMemo` (currently maps `snapshot.active_question.segments`), filter first:

```typescript
  const segments: SegmentDef[] = useMemo(() => {
    if (snapshot?.active_question == null) return [];
    return snapshot.active_question.segments
      .filter((s) => !s.is_eliminated)
      .map((s) => ({
        id: String(s.id),
        label: s.label,
        emoji: s.emoji ?? undefined,
        colorSeed: s.color_seed,
      }));
  }, [snapshot]);
```

- [ ] **Step 2: Derive elimination view-state** (after `const turnState = computeTurnState(snapshot);`)

```typescript
  const isElimination = snapshot?.room.game_mode === "elimination";
  const activeQuestion = snapshot?.active_question ?? null;
  const remaining = remainingCount(activeQuestion);
  const roundOver = isElimination && isRoundOver(activeQuestion);
  const survivor = roundOver ? livingSegments(activeQuestion)[0] : undefined;
  const resetRound = useRoomStore((s) => s.resetRound);
```

Add imports:
```typescript
import { isRoundOver, livingSegments, remainingCount } from "@/features/rooms/elimination";
```

- [ ] **Step 3: Show "Remaining: N" near the mode badge** — inside the `GameModeBadge` row/line area, add (only for elimination):

```tsx
        {isElimination ? (
          <span className="text-sm font-medium text-ink-light-2 dark:text-ink-dark-2">
            {t("room:elimination.remaining", { count: remaining })}
          </span>
        ) : null}
```

- [ ] **Step 4: Survivor banner + host New-round button** — in the bottom controls block (where SPIN / turn lines render), add:

```tsx
          {roundOver ? (
            <div className="text-center py-3">
              <p className="text-lg font-display font-bold text-brand-amber-3">
                {t("room:elimination.survivor", { label: survivor?.label ?? "" })}
              </p>
              {callerIsHost ? (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="mt-3"
                  onClick={resetRound}
                >
                  {t("room:elimination.new_round")}
                </Button>
              ) : null}
            </div>
          ) : null}
```

Gate the existing SPIN button / turn lines so they do not also render when `roundOver` (e.g. add `&& !roundOver` to the `canSpin && wheelState === "idle"` condition and the turn-line conditions).

- [ ] **Step 5: Eliminated greyscale strip** — under the `<Wheel>` (only elimination, only if any eliminated):

```tsx
        {isElimination && eliminatedSegments(activeQuestion).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 justify-center px-2">
            {eliminatedSegments(activeQuestion).map((s) => (
              <span
                key={s.id}
                className="text-xs px-2 py-1 rounded-full grayscale opacity-60 bg-surface-light-2 dark:bg-surface-dark-2 line-through"
              >
                {s.emoji ? `${s.emoji} ` : ""}{s.label}
              </span>
            ))}
          </div>
        ) : null}
```

Add `eliminatedSegments` to the elimination import.

- [ ] **Step 6: Verify build + lint + a render smoke test**

Run: `cd apps/webapp && pnpm tsc --noEmit && pnpm run lint`
Expected: PASS. (If RoomPage has an existing render test, extend it to assert the survivor banner + New-round button appear when a snapshot has 1 living segment and `me` is host; otherwise rely on tsc/lint + manual verify.)

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/pages/RoomPage.tsx
git commit -m "feat(webapp): elimination room UI — living wheel, remaining, survivor, reset"
```

---

## Task 13: Shatter animation (polish)

**Files:**
- Modify: `apps/webapp/src/pages/RoomPage.tsx` and/or `apps/webapp/src/features/wheel/Wheel.tsx`

**Scope note:** the *contract* (which segment leaves, when) is already correct from Tasks 6 + 10 — the wheel re-renders one smaller after `spin:settled`. This task adds the visual "shatter". Keep it modest; richer particle work is a follow-up.

- [ ] **Step 1: Add an exit transition to the eliminated wedge.** When a segment is removed from the living set, animate its departure. Simplest reliable approach: wrap the just-eliminated wedge in a Framer Motion `AnimatePresence` keyed by segment id with an `exit={{ opacity: 0, scale: 0.6, rotate: 12 }}` transition (~400ms), driven off `spinSettled.mode_aftereffects.eliminated_segment_id`. If the SVG `<Wheel>` is hard to animate per-wedge, fall back to a brief full-wheel "thunk" (scale 1→0.97→1 + haptic) on settle in elimination mode plus the existing result reveal.

- [ ] **Step 2: Manual verify only** (animations aren't unit-tested). Run `pnpm tsc --noEmit && pnpm run lint`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/src/pages/RoomPage.tsx apps/webapp/src/features/wheel/Wheel.tsx
git commit -m "feat(webapp): elimination shatter animation"
```

---

## Task 14: docs/game-modes.md + index + full gate

**Files:**
- Create: `docs/game-modes.md`
- Modify: `CLAUDE.md` (documentation index)

- [ ] **Step 1: Create `docs/game-modes.md`** documenting Elimination end-to-end: the loop (spin → winner shatters → wheel shrinks → repeat until 1 survivor → host New round), the `eliminated_at` model, the living-segments contract, `round:reset`, and `mode_aftereffects` payload. Stub Punishment (§5.3) and Chaos (§5.4) as "Planned — next slices".

- [ ] **Step 2: Add to the `CLAUDE.md` documentation index** a line: `` - [`docs/game-modes.md`](docs/game-modes.md) — per-mode gameplay mechanics (Elimination live; Punishment/Chaos planned). ``

- [ ] **Step 3: Run ALL quality gates**

```bash
cd apps/api && uv run --extra dev pytest -q && uv run --extra dev mypy --strict src && uv run --extra dev ruff check src tests
cd ../webapp && pnpm vitest run && pnpm tsc --noEmit && pnpm run lint
cd /home/kali/hoba && node scripts/i18n-check.mjs
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/game-modes.md CLAUDE.md
git commit -m "docs: game-modes.md — elimination"
```

---

## Final verification (after all tasks)

- [ ] All gates green (Task 14 Step 3).
- [ ] Deploy to VPS (api rebuild + webapp rebuild) and manual-verify on two accounts:
  - Create an Elimination room, spin → winner shatters, wheel shrinks, "Remaining: N" decrements.
  - Continue to 1 survivor → "🏆 survives!" banner, SPIN hidden.
  - Host taps "New round" → all segments revive on both devices.
  - Turn-based + elimination compose (turn rotates AND segments shrink) if tested together.
