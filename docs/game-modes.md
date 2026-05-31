# Game Modes — Hoba!

Per-mode gameplay mechanics. See `docs/spec.md` §5 for the full product specification.

---

## Classic (§5.1)

The default mode. Every spin is independent — the wheel lands on a segment, the result is revealed, and the wheel resets to the full set for the next spin. No state carries between spins.

**Spin policy default:** `anyone`.

---

## Elimination (§5.2) — Live

Each spin eliminates the winning segment from the wheel. The game continues until only one segment remains; that segment is the survivor. The host can then start a new round, restoring all segments.

### The loop

1. Host (or any participant, depending on `spin_policy`) triggers a spin.
2. The server spins over **living segments only** (see "Living-segments contract" below).
3. On settle the server marks the winning segment as eliminated, then emits `spin:settled` with `mode_aftereffects`.
4. Clients apply the elimination locally via `applyEliminated` (store reducer).
5. The wheel visually shrinks (the eliminated segment disappears from the living set on the next render) and a brief "thunk" animation fires (scale 1→0.97→1, ~300 ms + haptic).
6. The "Remaining: N" counter in the room header decrements.
7. The eliminated segment appears in a greyscale strip below the wheel.
8. Repeat from step 1 until one segment remains.
9. When `remaining === 1`, the server sets `round_over: true` in `mode_aftereffects`.
10. Clients show the survivor banner ("🏆 {label} survives!") and hide the SPIN button.
11. The host sees a "New round" button; tapping it emits `round:reset` to the server.
12. The server clears `eliminated_at` on all segments and broadcasts `round:reset` to the room.
13. Clients call `reviveAllSegments` (store reducer) to restore all segments locally.

### `eliminated_at` model

```python
# apps/api/src/hoba_api/models/segment.py
class Segment(Base):
    eliminated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    @property
    def is_eliminated(self) -> bool:
        return self.eliminated_at is not None
```

Alembic migration: `0005_add_segment_eliminated_at.py`.

### `is_eliminated` on the wire

`SegmentOut` (schema) exposes `is_eliminated: bool` so every `room:state` and `spin:settled` payload carries the current elimination status for each segment. The client never needs to track this separately — the server is the source of truth.

```python
# apps/api/src/hoba_api/schemas/room.py
class SegmentOut(BaseModel):
    ...
    is_eliminated: bool
```

### Living-segments contract

The server always spins over **living segments** — those where `eliminated_at IS NULL` — ordered by `position`. This is the same set the client renders. Because the client builds the wheel from `snapshot.active_question.segments.filter(s => !s.is_eliminated)`, the spin animation always lands on a segment that is actually on the wheel.

### `round:reset` event

- **Client → server:** `round:reset` (Socket.IO, no payload). Host-only; a non-host caller receives `error { code: "not_host" }`.
- **Server → room broadcast:** `round:reset` (no payload). All connected clients call `reviveAllSegments` on their local snapshot.

### `spin:settled.mode_aftereffects` payload

```json
{
  "eliminated_segment_id": 3,
  "remaining": 2,
  "round_over": false,
  "survivor_segment_id": null
}
```

| Field | Type | Description |
|---|---|---|
| `eliminated_segment_id` | `number` | Segment id that was just eliminated. |
| `remaining` | `number` | Living segments left after this elimination. |
| `round_over` | `boolean` | `true` when only one survivor remains. |
| `survivor_segment_id` | `number \| null` | Id of the sole survivor when `round_over` is `true`, otherwise `null`. |

When `mode_aftereffects` is absent (Classic, other modes), clients treat the settle as a no-op for elimination state.

### Frontend helpers

- `apps/webapp/src/features/rooms/elimination.ts` — `livingSegments`, `eliminatedSegments`, `remainingCount`, `isRoundOver`.
- `apps/webapp/src/stores/room.ts` — `applyEliminated`, `reviveAllSegments` (exported pure reducers); `resetRound` action.

**Spin policy default:** `turn_based`.

---

## Punishment (§5.3) — Live (turn-based personal-bet race)

A turn-based race. Before the game each present player locks **one fixed bet** (a segment); picks must be **unique** (two players can't both bet 🍣). Players then spin **in turn** — the **host always goes first** — and the first to score **N matches** wins. The host picks N (= `1 / 3 / 5 / 7`) in the mode picker; **N = 1** means the first correct guess wins and the game ends immediately.

This is the third Punishment design. It supersedes the v2 "prediction wager" (secret guess + a single host spin) and the original "winning segment = victim" (segments are options like 🍕/🍔, never real people).

### The loop

1. **Betting (lobby).** Each present player taps a chip to lock a bet. Picks are unique; if there are **more players than segments** a duplicate is allowed (so betting can't deadlock). The game can't start until everyone present has bet.
2. **Turn.** Only the player whose turn it is may spin — host first, then join order over online bettors, wrapping. `spin:trigger` starts the game on the host's first spin (`start_game` seeds the host as `current_turn_user_id`); a spin out of turn is rejected (`not_your_turn`).
3. **Resolve spin.**
   - **Lucky** — the wheel lands on the spinner's own bet → match count +1, turn advances. Reaching N sets the winner.
   - **Punish** — lands on anything else → the spinner draws their **own** dare card (host language). The turn stays blocked until the dare is resolved.
4. **Resolve the dare** (the punished player):
   - **Виконую / I'll do it** → a **random other online player** becomes the approver (never the performer — same rule when the host is performing). The dare card disappears and the approver is asked *"Did {name} do it?"* with **Yes / No**:
     - **Yes** → per-player + room-wide done counters increment; turn advances.
     - **No** → the dare card **reappears** for the performer and the turn stays blocked until it's actually approved (`punishment:reject`).
   - **Відмовитись (−1) / Refuse** → offered only when the player has points; costs −1 match and resolves immediately (no approval). Hidden at 0 points.
   - Solo / everyone else offline → the dare auto-approves.
5. **New game** (host) → `reset_game` clears bets / counts / winner / outcome / turn; the cumulative done counters persist.

Standings show each player's `matches/N` plus a `✓done` badge (per-player performed-dare count).

### Decks

Host picks `mild` / `spicy` / `chaos` in the mode picker. Cards are server-authored content (180 cards: 3 decks × 30 × EN/UK), dealt in the **host's** language, and sent to the client only as the dealt card text (bypasses `t()` like user-entered segment labels).

### Model

Room columns: `punishment_predictions` (`{uid: seg_id}` = the bets), `spin_count` (N = matches to win), `punishment_match_counts` (`{uid: int}`), `punishment_winner_user_id`, `punishment_last_outcome` (`{spinner_id, result_segment_id, kind, card, resolved, pending_approval, approver_user_id}`), `punishment_done_count` (room-wide) + `punishment_done_counts` (`{uid: int}` per-player), `punishment_unique_bets` (always `True` for punishment rooms — no per-room toggle), plus `punishment_deck`. Alembic `0011_punishment_match_race` + `0012_punishment_v4`. Legacy v2 columns (`punishment_cards`, `punishment_result_segment_id`, `punishment_active_card`) are retained but unused (SQLite rebuild safety). Turn / race / approval logic is service-level in `apps/api/src/hoba_api/services/punishment.py`; the `modes/punishment.py` engine stays minimal. WS events: `punishment:bet`, `punishment:resolve {refuse}`, `punishment:approve`, `punishment:reject`, and turn-gated `spin:trigger`. Frontend helpers: `apps/webapp/src/features/rooms/punishment.ts`; the UI is inlined in the RoomPage punishment branch.

**Spin policy default:** `turn_based`.

---

## Chaos (§5.4) — Live (full chaos)

"Full chaos": **every** spin draws one of the events below — there is no plain spin. The event is announced on a ~1.5 s card (skewed "Hoba!" + the event) before the wheel fires. The roll is **server-authoritative** (`ChaosEngine.on_spin_request`, seeded RNG injected for tests) and never carries state between spins.

### The four events (25% each)

| Event | Effect | Where it's applied |
|---|---|---|
| `speed_run` ⚡️ | spin runs at ×0.5 duration | `duration_multiplier` on `SpinDecision` |
| `slow_burn` 🐢 | spin runs at ×1.5 duration (+ `dramatic`) | `duration_multiplier` |
| `reverse` 🔄 | wheel travels counter-clockwise to the same sector | spin service re-targets `final_angle_deg` below the start (engines never compute angles) |
| `swap` 🔀 | two segments trade positions for this spin | engine reorders `SpinDecision.segments` + emits `segment_order` (the client renders that order or it lands on the wrong sector) |

### Attempts (best-of-N)

The host picks **N ∈ {1, 3, 5, 7}** in the mode picker (like Punishment). With N > 1 the room runs a **best-of-N** round: each spin (turn-based) is one chaotic spin, the server tallies `result_segment_id` across the round, and the **most-frequent segment wins** (ties keep the round open; host "New round" resets). This reuses the Classic best-of-N machinery (`game_mode in (classic, chaos)` gate in `_emit_settled`, `bon_*` columns, `bestOfN.ts` helpers). N = 1 is a single chaotic spin, no contest.

### Spin policy

`spin_policy` default: **`turn_based`** (host first, then take turns). The settings sheet offers **host_only** and **turn_based** only — "anyone can spin" is hidden for Chaos.

### Wire

The event is **folded into `spin:started.mode_effects`** (no separate `chaos:event` broadcast): `{ "chaos_event": "<name>", "segment_order"?: [int...], "dramatic"?: true }`. No new DB columns; the whole feature rides the existing `SpinDecision.effects` → `mode_state_snapshot.mode_effects` → `spin:started` channel.

### Client

- `apps/webapp/src/features/rooms/chaos.ts` — `CHAOS_EVENTS`, `CHAOS_EVENT_EMOJI`, `orderSegmentsForSpin` (the swap reorder).
- RoomPage spin-drive effect holds a `CHAOS_ANNOUNCE_MS = 1500` announcement card (skewed `<HobaWord/>` + event) before releasing the wheel, and pushes the settle/reveal timers back by that pre-roll. `reverse` needs no extra client work (the server angle already goes backwards; Framer animates to the smaller number).

### Deferred (spec §5.4, not yet built)

- **`nudge ±1`** — wheel settles, then creeps one sector forward/back, changing the result. Needs a two-phase wheel animation (settle → pause → nudge); tracked in `docs/TODO.md`.
- **Double-spin** and **Phantom-segment** — also deferred.

---

## Rigged (§5.5) — Planned

Long-press reveal only (not surfaced in the standard mode picker). Host secretly pre-selects the outcome. Planned for a later stage.

## Best-of-N spins (cross-mode)

The host can set `spin_count` ∈ {1, 3, 5, 7} (default 1) when creating a room
(Classic only this slice; Elimination/Punishment ignore it and always spin
once). When N > 1, one trigger runs **N server-side spins**; the
**most-frequent segment wins**. Ties are broken by extra spins counted only
when they land on a tied leader, until one leads (capped, then random).

- Server (`run_spin_series` in `services/spins.py`): chains angles forward,
  tallies hits, resolves ties; compresses every sub-spin except the last to a
  fast duration (`FAST_SUBSPIN_MS`), so only the finale plays full-length.
- Wire: `spin:started` carries `series` (the sub-spins) + `winner_segment_id`;
  `_emit_settled` is scheduled over the **series total** duration.
- Client (`features/wheel/spinSeries.ts` + RoomPage): animates each sub-spin in
  order with a live tally chip row ("🍕 2 · 🍣 1"), then the dramatic final +
  "Хоба!" on the winner.

Solo best-of-N (the wheel screen) is a planned follow-up; solo currently spins
once.
