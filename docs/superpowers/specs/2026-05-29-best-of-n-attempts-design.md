# Best-of-N v2 — N manual attempts (redesign)

> Replaces the auto-N best-of-N shipped earlier today (where one tap made the
> server spin N times automatically). New model: `spin_count` = N **manual
> attempts** — each tap is one real full spin; the round runs N attempts (more
> on a tie), tallies them, and the most-frequent segment wins.

## Why the change

The first version misread intent: it auto-span N times on one trigger. The
owner wants N **tries** — the group keeps spinning (per the room's spin_policy),
each spin counts, a live "Attempt k/N" + tally shows, and after N (or until a
tie resolves) the winner is the most-frequent segment.

## Decisions (locked)

- `spin_count` = number of manual attempts in a round (1/3/5/7; default 1).
- Each attempt = one normal full spin (no fast auto-series). Who spins each
  attempt follows the existing `spin_policy` (anyone / host_only / turn_based
  round-robin — best-of-N composes on top).
- Live progress: "Attempt k/N" + running tally chip row, updated every settle.
- Round end (attempts == N, no tie): finalize → winner = most-frequent →
  "Хоба!" + winner hero; host taps **New round** to reset (counter/tally/winner
  cleared). Spinning is blocked while a winner is shown.
- Tie at N: round does **not** finalize — keep allowing attempts until one
  segment leads.
- Round state stored as explicit `bon_*` columns on `rooms` (Alembic 0008).
- Classic + solo this slice; Elimination/Punishment ignore `spin_count`
  (always single attempt). Solo computes the round locally.

## Revert from v1

Remove the auto-series: `run_spin_series` and its tests, the `series` /
`winner_segment_id` keys in `spin.mode_state_snapshot` + `spin:started`, the
`FAST_SUBSPIN_MS` compression, and the client series-animation (`spinSeries.ts`
+ RoomPage sub-spin driver). `trigger_spin` returns to one spin per call. The
`spin_count` **column** (0007) stays — it's reused as the attempts target.

---

## 1. Data model (Alembic 0008)

Keep `rooms.spin_count` (the target N, from 0007). Add round-progress columns:

- `bon_attempts: int` — attempts taken this round (default 0).
- `bon_tally: JSON` — `{segment_id(str): count}` for the current round (default
  `{}` / null).
- `bon_winner_segment_id: int | None` — set when the round finalizes; null =
  round in progress. While non-null, spinning is gated.

(Prefix `bon_` = best-of-N. JSON for tally mirrors `punishment_active_card`.)

`RoomOut` exposes `spin_count`, `bon_attempts`, `bon_tally`,
`bon_winner_segment_id`. `RoomUpdateIn` keeps `spin_count`.

## 2. Server: per-attempt flow

`trigger_spin` (revert to single spin):
1. Existing guards + the new gate: if `room.spin_count > 1` and
   `room.bon_winner_segment_id is not None` → raise `round_over` (must reset
   first). (For `spin_count == 1`, no best-of-N round; behaves as today.)
2. Compute ONE spin (the current single-spin path). Persist the `Spin`.

`_emit_settled` (handler) — after the spin animation, for Classic rooms with
`spin_count > 1`:
1. Reload room; `attempts = room.bon_attempts + 1`; bump `bon_tally[winner] +=
   1`; set `room.bon_attempts = attempts`.
2. Determine leaders = segment ids at the max tally count. If `attempts >=
   spin_count` AND `len(leaders) == 1` → `room.bon_winner_segment_id =
   leaders[0]` (finalize). Else leave null (round continues; ties keep it open).
3. Commit; broadcast `room:updated { patch: { bon_attempts, bon_tally,
   bon_winner_segment_id } }`.

`_emit_settled` still emits `spin:settled` (single result) first, as today, so
the wheel reveals each attempt's landed segment normally.

New `bon:reset` WS handler (host-only): `bon_attempts=0`, `bon_tally={}`,
`bon_winner_segment_id=None`; commit; broadcast `room:updated` patch +
`bon:reset` event. (Mirrors `round:reset`.)

Reset also happens implicitly when `spin_count` is changed via PATCH, and on a
fresh question — keep it simple: PATCH of `spin_count` clears the bon_* round.

## 3. Frontend

- `lib/api.ts ServerRoom`: add `bon_attempts: number`,
  `bon_tally: Record<string, number>`, `bon_winner_segment_id: number | null`.
  (`spin_count` already added in 0007 slice.)
- Remove `SpinStartedEvent.series` / `winner_segment_id` and `spinSeries.ts` +
  its test + the RoomPage sub-spin driver (revert to single-spin animation).
- `features/rooms/bestOfN.ts` (pure): `isBestOfN(snap)` (`spin_count > 1` &&
  classic), `attempts(snap)`, `target(snap)`, `tally(snap)` (Map),
  `roundWinnerId(snap)`, `roundOver(snap)` (winner != null). Unit-tested.
- Store: `bestOfNReset()` action emits `bon:reset`; the existing `room:updated`
  patch handler already merges `bon_*` into `snapshot.room`.
- RoomPage (classic, spin_count>1):
  - "Attempt k/N" + tally chip row under the wheel (from `bon_*`), live.
  - When `roundOver`: winner hero ("Хоба! {label}" + confetti) replacing the
    idle wheel CTA; host **New round** button → `bestOfNReset()`.
  - Spin hub disabled while `roundOver`.
  - Each attempt animates as a normal full spin (current single-spin path).
- Solo (`SpinPage`): local best-of-N — keep an attempts counter + tally in
  component state; each hub tap spins once, increments, and on N shows the
  winner with a "New round" reset. No server.
- i18n EN/UK: `room.best_of_n.attempt` ("Attempt {k}/{n}"),
  `best_of_n.winner` ("🏆 {label}"), `best_of_n.new_round`. (Reuse
  `spin_count.label` "Spins" from the picker.)

## 4. Testing

### Backend
- `trigger_spin` classic spin_count=1 unchanged (single spin, no bon gate).
- `_emit_settled` classic spin_count=3: each settle bumps `bon_attempts` +
  `bon_tally`; finalizes winner only at attempts>=N with a single leader; a
  tie at N keeps `bon_winner_segment_id` null.
- `trigger_spin` raises `round_over` when `bon_winner_segment_id` set.
- `bon:reset` clears the three fields + broadcasts (host-only; guest → not_host).
- Elimination/Punishment with spin_count=5 never set bon_* (single attempt).
- `RoomOut` serializes the bon_* fields.

### Frontend
- `bestOfN.ts` helpers (attempts/target/tally/roundOver/winner).
- Store `bestOfNReset` emits; patch merges bon_*.
- (Animation manual-verify; revert of series animation verified by tsc + tests.)

### Docs
- Rewrite the `docs/game-modes.md` "Best-of-N" subsection to the attempts model.

### Gates
`pytest` + `mypy --strict` + `ruff` + `vitest` + `tsc` + `eslint` + `i18n:check`.

## Open questions / deferred

- turn_based + best-of-N: the cursor advances per attempt (existing advance on
  settle); the round spans multiple players' turns — works without extra code.
- Punishment v2 "prediction" slice can build its winner on this attempts loop
  later.
