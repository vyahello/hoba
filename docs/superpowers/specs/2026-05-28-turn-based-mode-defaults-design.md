# Hoba! — turn_based spin policy + mode-default spin_policy design (2026-05-28)

> First slice of Stage D — Phase 7 foundation pieces, per
> `docs/roadmap.md` Stage D charter and spec §5 + §15 Phase 7. Two
> paired backend foundations plus the full turn-based UI on the
> frontend. Sets the substrate for Punishment + Elimination + Chaos
> + Rigged modes that ship later in Stage D.

---

## Context

Stage C closed 2026-05-28 via owner override (iPhone 14 + iPhone X
verification). Two TODO items have been carrying the Stage D tag in
`docs/TODO.md`:

1. `stage:D — modes — finish turn_based spin policy. services/spins.user_can_spin currently treats it as host_only.`
2. `stage:D — mode defaults — when a room is created with a non-Classic game_mode, override the default spin_policy: Elimination → host_only, Punishment → turn_based, Chaos → anyone, Rigged → host_only.`

Owner picked "Foundation pieces first" at the slice question; then
explicitly escalated scope to "Backend + full turn UI" at the
follow-up confirmation. This design honours both decisions.

Brand context (CLAUDE.md rule 5): brand is `Hoba!` (Latin) in EN/code/
docs/files; `Хоба!` (Cyrillic) only in UK locale in-app UI. This doc
uses `Hoba!`.

---

## Goal

1. **`turn_based` spin policy works end-to-end** — backend persistence
   (turn cursor on `rooms`), advance-on-`spin:settled`, presence-aware
   skip of disconnected participants, initial cursor = host on
   lobby→active transition. Frontend reads cursor from snapshot,
   drives the existing hub-disable state via `computeCanSpin`, and
   shows a status line in the room header ("Your turn" /
   "Waiting for {name}") in both locales.

2. **Mode-default `spin_policy` derivation on room creation** — add
   `game_mode` to `RoomCreateIn` (defaults to `classic`). When
   `spin_policy` is not explicitly supplied AND `game_mode ≠ classic`,
   derive: Elimination → `host_only`, Punishment → `turn_based`,
   Chaos → `anyone`, Rigged → `host_only`. Explicit user value
   always wins over derivation.

## Non-goals

- **No mode picker UI** on `CreatePage`. `game_mode` ships in the API
  schema only; existing client flow continues to create rooms as
  `classic`. The picker lands when actual modes ship.
- **No mode-default override on PATCH.** If a host changes `game_mode`
  mid-room via `PATCH /api/v1/rooms/{code}`, `spin_policy` is
  unaffected. Host must explicitly patch both if they want both to
  change.
- **No "pass turn" affordance.** Cursor advances automatically on
  `spin:settled`. Host can't manually skip a participant; off-turn
  users wait until their slot comes up.
- **No avatar highlight in the participant list.** "Full turn UI"
  here means hub state + room-header status line, not avatar
  decoration.
- **No new game-mode UI (Elimination card, Punishment deck, Chaos
  events).** Those are separate Stage D commits.
- **No `CLAUDE.md` "Current phase" rewrite during execution.** The
  current line ("Stage C closed … Stage D unblocked") stays accurate
  until owner says "STAGE D COMPLETE" — at which point the full
  stage-transition workflow runs.

---

## Backend — data model + service logic

### Schema change

Single nullable column on `rooms`:

```sql
ALTER TABLE rooms ADD COLUMN current_turn_user_id INTEGER REFERENCES users(id);
```

Alembic migration `0004_add_current_turn_user_id.py`. Nullable because:

- Rooms in `lobby` status have no active turn (cursor is set on the
  lobby→active transition that the first spin triggers).
- Rooms with `spin_policy ∈ {host_only, anyone}` ignore the cursor
  entirely — kept null for those policies, never read or written.
- Allows null reset on `closed` transition for cleanup hygiene.

No `CHECK` constraint — validity (must reference a participant of this
room) is enforced at the service layer.

### Service-layer helpers

One new function in `apps/api/src/hoba_api/services/spins.py`,
co-located with `user_can_spin` and `trigger_spin`:

```python
async def advance_turn(
    session: AsyncSession, redis: Redis, room: Room,
) -> int | None:
    """Advance current_turn_user_id to the next online participant in join order.

    Walks Participant rows ordered by id (= join order), starting at the
    position after `room.current_turn_user_id` (or position 0 if cursor
    is None). Skips any participant whose presence key
    `presence:{room_id}:{user_id}` is absent from Redis. Wraps around
    if needed. Returns the new cursor (None if no one is online).
    Mutates `room.current_turn_user_id` in place; caller commits.
    """
```

No separate `is_users_turn` helper — `room.current_turn_user_id == user_id`
is a one-liner inlined in `user_can_spin`. Wrapping it would be premature
abstraction per CLAUDE.md rule 6.

`user_can_spin` updated to dispatch by policy:

```python
def user_can_spin(room: Room, user_id: int) -> bool:
    if room.spin_policy == "anyone":
        return True
    if room.spin_policy == "host_only":
        return room.host_id == user_id
    if room.spin_policy == "turn_based":
        return room.current_turn_user_id == user_id
    return False  # unknown policy = denied
```

### Initial cursor on lobby→active transition

`trigger_spin` already flips `room.status = "active"` when the first
spin runs from lobby. Adjacent change: if the new status is `active`
AND `room.spin_policy == "turn_based"` AND
`room.current_turn_user_id is None`, set it to `room.host_id`. Then
validate `user_can_spin` (so the first-spin caller, who must be host
in turn_based per the initial cursor, is allowed). The `host_id` is
guaranteed to be a participant (host is added as Participant on room
creation per `create_room`).

### Mid-room flip to turn_based via PATCH

In `update_room`, when the patch sets `spin_policy = "turn_based"` AND
`room.status == "active"`, also set
`room.current_turn_user_id = room.host_id`. Treats the mid-room flip
as a fresh lobby→active transition. The host gets the next turn.

### Cursor reset on PATCH away from turn_based

In `update_room`, when the patch sets `spin_policy` to anything other
than `turn_based`, also set `room.current_turn_user_id = None`. Keeps
the column accurate to its semantic: "only meaningful when policy is
turn_based."

`game_mode` PATCHes do NOT reset the cursor (host may change mode for
cosmetic reasons; stale cursor on the same participant set remains
valid).

### Mode-default derivation on create

`apps/api/src/hoba_api/services/rooms.py` — `create_room` signature
gains `game_mode: str = "classic"`. Internal `_derive_spin_policy`
helper does the mapping:

```python
MODE_DEFAULT_SPIN_POLICY = {
    "elimination": "host_only",
    "punishment": "turn_based",
    "chaos": "anyone",
    "rigged": "host_only",
}

def _derive_spin_policy(explicit: str | None, game_mode: str) -> str:
    if explicit is not None:
        return explicit
    return MODE_DEFAULT_SPIN_POLICY.get(game_mode, "anyone")
```

`spin_policy` in `create_room`'s signature becomes
`str | None = None` (sentinel: "client didn't supply"). REST schema
(`RoomCreateIn`) similarly switches to optional.

---

## Backend — integration (WS + REST + DTO)

### Advance trigger — where `advance_turn` fires

Inside `_emit_settled` (the scheduled coroutine in
`apps/api/src/hoba_api/realtime/handlers.py`), after the `spin:settled`
event is broadcast and before any other state-touching work:

```python
async def _emit_settled(spin_id: int, room_id: int, ...):
    await asyncio.sleep(duration_ms / 1000)
    await sio.emit("spin:settled", payload, room=room_code, namespace=NAMESPACE)
    async with SessionLocal() as session:
        room = await session.get(Room, room_id)
        if room is None or room.spin_policy != "turn_based":
            return
        await advance_turn(session, redis, room)
        new_cursor = room.current_turn_user_id
        await session.commit()
    await sio.emit(
        "room:updated",
        {"patch": {"current_turn_user_id": new_cursor}},
        room=room_code,
        namespace=NAMESPACE,
    )
```

The `room:updated` broadcast reuses the Stage B item 10 mechanism
(commit `3f4dbeb`) — clients merge `patch` into `snapshot.room`. No
new event-handler scaffolding on the frontend.

The re-fetch + policy guard handles the "policy changed mid-spin"
race: if the host PATCHed away from turn_based during the spin
animation, the advance is skipped.

### Permission check ordering in `on_spin_trigger`

Stage B item 10 (commit `3f4dbeb`) established **permission first,
throttles second** so a rejected off-turn tap doesn't burn the
per-room cooldown. That ordering carries through unchanged —
`user_can_spin` now returns False for off-turn users in `turn_based`
rooms, surfaced via the existing `not_allowed_to_spin` localized
error.

### REST schema changes

`apps/api/src/hoba_api/schemas/room.py`:

- `RoomCreateIn` gains `game_mode: GameMode = "classic"` (default
  classic so existing clients are unaffected).
- `RoomCreateIn.spin_policy` switches from `SpinPolicy = "anyone"` to
  `SpinPolicy | None = None`. Both explicit `null` and absent yield
  `None`, which the service interprets as "derive from mode."
- `ServerRoom` (used by `RoomState.room`) gains
  `current_turn_user_id: int | None`.
- `RoomUpdateIn` (PATCH schema) does NOT accept `current_turn_user_id`
  — it's server-managed, not client-patchable. Allowed PATCH fields
  stay as today (title, spin_policy, suggestion_policy, is_locked,
  game_mode).

### RoomState DTO

`apps/api/src/hoba_api/services/room_state.py` —
`build_room_state` already returns the full Room object;
`current_turn_user_id` is included by default once it's on the model.
One-line schema addition.

---

## Frontend — data flow + UI integration

### Type extension

`apps/webapp/src/lib/api.ts` — `ServerRoom` gains
`current_turn_user_id: number | null`. Existing
`RoomState.room: ServerRoom` carries the cursor naturally.

### Permission helper update

`apps/webapp/src/features/rooms/permissions.ts` — `computeCanSpin`
already handles `anyone` and falls back to host-role. Update the
`turn_based` branch explicitly:

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

The existing 7-case test file gets 2 new cases: turn_based with cursor
= me (true), turn_based with cursor = other (false).

### Turn-state helper

New small pure function in
`apps/webapp/src/features/rooms/turnState.ts`:

```typescript
export type TurnState =
  | { kind: "not_turn_based" }
  | { kind: "my_turn" }
  | { kind: "waiting"; whoUserId: number; whoName: string | null }
  | { kind: "no_one" };

export function computeTurnState(snapshot: RoomState | null): TurnState {
  /* ... */
}
```

Pure, fully unit-testable, mirrors `computeCanSpin`'s style. Drives
the room-header copy.

### UI: room-header status line

`apps/webapp/src/pages/RoomPage.tsx` — when
`spin_policy === "turn_based"` and `status === "active"`, render a
single line between the participant pill and the wheel:

- `EN`: "Your turn" / "Waiting for {{name}}" / "Waiting for next player"
- `UK`: "Ваш хід" / "Чекаємо на {{name}}" / "Чекаємо наступного гравця"

Lightweight inline element, not a new component file. Existing
typography tokens. The existing
`"Host spins. React with the bar above."` hint stays for `host_only`;
the turn-based hint replaces it in turn_based rooms.

### UI: hub state

The hub already disables itself when `computeCanSpin` is false
(via `isHubInteractive` from Stage A item 13). No new wiring needed —
the cursor change propagates through `computeCanSpin` automatically.

### State updates over WS

`apps/webapp/src/stores/room.ts` — `room:updated` event handler
already exists (Stage B item 10) and merges `patch` into
`snapshot.room`. The new `current_turn_user_id` field flows through
that same path with zero new code.

### CreatePage — no changes

`game_mode` picker is out of scope (non-goal). `CreatePage` continues
to send `game_mode` undefined / omitted; backend defaults to
`classic`.

---

## i18n

New keys in `apps/webapp/src/locales/{en,uk}/room.json`:

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

UK (natural Ukrainian per Stage A item 9):

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

Four keys × 2 locales = 8 new entries. `pnpm i18n:check` enforces
parity at CI. Participant display name source: existing
`first_name` (+ optional `last_name`) from `ServerParticipant`.

---

## Testing strategy

### Backend tests

`apps/api/tests/services/test_spins.py` — extends `user_can_spin`
coverage:

- `test_user_can_spin_turn_based_match` — cursor = caller → True.
- `test_user_can_spin_turn_based_mismatch` — cursor = other → False.
- `test_user_can_spin_turn_based_null_cursor` — cursor unset → False.

`apps/api/tests/services/test_turn_advance.py` (new file) — covers
`advance_turn`:

- `test_advance_skips_disconnected_participant`.
- `test_advance_wraps_to_first_when_at_end`.
- `test_advance_returns_none_when_all_offline`.
- `test_advance_from_null_cursor`.
- `test_advance_excludes_disconnected_host`.

`apps/api/tests/services/test_rooms.py` — extends `create_room`:

- `test_create_room_mode_default_elimination`.
- `test_create_room_mode_default_punishment`.
- `test_create_room_mode_default_chaos`.
- `test_create_room_mode_default_rigged`.
- `test_create_room_explicit_spin_policy_wins_over_mode`.
- `test_create_room_classic_default`.

`apps/api/tests/services/test_rooms.py` — extends `update_room`:

- `test_update_room_to_turn_based_active_sets_cursor_to_host`.
- `test_update_room_away_from_turn_based_clears_cursor`.
- `test_update_room_game_mode_does_not_clear_cursor`.

`apps/api/tests/realtime/test_handlers.py` — extends
`on_spin_trigger`:

- `test_spin_trigger_turn_based_advances_cursor`.
- `test_spin_trigger_turn_based_emits_room_updated`.
- `test_spin_trigger_turn_based_rejects_off_turn_user`.
- `test_spin_trigger_skips_advance_if_policy_changed_mid_spin`.

`apps/api/tests/api/test_rooms.py` — extends create-endpoint:

- `test_post_room_with_game_mode_in_payload`.
- `test_post_room_game_mode_drives_spin_policy_default`.

Estimated additions: **~18 backend tests**. Baseline 113 → ~131 backend
after.

### Frontend tests

`apps/webapp/src/features/rooms/__tests__/permissions.test.ts` — 2 new
turn_based cases.

`apps/webapp/src/features/rooms/__tests__/turnState.test.ts` (new
file) — covers `computeTurnState`:

- `kind: "not_turn_based"` for `spin_policy ≠ turn_based`.
- `kind: "my_turn"` when cursor = me_user_id.
- `kind: "waiting"` with named participant when cursor = other.
- `kind: "no_one"` when cursor = null.
- `kind: "no_one"` when cursor points to non-existent participant
  (defensive).
- Null snapshot → `kind: "not_turn_based"` (safe default).

Estimated additions: **~8 frontend tests**. Baseline 53 → ~61 frontend
after.

### Alembic migration test

Schema build via the `_test_db_engine` fixture exercises migrations on
test startup. Adding a nullable column is a no-op for existing rows.
Malformed migration fails the entire collect — no separate test
needed.

### Quality-gate baseline at exit

Expected: ~131 backend / ~61 frontend tests, ≥91 % coverage, mypy --strict
/ ruff / eslint / tsc --noEmit / i18n:check all green.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Migration on prod SQLite. | Nullable column with no default; safe additive. `AUTO_MIGRATE=true` runs Alembic on API boot. Old rows stay NULL. |
| Redis wipe mid-game stalls turn_based rooms. | Cursor unsets when advance returns None; recovery on next `presence:ping` cycle (~20 s). Acceptable per architecture.md's Redis-wipe policy. |
| Concurrent `_emit_settled` racing the cursor. | Stage B cooldown (1.5 s/room) makes near-impossible. SQLite serial via connection model. Becomes a real concern on Postgres migration (Stage G+); add SELECT FOR UPDATE then. Not in scope. |
| Policy change during in-flight spin. | `_emit_settled` re-fetches the room and guards on `room.spin_policy == "turn_based"` before advancing. Stale policies skip advance. |
| Pydantic null vs absent for `spin_policy`. | `Field(default=None)` with `model_config = ConfigDict(extra="forbid")`. Both explicit `null` and absent yield `None`. Documented in schema docstring. |

---

## Sequencing + branching

Direct commits on `main`, matching Stage A/B/C/cleanup-pass pattern.
Per-task quality-gate re-runs, rollback rule on regression. Order:

1. **Backend data layer.** Model column + Alembic + `advance_turn` +
   `is_users_turn` + `user_can_spin` update + `_derive_spin_policy` +
   service-level tests.
2. **Backend integration.** REST schema (`RoomCreateIn`, `ServerRoom`)
   + WS `_emit_settled` advance + `room:updated` broadcast +
   `update_room` mid-room flip and reset rules + handler tests +
   REST tests.
3. **Frontend types + helpers.** `ServerRoom` extension +
   `computeCanSpin` update + `computeTurnState` helper + frontend
   tests.
4. **Frontend UI + i18n.** Room-header status line + 4 EN + 4 UK i18n
   keys + i18n:check pass.
5. **Final gate run.** Backend + frontend + i18n all green; clean
   working tree; status block.

---

## Open questions

None. All resolved during brainstorming:

1. Scope: backend + full turn UI (confirmed).
2. Cursor storage: DB column on `rooms` (`current_turn_user_id`).
3. Advance trigger: `spin:settled`.
4. Disconnect handling: skip on advance.
5. Initial cursor: host first on lobby→active.
6. Mode-defaults override: explicit user value wins.
7. Mode picker UI: schema only, no picker (deferred).
8. Cursor reset on policy PATCH away from turn_based: yes.
9. Cursor reset on game_mode PATCH: no.
10. Mid-room flip to turn_based: set cursor = host_id when status = active.
