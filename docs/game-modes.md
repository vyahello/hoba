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

## Chaos (§5.4) — Live (bet race + chaos events)

Chaos is a **personal-bet race** — the same flow as Punishment, minus the dares, plus a chaos event on every spin. Each player locks a unique option (a segment); players spin **in turn** (host first); landing on **your own** bet scores a match; **first to N matches wins** (host picks `N ∈ {1,3,5,7}`). A miss is a **no-op** (just confetti + next turn — no dare). On **every** spin a chaos event also fires, announced on a ~1.5 s card before the wheel.

This reuses Punishment's whole betting/turn/standings/winner flow: backend `services/punishment.py` (`place_bet`, `start_game`, `resolve_turn`, `reset_game`) and the same room columns (`punishment_predictions` = bets, `spin_count` = N, `punishment_match_counts`, `punishment_winner_user_id`, `punishment_last_outcome`). The only fork is `resolve_turn`'s miss branch (`game_mode == "chaos"` → `kind: "miss"`, advance, no card). The frontend shares the UI via `isBetRace(snap) = punishment | chaos`; dare/approval UI auto-disables because chaos outcomes are never `"punish"`.

During play, the standings list every player's `option matches/N`; the **viewer's own row is highlighted** (★ "You", brand-primary) so they always know which option is theirs.

**Per-spin feedback:** no confetti on every stop. When the wheel settles, the **landed wedge flashes** (an animated highlight on the `<Wheel>` via `highlightSegmentId`, used by both Chaos and Punishment) so it's clear which option came up. A **hit** (lands your own option, non-winning) also shows the **"Hoba! {option}"** lucky banner in the standings area; a **miss** shows nothing. The **winning** hit flips the phase to `over` immediately, so the lucky banner is skipped and only the **winner hero** ("{option} wins! 🏆") shows — they never overlap. The winner hero fires its own confetti (chaos-only effect, since Chaos has no per-spin burst).

### The seven chaos events (≈⅐ each)

| Event | Effect | Where it's applied |
|---|---|---|
| `multi_spin` ⚡️ | a burst of `spin_reps` (2–5) short fast spins; the **last** lands the recorded result | engine picks `spin_reps`; the client plays the quick spins (random angles) then the server final |
| `slow_burn` 🐢 | a slow spin, no fast whip, with a **drawn-out sticky finish** | `duration_multiplier = 2.0`, the spin service **trims to `SLOW_BURN_TURNS = 3` turns** (so it can't whip through 5–8 revolutions), and `SpinResult.ease = [0.2, 0.1, 0.5, 1]` (gentle start, long flat tail = slow drawn-out end) |
| `reverse` 🔄 | wheel travels counter-clockwise to the same sector | spin service re-targets `final_angle_deg` below the start (engines never compute angles) |
| `swap` 🔀 | two segments trade positions; the announcement card shows the two **crossing** so it's visible | engine reorders `SpinDecision.segments` + emits `segment_order` (client renders that order) + `swap_pair` (the two ids for the card) |
| `nudge_fwd` ⏩ / `nudge_back` ⏪ | wheel settles, "thinks" (shake), then creeps **±1 sector** — changing the result. Both share **one generic "nudge" announcement** (direction not spoiled; only the creep reveals it) | spin service records the nudged segment + the nudged `final_angle_deg`, carries the pre-nudge stop in `nudge_from_angle`; client plays settle → shake → creep |
| `blind_pointer` 🫥 | normal spin, but the **pointer vanishes** during it and **reappears at a random screen angle** on stop — whatever it lands on is the result | spin service picks a random `pointer_deg` and computes the result = segment under it (`floor(((P − A) mod 360)/sector)`); `<Wheel pointerHidden pointerDeg>` hides the pointer while spinning, reveals it at `P` when settled |

The match-count uses the **recorded** `result_segment_id` (the *nudged* one for nudge, the *under-pointer* one for blind_pointer), so the race stays consistent with what the wheel finally shows. The announcement card holds `CHAOS_ANNOUNCE_MS = 2500` (long enough to read).

**No back-to-back repeats:** the engine never announces the same event two spins running — `trigger_spin` feeds the previous `chaos_event` into `SpinContext.last_chaos_event`, and `ChaosEngine` picks from the events whose displayed group differs (the two nudges count as one group, since they share a card). Prevents the "same event 3–4× in a row" feel.

### Spin policy

Chaos is **`turn_based` only** (host first, then take turns; if nobody else is present the host plays alone). There is no spin-policy choice — the settings gear is hidden (host_only made no sense for a multi-player bet race). The host picks **N** (matches to win) in the mode picker.

### Wire

The event is **folded into `spin:started.mode_effects`** (no separate `chaos:event` broadcast): `{ "chaos_event": "<name>", "segment_order"?: [int...], "dramatic"?: true }`. No new DB columns; the whole feature rides the existing `SpinDecision.effects` → `mode_state_snapshot.mode_effects` → `spin:started` channel.

### Client

- `apps/webapp/src/features/rooms/chaos.ts` — `CHAOS_EVENTS`, `CHAOS_EVENT_EMOJI`, `orderSegmentsForSpin` (the swap reorder).
- The RoomPage spin-drive effect is an **async choreography** (guarded by a `cancelled` flag): a `CHAOS_ANNOUNCE_MS = 1500` announcement card (skewed `<HobaWord/>` + event; for `swap`, the two `swap_pair` labels visibly cross; `nudge_fwd`/`nudge_back` share one generic "nudge" card) → the wheel phases → settle → confetti. `multi_spin` feeds `spin_reps` sequential `SpinResult`s to `<Wheel>` (via a `phaseSpin` override + `wheelRef.getCurrentRotation()`); `nudge_*` does spin → container shake (`useAnimate` on the wheel scope) → one-sector creep. `reverse`/`slow_burn` need no extra client work (the server angle/duration already encode them). Tunable constants: `MULTI_SPIN_STEP_MS`, `MULTI_SPIN_FINAL_MS`, `NUDGE_SHAKE_MS`, `NUDGE_CREEP_MS`.

### Deferred (spec §5.4, not yet built)

- **Double-spin** (two fully-counted results) and **Phantom-segment** (ephemeral non-DB 13th segment) — tracked in `docs/TODO.md`.

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
