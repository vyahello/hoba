# Elimination Mode — design

> Stage D, first per-mode gameplay slice. Implements spec §5.2 (Elimination)
> and introduces the `GameModeEngine` abstraction from spec §5 / §15 Phase 7.
> Punishment (§5.3) and Chaos (§5.4) are deliberately out of scope — each gets
> its own sibling slice and reuses the engine + pipeline established here.

## Goal

A room in `elimination` mode plays like Classic, except the winning segment
**shatters off the wheel** after each spin. Play continues over the shrinking
set of living segments until one survivor remains, at which point the host can
start a new round. Everything is server-authoritative (rule 2): the client only
renders state the server decides.

## Scope

In scope:
- `GameModeEngine` Protocol + `ClassicEngine` + `EliminationEngine` + registry.
- `Segment.eliminated_at` column (Alembic `0005`) + `SegmentOut.is_eliminated`.
- Spin pipeline integration (spin over living segments; eliminate at settle).
- `round:reset` host action.
- Frontend: living-only wheel, shatter animation, "Remaining: N", survivor
  banner, host "New round" button, eliminated greyscale strip, EN+UK strings.
- `docs/game-modes.md`.

Out of scope: Punishment, Chaos, Rigged. Any mode without an engine falls back
to `ClassicEngine` (keeps spinning exactly as today).

## Non-negotiables carried in

- Server-authoritative spin + elimination (rule 2).
- `mypy --strict` / `tsc` clean (rule 3); every user string through `t()` (rule 5).
- Engine abstraction is justified under rule 6 — 5 modes will implement it; this
  slice ships 2 (Classic + Elimination).

---

## 1. Backend engine architecture

New package `apps/api/src/hoba_api/modes/`.

### `base.py` — Protocol + pure dataclasses

Engines are **pure**: they read a context and return declarative decisions. They
do **not** touch the DB. The service applies persistence based on what they
return. This keeps engines unit-testable without a session.

```python
@dataclass(frozen=True)
class SpinContext:
    room: Room
    question: Question
    segments: list[Segment]      # ALL segments of the question, position order

@dataclass(frozen=True)
class SpinDecision:
    segments: list[Segment]      # the segments to spin over (= living), position order
    duration_multiplier: float   # 1.0 normal
    effects: dict[str, object]   # -> spin:started.mode_effects

@dataclass(frozen=True)
class ModeEffects:
    eliminate_segment_ids: list[int]
    round_over: bool
    extra: dict[str, object]     # -> spin:settled.mode_aftereffects (merged)

class GameModeEngine(Protocol):
    mode_id: str
    def on_spin_request(self, ctx: SpinContext) -> SpinDecision: ...
    def on_spin_settled(self, ctx: SpinContext, winner: Segment) -> ModeEffects: ...
    def get_visible_segments(self, ctx: SpinContext) -> list[Segment]: ...
    def is_round_over(self, ctx: SpinContext) -> bool: ...
```

### `classic.py` — `ClassicEngine`
- `get_visible_segments` → all.
- `on_spin_request` → `SpinDecision(segments=all, duration_multiplier=1.0, effects={})`.
- `on_spin_settled` → `ModeEffects([], round_over=False, extra={})`.
- `is_round_over` → `False`.

### `elimination.py` — `EliminationEngine`
- `living(ctx)` = `[s for s in ctx.segments if s.eliminated_at is None]`, position order.
- `get_visible_segments` → `living`.
- `on_spin_request` → `segments=living`; `duration_multiplier = 1.5 if len(living) == 2 else 1.0`
  (the dramatic final spin, spec §5.2); `effects = {"dramatic": True}` when 2 living else `{}`.
- `on_spin_settled(winner)` → `eliminate_segment_ids=[winner.id]`;
  `round_over = (len(living) - 1 == 1)`; `extra={}` (the service fills in
  `remaining` and `survivor_segment_id`, which need the post-write count).
- `is_round_over` → `len(living) <= 1`.

### `registry.py`
```python
def engine_for(game_mode: str) -> GameModeEngine: ...
```
Maps `"classic" -> ClassicEngine`, `"elimination" -> EliminationEngine`; **any
other value (punishment, chaos, rigged, unknown) → `ClassicEngine`** so
not-yet-built modes keep working.

---

## 2. Data model

- Alembic `0005`: add `Segment.eliminated_at: Mapped[datetime | None]`
  (`DateTime(timezone=True)`, nullable, default NULL). Use `op.add_column`
  (not `batch_alter_table`) per the 0004 lesson in `docs/deployment.md` §9b.
- `SegmentOut` (schema) gains `is_eliminated: bool`. Computed, not stored on the
  wire as a timestamp: serialize via a validator / `from_attributes` mapping
  `is_eliminated = eliminated_at is not None`. (Implementation note: add a
  computed field on `SegmentOut` derived from the ORM object.)
- No change to `weight` / `position`, so Rigged composes later.

**Definition of "living" (shared, exact):** `eliminated_at IS NULL`, ordered by
`position`. Server and client MUST both use this so the spin animation lands on
the correct wedge.

---

## 3. Spin pipeline

### Trigger (`services/spins.trigger_spin`)
1. Load all active-question segments (position order).
2. `engine = engine_for(room.game_mode)`; `ctx = SpinContext(room, question, segments)`.
3. `decision = engine.on_spin_request(ctx)`.
4. Require `len(decision.segments) >= MIN_SEGMENTS_TO_SPIN (2)` → else `too_few_segments`.
5. `compute_spin` over `decision.segments` only (count = len(living); weights from
   living). `duration_ms = base_duration × decision.duration_multiplier`.
6. Winner = `decision.segments[result_index]`. Persist `Spin`
   (`result_segment_id = winner.id`; `mode_state_snapshot =
   {"living_segment_ids": [...], "remaining_before": len(living)}`).
7. `spin:started.mode_effects = decision.effects`.

Elimination is **not** applied here — the winner is still on the wheel for this
spin.

### Settle (`realtime.handlers._emit_settled`)
This already runs post-animation and handles turn rotation. Add, in the same
re-fetched session:
1. Reload room + active question + segments; `engine = engine_for(...)`.
2. `effects = engine.on_spin_settled(ctx, winner)`.
3. For each id in `effects.eliminate_segment_ids`: set `segment.eliminated_at = now`.
4. Commit.
5. Compute `remaining = count(living after write)` and `survivor_segment_id =
   the_only_living.id if effects.round_over else None`.
6. Emit `spin:settled` with
   `mode_aftereffects = {eliminated_segment_id, remaining, round_over,
   survivor_segment_id}` for elimination; `{}` for Classic/others.

Ordering in `_emit_settled`: emit `spin:settled` (with aftereffects), then the
existing turn-advance `room:updated`. (Turn rotation and elimination are
orthogonal; both can apply.)

---

## 4. Events + round reset

### `spin:settled.mode_aftereffects` (Elimination)
```json
{ "eliminated_segment_id": 42, "remaining": 3, "round_over": false, "survivor_segment_id": null }
```
Classic / other modes: `{}`.

### `round:reset` — client → server (new)
- Host-only. `not_host` error otherwise; `not_in_room` if no room session.
- Clears `eliminated_at = NULL` for all segments of the active question; commit.
- Broadcasts a dedicated **`round:reset` `{}`** server→client event to the room.
  Each client revives all its segments locally (`is_eliminated = false`),
  refilling the wheel and re-enabling SPIN.
- Allowed anytime the host wants (can restart mid-round), not only at round end.

> **Note (resolved during planning):** an earlier draft said "broadcast
> `room:state`". That is unsafe — `room:state.me_user_id` is **per-connection**,
> so broadcasting one snapshot to the whole room would hand guests the host's
> id and break host detection. Hence the dedicated `round:reset` broadcast,
> which carries no per-recipient data.

---

## 5. Frontend

### Rendering
- RoomPage `segments` = `active_question.segments.filter(s => !s.is_eliminated)`
  mapped to `SegmentDef`. Fewer segments → larger wedges; server spun over the
  same living list so `final_angle_deg` is correct.

### Store (`stores/room.ts`)
- `SpinSettledEvent` gains
  `mode_aftereffects?: { eliminated_segment_id?: number; remaining?: number;
  round_over?: boolean; survivor_segment_id?: number | null }`.
- On `spin:settled`: set `spinSettled` AND, if `eliminated_segment_id` is present,
  set `is_eliminated = true` on that segment inside
  `snapshot.active_question.segments` (immutable update) so the wheel shrinks
  without a refetch.
- `round:reset` is the existing `room:state` path (snapshot replaced → segments
  revived). New store action `resetRound()` emits `round:reset`.

### Pure helper `features/rooms/elimination.ts`
- `livingSegments(q)`, `eliminatedSegments(q)`, `remainingCount(q)`,
  `isRoundOver(q)` (exactly 1 living). Unit-tested; keeps RoomPage thin.

### UI (RoomPage)
- **Shatter**: Framer-Motion fade + scale + slight fragment on the just-won wedge
  before it drops out (driven by `spinSettled.mode_aftereffects.eliminated_segment_id`).
  Visual polish via the frontend-design skill at build time.
- **"Remaining: N"** indicator near the `GameModeBadge` (elimination rooms only).
- **Survivor banner** "🏆 {label} survives!" when `round_over`; SPIN disabled.
- **Host "New round"** button at round end → `resetRound()`.
- **Eliminated strip**: greyscale chips of eliminated segments under the wheel
  (spec "fade to greyscale in history"). Smallest piece; trimmable.
- Classic and other modes render exactly as today (the strip/indicator/banner
  are elimination-gated on `room.game_mode === "elimination"`).

### i18n (room namespace, EN + UK)
- `elimination.remaining` (ICU plural), `elimination.survivor`,
  `elimination.new_round`, `elimination.eliminated_label`.

---

## 6. Testing

### Backend
- Engine units (no DB): Classic (visible=all, never round-over);
  Elimination (`get_visible_segments` = living; `on_spin_request` multiplier 1.5
  at exactly 2 living, 1.0 otherwise; `on_spin_settled` eliminates winner +
  `round_over` when 2→1; `is_round_over`).
- `registry.engine_for` fallback to Classic for punishment/chaos/rigged/unknown.
- `trigger_spin` in elimination spins over living only; rejects with
  `too_few_segments` when <2 living.
- `_emit_settled` sets `eliminated_at` and emits correct `mode_aftereffects`
  (remaining, round_over, survivor) — handler regression via `FakeSocketIO`.
- `round:reset`: host clears + broadcasts `room:state`; guest → `not_host`.
- `SegmentOut.is_eliminated` serialization.

### Frontend
- `elimination.ts` helpers (living/eliminated/remaining/round-over).
- Store applies the settle aftereffect (segment becomes eliminated; round-over
  shape) and `resetRound` emits.
- RoomPage gating: survivor banner + New-round button appear only when
  `round_over` and (for the button) host.

### Docs
- New `docs/game-modes.md` — Elimination documented end-to-end; Punishment +
  Chaos stubbed as "next slices". Add to the doc index in `CLAUDE.md`.

### Gates
`pytest` + `mypy --strict` + `ruff` + `vitest` + `tsc` + `eslint` + `i18n:check`.

---

## Open questions / deferred

- Shatter animation fidelity is left to implementation (frontend-design); the
  contract (which segment, when) is fixed here.
- Eliminated greyscale strip may be deferred if it bloats the slice.
- Punishment/Chaos engines + UI: separate sibling slices reusing this scaffold.
