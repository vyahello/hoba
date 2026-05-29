# Best-of-N spins (`spin_count`) — design

> Stage D, cross-mode foundation slice. Adds a host-chosen number of spins per
> trigger; the most-frequent segment over N spins wins. This slice wires it for
> **Classic + solo only**. Elimination/Punishment ignore it (they get it in
> their own slices — Punishment's "prediction" rework is the planned slice 2
> that builds on this).

## Goal

A host can set `spin_count` ∈ {1, 3, 5, 7} (default 1). When N > 1, one spin
trigger runs N spins server-side; the **winner is the segment that came up
most often**. Ties are broken by extra tie-break spins among the leaders. The
client animates the N spins quickly with a live tally, then a full dramatic
final spin + "Хоба!" on the winner.

## Decisions locked in brainstorming

- **Options:** 1 / 3 / 5 / 7 (odd → fewer ties). Default 1.
- **Animation:** fast sub-spins (~1.5–2 s each) with a live tally under the
  wheel; the final spin is full/dramatic + "Хоба!". Tie-break spins (if any)
  play as a quick "overtime" before the final.
- **Ties:** server runs extra tie-break spins **among the tied leaders only**,
  repeating until one leads. Deterministic, server-authoritative.
- **Modes this slice:** Classic + solo. Elimination/Punishment ignore
  `spin_count` (treat as 1).
- **Who/where:** set at room creation (mode picker) and on the solo wheel
  (settings). Server-authoritative field on `rooms`; solo computes locally.

## Scope

In: `rooms.spin_count` (Alembic 0007) + schema + create; `trigger_spin` runs N
+ tie-break + records the series; `spin:started`/`spin:settled` carry the
series; frontend series animation + tally + the N picker (mode sheet + solo);
tests.

Out: Elimination/Punishment best-of-N; the Punishment prediction rework
(slice 2); changing the deck/card system.

## Non-negotiables

- Server-authoritative spin + winner selection (rule 2) — the client only
  animates a server-decided series.
- `mypy --strict` / `tsc` clean (rule 3); user strings via `t()` (rule 5).
- No new abstraction (rule 6) — extend the existing spin pipeline.

---

## 1. Data model (Alembic 0007)

One column on `rooms`:

- `spin_count: int` — default 1, `server_default="1"`, not null. Validated in
  `create_room` to be one of {1, 3, 5, 7} (else `bad_spin_count`).

`RoomOut` exposes `spin_count`; `RoomCreateIn` accepts it (default 1);
`RoomUpdateIn` accepts it (host can change between rounds).

Solo has no room row — `SpinPage` holds `spin_count` in local state and passes
it to the local `computeSpin` loop (no persistence needed).

## 2. Server: multi-spin in `trigger_spin`

Today `trigger_spin` computes one `compute_spin` and persists one `Spin`. New
behavior, gated on the effective count:

```
effective_n = room.spin_count if room.game_mode == "classic" else 1
```
(Elimination/Punishment force 1 — they ignore the setting this slice.)

For `effective_n > 1`:
1. Run `effective_n` `compute_spin` calls, chaining `starting_angle_deg` from
   each result's `final_angle_deg` to the next (same forward-travel rule as the
   existing chain), over the same spin segments.
2. Tally segment hits. `winner` = max count. **Tie:** run additional spins
   restricted to the tied-leader segments (re-tally only those) until a single
   leader emerges; cap the tie-break loop at a safe bound (e.g. 20 extra) and
   on the (astronomically unlikely) cap, pick randomly among leaders.
3. Persist a single `Spin` whose `result_segment_id = winner.id`,
   `final_angle_deg`/`duration_ms` = the **last** sub-spin's (so existing
   "chain forward from last spin" still works next round), and record the full
   series in `mode_state_snapshot`:
   ```json
   {
     "series": [
       {"segment_id": 12, "final_angle_deg": 2310.5, "duration_ms": 1800, "seed": 123},
       ...
     ],
     "tally": {"12": 2, "15": 1},
     "winner_segment_id": 12,
     "tie_break_count": 0
   }
   ```
   For `effective_n == 1`, `series` has one entry (keeps the client path
   uniform); existing `living_segment_ids`/`mode_effects` keys remain for
   elimination/punishment.

A helper `_run_spin_series(segments, starting_angle, n, weights)` keeps
`trigger_spin` readable and unit-testable in isolation (pure math, no DB).

## 3. Realtime: carry the series

`spin:started` payload gains `series` (the list above) and `winner_segment_id`;
keeps `result_segment_id` = winner for back-comp. `_emit_settled` is unchanged
in contract (still fires after the animation, settles mode after-effects on the
winner) — the **settle delay** the server schedules must cover the whole series
(sum of sub-spin durations + the final), so `_schedule(_emit_settled(... ))`
uses the series total, not a single duration.

## 4. Frontend: series animation + tally

- `SpinStartedEvent` (store) gains `series: SubSpin[]` + `winner_segment_id`.
- RoomPage/SpinPage drive the wheel through the series: for each sub-spin, run a
  **fast** animation (~1.5–2 s) and update a **live tally** chip row under the
  wheel ("🍕 2 · 🍣 1"); the **last** sub-spin runs the normal full/dramatic
  duration, then the existing reveal ("Хоба!" + winner). Tie-break sub-spins
  render the same as normal sub-spins (quick), just continuing the series.
- A small pure helper `features/wheel/spinSeries.ts`:
  `tallyAfter(series, i)` → running counts for the chip row; `isFinalSubSpin(i,
  len)`. Unit-tested.
- The wheel itself spins over the same segments each sub-spin; only the target
  angle/duration differ per entry.

## 5. The N picker

- **Mode picker (`RoomModePickerSheet`):** a small "Spins: 1 / 3 / 5 / 7" chip
  row (default 1), always visible (applies to Classic; for Elimination/
  Punishment it's still sent but ignored server-side — or hide it unless
  `selected === "classic"` to avoid implying it affects them; **hide unless
  classic** to prevent confusion). `onCreate` carries `spin_count`.
- **Solo (`SpinPage`):** a matching chip row near the wheel; drives the local
  N-spin loop. Persists nothing.
- i18n (room namespace, EN + UK): `spin_count.title` ("Spins"),
  `spin_count.tally` is not needed (chips render emoji+count directly), but add
  `spin_count.label` if a header is shown.

## 6. Testing

### Backend
- `_run_spin_series`: returns N entries; winner = most frequent; chains angle
  forward; tie → tie-break spins until single leader; cap fallback random.
- `trigger_spin`: classic N=3 records a 3-entry series + winner; elimination/
  punishment force N=1 even if `spin_count` set; `bad_spin_count` on create.
- `_emit_settled` settle delay covers the series total (the spin still settles
  on the winner; mode after-effects unaffected).
- `RoomOut.spin_count` serialization; `create_room`/`update_room` accept it.

### Frontend
- `spinSeries.ts` helpers (running tally; final detection).
- Mode picker: N chip row visible only for classic; `onCreate` passes count.
- (Animation is manual-verify; the series-drive logic via the helper is tested.)

### Docs
- `docs/game-modes.md`: a short "Best-of-N" subsection (cross-mode; Classic +
  solo this slice). Update CLAUDE.md index note.

### Gates
`pytest` + `mypy --strict` + `ruff` + `vitest` + `tsc` + `eslint` + `i18n:check`.

## Open questions / deferred

- Elimination/Punishment best-of-N: deferred to their slices (Punishment's is
  the prediction rework — slice 2, which consumes this series infra).
- Per-sub-spin haptics/sound: keep the existing tick/launch sounds; tune in a
  later polish pass if the fast cadence is noisy.
